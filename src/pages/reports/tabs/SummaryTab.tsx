// src/pages/reports/tabs/SummaryTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'
import KPI from '../KPI'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'

export default function SummaryTab() {
  const {
    turnoverPerItem, turnoverSummary, bestWorst,
    valuationAsOfEnd, ui, valuationEngine, valuationCurrent,
    whById, period, itemById, moneyText, fmt,
    displayCurrency, fxRate, baseCurrency, fxNote, startDate, endDate,
  } = useReports()

  const ctx = {
    companyName: ui.companyName,
    startDate, endDate,
    displayCurrency, baseCurrency, fxRate, fxNote,
  }

  const stamp = endDate.replace(/-/g, '')

  // ----- build export rows -----
  const kpiRows: Row[] = [
    ['Metric', 'Value'],
    ['Days in period', Number(turnoverPerItem.daysInPeriod)],
    ['Units sold', Number(turnoverSummary.totalSold)],
    ['Avg inventory (units)', Number(turnoverSummary.avgInv)],
    ['Turns (units)', Number(turnoverSummary.turns)],
    ['Avg days to sell', turnoverSummary.avgDaysToSell != null ? Number(turnoverSummary.avgDaysToSell) : ''],
    ['COGS (period)', Number(turnoverSummary.totalCOGS)],
    ['Valuation total', Number(valuationAsOfEnd
      ? Array.from(valuationEngine.valuationByWH_AsOfEnd.values()).reduce((s, v) => s + v, 0)
      : valuationCurrent.total)],
  ]

  const movementsRows: Row[] = [
    ['Time', 'Type', 'Item', 'Qty', 'Unit Cost', 'Warehouse From', 'Warehouse To'],
    ...period.inRange.map(m => {
      const created = m?.createdAt ?? m?.created_at ?? m?.createdat
      const t = created ? new Date(created).toLocaleString() : ''
      const it = itemById.get(m.itemId)
      const qty = Math.abs(Number(m.qtyBase ?? m.qty) || 0)
      const wFrom = m.warehouseFromId || ''
      const wTo = m.warehouseToId || m.warehouseId || ''
      return [t, (m.type || '').toUpperCase(), it?.name || m.itemId, qty, Number(m.unitCost || 0), wFrom || '—', wTo || '—'] as Row
    }),
  ]

  // ----- handlers -----
  const onCSV = () => {
    downloadCSV(`summary_kpis_${stamp}.csv`, [
      ...headerRows(ctx, 'Summary — KPIs'),
      ...formatRowsForCSV(kpiRows, ctx, [1], []),
    ])
    downloadCSV(`summary_movements_${stamp}.csv`, [
      ...headerRows(ctx, 'Summary — Movements (audit)'),
      ...formatRowsForCSV(movementsRows, ctx, [4], [3]),
    ])
  }

  const onXLSX = () => {
    saveXLSX(`summary_${stamp}.xlsx`, ctx, [
      { title: 'KPIs', headerTitle: 'Summary — KPIs', body: kpiRows, moneyCols: [1] },
      { title: 'Movements', headerTitle: 'Summary — Movements (audit)', body: movementsRows, moneyCols: [4], qtyCols: [3] },
    ])
  }

  const onPDF = () => {
    const doc = startPDF(ctx, 'Summary — KPIs')
    pdfTable(doc, ['Metric', 'Value'], kpiRows.slice(1), [1], ctx, 110)
    doc.addPage()
    pdfTable(doc, ['Time','Type','Item','Qty','Unit Cost','Warehouse From','Warehouse To'],
      movementsRows.slice(1), [4], ctx, 110)
    doc.save(`summary_${stamp}.pdf`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />

        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <KPI label="Days in period" value={fmt(turnoverPerItem.daysInPeriod, 0)} />
          <KPI label="Units sold" value={fmt(turnoverSummary.totalSold, 2)} />
          <KPI label="Avg inventory (units)" value={fmt(turnoverSummary.avgInv, 2)} />
          <KPI label="Turns (units)" value={fmt(turnoverSummary.turns, 2)} />
          <KPI label="Avg days to sell" value={turnoverSummary.avgDaysToSell != null ? fmt(turnoverSummary.avgDaysToSell, 1) : '—'} />
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
                    const created = m?.createdAt ?? m?.created_at ?? m?.createdat
                    const t = created ? new Date(created).toLocaleString() : ''
                    const it = itemById.get(m.itemId)
                    const wFrom = m.warehouseFromId || ''
                    const wTo = m.warehouseToId || m.warehouseId || ''
                    const qty = Math.abs(Number(m.qtyBase ?? m.qty) || 0)
                    return (
                      <tr key={m.id} className="border-b">
                        <td className="py-2 pr-2">{t}</td>
                        <td className="py-2 pr-2">{(m.type || '').toUpperCase()}</td>
                        <td className="py-2 pr-2">{it?.name || m.itemId}</td>
                        <td className="py-2 pr-2">{fmt(qty, 2)}</td>
                        <td className="py-2 pr-2">{moneyText(Number(m.unitCost || 0))}</td>
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
