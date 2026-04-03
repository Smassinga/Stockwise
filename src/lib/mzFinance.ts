import { supabase } from './supabase'

export type CompanyFiscalSettingsRow = {
  company_id: string
  jurisdiction_code: string
  invoice_series_code: string
  credit_note_series_code: string
  debit_note_series_code: string
  computer_processed_phrase_text: string
  document_language_code: string
  presentation_currency_code: string
  saft_moz_enabled: boolean
  archive_retention_years: number
  compliance_rule_version: string
  homologation_reference: string | null
  created_at: string
  updated_at: string
}

export type FinanceDocumentFiscalSeriesRow = {
  id: string
  company_id: string
  document_type: 'sales_invoice' | 'sales_credit_note' | 'sales_debit_note'
  series_code: string
  fiscal_year: number
  next_number: number
  is_active: boolean
  valid_from: string | null
  valid_to: string | null
  created_at: string
  updated_at: string
}

export type SalesInvoiceDocumentRow = {
  id: string
  company_id: string
  sales_order_id: string | null
  customer_id: string | null
  internal_reference: string
  source_origin: 'native' | 'imported'
  moz_document_code: 'INV'
  fiscal_series_code: string | null
  fiscal_year: number | null
  fiscal_sequence_number: number | null
  invoice_date: string
  due_date: string
  currency_code: string
  fx_to_base: number
  subtotal: number
  tax_total: number
  total_amount: number
  subtotal_mzn: number
  tax_total_mzn: number
  total_amount_mzn: number
  seller_legal_name_snapshot: string | null
  seller_trade_name_snapshot: string | null
  seller_nuit_snapshot: string | null
  seller_address_line1_snapshot: string | null
  seller_address_line2_snapshot: string | null
  seller_city_snapshot: string | null
  seller_state_snapshot: string | null
  seller_postal_code_snapshot: string | null
  seller_country_code_snapshot: string | null
  buyer_legal_name_snapshot: string | null
  buyer_nuit_snapshot: string | null
  buyer_address_line1_snapshot: string | null
  buyer_address_line2_snapshot: string | null
  buyer_city_snapshot: string | null
  buyer_state_snapshot: string | null
  buyer_postal_code_snapshot: string | null
  buyer_country_code_snapshot: string | null
  document_language_code_snapshot: string | null
  computer_processed_phrase_snapshot: string | null
  vat_exemption_reason_text: string | null
  compliance_rule_version_snapshot: string | null
  document_workflow_status: 'draft' | 'issued' | 'voided'
  issued_at: string | null
  issued_by: string | null
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type SalesInvoiceDraftPreview = {
  seller_legal_name: string | null
  seller_trade_name: string | null
  seller_nuit: string | null
  seller_address_line1: string | null
  seller_address_line2: string | null
  seller_city: string | null
  seller_state: string | null
  seller_postal_code: string | null
  seller_country_code: string | null
  buyer_legal_name: string | null
  buyer_nuit: string | null
  buyer_address_line1: string | null
  buyer_address_line2: string | null
  buyer_city: string | null
  buyer_state: string | null
  buyer_postal_code: string | null
  buyer_country_code: string | null
  computer_processed_phrase: string | null
  document_language_code: string | null
}

export type SalesInvoiceDocumentLineRow = {
  id: string
  company_id: string
  sales_invoice_id: string
  sales_order_line_id: string | null
  item_id: string | null
  description: string
  qty: number
  unit_price: number
  tax_rate: number | null
  tax_amount: number
  line_total: number
  product_code_snapshot: string | null
  unit_of_measure_snapshot: string | null
  tax_category_code: string | null
  sort_order: number
  created_at: string
  updated_at: string
  display_description?: string
  display_unit_of_measure?: string | null
}

export type SalesCreditNoteRow = {
  id: string
  company_id: string
  original_sales_invoice_id: string
  customer_id: string | null
  internal_reference: string
  source_origin: 'native' | 'imported'
  moz_document_code: 'NC'
  fiscal_series_code: string | null
  fiscal_year: number | null
  fiscal_sequence_number: number | null
  credit_note_date: string
  due_date: string | null
  currency_code: string
  fx_to_base: number
  subtotal: number
  tax_total: number
  total_amount: number
  subtotal_mzn: number
  tax_total_mzn: number
  total_amount_mzn: number
  correction_reason_code: string | null
  correction_reason_text: string
  vat_exemption_reason_text: string | null
  document_workflow_status: 'draft' | 'issued' | 'voided'
  issued_at: string | null
  seller_legal_name_snapshot: string | null
  seller_trade_name_snapshot: string | null
  seller_nuit_snapshot: string | null
  seller_address_line1_snapshot: string | null
  seller_address_line2_snapshot: string | null
  seller_city_snapshot: string | null
  seller_state_snapshot: string | null
  seller_postal_code_snapshot: string | null
  seller_country_code_snapshot: string | null
  buyer_legal_name_snapshot: string | null
  buyer_nuit_snapshot: string | null
  buyer_address_line1_snapshot: string | null
  buyer_address_line2_snapshot: string | null
  buyer_city_snapshot: string | null
  buyer_state_snapshot: string | null
  buyer_postal_code_snapshot: string | null
  buyer_country_code_snapshot: string | null
  document_language_code_snapshot: string | null
  computer_processed_phrase_snapshot: string | null
  compliance_rule_version_snapshot: string | null
  created_at: string
  updated_at: string
}

export type SalesCreditNoteLineRow = {
  id: string
  company_id: string
  sales_credit_note_id: string
  sales_invoice_line_id: string | null
  item_id: string | null
  description: string
  qty: number
  unit_price: number
  tax_rate: number | null
  tax_amount: number
  line_total: number
  product_code_snapshot: string | null
  unit_of_measure_snapshot: string | null
  tax_category_code: string | null
  sort_order: number
  created_at: string
  updated_at: string
  display_description?: string
  display_unit_of_measure?: string | null
}

export type SalesCreditNoteDraftLineInput = {
  salesInvoiceLineId: string
  itemId?: string | null
  description?: string | null
  qty: number
  unitPrice?: number | null
  taxRate?: number | null
  taxAmount: number
  lineTotal: number
  sortOrder?: number | null
}

export type SalesDebitNoteRow = {
  id: string
  company_id: string
  original_sales_invoice_id: string
  customer_id: string | null
  internal_reference: string
  source_origin: 'native' | 'imported'
  moz_document_code: 'ND'
  fiscal_series_code: string | null
  fiscal_year: number | null
  fiscal_sequence_number: number | null
  debit_note_date: string
  due_date: string
  currency_code: string
  fx_to_base: number
  subtotal: number
  tax_total: number
  total_amount: number
  subtotal_mzn: number
  tax_total_mzn: number
  total_amount_mzn: number
  correction_reason_code: string | null
  correction_reason_text: string
  seller_legal_name_snapshot: string | null
  seller_trade_name_snapshot: string | null
  seller_nuit_snapshot: string | null
  seller_address_line1_snapshot: string | null
  seller_address_line2_snapshot: string | null
  seller_city_snapshot: string | null
  seller_state_snapshot: string | null
  seller_postal_code_snapshot: string | null
  seller_country_code_snapshot: string | null
  buyer_legal_name_snapshot: string | null
  buyer_nuit_snapshot: string | null
  buyer_address_line1_snapshot: string | null
  buyer_address_line2_snapshot: string | null
  buyer_city_snapshot: string | null
  buyer_state_snapshot: string | null
  buyer_postal_code_snapshot: string | null
  buyer_country_code_snapshot: string | null
  document_language_code_snapshot: string | null
  computer_processed_phrase_snapshot: string | null
  compliance_rule_version_snapshot: string | null
  document_workflow_status: 'draft' | 'issued' | 'voided'
  issued_at: string | null
  created_at: string
  updated_at: string
}

export type SalesDebitNoteLineRow = {
  id: string
  company_id: string
  sales_debit_note_id: string
  sales_invoice_line_id: string | null
  item_id: string | null
  description: string
  qty: number
  unit_price: number
  tax_rate: number | null
  tax_amount: number
  line_total: number
  product_code_snapshot: string | null
  unit_of_measure_snapshot: string | null
  tax_category_code: string | null
  sort_order: number
  created_at: string
  updated_at: string
  display_description?: string
  display_unit_of_measure?: string | null
}

export type SalesDebitNoteDraftLineInput = {
  salesInvoiceLineId: string
  itemId?: string | null
  description?: string | null
  qty: number
  unitPrice?: number | null
  taxRate?: number | null
  taxAmount: number
  lineTotal: number
  sortOrder?: number | null
}

export type CreateSalesDebitNoteInput = {
  correctionReasonText: string
  debitNoteDate?: string | null
  dueDate?: string | null
  lines: SalesDebitNoteDraftLineInput[]
}

export type CreateSalesCreditNoteInput = {
  correctionReasonText: string
  vatExemptionReasonText?: string | null
  creditNoteDate?: string | null
  lines: SalesCreditNoteDraftLineInput[]
}

export type FinanceDocumentEventRow = {
  id: string
  company_id: string
  document_kind: 'sales_invoice' | 'sales_credit_note' | 'sales_debit_note' | 'vendor_bill' | 'saft_moz_export'
  document_id: string
  event_type: string
  from_status: string | null
  to_status: string | null
  actor_user_id: string | null
  payload: Record<string, any>
  occurred_at: string
}

export type FiscalDocumentArtifactRow = {
  id: string
  company_id: string
  document_kind: 'sales_invoice' | 'sales_credit_note' | 'sales_debit_note'
  document_id: string
  artifact_type: 'pdf' | 'xml' | 'imported_source'
  storage_bucket: string | null
  storage_path: string
  file_name: string | null
  mime_type: string | null
  content_sha256: string | null
  size_bytes: number | null
  is_canonical: boolean
  retained_until: string | null
  created_by: string | null
  created_at: string
}

export type SaftMozExportRow = {
  id: string
  company_id: string
  period_start: string
  period_end: string
  status: 'pending' | 'generated' | 'submitted' | 'failed'
  requested_by: string | null
  generated_by: string | null
  generated_at: string | null
  submitted_by: string | null
  submitted_at: string | null
  submission_reference: string | null
  storage_bucket: string | null
  storage_path: string | null
  file_name: string | null
  mime_type: string | null
  file_sha256: string | null
  size_bytes: number | null
  source_document_count: number
  source_total_mzn: number
  error_message: string | null
  created_at: string
}

type SalesOrderDraftSource = {
  id: string
  company_id: string
  customer_id: string | null
  order_no: string | null
  status: string | null
  currency_code: string | null
  fx_to_base: number | null
  order_date: string | null
  due_date: string | null
  tax_total: number | null
}

type SalesOrderLineDraftSource = {
  id: string
  so_id: string
  item_id: string | null
  description: string | null
  line_no: number | null
  qty: number | null
  unit_price: number | null
  discount_pct: number | null
  line_total: number | null
}

type ItemDisplaySource = {
  id: string
  name: string | null
  sku: string | null
  base_uom_id: string | null
}

type SalesOrderLineDisplaySource = {
  id: string
  description: string | null
  uom_id: string | null
}

type UomDisplaySource = {
  id: string
  code: string | null
}

type SalesInvoiceDraftPreviewSource = Pick<SalesInvoiceDocumentRow, 'company_id' | 'sales_order_id' | 'customer_id'>

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function toNumber(value: number | string | null | undefined, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function looksLikeUuid(value: string | null | undefined) {
  return UUID_LIKE_PATTERN.test(normalizeText(value))
}

function isUnsafeDisplayText(value: string | null | undefined) {
  const text = normalizeText(value)
  return !text
    || text === '-'
    || text === '—'
    || looksLikeUuid(text)
    || ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))
}

function pickDisplayText(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (!isUnsafeDisplayText(text)) return text
  }

  for (const candidate of candidates) {
    const text = normalizeText(candidate)
    if (text) return text
  }

  return ''
}

function resolveInvoiceLineDescription(
  lineDescription?: string | null,
  orderLineDescription?: string | null,
  itemName?: string | null,
  itemSku?: string | null,
) {
  return pickDisplayText(lineDescription, orderLineDescription, itemName, itemSku) || 'Item'
}

function resolveInvoiceLineUnitOfMeasure(
  snapshot?: string | null,
  orderLineUomCode?: string | null,
  itemBaseUomCode?: string | null,
) {
  const snapshotText = normalizeText(snapshot)
  if (snapshotText && !looksLikeUuid(snapshotText)) return snapshotText
  return pickDisplayText(orderLineUomCode, itemBaseUomCode, snapshotText) || null
}

function parseNativeSalesInvoiceReference(internalReference: string | null | undefined) {
  const match = normalizeText(internalReference).match(/^[A-Z0-9]{3}-([A-Z0-9]{2,10})(\d{4})-(\d{5})$/)
  if (!match) return null

  return {
    fiscal_series_code: match[1],
    fiscal_year: Number(match[2]),
    fiscal_sequence_number: Number(match[3]),
  }
}

function mzRuntimeDebugEnabled() {
  try {
    return Boolean(import.meta.env.DEV || globalThis.localStorage?.getItem('stockwise:debug:mz') === '1')
  } catch {
    return false
  }
}

function mzRuntimeDebug(event: string, context: Record<string, unknown>) {
  if (!mzRuntimeDebugEnabled()) return
  console.debug(`[mz-runtime] ${event}`, context)
}

function mzRuntimeError(event: string, error: unknown, context: Record<string, unknown>) {
  console.error(`[mz-runtime] ${event}`, {
    ...context,
    error,
  })
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}

function fallbackLineTotal(line: SalesOrderLineDraftSource) {
  const qty = toNumber(line.qty)
  const unitPrice = toNumber(line.unit_price)
  const discountPct = toNumber(line.discount_pct)
  return roundMoney(qty * unitPrice * (1 - discountPct / 100))
}

function allocateHeaderTaxAmounts(lineTotals: number[], headerTaxTotal: number) {
  if (headerTaxTotal <= 0 || !lineTotals.length) {
    return lineTotals.map(() => 0)
  }

  const subtotal = roundMoney(lineTotals.reduce((sum, value) => sum + value, 0))
  if (subtotal <= 0) {
    throw new Error('A positive subtotal is required before tax can be allocated to invoice lines.')
  }

  const allocations: number[] = []
  let allocated = 0

  lineTotals.forEach((lineTotal, index) => {
    if (index === lineTotals.length - 1) {
      allocations.push(roundMoney(headerTaxTotal - allocated))
      return
    }

    const amount = roundMoney((lineTotal / subtotal) * headerTaxTotal)
    allocations.push(amount)
    allocated = roundMoney(allocated + amount)
  })

  return allocations
}

function normalizeDueDate(order: SalesOrderDraftSource) {
  const invoiceDate = isoToday()
  const candidate = order.due_date && order.due_date >= invoiceDate ? order.due_date : invoiceDate
  return {
    invoiceDate,
    dueDate: candidate,
  }
}

function humanizeRuntimeError(error: any, fallback: string, stage: string) {
  const message = String(error?.message || '').trim()
  const details = String(error?.details || '').trim()
  const hint = String(error?.hint || '').trim()
  const code = String(error?.code || '').trim()
  const parts = [message]

  if (details && details !== message) parts.push(details)
  if (hint) parts.push(`hint: ${hint}`)

  const stageLabel = code ? `${stage}.${code}` : stage
  if (!parts.filter(Boolean).length) return `${fallback} [${stageLabel}]`
  return `${fallback} [${stageLabel}]: ${parts.filter(Boolean).join(' | ')}`
}

function allowedSalesOrderForInvoice(status?: string | null) {
  return ['confirmed', 'allocated', 'shipped', 'closed'].includes(String(status || '').toLowerCase())
}

async function maybeVoidDraftInvoice(companyId: string, invoiceId: string, reason: string) {
  await supabase
    .from('sales_invoices')
    .update({
      document_workflow_status: 'voided',
      void_reason: reason,
    })
    .eq('company_id', companyId)
    .eq('id', invoiceId)
}

async function maybeVoidDraftCreditNote(companyId: string, noteId: string, reason: string) {
  await supabase
    .from('sales_credit_notes')
    .update({
      document_workflow_status: 'voided',
      void_reason: reason,
    })
    .eq('company_id', companyId)
    .eq('id', noteId)
}

async function maybeVoidDraftDebitNote(companyId: string, noteId: string, reason: string) {
  await supabase
    .from('sales_debit_notes')
    .update({
      document_workflow_status: 'voided',
      void_reason: reason,
    })
    .eq('company_id', companyId)
    .eq('id', noteId)
}

export async function getCompanyFiscalSettings(companyId: string) {
  mzRuntimeDebug('companyFiscalSettings.load.start', { companyId })
  const { data, error } = await supabase
    .from('company_fiscal_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle<CompanyFiscalSettingsRow>()

  if (error) {
    mzRuntimeError('companyFiscalSettings.load.failed', error, { companyId })
    throw error
  }
  mzRuntimeDebug('companyFiscalSettings.load.success', { companyId, found: Boolean(data) })
  return data
}

export async function listCompanyFiscalSeries(companyId: string, fiscalYear?: number | null) {
  mzRuntimeDebug('fiscalSeries.load.start', { companyId, fiscalYear: fiscalYear ?? null })
  let query = supabase
    .from('finance_document_fiscal_series')
    .select('*')
    .eq('company_id', companyId)
    .order('fiscal_year', { ascending: false })
    .order('document_type', { ascending: true })
    .order('series_code', { ascending: true })

  if (fiscalYear) query = query.eq('fiscal_year', fiscalYear)

  const { data, error } = await query

  if (error) {
    mzRuntimeError('fiscalSeries.load.failed', error, { companyId, fiscalYear: fiscalYear ?? null })
    throw error
  }
  mzRuntimeDebug('fiscalSeries.load.success', { companyId, fiscalYear: fiscalYear ?? null, rowCount: data?.length ?? 0 })
  return (data || []) as FinanceDocumentFiscalSeriesRow[]
}

export async function listSaftMozExports(companyId: string) {
  mzRuntimeDebug('saftExports.load.start', { companyId })
  const { data, error } = await supabase
    .from('saft_moz_exports')
    .select('*')
    .eq('company_id', companyId)
    .order('period_start', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    mzRuntimeError('saftExports.load.failed', error, { companyId })
    throw error
  }
  mzRuntimeDebug('saftExports.load.success', { companyId, rowCount: data?.length ?? 0 })
  return (data || []) as SaftMozExportRow[]
}

export async function listFinanceEvents(
  companyId: string,
  documentKind?: FinanceDocumentEventRow['document_kind'],
  documentId?: string,
) {
  mzRuntimeDebug('financeEvents.load.start', {
    companyId,
    documentKind: documentKind ?? null,
    documentId: documentId ?? null,
  })
  let query = supabase
    .from('finance_document_events')
    .select('*')
    .eq('company_id', companyId)
    .order('occurred_at', { ascending: false })

  if (documentKind) query = query.eq('document_kind', documentKind)
  if (documentId) query = query.eq('document_id', documentId)

  const { data, error } = await query.limit(documentId ? 50 : 25)

  if (error) {
    mzRuntimeError('financeEvents.load.failed', error, {
      companyId,
      documentKind: documentKind ?? null,
      documentId: documentId ?? null,
    })
    throw error
  }
  mzRuntimeDebug('financeEvents.load.success', {
    companyId,
    documentKind: documentKind ?? null,
    documentId: documentId ?? null,
    rowCount: data?.length ?? 0,
  })
  return (data || []) as FinanceDocumentEventRow[]
}

export async function listFiscalArtifacts(
  companyId: string,
  documentKind?: FiscalDocumentArtifactRow['document_kind'],
  documentId?: string,
) {
  mzRuntimeDebug('fiscalArtifacts.load.start', {
    companyId,
    documentKind: documentKind ?? null,
    documentId: documentId ?? null,
  })
  let query = supabase
    .from('fiscal_document_artifacts')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (documentKind) query = query.eq('document_kind', documentKind)
  if (documentId) query = query.eq('document_id', documentId)

  const { data, error } = await query.limit(documentId ? 25 : 20)

  if (error) {
    mzRuntimeError('fiscalArtifacts.load.failed', error, {
      companyId,
      documentKind: documentKind ?? null,
      documentId: documentId ?? null,
    })
    throw error
  }
  mzRuntimeDebug('fiscalArtifacts.load.success', {
    companyId,
    documentKind: documentKind ?? null,
    documentId: documentId ?? null,
    rowCount: data?.length ?? 0,
  })
  return (data || []) as FiscalDocumentArtifactRow[]
}

export async function getSalesInvoiceDocument(companyId: string, invoiceId: string) {
  mzRuntimeDebug('salesInvoice.load.start', { companyId, invoiceId })
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', invoiceId)
    .maybeSingle<SalesInvoiceDocumentRow>()

  if (error) {
    mzRuntimeError('salesInvoice.load.failed', error, { companyId, invoiceId })
    throw error
  }
  mzRuntimeDebug('salesInvoice.load.success', { companyId, invoiceId, found: Boolean(data) })
  return data
}

export async function getSalesInvoiceDraftPreview(
  companyId: string,
  invoice: SalesInvoiceDraftPreviewSource,
) {
  mzRuntimeDebug('salesInvoiceDraftPreview.load.start', {
    companyId,
    salesOrderId: invoice.sales_order_id,
    customerId: invoice.customer_id,
  })

  const [companyRes, settingsRes, orderRes, customerRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id,name,trade_name,legal_name,tax_id,address_line1,address_line2,city,state,postal_code,country_code')
      .eq('id', companyId)
      .maybeSingle(),
    supabase
      .from('company_fiscal_settings')
      .select('computer_processed_phrase_text,document_language_code')
      .eq('company_id', companyId)
      .maybeSingle(),
    invoice.sales_order_id
      ? supabase
          .from('sales_orders')
          .select('id,bill_to_name,bill_to_tax_id,bill_to_billing_address,bill_to_shipping_address')
          .eq('company_id', companyId)
          .eq('id', invoice.sales_order_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    invoice.customer_id
      ? supabase
          .from('customers')
          .select('id,name,tax_id,billing_address,shipping_address')
          .eq('company_id', companyId)
          .eq('id', invoice.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (companyRes.error) {
    mzRuntimeError('salesInvoiceDraftPreview.companyLoad.failed', companyRes.error, { companyId })
    throw companyRes.error
  }
  if (settingsRes.error) {
    mzRuntimeError('salesInvoiceDraftPreview.settingsLoad.failed', settingsRes.error, { companyId })
    throw settingsRes.error
  }
  if (orderRes.error) {
    mzRuntimeError('salesInvoiceDraftPreview.orderLoad.failed', orderRes.error, {
      companyId,
      salesOrderId: invoice.sales_order_id,
    })
    throw orderRes.error
  }
  if (customerRes.error) {
    mzRuntimeError('salesInvoiceDraftPreview.customerLoad.failed', customerRes.error, {
      companyId,
      customerId: invoice.customer_id,
    })
    throw customerRes.error
  }

  const company = companyRes.data as any
  const settings = settingsRes.data as any
  const order = orderRes.data as any
  const customer = customerRes.data as any

  const preview: SalesInvoiceDraftPreview = {
    seller_legal_name: company ? (company.legal_name || company.trade_name || company.name || null) : null,
    seller_trade_name: company ? (company.trade_name || company.name || null) : null,
    seller_nuit: company?.tax_id || null,
    seller_address_line1: company?.address_line1 || null,
    seller_address_line2: company?.address_line2 || null,
    seller_city: company?.city || null,
    seller_state: company?.state || null,
    seller_postal_code: company?.postal_code || null,
    seller_country_code: company?.country_code || null,
    buyer_legal_name: order?.bill_to_name || customer?.name || null,
    buyer_nuit: order?.bill_to_tax_id || customer?.tax_id || null,
    buyer_address_line1: order?.bill_to_billing_address || customer?.billing_address || null,
    buyer_address_line2: order?.bill_to_shipping_address || customer?.shipping_address || null,
    buyer_city: null,
    buyer_state: null,
    buyer_postal_code: null,
    buyer_country_code: company?.country_code || null,
    computer_processed_phrase: settings?.computer_processed_phrase_text || null,
    document_language_code: settings?.document_language_code || null,
  }

  mzRuntimeDebug('salesInvoiceDraftPreview.load.success', {
    companyId,
    salesOrderId: invoice.sales_order_id,
    customerId: invoice.customer_id,
    hasSellerPreview: Boolean(preview.seller_legal_name),
    hasBuyerPreview: Boolean(preview.buyer_legal_name),
    hasComputerPhrase: Boolean(preview.computer_processed_phrase),
  })
  return preview
}

async function enrichSalesInvoiceLines(companyId: string, lines: SalesInvoiceDocumentLineRow[]) {
  if (!lines.length) return [] as SalesInvoiceDocumentLineRow[]

  const itemIds = Array.from(new Set(lines.map((line) => line.item_id).filter(Boolean) as string[]))
  const salesOrderLineIds = Array.from(new Set(lines.map((line) => line.sales_order_line_id).filter(Boolean) as string[]))

  const [itemRes, orderLineRes] = await Promise.all([
    itemIds.length
      ? supabase
          .from('items')
          .select('id,name,sku,base_uom_id')
          .eq('company_id', companyId)
          .in('id', itemIds)
      : Promise.resolve({ data: [], error: null }),
    salesOrderLineIds.length
      ? supabase
          .from('sales_order_lines')
          .select('id,description,uom_id')
          .eq('company_id', companyId)
          .in('id', salesOrderLineIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (itemRes.error) {
    mzRuntimeError('salesInvoiceLines.itemsLoad.failed', itemRes.error, {
      companyId,
      itemCount: itemIds.length,
    })
  }
  if (orderLineRes.error) {
    mzRuntimeError('salesInvoiceLines.orderLinesLoad.failed', orderLineRes.error, {
      companyId,
      salesOrderLineCount: salesOrderLineIds.length,
    })
  }

  const itemById = new Map<string, ItemDisplaySource>(((itemRes.data || []) as ItemDisplaySource[]).map((row) => [row.id, row]))
  const orderLineById = new Map<string, SalesOrderLineDisplaySource>(((orderLineRes.data || []) as SalesOrderLineDisplaySource[]).map((row) => [row.id, row]))

  const uomIds = Array.from(
    new Set(
      lines
        .flatMap((line) => {
          const orderLine = line.sales_order_line_id ? orderLineById.get(line.sales_order_line_id) : undefined
          const item = line.item_id ? itemById.get(line.item_id) : undefined
          const ids = [
            looksLikeUuid(line.unit_of_measure_snapshot) ? normalizeText(line.unit_of_measure_snapshot) : null,
            orderLine?.uom_id || null,
            item?.base_uom_id || null,
          ]
          return ids.filter(Boolean)
        }) as string[],
    ),
  )

  let uomById = new Map<string, UomDisplaySource>()
  if (uomIds.length) {
    const { data: uoms, error: uomError } = await supabase
      .from('uoms')
      .select('id,code')
      .in('id', uomIds)

    if (uomError) {
      mzRuntimeError('salesInvoiceLines.uomsLoad.failed', uomError, {
        companyId,
        uomCount: uomIds.length,
      })
    } else {
      uomById = new Map<string, UomDisplaySource>(((uoms || []) as UomDisplaySource[]).map((row) => [row.id, row]))
    }
  }

  return lines.map((line) => {
    const item = line.item_id ? itemById.get(line.item_id) : undefined
    const orderLine = line.sales_order_line_id ? orderLineById.get(line.sales_order_line_id) : undefined
    const orderLineUomCode = orderLine?.uom_id ? uomById.get(orderLine.uom_id)?.code || null : null
    const itemBaseUomCode = item?.base_uom_id ? uomById.get(item.base_uom_id)?.code || null : null
    const snapshotUomCode = looksLikeUuid(line.unit_of_measure_snapshot)
      ? uomById.get(normalizeText(line.unit_of_measure_snapshot))?.code || null
      : null

    return {
      ...line,
      display_description: resolveInvoiceLineDescription(
        line.description,
        orderLine?.description,
        item?.name,
        item?.sku,
      ),
      display_unit_of_measure: resolveInvoiceLineUnitOfMeasure(
        snapshotUomCode || line.unit_of_measure_snapshot,
        orderLineUomCode,
        itemBaseUomCode,
      ),
    }
  })
}

async function enrichSalesAdjustmentLines<T extends {
  id: string
  item_id: string | null
  sales_invoice_line_id: string | null
  description: string
  unit_of_measure_snapshot: string | null
}>(companyId: string, lines: T[]) {
  if (!lines.length) return [] as Array<T & { display_description: string; display_unit_of_measure: string | null }>

  const itemIds = Array.from(new Set(lines.map((line) => line.item_id).filter(Boolean) as string[]))
  const invoiceLineIds = Array.from(new Set(lines.map((line) => line.sales_invoice_line_id).filter(Boolean) as string[]))

  const [itemRes, invoiceLineRes] = await Promise.all([
    itemIds.length
      ? supabase
          .from('items')
          .select('id,name,sku,base_uom_id')
          .eq('company_id', companyId)
          .in('id', itemIds)
      : Promise.resolve({ data: [], error: null }),
    invoiceLineIds.length
      ? supabase
          .from('sales_invoice_lines')
          .select('id,description,unit_of_measure_snapshot')
          .eq('company_id', companyId)
          .in('id', invoiceLineIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (itemRes.error) {
    mzRuntimeError('salesAdjustmentLines.itemsLoad.failed', itemRes.error, {
      companyId,
      itemCount: itemIds.length,
    })
  }
  if (invoiceLineRes.error) {
    mzRuntimeError('salesAdjustmentLines.invoiceLinesLoad.failed', invoiceLineRes.error, {
      companyId,
      invoiceLineCount: invoiceLineIds.length,
    })
  }

  const itemById = new Map<string, ItemDisplaySource>(((itemRes.data || []) as ItemDisplaySource[]).map((row) => [row.id, row]))
  const sourceLineById = new Map<string, Pick<SalesInvoiceDocumentLineRow, 'id' | 'description' | 'unit_of_measure_snapshot'>>(
    (((invoiceLineRes.data || []) as Array<Pick<SalesInvoiceDocumentLineRow, 'id' | 'description' | 'unit_of_measure_snapshot'>>)
      .map((row) => [row.id, row])),
  )

  const uomIds = Array.from(
    new Set(
      lines
        .flatMap((line) => {
          const sourceLine = line.sales_invoice_line_id ? sourceLineById.get(line.sales_invoice_line_id) : undefined
          const item = line.item_id ? itemById.get(line.item_id) : undefined
          const ids = [
            looksLikeUuid(line.unit_of_measure_snapshot) ? normalizeText(line.unit_of_measure_snapshot) : null,
            sourceLine?.unit_of_measure_snapshot && looksLikeUuid(sourceLine.unit_of_measure_snapshot)
              ? normalizeText(sourceLine.unit_of_measure_snapshot)
              : null,
            item?.base_uom_id || null,
          ]
          return ids.filter(Boolean)
        }) as string[],
    ),
  )

  let uomById = new Map<string, UomDisplaySource>()
  if (uomIds.length) {
    const { data: uoms, error: uomError } = await supabase
      .from('uoms')
      .select('id,code')
      .in('id', uomIds)

    if (uomError) {
      mzRuntimeError('salesAdjustmentLines.uomsLoad.failed', uomError, {
        companyId,
        uomCount: uomIds.length,
      })
    } else {
      uomById = new Map<string, UomDisplaySource>(((uoms || []) as UomDisplaySource[]).map((row) => [row.id, row]))
    }
  }

  return lines.map((line) => {
    const item = line.item_id ? itemById.get(line.item_id) : undefined
    const sourceLine = line.sales_invoice_line_id ? sourceLineById.get(line.sales_invoice_line_id) : undefined
    const sourceUnitOfMeasure = sourceLine?.unit_of_measure_snapshot && looksLikeUuid(sourceLine.unit_of_measure_snapshot)
      ? uomById.get(normalizeText(sourceLine.unit_of_measure_snapshot))?.code || null
      : sourceLine?.unit_of_measure_snapshot || null
    const snapshotUnitOfMeasure = looksLikeUuid(line.unit_of_measure_snapshot)
      ? uomById.get(normalizeText(line.unit_of_measure_snapshot))?.code || null
      : null
    const itemUnitOfMeasure = item?.base_uom_id ? uomById.get(item.base_uom_id)?.code || null : null

    return {
      ...line,
      display_description: resolveInvoiceLineDescription(
        line.description,
        sourceLine?.description,
        item?.name,
        item?.sku,
      ),
      display_unit_of_measure: resolveInvoiceLineUnitOfMeasure(
        snapshotUnitOfMeasure || line.unit_of_measure_snapshot,
        sourceUnitOfMeasure,
        itemUnitOfMeasure,
      ),
    }
  })
}

export async function listSalesInvoiceDocumentLines(companyId: string, invoiceId: string) {
  mzRuntimeDebug('salesInvoiceLines.load.start', { companyId, invoiceId })
  const { data, error } = await supabase
    .from('sales_invoice_lines')
    .select('*')
    .eq('company_id', companyId)
    .eq('sales_invoice_id', invoiceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    mzRuntimeError('salesInvoiceLines.load.failed', error, { companyId, invoiceId })
    throw error
  }
  mzRuntimeDebug('salesInvoiceLines.load.success', { companyId, invoiceId, rowCount: data?.length ?? 0 })
  return await enrichSalesInvoiceLines(companyId, (data || []) as SalesInvoiceDocumentLineRow[])
}

export async function listSalesCreditNotesForInvoice(companyId: string, invoiceId: string) {
  mzRuntimeDebug('creditNotes.load.start', { companyId, invoiceId })
  const { data, error } = await supabase
    .from('sales_credit_notes')
    .select('id,company_id,original_sales_invoice_id,customer_id,internal_reference,source_origin,moz_document_code,fiscal_series_code,fiscal_year,fiscal_sequence_number,credit_note_date,due_date,currency_code,fx_to_base,subtotal,tax_total,total_amount,subtotal_mzn,tax_total_mzn,total_amount_mzn,correction_reason_code,correction_reason_text,vat_exemption_reason_text,document_workflow_status,issued_at,seller_legal_name_snapshot,seller_trade_name_snapshot,seller_nuit_snapshot,seller_address_line1_snapshot,seller_address_line2_snapshot,seller_city_snapshot,seller_state_snapshot,seller_postal_code_snapshot,seller_country_code_snapshot,buyer_legal_name_snapshot,buyer_nuit_snapshot,buyer_address_line1_snapshot,buyer_address_line2_snapshot,buyer_city_snapshot,buyer_state_snapshot,buyer_postal_code_snapshot,buyer_country_code_snapshot,document_language_code_snapshot,computer_processed_phrase_snapshot,compliance_rule_version_snapshot,created_at,updated_at')
    .eq('company_id', companyId)
    .eq('original_sales_invoice_id', invoiceId)
    .order('created_at', { ascending: false })

  if (error) {
    mzRuntimeError('creditNotes.load.failed', error, { companyId, invoiceId })
    throw error
  }
  mzRuntimeDebug('creditNotes.load.success', { companyId, invoiceId, rowCount: data?.length ?? 0 })
  return (data || []) as SalesCreditNoteRow[]
}

export async function listSalesCreditNoteLines(companyId: string, noteIds: string[]) {
  const distinctIds = Array.from(new Set(noteIds.filter(Boolean)))
  if (!distinctIds.length) return [] as SalesCreditNoteLineRow[]

  mzRuntimeDebug('creditNoteLines.load.start', { companyId, noteCount: distinctIds.length })
  const { data, error } = await supabase
    .from('sales_credit_note_lines')
    .select('*')
    .eq('company_id', companyId)
    .in('sales_credit_note_id', distinctIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    mzRuntimeError('creditNoteLines.load.failed', error, { companyId, noteCount: distinctIds.length })
    throw error
  }

  mzRuntimeDebug('creditNoteLines.load.success', { companyId, noteCount: distinctIds.length, rowCount: data?.length ?? 0 })
  return await enrichSalesAdjustmentLines(companyId, (data || []) as SalesCreditNoteLineRow[])
}

export async function listSalesDebitNotesForInvoice(companyId: string, invoiceId: string) {
  mzRuntimeDebug('debitNotes.load.start', { companyId, invoiceId })
  const { data, error } = await supabase
    .from('sales_debit_notes')
    .select('id,company_id,original_sales_invoice_id,customer_id,internal_reference,source_origin,moz_document_code,fiscal_series_code,fiscal_year,fiscal_sequence_number,debit_note_date,due_date,currency_code,fx_to_base,subtotal,tax_total,total_amount,subtotal_mzn,tax_total_mzn,total_amount_mzn,correction_reason_code,correction_reason_text,seller_legal_name_snapshot,seller_trade_name_snapshot,seller_nuit_snapshot,seller_address_line1_snapshot,seller_address_line2_snapshot,seller_city_snapshot,seller_state_snapshot,seller_postal_code_snapshot,seller_country_code_snapshot,buyer_legal_name_snapshot,buyer_nuit_snapshot,buyer_address_line1_snapshot,buyer_address_line2_snapshot,buyer_city_snapshot,buyer_state_snapshot,buyer_postal_code_snapshot,buyer_country_code_snapshot,document_language_code_snapshot,computer_processed_phrase_snapshot,compliance_rule_version_snapshot,document_workflow_status,issued_at,created_at,updated_at')
    .eq('company_id', companyId)
    .eq('original_sales_invoice_id', invoiceId)
    .order('created_at', { ascending: false })

  if (error) {
    mzRuntimeError('debitNotes.load.failed', error, { companyId, invoiceId })
    throw error
  }
  mzRuntimeDebug('debitNotes.load.success', { companyId, invoiceId, rowCount: data?.length ?? 0 })
  return (data || []) as SalesDebitNoteRow[]
}

export async function listSalesDebitNoteLines(companyId: string, noteIds: string[]) {
  const distinctIds = Array.from(new Set(noteIds.filter(Boolean)))
  if (!distinctIds.length) return [] as SalesDebitNoteLineRow[]

  mzRuntimeDebug('debitNoteLines.load.start', { companyId, noteCount: distinctIds.length })
  const { data, error } = await supabase
    .from('sales_debit_note_lines')
    .select('*')
    .eq('company_id', companyId)
    .in('sales_debit_note_id', distinctIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    mzRuntimeError('debitNoteLines.load.failed', error, { companyId, noteCount: distinctIds.length })
    throw error
  }

  mzRuntimeDebug('debitNoteLines.load.success', { companyId, noteCount: distinctIds.length, rowCount: data?.length ?? 0 })
  return await enrichSalesAdjustmentLines(companyId, (data || []) as SalesDebitNoteLineRow[])
}

export async function updateSalesInvoiceDraftDates(
  companyId: string,
  invoiceId: string,
  invoiceDate: string,
  dueDate: string,
  vatExemptionReasonText?: string | null,
) {
  mzRuntimeDebug('salesInvoiceDraftDates.save.start', {
    companyId,
    invoiceId,
    invoiceDate,
    dueDate,
    hasVatExemptionReason: Boolean(normalizeText(vatExemptionReasonText)),
  })
  const { data, error } = await supabase
    .from('sales_invoices')
    .update({
      invoice_date: invoiceDate,
      due_date: dueDate,
      vat_exemption_reason_text: normalizeText(vatExemptionReasonText) || null,
    })
    .eq('company_id', companyId)
    .eq('id', invoiceId)
    .select('*')
    .single<SalesInvoiceDocumentRow>()

  if (error) {
    mzRuntimeError('salesInvoiceDraftDates.save.failed', error, {
      companyId,
      invoiceId,
      invoiceDate,
      dueDate,
      hasVatExemptionReason: Boolean(normalizeText(vatExemptionReasonText)),
    })
    throw error
  }
  mzRuntimeDebug('salesInvoiceDraftDates.save.success', { companyId, invoiceId })
  return data
}

export async function prepareSalesInvoiceDraftForIssue(companyId: string, invoiceId: string) {
  mzRuntimeDebug('salesInvoice.prepare.start', { companyId, invoiceId })
  const invoice = await getSalesInvoiceDocument(companyId, invoiceId)

  if (!invoice) {
    throw new Error('Sales invoice not found for the active company.')
  }
  if (invoice.document_workflow_status !== 'draft') {
    return invoice
  }

  let preview: SalesInvoiceDraftPreview | null = null
  try {
    preview = await getSalesInvoiceDraftPreview(companyId, invoice)
  } catch (error) {
    mzRuntimeError('salesInvoice.prepare.preview.failed', error, { companyId, invoiceId })
  }

  const headerPatch: Partial<SalesInvoiceDocumentRow> = {}
  if (invoice.source_origin === 'native') {
    const parsedReference = parseNativeSalesInvoiceReference(invoice.internal_reference)
    if (parsedReference) {
      if (!invoice.fiscal_series_code) headerPatch.fiscal_series_code = parsedReference.fiscal_series_code
      if (!invoice.fiscal_year) headerPatch.fiscal_year = parsedReference.fiscal_year
      if (!invoice.fiscal_sequence_number) headerPatch.fiscal_sequence_number = parsedReference.fiscal_sequence_number
    }
  }

  if (preview) {
    if (!normalizeText(invoice.seller_legal_name_snapshot)) headerPatch.seller_legal_name_snapshot = preview.seller_legal_name
    if (!normalizeText(invoice.seller_trade_name_snapshot) && normalizeText(preview.seller_trade_name)) headerPatch.seller_trade_name_snapshot = preview.seller_trade_name
    if (!normalizeText(invoice.seller_nuit_snapshot) && normalizeText(preview.seller_nuit)) headerPatch.seller_nuit_snapshot = preview.seller_nuit
    if (!normalizeText(invoice.seller_address_line1_snapshot) && normalizeText(preview.seller_address_line1)) headerPatch.seller_address_line1_snapshot = preview.seller_address_line1
    if (!normalizeText(invoice.seller_address_line2_snapshot) && normalizeText(preview.seller_address_line2)) headerPatch.seller_address_line2_snapshot = preview.seller_address_line2
    if (!normalizeText(invoice.seller_city_snapshot) && normalizeText(preview.seller_city)) headerPatch.seller_city_snapshot = preview.seller_city
    if (!normalizeText(invoice.seller_state_snapshot) && normalizeText(preview.seller_state)) headerPatch.seller_state_snapshot = preview.seller_state
    if (!normalizeText(invoice.seller_postal_code_snapshot) && normalizeText(preview.seller_postal_code)) headerPatch.seller_postal_code_snapshot = preview.seller_postal_code
    if (!normalizeText(invoice.seller_country_code_snapshot) && normalizeText(preview.seller_country_code)) headerPatch.seller_country_code_snapshot = preview.seller_country_code

    if (!normalizeText(invoice.buyer_legal_name_snapshot) && normalizeText(preview.buyer_legal_name)) headerPatch.buyer_legal_name_snapshot = preview.buyer_legal_name
    if (!normalizeText(invoice.buyer_nuit_snapshot) && normalizeText(preview.buyer_nuit)) headerPatch.buyer_nuit_snapshot = preview.buyer_nuit
    if (!normalizeText(invoice.buyer_address_line1_snapshot) && normalizeText(preview.buyer_address_line1)) headerPatch.buyer_address_line1_snapshot = preview.buyer_address_line1
    if (!normalizeText(invoice.buyer_address_line2_snapshot) && normalizeText(preview.buyer_address_line2)) headerPatch.buyer_address_line2_snapshot = preview.buyer_address_line2
    if (!normalizeText(invoice.buyer_city_snapshot) && normalizeText(preview.buyer_city)) headerPatch.buyer_city_snapshot = preview.buyer_city
    if (!normalizeText(invoice.buyer_state_snapshot) && normalizeText(preview.buyer_state)) headerPatch.buyer_state_snapshot = preview.buyer_state
    if (!normalizeText(invoice.buyer_postal_code_snapshot) && normalizeText(preview.buyer_postal_code)) headerPatch.buyer_postal_code_snapshot = preview.buyer_postal_code
    if (!normalizeText(invoice.buyer_country_code_snapshot) && normalizeText(preview.buyer_country_code)) headerPatch.buyer_country_code_snapshot = preview.buyer_country_code

    if (!normalizeText(invoice.document_language_code_snapshot) && normalizeText(preview.document_language_code)) {
      headerPatch.document_language_code_snapshot = preview.document_language_code
    }
    if (!normalizeText(invoice.computer_processed_phrase_snapshot) && normalizeText(preview.computer_processed_phrase)) {
      headerPatch.computer_processed_phrase_snapshot = preview.computer_processed_phrase
    }
  }

  if (invoice.vat_exemption_reason_text != null && !normalizeText(invoice.vat_exemption_reason_text)) {
    headerPatch.vat_exemption_reason_text = null
  }

  let patchedInvoice = invoice
  if (Object.keys(headerPatch).length) {
    const { data: updatedInvoice, error: updateError } = await supabase
      .from('sales_invoices')
      .update(headerPatch)
      .eq('company_id', companyId)
      .eq('id', invoiceId)
      .select('*')
      .single<SalesInvoiceDocumentRow>()

    if (updateError) {
      mzRuntimeError('salesInvoice.prepare.headerPatch.failed', updateError, {
        companyId,
        invoiceId,
        patchKeys: Object.keys(headerPatch),
      })
      throw updateError
    }
    patchedInvoice = updatedInvoice
  }

  const lines = await listSalesInvoiceDocumentLines(companyId, invoiceId)
  const linePatches = lines
    .map((line) => {
      const update: Partial<SalesInvoiceDocumentLineRow> = {}
      const nextDescription = normalizeText(line.display_description)
      const nextUnitOfMeasure = normalizeText(line.display_unit_of_measure)

      if (nextDescription && isUnsafeDisplayText(line.description)) {
        update.description = nextDescription
      }
      if (nextUnitOfMeasure && (!normalizeText(line.unit_of_measure_snapshot) || looksLikeUuid(line.unit_of_measure_snapshot))) {
        update.unit_of_measure_snapshot = nextUnitOfMeasure
      }

      return { id: line.id, update }
    })
    .filter((entry) => Object.keys(entry.update).length)

  if (linePatches.length) {
    const results = await Promise.all(
      linePatches.map(({ id, update }) =>
        supabase
          .from('sales_invoice_lines')
          .update(update)
          .eq('company_id', companyId)
          .eq('id', id),
      ),
    )

    const failedPatch = results.find((result) => result.error)
    if (failedPatch?.error) {
      mzRuntimeError('salesInvoice.prepare.linePatch.failed', failedPatch.error, {
        companyId,
        invoiceId,
        linePatchCount: linePatches.length,
      })
      throw failedPatch.error
    }
  }

  mzRuntimeDebug('salesInvoice.prepare.success', {
    companyId,
    invoiceId,
    headerPatchCount: Object.keys(headerPatch).length,
    linePatchCount: linePatches.length,
  })
  return patchedInvoice
}

export async function issueSalesInvoice(invoiceId: string) {
  mzRuntimeDebug('salesInvoice.issue.start', { invoiceId })
  const { data, error } = await supabase.rpc('issue_sales_invoice_mz', {
    p_invoice_id: invoiceId,
  })

  if (error) {
    mzRuntimeError('salesInvoice.issue.failed', error, { invoiceId, rpc: 'issue_sales_invoice_mz' })
    throw new Error(humanizeRuntimeError(error, 'Sales invoice issuance failed', 'rpc.issue_sales_invoice_mz'))
  }
  mzRuntimeDebug('salesInvoice.issue.success', { invoiceId })
  return data as SalesInvoiceDocumentRow
}

export async function createDraftSalesInvoiceFromOrder(companyId: string, salesOrderId: string) {
  mzRuntimeDebug('salesInvoiceDraft.create.start', { companyId, salesOrderId })
  const { data: existingInvoice, error: existingError } = await supabase
    .from('sales_invoices')
    .select('id,internal_reference,document_workflow_status')
    .eq('company_id', companyId)
    .eq('sales_order_id', salesOrderId)
    .in('document_workflow_status', ['draft', 'issued'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; internal_reference: string; document_workflow_status: string }>()

  if (existingError) {
    mzRuntimeError('salesInvoiceDraft.lookup.failed', existingError, { companyId, salesOrderId })
    throw new Error(humanizeRuntimeError(existingError, 'Failed to inspect existing fiscal invoices', 'sales_invoices.lookup'))
  }
  if (existingInvoice) {
    mzRuntimeDebug('salesInvoiceDraft.create.reused', {
      companyId,
      salesOrderId,
      invoiceId: existingInvoice.id,
      documentWorkflowStatus: existingInvoice.document_workflow_status,
    })
    return { invoiceId: existingInvoice.id, internalReference: existingInvoice.internal_reference, existed: true }
  }

  const { data: order, error: orderError } = await supabase
    .from('sales_orders')
    .select('id,company_id,customer_id,order_no,status,currency_code,fx_to_base,order_date,due_date,tax_total')
    .eq('company_id', companyId)
    .eq('id', salesOrderId)
    .maybeSingle<SalesOrderDraftSource>()

  if (orderError) {
    mzRuntimeError('salesInvoiceDraft.orderLoad.failed', orderError, { companyId, salesOrderId })
    throw new Error(humanizeRuntimeError(orderError, 'Failed to load the source sales order', 'sales_orders.select'))
  }
  if (!order) {
    throw new Error('Sales order not found for the active company.')
  }
  if (!allowedSalesOrderForInvoice(order.status)) {
    throw new Error('Only confirmed, allocated, shipped, or closed sales orders can become fiscal invoice drafts.')
  }

  // sales_order_lines has no created_at column in the live schema.
  // Keep fiscal draft preparation deterministic with line_no then id.
  const { data: lines, error: linesError } = await supabase
    .from('sales_order_lines')
    .select('id,so_id,item_id,description,line_no,qty,unit_price,discount_pct,line_total')
    .eq('so_id', salesOrderId)
    .order('line_no', { ascending: true })
    .order('id', { ascending: true })

  if (linesError) {
    mzRuntimeError('salesInvoiceDraft.orderLinesLoad.failed', linesError, {
      companyId,
      salesOrderId,
      queryPurpose: 'fiscal-draft-preparation',
      orderBy: ['line_no.asc', 'id.asc'],
    })
    throw new Error(humanizeRuntimeError(linesError, 'Failed to load sales order lines for fiscalization', 'sales_order_lines.select'))
  }

  const sourceLines = ((lines || []) as SalesOrderLineDraftSource[])
    .filter((line) => toNumber(line.qty) > 0)
    .map((line) => ({
      ...line,
      line_total: roundMoney(line.line_total == null ? fallbackLineTotal(line) : toNumber(line.line_total)),
    }))

  if (!sourceLines.length) {
    throw new Error('The selected sales order has no invoiceable lines.')
  }

  const itemIds = Array.from(new Set(sourceLines.map((line) => line.item_id).filter(Boolean) as string[]))
  const { data: items, error: itemsError } = itemIds.length
    ? await supabase
        .from('items')
        .select('id,name,sku,base_uom_id')
        .eq('company_id', companyId)
        .in('id', itemIds)
    : { data: [], error: null }

  if (itemsError) {
    mzRuntimeError('salesInvoiceDraft.itemsLoad.failed', itemsError, { companyId, salesOrderId, itemCount: itemIds.length })
    throw new Error(humanizeRuntimeError(itemsError, 'Failed to load item descriptions for fiscalization', 'items.select'))
  }

  const itemById = new Map<string, ItemDisplaySource>(((items || []) as ItemDisplaySource[]).map((row) => [row.id, row]))

  const { invoiceDate, dueDate } = normalizeDueDate(order)
  const subtotal = roundMoney(sourceLines.reduce((sum, line) => sum + toNumber(line.line_total), 0))
  const headerTaxTotal = roundMoney(toNumber(order.tax_total))
  if (headerTaxTotal > 0 && subtotal <= 0) {
    throw new Error('The selected sales order has tax recorded but no positive subtotal to fiscalize.')
  }
  const totalAmount = roundMoney(subtotal + headerTaxTotal)
  const taxRate = subtotal > 0 && headerTaxTotal > 0
    ? Math.round(((headerTaxTotal / subtotal) * 100) * 10000) / 10000
    : 0
  const lineTaxAmounts = allocateHeaderTaxAmounts(
    sourceLines.map((line) => toNumber(line.line_total)),
    headerTaxTotal,
  )

  const { data: invoice, error: invoiceError } = await supabase
    .from('sales_invoices')
    .insert({
      company_id: companyId,
      sales_order_id: order.id,
      customer_id: order.customer_id,
      invoice_date: invoiceDate,
      due_date: dueDate,
      currency_code: order.currency_code || 'MZN',
      fx_to_base: toNumber(order.fx_to_base, 1) > 0 ? toNumber(order.fx_to_base, 1) : 1,
      subtotal,
      tax_total: headerTaxTotal,
      total_amount: totalAmount,
      source_origin: 'native',
      document_workflow_status: 'draft',
    })
    .select('id,internal_reference')
    .single<{ id: string; internal_reference: string }>()

  if (invoiceError) {
    mzRuntimeError('salesInvoiceDraft.headerInsert.failed', invoiceError, { companyId, salesOrderId })
    throw new Error(humanizeRuntimeError(invoiceError, 'Failed to create the draft sales invoice header', 'sales_invoices.insert'))
  }

  const linePayload = sourceLines.map((line, index) => ({
    ...(line.item_id ? { item_id: line.item_id } : {}),
    company_id: companyId,
    sales_invoice_id: invoice.id,
    sales_order_line_id: line.id,
    description: resolveInvoiceLineDescription(
      line.description,
      null,
      line.item_id ? itemById.get(line.item_id)?.name : null,
      line.item_id ? itemById.get(line.item_id)?.sku : null,
    ),
    qty: toNumber(line.qty),
    unit_price: toNumber(line.unit_price),
    tax_rate: taxRate > 0 ? taxRate : 0,
    tax_amount: lineTaxAmounts[index] || 0,
    line_total: toNumber(line.line_total),
    sort_order: line.line_no ?? index,
  }))

  const { error: insertLineError } = await supabase
    .from('sales_invoice_lines')
    .insert(linePayload)

  if (insertLineError) {
    mzRuntimeError('salesInvoiceDraft.linesInsert.failed', insertLineError, {
      companyId,
      salesOrderId,
      invoiceId: invoice.id,
      lineCount: linePayload.length,
    })
    await maybeVoidDraftInvoice(companyId, invoice.id, 'Automatic invoice draft creation failed while inserting line items.')
    throw new Error(humanizeRuntimeError(insertLineError, 'The invoice draft could not be completed. The draft was voided for manual review.', 'sales_invoice_lines.insert'))
  }

  mzRuntimeDebug('salesInvoiceDraft.create.success', {
    companyId,
    salesOrderId,
    invoiceId: invoice.id,
    internalReference: invoice.internal_reference,
    lineCount: linePayload.length,
    subtotal,
    taxTotal: headerTaxTotal,
    totalAmount,
  })
  return { invoiceId: invoice.id, internalReference: invoice.internal_reference, existed: false }
}

function normalizeSalesNoteDraftLine(
  line: SalesCreditNoteDraftLineInput | SalesDebitNoteDraftLineInput,
) {
  const qty = roundMoney(toNumber(line.qty))
  const lineTotal = roundMoney(toNumber(line.lineTotal))
  const taxAmount = roundMoney(toNumber(line.taxAmount))
  const unitPrice = qty > 0
    ? roundMoney(toNumber(line.unitPrice, lineTotal / qty))
    : roundMoney(toNumber(line.unitPrice, lineTotal))

  return {
    salesInvoiceLineId: normalizeText(line.salesInvoiceLineId),
    itemId: line.itemId ?? null,
    description: normalizeText(line.description),
    qty,
    unitPrice,
    taxRate: line.taxRate == null ? null : roundMoney(toNumber(line.taxRate, 0)),
    taxAmount,
    lineTotal,
    sortOrder: line.sortOrder == null ? null : Math.trunc(toNumber(line.sortOrder, 0)),
  }
}

function buildSourceLineRollupById<T extends {
  sales_invoice_line_id: string | null
  qty: number
  line_total: number
  tax_amount: number
}>(lines: T[]) {
  const rollupBySourceLineId = new Map<string, { qty: number; lineTotal: number; taxAmount: number }>()

  lines.forEach((line) => {
    const sourceLineId = normalizeText(line.sales_invoice_line_id)
    if (!sourceLineId) return
    const current = rollupBySourceLineId.get(sourceLineId) || { qty: 0, lineTotal: 0, taxAmount: 0 }
    current.qty = roundMoney(current.qty + toNumber(line.qty))
    current.lineTotal = roundMoney(current.lineTotal + toNumber(line.line_total))
    current.taxAmount = roundMoney(current.taxAmount + toNumber(line.tax_amount))
    rollupBySourceLineId.set(sourceLineId, current)
  })

  return rollupBySourceLineId
}

function buildCreditAvailabilityBySourceLine(
  invoiceLines: SalesInvoiceDocumentLineRow[],
  issuedCreditNoteLines: SalesCreditNoteLineRow[],
) {
  const rollupBySourceLineId = buildSourceLineRollupById(issuedCreditNoteLines)

  return invoiceLines.map((line) => {
    const alreadyCredited = rollupBySourceLineId.get(line.id) || { qty: 0, lineTotal: 0, taxAmount: 0 }
    return {
      sourceLine: line,
      availableQty: roundMoney(Math.max(toNumber(line.qty) - alreadyCredited.qty, 0)),
      availableLineTotal: roundMoney(Math.max(toNumber(line.line_total) - alreadyCredited.lineTotal, 0)),
      availableTaxAmount: roundMoney(Math.max(toNumber(line.tax_amount) - alreadyCredited.taxAmount, 0)),
    }
  })
}

export async function createAndIssueSalesCreditNoteForInvoice(
  companyId: string,
  invoiceId: string,
  input: CreateSalesCreditNoteInput,
) {
  mzRuntimeDebug('creditNote.issueFromInvoice.start', { companyId, invoiceId, requestedLineCount: input.lines.length })
  const trimmedReason = normalizeText(input.correctionReasonText)
  if (!trimmedReason) {
    throw new Error('A correction reason is required to issue a credit note.')
  }

  const normalizedLines = input.lines
    .map(normalizeSalesNoteDraftLine)
    .filter((line) =>
      line.salesInvoiceLineId
      && (line.lineTotal > 0 || line.taxAmount > 0)
      && line.qty >= 0,
    )

  if (!normalizedLines.length) {
    throw new Error('Select at least one invoice line with a positive credit value before issuing the credit note.')
  }

  const [invoice, invoiceLines] = await Promise.all([
    getSalesInvoiceDocument(companyId, invoiceId),
    listSalesInvoiceDocumentLines(companyId, invoiceId),
  ])

  if (!invoice) {
    throw new Error('Sales invoice not found for the active company.')
  }
  if (invoice.document_workflow_status !== 'issued') {
    throw new Error('Credit notes can only be created from issued sales invoices.')
  }
  if (!invoiceLines.length) {
    throw new Error('The issued sales invoice has no source lines for a credit note.')
  }

  const invoiceLineById = new Map(invoiceLines.map((line) => [line.id, line]))
  const invalidLine = normalizedLines.find((line) => !invoiceLineById.has(line.salesInvoiceLineId))
  if (invalidLine) {
    throw new Error('Every credit note line must point to a source line on the original issued invoice.')
  }

  const trimmedVatExemptionReason = normalizeText(input.vatExemptionReasonText) || null
  const creditNoteDate = normalizeText(input.creditNoteDate) || isoToday()

  const { data: note, error: noteError } = await supabase
    .from('sales_credit_notes')
    .insert({
      company_id: companyId,
      original_sales_invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      credit_note_date: creditNoteDate,
      due_date: null,
      currency_code: invoice.currency_code,
      fx_to_base: invoice.fx_to_base,
      subtotal: 0,
      tax_total: 0,
      total_amount: 0,
      correction_reason_text: trimmedReason,
      vat_exemption_reason_text: trimmedVatExemptionReason,
      source_origin: 'native',
      document_workflow_status: 'draft',
    })
    .select('id,internal_reference')
    .single<{ id: string; internal_reference: string }>()

  if (noteError) {
    mzRuntimeError('creditNote.headerInsert.failed', noteError, { companyId, invoiceId })
    throw new Error(humanizeRuntimeError(noteError, 'Failed to create the credit note draft header', 'sales_credit_notes.insert'))
  }

  const noteLinePayload = normalizedLines.map((line, index) => {
    const sourceLine = invoiceLineById.get(line.salesInvoiceLineId)!
    return {
      company_id: companyId,
      sales_credit_note_id: note.id,
      sales_invoice_line_id: sourceLine.id,
      item_id: line.itemId ?? sourceLine.item_id,
      description: line.description || sourceLine.description,
      qty: line.qty,
      unit_price: line.unitPrice,
      tax_rate: line.taxRate ?? sourceLine.tax_rate,
      tax_amount: line.taxAmount,
      line_total: line.lineTotal,
      sort_order: line.sortOrder ?? sourceLine.sort_order ?? index,
    }
  })

  const { error: noteLineError } = await supabase
    .from('sales_credit_note_lines')
    .insert(noteLinePayload)

  if (noteLineError) {
    mzRuntimeError('creditNote.linesInsert.failed', noteLineError, {
      companyId,
      invoiceId,
      noteId: note.id,
      lineCount: noteLinePayload.length,
    })
    await maybeVoidDraftCreditNote(companyId, note.id, 'Automatic credit note creation failed while inserting line items.')
    throw new Error(humanizeRuntimeError(noteLineError, 'The credit note draft could not be completed. The draft was voided for manual review.', 'sales_credit_note_lines.insert'))
  }

  const { data: issuedNote, error: issueError } = await supabase.rpc('issue_sales_credit_note_mz', {
    p_note_id: note.id,
  })

  if (issueError) {
    mzRuntimeError('creditNote.issue.failed', issueError, { companyId, invoiceId, noteId: note.id, rpc: 'issue_sales_credit_note_mz' })
    throw new Error(humanizeRuntimeError(issueError, 'Credit note issuance failed', 'rpc.issue_sales_credit_note_mz'))
  }

  mzRuntimeDebug('creditNote.issueFromInvoice.success', {
    companyId,
    invoiceId,
    noteId: (issuedNote as SalesCreditNoteRow).id,
    internalReference: (issuedNote as SalesCreditNoteRow).internal_reference,
    issuedLineCount: noteLinePayload.length,
  })
  return issuedNote as SalesCreditNoteRow
}

export async function createAndIssueSalesDebitNoteForInvoice(
  companyId: string,
  invoiceId: string,
  input: CreateSalesDebitNoteInput,
) {
  mzRuntimeDebug('debitNote.issueFromInvoice.start', { companyId, invoiceId, requestedLineCount: input.lines.length })
  const trimmedReason = normalizeText(input.correctionReasonText)
  if (!trimmedReason) {
    throw new Error('A correction reason is required to issue a debit note.')
  }

  const normalizedLines = input.lines
    .map(normalizeSalesNoteDraftLine)
    .filter((line) =>
      line.salesInvoiceLineId
      && (line.lineTotal > 0 || line.taxAmount > 0)
      && line.qty >= 0,
    )

  if (!normalizedLines.length) {
    throw new Error('Select at least one invoice line with a positive debit value before issuing the debit note.')
  }

  const [invoice, invoiceLines] = await Promise.all([
    getSalesInvoiceDocument(companyId, invoiceId),
    listSalesInvoiceDocumentLines(companyId, invoiceId),
  ])

  if (!invoice) {
    throw new Error('Sales invoice not found for the active company.')
  }
  if (invoice.document_workflow_status !== 'issued') {
    throw new Error('Debit notes can only be created from issued sales invoices.')
  }
  if (!invoiceLines.length) {
    throw new Error('The issued sales invoice has no source lines for a debit note.')
  }

  const invoiceLineById = new Map(invoiceLines.map((line) => [line.id, line]))
  const invalidLine = normalizedLines.find((line) => !invoiceLineById.has(line.salesInvoiceLineId))
  if (invalidLine) {
    throw new Error('Every debit note line must point to a source line on the original issued invoice.')
  }

  const debitNoteDate = normalizeText(input.debitNoteDate) || isoToday()
  const dueDateCandidate = normalizeText(input.dueDate) || normalizeText(invoice.due_date) || debitNoteDate
  const dueDate = dueDateCandidate >= debitNoteDate ? dueDateCandidate : debitNoteDate
  const subtotal = roundMoney(normalizedLines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0))
  const taxTotal = roundMoney(normalizedLines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0))
  const totalAmount = roundMoney(subtotal + taxTotal)

  const { data: note, error: noteError } = await supabase
    .from('sales_debit_notes')
    .insert({
      company_id: companyId,
      original_sales_invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      debit_note_date: debitNoteDate,
      due_date: dueDate,
      currency_code: invoice.currency_code,
      fx_to_base: invoice.fx_to_base,
      subtotal,
      tax_total: taxTotal,
      total_amount: totalAmount,
      correction_reason_text: trimmedReason,
      source_origin: 'native',
      document_workflow_status: 'draft',
    })
    .select('id,internal_reference')
    .single<{ id: string; internal_reference: string }>()

  if (noteError) {
    mzRuntimeError('debitNote.headerInsert.failed', noteError, { companyId, invoiceId })
    throw new Error(humanizeRuntimeError(noteError, 'Failed to create the debit note draft header', 'sales_debit_notes.insert'))
  }

  const noteLinePayload = normalizedLines.map((line, index) => {
    const sourceLine = invoiceLineById.get(line.salesInvoiceLineId)!
    return {
      company_id: companyId,
      sales_debit_note_id: note.id,
      sales_invoice_line_id: sourceLine.id,
      item_id: line.itemId ?? sourceLine.item_id,
      description: line.description || sourceLine.display_description || sourceLine.description,
      qty: line.qty,
      unit_price: line.unitPrice,
      tax_rate: line.taxRate ?? sourceLine.tax_rate,
      tax_amount: line.taxAmount,
      line_total: line.lineTotal,
      unit_of_measure_snapshot: sourceLine.display_unit_of_measure || sourceLine.unit_of_measure_snapshot,
      sort_order: line.sortOrder ?? sourceLine.sort_order ?? index,
    }
  })

  const { error: noteLineError } = await supabase
    .from('sales_debit_note_lines')
    .insert(noteLinePayload)

  if (noteLineError) {
    mzRuntimeError('debitNote.linesInsert.failed', noteLineError, {
      companyId,
      invoiceId,
      noteId: note.id,
      lineCount: noteLinePayload.length,
    })
    await maybeVoidDraftDebitNote(companyId, note.id, 'Automatic debit note creation failed while inserting line items.')
    throw new Error(humanizeRuntimeError(noteLineError, 'The debit note draft could not be completed. The draft was voided for manual review.', 'sales_debit_note_lines.insert'))
  }

  const { data: issuedNote, error: issueError } = await supabase.rpc('issue_sales_debit_note_mz', {
    p_note_id: note.id,
  })

  if (issueError) {
    mzRuntimeError('debitNote.issue.failed', issueError, { companyId, invoiceId, noteId: note.id, rpc: 'issue_sales_debit_note_mz' })
    throw new Error(humanizeRuntimeError(issueError, 'Debit note issuance failed', 'rpc.issue_sales_debit_note_mz'))
  }

  mzRuntimeDebug('debitNote.issueFromInvoice.success', {
    companyId,
    invoiceId,
    noteId: (issuedNote as SalesDebitNoteRow).id,
    internalReference: (issuedNote as SalesDebitNoteRow).internal_reference,
    issuedLineCount: noteLinePayload.length,
  })
  return issuedNote as SalesDebitNoteRow
}

export async function createAndIssueFullCreditNoteForInvoice(
  companyId: string,
  invoiceId: string,
  correctionReasonText: string,
  vatExemptionReasonText?: string | null,
) {
  const [invoice, invoiceLines, creditNotes] = await Promise.all([
    getSalesInvoiceDocument(companyId, invoiceId),
    listSalesInvoiceDocumentLines(companyId, invoiceId),
    listSalesCreditNotesForInvoice(companyId, invoiceId),
  ])

  if (!invoice) {
    throw new Error('Sales invoice not found for the active company.')
  }
  if (invoice.document_workflow_status !== 'issued') {
    throw new Error('Credit notes can only be created from issued sales invoices.')
  }

  const issuedNoteIds = creditNotes
    .filter((note) => note.document_workflow_status === 'issued')
    .map((note) => note.id)
  const issuedLines = await listSalesCreditNoteLines(companyId, issuedNoteIds)

  const fullCreditLines = buildCreditAvailabilityBySourceLine(invoiceLines, issuedLines)
    .map(({ sourceLine, availableQty, availableLineTotal, availableTaxAmount }) => {
      const unitPrice = availableQty > 0
        ? roundMoney(availableLineTotal / availableQty)
        : roundMoney(availableLineTotal)

      return {
        salesInvoiceLineId: sourceLine.id,
        itemId: sourceLine.item_id,
        description: sourceLine.description,
        qty: availableQty,
        unitPrice,
        taxRate: sourceLine.tax_rate,
        taxAmount: availableTaxAmount,
        lineTotal: availableLineTotal,
        sortOrder: sourceLine.sort_order,
      }
    })
    .filter((line) => line.lineTotal > 0 || line.taxAmount > 0)

  if (!fullCreditLines.length) {
    throw new Error('This invoice has no remaining creditable value. It may already be fully credited.')
  }

  return await createAndIssueSalesCreditNoteForInvoice(companyId, invoiceId, {
    correctionReasonText,
    vatExemptionReasonText: vatExemptionReasonText ?? invoice.vat_exemption_reason_text,
    lines: fullCreditLines,
  })
}

export async function createAndIssueFullSalesDebitNoteForInvoice(
  companyId: string,
  invoiceId: string,
  correctionReasonText: string,
  debitNoteDate?: string | null,
  dueDate?: string | null,
) {
  const [invoice, invoiceLines] = await Promise.all([
    getSalesInvoiceDocument(companyId, invoiceId),
    listSalesInvoiceDocumentLines(companyId, invoiceId),
  ])

  if (!invoice) {
    throw new Error('Sales invoice not found for the active company.')
  }
  if (invoice.document_workflow_status !== 'issued') {
    throw new Error('Debit notes can only be created from issued sales invoices.')
  }
  if (!invoiceLines.length) {
    throw new Error('The issued sales invoice has no source lines for a debit note.')
  }

  return await createAndIssueSalesDebitNoteForInvoice(companyId, invoiceId, {
    correctionReasonText,
    debitNoteDate,
    dueDate,
    lines: invoiceLines.map((line) => ({
      salesInvoiceLineId: line.id,
      itemId: line.item_id,
      description: line.display_description || line.description,
      qty: roundMoney(toNumber(line.qty)),
      unitPrice: roundMoney(toNumber(line.unit_price)),
      taxRate: line.tax_rate,
      taxAmount: roundMoney(toNumber(line.tax_amount)),
      lineTotal: roundMoney(toNumber(line.line_total)),
      sortOrder: line.sort_order,
    })),
  })
}
