import type { FinanceActivityRow } from '../../lib/financeActivity'
import type { FinanceDocumentSettlementStatus } from '../../lib/financeDocuments'
import type { FinanceReconciliationExceptionRow, FinanceReviewState } from '../../lib/financeReconciliation'
import type { SettlementKind } from '../../lib/orderFinance'
import type { OrderSettlementStatus } from '../../lib/orderState'

export type CashTx = {
  id: string
  happened_at: string
  type: 'sale_receipt' | 'purchase_payment' | 'adjustment'
  ref_type: SettlementKind | 'ADJ' | null
  ref_id: string | null
  memo: string | null
  amount_base: number
}

export type BankTx = {
  id: string
  bank_id: string
  happened_at: string
  memo: string | null
  amount_base: number
  created_at?: string | null
  ref_type?: SettlementKind | null
  ref_id?: string | null
}

export type BankAccount = {
  id: string
  name: string
  bank_name?: string | null
  account_number?: string | null
  currency_code?: string | null
}

export type HistoryRow = {
  id: string
  source: 'cash' | 'bank'
  sourceLabel: string
  happenedAt: string
  amountBase: number
  memo: string | null
}

export type SettlementBalanceStatus = OrderSettlementStatus | FinanceDocumentSettlementStatus

export type SettlementRow = {
  kind: SettlementKind
  id: string
  reference: string
  counterparty: string
  documentDate: string | null
  dueDate: string | null
  currency: string
  workflowStatus: string
  workflowLabel: string
  balanceStatus: SettlementBalanceStatus
  balanceLabel: string
  originalAmount: number
  originalBase: number
  creditedBase: number
  debitedBase: number
  currentLegalBase: number
  settledBase: number
  outstandingBase: number
  cashBase: number
  bankBase: number
  agingDays: number
  history: HistoryRow[]
  sourceLabel: string
}

export type FinanceWorkspaceView = 'exposure' | 'receipts' | 'activity' | 'reconciliation'
export type FinanceWorkspaceSide = 'ar' | 'ap'

export type CustomerReceiptCustomer = {
  id: string
  code: string | null
  name: string
  email: string | null
  phone: string | null
}

export type CustomerReceivableExposure = {
  company_id: string
  customer_id: string
  anchor_id: string
  anchor_kind: 'sales_invoice' | 'sales_order'
  document_reference: string
  document_date: string | null
  due_date: string | null
  customer_name: string | null
  document_currency_code: string
  base_currency_code: string
  original_amount_base: number
  outstanding_amount_base: number
  collection_status: string
  collection_next_action_at: string | null
  collection_pause_until: string | null
  dispute_category: string | null
  current_promise_id: string | null
  collections_suppressed: boolean
  collection_suppression_reason: string | null
  due_position: string
  days_past_due: number
}

export type CustomerUnappliedCredit = {
  company_id: string
  customer_id: string
  currency_code: string
  unapplied_credit_base: number
  receipt_count: number
}

export type CustomerReceiptState = {
  id: string
  company_id: string
  customer_id: string
  receipt_reference: string
  received_on: string
  amount_received_base: number
  currency_code: string
  payment_channel: 'cash' | 'bank'
  bank_account_id: string | null
  financial_transaction_id: string
  external_reference: string | null
  note: string | null
  created_at: string
  allocated_base: number
  unallocated_base: number
}

export type CustomerReceiptAllocationState = {
  id: string
  customer_receipt_id: string
  sales_invoice_id: string
  amount_base: number
  active_amount_base: number
  is_reversed: boolean
  reversal_id: string | null
  created_at: string
}

export type FinanceExportRequest =
  | { kind: 'exposure' }
  | { kind: 'activity' }
  | { kind: 'reconciliation' }
  | { kind: 'advice'; activity: FinanceActivityRow }

export const validWorkspaceViews = new Set<FinanceWorkspaceView>(['exposure', 'receipts', 'activity', 'reconciliation'])
export const validWorkspaceSides = new Set<FinanceWorkspaceSide>(['ar', 'ap'])

export function isMissingStateViewError(error: unknown, viewName: string) {
  const sdkError = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null
  const code = String(sdkError?.code || '')
  const message = String(sdkError?.message || '').toLowerCase()
  const details = String(sdkError?.details || '').toLowerCase()
  const hint = String(sdkError?.hint || '').toLowerCase()
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

export const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const normalizeMoneyValue = (value: number) => {
  if (!Number.isFinite(value)) return Number.NaN
  const sign = value < 0 ? -1 : 1
  const normalized = sign * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100)
  return Object.is(normalized, -0) ? 0 : normalized
}

export const todayISO = () => new Date().toISOString().slice(0, 10)
export const activityStartISO = () => {
  const date = new Date()
  date.setDate(date.getDate() - 29)
  return date.toISOString().slice(0, 10)
}
export const emptyRows = { receive: [] as SettlementRow[], pay: [] as SettlementRow[] }
export const isCancelled = (status?: string | null) => ['cancelled', 'canceled'].includes(String(status || '').toLowerCase())

export const statusTone = (row: SettlementRow) => {
  if (normalizeMoneyValue(row.outstandingBase) <= 0) return 'border-status-success-border bg-status-success-muted text-status-success-foreground'
  if (row.agingDays > 0) return 'border-status-danger-border bg-status-danger-muted text-status-danger-foreground'
  if (row.settledBase > 0) return 'border-status-info-border bg-status-info-muted text-status-info-foreground'
  return 'border-status-neutral-border bg-status-neutral-muted text-status-neutral-foreground'
}

export const dueTone = (row: SettlementRow) => {
  if (!row.dueDate) return 'text-muted-foreground'
  if (row.agingDays > 0) return 'text-status-danger-foreground'
  return 'text-foreground'
}

export const isFinanceDocumentRow = (row: SettlementRow) => row.kind === 'SI' || row.kind === 'VB'

export const reviewTone = (state: FinanceReviewState) => {
  switch (state) {
    case 'exception':
      return 'border-status-danger-border bg-status-danger-muted text-status-danger-foreground'
    case 'overdue':
      return 'border-status-warning-border bg-status-warning-muted text-status-warning-foreground'
    case 'attention':
      return 'border-status-info-border bg-status-info-muted text-status-info-foreground'
    case 'resolved':
      return 'border-status-success-border bg-status-success-muted text-status-success-foreground'
    default:
      return 'border-border/70 bg-muted/30 text-muted-foreground'
  }
}

export const exceptionSeverityTone = (severity: FinanceReconciliationExceptionRow['severity']) =>
  severity === 'critical'
    ? 'border-status-danger-border bg-status-danger-muted text-status-danger-foreground'
    : 'border-status-warning-border bg-status-warning-muted text-status-warning-foreground'
