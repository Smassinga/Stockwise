create or replace function public.transfer_sales_order_settlement_anchor(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invoice record;
begin
  select
    si.id,
    si.company_id,
    si.sales_order_id,
    si.document_workflow_status
  into v_invoice
  from public.sales_invoices si
  where si.id = p_invoice_id;

  if v_invoice.id is null
     or v_invoice.sales_order_id is null
     or v_invoice.document_workflow_status <> 'issued' then
    return;
  end if;

  update public.cash_transactions ct
     set ref_type = 'SI',
         ref_id = v_invoice.id
   where ct.company_id = v_invoice.company_id
     and ct.type = 'sale_receipt'
     and ct.ref_type = 'SO'
     and ct.ref_id = v_invoice.sales_order_id;

  update public.bank_transactions bt
     set ref_type = 'SI',
         ref_id = v_invoice.id
   where bt.ref_type = 'SO'
     and bt.ref_id = v_invoice.sales_order_id;
end;
$$;

create or replace function public.transfer_purchase_order_settlement_anchor(p_vendor_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_bill record;
begin
  select
    vb.id,
    vb.company_id,
    vb.purchase_order_id,
    vb.document_workflow_status
  into v_bill
  from public.vendor_bills vb
  where vb.id = p_vendor_bill_id;

  if v_bill.id is null
     or v_bill.purchase_order_id is null
     or v_bill.document_workflow_status <> 'posted' then
    return;
  end if;

  update public.cash_transactions ct
     set ref_type = 'VB',
         ref_id = v_bill.id
   where ct.company_id = v_bill.company_id
     and ct.type = 'purchase_payment'
     and ct.ref_type = 'PO'
     and ct.ref_id = v_bill.purchase_order_id;

  update public.bank_transactions bt
     set ref_type = 'VB',
         ref_id = v_bill.id
   where bt.ref_type = 'PO'
     and bt.ref_id = v_bill.purchase_order_id;
end;
$$;

create or replace function public.sales_invoice_transfer_settlement_anchor()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.document_workflow_status = 'issued'
     and coalesce(old.document_workflow_status, '') <> 'issued' then
    perform public.transfer_sales_order_settlement_anchor(new.id);
  end if;

  return new;
end;
$$;

create or replace function public.vendor_bill_transfer_settlement_anchor()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.document_workflow_status = 'posted'
     and coalesce(old.document_workflow_status, '') <> 'posted' then
    perform public.transfer_purchase_order_settlement_anchor(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists au_95_sales_invoice_transfer_settlement_anchor on public.sales_invoices;
create trigger au_95_sales_invoice_transfer_settlement_anchor
after update of document_workflow_status on public.sales_invoices
for each row execute function public.sales_invoice_transfer_settlement_anchor();

drop trigger if exists au_95_vendor_bill_transfer_settlement_anchor on public.vendor_bills;
create trigger au_95_vendor_bill_transfer_settlement_anchor
after update of document_workflow_status on public.vendor_bills
for each row execute function public.vendor_bill_transfer_settlement_anchor();

do $$
declare
  v_anchor record;
begin
  for v_anchor in
    select distinct on (si.sales_order_id)
      si.id
    from public.sales_invoices si
    where si.sales_order_id is not null
      and si.document_workflow_status = 'issued'
    order by si.sales_order_id, si.issued_at desc nulls last, si.created_at desc, si.id desc
  loop
    perform public.transfer_sales_order_settlement_anchor(v_anchor.id);
  end loop;

  for v_anchor in
    select distinct on (vb.purchase_order_id)
      vb.id
    from public.vendor_bills vb
    where vb.purchase_order_id is not null
      and vb.document_workflow_status = 'posted'
    order by vb.purchase_order_id, vb.posted_at desc nulls last, vb.created_at desc, vb.id desc
  loop
    perform public.transfer_purchase_order_settlement_anchor(v_anchor.id);
  end loop;
end;
$$;

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
  order by si.sales_order_id, si.issued_at desc nulls last, si.created_at desc, si.id desc
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
  case
    when coalesce(ir.has_issued_invoice, false) then 'issued'
    when coalesce(ir.has_draft_invoice, false) then 'draft'
    else null
  end::text as invoicing_status,
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
  case
    when iia.financial_anchor_document_id is not null then 0::numeric
    else greatest(
      ((coalesce(so.total_amount, 0) + coalesce(so.tax_total, 0)) * coalesce(so.fx_to_base, 1))
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    )::numeric
  end as legacy_outstanding_base,
  case
    when iia.financial_anchor_document_id is not null then 'settled'
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
  case
    when iia.financial_anchor_document_id is not null then 'sales_invoice'
    else 'legacy_order_link'
  end::text as financial_anchor,
  iia.financial_anchor_document_id,
  iia.financial_anchor_reference
from public.sales_orders so
left join line_rollup lr on lr.so_id = so.id
left join cash_rollup cr on cr.so_id = so.id and cr.company_id = so.company_id
left join bank_rollup br on br.so_id = so.id
left join invoice_rollup ir on ir.sales_order_id = so.id
left join issued_invoice_anchor iia on iia.sales_order_id = so.id;

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
),
bill_rollup as (
  select
    vb.purchase_order_id,
    bool_or(vb.document_workflow_status = 'draft') as has_draft_bill,
    bool_or(vb.document_workflow_status = 'posted') as has_posted_bill
  from public.vendor_bills vb
  where vb.purchase_order_id is not null
    and vb.document_workflow_status <> 'voided'
  group by vb.purchase_order_id
),
posted_bill_anchor as (
  select distinct on (vb.purchase_order_id)
    vb.purchase_order_id,
    vb.id as financial_anchor_document_id,
    coalesce(nullif(vb.supplier_invoice_reference, ''), vb.internal_reference) as financial_anchor_reference
  from public.vendor_bills vb
  where vb.purchase_order_id is not null
    and vb.document_workflow_status = 'posted'
  order by vb.purchase_order_id, vb.posted_at desc nulls last, vb.created_at desc, vb.id desc
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
  case
    when coalesce(brl.has_posted_bill, false) then 'posted'
    when coalesce(brl.has_draft_bill, false) then 'draft'
    else null
  end::text as billing_status,
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
  case
    when pba.financial_anchor_document_id is not null then 0::numeric
    else greatest(
      (coalesce(po.total, coalesce(po.subtotal, 0) + coalesce(po.tax_total, 0)) * coalesce(po.fx_to_base, 1))
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    )::numeric
  end as legacy_outstanding_base,
  case
    when pba.financial_anchor_document_id is not null then 'settled'
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
  case
    when pba.financial_anchor_document_id is not null then 'vendor_bill'
    else 'legacy_order_link'
  end::text as financial_anchor,
  pba.financial_anchor_document_id,
  pba.financial_anchor_reference
from public.purchase_orders po
left join receive_rollup rr on rr.po_id_text = po.id::text
left join cash_rollup cr on cr.po_id = po.id and cr.company_id = po.company_id
left join bank_rollup br on br.po_id = po.id
left join bill_rollup brl on brl.purchase_order_id = po.id
left join posted_bill_anchor pba on pba.purchase_order_id = po.id;

create or replace view public.v_sales_invoice_state as
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
  greatest(
    (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
    - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))
    - coalesce(cnr.credited_total_base, 0),
    0
  )::numeric as outstanding_base,
  case
    when coalesce(cnr.credited_total_base, 0) >= ((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) - 0.005) then 'fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'partially_credited'
    else 'not_credited'
  end::text as credit_status,
  case
    when greatest(
      (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))
      - coalesce(cnr.credited_total_base, 0),
      0
    ) <= 0.005 then 'settled'
    when si.due_date is not null
      and si.due_date < current_date
      and greatest(
        (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
        - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))
        - coalesce(cnr.credited_total_base, 0),
        0
      ) > 0.005 then 'overdue'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'partially_settled'
    else 'unsettled'
  end::text as settlement_status,
  case
    when si.document_workflow_status = 'draft' then 'draft'
    when si.document_workflow_status = 'voided' then 'voided'
    when coalesce(cnr.credited_total_base, 0) >= ((coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1)) - 0.005) then 'issued_fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'issued_partially_credited'
    when greatest(
      (coalesce(si.total_amount, 0) * coalesce(si.fx_to_base, 1))
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))
      - coalesce(cnr.credited_total_base, 0),
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
left join credit_rollup cnr on cnr.sales_invoice_id = si.id and cnr.company_id = si.company_id;

create or replace view public.v_vendor_bill_state as
with line_rollup as (
  select
    vbl.vendor_bill_id,
    count(*)::integer as line_count
  from public.vendor_bill_lines vbl
  group by vbl.vendor_bill_id
),
duplicate_groups as (
  select
    vb.company_id,
    vb.supplier_id,
    vb.supplier_invoice_reference_normalized
  from public.vendor_bills vb
  where vb.document_workflow_status <> 'voided'
    and vb.supplier_invoice_reference_normalized is not null
  group by vb.company_id, vb.supplier_id, vb.supplier_invoice_reference_normalized
  having count(*) > 1
),
cash_rollup as (
  select
    ct.company_id,
    ct.ref_id as vendor_bill_id,
    coalesce(sum(ct.amount_base * -1), 0)::numeric as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'VB'
    and ct.type = 'purchase_payment'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as vendor_bill_id,
    coalesce(sum(bt.amount_base * -1), 0)::numeric as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'VB'
  group by bt.ref_id
)
select
  vb.id,
  vb.company_id,
  vb.purchase_order_id,
  vb.supplier_id,
  vb.internal_reference,
  vb.supplier_invoice_reference,
  vb.supplier_invoice_reference_normalized,
  coalesce(nullif(vb.supplier_invoice_reference, ''), vb.internal_reference) as primary_reference,
  vb.supplier_invoice_date,
  vb.bill_date,
  vb.due_date,
  coalesce(nullif(s.name, ''), nullif(po.supplier_name, ''), nullif(po.supplier, '')) as counterparty_name,
  po.order_no,
  coalesce(vb.currency_code, 'MZN') as currency_code,
  coalesce(vb.fx_to_base, 1)::numeric as fx_to_base,
  coalesce(vb.subtotal, 0)::numeric as subtotal,
  coalesce(vb.tax_total, 0)::numeric as tax_total,
  coalesce(vb.total_amount, 0)::numeric as total_amount,
  (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))::numeric as total_amount_base,
  vb.document_workflow_status,
  coalesce(lr.line_count, 0) as line_count,
  (dg.company_id is not null) as duplicate_supplier_reference_exists,
  'vendor_bill'::text as financial_anchor,
  coalesce(cr.settled_base, 0)::numeric as cash_paid_base,
  coalesce(br.settled_base, 0)::numeric as bank_paid_base,
  (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0))::numeric as settled_base,
  greatest(
    (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
    - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
    0
  )::numeric as outstanding_base,
  case
    when greatest(
      (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'settled'
    when vb.due_date is not null
      and vb.due_date < current_date
      and greatest(
        (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
        - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
        0
      ) > 0.005 then 'overdue'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'partially_settled'
    else 'unsettled'
  end::text as settlement_status,
  case
    when vb.document_workflow_status = 'draft' then 'draft'
    when vb.document_workflow_status = 'voided' then 'voided'
    when greatest(
      (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'posted_settled'
    when (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)) > 0.005 then 'posted_partially_settled'
    when vb.due_date is not null and vb.due_date < current_date then 'posted_overdue'
    else 'posted_open'
  end::text as resolution_status
from public.vendor_bills vb
left join public.suppliers s on s.id = vb.supplier_id
left join public.purchase_orders po on po.id = vb.purchase_order_id
left join line_rollup lr on lr.vendor_bill_id = vb.id
left join duplicate_groups dg
  on dg.company_id = vb.company_id
 and dg.supplier_id is not distinct from vb.supplier_id
 and dg.supplier_invoice_reference_normalized = vb.supplier_invoice_reference_normalized
left join cash_rollup cr on cr.vendor_bill_id = vb.id and cr.company_id = vb.company_id
left join bank_rollup br on br.vendor_bill_id = vb.id;

alter view public.v_sales_order_state set (security_invoker = true);
alter view public.v_purchase_order_state set (security_invoker = true);
alter view public.v_sales_invoice_state set (security_invoker = true);
alter view public.v_vendor_bill_state set (security_invoker = true);

revoke all on public.v_sales_order_state from public, anon;
revoke all on public.v_purchase_order_state from public, anon;
revoke all on public.v_sales_invoice_state from public, anon;
revoke all on public.v_vendor_bill_state from public, anon;

grant select on public.v_sales_order_state to authenticated;
grant select on public.v_purchase_order_state to authenticated;
grant select on public.v_sales_invoice_state to authenticated;
grant select on public.v_vendor_bill_state to authenticated;

comment on function public.transfer_sales_order_settlement_anchor(uuid) is
  'Reassigns legacy SO-linked cash and bank settlements onto the issued sales invoice so the invoice becomes the canonical settlement anchor.';

comment on function public.transfer_purchase_order_settlement_anchor(uuid) is
  'Reassigns legacy PO-linked cash and bank settlements onto the posted vendor bill so the bill becomes the canonical settlement anchor.';

comment on function public.sales_invoice_transfer_settlement_anchor() is
  'After an invoice is issued, transfers any order-linked settlement records onto the invoice anchor.';

comment on function public.vendor_bill_transfer_settlement_anchor() is
  'After a vendor bill is posted, transfers any order-linked settlement records onto the vendor bill anchor.';

comment on view public.v_sales_order_state is
  'Order read model for workflow visibility. Once an issued sales invoice exists, settlement anchoring transfers to the invoice and the order no longer carries the primary open balance.';

comment on view public.v_purchase_order_state is
  'Order read model for workflow visibility. Once a posted vendor bill exists, settlement anchoring transfers to the bill and the order no longer carries the primary open balance.';

comment on view public.v_sales_invoice_state is
  'Finance-document settlement read model for sales invoices. Issued invoices become the canonical receivable anchor, including prior order-linked receipts and issued credit-note reductions.';

comment on view public.v_vendor_bill_state is
  'Finance-document settlement read model for vendor bills. Posted bills become the canonical payable anchor, including prior order-linked payments.';
