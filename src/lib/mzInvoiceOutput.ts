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
      if (/^\s+$/.test(token) || token.length <= 28) return token
      const withBreakableSeparators = token.replace(/([/_.:-])/g, '$1 ')
      if (withBreakableSeparators.length <= 30) return withBreakableSeparators
      return withBreakableSeparators.replace(/(.{26})/g, '$1 ')
    })
    .join('')
}

function stablePdfValue(value: string | null | undefined) {
  const text = String(value || '').trim()
  return text ? text.replace(/\s+/g, '\u00A0') : '-'
}

function fitPdfTextSize(
  doc: InstanceType<typeof import('jspdf').default>,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
) {
  let size = startSize
  doc.setFontSize(size)
  while (size > minSize && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5
    doc.setFontSize(size)
  }
  return size
}

function drawPdfBrandFallback(
  doc: InstanceType<typeof import('jspdf').default>,
  x: number,
  y: number,
  size: number,
  initials: string,
) {
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, size, size, 16, 16, 'F')
  doc.setDrawColor(219, 228, 239)
  doc.roundedRect(x, y, size, size, 16, 16, 'S')
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(29, 78, 216)
  doc.setFontSize(21)
  doc.text(initials, x + size / 2, y + size / 2 + 8, { align: 'center' })
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
      grid-template-columns: 86px minmax(0, 1fr) 272px;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 18px;
      padding: 18px 20px;
      border: 1px solid #dbe4ef;
      border-radius: 20px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    }
    .hero-logo {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .brand-mark {
      width: 72px;
      height: 72px;
      border-radius: 20px;
      border: 1px solid #dbe4ef;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
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
      font-size: 23px;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: #1d4ed8;
      background: linear-gradient(180deg, #e8f1ff 0%, #ffffff 100%);
    }
    .hero-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 4px;
      padding: 4px 0;
    }
    .brand-name {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
    }
    .doc-type {
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #1d4ed8;
    }
    .reference {
      margin: 0;
      font-size: 30px;
      line-height: 1.04;
      letter-spacing: -0.04em;
      overflow-wrap: anywhere;
    }
    .hero-meta {
      border: 1px solid #dbe4ef;
      border-radius: 18px;
      background: #ffffff;
      padding: 16px 18px 17px;
      display: grid;
      gap: 14px;
      align-content: center;
      min-width: 0;
    }
    .status-row {
      display: flex;
      align-items: center;
    }
    .status-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      padding: 6px 12px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #0c4a6e;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 9.5px;
      font-weight: 800;
    }
    .meta-grid {
      display: grid;
      gap: 8px;
    }
    .meta-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: end;
      padding-bottom: 7px;
      border-bottom: 1px solid #eef3f8;
    }
    .meta-row:last-child {
      padding-bottom: 0;
      border-bottom: none;
    }
    .meta-label {
      color: #64748b;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }
    .meta-value {
      font-size: 12.5px;
      font-weight: 700;
      white-space: nowrap;
      text-align: right;
      line-height: 1.2;
    }
    .party-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 18px;
    }
    .party-card,
    .table-card,
    .totals-card,
    .note-card {
      border: 1px solid #dbe4ef;
      border-radius: 18px;
      background: #ffffff;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .card-heading {
      padding: 12px 16px;
      border-bottom: 1px solid #e7edf4;
      background: #f8fbff;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 9.7px;
      font-weight: 800;
    }
    .party-body {
      padding: 16px 18px 17px;
      display: grid;
      gap: 6px;
      min-height: 128px;
      align-content: start;
      line-height: 1.55;
    }
    .party-name {
      font-size: 13.5px;
      font-weight: 800;
      color: #0f172a;
    }
    .party-muted {
      color: #475569;
      line-height: 1.55;
    }
    .party-address {
      color: #475569;
      line-height: 1.6;
    }
    .table-card {
      margin-bottom: 18px;
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
      padding: 12px 14px;
      background: #eff6ff;
      border-bottom: 1px solid #dbe4ef;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      font-size: 9.5px;
      font-weight: 800;
      text-align: left;
      line-height: 1.2;
    }
    tbody td {
      padding: 14px;
      border-bottom: 1px solid #e7edf4;
      vertical-align: top;
      line-height: 1.5;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    tbody tr {
      page-break-inside: avoid;
    }
    .col-description {
      width: 45%;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .col-qty { width: 7%; }
    .col-unit { width: 8%; }
    .col-unit-price { width: 14%; }
    .col-tax { width: 12%; }
    .col-total { width: 14%; }
    .right { text-align: right; }
    .table-value {
      display: inline-block;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .line-description {
      font-weight: 700;
      font-size: 11.1px;
      line-height: 1.52;
      color: #0f172a;
    }
    .line-tax-rate {
      margin-top: 4px;
      font-size: 9.2px;
      color: #64748b;
      line-height: 1.4;
    }
    .summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 326px;
      gap: 16px;
      align-items: start;
    }
    .note-card {
      padding: 16px 18px 18px;
      background: linear-gradient(180deg, #fbfdff 0%, #f8fafc 100%);
    }
    .note-title {
      margin: 0 0 10px 0;
      font-size: 9.7px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 800;
      color: #1e3a8a;
    }
    .note-body {
      margin: 0;
      color: #475569;
      line-height: 1.6;
    }
    .totals-card {
      padding: 16px 18px 18px;
      display: grid;
      gap: 16px;
    }
    .totals-section + .totals-section {
      padding-top: 16px;
      border-top: 1px solid #e7edf4;
    }
    .totals-heading {
      margin: 0 0 10px 0;
      font-size: 9.4px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 800;
      color: #64748b;
    }
    .totals-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      margin: 0;
      padding: 5px 0;
      line-height: 1.45;
      font-variant-numeric: tabular-nums;
    }
    .totals-row.grand {
      margin-top: 4px;
      padding-top: 12px;
      padding-bottom: 8px;
      border-top: 1px solid #dbe4ef;
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
    }
    .footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      page-break-inside: avoid;
    }
    .footer-phrase {
      font-size: 8.8px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
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
        <td class="right col-qty"><span class="table-value">${escapeHtml(fmtNumber(line.qty, 2))}</span></td>
        <td class="right col-unit"><span class="table-value">${escapeHtml(textOrDash(line.unitOfMeasure))}</span></td>
        <td class="right col-unit-price"><span class="table-value">${escapeHtml(fmtCurrency(line.unitPrice, model.currencyCode))}</span></td>
        <td class="right col-tax"><span class="table-value">${escapeHtml(fmtCurrency(line.taxAmount, model.currencyCode))}</span></td>
        <td class="right col-total"><span class="table-value">${escapeHtml(fmtCurrency(line.lineGrossTotal, model.currencyCode))}</span></td>
      </tr>`
    })
    .join('')

  return `<div class="document">
    <header class="hero">
      <div class="hero-logo">
        <div class="brand-mark">
          ${model.brand.logoUrl
            ? `<img src="${escapeHtml(model.brand.logoUrl)}" alt="${escapeHtml(model.brand.name)}" class="brand-logo"/>`
            : `<div class="brand-fallback">${escapeHtml(brandInitials)}</div>`}
        </div>
      </div>

      <div class="hero-copy">
        <div class="brand-name">${escapeHtml(model.brand.name)}</div>
        <div class="doc-type">Fatura</div>
        <h1 class="reference">${escapeHtml(model.legalReference)}</h1>
      </div>

      <div class="hero-meta">
        <div class="status-row">
          <div class="status-chip">${escapeHtml(statusLabel(model.status))}</div>
        </div>
        <div class="meta-grid">
          <div class="meta-row">
            <div class="meta-label">Data da fatura</div>
            <div class="meta-value">${escapeHtml(model.issueDate)}</div>
          </div>
          <div class="meta-row">
            <div class="meta-label">Vencimento</div>
            <div class="meta-value">${escapeHtml(model.dueDate)}</div>
          </div>
          <div class="meta-row">
            <div class="meta-label">Moeda</div>
            <div class="meta-value">${escapeHtml(model.currencyCode)}</div>
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
          <div class="party-address">${multilineHtml(model.seller.address)}</div>
        </div>
      </section>

      <section class="party-card">
        <div class="card-heading">Cliente</div>
        <div class="party-body">
          <div class="party-name">${escapeHtml(model.buyer.legalName)}</div>
          <div class="party-muted">NUIT: ${escapeHtml(model.buyer.nuit)}</div>
          <div class="party-address">${multilineHtml(model.buyer.address)}</div>
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
          <div class="totals-row"><div>Subtotal</div><div><span class="table-value">${escapeHtml(fmtCurrency(model.subtotal, model.currencyCode))}</span></div></div>
          <div class="totals-row"><div>IVA</div><div><span class="table-value">${escapeHtml(fmtCurrency(model.taxTotal, model.currencyCode))}</span></div></div>
          <div class="totals-row grand"><div>Total</div><div><span class="table-value">${escapeHtml(fmtCurrency(model.totalAmount, model.currencyCode))}</span></div></div>
        </div>

        <div class="totals-section">
          <p class="totals-heading">MZN</p>
          <div class="totals-row"><div>Subtotal fiscal</div><div><span class="table-value">${escapeHtml(fmtCurrency(model.subtotalMzn, 'MZN'))}</span></div></div>
          <div class="totals-row"><div>IVA fiscal</div><div><span class="table-value">${escapeHtml(fmtCurrency(model.taxTotalMzn, 'MZN'))}</span></div></div>
          <div class="totals-row grand"><div>Total fiscal</div><div><span class="table-value">${escapeHtml(fmtCurrency(model.totalAmountMzn, 'MZN'))}</span></div></div>
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
    y += wrapped.length * 12
    if (index < lines.length - 1) y += 5
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
  doc.setDrawColor(219, 228, 239)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, width, height, 16, 16, 'FD')
  doc.setFillColor(248, 251, 255)
  doc.roundedRect(x, y, width, 28, 16, 16, 'F')
  doc.rect(x, y + 18, width, 10, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 58, 138)
  doc.setFontSize(9.5)
  doc.text(title.toUpperCase(), x + 14, y + 18)

  let lineY = y + 46
  lines.forEach((line, index) => {
    const wrapped = doc.splitTextToSize(String(line), width - 28)
    doc.setFont('helvetica', index === 0 ? 'bold' : 'normal')
    doc.setTextColor(index === 0 ? 15 : 71, index === 0 ? 23 : 85, index === 0 ? 42 : 105)
    doc.setFontSize(index === 0 ? 10.8 : 9.5)
    doc.text(wrapped, x + 14, lineY)
    lineY += wrapped.length * 12 + 5
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
  const brandInitials = (model.brand.name || model.seller.tradeName || model.seller.legalName || 'SW')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'SW'
  let cursorY = 42
  const headerHeight = 108
  const metaWidth = 218
  const metaHeight = 80
  const metaX = pageWidth - marginRight - metaWidth

  doc.setFillColor(248, 251, 255)
  doc.setDrawColor(219, 228, 239)
  doc.roundedRect(marginLeft, cursorY, contentWidth, headerHeight, 18, 18, 'FD')

  if (logoDataUrl) {
    try {
      const format = logoDataUrl.startsWith('data:image/jpeg') || logoDataUrl.startsWith('data:image/jpg')
        ? 'JPEG'
        : 'PNG'
      doc.addImage(logoDataUrl, format, marginLeft + 18, cursorY + 18, 62, 62, undefined, 'FAST')
    } catch {
      drawPdfBrandFallback(doc, marginLeft + 18, cursorY + 18, 62, brandInitials)
    }
  } else {
    drawPdfBrandFallback(doc, marginLeft + 18, cursorY + 18, 62, brandInitials)
  }

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(9.5)
  doc.text(model.brand.name, marginLeft + 98, cursorY + 25)

  doc.setTextColor(29, 78, 216)
  doc.setFontSize(13)
  doc.text('FATURA', marginLeft + 98, cursorY + 46)

  doc.setTextColor(15, 23, 42)
  fitPdfTextSize(doc, model.legalReference, metaX - (marginLeft + 98) - 18, 30, 18)
  doc.text(model.legalReference, marginLeft + 98, cursorY + 76)

  doc.setFillColor(255, 255, 255)
  doc.roundedRect(metaX, cursorY + 14, metaWidth, metaHeight, 16, 16, 'F')
  doc.setDrawColor(219, 228, 239)
  doc.roundedRect(metaX, cursorY + 14, metaWidth, metaHeight, 16, 16, 'S')

  doc.setFillColor(224, 242, 254)
  doc.roundedRect(metaX + 16, cursorY + 22, 82, 20, 10, 10, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(12, 74, 110)
  doc.setFontSize(9.2)
  doc.text(statusLabel(model.status).toUpperCase(), metaX + 57, cursorY + 36, { align: 'center' })

  const drawMetaRow = (label: string, value: string, y: number, isLast = false) => {
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(8.3)
    doc.text(label.toUpperCase(), metaX + 16, y)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(10.3)
    doc.text(stablePdfValue(value), metaX + metaWidth - 16, y, { align: 'right' })
    if (!isLast) {
      doc.setDrawColor(238, 243, 248)
      doc.line(metaX + 16, y + 7, metaX + metaWidth - 16, y + 7)
    }
  }

  drawMetaRow('Data da fatura', model.issueDate, cursorY + 56)
  drawMetaRow('Vencimento', model.dueDate, cursorY + 74)
  drawMetaRow('Moeda', model.currencyCode, cursorY + 92, true)

  cursorY += headerHeight + 18

  const partyGap = 16
  const partyWidth = (contentWidth - partyGap) / 2
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
  const bodyTop = cursorY + 46
  const sellerHeight = measureWrappedHeight(doc, sellerLines, partyWidth - 28, bodyTop)
  const buyerHeight = measureWrappedHeight(doc, buyerLines, partyWidth - 28, bodyTop)
  const partyHeight = Math.max(128, Math.max(sellerHeight, buyerHeight) - cursorY + 17)

  drawPartyCard(doc, marginLeft, cursorY, partyWidth, 'Emitente', sellerLines, partyHeight)
  drawPartyCard(doc, marginLeft + partyWidth + partyGap, cursorY, partyWidth, 'Cliente', buyerLines, partyHeight)

  cursorY += partyHeight + 18

  const descriptionWidth = Math.round(contentWidth * 0.45)
  const qtyWidth = Math.round(contentWidth * 0.07)
  const unitWidth = Math.round(contentWidth * 0.08)
  const unitPriceWidth = Math.round(contentWidth * 0.14)
  const taxWidth = Math.round(contentWidth * 0.12)
  const totalWidth = contentWidth - descriptionWidth - qtyWidth - unitWidth - unitPriceWidth - taxWidth
  const tableRows = model.lines.map((line) => ({
    description: softWrapPdfText(line.description),
    taxLine: line.taxRate == null ? null : `IVA ${fmtNumber(line.taxRate, 2)}%`,
    qty: stablePdfValue(fmtNumber(line.qty, 2)),
    unit: stablePdfValue(textOrDash(line.unitOfMeasure)),
    unitPrice: stablePdfValue(fmtCurrency(line.unitPrice, model.currencyCode)),
    tax: stablePdfValue(fmtCurrency(line.taxAmount, model.currencyCode)),
    total: stablePdfValue(fmtCurrency(line.lineGrossTotal, model.currencyCode)),
  }))

  autoTable(doc as any, {
    startY: cursorY,
    margin: { left: marginLeft, right: marginRight },
    tableWidth: contentWidth,
    columns: [
      { header: 'Descrição', dataKey: 'description' },
      { header: 'Qtd.', dataKey: 'qty' },
      { header: 'Un.', dataKey: 'unit' },
      { header: 'Preço unit.', dataKey: 'unitPrice' },
      { header: 'IVA', dataKey: 'tax' },
      { header: 'Total', dataKey: 'total' },
    ],
    body: tableRows,
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 8, right: 6, bottom: 8, left: 6 },
      minCellHeight: 24,
      lineColor: [231, 237, 244],
      lineWidth: 0.55,
      textColor: [15, 23, 42],
      overflow: 'linebreak',
      valign: 'top',
      cellWidth: 'wrap',
    },
    headStyles: {
      fillColor: [239, 246, 255],
      textColor: [30, 58, 138],
      fontStyle: 'bold',
      fontSize: 8.7,
      halign: 'left',
    },
    columnStyles: {
      description: { cellWidth: descriptionWidth, halign: 'left' },
      qty: { cellWidth: qtyWidth, halign: 'right' },
      unit: { cellWidth: unitWidth, halign: 'right' },
      unitPrice: { cellWidth: unitPriceWidth, halign: 'right' },
      tax: { cellWidth: taxWidth, halign: 'right' },
      total: { cellWidth: totalWidth, halign: 'right' },
    },
    didParseCell: (hookData: any) => {
      if (hookData.section === 'body' && hookData.column.dataKey === 'description') {
        const raw = hookData.row.raw as (typeof tableRows)[number]
        hookData.cell.text = raw.taxLine ? [raw.description, raw.taxLine] : [raw.description]
        hookData.cell.styles.textColor = [255, 255, 255]
      } else if (hookData.section === 'body') {
        hookData.cell.styles.fontSize = 8.1
      }
    },
    didDrawCell: (hookData: any) => {
      if (hookData.section !== 'body' || hookData.column.dataKey !== 'description') return

      const raw = hookData.row.raw as (typeof tableRows)[number]
      const textX = hookData.cell.x + 6
      let textY = hookData.cell.y + 13
      const descriptionLines = doc.splitTextToSize(raw.description, hookData.cell.width - 12)

      doc.setFont('helvetica', 'bold')
      doc.setTextColor(15, 23, 42)
      doc.setFontSize(9.1)
      doc.text(descriptionLines, textX, textY)

      if (raw.taxLine) {
        textY += descriptionLines.length * 10.8 + 2
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(100, 116, 139)
        doc.setFontSize(8)
        doc.text(doc.splitTextToSize(raw.taxLine, hookData.cell.width - 12), textX, textY)
      }
    },
  })

  cursorY = (((doc as any).lastAutoTable?.finalY as number | undefined) ?? cursorY) + 18

  const summaryGap = 16
  const totalsWidth = 232
  const noteWidth = contentWidth - totalsWidth - summaryGap
  const noteHeight = 106
  const totalsHeight = 198
  if (cursorY + totalsHeight + 34 > pageHeight) {
    doc.addPage()
    cursorY = 42
  }

  doc.setDrawColor(219, 228, 239)
  doc.setFillColor(251, 253, 255)
  doc.roundedRect(marginLeft, cursorY, noteWidth, noteHeight, 16, 16, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 58, 138)
  doc.setFontSize(9.5)
  doc.text('RESUMO FISCAL', marginLeft + 16, cursorY + 22)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(71, 85, 105)
  doc.setFontSize(9.3)
  doc.text(
    doc.splitTextToSize(
      'Os dados comerciais e fiscais deste documento ficam congelados na emissão. Os totais em MZN representam a base legal usada para arquivo e conformidade.',
      noteWidth - 32,
    ),
    marginLeft + 16,
    cursorY + 46,
  )

  const totalsX = marginLeft + noteWidth + summaryGap
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(totalsX, cursorY, totalsWidth, totalsHeight, 16, 16, 'FD')

  const drawTotalRow = (label: string, value: string, y: number, grand = false) => {
    doc.setFont('helvetica', grand ? 'bold' : 'normal')
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(grand ? 11.5 : 9.4)
    doc.text(label, totalsX + 16, y)
    doc.text(stablePdfValue(value), totalsX + totalsWidth - 16, y, { align: 'right' })
  }

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(9)
  doc.text(model.currencyCode.toUpperCase(), totalsX + 16, cursorY + 22)
  drawTotalRow('Subtotal', fmtCurrency(model.subtotal, model.currencyCode), cursorY + 50)
  drawTotalRow('IVA', fmtCurrency(model.taxTotal, model.currencyCode), cursorY + 70)
  doc.setDrawColor(219, 228, 239)
  doc.line(totalsX + 16, cursorY + 82, totalsX + totalsWidth - 16, cursorY + 82)
  drawTotalRow('Total', fmtCurrency(model.totalAmount, model.currencyCode), cursorY + 102, true)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.setFontSize(9)
  doc.text('MZN', totalsX + 16, cursorY + 130)
  drawTotalRow('Subtotal fiscal', fmtCurrency(model.subtotalMzn, 'MZN'), cursorY + 158)
  drawTotalRow('IVA fiscal', fmtCurrency(model.taxTotalMzn, 'MZN'), cursorY + 178)
  doc.setDrawColor(219, 228, 239)
  doc.line(totalsX + 16, cursorY + 190, totalsX + totalsWidth - 16, cursorY + 190)
  drawTotalRow('Total fiscal', fmtCurrency(model.totalAmountMzn, 'MZN'), cursorY + 210, true)

  const footerY = Math.max(cursorY + totalsHeight + 14, (((doc as any).lastAutoTable?.finalY as number | undefined) ?? cursorY) + 20)
  if (footerY + 24 > pageHeight) {
    doc.addPage()
    doc.setDrawColor(226, 232, 240)
    doc.line(marginLeft, 44, pageWidth - marginRight, 44)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(8.5)
    doc.text(model.computerPhrase, marginLeft, 58)
  } else {
    doc.setDrawColor(226, 232, 240)
    doc.line(marginLeft, footerY, pageWidth - marginRight, footerY)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(8.5)
    doc.text(model.computerPhrase, marginLeft, footerY + 14)
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
