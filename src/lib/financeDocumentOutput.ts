import type {
  SalesCreditNoteLineRow,
  SalesCreditNoteRow,
  SalesDebitNoteLineRow,
  SalesDebitNoteRow,
  SalesInvoiceDocumentLineRow,
  SalesInvoiceDocumentRow,
} from './mzFinance'
import type { VendorBillLineRow, VendorBillStateRow } from './financeDocuments'

type PdfSuite = { jsPDF: typeof import('jspdf').default; autoTable: (...args: any[]) => void }
type OutputParty = { legalName: string; tradeName?: string | null; taxIdLabel: string; taxId: string; address: string[] }
type OutputLine = {
  id: string
  description: string
  qty: number
  unitPrice: number
  taxAmount: number
  lineGrossTotal: number
  taxRate: number | null
  unitOfMeasure: string | null
}

export type FinanceDocumentOutputModel = {
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
  currencyCode: string
  subtotal: number
  taxTotal: number
  totalAmount: number
  baseCurrencyCode: string
  subtotalBase: number
  taxTotalBase: number
  totalAmountBase: number
  computerPhrase: string
}

export type SalesInvoiceOutputModel = FinanceDocumentOutputModel

let pdfSuitePromise: Promise<PdfSuite> | null = null

const css = `
@page{size:A4;margin:12mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#0f172a;font:11px/1.45 "Aptos","Segoe UI",Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}.doc{width:100%}.hero{display:grid;grid-template-columns:86px minmax(0,1fr) 272px;gap:18px;align-items:stretch;margin-bottom:18px;padding:18px 20px;border:1px solid #dbe4ef;border-radius:20px;background:linear-gradient(180deg,#fff 0%,#f8fbff 100%)}.logoWrap{display:flex;align-items:center;justify-content:center}.logoMark{width:72px;height:72px;border-radius:20px;border:1px solid #dbe4ef;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden}.logo{display:block;width:100%;height:100%;object-fit:contain}.logoFallback{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:23px;font-weight:800;letter-spacing:.06em;color:#1d4ed8;background:linear-gradient(180deg,#e8f1ff 0%,#fff 100%)}.heroCopy{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:4px 0}.brand{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b}.docType{font-size:14px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#1d4ed8}.ref{margin:0;font-size:30px;line-height:1.04;letter-spacing:-.04em;overflow-wrap:anywhere}.meta{border:1px solid #dbe4ef;border-radius:18px;background:#fff;padding:16px 18px 17px;display:grid;gap:14px;align-content:center}.chip{display:inline-flex;align-items:center;justify-content:center;width:fit-content;padding:6px 12px;border-radius:999px;background:#e0f2fe;color:#0c4a6e;text-transform:uppercase;letter-spacing:.08em;font-size:9.5px;font-weight:800}.metaGrid{display:grid;gap:8px}.metaRow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:end;padding-bottom:7px;border-bottom:1px solid #eef3f8}.metaRow:last-child{padding-bottom:0;border-bottom:none}.metaLabel{color:#64748b;font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:700}.metaValue{color:#0f172a;font-size:12.5px;font-weight:700;white-space:nowrap;text-align:right;line-height:1.2}.parties{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:18px}.card,.tableCard,.totals,.note{border:1px solid #dbe4ef;border-radius:18px;background:#fff;overflow:hidden;page-break-inside:avoid}.head{padding:12px 16px;border-bottom:1px solid #e7edf4;background:#f8fbff;color:#1e3a8a;text-transform:uppercase;letter-spacing:.12em;font-size:9.7px;font-weight:800}.partyBody{padding:16px 18px 17px;display:grid;gap:6px;min-height:128px;align-content:start;line-height:1.55}.partyName{font-size:13.5px;font-weight:800;color:#0f172a}.muted,.address{color:#475569;line-height:1.6}table{width:100%;border-collapse:collapse;table-layout:fixed}thead th{padding:12px 14px;background:#eff6ff;border-bottom:1px solid #dbe4ef;color:#1e3a8a;text-transform:uppercase;letter-spacing:.07em;font-size:9.5px;font-weight:800;text-align:left;line-height:1.2}tbody td{padding:14px;border-bottom:1px solid #e7edf4;vertical-align:top;line-height:1.5}tbody tr:last-child td{border-bottom:none}.descCol{width:45%;overflow-wrap:anywhere;word-break:break-word}.qtyCol{width:7%}.unitCol{width:8%}.priceCol{width:14%}.taxCol{width:12%}.totalCol{width:14%}.r{text-align:right}.tv{display:inline-block;white-space:nowrap;font-variant-numeric:tabular-nums}.desc{font-weight:700;font-size:11.1px;line-height:1.52;color:#0f172a}.taxRate{margin-top:4px;font-size:9.2px;color:#64748b;line-height:1.4}.summary{display:grid;grid-template-columns:minmax(0,1fr) 326px;gap:16px;align-items:start}.note{padding:16px 18px 18px;background:linear-gradient(180deg,#fbfdff 0%,#f8fafc 100%);white-space:pre-line}.noteTitle{margin:0 0 10px 0;font-size:9.7px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:#1e3a8a}.noteBody{margin:0;color:#475569;line-height:1.6}.totals{padding:16px 18px 18px;display:grid;gap:16px}.section+.section{padding-top:16px;border-top:1px solid #e7edf4}.totHead{margin:0 0 10px 0;font-size:9.4px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:#64748b}.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;margin:0;padding:5px 0;line-height:1.45;font-variant-numeric:tabular-nums}.row.grand{margin-top:4px;padding-top:12px;padding-bottom:8px;border-top:1px solid #dbe4ef;font-size:14px;font-weight:800;color:#0f172a}.foot{margin-top:18px;padding-top:10px;border-top:1px solid #e2e8f0}.footText{font-size:8.8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
`

const textOrDash = (value: string | null | undefined) => String(value || '').trim() || '-'
const fmtCurrency = (amount: number, currencyCode: string) => new Intl.NumberFormat('pt-MZ', { style: 'currency', currency: currencyCode || 'MZN' }).format(amount || 0)
const fmtNumber = (value: number, digits = 2) => new Intl.NumberFormat('pt-MZ', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value || 0)
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const buildAddressLines = (parts: Array<string | null | undefined>) => parts.map((part) => String(part || '').trim()).filter(Boolean)
const noteText = (...parts: Array<string | null | undefined>) => parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n\n').trim()

function workflowText(status: 'draft' | 'issued' | 'voided') {
  switch (status) {
    case 'issued': return 'Emitida'
    case 'voided': return 'Anulada'
    default: return 'Rascunho'
  }
}

function vendorBillWorkflowText(status: VendorBillStateRow['document_workflow_status']) {
  switch (status) {
    case 'posted': return 'Lançada'
    case 'voided': return 'Anulada'
    default: return 'Rascunho'
  }
}

function toSalesLines(lines: Array<SalesInvoiceDocumentLineRow | SalesCreditNoteLineRow | SalesDebitNoteLineRow>): OutputLine[] {
  return lines.map((line) => ({
    id: line.id,
    description: textOrDash((line as any).display_description || line.description),
    qty: Number(line.qty || 0),
    unitPrice: Number(line.unit_price || 0),
    taxAmount: Number(line.tax_amount || 0),
    lineGrossTotal: Number(line.line_total || 0) + Number(line.tax_amount || 0),
    taxRate: line.tax_rate == null ? null : Number(line.tax_rate),
    unitOfMeasure: (line as any).display_unit_of_measure?.trim() || line.unit_of_measure_snapshot?.trim() || null,
  }))
}

export function buildSalesInvoiceOutputModel(invoice: SalesInvoiceDocumentRow, lines: SalesInvoiceDocumentLineRow[], options?: { brandName?: string | null; logoUrl?: string | null }): SalesInvoiceOutputModel {
  return {
    documentId: invoice.id,
    legalReference: invoice.internal_reference,
    documentTypeLabel: 'Fatura',
    statusText: workflowText(invoice.document_workflow_status),
    brand: { name: textOrDash(options?.brandName || invoice.seller_trade_name_snapshot || invoice.seller_legal_name_snapshot), logoUrl: options?.logoUrl?.trim() || null },
    metaRows: [{ label: 'Data da fatura', value: textOrDash(invoice.invoice_date) }, { label: 'Vencimento', value: textOrDash(invoice.due_date) }, { label: 'Moeda', value: textOrDash(invoice.currency_code || 'MZN') }],
    leftPartyTitle: 'Emitente',
    rightPartyTitle: 'Cliente',
    leftParty: { legalName: textOrDash(invoice.seller_legal_name_snapshot), tradeName: invoice.seller_trade_name_snapshot?.trim() || null, taxIdLabel: 'NUIT', taxId: textOrDash(invoice.seller_nuit_snapshot), address: buildAddressLines([invoice.seller_address_line1_snapshot, invoice.seller_address_line2_snapshot, [invoice.seller_city_snapshot, invoice.seller_state_snapshot].filter(Boolean).join(', '), invoice.seller_postal_code_snapshot, invoice.seller_country_code_snapshot]) },
    rightParty: { legalName: textOrDash(invoice.buyer_legal_name_snapshot), taxIdLabel: 'NUIT', taxId: textOrDash(invoice.buyer_nuit_snapshot), address: buildAddressLines([invoice.buyer_address_line1_snapshot, invoice.buyer_address_line2_snapshot, [invoice.buyer_city_snapshot, invoice.buyer_state_snapshot].filter(Boolean).join(', '), invoice.buyer_postal_code_snapshot, invoice.buyer_country_code_snapshot]) },
    lines: toSalesLines(lines),
    noteTitle: 'Motivo de isenção do IVA',
    noteBody: invoice.vat_exemption_reason_text?.trim() || 'Não aplicável a esta fatura.',
    currencyCode: invoice.currency_code || 'MZN',
    subtotal: Number(invoice.subtotal || 0),
    taxTotal: Number(invoice.tax_total || 0),
    totalAmount: Number(invoice.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(invoice.subtotal_mzn || 0),
    taxTotalBase: Number(invoice.tax_total_mzn || 0),
    totalAmountBase: Number(invoice.total_amount_mzn || 0),
    computerPhrase: textOrDash(invoice.computer_processed_phrase_snapshot),
  }
}

export function buildSalesCreditNoteOutputModel(note: SalesCreditNoteRow, lines: SalesCreditNoteLineRow[], options?: { brandName?: string | null; logoUrl?: string | null; originalInvoiceReference?: string | null }): FinanceDocumentOutputModel {
  return {
    documentId: note.id,
    legalReference: note.internal_reference,
    documentTypeLabel: 'Nota de crédito',
    statusText: workflowText(note.document_workflow_status),
    brand: { name: textOrDash(options?.brandName || note.seller_trade_name_snapshot || note.seller_legal_name_snapshot), logoUrl: options?.logoUrl?.trim() || null },
    metaRows: [{ label: 'Data da nota', value: textOrDash(note.credit_note_date) }, { label: 'Fatura original', value: textOrDash(options?.originalInvoiceReference) }, { label: 'Moeda', value: textOrDash(note.currency_code || 'MZN') }],
    leftPartyTitle: 'Emitente',
    rightPartyTitle: 'Cliente',
    leftParty: { legalName: textOrDash(note.seller_legal_name_snapshot), tradeName: note.seller_trade_name_snapshot?.trim() || null, taxIdLabel: 'NUIT', taxId: textOrDash(note.seller_nuit_snapshot), address: buildAddressLines([note.seller_address_line1_snapshot, note.seller_address_line2_snapshot, [note.seller_city_snapshot, note.seller_state_snapshot].filter(Boolean).join(', '), note.seller_postal_code_snapshot, note.seller_country_code_snapshot]) },
    rightParty: { legalName: textOrDash(note.buyer_legal_name_snapshot), taxIdLabel: 'NUIT', taxId: textOrDash(note.buyer_nuit_snapshot), address: buildAddressLines([note.buyer_address_line1_snapshot, note.buyer_address_line2_snapshot, [note.buyer_city_snapshot, note.buyer_state_snapshot].filter(Boolean).join(', '), note.buyer_postal_code_snapshot, note.buyer_country_code_snapshot]) },
    lines: toSalesLines(lines),
    noteTitle: 'Motivo da correção',
    noteBody: noteText(note.correction_reason_text, note.vat_exemption_reason_text ? `Motivo de isenção do IVA: ${note.vat_exemption_reason_text}` : null) || 'Correção fiscal.',
    currencyCode: note.currency_code || 'MZN',
    subtotal: Number(note.subtotal || 0),
    taxTotal: Number(note.tax_total || 0),
    totalAmount: Number(note.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(note.subtotal_mzn || 0),
    taxTotalBase: Number(note.tax_total_mzn || 0),
    totalAmountBase: Number(note.total_amount_mzn || 0),
    computerPhrase: textOrDash(note.computer_processed_phrase_snapshot),
  }
}

export function buildSalesDebitNoteOutputModel(note: SalesDebitNoteRow, lines: SalesDebitNoteLineRow[], options?: { brandName?: string | null; logoUrl?: string | null; originalInvoiceReference?: string | null }): FinanceDocumentOutputModel {
  return {
    documentId: note.id,
    legalReference: note.internal_reference,
    documentTypeLabel: 'Nota de débito',
    statusText: workflowText(note.document_workflow_status),
    brand: { name: textOrDash(options?.brandName || note.seller_trade_name_snapshot || note.seller_legal_name_snapshot), logoUrl: options?.logoUrl?.trim() || null },
    metaRows: [{ label: 'Data da nota', value: textOrDash(note.debit_note_date) }, { label: 'Fatura original', value: textOrDash(options?.originalInvoiceReference) }, { label: 'Moeda', value: textOrDash(note.currency_code || 'MZN') }],
    leftPartyTitle: 'Emitente',
    rightPartyTitle: 'Cliente',
    leftParty: { legalName: textOrDash(note.seller_legal_name_snapshot), tradeName: note.seller_trade_name_snapshot?.trim() || null, taxIdLabel: 'NUIT', taxId: textOrDash(note.seller_nuit_snapshot), address: buildAddressLines([note.seller_address_line1_snapshot, note.seller_address_line2_snapshot, [note.seller_city_snapshot, note.seller_state_snapshot].filter(Boolean).join(', '), note.seller_postal_code_snapshot, note.seller_country_code_snapshot]) },
    rightParty: { legalName: textOrDash(note.buyer_legal_name_snapshot), taxIdLabel: 'NUIT', taxId: textOrDash(note.buyer_nuit_snapshot), address: buildAddressLines([note.buyer_address_line1_snapshot, note.buyer_address_line2_snapshot, [note.buyer_city_snapshot, note.buyer_state_snapshot].filter(Boolean).join(', '), note.buyer_postal_code_snapshot, note.buyer_country_code_snapshot]) },
    lines: toSalesLines(lines),
    noteTitle: 'Motivo da correção',
    noteBody: note.correction_reason_text?.trim() || 'Ajuste fiscal.',
    currencyCode: note.currency_code || 'MZN',
    subtotal: Number(note.subtotal || 0),
    taxTotal: Number(note.tax_total || 0),
    totalAmount: Number(note.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(note.subtotal_mzn || 0),
    taxTotalBase: Number(note.tax_total_mzn || 0),
    totalAmountBase: Number(note.total_amount_mzn || 0),
    computerPhrase: textOrDash(note.computer_processed_phrase_snapshot),
  }
}

export function buildVendorBillOutputModel(bill: VendorBillStateRow, lines: VendorBillLineRow[], options: { brandName?: string | null; logoUrl?: string | null; supplier: { name: string | null; taxId?: string | null; address?: Array<string | null | undefined> }; company: { legalName: string | null; tradeName?: string | null; taxId?: string | null; address?: Array<string | null | undefined> } }): FinanceDocumentOutputModel {
  return {
    documentId: bill.id,
    legalReference: textOrDash(bill.primary_reference || bill.internal_reference),
    documentTypeLabel: 'Fatura de fornecedor',
    statusText: vendorBillWorkflowText(bill.document_workflow_status),
    brand: { name: textOrDash(options.brandName || options.company.tradeName || options.company.legalName), logoUrl: options.logoUrl?.trim() || null },
    metaRows: [{ label: 'Data da fatura', value: textOrDash(bill.supplier_invoice_date || bill.bill_date) }, { label: 'Vencimento', value: textOrDash(bill.due_date) }, { label: 'Moeda', value: textOrDash(bill.currency_code || 'MZN') }],
    leftPartyTitle: 'Fornecedor',
    rightPartyTitle: 'Empresa',
    leftParty: { legalName: textOrDash(options.supplier.name || bill.counterparty_name), taxIdLabel: 'NUIT', taxId: textOrDash(options.supplier.taxId), address: buildAddressLines(options.supplier.address || []) },
    rightParty: { legalName: textOrDash(options.company.legalName), tradeName: options.company.tradeName?.trim() || null, taxIdLabel: 'NUIT', taxId: textOrDash(options.company.taxId), address: buildAddressLines(options.company.address || []) },
    lines: lines.map((line) => ({ id: line.id, description: textOrDash(line.description), qty: Number(line.qty || 0), unitPrice: Number(line.unit_cost || 0), taxAmount: Number(line.tax_amount || 0), lineGrossTotal: Number(line.line_total || 0) + Number(line.tax_amount || 0), taxRate: line.tax_rate == null ? null : Number(line.tax_rate), unitOfMeasure: null })),
    noteTitle: 'Referência operacional',
    noteBody: noteText(bill.supplier_invoice_reference ? `Referência do fornecedor: ${bill.supplier_invoice_reference}` : null, bill.internal_reference ? `Referência interna: ${bill.internal_reference}` : null, bill.order_no ? `Pedido de compra: ${bill.order_no}` : null) || 'Documento de contas a pagar.',
    currencyCode: bill.currency_code || 'MZN',
    subtotal: Number(bill.subtotal || 0),
    taxTotal: Number(bill.tax_total || 0),
    totalAmount: Number(bill.total_amount || 0),
    baseCurrencyCode: 'MZN',
    subtotalBase: Number(bill.subtotal || 0) * Number(bill.fx_to_base || 1),
    taxTotalBase: Number(bill.tax_total || 0) * Number(bill.fx_to_base || 1),
    totalAmountBase: Number(bill.total_amount_base || 0),
    computerPhrase: 'PROCESSADO POR COMPUTADOR',
  }
}

function escapeBody(text: string) {
  return escapeHtml(text).replace(/\n/g, '<br/>')
}

function html(model: FinanceDocumentOutputModel) {
  const initials = (model.brand.name || model.leftParty.tradeName || model.leftParty.legalName || 'SW')
    .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'SW'
  const rows = model.lines.map((line) => {
    const taxRate = line.taxRate == null ? '' : `<div class="taxRate">IVA ${escapeHtml(fmtNumber(line.taxRate, 2))}%</div>`
    return `<tr><td class="descCol"><div class="desc">${escapeHtml(line.description)}</div>${taxRate}</td><td class="r qtyCol"><span class="tv">${escapeHtml(fmtNumber(line.qty, 2))}</span></td><td class="r unitCol"><span class="tv">${escapeHtml(textOrDash(line.unitOfMeasure))}</span></td><td class="r priceCol"><span class="tv">${escapeHtml(fmtCurrency(line.unitPrice, model.currencyCode))}</span></td><td class="r taxCol"><span class="tv">${escapeHtml(fmtCurrency(line.taxAmount, model.currencyCode))}</span></td><td class="r totalCol"><span class="tv">${escapeHtml(fmtCurrency(line.lineGrossTotal, model.currencyCode))}</span></td></tr>`
  }).join('')
  const metaRows = model.metaRows.map((row) => `<div class="metaRow"><div class="metaLabel">${escapeHtml(row.label)}</div><div class="metaValue">${escapeHtml(row.value)}</div></div>`).join('')
  const leftTax = `${escapeHtml(model.leftParty.taxIdLabel)}: ${escapeHtml(model.leftParty.taxId)}`
  const rightTax = `${escapeHtml(model.rightParty.taxIdLabel)}: ${escapeHtml(model.rightParty.taxId)}`
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(model.documentTypeLabel)} ${escapeHtml(model.legalReference)}</title><style>${css}</style></head><body><div class="doc"><header class="hero"><div class="logoWrap"><div class="logoMark">${model.brand.logoUrl ? `<img src="${escapeHtml(model.brand.logoUrl)}" alt="${escapeHtml(model.brand.name)}" class="logo"/>` : `<div class="logoFallback">${escapeHtml(initials)}</div>`}</div></div><div class="heroCopy"><div class="brand">${escapeHtml(model.brand.name)}</div><div class="docType">${escapeHtml(model.documentTypeLabel)}</div><h1 class="ref">${escapeHtml(model.legalReference)}</h1></div><div class="meta"><div><div class="chip">${escapeHtml(model.statusText)}</div></div><div class="metaGrid">${metaRows}</div></div></header><div class="parties"><section class="card"><div class="head">${escapeHtml(model.leftPartyTitle)}</div><div class="partyBody"><div class="partyName">${escapeHtml(model.leftParty.tradeName || model.leftParty.legalName)}</div>${model.leftParty.tradeName ? `<div class="muted">${escapeHtml(model.leftParty.legalName)}</div>` : ''}<div class="muted">${leftTax}</div><div class="address">${buildAddressLines(model.leftParty.address).map(escapeHtml).join('<br/>') || '&mdash;'}</div></div></section><section class="card"><div class="head">${escapeHtml(model.rightPartyTitle)}</div><div class="partyBody"><div class="partyName">${escapeHtml(model.rightParty.tradeName || model.rightParty.legalName)}</div>${model.rightParty.tradeName ? `<div class="muted">${escapeHtml(model.rightParty.legalName)}</div>` : ''}<div class="muted">${rightTax}</div><div class="address">${buildAddressLines(model.rightParty.address).map(escapeHtml).join('<br/>') || '&mdash;'}</div></div></section></div><section class="tableCard"><table><thead><tr><th class="descCol">Descrição</th><th class="r qtyCol">Qtd.</th><th class="r unitCol">Un.</th><th class="r priceCol">Preço unit.</th><th class="r taxCol">IVA</th><th class="r totalCol">Total</th></tr></thead><tbody>${rows}</tbody></table></section><div class="summary"><section class="note"><p class="noteTitle">${escapeHtml(model.noteTitle)}</p><p class="noteBody">${escapeBody(model.noteBody)}</p></section><section class="totals"><div class="section"><p class="totHead">${escapeHtml(model.currencyCode)}</p><div class="row"><div>Subtotal</div><div><span class="tv">${escapeHtml(fmtCurrency(model.subtotal, model.currencyCode))}</span></div></div><div class="row"><div>IVA</div><div><span class="tv">${escapeHtml(fmtCurrency(model.taxTotal, model.currencyCode))}</span></div></div><div class="row grand"><div>Total</div><div><span class="tv">${escapeHtml(fmtCurrency(model.totalAmount, model.currencyCode))}</span></div></div></div><div class="section"><p class="totHead">${escapeHtml(model.baseCurrencyCode)}</p><div class="row"><div>Subtotal fiscal</div><div><span class="tv">${escapeHtml(fmtCurrency(model.subtotalBase, model.baseCurrencyCode))}</span></div></div><div class="row"><div>IVA fiscal</div><div><span class="tv">${escapeHtml(fmtCurrency(model.taxTotalBase, model.baseCurrencyCode))}</span></div></div><div class="row grand"><div>Total fiscal</div><div><span class="tv">${escapeHtml(fmtCurrency(model.totalAmountBase, model.baseCurrencyCode))}</span></div></div></div></section></div><footer class="foot"><div class="footText">${escapeHtml(model.computerPhrase)}</div></footer></div></body></html>`
}

function stablePdfValue(value: string | null | undefined) {
  const text = String(value || '').trim()
  return text ? text.replace(/\s+/g, '\u00A0') : '-'
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

async function pdfBlob(model: FinanceDocumentOutputModel) {
  const { jsPDF, autoTable } = await loadPdfSuite()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginLeft = 42
  const marginRight = 42
  const contentWidth = pageWidth - marginLeft - marginRight
  const metaWidth = 218
  const metaX = pageWidth - marginRight - metaWidth
  const logoDataUrl = await fetchDataUrl(model.brand.logoUrl)
  const initials = (model.brand.name || model.leftParty.tradeName || model.leftParty.legalName || 'SW').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'SW'
  let y = 42
  doc.setFillColor(248, 251, 255); doc.setDrawColor(219, 228, 239); doc.roundedRect(marginLeft, y, contentWidth, 108, 18, 18, 'FD')
  if (logoDataUrl) { try { doc.addImage(logoDataUrl, logoDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', marginLeft + 18, y + 18, 62, 62, undefined, 'FAST') } catch { doc.setFillColor(255,255,255); doc.roundedRect(marginLeft + 18, y + 18, 62, 62, 16, 16, 'F'); doc.setDrawColor(219,228,239); doc.roundedRect(marginLeft + 18, y + 18, 62, 62, 16, 16, 'S'); doc.setFont('helvetica','bold'); doc.setTextColor(29,78,216); doc.setFontSize(21); doc.text(initials, marginLeft + 49, y + 61, { align: 'center' }) } } else { doc.setFillColor(255,255,255); doc.roundedRect(marginLeft + 18, y + 18, 62, 62, 16, 16, 'F'); doc.setDrawColor(219,228,239); doc.roundedRect(marginLeft + 18, y + 18, 62, 62, 16, 16, 'S'); doc.setFont('helvetica','bold'); doc.setTextColor(29,78,216); doc.setFontSize(21); doc.text(initials, marginLeft + 49, y + 61, { align: 'center' }) }
  doc.setFont('helvetica', 'bold'); doc.setTextColor(100,116,139); doc.setFontSize(9.5); doc.text(model.brand.name, marginLeft + 98, y + 25)
  doc.setTextColor(29,78,216); doc.setFontSize(13); doc.text(model.documentTypeLabel.toUpperCase(), marginLeft + 98, y + 46)
  let refSize = 30; doc.setFontSize(refSize); while (refSize > 18 && doc.getTextWidth(model.legalReference) > metaX - (marginLeft + 98) - 18) { refSize -= 0.5; doc.setFontSize(refSize) }
  doc.setTextColor(15,23,42); doc.text(model.legalReference, marginLeft + 98, y + 76)
  doc.setFillColor(255,255,255); doc.roundedRect(metaX, y + 14, metaWidth, 80, 16, 16, 'F'); doc.setDrawColor(219,228,239); doc.roundedRect(metaX, y + 14, metaWidth, 80, 16, 16, 'S')
  doc.setFillColor(224,242,254); doc.roundedRect(metaX + 16, y + 22, 104, 20, 10, 10, 'F'); doc.setFont('helvetica','bold'); doc.setTextColor(12,74,110); doc.setFontSize(9.2); doc.text(model.statusText.toUpperCase(), metaX + 68, y + 36, { align: 'center' })
  model.metaRows.slice(0, 3).forEach((row, index) => { const rowY = y + 56 + index * 18; doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139); doc.setFontSize(8.3); doc.text(row.label.toUpperCase(), metaX + 16, rowY); doc.setTextColor(15,23,42); doc.setFontSize(10.3); doc.text(stablePdfValue(row.value), metaX + metaWidth - 16, rowY, { align: 'right' }); if (index < Math.min(model.metaRows.length, 3) - 1) { doc.setDrawColor(238,243,248); doc.line(metaX + 16, rowY + 7, metaX + metaWidth - 16, rowY + 7) } })
  y += 126
  const partyWidth = (contentWidth - 16) / 2
  const drawParty = (x: number, title: string, party: OutputParty) => {
    const lines = [party.tradeName || party.legalName, ...(party.tradeName ? [party.legalName] : []), `${party.taxIdLabel}: ${party.taxId}`, ...party.address]
    doc.setDrawColor(219,228,239); doc.setFillColor(255,255,255); doc.roundedRect(x, y, partyWidth, 128, 16, 16, 'FD')
    doc.setFillColor(248,251,255); doc.roundedRect(x, y, partyWidth, 28, 16, 16, 'F'); doc.rect(x, y + 18, partyWidth, 10, 'F')
    doc.setFont('helvetica','bold'); doc.setTextColor(30,58,138); doc.setFontSize(9.5); doc.text(title.toUpperCase(), x + 14, y + 18)
    let lineY = y + 46
    lines.forEach((line, index) => { const wrapped = doc.splitTextToSize(String(line), partyWidth - 28); doc.setFont('helvetica', index === 0 ? 'bold' : 'normal'); doc.setTextColor(index === 0 ? 15 : 71, index === 0 ? 23 : 85, index === 0 ? 42 : 105); doc.setFontSize(index === 0 ? 10.8 : 9.5); doc.text(wrapped, x + 14, lineY); lineY += wrapped.length * 12 + 5 })
  }
  drawParty(marginLeft, model.leftPartyTitle, model.leftParty); drawParty(marginLeft + partyWidth + 16, model.rightPartyTitle, model.rightParty)
  y += 146
  const descriptionWidth = Math.round(contentWidth * 0.45), qtyWidth = Math.round(contentWidth * 0.07), unitWidth = Math.round(contentWidth * 0.08), unitPriceWidth = Math.round(contentWidth * 0.14), taxWidth = Math.round(contentWidth * 0.12), totalWidth = contentWidth - descriptionWidth - qtyWidth - unitWidth - unitPriceWidth - taxWidth
  const rows = model.lines.map((line) => ({ description: String(line.description || '-').replace(/([/_.:-])/g, '$1 ').replace(/(.{28})/g, '$1 '), taxLine: line.taxRate == null ? null : `IVA ${fmtNumber(line.taxRate, 2)}%`, qty: stablePdfValue(fmtNumber(line.qty, 2)), unit: stablePdfValue(textOrDash(line.unitOfMeasure)), unitPrice: stablePdfValue(fmtCurrency(line.unitPrice, model.currencyCode)), tax: stablePdfValue(fmtCurrency(line.taxAmount, model.currencyCode)), total: stablePdfValue(fmtCurrency(line.lineGrossTotal, model.currencyCode)) }))
  autoTable(doc as any, { startY: y, margin: { left: marginLeft, right: marginRight }, tableWidth: contentWidth, columns: [{ header: 'Descrição', dataKey: 'description' }, { header: 'Qtd.', dataKey: 'qty' }, { header: 'Un.', dataKey: 'unit' }, { header: 'Preço unit.', dataKey: 'unitPrice' }, { header: 'IVA', dataKey: 'tax' }, { header: 'Total', dataKey: 'total' }], body: rows, theme: 'grid', styles: { fontSize: 8.5, cellPadding: { top: 8, right: 6, bottom: 8, left: 6 }, minCellHeight: 24, lineColor: [231,237,244], lineWidth: .55, textColor: [15,23,42], overflow: 'linebreak', valign: 'top', cellWidth: 'wrap' }, headStyles: { fillColor: [239,246,255], textColor: [30,58,138], fontStyle: 'bold', fontSize: 8.7, halign: 'left' }, columnStyles: { description: { cellWidth: descriptionWidth, halign: 'left' }, qty: { cellWidth: qtyWidth, halign: 'right' }, unit: { cellWidth: unitWidth, halign: 'right' }, unitPrice: { cellWidth: unitPriceWidth, halign: 'right' }, tax: { cellWidth: taxWidth, halign: 'right' }, total: { cellWidth: totalWidth, halign: 'right' } }, didParseCell: (hookData: any) => { if (hookData.section === 'body' && hookData.column.dataKey === 'description') { const raw = hookData.row.raw; hookData.cell.text = raw.taxLine ? [raw.description, raw.taxLine] : [raw.description]; hookData.cell.styles.textColor = [255,255,255] } else if (hookData.section === 'body') hookData.cell.styles.fontSize = 8.1 }, didDrawCell: (hookData: any) => { if (hookData.section !== 'body' || hookData.column.dataKey !== 'description') return; const raw = hookData.row.raw; const textX = hookData.cell.x + 6; let textY = hookData.cell.y + 13; const descriptionLines = doc.splitTextToSize(raw.description, hookData.cell.width - 12); doc.setFont('helvetica','bold'); doc.setTextColor(15,23,42); doc.setFontSize(9.1); doc.text(descriptionLines, textX, textY); if (raw.taxLine) { textY += descriptionLines.length * 10.8 + 2; doc.setFont('helvetica','normal'); doc.setTextColor(100,116,139); doc.setFontSize(8); doc.text(doc.splitTextToSize(raw.taxLine, hookData.cell.width - 12), textX, textY) } } })
  y = ((((doc as any).lastAutoTable?.finalY as number | undefined) ?? y) + 18)
  const noteWidth = contentWidth - 232 - 16; const noteLines = doc.splitTextToSize(model.noteBody || '-', noteWidth - 32); const noteHeight = Math.max(106, 56 + noteLines.length * 11); const sectionHeight = Math.max(noteHeight, 198); if (y + sectionHeight + 34 > pageHeight) { doc.addPage(); y = 42 }
  doc.setDrawColor(219,228,239); doc.setFillColor(251,253,255); doc.roundedRect(marginLeft, y, noteWidth, noteHeight, 16, 16, 'FD'); doc.setFont('helvetica','bold'); doc.setTextColor(30,58,138); doc.setFontSize(9.5); doc.text(model.noteTitle.toUpperCase(), marginLeft + 16, y + 22); doc.setFont('helvetica','normal'); doc.setTextColor(71,85,105); doc.setFontSize(9.3); doc.text(noteLines, marginLeft + 16, y + 46)
  const totalsX = marginLeft + noteWidth + 16; doc.setFillColor(255,255,255); doc.roundedRect(totalsX, y, 232, 198, 16, 16, 'FD'); const totalRow = (label: string, value: string, rowY: number, grand = false) => { doc.setFont('helvetica', grand ? 'bold' : 'normal'); doc.setTextColor(15,23,42); doc.setFontSize(grand ? 11.5 : 9.4); doc.text(label, totalsX + 16, rowY); doc.text(stablePdfValue(value), totalsX + 216, rowY, { align: 'right' }) }; doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139); doc.setFontSize(9); doc.text(model.currencyCode.toUpperCase(), totalsX + 16, y + 22); totalRow('Subtotal', fmtCurrency(model.subtotal, model.currencyCode), y + 50); totalRow('IVA', fmtCurrency(model.taxTotal, model.currencyCode), y + 70); doc.setDrawColor(219,228,239); doc.line(totalsX + 16, y + 82, totalsX + 216, y + 82); totalRow('Total', fmtCurrency(model.totalAmount, model.currencyCode), y + 102, true); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139); doc.setFontSize(9); doc.text(model.baseCurrencyCode.toUpperCase(), totalsX + 16, y + 130); totalRow('Subtotal fiscal', fmtCurrency(model.subtotalBase, model.baseCurrencyCode), y + 158); totalRow('IVA fiscal', fmtCurrency(model.taxTotalBase, model.baseCurrencyCode), y + 178); doc.setDrawColor(219,228,239); doc.line(totalsX + 16, y + 190, totalsX + 216, y + 190); totalRow('Total fiscal', fmtCurrency(model.totalAmountBase, model.baseCurrencyCode), y + 210, true)
  const footerY = Math.max(y + sectionHeight + 14, ((((doc as any).lastAutoTable?.finalY as number | undefined) ?? y) + 20)); doc.setDrawColor(226,232,240); doc.line(marginLeft, footerY, pageWidth - marginRight, footerY); doc.setFont('helvetica','bold'); doc.setTextColor(100,116,139); doc.setFontSize(8.5); doc.text(model.computerPhrase, marginLeft, footerY + 14)
  return doc.output('blob') as Blob
}

async function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url)
}

async function triggerIframePrint(srcDoc: string) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'; iframe.style.right = '0'; iframe.style.bottom = '0'; iframe.style.width = '0'; iframe.style.height = '0'; iframe.style.border = '0'; iframe.style.opacity = '0'
  document.body.appendChild(iframe)
  try {
    await new Promise<void>((resolve, reject) => { const timeout = window.setTimeout(() => reject(new Error('Não foi possível preparar o documento para impressão.')), 2500); iframe.onload = () => { window.clearTimeout(timeout); resolve() } ; iframe.srcdoc = srcDoc })
    const frameWindow = iframe.contentWindow
    if (!frameWindow || !iframe.contentDocument) throw new Error('Não foi possível abrir a janela de impressão.')
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    const cleanup = () => window.setTimeout(() => iframe.remove(), 1200)
    frameWindow.onafterprint = cleanup; frameWindow.focus(); frameWindow.print(); cleanup()
  } catch (error) { iframe.remove(); throw error }
}

export async function printFinanceDocument(model: FinanceDocumentOutputModel) {
  try { await triggerIframePrint(html(model)) } catch { await downloadBlob(await pdfBlob(model), `${model.legalReference}.pdf`) }
}

export async function downloadFinanceDocumentPdf(model: FinanceDocumentOutputModel) {
  await downloadBlob(await pdfBlob(model), `${model.legalReference}.pdf`)
}

export async function shareFinanceDocument(model: FinanceDocumentOutputModel) {
  if (!('share' in navigator) || typeof navigator.share !== 'function') throw new Error('Sharing is not available on the current device.')
  const blob = await pdfBlob(model)
  const file = new File([blob], `${model.legalReference}.pdf`, { type: 'application/pdf' })
  const payload = { title: `${model.documentTypeLabel} ${model.legalReference}`, text: `${model.documentTypeLabel} ${model.legalReference}`, files: [file] }
  const canShare = typeof (navigator as any).canShare === 'function' ? (navigator as any).canShare(payload) : true
  if (!canShare) throw new Error('Sharing the generated PDF is not supported on the current device.')
  await navigator.share(payload)
}

export async function printSalesInvoiceDocument(model: SalesInvoiceOutputModel) { return await printFinanceDocument(model) }
export async function downloadSalesInvoicePdf(model: SalesInvoiceOutputModel) { return await downloadFinanceDocumentPdf(model) }
export async function shareSalesInvoiceDocument(model: SalesInvoiceOutputModel) { return await shareFinanceDocument(model) }
