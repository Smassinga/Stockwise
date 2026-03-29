create table if not exists public.saft_moz_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null
    check (status in ('pending', 'generated', 'submitted', 'failed')),
  requested_by uuid null references auth.users(id) on delete set null,
  generated_by uuid null references auth.users(id) on delete set null,
  generated_at timestamptz null,
  submitted_by uuid null references auth.users(id) on delete set null,
  submitted_at timestamptz null,
  submission_reference text null,
  storage_bucket text null,
  storage_path text null,
  file_name text null,
  mime_type text null,
  file_sha256 text null,
  size_bytes bigint null,
  source_document_count integer not null default 0,
  source_total_mzn numeric not null default 0 check (source_total_mzn >= 0),
  error_message text null,
  created_at timestamptz not null default now(),
  constraint saft_moz_exports_period_unique
    unique (company_id, period_start, period_end),
  constraint saft_moz_exports_period_check
    check (period_end >= period_start)
);

create index if not exists saft_moz_exports_company_status_idx
  on public.saft_moz_exports (company_id, status, period_start desc);

create or replace function public.create_saft_moz_export_run(
  p_company_id uuid,
  p_period_start date,
  p_period_end date
)
returns public.saft_moz_exports
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_export public.saft_moz_exports;
  v_settings public.company_fiscal_settings%rowtype;
begin
  if p_company_id is null then
    raise exception using
      message = 'SAF-T export creation requires a company id.';
  end if;

  if not public.finance_documents_can_write(p_company_id) then
    raise exception using
      message = 'SAF-T export creation access denied.';
  end if;

  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception using
      message = 'SAF-T export creation requires a valid period range.';
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = p_company_id
    and cfs.jurisdiction_code = 'MZ';

  if v_settings.company_id is null then
    raise exception using
      message = 'SAF-T export creation requires Mozambique fiscal settings for the company.';
  end if;

  if not coalesce(v_settings.saft_moz_enabled, false) then
    raise exception using
      message = 'SAF-T export generation is disabled for this company.';
  end if;

  if exists (
    select 1
    from public.saft_moz_exports sme
    where sme.company_id = p_company_id
      and sme.period_start = p_period_start
      and sme.period_end = p_period_end
  ) then
    raise exception using
      message = 'An SAF-T export run already exists for this company and period.';
  end if;

  insert into public.saft_moz_exports (
    company_id,
    period_start,
    period_end,
    status,
    requested_by
  )
  values (
    p_company_id,
    p_period_start,
    p_period_end,
    'pending',
    auth.uid()
  )
  returning * into v_export;

  perform public.append_finance_document_event(
    v_export.company_id,
    'saft_moz_export',
    v_export.id,
    'saft_export_requested',
    null,
    v_export.status,
    jsonb_build_object(
      'period_start', v_export.period_start,
      'period_end', v_export.period_end
    )
  );

  return v_export;
end;
$$;

create or replace function public.finalize_saft_moz_export_run(
  p_export_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_sha256 text,
  p_size_bytes bigint,
  p_source_document_count integer,
  p_source_total_mzn numeric
)
returns public.saft_moz_exports
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_export public.saft_moz_exports;
begin
  select sme.*
    into v_export
  from public.saft_moz_exports sme
  where sme.id = p_export_id;

  if v_export.id is null then
    raise exception using
      message = 'SAF-T export run not found.';
  end if;

  if not public.finance_documents_can_write(v_export.company_id) then
    raise exception using
      message = 'SAF-T export finalize access denied.';
  end if;

  if v_export.status <> 'pending' then
    raise exception using
      message = format('SAF-T export can only transition from pending to generated, not %s.', coalesce(v_export.status, '<null>'));
  end if;

  update public.saft_moz_exports sme
     set status = 'generated',
         generated_by = auth.uid(),
         generated_at = now(),
         storage_bucket = p_storage_bucket,
         storage_path = p_storage_path,
         file_name = p_file_name,
         mime_type = p_mime_type,
         file_sha256 = p_file_sha256,
         size_bytes = p_size_bytes,
         source_document_count = greatest(coalesce(p_source_document_count, 0), 0),
         source_total_mzn = greatest(coalesce(p_source_total_mzn, 0), 0),
         error_message = null
   where sme.id = p_export_id
  returning sme.* into v_export;

  perform public.append_finance_document_event(
    v_export.company_id,
    'saft_moz_export',
    v_export.id,
    'saft_export_generated',
    null,
    v_export.status,
    jsonb_build_object(
      'storage_bucket', v_export.storage_bucket,
      'storage_path', v_export.storage_path,
      'file_name', v_export.file_name,
      'source_document_count', v_export.source_document_count,
      'source_total_mzn', v_export.source_total_mzn
    )
  );

  return v_export;
end;
$$;

create or replace function public.submit_saft_moz_export_run(
  p_export_id uuid,
  p_submission_reference text default null
)
returns public.saft_moz_exports
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_export public.saft_moz_exports;
begin
  select sme.*
    into v_export
  from public.saft_moz_exports sme
  where sme.id = p_export_id;

  if v_export.id is null then
    raise exception using
      message = 'SAF-T export run not found.';
  end if;

  if not public.finance_documents_can_write(v_export.company_id) then
    raise exception using
      message = 'SAF-T export submit access denied.';
  end if;

  if v_export.status <> 'generated' then
    raise exception using
      message = format('SAF-T export can only transition from generated to submitted, not %s.', coalesce(v_export.status, '<null>'));
  end if;

  update public.saft_moz_exports sme
     set status = 'submitted',
         submitted_by = auth.uid(),
         submitted_at = now(),
         submission_reference = nullif(btrim(coalesce(p_submission_reference, '')), '')
   where sme.id = p_export_id
  returning sme.* into v_export;

  perform public.append_finance_document_event(
    v_export.company_id,
    'saft_moz_export',
    v_export.id,
    'saft_export_submitted',
    'generated',
    v_export.status,
    jsonb_build_object(
      'submission_reference', v_export.submission_reference
    )
  );

  return v_export;
end;
$$;

create or replace function public.fail_saft_moz_export_run(
  p_export_id uuid,
  p_error_message text
)
returns public.saft_moz_exports
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_export public.saft_moz_exports;
begin
  select sme.*
    into v_export
  from public.saft_moz_exports sme
  where sme.id = p_export_id;

  if v_export.id is null then
    raise exception using
      message = 'SAF-T export run not found.';
  end if;

  if not public.finance_documents_can_write(v_export.company_id) then
    raise exception using
      message = 'SAF-T export failure update access denied.';
  end if;

  if v_export.status <> 'pending' then
    raise exception using
      message = format('SAF-T export can only transition from pending to failed, not %s.', coalesce(v_export.status, '<null>'));
  end if;

  update public.saft_moz_exports sme
     set status = 'failed',
         error_message = nullif(btrim(coalesce(p_error_message, '')), '')
   where sme.id = p_export_id
  returning sme.* into v_export;

  perform public.append_finance_document_event(
    v_export.company_id,
    'saft_moz_export',
    v_export.id,
    'saft_export_failed',
    null,
    v_export.status,
    jsonb_build_object(
      'error_message', v_export.error_message
    )
  );

  return v_export;
end;
$$;

alter table public.saft_moz_exports enable row level security;

drop policy if exists saft_moz_exports_select on public.saft_moz_exports;
create policy saft_moz_exports_select
on public.saft_moz_exports
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists saft_moz_exports_insert on public.saft_moz_exports;
drop policy if exists saft_moz_exports_update on public.saft_moz_exports;

revoke all on public.saft_moz_exports from public, anon;
grant select on public.saft_moz_exports to authenticated;

create or replace view public.v_saft_moz_master_company
with (security_invoker = true)
as
select
  c.id as company_id,
  cfs.jurisdiction_code,
  coalesce(nullif(c.legal_name, ''), nullif(c.trade_name, ''), c.name) as legal_name,
  coalesce(nullif(c.trade_name, ''), c.name) as trade_name,
  c.tax_id as nuit,
  c.address_line1,
  c.address_line2,
  c.city,
  c.state,
  c.postal_code,
  c.country_code,
  cfs.document_language_code,
  cfs.presentation_currency_code,
  cfs.compliance_rule_version,
  cfs.invoice_series_code,
  cfs.credit_note_series_code,
  cfs.debit_note_series_code,
  cfs.homologation_reference
from public.companies c
join public.company_fiscal_settings cfs
  on cfs.company_id = c.id
where cfs.jurisdiction_code = 'MZ';

create or replace view public.v_saft_moz_master_customers
with (security_invoker = true)
as
with customer_snapshots as (
  select
    si.company_id,
    si.customer_id,
    coalesce(si.customer_id::text, md5(coalesce(si.buyer_legal_name_snapshot, '') || '|' || coalesce(si.buyer_nuit_snapshot, ''))) as customer_key,
    si.buyer_legal_name_snapshot as customer_name,
    si.buyer_nuit_snapshot as customer_nuit,
    si.buyer_address_line1_snapshot as address_line1,
    si.buyer_address_line2_snapshot as address_line2,
    si.buyer_city_snapshot as city,
    si.buyer_state_snapshot as state,
    si.buyer_postal_code_snapshot as postal_code,
    si.buyer_country_code_snapshot as country_code,
    si.invoice_date as document_date,
    si.id::text as document_id
  from public.sales_invoices si
  where si.document_workflow_status = 'issued'
  union all
  select
    scn.company_id,
    scn.customer_id,
    coalesce(scn.customer_id::text, md5(coalesce(scn.buyer_legal_name_snapshot, '') || '|' || coalesce(scn.buyer_nuit_snapshot, ''))),
    scn.buyer_legal_name_snapshot,
    scn.buyer_nuit_snapshot,
    scn.buyer_address_line1_snapshot,
    scn.buyer_address_line2_snapshot,
    scn.buyer_city_snapshot,
    scn.buyer_state_snapshot,
    scn.buyer_postal_code_snapshot,
    scn.buyer_country_code_snapshot,
    scn.credit_note_date,
    scn.id::text
  from public.sales_credit_notes scn
  where scn.document_workflow_status = 'issued'
  union all
  select
    sdn.company_id,
    sdn.customer_id,
    coalesce(sdn.customer_id::text, md5(coalesce(sdn.buyer_legal_name_snapshot, '') || '|' || coalesce(sdn.buyer_nuit_snapshot, ''))),
    sdn.buyer_legal_name_snapshot,
    sdn.buyer_nuit_snapshot,
    sdn.buyer_address_line1_snapshot,
    sdn.buyer_address_line2_snapshot,
    sdn.buyer_city_snapshot,
    sdn.buyer_state_snapshot,
    sdn.buyer_postal_code_snapshot,
    sdn.buyer_country_code_snapshot,
    sdn.debit_note_date,
    sdn.id::text
  from public.sales_debit_notes sdn
  where sdn.document_workflow_status = 'issued'
),
ranked_customer_snapshots as (
  select
    cs.*,
    row_number() over (
      partition by cs.company_id, cs.customer_key
      order by cs.document_date desc, cs.document_id desc
    ) as row_no
  from customer_snapshots cs
  where nullif(btrim(coalesce(cs.customer_name, '')), '') is not null
)
select
  rcs.company_id,
  rcs.customer_id,
  rcs.customer_name,
  rcs.customer_nuit,
  rcs.address_line1,
  rcs.address_line2,
  rcs.city,
  rcs.state,
  rcs.postal_code,
  rcs.country_code
from ranked_customer_snapshots rcs
where rcs.row_no = 1;

create or replace view public.v_saft_moz_master_products
with (security_invoker = true)
as
with product_snapshots as (
  select
    si.company_id,
    sil.product_code_snapshot as product_code,
    sil.description,
    sil.unit_of_measure_snapshot as unit_of_measure,
    si.invoice_date as document_date,
    sil.id::text as line_id
  from public.sales_invoice_lines sil
  join public.sales_invoices si
    on si.id = sil.sales_invoice_id
  where si.document_workflow_status = 'issued'
  union all
  select
    scn.company_id,
    scnl.product_code_snapshot,
    scnl.description,
    scnl.unit_of_measure_snapshot,
    scn.credit_note_date,
    scnl.id::text
  from public.sales_credit_note_lines scnl
  join public.sales_credit_notes scn
    on scn.id = scnl.sales_credit_note_id
  where scn.document_workflow_status = 'issued'
  union all
  select
    sdn.company_id,
    sdnl.product_code_snapshot,
    sdnl.description,
    sdnl.unit_of_measure_snapshot,
    sdn.debit_note_date,
    sdnl.id::text
  from public.sales_debit_note_lines sdnl
  join public.sales_debit_notes sdn
    on sdn.id = sdnl.sales_debit_note_id
  where sdn.document_workflow_status = 'issued'
),
ranked_product_snapshots as (
  select
    ps.*,
    row_number() over (
      partition by ps.company_id, ps.product_code
      order by ps.document_date desc, ps.line_id desc
    ) as row_no
  from product_snapshots ps
  where nullif(btrim(coalesce(ps.product_code, '')), '') is not null
)
select
  rps.company_id,
  rps.product_code,
  rps.description,
  rps.unit_of_measure
from ranked_product_snapshots rps
where rps.row_no = 1;

create or replace view public.v_saft_moz_master_tax_table
with (security_invoker = true)
as
select distinct
  src.company_id,
  src.tax_category_code,
  src.tax_rate
from (
  select si.company_id, sil.tax_category_code, sil.tax_rate
  from public.sales_invoice_lines sil
  join public.sales_invoices si
    on si.id = sil.sales_invoice_id
  where si.document_workflow_status = 'issued'
  union all
  select scn.company_id, scnl.tax_category_code, scnl.tax_rate
  from public.sales_credit_note_lines scnl
  join public.sales_credit_notes scn
    on scn.id = scnl.sales_credit_note_id
  where scn.document_workflow_status = 'issued'
  union all
  select sdn.company_id, sdnl.tax_category_code, sdnl.tax_rate
  from public.sales_debit_note_lines sdnl
  join public.sales_debit_notes sdn
    on sdn.id = sdnl.sales_debit_note_id
  where sdn.document_workflow_status = 'issued'
) src
where src.tax_category_code is not null;

create or replace view public.v_saft_moz_source_documents_sales_invoices
with (security_invoker = true)
as
select
  si.id as sales_invoice_id,
  si.company_id,
  si.sales_order_id,
  si.customer_id,
  si.internal_reference as legal_reference,
  si.source_origin,
  si.moz_document_code,
  si.fiscal_series_code,
  si.fiscal_year,
  si.fiscal_sequence_number,
  si.invoice_date as document_date,
  si.due_date,
  si.currency_code,
  si.fx_to_base,
  si.subtotal,
  si.tax_total,
  si.total_amount,
  si.subtotal_mzn,
  si.tax_total_mzn,
  si.total_amount_mzn,
  si.seller_legal_name_snapshot,
  si.seller_trade_name_snapshot,
  si.seller_nuit_snapshot,
  si.seller_address_line1_snapshot,
  si.seller_address_line2_snapshot,
  si.seller_city_snapshot,
  si.seller_state_snapshot,
  si.seller_postal_code_snapshot,
  si.seller_country_code_snapshot,
  si.buyer_legal_name_snapshot,
  si.buyer_nuit_snapshot,
  si.buyer_address_line1_snapshot,
  si.buyer_address_line2_snapshot,
  si.buyer_city_snapshot,
  si.buyer_state_snapshot,
  si.buyer_postal_code_snapshot,
  si.buyer_country_code_snapshot,
  si.document_language_code_snapshot,
  si.computer_processed_phrase_snapshot,
  si.compliance_rule_version_snapshot,
  si.issued_at
from public.sales_invoices si
where si.document_workflow_status = 'issued';

create or replace view public.v_saft_moz_source_documents_sales_invoice_lines
with (security_invoker = true)
as
select
  sil.id as sales_invoice_line_id,
  sil.sales_invoice_id,
  si.company_id,
  si.internal_reference as legal_reference,
  sil.sales_order_line_id,
  sil.item_id,
  sil.sort_order,
  sil.description,
  sil.qty,
  sil.unit_price,
  sil.tax_rate,
  sil.tax_amount,
  sil.line_total,
  sil.product_code_snapshot,
  sil.unit_of_measure_snapshot,
  sil.tax_category_code
from public.sales_invoice_lines sil
join public.sales_invoices si
  on si.id = sil.sales_invoice_id
where si.document_workflow_status = 'issued';

create or replace view public.v_saft_moz_source_documents_sales_credit_notes
with (security_invoker = true)
as
select
  scn.id as sales_credit_note_id,
  scn.company_id,
  scn.original_sales_invoice_id,
  scn.customer_id,
  scn.internal_reference as legal_reference,
  scn.source_origin,
  scn.moz_document_code,
  scn.fiscal_series_code,
  scn.fiscal_year,
  scn.fiscal_sequence_number,
  scn.credit_note_date as document_date,
  scn.due_date,
  scn.currency_code,
  scn.fx_to_base,
  scn.subtotal,
  scn.tax_total,
  scn.total_amount,
  scn.subtotal_mzn,
  scn.tax_total_mzn,
  scn.total_amount_mzn,
  scn.correction_reason_code,
  scn.correction_reason_text,
  scn.seller_legal_name_snapshot,
  scn.seller_trade_name_snapshot,
  scn.seller_nuit_snapshot,
  scn.seller_address_line1_snapshot,
  scn.seller_address_line2_snapshot,
  scn.seller_city_snapshot,
  scn.seller_state_snapshot,
  scn.seller_postal_code_snapshot,
  scn.seller_country_code_snapshot,
  scn.buyer_legal_name_snapshot,
  scn.buyer_nuit_snapshot,
  scn.buyer_address_line1_snapshot,
  scn.buyer_address_line2_snapshot,
  scn.buyer_city_snapshot,
  scn.buyer_state_snapshot,
  scn.buyer_postal_code_snapshot,
  scn.buyer_country_code_snapshot,
  scn.document_language_code_snapshot,
  scn.computer_processed_phrase_snapshot,
  scn.compliance_rule_version_snapshot,
  scn.issued_at
from public.sales_credit_notes scn
where scn.document_workflow_status = 'issued';

create or replace view public.v_saft_moz_source_documents_sales_credit_note_lines
with (security_invoker = true)
as
select
  scnl.id as sales_credit_note_line_id,
  scnl.sales_credit_note_id,
  scn.company_id,
  scn.internal_reference as legal_reference,
  scnl.sales_invoice_line_id,
  scnl.item_id,
  scnl.sort_order,
  scnl.description,
  scnl.qty,
  scnl.unit_price,
  scnl.tax_rate,
  scnl.tax_amount,
  scnl.line_total,
  scnl.product_code_snapshot,
  scnl.unit_of_measure_snapshot,
  scnl.tax_category_code
from public.sales_credit_note_lines scnl
join public.sales_credit_notes scn
  on scn.id = scnl.sales_credit_note_id
where scn.document_workflow_status = 'issued';

create or replace view public.v_saft_moz_source_documents_sales_debit_notes
with (security_invoker = true)
as
select
  sdn.id as sales_debit_note_id,
  sdn.company_id,
  sdn.original_sales_invoice_id,
  sdn.customer_id,
  sdn.internal_reference as legal_reference,
  sdn.source_origin,
  sdn.moz_document_code,
  sdn.fiscal_series_code,
  sdn.fiscal_year,
  sdn.fiscal_sequence_number,
  sdn.debit_note_date as document_date,
  sdn.due_date,
  sdn.currency_code,
  sdn.fx_to_base,
  sdn.subtotal,
  sdn.tax_total,
  sdn.total_amount,
  sdn.subtotal_mzn,
  sdn.tax_total_mzn,
  sdn.total_amount_mzn,
  sdn.correction_reason_code,
  sdn.correction_reason_text,
  sdn.seller_legal_name_snapshot,
  sdn.seller_trade_name_snapshot,
  sdn.seller_nuit_snapshot,
  sdn.seller_address_line1_snapshot,
  sdn.seller_address_line2_snapshot,
  sdn.seller_city_snapshot,
  sdn.seller_state_snapshot,
  sdn.seller_postal_code_snapshot,
  sdn.seller_country_code_snapshot,
  sdn.buyer_legal_name_snapshot,
  sdn.buyer_nuit_snapshot,
  sdn.buyer_address_line1_snapshot,
  sdn.buyer_address_line2_snapshot,
  sdn.buyer_city_snapshot,
  sdn.buyer_state_snapshot,
  sdn.buyer_postal_code_snapshot,
  sdn.buyer_country_code_snapshot,
  sdn.document_language_code_snapshot,
  sdn.computer_processed_phrase_snapshot,
  sdn.compliance_rule_version_snapshot,
  sdn.issued_at
from public.sales_debit_notes sdn
where sdn.document_workflow_status = 'issued';

create or replace view public.v_saft_moz_source_documents_sales_debit_note_lines
with (security_invoker = true)
as
select
  sdnl.id as sales_debit_note_line_id,
  sdnl.sales_debit_note_id,
  sdn.company_id,
  sdn.internal_reference as legal_reference,
  sdnl.sales_invoice_line_id,
  sdnl.item_id,
  sdnl.sort_order,
  sdnl.description,
  sdnl.qty,
  sdnl.unit_price,
  sdnl.tax_rate,
  sdnl.tax_amount,
  sdnl.line_total,
  sdnl.product_code_snapshot,
  sdnl.unit_of_measure_snapshot,
  sdnl.tax_category_code
from public.sales_debit_note_lines sdnl
join public.sales_debit_notes sdn
  on sdn.id = sdnl.sales_debit_note_id
where sdn.document_workflow_status = 'issued';

create or replace view public.v_saft_moz_source_documents_summary
with (security_invoker = true)
as
select
  src.company_id,
  src.document_kind,
  src.fiscal_year,
  count(*) as document_count,
  sum(src.total_amount_mzn) as total_amount_mzn
from (
  select
    si.company_id,
    'sales_invoice'::text as document_kind,
    si.fiscal_year,
    si.total_amount_mzn
  from public.sales_invoices si
  where si.document_workflow_status = 'issued'
  union all
  select
    scn.company_id,
    'sales_credit_note'::text,
    scn.fiscal_year,
    scn.total_amount_mzn
  from public.sales_credit_notes scn
  where scn.document_workflow_status = 'issued'
  union all
  select
    sdn.company_id,
    'sales_debit_note'::text,
    sdn.fiscal_year,
    sdn.total_amount_mzn
  from public.sales_debit_notes sdn
  where sdn.document_workflow_status = 'issued'
) src
group by src.company_id, src.document_kind, src.fiscal_year;

grant select on public.v_saft_moz_master_company to authenticated;
grant select on public.v_saft_moz_master_customers to authenticated;
grant select on public.v_saft_moz_master_products to authenticated;
grant select on public.v_saft_moz_master_tax_table to authenticated;
grant select on public.v_saft_moz_source_documents_sales_invoices to authenticated;
grant select on public.v_saft_moz_source_documents_sales_invoice_lines to authenticated;
grant select on public.v_saft_moz_source_documents_sales_credit_notes to authenticated;
grant select on public.v_saft_moz_source_documents_sales_credit_note_lines to authenticated;
grant select on public.v_saft_moz_source_documents_sales_debit_notes to authenticated;
grant select on public.v_saft_moz_source_documents_sales_debit_note_lines to authenticated;
grant select on public.v_saft_moz_source_documents_summary to authenticated;

revoke all on function public.create_saft_moz_export_run(uuid, date, date) from public, anon;
revoke all on function public.finalize_saft_moz_export_run(uuid, text, text, text, text, text, bigint, integer, numeric) from public, anon;
revoke all on function public.submit_saft_moz_export_run(uuid, text) from public, anon;
revoke all on function public.fail_saft_moz_export_run(uuid, text) from public, anon;
grant execute on function public.create_saft_moz_export_run(uuid, date, date) to authenticated;
grant execute on function public.finalize_saft_moz_export_run(uuid, text, text, text, text, text, bigint, integer, numeric) to authenticated;
grant execute on function public.submit_saft_moz_export_run(uuid, text) to authenticated;
grant execute on function public.fail_saft_moz_export_run(uuid, text) to authenticated;

comment on table public.saft_moz_exports is
  'Monthly SAF-T (Mozambique) export runs, file metadata, and submission lifecycle state.';

comment on function public.create_saft_moz_export_run(uuid, date, date) is
  'Creates a pending SAF-T (Mozambique) export run for a company and period and journals the request.';

comment on view public.v_saft_moz_source_documents_summary is
  'Extensible summary view for issued sales-side fiscal documents feeding SAF-T generation in Wave 1.';
