begin;

create or replace function public.ensure_mz_company_fiscal_configuration(
  p_company_id uuid,
  p_document_date date default null
)
returns public.company_fiscal_settings
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_company public.companies%rowtype;
  v_settings public.company_fiscal_settings%rowtype;
  v_base_currency_code text;
  v_document_date date := coalesce(p_document_date, current_date);
  v_fiscal_year integer;
begin
  if p_company_id is null then
    raise exception 'finance_document_company_required';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception 'finance_document_company_write_denied';
  end if;

  select c.*
    into v_company
  from public.companies c
  where c.id = p_company_id;

  if v_company.id is null then
    raise exception 'finance_document_company_missing';
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = p_company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_settings.company_id is null then
    select nullif(btrim(coalesce(cs.base_currency_code::text, '')), '')
      into v_base_currency_code
    from public.company_settings cs
    where cs.company_id = p_company_id;

    insert into public.company_fiscal_settings (
      company_id,
      jurisdiction_code,
      invoice_series_code,
      credit_note_series_code,
      debit_note_series_code,
      computer_processed_phrase_text,
      document_language_code,
      presentation_currency_code,
      saft_moz_enabled,
      archive_retention_years,
      compliance_rule_version,
      homologation_reference
    )
    values (
      p_company_id,
      'MZ',
      'INV',
      'NC',
      'ND',
      'PROCESSADO POR COMPUTADOR',
      'pt-MZ',
      coalesce(v_base_currency_code, 'MZN'),
      true,
      5,
      'MZ-WAVE1-2026-03-29',
      null
    )
    on conflict (company_id) do nothing;

    select cfs.*
      into v_settings
    from public.company_fiscal_settings cfs
    where cfs.company_id = p_company_id
      and cfs.jurisdiction_code = 'MZ';
  end if;

  if v_settings.company_id is null then
    raise exception 'company_fiscal_settings_missing';
  end if;

  v_fiscal_year := extract(year from v_document_date)::integer;

  insert into public.finance_document_fiscal_series (
    company_id,
    document_type,
    series_code,
    fiscal_year,
    next_number,
    is_active,
    valid_from,
    valid_to
  )
  values
    (p_company_id, 'sales_invoice', v_settings.invoice_series_code, v_fiscal_year, 1, true, make_date(v_fiscal_year, 1, 1), null),
    (p_company_id, 'sales_credit_note', v_settings.credit_note_series_code, v_fiscal_year, 1, true, make_date(v_fiscal_year, 1, 1), null),
    (p_company_id, 'sales_debit_note', v_settings.debit_note_series_code, v_fiscal_year, 1, true, make_date(v_fiscal_year, 1, 1), null)
  on conflict (company_id, document_type, series_code, fiscal_year) do nothing;

  return v_settings;
end;
$function$;

create or replace function public.next_fiscal_document_reference(
  p_company_id uuid,
  p_document_type text,
  p_document_date date,
  p_source_origin text,
  p_explicit_reference text default null
)
returns table (
  internal_reference text,
  fiscal_series_code text,
  fiscal_year integer,
  fiscal_sequence_number integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_series public.finance_document_fiscal_series%rowtype;
  v_sequence integer;
  v_prefix text;
begin
  if p_company_id is null then
    raise exception 'finance_document_company_required';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception 'finance_document_company_write_denied';
  end if;

  if p_source_origin not in ('native', 'imported') then
    raise exception 'finance_document_source_origin_invalid';
  end if;

  if p_source_origin = 'imported' then
    if nullif(btrim(coalesce(p_explicit_reference, '')), '') is null then
      raise exception 'imported_sales_invoice_reference_required';
    end if;

    internal_reference := btrim(p_explicit_reference);
    fiscal_series_code := null;
    fiscal_year := extract(year from coalesce(p_document_date, current_date))::integer;
    fiscal_sequence_number := null;
    return next;
    return;
  end if;

  perform public.ensure_mz_company_fiscal_configuration(
    p_company_id,
    coalesce(p_document_date, current_date)
  );

  v_series := public.resolve_fiscal_series(
    p_company_id,
    p_document_type,
    coalesce(p_document_date, current_date)
  );

  update public.finance_document_fiscal_series fdfs
     set next_number = fdfs.next_number + 1,
         updated_at = now()
   where fdfs.id = v_series.id
  returning fdfs.next_number - 1
    into v_sequence;

  if v_sequence is null then
    raise exception 'finance_document_fiscal_series_update_failed';
  end if;

  v_prefix := public.finance_document_company_prefix(p_company_id);

  internal_reference := v_prefix
    || '-'
    || v_series.series_code
    || v_series.fiscal_year::text
    || '-'
    || lpad(v_sequence::text, 5, '0');
  fiscal_series_code := v_series.series_code;
  fiscal_year := v_series.fiscal_year;
  fiscal_sequence_number := v_sequence;
  return next;
end;
$function$;

revoke all on function public.ensure_mz_company_fiscal_configuration(uuid, date) from public, anon;
grant execute on function public.ensure_mz_company_fiscal_configuration(uuid, date) to authenticated;

comment on function public.ensure_mz_company_fiscal_configuration(uuid, date) is
  'Bootstraps the minimum Mozambique fiscal settings and current-year series required for native finance-document draft references.';

comment on function public.next_fiscal_document_reference(uuid, text, date, text, text) is
  'Allocates the next finance-document reference, auto-bootstrapping Mozambique draft defaults for native documents when the company has not been configured yet.';

commit;
