begin;

alter table public.sales_invoices
  add column if not exists approval_status text,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_requested_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid;

alter table public.vendor_bills
  add column if not exists approval_status text,
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_requested_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid;

update public.sales_invoices
set approval_status = case
      when document_workflow_status in ('issued', 'voided') then 'approved'
      else coalesce(approval_status, 'draft')
    end,
    approval_requested_at = case
      when document_workflow_status in ('issued', 'voided') then coalesce(approval_requested_at, issued_at, updated_at, created_at)
      else approval_requested_at
    end,
    approval_requested_by = case
      when document_workflow_status in ('issued', 'voided') then coalesce(approval_requested_by, issued_by, created_by)
      else approval_requested_by
    end,
    approved_at = case
      when document_workflow_status in ('issued', 'voided') then coalesce(approved_at, issued_at, updated_at, created_at)
      else approved_at
    end,
    approved_by = case
      when document_workflow_status in ('issued', 'voided') then coalesce(approved_by, issued_by, created_by)
      else approved_by
    end
where approval_status is null
   or document_workflow_status in ('issued', 'voided');

update public.vendor_bills
set approval_status = case
      when document_workflow_status in ('posted', 'voided') then 'approved'
      else coalesce(approval_status, 'draft')
    end,
    approval_requested_at = case
      when document_workflow_status in ('posted', 'voided') then coalesce(approval_requested_at, posted_at, updated_at, created_at)
      else approval_requested_at
    end,
    approval_requested_by = case
      when document_workflow_status in ('posted', 'voided') then coalesce(approval_requested_by, posted_by, created_by)
      else approval_requested_by
    end,
    approved_at = case
      when document_workflow_status in ('posted', 'voided') then coalesce(approved_at, posted_at, updated_at, created_at)
      else approved_at
    end,
    approved_by = case
      when document_workflow_status in ('posted', 'voided') then coalesce(approved_by, posted_by, created_by)
      else approved_by
    end
where approval_status is null
   or document_workflow_status in ('posted', 'voided');

update public.sales_invoices
set approval_status = 'draft'
where approval_status is null;

update public.vendor_bills
set approval_status = 'draft'
where approval_status is null;

alter table public.sales_invoices
  alter column approval_status set default 'draft',
  alter column approval_status set not null;

alter table public.vendor_bills
  alter column approval_status set default 'draft',
  alter column approval_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_invoices_approval_status_check'
      and conrelid = 'public.sales_invoices'::regclass
  ) then
    alter table public.sales_invoices
      add constraint sales_invoices_approval_status_check
      check (approval_status in ('draft', 'pending_approval', 'approved'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'vendor_bills_approval_status_check'
      and conrelid = 'public.vendor_bills'::regclass
  ) then
    alter table public.vendor_bills
      add constraint vendor_bills_approval_status_check
      check (approval_status in ('draft', 'pending_approval', 'approved'));
  end if;
end
$$;

create or replace function public.finance_documents_is_system_context()
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(auth.role(), '') = 'service_role'
      or (auth.uid() is null and coalesce(auth.role(), '') = '');
$function$;

create or replace function public.finance_documents_has_min_role(p_company_id uuid, p_min_role public.member_role)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_is_system_context()
      or exists (
        select 1
        from public.company_members cm
        where cm.company_id = p_company_id
          and cm.user_id = auth.uid()
          and cm.status = 'active'
          and cm.role <= p_min_role
      );
$function$;

create or replace function public.finance_documents_can_prepare_draft(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'OPERATOR'::public.member_role);
$function$;

create or replace function public.finance_documents_can_submit_for_approval(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'OPERATOR'::public.member_role);
$function$;

create or replace function public.finance_documents_can_approve(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$function$;

create or replace function public.finance_documents_can_issue_legal(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$function$;

create or replace function public.finance_documents_can_void(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$function$;

create or replace function public.finance_documents_can_issue_adjustment(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$function$;

create or replace function public.finance_documents_can_post_adjustment(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$function$;

create or replace function public.finance_documents_can_manage_settlement(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$function$;

create or replace function public.finance_documents_can_manage_due_reminders(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_has_min_role(p_company_id, 'ADMIN'::public.member_role);
$function$;

create or replace function public.finance_documents_can_write(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_can_prepare_draft(p_company_id);
$function$;

create or replace function public.finance_documents_internal_transition_bypass()
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_is_system_context()
      or coalesce(current_setting('stockwise.finance_transition_bypass', true), '') = 'on';
$function$;

create or replace function public.finance_document_header_event_journal()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_document_kind text;
  v_event_type text;
  v_from_status text;
  v_to_status text;
  v_payload jsonb;
  v_new_row jsonb;
  v_old_row jsonb;
begin
  v_document_kind := case tg_table_name
    when 'sales_invoices' then 'sales_invoice'
    when 'sales_credit_notes' then 'sales_credit_note'
    when 'sales_debit_notes' then 'sales_debit_note'
    when 'vendor_bills' then 'vendor_bill'
    when 'vendor_credit_notes' then 'vendor_credit_note'
    when 'vendor_debit_notes' then 'vendor_debit_note'
    else null
  end;

  if v_document_kind is null then
    raise exception using
      message = format('finance_document_header_event_journal does not support table %s.', tg_table_name);
  end if;

  v_new_row := to_jsonb(new);
  v_old_row := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;

  if tg_op = 'INSERT' then
    v_event_type := 'draft_created';
    v_from_status := null;
    v_to_status := new.document_workflow_status;
  elsif tg_op = 'UPDATE' and new.document_workflow_status is distinct from old.document_workflow_status then
    v_from_status := old.document_workflow_status;
    v_to_status := new.document_workflow_status;
    v_event_type := case new.document_workflow_status
      when 'issued' then 'issued'
      when 'posted' then 'posted'
      when 'voided' then 'voided'
      else 'status_changed'
    end;
  elsif tg_op = 'UPDATE'
     and (v_new_row ? 'approval_status')
     and (v_old_row ->> 'approval_status') is distinct from (v_new_row ->> 'approval_status') then
    v_from_status := v_old_row ->> 'approval_status';
    v_to_status := v_new_row ->> 'approval_status';
    v_event_type := case v_new_row ->> 'approval_status'
      when 'pending_approval' then 'approval_requested'
      when 'approved' then 'approved'
      when 'draft' then 'returned_to_draft'
      else 'approval_status_changed'
    end;
  else
    return null;
  end if;

  v_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'internal_reference', v_new_row ->> 'internal_reference',
      'document_status', v_new_row ->> 'document_workflow_status',
      'approval_status', v_new_row ->> 'approval_status',
      'approval_requested_at', v_new_row ->> 'approval_requested_at',
      'approved_at', v_new_row ->> 'approved_at',
      'source_origin', v_new_row ->> 'source_origin',
      'supplier_reference', coalesce(v_new_row ->> 'supplier_invoice_reference', v_new_row ->> 'supplier_document_reference')
    )
  );

  perform public.append_finance_document_event(
    new.company_id,
    v_document_kind,
    new.id,
    v_event_type,
    v_from_status,
    v_to_status,
    v_payload
  );

  return null;
end;
$function$;

create or replace function public.sales_invoice_hardening_guard()
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
        message = 'Sales invoice draft creation access denied.';
    end if;

    new.document_workflow_status := coalesce(new.document_workflow_status, 'draft');
    new.approval_status := coalesce(nullif(btrim(coalesce(new.approval_status, '')), ''), 'draft');

    if new.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Sales invoices must start in draft status.';
    end if;

    if new.approval_status <> 'draft' then
      raise exception using
        message = 'Sales invoices must start with draft approval status.';
    end if;

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
      message = 'Sales invoice approval and legal workflow transitions must be performed separately.';
  end if;

  if new.approval_status is distinct from old.approval_status then
    if old.document_workflow_status <> 'draft' then
      raise exception using
        message = 'Sales invoice approval state cannot change once the document is issued or voided.';
    end if;

    case old.approval_status
      when 'draft' then
        if new.approval_status <> 'pending_approval' then
          raise exception using
            message = 'Sales invoices can only move from draft to pending approval.';
        end if;
        if not public.finance_documents_can_submit_for_approval(v_company_id) then
          raise exception using
            message = 'Sales invoice approval request access denied.';
        end if;
        new.approval_requested_at := coalesce(new.approval_requested_at, now());
        new.approval_requested_by := coalesce(new.approval_requested_by, auth.uid());
        new.approved_at := null;
        new.approved_by := null;
      when 'pending_approval' then
        if new.approval_status = 'approved' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Sales invoice approval access denied.';
          end if;
          new.approval_requested_at := coalesce(old.approval_requested_at, new.approval_requested_at, now());
          new.approval_requested_by := coalesce(old.approval_requested_by, new.approval_requested_by, auth.uid());
          new.approved_at := coalesce(new.approved_at, now());
          new.approved_by := coalesce(new.approved_by, auth.uid());
        elsif new.approval_status = 'draft' then
          if not public.finance_documents_can_approve(v_company_id) then
            raise exception using
              message = 'Sales invoice approval reset access denied.';
          end if;
          new.approval_requested_at := null;
          new.approval_requested_by := null;
          new.approved_at := null;
          new.approved_by := null;
        else
          raise exception using
            message = 'Sales invoices can only move from pending approval to approved or back to draft.';
        end if;
      when 'approved' then
        if new.approval_status <> 'draft' then
          raise exception using
            message = 'Approved sales invoices can only be returned to draft before issue.';
        end if;
        if not public.finance_documents_can_approve(v_company_id) then
          raise exception using
            message = 'Sales invoice approval reset access denied.';
        end if;
        new.approval_requested_at := null;
        new.approval_requested_by := null;
        new.approved_at := null;
        new.approved_by := null;
      else
        raise exception using
          message = format('Sales invoice approval state %s is not recognized.', old.approval_status);
    end case;

    if new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - array['updated_at', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by'])
         is distinct from
           (to_jsonb(old) - array['updated_at', 'approval_status', 'approval_requested_at', 'approval_requested_by', 'approved_at', 'approved_by']) then
      raise exception using
        message = 'Sales invoice approval transitions cannot edit draft content. Save draft changes before approval routing.';
    end if;
  elsif old.document_workflow_status = 'draft' then
    if old.approval_status = 'draft' then
      if new.document_workflow_status = old.document_workflow_status
         and not public.finance_documents_can_prepare_draft(v_company_id) then
        raise exception using
          message = 'Sales invoice draft edit access denied.';
      end if;
    elsif new.document_workflow_status = old.document_workflow_status
       and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception using
        message = 'Sales invoices are locked once they are pending approval or approved. Return the document to draft before editing it.';
    end if;
  elsif old.document_workflow_status in ('issued', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Issued or voided sales invoices are immutable.';
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status = 'issued' then
          if old.approval_status <> 'approved' then
            raise exception using
              message = 'Sales invoices must be approved before issue.';
          end if;
          if not public.finance_documents_can_issue_legal(v_company_id) then
            raise exception 'sales_invoice_issue_access_denied';
          end if;
        elsif new.document_workflow_status = 'voided' then
          if not public.finance_documents_can_void(v_company_id) then
            raise exception using
              message = 'Sales invoice void access denied.';
          end if;
        else
          raise exception using
            message = format(
              'Sales invoice status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'issued' then
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      when 'voided' then
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Sales invoice status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  return new;
end;
$function$;

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

create or replace function public.sales_credit_note_hardening_guard()
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

  if not public.finance_documents_can_issue_adjustment(v_company_id) then
    raise exception using
      message = 'Sales credit note access denied.';
  end if;

  if tg_op = 'UPDATE' and new.original_sales_invoice_id is distinct from old.original_sales_invoice_id and exists (
    select 1
    from public.sales_credit_note_lines scnl
    where scnl.sales_credit_note_id = old.id
      and scnl.sales_invoice_line_id is not null
  ) then
    raise exception using
      message = 'Credit notes cannot change the original sales invoice after source-linked lines exist.';
  end if;

  if tg_op = 'INSERT' and new.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Sales credit notes must be created in draft status.';
  end if;

  if tg_op = 'UPDATE' and new.document_workflow_status is distinct from old.document_workflow_status then
    if old.document_workflow_status = 'draft' and new.document_workflow_status in ('issued', 'voided') then
      null;
    elsif new.document_workflow_status = old.document_workflow_status then
      null;
    else
      raise exception using
        message = 'Credit note workflow only allows draft to issued or draft to voided transitions.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('issued', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Issued or voided credit notes are immutable.';
  end if;

  return new;
end;
$function$;

create or replace function public.sales_debit_note_hardening_guard()
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

  if not public.finance_documents_can_issue_adjustment(v_company_id) then
    raise exception using
      message = 'Sales debit note access denied.';
  end if;

  if tg_op = 'UPDATE' and new.original_sales_invoice_id is distinct from old.original_sales_invoice_id and exists (
    select 1
    from public.sales_debit_note_lines sdnl
    where sdnl.sales_debit_note_id = old.id
      and sdnl.sales_invoice_line_id is not null
  ) then
    raise exception using
      message = 'Debit notes cannot change the original sales invoice after source-linked lines exist.';
  end if;

  if tg_op = 'INSERT' and new.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Sales debit notes must be created in draft status.';
  end if;

  if tg_op = 'UPDATE' and new.document_workflow_status is distinct from old.document_workflow_status then
    if old.document_workflow_status = 'draft' and new.document_workflow_status in ('issued', 'voided') then
      null;
    elsif new.document_workflow_status = old.document_workflow_status then
      null;
    else
      raise exception using
        message = 'Debit note workflow only allows draft to issued or draft to voided transitions.';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('issued', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Issued or voided debit notes are immutable.';
  end if;

  return new;
end;
$function$;

create or replace function public.vendor_credit_note_hardening_guard()
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

  if not public.finance_documents_can_post_adjustment(v_company_id) then
    raise exception using
      message = 'Supplier credit note access denied.';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Supplier credit notes must start in draft status.';
    end if;
    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('posted', 'voided') then
          raise exception using
            message = format(
              'Supplier credit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Supplier credit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Supplier credit note status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Supplier credit note status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('posted', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Posted or voided supplier credit notes are immutable.';
  end if;

  return new;
end;
$function$;

create or replace function public.vendor_debit_note_hardening_guard()
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

  if not public.finance_documents_can_post_adjustment(v_company_id) then
    raise exception using
      message = 'Supplier debit note access denied.';
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Supplier debit notes must start in draft status.';
    end if;
    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('posted', 'voided') then
          raise exception using
            message = format(
              'Supplier debit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'posted' then
        if new.document_workflow_status <> 'voided' then
          raise exception using
            message = format(
              'Supplier debit note status transition %s -> %s is not allowed.',
              old.document_workflow_status,
              new.document_workflow_status
            );
        end if;
      when 'voided' then
        raise exception using
          message = format(
            'Supplier debit note status transition %s -> %s is not allowed.',
            old.document_workflow_status,
            new.document_workflow_status
          );
      else
        raise exception using
          message = format(
            'Supplier debit note status transition %s -> %s is not recognized.',
            old.document_workflow_status,
            new.document_workflow_status
          );
    end case;
  end if;

  if tg_op = 'UPDATE'
     and old.document_workflow_status in ('posted', 'voided')
     and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using
      message = 'Posted or voided supplier debit notes are immutable.';
  end if;

  return new;
end;
$function$;

create or replace function public.finance_document_base_line_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_company_id uuid;
  v_parent_id uuid;
  v_workflow_status text;
  v_approval_status text;
  v_label text;
begin
  case tg_table_name
    when 'sales_invoice_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.sales_invoice_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.sales_invoice_id, old.sales_invoice_id);
      else
        v_parent_id := old.sales_invoice_id;
      end if;

      select si.company_id, si.document_workflow_status, coalesce(si.approval_status, 'draft'), 'Sales invoice'
        into v_company_id, v_workflow_status, v_approval_status, v_label
      from public.sales_invoices si
      where si.id = v_parent_id;
    when 'vendor_bill_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.vendor_bill_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.vendor_bill_id, old.vendor_bill_id);
      else
        v_parent_id := old.vendor_bill_id;
      end if;

      select vb.company_id, vb.document_workflow_status, coalesce(vb.approval_status, 'draft'), 'Vendor bill'
        into v_company_id, v_workflow_status, v_approval_status, v_label
      from public.vendor_bills vb
      where vb.id = v_parent_id;
    else
      raise exception using
        message = format('finance_document_base_line_guard does not support table %s.', tg_table_name);
  end case;

  if v_company_id is null then
    raise exception using
      message = format('%s lines require a parent draft document.', v_label);
  end if;

  if public.finance_documents_internal_transition_bypass() then
    if tg_op <> 'DELETE' then
      new.company_id := coalesce(new.company_id, v_company_id);
      if new.company_id is distinct from v_company_id then
        raise exception using
          message = format('%s line company must match the parent document company.', v_label);
      end if;
      return new;
    end if;

    return old;
  end if;

  if not public.finance_documents_can_prepare_draft(v_company_id) then
    raise exception using
      message = format('%s draft line access denied.', v_label);
  end if;

  if v_workflow_status <> 'draft' then
    raise exception using
      message = format('%s lines can only be changed while the parent document is still a draft.', v_label);
  end if;

  if v_approval_status <> 'draft' then
    raise exception using
      message = format('%s lines are locked once the parent document is pending approval or approved.', v_label);
  end if;

  if tg_op <> 'DELETE' then
    new.company_id := coalesce(new.company_id, v_company_id);
    if new.company_id is distinct from v_company_id then
      raise exception using
        message = format('%s line company must match the parent document company.', v_label);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function public.finance_document_adjustment_line_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_company_id uuid;
  v_parent_id uuid;
  v_workflow_status text;
  v_label text;
  v_can_adjust boolean;
begin
  case tg_table_name
    when 'sales_credit_note_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.sales_credit_note_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.sales_credit_note_id, old.sales_credit_note_id);
      else
        v_parent_id := old.sales_credit_note_id;
      end if;

      select scn.company_id, scn.document_workflow_status, 'Sales credit note'
        into v_company_id, v_workflow_status, v_label
      from public.sales_credit_notes scn
      where scn.id = v_parent_id;
      v_can_adjust := public.finance_documents_can_issue_adjustment(v_company_id);
    when 'sales_debit_note_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.sales_debit_note_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.sales_debit_note_id, old.sales_debit_note_id);
      else
        v_parent_id := old.sales_debit_note_id;
      end if;

      select sdn.company_id, sdn.document_workflow_status, 'Sales debit note'
        into v_company_id, v_workflow_status, v_label
      from public.sales_debit_notes sdn
      where sdn.id = v_parent_id;
      v_can_adjust := public.finance_documents_can_issue_adjustment(v_company_id);
    when 'vendor_credit_note_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.vendor_credit_note_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.vendor_credit_note_id, old.vendor_credit_note_id);
      else
        v_parent_id := old.vendor_credit_note_id;
      end if;

      select vcn.company_id, vcn.document_workflow_status, 'Supplier credit note'
        into v_company_id, v_workflow_status, v_label
      from public.vendor_credit_notes vcn
      where vcn.id = v_parent_id;
      v_can_adjust := public.finance_documents_can_post_adjustment(v_company_id);
    when 'vendor_debit_note_lines' then
      if tg_op = 'INSERT' then
        v_parent_id := new.vendor_debit_note_id;
      elsif tg_op = 'UPDATE' then
        v_parent_id := coalesce(new.vendor_debit_note_id, old.vendor_debit_note_id);
      else
        v_parent_id := old.vendor_debit_note_id;
      end if;

      select vdn.company_id, vdn.document_workflow_status, 'Supplier debit note'
        into v_company_id, v_workflow_status, v_label
      from public.vendor_debit_notes vdn
      where vdn.id = v_parent_id;
      v_can_adjust := public.finance_documents_can_post_adjustment(v_company_id);
    else
      raise exception using
        message = format('finance_document_adjustment_line_guard does not support table %s.', tg_table_name);
  end case;

  if v_company_id is null then
    raise exception using
      message = format('%s lines require a parent draft document.', v_label);
  end if;

  if public.finance_documents_internal_transition_bypass() then
    if tg_op <> 'DELETE' then
      new.company_id := coalesce(new.company_id, v_company_id);
      if new.company_id is distinct from v_company_id then
        raise exception using
          message = format('%s line company must match the parent document company.', v_label);
      end if;
      return new;
    end if;

    return old;
  end if;

  if not coalesce(v_can_adjust, false) then
    raise exception using
      message = format('%s line access denied.', v_label);
  end if;

  if v_workflow_status <> 'draft' then
    raise exception using
      message = format('%s lines can only be changed while the parent note is still a draft.', v_label);
  end if;

  if tg_op <> 'DELETE' then
    new.company_id := coalesce(new.company_id, v_company_id);
    if new.company_id is distinct from v_company_id then
      raise exception using
        message = format('%s line company must match the parent document company.', v_label);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function public.finance_document_settlement_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_company_id uuid;
  v_bank_id uuid;
  v_ref_type text;
  v_tx_type text;
begin
  if tg_table_name = 'cash_transactions' then
    if tg_op = 'INSERT' then
      v_ref_type := new.ref_type;
      v_tx_type := new.type;
    else
      v_ref_type := coalesce(new.ref_type, old.ref_type);
      v_tx_type := coalesce(new.type, old.type);
    end if;

    if tg_op = 'INSERT' then
      v_company_id := new.company_id;
    else
      v_company_id := coalesce(new.company_id, old.company_id);
    end if;

    if (
      v_tx_type in ('sale_receipt', 'purchase_payment')
      or v_ref_type in ('SO', 'PO', 'SI', 'VB')
    ) and not public.finance_documents_can_manage_settlement(v_company_id) then
      raise exception using
        message = 'Settlement-linked cash transactions require finance authority.';
    end if;
    return new;
  end if;

  if tg_table_name = 'bank_transactions' then
    if tg_op = 'INSERT' then
      v_ref_type := new.ref_type;
    else
      v_ref_type := coalesce(new.ref_type, old.ref_type);
    end if;

    if tg_op = 'INSERT' then
      v_bank_id := new.bank_id;
    else
      v_bank_id := coalesce(new.bank_id, old.bank_id);
    end if;

    select ba.company_id
      into v_company_id
    from public.bank_accounts ba
    where ba.id = v_bank_id;

    if v_ref_type in ('SO', 'PO', 'SI', 'VB')
       and not public.finance_documents_can_manage_settlement(v_company_id) then
      raise exception using
        message = 'Settlement-linked bank transactions require finance authority.';
    end if;
    return new;
  end if;

  raise exception using
    message = format('finance_document_settlement_guard does not support table %s.', tg_table_name);
end;
$function$;

create or replace function public.finance_document_company_settings_guard()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_old_due jsonb := case when tg_op = 'UPDATE' then coalesce(old.data -> 'dueReminders', 'null'::jsonb) else 'null'::jsonb end;
  v_new_due jsonb := coalesce(new.data -> 'dueReminders', 'null'::jsonb);
  v_default_due jsonb := coalesce(public.company_settings_defaults() -> 'dueReminders', 'null'::jsonb);
begin
  if tg_op = 'UPDATE' then
    if v_new_due is distinct from v_old_due
       and not public.finance_documents_can_manage_due_reminders(new.company_id) then
      raise exception using
        message = 'Due reminder settings require finance authority.';
    end if;
  elsif tg_op = 'INSERT' then
    if v_new_due is distinct from v_default_due
       and not public.finance_documents_can_manage_due_reminders(new.company_id) then
      raise exception using
        message = 'Due reminder settings require finance authority.';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.request_sales_invoice_approval_mz(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.sales_invoices%rowtype;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_submit_for_approval(v_row.company_id) then
    raise exception using
      message = 'Sales invoice approval request access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales invoices can be submitted for approval.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'draft' then
    raise exception using
      message = 'Only editable draft sales invoices can be submitted for approval.';
  end if;

  update public.sales_invoices si
     set approval_status = 'pending_approval',
         approval_requested_at = now(),
         approval_requested_by = auth.uid(),
         approved_at = null,
         approved_by = null
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.approve_sales_invoice_mz(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.sales_invoices%rowtype;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_approve(v_row.company_id) then
    raise exception using
      message = 'Sales invoice approval access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales invoices can be approved.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'pending_approval' then
    raise exception using
      message = 'Sales invoices must be pending approval before they can be approved.';
  end if;

  update public.sales_invoices si
     set approval_status = 'approved',
         approval_requested_at = coalesce(si.approval_requested_at, now()),
         approval_requested_by = coalesce(si.approval_requested_by, auth.uid()),
         approved_at = now(),
         approved_by = auth.uid()
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.return_sales_invoice_to_draft_mz(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.sales_invoices%rowtype;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_approve(v_row.company_id) then
    raise exception using
      message = 'Sales invoice approval reset access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales invoices can be returned to editable draft.';
  end if;

  if coalesce(v_row.approval_status, 'draft') not in ('pending_approval', 'approved') then
    raise exception using
      message = 'Only pending-approval or approved sales invoices can be returned to draft.';
  end if;

  update public.sales_invoices si
     set approval_status = 'draft',
         approval_requested_at = null,
         approval_requested_by = null,
         approved_at = null,
         approved_by = null
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.request_vendor_bill_approval_mz(p_bill_id uuid)
returns public.vendor_bills
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.vendor_bills%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_submit_for_approval(v_row.company_id) then
    raise exception using
      message = 'Vendor bill approval request access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft vendor bills can be submitted for approval.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'draft' then
    raise exception using
      message = 'Only editable draft vendor bills can be submitted for approval.';
  end if;

  update public.vendor_bills vb
     set approval_status = 'pending_approval',
         approval_requested_at = now(),
         approval_requested_by = auth.uid(),
         approved_at = null,
         approved_by = null
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.approve_vendor_bill_mz(p_bill_id uuid)
returns public.vendor_bills
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.vendor_bills%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_approve(v_row.company_id) then
    raise exception using
      message = 'Vendor bill approval access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft vendor bills can be approved.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'pending_approval' then
    raise exception using
      message = 'Vendor bills must be pending approval before they can be approved.';
  end if;

  update public.vendor_bills vb
     set approval_status = 'approved',
         approval_requested_at = coalesce(vb.approval_requested_at, now()),
         approval_requested_by = coalesce(vb.approval_requested_by, auth.uid()),
         approved_at = now(),
         approved_by = auth.uid()
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.return_vendor_bill_to_draft_mz(p_bill_id uuid)
returns public.vendor_bills
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.vendor_bills%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_approve(v_row.company_id) then
    raise exception using
      message = 'Vendor bill approval reset access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft vendor bills can be returned to editable draft.';
  end if;

  if coalesce(v_row.approval_status, 'draft') not in ('pending_approval', 'approved') then
    raise exception using
      message = 'Only pending-approval or approved vendor bills can be returned to draft.';
  end if;

  update public.vendor_bills vb
     set approval_status = 'draft',
         approval_requested_at = null,
         approval_requested_by = null,
         approved_at = null,
         approved_by = null
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.post_vendor_bill_mz(p_bill_id uuid)
returns public.vendor_bills
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.vendor_bills%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_issue_legal(v_row.company_id) then
    raise exception using
      message = 'Vendor bill post access denied.';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft vendor bills can be posted.';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'approved' then
    raise exception using
      message = 'Vendor bills must be approved before posting.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.vendor_bills vb
     set document_workflow_status = 'posted'
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.void_vendor_bill_mz(p_bill_id uuid)
returns public.vendor_bills
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.vendor_bills%rowtype;
  v_state public.v_vendor_bill_state%rowtype;
begin
  select vb.*
    into v_row
  from public.vendor_bills vb
  where vb.id = p_bill_id;

  if v_row.id is null then
    raise exception using
      message = 'Vendor bill not found.';
  end if;

  if not public.finance_documents_can_void(v_row.company_id) then
    raise exception using
      message = 'Vendor bill void access denied.';
  end if;

  if v_row.document_workflow_status = 'voided' then
    return v_row;
  end if;

  if v_row.document_workflow_status = 'posted' then
    select *
      into v_state
    from public.v_vendor_bill_state
    where id = v_row.id;

    if v_state.id is null then
      raise exception using
        message = 'Vendor bill state view is required before a posted bill can be voided.';
    end if;

    if coalesce(v_state.settled_base, 0) > 0.005 then
      raise exception using
        message = 'Posted vendor bills with settlements cannot be voided.';
    end if;

    if coalesce(v_state.credit_note_count, 0) > 0 or coalesce(v_state.debit_note_count, 0) > 0 then
      raise exception using
        message = 'Posted vendor bills with supplier credit or debit notes cannot be voided.';
    end if;
  elsif v_row.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft or posted vendor bills can be voided.';
  end if;

  update public.vendor_bills vb
     set document_workflow_status = 'voided'
   where vb.id = p_bill_id
  returning vb.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.issue_sales_invoice_mz(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row public.sales_invoices%rowtype;
begin
  select si.*
    into v_row
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_row.id is null then
    raise exception 'sales_invoice_not_found';
  end if;

  if not public.finance_documents_can_issue_legal(v_row.company_id) then
    raise exception 'sales_invoice_issue_access_denied';
  end if;

  if v_row.document_workflow_status <> 'draft' then
    raise exception 'sales_invoice_issue_not_draft';
  end if;

  if coalesce(v_row.approval_status, 'draft') <> 'approved' then
    raise exception 'sales_invoice_issue_requires_approved_status';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.sales_invoices si
     set document_workflow_status = 'issued'
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$function$;

create or replace function public.issue_sales_credit_note_mz(p_note_id uuid)
returns public.sales_credit_notes
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_note public.sales_credit_notes;
begin
  select scn.*
    into v_note
  from public.sales_credit_notes scn
  where scn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Sales credit note not found.';
  end if;

  if not public.finance_documents_can_issue_adjustment(v_note.company_id) then
    raise exception using
      message = 'Sales credit note issue access denied.';
  end if;

  if v_note.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales credit notes can be issued.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.sales_credit_notes scn
     set document_workflow_status = 'issued'
   where scn.id = p_note_id
  returning scn.* into v_note;

  return v_note;
end;
$function$;

create or replace function public.issue_sales_debit_note_mz(p_note_id uuid)
returns public.sales_debit_notes
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_note public.sales_debit_notes;
begin
  select sdn.*
    into v_note
  from public.sales_debit_notes sdn
  where sdn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Sales debit note not found.';
  end if;

  if not public.finance_documents_can_issue_adjustment(v_note.company_id) then
    raise exception using
      message = 'Sales debit note issue access denied.';
  end if;

  if v_note.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft sales debit notes can be issued.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.sales_debit_notes sdn
     set document_workflow_status = 'issued'
   where sdn.id = p_note_id
  returning sdn.* into v_note;

  return v_note;
end;
$function$;

create or replace function public.post_vendor_credit_note(p_note_id uuid)
returns public.vendor_credit_notes
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_note public.vendor_credit_notes;
begin
  select vcn.*
    into v_note
  from public.vendor_credit_notes vcn
  where vcn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Supplier credit note not found.';
  end if;

  if not public.finance_documents_can_post_adjustment(v_note.company_id) then
    raise exception using
      message = 'Supplier credit note post access denied.';
  end if;

  if v_note.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft supplier credit notes can be posted.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.vendor_credit_notes vcn
     set document_workflow_status = 'posted'
   where vcn.id = p_note_id
  returning vcn.* into v_note;

  return v_note;
end;
$function$;

create or replace function public.post_vendor_debit_note(p_note_id uuid)
returns public.vendor_debit_notes
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_note public.vendor_debit_notes;
begin
  select vdn.*
    into v_note
  from public.vendor_debit_notes vdn
  where vdn.id = p_note_id;

  if v_note.id is null then
    raise exception using
      message = 'Supplier debit note not found.';
  end if;

  if not public.finance_documents_can_post_adjustment(v_note.company_id) then
    raise exception using
      message = 'Supplier debit note post access denied.';
  end if;

  if v_note.document_workflow_status <> 'draft' then
    raise exception using
      message = 'Only draft supplier debit notes can be posted.';
  end if;

  perform set_config('stockwise.finance_transition_bypass', 'on', true);

  update public.vendor_debit_notes vdn
     set document_workflow_status = 'posted'
   where vdn.id = p_note_id
  returning vdn.* into v_note;

  return v_note;
end;
$function$;

create or replace function public.update_company_settings(p_company_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_current jsonb;
  v_merged jsonb;
  v_defaults jsonb := public.company_settings_defaults();
begin
  if not public.finance_documents_is_system_context() then
    if auth.uid() is null
       or p_company_id is distinct from public.current_company_id()
       or not public.has_company_role(p_company_id, array['OWNER','ADMIN','MANAGER']::public.member_role[]) then
      raise exception 'forbidden' using errcode = '42501';
    end if;

    if coalesce(p_patch ? 'dueReminders', false)
       and not public.finance_documents_can_manage_due_reminders(p_company_id) then
      raise exception 'due_reminder_settings_access_denied' using errcode = '42501';
    end if;
  end if;

  select data into v_current
  from public.company_settings
  where company_id = p_company_id
  for update;

  v_merged := public.jsonb_deep_merge(v_defaults, public.jsonb_deep_merge(coalesce(v_current, '{}'::jsonb), coalesce(p_patch, '{}'::jsonb)));
  v_merged := jsonb_set(v_merged, '{notifications,recipients,emails}', coalesce((v_merged #> '{notifications,recipients,emails}'), '[]'::jsonb), true);
  v_merged := jsonb_set(v_merged, '{notifications,recipients,phones}', coalesce((v_merged #> '{notifications,recipients,phones}'), '[]'::jsonb), true);
  v_merged := jsonb_set(v_merged, '{notifications,recipients,whatsapp}', coalesce((v_merged #> '{notifications,recipients,whatsapp}'), '[]'::jsonb), true);

  if (v_merged #>> '{notifications,dailyDigestTime}') is null then
    v_merged := jsonb_set(v_merged, '{notifications,dailyDigestTime}', to_jsonb('08:00'), true);
  end if;
  if (v_merged #>> '{notifications,timezone}') is null then
    v_merged := jsonb_set(v_merged, '{notifications,timezone}', to_jsonb('Africa/Maputo'), true);
  end if;

  insert into public.company_settings(company_id, data, updated_at)
  values (p_company_id, v_merged, now())
  on conflict (company_id) do update
    set data = excluded.data, updated_at = now()
  returning data into v_merged;

  return v_merged;
end
$function$;

drop trigger if exists biud_40_sales_invoice_line_guard on public.sales_invoice_lines;
create trigger biud_40_sales_invoice_line_guard
before insert or update or delete on public.sales_invoice_lines
for each row execute function public.finance_document_base_line_guard();

drop trigger if exists biud_40_vendor_bill_line_guard on public.vendor_bill_lines;
create trigger biud_40_vendor_bill_line_guard
before insert or update or delete on public.vendor_bill_lines
for each row execute function public.finance_document_base_line_guard();

drop trigger if exists biud_40_sales_credit_note_line_guard on public.sales_credit_note_lines;
create trigger biud_40_sales_credit_note_line_guard
before insert or update or delete on public.sales_credit_note_lines
for each row execute function public.finance_document_adjustment_line_guard();

drop trigger if exists biud_40_sales_debit_note_line_guard on public.sales_debit_note_lines;
create trigger biud_40_sales_debit_note_line_guard
before insert or update or delete on public.sales_debit_note_lines
for each row execute function public.finance_document_adjustment_line_guard();

drop trigger if exists biud_40_vendor_credit_note_line_guard on public.vendor_credit_note_lines;
create trigger biud_40_vendor_credit_note_line_guard
before insert or update or delete on public.vendor_credit_note_lines
for each row execute function public.finance_document_adjustment_line_guard();

drop trigger if exists biud_40_vendor_debit_note_line_guard on public.vendor_debit_note_lines;
create trigger biud_40_vendor_debit_note_line_guard
before insert or update or delete on public.vendor_debit_note_lines
for each row execute function public.finance_document_adjustment_line_guard();

drop trigger if exists biu_40_finance_document_cash_settlement_guard on public.cash_transactions;
create trigger biu_40_finance_document_cash_settlement_guard
before insert or update on public.cash_transactions
for each row execute function public.finance_document_settlement_guard();

drop trigger if exists biu_40_finance_document_bank_settlement_guard on public.bank_transactions;
create trigger biu_40_finance_document_bank_settlement_guard
before insert or update on public.bank_transactions
for each row execute function public.finance_document_settlement_guard();

drop trigger if exists biu_40_finance_document_company_settings_guard on public.company_settings;
create trigger biu_40_finance_document_company_settings_guard
before insert or update on public.company_settings
for each row execute function public.finance_document_company_settings_guard();

create or replace view public.v_sales_invoice_state as
with line_rollup as (
  select
    sil.sales_invoice_id,
    count(*)::integer as line_count
  from public.sales_invoice_lines sil
  group by sil.sales_invoice_id
),
cash_rollup as (
  select
    ct.company_id,
    ct.ref_id as sales_invoice_id,
    coalesce(sum(ct.amount_base), 0)::numeric as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'SI'
    and ct.type = 'sale_receipt'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as sales_invoice_id,
    coalesce(sum(bt.amount_base), 0)::numeric as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'SI'
  group by bt.ref_id
),
credit_rollup as (
  select
    scn.company_id,
    scn.original_sales_invoice_id as sales_invoice_id,
    count(*) filter (where scn.document_workflow_status = 'issued')::integer as credit_note_count,
    coalesce(sum(coalesce(scn.total_amount, 0) * coalesce(scn.fx_to_base, 1)) filter (where scn.document_workflow_status = 'issued'), 0)::numeric as credited_total_base
  from public.sales_credit_notes scn
  group by scn.company_id, scn.original_sales_invoice_id
),
debit_rollup as (
  select
    sdn.company_id,
    sdn.original_sales_invoice_id as sales_invoice_id,
    count(*) filter (where sdn.document_workflow_status = 'issued')::integer as debit_note_count,
    coalesce(sum(coalesce(sdn.total_amount, 0) * coalesce(sdn.fx_to_base, 1)) filter (where sdn.document_workflow_status = 'issued'), 0)::numeric as debited_total_base
  from public.sales_debit_notes sdn
  group by sdn.company_id, sdn.original_sales_invoice_id
)
select
  si.id,
  si.company_id,
  si.sales_order_id,
  si.customer_id,
  si.internal_reference,
  si.invoice_date,
  si.due_date,
  coalesce(nullif(c.name, ''), nullif(so.bill_to_name, ''), nullif(so.customer, '')) as counterparty_name,
  so.order_no,
  coalesce(si.currency_code, 'MZN') as currency_code,
  coalesce(si.fx_to_base, 1)::numeric as fx_to_base,
  coalesce(si.subtotal, 0)::numeric as subtotal,
  coalesce(si.tax_total, 0)::numeric as tax_total,
  coalesce(si.total_amount, 0)::numeric as total_amount,
  (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))::numeric as total_amount_base,
  si.document_workflow_status,
  coalesce(lr.line_count, 0) as line_count,
  false as state_warning,
  'sales_invoice'::text as financial_anchor,
  coalesce(cr.settled_base, 0)::numeric as cash_received_base,
  coalesce(br.settled_base, 0)::numeric as bank_received_base,
  (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))::numeric as settled_base,
  coalesce(cnr.credit_note_count, 0) as credit_note_count,
  coalesce(cnr.credited_total_base, 0)::numeric as credited_total_base,
  coalesce(dnr.debit_note_count, 0) as debit_note_count,
  coalesce(dnr.debited_total_base, 0)::numeric as debited_total_base,
  greatest(((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0)::numeric as current_legal_total_base,
  greatest(greatest(((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0) - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)), 0)::numeric as outstanding_base,
  case
    when coalesce(cnr.credited_total_base, 0) >= (((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - 0.005) then 'fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'partially_credited'
    else 'not_credited'
  end as credit_status,
  case
    when coalesce(cnr.credited_total_base, 0) > 0.005 and coalesce(dnr.debited_total_base, 0) > 0.005 then 'credited_and_debited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'credited'
    when coalesce(dnr.debited_total_base, 0) > 0.005 then 'debited'
    else 'none'
  end as adjustment_status,
  case
    when greatest(greatest(((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0) - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)), 0) <= 0.005 then 'settled'
    when si.due_date is not null and si.due_date < current_date and greatest(greatest(((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0) - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)), 0) > 0.005 then 'overdue'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'partially_settled'
    else 'unsettled'
  end as settlement_status,
  case
    when si.document_workflow_status = 'draft' then 'draft'
    when si.document_workflow_status = 'voided' then 'voided'
    when coalesce(cnr.credited_total_base, 0) >= (((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - 0.005) then 'issued_fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'issued_partially_credited'
    when greatest(greatest(((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0) - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)), 0) <= 0.005 then 'issued_settled'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'issued_partially_settled'
    when si.due_date is not null and si.due_date < current_date then 'issued_overdue'
    else 'issued_open'
  end as resolution_status,
  si.approval_status,
  si.approval_requested_at,
  si.approved_at
from public.sales_invoices si
left join public.customers c
  on c.id = si.customer_id
left join public.sales_orders so
  on so.id = si.sales_order_id
left join line_rollup lr
  on lr.sales_invoice_id = si.id
left join cash_rollup cr
  on cr.sales_invoice_id = si.id
 and cr.company_id = si.company_id
left join bank_rollup br
  on br.sales_invoice_id = si.id
left join credit_rollup cnr
  on cnr.sales_invoice_id = si.id
 and cnr.company_id = si.company_id
left join debit_rollup dnr
  on dnr.sales_invoice_id = si.id
 and dnr.company_id = si.company_id;

alter view public.v_sales_invoice_state set (security_invoker = true);
grant select on public.v_sales_invoice_state to authenticated;

create or replace view public.v_vendor_bill_state as
with line_rollup as (
  select
    vbl.vendor_bill_id,
    count(*)::integer as line_count
  from public.vendor_bill_lines vbl
  group by vbl.vendor_bill_id
),
duplicate_groups as (
  select
    vb.company_id,
    vb.supplier_id,
    vb.supplier_invoice_reference_normalized
  from public.vendor_bills vb
  where vb.document_workflow_status <> 'voided'
    and vb.supplier_invoice_reference_normalized is not null
  group by vb.company_id, vb.supplier_id, vb.supplier_invoice_reference_normalized
  having count(*) > 1
),
cash_rollup as (
  select
    ct.company_id,
    ct.ref_id as vendor_bill_id,
    coalesce(sum(case when coalesce(ct.amount_base, 0) < 0 then -ct.amount_base else 0 end), 0)::numeric as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'VB'
    and ct.type = 'purchase_payment'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as vendor_bill_id,
    coalesce(sum(case when coalesce(bt.amount_base, 0) < 0 then -bt.amount_base else 0 end), 0)::numeric as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'VB'
  group by bt.ref_id
),
credit_rollup as (
  select
    vcn.company_id,
    vcn.original_vendor_bill_id as vendor_bill_id,
    count(*) filter (where vcn.document_workflow_status = 'posted')::integer as credit_note_count,
    coalesce(sum(coalesce(vcn.total_amount_base, 0)) filter (where vcn.document_workflow_status = 'posted'), 0)::numeric as credited_total_base
  from public.vendor_credit_notes vcn
  group by vcn.company_id, vcn.original_vendor_bill_id
),
debit_rollup as (
  select
    vdn.company_id,
    vdn.original_vendor_bill_id as vendor_bill_id,
    count(*) filter (where vdn.document_workflow_status = 'posted')::integer as debit_note_count,
    coalesce(sum(coalesce(vdn.total_amount_base, 0)) filter (where vdn.document_workflow_status = 'posted'), 0)::numeric as debited_total_base
  from public.vendor_debit_notes vdn
  group by vdn.company_id, vdn.original_vendor_bill_id
)
select
  vb.id,
  vb.company_id,
  vb.purchase_order_id,
  vb.supplier_id,
  vb.internal_reference,
  vb.supplier_invoice_reference,
  vb.supplier_invoice_reference_normalized,
  coalesce(nullif(vb.supplier_invoice_reference, ''), vb.internal_reference) as primary_reference,
  vb.supplier_invoice_date,
  vb.bill_date,
  vb.due_date,
  coalesce(nullif(s.name, ''), nullif(po.supplier_name, ''), nullif(po.supplier, '')) as counterparty_name,
  po.order_no,
  coalesce(vb.currency_code, 'MZN') as currency_code,
  coalesce(vb.fx_to_base, 1)::numeric as fx_to_base,
  coalesce(vb.subtotal, 0)::numeric as subtotal,
  coalesce(vb.tax_total, 0)::numeric as tax_total,
  coalesce(vb.total_amount, 0)::numeric as total_amount,
  (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))::numeric as total_amount_base,
  vb.document_workflow_status,
  coalesce(lr.line_count, 0) as line_count,
  (dg.company_id is not null) as duplicate_supplier_reference_exists,
  'vendor_bill'::text as financial_anchor,
  coalesce(cr.settled_base, 0)::numeric as cash_paid_base,
  coalesce(br.settled_base, 0)::numeric as bank_paid_base,
  (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))::numeric as settled_base,
  coalesce(cnr.credit_note_count, 0) as credit_note_count,
  coalesce(cnr.credited_total_base, 0)::numeric as credited_total_base,
  coalesce(dnr.debit_note_count, 0) as debit_note_count,
  coalesce(dnr.debited_total_base, 0)::numeric as debited_total_base,
  greatest(((coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0)::numeric as current_legal_total_base,
  greatest(greatest(((coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0) - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)), 0)::numeric as outstanding_base,
  case
    when coalesce(cnr.credited_total_base, 0) >= (((coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - 0.005) then 'fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'partially_credited'
    else 'not_credited'
  end as credit_status,
  case
    when coalesce(cnr.credited_total_base, 0) > 0.005 and coalesce(dnr.debited_total_base, 0) > 0.005 then 'credited_and_debited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'credited'
    when coalesce(dnr.debited_total_base, 0) > 0.005 then 'debited'
    else 'none'
  end as adjustment_status,
  case
    when greatest(greatest(((coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0) - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)), 0) <= 0.005 then 'settled'
    when vb.due_date is not null and vb.due_date < current_date and greatest(greatest(((coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0) - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)), 0) > 0.005 then 'overdue'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'partially_settled'
    else 'unsettled'
  end as settlement_status,
  case
    when vb.document_workflow_status = 'draft' then 'draft'
    when vb.document_workflow_status = 'voided' then 'voided'
    when coalesce(cnr.credited_total_base, 0) >= (((coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - 0.005) then 'posted_fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'posted_partially_credited'
    when greatest(greatest(((coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1)) + coalesce(dnr.debited_total_base, 0)) - coalesce(cnr.credited_total_base, 0), 0) - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)), 0) <= 0.005 then 'posted_settled'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'posted_partially_settled'
    when vb.due_date is not null and vb.due_date < current_date then 'posted_overdue'
    else 'posted_open'
  end as resolution_status,
  vb.approval_status,
  vb.approval_requested_at,
  vb.approved_at
from public.vendor_bills vb
left join public.suppliers s
  on s.id = vb.supplier_id
left join public.purchase_orders po
  on po.id = vb.purchase_order_id
left join line_rollup lr
  on lr.vendor_bill_id = vb.id
left join duplicate_groups dg
  on dg.company_id = vb.company_id
 and dg.supplier_id is not distinct from vb.supplier_id
 and dg.supplier_invoice_reference_normalized = vb.supplier_invoice_reference_normalized
left join cash_rollup cr
  on cr.vendor_bill_id = vb.id
 and cr.company_id = vb.company_id
left join bank_rollup br
  on br.vendor_bill_id = vb.id
left join credit_rollup cnr
  on cnr.vendor_bill_id = vb.id
 and cnr.company_id = vb.company_id
left join debit_rollup dnr
  on dnr.vendor_bill_id = vb.id
 and dnr.company_id = vb.company_id;

alter view public.v_vendor_bill_state set (security_invoker = true);
grant select on public.v_vendor_bill_state to authenticated;

grant execute on function public.request_sales_invoice_approval_mz(uuid) to authenticated;
grant execute on function public.approve_sales_invoice_mz(uuid) to authenticated;
grant execute on function public.return_sales_invoice_to_draft_mz(uuid) to authenticated;
grant execute on function public.request_vendor_bill_approval_mz(uuid) to authenticated;
grant execute on function public.approve_vendor_bill_mz(uuid) to authenticated;
grant execute on function public.return_vendor_bill_to_draft_mz(uuid) to authenticated;
grant execute on function public.post_vendor_bill_mz(uuid) to authenticated;
grant execute on function public.void_vendor_bill_mz(uuid) to authenticated;

commit;
