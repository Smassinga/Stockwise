// src/pages/reports/tabs/TurnoverTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'

export default function TurnoverTab() {
  const { turnoverPerItem, moneyText, fmt, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote, ui } = useReports()
  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')

  const rows: Row[] = [[
    'Item','SKU','Sold (period)','Begin Units','End Units','Avg Units','Turns','Avg Days to Sell','COGS'
  ]]
  turnoverPerItem.rows.forEach(r => {
    rows.push([
      r.name, r.sku,
      Number(r.sold),
      Number(r.beginUnits.toFixed(2)),
      Number(r.endUnits.toFixed(2)),
      Number(r.avgUnits.toFixed(2)),
      Number(r.turns.toFixed(2)),
      r.avgDaysToSell != null ? Number(r.avgDaysToSell.toFixed(1)) : '',
      Number(r.cogs ?? 0),
    ])
  })

  const onCSV = () => {
    downloadCSV(`turnover_${stamp}.csv`, [
      ...headerRows(ctx, 'Inventory Turnover & Avg Days to Sell'),
      ...formatRowsForCSV(rows, ctx, [8], [2,3,4,5,6,7]),
    ])
  }
  const onXLSX = () => {
    saveXLSX(`turnover_${stamp}.xlsx`, ctx, [
      { title: 'Turnover', headerTitle: 'Inventory Turnover & Avg Days to Sell', body: rows, moneyCols: [8], qtyCols: [2,3,4,5,6,7] },
    ])
  }
  const onPDF = () => {
    const doc = startPDF(ctx, 'Inventory Turnover & Avg Days to Sell')
    pdfTable(doc, rows[0] as string[], rows.slice(1), [8], ctx, 110)
    doc.save(`turnover_${stamp}.pdf`)
  }

  return (
    <Card>
      <CardHeader><CardTitle>Turnover (Units) &amp; Avg Days to Sell</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />
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
