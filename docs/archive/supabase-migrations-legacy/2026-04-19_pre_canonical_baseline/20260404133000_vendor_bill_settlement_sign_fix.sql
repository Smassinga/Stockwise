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
    coalesce(sum(case when coalesce(ct.amount_base, 0) < 0 then -ct.amount_base else 0 end), 0)::numeric as settled_base
  from public.cash_transactions ct
  where ct.ref_type = 'VB'
    and ct.type = 'purchase_payment'
  group by ct.company_id, ct.ref_id
),
bank_rollup as (
  select
    bt.ref_id as vendor_bill_id,
    coalesce(sum(case when coalesce(bt.amount_base, 0) < 0 then -bt.amount_base else 0 end), 0)::numeric as settled_base
  from public.bank_transactions bt
  where bt.ref_type = 'VB'
  group by bt.ref_id
),
credit_rollup as (
  select
    vcn.company_id,
    vcn.original_vendor_bill_id as vendor_bill_id,
    count(*) filter (where vcn.document_workflow_status = 'posted')::integer as credit_note_count,
    coalesce(sum(coalesce(vcn.total_amount_base, 0)) filter (where vcn.document_workflow_status = 'posted'), 0)::numeric as credited_total_base
  from public.vendor_credit_notes vcn
  group by vcn.company_id, vcn.original_vendor_bill_id
),
debit_rollup as (
  select
    vdn.company_id,
    vdn.original_vendor_bill_id as vendor_bill_id,
    count(*) filter (where vdn.document_workflow_status = 'posted')::integer as debit_note_count,
    coalesce(sum(coalesce(vdn.total_amount_base, 0)) filter (where vdn.document_workflow_status = 'posted'), 0)::numeric as debited_total_base
  from public.vendor_debit_notes vdn
  group by vdn.company_id, vdn.original_vendor_bill_id
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
  coalesce(cnr.credit_note_count, 0)::integer as credit_note_count,
  coalesce(cnr.credited_total_base, 0)::numeric as credited_total_base,
  coalesce(dnr.debit_note_count, 0)::integer as debit_note_count,
  coalesce(dnr.debited_total_base, 0)::numeric as debited_total_base,
  greatest(
    (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
    + coalesce(dnr.debited_total_base, 0)
    - coalesce(cnr.credited_total_base, 0),
    0
  )::numeric as current_legal_total_base,
  greatest(
    greatest(
      (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
      + coalesce(dnr.debited_total_base, 0)
      - coalesce(cnr.credited_total_base, 0),
      0
    )
    - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
    0
  )::numeric as outstanding_base,
  case
    when coalesce(cnr.credited_total_base, 0) >= (
      (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
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
        (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
        + coalesce(dnr.debited_total_base, 0)
        - coalesce(cnr.credited_total_base, 0),
        0
      )
      - (coalesce(cr.settled_base, 0) + coalesce(br.settled_base, 0)),
      0
    ) <= 0.005 then 'settled'
    when vb.due_date is not null
      and vb.due_date < current_date
      and greatest(
        greatest(
          (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
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
    when vb.document_workflow_status = 'draft' then 'draft'
    when vb.document_workflow_status = 'voided' then 'voided'
    when coalesce(cnr.credited_total_base, 0) >= (
      (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
      + coalesce(dnr.debited_total_base, 0)
      - 0.005
    ) then 'posted_fully_credited'
    when coalesce(cnr.credited_total_base, 0) > 0.005 then 'posted_partially_credited'
    when greatest(
      greatest(
        (coalesce(vb.total_amount, 0) * coalesce(vb.fx_to_base, 1))
        + coalesce(dnr.debited_total_base, 0)
        - coalesce(cnr.credited_total_base, 0),
        0
      )
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
left join bank_rollup br on br.vendor_bill_id = vb.id
left join credit_rollup cnr on cnr.vendor_bill_id = vb.id and cnr.company_id = vb.company_id
left join debit_rollup dnr on dnr.vendor_bill_id = vb.id and dnr.company_id = vb.company_id;

alter view public.v_vendor_bill_state set (security_invoker = true);

grant select on public.v_vendor_bill_state to authenticated;

comment on view public.v_vendor_bill_state is
  'Finance-document settlement read model for vendor bills. AP payment outflows are stored as negative cash/bank movements and are converted here into positive settled amounts before outstanding liability is calculated.';
