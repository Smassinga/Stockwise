import { supabase } from './supabase'
import type { Locale } from './i18n'

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
  subtotal?: number
  tax_total?: number
  pos_tax_mode_snapshot?: 'configured' | 'non_fiscal' | null
}

export type OperatorSalePreviewLine = {
  line_no: number
  item_id: string
  subtotal: number
  tax_option_code: string
  tax_treatment: 'standard' | 'zero' | 'exempt' | 'non_fiscal'
  tax_label: string
  tax_rate: number
  tax_amount: number
  total: number
}

export type OperatorSalePreview = {
  ready: boolean
  mode: 'configured' | 'non_fiscal' | null
  mode_label?: string | null
  blockers: string[]
  tax_option_code?: string | null
  tax_treatment?: OperatorSalePreviewLine['tax_treatment'] | null
  tax_label?: string | null
  tax_rate?: number | null
  requires_exemption_reason?: boolean
  exemption_reason_configured?: boolean
  line_count?: number
  subtotal: number
  tax_total: number
  total: number
  settled_amount_base: number
  settlement_method?: OperatorSettlementMethod
  bank_account_id?: string | null
  lines: OperatorSalePreviewLine[]
}

const TAX_ERROR_MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    commercial_tax_pos_mode_unconfigured: 'Point of Sale tax handling has not been configured. Ask a company administrator to complete the setup.',
    commercial_tax_pos_default_unconfigured: 'The configured Point of Sale tax mode needs an active default sales-tax option.',
    commercial_tax_pos_default_inactive: 'The default Point of Sale sales-tax option is not active for this sale date.',
    commercial_tax_pos_exemption_reason_required: 'The configured Point of Sale tax option requires an exemption reason in company Settings.',
    commercial_tax_non_fiscal_pos_invoice_forbidden: 'This Point of Sale transaction is non-fiscal and cannot be converted into a fiscal sales invoice.',
  },
  pt: {
    commercial_tax_pos_mode_unconfigured: 'O tratamento fiscal do Ponto de Venda ainda não foi configurado. Peça a um administrador da empresa para concluir a configuração.',
    commercial_tax_pos_default_unconfigured: 'O modo fiscal configurado para o Ponto de Venda exige uma opção predefinida de imposto sobre vendas ativa.',
    commercial_tax_pos_default_inactive: 'A opção predefinida de imposto sobre vendas do Ponto de Venda não está ativa para a data desta venda.',
    commercial_tax_pos_exemption_reason_required: 'A opção fiscal configurada para o Ponto de Venda exige um motivo de isenção nas Definições da empresa.',
    commercial_tax_non_fiscal_pos_invoice_forbidden: 'Esta transação do Ponto de Venda é não fiscal e não pode ser convertida numa fatura fiscal.',
  },
}

export function operatorSaleBlockerMessage(code: string, language: Locale = 'en') {
  return TAX_ERROR_MESSAGES[language][code] || null
}

function operatorMessageFromError(message: string, language: Locale = 'en') {
  const normalized = message.toLowerCase()
  const code = normalized.match(/commercial_tax_[a-z0-9_]+/)?.[0]
  if (code && TAX_ERROR_MESSAGES[language][code]) return TAX_ERROR_MESSAGES[language][code]

  if (normalized.includes('not_authenticated')) return 'Sign in again before posting the sale.'
  if (normalized.includes('switch into the target company')) return 'Switch into the selected company before posting the sale.'
  if (normalized.includes('operators and above')) return 'Only operators and above can post from Point of Sale.'
  if (normalized.includes('choose a valid source bin') || normalized.includes('commercial_tax_pos_source_bin_invalid')) return 'Choose a valid source bin before posting the sale.'
  if (normalized.includes('does not have enough stock') || normalized.includes('commercial_tax_pos_stock_insufficient')) return message
  if (normalized.includes('needs a quantity above zero') || normalized.includes('commercial_tax_pos_line_amount_invalid')) return message
  if (normalized.includes('references an unknown item') || normalized.includes('commercial_tax_pos_item_invalid')) return message
  if (normalized.includes('add at least one item') || normalized.includes('commercial_tax_pos_lines_required')) return 'Add at least one item before posting the sale.'
  if (normalized.includes('choose a bank account before posting a bank pos settlement') || normalized.includes('commercial_tax_pos_bank_required')) {
    return 'Choose a bank account before completing a bank-paid sale.'
  }
  if (normalized.includes('selected bank account does not belong') || normalized.includes('commercial_tax_pos_bank_invalid')) return 'Choose a bank account for the active company.'
  if (normalized.includes('payment destination must be cash or bank') || normalized.includes('commercial_tax_pos_payment_method_invalid')) return 'Choose Cash or Bank before posting the sale.'
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

export async function previewOperatorSale(input: {
  companyId: string
  sourceBinId: string
  customerId?: string | null
  orderDate?: string
  currencyCode?: string
  fxToBase?: number
  lines: OperatorSaleLineInput[]
  settlementMethod?: OperatorSettlementMethod
  bankAccountId?: string | null
  language?: Locale
}) {
  const settlementMethod = input.settlementMethod ?? 'cash'
  const { data, error } = await supabase.rpc('preview_operator_sale', {
    p_company_id: input.companyId,
    p_bin_from_id: input.sourceBinId,
    p_customer_id: input.customerId ?? null,
    p_order_date: input.orderDate ?? new Date().toISOString().slice(0, 10),
    p_currency_code: input.currencyCode ?? 'MZN',
    p_fx_to_base: input.fxToBase ?? 1,
    p_lines: input.lines.map((line) => ({
      item_id: line.itemId,
      qty: line.qty,
      unit_price: line.unitPrice ?? null,
    })),
    p_settlement_method: settlementMethod,
    p_bank_account_id: settlementMethod === 'bank' ? input.bankAccountId ?? null : null,
  })
  if (error) throw new Error(operatorMessageFromError(String(error.message || ''), input.language))
  return data as OperatorSalePreview
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
  language?: Locale
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
  if (error) throw new Error(operatorMessageFromError(String(error.message || ''), input.language))
  const result = (Array.isArray(data) ? data[0] : data) as OperatorSaleResult | null
  if (!result?.sales_order_id) return result

  const { data: order, error: orderError } = await supabase
    .from('sales_orders')
    .select('subtotal,tax_total,total_amount,pos_tax_mode_snapshot')
    .eq('company_id', input.companyId)
    .eq('id', result.sales_order_id)
    .single()
  if (orderError) return result

  return {
    ...result,
    subtotal: Number(order.subtotal || 0),
    tax_total: Number(order.tax_total || 0),
    total_amount: Number(order.total_amount || result.total_amount || 0),
    pos_tax_mode_snapshot: order.pos_tax_mode_snapshot as OperatorSaleResult['pos_tax_mode_snapshot'],
  }
}
