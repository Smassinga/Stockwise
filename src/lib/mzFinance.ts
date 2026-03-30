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
  document_workflow_status: 'draft' | 'issued' | 'voided'
  issued_at: string | null
  created_at: string
  updated_at: string
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

function toNumber(value: number | string | null | undefined, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
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

function humanizeError(error: any, fallback: string) {
  const message = String(error?.message || '').trim()
  if (!message) return fallback
  return message
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

export async function getCompanyFiscalSettings(companyId: string) {
  const { data, error } = await supabase
    .from('company_fiscal_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle<CompanyFiscalSettingsRow>()

  if (error) throw error
  return data
}

export async function listCompanyFiscalSeries(companyId: string, fiscalYear?: number | null) {
  let query = supabase
    .from('finance_document_fiscal_series')
    .select('*')
    .eq('company_id', companyId)
    .order('fiscal_year', { ascending: false })
    .order('document_type', { ascending: true })
    .order('series_code', { ascending: true })

  if (fiscalYear) query = query.eq('fiscal_year', fiscalYear)

  const { data, error } = await query

  if (error) throw error
  return (data || []) as FinanceDocumentFiscalSeriesRow[]
}

export async function listSaftMozExports(companyId: string) {
  const { data, error } = await supabase
    .from('saft_moz_exports')
    .select('*')
    .eq('company_id', companyId)
    .order('period_start', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as SaftMozExportRow[]
}

export async function listFinanceEvents(
  companyId: string,
  documentKind?: FinanceDocumentEventRow['document_kind'],
  documentId?: string,
) {
  let query = supabase
    .from('finance_document_events')
    .select('*')
    .eq('company_id', companyId)
    .order('occurred_at', { ascending: false })

  if (documentKind) query = query.eq('document_kind', documentKind)
  if (documentId) query = query.eq('document_id', documentId)

  const { data, error } = await query.limit(documentId ? 50 : 25)

  if (error) throw error
  return (data || []) as FinanceDocumentEventRow[]
}

export async function listFiscalArtifacts(
  companyId: string,
  documentKind?: FiscalDocumentArtifactRow['document_kind'],
  documentId?: string,
) {
  let query = supabase
    .from('fiscal_document_artifacts')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  if (documentKind) query = query.eq('document_kind', documentKind)
  if (documentId) query = query.eq('document_id', documentId)

  const { data, error } = await query.limit(documentId ? 25 : 20)

  if (error) throw error
  return (data || []) as FiscalDocumentArtifactRow[]
}

export async function getSalesInvoiceDocument(companyId: string, invoiceId: string) {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('*')
    .eq('company_id', companyId)
    .eq('id', invoiceId)
    .maybeSingle<SalesInvoiceDocumentRow>()

  if (error) throw error
  return data
}

export async function listSalesInvoiceDocumentLines(companyId: string, invoiceId: string) {
  const { data, error } = await supabase
    .from('sales_invoice_lines')
    .select('*')
    .eq('company_id', companyId)
    .eq('sales_invoice_id', invoiceId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as SalesInvoiceDocumentLineRow[]
}

export async function listSalesCreditNotesForInvoice(companyId: string, invoiceId: string) {
  const { data, error } = await supabase
    .from('sales_credit_notes')
    .select('id,company_id,original_sales_invoice_id,customer_id,internal_reference,source_origin,moz_document_code,fiscal_series_code,fiscal_year,fiscal_sequence_number,credit_note_date,due_date,currency_code,fx_to_base,subtotal,tax_total,total_amount,subtotal_mzn,tax_total_mzn,total_amount_mzn,correction_reason_code,correction_reason_text,document_workflow_status,issued_at,created_at,updated_at')
    .eq('company_id', companyId)
    .eq('original_sales_invoice_id', invoiceId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as SalesCreditNoteRow[]
}

export async function updateSalesInvoiceDraftDates(
  companyId: string,
  invoiceId: string,
  invoiceDate: string,
  dueDate: string,
) {
  const { data, error } = await supabase
    .from('sales_invoices')
    .update({
      invoice_date: invoiceDate,
      due_date: dueDate,
    })
    .eq('company_id', companyId)
    .eq('id', invoiceId)
    .select('*')
    .single<SalesInvoiceDocumentRow>()

  if (error) throw error
  return data
}

export async function issueSalesInvoice(invoiceId: string) {
  const { data, error } = await supabase.rpc('issue_sales_invoice_mz', {
    p_invoice_id: invoiceId,
  })

  if (error) throw error
  return data as SalesInvoiceDocumentRow
}

export async function createDraftSalesInvoiceFromOrder(companyId: string, salesOrderId: string) {
  const { data: existingInvoice, error: existingError } = await supabase
    .from('sales_invoices')
    .select('id,internal_reference,document_workflow_status')
    .eq('company_id', companyId)
    .eq('sales_order_id', salesOrderId)
    .in('document_workflow_status', ['draft', 'issued'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; internal_reference: string; document_workflow_status: string }>()

  if (existingError) throw existingError
  if (existingInvoice) {
    return { invoiceId: existingInvoice.id, internalReference: existingInvoice.internal_reference, existed: true }
  }

  const { data: order, error: orderError } = await supabase
    .from('sales_orders')
    .select('id,company_id,customer_id,order_no,status,currency_code,fx_to_base,order_date,due_date,tax_total')
    .eq('company_id', companyId)
    .eq('id', salesOrderId)
    .maybeSingle<SalesOrderDraftSource>()

  if (orderError) throw orderError
  if (!order) {
    throw new Error('Sales order not found for the active company.')
  }
  if (!allowedSalesOrderForInvoice(order.status)) {
    throw new Error('Only confirmed, allocated, shipped, or closed sales orders can become fiscal invoice drafts.')
  }

  const { data: lines, error: linesError } = await supabase
    .from('sales_order_lines')
    .select('id,so_id,item_id,description,line_no,qty,unit_price,discount_pct,line_total')
    .eq('so_id', salesOrderId)
    .order('line_no', { ascending: true })
    .order('created_at', { ascending: true })

  if (linesError) throw linesError

  const sourceLines = ((lines || []) as SalesOrderLineDraftSource[])
    .filter((line) => toNumber(line.qty) > 0)
    .map((line) => ({
      ...line,
      line_total: roundMoney(line.line_total == null ? fallbackLineTotal(line) : toNumber(line.line_total)),
    }))

  if (!sourceLines.length) {
    throw new Error('The selected sales order has no invoiceable lines.')
  }

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

  if (invoiceError) throw invoiceError

  const linePayload = sourceLines.map((line, index) => ({
    company_id: companyId,
    sales_invoice_id: invoice.id,
    sales_order_line_id: line.id,
    item_id: line.item_id,
    description: (line.description || '').trim(),
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
    await maybeVoidDraftInvoice(companyId, invoice.id, 'Automatic invoice draft creation failed while inserting line items.')
    throw new Error(humanizeError(insertLineError, 'The invoice draft could not be completed. The draft was voided for manual review.'))
  }

  return { invoiceId: invoice.id, internalReference: invoice.internal_reference, existed: false }
}

export async function createAndIssueFullCreditNoteForInvoice(
  companyId: string,
  invoiceId: string,
  correctionReasonText: string,
) {
  const trimmedReason = correctionReasonText.trim()
  if (!trimmedReason) {
    throw new Error('A correction reason is required to issue a credit note.')
  }

  const [invoice, lines] = await Promise.all([
    getSalesInvoiceDocument(companyId, invoiceId),
    listSalesInvoiceDocumentLines(companyId, invoiceId),
  ])

  if (!invoice) {
    throw new Error('Sales invoice not found for the active company.')
  }
  if (invoice.document_workflow_status !== 'issued') {
    throw new Error('Credit notes can only be created from issued sales invoices.')
  }
  if (!lines.length) {
    throw new Error('The issued sales invoice has no source lines for a credit note.')
  }

  const { data: note, error: noteError } = await supabase
    .from('sales_credit_notes')
    .insert({
      company_id: companyId,
      original_sales_invoice_id: invoice.id,
      customer_id: invoice.customer_id,
      credit_note_date: isoToday(),
      due_date: null,
      currency_code: invoice.currency_code,
      fx_to_base: invoice.fx_to_base,
      subtotal: invoice.subtotal,
      tax_total: invoice.tax_total,
      total_amount: invoice.total_amount,
      correction_reason_text: trimmedReason,
      source_origin: 'native',
      document_workflow_status: 'draft',
    })
    .select('id,internal_reference')
    .single<{ id: string; internal_reference: string }>()

  if (noteError) throw noteError

  const noteLinePayload = lines.map((line, index) => ({
    company_id: companyId,
    sales_credit_note_id: note.id,
    sales_invoice_line_id: line.id,
    item_id: line.item_id,
    description: line.description,
    qty: line.qty,
    unit_price: line.unit_price,
    tax_rate: line.tax_rate,
    tax_amount: line.tax_amount,
    line_total: line.line_total,
    sort_order: line.sort_order ?? index,
  }))

  const { error: noteLineError } = await supabase
    .from('sales_credit_note_lines')
    .insert(noteLinePayload)

  if (noteLineError) {
    await maybeVoidDraftCreditNote(companyId, note.id, 'Automatic credit note creation failed while inserting line items.')
    throw new Error(humanizeError(noteLineError, 'The credit note draft could not be completed. The draft was voided for manual review.'))
  }

  const { data: issuedNote, error: issueError } = await supabase.rpc('issue_sales_credit_note_mz', {
    p_note_id: note.id,
  })

  if (issueError) {
    throw issueError
  }

  return issuedNote as SalesCreditNoteRow
}
