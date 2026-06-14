import { supabase } from './supabase'

export type OperatorSaleLineInput = {
  itemId: string
  qty: number
  unitPrice?: number | null
}

export type OperatorSettlementMethod = 'cash' | 'bank'

export type OperatorSaleResult = {
  sales_order_id: string
  order_no: string | null
  customer_id: string
  customer_name: string | null
  line_count: number
  total_amount: number
  settlement_method?: OperatorSettlementMethod | null
  settlement_id?: string | null
  settled_amount_base?: number | null
  bank_account_id?: string | null
}

function operatorMessageFromError(message: string) {
  const normalized = message.toLowerCase()

  if (normalized.includes('not_authenticated')) return 'Sign in again before posting the sale.'
  if (normalized.includes('switch into the target company')) return 'Switch into the selected company before posting the sale.'
  if (normalized.includes('operators and above')) return 'Only operators and above can post from Point of Sale.'
  if (normalized.includes('choose a valid source bin')) return 'Choose a valid source bin before posting the sale.'
  if (normalized.includes('does not have enough stock')) return message
  if (normalized.includes('needs a quantity above zero')) return message
  if (normalized.includes('references an unknown item')) return message
  if (normalized.includes('add at least one item')) return 'Add at least one item before posting the sale.'
  if (normalized.includes('choose a bank account before posting a bank pos settlement')) {
    return 'Choose a bank account before completing a bank-paid sale.'
  }
  if (normalized.includes('selected bank account does not belong')) return 'Choose a bank account for the active company.'
  if (normalized.includes('payment destination must be cash or bank')) return 'Choose Cash or Bank before posting the sale.'
  if (normalized.includes('request_key_required') || normalized.includes('idempotency_key_required')) {
    return 'Try posting the sale again. The request was missing a posting key.'
  }
  if (normalized.includes('idempotency_key_payload_mismatch')) {
    return 'This sale changed while it was being posted. Review the cart before trying again.'
  }
  if (normalized.includes('request_in_progress')) return 'This sale is still being processed. Wait a moment, then retry.'
  if (normalized.includes('idempotency_request_failed_use_new_key')) {
    return 'The previous sale attempt failed. Review the cart and start a new posting attempt.'
  }

  return message || 'Could not post the sale.'
}

export async function createOperatorSaleIssue(input: {
  companyId: string
  sourceBinId: string
  customerId?: string | null
  orderDate?: string | null
  currencyCode?: string | null
  fxToBase?: number | null
  referenceNo?: string | null
  notes?: string | null
  settlementMethod?: OperatorSettlementMethod
  bankAccountId?: string | null
  requestKey: string
  lines: OperatorSaleLineInput[]
}) {
  const settlementMethod = input.settlementMethod ?? 'cash'
  const payload = {
    p_company_id: input.companyId,
    p_bin_from_id: input.sourceBinId,
    p_customer_id: input.customerId ?? null,
    p_order_date: input.orderDate ?? null,
    p_currency_code: input.currencyCode ?? 'MZN',
    p_fx_to_base: input.fxToBase ?? 1,
    p_reference_no: input.referenceNo ?? null,
    p_notes: input.notes ?? null,
    p_lines: input.lines.map((line) => ({
      item_id: line.itemId,
      qty: line.qty,
      unit_price: line.unitPrice ?? null,
    })),
    p_settlement_method: settlementMethod,
    p_bank_account_id: settlementMethod === 'bank' ? input.bankAccountId ?? null : null,
    p_request_key: input.requestKey,
  }

  const { data, error } = await supabase.rpc('post_operator_sale', payload)
  if (error) {
    throw new Error(operatorMessageFromError(String(error.message || '')))
  }

  if (Array.isArray(data)) {
    return (data[0] || null) as OperatorSaleResult | null
  }

  return (data || null) as OperatorSaleResult | null
}
