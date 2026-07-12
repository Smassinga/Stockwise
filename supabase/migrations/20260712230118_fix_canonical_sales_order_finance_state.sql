-- Canonical line-tax Sales Orders already persist total_amount as the grand total.
-- Preserve the historical legacy-header interpretation while preventing the
-- settlement read model from adding canonical line tax a second time.

create or replace view public.v_sales_order_state
with (security_invoker = true)
as
with line_rollup as (
  select
    sol.so_id,
    coalesce(sum(coalesce(sol.qty, 0)), 0) as ordered_qty,
    coalesce(sum(coalesce(sol.shipped_qty, 0)), 0) as shipped_qty
  from public.sales_order_lines sol
  group by sol.so_id
),
cash_rollup as (
  select
    ct.company_id,
    ct.ref_id as so_id,
    coalesce(sum(ct.amount_base), 0) as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'SO'
    and ct.type = 'sale_receipt'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as so_id,
    coalesce(sum(bt.amount_base), 0) as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'SO'
  group by bt.ref_id
),
invoice_rollup as (
  select
    si.sales_order_id,
    bool_or(si.document_workflow_status = 'draft') as has_draft_invoice,
    bool_or(si.document_workflow_status = 'issued') as has_issued_invoice
  from public.sales_invoices si
  where si.sales_order_id is not null
    and si.document_workflow_status <> 'voided'
  group by si.sales_order_id
),
issued_invoice_anchor as (
  select distinct on (si.sales_order_id)
    si.sales_order_id,
    si.id as financial_anchor_document_id,
    si.internal_reference as financial_anchor_reference
  from public.sales_invoices si
  where si.sales_order_id is not null
    and si.document_workflow_status = 'issued'
  order by
    si.sales_order_id,
    si.issued_at desc nulls last,
    si.created_at desc,
    si.id desc
),
order_amounts as (
  select
    so.*,
    case
      when so.tax_calculation_mode = 'line'
        then coalesce(so.subtotal, 0)
      else coalesce(so.total_amount, 0)
    end as finance_subtotal_amount_ccy,
    coalesce(so.tax_total, 0) as finance_tax_amount_ccy,
    case
      when so.tax_calculation_mode = 'line'
        then coalesce(
          so.total,
          so.total_amount,
          coalesce(so.subtotal, 0) + coalesce(so.tax_total, 0)
        )
      else coalesce(so.total_amount, 0) + coalesce(so.tax_total, 0)
    end as finance_total_amount_ccy
  from public.sales_orders so
)
select
  so.id,
  so.company_id,
  so.order_no,
  lower(so.status::text) as legacy_status,
  case
    when lower(so.status::text) = 'draft' then 'draft'
    when lower(so.status::text) = 'submitted' then 'awaiting_approval'
    when lower(so.status::text) = any (array['confirmed', 'allocated', 'shipped', 'closed']) then 'approved'
    when lower(so.status::text) = any (array['cancelled', 'canceled']) then 'cancelled'
    else 'approved'
  end as workflow_status,
  case
    when lower(so.status::text) = any (array['cancelled', 'canceled']) then 'not_started'
    when lower(so.status::text) = any (array['shipped', 'closed']) then 'complete'
    when coalesce(lr.ordered_qty, 0) <= 0 then 'not_started'
    when coalesce(lr.shipped_qty, 0) <= 0 then 'not_started'
    when coalesce(lr.shipped_qty, 0) + 0.000001 < coalesce(lr.ordered_qty, 0) then 'partial'
    else 'complete'
  end as fulfilment_status,
  case
    when coalesce(ir.has_issued_invoice, false) then 'issued'
    when coalesce(ir.has_draft_invoice, false) then 'draft'
    else null
  end as invoicing_status,
  coalesce(so.order_date, (so.created_at at time zone 'utc')::date) as order_date,
  so.due_date,
  coalesce(nullif(so.bill_to_name, ''), nullif(so.customer, '')) as counterparty_name,
  coalesce(so.currency_code, 'MZN'::bpchar) as currency_code,
  coalesce(so.fx_to_base, 1) as fx_to_base,
  so.finance_subtotal_amount_ccy as subtotal_amount_ccy,
  so.finance_tax_amount_ccy as tax_amount_ccy,
  so.finance_total_amount_ccy as total_amount_ccy,
  so.finance_total_amount_ccy * coalesce(so.fx_to_base, 1) as total_amount_base,
  coalesce(cr.settled_base, 0) as legacy_cash_settled_base,
  coalesce(br.settled_base, 0) as legacy_bank_settled_base,
  coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0) as legacy_settled_base,
  case
    when iia.financial_anchor_document_id is not null then 0
    else greatest(
      so.finance_total_amount_ccy * coalesce(so.fx_to_base, 1)
        - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    )
  end as legacy_outstanding_base,
  case
    when iia.financial_anchor_document_id is not null then 'settled'
    when greatest(
      so.finance_total_amount_ccy * coalesce(so.fx_to_base, 1)
        - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'settled'
    when so.due_date is not null
      and so.due_date < current_date
      and greatest(
        so.finance_total_amount_ccy * coalesce(so.fx_to_base, 1)
          - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
        0
      ) > 0.005 then 'overdue'
    when coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0) > 0.005
      then 'partially_settled'
    else 'unsettled'
  end as settlement_status,
  case
    when iia.financial_anchor_document_id is not null then 'sales_invoice'
    else 'legacy_order_link'
  end as financial_anchor,
  iia.financial_anchor_document_id,
  iia.financial_anchor_reference
from order_amounts so
left join line_rollup lr on lr.so_id = so.id
left join cash_rollup cr on cr.so_id = so.id and cr.company_id = so.company_id
left join bank_rollup br on br.so_id = so.id
left join invoice_rollup ir on ir.sales_order_id = so.id
left join issued_invoice_anchor iia on iia.sales_order_id = so.id;

comment on view public.v_sales_order_state is
  'Order read model for workflow visibility. Canonical line-tax orders use their stored grand total once; legacy header-tax orders retain historical interpretation. Once an issued sales invoice exists, settlement anchoring transfers to the invoice.';
