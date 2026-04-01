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
     set product_code_snapshot = coalesce(
           sil.product_code_snapshot,
           src.item_sku,
           src.item_id_text
         ),
         unit_of_measure_snapshot = coalesce(
           sil.unit_of_measure_snapshot,
           src.sales_order_line_uom_id_text,
           src.item_base_uom_id_text
         ),
         tax_category_code = coalesce(
           sil.tax_category_code,
           case when coalesce(sil.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from (
      select
        sil2.id as sales_invoice_line_id,
        nullif(i.sku, '') as item_sku,
        sil2.item_id::text as item_id_text,
        nullif(sol.uom_id::text, '') as sales_order_line_uom_id_text,
        nullif(i.base_uom_id::text, '') as item_base_uom_id_text
      from public.sales_invoice_lines sil2
      left join public.items i
        on i.id is not distinct from sil2.item_id
      left join public.sales_order_lines sol
        on sol.id is not distinct from sil2.sales_order_line_id
      where sil2.sales_invoice_id = new.id
    ) src
   where sil.id = src.sales_invoice_line_id;

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
     set product_code_snapshot = coalesce(
           scnl.product_code_snapshot,
           src.invoice_product_code_snapshot,
           src.item_sku,
           src.item_id_text
         ),
         unit_of_measure_snapshot = coalesce(
           scnl.unit_of_measure_snapshot,
           src.invoice_unit_of_measure_snapshot,
           src.item_base_uom_id_text
         ),
         tax_category_code = coalesce(
           scnl.tax_category_code,
           src.invoice_tax_category_code,
           case when coalesce(scnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from (
      select
        scnl2.id as sales_credit_note_line_id,
        sil.product_code_snapshot as invoice_product_code_snapshot,
        sil.unit_of_measure_snapshot as invoice_unit_of_measure_snapshot,
        sil.tax_category_code as invoice_tax_category_code,
        nullif(i.sku, '') as item_sku,
        scnl2.item_id::text as item_id_text,
        nullif(i.base_uom_id::text, '') as item_base_uom_id_text
      from public.sales_credit_note_lines scnl2
      left join public.sales_invoice_lines sil
        on sil.id is not distinct from scnl2.sales_invoice_line_id
      left join public.items i
        on i.id is not distinct from scnl2.item_id
      where scnl2.sales_credit_note_id = new.id
    ) src
   where scnl.id = src.sales_credit_note_line_id;

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
     set product_code_snapshot = coalesce(
           sdnl.product_code_snapshot,
           src.invoice_product_code_snapshot,
           src.item_sku,
           src.item_id_text
         ),
         unit_of_measure_snapshot = coalesce(
           sdnl.unit_of_measure_snapshot,
           src.invoice_unit_of_measure_snapshot,
           src.item_base_uom_id_text
         ),
         tax_category_code = coalesce(
           sdnl.tax_category_code,
           src.invoice_tax_category_code,
           case when coalesce(sdnl.tax_rate, 0) = 0 then 'ISENTO' else 'IVA' end
         ),
         updated_at = now()
    from (
      select
        sdnl2.id as sales_debit_note_line_id,
        sil.product_code_snapshot as invoice_product_code_snapshot,
        sil.unit_of_measure_snapshot as invoice_unit_of_measure_snapshot,
        sil.tax_category_code as invoice_tax_category_code,
        nullif(i.sku, '') as item_sku,
        sdnl2.item_id::text as item_id_text,
        nullif(i.base_uom_id::text, '') as item_base_uom_id_text
      from public.sales_debit_note_lines sdnl2
      left join public.sales_invoice_lines sil
        on sil.id is not distinct from sdnl2.sales_invoice_line_id
      left join public.items i
        on i.id is not distinct from sdnl2.item_id
      where sdnl2.sales_debit_note_id = new.id
    ) src
   where sdnl.id = src.sales_debit_note_line_id;

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

comment on function public.sales_invoice_snapshot_fiscal_fields() is
  'Patches line snapshot updates for invoice issue so target-table aliases are not referenced illegally inside FROM-clause joins.';

comment on function public.sales_credit_note_snapshot_fiscal_fields() is
  'Patches line snapshot updates for credit note issue so target-table aliases are not referenced illegally inside FROM-clause joins.';

comment on function public.sales_debit_note_snapshot_fiscal_fields() is
  'Patches line snapshot updates for debit note issue so target-table aliases are not referenced illegally inside FROM-clause joins.';
