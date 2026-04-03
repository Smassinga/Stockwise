export type SalesInvoiceWorkflowStatus = 'draft' | 'issued' | 'voided'
export type VendorBillWorkflowStatus = 'draft' | 'posted' | 'voided'
export type FinanceDocumentSettlementStatus = 'unsettled' | 'partially_settled' | 'settled' | 'overdue'
export type SalesInvoiceResolutionStatus =
  | 'draft'
  | 'voided'
  | 'issued_open'
  | 'issued_overdue'
  | 'issued_partially_settled'
  | 'issued_settled'
  | 'issued_partially_credited'
  | 'issued_fully_credited'
export type VendorBillResolutionStatus =
  | 'draft'
  | 'voided'
  | 'posted_open'
  | 'posted_overdue'
  | 'posted_partially_settled'
  | 'posted_settled'

export type SalesInvoiceStateRow = {
  id: string
  company_id: string
  sales_order_id: string | null
  customer_id: string | null
  internal_reference: string
  invoice_date: string
  due_date: string
  counterparty_name: string | null
  order_no: string | null
  currency_code: string
  fx_to_base: number
  subtotal: number
  tax_total: number
  total_amount: number
  total_amount_base: number
  document_workflow_status: SalesInvoiceWorkflowStatus
  line_count: number
  state_warning: boolean
  financial_anchor: 'sales_invoice'
  cash_received_base: number
  bank_received_base: number
  settled_base: number
  credit_note_count: number
  credited_total_base: number
  outstanding_base: number
  credit_status: 'not_credited' | 'partially_credited' | 'fully_credited'
  settlement_status: FinanceDocumentSettlementStatus
  resolution_status: SalesInvoiceResolutionStatus
}

export type VendorBillStateRow = {
  id: string
  company_id: string
  purchase_order_id: string | null
  supplier_id: string | null
  internal_reference: string
  supplier_invoice_reference: string | null
  supplier_invoice_reference_normalized: string | null
  primary_reference: string
  supplier_invoice_date: string | null
  bill_date: string
  due_date: string
  counterparty_name: string | null
  order_no: string | null
  currency_code: string
  fx_to_base: number
  subtotal: number
  tax_total: number
  total_amount: number
  total_amount_base: number
  document_workflow_status: VendorBillWorkflowStatus
  line_count: number
  duplicate_supplier_reference_exists: boolean
  financial_anchor: 'vendor_bill'
  cash_paid_base: number
  bank_paid_base: number
  settled_base: number
  outstanding_base: number
  settlement_status: FinanceDocumentSettlementStatus
  resolution_status: VendorBillResolutionStatus
}

export type SalesInvoiceLineRow = {
  id: string
  sales_invoice_id: string
  description: string
  qty: number
  unit_price: number
  tax_rate: number | null
  tax_amount: number
  line_total: number
  sort_order: number
}

export type VendorBillLineRow = {
  id: string
  vendor_bill_id: string
  description: string
  qty: number
  unit_cost: number
  tax_rate: number | null
  tax_amount: number
  line_total: number
  sort_order: number
}

export const SALES_INVOICE_STATE_VIEW = 'v_sales_invoice_state'
export const VENDOR_BILL_STATE_VIEW = 'v_vendor_bill_state'

export function isMissingFinanceViewError(error: any, viewName: string) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  const name = viewName.toLowerCase()

  return code === 'PGRST205'
    || ((message.includes(name) || details.includes(name) || hint.includes(name))
      && (
        message.includes('could not find')
        || message.includes('does not exist')
        || details.includes('does not exist')
        || hint.includes('schema cache')
      ))
}

export function salesInvoiceWorkflowLabelKey(status?: SalesInvoiceWorkflowStatus | null) {
  switch (status) {
    case 'draft':
      return 'financeDocs.workflow.draft'
    case 'issued':
      return 'financeDocs.workflow.issued'
    case 'voided':
      return 'financeDocs.workflow.voided'
    default:
      return 'orders.status.unknown'
  }
}

export function vendorBillWorkflowLabelKey(status?: VendorBillWorkflowStatus | null) {
  switch (status) {
    case 'draft':
      return 'financeDocs.workflow.draft'
    case 'posted':
      return 'financeDocs.workflow.posted'
    case 'voided':
      return 'financeDocs.workflow.voided'
    default:
      return 'orders.status.unknown'
  }
}

export function salesInvoiceResolutionLabelKey(status?: SalesInvoiceResolutionStatus | null) {
  switch (status) {
    case 'draft':
      return 'financeDocs.resolution.draft'
    case 'voided':
      return 'financeDocs.resolution.voided'
    case 'issued_open':
      return 'financeDocs.resolution.issuedOpen'
    case 'issued_overdue':
      return 'financeDocs.resolution.issuedOverdue'
    case 'issued_partially_settled':
      return 'financeDocs.resolution.issuedPartiallySettled'
    case 'issued_settled':
      return 'financeDocs.resolution.issuedSettled'
    case 'issued_partially_credited':
      return 'financeDocs.resolution.issuedPartiallyCredited'
    case 'issued_fully_credited':
      return 'financeDocs.resolution.issuedFullyCredited'
    default:
      return 'orders.status.unknown'
  }
}

export function vendorBillResolutionLabelKey(status?: VendorBillResolutionStatus | null) {
  switch (status) {
    case 'draft':
      return 'financeDocs.resolution.draft'
    case 'voided':
      return 'financeDocs.resolution.voided'
    case 'posted_open':
      return 'financeDocs.resolution.postedOpen'
    case 'posted_overdue':
      return 'financeDocs.resolution.postedOverdue'
    case 'posted_partially_settled':
      return 'financeDocs.resolution.postedPartiallySettled'
    case 'posted_settled':
      return 'financeDocs.resolution.postedSettled'
    default:
      return 'orders.status.unknown'
  }
}
