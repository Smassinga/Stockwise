export type CustomerReceiptAllocationInput = {
  salesInvoiceId: string
  amountBase: number
}

export type CustomerReceiptExposure = {
  anchorId: string
  dueDate: string | null
  outstandingAmountBase: number
}

export type CustomerReceiptPostingInput = {
  companyId: string
  customerId: string
  receivedOn: string
  amountReceived: number
  currencyCode: string
  paymentChannel: 'cash' | 'bank'
  bankAccountId?: string | null
  externalReference?: string | null
  note?: string | null
  allocations: CustomerReceiptAllocationInput[]
  requestKey: string
}

export type CustomerReceiptErrorCode =
  | 'baseCurrencyOnly'
  | 'overAllocated'
  | 'invoiceOverAllocated'
  | 'customerMismatch'
  | 'creditChanged'
  | 'stale'
  | 'alreadyReversed'
  | 'permissionDenied'
  | 'bankRequired'
  | 'reasonRequired'
  | 'requestConflict'
  | 'unknown'

export function classifyCustomerReceiptError(error: unknown): CustomerReceiptErrorCode {
  const message = String((error as { message?: unknown } | null)?.message || error || '').toLowerCase()
  if (message.includes('receipt_currency_must_equal_company_base')
    || message.includes('receipt_invoice_currency_not_supported')) return 'baseCurrencyOnly'
  if (message.includes('receipt_allocations_exceed_received')) return 'overAllocated'
  if (message.includes('receipt_allocation_exceeds_outstanding')) return 'invoiceOverAllocated'
  if (message.includes('receipt_customer_mismatch')) return 'customerMismatch'
  if (message.includes('receipt_allocation_exceeds_unallocated')) return 'creditChanged'
  if (message.includes('receipt_allocation_already_reversed')) return 'alreadyReversed'
  if (message.includes('allocation_reversal_reason_required')) return 'reasonRequired'
  if (message.includes('receipt_bank_account_required')) return 'bankRequired'
  if (message.includes('idempotency_key_payload_mismatch')
    || message.includes('request_in_progress')) return 'requestConflict'
  if (message.includes('receipt_not_found')
    || message.includes('receipt_invoice_not_found')
    || message.includes('receipt_allocation_not_found')) return 'stale'
  if (message.includes('insufficient_company_role')
    || message.includes('cross_company_access_denied')
    || message.includes('company_access_disabled')) return 'permissionDenied'
  return 'unknown'
}

export const normalizeReceiptMoney = (value: number) => {
  if (!Number.isFinite(value)) return Number.NaN
  const sign = value < 0 ? -1 : 1
  const normalized = sign * (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100)
  return Object.is(normalized, -0) ? 0 : normalized
}

export function summarizeCustomerReceipt(
  amountReceived: number,
  allocations: CustomerReceiptAllocationInput[],
) {
  const received = normalizeReceiptMoney(amountReceived)
  const allocated = normalizeReceiptMoney(
    allocations.reduce((total, allocation) => total + normalizeReceiptMoney(allocation.amountBase), 0),
  )
  return {
    received,
    allocated,
    unallocated: normalizeReceiptMoney(received - allocated),
  }
}

export function allocateCustomerReceiptOldestFirst(
  amountReceived: number,
  exposures: CustomerReceiptExposure[],
) {
  let remaining = normalizeReceiptMoney(amountReceived)
  if (!Number.isFinite(remaining) || remaining <= 0) return []

  return [...exposures]
    .filter((exposure) => normalizeReceiptMoney(exposure.outstandingAmountBase) > 0)
    .sort((left, right) => {
      const leftDate = left.dueDate || '9999-12-31'
      const rightDate = right.dueDate || '9999-12-31'
      return leftDate.localeCompare(rightDate) || left.anchorId.localeCompare(right.anchorId)
    })
    .flatMap((exposure) => {
      if (remaining <= 0) return []
      const amountBase = Math.min(
        remaining,
        normalizeReceiptMoney(exposure.outstandingAmountBase),
      )
      remaining = normalizeReceiptMoney(remaining - amountBase)
      return amountBase > 0 ? [{ salesInvoiceId: exposure.anchorId, amountBase }] : []
    })
}

export function buildCustomerReceiptPostingPayload(input: CustomerReceiptPostingInput) {
  const summary = summarizeCustomerReceipt(input.amountReceived, input.allocations)
  if (!Number.isFinite(summary.received) || summary.received <= 0) {
    throw new Error('receipt_amount_must_be_positive')
  }
  if (summary.unallocated < 0) throw new Error('receipt_allocations_exceed_received')
  if (!input.companyId || !input.customerId || !input.receivedOn || !input.requestKey) {
    throw new Error('receipt_required_fields_missing')
  }
  if (input.paymentChannel === 'bank' && !input.bankAccountId) {
    throw new Error('receipt_bank_account_required')
  }

  const seen = new Set<string>()
  const allocations = input.allocations.map((allocation) => {
    const amountBase = normalizeReceiptMoney(allocation.amountBase)
    if (!allocation.salesInvoiceId || amountBase <= 0 || !Number.isFinite(amountBase)) {
      throw new Error('receipt_allocation_invalid')
    }
    if (seen.has(allocation.salesInvoiceId)) throw new Error('receipt_duplicate_invoice_allocation')
    seen.add(allocation.salesInvoiceId)
    return {
      sales_invoice_id: allocation.salesInvoiceId,
      amount_base: amountBase,
    }
  })

  return {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_received_on: input.receivedOn,
    p_amount_received: summary.received,
    p_currency_code: input.currencyCode.toUpperCase(),
    p_payment_channel: input.paymentChannel,
    p_bank_account_id: input.paymentChannel === 'bank' ? input.bankAccountId : null,
    p_external_reference: input.externalReference?.trim() || null,
    p_note: input.note?.trim() || null,
    p_initial_allocations: allocations,
    p_request_key: input.requestKey,
  }
}
