import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, Calendar, RefreshCw } from 'lucide-react'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { ClockIcon } from '@phosphor-icons/react/dist/csr/Clock'
import { PackageIcon } from '@phosphor-icons/react/dist/csr/Package'
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { PremiumEmptyState, PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumSection } from '../components/premium/PremiumSection'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'
import { useOrg } from '../hooks/useOrg'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { dashboardPeriodRange, resolveMovementCost, type DashboardPeriodPreset } from '../lib/dashboardMetrics'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { formatOperationalQuantity } from '../lib/operationalQuantity'
import { can } from '../lib/permissions'
import { supabase } from '../lib/supabase'

type Warehouse = { id: string; name: string }
type Item = { id: string; name: string; sku: string | null; track_inventory: boolean; min_stock: number | null }
type Movement = {
  id: string
  item_id: string
  qty_base: number | null
  type: 'receive' | 'issue' | 'transfer' | 'adjust' | null
  created_at: string
  unit_cost: number | null
  total_value: number | null
}
type Summary = {
  sales: number
  transactions: number
  posTransactions: number
  knownCogs: number
  missingCostCount: number
  grossProfit: number | null
  grossMargin: number | null
  completionRate: number | null
  eligible: number
  eligibleCompleted: number
  previousSales: number
  previousTransactions: number
  previousCompletionRate: number | null
  openOrders: number
  openSubmitted: number
  openConfirmed: number
  openAllocated: number
}
type Inventory = {
  value: number
  missing_cost_count: number
  out_of_stock: number
  low_stock: number
  missing_minimum: number
}
type Product = {
  itemId: string
  name: string
  sku: string | null
  baseUom: string | null
  revenue: number
  quantity: number
  knownCogs: number
  grossProfit: number | null
  missingCostCount: number
}
type CustomerSummary = {
  active: number
  new: number
  repeat: number
  top: { id: string; name: string; sales: number } | null
}
type Trend = { date: string; sales: number; knownCogs: number; grossProfit: number | null; missingCostCount: number }
type DashboardData = { summary: Summary; inventory: Inventory; products: Product[]; customers: CustomerSummary; trend: Trend[] }
type SupportingData = { warehouses: Warehouse[]; items: Item[]; movements: Movement[] }
type AttentionItem = { title: string; detail: string; tone: PremiumTone; actionLabel: string; onClick: () => void }

const validPeriod = (value: string | null): DashboardPeriodPreset =>
  value === 'week' || value === 'month' || value === 'custom' ? value : 'today'
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0

export default function Dashboard() {
  const { t, lang } = useI18n()
  const { companyId, companyName, myRole } = useOrg()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tt = useCallback((key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars), [t])
  const [baseCode, setBaseCode] = useState('MZN')
  const [data, setData] = useState<DashboardData | null>(null)
  const [supporting, setSupporting] = useState<SupportingData>({ warehouses: [], items: [], movements: [] })
  const [loadedCompanyId, setLoadedCompanyId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [dailyOpen, setDailyOpen] = useState(false)
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
  const dateTimeLabel = useCallback((value: string) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)), [locale])

  const comparisonLabel = range
    ? `${dateLabel(range.start)}–${dateLabel(range.end)} · ${tt('dashboard.comparedWith', 'Compared with')} ${dateLabel(range.compareStart)}–${dateLabel(range.compareEnd)}`
    : ''
  const selectedWarehouse = supporting.warehouses.find((item) => item.id === warehouse)
  const warehouseLabel = warehouse === 'all' ? tt('common.all', 'All warehouses') : selectedWarehouse?.name || tt('dashboard.warehouse', 'Warehouse')

  const updateScope = (next: { period?: DashboardPeriodPreset; warehouse?: string }) => {
    const copy = new URLSearchParams(params)
    if (next.period) {
      next.period === 'today' ? copy.delete('period') : copy.set('period', next.period)
      if (next.period !== 'custom') {
        copy.delete('start')
        copy.delete('end')
      }
    }
    if (next.warehouse) next.warehouse === 'all' ? copy.delete('warehouse') : copy.set('warehouse', next.warehouse)
    setParams(copy)
  }

  const applyCustom = () => {
    if (!draftStart || !draftEnd || draftEnd < draftStart) return
    const copy = new URLSearchParams(params)
    copy.set('period', 'custom')
    copy.set('start', draftStart)
    copy.set('end', draftEnd)
    setParams(copy)
  }

  useEffect(() => {
    if (!companyId || !range) return
    let active = true
    setLoading(true)
    setLoadFailed(false)

    void Promise.all([
      getBaseCurrencyCode(companyId),
      supabase.from('warehouses').select('id,name').eq('company_id', companyId).order('name'),
      supabase.from('items').select('id,name,sku,track_inventory,min_stock').eq('company_id', companyId),
      supabase
        .from('stock_movements')
        .select('id,item_id,qty_base,type,created_at,unit_cost,total_value')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase.rpc('get_owner_dashboard', {
        p_company_id: companyId,
        p_start_date: range.start,
        p_end_date: range.end,
        p_compare_start_date: range.compareStart,
        p_compare_end_date: range.compareEnd,
        p_warehouse_id: warehouse === 'all' ? null : warehouse,
      }),
    ]).then(([currency, warehouseResult, itemResult, movementResult, dashboardResult]) => {
      const readError = warehouseResult.error || itemResult.error || movementResult.error || dashboardResult.error
      if (readError) throw readError
      if (!active) return
      setBaseCode(currency || 'MZN')
      setSupporting({
        warehouses: (warehouseResult.data || []) as Warehouse[],
        items: (itemResult.data || []) as Item[],
        movements: (movementResult.data || []) as Movement[],
      })
      setData(dashboardResult.data as DashboardData)
      setLoadedCompanyId(companyId)
    }).catch((error: unknown) => {
      console.error('Dashboard read failed', error)
      if (active) setLoadFailed(true)
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [companyId, range, revision, warehouse])

  const currentData = loadedCompanyId === companyId ? data : null
  const summary = currentData?.summary
  const inventory = currentData?.inventory
  const itemById = useMemo(() => new Map(supporting.items.map((item) => [item.id, item])), [supporting.items])
  const hasPeriodActivity = Boolean(summary && (summary.transactions > 0 || currentData?.trend.length))
  const hasOperatingEvidence = Boolean(
    supporting.items.length
    || supporting.movements.length
    || (summary && (summary.transactions > 0 || summary.openOrders > 0))
    || (inventory && inventory.value !== 0),
  )
  const isFirstUse = Boolean(summary && inventory && supporting.items.length === 0 && !hasOperatingEvidence)
  const isSetupWithoutActivity = Boolean(
    summary
    && inventory
    && supporting.items.length > 0
    && supporting.movements.length === 0
    && summary.transactions === 0
    && summary.openOrders === 0
    && inventory.value === 0,
  )
  const salesDelta = summary && summary.previousSales > 0
    ? (summary.sales - summary.previousSales) / summary.previousSales * 100
    : null
  const customerRate = currentData?.customers.active
    ? currentData.customers.repeat / currentData.customers.active * 100
    : null

  const attentionItems = useMemo<AttentionItem[]>(() => {
    if (!summary || !inventory) return []
    const items: AttentionItem[] = []
    if (inventory.out_of_stock > 0 || inventory.low_stock > 0) items.push({
      title: tt('dashboard.stockExceptions', 'Stock exceptions'),
      detail: `${count(inventory.out_of_stock)} ${tt('dashboard.outOfStock', 'out of stock')} · ${count(inventory.low_stock)} ${tt('dashboard.lowStock', 'low stock')}`,
      tone: inventory.out_of_stock > 0 ? 'critical' : 'warning',
      actionLabel: tt('dashboard.reviewLowStock', 'Review low stock'),
      onClick: () => navigate('/stock-levels'),
    })
    if (inventory.missing_minimum > 0) items.push({
      title: tt('dashboard.missingMinimums', 'Missing minimum-stock settings'),
      detail: tt('dashboard.itemsCount', '{count} items', { count: count(inventory.missing_minimum) }),
      tone: 'warning',
      actionLabel: tt('dashboard.reviewItems', 'Review items'),
      onClick: () => navigate('/items'),
    })
    if (summary.missingCostCount > 0) items.push({
      title: tt('dashboard.needsCostEvidence', 'Needs cost evidence'),
      detail: `${count(summary.missingCostCount)} ${tt('dashboard.missingCosts', 'cost records need evidence')}`,
      tone: 'warning',
      actionLabel: tt('dashboard.reviewCostEvidence', 'Review cost evidence'),
      onClick: () => navigate('/movements'),
    })
    if (summary.grossProfit != null && summary.grossProfit < 0) items.push({
      title: tt('dashboard.marginAction', 'Review negative gross profit'),
      detail: tt('dashboard.marginActionHelp', 'Shipment-linked cost exceeds operational revenue in this period.'),
      tone: 'critical',
      actionLabel: tt('dashboard.openReports', 'Open reports'),
      onClick: () => navigate('/reports'),
    })
    return items.slice(0, 3)
  }, [count, inventory, navigate, summary, tt])

  const rankedProducts = useMemo(() => [...(currentData?.products || [])]
    .sort((left, right) => number(right.revenue) - number(left.revenue))
    .slice(0, 4), [currentData?.products])

  const dashboardStatus = useMemo(() => {
    if (loadFailed) return {
      tone: 'critical' as PremiumTone,
      label: tt('dashboard.statusUnavailable', 'Data unavailable'),
      icon: <WarningCircleIcon weight="duotone" />,
    }
    if (isFirstUse || isSetupWithoutActivity) return {
      tone: 'neutral' as PremiumTone,
      label: tt('dashboard.statusSetup', 'Setup in progress'),
      icon: <PackageIcon weight="duotone" />,
    }
    if (attentionItems.some((item) => item.tone === 'critical')) return {
      tone: 'critical' as PremiumTone,
      label: tt('dashboard.statusCritical', 'Action required'),
      icon: <WarningCircleIcon weight="duotone" />,
    }
    if (attentionItems.length) return {
      tone: 'warning' as PremiumTone,
      label: tt('dashboard.statusAttention', 'Needs attention'),
      icon: <WarningIcon weight="duotone" />,
    }
    return {
      tone: 'positive' as PremiumTone,
      label: tt('dashboard.noOpenActions', 'No urgent actions'),
      icon: <CheckCircleIcon weight="duotone" />,
    }
  }, [attentionItems, isFirstUse, isSetupWithoutActivity, loadFailed, tt])

  return (
    <div className="app-page app-page--analytics space-y-7">
      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="screen-title">{tt('dashboard.title', 'Dashboard')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{companyName} · {warehouseLabel}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)} disabled={loading}>
          <RefreshCw className={loading ? 'h-4 w-4 motion-safe:animate-spin' : 'h-4 w-4'} aria-hidden="true" />
          {loading ? tt('dashboard.refreshing', 'Refreshing') : tt('common.refresh', 'Refresh')}
        </Button>
      </header>

      <section aria-label={tt('dashboard.scopeLabel', 'Dashboard scope')} className="border-b border-border pb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(10rem,14rem)_minmax(12rem,18rem)_auto] lg:items-end">
          <label className="space-y-1.5 text-sm font-medium">
            <span>{tt('dashboard.period', 'Period')}</span>
            <Select value={period} onValueChange={(value) => updateScope({ period: value as DashboardPeriodPreset })}>
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
            <Select value={warehouse} onValueChange={(value) => updateScope({ warehouse: value })}>
              <SelectTrigger aria-label={tt('dashboard.warehouse', 'Warehouse')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                {supporting.warehouses.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          {currentData?.trend.length ? (
            <Button variant="outline" onClick={() => setDailyOpen(true)}>
              <Calendar className="h-4 w-4" aria-hidden="true" />
              {tt('dashboard.dailyDetails', 'Daily details')}
            </Button>
          ) : null}
        </div>
        {period === 'custom' ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(9rem,13rem)_minmax(9rem,13rem)_auto] sm:items-end">
            <label className="space-y-1.5 text-sm font-medium">
              <span>{tt('dashboard.startDate', 'Start date')}</span>
              <input className="input w-full" type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              <span>{tt('dashboard.endDate', 'End date')}</span>
              <input className="input w-full" type="date" min={draftStart} value={draftEnd} onChange={(event) => setDraftEnd(event.target.value)} />
            </label>
            <Button disabled={!draftStart || !draftEnd || draftEnd < draftStart} onClick={applyCustom}>{tt('common.apply', 'Apply')}</Button>
          </div>
        ) : null}
        <p className="mt-3 text-sm text-muted-foreground">{comparisonLabel}</p>
      </section>

      {loading && !currentData ? <DashboardSkeleton label={tt('dashboard.loading', 'Loading dashboard')} /> : null}

      {loadFailed && !currentData ? (
        <PremiumStatePanel
          kind="error"
          title={tt('dashboard.statusUnavailable', 'Dashboard data is unavailable')}
          description={tt('dashboard.statusUnavailableHelp', 'Retry before using this view for an operating decision.')}
          icon={<WarningCircleIcon weight="duotone" />}
          action={<Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>{tt('dashboard.retryData', 'Retry dashboard data')}</Button>}
        />
      ) : null}

      {currentData && summary && inventory ? (
        <>
          {loadFailed ? (
            <PremiumStatePanel
              kind="blocked"
              compact
              title={tt('dashboard.statusStale', 'Showing last known data')}
              description={tt('dashboard.statusStaleHelp', 'The refresh failed. Retry before relying on this view for a new decision.')}
              icon={<WarningCircleIcon weight="duotone" />}
              action={<Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>{tt('dashboard.retryData', 'Retry dashboard data')}</Button>}
            />
          ) : null}

          <PremiumSection
            title={isFirstUse || isSetupWithoutActivity ? tt('dashboard.statusSetup', 'Start with operating records') : tt('dashboard.actionNeeded', 'Needs attention')}
            action={<PremiumStatusBadge tone={dashboardStatus.tone} icon={dashboardStatus.icon}>{dashboardStatus.label}</PremiumStatusBadge>}
          >
            {isFirstUse || isSetupWithoutActivity ? (
              <FirstUseState
                canCreate={can.createItem(myRole)}
                canImport={can.createMaster(myRole)}
                hasItems={supporting.items.length > 0}
                tt={tt}
                navigate={navigate}
              />
            ) : attentionItems.length ? (
              <div className="divide-y divide-border border-y border-border">
                {attentionItems.map((item) => <AttentionRow key={item.title} {...item} />)}
              </div>
            ) : (
              <div className="flex items-start gap-3 border-y border-border py-5" role="status">
                <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-status-success-foreground" weight="duotone" aria-hidden="true" />
                <div>
                  <p className="font-medium">{tt('dashboard.noOpenActions', 'No urgent actions')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{tt('dashboard.noUrgentActionsHelp', 'No urgent exception is visible in the active scope.')}</p>
                </div>
              </div>
            )}
          </PremiumSection>

          {!isFirstUse ? (
            <PremiumSection
              title={tt('dashboard.latestMovements', 'Recent activity')}
              action={<Button variant="ghost" size="sm" onClick={() => navigate('/movements')}>{tt('dashboard.viewAllMovements', 'View all movements')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>}
            >
              {supporting.movements.length ? (
                <div className="divide-y divide-border border-y border-border">
                  {supporting.movements.map((movement) => {
                    const item = itemById.get(movement.item_id)
                    const movementValue = resolveMovementCost(movement)
                    return (
                      <div key={movement.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5">
                        <div className="min-w-0">
                          <p className="font-medium break-words">{item?.name || tt('dashboard.unknownItem', 'Unknown item')}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{dateTimeLabel(movement.created_at)} · {tt(`movements.type.${movement.type}`, movement.type || '—')}</p>
                        </div>
                        <p className="text-sm tabular-nums"><span className="text-muted-foreground">{tt('table.qtyBase', 'Quantity')}:</span> {formatOperationalQuantity(number(movement.qty_base), locale)}</p>
                        <p className="text-sm tabular-nums"><span className="text-muted-foreground">{tt('table.value', 'Value')}:</span> {movementValue.available ? money(movementValue.amount) : tt('dashboard.unavailableValue', 'Unavailable')}</p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <PremiumEmptyState
                  compact
                  title={tt('dashboard.noMovements', 'No recent stock movement')}
                  description={tt('dashboard.noMovementsHelp', 'Stock activity will appear here after a governed movement is recorded.')}
                  icon={<ClockIcon weight="duotone" />}
                />
              )}
            </PremiumSection>
          ) : null}

          {!isFirstUse && !isSetupWithoutActivity ? (
            <PremiumSection title={tt('dashboard.performanceSnapshot', 'Current position')}>
              <dl className="grid border-y border-border sm:grid-cols-2 xl:grid-cols-4">
                <MetricRow
                  label={tt('dashboard.operationalRevenue', 'Operational revenue')}
                  value={hasPeriodActivity ? money(summary.sales) : tt('dashboard.noActivity', 'No activity')}
                  detail={hasPeriodActivity
                    ? `${count(summary.transactions)} ${tt('dashboard.completedTransactions', 'completed transactions')}`
                    : tt('dashboard.noCompletedActivity', 'No completed operating activity in this period.')}
                />
                <MetricRow
                  label={tt('dashboard.grossProfit', 'Gross profit')}
                  value={!hasPeriodActivity
                    ? tt('dashboard.noActivity', 'No activity')
                    : summary.grossProfit == null
                      ? tt('dashboard.unavailableValue', 'Unavailable')
                      : money(summary.grossProfit)}
                  detail={!hasPeriodActivity
                    ? tt('dashboard.noCompletedActivity', 'No completed operating activity in this period.')
                    : summary.grossProfit == null
                      ? tt('dashboard.marginWithheld', 'Withheld until cost evidence is complete.')
                      : summary.grossMargin == null ? undefined : `${summary.grossMargin.toFixed(1)}% ${tt('dashboard.grossMargin', 'gross margin')}`}
                  tone={summary.grossProfit != null && summary.grossProfit < 0 ? 'danger' : undefined}
                />
                <MetricRow
                  label={tt('dashboard.inventoryValue', 'Inventory value')}
                  value={inventory.missing_cost_count > 0 ? tt('dashboard.unavailableValue', 'Unavailable') : money(inventory.value)}
                  detail={inventory.missing_cost_count > 0
                    ? tt('dashboard.inventoryPartial', 'Some stock balances lack cost evidence.')
                    : tt('dashboard.inventoryCurrentState', 'Current inventory valuation for {warehouse}.', { warehouse: warehouseLabel })}
                />
                <MetricRow
                  label={tt('dashboard.openOrders', 'Open orders')}
                  value={count(summary.openOrders)}
                  detail={`${summary.openSubmitted} ${tt('dashboard.openSubmitted', 'submitted')} · ${summary.openConfirmed} ${tt('dashboard.openConfirmed', 'confirmed')} · ${summary.openAllocated} ${tt('dashboard.openAllocated', 'allocated')}`}
                />
              </dl>
              {salesDelta != null ? (
                <p className="mt-3 text-xs text-muted-foreground">{salesDelta >= 0 ? '+' : ''}{salesDelta.toFixed(1)}% {tt('dashboard.vsComparison', 'vs comparison')}</p>
              ) : null}
            </PremiumSection>
          ) : null}

          {currentData.trend.length >= 2 ? (
            <PremiumSection title={tt('dashboard.dailyPerformance', 'Daily performance')}>
              <div className="border-y border-border py-5 sm:py-6">
                <div className="h-72" role="img" aria-label={`${tt('dashboard.dailyPerformance', 'Daily performance')}: ${money(summary.sales)}`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={currentData.trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="hsl(var(--chart-grid-border))" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={dateLabel} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(value) => count(number(value))} axisLine={false} tickLine={false} width={70} />
                      <Tooltip formatter={(value) => money(number(value))} labelFormatter={(value) => dateLabel(String(value))} />
                      <Legend />
                      <Line type="monotone" dataKey="sales" name={tt('dashboard.operationalSales', 'Operational sales')} stroke="hsl(var(--chart-revenue-line))" strokeWidth={2.5} dot={{ r: 4, stroke: 'hsl(var(--chart-grid-border))' }} activeDot={{ r: 5 }} />
                      <Line type="monotone" dataKey="knownCogs" name={tt('dashboard.cogs', 'COGS')} stroke="hsl(var(--chart-cogs-line))" strokeWidth={2.5} strokeDasharray="6 4" dot={{ r: 4, stroke: 'hsl(var(--chart-grid-border))' }} activeDot={{ r: 5 }} />
                      <Line type="monotone" connectNulls={false} dataKey="grossProfit" name={tt('dashboard.grossProfit', 'Gross profit')} stroke="hsl(var(--chart-margin-line))" strokeWidth={2.5} dot={{ r: 4, stroke: 'hsl(var(--chart-grid-border))' }} activeDot={{ r: 5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{summary.missingCostCount
                  ? tt('dashboard.chartPartial', 'Known COGS is shown; gross profit is withheld where cost evidence is incomplete.')
                  : tt('dashboard.chartSummary', 'The chart uses the same operating evidence as the period totals.')}</p>
                <table className="sr-only">
                  <caption>{tt('dashboard.dailyDetails', 'Daily details')}</caption>
                  <thead><tr><th>{tt('dashboard.period', 'Date')}</th><th>{tt('dashboard.operationalSales', 'Operational sales')}</th><th>{tt('dashboard.cogs', 'COGS')}</th><th>{tt('dashboard.grossProfit', 'Gross profit')}</th></tr></thead>
                  <tbody>{currentData.trend.map((day) => <tr key={day.date}><td>{dateLabel(day.date)}</td><td>{money(day.sales)}</td><td>{money(day.knownCogs)}</td><td>{day.grossProfit == null ? tt('dashboard.unavailableValue', 'Unavailable') : money(day.grossProfit)}</td></tr>)}</tbody>
                </table>
              </div>
            </PremiumSection>
          ) : null}

          {rankedProducts.length ? (
            <PremiumSection title={tt('dashboard.performanceDrivers', 'Performance drivers')}>
              <div className="grid gap-6 border-y border-border py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(15rem,0.7fr)]">
                <div>
                  <h3 className="font-medium">{tt('dashboard.productPerformance', 'Leading products')}</h3>
                  <ol className="mt-3 divide-y divide-border">
                    {rankedProducts.map((product, index) => (
                      <li key={product.itemId} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                        <div className="min-w-0"><p className="font-medium break-words">{index + 1}. {product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.sku || '—'}</p></div>
                        <p className="shrink-0 font-semibold tabular-nums">{money(product.revenue)}</p>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  <h3 className="font-medium">{tt('dashboard.customerPerformance', 'Customer activity')}</h3>
                  {currentData.customers.active > 0 ? (
                    <dl className="mt-3 space-y-3 text-sm">
                      <Driver label={tt('dashboard.namedCustomersOnly', 'Named customers')} value={count(currentData.customers.active)} />
                      <Driver label={tt('dashboard.repeatCustomers', 'Repeat customers')} value={count(currentData.customers.repeat)} />
                      <Driver label={tt('dashboard.repeatCustomerRate', 'Repeat-customer rate')} value={`${customerRate?.toFixed(1)}%`} />
                    </dl>
                  ) : <p className="mt-3 text-sm text-muted-foreground">{tt('dashboard.topClientEmpty', 'No customer-linked operational revenue is available.')}</p>}
                </div>
              </div>
            </PremiumSection>
          ) : null}
        </>
      ) : null}

      <Sheet open={dailyOpen} onOpenChange={setDailyOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>{tt('dashboard.dailyDetails', 'Daily details')}</SheetTitle><SheetDescription>{comparisonLabel}</SheetDescription></SheetHeader>
          <SheetBody>
            <div className="divide-y divide-border">
              {currentData?.trend.map((day) => (
                <div key={day.date} className="py-4">
                  <p className="font-medium">{dateLabel(day.date)}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                    <Driver label={tt('dashboard.operationalSales', 'Operational sales')} value={money(day.sales)} />
                    <Driver label={tt('dashboard.cogs', 'COGS')} value={money(day.knownCogs)} />
                    <Driver label={tt('dashboard.grossProfit', 'Gross profit')} value={day.grossProfit == null ? tt('dashboard.unavailableValue', 'Unavailable') : money(day.grossProfit)} />
                  </dl>
                </div>
              ))}
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-7" aria-label={label}>
      <PremiumSkeleton variant="list" rows={3} label={label} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <PremiumSkeleton key={index} lines={2} label={label} />)}
      </div>
      <PremiumSkeleton variant="detail" rows={3} label={label} />
    </div>
  )
}

function FirstUseState({
  canCreate,
  canImport,
  hasItems,
  tt,
  navigate,
}: {
  canCreate: boolean
  canImport: boolean
  hasItems: boolean
  tt: (key: string, fallback: string, vars?: Record<string, string | number>) => string
  navigate: (to: string) => void
}) {
  const actions = [
    !hasItems && canCreate ? {
      title: tt('dashboard.firstItemsTitle', 'Add operating items'),
      body: tt('dashboard.firstItemsBody', 'Create the products or services the company will buy, hold, or sell.'),
      label: tt('dashboard.firstUseItemsAction', 'Create items'),
      route: '/items?view=create',
    } : null,
    canImport ? {
      title: tt('dashboard.firstUseImportTitle', 'Import opening stock'),
      body: tt('dashboard.firstUseImportBody', 'Bring existing stock balances into the operating workspace before daily use.'),
      label: tt('dashboard.firstUseImportAction', 'Open import'),
      route: '/setup/import?dataset=opening_stock',
    } : null,
    canCreate ? {
      title: tt('dashboard.firstPosTitle', 'Check Point of Sale readiness'),
      body: tt('dashboard.firstPosBody', 'Confirm tax handling, stock source, and payment destination before the first sale.'),
      label: tt('dashboard.openPos', 'Open Point of Sale'),
      route: '/operator',
    } : null,
  ].filter(Boolean) as Array<{ title: string; body: string; label: string; route: string }>

  if (!actions.length) {
    return (
      <PremiumEmptyState
        compact
        title={tt('dashboard.noPerformanceTitle', 'No operating data yet')}
        description={tt('dashboard.statusSetupHelp', 'An administrator or operator can add items and opening stock before routine activity begins.')}
      />
    )
  }

  return (
    <ol className="divide-y divide-border border-y border-border">
      {actions.slice(0, 3).map((action, index) => (
        <li key={action.title} className="grid gap-3 py-5 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-status-neutral-border bg-status-neutral-muted text-sm font-semibold text-status-neutral-foreground" aria-hidden="true">{index + 1}</span>
          <div><p className="font-medium">{action.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{action.body}</p></div>
          <Button variant="outline" size="sm" onClick={() => navigate(action.route)}>{action.label}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
        </li>
      ))}
    </ol>
  )
}

function AttentionRow({ title, detail, tone, actionLabel, onClick }: AttentionItem) {
  return (
    <div className="grid gap-3 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      {tone === 'critical'
        ? <WarningCircleIcon className="h-5 w-5 text-status-danger-foreground" weight="duotone" aria-hidden="true" />
        : <WarningIcon className="h-5 w-5 text-status-warning-foreground" weight="duotone" aria-hidden="true" />}
      <div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>
      <Button variant="outline" size="sm" onClick={onClick}>{actionLabel}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
  )
}

function MetricRow({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: ReactNode; tone?: 'danger' }) {
  return (
    <div className="min-w-0 px-0 py-5 sm:px-5 sm:first:pl-0 sm:[&:nth-child(2n+1)]:pl-0 xl:[&:nth-child(3)]:pl-5 xl:last:pr-0">
      <dt className="premium-label">{label}</dt>
      <dd className={tone === 'danger' ? 'mt-2 text-2xl font-semibold tabular-nums text-status-danger-foreground' : 'mt-2 text-2xl font-semibold tabular-nums text-foreground'}>{value}</dd>
      {detail ? <dd className="mt-2 text-sm leading-5 text-muted-foreground">{detail}</dd> : null}
    </div>
  )
}

function Driver({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-medium tabular-nums text-foreground">{value}</dd></div>
}
