import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Building2, FilePlus2, List, ReceiptText } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'

const PurchaseOrders = lazy(() => import('./Orders/PurchaseOrders'))
const SalesOrders = lazy(() => import('./Orders/SalesOrders'))

export default function OrdersPage() {
  const { t } = useI18n()
  const tt = (k: string, f: string) => (t(k) === k ? f : t(k))
  const { companyName } = useOrg()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab') === 'sales' ? 'sales' : 'purchase'
  const requestedView = searchParams.get('orderId')
    ? 'detail'
    : searchParams.get('view') === 'create'
      ? 'create'
      : 'register'
  const [tab, setTab] = useState<'purchase' | 'sales'>(requestedTab)

  useEffect(() => {
    if (requestedTab !== tab) setTab(requestedTab)
  }, [requestedTab, tab])

  function updateTab(next: 'purchase' | 'sales') {
    setTab(next)
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    params.set('view', 'register')
    params.delete('orderId')
    setSearchParams(params, { replace: true })
  }

  function updateView(next: 'register' | 'create') {
    const params = new URLSearchParams(searchParams)
    params.set('tab', tab)
    params.set('view', next)
    if (next !== 'register') params.delete('orderId')
    setSearchParams(params)
  }

  const isSales = tab === 'sales'

  return (
    <div className="space-y-6">
      <PremiumRegisterHeader
        eyebrow={tt('orders.workspace', 'Order workspace')}
        title={isSales ? tt('orders.salesWorkspaceTitle', 'Sales Orders') : tt('orders.purchaseWorkspaceTitle', 'Purchase Orders')}
        description={isSales
          ? tt('orders.salesWorkspaceDescription', 'Manage customer commitments, approval, fulfilment, and the handoff to legal Sales Invoices.')
          : tt('orders.purchaseWorkspaceDescription', 'Manage supplier commitments, approval, receipt, and the independent handoff to Vendor Bills.')}
        badges={
          <>
            <PremiumStatusBadge tone="info" icon={<Building2 />}>
              {companyName || tt('orders.activeCompanyUnavailable', 'Active company unavailable')}
            </PremiumStatusBadge>
            <PremiumStatusBadge tone="neutral">
              {requestedView === 'detail'
                ? tt('orders.viewDetail', 'Detail')
                : requestedView === 'create'
                  ? tt('orders.viewCreate', 'Create draft')
                  : tt('orders.viewRegister', 'Register')}
            </PremiumStatusBadge>
          </>
        }
        actions={
          <>
            <Button
              variant={requestedView === 'register' ? 'secondary' : 'outline'}
              onClick={() => updateView('register')}
            >
              <List className="mr-2 h-4 w-4" />
              {tt('orders.viewRegister', 'Register')}
            </Button>
            <Button onClick={() => updateView('create')}>
              <FilePlus2 className="mr-2 h-4 w-4" />
              {isSales ? tt('orders.newSO', 'New Sales Order') : tt('orders.newPO', 'New Purchase Order')}
            </Button>
          </>
        }
      />

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

          <div className="flex flex-wrap items-center gap-2">
            <p className="max-w-2xl text-sm text-muted-foreground">
              {tab === 'purchase'
                ? tt('orders.purchaseHint', 'Use purchase orders for supplier commitments, approvals, receiving, and landed-cost prep.')
                : tt('orders.salesHint', 'Use sales orders for customer commitments, approvals, allocation, and fulfilment.')}
            </p>
            <Button asChild size="sm" variant="outline">
              <Link to={isSales ? '/sales-invoices' : '/vendor-bills'}>
                <ReceiptText className="mr-2 h-4 w-4" />
                {isSales ? tt('financeDocs.salesInvoices.title', 'Sales Invoices') : tt('financeDocs.vendorBills.title', 'Vendor Bills')}
              </Link>
            </Button>
            {!isSales ? (
              <Button asChild size="sm" variant="outline">
                <Link to="/landed-cost">{tt('landedCost.title', 'Landed Cost')}</Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="ghost">
              <Link to="/settlements">{tt('settlements.title', 'Collections & Payments')}</Link>
            </Button>
          </div>
        </div>
      </div>

      <Suspense
        fallback={
          <Card className="border-dashed">
            <CardContent className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
              {tt('orders.loadingWorkspace', 'Loading order workspace...')}
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
