create or replace view public.v_sales_order_state as
with line_rollup as (
  select
    sol.so_id,
    coalesce(sum(coalesce(sol.qty, 0)), 0)::numeric as ordered_qty,
    coalesce(sum(coalesce(sol.shipped_qty, 0)), 0)::numeric as shipped_qty
  from public.sales_order_lines sol
  group by sol.so_id
),
cash_rollup as (
  select
    ct.company_id,
    ct.ref_id as so_id,
    coalesce(sum(ct.amount_base), 0)::numeric as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'SO'
    and ct.type = 'sale_receipt'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as so_id,
    coalesce(sum(bt.amount_base), 0)::numeric as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'SO'
  group by bt.ref_id
)
select
  so.id,
  so.company_id,
  so.order_no,
  lower(so.status::text) as legacy_status,
  case
    when lower(so.status::text) = 'draft' then 'draft'
    when lower(so.status::text) = 'submitted' then 'awaiting_approval'
    when lower(so.status::text) in ('confirmed', 'allocated', 'shipped', 'closed') then 'approved'
    when lower(so.status::text) in ('cancelled', 'canceled') then 'cancelled'
    else 'approved'
  end::text as workflow_status,
  case
    when lower(so.status::text) in ('cancelled', 'canceled') then 'not_started'
    when lower(so.status::text) in ('shipped', 'closed') then 'complete'
    when coalesce(lr.ordered_qty, 0) <= 0 then 'not_started'
    when coalesce(lr.shipped_qty, 0) <= 0 then 'not_started'
    when coalesce(lr.shipped_qty, 0) + 0.000001 < coalesce(lr.ordered_qty, 0) then 'partial'
    else 'complete'
  end::text as fulfilment_status,
  null::text as invoicing_status,
  coalesce(so.order_date, (so.created_at at time zone 'utc')::date) as order_date,
  so.due_date,
  coalesce(nullif(so.bill_to_name, ''), nullif(so.customer, '')) as counterparty_name,
  coalesce(so.currency_code, 'MZN') as currency_code,
  coalesce(so.fx_to_base, 1)::numeric as fx_to_base,
  coalesce(so.total_amount, 0)::numeric as subtotal_amount_ccy,
  coalesce(so.tax_total, 0)::numeric as tax_amount_ccy,
  (coalesce(so.total_amount, 0) + coalesce(so.tax_total, 0))::numeric as total_amount_ccy,
  ((coalesce(so.total_amount, 0) + coalesce(so.tax_total, 0)) * coalesce(so.fx_to_base, 1))::numeric as total_amount_base,
  coalesce(cr.settled_base, 0)::numeric as legacy_cash_settled_base,
  coalesce(br.settled_base, 0)::numeric as legacy_bank_settled_base,
  (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))::numeric as legacy_settled_base,
  greatest(
    ((coalesce(so.total_amount, 0) + coalesce(so.tax_total, 0)) * coalesce(so.fx_to_base, 1))
    - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
    0
  )::numeric as legacy_outstanding_base,
  case
    when greatest(
      ((coalesce(so.total_amount, 0) + coalesce(so.tax_total, 0)) * coalesce(so.fx_to_base, 1))
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'settled'
    when so.due_date is not null
      and so.due_date < current_date
      and greatest(
        ((coalesce(so.total_amount, 0) + coalesce(so.tax_total, 0)) * coalesce(so.fx_to_base, 1))
        - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
        0
      ) > 0.005 then 'overdue'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'partially_settled'
    else 'unsettled'
  end::text as settlement_status,
  'legacy_order_link'::text as financial_anchor
from public.sales_orders so
left join line_rollup lr on lr.so_id = so.id
left join cash_rollup cr on cr.so_id = so.id and cr.company_id = so.company_id
left join bank_rollup br on br.so_id = so.id;

create or replace view public.v_purchase_order_state as
with receive_rollup as (
  select
    sm.ref_id as po_id_text,
    count(*)::integer as receive_count
  from public.stock_movements sm
  where sm.ref_type = 'PO'
    and sm.type = 'receive'
  group by sm.ref_id
),
cash_rollup as (
  select
    ct.company_id,
    ct.ref_id as po_id,
    coalesce(sum(ct.amount_base * -1), 0)::numeric as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'PO'
    and ct.type = 'purchase_payment'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as po_id,
    coalesce(sum(bt.amount_base * -1), 0)::numeric as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'PO'
  group by bt.ref_id
)
select
  po.id,
  po.company_id,
  po.order_no,
  lower(po.status::text) as legacy_status,
  case
    when lower(po.status::text) = 'draft' then 'draft'
    when lower(po.status::text) in ('cancelled', 'canceled') then 'cancelled'
    else 'approved'
  end::text as workflow_status,
  case
    when lower(po.status::text) in ('cancelled', 'canceled') then 'not_started'
    when lower(po.status::text) = 'closed' then 'complete'
    when lower(po.status::text) = 'partially_received' then 'partial'
    when coalesce(rr.receive_count, 0) > 0 then 'partial'
    else 'not_started'
  end::text as receipt_status,
  null::text as billing_status,
  coalesce(po.order_date, (po.created_at at time zone 'utc')::date) as order_date,
  coalesce(po.due_date, po.expected_date) as due_date,
  coalesce(nullif(po.supplier_name, ''), nullif(po.supplier, '')) as counterparty_name,
  coalesce(po.currency_code, 'MZN') as currency_code,
  coalesce(po.fx_to_base, 1)::numeric as fx_to_base,
  coalesce(po.subtotal, 0)::numeric as subtotal_amount_ccy,
  coalesce(po.tax_total, greatest(coalesce(po.total, 0) - coalesce(po.subtotal, 0), 0))::numeric as tax_amount_ccy,
  coalesce(po.total, coalesce(po.subtotal, 0) + coalesce(po.tax_total, 0))::numeric as total_amount_ccy,
  (coalesce(po.total, coalesce(po.subtotal, 0) + coalesce(po.tax_total, 0)) * coalesce(po.fx_to_base, 1))::numeric as total_amount_base,
  coalesce(cr.settled_base, 0)::numeric as legacy_cash_settled_base,
  coalesce(br.settled_base, 0)::numeric as legacy_bank_settled_base,
  (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))::numeric as legacy_paid_base,
  greatest(
    (coalesce(po.total, coalesce(po.subtotal, 0) + coalesce(po.tax_total, 0)) * coalesce(po.fx_to_base, 1))
    - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
    0
  )::numeric as legacy_outstanding_base,
  case
    when greatest(
      (coalesce(po.total, coalesce(po.subtotal, 0) + coalesce(po.tax_total, 0)) * coalesce(po.fx_to_base, 1))
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'settled'
    when coalesce(po.due_date, po.expected_date) is not null
      and coalesce(po.due_date, po.expected_date) < current_date
      and greatest(
        (coalesce(po.total, coalesce(po.subtotal, 0) + coalesce(po.tax_total, 0)) * coalesce(po.fx_to_base, 1))
        - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
        0
      ) > 0.005 then 'overdue'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'partially_settled'
    else 'unsettled'
  end::text as settlement_status,
  'legacy_order_link'::text as financial_anchor
from public.purchase_orders po
left join receive_rollup rr on rr.po_id_text = po.id::text
left join cash_rollup cr on cr.po_id = po.id and cr.company_id = po.company_id
left join bank_rollup br on br.po_id = po.id;

alter view public.v_sales_order_state set (security_invoker = true);
alter view public.v_purchase_order_state set (security_invoker = true);

revoke all on public.v_sales_order_state from public, anon;
revoke all on public.v_purchase_order_state from public, anon;

grant select on public.v_sales_order_state to authenticated;
grant select on public.v_purchase_order_state to authenticated;

comment on view public.v_sales_order_state is
  'Phase 1 canonical sales-order state view. Keeps workflow and fulfilment semantics separate from the current legacy order-linked finance summary.';

comment on view public.v_purchase_order_state is
  'Phase 1 canonical purchase-order state view. Keeps workflow and receipt semantics separate from the current legacy order-linked finance summary.';
