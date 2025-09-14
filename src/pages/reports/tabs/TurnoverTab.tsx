// src/pages/reports/tabs/TurnoverTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'

export default function TurnoverTab() {
  const { turnoverPerItem, moneyText, fmt } = useReports()

  return (
    <Card>
      <CardHeader><CardTitle>Turnover (Units) &amp; Avg Days to Sell</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b">
            <th className="py-2 pr-2">Item</th>
            <th className="py-2 pr-2">SKU</th>
            <th className="py-2 pr-2">Sold (period)</th>
            <th className="py-2 pr-2">Begin Units</th>
            <th className="py-2 pr-2">End Units</th>
            <th className="py-2 pr-2">Avg Units</th>
            <th className="py-2 pr-2">Turns</th>
            <th className="py-2 pr-2">Avg Days to Sell</th>
            <th className="py-2 pr-2">COGS</th>
          </tr></thead>
          <tbody>
            {turnoverPerItem.rows.length === 0 && (
              <tr><td colSpan={9} className="py-4 text-muted-foreground">No movements in the selected period.</td></tr>
            )}
            {turnoverPerItem.rows.map(r => (
              <tr key={r.itemId} className="border-b">
                <td className="py-2 pr-2">{r.name}</td>
                <td className="py-2 pr-2">{r.sku}</td>
                <td className="py-2 pr-2">{fmt(r.sold, 2)}</td>
                <td className="py-2 pr-2">{fmt(r.beginUnits, 2)}</td>
                <td className="py-2 pr-2">{fmt(r.endUnits, 2)}</td>
                <td className="py-2 pr-2">{fmt(r.avgUnits, 2)}</td>
                <td className="py-2 pr-2">{fmt(r.turns, 2)}</td>
                <td className="py-2 pr-2">{r.avgDaysToSell != null ? fmt(r.avgDaysToSell, 1) : '—'}</td>
                <td className="py-2 pr-2">{moneyText(Number(r.cogs ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
