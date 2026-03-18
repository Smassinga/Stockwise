// src/pages/reports/tabs/ValuationTab.tsx
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { useI18n } from '../../../lib/i18n'
import { useReports } from '../context/ReportsProvider'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'

export default function ValuationTab() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => (t(key) === key ? fallback : t(key))
  const {
    valuationAsOfEnd,
    ui,
    valuationEngine,
    valuationCurrent,
    whById,
    binById,
    moneyText,
    startDate,
    endDate,
    displayCurrency,
    baseCurrency,
    fxRate,
    fxNote,
  } = useReports()

  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')
  const pairs = valuationAsOfEnd
    ? Array.from(valuationEngine.valuationByWH_AsOfEnd.entries())
    : Array.from(valuationCurrent.byWH.entries())
  const sortedWarehousePairs = [...pairs].sort((a, b) => b[1] - a[1])
  const sortedBinPairs = Array.from(valuationCurrent.byBin.entries()).sort((a, b) => b[1] - a[1])
  const warehouseTotal = sortedWarehousePairs.reduce((sum, [, value]) => sum + value, 0)

  const rowsByWH: Row[] = [[tt('reports.summary.valuation.warehouse', 'Warehouse'), `${tt('reports.summary.valuation.value', 'Value')} (${displayCurrency})`]]
  sortedWarehousePairs.forEach(([wid, val]) => {
    rowsByWH.push([whById.get(wid)?.name || wid, Number(val)])
  })
  rowsByWH.push([tt('reports.summary.valuation.total', 'Total'), warehouseTotal])

  const rowsByBin: Row[] = [[tt('reports.summary.valuation.warehouse', 'Warehouse'), tt('orders.binHint', 'Bin'), `${tt('reports.summary.valuation.value', 'Value')} (${displayCurrency})`]]
  sortedBinPairs.forEach(([key, val]) => {
    const [wid, bid] = key.split('|')
    const whName = whById.get(wid)?.name || wid
    const binCode = bid ? binById.get(bid)?.code || bid : tt('orders.noBin', '(no bin)')
    rowsByBin.push([whName, binCode, Number(val)])
  })

  const onCSV = async () => {
    const titleWH = `${tt('reports.tab.valuation', 'Valuation')} — ${valuationAsOfEnd ? `${tt('reports.asOfEnd', 'As of end date')} ${endDate}` : tt('reports.currentSnapshot', 'Current snapshot')}`
    await downloadCSV(`valuation_by_warehouse_${stamp}.csv`, [
      ...headerRows(ctx, titleWH),
      ...formatRowsForCSV(rowsByWH, ctx, [1]),
    ])
    await downloadCSV(`valuation_by_bin_${stamp}.csv`, [
      ...headerRows(ctx, `${tt('reports.tab.valuation', 'Valuation')} — ${tt('reports.binBreakdown', 'By bin')}`),
      ...formatRowsForCSV(rowsByBin, ctx, [2]),
    ])
  }

  const onXLSX = async () => {
    await saveXLSX(`valuation_${stamp}.xlsx`, ctx, [
      {
        title: tt('reports.sheet.byWarehouse', 'By warehouse'),
        headerTitle: `${tt('reports.tab.valuation', 'Valuation')} — ${valuationAsOfEnd ? `${tt('reports.asOfEnd', 'As of end date')} ${endDate}` : tt('reports.currentSnapshot', 'Current snapshot')}`,
        body: rowsByWH,
        moneyCols: [1],
      },
      {
        title: tt('reports.sheet.byBin', 'By bin'),
        headerTitle: `${tt('reports.tab.valuation', 'Valuation')} — ${tt('reports.binBreakdown', 'By bin')}`,
        body: rowsByBin,
        moneyCols: [2],
      },
    ])
  }

  const onPDF = async () => {
    const doc = await startPDF(ctx, `${tt('reports.tab.valuation', 'Valuation')} — ${valuationAsOfEnd ? `${tt('reports.asOfEnd', 'As of end date')} ${endDate}` : tt('reports.currentSnapshot', 'Current snapshot')}`)
    await pdfTable(doc, [tt('reports.summary.valuation.warehouse', 'Warehouse'), `${tt('reports.summary.valuation.value', 'Value')} (${displayCurrency})`], rowsByWH.slice(1), [1], ctx, 110)
    doc.addPage()
    await pdfTable(doc, [tt('reports.summary.valuation.warehouse', 'Warehouse'), tt('orders.binHint', 'Bin'), `${tt('reports.summary.valuation.value', 'Value')} (${displayCurrency})`], rowsByBin.slice(1), [2], ctx, 110)
    doc.save(`valuation_${stamp}.pdf`)
  }

  return (
    <Card className="rounded-2xl border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle>{tt('reports.tab.valuation', 'Valuation')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {valuationAsOfEnd
            ? tt('reports.valuationHelpAsOf', 'Use this view to review warehouse value at the selected period end, using the chosen costing method.')
            : tt('reports.valuationHelpCurrent', 'Use this view to review the current valuation position by warehouse and by bin.')}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} className="mt-0 justify-end" />

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.context.valuationMode', 'Valuation mode')}</p>
            <div className="mt-2 text-lg font-semibold">
              {valuationAsOfEnd ? tt('reports.asOfEnd', 'As of end date') : tt('reports.currentSnapshot', 'Current snapshot')}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{ui.costMethod}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.summary.valuation.total', 'Total')}</p>
            <div className="mt-2 text-lg font-semibold">{moneyText(warehouseTotal)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.tab.valuation', 'Valuation')} ({displayCurrency})</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.coverage', 'Coverage')}</p>
            <div className="mt-2 text-lg font-semibold">{sortedWarehousePairs.length} / {sortedBinPairs.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.coverageHelp', 'Warehouses / bins currently contributing to valuation.')}</p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">
                {tt('reports.summary.valuation.title', 'Valuation by Warehouse')} {valuationAsOfEnd ? `(${tt('reports.asOfEnd', 'As of end date')}, ${ui.costMethod})` : `(${tt('reports.currentSnapshot', 'Current snapshot')})`}
              </h3>
              <p className="text-xs text-muted-foreground">{tt('reports.valuationWarehouseHelp', 'Sort warehouses by value concentration so the largest inventory positions are visible first.')}</p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2">{tt('reports.summary.valuation.warehouse', 'Warehouse')}</th>
                    <th className="px-3 py-2 text-right">{tt('reports.summary.valuation.value', 'Value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedWarehousePairs.map(([wid, val]) => (
                    <tr key={wid} className="border-t">
                      <td className="px-3 py-3">{whById.get(wid)?.name || wid}</td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">{moneyText(val)}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/20">
                    <td className="px-3 py-3 font-medium">{tt('reports.summary.valuation.total', 'Total')}</td>
                    <td className="px-3 py-3 text-right font-mono font-medium tabular-nums">{moneyText(warehouseTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{tt('reports.binBreakdown', 'By bin')}</h3>
              <p className="text-xs text-muted-foreground">{tt('reports.binBreakdownHelp', 'Use the bin breakdown to spot where value is physically sitting inside each warehouse footprint.')}</p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2">{tt('reports.summary.valuation.warehouse', 'Warehouse')}</th>
                    <th className="px-3 py-2">{tt('orders.binHint', 'Bin')}</th>
                    <th className="px-3 py-2 text-right">{tt('reports.summary.valuation.value', 'Value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedBinPairs.map(([key, val]) => {
                    const [wid, bid] = key.split('|')
                    const whName = whById.get(wid)?.name || wid
                    const binCode = bid ? binById.get(bid)?.code || bid : tt('orders.noBin', '(no bin)')
                    return (
                      <tr key={key} className="border-t">
                        <td className="px-3 py-3">{whName}</td>
                        <td className="px-3 py-3">{binCode}</td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">{moneyText(val)}</td>
                      </tr>
                    )
                  })}
                  {!sortedBinPairs.length && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-sm text-muted-foreground">
                        {tt('reports.noBinValuationRows', 'No bin-level valuation rows are available for the current company and filters.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/15 p-3 text-xs text-muted-foreground">
              {tt('reports.binValuationCaptureHelp', 'Bin-level valuation stays strongest when movements capture source and destination bin references consistently.')}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
