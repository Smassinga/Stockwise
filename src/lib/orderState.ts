export type OrderSettlementStatus =
  | 'unsettled'
  | 'partially_settled'
  | 'settled'
  | 'overdue'

export type SalesOrderWorkflowStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'cancelled'

export type SalesOrderFulfilmentStatus =
  | 'not_started'
  | 'partial'
  | 'complete'

export type PurchaseOrderWorkflowStatus =
  | 'draft'
  | 'approved'
  | 'cancelled'

export type PurchaseOrderReceiptStatus =
  | 'not_started'
  | 'partial'
  | 'complete'

export type LegacyFinancialAnchor = 'legacy_order_link'

type BaseOrderStateRow = {
  id: string
  company_id: string
  order_no: string | null
  legacy_status: string
  order_date: string | null
  due_date: string | null
  counterparty_name: string | null
  currency_code: string | null
  fx_to_base: number | null
  subtotal_amount_ccy: number | null
  tax_amount_ccy: number | null
  total_amount_ccy: number | null
  total_amount_base: number | null
  legacy_cash_settled_base: number | null
  legacy_bank_settled_base: number | null
  legacy_outstanding_base: number | null
  settlement_status: OrderSettlementStatus
  financial_anchor: LegacyFinancialAnchor
}

export type SalesOrderStateRow = BaseOrderStateRow & {
  workflow_status: SalesOrderWorkflowStatus
  fulfilment_status: SalesOrderFulfilmentStatus
  invoicing_status: string | null
  legacy_settled_base: number | null
}

export type PurchaseOrderStateRow = BaseOrderStateRow & {
  workflow_status: PurchaseOrderWorkflowStatus
  receipt_status: PurchaseOrderReceiptStatus
  billing_status: string | null
  legacy_paid_base: number | null
}

export const SALES_ORDER_STATE_VIEW = 'v_sales_order_state'
export const PURCHASE_ORDER_STATE_VIEW = 'v_purchase_order_state'

export function salesWorkflowLabelKey(status?: SalesOrderWorkflowStatus | null) {
  switch (status) {
    case 'draft':
      return 'orders.draftStatus'
    case 'awaiting_approval':
      return 'orders.awaitingApprovalStatus'
    case 'approved':
      return 'orders.approvedStatus'
    case 'cancelled':
      return 'orders.cancelledStatus'
    default:
      return 'orders.status.unknown'
  }
}

export function salesFulfilmentLabelKey(status?: SalesOrderFulfilmentStatus | null) {
  switch (status) {
    case 'not_started':
      return 'orders.fulfilmentNotStarted'
    case 'partial':
      return 'orders.fulfilmentPartial'
    case 'complete':
      return 'orders.fulfilmentComplete'
    default:
      return 'orders.status.unknown'
  }
}

export function purchaseWorkflowLabelKey(status?: PurchaseOrderWorkflowStatus | null) {
  switch (status) {
    case 'draft':
      return 'orders.draftStatus'
    case 'approved':
      return 'orders.approvedStatus'
    case 'cancelled':
      return 'orders.cancelledStatus'
    default:
      return 'orders.status.unknown'
  }
}

export function purchaseReceiptLabelKey(status?: PurchaseOrderReceiptStatus | null) {
  switch (status) {
    case 'not_started':
      return 'orders.receiptNotStarted'
    case 'partial':
      return 'orders.receiptPartial'
    case 'complete':
      return 'orders.receiptComplete'
    default:
      return 'orders.status.unknown'
  }
}

export function settlementLabelKey(status?: OrderSettlementStatus | null) {
  switch (status) {
    case 'unsettled':
      return 'orders.settlementUnsettled'
    case 'partially_settled':
      return 'orders.settlementPartial'
    case 'settled':
      return 'orders.settlementSettled'
    case 'overdue':
      return 'orders.settlementOverdue'
    default:
      return 'orders.status.unknown'
  }
}

export function legacySalesWorkflowStatus(status?: string | null): SalesOrderWorkflowStatus {
  const value = String(status || '').toLowerCase()
  if (value === 'draft') return 'draft'
  if (value === 'submitted') return 'awaiting_approval'
  if (value === 'cancelled' || value === 'canceled') return 'cancelled'
  return 'approved'
}

export function legacyPurchaseWorkflowStatus(status?: string | null): PurchaseOrderWorkflowStatus {
  const value = String(status || '').toLowerCase()
  if (value === 'draft') return 'draft'
  if (value === 'cancelled' || value === 'canceled') return 'cancelled'
  return 'approved'
}

export function legacySalesFulfilmentStatus(status?: string | null): SalesOrderFulfilmentStatus {
  const value = String(status || '').toLowerCase()
  if (value === 'shipped' || value === 'closed') return 'complete'
  return 'not_started'
}

export function legacyPurchaseReceiptStatus(status?: string | null): PurchaseOrderReceiptStatus {
  const value = String(status || '').toLowerCase()
  if (value === 'closed') return 'complete'
  if (value === 'partially_received') return 'partial'
  return 'not_started'
}
