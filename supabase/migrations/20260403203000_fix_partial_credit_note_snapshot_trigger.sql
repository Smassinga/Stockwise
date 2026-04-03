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
  new.vat_exemption_reason_text := coalesce(
    nullif(btrim(coalesce(new.vat_exemption_reason_text, '')), ''),
    nullif(btrim(coalesce(v_invoice.vat_exemption_reason_text, '')), ''),
    null
  );

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

comment on function public.sales_credit_note_snapshot_fiscal_fields() is
  'Fixes the partial-credit migration regression so credit-note issue snapshots do not reference target-table aliases illegally inside FROM-clause joins.';
