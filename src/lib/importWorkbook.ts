import * as XLSX from 'xlsx'

export type ParsedImportRow = Record<string, string>

export function normalizeImportHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
}

export async function readImportWorkbook(file: File) {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return [] as ParsedImportRow[]

  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: '',
    raw: false,
  })

  return rows.map((row) => {
    const normalized: ParsedImportRow = {}
    for (const [key, value] of Object.entries(row)) {
      const header = normalizeImportHeader(key)
      if (!header) continue
      normalized[header] = String(value ?? '').trim()
    }
    return normalized
  })
}

export function downloadImportTemplate(
  filename: string,
  headers: string[],
  sampleRows: Array<Record<string, string | number | null | undefined>>,
) {
  const worksheetRows = [
    headers,
    ...sampleRows.map((row) => headers.map((header) => row[header] ?? '')),
  ]
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetRows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Template')
  XLSX.writeFileXLSX(workbook, filename)
}
