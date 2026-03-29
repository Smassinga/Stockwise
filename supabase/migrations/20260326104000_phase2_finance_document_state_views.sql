create or replace view public.v_sales_invoice_state as
with line_rollup as (
  select
    sil.sales_invoice_id,
    count(*)::integer as line_count
  from public.sales_invoice_lines sil
  group by sil.sales_invoice_id
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
  false as state_warning
from public.sales_invoices si
left join public.customers c on c.id = si.customer_id
left join public.sales_orders so on so.id = si.sales_order_id
left join line_rollup lr on lr.sales_invoice_id = si.id;

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
  (dg.company_id is not null) as duplicate_supplier_reference_exists
from public.vendor_bills vb
left join public.suppliers s on s.id = vb.supplier_id
left join public.purchase_orders po on po.id = vb.purchase_order_id
left join line_rollup lr on lr.vendor_bill_id = vb.id
left join duplicate_groups dg
  on dg.company_id = vb.company_id
 and dg.supplier_id is not distinct from vb.supplier_id
 and dg.supplier_invoice_reference_normalized = vb.supplier_invoice_reference_normalized;

alter view public.v_sales_invoice_state set (security_invoker = true);
alter view public.v_vendor_bill_state set (security_invoker = true);

revoke all on public.v_sales_invoice_state from public, anon;
revoke all on public.v_vendor_bill_state from public, anon;

grant select on public.v_sales_invoice_state to authenticated;
grant select on public.v_vendor_bill_state to authenticated;

comment on view public.v_sales_invoice_state is
  'Step 2 finance-document read model for sales invoices. Internal reference is the primary business identity for outbound documents.';

comment on view public.v_vendor_bill_state is
  'Step 2 finance-document read model for vendor bills. Supplier invoice reference stays primary in AP-facing workflows while the internal reference remains the audit identity.';
