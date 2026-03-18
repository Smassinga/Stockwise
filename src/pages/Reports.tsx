// src/pages/Reports.tsx
import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Label } from '../components/ui/label'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { useI18n } from '../lib/i18n'
import { ReportsProvider, useReports } from './reports/context/ReportsProvider'

const SummaryTab = lazy(() => import('./reports/tabs/SummaryTab'))
const ValuationTab = lazy(() => import('./reports/tabs/ValuationTab'))
const TurnoverTab = lazy(() => import('./reports/tabs/TurnoverTab'))
const AgingTab = lazy(() => import('./reports/tabs/AgingTab'))
const RevenueTab = lazy(() => import('./reports/tabs/RevenueTab'))
const SuppliersTab = lazy(() => import('./reports/tabs/SuppliersTab'))
const CustomersTab = lazy(() => import('./reports/tabs/CustomersTab'))

function FiltersBar() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => (t(key) === key ? fallback : t(key))
  const tv = (key: string, vars: Record<string, string | number>, fallback: string) => {
    const resolved = t(key, vars)
    return resolved === key ? fallback : resolved
  }
  const {
    ui,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    lastNDays,
    setCostMethod,
    valuationAsOfEnd,
    setValuationAsOfEnd,
    baseCurrency,
    displayCurrency,
    setDisplayCurrency,
    fxRate,
    setFxRate,
    autoFx,
    setAutoFx,
    currencyOptions,
  } = useReports()

  const selectCx =
    'h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none ring-offset-background transition focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50'

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('reports.workspace', 'Reporting workspace')}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('nav.reports', 'Reports')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {tt('reports.subtitle', 'Review valuation, turnover, revenue, and partner-level movement summaries with the same company and currency context used across the app.')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/stock-levels">{tt('nav.stockLevels', 'Stock Levels')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/settings">{tt('nav.settings', 'Settings')}</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {tt('reports.context.company', 'Company')}
          </div>
          <div className="mt-2 text-sm font-semibold">{ui.companyName}</div>
          <div className="mt-1 text-xs text-muted-foreground">{ui.subtitle}</div>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {tt('reports.context.period', 'Period')}
          </div>
          <div className="mt-2 text-sm font-semibold">
            {startDate} → {endDate}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{tt('reports.filters', 'Filters')} + quick ranges</div>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {tt('reports.context.currency', 'Display currency')}
          </div>
          <div className="mt-2 text-sm font-semibold">{displayCurrency}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {fxRate !== 1 ? `FX ${fxRate.toFixed(6)} / ${baseCurrency}` : tt('reports.context.baseCurrency', 'Using base currency')}
          </div>
        </div>
        <div className="rounded-2xl border border-border/80 bg-card px-4 py-3 shadow-sm">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {tt('reports.context.valuationMode', 'Valuation mode')}
          </div>
          <div className="mt-2 text-sm font-semibold">
            {valuationAsOfEnd ? tt('reports.asOfEnd', 'As of end date') : tt('reports.currentSnapshot', 'Current snapshot')}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{ui.costMethod}</div>
        </div>
      </div>

      <Card className="rounded-2xl border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{tt('reports.filters', 'Filters')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>{tt('reports.start', 'Start')}</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>{tt('reports.end', 'End')}</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div>
              <Label>{tt('reports.costingMethod', 'Costing method')}</Label>
              <select
                className={selectCx}
                value={ui.costMethod}
                onChange={(e) => setCostMethod(e.target.value === 'FIFO' ? 'FIFO' : 'WA')}
              >
                <option value="WA">{tt('reports.weightedAverage', 'Weighted Average')}</option>
                <option value="FIFO">{tt('reports.fifo', 'FIFO')}</option>
              </select>
            </div>
            <div>
              <Label>{tt('reports.currency', 'Currency')}</Label>
              <select className={selectCx} value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value)}>
                {currencyOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => { const d = lastNDays(30); setStartDate(d.start); setEndDate(d.end) }}>
              {tt('reports.last30d', 'Last 30d')}
            </Button>
            <Button type="button" variant="outline" onClick={() => { const d = lastNDays(90); setStartDate(d.start); setEndDate(d.end) }}>
              {tt('reports.last90d', 'Last 90d')}
            </Button>
            <Button type="button" variant="outline" onClick={() => { const d = lastNDays(365); setStartDate(d.start); setEndDate(d.end) }}>
              {tt('reports.last365d', 'Last 365d')}
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center gap-2">
                <input
                  id="asof"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={valuationAsOfEnd}
                  onChange={(e) => setValuationAsOfEnd(e.target.checked)}
                />
                <Label htmlFor="asof">{tt('reports.asOfEnd', 'As of end date')}</Label>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{tt('reports.binNote', 'Bin-level valuation depends on movement bin tracking.')}</div>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div>
                  <Label>{tv('reports.fxPerBase', { code: baseCurrency }, `FX per ${baseCurrency}`)}</Label>
                  <Input
                    type="number"
                    step="0.000001"
                    value={fxRate}
                    onChange={(e) => setFxRate(Number(e.target.value) || 0)}
                    disabled={autoFx}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input id="autofx" type="checkbox" className="h-4 w-4" checked={autoFx} onChange={(e) => setAutoFx(e.target.checked)} />
                  <span>{tt('reports.autoFx', 'Auto FX')}</span>
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ReportTabFallback({ label }: { label: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
        Loading {label}…
      </CardContent>
    </Card>
  )
}

export default function Reports() {
  const { t } = useI18n()
  const [tab, setTab] = useState('summary')

  return (
    <ReportsProvider>
      <div className="space-y-6">
        <FiltersBar />

        <Tabs value={tab} onValueChange={setTab}>
          <div className="rounded-2xl border bg-card p-3 shadow-sm">
            <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/70 p-1">
              <TabsTrigger value="summary" className="rounded-lg">
                {t('reports.tab.summary')}
              </TabsTrigger>
              <TabsTrigger value="valuation" className="rounded-lg">
                {t('reports.tab.valuation')}
              </TabsTrigger>
              <TabsTrigger value="turnover" className="rounded-lg">
                {t('reports.tab.turnover')}
              </TabsTrigger>
              <TabsTrigger value="aging" className="rounded-lg">
                {t('reports.tab.aging')}
              </TabsTrigger>
              <TabsTrigger value="revenue" className="rounded-lg">
                {t('reports.tab.revenue')}
              </TabsTrigger>
              <TabsTrigger value="suppliers" className="rounded-lg">
                {t('reports.tab.suppliers')}
              </TabsTrigger>
              <TabsTrigger value="customers" className="rounded-lg">
                {t('reports.tab.customers')}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="summary">
            <Suspense fallback={<ReportTabFallback label={t('reports.tab.summary')} />}>
              <SummaryTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="valuation">
            <Suspense fallback={<ReportTabFallback label={t('reports.tab.valuation')} />}>
              <ValuationTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="turnover">
            <Suspense fallback={<ReportTabFallback label={t('reports.tab.turnover')} />}>
              <TurnoverTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="aging">
            <Suspense fallback={<ReportTabFallback label={t('reports.tab.aging')} />}>
              <AgingTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="revenue">
            <Suspense fallback={<ReportTabFallback label={t('reports.tab.revenue')} />}>
              <RevenueTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="suppliers">
            <Suspense fallback={<ReportTabFallback label={t('reports.tab.suppliers')} />}>
              <SuppliersTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="customers">
            <Suspense fallback={<ReportTabFallback label={t('reports.tab.customers')} />}>
              <CustomersTab />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </ReportsProvider>
  )
}
