export type FinanceLedgerSide = 'AR' | 'AP'

export type FinanceAnchorKind =
  | 'sales_invoice'
  | 'vendor_bill'
  | 'sales_invoice_draft'
  | 'sales_order'
  | 'purchase_order'

export type FinanceDuePosition =
  | 'resolved'
  | 'undated'
  | 'current'
  | 'due_soon'
  | 'due_today'
  | 'overdue'

export type FinanceAgingBucket =
  | 'resolved'
  | 'undated'
  | 'current'
  | '1_30'
  | '31_60'
  | '61_90'
  | '91_plus'

export type FinanceReviewState = 'exception' | 'overdue' | 'attention' | 'open' | 'resolved'

export type FinanceReconciliationRow = {
  ledger_side: FinanceLedgerSide
  anchor_kind: FinanceAnchorKind
  company_id: string
  anchor_id: string
  operational_document_id: string | null
  anchor_reference: string
  operational_reference: string | null
  counterparty_name: string | null
  document_date: string | null
  due_date: string | null
  currency_code: string
  original_total_base: number
  credited_total_base: number
  debited_total_base: number
  net_adjustment_base: number
  current_legal_total_base: number
  settled_base: number
  raw_outstanding_base: number
  outstanding_base: number
  over_settled_base: number
  document_workflow_status: string
  approval_status: string | null
  adjustment_status: string | null
  credit_status: string | null
  settlement_status: string | null
  resolution_status: string | null
  due_position: FinanceDuePosition
  days_past_due: number
  days_until_due: number | null
  aging_bucket: FinanceAgingBucket
  exception_codes: string[] | null
  exception_count: number
  review_state: FinanceReviewState
  needs_review: boolean
}

export type FinanceReconciliationExceptionSeverity = 'critical' | 'warning'
export type FinanceReconciliationExceptionGroup = 'bridge' | 'chain' | 'issue_readiness'

export type FinanceReconciliationExceptionRow = {
  company_id: string
  ledger_side: FinanceLedgerSide
  anchor_kind: FinanceAnchorKind
  anchor_id: string
  operational_document_id: string | null
  anchor_reference: string
  operational_reference: string | null
  counterparty_name: string | null
  document_date: string | null
  due_date: string | null
  current_legal_total_base: number | null
  settled_base: number | null
  raw_outstanding_base: number | null
  outstanding_base: number | null
  exception_code: string
  severity: FinanceReconciliationExceptionSeverity
  exception_group: FinanceReconciliationExceptionGroup
}

export const FINANCE_RECONCILIATION_VIEW = 'v_finance_reconciliation_review'
export const FINANCE_RECONCILIATION_EXCEPTIONS_VIEW = 'v_finance_reconciliation_exceptions'

export function financeDuePositionLabelKey(position?: FinanceDuePosition | null) {
  switch (position) {
    case 'resolved':
      return 'financeDocs.reconciliation.due.resolved'
    case 'undated':
      return 'financeDocs.reconciliation.due.undated'
    case 'current':
      return 'financeDocs.reconciliation.due.current'
    case 'due_soon':
      return 'financeDocs.reconciliation.due.dueSoon'
    case 'due_today':
      return 'financeDocs.reconciliation.due.dueToday'
    case 'overdue':
      return 'financeDocs.reconciliation.due.overdue'
    default:
      return 'orders.status.unknown'
  }
}

export function financeAgingBucketLabelKey(bucket?: FinanceAgingBucket | null) {
  switch (bucket) {
    case 'resolved':
      return 'financeDocs.reconciliation.aging.resolved'
    case 'undated':
      return 'financeDocs.reconciliation.aging.undated'
    case 'current':
      return 'financeDocs.reconciliation.aging.current'
    case '1_30':
      return 'financeDocs.reconciliation.aging.oneToThirty'
    case '31_60':
      return 'financeDocs.reconciliation.aging.thirtyOneToSixty'
    case '61_90':
      return 'financeDocs.reconciliation.aging.sixtyOneToNinety'
    case '91_plus':
      return 'financeDocs.reconciliation.aging.ninetyOnePlus'
    default:
      return 'orders.status.unknown'
  }
}

export function financeReviewStateLabelKey(state?: FinanceReviewState | null) {
  switch (state) {
    case 'exception':
      return 'financeDocs.reconciliation.review.exception'
    case 'overdue':
      return 'financeDocs.reconciliation.review.overdue'
    case 'attention':
      return 'financeDocs.reconciliation.review.attention'
    case 'open':
      return 'financeDocs.reconciliation.review.open'
    case 'resolved':
      return 'financeDocs.reconciliation.review.resolved'
    default:
      return 'orders.status.unknown'
  }
}

export function financeExceptionLabelKey(code?: string | null) {
  switch (code) {
    case 'negative_current_legal':
      return 'financeDocs.reconciliation.exceptions.negativeCurrentLegal'
    case 'negative_outstanding':
      return 'financeDocs.reconciliation.exceptions.negativeOutstanding'
    case 'over_settled':
      return 'financeDocs.reconciliation.exceptions.overSettled'
    case 'missing_due_date':
      return 'financeDocs.reconciliation.exceptions.missingDueDate'
    case 'missing_counterparty':
      return 'financeDocs.reconciliation.exceptions.missingCounterparty'
    case 'duplicate_supplier_reference':
      return 'financeDocs.reconciliation.exceptions.duplicateSupplierReference'
    case 'resolved_status_mismatch':
      return 'financeDocs.reconciliation.exceptions.resolvedStatusMismatch'
    case 'unresolved_status_mismatch':
      return 'financeDocs.reconciliation.exceptions.unresolvedStatusMismatch'
    case 'missing_finance_anchor':
      return 'financeDocs.reconciliation.exceptions.missingFinanceAnchor'
    case 'company_fiscal_settings_missing':
      return 'financeDocs.reconciliation.exceptions.companyFiscalSettingsMissing'
    case 'sales_invoice_issue_requires_seller_snapshot':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceRequiresSellerSnapshot'
    case 'sales_invoice_issue_requires_buyer_snapshot':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceRequiresBuyerSnapshot'
    case 'sales_invoice_issue_requires_document_language':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceRequiresDocumentLanguage'
    case 'sales_invoice_issue_requires_computer_phrase':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceRequiresComputerPhrase'
    case 'sales_invoice_issue_missing_fiscal_identity':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceMissingFiscalIdentity'
    case 'sales_invoice_issue_series_mismatch':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceSeriesMismatch'
    case 'sales_invoice_issue_invalid_totals':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceInvalidTotals'
    case 'sales_invoice_issue_requires_lines':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceRequiresLines'
    case 'sales_invoice_issue_requires_invoice_date':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceRequiresInvoiceDate'
    case 'sales_invoice_issue_requires_due_date':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceRequiresDueDate'
    case 'sales_invoice_issue_invalid_due_date':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceInvalidDueDate'
    case 'sales_invoice_issue_requires_vat_exemption_reason':
      return 'financeDocs.reconciliation.exceptions.salesInvoiceRequiresVatExemptionReason'
    default:
      return 'financeDocs.reconciliation.exceptions.generic'
  }
}

export function financeExceptionGroupLabelKey(group?: FinanceReconciliationExceptionGroup | null) {
  switch (group) {
    case 'bridge':
      return 'financeDocs.reconciliation.exceptionGroups.bridge'
    case 'chain':
      return 'financeDocs.reconciliation.exceptionGroups.chain'
    case 'issue_readiness':
      return 'financeDocs.reconciliation.exceptionGroups.issueReadiness'
    default:
      return 'orders.status.unknown'
  }
}
