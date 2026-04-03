import type { SalesInvoiceDocumentLineRow, SalesInvoiceDocumentRow } from './mzFinance'

type PdfSuite = {
  jsPDF: typeof import('jspdf').default
  autoTable: (...args: any[]) => void
}

export type SalesInvoiceOutputModel = {
  invoiceId: string
  legalReference: string
  issueDate: string
  dueDate: string
  status: SalesInvoiceDocumentRow['document_workflow_status']
  currencyCode: string
  subtotal: number
  taxTotal: number
  totalAmount: number
  subtotalMzn: number
  taxTotalMzn: number
  totalAmountMzn: number
  computerPhrase: string
  brand: {
    name: string
    logoUrl: string | null
  }
  seller: {
    legalName: string
    tradeName: string | null
    nuit: string
    address: string[]
  }
  buyer: {
    legalName: string
    nuit: string
    address: string[]
  }
  lines: Array<{
    id: string
    description: string
    qty: number
    unitPrice: number
    taxAmount: number
    lineNetTotal: number
    lineGrossTotal: number
    taxRate: number | null
    unitOfMeasure: string | null
  }>
}

let pdfSuitePromise: Promise<PdfSuite> | null = null

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

function loadPdfSuite() {
  if (!pdfSuitePromise) {
    pdfSuitePromise = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(
      ([jspdf, jspdfAutoTable]) => ({
        jsPDF: jspdf.default,
        autoTable: (jspdfAutoTable as any).default ?? jspdfAutoTable,
      }),
    )
  }

  return pdfSuitePromise
}

function fmtCurrency(amount: number, currencyCode: string) {
  return new Intl.NumberFormat('pt-MZ', {
    style: 'currency',
    currency: currencyCode || 'MZN',
  }).format(amount || 0)
}

function fmtNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('pt-MZ', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0)
}

function textOrDash(value: string | null | undefined) {
  const text = String(value || '').trim()
  return text || '-'
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function multilineHtml(lines: string[]) {
  const filtered = lines.map((line) => String(line || '').trim()).filter(Boolean)
  return filtered.length ? filtered.map(escapeHtml).join('<br/>') : '&mdash;'
}

function buildAddressLines(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
}

function statusLabel(status: SalesInvoiceOutputModel['status']) {
  switch (status) {
    case 'issued':
      return 'Emitida'
    case 'voided':
      return 'Anulada'
    default:
      return 'Rascunho'
  }
}

function pdfFileName(reference: string) {
  return `${reference}.pdf`
}

function softWrapPdfText(value: string | null | undefined) {
  const text = String(value || '').trim()
  if (!text) return '-'

  return text
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token) || token.length <= 22) return token
      const withBreakableSeparators = token.replace(/([/_.:-])/g, '$1 ')
      if (withBreakableSeparators.length <= 24) return withBreakableSeparators
      return withBreakableSeparators.replace(/(.{20})/g, '$1 ')
    })
    .join('')
}

async function fetchDataUrl(src?: string | null): Promise<string | null> {
  if (!src || !src.trim()) return null
  try {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 5000)
    const response = await fetch(src, {
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    window.clearTimeout(timeoutId)
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

export function buildSalesInvoiceOutputModel(
  invoice: SalesInvoiceDocumentRow,
  lines: SalesInvoiceDocumentLineRow[],
  options?: { brandName?: string | null; logoUrl?: string | null },
): SalesInvoiceOutputModel {
  return {
    invoiceId: invoice.id,
    legalReference: invoice.internal_reference,
    issueDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    status: invoice.document_workflow_status,
    currencyCode: invoice.currency_code || 'MZN',
    subtotal: Number(invoice.subtotal || 0),
    taxTotal: Number(invoice.tax_total || 0),
    totalAmount: Number(invoice.total_amount || 0),
    subtotalMzn: Number(invoice.subtotal_mzn || 0),
    taxTotalMzn: Number(invoice.tax_total_mzn || 0),
    totalAmountMzn: Number(invoice.total_amount_mzn || 0),
    computerPhrase: textOrDash(invoice.computer_processed_phrase_snapshot),
    brand: {
      name: textOrDash(options?.brandName || invoice.seller_trade_name_snapshot || invoice.seller_legal_name_snapshot),
      logoUrl: options?.logoUrl?.trim() || null,
    },
    seller: {
      legalName: textOrDash(invoice.seller_legal_name_snapshot),
      tradeName: invoice.seller_trade_name_snapshot?.trim() || null,
      nuit: textOrDash(invoice.seller_nuit_snapshot),
      address: buildAddressLines([
        invoice.seller_address_line1_snapshot,
        invoice.seller_address_line2_snapshot,
        [invoice.seller_city_snapshot, invoice.seller_state_snapshot].filter(Boolean).join(', '),
        invoice.seller_postal_code_snapshot,
        invoice.seller_country_code_snapshot,
      ]),
    },
    buyer: {
      legalName: textOrDash(invoice.buyer_legal_name_snapshot),
      nuit: textOrDash(invoice.buyer_nuit_snapshot),
      address: buildAddressLines([
        invoice.buyer_address_line1_snapshot,
        invoice.buyer_address_line2_snapshot,
        [invoice.buyer_city_snapshot, invoice.buyer_state_snapshot].filter(Boolean).join(', '),
        invoice.buyer_postal_code_snapshot,
        invoice.buyer_country_code_snapshot,
      ]),
    },
    lines: lines.map((line) => ({
      id: line.id,
      description: textOrDash(line.display_description || line.description),
      qty: Number(line.qty || 0),
      unitPrice: Number(line.unit_price || 0),
      taxAmount: Number(line.tax_amount || 0),
      lineNetTotal: Number(line.line_total || 0),
      lineGrossTotal: Number(line.line_total || 0) + Number(line.tax_amount || 0),
      taxRate: line.tax_rate == null ? null : Number(line.tax_rate),
      unitOfMeasure: line.display_unit_of_measure?.trim() || line.unit_of_measure_snapshot?.trim() || null,
    })),
  }
}

function buildSalesInvoiceCss() {
  return `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #0f172a;
      font: 11px/1.45 "Aptos", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .document {
      width: 100%;
      max-width: 100%;
    }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 260px;
      gap: 16px;
      margin-bottom: 16px;
      padding: 16px 18px;
      border: 1px solid #d7dee8;
      border-radius: 18px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    }
    .hero-brand {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      min-width: 0;
    }
    .brand-mark {
      width: 68px;
      height: 68px;
      border-radius: 18px;
      border: 1px solid #d7dee8;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex: 0 0 auto;
    }
    .brand-logo {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .brand-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      font-size: 22px;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: #1d4ed8;
      background: linear-gradient(180deg, #e8f1ff 0%, #ffffff 100%);
    }
    .brand-copy {
      min-width: 0;
      display: grid;
      gap: 4px;
    }
    .brand-name {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #475569;
    }
    .doc-type {
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #1d4ed8;
    }
    .reference {
      margin: 0;
      font-size: 28px;
      line-height: 1.05;
      letter-spacing: -0.03em;
      overflow-wrap: anywhere;
    }
    .hero-meta {
      border: 1px solid #d7dee8;
      border-radius: 16px;
      background: #ffffff;
      padding: 14px 16px;
      display: grid;
      gap: 10px;
      align-content: start;
    }
    .status-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      padding: 5px 10px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #0c4a6e;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 10px;
      font-weight: 800;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 12px;
    }
    .meta-label {
      color: #64748b;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .meta-value {
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .party-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }
    .party-card,
    .table-card,
    .totals-card,
    .note-card {
      border: 1px solid #d7dee8;
      border-radius: 16px;
      background: #ffffff;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .card-heading {
      padding: 11px 14px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 10px;
      font-weight: 800;
    }
    .party-body {
      padding: 14px;
      display: grid;
      gap: 4px;
      min-height: 116px;
      align-content: start;
    }
    .party-name {
      font-size: 13px;
      font-weight: 800;
      color: #0f172a;
    }
    .party-muted {
      color: #475569;
    }
    .table-card {
      margin-bottom: 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    thead {
      display: table-header-group;
    }
    thead th {
      padding: 10px 12px;
      background: #eff6ff;
      border-bottom: 1px solid #d7dee8;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 10px;
      font-weight: 800;
      text-align: left;
    }
    tbody td {
      padding: 10px 12px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    tbody tr {
      page-break-inside: avoid;
    }
    .col-description { width: 42%; }
    .col-qty { width: 10%; }
    .col-unit { width: 10%; }
    .col-unit-price { width: 14%; }
    .col-tax { width: 10%; }
    .col-total { width: 14%; }
    .right { text-align: right; }
    .line-description {
      font-weight: 700;
      color: #0f172a;
    }
    .line-tax-rate {
      margin-top: 3px;
      font-size: 10px;
      color: #64748b;
    }
    .summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 14px;
      align-items: start;
    }
    .note-card {
      padding: 14px;
      background: linear-gradient(180deg, #fbfdff 0%, #f8fafc 100%);
    }
    .note-title {
      margin: 0 0 8px 0;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 800;
      color: #1e3a8a;
    }
    .note-body {
      margin: 0;
      color: #475569;
    }
    .totals-card {
      padding: 14px;
    }
    .totals-section + .totals-section {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
    }
    .totals-heading {
      margin: 0 0 8px 0;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 800;
      color: #64748b;
    }
    .totals-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      margin: 5px 0;
    }
    .totals-row.grand {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #d7dee8;
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
    }
    .footer {
      margin-top: 16px;
      padding-top: 10px;
      border-top: 1px solid #d7dee8;
      page-break-inside: avoid;
    }
    .footer-phrase {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #0f172a;
    }
  `
}

function buildSalesInvoiceHtml(model: SalesInvoiceOutputModel) {
  const brandInitials = (model.brand.name || model.seller.tradeName || model.seller.legalName || 'SW')
    .split(/\\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'SW'

  const rows = model.lines
    .map((line) => {
      const taxRate = line.taxRate == null ? '' : `<div class="line-tax-rate">IVA ${escapeHtml(fmtNumber(line.taxRate, 2))}%</div>`

      return `<tr>
        <td class="col-description">
          <div class="line-description">${escapeHtml(line.description)}</div>
          ${taxRate}
        </td>
        <td class="right col-qty">${escapeHtml(fmtNumber(line.qty, 2))}</td>
        <td class="right col-unit">${escapeHtml(textOrDash(line.unitOfMeasure))}</td>
        <td class="right col-unit-price">${escapeHtml(fmtCurrency(line.unitPrice, model.currencyCode))}</td>
        <td class="right col-tax">${escapeHtml(fmtCurrency(line.taxAmount, model.currencyCode))}</td>
        <td class="right col-total">${escapeHtml(fmtCurrency(line.lineGrossTotal, model.currencyCode))}</td>
      </tr>`
    })
    .join('')

  return `<div class="document">
    <header class="hero">
      <div class="hero-brand">
        <div class="brand-mark">
          ${model.brand.logoUrl
            ? `<img src="${escapeHtml(model.brand.logoUrl)}" alt="${escapeHtml(model.brand.name)}" class="brand-logo"/>`
            : `<div class="brand-fallback">${escapeHtml(brandInitials)}</div>`}
        </div>
        <div class="brand-copy">
          <div class="brand-name">${escapeHtml(model.brand.name)}</div>
          <div class="doc-type">Fatura</div>
          <h1 class="reference">${escapeHtml(model.legalReference)}</h1>
        </div>
      </div>

      <div class="hero-meta">
        <div class="status-chip">${escapeHtml(statusLabel(model.status))}</div>
        <div class="meta-grid">
          <div>
            <div class="meta-label">Data da fatura</div>
            <div class="meta-value">${escapeHtml(model.issueDate)}</div>
          </div>
          <div>
            <div class="meta-label">Vencimento</div>
            <div class="meta-value">${escapeHtml(model.dueDate)}</div>
          </div>
          <div>
            <div class="meta-label">Moeda</div>
            <div class="meta-value">${escapeHtml(model.currencyCode)}</div>
          </div>
          <div>
            <div class="meta-label">Estado</div>
            <div class="meta-value">${escapeHtml(statusLabel(model.status))}</div>
          </div>
        </div>
      </div>
    </header>

    <div class="party-grid">
      <section class="party-card">
        <div class="card-heading">Emitente</div>
        <div class="party-body">
          <div class="party-name">${escapeHtml(model.seller.tradeName || model.seller.legalName)}</div>
          ${model.seller.tradeName ? `<div class="party-muted">${escapeHtml(model.seller.legalName)}</div>` : ''}
          <div class="party-muted">NUIT: ${escapeHtml(model.seller.nuit)}</div>
          <div class="party-muted">${multilineHtml(model.seller.address)}</div>
        </div>
      </section>

      <section class="party-card">
        <div class="card-heading">Cliente</div>
        <div class="party-body">
          <div class="party-name">${escapeHtml(model.buyer.legalName)}</div>
          <div class="party-muted">NUIT: ${escapeHtml(model.buyer.nuit)}</div>
          <div class="party-muted">${multilineHtml(model.buyer.address)}</div>
        </div>
      </section>
    </div>

    <section class="table-card">
      <table>
        <thead>
          <tr>
            <th class="col-description">Descrição</th>
            <th class="right col-qty">Qtd.</th>
            <th class="right col-unit">Un.</th>
            <th class="right col-unit-price">Preço unit.</th>
            <th class="right col-tax">IVA</th>
            <th class="right col-total">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <div class="summary">
      <section class="note-card">
        <p class="note-title">Resumo fiscal</p>
        <p class="note-body">Os dados comerciais e fiscais deste documento ficam congelados na emissão. Os totais em MZN representam a base legal utilizada para arquivo e conformidade.</p>
      </section>

      <section class="totals-card">
        <div class="totals-section">
          <p class="totals-heading">${escapeHtml(model.currencyCode)}</p>
          <div class="totals-row"><div>Subtotal</div><div>${escapeHtml(fmtCurrency(model.subtotal, model.currencyCode))}</div></div>
          <div class="totals-row"><div>IVA</div><div>${escapeHtml(fmtCurrency(model.taxTotal, model.currencyCode))}</div></div>
          <div class="totals-row grand"><div>Total</div><div>${escapeHtml(fmtCurrency(model.totalAmount, model.currencyCode))}</div></div>
        </div>

        <div class="totals-section">
          <p class="totals-heading">MZN</p>
          <div class="totals-row"><div>Subtotal fiscal</div><div>${escapeHtml(fmtCurrency(model.subtotalMzn, 'MZN'))}</div></div>
          <div class="totals-row"><div>IVA fiscal</div><div>${escapeHtml(fmtCurrency(model.taxTotalMzn, 'MZN'))}</div></div>
          <div class="totals-row grand"><div>Total fiscal</div><div>${escapeHtml(fmtCurrency(model.totalAmountMzn, 'MZN'))}</div></div>
        </div>
      </section>
    </div>

    <footer class="footer">
      <div class="footer-phrase">${escapeHtml(model.computerPhrase)}</div>
    </footer>
  </div>`
}

function htmlShell(title: string, css: string, html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${html}</body></html>`
}

function measureWrappedHeight(doc: InstanceType<typeof import('jspdf').default>, lines: string[], width: number, baseY: number) {
  let y = baseY
  lines.forEach((line, index) => {
    const wrapped = doc.splitTextToSize(String(line), width)
    y += wrapped.length * 11
    if (index < lines.length - 1) y += 4
  })
  return y
}

function drawPartyCard(
  doc: InstanceType<typeof import('jspdf').default>,
  x: number,
  y: number,
  width: number,
  title: string,
  lines: string[],
  height: number,
) {
  doc.setDrawColor(215, 222, 232)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, width, height, 14, 14, 'FD')
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(x, y, width, 26, 14, 14, 'F')
  doc.rect(x, y + 18, width, 8, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 58, 138)
  doc.setFontSize(10)
  doc.text(title.toUpperCase(), x + 12, y + 17)

  let lineY = y + 42
  lines.forEach((line, index) => {
    const wrapped = doc.splitTextToSize(String(line), width - 24)
    doc.setFont('helvetica', index === 0 ? 'bold' : 'normal')
    doc.setTextColor(index === 0 ? 15 : 71, index === 0 ? 23 : 85, index === 0 ? 42 : 105)
    doc.setFontSize(index === 0 ? 10.5 : 9.5)
    doc.text(wrapped, x + 12, lineY)
    lineY += wrapped.length * 11 + 4
  })
}

async function buildSalesInvoicePdfBlob(model: SalesInvoiceOutputModel) {
  mzRuntimeDebug('salesInvoiceOutput.pdf.start', {
    invoiceId: model.invoiceId,
    legalReference: model.legalReference,
    lineCount: model.lines.length,
  })

  const { jsPDF, autoTable } = await loadPdfSuite()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const marginLeft = 42
  const marginRight = 42
  const contentWidth = pageWidth - marginLeft - marginRight
  const logoDataUrl = await fetchDataUrl(model.brand.logoUrl)
  let cursorY = 42

  doc.setFillColor(248, 251, 255)
  doc.setDrawColor(215, 222, 232)
  doc.roundedRect(marginLeft, cursorY, contentWidth, 96, 16, 16, 'FD')

  if (logoDataUrl) {
    try {
      const format = logoDataUrl.startsWith('data:image/jpeg') || logoDataUrl.startsWith('data:image/jpg')
        ? 'JPEG'
        : 'PNG'
      doc.addImage(logoDataUrl, format, marginLeft + 16, cursorY + 14, 56, 56, undefined, 'FAST')
    } catch {
      // Ignore logo rendering failures and keep generation resilient.
    }
  } else {
    const initials = (model.brand.name || model.seller.tradeName || model.seller.legalName || 'SW')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'SW'
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(marginLeft + 16, cursorY + 14, 56, 56, 14, 14, 'F')
    doc.setDrawColor(215, 222, 232)
    doc.roundedRect(marginLeft + 16, cursorY + 14, 56, 56, 14, 14, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(29, 78, 216)
    doc.setFontSize(20)
    doc.text(initials, marginLeft + 44, cursorY + 49, { align: 'center' })
  }

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(10)
  doc.text(model.brand.name, marginLeft + 88, cursorY + 20)

  doc.setTextColor(29, 78, 216)
  doc.setFontSize(12)
  doc.text('FATURA', marginLeft + 88, cursorY + 38)

  doc.setTextColor(15, 23, 42)
  doc.setFontSize(25)
  doc.text(model.legalReference, marginLeft + 88, cursorY + 64)

  const metaX = pageWidth - marginRight - 210
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(metaX, cursorY + 14, 194, 68, 14, 14, 'F')
  doc.setDrawColor(215, 222, 232)
  doc.roundedRect(metaX, cursorY + 14, 194, 68, 14, 14, 'S')

  doc.setFillColor(224, 242, 254)
  doc.roundedRect(metaX + 12, cursorY + 22, 72, 18, 9, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(12, 74, 110)
  doc.setFontSize(9.5)
  doc.text(statusLabel(model.status).toUpperCase(), metaX + 48, cursorY + 34, { align: 'center' })

  const drawMetaPair = (label: string, value: string, x: number, y: number) => {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(8.5)
    doc.text(label.toUpperCase(), x, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(10)
    doc.text(value, x, y + 13)
  }

  drawMetaPair('Data da fatura', model.issueDate, metaX + 12, cursorY + 54)
  drawMetaPair('Vencimento', model.dueDate, metaX + 106, cursorY + 54)
  drawMetaPair('Moeda', model.currencyCode, metaX + 12, cursorY + 74)

  cursorY += 114

  const partyWidth = (contentWidth - 14) / 2
  const sellerLines = [
    model.seller.tradeName || model.seller.legalName,
    ...(model.seller.tradeName ? [model.seller.legalName] : []),
    `NUIT: ${model.seller.nuit}`,
    ...model.seller.address,
  ]
  const buyerLines = [
    model.buyer.legalName,
    `NUIT: ${model.buyer.nuit}`,
    ...model.buyer.address,
  ]
  const bodyTop = cursorY + 42
  const sellerHeight = measureWrappedHeight(doc, sellerLines, partyWidth - 24, bodyTop)
  const buyerHeight = measureWrappedHeight(doc, buyerLines, partyWidth - 24, bodyTop)
  const partyHeight = Math.max(116, Math.max(sellerHeight, buyerHeight) - cursorY + 14)

  drawPartyCard(doc, marginLeft, cursorY, partyWidth, 'Emitente', sellerLines, partyHeight)
  drawPartyCard(doc, marginLeft + partyWidth + 14, cursorY, partyWidth, 'Cliente', buyerLines, partyHeight)

  cursorY += partyHeight + 16

  const descriptionWidth = Math.round(contentWidth * 0.42)
  const qtyWidth = Math.round(contentWidth * 0.10)
  const unitWidth = Math.round(contentWidth * 0.10)
  const unitPriceWidth = Math.round(contentWidth * 0.14)
  const taxWidth = Math.round(contentWidth * 0.10)
  const totalWidth = contentWidth - descriptionWidth - qtyWidth - unitWidth - unitPriceWidth - taxWidth

  autoTable(doc as any, {
    startY: cursorY,
    margin: { left: marginLeft, right: marginRight },
    tableWidth: contentWidth,
    head: [['Descrição', 'Qtd.', 'Un.', 'Preço unit.', 'IVA', 'Total']],
    body: model.lines.map((line) => [
      line.taxRate == null
        ? softWrapPdfText(line.description)
        : `${softWrapPdfText(line.description)}\nIVA ${fmtNumber(line.taxRate, 2)}%`,
      fmtNumber(line.qty, 2),
      softWrapPdfText(textOrDash(line.unitOfMeasure)),
      fmtCurrency(line.unitPrice, model.currencyCode),
      fmtCurrency(line.taxAmount, model.currencyCode),
      fmtCurrency(line.lineGrossTotal, model.currencyCode),
    ]),
    theme: 'grid',
    styles: {
      fontSize: 8.6,
      cellPadding: { top: 6, right: 5, bottom: 6, left: 5 },
      lineColor: [226, 232, 240],
      lineWidth: 0.7,
      textColor: [15, 23, 42],
      overflow: 'linebreak',
      valign: 'top',
      cellWidth: 'wrap',
    },
    headStyles: {
      fillColor: [239, 246, 255],
      textColor: [30, 58, 138],
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: descriptionWidth, halign: 'left' },
      1: { cellWidth: qtyWidth, halign: 'right' },
      2: { cellWidth: unitWidth, halign: 'right' },
      3: { cellWidth: unitPriceWidth, halign: 'right' },
      4: { cellWidth: taxWidth, halign: 'right' },
      5: { cellWidth: totalWidth, halign: 'right' },
    },
  })

  cursorY = (((doc as any).lastAutoTable?.finalY as number | undefined) ?? cursorY) + 16

  const summaryGap = 14
  const totalsWidth = 226
  const noteWidth = contentWidth - totalsWidth - summaryGap
  if (cursorY + 206 > pageHeight) {
    doc.addPage()
    cursorY = 42
  }

  doc.setDrawColor(215, 222, 232)
  doc.setFillColor(251, 253, 255)
  doc.roundedRect(marginLeft, cursorY, noteWidth, 92, 14, 14, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 58, 138)
  doc.setFontSize(9)
  doc.text('RESUMO FISCAL', marginLeft + 12, cursorY + 18)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(71, 85, 105)
  doc.setFontSize(9.3)
  doc.text(
    doc.splitTextToSize(
      'Os dados comerciais e fiscais deste documento ficam congelados na emissão. Os totais em MZN representam a base legal usada para arquivo e conformidade.',
      noteWidth - 24,
    ),
    marginLeft + 12,
    cursorY + 36,
  )

  const totalsX = marginLeft + noteWidth + summaryGap
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(totalsX, cursorY, totalsWidth, 152, 14, 14, 'FD')

  const drawTotalRow = (label: string, value: string, y: number, grand = false) => {
    doc.setFont('helvetica', grand ? 'bold' : 'normal')
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(grand ? 11.5 : 9.4)
    doc.text(label, totalsX + 12, y)
    doc.text(value, totalsX + totalsWidth - 12, y, { align: 'right' })
  }

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(9)
  doc.text(model.currencyCode.toUpperCase(), totalsX + 12, cursorY + 18)
  drawTotalRow('Subtotal', fmtCurrency(model.subtotal, model.currencyCode), cursorY + 40)
  drawTotalRow('IVA', fmtCurrency(model.taxTotal, model.currencyCode), cursorY + 56)
  doc.line(totalsX + 12, cursorY + 66, totalsX + totalsWidth - 12, cursorY + 66)
  drawTotalRow('Total', fmtCurrency(model.totalAmount, model.currencyCode), cursorY + 84, true)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(9)
  doc.text('MZN', totalsX + 12, cursorY + 108)
  drawTotalRow('Subtotal fiscal', fmtCurrency(model.subtotalMzn, 'MZN'), cursorY + 126)
  drawTotalRow('IVA fiscal', fmtCurrency(model.taxTotalMzn, 'MZN'), cursorY + 142)
  doc.line(totalsX + 12, cursorY + 152, totalsX + totalsWidth - 12, cursorY + 152)
  drawTotalRow('Total fiscal', fmtCurrency(model.totalAmountMzn, 'MZN'), cursorY + 170, true)

  const footerY = Math.max(cursorY + 170, (((doc as any).lastAutoTable?.finalY as number | undefined) ?? cursorY) + 18)
  if (footerY + 26 > pageHeight) {
    doc.addPage()
    doc.setDrawColor(215, 222, 232)
    doc.line(marginLeft, 44, pageWidth - marginRight, 44)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(10)
    doc.text(model.computerPhrase, marginLeft, 60)
  } else {
    doc.setDrawColor(215, 222, 232)
    doc.line(marginLeft, footerY, pageWidth - marginRight, footerY)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(10)
    doc.text(model.computerPhrase, marginLeft, footerY + 16)
  }

  const blob = doc.output('blob') as Blob
  mzRuntimeDebug('salesInvoiceOutput.pdf.success', {
    invoiceId: model.invoiceId,
    legalReference: model.legalReference,
    byteSize: blob.size,
  })
  return blob
}

function htmlShellForModel(model: SalesInvoiceOutputModel) {
  return htmlShell(
    `Fatura ${model.legalReference}`,
    buildSalesInvoiceCss(),
    buildSalesInvoiceHtml(model),
  )
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

async function triggerIframePrint(shell: string) {
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
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Não foi possível preparar o documento para impressão.')), 2500)
      iframe.onload = () => {
        window.clearTimeout(timeout)
        resolve()
      }
    })

    iframe.srcdoc = shell
    await ready

    const frameWindow = iframe.contentWindow
    if (!frameWindow || !iframe.contentDocument) {
      throw new Error('Não foi possível abrir a janela de impressão.')
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

export async function printSalesInvoiceDocument(model: SalesInvoiceOutputModel) {
  mzRuntimeDebug('salesInvoiceOutput.print.start', {
    invoiceId: model.invoiceId,
    legalReference: model.legalReference,
  })

  try {
    await triggerIframePrint(htmlShellForModel(model))
    mzRuntimeDebug('salesInvoiceOutput.print.success', {
      invoiceId: model.invoiceId,
      legalReference: model.legalReference,
      mode: 'iframe',
    })
  } catch (printError) {
    mzRuntimeError('salesInvoiceOutput.print.failed', printError, {
      invoiceId: model.invoiceId,
      legalReference: model.legalReference,
      fallback: 'pdf',
    })

    try {
      const blob = await buildSalesInvoicePdfBlob(model)
      await downloadBlob(blob, pdfFileName(model.legalReference))
      mzRuntimeDebug('salesInvoiceOutput.print.fallbackPdf', {
        invoiceId: model.invoiceId,
        legalReference: model.legalReference,
      })
    } catch (pdfError) {
      mzRuntimeError('salesInvoiceOutput.print.fallbackPdf.failed', pdfError, {
        invoiceId: model.invoiceId,
        legalReference: model.legalReference,
      })
      throw new Error('Não foi possível iniciar a impressão nem gerar o PDF de contingência.')
    }
  }
}

export async function downloadSalesInvoicePdf(model: SalesInvoiceOutputModel) {
  try {
    const blob = await buildSalesInvoicePdfBlob(model)
    await downloadBlob(blob, pdfFileName(model.legalReference))
    mzRuntimeDebug('salesInvoiceOutput.download.success', {
      invoiceId: model.invoiceId,
      legalReference: model.legalReference,
    })
  } catch (error) {
    mzRuntimeError('salesInvoiceOutput.download.failed', error, {
      invoiceId: model.invoiceId,
      legalReference: model.legalReference,
    })
    throw error
  }
}

export async function shareSalesInvoiceDocument(model: SalesInvoiceOutputModel) {
  try {
    mzRuntimeDebug('salesInvoiceOutput.share.start', {
      invoiceId: model.invoiceId,
      legalReference: model.legalReference,
    })

    const navigatorWithShare = navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>
      canShare?: (data: ShareData) => boolean
    }
    const summaryText =
      `Fatura ${model.legalReference}\n` +
      `Data: ${model.issueDate}\n` +
      `Total fiscal (MZN): ${fmtCurrency(model.totalAmountMzn, 'MZN')}`

    if (navigatorWithShare.share) {
      const blob = await buildSalesInvoicePdfBlob(model)
      const file = new File([blob], pdfFileName(model.legalReference), { type: 'application/pdf' })

      if (navigatorWithShare.canShare?.({ files: [file] })) {
        await navigatorWithShare.share({
          title: `Fatura ${model.legalReference}`,
          text: summaryText,
          files: [file],
        })
        mzRuntimeDebug('salesInvoiceOutput.share.success', {
          invoiceId: model.invoiceId,
          legalReference: model.legalReference,
          mode: 'file',
        })
        return
      }

      await navigatorWithShare.share({
        title: `Fatura ${model.legalReference}`,
        text: summaryText,
      })
      mzRuntimeDebug('salesInvoiceOutput.share.success', {
        invoiceId: model.invoiceId,
        legalReference: model.legalReference,
        mode: 'text',
      })
      return
    }

    throw new Error('A partilha não está disponível neste dispositivo.')
  } catch (error) {
    mzRuntimeError('salesInvoiceOutput.share.failed', error, {
      invoiceId: model.invoiceId,
      legalReference: model.legalReference,
    })
    throw error
  }
}
