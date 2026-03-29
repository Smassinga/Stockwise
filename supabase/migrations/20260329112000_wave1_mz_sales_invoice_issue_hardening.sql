create or replace function public.sales_invoice_validate_issue_mz()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_line_count integer;
  v_settings public.company_fiscal_settings%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = new.company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_settings.company_id is null then
    raise exception 'company_fiscal_settings_missing';
  end if;

  if new.invoice_date is null then
    raise exception 'sales_invoice_issue_requires_invoice_date';
  end if;

  if new.due_date is null then
    raise exception 'sales_invoice_issue_requires_due_date';
  end if;

  if new.due_date < new.invoice_date then
    raise exception 'sales_invoice_issue_invalid_due_date';
  end if;

  if coalesce(new.fx_to_base, 0) <= 0 then
    raise exception 'sales_invoice_issue_invalid_fx';
  end if;

  if new.source_origin = 'native'
     and (
       new.fiscal_series_code is null
       or new.fiscal_year is null
       or new.fiscal_sequence_number is null
     ) then
    raise exception 'sales_invoice_issue_missing_fiscal_identity';
  end if;

  if new.source_origin = 'native' then
    select *
      into v_series
    from public.resolve_fiscal_series(new.company_id, 'sales_invoice', new.invoice_date);

    if v_series.series_code is distinct from new.fiscal_series_code
       or v_series.fiscal_year is distinct from new.fiscal_year then
      raise exception 'sales_invoice_issue_series_mismatch';
    end if;
  end if;

  if nullif(btrim(coalesce(new.seller_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_address_line1_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_seller_snapshot';
  end if;

  if nullif(btrim(coalesce(new.buyer_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_address_line1_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_buyer_snapshot';
  end if;

  if nullif(btrim(coalesce(new.document_language_code_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_document_language';
  end if;

  if nullif(btrim(coalesce(new.computer_processed_phrase_snapshot, '')), '') is null then
    raise exception 'sales_invoice_issue_requires_computer_phrase';
  end if;

  if coalesce(new.subtotal, 0) < 0
     or coalesce(new.tax_total, 0) < 0
     or coalesce(new.total_amount, 0) < 0
     or coalesce(new.subtotal_mzn, 0) < 0
     or coalesce(new.tax_total_mzn, 0) < 0
     or coalesce(new.total_amount_mzn, 0) < 0 then
    raise exception 'sales_invoice_issue_invalid_totals';
  end if;

  select count(*)
    into v_line_count
  from public.sales_invoice_lines sil
  where sil.sales_invoice_id = new.id;

  if v_line_count < 1 then
    raise exception 'sales_invoice_issue_requires_lines';
  end if;

  return new;
end;
$$;

create or replace function public.sales_invoice_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.document_workflow_status, 'draft') <> 'draft' then
      raise exception using
        message = 'Sales invoices must start in draft status.';
    end if;

    return new;
  end if;

  if new.document_workflow_status is distinct from old.document_workflow_status then
    case old.document_workflow_status
      when 'draft' then
        if new.document_workflow_status not in ('issued', 'voided') then
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

  if old.document_workflow_status in ('issued', 'voided')
     and row(
       old.company_id,
       old.sales_order_id,
       old.customer_id,
       old.internal_reference,
       old.invoice_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.source_origin,
       old.moz_document_code,
       old.fiscal_series_code,
       old.fiscal_year,
       old.fiscal_sequence_number,
       old.seller_legal_name_snapshot,
       old.seller_trade_name_snapshot,
       old.seller_nuit_snapshot,
       old.seller_address_line1_snapshot,
       old.seller_address_line2_snapshot,
       old.seller_city_snapshot,
       old.seller_state_snapshot,
       old.seller_postal_code_snapshot,
       old.seller_country_code_snapshot,
       old.buyer_legal_name_snapshot,
       old.buyer_nuit_snapshot,
       old.buyer_address_line1_snapshot,
       old.buyer_address_line2_snapshot,
       old.buyer_city_snapshot,
       old.buyer_state_snapshot,
       old.buyer_postal_code_snapshot,
       old.buyer_country_code_snapshot,
       old.document_language_code_snapshot,
       old.computer_processed_phrase_snapshot,
       old.subtotal_mzn,
       old.tax_total_mzn,
       old.total_amount_mzn,
       old.compliance_rule_version_snapshot,
       old.issued_at,
       old.issued_by,
       old.voided_at,
       old.voided_by,
       old.void_reason,
       old.created_by,
       old.created_at
     ) is distinct from row(
       new.company_id,
       new.sales_order_id,
       new.customer_id,
       new.internal_reference,
       new.invoice_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.source_origin,
       new.moz_document_code,
       new.fiscal_series_code,
       new.fiscal_year,
       new.fiscal_sequence_number,
       new.seller_legal_name_snapshot,
       new.seller_trade_name_snapshot,
       new.seller_nuit_snapshot,
       new.seller_address_line1_snapshot,
       new.seller_address_line2_snapshot,
       new.seller_city_snapshot,
       new.seller_state_snapshot,
       new.seller_postal_code_snapshot,
       new.seller_country_code_snapshot,
       new.buyer_legal_name_snapshot,
       new.buyer_nuit_snapshot,
       new.buyer_address_line1_snapshot,
       new.buyer_address_line2_snapshot,
       new.buyer_city_snapshot,
       new.buyer_state_snapshot,
       new.buyer_postal_code_snapshot,
       new.buyer_country_code_snapshot,
       new.document_language_code_snapshot,
       new.computer_processed_phrase_snapshot,
       new.subtotal_mzn,
       new.tax_total_mzn,
       new.total_amount_mzn,
       new.compliance_rule_version_snapshot,
       new.issued_at,
       new.issued_by,
       new.voided_at,
       new.voided_by,
       new.void_reason,
       new.created_by,
       new.created_at
     ) then
    raise exception using
      message = 'Issued or voided sales invoices cannot change company, linkage, legal reference, dates, currency, FX, totals, or fiscal snapshots.';
  end if;

  return new;
end;
$$;

create or replace function public.sales_invoice_lines_parent_issue_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_invoice_id uuid;
  v_status text;
begin
  v_invoice_id := case when tg_op = 'DELETE' then old.sales_invoice_id else new.sales_invoice_id end;

  select si.document_workflow_status
    into v_status
  from public.sales_invoices si
  where si.id = v_invoice_id;

  if coalesce(v_status, '') in ('issued', 'voided') then
    raise exception 'sales_invoice_lines_parent_locked';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.issue_sales_invoice_mz(p_invoice_id uuid)
returns public.sales_invoices
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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

  if not public.finance_documents_can_write(v_row.company_id) then
    raise exception 'sales_invoice_issue_access_denied';
  end if;

  update public.sales_invoices si
     set document_workflow_status = 'issued'
   where si.id = p_invoice_id
  returning si.* into v_row;

  return v_row;
end;
$$;

drop trigger if exists sales_invoices_hardening on public.sales_invoices;
drop trigger if exists sales_invoices_touch_updated_at on public.sales_invoices;
drop trigger if exists biu_30_sales_invoice_validate_issue_mz on public.sales_invoices;
drop trigger if exists biu_40_sales_invoice_hardening on public.sales_invoices;
drop trigger if exists bu_90_sales_invoice_touch_updated_at on public.sales_invoices;

create trigger biu_30_sales_invoice_validate_issue_mz
before update of document_workflow_status on public.sales_invoices
for each row execute function public.sales_invoice_validate_issue_mz();

create trigger biu_40_sales_invoice_hardening
before insert or update on public.sales_invoices
for each row execute function public.sales_invoice_hardening_guard();

create trigger bu_90_sales_invoice_touch_updated_at
before update on public.sales_invoices
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists sales_invoice_lines_company_guard on public.sales_invoice_lines;
drop trigger if exists sales_invoice_lines_hardening on public.sales_invoice_lines;
drop trigger if exists sales_invoice_lines_touch_updated_at on public.sales_invoice_lines;
drop trigger if exists biu_10_sales_invoice_lines_company_guard on public.sales_invoice_lines;
drop trigger if exists biu_20_sales_invoice_lines_hardening on public.sales_invoice_lines;
drop trigger if exists biu_30_sales_invoice_lines_parent_issue_guard on public.sales_invoice_lines;
drop trigger if exists bd_30_sales_invoice_lines_parent_issue_guard on public.sales_invoice_lines;
drop trigger if exists bu_90_sales_invoice_lines_touch_updated_at on public.sales_invoice_lines;

create trigger biu_10_sales_invoice_lines_company_guard
before insert or update on public.sales_invoice_lines
for each row execute function public.finance_document_line_company_guard();

create trigger biu_20_sales_invoice_lines_hardening
before insert or update on public.sales_invoice_lines
for each row execute function public.sales_invoice_line_hardening_guard();

create trigger biu_30_sales_invoice_lines_parent_issue_guard
before insert or update on public.sales_invoice_lines
for each row execute function public.sales_invoice_lines_parent_issue_guard();

create trigger bd_30_sales_invoice_lines_parent_issue_guard
before delete on public.sales_invoice_lines
for each row execute function public.sales_invoice_lines_parent_issue_guard();

create trigger bu_90_sales_invoice_lines_touch_updated_at
before update on public.sales_invoice_lines
for each row execute function public.finance_documents_touch_updated_at();

comment on function public.sales_invoice_validate_issue_mz() is
  'Validates Mozambique issue-time requirements for sales invoices before the document can transition into issued status.';

comment on function public.sales_invoice_lines_parent_issue_guard() is
  'Prevents insert, update, or delete on invoice lines after the parent sales invoice is issued or voided.';

comment on function public.issue_sales_invoice_mz(uuid) is
  'Helper path for issuing one Mozambique sales invoice through the same trigger-based validation and immutability rules as direct updates.';

revoke all on function public.issue_sales_invoice_mz(uuid) from public, anon;
grant execute on function public.issue_sales_invoice_mz(uuid) to authenticated;
