import { supabase } from './supabase'

export type OperatorSaleLineInput = {
  itemId: string
  qty: number
  unitPrice?: number | null
}

export type OperatorSaleResult = {
  sales_order_id: string
  order_no: string | null
  customer_id: string
  customer_name: string | null
  line_count: number
  total_amount: number
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
  lines: OperatorSaleLineInput[]
}) {
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
  }

  const { data, error } = await supabase.rpc('create_operator_sale_issue', payload)
  if (error) {
    throw new Error(operatorMessageFromError(String(error.message || '')))
  }

  if (Array.isArray(data)) {
    return (data[0] || null) as OperatorSaleResult | null
  }

  return (data || null) as OperatorSaleResult | null
}
