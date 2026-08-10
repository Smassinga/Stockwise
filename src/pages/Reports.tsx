import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FileText, Printer, RefreshCw } from 'lucide-react'
import { PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { useOrg } from '../hooks/useOrg'
import { formatMoneyBase } from '../lib/currency'
import { exportExcelReport, loadCompanyExportHeader } from '../lib/excelExport'
import { useI18n } from '../lib/i18n'
import { formatOperationalQuantity } from '../lib/operationalQuantity'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

type ReportCode = 'performance' | 'product-profitability' | 'inventory-valuation' | 'stock-movement-ledger' | 'inventory-ageing' | 'customer-location' | 'supplier-payables' | 'service-job-profitability' | 'order-fulfilment'
type ReportGroup = 'performance' | 'inventory' | 'partners' | 'operations'
type ReportPayload = { rows?: Array<Record<string, unknown>>; summary?: Record<string, unknown>; trend?: Array<Record<string, unknown>>; asOf?: string; thresholdDays?: number; [key: string]: unknown }
type UomRow = { id: string; code: string; name: string }
type ExportFormat = 'xlsx' | 'csv' | 'pdf' | 'print'

const catalogue: Array<{ group: ReportGroup; reports: ReportCode[] }> = [
  { group: 'performance', reports: ['performance', 'product-profitability'] },
  { group: 'inventory', reports: ['inventory-valuation', 'stock-movement-ledger', 'inventory-ageing'] },
  { group: 'partners', reports: ['customer-location', 'supplier-payables'] },
  { group: 'operations', reports: ['service-job-profitability', 'order-fulfilment'] },
]

const periodReports = new Set<ReportCode>([
  'performance', 'product-profitability', 'stock-movement-ledger', 'customer-location',
  'supplier-payables', 'service-job-profitability', 'order-fulfilment',
])

const labels = {
  en: {
    title: 'Reports', report: 'Report', currentReport: 'Current report', start: 'Start date', end: 'End date', refresh: 'Refresh report',
    loading: 'Loading report', loadFailed: 'The report could not be loaded.', loadFailedHelp: 'Try again. If the problem continues, review the selected dates.', retry: 'Try again',
    invalidPeriod: 'Check the report period.', invalidPeriodHelp: 'The start date must be on or before the end date.',
    unavailable: 'Unavailable', currentSnapshot: 'Current snapshot', period: 'Period', currency: 'Currency', results: 'Results', row: 'row', rows: 'rows', metrics: 'metrics',
    noPeriodActivity: 'No activity was recorded in this period.', noSnapshotData: 'No current records are available for this report.',
    noFilterResults: 'No records match the selected collection status.', emptyHelp: 'Change the filters or choose another report.',
    exportScope: 'Exports use the report and filters shown here.', exportFailed: 'The export could not be prepared.', exportFailedHelp: 'Try the export again.',
    print: 'Print', preparing: 'Preparing', tableRegion: 'Scrollable report results', mobileTableHelp: 'Scroll the table horizontally to review every column.',
    scope: 'Report scope', summary: 'Report summary', collectionStatus: 'Collection status', all: 'All',
    snapshotNote: 'This is a current stock snapshot, not activity for a date range.',
    ageingNote: 'Slow-moving status uses the report threshold shown below and the current stock position.',
    costNote: 'Missing cost remains unavailable; it is not treated as zero.',
    groups: { performance: 'Performance', inventory: 'Inventory', partners: 'Customers and suppliers', operations: 'Operations' },
    reports: { performance: 'Operational performance', 'product-profitability': 'Product profitability', 'inventory-valuation': 'Inventory valuation', 'stock-movement-ledger': 'Stock movement ledger', 'inventory-ageing': 'Inventory ageing and slow-moving stock', 'customer-location': 'Customer performance and receivables', 'supplier-payables': 'Supplier spend and payables', 'service-job-profitability': 'Service Job profitability', 'order-fulfilment': 'Order fulfilment' },
  },
  pt: {
    title: 'Relatórios', report: 'Relatório', currentReport: 'Relatório actual', start: 'Data de início', end: 'Data de fim', refresh: 'Actualizar relatório',
    loading: 'A carregar o relatório', loadFailed: 'Não foi possível carregar o relatório.', loadFailedHelp: 'Tente novamente. Se o problema continuar, reveja as datas seleccionadas.', retry: 'Tentar novamente',
    invalidPeriod: 'Verifique o período do relatório.', invalidPeriodHelp: 'A data de início deve ser anterior ou igual à data de fim.',
    unavailable: 'Indisponível', currentSnapshot: 'Situação actual', period: 'Período', currency: 'Moeda', results: 'Resultados', row: 'linha', rows: 'linhas', metrics: 'métricas',
    noPeriodActivity: 'Não foi registada actividade neste período.', noSnapshotData: 'Não existem registos actuais para este relatório.',
    noFilterResults: 'Nenhum registo corresponde ao estado de cobrança seleccionado.', emptyHelp: 'Altere os filtros ou escolha outro relatório.',
    exportScope: 'As exportações usam o relatório e os filtros apresentados aqui.', exportFailed: 'Não foi possível preparar a exportação.', exportFailedHelp: 'Tente exportar novamente.',
    print: 'Imprimir', preparing: 'A preparar', tableRegion: 'Resultados do relatório com deslocamento horizontal', mobileTableHelp: 'Deslize a tabela na horizontal para consultar todas as colunas.',
    scope: 'Âmbito do relatório', summary: 'Resumo do relatório', collectionStatus: 'Estado da cobrança', all: 'Todos',
    snapshotNote: 'Esta é a situação actual do stock, não a actividade de um intervalo de datas.',
    ageingNote: 'O estado de baixa rotação usa o limite indicado abaixo e a situação actual do stock.',
    costNote: 'O custo em falta permanece indisponível; não é tratado como zero.',
    groups: { performance: 'Desempenho', inventory: 'Inventário', partners: 'Clientes e fornecedores', operations: 'Operações' },
    reports: { performance: 'Desempenho operacional', 'product-profitability': 'Rentabilidade por produto', 'inventory-valuation': 'Valorização do inventário', 'stock-movement-ledger': 'Razão de movimentos de stock', 'inventory-ageing': 'Antiguidade e stock de baixa rotação', 'customer-location': 'Desempenho de clientes e contas a receber', 'supplier-payables': 'Compras a fornecedores e contas a pagar', 'service-job-profitability': 'Rentabilidade dos Trabalhos de Serviço', 'order-fulfilment': 'Cumprimento de ordens' },
  },
} as const

const fieldLabels: Record<'en' | 'pt', Record<string, string>> = {
  en: {
    date: 'Date', sales: 'Operational sales', knownCogs: 'COGS', grossProfit: 'Gross profit', grossMargin: 'Gross margin', transactions: 'Transactions', missingCostCount: 'Missing cost count',
    name: 'Product or service', sku: 'SKU', quantity: 'Quantity', baseUom: 'Base UoM', revenue: 'Operational sales',
    item: 'Item', warehouse: 'Warehouse', bin: 'Bin', uom: 'UoM', weightedAverageCost: 'Weighted-average cost', inventoryValue: 'Inventory value', missingCost: 'Missing cost',
    occurredAt: 'Date and time', movementKind: 'Movement kind', baseQuantity: 'Base quantity', warehouseFrom: 'Warehouse from', binFrom: 'Bin from', warehouseTo: 'Warehouse to', binTo: 'Bin to', unitCost: 'Unit cost', totalCost: 'Total cost', referenceType: 'Reference type', reference: 'Reference', actor: 'Actor',
    lastSaleOrIssueAt: 'Last sale or issue', daysWithoutMovement: 'Days without movement', slowMoving: 'Slow-moving', stockStatus: 'Stock status',
    customer: 'Customer', customerLocation: 'Customer location', operationalLocation: 'Operational location', cashActivity: 'Cash/walk-in activity', operationalSales: 'Operational sales', outstandingBalance: 'Outstanding balance', overdueBalance: 'Overdue balance', lastCompletedPurchase: 'Last completed purchase',
    collectionStatus: 'Collection status', collectionOwner: 'Collection owner', nextActionAt: 'Next action', promiseDate: 'Promise date', promisedAmount: 'Promised amount', promiseStatus: 'Promise status', disputeCategory: 'Dispute category', daysOverdue: 'Days overdue', lastReminderStage: 'Last reminder stage', lastReminderAcceptedAt: 'Last reminder accepted',
    supplier: 'Supplier', supplierLocation: 'Supplier location', vendorBillValue: 'Vendor Bill value', paidAmount: 'Paid amount', outstandingAmount: 'Outstanding amount', overdueAmount: 'Overdue amount', lastBillDate: 'Last bill date', purchaseOrderValue: 'Purchase Order value',
    serviceJob: 'Service Job', service: 'Service', completionDate: 'Completion date', materials: 'Materials', labour: 'Labour', subcontractors: 'Subcontractors', supplierAllocations: 'Supplier allocations', otherDirectCost: 'Other direct cost', totalActualCost: 'Total actual cost', costingState: 'Costing state',
    submitted: 'Submitted', confirmed: 'Confirmed', allocated: 'Allocated', shippedCompleted: 'Shipped/completed', closed: 'Closed', cancelled: 'Cancelled', openBacklog: 'Open backlog', completionRate: 'Completion rate', averageFulfilmentDays: 'Average fulfilment duration (days)', overdueOrders: 'Overdue orders', thresholdDays: 'Slow-moving threshold',
  },
  pt: {
    date: 'Data', sales: 'Vendas operacionais', knownCogs: 'Custo das vendas', grossProfit: 'Lucro bruto', grossMargin: 'Margem bruta', transactions: 'Transacções', missingCostCount: 'Custos em falta',
    name: 'Produto ou serviço', sku: 'SKU', quantity: 'Quantidade', baseUom: 'UdM base', revenue: 'Vendas operacionais',
    item: 'Artigo', warehouse: 'Armazém', bin: 'Localização', uom: 'UdM', weightedAverageCost: 'Custo médio ponderado', inventoryValue: 'Valor do inventário', missingCost: 'Custo em falta',
    occurredAt: 'Data e hora', movementKind: 'Tipo de movimento', baseQuantity: 'Quantidade base', warehouseFrom: 'Armazém de origem', binFrom: 'Localização de origem', warehouseTo: 'Armazém de destino', binTo: 'Localização de destino', unitCost: 'Custo unitário', totalCost: 'Custo total', referenceType: 'Tipo de referência', reference: 'Referência', actor: 'Responsável',
    lastSaleOrIssueAt: 'Última venda ou saída', daysWithoutMovement: 'Dias sem movimento', slowMoving: 'Baixa rotação', stockStatus: 'Estado do stock',
    customer: 'Cliente', customerLocation: 'Localização do cliente', operationalLocation: 'Localização operacional', cashActivity: 'Actividade a dinheiro/cliente ocasional', operationalSales: 'Vendas operacionais', outstandingBalance: 'Saldo em aberto', overdueBalance: 'Saldo vencido', lastCompletedPurchase: 'Última compra concluída',
    collectionStatus: 'Estado da cobrança', collectionOwner: 'Responsável pela cobrança', nextActionAt: 'Próxima acção', promiseDate: 'Data da promessa', promisedAmount: 'Valor prometido', promiseStatus: 'Estado da promessa', disputeCategory: 'Categoria da reclamação', daysOverdue: 'Dias em atraso', lastReminderStage: 'Última etapa do lembrete', lastReminderAcceptedAt: 'Último lembrete aceite',
    supplier: 'Fornecedor', supplierLocation: 'Localização do fornecedor', vendorBillValue: 'Valor das faturas de fornecedor', paidAmount: 'Valor pago', outstandingAmount: 'Valor em aberto', overdueAmount: 'Valor vencido', lastBillDate: 'Data da última fatura', purchaseOrderValue: 'Valor das ordens de compra',
    serviceJob: 'Trabalho de Serviço', service: 'Serviço', completionDate: 'Data de conclusão', materials: 'Materiais', labour: 'Mão de obra', subcontractors: 'Subcontratados', supplierAllocations: 'Alocações de fornecedores', otherDirectCost: 'Outros custos directos', totalActualCost: 'Custo real total', costingState: 'Estado do custeio',
    submitted: 'Submetidas', confirmed: 'Confirmadas', allocated: 'Alocadas', shippedCompleted: 'Expedidas/concluídas', closed: 'Encerradas', cancelled: 'Canceladas', openBacklog: 'Pendentes em aberto', completionRate: 'Taxa de conclusão', averageFulfilmentDays: 'Duração média de cumprimento (dias)', overdueOrders: 'Ordens vencidas', thresholdDays: 'Limite de baixa rotação',
  },
}

const moneyFields = new Set([
  'sales', 'knownCogs', 'grossProfit', 'revenue', 'weightedAverageCost', 'inventoryValue', 'unitCost', 'totalCost',
  'operationalSales', 'outstandingBalance', 'overdueBalance', 'vendorBillValue', 'paidAmount', 'outstandingAmount',
  'overdueAmount', 'purchaseOrderValue', 'materials', 'labour', 'subcontractors', 'supplierAllocations', 'otherDirectCost', 'totalActualCost', 'promisedAmount',
])
const percentageFields = new Set(['grossMargin', 'completionRate'])
const quantityFields = new Set(['quantity', 'baseQuantity'])
const numericFields = new Set(['quantity', 'baseQuantity', 'daysWithoutMovement', 'daysOverdue', 'transactions', 'missingCostCount', 'averageFulfilmentDays', 'overdueOrders', 'submitted', 'confirmed', 'allocated', 'shippedCompleted', 'closed', 'cancelled', 'openBacklog'])
const dateFields = new Set(['date', 'occurredAt', 'lastSaleOrIssueAt', 'lastCompletedPurchase', 'lastBillDate', 'completionDate', 'nextActionAt', 'promiseDate', 'lastReminderAcceptedAt'])
const uomFields = new Set(['baseUom', 'uom'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const summaryFields = ['sales', 'knownCogs', 'grossProfit', 'grossMargin', 'transactions', 'missingCostCount']
const reportColumnOrder: Record<ReportCode, string[]> = {
  performance: ['date', 'sales', 'knownCogs', 'grossProfit', 'missingCostCount'],
  'product-profitability': ['name', 'sku', 'quantity', 'baseUom', 'revenue', 'knownCogs', 'grossProfit', 'grossMargin', 'missingCostCount'],
  'inventory-valuation': ['item', 'sku', 'warehouse', 'bin', 'quantity', 'uom', 'weightedAverageCost', 'inventoryValue', 'missingCost'],
  'stock-movement-ledger': ['occurredAt', 'movementKind', 'item', 'sku', 'quantity', 'baseQuantity', 'uom', 'warehouseFrom', 'binFrom', 'warehouseTo', 'binTo', 'unitCost', 'totalCost', 'referenceType', 'reference', 'actor'],
  'inventory-ageing': ['item', 'sku', 'warehouse', 'quantity', 'inventoryValue', 'lastSaleOrIssueAt', 'daysWithoutMovement', 'slowMoving', 'stockStatus'],
  'customer-location': ['customer', 'customerLocation', 'operationalLocation', 'cashActivity', 'transactions', 'operationalSales', 'knownCogs', 'grossProfit', 'grossMargin', 'missingCostCount', 'outstandingBalance', 'overdueBalance', 'lastCompletedPurchase', 'collectionStatus', 'collectionOwner', 'nextActionAt', 'promiseDate', 'promisedAmount', 'promiseStatus', 'disputeCategory', 'daysOverdue', 'lastReminderStage', 'lastReminderAcceptedAt'],
  'supplier-payables': ['supplier', 'supplierLocation', 'vendorBillValue', 'paidAmount', 'outstandingAmount', 'overdueAmount', 'lastBillDate', 'purchaseOrderValue'],
  'service-job-profitability': ['serviceJob', 'customer', 'service', 'completionDate', 'materials', 'labour', 'subcontractors', 'supplierAllocations', 'otherDirectCost', 'totalActualCost', 'operationalSales', 'grossProfit', 'costingState'],
  'order-fulfilment': ['submitted', 'confirmed', 'allocated', 'shippedCompleted', 'closed', 'cancelled', 'openBacklog', 'completionRate', 'averageFulfilmentDays', 'overdueOrders'],
}
const enumLabels: Record<'en' | 'pt', Record<string, string>> = {
  en: { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock', open: 'Open', finalised: 'Finalised', reopened: 'Reopened', active: 'Automatic reminders active', paused: 'Paused', disputed: 'Disputed', promise_to_pay: 'Promise to pay', manual_follow_up: 'Manual follow-up', closed: 'Closed', kept: 'Kept', partially_kept: 'Partially kept', broken: 'Broken', issue: 'Issue', receive: 'Receipt', transfer: 'Transfer', adjust: 'Adjustment' },
  pt: { in_stock: 'Em stock', low_stock: 'Stock baixo', out_of_stock: 'Sem stock', open: 'Aberto', finalised: 'Finalizado', reopened: 'Reaberto', active: 'Lembretes automáticos activos', paused: 'Suspenso', disputed: 'Em reclamação', promise_to_pay: 'Promessa de pagamento', manual_follow_up: 'Acompanhamento manual', closed: 'Encerrado', kept: 'Cumprida', partially_kept: 'Parcialmente cumprida', broken: 'Não cumprida', issue: 'Saída', receive: 'Entrada', transfer: 'Transferência', adjust: 'Ajuste' },
}
const backendTextLabels: Record<'en' | 'pt', Record<string, string>> = {
  en: { 'Cash Customer': 'Cash customer', 'Walk-in / cash customer': 'Walk-in / cash customer', 'No location': 'No location' },
  pt: { 'Cash Customer': 'Cliente a dinheiro', 'Walk-in / cash customer': 'Cliente ocasional / a dinheiro', 'No location': 'Sem local' },
}

function isoDaysAgo(days: number) { const date = new Date(); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10) }
function today() { return new Date().toISOString().slice(0, 10) }
function fallbackDisplayKey(key: string) { return key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase()) }
function escapeHtml(value: unknown) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!) }

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
  const [loadFailed, setLoadFailed] = useState(false)
  const [reload, setReload] = useState(0)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [exportFailed, setExportFailed] = useState(false)
  const [uoms, setUoms] = useState<UomRow[]>([])
  const [collectionFilter, setCollectionFilter] = useState('all')
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const isPeriodReport = periodReports.has(report)
  const periodInvalid = isPeriodReport && (!startDate || !endDate || startDate > endDate)

  useEffect(() => {
    let cancelled = false
    supabase.from('uoms').select('id,code,name').order('code').then(({ data }) => {
      if (!cancelled) setUoms((data || []) as UomRow[])
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!companyId || periodInvalid) {
      setPayload(null)
      setLoading(false)
      setLoadFailed(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setPayload(null)
    setExportFailed(false)
    supabase.rpc('get_operational_report', {
      p_company_id: companyId, p_report_code: report, p_start_date: startDate, p_end_date: endDate,
      p_warehouse_id: null, p_customer_id: null, p_include_cash: true, p_slow_days: 90,
    }).then(({ data, error: rpcError }) => {
      if (cancelled) return
      setLoading(false)
      if (rpcError) {
        console.error('[Reports] Report request failed', { report, rpcError })
        setLoadFailed(true)
        return
      }
      setPayload((data || {}) as ReportPayload)
      setLoadedAt(new Date())
    })
    return () => { cancelled = true }
  }, [companyId, endDate, periodInvalid, reload, report, startDate])

  const sourceRows = useMemo(() => {
    if (!payload) return []
    if (payload.rows) return payload.rows
    if (report === 'performance') return payload.trend || []
    if (report === 'order-fulfilment') {
      const activityKeys = ['submitted', 'confirmed', 'allocated', 'shippedCompleted', 'closed', 'cancelled']
      return activityKeys.some((key) => Number(payload[key] || 0) > 0) ? [payload] : []
    }
    return []
  }, [payload, report])
  const rows = useMemo(() => {
    if (report !== 'customer-location' || collectionFilter === 'all') return sourceRows
    const currentDay = today()
    return sourceRows.filter((row) => {
      if (collectionFilter === 'promise_due_today') return row.promiseDate === currentDay && row.promiseStatus === 'open'
      if (collectionFilter === 'broken_promise') return row.promiseStatus === 'broken'
      if (collectionFilter === 'follow_up_overdue') return Boolean(row.nextActionAt && String(row.nextActionAt) < new Date().toISOString())
      return row.collectionStatus === collectionFilter
    })
  }, [collectionFilter, report, sourceRows])
  const columns = useMemo(() => {
    const keys = new Set<string>()
    rows.slice(0, 30).forEach((row) => Object.keys(row).forEach((key) => { if (!key.toLowerCase().endsWith('id') && key !== 'asOf' && key !== 'thresholdDays') keys.add(key) }))
    const preferred = reportColumnOrder[report].filter((key) => keys.has(key))
    const remaining = [...keys].filter((key) => !preferred.includes(key)).sort()
    return [...preferred, ...remaining]
  }, [report, rows])
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const uomById = useMemo(() => new Map(uoms.map((uom) => [uom.id, uom.code])), [uoms])
  const displayKey = (key: string) => fieldLabels[lang][key] || fallbackDisplayKey(key)
  const collectionOptions = useMemo(() => [
    ['all', copy.all], ['active', enumLabels[lang].active], ['paused', enumLabels[lang].paused], ['disputed', enumLabels[lang].disputed],
    ['promise_to_pay', enumLabels[lang].promise_to_pay], ['manual_follow_up', enumLabels[lang].manual_follow_up],
    ['promise_due_today', lang === 'pt' ? 'Promessa vence hoje' : 'Promise due today'], ['broken_promise', lang === 'pt' ? 'Promessa não cumprida' : 'Broken promise'],
    ['follow_up_overdue', lang === 'pt' ? 'Acompanhamento em atraso' : 'Follow-up overdue'],
  ] as Array<[string, string]>, [copy.all, lang])
  const activeCollectionLabel = collectionOptions.find(([value]) => value === collectionFilter)?.[1] || copy.all

  const resolvedValue = (key: string, value: unknown) => {
    if (typeof value !== 'string') return value
    if (uomFields.has(key)) return uomById.get(value) || (uuidPattern.test(value) ? null : value)
    if (backendTextLabels[lang][value]) return backendTextLabels[lang][value]
    if (key === 'movementKind') return enumLabels[lang][value] || fallbackDisplayKey(value)
    if (key === 'stockStatus' || key === 'costingState') return enumLabels[lang][value] || fallbackDisplayKey(value)
    if (key === 'collectionStatus' || key === 'promiseStatus') return enumLabels[lang][value] || fallbackDisplayKey(value)
    return value
  }
  const formatDate = (value: string | Date, includeTime = false) => {
    const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value)
    if (Number.isNaN(date.getTime())) return String(value)
    return new Intl.DateTimeFormat(locale, includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date)
  }
  const formatValue = (key: string, input: unknown) => {
    const value = resolvedValue(key, input)
    if (value == null) return copy.unavailable
    if (typeof value === 'boolean') return value ? (lang === 'pt' ? 'Sim' : 'Yes') : (lang === 'pt' ? 'Não' : 'No')
    if (typeof value === 'number' && moneyFields.has(key)) return formatMoneyBase(value, 'MZN', locale)
    if (typeof value === 'number' && quantityFields.has(key)) return formatOperationalQuantity(value, locale)
    if (typeof value === 'number' && percentageFields.has(key)) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%`
    if (typeof value === 'number') return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
    if (typeof value === 'string' && dateFields.has(key)) return formatDate(value, key === 'occurredAt' || key === 'nextActionAt' || key === 'lastReminderAcceptedAt')
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  const reportTitle = copy.reports[report]
  const period = `${formatDate(startDate)} – ${formatDate(endDate)}`
  const snapshotAt = report === 'inventory-valuation' && payload?.asOf ? formatDate(payload.asOf, true) : loadedAt ? formatDate(loadedAt, true) : copy.currentSnapshot
  const scopeLabel = isPeriodReport ? period : `${copy.currentSnapshot} · ${snapshotAt}`
  const filterLines = [
    `${copy.report}: ${reportTitle}`,
    isPeriodReport ? `${copy.period}: ${period}` : `${copy.currentSnapshot}: ${snapshotAt}`,
    `${copy.currency}: MZN`,
    ...(report === 'customer-location' ? [`${copy.collectionStatus}: ${activeCollectionLabel}`] : []),
  ]
  const summaryEntries = payload?.summary && rows.length > 0
    ? Object.entries(payload.summary).filter(([key]) => summaryFields.includes(key))
    : report === 'order-fulfilment' && payload && rows.length > 0
      ? reportColumnOrder[report].filter((key) => key in payload).map((key) => [key, payload[key]] as [string, unknown])
      : []
  const resultCountLabel = report === 'order-fulfilment'
    ? `${summaryEntries.length} ${copy.metrics}`
    : `${rows.length} ${rows.length === 1 ? copy.row : copy.rows}`
  const isNumericColumn = (column: string) => moneyFields.has(column) || percentageFields.has(column) || numericFields.has(column) || typeof rows[0]?.[column] === 'number'
  const rowKey = (row: Record<string, unknown>, index: number) => [
    row.id, row.itemId, row.serviceJobId, row.customerId, row.supplierId,
    row.warehouseId, row.binId, row.date, row.occurredAt, index,
  ].filter((value) => value != null && value !== '').map(String).join(':')

  function handleReportChange(nextReport: ReportCode) {
    const next = new URLSearchParams(params)
    next.set('report', nextReport)
    setParams(next)
  }

  async function runExport(format: ExportFormat, action: () => Promise<void>) {
    setExporting(format)
    setExportFailed(false)
    try {
      await action()
    } catch (error) {
      console.error(`[Reports] ${format} export failed`, error)
      setExportFailed(true)
    } finally {
      setExporting(null)
    }
  }

  async function exportXlsx() {
    if (!companyId || !rows.length) return
    await runExport('xlsx', async () => {
      const company = await loadCompanyExportHeader(companyId)
      await exportExcelReport<Record<string, unknown>>({
        filename: `StockWise_${report}_${startDate}_${endDate}.xlsx`, sheetName: reportTitle, title: reportTitle,
        subtitle: scopeLabel, reportCode: report, reportingPeriod: scopeLabel, displayCurrency: 'MZN', company,
        filters: filterLines, rows,
        columns: columns.map((column) => ({
          label: displayKey(column), value: (row) => resolvedValue(column, row[column]) as string | number | null | undefined,
          type: moneyFields.has(column) ? 'currency' : typeof rows[0]?.[column] === 'number' ? 'number' : 'text',
          width: Math.min(38, Math.max(14, displayKey(column).length + 3)),
        })),
      })
    })
  }

  async function exportCsv() {
    if (!companyId || !rows.length) return
    await runExport('csv', async () => {
      const company = await loadCompanyExportHeader(companyId)
      const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
      const lines = [
        [lang === 'pt' ? 'Empresa' : 'Company', company.companyName],
        ...filterLines.map((line) => [line]),
        [], columns.map(displayKey),
        ...rows.map((row) => columns.map((column) => resolvedValue(column, row[column]) ?? copy.unavailable)),
      ].map((line) => line.map(escape).join(','))
      const href = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = href
      link.download = `StockWise_${report}_${startDate}_${endDate}.csv`
      link.click()
      URL.revokeObjectURL(href)
    })
  }

  async function exportPdf() {
    if (!companyId || !rows.length) return
    await runExport('pdf', async () => {
      const [{ default: jsPDF }, { default: autoTable }, company] = await Promise.all([import('jspdf'), import('jspdf-autotable'), loadCompanyExportHeader(companyId)])
      const doc = new jsPDF({ orientation: columns.length > 7 ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(company.companyName, 12, 14)
      doc.setFontSize(13); doc.text(reportTitle, 12, 23)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`${scopeLabel} · MZN`, 12, 30)
      autoTable(doc, { startY: 36, head: [columns.map(displayKey)], body: rows.map((row) => columns.map((column) => formatValue(column, row[column]))), styles: { fontSize: 7, cellPadding: 1.7, overflow: 'linebreak' }, headStyles: { fillColor: [1, 69, 88] }, alternateRowStyles: { fillColor: [248, 250, 252] }, margin: { left: 8, right: 8, bottom: 16 }, didDrawPage: ({ pageNumber }: { pageNumber: number }) => { doc.setFontSize(8); doc.text(company.footerNote || 'Generated by StockWise', 8, doc.internal.pageSize.getHeight() - 7); doc.text(`${pageNumber}`, pageWidth - 12, doc.internal.pageSize.getHeight() - 7, { align: 'right' }) } })
      doc.save(`StockWise_${report}_${startDate}_${endDate}.pdf`)
    })
  }

  async function printReport() {
    if (!companyId || !rows.length) return
    const popup = window.open('', '_blank', 'noopener,noreferrer')
    if (!popup) {
      setExportFailed(true)
      return
    }
    await runExport('print', async () => {
      const company = await loadCompanyExportHeader(companyId)
      popup.document.write(`<html><head><title>${escapeHtml(reportTitle)}</title><style>body{font:12px Arial;padding:24px;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:6px;text-align:left}th{background:#014558;color:#fff}h1{margin-bottom:4px}.meta{color:#4b5563;margin-bottom:18px}@page{margin:12mm}</style></head><body><h1>${escapeHtml(company.companyName)}</h1><h2>${escapeHtml(reportTitle)}</h2><div class="meta">${escapeHtml(scopeLabel)} · MZN · StockWise</div><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(displayKey(column))}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(formatValue(column, row[column]))}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`)
      popup.document.close()
      popup.addEventListener('load', () => popup.print(), { once: true })
    })
  }

  const emptyTitle = report === 'customer-location' && collectionFilter !== 'all' && sourceRows.length > 0
    ? copy.noFilterResults
    : isPeriodReport ? copy.noPeriodActivity : copy.noSnapshotData

  return (
    <div className="app-page app-page--analytics">
      <PremiumRegisterHeader title={copy.title} />

      <div className="grid min-w-0 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:gap-8">
        <aside className="hidden lg:block">
          <nav aria-label={copy.report} className="border-y border-border py-2">
            {catalogue.map((group, groupIndex) => (
              <section key={group.group} aria-labelledby={`report-group-${group.group}`} className={cn('py-4', groupIndex > 0 && 'border-t border-border')}>
                <h2 id={`report-group-${group.group}`} className="px-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{copy.groups[group.group]}</h2>
                <div className="mt-2 grid gap-1">
                  {group.reports.map((code) => (
                    <Button
                      key={code}
                      type="button"
                      variant="ghost"
                      aria-current={report === code ? 'page' : undefined}
                      className={cn('h-auto min-h-10 justify-start whitespace-normal rounded-none border-l-2 border-transparent px-3 py-2 text-left leading-5', report === code && 'border-primary bg-surface-muted text-foreground')}
                      onClick={() => handleReportChange(code)}
                    >
                      {copy.reports[code]}
                    </Button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 space-y-6">
          <div className="lg:hidden">
            <Label htmlFor="mobile-report-selector">{copy.report}</Label>
            <Select value={report} onValueChange={(value) => handleReportChange(value as ReportCode)}>
              <SelectTrigger id="mobile-report-selector" className="mt-2 min-h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {catalogue.flatMap((group) => group.reports.map((code) => <SelectItem key={code} value={code}>{copy.reports[code]}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <section aria-labelledby="current-report-heading" className="space-y-5">
            <div>
              <h2 id="current-report-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">{reportTitle}</h2>
              {report === 'inventory-valuation' ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{copy.snapshotNote}</p> : null}
              {report === 'inventory-ageing' ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{copy.ageingNote}</p> : null}
              {(report === 'performance' || report === 'product-profitability') ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{copy.costNote}</p> : null}
            </div>

            <div className="border-y border-border py-4">
              <div className={cn('grid gap-4', isPeriodReport && 'sm:grid-cols-2 sm:items-end xl:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_auto]')}>
                {isPeriodReport ? (
                  <>
                    <div>
                      <Label htmlFor="report-start-date">{copy.start}</Label>
                      <Input id="report-start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-invalid={periodInvalid} className="mt-2 min-h-11" />
                    </div>
                    <div>
                      <Label htmlFor="report-end-date">{copy.end}</Label>
                      <Input id="report-end-date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} aria-invalid={periodInvalid} className="mt-2 min-h-11" />
                    </div>
                  </>
                ) : null}
                <Button type="button" variant="outline" className={cn('min-h-11', isPeriodReport && 'sm:col-span-2 sm:w-fit xl:col-span-1', !isPeriodReport && 'w-fit')} disabled={loading || periodInvalid} onClick={() => setReload((value) => value + 1)}>
                  <RefreshCw className={cn(loading && 'motion-safe:animate-spin')} />{copy.refresh}
                </Button>
              </div>

              {report === 'customer-location' ? (
                <div className="mt-4 max-w-sm">
                  <Label htmlFor="collection-status-filter">{copy.collectionStatus}</Label>
                  <Select value={collectionFilter} onValueChange={setCollectionFilter}>
                    <SelectTrigger id="collection-status-filter" className="mt-2 min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {collectionOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          </section>

          {periodInvalid ? (
            <PremiumStatePanel kind="warning" title={copy.invalidPeriod} description={copy.invalidPeriodHelp} />
          ) : (
            <>
              <section aria-label={copy.scope} className="border-b border-border pb-5">
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div><dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{isPeriodReport ? copy.period : copy.currentSnapshot}</dt><dd className="mt-1 break-words text-sm font-medium">{isPeriodReport ? period : snapshotAt}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{copy.currency}</dt><dd className="mt-1 text-sm font-medium">MZN</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{copy.results}</dt><dd className="mt-1 text-sm font-medium tabular-nums">{loading ? '—' : resultCountLabel}</dd></div>
                  {report === 'customer-location' ? <div><dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{copy.collectionStatus}</dt><dd className="mt-1 break-words text-sm font-medium">{activeCollectionLabel}</dd></div> : null}
                  {report === 'inventory-ageing' ? <div><dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{displayKey('thresholdDays')}</dt><dd className="mt-1 text-sm font-medium tabular-nums">{payload?.thresholdDays ?? 90} {lang === 'pt' ? 'dias' : 'days'}</dd></div> : null}
                </dl>
              </section>

              {loading ? (
                <div className="space-y-4" aria-label={copy.loading}>
                  {(report === 'performance' || report === 'product-profitability' || report === 'order-fulfilment') ? <PremiumSkeleton variant="summary" lines={2} label={copy.loading} /> : null}
                  <PremiumSkeleton variant="table" rows={6} label={copy.loading} />
                </div>
              ) : loadFailed ? (
                <PremiumStatePanel kind="error" title={copy.loadFailed} description={copy.loadFailedHelp} action={<Button type="button" variant="outline" onClick={() => setReload((value) => value + 1)}>{copy.retry}</Button>} />
              ) : (
                <>
                  {summaryEntries.length > 0 ? (
                    <section aria-label={copy.summary} className="border-y border-border">
                      <dl className="grid sm:grid-cols-2 xl:grid-cols-3">
                        {summaryEntries.map(([key, value]) => (
                          <div key={key} className="min-w-0 border-b border-border py-4 sm:border-l sm:px-5 sm:first:border-l-0 sm:first:pl-0 xl:[&:nth-child(3n+1)]:border-l-0 xl:[&:nth-child(3n+1)]:pl-0">
                            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{displayKey(key)}</dt>
                            <dd className="mt-2 break-words text-xl font-semibold tracking-tight tabular-nums">{formatValue(key, value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ) : null}

                  {exportFailed ? <PremiumStatePanel kind="error" compact title={copy.exportFailed} description={copy.exportFailedHelp} /> : null}

                  {rows.length > 0 ? (
                    <section aria-label={lang === 'pt' ? 'Exportar relatório' : 'Export report'} className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs leading-5 text-muted-foreground">{copy.exportScope}</p>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                        <Button type="button" size="sm" variant="outline" disabled={Boolean(exporting)} onClick={() => void exportXlsx()}><Download />{exporting === 'xlsx' ? `${copy.preparing} XLSX…` : 'XLSX'}</Button>
                        <Button type="button" size="sm" variant="outline" disabled={Boolean(exporting)} onClick={() => void exportCsv()}><FileText />{exporting === 'csv' ? `${copy.preparing} CSV…` : 'CSV'}</Button>
                        <Button type="button" size="sm" variant="outline" disabled={Boolean(exporting)} onClick={() => void exportPdf()}><Download />{exporting === 'pdf' ? `${copy.preparing} PDF…` : 'PDF'}</Button>
                        <Button type="button" size="sm" variant="outline" disabled={Boolean(exporting)} onClick={() => void printReport()}><Printer />{exporting === 'print' ? `${copy.preparing}…` : copy.print}</Button>
                      </div>
                    </section>
                  ) : null}

                  {!rows.length ? (
                    <PremiumStatePanel kind="empty" title={emptyTitle} description={copy.emptyHelp} />
                  ) : report === 'order-fulfilment' ? null : (
                    <section>
                      <p className="mb-2 text-xs text-muted-foreground sm:hidden">{copy.mobileTableHelp}</p>
                      <div className="max-w-full overflow-x-auto border-y border-border" role="region" aria-label={copy.tableRegion} tabIndex={0}>
                        <table className="w-full min-w-[760px] text-sm">
                          <caption className="sr-only">{reportTitle}. {scopeLabel}.</caption>
                          <thead><tr>{columns.map((column) => <th key={column} scope="col" className={cn(isNumericColumn(column) && 'text-right')}>{displayKey(column)}</th>)}</tr></thead>
                          <tbody>
                            {rows.map((row, index) => (
                              <tr key={rowKey(row, index)}>
                                {columns.map((column) => <td key={column} className={cn('align-top', isNumericColumn(column) && 'text-right font-mono tabular-nums')}>{formatValue(column, row[column])}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
