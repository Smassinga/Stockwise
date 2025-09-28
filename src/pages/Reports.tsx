// src/pages/Reports.tsx
import { lazy, Suspense } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Label } from '../components/ui/label'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Link } from 'react-router-dom'

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
  const {
    ui,
    startDate, endDate, setStartDate, setEndDate,
    lastNDays, setCostMethod,
    valuationAsOfEnd, setValuationAsOfEnd,
    baseCurrency, displayCurrency, setDisplayCurrency,
    fxRate, setFxRate, autoFx, setAutoFx,
    currencyOptions,
  } = useReports()

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
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Start</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(30); setStartDate(d.start); setEndDate(d.end) }}>Last 30d</Button>
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(90); setStartDate(d.start); setEndDate(d.end) }}>Last 90d</Button>
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(365); setStartDate(d.start); setEndDate(d.end) }}>Last 365d</Button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Costing Method</Label>
              <select
                className="w-full border rounded-md h-9 px-2"
                value={ui.costMethod}
                onChange={e => setCostMethod(e.target.value === 'FIFO' ? 'FIFO' : 'WA')}
              >
                <option value="WA">Weighted Average</option>
                <option value="FIFO">FIFO</option>
              </select>
            </div>
            <div>
              <Label>Valuation Timing</Label>
              <div className="flex items-center gap-2 h-9">
                <input
                  id="asof"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={valuationAsOfEnd}
                  onChange={e => setValuationAsOfEnd(e.target.checked)}
                />
                <Label htmlFor="asof">Use valuation as of end date (warehouse level)</Label>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Bin-level valuation uses the current snapshot until movements include bin IDs.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Currency</Label>
                <select
                  className="w-full border rounded-md h-9 px-2"
                  value={displayCurrency}
                  onChange={e => setDisplayCurrency(e.target.value)}
                >
                  {currencyOptions.map(code => (<option key={code} value={code}>{code}</option>))}
                </select>
              </div>
              <div>
                <Label>FX rate (per {baseCurrency})</Label>
                <Input
                  type="number"
                  step="0.000001"
                  value={fxRate}
                  onChange={e => setFxRate(Number(e.target.value) || 0)}
                  disabled={autoFx}
                />
                <div className="flex items-center gap-2 mt-1">
                  <input id="autofx" type="checkbox" className="h-4 w-4" checked={autoFx} onChange={e => setAutoFx(e.target.checked)} />
                  <Label htmlFor="autofx" className="text-xs">Auto FX (use latest rate on/before End date)</Label>
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
  return (
    <ReportsProvider>
      <div className="p-4 space-y-6">
        <FiltersBar />

        <Tabs defaultValue="summary">
          <TabsList className="mb-4 flex-wrap">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="valuation">Valuation</TabsTrigger>
            <TabsTrigger value="turnover">Turnover</TabsTrigger>
            <TabsTrigger value="aging">Aging</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            {/* NEW */}
            <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
          </TabsList>

          <TabsContent value="summary">
            <Suspense fallback={<div>Loading Summary…</div>}>
              <SummaryTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="valuation">
            <Suspense fallback={<div>Loading Valuation…</div>}>
              <ValuationTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="turnover">
            <Suspense fallback={<div>Loading Turnover…</div>}>
              <TurnoverTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="aging">
            <Suspense fallback={<div>Loading Aging…</div>}>
              <AgingTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="revenue">
            <Suspense fallback={<div>Loading Revenue…</div>}>
              <RevenueTab />
            </Suspense>
          </TabsContent>

          {/* NEW: Suppliers */}
          <TabsContent value="suppliers">
            <Suspense fallback={<div>Loading Suppliers…</div>}>
              <SuppliersTab />
            </Suspense>
          </TabsContent>

          {/* NEW: Customers */}
          <TabsContent value="customers">
            <Suspense fallback={<div>Loading Customers…</div>}>
              <CustomersTab />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </ReportsProvider>
  )
}
