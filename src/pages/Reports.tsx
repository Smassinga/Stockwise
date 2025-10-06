// src/pages/Reports.tsx
import { lazy, Suspense } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Label } from '../components/ui/label'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n'

import { ReportsProvider, useReports } from './reports/context/ReportsProvider'

// lazy tabs
const SummaryTab   = lazy(() => import('./reports/tabs/SummaryTab'))
const ValuationTab = lazy(() => import('./reports/tabs/ValuationTab'))
const TurnoverTab  = lazy(() => import('./reports/tabs/TurnoverTab'))
const AgingTab     = lazy(() => import('./reports/tabs/AgingTab'))
const RevenueTab   = lazy(() => import('./reports/tabs/RevenueTab'))

// NEW: supplier / customer statement tabs
const SuppliersTab = lazy(() => import('./reports/tabs/SuppliersTab'))
const CustomersTab = lazy(() => import('./reports/tabs/CustomersTab'))

function FiltersBar() {
  const { t } = useI18n()
  const {
    ui,
    startDate, endDate, setStartDate, setEndDate,
    lastNDays, setCostMethod,
    valuationAsOfEnd, setValuationAsOfEnd,
    baseCurrency, displayCurrency, setDisplayCurrency,
    fxRate, setFxRate, autoFx, setAutoFx,
    currencyOptions,
  } = useReports()

  // Higher-contrast select styling for light theme, still theme-aware
  const selectCx =
    "w-full h-9 rounded-md border border-input bg-background text-foreground px-2 pr-8 " +
    "shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background " +
    "disabled:opacity-50";

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl md:text-3xl font-bold">
          <Link to="/settings" className="underline decoration-dotted underline-offset-4 hover:opacity-80">
            {ui.companyName}
          </Link>
          {' — '}
          {ui.subtitle}
        </h1>
        <div className="text-xs text-muted-foreground">
          Money shown in {displayCurrency}
          {fxRate !== 1 ? ` @ FX ${fxRate.toFixed(6)} per ${baseCurrency}` : ''}
          {ui.fxNote ? ` • ${ui.fxNote}` : ''}
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>{t('reports.filters')}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>{t('reports.start')}</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>{t('reports.end')}</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(30); setStartDate(d.start); setEndDate(d.end) }}>{t('reports.last30d')}</Button>
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(90); setStartDate(d.start); setEndDate(d.end) }}>{t('reports.last90d')}</Button>
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(365); setStartDate(d.start); setEndDate(d.end) }}>{t('reports.last365d')}</Button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>{t('reports.costingMethod')}</Label>
              <select
                className={selectCx} // ← updated
                value={ui.costMethod}
                onChange={e => setCostMethod(e.target.value === 'FIFO' ? 'FIFO' : 'WA')}
              >
                <option value="WA">{t('reports.weightedAverage')}</option>
                <option value="FIFO">{t('reports.fifo')}</option>
              </select>
            </div>
            <div>
              <Label>{t('reports.valuationTiming')}</Label>
              <div className="flex items-center gap-2 h-9">
                <input
                  id="asof"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={valuationAsOfEnd}
                  onChange={e => setValuationAsOfEnd(e.target.checked)}
                />
                <Label htmlFor="asof">{t('reports.asOfEnd')}</Label>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {t('reports.binNote')}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t('reports.currency')}</Label>
                <select
                  className={selectCx} // ← updated
                  value={displayCurrency}
                  onChange={e => setDisplayCurrency(e.target.value)}
                >
                  {currencyOptions.map(code => (<option key={code} value={code}>{code}</option>))}
                </select>
              </div>
              <div>
                <Label>{t('reports.fxPerBase', { code: baseCurrency })}</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={fxRate}
                  onChange={e => setFxRate(Number(e.target.value) || 0)}
                  disabled={autoFx}
                />
                <div className="flex items-center gap-2 mt-1">
                  <input id="autofx" type="checkbox" className="h-4 w-4" checked={autoFx} onChange={e => setAutoFx(e.target.checked)} />
                  <Label htmlFor="autofx" className="text-xs">{t('reports.autoFx')}</Label>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

export default function Reports() {
  const { t } = useI18n()
  return (
    <ReportsProvider>
      <div className="p-4 space-y-6 mobile-container w-full max-w-full overflow-x-hidden">
        <FiltersBar />

        <Tabs defaultValue="summary">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="summary">{t('reports.tab.summary')}</TabsTrigger>
            <TabsTrigger value="valuation">{t('reports.tab.valuation')}</TabsTrigger>
            <TabsTrigger value="turnover">{t('reports.tab.turnover')}</TabsTrigger>
            <TabsTrigger value="aging">{t('reports.tab.aging')}</TabsTrigger>
            <TabsTrigger value="revenue">{t('reports.tab.revenue')}</TabsTrigger>
            {/* NEW */}
            <TabsTrigger value="suppliers">{t('reports.tab.suppliers')}</TabsTrigger>
            <TabsTrigger value="customers">{t('reports.tab.customers')}</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <Suspense fallback={<div>{t('loading')} {t('reports.tab.summary')}…</div>}>
              <SummaryTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="valuation">
            <Suspense fallback={<div>{t('loading')} {t('reports.tab.valuation')}…</div>}>
              <ValuationTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="turnover">
            <Suspense fallback={<div>{t('loading')} {t('reports.tab.turnover')}…</div>}>
              <TurnoverTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="aging">
            <Suspense fallback={<div>{t('loading')} {t('reports.tab.aging')}…</div>}>
              <AgingTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="revenue">
            <Suspense fallback={<div>{t('loading')} {t('reports.tab.revenue')}…</div>}>
              <RevenueTab />
            </Suspense>
          </TabsContent>

          {/* NEW: Suppliers */}
          <TabsContent value="suppliers">
            <Suspense fallback={<div>{t('loading')} {t('reports.tab.suppliers')}…</div>}>
              <SuppliersTab />
            </Suspense>
          </TabsContent>

          {/* NEW: Customers */}
          <TabsContent value="customers">
            <Suspense fallback={<div>{t('loading')} {t('reports.tab.customers')}…</div>}>
              <CustomersTab />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </ReportsProvider>
  )
}
