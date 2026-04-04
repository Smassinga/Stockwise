begin;

create or replace function public.finance_documents_internal_transition_bypass()
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'public'
as $function$
  select public.finance_documents_is_system_context()
      or coalesce(current_setting('stockwise.finance_transition_bypass', true), '') = 'on';
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

commit;
