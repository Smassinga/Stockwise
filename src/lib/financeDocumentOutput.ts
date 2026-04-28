import type {
  SalesCreditNoteLineRow,
  SalesCreditNoteRow,
  SalesDebitNoteLineRow,
  SalesDebitNoteRow,
  SalesInvoiceDocumentLineRow,
  SalesInvoiceDocumentRow,
  VendorCreditNoteLineRow,
  VendorCreditNoteRow,
  VendorDebitNoteLineRow,
  VendorDebitNoteRow,
} from './mzFinance'
import type { VendorBillLineRow, VendorBillStateRow } from './financeDocuments'
import {
  formatOutputCurrency,
  formatOutputDate,
  formatOutputNumber,
  getOutputCopy,
  localizeComputerPhrase,
  resolveDocumentOutputLanguage,
  type OutputLanguage,
} from './financeDocumentOutputLanguage'

type PdfSuite = { jsPDF: typeof import('jspdf').default; autoTable: (...args: any[]) => void }
type OutputField = {
  label: string
  value: string
}
type OutputBlock = {
  title: string
  body: string
}
type OutputBankAccount = {
  title: string
  rows: OutputField[]
}
type OutputParty = {
  legalName: string
  tradeName?: string | null
  taxIdLabel: string
  taxId: string
  address: string[]
  extraFields?: OutputField[]
}
type OutputLine = {
  id: string
  description: string
  code?: string | null
  qty: number
  unitPrice: number
  lineNetTotal: number
  taxAmount: number
  lineGrossTotal: number
  taxRate: number | null
  unitOfMeasure: string | null
}

export type OutputBankAccountInput = {
  name?: string | null
  bankName?: string | null
  accountNumber?: string | null
  currencyCode?: string | null
  swift?: string | null
  nib?: string | null
  taxNumber?: string | null
}

export type FinanceDocumentOutputModel = {
  language: OutputLanguage
  uiLanguage?: OutputLanguage
  documentId: string
  legalReference: string
  documentTypeLabel: string
  statusText: string
  brand: { name: string; logoUrl: string | null }
  metaRows: Array<{ label: string; value: string }>
  leftPartyTitle: string
  rightPartyTitle: string
  leftParty: OutputParty
  rightParty: OutputParty
  lines: OutputLine[]
  noteTitle: string
  noteBody: string
  detailBlocks?: OutputBlock[]
  bankTitle?: string | null
  bankAccounts?: OutputBankAccount[]
  currencyCode: string
  subtotal: number
  taxTotal: number
  totalAmount: number
  baseCurrencyCode: string
  subtotalBase: number
  taxTotalBase: number
  totalAmountBase: number
  exchangeRate?: number | null
  computerPhrase: string
}

export type SalesInvoiceOutputModel = FinanceDocumentOutputModel

type BrandOptions = {
  brandName?: string | null
  logoUrl?: string | null
  lang?: string | null
  orderReference?: string | null
  bankAccounts?: OutputBankAccountInput[] | null
}

let pdfSuitePromise: Promise<PdfSuite> | null = null

const css = `
@page{size:A4;margin:14mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#0f172a;font:10.8px/1.45 "Aptos","Segoe UI",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.doc{width:100%}.sheet{border:1px solid #94a3b8;padding:18px 18px 14px}.header{display:grid;grid-template-columns:minmax(0,1fr) 228px;gap:18px;align-items:start;margin-bottom:14px}.seller{border:1px solid #94a3b8;display:grid;grid-template-columns:88px minmax(0,1fr);gap:14px;padding:14px 16px}.logoWrap{display:flex;align-items:flex-start;justify-content:center}.logoMark{width:68px;height:68px;border:1px solid #94a3b8;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff}.logo{display:block;width:100%;height:100%;object-fit:contain}.logoFallback{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:21px;font-weight:800;letter-spacing:.06em;color:#b91c1c}.sellerCopy{min-width:0}.brand{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#475569}.docType{margin-top:2px;font-size:17px;font-weight:800;letter-spacing:.03em;color:#111827}.ref{margin:4px 0 8px 0;font-size:28px;line-height:1.02;letter-spacing:-.03em;overflow-wrap:anywhere}.sellerLine{margin:2px 0;color:#334155}.sellerStrong{font-weight:800;color:#0f172a}.meta{border:1px solid #94a3b8}.metaTable,.dataTable,.lineTable,.bankTable,.totalsTable{width:100%;border-collapse:collapse;table-layout:fixed}.metaTable td,.metaTable th,.dataTable td,.lineTable td,.lineTable th,.bankTable td,.bankTable th,.totalsTable td,.totalsTable th{border:1px solid #94a3b8;padding:6px 8px;vertical-align:top}.metaTable th,.dataTable th,.lineTable th,.bankTable th,.totalsTable th{background:#f8fafc;color:#1e293b;font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.metaLabel,.dataLabel,.totalsLabel{width:42%;font-size:9px;font-weight:700;color:#475569}.metaValue,.dataValue,.totalsValue{font-weight:700;color:#0f172a}.docBlock{margin-bottom:12px}.docBlock:last-child{margin-bottom:0}.blockTitle{margin:0 0 6px 0;font-size:9.3px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#1e293b}.counterparty{margin-bottom:12px}.lineTable thead th{text-align:left}.lineDesc{font-weight:700;color:#0f172a}.lineMeta{margin-top:3px;font-size:8.7px;color:#64748b}.r{text-align:right}.tv{display:inline-block;white-space:nowrap;font-variant-numeric:tabular-nums}.summary{display:grid;grid-template-columns:minmax(0,1fr) 214px;gap:16px;align-items:start;margin-top:14px}.stack{display:grid;gap:10px;grid-column:1;grid-row:1}.totalsPane{grid-column:2;grid-row:1}.panel{border:1px solid #94a3b8;padding:10px 12px;page-break-inside:avoid;white-space:pre-line}.panelMuted{color:#475569}.bankGroup+.bankGroup{margin-top:8px}.bankHeading{margin:0 0 6px 0;font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#334155}.totalsTable td,.totalsTable th{padding:7px 8px}.totalsTable th{background:#f8fafc}.totalsTable .grand td{font-size:12px;font-weight:800}.totalsTable .sectionHead th{font-size:9.1px}.footer{display:flex;justify-content:space-between;gap:12px;margin-top:14px;padding-top:8px;border-top:1px solid #94a3b8;font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#475569}.footerRight{text-align:right}@media print{.sheet{border:none;padding:0}.footer{position:static}}
`

const textOrDash = (value: string | null | undefined) => String(value || '').trim() || '-'
const fmtCurrency = (language: OutputLanguage, amount: number, currencyCode: string) =>
  formatOutputCurrency(language, amount, currencyCode)
const fmtNumber = (language: OutputLanguage, value: number, digits = 2) =>
  formatOutputNumber(language, value, digits)
const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
const buildAddressLines = (parts: Array<string | null | undefined>) =>
  parts.map((part) => String(part || '').trim()).filter(Boolean)
const noteText = (...parts: Array<string | null | undefined>) =>
  parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n\n').trim()
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function appendBlock(blocks: OutputBlock[], title: string, body?: string | null) {
  const normalized = String(body || '').trim()
  if (!normalized) return
  blocks.push({ title, body: normalized })
}

function parseIsoDate(value?: string | null) {
  const text = String(value || '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month, day))
  return Number.isNaN(date.getTime()) ? null : date
}

function diffDays(start?: string | null, end?: string | null) {
  const startDate = parseIsoDate(start)
  const endDate = parseIsoDate(end)
  if (!startDate || !endDate) return null
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000)
}

function buildPaymentTermsBody(language: OutputLanguage, invoiceDate?: string | null, dueDate?: string | null) {
  const dueText = formatOutputDate(language, dueDate)
  if (dueText === '-') return null
  const days = diffDays(invoiceDate, dueDate)
  if (days == null || days <= 0) {
    return `Pagamento vence em ${dueText}.\nPayment is due on ${dueText}.`
  }
  return `Pagamento deve ser efectuado até ${dueText} (${days} dias após a data da factura).\nPayment should be effected by ${dueText} (${days} days from the invoice date).`
}

function buildSalesBankAccounts(
  language: OutputLanguage,
  accounts: OutputBankAccountInput[] | null | undefined,
  holderName?: string | null,
) {
  const copy = getOutputCopy(language)
  return (accounts || [])
    .map((account) => {
      const bankName = String(account.bankName || '').trim()
      const accountNumber = String(account.accountNumber || '').trim()
      const swift = String(account.swift || '').trim()
      const nib = String(account.nib || '').trim()
      const taxNumber = String(account.taxNumber || '').trim()
      const currencyCode = String(account.currencyCode || '').trim()
      const titleParts = [String(account.name || '').trim(), currencyCode].filter(Boolean)
      const rows: OutputField[] = []
      if (bankName) rows.push({ label: copy.sections.bankName, value: bankName })
      if (accountNumber) rows.push({ label: copy.sections.accountNumber, value: accountNumber })
      if (holderName) rows.push({ label: copy.sections.accountHolder, value: holderName })
      if (nib) rows.push({ label: copy.sections.nib, value: nib })
      if (swift) rows.push({ label: copy.sections.swift, value: swift })
      if (taxNumber) rows.push({ label: copy.sections.taxNumber, value: taxNumber })
      if (rows.length === 0) return null
      return {
        title: titleParts.join(' · ') || bankName || copy.sections.bankDetails,
        rows,
      }
    })
    .filter(Boolean) as OutputBankAccount[]
}

function buildDocumentBlocks(model: FinanceDocumentOutputModel) {
  if (model.detailBlocks?.length) return model.detailBlocks
  return [{ title: model.noteTitle, body: model.noteBody || '-' }]
}

function showBaseTotals(model: FinanceDocumentOutputModel) {
  return model.baseCurrencyCode !== model.currencyCode
    || roundMoney(model.subtotalBase) !== roundMoney(model.subtotal)
    || roundMoney(model.taxTotalBase) !== roundMoney(model.taxTotal)
    || roundMoney(model.totalAmountBase) !== roundMoney(model.totalAmount)
    || roundMoney(Number(model.exchangeRate || 1)) !== 1
}

function workflowText(language: OutputLanguage, status: 'draft' | 'issued' | 'posted' | 'voided') {
  const copy = getOutputCopy(language)
  switch (status) {
    case 'issued':
      return copy.workflow.issued
    case 'posted':
      return copy.workflow.posted
    case 'voided':
      return copy.workflow.voided
    default:
      return copy.workflow.draft
  }
}

function toSalesLines(
  lines: Array<SalesInvoiceDocumentLineRow | SalesCreditNoteLineRow | SalesDebitNoteLineRow>,
): OutputLine[] {
  return lines.map((line) => ({
    id: line.id,
    description: textOrDash((line as any).display_description || line.description),
    code: String((line as any).product_code_snapshot || '').trim() || null,
    qty: Number(line.qty || 0),
    unitPrice: Number(line.unit_price || 0),
    lineNetTotal: Number(line.line_total || 0),
    taxAmount: Number(line.tax_amount || 0),
    lineGrossTotal: Number(line.line_total || 0) + Number(line.tax_amount || 0),
    taxRate: line.tax_rate == null ? null : Number(line.tax_rate),
    unitOfMeasure:
      (line as any).display_unit_of_measure?.trim()
      || line.unit_of_measure_snapshot?.trim()
      || null,
  }))
}

function toVendorLines(
  lines: Array<VendorBillLineRow | VendorCreditNoteLineRow | VendorDebitNoteLineRow>,
): OutputLine[] {
  return lines.map((line) => ({
    id: line.id,
    description: textOrDash(line.description),
    code: null,
    qty: Number(line.qty || 0),
    unitPrice: Number((line as any).unit_cost || 0),
    lineNetTotal: Number(line.line_total || 0),
    taxAmount: Number(line.tax_amount || 0),
    lineGrossTotal: Number(line.line_total || 0) + Number(line.tax_amount || 0),
    taxRate: line.tax_rate == null ? null : Number(line.tax_rate),
    unitOfMeasure: null,
  }))
}

export function buildSalesInvoiceOutputModel(
  invoice: SalesInvoiceDocumentRow,
  lines: SalesInvoiceDocumentLineRow[],
  options?: BrandOptions,
): SalesInvoiceOutputModel {
  const language: OutputLanguage = 'bi'
  const copy = getOutputCopy(language)
  const detailBlocks: OutputBlock[] = []
  appendBlock(
    detailBlocks,
    copy.notes.fiscalNote,
    invoice.vat_exemption_reason_text
      ? `${copy.notes.vatExemptionReason}: ${invoice.vat_exemption_reason_text.trim()}`
      : null,
  )
  appendBlock(detailBlocks, copy.notes.paymentTerms, buildPaymentTermsBody(language, invoice.invoice_date, invoice.due_date))
  const bankAccounts = buildSalesBankAccounts(
    language,
    options?.bankAccounts,
    invoice.seller_legal_name_snapshot || invoice.seller_trade_name_snapshot || null,
  )
  return {
    language,
    uiLanguage: resolveDocumentOutputLanguage(invoice.document_language_code_snapshot, options?.lang),
    documentId: invoice.id,
    legalReference: invoice.internal_reference,
    documentTypeLabel: copy.documentTypes.salesInvoice,
    statusText: workflowText(language, invoice.document_workflow_status),
    brand: {
      name: textOrDash(options?.brandName || invoice.seller_trade_name_snapshot || invoice.seller_legal_name_snapshot),
      logoUrl: options?.logoUrl?.trim() || null,
    },
    metaRows: [
      { label: copy.meta.invoiceDate, value: formatOutputDate(language, invoice.invoice_date) },
      { label: copy.meta.dueDate, value: formatOutputDate(language, invoice.due_date) },
      { label: copy.meta.currency, value: textOrDash(invoice.currency_code || 'MZN') },
      { label: copy.meta.exchangeRate, value: fmtNumber(language, Number(invoice.fx_to_base || 0) > 0 ? Number(invoice.fx_to_base) : 1, 4) },
    ],
    leftPartyTitle: copy.parties.issuer,
    rightPartyTitle: copy.parties.client,
    leftParty: {
      legalName: textOrDash(invoice.seller_legal_name_snapshot),
      tradeName: invoice.seller_trade_name_snapshot?.trim() || null,
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(invoice.seller_nuit_snapshot),
      address: buildAddressLines([
        invoice.seller_address_line1_snapshot,
        invoice.seller_address_line2_snapshot,
        [invoice.seller_city_snapshot, invoice.seller_state_snapshot].filter(Boolean).join(', '),
        invoice.seller_postal_code_snapshot,
        invoice.seller_country_code_snapshot,
      ]),
    },
    rightParty: {
      legalName: textOrDash(invoice.buyer_legal_name_snapshot),
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(invoice.buyer_nuit_snapshot),
      address: buildAddressLines([
        invoice.buyer_address_line1_snapshot,
        invoice.buyer_address_line2_snapshot,
        [invoice.buyer_city_snapshot, invoice.buyer_state_snapshot].filter(Boolean).join(', '),
        invoice.buyer_postal_code_snapshot,
        invoice.buyer_country_code_snapshot,
      ]),
      extraFields: options?.orderReference
        ? [{ label: copy.meta.orderReference, value: textOrDash(options.orderReference) }]
        : [],
    },
    lines: toSalesLines(lines),
    noteTitle: detailBlocks[0]?.title || copy.notes.fiscalNote,
    noteBody: detailBlocks[0]?.body || copy.notes.notApplicable,
    detailBlocks,
    bankTitle: bankAccounts.length ? copy.sections.bankDetails : null,
    bankAccounts,
    currencyCode: invoice.currency_code || 'MZN',
    subtotal: Number(invoice.subtotal || 0),
    taxTotal: Number(invoice.tax_total || 0),
    totalAmount: Number(invoice.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(invoice.subtotal_mzn || 0),
    taxTotalBase: Number(invoice.tax_total_mzn || 0),
    totalAmountBase: Number(invoice.total_amount_mzn || 0),
    exchangeRate: Number(invoice.fx_to_base || 0) > 0 ? Number(invoice.fx_to_base) : 1,
    computerPhrase: localizeComputerPhrase(language, invoice.computer_processed_phrase_snapshot),
  }
}

export function buildSalesCreditNoteOutputModel(
  note: SalesCreditNoteRow,
  lines: SalesCreditNoteLineRow[],
  options?: BrandOptions & { originalInvoiceReference?: string | null },
): FinanceDocumentOutputModel {
  const language: OutputLanguage = 'bi'
  const copy = getOutputCopy(language)
  const detailBlocks: OutputBlock[] = []
  const bankAccounts = buildSalesBankAccounts(
    language,
    options?.bankAccounts,
    note.seller_legal_name_snapshot || note.seller_trade_name_snapshot || null,
  )
  appendBlock(
    detailBlocks,
    copy.notes.correctionReason,
    noteText(
      note.correction_reason_text,
      note.vat_exemption_reason_text
        ? `${copy.notes.vatExemptionReason}: ${note.vat_exemption_reason_text}`
        : null,
    ) || copy.notes.fiscalCorrection,
  )
  return {
    language,
    uiLanguage: resolveDocumentOutputLanguage(note.document_language_code_snapshot, options?.lang),
    documentId: note.id,
    legalReference: note.internal_reference,
    documentTypeLabel: copy.documentTypes.salesCreditNote,
    statusText: workflowText(language, note.document_workflow_status),
    brand: {
      name: textOrDash(options?.brandName || note.seller_trade_name_snapshot || note.seller_legal_name_snapshot),
      logoUrl: options?.logoUrl?.trim() || null,
    },
    metaRows: [
      { label: copy.meta.noteDate, value: formatOutputDate(language, note.credit_note_date) },
      { label: copy.meta.originalInvoice, value: textOrDash(options?.originalInvoiceReference) },
      { label: copy.meta.currency, value: textOrDash(note.currency_code || 'MZN') },
      { label: copy.meta.exchangeRate, value: fmtNumber(language, Number(note.fx_to_base || 0) > 0 ? Number(note.fx_to_base) : 1, 4) },
    ],
    leftPartyTitle: copy.parties.issuer,
    rightPartyTitle: copy.parties.client,
    leftParty: {
      legalName: textOrDash(note.seller_legal_name_snapshot),
      tradeName: note.seller_trade_name_snapshot?.trim() || null,
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(note.seller_nuit_snapshot),
      address: buildAddressLines([
        note.seller_address_line1_snapshot,
        note.seller_address_line2_snapshot,
        [note.seller_city_snapshot, note.seller_state_snapshot].filter(Boolean).join(', '),
        note.seller_postal_code_snapshot,
        note.seller_country_code_snapshot,
      ]),
    },
    rightParty: {
      legalName: textOrDash(note.buyer_legal_name_snapshot),
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(note.buyer_nuit_snapshot),
      address: buildAddressLines([
        note.buyer_address_line1_snapshot,
        note.buyer_address_line2_snapshot,
        [note.buyer_city_snapshot, note.buyer_state_snapshot].filter(Boolean).join(', '),
        note.buyer_postal_code_snapshot,
        note.buyer_country_code_snapshot,
      ]),
    },
    lines: toSalesLines(lines),
    noteTitle: detailBlocks[0]?.title || copy.notes.correctionReason,
    noteBody: detailBlocks[0]?.body || copy.notes.fiscalCorrection,
    detailBlocks,
    bankTitle: bankAccounts.length ? copy.sections.bankDetails : null,
    bankAccounts,
    currencyCode: note.currency_code || 'MZN',
    subtotal: Number(note.subtotal || 0),
    taxTotal: Number(note.tax_total || 0),
    totalAmount: Number(note.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(note.subtotal_mzn || 0),
    taxTotalBase: Number(note.tax_total_mzn || 0),
    totalAmountBase: Number(note.total_amount_mzn || 0),
    exchangeRate: Number(note.fx_to_base || 0) > 0 ? Number(note.fx_to_base) : 1,
    computerPhrase: localizeComputerPhrase(language, note.computer_processed_phrase_snapshot),
  }
}

export function buildSalesDebitNoteOutputModel(
  note: SalesDebitNoteRow,
  lines: SalesDebitNoteLineRow[],
  options?: BrandOptions & { originalInvoiceReference?: string | null },
): FinanceDocumentOutputModel {
  const language: OutputLanguage = 'bi'
  const copy = getOutputCopy(language)
  const detailBlocks: OutputBlock[] = []
  const bankAccounts = buildSalesBankAccounts(
    language,
    options?.bankAccounts,
    note.seller_legal_name_snapshot || note.seller_trade_name_snapshot || null,
  )
  appendBlock(detailBlocks, copy.notes.correctionReason, note.correction_reason_text?.trim() || copy.notes.fiscalAdjustment)
  appendBlock(detailBlocks, copy.notes.paymentTerms, buildPaymentTermsBody(language, note.debit_note_date, note.due_date))
  return {
    language,
    uiLanguage: resolveDocumentOutputLanguage(note.document_language_code_snapshot, options?.lang),
    documentId: note.id,
    legalReference: note.internal_reference,
    documentTypeLabel: copy.documentTypes.salesDebitNote,
    statusText: workflowText(language, note.document_workflow_status),
    brand: {
      name: textOrDash(options?.brandName || note.seller_trade_name_snapshot || note.seller_legal_name_snapshot),
      logoUrl: options?.logoUrl?.trim() || null,
    },
    metaRows: [
      { label: copy.meta.noteDate, value: formatOutputDate(language, note.debit_note_date) },
      { label: copy.meta.originalInvoice, value: textOrDash(options?.originalInvoiceReference) },
      { label: copy.meta.currency, value: textOrDash(note.currency_code || 'MZN') },
      { label: copy.meta.exchangeRate, value: fmtNumber(language, Number(note.fx_to_base || 0) > 0 ? Number(note.fx_to_base) : 1, 4) },
    ],
    leftPartyTitle: copy.parties.issuer,
    rightPartyTitle: copy.parties.client,
    leftParty: {
      legalName: textOrDash(note.seller_legal_name_snapshot),
      tradeName: note.seller_trade_name_snapshot?.trim() || null,
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(note.seller_nuit_snapshot),
      address: buildAddressLines([
        note.seller_address_line1_snapshot,
        note.seller_address_line2_snapshot,
        [note.seller_city_snapshot, note.seller_state_snapshot].filter(Boolean).join(', '),
        note.seller_postal_code_snapshot,
        note.seller_country_code_snapshot,
      ]),
    },
    rightParty: {
      legalName: textOrDash(note.buyer_legal_name_snapshot),
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(note.buyer_nuit_snapshot),
      address: buildAddressLines([
        note.buyer_address_line1_snapshot,
        note.buyer_address_line2_snapshot,
        [note.buyer_city_snapshot, note.buyer_state_snapshot].filter(Boolean).join(', '),
        note.buyer_postal_code_snapshot,
        note.buyer_country_code_snapshot,
      ]),
    },
    lines: toSalesLines(lines),
    noteTitle: detailBlocks[0]?.title || copy.notes.correctionReason,
    noteBody: detailBlocks[0]?.body || copy.notes.fiscalAdjustment,
    detailBlocks,
    bankTitle: bankAccounts.length ? copy.sections.bankDetails : null,
    bankAccounts,
    currencyCode: note.currency_code || 'MZN',
    subtotal: Number(note.subtotal || 0),
    taxTotal: Number(note.tax_total || 0),
    totalAmount: Number(note.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(note.subtotal_mzn || 0),
    taxTotalBase: Number(note.tax_total_mzn || 0),
    totalAmountBase: Number(note.total_amount_mzn || 0),
    exchangeRate: Number(note.fx_to_base || 0) > 0 ? Number(note.fx_to_base) : 1,
    computerPhrase: localizeComputerPhrase(language, note.computer_processed_phrase_snapshot),
  }
}

export function buildVendorBillOutputModel(
  bill: VendorBillStateRow,
  lines: VendorBillLineRow[],
  options: BrandOptions & {
    supplier: { name: string | null; taxId?: string | null; address?: Array<string | null | undefined> }
    company: { legalName: string | null; tradeName?: string | null; taxId?: string | null; address?: Array<string | null | undefined> }
  },
): FinanceDocumentOutputModel {
  const language = resolveDocumentOutputLanguage(null, options.lang)
  const copy = getOutputCopy(language)
  return {
    language,
    documentId: bill.id,
    legalReference: textOrDash(bill.primary_reference || bill.internal_reference),
    documentTypeLabel: copy.documentTypes.vendorBill,
    statusText: workflowText(language, bill.document_workflow_status),
    brand: {
      name: textOrDash(options.brandName || options.company.tradeName || options.company.legalName),
      logoUrl: options.logoUrl?.trim() || null,
    },
    metaRows: [
      { label: copy.meta.invoiceDate, value: formatOutputDate(language, bill.supplier_invoice_date || bill.bill_date) },
      { label: copy.meta.dueDate, value: formatOutputDate(language, bill.due_date) },
      { label: copy.meta.currency, value: textOrDash(bill.currency_code || 'MZN') },
    ],
    leftPartyTitle: copy.parties.supplier,
    rightPartyTitle: copy.parties.company,
    leftParty: {
      legalName: textOrDash(options.supplier.name || bill.counterparty_name),
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(options.supplier.taxId),
      address: buildAddressLines(options.supplier.address || []),
    },
    rightParty: {
      legalName: textOrDash(options.company.legalName),
      tradeName: options.company.tradeName?.trim() || null,
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(options.company.taxId),
      address: buildAddressLines(options.company.address || []),
    },
    lines: toVendorLines(lines),
    noteTitle: copy.notes.references,
    noteBody:
      noteText(
        bill.supplier_invoice_reference ? `${copy.references.supplierInvoiceReference}: ${bill.supplier_invoice_reference}` : null,
        bill.internal_reference ? `${copy.references.stockwiseKey}: ${bill.internal_reference}` : null,
        bill.order_no ? `${copy.references.linkedPurchaseOrder}: ${bill.order_no}` : null,
      ) || copy.notes.apDocument,
    currencyCode: bill.currency_code || 'MZN',
    subtotal: Number(bill.subtotal || 0),
    taxTotal: Number(bill.tax_total || 0),
    totalAmount: Number(bill.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(bill.subtotal || 0) * Number(bill.fx_to_base || 1),
    taxTotalBase: Number(bill.tax_total || 0) * Number(bill.fx_to_base || 1),
    totalAmountBase: Number(bill.total_amount_base || 0),
    computerPhrase: localizeComputerPhrase(language),
  }
}

export function buildVendorCreditNoteOutputModel(
  note: VendorCreditNoteRow,
  lines: VendorCreditNoteLineRow[],
  options: BrandOptions & {
    originalBillReference?: string | null
    supplier: { name: string | null; taxId?: string | null; address?: Array<string | null | undefined> }
    company: { legalName: string | null; tradeName?: string | null; taxId?: string | null; address?: Array<string | null | undefined> }
  },
): FinanceDocumentOutputModel {
  const language = resolveDocumentOutputLanguage(null, options.lang)
  const copy = getOutputCopy(language)
  return {
    language,
    documentId: note.id,
    legalReference: textOrDash(note.supplier_document_reference || note.internal_reference),
    documentTypeLabel: copy.documentTypes.vendorCreditNote,
    statusText: workflowText(language, note.document_workflow_status),
    brand: {
      name: textOrDash(options.brandName || options.company.tradeName || options.company.legalName),
      logoUrl: options.logoUrl?.trim() || null,
    },
    metaRows: [
      { label: copy.meta.noteDate, value: formatOutputDate(language, note.note_date) },
      { label: copy.meta.originalBill, value: textOrDash(options.originalBillReference) },
      { label: copy.meta.currency, value: textOrDash(note.currency_code || 'MZN') },
    ],
    leftPartyTitle: copy.parties.supplier,
    rightPartyTitle: copy.parties.company,
    leftParty: {
      legalName: textOrDash(options.supplier.name),
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(options.supplier.taxId),
      address: buildAddressLines(options.supplier.address || []),
    },
    rightParty: {
      legalName: textOrDash(options.company.legalName),
      tradeName: options.company.tradeName?.trim() || null,
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(options.company.taxId),
      address: buildAddressLines(options.company.address || []),
    },
    lines: toVendorLines(lines),
    noteTitle: copy.notes.correctionReason,
    noteBody:
      noteText(
        note.adjustment_reason_text,
        note.supplier_document_reference ? `${copy.references.supplierInvoiceReference}: ${note.supplier_document_reference}` : null,
        note.internal_reference ? `${copy.references.stockwiseKey}: ${note.internal_reference}` : null,
      ) || copy.notes.supplierCreditAdjustment,
    currencyCode: note.currency_code || 'MZN',
    subtotal: Number(note.subtotal || 0),
    taxTotal: Number(note.tax_total || 0),
    totalAmount: Number(note.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(note.subtotal_base || 0),
    taxTotalBase: Number(note.tax_total_base || 0),
    totalAmountBase: Number(note.total_amount_base || 0),
    computerPhrase: localizeComputerPhrase(language),
  }
}

export function buildVendorDebitNoteOutputModel(
  note: VendorDebitNoteRow,
  lines: VendorDebitNoteLineRow[],
  options: BrandOptions & {
    originalBillReference?: string | null
    supplier: { name: string | null; taxId?: string | null; address?: Array<string | null | undefined> }
    company: { legalName: string | null; tradeName?: string | null; taxId?: string | null; address?: Array<string | null | undefined> }
  },
): FinanceDocumentOutputModel {
  const language = resolveDocumentOutputLanguage(null, options.lang)
  const copy = getOutputCopy(language)
  return {
    language,
    documentId: note.id,
    legalReference: textOrDash(note.supplier_document_reference || note.internal_reference),
    documentTypeLabel: copy.documentTypes.vendorDebitNote,
    statusText: workflowText(language, note.document_workflow_status),
    brand: {
      name: textOrDash(options.brandName || options.company.tradeName || options.company.legalName),
      logoUrl: options.logoUrl?.trim() || null,
    },
    metaRows: [
      { label: copy.meta.noteDate, value: formatOutputDate(language, note.note_date) },
      { label: copy.meta.originalBill, value: textOrDash(options.originalBillReference) },
      { label: copy.meta.currency, value: textOrDash(note.currency_code || 'MZN') },
    ],
    leftPartyTitle: copy.parties.supplier,
    rightPartyTitle: copy.parties.company,
    leftParty: {
      legalName: textOrDash(options.supplier.name),
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(options.supplier.taxId),
      address: buildAddressLines(options.supplier.address || []),
    },
    rightParty: {
      legalName: textOrDash(options.company.legalName),
      tradeName: options.company.tradeName?.trim() || null,
      taxIdLabel: copy.parties.taxIdLabel,
      taxId: textOrDash(options.company.taxId),
      address: buildAddressLines(options.company.address || []),
    },
    lines: toVendorLines(lines),
    noteTitle: copy.notes.correctionReason,
    noteBody:
      noteText(
        note.adjustment_reason_text,
        note.supplier_document_reference ? `${copy.references.supplierInvoiceReference}: ${note.supplier_document_reference}` : null,
        note.internal_reference ? `${copy.references.stockwiseKey}: ${note.internal_reference}` : null,
      ) || copy.notes.supplierDebitAdjustment,
    currencyCode: note.currency_code || 'MZN',
    subtotal: Number(note.subtotal || 0),
    taxTotal: Number(note.tax_total || 0),
    totalAmount: Number(note.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(note.subtotal_base || 0),
    taxTotalBase: Number(note.tax_total_base || 0),
    totalAmountBase: Number(note.total_amount_base || 0),
    computerPhrase: localizeComputerPhrase(language),
  }
}

function escapeBody(text: string) {
  return escapeHtml(text).replace(/\n/g, '<br/>')
}

export function renderFinanceDocumentHtml(model: FinanceDocumentOutputModel) {
  const copy = getOutputCopy(model.language)
  const detailBlocks = buildDocumentBlocks(model)
  const displayBaseTotals = showBaseTotals(model)
  const initials =
    (model.brand.name || model.leftParty.tradeName || model.leftParty.legalName || 'SW')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'SW'
  const renderPartyValue = (party: OutputParty) =>
    [
      `<div class="sellerStrong">${escapeHtml(party.tradeName || party.legalName)}</div>`,
      party.tradeName ? `<div class="panelMuted">${escapeHtml(party.legalName)}</div>` : '',
    ].filter(Boolean).join('')
  const renderFieldRows = (rows: Array<{ label: string; value: string }>, kind: 'meta' | 'data' = 'data') =>
    rows
      .map((row) => `<tr><td class="${kind === 'meta' ? 'metaLabel' : 'dataLabel'}">${escapeHtml(row.label)}</td><td class="${kind === 'meta' ? 'metaValue' : 'dataValue'}">${escapeHtml(row.value)}</td></tr>`)
      .join('')
  const renderBankAccounts = () => {
    if (!model.bankAccounts?.length) return ''
    return `<section class="panel"><h3 class="blockTitle">${escapeHtml(model.bankTitle || copy.sections.bankDetails)}</h3>${model.bankAccounts.map((account) => `<div class="bankGroup"><div class="bankHeading">${escapeHtml(account.title)}</div><table class="bankTable"><tbody>${account.rows.map((row) => `<tr><td class="dataLabel">${escapeHtml(row.label)}</td><td class="dataValue">${escapeHtml(row.value)}</td></tr>`).join('')}</tbody></table></div>`).join('')}</section>`
  }
  const rows = model.lines
    .map((line) => {
      const lineMeta = [
        line.code ? escapeHtml(line.code) : '',
        line.taxRate == null ? '' : `${escapeHtml(copy.table.taxRatePrefix)} ${escapeHtml(fmtNumber(model.language, line.taxRate, 2))}%`,
        `${escapeHtml(copy.table.vat)} ${escapeHtml(fmtCurrency(model.language, line.taxAmount, model.currencyCode))}`,
      ].filter(Boolean).join(' · ')
      return `<tr><td><div class="lineDesc">${escapeHtml(line.description)}</div>${lineMeta ? `<div class="lineMeta">${lineMeta}</div>` : ''}</td><td class="r"><span class="tv">${escapeHtml(fmtNumber(model.language, line.qty, 2))}</span></td><td class="r"><span class="tv">${escapeHtml(textOrDash(line.unitOfMeasure))}</span></td><td class="r"><span class="tv">${escapeHtml(fmtCurrency(model.language, line.unitPrice, model.currencyCode))}</span></td><td class="r"><span class="tv">${escapeHtml(fmtCurrency(model.language, line.lineNetTotal, model.currencyCode))}</span></td></tr>`
    })
    .join('')
  const metaRows = [
    { label: model.documentTypeLabel, value: model.legalReference },
    ...model.metaRows,
  ]
  const counterpartyRows = [
    { label: copy.parties.client, value: renderPartyValue(model.rightParty) },
    { label: copy.sections.address, value: buildAddressLines(model.rightParty.address).map(escapeHtml).join('<br/>') || '-' },
    { label: model.rightParty.taxIdLabel, value: escapeHtml(model.rightParty.taxId) },
    ...(model.rightParty.extraFields || []).map((row) => ({ label: row.label, value: escapeHtml(row.value) })),
  ]
  return `<!doctype html><html lang="${escapeHtml(model.language)}"><head><meta charset="utf-8"/><title>${escapeHtml(model.documentTypeLabel)} ${escapeHtml(model.legalReference)}</title><style>${css}</style></head><body><div class="doc"><div class="sheet"><header class="header"><section class="seller"><div class="logoWrap"><div class="logoMark">${model.brand.logoUrl ? `<img src="${escapeHtml(model.brand.logoUrl)}" alt="${escapeHtml(model.brand.name)}" class="logo"/>` : `<div class="logoFallback">${escapeHtml(initials)}</div>`}</div></div><div class="sellerCopy"><div class="brand">${escapeHtml(model.brand.name)}</div><div class="docType">${escapeHtml(model.documentTypeLabel)}</div><div class="ref">${escapeHtml(model.legalReference)}</div><div class="sellerLine sellerStrong">${escapeHtml(model.leftParty.legalName)}</div>${model.leftParty.tradeName ? `<div class="sellerLine">${escapeHtml(model.leftParty.tradeName)}</div>` : ''}${buildAddressLines(model.leftParty.address).map((line) => `<div class="sellerLine">${escapeHtml(line)}</div>`).join('')}<div class="sellerLine"><span class="sellerStrong">${escapeHtml(model.leftParty.taxIdLabel)}:</span> ${escapeHtml(model.leftParty.taxId)}</div></div></section><section class="meta"><table class="metaTable"><tbody>${renderFieldRows(metaRows, 'meta')}</tbody></table></section></header><section class="counterparty"><table class="dataTable"><tbody>${counterpartyRows.map((row) => `<tr><td class="dataLabel">${escapeHtml(row.label)}</td><td class="dataValue">${row.value}</td></tr>`).join('')}</tbody></table></section><section class="docBlock"><table class="lineTable"><thead><tr><th>${escapeHtml(copy.table.description)}</th><th class="r">${escapeHtml(copy.table.qty)}</th><th class="r">${escapeHtml(copy.table.unit)}</th><th class="r">${escapeHtml(copy.table.unitPrice)}</th><th class="r">${escapeHtml(copy.table.total)}</th></tr></thead><tbody>${rows}</tbody></table></section><div class="summary"><section class="totalsPane"><table class="totalsTable"><tbody><tr class="sectionHead"><th colspan="2">${escapeHtml(model.currencyCode)}</th></tr><tr><td class="totalsLabel">${escapeHtml(copy.totals.subtotal)}</td><td class="r totalsValue"><span class="tv">${escapeHtml(fmtCurrency(model.language, model.subtotal, model.currencyCode))}</span></td></tr><tr><td class="totalsLabel">${escapeHtml(copy.totals.vat)}</td><td class="r totalsValue"><span class="tv">${escapeHtml(fmtCurrency(model.language, model.taxTotal, model.currencyCode))}</span></td></tr><tr class="grand"><td class="totalsLabel">${escapeHtml(copy.totals.total)}</td><td class="r totalsValue"><span class="tv">${escapeHtml(fmtCurrency(model.language, model.totalAmount, model.currencyCode))}</span></td></tr>${displayBaseTotals ? `<tr class="sectionHead"><th colspan="2">${escapeHtml(model.baseCurrencyCode)}</th></tr><tr><td class="totalsLabel">${escapeHtml(copy.totals.baseSubtotal)}</td><td class="r totalsValue"><span class="tv">${escapeHtml(fmtCurrency(model.language, model.subtotalBase, model.baseCurrencyCode))}</span></td></tr><tr><td class="totalsLabel">${escapeHtml(copy.totals.baseVat)}</td><td class="r totalsValue"><span class="tv">${escapeHtml(fmtCurrency(model.language, model.taxTotalBase, model.baseCurrencyCode))}</span></td></tr><tr class="grand"><td class="totalsLabel">${escapeHtml(copy.totals.baseTotal)}</td><td class="r totalsValue"><span class="tv">${escapeHtml(fmtCurrency(model.language, model.totalAmountBase, model.baseCurrencyCode))}</span></td></tr>` : ''}</tbody></table></section><div class="stack">${detailBlocks.map((block) => `<section class="panel"><h3 class="blockTitle">${escapeHtml(block.title)}</h3><div class="panelMuted">${escapeBody(block.body)}</div></section>`).join('')}${renderBankAccounts()}</div></div><footer class="footer"><div>${escapeHtml(model.computerPhrase)}</div><div class="footerRight">&nbsp;</div></footer></div></div></body></html>`
}

function stablePdfValue(value: string | null | undefined) {
  const text = String(value || '').trim()
  return text ? text.replace(/\s+/g, '\u00A0') : '-'
}

function safeFileName(reference: string) {
  const sanitized = String(reference || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, ' ')
  return sanitized || 'document'
}

async function loadPdfSuite() {
  if (!pdfSuitePromise) {
    pdfSuitePromise = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(([jspdf, jspdfAutoTable]) => ({
      jsPDF: jspdf.default,
      autoTable: (jspdfAutoTable as any).default ?? jspdfAutoTable,
    }))
  }
  return pdfSuitePromise
}

async function fetchDataUrl(src?: string | null): Promise<string | null> {
  if (!src || !src.trim()) return null
  try {
    const response = await fetch(src, { mode: 'cors', cache: 'no-store' })
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

export async function generateFinanceDocumentPdfBlob(model: FinanceDocumentOutputModel) {
  const copy = getOutputCopy(model.language)
  const detailBlocks = buildDocumentBlocks(model)
  const displayBaseTotals = showBaseTotals(model)
  const { jsPDF, autoTable } = await loadPdfSuite()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginLeft = 38
  const marginRight = 38
  const marginTop = 38
  const marginBottom = 24
  const footerReserve = 26
  const contentWidth = pageWidth - marginLeft - marginRight
  const metaWidth = 214
  const metaX = pageWidth - marginRight - metaWidth
  const sellerWidth = contentWidth - metaWidth - 14
  const printableBottom = pageHeight - marginBottom - footerReserve
  const logoDataUrl = await fetchDataUrl(model.brand.logoUrl)
  const metaRows = [{ label: model.documentTypeLabel, value: model.legalReference }, ...model.metaRows]
  const customerRows = [
    {
      label: copy.parties.client,
      value: [
        model.rightParty.tradeName || model.rightParty.legalName,
        model.rightParty.tradeName ? model.rightParty.legalName : null,
      ].filter(Boolean).join('\n'),
    },
    {
      label: copy.sections.address,
      value: buildAddressLines(model.rightParty.address).join('\n') || '-',
    },
    {
      label: model.rightParty.taxIdLabel,
      value: textOrDash(model.rightParty.taxId),
    },
    ...(model.rightParty.extraFields || []).map((row) => ({ label: row.label, value: row.value })),
  ]
  const initials =
    (model.brand.name || model.leftParty.tradeName || model.leftParty.legalName || 'SW')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'SW'
  const sellerTextWidth = sellerWidth - 106
  const split = (text: string, width: number) => doc.splitTextToSize(String(text || ''), width) as string[]
  const sellerAddress = buildAddressLines(model.leftParty.address)
  const sellerBlocks = [
    { lines: split(model.brand.name, sellerTextWidth), size: 9.3, style: 'bold' as const, color: [71, 85, 105] as [number, number, number], lineHeight: 11 },
    { lines: split(model.documentTypeLabel, sellerTextWidth), size: 15, style: 'bold' as const, color: [15, 23, 42] as [number, number, number], lineHeight: 17 },
    { lines: split(model.legalReference, sellerTextWidth), size: 23, style: 'bold' as const, color: [15, 23, 42] as [number, number, number], lineHeight: 22 },
    { lines: split(model.leftParty.legalName, sellerTextWidth), size: 10.3, style: 'bold' as const, color: [15, 23, 42] as [number, number, number], lineHeight: 11.5 },
    ...(model.leftParty.tradeName
      ? [{ lines: split(model.leftParty.tradeName, sellerTextWidth), size: 9.2, style: 'normal' as const, color: [71, 85, 105] as [number, number, number], lineHeight: 10.5 }]
      : []),
    ...sellerAddress.map((line) => ({
      lines: split(line, sellerTextWidth),
      size: 8.9,
      style: 'normal' as const,
      color: [51, 65, 85] as [number, number, number],
      lineHeight: 10,
    })),
    {
      lines: split(`${model.leftParty.taxIdLabel}: ${textOrDash(model.leftParty.taxId)}`, sellerTextWidth),
      size: 8.9,
      style: 'normal' as const,
      color: [15, 23, 42] as [number, number, number],
      lineHeight: 10,
    },
  ]
  const sellerContentHeight = sellerBlocks.reduce((sum, block, index) => sum + (block.lines.length * block.lineHeight) + (index === 2 ? 6 : 2), 0)
  const headerHeight = Math.max(124, sellerContentHeight + 22, 18 + metaRows.length * 24)
  let y = marginTop

  const ensureSpace = (requiredHeight: number) => {
    if (y + requiredHeight > printableBottom) {
      doc.addPage()
      y = marginTop
    }
  }

  ensureSpace(headerHeight)
  doc.setDrawColor(148, 163, 184)
  doc.setFillColor(255, 255, 255)
  doc.rect(marginLeft, y, sellerWidth, headerHeight, 'FD')
  doc.rect(metaX, y, metaWidth, headerHeight, 'FD')

  const logoX = marginLeft + 12
  const logoY = y + 12
  const logoSize = 64
  doc.setDrawColor(148, 163, 184)
  doc.rect(logoX, logoY, logoSize, logoSize)

  if (logoDataUrl) {
    try {
      doc.addImage(
        logoDataUrl,
        logoDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG',
        logoX,
        logoY,
        logoSize,
        logoSize,
        undefined,
        'FAST',
      )
    } catch {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(185, 28, 28)
      doc.setFontSize(21)
      doc.text(initials, logoX + (logoSize / 2), logoY + 40, { align: 'center' })
    }
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(185, 28, 28)
    doc.setFontSize(21)
    doc.text(initials, logoX + (logoSize / 2), logoY + 40, { align: 'center' })
  }

  let sellerCursorY = y + 16
  const sellerTextX = logoX + logoSize + 12
  sellerBlocks.forEach((block, index) => {
    doc.setFont('helvetica', block.style)
    doc.setTextColor(block.color[0], block.color[1], block.color[2])
    doc.setFontSize(block.size)
    doc.text(block.lines, sellerTextX, sellerCursorY)
    sellerCursorY += (block.lines.length * block.lineHeight) + (index === 2 ? 6 : 2)
  })

  metaRows.forEach((row, index) => {
    const rowTop = y + index * 24
    if (index > 0) {
      doc.line(metaX, rowTop, metaX + metaWidth, rowTop)
    }
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(8.3)
    doc.text(row.label, metaX + 8, rowTop + 15)
    doc.setFontSize(9.4)
    doc.setTextColor(15, 23, 42)
    const valueLines = split(stablePdfValue(row.value), metaWidth - 110)
    doc.text(valueLines, metaX + metaWidth - 8, rowTop + 15, { align: 'right' })
  })

  y += headerHeight + 14

  autoTable(doc as any, {
    startY: y,
    margin: { left: marginLeft, right: marginRight },
    tableWidth: contentWidth,
    columns: [
      { header: '', dataKey: 'label' },
      { header: '', dataKey: 'value' },
    ],
    body: customerRows,
    theme: 'grid',
    styles: {
      fontSize: 8.8,
      cellPadding: { top: 7, right: 8, bottom: 7, left: 8 },
      lineColor: [148, 163, 184],
      lineWidth: 0.5,
      textColor: [15, 23, 42],
      overflow: 'linebreak',
      valign: 'top',
    },
    columnStyles: {
      label: { cellWidth: 154, fontStyle: 'bold', textColor: [30, 41, 59] },
      value: { cellWidth: contentWidth - 154 },
    },
    didParseCell: (hookData: any) => {
      if (hookData.section === 'head') {
        hookData.cell.styles.minCellHeight = 0
      }
      if (hookData.section === 'body' && hookData.column.dataKey === 'label') {
        hookData.cell.styles.fillColor = [248, 250, 252]
      }
    },
    showHead: 'never',
  })

  y = ((((doc as any).lastAutoTable?.finalY as number | undefined) ?? y) + 14)
  ensureSpace(40)

  const descriptionWidth = Math.round(contentWidth * 0.48)
  const qtyWidth = Math.round(contentWidth * 0.11)
  const unitWidth = Math.round(contentWidth * 0.12)
  const unitPriceWidth = Math.round(contentWidth * 0.14)
  const totalWidth = contentWidth - descriptionWidth - qtyWidth - unitWidth - unitPriceWidth
  const rows = model.lines.map((line) => ({
    description: String(line.description || '-'),
    detail: [
      line.code ? line.code : '',
      line.taxRate == null ? '' : `${copy.table.taxRatePrefix} ${fmtNumber(model.language, line.taxRate, 2)}%`,
      `${copy.table.vat} ${fmtCurrency(model.language, line.taxAmount, model.currencyCode)}`,
    ].filter(Boolean).join(' · '),
    qty: stablePdfValue(fmtNumber(model.language, line.qty, 2)),
    unit: stablePdfValue(textOrDash(line.unitOfMeasure)),
    unitPrice: stablePdfValue(fmtCurrency(model.language, line.unitPrice, model.currencyCode)),
    total: stablePdfValue(fmtCurrency(model.language, line.lineNetTotal, model.currencyCode)),
  }))

  autoTable(doc as any, {
    startY: y,
    margin: { left: marginLeft, right: marginRight },
    tableWidth: contentWidth,
    columns: [
      { header: copy.table.description, dataKey: 'description' },
      { header: copy.table.qty, dataKey: 'qty' },
      { header: copy.table.unit, dataKey: 'unit' },
      { header: copy.table.unitPrice, dataKey: 'unitPrice' },
      { header: copy.table.total, dataKey: 'total' },
    ],
    body: rows,
    theme: 'grid',
    styles: {
      fontSize: 8.3,
      cellPadding: { top: 8, right: 6, bottom: 8, left: 6 },
      minCellHeight: 24,
      lineColor: [148, 163, 184],
      lineWidth: 0.5,
      textColor: [15, 23, 42],
      overflow: 'linebreak',
      valign: 'top',
      cellWidth: 'wrap',
    },
    headStyles: {
      fillColor: [248, 250, 252],
      textColor: [30, 41, 59],
      fontStyle: 'bold',
      fontSize: 8.2,
      halign: 'left',
    },
    columnStyles: {
      description: { cellWidth: descriptionWidth, halign: 'left' },
      qty: { cellWidth: qtyWidth, halign: 'right' },
      unit: { cellWidth: unitWidth, halign: 'right' },
      unitPrice: { cellWidth: unitPriceWidth, halign: 'right' },
      total: { cellWidth: totalWidth, halign: 'right' },
    },
    didParseCell: (hookData: any) => {
      if (hookData.section === 'body' && hookData.column.dataKey === 'description') {
        const raw = hookData.row.raw
        hookData.cell.text = raw.detail ? [raw.description, raw.detail] : [raw.description]
        hookData.cell.styles.textColor = [255, 255, 255]
      }
    },
    didDrawCell: (hookData: any) => {
      if (hookData.section !== 'body' || hookData.column.dataKey !== 'description') return
      const raw = hookData.row.raw
      const textX = hookData.cell.x + 6
      let textY = hookData.cell.y + 12
      const descriptionLines = split(raw.description, hookData.cell.width - 12)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(15, 23, 42)
      doc.setFontSize(8.9)
      doc.text(descriptionLines, textX, textY)
      if (raw.detail) {
        textY += descriptionLines.length * 10 + 2
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(100, 116, 139)
        doc.setFontSize(7.8)
        doc.text(split(raw.detail, hookData.cell.width - 12), textX, textY)
      }
    },
  })

  y = ((((doc as any).lastAutoTable?.finalY as number | undefined) ?? y) + 14)
  const totalsX = pageWidth - marginRight - 216
  const drawTotalsTable = (startY: number, currencyLabel: string, rows: Array<[string, string]>) => {
    autoTable(doc as any, {
      startY,
      margin: { left: totalsX, right: marginRight },
      tableWidth: 216,
      head: [[{ content: currencyLabel, colSpan: 2, styles: { fillColor: [248, 250, 252], textColor: [30, 41, 59], fontStyle: 'bold', halign: 'left' } }]],
      body: rows.map(([label, value]) => [label, value]),
      theme: 'grid',
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 7, right: 8, bottom: 7, left: 8 },
        lineColor: [148, 163, 184],
        lineWidth: 0.5,
        textColor: [15, 23, 42],
      },
      columnStyles: {
        0: { cellWidth: 118, fontStyle: 'bold', textColor: [30, 41, 59] },
        1: { cellWidth: 98, halign: 'right' },
      },
      didParseCell: (hookData: any) => {
        if (hookData.section === 'body' && hookData.row.index === rows.length - 1) {
          hookData.cell.styles.fontStyle = 'bold'
          hookData.cell.styles.fontSize = 9.1
        }
      },
    })
    return (((doc as any).lastAutoTable?.finalY as number | undefined) ?? startY)
  }

  ensureSpace(displayBaseTotals ? 146 : 88)
  let totalsY = drawTotalsTable(y, model.currencyCode, [
    [copy.totals.subtotal, stablePdfValue(fmtCurrency(model.language, model.subtotal, model.currencyCode))],
    [copy.totals.vat, stablePdfValue(fmtCurrency(model.language, model.taxTotal, model.currencyCode))],
    [copy.totals.total, stablePdfValue(fmtCurrency(model.language, model.totalAmount, model.currencyCode))],
  ]) + 10
  if (displayBaseTotals) {
    totalsY = drawTotalsTable(totalsY, model.baseCurrencyCode, [
      [copy.totals.baseSubtotal, stablePdfValue(fmtCurrency(model.language, model.subtotalBase, model.baseCurrencyCode))],
      [copy.totals.baseVat, stablePdfValue(fmtCurrency(model.language, model.taxTotalBase, model.baseCurrencyCode))],
      [copy.totals.baseTotal, stablePdfValue(fmtCurrency(model.language, model.totalAmountBase, model.baseCurrencyCode))],
    ]) + 10
  }
  y = totalsY

  const panelPadding = 10
  detailBlocks.forEach((block) => {
    const bodyLines = split(block.body || '-', contentWidth - (panelPadding * 2))
    const blockHeight = 28 + (bodyLines.length * 10) + panelPadding
    ensureSpace(blockHeight + 10)
    doc.rect(marginLeft, y, contentWidth, blockHeight)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(8.6)
    doc.text(block.title, marginLeft + panelPadding, y + 15)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(71, 85, 105)
    doc.setFontSize(8.5)
    doc.text(bodyLines, marginLeft + panelPadding, y + 31)
    y += blockHeight + 10
  })
  if (model.bankAccounts?.length) {
    const sectionTitleHeight = 18
    ensureSpace(sectionTitleHeight)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.setFontSize(8.6)
    doc.text(model.bankTitle || copy.sections.bankDetails, marginLeft, y + 12)
    y += sectionTitleHeight

    model.bankAccounts.forEach((account) => {
      ensureSpace(22)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(51, 65, 85)
      doc.setFontSize(8.3)
      doc.text(account.title, marginLeft, y + 10)
      y += 14
      autoTable(doc as any, {
        startY: y,
        margin: { left: marginLeft, right: marginRight },
        tableWidth: contentWidth,
        columns: [
          { header: '', dataKey: 'label' },
          { header: '', dataKey: 'value' },
        ],
        body: account.rows,
        theme: 'grid',
        styles: {
          fontSize: 8.2,
          cellPadding: { top: 6, right: 8, bottom: 6, left: 8 },
          lineColor: [148, 163, 184],
          lineWidth: 0.5,
          textColor: [15, 23, 42],
          overflow: 'linebreak',
          valign: 'top',
        },
        columnStyles: {
          label: { cellWidth: 154, fontStyle: 'bold', textColor: [30, 41, 59] },
          value: { cellWidth: contentWidth - 154 },
        },
        didParseCell: (hookData: any) => {
          if (hookData.section === 'body' && hookData.column.dataKey === 'label') {
            hookData.cell.styles.fillColor = [248, 250, 252]
          }
        },
        showHead: 'never',
      })
      y = ((((doc as any).lastAutoTable?.finalY as number | undefined) ?? y) + 10)
    })
  }

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    const footerY = pageHeight - marginBottom
    doc.setDrawColor(148, 163, 184)
    doc.line(marginLeft, footerY - 12, pageWidth - marginRight, footerY - 12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(8)
    doc.text(model.computerPhrase, marginLeft, footerY)
    doc.text(`${copy.footer.pageLabel} ${page}/${pageCount}`, pageWidth - marginRight, footerY, { align: 'right' })
  }
  return doc.output('blob') as Blob
}

async function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

async function triggerIframePrint(srcDoc: string, language: OutputLanguage) {
  const errors = getOutputCopy(language).errors
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.opacity = '0'
  document.body.appendChild(iframe)
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error(errors.printPrepFailed)), 2500)
      iframe.onload = () => {
        window.clearTimeout(timeout)
        resolve()
      }
      iframe.srcdoc = srcDoc
    })
    const frameWindow = iframe.contentWindow
    if (!frameWindow || !iframe.contentDocument) {
      throw new Error(errors.printOpenFailed)
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    const cleanup = () => window.setTimeout(() => iframe.remove(), 1200)
    frameWindow.onafterprint = cleanup
    frameWindow.focus()
    frameWindow.print()
    cleanup()
  } catch (error) {
    iframe.remove()
    throw error
  }
}

export async function printFinanceDocument(model: FinanceDocumentOutputModel) {
  try {
    await triggerIframePrint(renderFinanceDocumentHtml(model), model.language)
  } catch {
    await downloadBlob(await generateFinanceDocumentPdfBlob(model), `${safeFileName(model.legalReference)}.pdf`)
  }
}

export async function downloadFinanceDocumentPdf(model: FinanceDocumentOutputModel) {
  await downloadBlob(await generateFinanceDocumentPdfBlob(model), `${safeFileName(model.legalReference)}.pdf`)
}

export async function shareFinanceDocument(model: FinanceDocumentOutputModel) {
  const copy = getOutputCopy(model.language)
  if (!('share' in navigator) || typeof navigator.share !== 'function') {
    throw new Error(copy.errors.shareUnavailable)
  }
  const blob = await generateFinanceDocumentPdfBlob(model)
  const file = new File([blob], `${safeFileName(model.legalReference)}.pdf`, { type: 'application/pdf' })
  const payload = {
    title: `${model.documentTypeLabel} ${model.legalReference}`,
    text: `${model.documentTypeLabel} ${model.legalReference}\n${copy.share.dateLabel}: ${model.metaRows[0]?.value || '-'}\n${copy.share.baseTotalLabel}: ${fmtCurrency(model.language, model.totalAmountBase, model.baseCurrencyCode)}`,
    files: [file],
  }
  const canShare = typeof (navigator as any).canShare === 'function' ? (navigator as any).canShare(payload) : true
  if (!canShare) {
    throw new Error(copy.errors.shareUnsupported)
  }
  await navigator.share(payload)
}

export async function printSalesInvoiceDocument(model: SalesInvoiceOutputModel) {
  return await printFinanceDocument(model)
}

export async function downloadSalesInvoicePdf(model: SalesInvoiceOutputModel) {
  return await downloadFinanceDocumentPdf(model)
}

export async function shareSalesInvoiceDocument(model: SalesInvoiceOutputModel) {
  return await shareFinanceDocument(model)
}
