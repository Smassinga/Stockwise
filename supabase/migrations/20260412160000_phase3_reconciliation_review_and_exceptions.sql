create or replace view public.v_finance_reconciliation_review as
with anchor_rows as (
  select
    'AR'::text as ledger_side,
    'sales_invoice'::text as anchor_kind,
    si.company_id,
    si.id as anchor_id,
    si.sales_order_id as operational_document_id,
    si.internal_reference as anchor_reference,
    si.order_no as operational_reference,
    si.counterparty_name,
    si.invoice_date as document_date,
    si.due_date,
    si.currency_code,
    coalesce(si.total_amount_base, 0)::numeric as original_total_base,
    coalesce(si.credited_total_base, 0)::numeric as credited_total_base,
    coalesce(si.debited_total_base, 0)::numeric as debited_total_base,
    (coalesce(si.debited_total_base, 0) - coalesce(si.credited_total_base, 0))::numeric as net_adjustment_base,
    coalesce(si.current_legal_total_base, 0)::numeric as current_legal_total_base,
    coalesce(si.settled_base, 0)::numeric as settled_base,
    (coalesce(si.current_legal_total_base, 0) - coalesce(si.settled_base, 0))::numeric as raw_outstanding_base,
    coalesce(si.outstanding_base, 0)::numeric as outstanding_base,
    greatest(coalesce(si.settled_base, 0) - coalesce(si.current_legal_total_base, 0), 0)::numeric as over_settled_base,
    si.document_workflow_status,
    si.approval_status,
    si.adjustment_status,
    si.credit_status,
    si.settlement_status,
    si.resolution_status,
    false as duplicate_reference_flag
  from public.v_sales_invoice_state si
  where si.document_workflow_status = 'issued'

  union all

  select
    'AP'::text as ledger_side,
    'vendor_bill'::text as anchor_kind,
    vb.company_id,
    vb.id as anchor_id,
    vb.purchase_order_id as operational_document_id,
    vb.internal_reference as anchor_reference,
    vb.order_no as operational_reference,
    vb.counterparty_name,
    vb.bill_date as document_date,
    vb.due_date,
    vb.currency_code,
    coalesce(vb.total_amount_base, 0)::numeric as original_total_base,
    coalesce(vb.credited_total_base, 0)::numeric as credited_total_base,
    coalesce(vb.debited_total_base, 0)::numeric as debited_total_base,
    (coalesce(vb.debited_total_base, 0) - coalesce(vb.credited_total_base, 0))::numeric as net_adjustment_base,
    coalesce(vb.current_legal_total_base, 0)::numeric as current_legal_total_base,
    coalesce(vb.settled_base, 0)::numeric as settled_base,
    (coalesce(vb.current_legal_total_base, 0) - coalesce(vb.settled_base, 0))::numeric as raw_outstanding_base,
    coalesce(vb.outstanding_base, 0)::numeric as outstanding_base,
    greatest(coalesce(vb.settled_base, 0) - coalesce(vb.current_legal_total_base, 0), 0)::numeric as over_settled_base,
    vb.document_workflow_status,
    vb.approval_status,
    vb.adjustment_status,
    vb.credit_status,
    vb.settlement_status,
    vb.resolution_status,
    coalesce(vb.duplicate_supplier_reference_exists, false) as duplicate_reference_flag
  from public.v_vendor_bill_state vb
  where vb.document_workflow_status = 'posted'
),
annotated as (
  select
    anchor_rows.*,
    case
      when coalesce(anchor_rows.outstanding_base, 0) <= 0.005 then 'resolved'
      when anchor_rows.due_date is null then 'undated'
      when anchor_rows.due_date < current_date then 'overdue'
      when anchor_rows.due_date = current_date then 'due_today'
      when anchor_rows.due_date <= current_date + 7 then 'due_soon'
      else 'current'
    end as due_position,
    case
      when coalesce(anchor_rows.outstanding_base, 0) <= 0.005 or anchor_rows.due_date is null or anchor_rows.due_date >= current_date then 0
      else (current_date - anchor_rows.due_date)
    end::integer as days_past_due,
    case
      when coalesce(anchor_rows.outstanding_base, 0) <= 0.005 or anchor_rows.due_date is null or anchor_rows.due_date < current_date then null
      else (anchor_rows.due_date - current_date)
    end::integer as days_until_due,
    case
      when coalesce(anchor_rows.outstanding_base, 0) <= 0.005 then 'resolved'
      when anchor_rows.due_date is null then 'undated'
      when anchor_rows.due_date >= current_date then 'current'
      when current_date - anchor_rows.due_date <= 30 then '1_30'
      when current_date - anchor_rows.due_date <= 60 then '31_60'
      when current_date - anchor_rows.due_date <= 90 then '61_90'
      else '91_plus'
    end as aging_bucket,
    array_remove(
      array[
        case when coalesce(anchor_rows.current_legal_total_base, 0) < -0.005 then 'negative_current_legal' end,
        case when coalesce(anchor_rows.raw_outstanding_base, 0) < -0.005 then 'negative_outstanding' end,
        case when coalesce(anchor_rows.over_settled_base, 0) > 0.005 then 'over_settled' end,
        case when coalesce(anchor_rows.outstanding_base, 0) > 0.005 and anchor_rows.due_date is null then 'missing_due_date' end,
        case when nullif(btrim(coalesce(anchor_rows.counterparty_name, '')), '') is null then 'missing_counterparty' end,
        case when anchor_rows.duplicate_reference_flag then 'duplicate_supplier_reference' end,
        case
          when coalesce(anchor_rows.outstanding_base, 0) <= 0.005
           and anchor_rows.resolution_status in ('issued_open', 'issued_overdue', 'issued_partially_settled', 'posted_open', 'posted_overdue', 'posted_partially_settled')
            then 'resolved_status_mismatch'
        end,
        case
          when coalesce(anchor_rows.outstanding_base, 0) > 0.005
           and anchor_rows.resolution_status in ('issued_settled', 'issued_fully_credited', 'posted_settled', 'posted_fully_credited')
            then 'unresolved_status_mismatch'
        end
      ],
      null::text
    ) as exception_codes
  from anchor_rows
)
select
  annotated.ledger_side,
  annotated.anchor_kind,
  annotated.company_id,
  annotated.anchor_id,
  annotated.operational_document_id,
  annotated.anchor_reference,
  annotated.operational_reference,
  annotated.counterparty_name,
  annotated.document_date,
  annotated.due_date,
  annotated.currency_code,
  annotated.original_total_base,
  annotated.credited_total_base,
  annotated.debited_total_base,
  annotated.net_adjustment_base,
  annotated.current_legal_total_base,
  annotated.settled_base,
  annotated.raw_outstanding_base,
  annotated.outstanding_base,
  annotated.over_settled_base,
  annotated.document_workflow_status,
  annotated.approval_status,
  annotated.adjustment_status,
  annotated.credit_status,
  annotated.settlement_status,
  annotated.resolution_status,
  annotated.due_position,
  annotated.days_past_due,
  annotated.days_until_due,
  annotated.aging_bucket,
  annotated.exception_codes,
  coalesce(array_length(annotated.exception_codes, 1), 0) as exception_count,
  case
    when coalesce(array_length(annotated.exception_codes, 1), 0) > 0 then 'exception'
    when annotated.due_position = 'overdue' then 'overdue'
    when annotated.due_position in ('due_today', 'due_soon') then 'attention'
    when coalesce(annotated.outstanding_base, 0) > 0.005 then 'open'
    else 'resolved'
  end as review_state,
  (
    coalesce(array_length(annotated.exception_codes, 1), 0) > 0
    or coalesce(annotated.outstanding_base, 0) > 0.005
  ) as needs_review
from annotated;

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

alter view public.v_finance_reconciliation_review set (security_invoker = true);
alter view public.v_finance_reconciliation_exceptions set (security_invoker = true);

revoke all on public.v_finance_reconciliation_review from public, anon;
revoke all on public.v_finance_reconciliation_exceptions from public, anon;

grant select on public.v_finance_reconciliation_review to authenticated;
grant select on public.v_finance_reconciliation_exceptions to authenticated;

comment on view public.v_finance_reconciliation_review is
  'Phase 3A review register for AR/AP reconciliation. Exposes original, adjustment, current legal, settled, outstanding, due, aging, and review-state fields at the active finance anchor.';

comment on view public.v_finance_reconciliation_exceptions is
  'Phase 3A exception queue for reconciliation and close review. Includes bridge anomalies, missing active anchors, and approved-draft Mozambique issue blockers that still prevent legal issue.';
