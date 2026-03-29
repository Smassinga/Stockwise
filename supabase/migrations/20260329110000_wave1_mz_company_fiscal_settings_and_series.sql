create table if not exists public.company_fiscal_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  jurisdiction_code text not null default 'MZ',
  invoice_series_code text not null,
  credit_note_series_code text not null,
  debit_note_series_code text not null,
  computer_processed_phrase_text text not null,
  document_language_code text not null default 'pt-MZ',
  presentation_currency_code text not null default 'MZN',
  saft_moz_enabled boolean not null default true,
  archive_retention_years integer not null default 5,
  compliance_rule_version text not null,
  homologation_reference text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_fiscal_settings_archive_retention_years_check
    check (archive_retention_years >= 5),
  constraint company_fiscal_settings_invoice_series_code_check
    check (invoice_series_code ~ '^[A-Z0-9]{2,10}$'),
  constraint company_fiscal_settings_credit_note_series_code_check
    check (credit_note_series_code ~ '^[A-Z0-9]{2,10}$'),
  constraint company_fiscal_settings_debit_note_series_code_check
    check (debit_note_series_code ~ '^[A-Z0-9]{2,10}$')
);

create table if not exists public.finance_document_fiscal_series (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_type text not null
    check (document_type in ('sales_invoice', 'sales_credit_note', 'sales_debit_note')),
  series_code text not null
    check (series_code ~ '^[A-Z0-9]{2,10}$'),
  fiscal_year integer not null
    check (fiscal_year between 2000 and 9999),
  next_number integer not null default 1
    check (next_number >= 1),
  is_active boolean not null default true,
  valid_from date null,
  valid_to date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_document_fiscal_series_company_document_series_year_key
    unique (company_id, document_type, series_code, fiscal_year),
  constraint finance_document_fiscal_series_valid_range_check
    check (valid_from is null or valid_to is null or valid_from <= valid_to)
);

create index if not exists finance_document_fiscal_series_company_lookup_idx
  on public.finance_document_fiscal_series (company_id, document_type, fiscal_year, is_active);

create or replace function public.resolve_fiscal_series(
  p_company_id uuid,
  p_document_type text,
  p_document_date date
)
returns public.finance_document_fiscal_series
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.finance_document_fiscal_series%rowtype;
  v_count integer;
  v_fiscal_year integer;
begin
  if p_company_id is null then
    raise exception 'finance_document_company_required';
  end if;

  if not public.finance_documents_can_read(p_company_id) then
    raise exception 'finance_document_company_access_denied';
  end if;

  if p_document_type not in ('sales_invoice', 'sales_credit_note', 'sales_debit_note') then
    raise exception 'unsupported_fiscal_document_type: %', p_document_type;
  end if;

  if not exists (
    select 1
    from public.company_fiscal_settings cfs
    where cfs.company_id = p_company_id
      and cfs.jurisdiction_code = 'MZ'
  ) then
    raise exception 'company_fiscal_settings_missing';
  end if;

  v_fiscal_year := extract(year from coalesce(p_document_date, current_date))::integer;

  select count(*)
    into v_count
  from public.finance_document_fiscal_series fdfs
  where fdfs.company_id = p_company_id
    and fdfs.document_type = p_document_type
    and fdfs.fiscal_year = v_fiscal_year
    and fdfs.is_active
    and (fdfs.valid_from is null or coalesce(p_document_date, current_date) >= fdfs.valid_from)
    and (fdfs.valid_to is null or coalesce(p_document_date, current_date) <= fdfs.valid_to);

  if v_count = 0 then
    raise exception 'finance_document_fiscal_series_missing';
  end if;

  if v_count > 1 then
    raise exception 'finance_document_fiscal_series_ambiguous';
  end if;

  select fdfs.*
    into v_row
  from public.finance_document_fiscal_series fdfs
  where fdfs.company_id = p_company_id
    and fdfs.document_type = p_document_type
    and fdfs.fiscal_year = v_fiscal_year
    and fdfs.is_active
    and (fdfs.valid_from is null or coalesce(p_document_date, current_date) >= fdfs.valid_from)
    and (fdfs.valid_to is null or coalesce(p_document_date, current_date) <= fdfs.valid_to)
  limit 1;

  return v_row;
end;
$$;

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
as $$
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
$$;

drop trigger if exists bu_90_company_fiscal_settings_touch_updated_at on public.company_fiscal_settings;
create trigger bu_90_company_fiscal_settings_touch_updated_at
before update on public.company_fiscal_settings
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists bu_90_finance_document_fiscal_series_touch_updated_at on public.finance_document_fiscal_series;
create trigger bu_90_finance_document_fiscal_series_touch_updated_at
before update on public.finance_document_fiscal_series
for each row execute function public.finance_documents_touch_updated_at();

alter table public.company_fiscal_settings enable row level security;
alter table public.finance_document_fiscal_series enable row level security;

drop policy if exists company_fiscal_settings_select on public.company_fiscal_settings;
create policy company_fiscal_settings_select
on public.company_fiscal_settings
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists company_fiscal_settings_write on public.company_fiscal_settings;
create policy company_fiscal_settings_write
on public.company_fiscal_settings
for all
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists finance_document_fiscal_series_select on public.finance_document_fiscal_series;
create policy finance_document_fiscal_series_select
on public.finance_document_fiscal_series
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists finance_document_fiscal_series_write on public.finance_document_fiscal_series;
create policy finance_document_fiscal_series_write
on public.finance_document_fiscal_series
for all
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

revoke all on public.company_fiscal_settings from public, anon;
revoke all on public.finance_document_fiscal_series from public, anon;

grant select, insert, update on public.company_fiscal_settings to authenticated;
grant select, insert, update on public.finance_document_fiscal_series to authenticated;

revoke all on function public.resolve_fiscal_series(uuid, text, date) from public, anon;
revoke all on function public.next_fiscal_document_reference(uuid, text, date, text, text) from public, anon;
grant execute on function public.resolve_fiscal_series(uuid, text, date) to authenticated;
grant execute on function public.next_fiscal_document_reference(uuid, text, date, text, text) to authenticated;

comment on table public.company_fiscal_settings is
  'Mozambique fiscal-compliance settings per company, including document language, phrase, series defaults, and archive retention policy.';

comment on table public.finance_document_fiscal_series is
  'Company-scoped legal fiscal series and sequence allocation rows for Mozambique sales invoices and corrective notes.';

comment on function public.resolve_fiscal_series(uuid, text, date) is
  'Returns the single active Mozambique fiscal series for the company, document type, and document year or raises a clear exception.';

comment on function public.next_fiscal_document_reference(uuid, text, date, text, text) is
  'Allocates the next visible legal fiscal reference for native Mozambique sales documents or preserves imported references unchanged.';
