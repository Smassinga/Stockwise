// src/pages/reports/tabs/RevenueTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'

export default function RevenueTab() {
  const { revenueByCustomer, moneyText, ordersUnavailable, cashUnavailable } = useReports()

  return (
    <Card>
      <CardHeader><CardTitle>Revenue by Customer</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        {(ordersUnavailable || cashUnavailable) && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
            {ordersUnavailable && cashUnavailable && 'No revenue sources are connected. Configure order/cash sources in Settings.'}
            {ordersUnavailable && !cashUnavailable && 'Orders source not connected — showing only Cash/POS sales.'}
            {!ordersUnavailable && cashUnavailable && 'Cash/POS source not connected — showing only Orders.'}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-2">Customer</th>
              <th className="py-2 pr-2">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {revenueByCustomer.rows.length === 0 && (
              <tr>
                <td colSpan={2} className="py-4 text-muted-foreground">No revenue in the selected period.</td>
              </tr>
            )}
            {revenueByCustomer.rows.map(r => (
              <tr key={r.customerId} className="border-b">
                <td className="py-2 pr-2">{r.customerName}</td>
                <td className="py-2 pr-2">{moneyText(r.baseAmount)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-2 font-medium">Total</td>
              <td className="py-2 pr-2 font-medium">{moneyText(revenueByCustomer.grandTotalBase)}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
