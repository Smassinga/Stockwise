import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { supabase } from './supabase'

export type ExportCompanyHeader = {
  companyName: string
  legalName?: string | null
  taxId?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  footerNote?: string | null
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
}

type CompanySettingsRow = {
  data?: {
    documents?: {
      brand?: {
        name?: string
      }
    }
  } | null
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

export async function loadCompanyExportHeader(companyId: string): Promise<ExportCompanyHeader> {
  const [{ data: companyData, error: companyError }, { data: settingsData, error: settingsError }] = await Promise.all([
    supabase
      .from('companies')
      .select(
        'legal_name,trade_name,tax_id,phone,email,address_line1,address_line2,city,state,postal_code,country_code,print_footer_note'
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
  }
}

export function exportExcelReport<T>(options: ExcelReportOptions<T>) {
  const labels = {
    generated: options.labels?.generated || 'Generated',
    filters: options.labels?.filters || 'Filters',
    taxId: options.labels?.taxId || 'Tax ID',
    email: options.labels?.email || 'Email',
    phone: options.labels?.phone || 'Phone',
  }
  const aoa: Array<Array<string | number>> = []
  const now = new Date()
  const mergeRows: number[] = []
  const companyLine = options.company.legalName && options.company.legalName !== options.company.companyName
    ? `${options.company.companyName} (${options.company.legalName})`
    : options.company.companyName

  mergeRows.push(aoa.length)
  aoa.push([companyLine])
  if (options.company.taxId || options.company.email || options.company.phone) {
    aoa.push([
      [
        options.company.taxId ? `${labels.taxId}: ${options.company.taxId}` : null,
        options.company.email ? `${labels.email}: ${options.company.email}` : null,
        options.company.phone ? `${labels.phone}: ${options.company.phone}` : null,
      ]
        .filter(Boolean)
        .join('  |  '),
    ])
  }
  if (options.company.address) aoa.push([options.company.address])
  mergeRows.push(aoa.length)
  aoa.push([options.title])
  if (options.subtitle) {
    mergeRows.push(aoa.length)
    aoa.push([options.subtitle])
  }
  aoa.push([`${labels.generated}: ${formatDateTime(now)}`])
  if (options.filters?.length) aoa.push([`${labels.filters}: ${options.filters.join(' | ')}`])
  aoa.push([])

  const headerRowIndex = aoa.length
  aoa.push(options.columns.map((column) => column.label))
  for (const row of options.rows) {
    aoa.push(options.columns.map((column) => {
      const value = column.value(row)
      return value == null ? '' : value
    }))
  }

  if (options.company.footerNote) {
    aoa.push([])
    aoa.push([options.company.footerNote])
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = options.columns.map((column) => ({ wch: column.width ?? Math.max(14, column.label.length + 2) }))

  const mergeWidth = Math.max(0, options.columns.length - 1)
  ws['!merges'] = mergeRows.map((rowIndex) => ({
    s: { r: rowIndex, c: 0 },
    e: { r: rowIndex, c: mergeWidth },
  }))

  const moneyFmt = '#,##0.00;(#,##0.00)'
  const numberFmt = '#,##0.00;[Red]-#,##0.00'
  for (let rowIndex = headerRowIndex + 1; rowIndex < aoa.length; rowIndex += 1) {
    options.columns.forEach((column, columnIndex) => {
      if (column.type === 'text') return
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
      const cell = ws[address] as XLSX.CellObject | undefined
      if (!cell || typeof cell.v !== 'number') return
      cell.z = column.type === 'currency' ? moneyFmt : numberFmt
    })
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, options.sheetName.slice(0, 31))
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  saveAs(
    new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    options.filename,
  )
}
