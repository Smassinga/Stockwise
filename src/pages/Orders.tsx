// src/pages/Orders.tsx
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { useI18n } from '../lib/i18n'
import PurchaseOrders from './Orders/PurchaseOrders'
import SalesOrders from './Orders/SalesOrders'

export default function OrdersPage() {
  const { t } = useI18n()
  const tt = (k: string, f: string) => (t(k) === k ? f : t(k))
  const [tab, setTab] = useState<'purchase' | 'sales'>('purchase')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{tt('orders.title', 'Orders')}</h1>
        <div className="flex gap-2">
          <Button variant={tab === 'purchase' ? 'default' : 'outline'} onClick={() => setTab('purchase')}>
            {tt('orders.purchaseTab', 'Purchase')}
          </Button>
          <Button variant={tab === 'sales' ? 'default' : 'outline'} onClick={() => setTab('sales')}>
            {tt('orders.salesTab', 'Sales')}
          </Button>
        </div>
      </div>

      {tab === 'purchase' ? <PurchaseOrders /> : <SalesOrders />}
    </div>
  )
}

export function Orders() { return <OrdersPage /> }
