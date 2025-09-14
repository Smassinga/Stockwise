// src/pages/reports/tabs/ValuationTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'

export default function ValuationTab() {
  const {
    valuationAsOfEnd, ui, valuationEngine, valuationCurrent, whById, binById,
    moneyText, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote
  } = useReports()

  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')

  // rows
  const rowsByWH: Row[] = [['Warehouse', `Value (${displayCurrency})`]]
  const pairs = valuationAsOfEnd
    ? Array.from(valuationEngine.valuationByWH_AsOfEnd.entries())
    : Array.from(valuationCurrent.byWH.entries())
  pairs.sort((a, b) => b[1] - a[1]).forEach(([wid, val]) => {
    rowsByWH.push([whById.get(wid)?.name || wid, Number(val)])
  })
  rowsByWH.push(['Total', pairs.reduce((s, [, v]) => s + v, 0)])

  const rowsByBin: Row[] = [['Warehouse', 'Bin', `Value (${displayCurrency})`]]
  Array.from(valuationCurrent.byBin.entries()).sort((a, b) => b[1] - a[1]).forEach(([key, val]) => {
    const [wid, bid] = key.split('|')
    const whName = whById.get(wid)?.name || wid
    const binCode = bid ? (binById.get(bid)?.code || bid) : '(no bin)'
    rowsByBin.push([whName, binCode, Number(val)])
  })

  const onCSV = () => {
    const titleWH = `Stock Valuation — ${valuationAsOfEnd ? `as of ${endDate}` : 'current snapshot'}`
    downloadCSV(`valuation_by_warehouse_${stamp}.csv`, [
      ...headerRows(ctx, titleWH),
      ...formatRowsForCSV(rowsByWH, ctx, [1]),
    ])
    downloadCSV(`valuation_by_bin_${stamp}.csv`, [
      ...headerRows(ctx, 'Stock Valuation — By Bin (current snapshot)'),
      ...formatRowsForCSV(rowsByBin, ctx, [2]),
    ])
  }

  const onXLSX = () => {
    saveXLSX(`valuation_${stamp}.xlsx`, ctx, [
      { title: 'By Warehouse', headerTitle: `Stock Valuation — ${valuationAsOfEnd ? `as of ${endDate}` : 'current snapshot'}`, body: rowsByWH, moneyCols: [1] },
      { title: 'By Bin', headerTitle: 'Stock Valuation — By Bin (current snapshot)', body: rowsByBin, moneyCols: [2] },
    ])
  }

  const onPDF = () => {
    const doc = startPDF(ctx, `Stock Valuation — ${valuationAsOfEnd ? `as of ${endDate}` : 'current snapshot'}`)
    pdfTable(doc, ['Warehouse', `Value (${displayCurrency})`], rowsByWH.slice(1), [1], ctx, 110)
    doc.addPage()
    pdfTable(doc, ['Warehouse', 'Bin', `Value (${displayCurrency})`], rowsByBin.slice(1), [2], ctx, 110)
    doc.save(`valuation_${stamp}.pdf`)
  }

  return (
    <Card>
      <CardHeader><CardTitle>Stock Valuation</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />

        {/* By Warehouse */}
        <div className="overflow-x-auto">
          <h3 className="font-medium mb-2">By Warehouse {valuationAsOfEnd ? `(as of end date, ${ui.costMethod})` : `(current snapshot)`}</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">Warehouse</th>
              <th className="py-2 pr-2">Value</th>
            </tr></thead>
            <tbody>
              {pairs.map(([wid, val]) => (
                <tr key={wid} className="border-b">
                  <td className="py-2 pr-2">{whById.get(wid)?.name || wid}</td>
                  <td className="py-2 pr-2">{moneyText(val)}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2 pr-2 font-medium">Total</td>
                <td className="py-2 pr-2 font-medium">{moneyText(pairs.reduce((s, [, v]) => s + v, 0))}</td>
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
