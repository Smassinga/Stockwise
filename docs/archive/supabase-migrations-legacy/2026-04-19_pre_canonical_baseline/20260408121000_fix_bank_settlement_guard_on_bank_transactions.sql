begin;

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
      v_company_id := new.company_id;
    else
      v_ref_type := coalesce(new.ref_type, old.ref_type);
      v_tx_type := coalesce(new.type, old.type);
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
      v_bank_id := new.bank_id;
    else
      v_ref_type := coalesce(new.ref_type, old.ref_type);
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

revoke all on function public.finance_document_settlement_guard() from public;
grant execute on function public.finance_document_settlement_guard() to authenticated;

commit;
