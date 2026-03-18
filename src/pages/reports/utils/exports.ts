// src/pages/reports/utils/exports.ts
export type Row = (string | number)[]

export type HeaderCtx = {
  companyName: string
  startDate: string
  endDate: string
  displayCurrency: string
  baseCurrency: string
  fxRate: number
  fxNote?: string
}

type SheetDef = {
  title: string
  headerTitle: string
  body: Row[]
  moneyCols?: number[]
  qtyCols?: number[]
}

let spreadsheetSuitePromise: Promise<{
  XLSX: typeof import('xlsx')
  saveAs: typeof import('file-saver').saveAs
}> | null = null

let pdfSuitePromise: Promise<{
  jsPDF: typeof import('jspdf').default
  autoTable: typeof import('jspdf-autotable').default
}> | null = null

async function loadSpreadsheetSuite() {
  if (!spreadsheetSuitePromise) {
    spreadsheetSuitePromise = Promise.all([import('xlsx'), import('file-saver')]).then(
      ([XLSX, fileSaver]) => ({
        XLSX,
        saveAs: fileSaver.saveAs,
      })
    )
  }
  return spreadsheetSuitePromise
}

async function loadPdfSuite() {
  if (!pdfSuitePromise) {
    pdfSuitePromise = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(
      ([jspdf, jspdfAutoTable]) => ({
        jsPDF: jspdf.default,
        autoTable: jspdfAutoTable.default,
      })
    )
  }
  return pdfSuitePromise
}

const fmtPositive = (x: number, decimals = 2) => {
  const fixed = (Math.abs(x) || 0).toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decPart != null ? `${withCommas}.${decPart}` : withCommas
}

const fmt = (x: number, d = 2) => (x < 0 ? '-' : '') + fmtPositive(x, d)
const fmtAccounting = (x: number, d = 2) => (x < 0 ? `(${fmtPositive(x, d)})` : fmtPositive(x, d))

export const moneyText = (v: number, ctx: HeaderCtx) =>
  `${ctx.displayCurrency} ${fmtAccounting(v * ctx.fxRate, 2)}`

export const headerRows = (ctx: HeaderCtx, title: string): Row[] => ([
  [ctx.companyName],
  [title],
  [`Period: ${ctx.startDate} → ${ctx.endDate}`],
  [`Currency: ${ctx.displayCurrency}${ctx.fxRate !== 1 ? `  (FX ${ctx.fxRate.toFixed(6)} per ${ctx.baseCurrency})` : ''}`],
  [ctx.fxNote ? ctx.fxNote : ''],
  [''],
])

export function formatRowsForCSV(rows: Row[], ctx: HeaderCtx, moneyCols: number[] = [], qtyCols: number[] = []) {
  return rows.map((r, i) => {
    if (i === 0) return r
    return r.map((cell, ci) => {
      if (typeof cell === 'number') {
        if (moneyCols.includes(ci)) return moneyText(cell, ctx)
        if (qtyCols.includes(ci)) return fmt(cell, 2)
        return fmt(cell, 2)
      }
      return String(cell ?? '')
    })
  })
}

export async function downloadCSV(filename: string, rows: Row[]) {
  const { saveAs } = await loadSpreadsheetSuite()
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? '')
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
        })
        .join(',')
    )
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, filename)
}

function formatSheetNumbers(
  XLSX: typeof import('xlsx'),
  ws: import('xlsx').WorkSheet,
  dataStartRow: number,
  moneyCols: number[] = [],
  qtyCols: number[] = []
) {
  if (!ws['!ref']) return
  const range = XLSX.utils.decode_range(ws['!ref'])
  const moneyFmt = '#,##0.00;(#,##0.00)'
  const qtyFmt = '#,##0.00;[Red]-#,##0.00'
  for (let row = dataStartRow; row <= range.e.r; row++) {
    for (const col of moneyCols) {
      const address = XLSX.utils.encode_cell({ r: row, c: col })
      const cell = (ws as Record<string, any>)[address]
      if (cell && typeof cell.v === 'number') cell.z = moneyFmt
    }
    for (const col of qtyCols) {
      const address = XLSX.utils.encode_cell({ r: row, c: col })
      const cell = (ws as Record<string, any>)[address]
      if (cell && typeof cell.v === 'number') cell.z = qtyFmt
    }
  }
}

export async function saveXLSX(filename: string, ctx: HeaderCtx, sheets: SheetDef[]) {
  const { XLSX, saveAs } = await loadSpreadsheetSuite()
  const wb = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const pre = headerRows(ctx, sheet.headerTitle)
    const aoa = [...pre, ...sheet.body]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    XLSX.utils.book_append_sheet(wb, ws, sheet.title.substring(0, 31))
    const dataStart = pre.length + 1
    formatSheetNumbers(XLSX, ws, dataStart, sheet.moneyCols || [], sheet.qtyCols || [])
  }

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(new Blob([wbout], { type: 'application/octet-stream' }), filename)
}

export async function startPDF(ctx: HeaderCtx, title: string) {
  const { jsPDF } = await loadPdfSuite()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFontSize(12)
  doc.text(ctx.companyName, 40, 36)
  doc.setFontSize(14)
  doc.text(title, 40, 58)
  doc.setFontSize(10)
  doc.text(`Period: ${ctx.startDate} → ${ctx.endDate}`, 40, 76)
  let fxLine = `Currency: ${ctx.displayCurrency}${ctx.fxRate !== 1 ? `  (FX ${ctx.fxRate.toFixed(6)} per ${ctx.baseCurrency})` : ''}`
  if (ctx.fxNote) fxLine += ` • ${ctx.fxNote}`
  doc.text(fxLine, 40, 92)
  doc.setDrawColor(200)
  doc.line(40, 100, 800, 100)
  return doc
}

export async function pdfTable(
  doc: any,
  head: string[],
  body: Row[],
  moneyCols: number[],
  ctx: HeaderCtx,
  startY = 110
) {
  const { autoTable } = await loadPdfSuite()
  autoTable(doc, {
    startY,
    head: [head],
    body,
    styles: { fontSize: 9 as const, cellPadding: 4 },
    headStyles: { fillColor: [240, 240, 240] as [number, number, number] },
    didParseCell(data: any) {
      if (data.section === 'body' && typeof data.cell.raw === 'number' && moneyCols.includes(data.column.index)) {
        data.cell.text = [moneyText(data.cell.raw as number, ctx)]
      }
    },
  })
}
