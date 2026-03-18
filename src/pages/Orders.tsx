import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useI18n } from '../lib/i18n'

const PurchaseOrders = lazy(() => import('./Orders/PurchaseOrders'))
const SalesOrders = lazy(() => import('./Orders/SalesOrders'))

export default function OrdersPage() {
  const { t } = useI18n()
  const tt = (k: string, f: string) => (t(k) === k ? f : t(k))
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') === 'sales' ? 'sales' : 'purchase'
  const [tab, setTab] = useState<'purchase' | 'sales'>(requestedTab)

  useEffect(() => {
    if (requestedTab !== tab) setTab(requestedTab)
  }, [requestedTab, tab])

  function updateTab(next: 'purchase' | 'sales') {
    setTab(next)
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('orders.workspace', 'Order workspace')}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('orders.title', 'Orders')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {tt('orders.subtitle', 'Create, review, receive, and ship orders here. Open balances now live in a dedicated settlements workflow so the order list can stay operationally focused.')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/settlements">{tt('settlements.title', 'Receivables & Payables')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/landed-cost">{tt('landedCost.title', 'Landed Cost')}</Link>
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Tabs value={tab} onValueChange={(value) => updateTab(value as 'purchase' | 'sales')}>
            <TabsList className="h-auto w-full justify-start gap-1 rounded-xl bg-muted/70 p-1 md:w-auto">
              <TabsTrigger value="purchase" className="min-w-[140px] rounded-lg">
                {tt('orders.purchaseTab', 'Purchase')}
              </TabsTrigger>
              <TabsTrigger value="sales" className="min-w-[140px] rounded-lg">
                {tt('orders.salesTab', 'Sales')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="text-sm text-muted-foreground">
            {tab === 'purchase'
              ? tt('orders.purchaseHint', 'Use purchase orders for supplier commitments, receiving, and landed-cost prep.')
              : tt('orders.salesHint', 'Use sales orders for customer commitments, fulfilment, and receivables tracking.')}
          </div>
        </div>
      </div>

      <Suspense
        fallback={
          <Card className="border-dashed">
            <CardContent className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
              {tt('orders.loadingWorkspace', 'Loading order workspace…')}
            </CardContent>
          </Card>
        }
      >
        {tab === 'purchase' ? <PurchaseOrders /> : <SalesOrders />}
      </Suspense>
    </div>
  )
}

export function Orders() { return <OrdersPage /> }
