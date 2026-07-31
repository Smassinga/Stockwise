import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, Boxes, BriefcaseBusiness, Download, FileText, PackageSearch, Printer, RefreshCw, UsersRound } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { formatMoneyBase } from '../lib/currency'
import { exportExcelReport, loadCompanyExportHeader } from '../lib/excelExport'

type ReportCode = 'performance' | 'product-profitability' | 'inventory-valuation' | 'stock-movement-ledger' | 'inventory-ageing' | 'customer-location' | 'supplier-payables' | 'service-job-profitability' | 'order-fulfilment'
type ReportPayload = { rows?: Array<Record<string, unknown>>; summary?: Record<string, unknown>; trend?: Array<Record<string, unknown>>; [key: string]: unknown }

const catalogue: Array<{ group: 'performance' | 'inventory' | 'partners' | 'operations'; reports: ReportCode[] }> = [
  { group: 'performance', reports: ['performance', 'product-profitability'] },
  { group: 'inventory', reports: ['inventory-valuation', 'stock-movement-ledger', 'inventory-ageing'] },
  { group: 'partners', reports: ['customer-location', 'supplier-payables'] },
  { group: 'operations', reports: ['service-job-profitability', 'order-fulfilment'] },
]

const labels = {
  en: {
    title: 'Reports', subtitle: 'Authoritative operational answers, loaded one report at a time.', period: 'Period', start: 'Start', end: 'End', refresh: 'Refresh', loading: 'Loading authoritative report…', empty: 'No activity matches these filters.', unavailable: 'Unavailable',
    groups: { performance: 'Performance', inventory: 'Inventory', partners: 'Customers and suppliers', operations: 'Operations' },
    reports: { performance: 'Operational performance', 'product-profitability': 'Product profitability', 'inventory-valuation': 'Inventory valuation', 'stock-movement-ledger': 'Stock movement ledger', 'inventory-ageing': 'Inventory ageing and slow-moving stock', 'customer-location': 'Customer performance and receivables', 'supplier-payables': 'Supplier spend and payables', 'service-job-profitability': 'Service Job profitability', 'order-fulfilment': 'Order fulfilment' },
    explanation: 'Operational reports follow the same recognition contract as the Owner Performance dashboard. Missing cost is never treated as zero.',
  },
  pt: {
    title: 'Relatórios', subtitle: 'Respostas operacionais autoritativas, carregadas um relatório de cada vez.', period: 'Período', start: 'Início', end: 'Fim', refresh: 'Actualizar', loading: 'A carregar o relatório autoritativo…', empty: 'Nenhuma actividade corresponde aos filtros.', unavailable: 'Indisponível',
    groups: { performance: 'Desempenho', inventory: 'Inventário', partners: 'Clientes e fornecedores', operations: 'Operações' },
    reports: { performance: 'Desempenho operacional', 'product-profitability': 'Rentabilidade por produto', 'inventory-valuation': 'Valorização do inventário', 'stock-movement-ledger': 'Razão de movimentos de stock', 'inventory-ageing': 'Antiguidade e stock de baixa rotação', 'customer-location': 'Desempenho de clientes e contas a receber', 'supplier-payables': 'Compras a fornecedores e contas a pagar', 'service-job-profitability': 'Rentabilidade dos Trabalhos de Serviço', 'order-fulfilment': 'Cumprimento de ordens' },
    explanation: 'Os relatórios operacionais seguem o mesmo contrato de reconhecimento do painel de Desempenho do Proprietário. O custo em falta nunca é tratado como zero.',
  },
} as const

function isoDaysAgo(days: number) { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10) }
function today() { return new Date().toISOString().slice(0, 10) }
function displayKey(key: string) { return key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase()) }

export default function Reports() {
  const { lang } = useI18n()
  const { companyId } = useOrg()
  const copy = labels[lang]
  const [params, setParams] = useSearchParams()
  const requested = params.get('report') as ReportCode | null
  const report = catalogue.some((group) => group.reports.includes(requested as ReportCode)) ? requested! : 'performance'
  const [startDate, setStartDate] = useState(isoDaysAgo(29))
  const [endDate, setEndDate] = useState(today())
  const [payload, setPayload] = useState<ReportPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setLoading(true); setError(null); setPayload(null)
    supabase.rpc('get_operational_report', {
      p_company_id: companyId, p_report_code: report, p_start_date: startDate, p_end_date: endDate,
      p_warehouse_id: null, p_customer_id: null, p_include_cash: true, p_slow_days: 90,
    }).then(({ data, error: rpcError }) => {
      if (cancelled) return
      setLoading(false)
      if (rpcError) setError(rpcError.message)
      else setPayload((data || {}) as ReportPayload)
    })
    return () => { cancelled = true }
  }, [companyId, endDate, reload, report, startDate])

  const rows = useMemo(() => payload?.rows || (report === 'performance' ? payload?.trend || [] : payload ? [payload] : []), [payload, report])
  const columns = useMemo(() => {
    const keys = new Set<string>()
    rows.slice(0, 30).forEach((row) => Object.keys(row).forEach((key) => { if (!key.toLowerCase().endsWith('id')) keys.add(key) }))
    return [...keys]
  }, [rows])
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const formatValue = (key: string, value: unknown) => {
    if (value == null) return copy.unavailable
    if (typeof value === 'boolean') return value ? (lang === 'pt' ? 'Sim' : 'Yes') : (lang === 'pt' ? 'Não' : 'No')
    if (typeof value === 'number' && /(sales|cogs|profit|cost|value|amount|balance|paid|subtotal|tax|price)/i.test(key)) return formatMoneyBase(value, 'MZN', locale)
    if (typeof value === 'number') return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const reportTitle = copy.reports[report]
  const period = `${startDate} – ${endDate}`
  async function exportXlsx() {
    if (!companyId || !rows.length) return
    setExporting(true)
    try {
      const company = await loadCompanyExportHeader(companyId)
      await exportExcelReport({
        filename: `StockWise_${report}_${startDate}_${endDate}.xlsx`, sheetName: reportTitle, title: reportTitle,
        subtitle: period, reportCode: report, reportingPeriod: period, displayCurrency: 'MZN', company,
        filters: [`Period: ${period}`, 'Currency: MZN'], rows,
        columns: columns.map((column) => ({
          label: displayKey(column), value: (row) => row[column] as string | number | null | undefined,
          type: /(sales|cogs|profit|cost|value|amount|balance|paid|subtotal|tax|price)/i.test(column) ? 'currency' : typeof rows[0]?.[column] === 'number' ? 'number' : 'text',
          width: Math.min(38, Math.max(14, displayKey(column).length + 3)),
        })),
      })
    } finally { setExporting(false) }
  }
  function exportCsv() {
    if (!rows.length) return
    const company = companyId || ''
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const lines = [
      ['Company', company], ['Report title', reportTitle], ['Period', period], ['Currency', 'MZN'], ['Filters', `Period=${period}`], [],
      columns, ...rows.map((row) => columns.map((column) => row[column] ?? '')),
    ].map((line) => line.map(escape).join(','))
    const href = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = href; link.download = `StockWise_${report}_${startDate}_${endDate}.csv`; link.click(); URL.revokeObjectURL(href)
  }
  async function exportPdf() {
    if (!companyId || !rows.length) return
    setExporting(true)
    try {
      const [{ default: jsPDF }, { default: autoTable }, company] = await Promise.all([import('jspdf'), import('jspdf-autotable'), loadCompanyExportHeader(companyId)])
      const doc = new jsPDF({ orientation: columns.length > 7 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(company.companyName, 12, 14)
      doc.setFontSize(13); doc.text(reportTitle, 12, 23)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`${period} · MZN`, 12, 30)
      autoTable(doc, { startY: 36, head: [columns.map(displayKey)], body: rows.map((row) => columns.map((column) => formatValue(column, row[column]))), styles: { fontSize: 7, cellPadding: 1.7, overflow: 'linebreak' }, headStyles: { fillColor: [1,69,88] }, alternateRowStyles: { fillColor: [248,250,252] }, margin: { left: 8, right: 8, bottom: 16 }, didDrawPage: ({ pageNumber }) => { doc.setFontSize(8); doc.text(company.footerNote || 'Generated by StockWise', 8, doc.internal.pageSize.getHeight() - 7); doc.text(`${pageNumber}`, pageWidth - 12, doc.internal.pageSize.getHeight() - 7, { align: 'right' }) } })
      doc.save(`StockWise_${report}_${startDate}_${endDate}.pdf`)
    } finally { setExporting(false) }
  }
  function printReport() {
    const popup = window.open('', '_blank', 'noopener,noreferrer')
    if (!popup) return
    popup.document.write(`<html><head><title>${reportTitle}</title><style>body{font:12px Arial;padding:24px;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:6px;text-align:left}th{background:#014558;color:#fff}h1{margin-bottom:4px}.meta{color:#4b5563;margin-bottom:18px}@page{margin:12mm}</style></head><body><h1>${reportTitle}</h1><div class="meta">${period} · MZN · Generated by StockWise</div><table><thead><tr>${columns.map((column) => `<th>${displayKey(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${formatValue(column,row[column])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`)
    popup.document.close(); popup.addEventListener('load', () => popup.print(), { once: true })
  }

  return <div className="app-page space-y-6">
    <div className="screen-intro"><div className="premium-label">OPS-1</div><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
    <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="space-y-4">
        {catalogue.map((group) => <Card key={group.group}><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm">{group.group === 'performance' ? <BarChart3 className="h-4 w-4" /> : group.group === 'inventory' ? <Boxes className="h-4 w-4" /> : group.group === 'partners' ? <UsersRound className="h-4 w-4" /> : <BriefcaseBusiness className="h-4 w-4" />}{copy.groups[group.group]}</CardTitle></CardHeader><CardContent className="grid gap-1">{group.reports.map((code) => <Button key={code} type="button" variant={report === code ? 'default' : 'ghost'} className="h-auto justify-start whitespace-normal py-2 text-left" onClick={() => setParams({ report: code })}>{copy.reports[code]}</Button>)}</CardContent></Card>)}
      </aside>
      <main className="min-w-0 space-y-4">
        <Card><CardHeader><CardTitle>{copy.reports[report]}</CardTitle><CardDescription>{copy.explanation}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><div><Label>{copy.start}</Label><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div><Label>{copy.end}</Label><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div><Button type="button" variant="outline" onClick={() => setReload((value) => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />{copy.refresh}</Button></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={exporting || !rows.length} onClick={() => void exportXlsx()}><Download className="mr-2 h-4 w-4" />XLSX</Button><Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={exportCsv}><FileText className="mr-2 h-4 w-4" />CSV</Button><Button type="button" size="sm" variant="outline" disabled={exporting || !rows.length} onClick={() => void exportPdf()}><Download className="mr-2 h-4 w-4" />PDF</Button><Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={printReport}><Printer className="mr-2 h-4 w-4" />Print</Button></div></CardContent></Card>
        {payload?.summary ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(payload.summary).filter(([key]) => ['sales','knownCogs','grossProfit','grossMargin','transactions','missingCostCount'].includes(key)).map(([key,value]) => <Card key={key}><CardHeader className="pb-2"><CardDescription>{displayKey(key)}</CardDescription></CardHeader><CardContent className="text-xl font-semibold">{formatValue(key,value)}</CardContent></Card>)}</div> : null}
        <Card className="overflow-hidden"><CardContent className="p-0">{loading ? <div className="p-8 text-center text-muted-foreground">{copy.loading}</div> : error ? <div className="p-8 text-center text-destructive">{error}</div> : !rows.length ? <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground"><PackageSearch className="h-8 w-8" />{copy.empty}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-muted/60"><tr>{columns.map((column) => <th key={column} className="px-4 py-3 text-left font-semibold">{displayKey(column)}</th>)}</tr></thead><tbody>{rows.map((row,index) => <tr key={String(row.id || row.itemId || row.serviceJobId || index)} className="border-t border-border/70">{columns.map((column) => <td key={column} className="px-4 py-3 align-top">{formatValue(column,row[column])}</td>)}</tr>)}</tbody></table></div>}</CardContent></Card>
      </main>
    </div>
  </div>
}
