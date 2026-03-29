create table if not exists public.sales_credit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  original_sales_invoice_id uuid not null references public.sales_invoices(id) on delete restrict,
  customer_id uuid null references public.customers(id) on delete set null,
  internal_reference text not null,
  source_origin text not null default 'native'
    check (source_origin in ('native', 'imported')),
  moz_document_code text not null default 'NC'
    check (moz_document_code = 'NC'),
  fiscal_series_code text null,
  fiscal_year integer null
    check (fiscal_year is null or fiscal_year between 2000 and 9999),
  fiscal_sequence_number integer null
    check (fiscal_sequence_number is null or fiscal_sequence_number >= 1),
  credit_note_date date not null default current_date,
  due_date date null,
  currency_code text not null default 'MZN',
  fx_to_base numeric not null default 1 check (fx_to_base > 0),
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_total numeric not null default 0 check (tax_total >= 0),
  total_amount numeric not null default 0 check (total_amount >= 0),
  subtotal_mzn numeric not null default 0 check (subtotal_mzn >= 0),
  tax_total_mzn numeric not null default 0 check (tax_total_mzn >= 0),
  total_amount_mzn numeric not null default 0 check (total_amount_mzn >= 0),
  correction_reason_code text null,
  correction_reason_text text not null default '',
  seller_legal_name_snapshot text null,
  seller_trade_name_snapshot text null,
  seller_nuit_snapshot text null,
  seller_address_line1_snapshot text null,
  seller_address_line2_snapshot text null,
  seller_city_snapshot text null,
  seller_state_snapshot text null,
  seller_postal_code_snapshot text null,
  seller_country_code_snapshot text null,
  buyer_legal_name_snapshot text null,
  buyer_nuit_snapshot text null,
  buyer_address_line1_snapshot text null,
  buyer_address_line2_snapshot text null,
  buyer_city_snapshot text null,
  buyer_state_snapshot text null,
  buyer_postal_code_snapshot text null,
  buyer_country_code_snapshot text null,
  document_language_code_snapshot text null,
  computer_processed_phrase_snapshot text null,
  compliance_rule_version_snapshot text null,
  document_workflow_status text not null default 'draft'
    check (document_workflow_status in ('draft', 'issued', 'voided')),
  issued_at timestamptz null,
  issued_by uuid null references auth.users(id) on delete set null,
  voided_at timestamptz null,
  voided_by uuid null references auth.users(id) on delete set null,
  void_reason text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_credit_notes_internal_reference_format
    check (
      (
        source_origin = 'native'
        and internal_reference ~ '^[A-Z0-9]{3}-[A-Z0-9]{2,10}[0-9]{4}-[0-9]{5}$'
      )
      or (
        source_origin = 'imported'
        and nullif(btrim(coalesce(internal_reference, '')), '') is not null
      )
    )
);

create unique index if not exists sales_credit_notes_company_internal_reference_key
  on public.sales_credit_notes (company_id, internal_reference);

drop index if exists public.sales_credit_notes_company_native_sequence_key;
create unique index sales_credit_notes_company_native_sequence_key
  on public.sales_credit_notes (company_id, moz_document_code, fiscal_series_code, fiscal_year, fiscal_sequence_number)
  where source_origin = 'native';

create index if not exists sales_credit_notes_original_invoice_idx
  on public.sales_credit_notes (company_id, original_sales_invoice_id);

create table if not exists public.sales_credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sales_credit_note_id uuid not null references public.sales_credit_notes(id) on delete cascade,
  sales_invoice_line_id uuid null references public.sales_invoice_lines(id) on delete set null,
  item_id uuid null references public.items(id) on delete set null,
  description text not null default '',
  qty numeric not null default 0,
  unit_price numeric not null default 0,
  tax_rate numeric null,
  tax_amount numeric not null default 0,
  line_total numeric not null default 0,
  product_code_snapshot text null,
  unit_of_measure_snapshot text null,
  tax_category_code text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_credit_note_lines_nonnegative_fields
    check (
      qty >= 0
      and unit_price >= 0
      and (tax_rate is null or tax_rate >= 0)
      and tax_amount >= 0
      and line_total >= 0
    )
);

create index if not exists sales_credit_note_lines_note_idx
  on public.sales_credit_note_lines (sales_credit_note_id, sort_order, created_at);

create table if not exists public.sales_debit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  original_sales_invoice_id uuid not null references public.sales_invoices(id) on delete restrict,
  customer_id uuid null references public.customers(id) on delete set null,
  internal_reference text not null,
  source_origin text not null default 'native'
    check (source_origin in ('native', 'imported')),
  moz_document_code text not null default 'ND'
    check (moz_document_code = 'ND'),
  fiscal_series_code text null,
  fiscal_year integer null
    check (fiscal_year is null or fiscal_year between 2000 and 9999),
  fiscal_sequence_number integer null
    check (fiscal_sequence_number is null or fiscal_sequence_number >= 1),
  debit_note_date date not null default current_date,
  due_date date not null,
  currency_code text not null default 'MZN',
  fx_to_base numeric not null default 1 check (fx_to_base > 0),
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_total numeric not null default 0 check (tax_total >= 0),
  total_amount numeric not null default 0 check (total_amount >= 0),
  subtotal_mzn numeric not null default 0 check (subtotal_mzn >= 0),
  tax_total_mzn numeric not null default 0 check (tax_total_mzn >= 0),
  total_amount_mzn numeric not null default 0 check (total_amount_mzn >= 0),
  correction_reason_code text null,
  correction_reason_text text not null default '',
  seller_legal_name_snapshot text null,
  seller_trade_name_snapshot text null,
  seller_nuit_snapshot text null,
  seller_address_line1_snapshot text null,
  seller_address_line2_snapshot text null,
  seller_city_snapshot text null,
  seller_state_snapshot text null,
  seller_postal_code_snapshot text null,
  seller_country_code_snapshot text null,
  buyer_legal_name_snapshot text null,
  buyer_nuit_snapshot text null,
  buyer_address_line1_snapshot text null,
  buyer_address_line2_snapshot text null,
  buyer_city_snapshot text null,
  buyer_state_snapshot text null,
  buyer_postal_code_snapshot text null,
  buyer_country_code_snapshot text null,
  document_language_code_snapshot text null,
  computer_processed_phrase_snapshot text null,
  compliance_rule_version_snapshot text null,
  document_workflow_status text not null default 'draft'
    check (document_workflow_status in ('draft', 'issued', 'voided')),
  issued_at timestamptz null,
  issued_by uuid null references auth.users(id) on delete set null,
  voided_at timestamptz null,
  voided_by uuid null references auth.users(id) on delete set null,
  void_reason text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_debit_notes_internal_reference_format
    check (
      (
        source_origin = 'native'
        and internal_reference ~ '^[A-Z0-9]{3}-[A-Z0-9]{2,10}[0-9]{4}-[0-9]{5}$'
      )
      or (
        source_origin = 'imported'
        and nullif(btrim(coalesce(internal_reference, '')), '') is not null
      )
    )
);

create unique index if not exists sales_debit_notes_company_internal_reference_key
  on public.sales_debit_notes (company_id, internal_reference);

drop index if exists public.sales_debit_notes_company_native_sequence_key;
create unique index sales_debit_notes_company_native_sequence_key
  on public.sales_debit_notes (company_id, moz_document_code, fiscal_series_code, fiscal_year, fiscal_sequence_number)
  where source_origin = 'native';

create index if not exists sales_debit_notes_original_invoice_idx
  on public.sales_debit_notes (company_id, original_sales_invoice_id);

create table if not exists public.sales_debit_note_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sales_debit_note_id uuid not null references public.sales_debit_notes(id) on delete cascade,
  sales_invoice_line_id uuid null references public.sales_invoice_lines(id) on delete set null,
  item_id uuid null references public.items(id) on delete set null,
  description text not null default '',
  qty numeric not null default 0,
  unit_price numeric not null default 0,
  tax_rate numeric null,
  tax_amount numeric not null default 0,
  line_total numeric not null default 0,
  product_code_snapshot text null,
  unit_of_measure_snapshot text null,
  tax_category_code text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_debit_note_lines_nonnegative_fields
    check (
      qty >= 0
      and unit_price >= 0
      and (tax_rate is null or tax_rate >= 0)
      and tax_amount >= 0
      and line_total >= 0
    )
);

create index if not exists sales_debit_note_lines_note_idx
  on public.sales_debit_note_lines (sales_debit_note_id, sort_order, created_at);

create or replace function public.finance_note_line_company_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_parent_company_id uuid;
  v_original_invoice_id uuid;
  v_sales_invoice_id uuid;
begin
  if tg_table_name = 'sales_credit_note_lines' then
    select scn.company_id, scn.original_sales_invoice_id
      into v_parent_company_id, v_original_invoice_id
    from public.sales_credit_notes scn
    where scn.id = new.sales_credit_note_id;
  elsif tg_table_name = 'sales_debit_note_lines' then
    select sdn.company_id, sdn.original_sales_invoice_id
      into v_parent_company_id, v_original_invoice_id
    from public.sales_debit_notes sdn
    where sdn.id = new.sales_debit_note_id;
  end if;

  if v_parent_company_id is null then
    raise exception 'finance_document_parent_not_found';
  end if;

  if new.sales_invoice_line_id is not null then
    select sil.sales_invoice_id
      into v_sales_invoice_id
    from public.sales_invoice_lines sil
    where sil.id = new.sales_invoice_line_id;

    if v_sales_invoice_id is null then
      raise exception using
        message = 'Sales note lines must reference an existing sales invoice line when a source line is provided.';
    end if;

    if v_sales_invoice_id is distinct from v_original_invoice_id then
      raise exception using
        message = 'Sales note lines must reference lines from the original sales invoice.';
    end if;
  end if;

  new.company_id := v_parent_company_id;
  return new;
end;
$$;

create or replace function public.sales_credit_note_assign_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_reference record;
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'sales_credit_note_internal_reference_immutable';
  end if;

  if new.source_origin not in ('native', 'imported') then
    raise exception 'sales_credit_note_source_origin_invalid';
  end if;

  new.moz_document_code := 'NC';

  if new.source_origin = 'imported' then
    if nullif(btrim(coalesce(new.internal_reference, '')), '') is null then
      raise exception 'imported_sales_credit_note_reference_required';
    end if;
    new.internal_reference := btrim(new.internal_reference);
    if new.fiscal_year is null then
      new.fiscal_year := extract(year from coalesce(new.credit_note_date, current_date))::integer;
    end if;
  elsif new.internal_reference is null or btrim(new.internal_reference) = '' then
    select *
      into v_reference
    from public.next_fiscal_document_reference(
      new.company_id,
      'sales_credit_note',
      coalesce(new.credit_note_date, current_date),
      new.source_origin,
      null
    );

    new.internal_reference := v_reference.internal_reference;
    new.fiscal_series_code := v_reference.fiscal_series_code;
    new.fiscal_year := v_reference.fiscal_year;
    new.fiscal_sequence_number := v_reference.fiscal_sequence_number;
  end if;

  if new.document_workflow_status = 'issued' then
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    if new.issued_by is null then
      new.issued_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sales_debit_note_assign_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_reference record;
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'sales_debit_note_internal_reference_immutable';
  end if;

  if new.source_origin not in ('native', 'imported') then
    raise exception 'sales_debit_note_source_origin_invalid';
  end if;

  new.moz_document_code := 'ND';

  if new.source_origin = 'imported' then
    if nullif(btrim(coalesce(new.internal_reference, '')), '') is null then
      raise exception 'imported_sales_debit_note_reference_required';
    end if;
    new.internal_reference := btrim(new.internal_reference);
    if new.fiscal_year is null then
      new.fiscal_year := extract(year from coalesce(new.debit_note_date, current_date))::integer;
    end if;
  elsif new.internal_reference is null or btrim(new.internal_reference) = '' then
    select *
      into v_reference
    from public.next_fiscal_document_reference(
      new.company_id,
      'sales_debit_note',
      coalesce(new.debit_note_date, current_date),
      new.source_origin,
      null
    );

    new.internal_reference := v_reference.internal_reference;
    new.fiscal_series_code := v_reference.fiscal_series_code;
    new.fiscal_year := v_reference.fiscal_year;
    new.fiscal_sequence_number := v_reference.fiscal_sequence_number;
  end if;

  if new.document_workflow_status = 'issued' then
    if new.issued_at is null then
      new.issued_at := now();
    end if;
    if new.issued_by is null then
      new.issued_by := auth.uid();
    end if;
  end if;

  if new.document_workflow_status = 'voided' then
    if new.voided_at is null then
      new.voided_at := now();
    end if;
    if new.voided_by is null then
      new.voided_by := auth.uid();
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sales_credit_note_snapshot_fiscal_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_invoice public.sales_invoices%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception 'sales_note_original_invoice_missing';
  end if;

  new.customer_id := coalesce(new.customer_id, v_invoice.customer_id);
  new.currency_code := coalesce(new.currency_code, v_invoice.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_invoice.fx_to_base, 1);
  new.seller_legal_name_snapshot := coalesce(new.seller_legal_name_snapshot, v_invoice.seller_legal_name_snapshot);
  new.seller_trade_name_snapshot := coalesce(new.seller_trade_name_snapshot, v_invoice.seller_trade_name_snapshot);
  new.seller_nuit_snapshot := coalesce(new.seller_nuit_snapshot, v_invoice.seller_nuit_snapshot);
  new.seller_address_line1_snapshot := coalesce(new.seller_address_line1_snapshot, v_invoice.seller_address_line1_snapshot);
  new.seller_address_line2_snapshot := coalesce(new.seller_address_line2_snapshot, v_invoice.seller_address_line2_snapshot);
  new.seller_city_snapshot := coalesce(new.seller_city_snapshot, v_invoice.seller_city_snapshot);
  new.seller_state_snapshot := coalesce(new.seller_state_snapshot, v_invoice.seller_state_snapshot);
  new.seller_postal_code_snapshot := coalesce(new.seller_postal_code_snapshot, v_invoice.seller_postal_code_snapshot);
  new.seller_country_code_snapshot := coalesce(new.seller_country_code_snapshot, v_invoice.seller_country_code_snapshot);
  new.buyer_legal_name_snapshot := coalesce(new.buyer_legal_name_snapshot, v_invoice.buyer_legal_name_snapshot);
  new.buyer_nuit_snapshot := coalesce(new.buyer_nuit_snapshot, v_invoice.buyer_nuit_snapshot);
  new.buyer_address_line1_snapshot := coalesce(new.buyer_address_line1_snapshot, v_invoice.buyer_address_line1_snapshot);
  new.buyer_address_line2_snapshot := coalesce(new.buyer_address_line2_snapshot, v_invoice.buyer_address_line2_snapshot);
  new.buyer_city_snapshot := coalesce(new.buyer_city_snapshot, v_invoice.buyer_city_snapshot);
  new.buyer_state_snapshot := coalesce(new.buyer_state_snapshot, v_invoice.buyer_state_snapshot);
  new.buyer_postal_code_snapshot := coalesce(new.buyer_postal_code_snapshot, v_invoice.buyer_postal_code_snapshot);
  new.buyer_country_code_snapshot := coalesce(new.buyer_country_code_snapshot, v_invoice.buyer_country_code_snapshot);
  new.document_language_code_snapshot := coalesce(new.document_language_code_snapshot, v_invoice.document_language_code_snapshot);
  new.computer_processed_phrase_snapshot := coalesce(new.computer_processed_phrase_snapshot, v_invoice.computer_processed_phrase_snapshot);
  new.compliance_rule_version_snapshot := coalesce(new.compliance_rule_version_snapshot, v_invoice.compliance_rule_version_snapshot);
  new.subtotal_mzn := round(coalesce(new.subtotal, 0) * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_mzn := round(coalesce(new.tax_total, 0) * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_mzn := round(coalesce(new.total_amount, 0) * coalesce(new.fx_to_base, 1), 2);

  update public.sales_credit_note_lines scnl
     set product_code_snapshot = coalesce(scnl.product_code_snapshot, sil.product_code_snapshot, nullif(i.sku, ''), scnl.item_id::text),
         unit_of_measure_snapshot = coalesce(
           scnl.unit_of_measure_snapshot,
           sil.unit_of_measure_snapshot,
           nullif(i.base_uom_id::text, '')
         ),
         tax_category_code = coalesce(
           scnl.tax_category_code,
           sil.tax_category_code,
           case when coalesce(scnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from public.sales_invoice_lines sil
    left join public.items i
      on i.id = scnl.item_id
   where scnl.sales_credit_note_id = new.id
     and sil.id is not distinct from scnl.sales_invoice_line_id;

  update public.sales_credit_note_lines scnl
     set product_code_snapshot = coalesce(scnl.product_code_snapshot, scnl.item_id::text, 'ITEM'),
         unit_of_measure_snapshot = coalesce(scnl.unit_of_measure_snapshot, 'UN'),
         tax_category_code = coalesce(
           scnl.tax_category_code,
           case when coalesce(scnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
   where scnl.sales_credit_note_id = new.id
     and (scnl.product_code_snapshot is null
       or scnl.unit_of_measure_snapshot is null
       or scnl.tax_category_code is null);

  return new;
end;
$$;

create or replace function public.sales_debit_note_snapshot_fiscal_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_invoice public.sales_invoices%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception 'sales_note_original_invoice_missing';
  end if;

  new.customer_id := coalesce(new.customer_id, v_invoice.customer_id);
  new.currency_code := coalesce(new.currency_code, v_invoice.currency_code);
  new.fx_to_base := coalesce(new.fx_to_base, v_invoice.fx_to_base, 1);
  new.seller_legal_name_snapshot := coalesce(new.seller_legal_name_snapshot, v_invoice.seller_legal_name_snapshot);
  new.seller_trade_name_snapshot := coalesce(new.seller_trade_name_snapshot, v_invoice.seller_trade_name_snapshot);
  new.seller_nuit_snapshot := coalesce(new.seller_nuit_snapshot, v_invoice.seller_nuit_snapshot);
  new.seller_address_line1_snapshot := coalesce(new.seller_address_line1_snapshot, v_invoice.seller_address_line1_snapshot);
  new.seller_address_line2_snapshot := coalesce(new.seller_address_line2_snapshot, v_invoice.seller_address_line2_snapshot);
  new.seller_city_snapshot := coalesce(new.seller_city_snapshot, v_invoice.seller_city_snapshot);
  new.seller_state_snapshot := coalesce(new.seller_state_snapshot, v_invoice.seller_state_snapshot);
  new.seller_postal_code_snapshot := coalesce(new.seller_postal_code_snapshot, v_invoice.seller_postal_code_snapshot);
  new.seller_country_code_snapshot := coalesce(new.seller_country_code_snapshot, v_invoice.seller_country_code_snapshot);
  new.buyer_legal_name_snapshot := coalesce(new.buyer_legal_name_snapshot, v_invoice.buyer_legal_name_snapshot);
  new.buyer_nuit_snapshot := coalesce(new.buyer_nuit_snapshot, v_invoice.buyer_nuit_snapshot);
  new.buyer_address_line1_snapshot := coalesce(new.buyer_address_line1_snapshot, v_invoice.buyer_address_line1_snapshot);
  new.buyer_address_line2_snapshot := coalesce(new.buyer_address_line2_snapshot, v_invoice.buyer_address_line2_snapshot);
  new.buyer_city_snapshot := coalesce(new.buyer_city_snapshot, v_invoice.buyer_city_snapshot);
  new.buyer_state_snapshot := coalesce(new.buyer_state_snapshot, v_invoice.buyer_state_snapshot);
  new.buyer_postal_code_snapshot := coalesce(new.buyer_postal_code_snapshot, v_invoice.buyer_postal_code_snapshot);
  new.buyer_country_code_snapshot := coalesce(new.buyer_country_code_snapshot, v_invoice.buyer_country_code_snapshot);
  new.document_language_code_snapshot := coalesce(new.document_language_code_snapshot, v_invoice.document_language_code_snapshot);
  new.computer_processed_phrase_snapshot := coalesce(new.computer_processed_phrase_snapshot, v_invoice.computer_processed_phrase_snapshot);
  new.compliance_rule_version_snapshot := coalesce(new.compliance_rule_version_snapshot, v_invoice.compliance_rule_version_snapshot);
  new.subtotal_mzn := round(coalesce(new.subtotal, 0) * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_mzn := round(coalesce(new.tax_total, 0) * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_mzn := round(coalesce(new.total_amount, 0) * coalesce(new.fx_to_base, 1), 2);

  update public.sales_debit_note_lines sdnl
     set product_code_snapshot = coalesce(sdnl.product_code_snapshot, sil.product_code_snapshot, nullif(i.sku, ''), sdnl.item_id::text),
         unit_of_measure_snapshot = coalesce(
           sdnl.unit_of_measure_snapshot,
           sil.unit_of_measure_snapshot,
           nullif(i.base_uom_id::text, '')
         ),
         tax_category_code = coalesce(
           sdnl.tax_category_code,
           sil.tax_category_code,
           case when coalesce(sdnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from public.sales_invoice_lines sil
    left join public.items i
      on i.id = sdnl.item_id
   where sdnl.sales_debit_note_id = new.id
     and sil.id is not distinct from sdnl.sales_invoice_line_id;

  update public.sales_debit_note_lines sdnl
     set product_code_snapshot = coalesce(sdnl.product_code_snapshot, sdnl.item_id::text, 'ITEM'),
         unit_of_measure_snapshot = coalesce(sdnl.unit_of_measure_snapshot, 'UN'),
         tax_category_code = coalesce(
           sdnl.tax_category_code,
           case when coalesce(sdnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
   where sdnl.sales_debit_note_id = new.id
     and (sdnl.product_code_snapshot is null
       or sdnl.unit_of_measure_snapshot is null
       or sdnl.tax_category_code is null);

  return new;
end;
$$;

create or replace function public.sales_credit_note_validate_issue_mz()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_line_count integer;
  v_invoice public.sales_invoices%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
  v_invalid_source_line_count integer;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception using
      message = 'Credit notes require an original issued sales invoice.';
  end if;

  if v_invoice.document_workflow_status <> 'issued' then
    raise exception using
      message = 'Credit notes can only be issued against an issued sales invoice.';
  end if;

  if v_invoice.company_id <> new.company_id then
    raise exception using
      message = 'Credit note company must match the original sales invoice company.';
  end if;

  if coalesce(new.customer_id, v_invoice.customer_id) is distinct from v_invoice.customer_id then
    raise exception using
      message = 'Credit note customer must match the original sales invoice customer.';
  end if;

  if nullif(btrim(coalesce(new.correction_reason_text, '')), '') is null then
    raise exception using
      message = 'Credit notes require a correction reason.';
  end if;

  if new.credit_note_date is null then
    raise exception using
      message = 'Credit notes require a note date before issue.';
  end if;

  if new.credit_note_date < v_invoice.invoice_date then
    raise exception using
      message = 'Credit note date cannot be earlier than the original sales invoice date.';
  end if;

  if new.currency_code is distinct from v_invoice.currency_code then
    raise exception using
      message = 'Credit note currency must match the original sales invoice currency.';
  end if;

  if coalesce(new.fx_to_base, 0) <= 0 then
    raise exception using
      message = 'Credit notes require a positive FX rate.';
  end if;

  if new.source_origin = 'native'
     and (
       new.fiscal_series_code is null
       or new.fiscal_year is null
       or new.fiscal_sequence_number is null
     ) then
    raise exception using
      message = 'Credit notes require fiscal series, year, and sequence before issue.';
  end if;

  if new.source_origin = 'native' then
    select *
      into v_series
    from public.resolve_fiscal_series(new.company_id, 'sales_credit_note', new.credit_note_date);

    if v_series.series_code is distinct from new.fiscal_series_code
       or v_series.fiscal_year is distinct from new.fiscal_year then
      raise exception using
        message = 'Credit note fiscal series metadata does not match the active company series.';
    end if;
  end if;

  if nullif(btrim(coalesce(new.seller_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_nuit_snapshot, '')), '') is null then
    raise exception using
      message = 'Credit notes require seller and buyer fiscal snapshots before issue.';
  end if;

  if nullif(btrim(coalesce(new.document_language_code_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.computer_processed_phrase_snapshot, '')), '') is null then
    raise exception using
      message = 'Credit notes require document language and computer-processing wording before issue.';
  end if;

  if coalesce(new.subtotal, 0) < 0
     or coalesce(new.tax_total, 0) < 0
     or coalesce(new.total_amount, 0) < 0
     or coalesce(new.subtotal_mzn, 0) < 0
     or coalesce(new.tax_total_mzn, 0) < 0
     or coalesce(new.total_amount_mzn, 0) < 0 then
    raise exception using
      message = 'Credit notes require non-negative totals.';
  end if;

  select count(*)
    into v_line_count
  from public.sales_credit_note_lines scnl
  where scnl.sales_credit_note_id = new.id;

  if coalesce(v_line_count, 0) <= 0 then
    raise exception using
      message = 'Credit notes require at least one line before issue.';
  end if;

  select count(*)
    into v_invalid_source_line_count
  from public.sales_credit_note_lines scnl
  join public.sales_invoice_lines sil
    on sil.id = scnl.sales_invoice_line_id
  where scnl.sales_credit_note_id = new.id
    and sil.sales_invoice_id is distinct from new.original_sales_invoice_id;

  if coalesce(v_invalid_source_line_count, 0) > 0 then
    raise exception using
      message = 'Credit notes cannot issue with source-linked lines from a different original sales invoice.';
  end if;

  return new;
end;
$$;

create or replace function public.sales_debit_note_validate_issue_mz()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_line_count integer;
  v_invoice public.sales_invoices%rowtype;
  v_series public.finance_document_fiscal_series%rowtype;
  v_invalid_source_line_count integer;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select si.*
    into v_invoice
  from public.sales_invoices si
  where si.id = new.original_sales_invoice_id;

  if v_invoice.id is null then
    raise exception using
      message = 'Debit notes require an original issued sales invoice.';
  end if;

  if v_invoice.document_workflow_status <> 'issued' then
    raise exception using
      message = 'Debit notes can only be issued against an issued sales invoice.';
  end if;

  if v_invoice.company_id <> new.company_id then
    raise exception using
      message = 'Debit note company must match the original sales invoice company.';
  end if;

  if coalesce(new.customer_id, v_invoice.customer_id) is distinct from v_invoice.customer_id then
    raise exception using
      message = 'Debit note customer must match the original sales invoice customer.';
  end if;

  if nullif(btrim(coalesce(new.correction_reason_text, '')), '') is null then
    raise exception using
      message = 'Debit notes require a correction reason.';
  end if;

  if new.debit_note_date is null then
    raise exception using
      message = 'Debit notes require a note date before issue.';
  end if;

  if new.debit_note_date < v_invoice.invoice_date then
    raise exception using
      message = 'Debit note date cannot be earlier than the original sales invoice date.';
  end if;

  if new.due_date is null or new.due_date < new.debit_note_date then
    raise exception using
      message = 'Debit notes require a due date on or after the debit note date.';
  end if;

  if new.currency_code is distinct from v_invoice.currency_code then
    raise exception using
      message = 'Debit note currency must match the original sales invoice currency.';
  end if;

  if coalesce(new.fx_to_base, 0) <= 0 then
    raise exception using
      message = 'Debit notes require a positive FX rate.';
  end if;

  if new.source_origin = 'native'
     and (
       new.fiscal_series_code is null
       or new.fiscal_year is null
       or new.fiscal_sequence_number is null
     ) then
    raise exception using
      message = 'Debit notes require fiscal series, year, and sequence before issue.';
  end if;

  if new.source_origin = 'native' then
    select *
      into v_series
    from public.resolve_fiscal_series(new.company_id, 'sales_debit_note', new.debit_note_date);

    if v_series.series_code is distinct from new.fiscal_series_code
       or v_series.fiscal_year is distinct from new.fiscal_year then
      raise exception using
        message = 'Debit note fiscal series metadata does not match the active company series.';
    end if;
  end if;

  if nullif(btrim(coalesce(new.seller_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.seller_nuit_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_legal_name_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.buyer_nuit_snapshot, '')), '') is null then
    raise exception using
      message = 'Debit notes require seller and buyer fiscal snapshots before issue.';
  end if;

  if nullif(btrim(coalesce(new.document_language_code_snapshot, '')), '') is null
     or nullif(btrim(coalesce(new.computer_processed_phrase_snapshot, '')), '') is null then
    raise exception using
      message = 'Debit notes require document language and computer-processing wording before issue.';
  end if;

  if coalesce(new.subtotal, 0) < 0
     or coalesce(new.tax_total, 0) < 0
     or coalesce(new.total_amount, 0) < 0
     or coalesce(new.subtotal_mzn, 0) < 0
     or coalesce(new.tax_total_mzn, 0) < 0
     or coalesce(new.total_amount_mzn, 0) < 0 then
    raise exception using
      message = 'Debit notes require non-negative totals.';
  end if;

  select count(*)
    into v_line_count
  from public.sales_debit_note_lines sdnl
  where sdnl.sales_debit_note_id = new.id;

  if coalesce(v_line_count, 0) <= 0 then
    raise exception using
      message = 'Debit notes require at least one line before issue.';
  end if;

  select count(*)
    into v_invalid_source_line_count
  from public.sales_debit_note_lines sdnl
  join public.sales_invoice_lines sil
    on sil.id = sdnl.sales_invoice_line_id
  where sdnl.sales_debit_note_id = new.id
    and sil.sales_invoice_id is distinct from new.original_sales_invoice_id;

  if coalesce(v_invalid_source_line_count, 0) > 0 then
    raise exception using
      message = 'Debit notes cannot issue with source-linked lines from a different original sales invoice.';
  end if;

  return new;
end;
$$;

create or replace function public.sales_credit_note_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and new.original_sales_invoice_id is distinct from old.original_sales_invoice_id
     and exists (
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
    if old.document_workflow_status = 'draft'
       and new.document_workflow_status in ('issued', 'voided') then
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
     and row(
       old.company_id,
       old.original_sales_invoice_id,
       old.customer_id,
       old.internal_reference,
       old.source_origin,
       old.moz_document_code,
       old.fiscal_series_code,
       old.fiscal_year,
       old.fiscal_sequence_number,
       old.credit_note_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.subtotal_mzn,
       old.tax_total_mzn,
       old.total_amount_mzn,
       old.correction_reason_code,
       old.correction_reason_text,
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
       new.original_sales_invoice_id,
       new.customer_id,
       new.internal_reference,
       new.source_origin,
       new.moz_document_code,
       new.fiscal_series_code,
       new.fiscal_year,
       new.fiscal_sequence_number,
       new.credit_note_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.subtotal_mzn,
       new.tax_total_mzn,
       new.total_amount_mzn,
       new.correction_reason_code,
       new.correction_reason_text,
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
      message = 'Issued or voided credit notes cannot change linkage, references, fiscal snapshots, dates, currency, FX, totals, or correction reasons.';
  end if;

  return new;
end;
$$;

create or replace function public.sales_debit_note_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
     and new.original_sales_invoice_id is distinct from old.original_sales_invoice_id
     and exists (
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
    if old.document_workflow_status = 'draft'
       and new.document_workflow_status in ('issued', 'voided') then
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
     and row(
       old.company_id,
       old.original_sales_invoice_id,
       old.customer_id,
       old.internal_reference,
       old.source_origin,
       old.moz_document_code,
       old.fiscal_series_code,
       old.fiscal_year,
       old.fiscal_sequence_number,
       old.debit_note_date,
       old.due_date,
       old.currency_code,
       old.fx_to_base,
       old.subtotal,
       old.tax_total,
       old.total_amount,
       old.subtotal_mzn,
       old.tax_total_mzn,
       old.total_amount_mzn,
       old.correction_reason_code,
       old.correction_reason_text,
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
       new.original_sales_invoice_id,
       new.customer_id,
       new.internal_reference,
       new.source_origin,
       new.moz_document_code,
       new.fiscal_series_code,
       new.fiscal_year,
       new.fiscal_sequence_number,
       new.debit_note_date,
       new.due_date,
       new.currency_code,
       new.fx_to_base,
       new.subtotal,
       new.tax_total,
       new.total_amount,
       new.subtotal_mzn,
       new.tax_total_mzn,
       new.total_amount_mzn,
       new.correction_reason_code,
       new.correction_reason_text,
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
      message = 'Issued or voided debit notes cannot change linkage, references, fiscal snapshots, dates, currency, FX, totals, or correction reasons.';
  end if;

  return new;
end;
$$;

create or replace function public.sales_note_lines_parent_issue_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_note_id uuid;
  v_status text;
begin
  if tg_table_name = 'sales_credit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.sales_credit_note_id;
    else
      v_note_id := new.sales_credit_note_id;
    end if;
    select scn.document_workflow_status
      into v_status
    from public.sales_credit_notes scn
    where scn.id = v_note_id;
  elsif tg_table_name = 'sales_debit_note_lines' then
    if tg_op = 'DELETE' then
      v_note_id := old.sales_debit_note_id;
    else
      v_note_id := new.sales_debit_note_id;
    end if;
    select sdn.document_workflow_status
      into v_status
    from public.sales_debit_notes sdn
    where sdn.id = v_note_id;
  else
    raise exception using
      message = format('sales_note_lines_parent_issue_guard does not support table %s.', tg_table_name);
  end if;

  if v_status in ('issued', 'voided') then
    raise exception using
      message = 'Issued or voided sales notes cannot change line items.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.issue_sales_credit_note_mz(p_note_id uuid)
returns public.sales_credit_notes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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

  if not public.finance_documents_can_write(v_note.company_id) then
    raise exception using
      message = 'Sales credit note issue access denied.';
  end if;

  update public.sales_credit_notes scn
     set document_workflow_status = 'issued'
   where scn.id = p_note_id
  returning scn.* into v_note;

  return v_note;
end;
$$;

create or replace function public.issue_sales_debit_note_mz(p_note_id uuid)
returns public.sales_debit_notes
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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

  if not public.finance_documents_can_write(v_note.company_id) then
    raise exception using
      message = 'Sales debit note issue access denied.';
  end if;

  update public.sales_debit_notes sdn
     set document_workflow_status = 'issued'
   where sdn.id = p_note_id
  returning sdn.* into v_note;

  return v_note;
end;
$$;

drop trigger if exists biu_10_sales_credit_note_assign_reference on public.sales_credit_notes;
create trigger biu_10_sales_credit_note_assign_reference
before insert or update on public.sales_credit_notes
for each row execute function public.sales_credit_note_assign_reference();

drop trigger if exists biu_20_sales_credit_note_snapshot_fiscal_fields on public.sales_credit_notes;
create trigger biu_20_sales_credit_note_snapshot_fiscal_fields
before update on public.sales_credit_notes
for each row execute function public.sales_credit_note_snapshot_fiscal_fields();

drop trigger if exists biu_30_sales_credit_note_validate_issue_mz on public.sales_credit_notes;
create trigger biu_30_sales_credit_note_validate_issue_mz
before update on public.sales_credit_notes
for each row execute function public.sales_credit_note_validate_issue_mz();

drop trigger if exists biu_40_sales_credit_note_hardening on public.sales_credit_notes;
create trigger biu_40_sales_credit_note_hardening
before insert or update on public.sales_credit_notes
for each row execute function public.sales_credit_note_hardening_guard();

drop trigger if exists bu_90_sales_credit_note_touch_updated_at on public.sales_credit_notes;
create trigger bu_90_sales_credit_note_touch_updated_at
before update on public.sales_credit_notes
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists biu_10_sales_credit_note_lines_company_guard on public.sales_credit_note_lines;
create trigger biu_10_sales_credit_note_lines_company_guard
before insert or update on public.sales_credit_note_lines
for each row execute function public.finance_note_line_company_guard();

drop trigger if exists biu_20_sales_credit_note_lines_hardening on public.sales_credit_note_lines;
create trigger biu_20_sales_credit_note_lines_hardening
before insert or update on public.sales_credit_note_lines
for each row execute function public.sales_invoice_line_hardening_guard();

drop trigger if exists biu_30_sales_credit_note_lines_parent_issue_guard on public.sales_credit_note_lines;
create trigger biu_30_sales_credit_note_lines_parent_issue_guard
before insert or update on public.sales_credit_note_lines
for each row execute function public.sales_note_lines_parent_issue_guard();

drop trigger if exists bd_30_sales_credit_note_lines_parent_issue_guard on public.sales_credit_note_lines;
create trigger bd_30_sales_credit_note_lines_parent_issue_guard
before delete on public.sales_credit_note_lines
for each row execute function public.sales_note_lines_parent_issue_guard();

drop trigger if exists bu_90_sales_credit_note_lines_touch_updated_at on public.sales_credit_note_lines;
create trigger bu_90_sales_credit_note_lines_touch_updated_at
before update on public.sales_credit_note_lines
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists biu_10_sales_debit_note_assign_reference on public.sales_debit_notes;
create trigger biu_10_sales_debit_note_assign_reference
before insert or update on public.sales_debit_notes
for each row execute function public.sales_debit_note_assign_reference();

drop trigger if exists biu_20_sales_debit_note_snapshot_fiscal_fields on public.sales_debit_notes;
create trigger biu_20_sales_debit_note_snapshot_fiscal_fields
before update on public.sales_debit_notes
for each row execute function public.sales_debit_note_snapshot_fiscal_fields();

drop trigger if exists biu_30_sales_debit_note_validate_issue_mz on public.sales_debit_notes;
create trigger biu_30_sales_debit_note_validate_issue_mz
before update on public.sales_debit_notes
for each row execute function public.sales_debit_note_validate_issue_mz();

drop trigger if exists biu_40_sales_debit_note_hardening on public.sales_debit_notes;
create trigger biu_40_sales_debit_note_hardening
before insert or update on public.sales_debit_notes
for each row execute function public.sales_debit_note_hardening_guard();

drop trigger if exists bu_90_sales_debit_note_touch_updated_at on public.sales_debit_notes;
create trigger bu_90_sales_debit_note_touch_updated_at
before update on public.sales_debit_notes
for each row execute function public.finance_documents_touch_updated_at();

drop trigger if exists biu_10_sales_debit_note_lines_company_guard on public.sales_debit_note_lines;
create trigger biu_10_sales_debit_note_lines_company_guard
before insert or update on public.sales_debit_note_lines
for each row execute function public.finance_note_line_company_guard();

drop trigger if exists biu_20_sales_debit_note_lines_hardening on public.sales_debit_note_lines;
create trigger biu_20_sales_debit_note_lines_hardening
before insert or update on public.sales_debit_note_lines
for each row execute function public.sales_invoice_line_hardening_guard();

drop trigger if exists biu_30_sales_debit_note_lines_parent_issue_guard on public.sales_debit_note_lines;
create trigger biu_30_sales_debit_note_lines_parent_issue_guard
before insert or update on public.sales_debit_note_lines
for each row execute function public.sales_note_lines_parent_issue_guard();

drop trigger if exists bd_30_sales_debit_note_lines_parent_issue_guard on public.sales_debit_note_lines;
create trigger bd_30_sales_debit_note_lines_parent_issue_guard
before delete on public.sales_debit_note_lines
for each row execute function public.sales_note_lines_parent_issue_guard();

drop trigger if exists bu_90_sales_debit_note_lines_touch_updated_at on public.sales_debit_note_lines;
create trigger bu_90_sales_debit_note_lines_touch_updated_at
before update on public.sales_debit_note_lines
for each row execute function public.finance_documents_touch_updated_at();

alter table public.sales_credit_notes enable row level security;
alter table public.sales_credit_note_lines enable row level security;
alter table public.sales_debit_notes enable row level security;
alter table public.sales_debit_note_lines enable row level security;

drop policy if exists sales_credit_notes_select on public.sales_credit_notes;
create policy sales_credit_notes_select
on public.sales_credit_notes
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists sales_credit_notes_insert on public.sales_credit_notes;
create policy sales_credit_notes_insert
on public.sales_credit_notes
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_credit_notes_update on public.sales_credit_notes;
create policy sales_credit_notes_update
on public.sales_credit_notes
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_credit_note_lines_select on public.sales_credit_note_lines;
create policy sales_credit_note_lines_select
on public.sales_credit_note_lines
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists sales_credit_note_lines_insert on public.sales_credit_note_lines;
create policy sales_credit_note_lines_insert
on public.sales_credit_note_lines
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_credit_note_lines_update on public.sales_credit_note_lines;
create policy sales_credit_note_lines_update
on public.sales_credit_note_lines
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_debit_notes_select on public.sales_debit_notes;
create policy sales_debit_notes_select
on public.sales_debit_notes
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists sales_debit_notes_insert on public.sales_debit_notes;
create policy sales_debit_notes_insert
on public.sales_debit_notes
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_debit_notes_update on public.sales_debit_notes;
create policy sales_debit_notes_update
on public.sales_debit_notes
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_debit_note_lines_select on public.sales_debit_note_lines;
create policy sales_debit_note_lines_select
on public.sales_debit_note_lines
for select
to authenticated
using (public.finance_documents_can_read(company_id));

drop policy if exists sales_debit_note_lines_insert on public.sales_debit_note_lines;
create policy sales_debit_note_lines_insert
on public.sales_debit_note_lines
for insert
to authenticated
with check (public.finance_documents_can_write(company_id));

drop policy if exists sales_debit_note_lines_update on public.sales_debit_note_lines;
create policy sales_debit_note_lines_update
on public.sales_debit_note_lines
for update
to authenticated
using (public.finance_documents_can_write(company_id))
with check (public.finance_documents_can_write(company_id));

revoke all on public.sales_credit_notes from public, anon;
revoke all on public.sales_credit_note_lines from public, anon;
revoke all on public.sales_debit_notes from public, anon;
revoke all on public.sales_debit_note_lines from public, anon;

grant select, insert, update on public.sales_credit_notes to authenticated;
grant select, insert, update on public.sales_credit_note_lines to authenticated;
grant select, insert, update on public.sales_debit_notes to authenticated;
grant select, insert, update on public.sales_debit_note_lines to authenticated;

comment on table public.sales_credit_notes is
  'Mozambique-compliant sales credit notes linked to the original issued sales invoice.';

comment on table public.sales_debit_notes is
  'Mozambique-compliant sales debit notes linked to the original issued sales invoice.';

comment on function public.sales_credit_note_validate_issue_mz() is
  'Validates Mozambique issue-time requirements for sales credit notes, including original invoice linkage and fiscal snapshots.';

comment on function public.sales_debit_note_validate_issue_mz() is
  'Validates Mozambique issue-time requirements for sales debit notes, including original invoice linkage and fiscal snapshots.';

comment on function public.sales_note_lines_parent_issue_guard() is
  'Blocks insert, update, and delete on sales credit/debit note lines once the parent note is issued or voided.';

revoke all on function public.issue_sales_credit_note_mz(uuid) from public, anon;
revoke all on function public.issue_sales_debit_note_mz(uuid) from public, anon;
grant execute on function public.issue_sales_credit_note_mz(uuid) to authenticated;
grant execute on function public.issue_sales_debit_note_mz(uuid) to authenticated;
