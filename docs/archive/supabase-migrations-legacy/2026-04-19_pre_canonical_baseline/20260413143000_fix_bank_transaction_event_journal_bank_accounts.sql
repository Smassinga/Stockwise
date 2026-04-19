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
  v_bank_account_name text;
  v_bank_name text;
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
    select ba.company_id, nullif(ba.name, ''), nullif(ba.bank_name, '')
      into v_company_id, v_bank_account_name, v_bank_name
    from public.bank_accounts ba
    where ba.id = new.bank_id;

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
      'bank_id', new.bank_id,
      'bank_account_name', v_bank_account_name,
      'bank_name', v_bank_name
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

comment on function public.finance_document_settlement_event_journal() is
  'Appends settlement-linked cash and bank events onto the active sales-invoice or vendor-bill audit trail using the current cash and bank account models.';
