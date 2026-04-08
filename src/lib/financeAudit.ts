import { supabase } from './db'
import type {
  FinanceDocumentEventRow,
  SalesCreditNoteRow,
  SalesDebitNoteRow,
  VendorCreditNoteRow,
  VendorDebitNoteRow,
} from './mzFinance'

export type FinanceAuditLang = 'en' | 'pt'

export type AdjustmentReasonDomain =
  | 'sales_credit'
  | 'sales_debit'
  | 'vendor_credit'
  | 'vendor_debit'

export type AdjustmentReasonOption = {
  code: string
  label: string
  help: string
}

export type FinanceActorDirectory = Record<string, string>

export type FinanceSettlementAuditEvent = {
  id: string
  channel: 'cash' | 'bank'
  documentKind: 'sales_invoice' | 'vendor_bill'
  amountBase: number
  happenedAt: string | null
  createdAt: string
  memo: string | null
  actorLabel: string | null
}

export type FinanceTimelineEntry = {
  id: string
  sortAt: string
  occurredAt: string
  title: string
  summary?: string | null
  transition?: string | null
  actorLabel?: string | null
  amount?: string | null
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  href?: string | null
  hrefLabel?: string | null
}

type SupportedNoteRow =
  | SalesCreditNoteRow
  | SalesDebitNoteRow
  | VendorCreditNoteRow
  | VendorDebitNoteRow

const REASON_OPTIONS: Record<AdjustmentReasonDomain, Record<FinanceAuditLang, AdjustmentReasonOption[]>> = {
  sales_credit: {
    en: [
      { code: 'goods_returned', label: 'Goods returned', help: 'Customer returned invoiced goods.' },
      { code: 'service_scope_reduced', label: 'Service scope reduced', help: 'Part of the delivered service was rejected or removed.' },
      { code: 'quality_issue', label: 'Quality issue', help: 'Credit issued because the delivered item or service failed quality expectations.' },
      { code: 'quantity_correction', label: 'Quantity correction', help: 'Credit issued because billed quantity exceeded accepted quantity.' },
      { code: 'commercial_discount', label: 'Commercial discount', help: 'Post-invoice discount or allowance granted to the customer.' },
      { code: 'pricing_error', label: 'Pricing error', help: 'Invoice price was overstated and needs a downward correction.' },
      { code: 'other', label: 'Other', help: 'Use when none of the standard finance reasons fits.' },
    ],
    pt: [
      { code: 'goods_returned', label: 'Mercadoria devolvida', help: 'O cliente devolveu mercadoria já faturada.' },
      { code: 'service_scope_reduced', label: 'Serviço reduzido', help: 'Parte do serviço entregue foi rejeitada ou retirada.' },
      { code: 'quality_issue', label: 'Problema de qualidade', help: 'A nota corrige valor por falha de qualidade do item ou serviço.' },
      { code: 'quantity_correction', label: 'Correção de quantidade', help: 'A quantidade faturada ficou acima da quantidade aceite.' },
      { code: 'commercial_discount', label: 'Desconto comercial', help: 'Desconto ou abatimento concedido depois da emissão.' },
      { code: 'pricing_error', label: 'Erro de preço', help: 'O preço faturado ficou acima do correto.' },
      { code: 'other', label: 'Outro', help: 'Use quando nenhum motivo padrão se aplica.' },
    ],
  },
  sales_debit: {
    en: [
      { code: 'underbilling_correction', label: 'Underbilling correction', help: 'Original invoice understated the legal value.' },
      { code: 'omitted_charge', label: 'Omitted charge', help: 'A charge was missing from the original invoice.' },
      { code: 'additional_service', label: 'Additional service', help: 'Extra service value must now be billed against the same invoice chain.' },
      { code: 'quantity_short_billed', label: 'Quantity short billed', help: 'Accepted quantity exceeded the quantity originally billed.' },
      { code: 'pricing_correction', label: 'Pricing correction', help: 'Original invoice price was too low.' },
      { code: 'tax_correction', label: 'Tax correction', help: 'A tax amount needs an upward correction.' },
      { code: 'other', label: 'Other', help: 'Use when none of the standard finance reasons fits.' },
    ],
    pt: [
      { code: 'underbilling_correction', label: 'Correção de subfaturação', help: 'A fatura original ficou abaixo do valor legal correto.' },
      { code: 'omitted_charge', label: 'Cobrança omitida', help: 'Um encargo ficou fora da fatura original.' },
      { code: 'additional_service', label: 'Serviço adicional', help: 'Há valor adicional de serviço a cobrar na mesma cadeia documental.' },
      { code: 'quantity_short_billed', label: 'Quantidade faturada a menos', help: 'A quantidade aceite foi superior à quantidade faturada.' },
      { code: 'pricing_correction', label: 'Correção de preço', help: 'O preço original ficou abaixo do correto.' },
      { code: 'tax_correction', label: 'Correção de imposto', help: 'O imposto precisa de uma correção para cima.' },
      { code: 'other', label: 'Outro', help: 'Use quando nenhum motivo padrão se aplica.' },
    ],
  },
  vendor_credit: {
    en: [
      { code: 'returned_to_supplier', label: 'Returned to supplier', help: 'Goods or services were returned to the supplier.' },
      { code: 'service_not_accepted', label: 'Service not accepted', help: 'Part of the billed supplier service was rejected.' },
      { code: 'quality_claim', label: 'Quality claim', help: 'Supplier granted a reduction because of a quality issue.' },
      { code: 'quantity_overbilled_reversal', label: 'Overbilled quantity reversal', help: 'Supplier billed more quantity than was accepted.' },
      { code: 'supplier_allowance', label: 'Supplier allowance', help: 'Supplier granted a rebate, allowance, or negotiated reduction.' },
      { code: 'tax_correction', label: 'Tax correction', help: 'Supplier tax value needed a downward correction.' },
      { code: 'other', label: 'Other', help: 'Use when none of the standard finance reasons fits.' },
    ],
    pt: [
      { code: 'returned_to_supplier', label: 'Devolução ao fornecedor', help: 'Mercadoria ou serviço foi devolvido ao fornecedor.' },
      { code: 'service_not_accepted', label: 'Serviço não aceite', help: 'Parte do serviço faturado pelo fornecedor foi rejeitada.' },
      { code: 'quality_claim', label: 'Reclamação de qualidade', help: 'O fornecedor concedeu redução por problema de qualidade.' },
      { code: 'quantity_overbilled_reversal', label: 'Reversão de quantidade faturada a mais', help: 'O fornecedor faturou quantidade acima da aceite.' },
      { code: 'supplier_allowance', label: 'Abatimento do fornecedor', help: 'O fornecedor concedeu um desconto, rebate ou abatimento.' },
      { code: 'tax_correction', label: 'Correção de imposto', help: 'O imposto do fornecedor precisava de correção para baixo.' },
      { code: 'other', label: 'Outro', help: 'Use quando nenhum motivo padrão se aplica.' },
    ],
  },
  vendor_debit: {
    en: [
      { code: 'supplier_additional_charge', label: 'Supplier additional charge', help: 'Supplier added an extra charge after the original bill.' },
      { code: 'short_billed_supplier_correction', label: 'Short-billed correction', help: 'Supplier originally billed less than the accepted liability.' },
      { code: 'freight_or_duty_addition', label: 'Freight or duty addition', help: 'A later freight, customs, or duty amount belongs to the same bill chain.' },
      { code: 'quantity_underbilled_supplier', label: 'Quantity underbilled', help: 'Supplier accepted quantity exceeded the quantity originally billed.' },
      { code: 'tax_correction', label: 'Tax correction', help: 'Supplier tax value needed an upward correction.' },
      { code: 'other', label: 'Other', help: 'Use when none of the standard finance reasons fits.' },
    ],
    pt: [
      { code: 'supplier_additional_charge', label: 'Encargo adicional do fornecedor', help: 'O fornecedor adicionou um encargo depois da fatura original.' },
      { code: 'short_billed_supplier_correction', label: 'Correção de subfaturação do fornecedor', help: 'O fornecedor faturou menos do que a responsabilidade aceite.' },
      { code: 'freight_or_duty_addition', label: 'Acréscimo de frete ou direitos', help: 'Frete, alfândega ou outro custo posterior pertence à mesma cadeia documental.' },
      { code: 'quantity_underbilled_supplier', label: 'Quantidade faturada a menos pelo fornecedor', help: 'A quantidade aceite foi superior à quantidade faturada pelo fornecedor.' },
      { code: 'tax_correction', label: 'Correção de imposto', help: 'O imposto do fornecedor precisava de correção para cima.' },
      { code: 'other', label: 'Outro', help: 'Use quando nenhum motivo padrão se aplica.' },
    ],
  },
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

export function readableIdentity(value?: string | null) {
  const text = normalizeText(value)
  if (!text) return ''
  if (!text.includes('@')) return text
  const [local] = text.split('@')
  const pretty = local.replace(/[._-]+/g, ' ').trim()
  const titled = pretty.replace(/\b\w/g, (char) => char.toUpperCase())
  return titled ? `${titled} (${text})` : text
}

export function getAdjustmentReasonOptions(domain: AdjustmentReasonDomain, lang: FinanceAuditLang) {
  return REASON_OPTIONS[domain][lang]
}

export function getAdjustmentReasonLabel(
  domain: AdjustmentReasonDomain,
  code: string | null | undefined,
  lang: FinanceAuditLang,
) {
  const normalized = normalizeText(code)
  if (!normalized) return ''
  const match = REASON_OPTIONS[domain][lang].find((option) => option.code === normalized)
  return match?.label || normalized
}

export async function listFinanceActorDirectory(companyId: string, userIds: string[] = []) {
  if (!companyId) return {} as FinanceActorDirectory

  let query = supabase
    .from('company_members_with_auth')
    .select('user_id,email')
    .eq('company_id', companyId)

  const distinctUserIds = Array.from(new Set(userIds.filter(Boolean)))
  if (distinctUserIds.length) query = query.in('user_id', distinctUserIds)

  const { data, error } = await query
  if (error) throw error

  return Object.fromEntries(
    (data || [])
      .filter((row) => row.user_id)
      .map((row) => [String(row.user_id), readableIdentity(String(row.email || ''))]),
  ) as FinanceActorDirectory
}

export async function listFinanceSettlementAuditEvents(
  companyId: string,
  documentKind: 'sales_invoice' | 'vendor_bill',
  documentId: string,
) {
  if (!companyId || !documentId) return [] as FinanceSettlementAuditEvent[]

  const refType = documentKind === 'sales_invoice' ? 'SI' : 'VB'
  const [cashRes, bankRes] = await Promise.all([
    supabase
      .from('cash_transactions')
      .select('id,happened_at,amount_base,memo,ref_type,ref_id,created_at,user_ref')
      .eq('company_id', companyId)
      .eq('ref_type', refType)
      .eq('ref_id', documentId)
      .order('created_at', { ascending: false }),
    supabase
      .from('bank_transactions')
      .select('id,happened_at,amount_base,memo,ref_type,ref_id,created_at')
      .eq('ref_type', refType)
      .eq('ref_id', documentId)
      .order('created_at', { ascending: false }),
  ])

  if (cashRes.error) throw cashRes.error
  if (bankRes.error) throw bankRes.error

  const cashRows = (cashRes.data || []).map((row) => ({
    id: String(row.id),
    channel: 'cash' as const,
    documentKind,
    amountBase: Math.abs(Number(row.amount_base || 0)),
    happenedAt: row.happened_at ? String(row.happened_at) : null,
    createdAt: String(row.created_at),
    memo: row.memo ? String(row.memo) : null,
    actorLabel: readableIdentity(row.user_ref ? String(row.user_ref) : ''),
  }))

  const bankRows = (bankRes.data || []).map((row) => ({
    id: String(row.id),
    channel: 'bank' as const,
    documentKind,
    amountBase: Math.abs(Number(row.amount_base || 0)),
    happenedAt: row.happened_at ? String(row.happened_at) : null,
    createdAt: String(row.created_at),
    memo: row.memo ? String(row.memo) : null,
    actorLabel: null,
  }))

  return [...cashRows, ...bankRows].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function humanizeEventKey(value: string) {
  return normalizeText(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function financeEventTitle(eventType: string, lang: FinanceAuditLang) {
  const key = normalizeText(eventType)
  const titles: Record<string, { en: string; pt: string }> = {
    draft_created: { en: 'Draft created', pt: 'Rascunho criado' },
    draft_edited: { en: 'Draft edited', pt: 'Rascunho editado' },
    approval_requested: { en: 'Submitted for approval', pt: 'Enviado para aprovação' },
    approved: { en: 'Approved', pt: 'Aprovado' },
    returned_to_draft: { en: 'Returned to draft', pt: 'Devolvido ao rascunho' },
    issued: { en: 'Issued', pt: 'Emitido' },
    posted: { en: 'Posted', pt: 'Registado' },
    voided: { en: 'Voided', pt: 'Anulado' },
    artifact_registered: { en: 'Archive artifact registered', pt: 'Artefacto de arquivo registado' },
    related_sales_credit_note_created: { en: 'Related credit note created', pt: 'Nota de crédito relacionada criada' },
    related_sales_credit_note_issued: { en: 'Related credit note issued', pt: 'Nota de crédito relacionada emitida' },
    related_sales_debit_note_created: { en: 'Related debit note created', pt: 'Nota de débito relacionada criada' },
    related_sales_debit_note_issued: { en: 'Related debit note issued', pt: 'Nota de débito relacionada emitida' },
    related_vendor_credit_note_created: { en: 'Related supplier credit note created', pt: 'Nota de crédito do fornecedor relacionada criada' },
    related_vendor_credit_note_posted: { en: 'Related supplier credit note posted', pt: 'Nota de crédito do fornecedor relacionada registada' },
    related_vendor_debit_note_created: { en: 'Related supplier debit note created', pt: 'Nota de débito do fornecedor relacionada criada' },
    related_vendor_debit_note_posted: { en: 'Related supplier debit note posted', pt: 'Nota de débito do fornecedor relacionada registada' },
    cash_receipt_recorded: { en: 'Cash receipt recorded', pt: 'Recebimento em caixa registado' },
    bank_receipt_recorded: { en: 'Bank receipt recorded', pt: 'Recebimento bancário registado' },
    cash_payment_recorded: { en: 'Cash payment recorded', pt: 'Pagamento em caixa registado' },
    bank_payment_recorded: { en: 'Bank payment recorded', pt: 'Pagamento bancário registado' },
  }

  return titles[key]?.[lang] || humanizeEventKey(key)
}

export function financeEventTone(eventType: string): FinanceTimelineEntry['tone'] {
  const key = normalizeText(eventType)
  if (key.includes('void')) return 'danger'
  if (key.includes('approved') || key.includes('issued') || key.includes('posted')) return 'success'
  if (key.includes('approval') || key.includes('credit') || key.includes('debit')) return 'warning'
  return 'neutral'
}

export function financeEventSummary(
  event: FinanceDocumentEventRow,
  lang: FinanceAuditLang,
) {
  const payload = event.payload || {}
  const reference = normalizeText(payload.related_reference || payload.primary_reference || payload.internal_reference)
  const amount = normalizeText(payload.amount_base)
  const memo = normalizeText(payload.memo)
  const reasonText = normalizeText(payload.reason_text || payload.correction_reason_text || payload.adjustment_reason_text)

  if (reference && reasonText) return `${reference} - ${reasonText}`
  if (reference && amount) return `${reference} - ${amount}`
  if (reference && memo) return `${reference} - ${memo}`
  if (reference) return reference
  if (reasonText) return reasonText
  if (memo) return memo

  return lang === 'pt' ? 'Sem detalhe adicional' : 'No additional detail'
}

export function financeEventTransition(
  event: FinanceDocumentEventRow,
  lang: FinanceAuditLang,
) {
  const fromStatus = normalizeText(event.from_status)
  const toStatus = normalizeText(event.to_status)
  if (!fromStatus && !toStatus) return null
  if (lang === 'pt') return `${fromStatus || '-'} -> ${toStatus || '-'}`
  return `${fromStatus || '-'} -> ${toStatus || '-'}`
}

export function financeActorLabel(
  actorUserId: string | null | undefined,
  actorDirectory: FinanceActorDirectory,
  lang: FinanceAuditLang,
  explicitLabel?: string | null,
) {
  const explicit = normalizeText(explicitLabel)
  if (explicit) return explicit

  const userId = normalizeText(actorUserId)
  if (userId && actorDirectory[userId]) return actorDirectory[userId]

  return lang === 'pt' ? 'Sistema / não capturado' : 'System / not captured'
}

export function notePrimaryReference(note: SupportedNoteRow) {
  if ('supplier_document_reference' in note) {
    return normalizeText(note.supplier_document_reference) || normalizeText(note.internal_reference)
  }
  return normalizeText(note.internal_reference)
}

export type VendorBillRowLike = {
  id: string
  internal_reference: string
  supplier_invoice_reference: string | null
  primary_reference: string
  purchase_order_id: string | null
  created_by?: string | null
  approval_requested_at?: string | null
  approval_requested_by?: string | null
  approved_at?: string | null
  approved_by?: string | null
  posted_at?: string | null
  posted_by?: string | null
  voided_at?: string | null
  voided_by?: string | null
  void_reason?: string | null
  created_at?: string
}
