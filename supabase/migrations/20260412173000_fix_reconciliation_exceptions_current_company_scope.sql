create or replace view public.v_finance_reconciliation_exceptions as
with review_flags as (
  select
    review.company_id,
    review.ledger_side,
    review.anchor_kind,
    review.anchor_id,
    review.operational_document_id,
    review.anchor_reference,
    review.operational_reference,
    review.counterparty_name,
    review.document_date,
    review.due_date,
    review.current_legal_total_base,
    review.settled_base,
    review.raw_outstanding_base,
    review.outstanding_base,
    code.exception_code
  from public.v_finance_reconciliation_review review
  join lateral unnest(coalesce(review.exception_codes, array[]::text[])) as code(exception_code) on true
),
approved_sales_invoice_drafts as (
  select
    si.company_id,
    'AR'::text as ledger_side,
    'sales_invoice_draft'::text as anchor_kind,
    si.id as anchor_id,
    si.sales_order_id as operational_document_id,
    si.internal_reference as anchor_reference,
    so.order_no as operational_reference,
    coalesce(nullif(c.name, ''), nullif(so.bill_to_name, ''), nullif(so.customer, '')) as counterparty_name,
    si.invoice_date as document_date,
    si.due_date,
    public.sales_invoice_issue_readiness_mz(si.id) as readiness
  from public.sales_invoices si
  left join public.sales_orders so on so.id = si.sales_order_id
  left join public.customers c on c.id = si.customer_id
  where si.document_workflow_status = 'draft'
    and coalesce(si.approval_status, 'draft') = 'approved'
    and si.company_id = public.current_company_id()
),
approved_sales_invoice_blockers as (
  select
    draft.company_id,
    draft.ledger_side,
    draft.anchor_kind,
    draft.anchor_id,
    draft.operational_document_id,
    draft.anchor_reference,
    draft.operational_reference,
    draft.counterparty_name,
    draft.document_date,
    draft.due_date,
    null::numeric as current_legal_total_base,
    null::numeric as settled_base,
    null::numeric as raw_outstanding_base,
    null::numeric as outstanding_base,
    blocker.exception_code
  from approved_sales_invoice_drafts draft
  join lateral jsonb_array_elements_text(coalesce(draft.readiness -> 'blockers', '[]'::jsonb)) as blocker(exception_code) on true
  where coalesce((draft.readiness ->> 'can_issue')::boolean, false) = false
),
broken_sales_order_chain as (
  select
    so.company_id,
    'AR'::text as ledger_side,
    'sales_order'::text as anchor_kind,
    so.id as anchor_id,
    so.id as operational_document_id,
    so.order_no as anchor_reference,
    so.order_no as operational_reference,
    so.counterparty_name,
    so.order_date as document_date,
    so.due_date,
    null::numeric as current_legal_total_base,
    null::numeric as settled_base,
    null::numeric as raw_outstanding_base,
    null::numeric as outstanding_base,
    'missing_finance_anchor'::text as exception_code
  from public.v_sales_order_state so
  where so.financial_anchor = 'legacy_order_link'
    and so.company_id = public.current_company_id()
    and coalesce(so.invoicing_status, '') = 'issued'
),
broken_purchase_order_chain as (
  select
    po.company_id,
    'AP'::text as ledger_side,
    'purchase_order'::text as anchor_kind,
    po.id as anchor_id,
    po.id as operational_document_id,
    po.order_no as anchor_reference,
    po.order_no as operational_reference,
    po.counterparty_name,
    po.order_date as document_date,
    po.due_date,
    null::numeric as current_legal_total_base,
    null::numeric as settled_base,
    null::numeric as raw_outstanding_base,
    null::numeric as outstanding_base,
    'missing_finance_anchor'::text as exception_code
  from public.v_purchase_order_state po
  where po.financial_anchor = 'legacy_order_link'
    and po.company_id = public.current_company_id()
    and coalesce(po.billing_status, '') = 'posted'
)
select
  flagged.company_id,
  flagged.ledger_side,
  flagged.anchor_kind,
  flagged.anchor_id,
  flagged.operational_document_id,
  flagged.anchor_reference,
  flagged.operational_reference,
  flagged.counterparty_name,
  flagged.document_date,
  flagged.due_date,
  flagged.current_legal_total_base,
  flagged.settled_base,
  flagged.raw_outstanding_base,
  flagged.outstanding_base,
  flagged.exception_code,
  case
    when flagged.exception_code in (
      'negative_current_legal',
      'negative_outstanding',
      'unresolved_status_mismatch',
      'missing_finance_anchor',
      'company_fiscal_settings_missing',
      'sales_invoice_issue_requires_seller_snapshot',
      'sales_invoice_issue_requires_buyer_snapshot',
      'sales_invoice_issue_requires_document_language',
      'sales_invoice_issue_requires_computer_phrase',
      'sales_invoice_issue_missing_fiscal_identity',
      'sales_invoice_issue_series_mismatch',
      'sales_invoice_issue_invalid_totals',
      'sales_invoice_issue_requires_lines'
    ) then 'critical'
    else 'warning'
  end as severity,
  case
    when flagged.exception_code in (
      'company_fiscal_settings_missing',
      'sales_invoice_issue_requires_seller_snapshot',
      'sales_invoice_issue_requires_buyer_snapshot',
      'sales_invoice_issue_requires_document_language',
      'sales_invoice_issue_requires_computer_phrase',
      'sales_invoice_issue_missing_fiscal_identity',
      'sales_invoice_issue_series_mismatch',
      'sales_invoice_issue_invalid_totals',
      'sales_invoice_issue_requires_lines',
      'sales_invoice_issue_requires_invoice_date',
      'sales_invoice_issue_requires_due_date',
      'sales_invoice_issue_invalid_due_date',
      'sales_invoice_issue_requires_vat_exemption_reason'
    ) then 'issue_readiness'
    when flagged.exception_code = 'missing_finance_anchor' then 'chain'
    else 'bridge'
  end as exception_group
from (
  select * from review_flags
  union all
  select * from approved_sales_invoice_blockers
  union all
  select * from broken_sales_order_chain
  union all
  select * from broken_purchase_order_chain
) as flagged;

alter view public.v_finance_reconciliation_exceptions set (security_invoker = true);

revoke all on public.v_finance_reconciliation_exceptions from public, anon;
grant select on public.v_finance_reconciliation_exceptions to authenticated;

comment on view public.v_finance_reconciliation_exceptions is
  'Phase 3A exception queue for reconciliation and close review. Includes bridge anomalies, missing active anchors, and approved-draft Mozambique issue blockers that still prevent legal issue.';
