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
  return filtered.length ? filtered.map(escapeHtml).join('<br/>') : '—'
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
      description: textOrDash(line.description),
      qty: Number(line.qty || 0),
      unitPrice: Number(line.unit_price || 0),
      taxAmount: Number(line.tax_amount || 0),
      lineNetTotal: Number(line.line_total || 0),
      lineGrossTotal: Number(line.line_total || 0) + Number(line.tax_amount || 0),
      taxRate: line.tax_rate == null ? null : Number(line.tax_rate),
      unitOfMeasure: line.unit_of_measure_snapshot?.trim() || null,
    })),
  }
}

function buildSalesInvoiceCss() {
  return `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #0f172a;
      font: 11.5px/1.45 "Aptos", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #ffffff;
    }
    .document {
      max-width: 100%;
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      margin-bottom: 18px;
    }
    .topbar-left {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      min-width: 0;
    }
    .brand-mark {
      width: 72px;
      height: 72px;
      border-radius: 18px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }
    .brand-logo {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      display: block;
    }
    .brand-fallback {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #1e3a8a;
      font-size: 26px;
      font-weight: 800;
      letter-spacing: 0.06em;
      background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
    }
    .eyebrow {
      color: #1d4ed8;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-size: 10px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .headline {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .headline h1 {
      margin: 0;
      font-size: 30px;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }
    .reference {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      border-radius: 999px;
      padding: 4px 10px;
      background: #e0f2fe;
      color: #0c4a6e;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .meta-panel {
      min-width: 280px;
      border: 1px solid #cbd5e1;
      border-radius: 16px;
      padding: 14px 16px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
    }
    .meta-item {
      min-width: 0;
    }
    .meta-label {
      color: #475569;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .meta-value {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .parties {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }
    .party-card,
    .totals-card,
    .lines-card {
      border: 1px solid #cbd5e1;
      border-radius: 16px;
      background: #ffffff;
      overflow: hidden;
    }
    .card-header {
      padding: 12px 14px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }
    .card-title {
      color: #1e3a8a;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 800;
      margin: 0;
    }
    .party-body {
      padding: 14px;
      display: grid;
      gap: 4px;
      color: #334155;
    }
    .party-name {
      font-weight: 800;
      color: #0f172a;
      font-size: 13px;
    }
    .lines-card {
      margin-bottom: 18px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    thead th {
      padding: 10px 12px;
      border-bottom: 1px solid #cbd5e1;
      background: #eff6ff;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 10px;
      text-align: left;
      font-weight: 800;
    }
    tbody td {
      padding: 11px 12px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
      color: #0f172a;
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .col-description { width: 42%; }
    .col-qty { width: 14%; }
    .col-unit-price { width: 16%; }
    .col-tax { width: 13%; }
    .col-total { width: 15%; }
    .right { text-align: right; }
    .line-description {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .line-muted {
      color: #64748b;
      font-size: 10px;
      margin-top: 2px;
    }
    .summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 14px;
      align-items: start;
    }
    .summary-note {
      border: 1px dashed #bfdbfe;
      border-radius: 16px;
      padding: 14px;
      background: #f8fbff;
      color: #334155;
    }
    .summary-note strong {
      display: block;
      margin-bottom: 8px;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 10px;
    }
    .totals-card {
      padding: 14px;
    }
    .totals-group + .totals-group {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
    }
    .totals-heading {
      color: #475569;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 800;
      margin-bottom: 8px;
    }
    .totals-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      margin: 5px 0;
    }
    .totals-row.grand {
      font-weight: 800;
      font-size: 14px;
      color: #0f172a;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #cbd5e1;
    }
    .footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #cbd5e1;
    }
    .footer-phrase {
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #0f172a;
    }
  `
}

function buildSalesInvoiceHtml(model: SalesInvoiceOutputModel) {
  const brandInitials = (model.brand.name || model.seller.tradeName || model.seller.legalName || 'SW')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'SW'
  const rows = model.lines
    .map((line) => {
      const unitDetail = line.unitOfMeasure ? `Un.: ${escapeHtml(line.unitOfMeasure)}` : ''
      const taxDetail = line.taxRate == null ? 'IVA: —' : `IVA: ${fmtNumber(line.taxRate, 2)}%`

      return `<tr>
        <td class="col-description">
          <div class="line-description">${escapeHtml(line.description)}</div>
          <div class="line-muted">${[unitDetail, taxDetail].filter(Boolean).join(' · ')}</div>
        </td>
        <td class="right col-qty">${fmtNumber(line.qty, 2)}</td>
        <td class="right col-unit-price">${fmtCurrency(line.unitPrice, model.currencyCode)}</td>
        <td class="right col-tax">${fmtCurrency(line.taxAmount, model.currencyCode)}</td>
        <td class="right col-total">${fmtCurrency(line.lineGrossTotal, model.currencyCode)}</td>
      </tr>`
    })
    .join('')

  return `<div class="document">
    <div class="topbar">
      <div class="topbar-left">
        <div class="brand-mark">
          ${model.brand.logoUrl
            ? `<img src="${escapeHtml(model.brand.logoUrl)}" alt="${escapeHtml(model.brand.name)}" class="brand-logo"/>`
            : `<div class="brand-fallback">${escapeHtml(brandInitials)}</div>`}
        </div>
        <div class="headline">
          <div class="eyebrow">Documento fiscal de Moçambique</div>
          <h1>Fatura</h1>
          <div class="reference">${escapeHtml(model.legalReference)}</div>
          <div class="status-pill">${escapeHtml(statusLabel(model.status))}</div>
        </div>
      </div>

      <div class="meta-panel">
        <div class="meta-grid">
          <div class="meta-item">
            <div class="meta-label">Referência</div>
            <div class="meta-value">${escapeHtml(model.legalReference)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Moeda</div>
            <div class="meta-value">${escapeHtml(model.currencyCode)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Data da fatura</div>
            <div class="meta-value">${escapeHtml(model.issueDate)}</div>
          </div>
          <div class="meta-item">
            <div class="meta-label">Vencimento</div>
            <div class="meta-value">${escapeHtml(model.dueDate)}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="parties">
      <section class="party-card">
        <div class="card-header"><p class="card-title">Emitente</p></div>
        <div class="party-body">
          <div class="party-name">${escapeHtml(model.seller.tradeName || model.seller.legalName)}</div>
          ${model.seller.tradeName ? `<div>${escapeHtml(model.seller.legalName)}</div>` : ''}
          <div>NUIT: ${escapeHtml(model.seller.nuit)}</div>
          <div>${multilineHtml(model.seller.address)}</div>
        </div>
      </section>

      <section class="party-card">
        <div class="card-header"><p class="card-title">Cliente</p></div>
        <div class="party-body">
          <div class="party-name">${escapeHtml(model.buyer.legalName)}</div>
          <div>NUIT: ${escapeHtml(model.buyer.nuit)}</div>
          <div>${multilineHtml(model.buyer.address)}</div>
        </div>
      </section>
    </div>

    <section class="lines-card">
      <table>
        <thead>
          <tr>
            <th class="col-description">Descrição</th>
            <th class="right col-qty">Qtd.</th>
            <th class="right col-unit-price">Preço unit.</th>
            <th class="right col-tax">IVA</th>
            <th class="right col-total">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>

    <div class="summary">
      <div class="summary-note">
        <strong>Observação fiscal</strong>
        Os valores do documento emitido são apresentados a partir do registo fiscal congelado da fatura, incluindo os montantes fiscais em MZN.
      </div>

      <section class="totals-card">
        <div class="totals-group">
          <div class="totals-heading">${escapeHtml(model.currencyCode)}</div>
          <div class="totals-row"><div>Subtotal</div><div>${fmtCurrency(model.subtotal, model.currencyCode)}</div></div>
          <div class="totals-row"><div>IVA</div><div>${fmtCurrency(model.taxTotal, model.currencyCode)}</div></div>
          <div class="totals-row grand"><div>Total</div><div>${fmtCurrency(model.totalAmount, model.currencyCode)}</div></div>
        </div>

        <div class="totals-group">
          <div class="totals-heading">MZN</div>
          <div class="totals-row"><div>Subtotal fiscal</div><div>${fmtCurrency(model.subtotalMzn, 'MZN')}</div></div>
          <div class="totals-row"><div>IVA fiscal</div><div>${fmtCurrency(model.taxTotalMzn, 'MZN')}</div></div>
          <div class="totals-row grand"><div>Total fiscal</div><div>${fmtCurrency(model.totalAmountMzn, 'MZN')}</div></div>
        </div>
      </section>
    </div>

    <div class="footer">
      <div class="footer-phrase">${escapeHtml(model.computerPhrase)}</div>
    </div>
  </div>`
}

function htmlShell(title: string, css: string, html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${html}</body></html>`
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
  const left = 38
  const right = pageWidth - 38
  const logoDataUrl = await fetchDataUrl(model.brand.logoUrl)
  let cursorY = 42

  doc.setFillColor(239, 246, 255)
  doc.roundedRect(left, cursorY - 8, pageWidth - left * 2, 82, 16, 16, 'F')
  if (logoDataUrl) {
    try {
      const format = logoDataUrl.startsWith('data:image/jpeg') || logoDataUrl.startsWith('data:image/jpg')
        ? 'JPEG'
        : 'PNG'
      doc.addImage(logoDataUrl, format, left + 14, cursorY, 56, 56, undefined, 'FAST')
    } catch {
      // Ignore logo rendering failures and keep document generation going.
    }
  } else {
    const initials = (model.brand.name || model.seller.tradeName || model.seller.legalName || 'SW')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'SW'
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(left + 14, cursorY, 56, 56, 14, 14, 'F')
    doc.setDrawColor(203, 213, 225)
    doc.roundedRect(left + 14, cursorY, 56, 56, 14, 14, 'S')
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 58, 138)
    doc.setFontSize(20)
    doc.text(initials, left + 42, cursorY + 35, { align: 'center' })
  }

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(29, 78, 216)
  doc.setFontSize(10)
  doc.text('DOCUMENTO FISCAL DE MOÇAMBIQUE', left + 84, cursorY + 8)

  doc.setTextColor(15, 23, 42)
  doc.setFontSize(24)
  doc.text('Fatura', left + 84, cursorY + 30)

  doc.setFontSize(16)
  doc.text(model.legalReference, left + 84, cursorY + 52)

  doc.setFontSize(10)
  doc.setTextColor(12, 74, 110)
  doc.text(statusLabel(model.status).toUpperCase(), right - 14, cursorY + 12, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setTextColor(71, 85, 105)
  doc.text(`Data da fatura: ${model.issueDate}`, right - 14, cursorY + 34, { align: 'right' })
  doc.text(`Vencimento: ${model.dueDate}`, right - 14, cursorY + 50, { align: 'right' })
  doc.text(`Moeda: ${model.currencyCode}`, right - 14, cursorY + 66, { align: 'right' })

  cursorY += 102

  const cardWidth = (pageWidth - left * 2 - 14) / 2
  const drawPartyCard = (x: number, title: string, lines: string[]) => {
    const cardTop = cursorY
    const cardHeight = 98

    doc.setDrawColor(203, 213, 225)
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(x, cardTop, cardWidth, cardHeight, 14, 14, 'FD')
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(x, cardTop, cardWidth, 24, 14, 14, 'F')
    doc.rect(x, cardTop + 16, cardWidth, 8, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 58, 138)
    doc.setFontSize(10)
    doc.text(title.toUpperCase(), x + 12, cardTop + 15)

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(10)

    let lineY = cardTop + 38
    lines.forEach((line, index) => {
      doc.setFont('helvetica', index === 0 ? 'bold' : 'normal')
      const wrapped = doc.splitTextToSize(String(line), cardWidth - 24)
      doc.text(wrapped, x + 12, lineY)
      lineY += wrapped.length * 11 + 2
    })
  }

  drawPartyCard(left, 'Emitente', [
    model.seller.tradeName || model.seller.legalName,
    ...(model.seller.tradeName ? [model.seller.legalName] : []),
    `NUIT: ${model.seller.nuit}`,
    ...model.seller.address,
  ])
  drawPartyCard(left + cardWidth + 14, 'Cliente', [
    model.buyer.legalName,
    `NUIT: ${model.buyer.nuit}`,
    ...model.buyer.address,
  ])

  cursorY += 120

  autoTable(doc as any, {
    startY: cursorY,
    margin: { left, right },
    head: [['Descrição', 'Qtd.', 'Preço unit.', 'IVA', 'Total']],
    body: model.lines.map((line) => [
      [
        line.description,
        [line.unitOfMeasure ? `Un.: ${line.unitOfMeasure}` : null, line.taxRate == null ? 'IVA: —' : `IVA: ${fmtNumber(line.taxRate, 2)}%`]
          .filter(Boolean)
          .join(' · '),
      ],
      fmtNumber(line.qty, 2),
      fmtCurrency(line.unitPrice, model.currencyCode),
      fmtCurrency(line.taxAmount, model.currencyCode),
      fmtCurrency(line.lineGrossTotal, model.currencyCode),
    ]),
    theme: 'grid',
    styles: {
      fontSize: 8.7,
      cellPadding: { top: 6, right: 5, bottom: 6, left: 5 },
      lineColor: [226, 232, 240],
      lineWidth: 0.7,
      textColor: [15, 23, 42],
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      fillColor: [239, 246, 255],
      textColor: [30, 58, 138],
      fontStyle: 'bold',
      halign: 'left',
    },
    columnStyles: {
      0: { cellWidth: 222 },
      1: { cellWidth: 44, halign: 'right' },
      2: { cellWidth: 72, halign: 'right' },
      3: { cellWidth: 58, halign: 'right' },
      4: { cellWidth: 72, halign: 'right' },
    },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0) {
        data.cell.styles.fontStyle = 'normal'
      }
    },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 0 && Array.isArray(data.cell.raw)) {
        const [title, meta] = data.cell.raw as [string, string]
        const x = data.cell.x + 5
        let y = data.cell.y + 12

        doc.setFont('helvetica', 'bold')
        doc.setTextColor(15, 23, 42)
        doc.setFontSize(8.9)
        doc.text(doc.splitTextToSize(title, data.cell.width - 10), x, y)

        const wrappedTitle = doc.splitTextToSize(title, data.cell.width - 10)
        y += wrappedTitle.length * 9 + 2

        doc.setFont('helvetica', 'normal')
        doc.setTextColor(100, 116, 139)
        doc.setFontSize(7.8)
        doc.text(doc.splitTextToSize(meta, data.cell.width - 10), x, y)
      }
    },
  })

  cursorY = (((doc as any).lastAutoTable?.finalY as number | undefined) ?? cursorY) + 16

  if (cursorY > pageHeight - 150) {
    doc.addPage()
    cursorY = 44
  }

  const totalsLeft = pageWidth - 250
  doc.setDrawColor(203, 213, 225)
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(totalsLeft, cursorY, 212, 136, 14, 14, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.setFontSize(9)
  doc.text(model.currencyCode.toUpperCase(), totalsLeft + 12, cursorY + 16)

  const drawTotalRow = (label: string, value: string, y: number, grand = false) => {
    doc.setFont('helvetica', grand ? 'bold' : 'normal')
    doc.setTextColor(15, 23, 42)
    doc.setFontSize(grand ? 11.5 : 9.5)
    doc.text(label, totalsLeft + 12, y)
    doc.text(value, pageWidth - 52, y, { align: 'right' })
  }

  drawTotalRow('Subtotal', fmtCurrency(model.subtotal, model.currencyCode), cursorY + 34)
  drawTotalRow('IVA', fmtCurrency(model.taxTotal, model.currencyCode), cursorY + 50)
  doc.setDrawColor(203, 213, 225)
  doc.line(totalsLeft + 12, cursorY + 60, pageWidth - 52, cursorY + 60)
  drawTotalRow('Total', fmtCurrency(model.totalAmount, model.currencyCode), cursorY + 78, true)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(71, 85, 105)
  doc.setFontSize(9)
  doc.text('MZN', totalsLeft + 12, cursorY + 104)
  drawTotalRow('Subtotal fiscal', fmtCurrency(model.subtotalMzn, 'MZN'), cursorY + 122)
  drawTotalRow('IVA fiscal', fmtCurrency(model.taxTotalMzn, 'MZN'), cursorY + 138)
  doc.line(totalsLeft + 12, cursorY + 148, pageWidth - 52, cursorY + 148)
  drawTotalRow('Total fiscal', fmtCurrency(model.totalAmountMzn, 'MZN'), cursorY + 166, true)

  const footerY = Math.max(cursorY + 164, (((doc as any).lastAutoTable?.finalY as number | undefined) ?? cursorY) + 22)
  doc.setDrawColor(203, 213, 225)
  doc.line(left, footerY, right, footerY)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.setFontSize(10)
  doc.text(model.computerPhrase, left, footerY + 16)

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
