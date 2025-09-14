// src/pages/reports/tabs/SummaryTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'
import KPI from '../KPI'

export default function SummaryTab() {
  const {
    turnoverPerItem, turnoverSummary, bestWorst,
    valuationAsOfEnd, ui, valuationEngine, valuationCurrent,
    whById, period, itemById, moneyText, fmt,
  } = useReports()

  // Local numeric helper (replaces the old `n`)
  const num = (v: any, d = 0) => {
    const x = Number(v)
    return Number.isFinite(x) ? x : d
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <KPI label="Days in period" value={fmt(turnoverPerItem.daysInPeriod, 0)} />
          <KPI label="Units sold" value={fmt(turnoverSummary.totalSold, 2)} />
          <KPI label="Avg inventory (units)" value={fmt(turnoverSummary.avgInv, 2)} />
          <KPI label="Turns (units)" value={fmt(turnoverSummary.turns, 2)} />
          <KPI
            label="Avg days to sell"
            value={turnoverSummary.avgDaysToSell != null ? fmt(turnoverSummary.avgDaysToSell, 1) : '—'}
          />
          <KPI label="COGS (period)" value={moneyText(turnoverSummary.totalCOGS)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <Card className="border-dashed">
            <CardHeader><CardTitle>Best &amp; Worst Sellers (by units)</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 pr-2 font-medium">Best</td>
                    <td className="py-2 pr-2">
                      {bestWorst.best ? `${bestWorst.best.item!.name} (${fmt(bestWorst.best.qty, 2)} units)` : '—'}
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-2 font-medium">Worst</td>
                    <td className="py-2 pr-2">
                      {bestWorst.worst ? `${bestWorst.worst.item!.name} (${fmt(bestWorst.worst.qty, 2)} units)` : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 font-medium">Zero sales</td>
                    <td className="py-2 pr-2">{fmt(bestWorst.zeroSales, 0)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="border-dashed md:col-span-2">
            <CardHeader>
              <CardTitle>
                Valuation by Warehouse {valuationAsOfEnd ? `(as of end date, ${ui.costMethod})` : `(current snapshot)`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">Warehouse</th>
                    <th className="py-2 pr-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(valuationAsOfEnd
                    ? Array.from(valuationEngine.valuationByWH_AsOfEnd.entries())
                    : Array.from(valuationCurrent.byWH.entries())
                  ).sort((a, b) => b[1] - a[1]).map(([wid, val]) => (
                    <tr key={wid} className="border-b">
                      <td className="py-2 pr-2">{whById.get(wid)?.name || wid}</td>
                      <td className="py-2 pr-2">{moneyText(val)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-2 font-medium">Total</td>
                    <td className="py-2 pr-2 font-medium">
                      {moneyText(valuationAsOfEnd
                        ? Array.from(valuationEngine.valuationByWH_AsOfEnd.values()).reduce((s, v) => s + v, 0)
                        : valuationCurrent.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <Card className="border-dashed">
            <CardHeader><CardTitle>Movements (in period) — Audit trail</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">Time</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Item</th>
                    <th className="py-2 pr-2">Qty</th>
                    <th className="py-2 pr-2">Unit Cost</th>
                    <th className="py-2 pr-2">Warehouse From</th>
                    <th className="py-2 pr-2">Warehouse To</th>
                  </tr>
                </thead>
                <tbody>
                  {period.inRange.length === 0 && (
                    <tr><td colSpan={7} className="py-4 text-muted-foreground">No movements in the selected period.</td></tr>
                  )}
                  {period.inRange.map(m => {
                    const created =
                      m?.createdAt ?? m?.created_at ?? m?.createdat
                    const t = created ? new Date(created).toLocaleString() : ''
                    const it = itemById.get(m.itemId)
                    const wFrom = m.warehouseFromId || ''
                    const wTo = m.warehouseToId || m.warehouseId || ''
                    const qty = Math.abs(num(m.qtyBase ?? m.qty, 0))
                    return (
                      <tr key={m.id} className="border-b">
                        <td className="py-2 pr-2">{t}</td>
                        <td className="py-2 pr-2">{(m.type || '').toUpperCase()}</td>
                        <td className="py-2 pr-2">{it?.name || m.itemId}</td>
                        <td className="py-2 pr-2">{fmt(qty, 2)}</td>
                        <td className="py-2 pr-2">{moneyText(num(m.unitCost, 0))}</td>
                        <td className="py-2 pr-2">{wFrom || '—'}</td>
                        <td className="py-2 pr-2">{wTo || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}
