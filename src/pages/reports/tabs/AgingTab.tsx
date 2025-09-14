// src/pages/reports/tabs/AgingTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'

export default function AgingTab() {
  const { aging, moneyText, fmt } = useReports()

  return (
    <Card>
      <CardHeader><CardTitle>Aging Buckets</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-x-auto">
          <h3 className="font-medium mb-2">By Warehouse</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Warehouse</th>
                <th className="py-2 pr-2">Total Qty</th>
                <th className="py-2 pr-2">Total Value</th>
                {aging.buckets.map(b => <th key={b} className="py-2 pr-2">{b}</th>)}
              </tr>
            </thead>
            <tbody>
              {aging.rowsWH.map(r => (
                <tr key={r.warehouseId} className="border-b">
                  <td className="py-2 pr-2">{r.warehouseName}</td>
                  <td className="py-2 pr-2">{fmt(r.qty, 2)}</td>
                  <td className="py-2 pr-2">{moneyText(r.value)}</td>
                  {aging.buckets.map(b => (
                    <td key={b} className="py-2 pr-2">
                      {fmt(r.byBucket[b].qty, 2)} / {moneyText(r.byBucket[b].value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto">
          <h3 className="font-medium mb-2">By Bin (current snapshot)</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Warehouse</th>
                <th className="py-2 pr-2">Bin</th>
                <th className="py-2 pr-2">Total Qty</th>
                <th className="py-2 pr-2">Total Value</th>
                {aging.buckets.map(b => <th key={b} className="py-2 pr-2">{b}</th>)}
              </tr>
            </thead>
            <tbody>
              {aging.rowsBin.map(r => (
                <tr key={`${r.warehouseId}|${r.binId || ''}`} className="border-b">
                  <td className="py-2 pr-2">{r.warehouseName}</td>
                  <td className="py-2 pr-2">{r.binCode}</td>
                  <td className="py-2 pr-2">{fmt(r.qty, 2)}</td>
                  <td className="py-2 pr-2">{moneyText(r.value)}</td>
                  {aging.buckets.map(b => (
                    <td key={b} className="py-2 pr-2">
                      {fmt(r.byBucket[b].qty, 2)} / {moneyText(r.byBucket[b].value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
