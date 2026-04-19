alter table public.vendor_credit_notes
  add column if not exists adjustment_reason_code text null;

alter table public.vendor_debit_notes
  add column if not exists adjustment_reason_code text null;

create or replace function public.finance_document_header_event_journal()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_document_kind text;
  v_event_type text;
  v_from_status text;
  v_to_status text;
  v_payload jsonb;
  v_new_json jsonb;
  v_old_json jsonb;
  v_comparable_new jsonb;
  v_comparable_old jsonb;
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

  v_new_json := to_jsonb(new);
  v_old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;

  if tg_op = 'INSERT' then
    v_event_type := 'draft_created';
    v_from_status := null;
    v_to_status := nullif(v_new_json ->> 'document_workflow_status', '');
  elsif tg_op = 'UPDATE' then
    if (v_new_json ? 'approval_status')
       and coalesce(v_new_json ->> 'approval_status', '') is distinct from coalesce(v_old_json ->> 'approval_status', '') then
      v_from_status := nullif(v_old_json ->> 'approval_status', '');
      v_to_status := nullif(v_new_json ->> 'approval_status', '');
      v_event_type := case
        when v_to_status = 'pending_approval' then 'approval_requested'
        when v_to_status = 'approved' then 'approved'
        when v_to_status = 'draft' and coalesce(v_from_status, '') in ('pending_approval', 'approved') then 'returned_to_draft'
        else 'approval_status_changed'
      end;
    elsif coalesce(v_new_json ->> 'document_workflow_status', '') is distinct from coalesce(v_old_json ->> 'document_workflow_status', '') then
      v_from_status := nullif(v_old_json ->> 'document_workflow_status', '');
      v_to_status := nullif(v_new_json ->> 'document_workflow_status', '');
      v_event_type := case v_to_status
        when 'issued' then 'issued'
        when 'posted' then 'posted'
        when 'voided' then 'voided'
        else 'status_changed'
      end;
    else
      if coalesce(v_new_json ->> 'document_workflow_status', 'draft') <> 'draft' then
        return null;
      end if;

      v_comparable_new := v_new_json - array[
        'updated_at',
        'document_workflow_status',
        'issued_at',
        'issued_by',
        'posted_at',
        'posted_by',
        'voided_at',
        'voided_by',
        'void_reason',
        'approval_status',
        'approval_requested_at',
        'approval_requested_by',
        'approved_at',
        'approved_by',
        'supplier_invoice_reference_normalized',
        'supplier_document_reference_normalized'
      ];
      v_comparable_old := v_old_json - array[
        'updated_at',
        'document_workflow_status',
        'issued_at',
        'issued_by',
        'posted_at',
        'posted_by',
        'voided_at',
        'voided_by',
        'void_reason',
        'approval_status',
        'approval_requested_at',
        'approval_requested_by',
        'approved_at',
        'approved_by',
        'supplier_invoice_reference_normalized',
        'supplier_document_reference_normalized'
      ];

      if v_comparable_new = v_comparable_old then
        return null;
      end if;

      v_event_type := 'draft_edited';
      v_from_status := nullif(v_old_json ->> 'document_workflow_status', '');
      v_to_status := nullif(v_new_json ->> 'document_workflow_status', '');
    end if;
  else
    return null;
  end if;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'internal_reference', nullif(v_new_json ->> 'internal_reference', ''),
    'primary_reference', coalesce(
      nullif(v_new_json ->> 'supplier_invoice_reference', ''),
      nullif(v_new_json ->> 'supplier_document_reference', ''),
      nullif(v_new_json ->> 'internal_reference', '')
    ),
    'source_origin', nullif(v_new_json ->> 'source_origin', ''),
    'document_status', nullif(v_new_json ->> 'document_workflow_status', ''),
    'approval_status', nullif(v_new_json ->> 'approval_status', ''),
    'sales_order_id', nullif(v_new_json ->> 'sales_order_id', ''),
    'purchase_order_id', nullif(v_new_json ->> 'purchase_order_id', ''),
    'original_sales_invoice_id', nullif(v_new_json ->> 'original_sales_invoice_id', ''),
    'original_vendor_bill_id', nullif(v_new_json ->> 'original_vendor_bill_id', ''),
    'correction_reason_code', nullif(v_new_json ->> 'correction_reason_code', ''),
    'correction_reason_text', nullif(v_new_json ->> 'correction_reason_text', ''),
    'adjustment_reason_code', nullif(v_new_json ->> 'adjustment_reason_code', ''),
    'adjustment_reason_text', nullif(v_new_json ->> 'adjustment_reason_text', '')
  ));

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
$$;

create or replace function public.finance_document_parent_adjustment_event_journal()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_child_kind text;
  v_parent_kind text;
  v_parent_id uuid;
  v_event_type text;
  v_new_json jsonb;
  v_old_json jsonb;
  v_payload jsonb;
  v_reference text;
begin
  v_child_kind := case tg_table_name
    when 'sales_credit_notes' then 'sales_credit_note'
    when 'sales_debit_notes' then 'sales_debit_note'
    when 'vendor_credit_notes' then 'vendor_credit_note'
    when 'vendor_debit_notes' then 'vendor_debit_note'
    else null
  end;

  if v_child_kind is null then
    raise exception using
      message = format('finance_document_parent_adjustment_event_journal does not support table %s.', tg_table_name);
  end if;

  v_new_json := to_jsonb(new);
  v_old_json := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;

  if v_child_kind in ('sales_credit_note', 'sales_debit_note') then
    v_parent_kind := 'sales_invoice';
    v_parent_id := new.original_sales_invoice_id;
  else
    v_parent_kind := 'vendor_bill';
    v_parent_id := new.original_vendor_bill_id;
  end if;

  if v_parent_id is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := case v_child_kind
      when 'sales_credit_note' then 'related_sales_credit_note_created'
      when 'sales_debit_note' then 'related_sales_debit_note_created'
      when 'vendor_credit_note' then 'related_vendor_credit_note_created'
      when 'vendor_debit_note' then 'related_vendor_debit_note_created'
      else null
    end;
  elsif tg_op = 'UPDATE'
        and coalesce(v_new_json ->> 'document_workflow_status', '') is distinct from coalesce(v_old_json ->> 'document_workflow_status', '') then
    v_event_type := case
      when v_child_kind = 'sales_credit_note' and v_new_json ->> 'document_workflow_status' = 'issued' then 'related_sales_credit_note_issued'
      when v_child_kind = 'sales_debit_note' and v_new_json ->> 'document_workflow_status' = 'issued' then 'related_sales_debit_note_issued'
      when v_child_kind = 'vendor_credit_note' and v_new_json ->> 'document_workflow_status' = 'posted' then 'related_vendor_credit_note_posted'
      when v_child_kind = 'vendor_debit_note' and v_new_json ->> 'document_workflow_status' = 'posted' then 'related_vendor_debit_note_posted'
      else null
    end;
  else
    return null;
  end if;

  if v_event_type is null then
    return null;
  end if;

  v_reference := coalesce(
    nullif(v_new_json ->> 'supplier_document_reference', ''),
    nullif(v_new_json ->> 'internal_reference', '')
  );

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'related_document_kind', v_child_kind,
    'related_document_id', new.id,
    'related_reference', v_reference,
    'related_document_status', nullif(v_new_json ->> 'document_workflow_status', ''),
    'reason_code', coalesce(
      nullif(v_new_json ->> 'correction_reason_code', ''),
      nullif(v_new_json ->> 'adjustment_reason_code', '')
    ),
    'reason_text', coalesce(
      nullif(v_new_json ->> 'correction_reason_text', ''),
      nullif(v_new_json ->> 'adjustment_reason_text', '')
    )
  ));

  perform public.append_finance_document_event(
    new.company_id,
    v_parent_kind,
    v_parent_id,
    v_event_type,
    null,
    null,
    v_payload
  );

  return null;
end;
$$;

create or replace function public.finance_document_settlement_event_journal()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_company_id uuid;
  v_document_kind text;
  v_event_type text;
  v_amount_abs numeric;
  v_payload jsonb;
begin
  if tg_table_name = 'cash_transactions' then
    v_company_id := new.company_id;
    v_document_kind := case new.ref_type
      when 'SI' then 'sales_invoice'
      when 'VB' then 'vendor_bill'
      else null
    end;
    v_event_type := case new.ref_type
      when 'SI' then 'cash_receipt_recorded'
      when 'VB' then 'cash_payment_recorded'
      else null
    end;
    v_amount_abs := abs(coalesce(new.amount_base, 0));
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'transaction_id', new.id,
      'channel', 'cash',
      'happened_at', new.happened_at,
      'memo', nullif(new.memo, ''),
      'amount_base', v_amount_abs,
      'signed_amount_base', new.amount_base,
      'user_ref', nullif(new.user_ref, '')
    ));
  elsif tg_table_name = 'bank_transactions' then
    select b.company_id
      into v_company_id
    from public.banks b
    where b.id = new.bank_id;

    v_document_kind := case new.ref_type
      when 'SI' then 'sales_invoice'
      when 'VB' then 'vendor_bill'
      else null
    end;
    v_event_type := case new.ref_type
      when 'SI' then 'bank_receipt_recorded'
      when 'VB' then 'bank_payment_recorded'
      else null
    end;
    v_amount_abs := abs(coalesce(new.amount_base, 0));
    v_payload := jsonb_strip_nulls(jsonb_build_object(
      'transaction_id', new.id,
      'channel', 'bank',
      'happened_at', new.happened_at,
      'memo', nullif(new.memo, ''),
      'amount_base', v_amount_abs,
      'signed_amount_base', new.amount_base,
      'bank_id', new.bank_id
    ));
  else
    return null;
  end if;

  if v_company_id is null or v_document_kind is null or v_event_type is null or new.ref_id is null then
    return null;
  end if;

  perform public.append_finance_document_event(
    v_company_id,
    v_document_kind,
    new.ref_id,
    v_event_type,
    null,
    null,
    v_payload
  );

  return null;
end;
$$;

drop trigger if exists ai_20_sales_credit_note_parent_event_journal on public.sales_credit_notes;
create trigger ai_20_sales_credit_note_parent_event_journal
after insert on public.sales_credit_notes
for each row execute function public.finance_document_parent_adjustment_event_journal();

drop trigger if exists au_20_sales_credit_note_parent_event_journal on public.sales_credit_notes;
create trigger au_20_sales_credit_note_parent_event_journal
after update on public.sales_credit_notes
for each row execute function public.finance_document_parent_adjustment_event_journal();

drop trigger if exists ai_20_sales_debit_note_parent_event_journal on public.sales_debit_notes;
create trigger ai_20_sales_debit_note_parent_event_journal
after insert on public.sales_debit_notes
for each row execute function public.finance_document_parent_adjustment_event_journal();

drop trigger if exists au_20_sales_debit_note_parent_event_journal on public.sales_debit_notes;
create trigger au_20_sales_debit_note_parent_event_journal
after update on public.sales_debit_notes
for each row execute function public.finance_document_parent_adjustment_event_journal();

drop trigger if exists ai_20_vendor_credit_note_parent_event_journal on public.vendor_credit_notes;
create trigger ai_20_vendor_credit_note_parent_event_journal
after insert on public.vendor_credit_notes
for each row execute function public.finance_document_parent_adjustment_event_journal();

drop trigger if exists au_20_vendor_credit_note_parent_event_journal on public.vendor_credit_notes;
create trigger au_20_vendor_credit_note_parent_event_journal
after update on public.vendor_credit_notes
for each row execute function public.finance_document_parent_adjustment_event_journal();

drop trigger if exists ai_20_vendor_debit_note_parent_event_journal on public.vendor_debit_notes;
create trigger ai_20_vendor_debit_note_parent_event_journal
after insert on public.vendor_debit_notes
for each row execute function public.finance_document_parent_adjustment_event_journal();

drop trigger if exists au_20_vendor_debit_note_parent_event_journal on public.vendor_debit_notes;
create trigger au_20_vendor_debit_note_parent_event_journal
after update on public.vendor_debit_notes
for each row execute function public.finance_document_parent_adjustment_event_journal();

drop trigger if exists ai_30_cash_transactions_finance_event_journal on public.cash_transactions;
create trigger ai_30_cash_transactions_finance_event_journal
after insert on public.cash_transactions
for each row execute function public.finance_document_settlement_event_journal();

drop trigger if exists ai_30_bank_transactions_finance_event_journal on public.bank_transactions;
create trigger ai_30_bank_transactions_finance_event_journal
after insert on public.bank_transactions
for each row execute function public.finance_document_settlement_event_journal();

comment on function public.finance_document_header_event_journal() is
  'Captures draft, approval, issue/post, void, and draft-edit lifecycle events for finance documents.';

comment on function public.finance_document_parent_adjustment_event_journal() is
  'Projects related sales/vendor adjustment note creation and posting events onto the parent invoice or vendor bill timeline.';

comment on function public.finance_document_settlement_event_journal() is
  'Appends settlement-linked cash and bank events onto the active sales-invoice or vendor-bill audit trail.';
