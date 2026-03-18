// src/pages/reports/tabs/AgingTab.tsx
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { useI18n } from '../../../lib/i18n'
import { useReports } from '../context/ReportsProvider'
import ExportButtons from '../components/ExportButtons'
import { headerRows, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'

export default function AgingTab() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => (t(key) === key ? fallback : t(key))
  const { aging, moneyText, fmt, ui, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote } = useReports()

  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')
  const totalValue = aging.rowsWH.reduce((sum, row) => sum + row.value, 0)
  const totalQty = aging.rowsWH.reduce((sum, row) => sum + row.qty, 0)

  const whRows: Row[] = [
    [tt('reports.summary.valuation.warehouse', 'Warehouse'), tt('reports.totalQty', 'Total Qty'), `${tt('reports.summary.valuation.value', 'Value')} (${displayCurrency})`, ...aging.buckets],
    ...aging.rowsWH.map((row) => ([
      row.warehouseName,
      Number(row.qty.toFixed(2)),
      Number(row.value),
      ...aging.buckets.map((bucket) => `${fmt(row.byBucket[bucket].qty, 2)} / ${moneyText(row.byBucket[bucket].value)}`),
    ])),
  ]
  const binRows: Row[] = [
    [tt('reports.summary.valuation.warehouse', 'Warehouse'), tt('orders.binHint', 'Bin'), tt('reports.totalQty', 'Total Qty'), `${tt('reports.summary.valuation.value', 'Value')} (${displayCurrency})`, ...aging.buckets],
    ...aging.rowsBin.map((row) => ([
      row.warehouseName,
      row.binCode,
      Number(row.qty.toFixed(2)),
      Number(row.value),
      ...aging.buckets.map((bucket) => `${fmt(row.byBucket[bucket].qty, 2)} / ${moneyText(row.byBucket[bucket].value)}`),
    ])),
  ]

  const onCSV = async () => {
    await downloadCSV(`aging_by_warehouse_${stamp}.csv`, [...headerRows(ctx, tt('reports.agingByWarehouse', 'Inventory Aging — By Warehouse')), ...whRows])
    await downloadCSV(`aging_by_bin_${stamp}.csv`, [...headerRows(ctx, tt('reports.agingByBin', 'Inventory Aging — By Bin')), ...binRows])
  }

  const onXLSX = async () => {
    await saveXLSX(`aging_${stamp}.xlsx`, ctx, [
      { title: 'By Warehouse', headerTitle: tt('reports.agingByWarehouse', 'Inventory Aging — By Warehouse'), body: whRows, moneyCols: [2], qtyCols: [1] },
      { title: 'By Bin', headerTitle: tt('reports.agingByBin', 'Inventory Aging — By Bin'), body: binRows, moneyCols: [3], qtyCols: [2] },
    ])
  }

  const onPDF = async () => {
    const doc = await startPDF(ctx, tt('reports.agingByWarehouse', 'Inventory Aging — By Warehouse'))
    await pdfTable(doc, whRows[0] as string[], whRows.slice(1), [], ctx, 110)
    doc.addPage()
    await pdfTable(doc, binRows[0] as string[], binRows.slice(1), [], ctx, 110)
    doc.save(`aging_${stamp}.pdf`)
  }

  return (
    <Card className="rounded-2xl border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle>{tt('reports.tab.aging', 'Aging')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {tt('reports.agingHelp', 'Use aging buckets to spot old stock value, where it sits, and which warehouses or bins are carrying slow-moving inventory.')}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} className="mt-0 justify-end" />

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.summary.valuation.warehouse', 'Warehouse')}</p>
            <div className="mt-2 text-lg font-semibold">{aging.rowsWH.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.agingWarehouseHelp', 'Warehouses carrying stock in the current aging snapshot.')}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.totalQty', 'Total Qty')}</p>
            <div className="mt-2 text-lg font-semibold">{fmt(totalQty, 2)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.agingQtyHelp', 'On-hand quantity included in the aging analysis.')}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.summary.valuation.value', 'Value')}</p>
            <div className="mt-2 text-lg font-semibold">{moneyText(totalValue)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.agingValueHelp', 'Total value represented across the aging buckets.')}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{tt('reports.agingByWarehouse', 'Inventory Aging — By Warehouse')}</h3>
            <p className="text-xs text-muted-foreground">{tt('reports.agingWarehouseBreakdownHelp', 'Warehouse rows combine quantity and value by aging bucket so slow-moving stock is easier to isolate.')}</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2">{tt('reports.summary.valuation.warehouse', 'Warehouse')}</th>
                  <th className="px-3 py-2 text-right">{tt('reports.totalQty', 'Total Qty')}</th>
                  <th className="px-3 py-2 text-right">{tt('reports.summary.valuation.value', 'Value')}</th>
                  {aging.buckets.map((bucket) => <th key={bucket} className="px-3 py-2">{bucket}</th>)}
                </tr>
              </thead>
              <tbody>
                {aging.rowsWH.map((row) => (
                  <tr key={row.warehouseId} className="border-t">
                    <td className="px-3 py-3">{row.warehouseName}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{fmt(row.qty, 2)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{moneyText(row.value)}</td>
                    {aging.buckets.map((bucket) => (
                      <td key={bucket} className="px-3 py-3 text-xs text-muted-foreground">
                        {fmt(row.byBucket[bucket].qty, 2)} / {moneyText(row.byBucket[bucket].value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{tt('reports.agingByBin', 'Inventory Aging — By Bin')}</h3>
            <p className="text-xs text-muted-foreground">{tt('reports.agingBinBreakdownHelp', 'Bin rows help warehouse teams pinpoint exactly where older stock is sitting inside a site.')}</p>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2">{tt('reports.summary.valuation.warehouse', 'Warehouse')}</th>
                  <th className="px-3 py-2">{tt('orders.binHint', 'Bin')}</th>
                  <th className="px-3 py-2 text-right">{tt('reports.totalQty', 'Total Qty')}</th>
                  <th className="px-3 py-2 text-right">{tt('reports.summary.valuation.value', 'Value')}</th>
                  {aging.buckets.map((bucket) => <th key={bucket} className="px-3 py-2">{bucket}</th>)}
                </tr>
              </thead>
              <tbody>
                {aging.rowsBin.map((row) => (
                  <tr key={`${row.warehouseId}|${row.binId || ''}`} className="border-t">
                    <td className="px-3 py-3">{row.warehouseName}</td>
                    <td className="px-3 py-3">{row.binCode}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{fmt(row.qty, 2)}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{moneyText(row.value)}</td>
                    {aging.buckets.map((bucket) => (
                      <td key={bucket} className="px-3 py-3 text-xs text-muted-foreground">
                        {fmt(row.byBucket[bucket].qty, 2)} / {moneyText(row.byBucket[bucket].value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
