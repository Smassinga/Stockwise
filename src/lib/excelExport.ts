import { saveAs } from 'file-saver'
import { supabase } from './supabase'
import { companyLogoUrl } from './companyProfile'

export type ExportCompanyHeader = {
  companyName: string
  legalName?: string | null
  taxId?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  footerNote?: string | null
  logoUrl?: string | null
}

export type ExcelColumn<T> = {
  label: string
  value: (row: T) => string | number | null | undefined
  width?: number
  type?: 'text' | 'number' | 'currency'
}

export type ExcelReportOptions<T> = {
  filename: string
  sheetName: string
  title: string
  subtitle?: string
  filters?: string[]
  company: ExportCompanyHeader
  columns: ExcelColumn<T>[]
  rows: T[]
  labels?: {
    generated?: string
    filters?: string
    taxId?: string
    email?: string
    phone?: string
  }
}

type CompanyRow = {
  legal_name: string | null
  trade_name: string | null
  tax_id: string | null
  phone: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country_code: string | null
  print_footer_note: string | null
  logo_path: string | null
}

type CompanySettingsRow = {
  data?: {
    documents?: {
      brand?: {
        name?: string
        logoUrl?: string
      }
    }
  } | null
}

type LogoImage = {
  base64: string
  extension: 'png' | 'jpeg' | 'gif'
}

function formatDateTime(value: Date) {
  return value.toLocaleString()
}

function normalizeAddress(row: CompanyRow | null) {
  if (!row) return ''
  return [
    row.address_line1,
    row.address_line2,
    [row.city, row.state].filter(Boolean).join(', '),
    row.postal_code,
    row.country_code,
  ]
    .filter(Boolean)
    .join(' | ')
}

async function toDataUrl(src: string): Promise<string | null> {
  try {
    const response = await fetch(src, { cache: 'no-store' })
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

function normalizeLogoImage(dataUrl: string | null): LogoImage | null {
  if (!dataUrl) return null
  if (dataUrl.startsWith('data:image/png')) return { base64: dataUrl, extension: 'png' }
  if (dataUrl.startsWith('data:image/gif')) return { base64: dataUrl, extension: 'gif' }
  if (dataUrl.startsWith('data:image/jpg') || dataUrl.startsWith('data:image/jpeg')) {
    return { base64: dataUrl, extension: 'jpeg' }
  }
  return null
}

export async function loadCompanyExportHeader(companyId: string): Promise<ExportCompanyHeader> {
  const [{ data: companyData, error: companyError }, { data: settingsData, error: settingsError }] = await Promise.all([
    supabase
      .from('companies')
      .select(
        'legal_name,trade_name,tax_id,phone,email,address_line1,address_line2,city,state,postal_code,country_code,print_footer_note,logo_path'
      )
      .eq('id', companyId)
      .maybeSingle(),
    supabase
      .from('company_settings')
      .select('data')
      .eq('company_id', companyId)
      .maybeSingle(),
  ])

  if (companyError) throw companyError
  if (settingsError && settingsError.code !== 'PGRST116') throw settingsError

  const company = (companyData as CompanyRow | null) ?? null
  const settings = (settingsData as CompanySettingsRow | null) ?? null
  const settingsLogo = settings?.data?.documents?.brand?.logoUrl?.trim()
  const companyLogo = companyLogoUrl(company?.logo_path || null)

  return {
    companyName:
      settings?.data?.documents?.brand?.name?.trim() ||
      company?.trade_name?.trim() ||
      company?.legal_name?.trim() ||
      'StockWise',
    legalName: company?.legal_name || null,
    taxId: company?.tax_id || null,
    email: company?.email || null,
    phone: company?.phone || null,
    address: normalizeAddress(company),
    footerNote: company?.print_footer_note || null,
    logoUrl: settingsLogo || companyLogo || null,
  }
}

export async function exportExcelReport<T>(options: ExcelReportOptions<T>) {
  const labels = {
    generated: options.labels?.generated || 'Generated',
    filters: options.labels?.filters || 'Filters',
    taxId: options.labels?.taxId || 'Tax ID',
    email: options.labels?.email || 'Email',
    phone: options.labels?.phone || 'Phone',
  }

  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'StockWise'
  workbook.created = new Date()
  workbook.modified = new Date()

  const sheet = workbook.addWorksheet(options.sheetName.slice(0, 31), {
    properties: { defaultRowHeight: 20 },
    views: [{ showGridLines: false }],
  })

  const totalColumns = Math.max(options.columns.length, 1)
  sheet.columns = options.columns.map((column) => ({
    width: column.width ?? Math.max(14, column.label.length + 2),
  }))

  const headerStartColumn = options.company.logoUrl ? 3 : 1
  const headerEndColumn = Math.max(headerStartColumn, totalColumns)
  const mergeAcross = (row: number) => {
    sheet.mergeCells(row, headerStartColumn, row, headerEndColumn)
  }

  if (options.company.logoUrl) {
    const logo = normalizeLogoImage(await toDataUrl(options.company.logoUrl))
    if (logo) {
      const imageId = workbook.addImage(logo)
      sheet.addImage(imageId, {
        tl: { col: 0.1, row: 0.15 },
        ext: { width: 92, height: 52 },
      })
      sheet.getRow(1).height = 24
      sheet.getRow(2).height = 22
      sheet.getRow(3).height = 18
    }
  }

  const companyLine =
    options.company.legalName && options.company.legalName !== options.company.companyName
      ? `${options.company.companyName} (${options.company.legalName})`
      : options.company.companyName
  const contactLine = [
    options.company.taxId ? `${labels.taxId}: ${options.company.taxId}` : null,
    options.company.email ? `${labels.email}: ${options.company.email}` : null,
    options.company.phone ? `${labels.phone}: ${options.company.phone}` : null,
  ]
    .filter(Boolean)
    .join('  |  ')

  mergeAcross(1)
  sheet.getCell(1, headerStartColumn).value = companyLine
  sheet.getCell(1, headerStartColumn).font = { size: 16, bold: true, color: { argb: 'FF0F172A' } }
  sheet.getCell(1, headerStartColumn).alignment = { vertical: 'middle' }

  if (contactLine) {
    mergeAcross(2)
    sheet.getCell(2, headerStartColumn).value = contactLine
    sheet.getCell(2, headerStartColumn).font = { size: 10, color: { argb: 'FF475569' } }
  }

  if (options.company.address) {
    mergeAcross(3)
    sheet.getCell(3, headerStartColumn).value = options.company.address
    sheet.getCell(3, headerStartColumn).font = { size: 10, color: { argb: 'FF475569' } }
  }

  mergeAcross(5)
  sheet.getCell(5, 1).value = options.title
  sheet.getCell(5, 1).font = { size: 15, bold: true, color: { argb: 'FF0F172A' } }

  if (options.subtitle) {
    mergeAcross(6)
    sheet.getCell(6, 1).value = options.subtitle
    sheet.getCell(6, 1).font = { size: 10, color: { argb: 'FF64748B' } }
  }

  mergeAcross(7)
  sheet.getCell(7, 1).value = `${labels.generated}: ${formatDateTime(new Date())}`
  sheet.getCell(7, 1).font = { size: 10, color: { argb: 'FF475569' } }

  if (options.filters?.length) {
    mergeAcross(8)
    sheet.getCell(8, 1).value = `${labels.filters}: ${options.filters.join(' | ')}`
    sheet.getCell(8, 1).font = { size: 10, color: { argb: 'FF475569' } }
  }

  const headerRowNumber = options.filters?.length ? 10 : 9
  const headerRow = sheet.getRow(headerRowNumber)
  options.columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1)
    cell.value = column.label
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1D4ED8' },
    }
    cell.alignment = { vertical: 'middle', horizontal: column.type === 'text' ? 'left' : 'right' }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      left: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      bottom: { style: 'thin', color: { argb: 'FFBFDBFE' } },
      right: { style: 'thin', color: { argb: 'FFBFDBFE' } },
    }
  })
  headerRow.height = 22

  const moneyFmt = '#,##0.00;[Red](#,##0.00)'
  const numberFmt = '#,##0.00;[Red]-#,##0.00'
  const firstDataRow = headerRowNumber + 1

  options.rows.forEach((row, rowIndex) => {
    const sheetRow = sheet.getRow(firstDataRow + rowIndex)
    options.columns.forEach((column, columnIndex) => {
      const cell = sheetRow.getCell(columnIndex + 1)
      const value = column.value(row)
      cell.value = value == null ? '' : value
      cell.alignment = {
        vertical: 'top',
        horizontal: column.type === 'text' ? 'left' : 'right',
      }
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
      if (typeof value === 'number') {
        cell.numFmt = column.type === 'currency' ? moneyFmt : numberFmt
      }
    })
  })

  if (options.company.footerNote) {
    const footerRowNumber = firstDataRow + options.rows.length + 2
    sheet.mergeCells(footerRowNumber, 1, footerRowNumber, totalColumns)
    const footerCell = sheet.getCell(footerRowNumber, 1)
    footerCell.value = options.company.footerNote
    footerCell.font = { italic: true, size: 10, color: { argb: 'FF475569' } }
  }

  sheet.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber, column: totalColumns },
  }
  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber, showGridLines: false }]

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    options.filename,
  )
}
