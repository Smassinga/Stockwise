import { saveAs } from 'file-saver'

export type ParsedImportRow = Record<string, string>

export function normalizeImportHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
}

function rowsToImportObjects(rows: string[][]) {
  const headerRow = rows[0] || []
  const headers = headerRow.map(normalizeImportHeader)
  const parsed: ParsedImportRow[] = []

  for (const values of rows.slice(1)) {
    const normalized: ParsedImportRow = {}
    let hasValue = false

    headers.forEach((header, index) => {
      if (!header) return
      const value = String(values[index] ?? '').trim()
      if (value) hasValue = true
      normalized[header] = value
    })

    if (hasValue) parsed.push(normalized)
  }

  return parsed
}

function parseCsvRows(source: string) {
  const text = source.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"' && field.length === 0) {
      quoted = true
      continue
    }
    if (character === ',') {
      pushField()
      continue
    }
    if (character === '\n') {
      pushRow()
      continue
    }
    if (character === '\r') {
      if (text[index + 1] === '\n') index += 1
      pushRow()
      continue
    }

    field += character
  }

  if (quoted) throw new Error('The CSV file contains an unterminated quoted field.')
  if (field.length > 0 || row.length > 0) pushRow()

  return rows
}

async function readXlsxRows(arrayBuffer: ArrayBuffer) {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const loadWorkbook = workbook.xlsx.load as unknown as (data: ArrayBuffer) => Promise<unknown>
  await loadWorkbook(arrayBuffer)

  const worksheet = workbook.worksheets[0]
  if (!worksheet) return [] as string[][]

  const columnCount = Math.max(worksheet.columnCount, worksheet.getRow(1).cellCount)
  const rows: string[][] = []

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber)
    const values: string[] = []
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      values.push(worksheetRow.getCell(columnNumber).text.trim())
    }
    rows.push(values)
  }

  return rows
}

export async function readImportWorkbook(file: File) {
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.csv')) {
    return rowsToImportObjects(parseCsvRows(await file.text()))
  }

  if (lowerName.endsWith('.xls')) {
    throw new Error('Legacy .xls files are not supported. Save the workbook as .xlsx or .csv and upload it again.')
  }

  if (!lowerName.endsWith('.xlsx')) {
    throw new Error('Unsupported import file. Use an .xlsx or .csv file.')
  }

  return rowsToImportObjects(await readXlsxRows(await file.arrayBuffer()))
}

export function downloadImportTemplate(
  filename: string,
  headers: string[],
  sampleRows: Array<Record<string, string | number | null | undefined>>,
) {
  void (async () => {
    const ExcelJS = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'StockWise'
    workbook.created = new Date()

    const worksheet = workbook.addWorksheet('Template', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: true }],
    })
    worksheet.addRow(headers)
    sampleRows.forEach((row) => {
      worksheet.addRow(headers.map((header) => row[header] ?? ''))
    })
    worksheet.columns = headers.map((header) => ({
      width: Math.min(32, Math.max(12, header.length + 2)),
    }))
    worksheet.getRow(1).font = { bold: true }

    const buffer = await workbook.xlsx.writeBuffer()
    saveAs(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename,
    )
  })().catch((error) => {
    console.error('Import template generation failed', error)
  })
}
