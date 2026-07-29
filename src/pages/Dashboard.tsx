import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, Calendar, RefreshCw } from 'lucide-react'
import { ChartLineUpIcon } from '@phosphor-icons/react/dist/csr/ChartLineUp'
import { CoinsIcon } from '@phosphor-icons/react/dist/csr/Coins'
import { PackageIcon } from '@phosphor-icons/react/dist/csr/Package'
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning'
import { supabase } from '../lib/supabase'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { useOrg } from '../hooks/useOrg'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import {
  dashboardAverageTransaction,
  dashboardPeriodRange,
  type DashboardPeriodPreset,
} from '../lib/dashboardMetrics'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { PremiumChartCard } from '../components/premium/PremiumChartCard'
import { PremiumEmptyState, PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumMetricCard } from '../components/premium/PremiumMetricCard'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { PremiumSection } from '../components/premium/PremiumSection'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'

type Warehouse = { id: string; name: string }
type Summary = {
  sales: number; transactions: number; posTransactions: number; knownCogs: number; missingCostCount: number
  grossProfit: number | null; grossMargin: number | null; completionRate: number | null
  eligible: number; eligibleCompleted: number; previousSales: number; previousTransactions: number
  previousCompletionRate: number | null; openOrders: number; openSubmitted: number
  openConfirmed: number; openAllocated: number
}
type Inventory = { value: number; missing_cost_count: number; out_of_stock: number; low_stock: number; missing_minimum: number }
type Product = {
  itemId: string; name: string; sku: string | null; baseUom: string | null; revenue: number
  quantity: number; knownCogs: number; grossProfit: number | null; missingCostCount: number
}
type CustomerSummary = {
  active: number; new: number; repeat: number
  top: { id: string; name: string; sales: number } | null
}
type Trend = { date: string; sales: number; knownCogs: number; grossProfit: number | null; missingCostCount: number }
type DashboardData = { summary: Summary; inventory: Inventory; products: Product[]; customers: CustomerSummary; trend: Trend[] }
type Ranking = 'revenue' | 'quantity' | 'grossProfit'

const validPeriod = (value: string | null): DashboardPeriodPreset =>
  value === 'week' || value === 'month' || value === 'custom' ? value : 'today'
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0

export default function Dashboard() {
  const { t, lang } = useI18n()
  const { companyId, companyName } = useOrg()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)
  const [baseCode, setBaseCode] = useState('MZN')
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dailyOpen, setDailyOpen] = useState(false)
  const [ranking, setRanking] = useState<Ranking>('revenue')
  const [revision, setRevision] = useState(0)

  const period = validPeriod(params.get('period'))
  const warehouse = params.get('warehouse') || 'all'
  const appliedStart = params.get('start') || ''
  const appliedEnd = params.get('end') || ''
  const [draftStart, setDraftStart] = useState(appliedStart)
  const [draftEnd, setDraftEnd] = useState(appliedEnd)
  const range = useMemo(
    () => dashboardPeriodRange(period, new Date(), appliedStart, appliedEnd),
    [period, appliedStart, appliedEnd],
  )
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const money = useCallback((value: number) => formatMoneyBase(value, baseCode, locale), [baseCode, locale])
  const count = useCallback((value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value), [locale])
  const dateLabel = useCallback((value: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`)), [locale])
  const comparisonLabel = range
    ? `${dateLabel(range.start)}–${dateLabel(range.end)} · ${tt('dashboard.comparedWith', 'Compared with')} ${dateLabel(range.compareStart)}–${dateLabel(range.compareEnd)}`
    : ''

  const updateScope = (next: { period?: DashboardPeriodPreset; warehouse?: string }) => {
    const copy = new URLSearchParams(params)
    if (next.period) {
      next.period === 'today' ? copy.delete('period') : copy.set('period', next.period)
      if (next.period !== 'custom') {
        copy.delete('start'); copy.delete('end')
      }
    }
    if (next.warehouse) next.warehouse === 'all' ? copy.delete('warehouse') : copy.set('warehouse', next.warehouse)
    setParams(copy)
  }
  const applyCustom = () => {
    if (!draftStart || !draftEnd || draftEnd < draftStart) return
    const copy = new URLSearchParams(params)
    copy.set('period', 'custom'); copy.set('start', draftStart); copy.set('end', draftEnd)
    setParams(copy)
  }

  useEffect(() => {
    if (!companyId) return
    let active = true
    Promise.all([
      getBaseCurrencyCode(),
      supabase.from('warehouses').select('id,name').eq('company_id', companyId).order('name'),
    ]).then(([currency, warehouseResult]) => {
      if (!active) return
      setBaseCode(currency)
      if (!warehouseResult.error) setWarehouses((warehouseResult.data || []) as Warehouse[])
    })
    return () => { active = false }
  }, [companyId])

  useEffect(() => {
    if (!companyId || !range) return
    let active = true
    setLoading(true); setError(null)
    supabase.rpc('get_owner_dashboard', {
      p_company_id: companyId,
      p_start_date: range.start,
      p_end_date: range.end,
      p_compare_start_date: range.compareStart,
      p_compare_end_date: range.compareEnd,
      p_warehouse_id: warehouse === 'all' ? null : warehouse,
    }).then(({ data: result, error: readError }) => {
      if (!active) return
      if (readError) {
        setError(readError.message)
      } else {
        setData(result as DashboardData)
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [companyId, range, warehouse, revision])

  const summary = data?.summary
  const inventory = data?.inventory
  const salesDelta = summary && summary.previousSales
    ? (summary.sales - summary.previousSales) / summary.previousSales * 100 : null
  const completionDelta = summary?.completionRate != null && summary.previousCompletionRate != null
    ? summary.completionRate - summary.previousCompletionRate : null
  const average = summary ? dashboardAverageTransaction(summary.sales, summary.transactions) : null
  const rankedProducts = useMemo(() => [...(data?.products || [])]
    .filter(product => ranking !== 'grossProfit' || product.grossProfit != null)
    .sort((a, b) => number(b[ranking]) - number(a[ranking])).slice(0, 5), [data?.products, ranking])
  const customerRate = data?.customers.active ? data.customers.repeat / data.customers.active * 100 : null

  return (
    <div className="app-page app-page--analytics space-y-6">
      <PremiumPageHeader
        title={tt('dashboard.title', 'Dashboard')}
        description={tt('dashboard.ownerSubtitle', 'Business performance, attention points and the drivers behind the result.')}
        context={<Badge variant="outline">{tt('dashboard.operational', 'Operational')}</Badge>}
        meta={<span>{companyName}</span>}
        actions={<Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />{tt('common.refresh', 'Refresh')}</Button>}
      />

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,14rem)_minmax(12rem,18rem)_auto] lg:items-end">
            <label className="space-y-1.5 text-sm font-medium">
              <span>{tt('dashboard.period', 'Period')}</span>
              <Select value={period} onValueChange={value => updateScope({ period: value as DashboardPeriodPreset })}>
                <SelectTrigger aria-label={tt('dashboard.period', 'Period')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">{tt('dashboard.today', 'Today')}</SelectItem>
                  <SelectItem value="week">{tt('dashboard.thisWeek', 'This week')}</SelectItem>
                  <SelectItem value="month">{tt('dashboard.thisMonth', 'This month')}</SelectItem>
                  <SelectItem value="custom">{tt('dashboard.customPeriod', 'Custom period')}</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              <span>{tt('dashboard.warehouse', 'Warehouse')}</span>
              <Select value={warehouse} onValueChange={value => updateScope({ warehouse: value })}>
                <SelectTrigger aria-label={tt('dashboard.warehouse', 'Warehouse')}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">{tt('common.all', 'All')}</SelectItem>{warehouses.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <Button variant="outline" onClick={() => setDailyOpen(true)}><Calendar className="mr-2 h-4 w-4" />{tt('dashboard.dailyDetails', 'Daily details')}</Button>
          </div>
          {period === 'custom' ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(9rem,13rem)_minmax(9rem,13rem)_auto] sm:items-end">
              <label className="space-y-1.5 text-sm font-medium"><span>{tt('dashboard.startDate', 'Start date')}</span><input className="input w-full" type="date" value={draftStart} onChange={event => setDraftStart(event.target.value)} /></label>
              <label className="space-y-1.5 text-sm font-medium"><span>{tt('dashboard.endDate', 'End date')}</span><input className="input w-full" type="date" min={draftStart} value={draftEnd} onChange={event => setDraftEnd(event.target.value)} /></label>
              <Button disabled={!draftStart || !draftEnd || draftEnd < draftStart} onClick={applyCustom}>{tt('common.apply', 'Apply')}</Button>
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">{comparisonLabel}</p>
        </CardContent>
      </Card>

      {loading && !data ? <PremiumSkeleton rows={4} /> : error && !data ? (
        <PremiumStatePanel tone="danger" title={tt('dashboard.unavailable', 'Dashboard unavailable')} description={error} />
      ) : summary && inventory ? <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <PremiumMetricCard label={tt('dashboard.operationalSales', 'Operational sales')} value={money(summary.sales)} icon={<CoinsIcon />} description={`${summary.transactions} ${tt('dashboard.completedTransactions', 'completed transactions')}`} meta={salesDelta == null ? tt('dashboard.noComparison', 'No prior activity') : `${salesDelta >= 0 ? '↑' : '↓'} ${Math.abs(salesDelta).toFixed(1)}% ${tt('dashboard.vsComparison', 'vs comparison')}`} />
          <PremiumMetricCard label={tt('dashboard.grossProfit', 'Gross profit')} value={summary.grossProfit == null ? tt('dashboard.unavailableValue', 'Unavailable') : money(summary.grossProfit)} icon={<ChartLineUpIcon />} description={summary.grossProfit == null ? `${money(summary.knownCogs)} ${tt('dashboard.knownCost', 'known cost')} · ${summary.missingCostCount} ${tt('dashboard.missingCosts', 'missing cost evidence')}` : tt('dashboard.supportedDirectCosts', 'Supported direct COGS')} tone={summary.grossProfit != null && summary.grossProfit < 0 ? 'negative' : 'positive'} />
          <PremiumMetricCard label={tt('dashboard.grossMargin', 'Gross margin')} value={summary.grossMargin == null ? tt('dashboard.unavailableValue', 'Unavailable') : `${summary.grossMargin.toFixed(1)}%`} description={summary.grossMargin == null ? tt('dashboard.needsCostEvidence', 'Needs cost evidence') : tt('dashboard.salesLessCogs', 'Gross profit ÷ operational sales')} />
          <PremiumMetricCard label={tt('dashboard.completionRate', 'Completion rate')} value={summary.completionRate == null ? tt('dashboard.unavailableValue', 'Unavailable') : `${summary.completionRate.toFixed(1)}%`} description={`${summary.eligibleCompleted} / ${summary.eligible} ${tt('dashboard.eligibleOrders', 'eligible orders')}`} meta={completionDelta == null ? tt('dashboard.noComparison', 'No comparable denominator') : `${completionDelta >= 0 ? '↑' : '↓'} ${Math.abs(completionDelta).toFixed(1)} pp`} />
          <PremiumMetricCard className="col-span-2 xl:col-span-1" label={tt('dashboard.openOrders', 'Open orders')} value={count(summary.openOrders)} icon={<PackageIcon />} description={tt('dashboard.currentBacklog', 'Current backlog')} meta={`${summary.openSubmitted} ${tt('dashboard.openSubmitted', 'submitted')} · ${summary.openConfirmed} ${tt('dashboard.openConfirmed', 'confirmed')} · ${summary.openAllocated} ${tt('dashboard.openAllocated', 'allocated')}`} />
        </div>

        <Card><CardContent className="grid grid-cols-2 gap-x-5 gap-y-6 p-5 sm:grid-cols-3 sm:p-6 sm:pt-6 xl:grid-cols-5">
          {[
            [tt('dashboard.transactions', 'Transactions'), count(summary.transactions)],
            [tt('dashboard.averageTransaction', 'Average transaction value'), average == null ? tt('dashboard.unavailableValue', 'Unavailable') : money(average)],
            [tt('dashboard.inventoryValue', 'Inventory value'), money(inventory.value)],
            [tt('dashboard.lowStock', 'Low-stock items'), count(inventory.low_stock)],
            [tt('dashboard.outOfStock', 'Out-of-stock items'), count(inventory.out_of_stock)],
          ].map(([label, value]) => <div key={label}><p className="premium-label">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>)}
        </CardContent></Card>

        <PremiumChartCard title={tt('dashboard.performanceTrend', 'Operational performance')} description={comparisonLabel} footer={summary.missingCostCount ? tt('dashboard.chartPartial', 'Known COGS is shown; gross profit is withheld where cost evidence is incomplete.') : tt('dashboard.chartSummary', 'Chart totals reconcile to the operational headline values.')}>
          <div className="h-72" role="img" aria-label={`${tt('dashboard.performanceTrend', 'Operational performance')}: ${money(summary.sales)}`}>
            {data.trend.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data.trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis tickFormatter={value => count(value)} /><Tooltip formatter={value => money(number(value))} /><Legend /><Line type="monotone" dataKey="sales" name={tt('dashboard.operationalSales', 'Operational sales')} stroke="hsl(var(--primary))" /><Line type="monotone" dataKey="knownCogs" name={tt('dashboard.cogs', 'COGS')} stroke="hsl(var(--destructive))" /><Line type="monotone" connectNulls={false} dataKey="grossProfit" name={tt('dashboard.grossProfit', 'Gross profit')} stroke="hsl(var(--success))" /></LineChart></ResponsiveContainer> : <PremiumEmptyState title={tt('dashboard.noActivity', 'No activity')} description={tt('dashboard.noCompletedActivity', 'No completed operating activity in this period.')} />}
          </div>
        </PremiumChartCard>

        <PremiumSection title={tt('dashboard.actionQueue', 'Needs attention')}>
          <div className="grid gap-3 lg:grid-cols-3">
            {(inventory.out_of_stock > 0 || inventory.low_stock > 0) && <Action title={tt('dashboard.stockExceptions', 'Stock exceptions')} detail={`${inventory.out_of_stock} ${tt('dashboard.outOfStock', 'out of stock')} · ${inventory.low_stock} ${tt('dashboard.lowStock', 'low stock')}`} onClick={() => navigate('/stock-levels')} />}
            {summary.missingCostCount > 0 && <Action title={tt('dashboard.needsCostEvidence', 'Needs cost evidence')} detail={`${summary.missingCostCount} ${tt('dashboard.missingCosts', 'missing cost evidence')}`} onClick={() => navigate('/reports')} />}
            {inventory.missing_minimum > 0 && <Action title={tt('dashboard.missingMinimums', 'Missing minimum-stock settings')} detail={count(inventory.missing_minimum)} onClick={() => navigate('/items')} />}
            {!inventory.out_of_stock && !inventory.low_stock && !summary.missingCostCount && !inventory.missing_minimum && <PremiumStatePanel tone="success" title={tt('dashboard.noPriorityActions', 'No priority actions')} description={tt('dashboard.controlsHealthy', 'Current operating controls have no principal exception.')} />}
          </div>
        </PremiumSection>

        <div className="grid gap-6 xl:grid-cols-2">
          <PremiumSection title={tt('dashboard.productPerformance', 'Product performance')} action={<Select value={ranking} onValueChange={value => setRanking(value as Ranking)}><SelectTrigger className="w-48" aria-label={tt('dashboard.productRanking', 'Product ranking')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="revenue">{tt('dashboard.operationalRevenue', 'Operational revenue')}</SelectItem><SelectItem value="quantity">{tt('dashboard.quantity', 'Quantity')}</SelectItem><SelectItem value="grossProfit">{tt('dashboard.grossProfit', 'Gross profit')}</SelectItem></SelectContent></Select>}>
            <Card><CardContent className="divide-y p-0">{rankedProducts.length ? rankedProducts.map((product, index) => <div key={product.itemId} className="flex items-center justify-between gap-4 p-4"><div className="min-w-0"><p className="font-medium">{index + 1}. {product.name}</p><p className="text-xs text-muted-foreground">{product.sku || '—'}{ranking === 'quantity' ? ` · ${product.baseUom || '—'}` : ''}</p></div><p className="font-semibold tabular-nums">{ranking === 'quantity' ? count(product.quantity) : money(number(product[ranking]))}</p></div>) : <div className="p-5"><PremiumEmptyState title={tt('dashboard.noActivity', 'No activity')} description={ranking === 'grossProfit' ? tt('dashboard.needsCostEvidence', 'Needs cost evidence') : tt('dashboard.noCompletedActivity', 'No completed operating activity in this period.')} /></div>}</CardContent></Card>
            {ranking === 'quantity' && <p className="mt-2 text-xs text-muted-foreground">{tt('dashboard.quantityBaseUnitNote', 'Quantities follow each item’s base unit.')}</p>}
          </PremiumSection>
          {data.customers.active > 0 ? <PremiumSection title={tt('dashboard.customerPerformance', 'Customer performance')} description={tt('dashboard.namedCustomersOnly', 'Named customers only')}>
            <Card><CardContent className="grid grid-cols-2 gap-5 p-5 sm:p-6 sm:pt-6"><Driver label={tt('dashboard.newCustomers', 'New customers')} value={count(data.customers.new)} /><Driver label={tt('dashboard.repeatCustomers', 'Repeat customers')} value={count(data.customers.repeat)} /><Driver label={tt('dashboard.repeatCustomerRate', 'Repeat-customer rate')} value={`${customerRate?.toFixed(1)}%`} /><Driver label={tt('dashboard.topNamedCustomer', 'Top named customer')} value={data.customers.top?.name || '—'} meta={data.customers.top ? money(data.customers.top.sales) : undefined} /></CardContent></Card>
          </PremiumSection> : null}
        </div>

        <div className="flex justify-end"><Button variant="ghost" onClick={() => navigate('/stock/movements')}>{tt('dashboard.viewStockMovements', 'View stock movements')}<ArrowRight className="ml-2 h-4 w-4" /></Button></div>
      </> : null}

      <Sheet open={dailyOpen} onOpenChange={setDailyOpen}><SheetContent><SheetHeader><SheetTitle>{tt('dashboard.dailyDetails', 'Daily details')}</SheetTitle><SheetDescription>{comparisonLabel}</SheetDescription></SheetHeader><SheetBody><div className="space-y-3">{data?.trend.map(day => <div key={day.date} className="rounded-lg border p-3"><p className="font-medium">{dateLabel(day.date)}</p><p className="mt-1 text-sm text-muted-foreground">{tt('dashboard.operationalSales', 'Operational sales')}: {money(day.sales)} · {tt('dashboard.cogs', 'COGS')}: {money(day.knownCogs)}</p></div>)}</div></SheetBody></SheetContent></Sheet>
    </div>
  )
}

function Action({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-28 w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><WarningIcon className="mt-0.5 h-5 w-5 text-warning" /><span><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm text-muted-foreground">{detail}</span></span><ArrowRight className="ml-auto h-4 w-4" /></button>
}
function Driver({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return <div><p className="premium-label">{label}</p><p className="mt-1 font-semibold tabular-nums">{value}</p>{meta && <p className="text-xs text-muted-foreground">{meta}</p>}</div>
}
