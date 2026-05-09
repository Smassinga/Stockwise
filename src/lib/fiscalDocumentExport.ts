import { saveAs } from 'file-saver'
import type {
  SalesCreditNoteLineRow,
  SalesCreditNoteRow,
  SalesDebitNoteLineRow,
  SalesDebitNoteRow,
  SalesInvoiceDocumentLineRow,
  SalesInvoiceDocumentRow,
} from './mzFinance'
import { supabase } from './supabase'
import { loadCompanyExportHeader, type ExportCompanyHeader } from './excelExport'
import { listFinanceActorDirectory } from './financeAudit'
import type { SalesInvoiceStateRow } from './financeDocuments'

export type FiscalDocumentExportDocumentType =
  | 'all'
  | 'sales_invoice'
  | 'sales_credit_note'
  | 'sales_debit_note'

export type FiscalDocumentExportStatus = 'all' | 'draft' | 'issued' | 'voided'

export type FiscalDocumentExportFilters = {
  dateFrom?: string
  dateTo?: string
  documentType?: FiscalDocumentExportDocumentType
  status?: FiscalDocumentExportStatus
  customer?: string
  currency?: string
}

type FiscalDocumentKind = Exclude<FiscalDocumentExportDocumentType, 'all'>

type ItemLookupRow = {
  id: string
  sku: string | null
  name: string | null
  base_uom_id: string | null
}

type UomLookupRow = {
  id: string
  code: string | null
}

type InvoiceSettlementRow = Pick<
  SalesInvoiceStateRow,
  'id' | 'settlement_status' | 'settled_base' | 'cash_received_base' | 'bank_received_base'
>

type FiscalDocumentRow = {
  kind: FiscalDocumentKind
  id: string
  sourceDocumentNumber: string
  documentType: string
  documentNumber: string
  documentDate: string
  dueDate: string
  customerName: string
  customerNuit: string
  customerReference: string
  currency: string
  exchangeRate: number
  status: string
  taxableAmount: number
  vatAmount: number
  totalAmount: number
  taxableAmountMzn: number
  vatAmountMzn: number
  totalAmountMzn: number
  issuerName: string
  issuerNuit: string
  issuerAddress: string
  createdBy: string
  postedBy: string
  createdAt: string
  postedAt: string
  settlementStatus: string
  settledAmountBase: number | null
  paymentMethod: string
  cashBankReference: string
  settlementDate: string
}

type FiscalLineRow = {
  kind: FiscalDocumentKind
  documentNumber: string
  lineNumber: number
  itemCode: string
  description: string
  quantity: number
  unit: string
  unitPrice: number
  discount: string
  taxableAmount: number
  vatRate: number | null
  vatAmount: number
  lineTotal: number
}

type FiscalExportData = {
  company: ExportCompanyHeader
  headers: FiscalDocumentRow[]
  lines: FiscalLineRow[]
  filters: FiscalDocumentExportFilters
}

const DOCUMENT_LABELS: Record<FiscalDocumentKind, string> = {
  sales_invoice: 'Factura / Invoice',
  sales_credit_note: 'Nota de Crédito / Credit Note',
  sales_debit_note: 'Nota de Débito / Debit Note',
}

const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function looksLikeUuid(value: string | null | undefined) {
  return UUID_LIKE_PATTERN.test(normalizeText(value))
}

function buildAddress(parts: Array<string | null | undefined>) {
  return parts.map(normalizeText).filter(Boolean).join(' | ')
}

function normalizeFilterText(value?: string) {
  return normalizeText(value).toLowerCase()
}

function shouldInclude(kind: FiscalDocumentKind, requested?: FiscalDocumentExportDocumentType) {
  return !requested || requested === 'all' || requested === kind
}

function applyDateAndStatusFilters<T>(
  query: T,
  dateColumn: string,
  filters: FiscalDocumentExportFilters,
): T {
  let nextQuery = query as any
  if (filters.dateFrom) nextQuery = nextQuery.gte(dateColumn, filters.dateFrom)
  if (filters.dateTo) nextQuery = nextQuery.lte(dateColumn, filters.dateTo)
  if (filters.status && filters.status !== 'all') {
    nextQuery = nextQuery.eq('document_workflow_status', filters.status)
  }
  if (filters.currency) {
    nextQuery = nextQuery.eq('currency_code', normalizeText(filters.currency).toUpperCase())
  }
  return nextQuery as T
}

function filterByCustomer<T extends { buyer_legal_name_snapshot?: string | null; buyer_nuit_snapshot?: string | null }>(
  rows: T[],
  customer?: string,
) {
  const needle = normalizeFilterText(customer)
  if (!needle) return rows
  return rows.filter((row) =>
    [row.buyer_legal_name_snapshot, row.buyer_nuit_snapshot]
      .map((value) => normalizeFilterText(value || ''))
      .some((value) => value.includes(needle)),
  )
}

async function loadSalesInvoices(companyId: string, filters: FiscalDocumentExportFilters) {
  if (!shouldInclude('sales_invoice', filters.documentType)) return [] as SalesInvoiceDocumentRow[]

  const query = applyDateAndStatusFilters(
    supabase
      .from('sales_invoices')
      .select('*')
      .eq('company_id', companyId)
      .order('invoice_date', { ascending: true })
      .order('created_at', { ascending: true }),
    'invoice_date',
    filters,
  )

  const { data, error } = await query
  if (error) throw error
  return filterByCustomer((data || []) as SalesInvoiceDocumentRow[], filters.customer)
}

async function loadSalesCreditNotes(companyId: string, filters: FiscalDocumentExportFilters) {
  if (!shouldInclude('sales_credit_note', filters.documentType)) return [] as SalesCreditNoteRow[]

  const query = applyDateAndStatusFilters(
    supabase
      .from('sales_credit_notes')
      .select('*')
      .eq('company_id', companyId)
      .order('credit_note_date', { ascending: true })
      .order('created_at', { ascending: true }),
    'credit_note_date',
    filters,
  )

  const { data, error } = await query
  if (error) throw error
  return filterByCustomer((data || []) as SalesCreditNoteRow[], filters.customer)
}

async function loadSalesDebitNotes(companyId: string, filters: FiscalDocumentExportFilters) {
  if (!shouldInclude('sales_debit_note', filters.documentType)) return [] as SalesDebitNoteRow[]

  const query = applyDateAndStatusFilters(
    supabase
      .from('sales_debit_notes')
      .select('*')
      .eq('company_id', companyId)
      .order('debit_note_date', { ascending: true })
      .order('created_at', { ascending: true }),
    'debit_note_date',
    filters,
  )

  const { data, error } = await query
  if (error) throw error
  return filterByCustomer((data || []) as SalesDebitNoteRow[], filters.customer)
}

async function loadLines<TLine>(
  table: string,
  foreignKey: string,
  companyId: string,
  documentIds: string[],
) {
  const ids = Array.from(new Set(documentIds.filter(Boolean)))
  if (!ids.length) return [] as TLine[]

  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('company_id', companyId)
    .in(foreignKey, ids)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data || []) as TLine[]
}

async function loadInvoiceSettlementMap(companyId: string, invoiceIds: string[]) {
  const ids = Array.from(new Set(invoiceIds.filter(Boolean)))
  if (!ids.length) return new Map<string, InvoiceSettlementRow>()

  try {
    const { data, error } = await supabase
      .from('v_sales_invoice_state')
      .select('id,settlement_status,settled_base,cash_received_base,bank_received_base')
      .eq('company_id', companyId)
      .in('id', ids)

    if (error) throw error
    return new Map(((data || []) as InvoiceSettlementRow[]).map((row) => [row.id, row]))
  } catch (error) {
    console.warn('[fiscal-export] Settlement rollup is unavailable; continuing without settlement fields.', error)
    return new Map<string, InvoiceSettlementRow>()
  }
}

async function loadLineLookups(companyId: string, lines: Array<SalesInvoiceDocumentLineRow | SalesCreditNoteLineRow | SalesDebitNoteLineRow>) {
  const itemIds = Array.from(new Set(lines.map((line) => normalizeText(line.item_id)).filter(Boolean)))
  const items = new Map<string, ItemLookupRow>()
  if (itemIds.length) {
    const { data, error } = await supabase
      .from('items')
      .select('id,sku,name,base_uom_id')
      .eq('company_id', companyId)
      .in('id', itemIds)

    if (error) throw error
    ;((data || []) as ItemLookupRow[]).forEach((row) => items.set(row.id, row))
  }

  const uomIds = Array.from(new Set([
    ...lines.map((line) => normalizeText(line.unit_of_measure_snapshot)).filter(looksLikeUuid),
    ...Array.from(items.values()).map((item) => normalizeText(item.base_uom_id)).filter(Boolean),
  ]))
  const uoms = new Map<string, UomLookupRow>()
  if (uomIds.length) {
    const { data, error } = await supabase
      .from('uoms')
      .select('id,code')
      .in('id', uomIds)

    if (error) throw error
    ;((data || []) as UomLookupRow[]).forEach((row) => uoms.set(row.id, row))
  }

  return { items, uoms }
}

function resolveLineCode(
  line: SalesInvoiceDocumentLineRow | SalesCreditNoteLineRow | SalesDebitNoteLineRow,
  item?: ItemLookupRow,
) {
  return normalizeText(line.product_code_snapshot) || normalizeText(item?.sku)
}

function resolveLineUnit(
  line: SalesInvoiceDocumentLineRow | SalesCreditNoteLineRow | SalesDebitNoteLineRow,
  item: ItemLookupRow | undefined,
  uoms: Map<string, UomLookupRow>,
) {
  const snapshot = normalizeText(line.unit_of_measure_snapshot)
  if (snapshot && looksLikeUuid(snapshot)) return normalizeText(uoms.get(snapshot)?.code)
  if (snapshot) return snapshot
  return normalizeText(item?.base_uom_id ? uoms.get(item.base_uom_id)?.code : '')
}

function resolvePaymentMethod(settlement?: InvoiceSettlementRow) {
  if (!settlement) return ''
  const cash = toNumber(settlement.cash_received_base)
  const bank = toNumber(settlement.bank_received_base)
  if (cash > 0 && bank > 0) return 'Cash + Bank'
  if (cash > 0) return 'Cash'
  if (bank > 0) return 'Bank'
  return ''
}

function invoiceHeaderRow(
  invoice: SalesInvoiceDocumentRow,
  company: ExportCompanyHeader,
  actorDirectory: Record<string, string>,
  settlement?: InvoiceSettlementRow,
): FiscalDocumentRow {
  return {
    kind: 'sales_invoice',
    id: invoice.id,
    sourceDocumentNumber: '',
    documentType: DOCUMENT_LABELS.sales_invoice,
    documentNumber: invoice.internal_reference,
    documentDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    customerName: normalizeText(invoice.buyer_legal_name_snapshot),
    customerNuit: normalizeText(invoice.buyer_nuit_snapshot),
    customerReference: '',
    currency: invoice.currency_code || 'MZN',
    exchangeRate: toNumber(invoice.fx_to_base, 1),
    status: invoice.document_workflow_status,
    taxableAmount: toNumber(invoice.subtotal),
    vatAmount: toNumber(invoice.tax_total),
    totalAmount: toNumber(invoice.total_amount),
    taxableAmountMzn: toNumber(invoice.subtotal_mzn),
    vatAmountMzn: toNumber(invoice.tax_total_mzn),
    totalAmountMzn: toNumber(invoice.total_amount_mzn),
    issuerName: normalizeText(invoice.seller_legal_name_snapshot || invoice.seller_trade_name_snapshot || company.legalName || company.companyName),
    issuerNuit: normalizeText(invoice.seller_nuit_snapshot || company.taxId),
    issuerAddress: buildAddress([
      invoice.seller_address_line1_snapshot,
      invoice.seller_address_line2_snapshot,
      [invoice.seller_city_snapshot, invoice.seller_state_snapshot].filter(Boolean).join(', '),
      invoice.seller_postal_code_snapshot,
      invoice.seller_country_code_snapshot,
    ]) || normalizeText(company.address),
    createdBy: invoice.created_by ? actorDirectory[invoice.created_by] || invoice.created_by : '',
    postedBy: invoice.issued_by ? actorDirectory[invoice.issued_by] || invoice.issued_by : '',
    createdAt: invoice.created_at,
    postedAt: invoice.issued_at || '',
    settlementStatus: settlement?.settlement_status || '',
    settledAmountBase: settlement ? toNumber(settlement.settled_base) : null,
    paymentMethod: resolvePaymentMethod(settlement),
    cashBankReference: '',
    settlementDate: '',
  }
}

function creditHeaderRow(
  note: SalesCreditNoteRow,
  originalInvoiceById: Map<string, SalesInvoiceDocumentRow>,
  company: ExportCompanyHeader,
  actorDirectory: Record<string, string>,
): FiscalDocumentRow {
  const sourceInvoice = originalInvoiceById.get(note.original_sales_invoice_id)
  return {
    kind: 'sales_credit_note',
    id: note.id,
    sourceDocumentNumber: sourceInvoice?.internal_reference || note.original_sales_invoice_id,
    documentType: DOCUMENT_LABELS.sales_credit_note,
    documentNumber: note.internal_reference,
    documentDate: note.credit_note_date,
    dueDate: note.due_date || '',
    customerName: normalizeText(note.buyer_legal_name_snapshot),
    customerNuit: normalizeText(note.buyer_nuit_snapshot),
    customerReference: '',
    currency: note.currency_code || 'MZN',
    exchangeRate: toNumber(note.fx_to_base, 1),
    status: note.document_workflow_status,
    taxableAmount: toNumber(note.subtotal),
    vatAmount: toNumber(note.tax_total),
    totalAmount: toNumber(note.total_amount),
    taxableAmountMzn: toNumber(note.subtotal_mzn),
    vatAmountMzn: toNumber(note.tax_total_mzn),
    totalAmountMzn: toNumber(note.total_amount_mzn),
    issuerName: normalizeText(note.seller_legal_name_snapshot || note.seller_trade_name_snapshot || company.legalName || company.companyName),
    issuerNuit: normalizeText(note.seller_nuit_snapshot || company.taxId),
    issuerAddress: buildAddress([
      note.seller_address_line1_snapshot,
      note.seller_address_line2_snapshot,
      [note.seller_city_snapshot, note.seller_state_snapshot].filter(Boolean).join(', '),
      note.seller_postal_code_snapshot,
      note.seller_country_code_snapshot,
    ]) || normalizeText(company.address),
    createdBy: note.created_by ? actorDirectory[note.created_by] || note.created_by : '',
    postedBy: note.issued_by ? actorDirectory[note.issued_by] || note.issued_by : '',
    createdAt: note.created_at,
    postedAt: note.issued_at || '',
    settlementStatus: '',
    settledAmountBase: null,
    paymentMethod: '',
    cashBankReference: '',
    settlementDate: '',
  }
}

function debitHeaderRow(
  note: SalesDebitNoteRow,
  originalInvoiceById: Map<string, SalesInvoiceDocumentRow>,
  company: ExportCompanyHeader,
  actorDirectory: Record<string, string>,
): FiscalDocumentRow {
  const sourceInvoice = originalInvoiceById.get(note.original_sales_invoice_id)
  return {
    kind: 'sales_debit_note',
    id: note.id,
    sourceDocumentNumber: sourceInvoice?.internal_reference || note.original_sales_invoice_id,
    documentType: DOCUMENT_LABELS.sales_debit_note,
    documentNumber: note.internal_reference,
    documentDate: note.debit_note_date,
    dueDate: note.due_date,
    customerName: normalizeText(note.buyer_legal_name_snapshot),
    customerNuit: normalizeText(note.buyer_nuit_snapshot),
    customerReference: '',
    currency: note.currency_code || 'MZN',
    exchangeRate: toNumber(note.fx_to_base, 1),
    status: note.document_workflow_status,
    taxableAmount: toNumber(note.subtotal),
    vatAmount: toNumber(note.tax_total),
    totalAmount: toNumber(note.total_amount),
    taxableAmountMzn: toNumber(note.subtotal_mzn),
    vatAmountMzn: toNumber(note.tax_total_mzn),
    totalAmountMzn: toNumber(note.total_amount_mzn),
    issuerName: normalizeText(note.seller_legal_name_snapshot || note.seller_trade_name_snapshot || company.legalName || company.companyName),
    issuerNuit: normalizeText(note.seller_nuit_snapshot || company.taxId),
    issuerAddress: buildAddress([
      note.seller_address_line1_snapshot,
      note.seller_address_line2_snapshot,
      [note.seller_city_snapshot, note.seller_state_snapshot].filter(Boolean).join(', '),
      note.seller_postal_code_snapshot,
      note.seller_country_code_snapshot,
    ]) || normalizeText(company.address),
    createdBy: note.created_by ? actorDirectory[note.created_by] || note.created_by : '',
    postedBy: note.issued_by ? actorDirectory[note.issued_by] || note.issued_by : '',
    createdAt: note.created_at,
    postedAt: note.issued_at || '',
    settlementStatus: '',
    settledAmountBase: null,
    paymentMethod: '',
    cashBankReference: '',
    settlementDate: '',
  }
}

function toFiscalLineRows(
  kind: FiscalDocumentKind,
  documentNumber: string,
  lines: Array<SalesInvoiceDocumentLineRow | SalesCreditNoteLineRow | SalesDebitNoteLineRow>,
  foreignKey: 'sales_invoice_id' | 'sales_credit_note_id' | 'sales_debit_note_id',
  documentId: string,
  items: Map<string, ItemLookupRow>,
  uoms: Map<string, UomLookupRow>,
) {
  return lines
    .filter((line) => normalizeText((line as any)[foreignKey]) === documentId)
    .map((line, index): FiscalLineRow => {
      const item = line.item_id ? items.get(line.item_id) : undefined
      const taxableAmount = toNumber(line.line_total)
      const vatAmount = toNumber(line.tax_amount)
      return {
        kind,
        documentNumber,
        lineNumber: toNumber(line.sort_order, index + 1) || index + 1,
        itemCode: resolveLineCode(line, item),
        description: normalizeText((line as any).display_description || line.description || item?.name),
        quantity: toNumber(line.qty),
        unit: resolveLineUnit(line, item, uoms),
        unitPrice: toNumber(line.unit_price),
        discount: '',
        taxableAmount,
        vatRate: line.tax_rate == null ? null : toNumber(line.tax_rate),
        vatAmount,
        lineTotal: taxableAmount + vatAmount,
      }
    })
}

async function loadOriginalInvoiceMap(companyId: string, invoiceIds: string[]) {
  const ids = Array.from(new Set(invoiceIds.filter(Boolean)))
  if (!ids.length) return new Map<string, SalesInvoiceDocumentRow>()

  const { data, error } = await supabase
    .from('sales_invoices')
    .select('*')
    .eq('company_id', companyId)
    .in('id', ids)

  if (error) throw error
  return new Map(((data || []) as SalesInvoiceDocumentRow[]).map((row) => [row.id, row]))
}

export async function buildFiscalDocumentExportData(
  companyId: string,
  filters: FiscalDocumentExportFilters,
): Promise<FiscalExportData> {
  const company = await loadCompanyExportHeader(companyId)
  const [invoices, creditNotes, debitNotes] = await Promise.all([
    loadSalesInvoices(companyId, filters),
    loadSalesCreditNotes(companyId, filters),
    loadSalesDebitNotes(companyId, filters),
  ])

  const originalInvoiceById = await loadOriginalInvoiceMap(companyId, [
    ...creditNotes.map((note) => note.original_sales_invoice_id),
    ...debitNotes.map((note) => note.original_sales_invoice_id),
  ])
  const settlementByInvoiceId = await loadInvoiceSettlementMap(companyId, invoices.map((invoice) => invoice.id))

  const allActorIds = Array.from(new Set([
    ...invoices.flatMap((row) => [row.created_by, row.issued_by]),
    ...creditNotes.flatMap((row) => [row.created_by, row.issued_by]),
    ...debitNotes.flatMap((row) => [row.created_by, row.issued_by]),
  ].filter(Boolean) as string[]))
  const actorDirectory = await listFinanceActorDirectory(companyId, allActorIds)

  const [invoiceLines, creditNoteLines, debitNoteLines] = await Promise.all([
    loadLines<SalesInvoiceDocumentLineRow>('sales_invoice_lines', 'sales_invoice_id', companyId, invoices.map((invoice) => invoice.id)),
    loadLines<SalesCreditNoteLineRow>('sales_credit_note_lines', 'sales_credit_note_id', companyId, creditNotes.map((note) => note.id)),
    loadLines<SalesDebitNoteLineRow>('sales_debit_note_lines', 'sales_debit_note_id', companyId, debitNotes.map((note) => note.id)),
  ])
  const allLines = [...invoiceLines, ...creditNoteLines, ...debitNoteLines]
  const { items, uoms } = await loadLineLookups(companyId, allLines)

  const headers = [
    ...invoices.map((invoice) => invoiceHeaderRow(invoice, company, actorDirectory, settlementByInvoiceId.get(invoice.id))),
    ...creditNotes.map((note) => creditHeaderRow(note, originalInvoiceById, company, actorDirectory)),
    ...debitNotes.map((note) => debitHeaderRow(note, originalInvoiceById, company, actorDirectory)),
  ].sort((left, right) =>
    `${left.documentDate} ${left.documentType} ${left.documentNumber}`.localeCompare(
      `${right.documentDate} ${right.documentType} ${right.documentNumber}`,
    ),
  )

  const lines = [
    ...invoices.flatMap((invoice) =>
      toFiscalLineRows('sales_invoice', invoice.internal_reference, invoiceLines, 'sales_invoice_id', invoice.id, items, uoms),
    ),
    ...creditNotes.flatMap((note) =>
      toFiscalLineRows('sales_credit_note', note.internal_reference, creditNoteLines, 'sales_credit_note_id', note.id, items, uoms),
    ),
    ...debitNotes.flatMap((note) =>
      toFiscalLineRows('sales_debit_note', note.internal_reference, debitNoteLines, 'sales_debit_note_id', note.id, items, uoms),
    ),
  ]

  return { company, headers, lines, filters }
}

function filterSummary(filters: FiscalDocumentExportFilters) {
  const parts = [
    filters.dateFrom ? `Data inicial / Date from: ${filters.dateFrom}` : null,
    filters.dateTo ? `Data final / Date to: ${filters.dateTo}` : null,
    filters.documentType && filters.documentType !== 'all' ? `Tipo / Type: ${DOCUMENT_LABELS[filters.documentType]}` : null,
    filters.status && filters.status !== 'all' ? `Estado / Status: ${filters.status}` : null,
    filters.customer ? `Cliente / Customer: ${filters.customer}` : null,
    filters.currency ? `Moeda / Currency: ${filters.currency.toUpperCase()}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' | ') : 'Todos os documentos / All documents'
}

function addMetadataRows(sheet: any, title: string, company: ExportCompanyHeader, filters: FiscalDocumentExportFilters) {
  const companyLine = company.legalName && company.legalName !== company.companyName
    ? `${company.companyName} (${company.legalName})`
    : company.companyName
  sheet.addRow([companyLine])
  sheet.addRow([title])
  sheet.addRow([`NUIT / Tax ID: ${company.taxId || ''}`])
  sheet.addRow([`Endereço / Address: ${company.address || ''}`])
  sheet.addRow([`Gerado em / Generated at: ${new Date().toLocaleString()}`])
  sheet.addRow([`Filtros / Filters: ${filterSummary(filters)}`])
  sheet.addRow([])
  sheet.getCell('A1').font = { bold: true, size: 15 }
  sheet.getCell('A2').font = { bold: true, size: 13 }
}

function applySheetFormatting(sheet: any, headerRowNumber: number, numericColumns: number[]) {
  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }]
  const headerRow = sheet.getRow(headerRowNumber)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.eachCell((cell: any) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      left: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      bottom: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      right: { style: 'thin', color: { argb: 'FFBFDBFE' } },
    }
  })
  sheet.columns.forEach((column: any, index: number) => {
    column.width = Math.min(Math.max(column.header?.length || 14, 14), 34)
    if (numericColumns.includes(index + 1)) {
      column.numFmt = '#,##0.00;[Red]-#,##0.00'
      column.alignment = { horizontal: 'right' }
    }
  })
  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: sheet.columnCount },
  }
}

export async function downloadFiscalDocumentExportWorkbook(data: FiscalExportData) {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StockWise'
  workbook.created = new Date()
  workbook.modified = new Date()

  const documentColumns = [
    ['Empresa / Company', (row: FiscalDocumentRow) => row.issuerName],
    ['NUIT da Empresa / Company Tax ID', (row: FiscalDocumentRow) => row.issuerNuit],
    ['Endereço da Empresa / Company Address', (row: FiscalDocumentRow) => row.issuerAddress],
    ['Tipo de Documento / Document Type', (row: FiscalDocumentRow) => row.documentType],
    ['Número / Number', (row: FiscalDocumentRow) => row.documentNumber],
    ['Documento de Origem / Source Document', (row: FiscalDocumentRow) => row.sourceDocumentNumber],
    ['Data / Date', (row: FiscalDocumentRow) => row.documentDate],
    ['Vencimento / Due Date', (row: FiscalDocumentRow) => row.dueDate],
    ['Cliente / Customer', (row: FiscalDocumentRow) => row.customerName],
    ['NUIT do Cliente / Customer Tax ID', (row: FiscalDocumentRow) => row.customerNuit],
    ['Referência do Cliente / Customer Reference', (row: FiscalDocumentRow) => row.customerReference],
    ['Moeda / Currency', (row: FiscalDocumentRow) => row.currency],
    ['Câmbio / ROE', (row: FiscalDocumentRow) => row.exchangeRate],
    ['Estado / Status', (row: FiscalDocumentRow) => row.status],
    ['Valor Tributável / Taxable Amount', (row: FiscalDocumentRow) => row.taxableAmount],
    ['IVA / VAT', (row: FiscalDocumentRow) => row.vatAmount],
    ['Total', (row: FiscalDocumentRow) => row.totalAmount],
    ['Valor Tributável MZN / Taxable MZN', (row: FiscalDocumentRow) => row.taxableAmountMzn],
    ['IVA MZN / VAT MZN', (row: FiscalDocumentRow) => row.vatAmountMzn],
    ['Total MZN', (row: FiscalDocumentRow) => row.totalAmountMzn],
    ['Criado por / Created By', (row: FiscalDocumentRow) => row.createdBy],
    ['Emitido por / Posted By', (row: FiscalDocumentRow) => row.postedBy],
    ['Criado em / Created At', (row: FiscalDocumentRow) => row.createdAt],
    ['Emitido em / Posted At', (row: FiscalDocumentRow) => row.postedAt],
    ['Estado de Liquidação / Settlement Status', (row: FiscalDocumentRow) => row.settlementStatus],
    ['Valor Liquidado Base / Settled Base Amount', (row: FiscalDocumentRow) => row.settledAmountBase],
    ['Método de Pagamento / Payment Method', (row: FiscalDocumentRow) => row.paymentMethod],
    ['Referência Caixa/Banco / Cash/Bank Reference', (row: FiscalDocumentRow) => row.cashBankReference],
    ['Data de Liquidação / Settlement Date', (row: FiscalDocumentRow) => row.settlementDate],
  ] as const

  const lineColumns = [
    ['Tipo de Documento / Document Type', (row: FiscalLineRow) => DOCUMENT_LABELS[row.kind]],
    ['Número / Number', (row: FiscalLineRow) => row.documentNumber],
    ['Linha / Line', (row: FiscalLineRow) => row.lineNumber],
    ['Código do Artigo / Item Code', (row: FiscalLineRow) => row.itemCode],
    ['Descrição / Description', (row: FiscalLineRow) => row.description],
    ['Quantidade / Quantity', (row: FiscalLineRow) => row.quantity],
    ['Unidade / Unit', (row: FiscalLineRow) => row.unit],
    ['Preço Unitário / Unit Price', (row: FiscalLineRow) => row.unitPrice],
    ['Desconto / Discount', (row: FiscalLineRow) => row.discount],
    ['Valor Tributável / Taxable Amount', (row: FiscalLineRow) => row.taxableAmount],
    ['Taxa IVA / VAT Rate', (row: FiscalLineRow) => row.vatRate],
    ['IVA / VAT', (row: FiscalLineRow) => row.vatAmount],
    ['Total da Linha / Line Total', (row: FiscalLineRow) => row.lineTotal],
  ] as const

  const documentsSheet = workbook.addWorksheet('Documentos')
  addMetadataRows(documentsSheet, 'Exportação de Documentos Fiscais / Fiscal Document Export', data.company, data.filters)
  documentsSheet.addRow(documentColumns.map(([label]) => label))
  data.headers.forEach((row) => documentsSheet.addRow(documentColumns.map(([, value]) => value(row))))
  applySheetFormatting(documentsSheet, 8, [13, 15, 16, 17, 18, 19, 20, 26])

  const linesSheet = workbook.addWorksheet('Linhas')
  addMetadataRows(linesSheet, 'Linhas de Documentos Fiscais / Fiscal Document Lines', data.company, data.filters)
  linesSheet.addRow(lineColumns.map(([label]) => label))
  data.lines.forEach((row) => linesSheet.addRow(lineColumns.map(([, value]) => value(row))))
  applySheetFormatting(linesSheet, 8, [3, 6, 8, 10, 11, 12, 13])

  const suffix = [
    data.filters.dateFrom || 'inicio',
    data.filters.dateTo || 'fim',
  ].join('_')
  const filename = `stockwise-fiscal-document-export-${suffix}.xlsx`
  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  )
  return filename
}

export async function exportFiscalDocumentWorkbook(companyId: string, filters: FiscalDocumentExportFilters) {
  const data = await buildFiscalDocumentExportData(companyId, filters)
  if (!data.headers.length) {
    return {
      filename: null,
      documentCount: 0,
      lineCount: 0,
    }
  }

  const filename = await downloadFiscalDocumentExportWorkbook(data)
  return {
    filename,
    documentCount: data.headers.length,
    lineCount: data.lines.length,
  }
}
