// src/pages/reports/tabs/ValuationTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'

export default function ValuationTab() {
  const { valuationAsOfEnd, ui, valuationEngine, valuationCurrent, whById, binById, moneyText,  } = useReports()

  return (
    <Card>
      <CardHeader><CardTitle>Stock Valuation</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        {/* By Warehouse */}
        <div className="overflow-x-auto">
          <h3 className="font-medium mb-2">By Warehouse {valuationAsOfEnd ? `(as of end date, ${ui.costMethod})` : `(current snapshot)`}</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">Warehouse</th>
              <th className="py-2 pr-2">Value</th>
            </tr></thead>
            <tbody>
              {(valuationAsOfEnd
                ? Array.from(valuationEngine.valuationByWH_AsOfEnd.entries())
                : Array.from(valuationCurrent.byWH.entries())
              ).sort((a,b)=>b[1]-a[1]).map(([wid, val]) => (
                <tr key={wid} className="border-b">
                  <td className="py-2 pr-2">{whById.get(wid)?.name || wid}</td>
                  <td className="py-2 pr-2">{moneyText(val)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-2 font-medium">Total</td>
                <td className="py-2 pr-2 font-medium">
                  {moneyText(valuationAsOfEnd
                    ? Array.from(valuationEngine.valuationByWH_AsOfEnd.values()).reduce((s,v)=>s+v,0)
                    : valuationCurrent.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* By Bin (snapshot) */}
        <div className="overflow-x-auto">
          <h3 className="font-medium mb-2">By Bin (current snapshot)</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">Warehouse</th>
              <th className="py-2 pr-2">Bin</th>
              <th className="py-2 pr-2">Value</th>
            </tr></thead>
            <tbody>
              {Array.from(valuationCurrent.byBin.entries()).sort((a,b)=>b[1]-a[1]).map(([key, val]) => {
                const [wid, bid] = key.split('|')
                const whName = whById.get(wid)?.name || wid
                const binCode = bid ? (binById.get(bid)?.code || bid) : '(no bin)'
                return (
                  <tr key={key} className="border-b">
                    <td className="py-2 pr-2">{whName}</td>
                    <td className="py-2 pr-2">{binCode}</td>
                    <td className="py-2 pr-2">{moneyText(val)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="text-xs text-muted-foreground mt-2">
            To enable FIFO by Bin, record <code>binFromId</code>/<code>binToId</code> on movements.
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
