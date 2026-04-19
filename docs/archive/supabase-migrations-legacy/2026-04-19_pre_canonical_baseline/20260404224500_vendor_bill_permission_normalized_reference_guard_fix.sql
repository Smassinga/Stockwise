begin;

create or replace function public.vendor_bill_hardening_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_company_id uuid;
begin
  if tg_op = 'INSERT' then
    v_company_id := new.company_id;
  elsif tg_op = 'UPDATE' then
    v_company_id := coalesce(new.company_id, old.company_id);
  else
    v_company_id := old.company_id;
  end if;

  if tg_op = 'INSERT' then
    if not public.finance_documents_can_prepare_draft(v_company_id) then
      raise exception using
        message = 'Vendor bill draft creation access denied.';
    end if;

    new.document_workflow_status := coalesce(new.document_workflow_status, 'draft');
    new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), 'draft');

    if new.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Vendor bills must start in draft status.';
    end if;

    if new.approval_status <> 'draft' then
      raise exception using
        message = 'Vendor bills must start with draft approval status.';
    end if;

    new.posted_at := null;
    new.posted_by := null;
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.approval_requested_at := null;
    new.approval_requested_by := null;
    new.approved_at := null;
    new.approved_by := null;
    return new;
  end if;

  new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), old.approval_status, 'draft');

  if new.document_workflow_status is distinct from old.document_workflow_status
     and new.approval_status is distinct from old.approval_status then
    raise exception using
      message = 'Vendor bill approval and legal workflow transitions must be performed separately.';
  end if;

  if new.approval_status is distinct from old.approval_status then
    if old.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Vendor bill approval state cannot change once the document is posted or voided.';
    end if;

    case old.approval_status
      when 'draft' then
        if new.approval_status <> 'pending_approval' then
          raise exception using
            message = 'Vendor bills can only move from draft to pending approval.';
        end if;
        if not public.finance_documents_can_submit_for_approval(v_company_id) then
          raise exception using
            message = 'Vendor bill approval request access denied.';
        end if;
        new.approval_requested_at := coalesce(new.approval_requested_at, now());
        new.approval_requested_by := coalesce(new.approval_requested_by, auth.uid());
        new.approved_at := null;
        new.approved_by := null;
      when 'pending_approval' then
        if new.approval_status = 'approved' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Vendor bill approval access denied.';
          end if;
          new.approval_requested_at := coalesce(old.approval_requested_at, new.approval_requested_at, now());
          new.approval_requested_by := coalesce(old.approval_requested_by, new.approval_requested_by, auth.uid());
          new.approved_at := coalesce(new.approved_at, now());
          new.approved_by := coalesce(new.approved_by, auth.uid());
        elsif new.approval_status = 'draft' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Vendor bill approval reset access denied.';
          end if;
          new.approval_requested_at := null;
          new.approval_requested_by := null;
          new.approved_at := null;
          new.approved_by := null;
        else
          raise exception using
            message = 'Vendor bills can only move from pending approval to approved or back to draft.';
        end if;
      when 'approved' then
        if new.approval_status <> 'draft' then
          raise exception using
            message = 'Approved vendor bills can only be returned to draft before posting.';
        end if;
        if not public.finance_documents_can_approve(v_company_id) then
          raise exception using
            message = 'Vendor bill approval reset access denied.';
        end if;
        new.approval_requested_at := null;
        new.approval_requested_by := null;
        new.approved_at := null;
        new.approved_by := null;
      else
        raise exception using
          message = format('Vendor bill approval state %s is not recognized.', old.approval_status);
    end case;

    if new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by'])
         is distinct from
           (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by']) then
      raise exception using
        message = 'Vendor bill approval transitions cannot edit draft content. Save draft changes before approval routing.';
    end if;
  elsif old.document_workflow_status = 'draft' then
    if old.approval_status = 'draft' then
      if new.document_workflow_status = old.document_workflow_status
         and not public.finance_documents_can_prepare_draft(v_company_id) then
        raise exception using
          message = 'Vendor bill draft edit access denied.';
      end if;
    elsif new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized'])
         is distinct from
           (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized']) then
      raise exception using
        message = 'Vendor bills are locked once they are pending approval or approved. Return the document to draft before editing it.';
    end if;
  elsif old.document_workflow_status = 'posted'
     and new.document_workflow_status = old.document_workflow_status
     and (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized'])
       is distinct from
         (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized']) then
    raise exception using
      message = 'Posted vendor bills are immutable.';
  elsif old.document_workflow_status = 'voided'
     and (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized'])
       is distinct from
         (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized']) then
    raise exception using
      message = 'Voided vendor bills are immutable.';
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status = 'posted' then
          if old.approval_status <> 'approved' then
            raise exception using
              message = 'Vendor bills must be approved before posting.';
          end if;
          if not public.finance_documents_can_issue_legal(v_company_id) then
            raise exception using
              message = 'Vendor bill post access denied.';
          end if;
        elsif new.document_workflow_status = 'voided' then
          if not public.finance_documents_can_void(v_company_id) then
            raise exception using
              message = 'Vendor bill void access denied.';
          end if;
        else
          raise exception using
            message = format(
              'Vendor bill status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Vendor bill status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
        if not public.finance_documents_can_void(v_company_id) then
          raise exception using
            message = 'Vendor bill void access denied.';
        end if;
        if (to_jsonb(new) - array['updated_at', 'supplier_invoice_reference_normalized', 'document_workflow_status', 'voided_at', 'voided_by', 'void_reason'])
             is distinct from
           (to_jsonb(old) - array['updated_at', 'supplier_invoice_reference_normalized', 'document_workflow_status', 'voided_at', 'voided_by', 'void_reason']) then
          raise exception using
            message = 'Posted vendor bills can only change workflow and void metadata during a void transition.';
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Vendor bill status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Vendor bill status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  return new;
end;
$function$;

commit;
