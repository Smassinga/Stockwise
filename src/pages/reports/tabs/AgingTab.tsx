// src/pages/reports/tabs/AgingTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'
import ExportButtons from '../components/ExportButtons'
import { headerRows, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'

export default function AgingTab() {
  const { aging, moneyText, fmt, ui, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote } = useReports()
  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')

  const whRows: Row[] = [
    ['Warehouse', 'Total Qty', `Total Value (${displayCurrency})`, ...aging.buckets],
    ...aging.rowsWH.map(r => ([
      r.warehouseName,
      Number(r.qty.toFixed(2)),
      Number(r.value),
      ...aging.buckets.map(b => `${fmt(r.byBucket[b].qty, 2)} / ${moneyText(r.byBucket[b].value)}`)
    ])),
  ]
  const binRows: Row[] = [
    ['Warehouse', 'Bin', 'Total Qty', `Total Value (${displayCurrency})`, ...aging.buckets],
    ...aging.rowsBin.map(r => ([
      r.warehouseName,
      r.binCode,
      Number(r.qty.toFixed(2)),
      Number(r.value),
      ...aging.buckets.map(b => `${fmt(r.byBucket[b].qty, 2)} / ${moneyText(r.byBucket[b].value)}`)
    ])),
  ]

  const onCSV = () => {
    downloadCSV(`aging_by_warehouse_${stamp}.csv`, [...headerRows(ctx, 'Inventory Aging — By Warehouse'), ...whRows])
    downloadCSV(`aging_by_bin_${stamp}.csv`, [...headerRows(ctx, 'Inventory Aging — By Bin'), ...binRows])
  }
  const onXLSX = () => {
    saveXLSX(`aging_${stamp}.xlsx`, ctx, [
      { title: 'By Warehouse', headerTitle: 'Inventory Aging — By Warehouse', body: whRows, moneyCols: [2], qtyCols: [1] },
      { title: 'By Bin', headerTitle: 'Inventory Aging — By Bin', body: binRows, moneyCols: [3], qtyCols: [2] },
    ])
  }
  const onPDF = () => {
    const doc = startPDF(ctx, 'Inventory Aging — By Warehouse')
    pdfTable(doc, whRows[0] as string[], whRows.slice(1), [], ctx, 110)
    doc.addPage()
    pdfTable(doc, binRows[0] as string[], binRows.slice(1), [], ctx, 110)
    doc.save(`aging_${stamp}.pdf`)
  }

  return (
    <Card>
      <CardHeader><CardTitle>Aging Buckets</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />

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
