alter table public.sales_invoices
  add column if not exists source_origin text not null default 'native'
    check (source_origin in ('native', 'imported')),
  add column if not exists moz_document_code text not null default 'INV',
  add column if not exists fiscal_series_code text null,
  add column if not exists fiscal_year integer null,
  add column if not exists fiscal_sequence_number integer null,
  add column if not exists seller_legal_name_snapshot text null,
  add column if not exists seller_trade_name_snapshot text null,
  add column if not exists seller_nuit_snapshot text null,
  add column if not exists seller_address_line1_snapshot text null,
  add column if not exists seller_address_line2_snapshot text null,
  add column if not exists seller_city_snapshot text null,
  add column if not exists seller_state_snapshot text null,
  add column if not exists seller_postal_code_snapshot text null,
  add column if not exists seller_country_code_snapshot text null,
  add column if not exists buyer_legal_name_snapshot text null,
  add column if not exists buyer_nuit_snapshot text null,
  add column if not exists buyer_address_line1_snapshot text null,
  add column if not exists buyer_address_line2_snapshot text null,
  add column if not exists buyer_city_snapshot text null,
  add column if not exists buyer_state_snapshot text null,
  add column if not exists buyer_postal_code_snapshot text null,
  add column if not exists buyer_country_code_snapshot text null,
  add column if not exists document_language_code_snapshot text null,
  add column if not exists computer_processed_phrase_snapshot text null,
  add column if not exists subtotal_mzn numeric not null default 0,
  add column if not exists tax_total_mzn numeric not null default 0,
  add column if not exists total_amount_mzn numeric not null default 0,
  add column if not exists compliance_rule_version_snapshot text null;

alter table public.sales_invoice_lines
  add column if not exists product_code_snapshot text null,
  add column if not exists unit_of_measure_snapshot text null,
  add column if not exists tax_category_code text null;

do $$
declare
  v_matches integer;
  v_constraint_name text;
begin
  select count(*), min(c.conname)
    into v_matches, v_constraint_name
  from pg_constraint c
  where c.conrelid = 'public.sales_invoices'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%internal_reference%'
    and pg_get_constraintdef(c.oid) like '%INV[0-9]{5}%';

  if v_matches > 1 then
    raise exception 'sales_invoice_reference_constraint_ambiguous';
  end if;

  if v_matches = 1 then
    execute format(
      'alter table public.sales_invoices drop constraint %I',
      v_constraint_name
    );
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.sales_invoices'::regclass
      and c.conname = 'sales_invoices_internal_reference_format'
  ) then
    alter table public.sales_invoices
      add constraint sales_invoices_internal_reference_format
      check (
        (
          source_origin = 'native'
          and internal_reference ~ '^[A-Z0-9]{3}-[A-Z0-9]{2,10}[0-9]{4}-[0-9]{5}$'
        )
        or (
          source_origin = 'imported'
          and nullif(btrim(coalesce(internal_reference, '')), '') is not null
        )
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_invoices'::regclass
      and conname = 'sales_invoices_mzn_totals_nonnegative'
  ) then
    alter table public.sales_invoices
      add constraint sales_invoices_mzn_totals_nonnegative
      check (
        subtotal_mzn >= 0
        and tax_total_mzn >= 0
        and total_amount_mzn >= 0
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_invoices'::regclass
      and conname = 'sales_invoices_fiscal_sequence_number_check'
  ) then
    alter table public.sales_invoices
      add constraint sales_invoices_fiscal_sequence_number_check
      check (fiscal_sequence_number is null or fiscal_sequence_number >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_invoices'::regclass
      and conname = 'sales_invoices_fiscal_year_check'
  ) then
    alter table public.sales_invoices
      add constraint sales_invoices_fiscal_year_check
      check (fiscal_year is null or fiscal_year between 2000 and 9999);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_invoices'::regclass
      and conname = 'sales_invoices_moz_document_code_check'
  ) then
    alter table public.sales_invoices
      add constraint sales_invoices_moz_document_code_check
      check (moz_document_code = 'INV');
  end if;
end;
$$;

drop index if exists public.sales_invoices_company_native_sequence_key;
create unique index sales_invoices_company_native_sequence_key
  on public.sales_invoices (company_id, moz_document_code, fiscal_series_code, fiscal_year, fiscal_sequence_number)
  where source_origin = 'native';

create index if not exists sales_invoices_company_fiscal_lookup_idx
  on public.sales_invoices (company_id, fiscal_year, fiscal_series_code, fiscal_sequence_number);

create or replace function public.sales_invoice_assign_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_reference record;
begin
  if tg_op = 'UPDATE' and new.internal_reference is distinct from old.internal_reference then
    raise exception 'sales_invoice_internal_reference_immutable';
  end if;

  if new.source_origin not in ('native', 'imported') then
    raise exception 'sales_invoice_source_origin_invalid';
  end if;

  new.moz_document_code := 'INV';

  if new.source_origin = 'imported' then
    if nullif(btrim(coalesce(new.internal_reference, '')), '') is null then
      raise exception 'imported_sales_invoice_reference_required';
    end if;
    new.internal_reference := btrim(new.internal_reference);
    if new.fiscal_year is null then
      new.fiscal_year := extract(year from coalesce(new.invoice_date, current_date))::integer;
    end if;
  elsif new.internal_reference is null or btrim(new.internal_reference) = '' then
    select *
      into v_reference
    from public.next_fiscal_document_reference(
      new.company_id,
      'sales_invoice',
      coalesce(new.invoice_date, current_date),
      new.source_origin,
      null
    );

    new.internal_reference := v_reference.internal_reference;
    new.fiscal_series_code := v_reference.fiscal_series_code;
    new.fiscal_year := v_reference.fiscal_year;
    new.fiscal_sequence_number := v_reference.fiscal_sequence_number;
  end if;

  if new.document_workflow_status = 'issued' then
    if new.due_date is null then
      raise exception 'sales_invoice_due_date_required_for_issue';
    end if;
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

create or replace function public.sales_invoice_snapshot_fiscal_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_company public.companies%rowtype;
  v_customer record;
  v_order record;
  v_settings public.company_fiscal_settings%rowtype;
begin
  if tg_op <> 'UPDATE'
     or new.document_workflow_status <> 'issued'
     or coalesce(old.document_workflow_status, 'draft') = 'issued' then
    return new;
  end if;

  select c.*
    into v_company
  from public.companies c
  where c.id = new.company_id;

  if v_company.id is null then
    raise exception 'sales_invoice_company_not_found';
  end if;

  select cfs.*
    into v_settings
  from public.company_fiscal_settings cfs
  where cfs.company_id = new.company_id;

  if v_settings.company_id is null then
    raise exception 'company_fiscal_settings_missing';
  end if;

  if new.customer_id is not null then
    select
      c.name,
      c.tax_id,
      c.billing_address,
      c.shipping_address
      into v_customer
    from public.customers c
    where c.id = new.customer_id;
  end if;

  if new.sales_order_id is not null then
    select
      so.bill_to_name,
      so.bill_to_tax_id,
      so.bill_to_billing_address,
      so.bill_to_shipping_address
      into v_order
    from public.sales_orders so
    where so.id = new.sales_order_id;
  end if;

  new.seller_legal_name_snapshot := coalesce(
    nullif(new.seller_legal_name_snapshot, ''),
    nullif(v_company.legal_name, ''),
    nullif(v_company.trade_name, ''),
    nullif(v_company.name, '')
  );
  new.seller_trade_name_snapshot := coalesce(
    nullif(new.seller_trade_name_snapshot, ''),
    nullif(v_company.trade_name, ''),
    nullif(v_company.name, '')
  );
  new.seller_nuit_snapshot := coalesce(
    nullif(new.seller_nuit_snapshot, ''),
    nullif(v_company.tax_id, '')
  );
  new.seller_address_line1_snapshot := coalesce(
    nullif(new.seller_address_line1_snapshot, ''),
    nullif(v_company.address_line1, '')
  );
  new.seller_address_line2_snapshot := coalesce(
    nullif(new.seller_address_line2_snapshot, ''),
    nullif(v_company.address_line2, '')
  );
  new.seller_city_snapshot := coalesce(
    nullif(new.seller_city_snapshot, ''),
    nullif(v_company.city, '')
  );
  new.seller_state_snapshot := coalesce(
    nullif(new.seller_state_snapshot, ''),
    nullif(v_company.state, '')
  );
  new.seller_postal_code_snapshot := coalesce(
    nullif(new.seller_postal_code_snapshot, ''),
    nullif(v_company.postal_code, '')
  );
  new.seller_country_code_snapshot := coalesce(
    nullif(new.seller_country_code_snapshot, ''),
    nullif(v_company.country_code, '')
  );

  new.buyer_legal_name_snapshot := coalesce(
    nullif(new.buyer_legal_name_snapshot, ''),
    nullif(v_order.bill_to_name, ''),
    nullif(v_customer.name, '')
  );
  new.buyer_nuit_snapshot := coalesce(
    nullif(new.buyer_nuit_snapshot, ''),
    nullif(v_order.bill_to_tax_id, ''),
    nullif(v_customer.tax_id, '')
  );
  new.buyer_address_line1_snapshot := coalesce(
    nullif(new.buyer_address_line1_snapshot, ''),
    nullif(v_order.bill_to_billing_address, ''),
    nullif(v_customer.billing_address, '')
  );
  new.buyer_address_line2_snapshot := coalesce(
    nullif(new.buyer_address_line2_snapshot, ''),
    nullif(v_order.bill_to_shipping_address, ''),
    nullif(v_customer.shipping_address, '')
  );
  new.buyer_country_code_snapshot := coalesce(
    nullif(new.buyer_country_code_snapshot, ''),
    nullif(v_company.country_code, '')
  );
  new.document_language_code_snapshot := coalesce(
    nullif(new.document_language_code_snapshot, ''),
    v_settings.document_language_code
  );
  new.computer_processed_phrase_snapshot := coalesce(
    nullif(new.computer_processed_phrase_snapshot, ''),
    v_settings.computer_processed_phrase_text
  );
  new.compliance_rule_version_snapshot := coalesce(
    nullif(new.compliance_rule_version_snapshot, ''),
    v_settings.compliance_rule_version
  );
  new.subtotal_mzn := round(coalesce(new.subtotal, 0) * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_mzn := round(coalesce(new.tax_total, 0) * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_mzn := round(coalesce(new.total_amount, 0) * coalesce(new.fx_to_base, 1), 2);

  update public.sales_invoice_lines sil
     set product_code_snapshot = coalesce(sil.product_code_snapshot, nullif(i.sku, ''), sil.item_id::text),
         unit_of_measure_snapshot = coalesce(
           sil.unit_of_measure_snapshot,
           nullif(sol.uom_id::text, ''),
           nullif(i.base_uom_id::text, '')
         ),
         tax_category_code = coalesce(
           sil.tax_category_code,
           case when coalesce(sil.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from public.items i
    left join public.sales_order_lines sol
      on sol.id = sil.sales_order_line_id
   where sil.sales_invoice_id = new.id
     and i.id is not distinct from sil.item_id;

  update public.sales_invoice_lines sil
     set product_code_snapshot = coalesce(sil.product_code_snapshot, sil.item_id::text, 'ITEM'),
         unit_of_measure_snapshot = coalesce(sil.unit_of_measure_snapshot, 'UN'),
         tax_category_code = coalesce(
           sil.tax_category_code,
           case when coalesce(sil.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
   where sil.sales_invoice_id = new.id
     and (sil.product_code_snapshot is null
       or sil.unit_of_measure_snapshot is null
       or sil.tax_category_code is null);

  return new;
end;
$$;

drop trigger if exists sales_invoices_assign_reference on public.sales_invoices;
drop trigger if exists biu_10_sales_invoice_assign_reference on public.sales_invoices;
create trigger biu_10_sales_invoice_assign_reference
before insert or update on public.sales_invoices
for each row execute function public.sales_invoice_assign_reference();

drop trigger if exists biu_20_sales_invoice_snapshot_fiscal_fields on public.sales_invoices;
create trigger biu_20_sales_invoice_snapshot_fiscal_fields
before update on public.sales_invoices
for each row execute function public.sales_invoice_snapshot_fiscal_fields();

comment on column public.sales_invoices.internal_reference is
  'Visible legal fiscal reference for Mozambique sales invoices. Internal joins and workflow logic must continue to use stable ids and fiscal metadata fields, not the text shape.';

comment on function public.sales_invoice_assign_reference() is
  'Assigns the legal visible invoice reference for Mozambique sales invoices without making business logic depend on parsing that text.';

comment on function public.sales_invoice_snapshot_fiscal_fields() is
  'Snapshots seller, buyer, line export context, and MZN totals at issue time so issued invoices no longer depend on mutable master data.';
