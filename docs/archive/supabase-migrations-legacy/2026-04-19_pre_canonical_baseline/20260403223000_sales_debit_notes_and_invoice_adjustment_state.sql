create or replace function public.sales_note_line_hardening_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if coalesce(new.line_total, 0) = 0
     and coalesce(new.qty, 0) > 0
     and coalesce(new.unit_price, 0) > 0 then
    raise exception using
      message = 'Sales note lines with quantity and unit price above zero cannot have a zero line total.';
  end if;

  if coalesce(new.line_total, 0) < coalesce(new.tax_amount, 0) then
    raise exception using
      message = 'Sales note line tax cannot exceed the stored line total.';
  end if;

  if coalesce(new.qty, 0) = 0
     and coalesce(new.line_total, 0) > 0
     and coalesce(new.unit_price, 0) <= 0 then
    raise exception using
      message = 'Sales note lines with a value-only adjustment must keep a positive unit price.';
  end if;

  return new;
end;
$$;

drop trigger if exists biu_20_sales_credit_note_lines_hardening on public.sales_credit_note_lines;
create trigger biu_20_sales_credit_note_lines_hardening
before insert or update on public.sales_credit_note_lines
for each row execute function public.sales_note_line_hardening_guard();

drop trigger if exists biu_20_sales_debit_note_lines_hardening on public.sales_debit_note_lines;
create trigger biu_20_sales_debit_note_lines_hardening
before insert or update on public.sales_debit_note_lines
for each row execute function public.sales_note_line_hardening_guard();

create or replace function public.sales_debit_note_snapshot_fiscal_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_rollup record;
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

  select
    count(*)::integer as line_count,
    coalesce(sum(coalesce(sdnl.line_total, 0)), 0)::numeric as subtotal,
    coalesce(sum(coalesce(sdnl.tax_amount, 0)), 0)::numeric as tax_total,
    coalesce(sum(coalesce(sdnl.line_total, 0) + coalesce(sdnl.tax_amount, 0)), 0)::numeric as total_amount
    into v_rollup
  from public.sales_debit_note_lines sdnl
  where sdnl.sales_debit_note_id = new.id;

  if coalesce(v_rollup.line_count, 0) <= 0 then
    raise exception using
      message = 'Debit notes require at least one line before issue.';
  end if;

  new.subtotal := round(coalesce(v_rollup.subtotal, 0), 2);
  new.tax_total := round(coalesce(v_rollup.tax_total, 0), 2);
  new.total_amount := round(coalesce(v_rollup.total_amount, 0), 2);
  new.subtotal_mzn := round(new.subtotal * coalesce(new.fx_to_base, 1), 2);
  new.tax_total_mzn := round(new.tax_total * coalesce(new.fx_to_base, 1), 2);
  new.total_amount_mzn := round(new.total_amount * coalesce(new.fx_to_base, 1), 2);

  if coalesce(new.total_amount, 0) <= 0 then
    raise exception using
      message = 'Debit notes require a positive total before issue.';
  end if;

  return new;
end;
$$;

drop view if exists public.v_sales_invoice_state;

create view public.v_sales_invoice_state as
with line_rollup as (
  select
    sil.sales_invoice_id,
    count(*)::integer as line_count
  from public.sales_invoice_lines sil
  group by sil.sales_invoice_id
),
cash_rollup as (
  select
    ct.company_id,
    ct.ref_id as sales_invoice_id,
    coalesce(sum(ct.amount_base), 0)::numeric as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'SI'
    and ct.type = 'sale_receipt'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as sales_invoice_id,
    coalesce(sum(bt.amount_base), 0)::numeric as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'SI'
  group by bt.ref_id
),
credit_rollup as (
  select
    scn.company_id,
    scn.original_sales_invoice_id as sales_invoice_id,
    count(*) filter (where scn.document_workflow_status = 'issued')::integer as credit_note_count,
    coalesce(sum(coalesce(scn.total_amount, 0) * coalesce(scn.fx_to_base, 1)) filter (where scn.document_workflow_status = 'issued'), 0)::numeric as credited_total_base
  from public.sales_credit_notes scn
  group by scn.company_id, scn.original_sales_invoice_id
),
debit_rollup as (
  select
    sdn.company_id,
    sdn.original_sales_invoice_id as sales_invoice_id,
    count(*) filter (where sdn.document_workflow_status = 'issued')::integer as debit_note_count,
    coalesce(sum(coalesce(sdn.total_amount, 0) * coalesce(sdn.fx_to_base, 1)) filter (where sdn.document_workflow_status = 'issued'), 0)::numeric as debited_total_base
  from public.sales_debit_notes sdn
  group by sdn.company_id, sdn.original_sales_invoice_id
)
select
  si.id,
  si.company_id,
  si.sales_order_id,
  si.customer_id,
  si.internal_reference,
  si.invoice_date,
  si.due_date,
  coalesce(nullif(c.name, ''), nullif(so.bill_to_name, ''), nullif(so.customer, '')) as counterparty_name,
  so.order_no,
  coalesce(si.currency_code, 'MZN') as currency_code,
  coalesce(si.fx_to_base, 1)::numeric as fx_to_base,
  coalesce(si.subtotal, 0)::numeric as subtotal,
  coalesce(si.tax_total, 0)::numeric as tax_total,
  coalesce(si.total_amount, 0)::numeric as total_amount,
  (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))::numeric as total_amount_base,
  si.document_workflow_status,
  coalesce(lr.line_count, 0) as line_count,
  false as state_warning,
  'sales_invoice'::text as financial_anchor,
  coalesce(cr.settled_base, 0)::numeric as cash_received_base,
  coalesce(br.settled_base, 0)::numeric as bank_received_base,
  (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))::numeric as settled_base,
  coalesce(cnr.credit_note_count, 0)::integer as credit_note_count,
  coalesce(cnr.credited_total_base, 0)::numeric as credited_total_base,
  coalesce(dnr.debit_note_count, 0)::integer as debit_note_count,
  coalesce(dnr.debited_total_base, 0)::numeric as debited_total_base,
  greatest(
    (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
    + coalesce(dnr.debited_total_base, 0)
    - coalesce(cnr.credited_total_base, 0),
    0
  )::numeric as current_legal_total_base,
  greatest(
    greatest(
      (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
      + coalesce(dnr.debited_total_base, 0)
      - coalesce(cnr.credited_total_base, 0),
      0
    )
    - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
    0
  )::numeric as outstanding_base,
  case
    when coalesce(cnr.credited_total_base, 0) >= (
      (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
      + coalesce(dnr.debited_total_base, 0)
      - 0.005
    ) then 'fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'partially_credited'
    else 'not_credited'
  end::text as credit_status,
  case
    when coalesce(cnr.credited_total_base, 0) > 0.005
      and coalesce(dnr.debited_total_base, 0) > 0.005 then 'credited_and_debited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'credited'
    when coalesce(dnr.debited_total_base, 0) > 0.005 then 'debited'
    else 'none'
  end::text as adjustment_status,
  case
    when greatest(
      greatest(
        (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
        + coalesce(dnr.debited_total_base, 0)
        - coalesce(cnr.credited_total_base, 0),
        0
      )
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'settled'
    when si.due_date is not null
      and si.due_date < current_date
      and greatest(
        greatest(
          (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
          + coalesce(dnr.debited_total_base, 0)
          - coalesce(cnr.credited_total_base, 0),
          0
        )
        - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
        0
      ) > 0.005 then 'overdue'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'partially_settled'
    else 'unsettled'
  end::text as settlement_status,
  case
    when si.document_workflow_status = 'draft' then 'draft'
    when si.document_workflow_status = 'voided' then 'voided'
    when coalesce(cnr.credited_total_base, 0) >= (
      (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
      + coalesce(dnr.debited_total_base, 0)
      - 0.005
    ) then 'issued_fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'issued_partially_credited'
    when greatest(
      greatest(
        (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
        + coalesce(dnr.debited_total_base, 0)
        - coalesce(cnr.credited_total_base, 0),
        0
      )
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'issued_settled'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'issued_partially_settled'
    when si.due_date is not null and si.due_date < current_date then 'issued_overdue'
    else 'issued_open'
  end::text as resolution_status
from public.sales_invoices si
left join public.customers c on c.id = si.customer_id
left join public.sales_orders so on so.id = si.sales_order_id
left join line_rollup lr on lr.sales_invoice_id = si.id
left join cash_rollup cr on cr.sales_invoice_id = si.id and cr.company_id = si.company_id
left join bank_rollup br on br.sales_invoice_id = si.id
left join credit_rollup cnr on cnr.sales_invoice_id = si.id and cnr.company_id = si.company_id
left join debit_rollup dnr on dnr.sales_invoice_id = si.id and dnr.company_id = si.company_id;
