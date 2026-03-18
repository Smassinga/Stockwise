import {
  loadCompanyExportHeader,
  loadCompanyLogoImage,
  type ExportCompanyHeader,
} from '../../../lib/excelExport'

export type Row = (string | number)[]

export type HeaderCtx = {
  companyId?: string
  companyName: string
  startDate: string
  endDate: string
  displayCurrency: string
  baseCurrency: string
  fxRate: number
  fxNote?: string
  filters?: string[]
}

type SheetDef = {
  title: string
  headerTitle: string
  body: Row[]
  moneyCols?: number[]
  qtyCols?: number[]
  filters?: string[]
}

type PdfTableOptions = {
  qtyCols?: number[]
  sectionTitle?: string
}

type PdfMeta = {
  ctx: HeaderCtx
  company: ExportCompanyHeader
  title: string
  headerBottom: number
  currentY: number
  lastPageNumber: number
  generatedAt: string
  logo: Awaited<ReturnType<typeof loadCompanyLogoImage>>
  drawnPages: Set<number>
}

type ReportPdfDoc = {
  __stockwiseReport?: PdfMeta
  addImage: (...args: any[]) => void
  getCurrentPageInfo?: () => { pageNumber: number }
  internal: {
    pageSize: {
      getWidth: () => number
    }
  }
  line: (...args: any[]) => void
  save: (filename: string) => void
  setDrawColor: (...args: any[]) => void
  setFillColor: (...args: any[]) => void
  setFont: (...args: any[]) => void
  setFontSize: (...args: any[]) => void
  setTextColor: (...args: any[]) => void
  text: (...args: any[]) => void
}

let csvSuitePromise: Promise<{
  saveAs: typeof import('file-saver').saveAs
}> | null = null

let excelSuitePromise: Promise<{
  ExcelJS: typeof import('exceljs')
  saveAs: typeof import('file-saver').saveAs
}> | null = null

let pdfSuitePromise: Promise<{
  jsPDF: typeof import('jspdf').default
  autoTable: typeof import('jspdf-autotable').default
}> | null = null

async function loadCsvSuite() {
  if (!csvSuitePromise) {
    csvSuitePromise = import('file-saver').then((fileSaver) => ({
      saveAs: fileSaver.saveAs,
    }))
  }
  return csvSuitePromise
}

async function loadExcelSuite() {
  if (!excelSuitePromise) {
    excelSuitePromise = Promise.all([import('exceljs'), import('file-saver')]).then(
      ([ExcelJS, fileSaver]) => ({
        ExcelJS,
        saveAs: fileSaver.saveAs,
      }),
    )
  }
  return excelSuitePromise
}

async function loadPdfSuite() {
  if (!pdfSuitePromise) {
    pdfSuitePromise = Promise.all([import('jspdf'), import('jspdf-autotable')]).then(
      ([jspdf, jspdfAutoTable]) => ({
        jsPDF: jspdf.default,
        autoTable: jspdfAutoTable.default,
      }),
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

function formatDateTime(value: Date) {
  return value.toLocaleString()
}

function buildCurrencyLine(ctx: HeaderCtx) {
  return `Currency: ${ctx.displayCurrency}${
    ctx.fxRate !== 1 ? ` (FX ${ctx.fxRate.toFixed(6)} per ${ctx.baseCurrency})` : ''
  }`
}

function buildHeaderContextLines(ctx: HeaderCtx, extraFilters: string[] = []) {
  const filters = [...(ctx.filters || []), ...extraFilters].filter(Boolean)
  const lines = [`Period: ${ctx.startDate} to ${ctx.endDate}`, buildCurrencyLine(ctx)]
  if (ctx.fxNote) lines.push(ctx.fxNote)
  if (filters.length) lines.push(`Filters: ${filters.join(' | ')}`)
  return lines
}

async function resolveCompanyHeader(ctx: HeaderCtx): Promise<ExportCompanyHeader> {
  if (ctx.companyId) {
    try {
      return await loadCompanyExportHeader(ctx.companyId)
    } catch (error) {
      console.error('[reports.export] Failed to load company export header', error)
    }
  }
  return { companyName: ctx.companyName }
}

function columnWidth(values: Array<string | number | null | undefined>) {
  const max = values.reduce((longest, value) => {
    const length = String(value ?? '').length
    return Math.max(longest, length)
  }, 12)
  return Math.min(Math.max(max + 2, 12), 42)
}

function excelAlignment(type: 'text' | 'number') {
  return { vertical: 'top', horizontal: type === 'text' ? 'left' : 'right' } as const
}

function moneyColumnSet(cols?: number[]) {
  return new Set(cols || [])
}

function qtyColumnSet(cols?: number[]) {
  return new Set(cols || [])
}

function currentPdfPage(doc: ReportPdfDoc) {
  return doc.getCurrentPageInfo?.().pageNumber ?? 1
}

function drawPdfHeader(doc: ReportPdfDoc, meta: PdfMeta) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const left = 40
  const right = pageWidth - 40
  const companyX = meta.logo ? 130 : left
  let top = 34

  if (meta.logo) {
    doc.addImage(meta.logo.base64, meta.logo.extension.toUpperCase(), left, 26, 72, 42)
  }

  const companyLine =
    meta.company.legalName && meta.company.legalName !== meta.company.companyName
      ? `${meta.company.companyName} (${meta.company.legalName})`
      : meta.company.companyName

  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(companyLine, companyX, top)

  top += 16
  const companyDetails = [
    meta.company.taxId ? `Tax ID: ${meta.company.taxId}` : null,
    meta.company.email ? `Email: ${meta.company.email}` : null,
    meta.company.phone ? `Phone: ${meta.company.phone}` : null,
  ]
    .filter(Boolean)
    .join('  |  ')
  if (companyDetails) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(71, 85, 105)
    doc.text(companyDetails, companyX, top)
    top += 13
  }
  if (meta.company.address) {
    doc.text(meta.company.address, companyX, top)
    top += 13
  }

  top = Math.max(top + 10, 92)

  doc.setFillColor(226, 232, 240)
  doc.setDrawColor(203, 213, 225)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(15, 23, 42)
  doc.text(meta.title, left, top)

  top += 18
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(71, 85, 105)
  doc.text(`Generated: ${meta.generatedAt}`, left, top)
  top += 13

  for (const line of buildHeaderContextLines(meta.ctx)) {
    doc.text(line, left, top)
    top += 13
  }

  doc.setDrawColor(203, 213, 225)
  doc.line(left, top, right, top)
  return top + 12
}

export const moneyText = (v: number, ctx: HeaderCtx) =>
  `${ctx.displayCurrency} ${fmtAccounting(v * ctx.fxRate, 2)}`

export const headerRows = (ctx: HeaderCtx, title: string): Row[] => {
  const rows: Row[] = [
    [ctx.companyName],
    [title],
    ...buildHeaderContextLines(ctx).map((line) => [line]),
    [''],
  ]
  return rows
}

export function formatRowsForCSV(
  rows: Row[],
  ctx: HeaderCtx,
  moneyCols: number[] = [],
  qtyCols: number[] = [],
) {
  return rows.map((row, index) => {
    if (index === 0) return row
    return row.map((cell, cellIndex) => {
      if (typeof cell === 'number') {
        if (moneyCols.includes(cellIndex)) return moneyText(cell, ctx)
        if (qtyCols.includes(cellIndex)) return fmt(cell, 2)
        return fmt(cell, 2)
      }
      return String(cell ?? '')
    })
  })
}

export async function downloadCSV(filename: string, rows: Row[]) {
  const { saveAs } = await loadCsvSuite()
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '')
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
        })
        .join(','),
    )
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  saveAs(blob, filename)
}

export async function saveXLSX(filename: string, ctx: HeaderCtx, sheets: SheetDef[]) {
  const [{ ExcelJS, saveAs }, company] = await Promise.all([loadExcelSuite(), resolveCompanyHeader(ctx)])
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StockWise'
  workbook.created = new Date()
  workbook.modified = new Date()
  const logo = await loadCompanyLogoImage(company.logoUrl || '')
  const generatedAt = formatDateTime(new Date())

  for (const sheetDef of sheets) {
    const worksheet = workbook.addWorksheet(sheetDef.title.slice(0, 31), {
      properties: { defaultRowHeight: 20 },
      views: [{ showGridLines: false }],
    })

    const headerRowValues = sheetDef.body[0] || []
    const dataRows = sheetDef.body.slice(1)
    const totalColumns = Math.max(headerRowValues.length, 1)

    worksheet.columns = Array.from({ length: totalColumns }, (_, index) => ({
      width: columnWidth([
        headerRowValues[index],
        ...dataRows.map((row) => row[index]),
      ]),
    }))

    const contentStartColumn = logo ? 2 : 1
    const headerEndColumn = Math.max(contentStartColumn, totalColumns)
    const mergeAcross = (row: number) => {
      if (contentStartColumn < headerEndColumn) {
        worksheet.mergeCells(row, contentStartColumn, row, headerEndColumn)
      }
    }

    if (logo) {
      worksheet.getColumn(1).width = Math.max(worksheet.getColumn(1).width || 14, 16)
      const imageId = workbook.addImage(logo)
      worksheet.addImage(imageId, {
        tl: { col: 0.15, row: 0.2 },
        ext: { width: 96, height: 56 },
      })
      worksheet.getRow(1).height = 26
      worksheet.getRow(2).height = 22
      worksheet.getRow(3).height = 18
    }

    const companyLine =
      company.legalName && company.legalName !== company.companyName
        ? `${company.companyName} (${company.legalName})`
        : company.companyName
    const contactLine = [
      company.taxId ? `Tax ID: ${company.taxId}` : null,
      company.email ? `Email: ${company.email}` : null,
      company.phone ? `Phone: ${company.phone}` : null,
    ]
      .filter(Boolean)
      .join('  |  ')

    mergeAcross(1)
    worksheet.getCell(1, contentStartColumn).value = companyLine
    worksheet.getCell(1, contentStartColumn).font = {
      size: 16,
      bold: true,
      color: { argb: 'FF0F172A' },
    }

    if (contactLine) {
      mergeAcross(2)
      worksheet.getCell(2, contentStartColumn).value = contactLine
      worksheet.getCell(2, contentStartColumn).font = { size: 10, color: { argb: 'FF475569' } }
    }

    if (company.address) {
      mergeAcross(3)
      worksheet.getCell(3, contentStartColumn).value = company.address
      worksheet.getCell(3, contentStartColumn).font = { size: 10, color: { argb: 'FF475569' } }
    }

    mergeAcross(5)
    worksheet.getCell(5, contentStartColumn).value = sheetDef.headerTitle
    worksheet.getCell(5, contentStartColumn).font = {
      size: 15,
      bold: true,
      color: { argb: 'FF0F172A' },
    }
    worksheet.getCell(5, contentStartColumn).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    }
    worksheet.getCell(5, contentStartColumn).border = {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    }
    worksheet.getRow(5).height = 22

    let infoRow = 7
    mergeAcross(infoRow)
    worksheet.getCell(infoRow, contentStartColumn).value = `Generated: ${generatedAt}`
    worksheet.getCell(infoRow, contentStartColumn).font = { size: 10, color: { argb: 'FF475569' } }

    for (const line of buildHeaderContextLines(ctx, sheetDef.filters)) {
      infoRow += 1
      mergeAcross(infoRow)
      worksheet.getCell(infoRow, contentStartColumn).value = line
      worksheet.getCell(infoRow, contentStartColumn).font = { size: 10, color: { argb: 'FF475569' } }
    }

    const headerRowNumber = infoRow + 2
    const headerRow = worksheet.getRow(headerRowNumber)
    headerRowValues.forEach((label, index) => {
      const cell = headerRow.getCell(index + 1)
      cell.value = label
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } }
      cell.alignment = excelAlignment('text')
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        left: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        bottom: { style: 'thin', color: { argb: 'FFBFDBFE' } },
        right: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      }
    })
    headerRow.height = 22

    const moneyCols = moneyColumnSet(sheetDef.moneyCols)
    const qtyCols = qtyColumnSet(sheetDef.qtyCols)
    const moneyFmt = '#,##0.00;[Red](#,##0.00)'
    const qtyFmt = '#,##0.00;[Red]-#,##0.00'

    dataRows.forEach((row, rowIndex) => {
      const sheetRow = worksheet.getRow(headerRowNumber + 1 + rowIndex)
      row.forEach((value, columnIndex) => {
        const cell = sheetRow.getCell(columnIndex + 1)
        cell.value = value == null ? '' : value
        const isNumeric = typeof value === 'number'
        cell.alignment = excelAlignment(isNumeric ? 'number' : 'text')
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        }
        if (rowIndex % 2 === 1) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' },
          }
        }
        if (isNumeric) {
          if (moneyCols.has(columnIndex)) {
            cell.numFmt = moneyFmt
          } else if (qtyCols.has(columnIndex)) {
            cell.numFmt = qtyFmt
          } else {
            cell.numFmt = qtyFmt
          }
        }
      })
    })

    if (company.footerNote) {
      const footerRowNumber = headerRowNumber + dataRows.length + 2
      worksheet.mergeCells(footerRowNumber, 1, footerRowNumber, totalColumns)
      const footerCell = worksheet.getCell(footerRowNumber, 1)
      footerCell.value = company.footerNote
      footerCell.font = { italic: true, size: 10, color: { argb: 'FF475569' } }
    }

    worksheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: headerRowNumber, column: totalColumns },
    }
    worksheet.views = [{ state: 'frozen', ySplit: headerRowNumber, showGridLines: false }]
  }

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename,
  )
}

export async function startPDF(ctx: HeaderCtx, title: string) {
  const [{ jsPDF }, company] = await Promise.all([loadPdfSuite(), resolveCompanyHeader(ctx)])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' }) as ReportPdfDoc
  const meta: PdfMeta = {
    ctx,
    company,
    title,
    headerBottom: 0,
    currentY: 0,
    lastPageNumber: 1,
    generatedAt: formatDateTime(new Date()),
    logo: await loadCompanyLogoImage(company.logoUrl || ''),
    drawnPages: new Set<number>(),
  }
  doc.__stockwiseReport = meta
  meta.headerBottom = drawPdfHeader(doc, meta)
  meta.drawnPages.add(1)
  meta.currentY = meta.headerBottom + 16
  return doc
}

export async function pdfTable(
  doc: ReportPdfDoc,
  head: string[],
  body: Row[],
  moneyCols: number[],
  ctx: HeaderCtx,
  startY = 110,
  options?: PdfTableOptions,
) {
  const meta = doc.__stockwiseReport
  if (!meta) throw new Error('Report PDF metadata is missing')

  const { autoTable } = await loadPdfSuite()
  const activePage = currentPdfPage(doc)
  if (activePage !== meta.lastPageNumber) {
    if (!meta.drawnPages.has(activePage)) {
      meta.headerBottom = drawPdfHeader(doc, meta)
      meta.drawnPages.add(activePage)
    }
    meta.lastPageNumber = activePage
    meta.currentY = meta.headerBottom + 16
  }

  let tableStartY = Math.max(meta.currentY, meta.headerBottom + 16, startY)
  if (options?.sectionTitle) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(options.sectionTitle, 40, tableStartY)
    tableStartY += 14
  }

  const qtyCols = new Set(options?.qtyCols || [])
  const moneySet = new Set(moneyCols)
  const columnStyles = head.reduce<Record<number, { halign: 'left' | 'right' }>>((styles, _, index) => {
    if (moneySet.has(index) || qtyCols.has(index)) {
      styles[index] = { halign: 'right' }
    }
    return styles
  }, {})

  autoTable(doc as any, {
    startY: tableStartY,
    margin: { top: meta.headerBottom + 16, left: 40, right: 40, bottom: 34 },
    head: [head],
    body,
    theme: 'grid',
    styles: {
      fontSize: 8.5,
      cellPadding: 5,
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
      textColor: [15, 23, 42],
    },
    headStyles: {
      fillColor: [29, 78, 216],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles,
    didParseCell(data: any) {
      if (data.section === 'body' && typeof data.cell.raw === 'number') {
        if (moneySet.has(data.column.index)) {
          data.cell.text = [moneyText(data.cell.raw as number, ctx)]
          data.cell.styles.halign = 'right'
        } else if (qtyCols.has(data.column.index)) {
          data.cell.text = [fmt(data.cell.raw as number, 2)]
          data.cell.styles.halign = 'right'
        }
      }
    },
    didDrawPage: () => {
      const pageNumber = currentPdfPage(doc)
      if (!meta.drawnPages.has(pageNumber)) {
        meta.headerBottom = drawPdfHeader(doc, meta)
        meta.drawnPages.add(pageNumber)
      }
      meta.lastPageNumber = pageNumber
    },
  })

  meta.currentY = (((doc as any).lastAutoTable?.finalY as number | undefined) ?? tableStartY) + 18
}
