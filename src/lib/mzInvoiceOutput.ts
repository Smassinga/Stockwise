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
  return filtered.length ? filtered.map(escapeHtml).join('<br/>') : '-'
}

function buildAddressLines(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
}

export function buildSalesInvoiceOutputModel(
  invoice: SalesInvoiceDocumentRow,
  lines: SalesInvoiceDocumentLineRow[],
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
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #0f172a;
      font: 11.5px/1.45 "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #ffffff;
    }
    .wrap { padding: 0; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      border-bottom: 2px solid #dbeafe;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .title-block h1 {
      margin: 0;
      font-size: 28px;
      letter-spacing: 0.02em;
    }
    .eyebrow {
      color: #1d4ed8;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: 10px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .meta {
      min-width: 280px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 10px 12px;
      background: #f8fafc;
    }
    .meta-row {
      display: grid;
      grid-template-columns: 128px 1fr;
      gap: 8px;
      margin: 2px 0;
    }
    .label {
      color: #475569;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
    }
    .value-strong {
      font-weight: 700;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }
    .card {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px;
      background: #ffffff;
    }
    .card h2 {
      margin: 0 0 8px;
      font-size: 12px;
      color: #1d4ed8;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
    .address {
      color: #334155;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    thead th {
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border-bottom: 1px solid #bfdbfe;
      padding: 8px 6px;
      text-align: left;
    }
    td {
      border-bottom: 1px solid #e2e8f0;
      padding: 8px 6px;
      vertical-align: top;
    }
    .right { text-align: right; }
    .totals {
      width: 360px;
      margin-left: auto;
      margin-top: 14px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px;
      background: #f8fafc;
    }
    .totals-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      margin: 4px 0;
    }
    .totals-row.grand {
      font-size: 14px;
      font-weight: 800;
      border-top: 1px solid #cbd5e1;
      padding-top: 8px;
      margin-top: 8px;
    }
    .footer {
      margin-top: 18px;
      border-top: 1px dashed #cbd5e1;
      padding-top: 10px;
      color: #334155;
      font-size: 11px;
    }
    .footer-phrase {
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
  `
}

function buildSalesInvoiceHtml(model: SalesInvoiceOutputModel) {
  const rows = model.lines
    .map((line) => {
      const detail = line.unitOfMeasure ? ` (${escapeHtml(line.unitOfMeasure)})` : ''
      return `<tr>
        <td>${escapeHtml(line.description)}${detail}</td>
        <td class="right">${fmtNumber(line.qty, 2)}</td>
        <td class="right">${fmtCurrency(line.unitPrice, model.currencyCode)}</td>
        <td class="right">${fmtCurrency(line.lineNetTotal, model.currencyCode)}</td>
        <td class="right">${fmtCurrency(line.taxAmount, model.currencyCode)}</td>
        <td class="right">${fmtCurrency(line.lineGrossTotal, model.currencyCode)}</td>
      </tr>`
    })
    .join('')

  return `<div class="wrap">
    <div class="header">
      <div class="title-block">
        <div class="eyebrow">Sistema fiscal Moçambique</div>
        <h1>Fatura</h1>
        <div><strong>${escapeHtml(model.legalReference)}</strong></div>
      </div>
      <div class="meta">
        <div class="meta-row"><div class="label">Referência</div><div class="value-strong">${escapeHtml(model.legalReference)}</div></div>
        <div class="meta-row"><div class="label">Data da fatura</div><div>${escapeHtml(model.issueDate)}</div></div>
        <div class="meta-row"><div class="label">Data de vencimento</div><div>${escapeHtml(model.dueDate)}</div></div>
        <div class="meta-row"><div class="label">Moeda</div><div>${escapeHtml(model.currencyCode)}</div></div>
        <div class="meta-row"><div class="label">Estado</div><div>${escapeHtml(model.status.toUpperCase())}</div></div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Emitente</h2>
        <div class="value-strong">${escapeHtml(model.seller.tradeName || model.seller.legalName)}</div>
        ${model.seller.tradeName ? `<div>${escapeHtml(model.seller.legalName)}</div>` : ''}
        <div>NUIT: ${escapeHtml(model.seller.nuit)}</div>
        <div class="address">${multilineHtml(model.seller.address)}</div>
      </div>
      <div class="card">
        <h2>Cliente</h2>
        <div class="value-strong">${escapeHtml(model.buyer.legalName)}</div>
        <div>NUIT: ${escapeHtml(model.buyer.nuit)}</div>
        <div class="address">${multilineHtml(model.buyer.address)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Descrição</th>
          <th class="right">Qtd</th>
          <th class="right">Preço unit.</th>
          <th class="right">Base</th>
          <th class="right">IVA</th>
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><div>Subtotal (${escapeHtml(model.currencyCode)})</div><div>${fmtCurrency(model.subtotal, model.currencyCode)}</div></div>
      <div class="totals-row"><div>IVA (${escapeHtml(model.currencyCode)})</div><div>${fmtCurrency(model.taxTotal, model.currencyCode)}</div></div>
      <div class="totals-row grand"><div>Total (${escapeHtml(model.currencyCode)})</div><div>${fmtCurrency(model.totalAmount, model.currencyCode)}</div></div>
      <div class="totals-row"><div>Subtotal fiscal (MZN)</div><div>${fmtCurrency(model.subtotalMzn, 'MZN')}</div></div>
      <div class="totals-row"><div>IVA fiscal (MZN)</div><div>${fmtCurrency(model.taxTotalMzn, 'MZN')}</div></div>
      <div class="totals-row grand"><div>Total fiscal (MZN)</div><div>${fmtCurrency(model.totalAmountMzn, 'MZN')}</div></div>
    </div>

    <div class="footer">
      <div class="footer-phrase">${escapeHtml(model.computerPhrase)}</div>
      <div>Documento fiscal emitido com base nos dados congelados da fatura.</div>
    </div>
  </div>`
}

function htmlShell(title: string, css: string, html: string) {
  return `<html><head><title>${escapeHtml(title)}</title><meta charset="utf-8"/><style>${css}</style></head><body>${html}</body></html>`
}

async function buildSalesInvoicePdfBlob(model: SalesInvoiceOutputModel) {
  const { jsPDF, autoTable } = await loadPdfSuite()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })

  const left = 40
  const right = doc.internal.pageSize.getWidth() - 40
  let cursorY = 44

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(29, 78, 216)
  doc.text('SISTEMA FISCAL MOÇAMBIQUE', left, cursorY)

  cursorY += 20
  doc.setTextColor(15, 23, 42)
  doc.setFontSize(24)
  doc.text('Fatura', left, cursorY)

  doc.setFontSize(12)
  doc.text(model.legalReference, right, cursorY, { align: 'right' })

  cursorY += 22
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(71, 85, 105)
  doc.text(`Data da fatura: ${model.issueDate}`, left, cursorY)
  doc.text(`Vencimento: ${model.dueDate}`, right, cursorY, { align: 'right' })

  cursorY += 26
  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Emitente', left, cursorY)
  doc.text('Cliente', 300, cursorY)

  cursorY += 16
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  ;[
    model.seller.tradeName || model.seller.legalName,
    model.seller.tradeName ? model.seller.legalName : null,
    `NUIT: ${model.seller.nuit}`,
    ...model.seller.address,
  ]
    .filter(Boolean)
    .forEach((line) => {
      doc.text(String(line), left, cursorY)
      cursorY += 12
    })

  let buyerY = 44 + 20 + 22 + 26 + 16
  ;[
    model.buyer.legalName,
    `NUIT: ${model.buyer.nuit}`,
    ...model.buyer.address,
  ].forEach((line) => {
    doc.text(String(line), 300, buyerY)
    buyerY += 12
  })

  cursorY = Math.max(cursorY, buyerY) + 18

  autoTable(doc as any, {
    startY: cursorY,
    margin: { left, right },
    head: [['Descrição', 'Qtd', 'Preço unit.', 'Base', 'IVA', 'Total']],
    body: model.lines.map((line) => [
      line.description + (line.unitOfMeasure ? ` (${line.unitOfMeasure})` : ''),
      fmtNumber(line.qty, 2),
      fmtCurrency(line.unitPrice, model.currencyCode),
      fmtCurrency(line.lineNetTotal, model.currencyCode),
      fmtCurrency(line.taxAmount, model.currencyCode),
      fmtCurrency(line.lineGrossTotal, model.currencyCode),
    ]),
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 5,
      lineColor: [226, 232, 240],
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: [239, 246, 255],
      textColor: [30, 58, 138],
      fontStyle: 'bold',
    },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  })

  cursorY = (((doc as any).lastAutoTable?.finalY as number | undefined) ?? cursorY) + 18

  const totals: Array<[string, string]> = [
    [`Subtotal (${model.currencyCode})`, fmtCurrency(model.subtotal, model.currencyCode)],
    [`IVA (${model.currencyCode})`, fmtCurrency(model.taxTotal, model.currencyCode)],
    [`Total (${model.currencyCode})`, fmtCurrency(model.totalAmount, model.currencyCode)],
    ['Subtotal fiscal (MZN)', fmtCurrency(model.subtotalMzn, 'MZN')],
    ['IVA fiscal (MZN)', fmtCurrency(model.taxTotalMzn, 'MZN')],
    ['Total fiscal (MZN)', fmtCurrency(model.totalAmountMzn, 'MZN')],
  ]

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  totals.forEach(([label, value], index) => {
    const isGrand = index === 2 || index === 5
    doc.setFont('helvetica', isGrand ? 'bold' : 'normal')
    doc.text(label, 320, cursorY)
    doc.text(value, right, cursorY, { align: 'right' })
    cursorY += isGrand ? 16 : 13
  })

  cursorY += 10
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text(model.computerPhrase, left, cursorY)
  doc.setFont('helvetica', 'normal')
  doc.text('Documento fiscal emitido com base nos dados congelados da fatura.', left, cursorY + 14)

  return doc.output('blob') as Blob
}

export async function printSalesInvoiceDocument(model: SalesInvoiceOutputModel) {
  const shell = htmlShell(
    `Fatura ${model.legalReference}`,
    buildSalesInvoiceCss(),
    buildSalesInvoiceHtml(model),
  )
  const w = window.open('', '_blank', 'noopener,noreferrer')
  if (!w) {
    throw new Error('Não foi possível abrir a janela de impressão.')
  }

  w.document.write(shell)
  w.document.close()
  setTimeout(() => {
    try {
      w.focus()
      w.print()
    } catch {
      w.alert('Use a função de impressão do navegador para continuar.')
    }
  }, 300)
}

export async function downloadSalesInvoicePdf(model: SalesInvoiceOutputModel) {
  const blob = await buildSalesInvoicePdfBlob(model)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${model.legalReference}.pdf`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export async function shareSalesInvoiceDocument(model: SalesInvoiceOutputModel) {
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
    const file = new File([blob], `${model.legalReference}.pdf`, { type: 'application/pdf' })

    if (navigatorWithShare.canShare?.({ files: [file] })) {
      await navigatorWithShare.share({
        title: `Fatura ${model.legalReference}`,
        text: summaryText,
        files: [file],
      })
      return
    }

    await navigatorWithShare.share({
      title: `Fatura ${model.legalReference}`,
      text: summaryText,
    })
    return
  }

  throw new Error('A partilha não está disponível neste dispositivo.')
}
