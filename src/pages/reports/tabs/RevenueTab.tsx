// src/pages/reports/tabs/RevenueTab.tsx
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'

export default function RevenueTab() {
  const { revenueByCustomer, moneyText, ordersUnavailable, cashUnavailable, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote, ui } = useReports()
  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')

  const rows: Row[] = [['Customer', `Revenue (${displayCurrency})`]]
  revenueByCustomer.rows.forEach(r => rows.push([r.customerName, Number(r.baseAmount)]))
  rows.push(['Total', Number(revenueByCustomer.grandTotalBase)])

  const onCSV = () => {
    downloadCSV(`revenue_by_customer_${stamp}.csv`, [
      ...headerRows(ctx, 'Revenue by Customer'),
      ...formatRowsForCSV(rows, ctx, [1]),
    ])
  }
  const onXLSX = () => {
    saveXLSX(`revenue_${stamp}.xlsx`, ctx, [
      { title: 'By Customer', headerTitle: 'Revenue by Customer', body: rows, moneyCols: [1] },
    ])
  }
  const onPDF = () => {
    const doc = startPDF(ctx, 'Revenue by Customer')
    pdfTable(doc, rows[0] as string[], rows.slice(1), [1], ctx, 110)
    doc.save(`revenue_${stamp}.pdf`)
  }

  return (
    <Card>
      <CardHeader><CardTitle>Revenue by Customer</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />

        {(ordersUnavailable || cashUnavailable) && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
            {ordersUnavailable && cashUnavailable && 'No revenue sources are connected. Configure order/cash sources in Settings.'}
            {ordersUnavailable && !cashUnavailable && 'Orders source not connected — showing only Cash/POS sales.'}
            {!ordersUnavailable && cashUnavailable && 'Cash/POS source not connected — showing only Orders.'}
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-2">Customer</th>
              <th className="py-2 pr-2">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {revenueByCustomer.rows.length === 0 && (
              <tr>
                <td colSpan={2} className="py-4 text-muted-foreground">No revenue in the selected period.</td>
              </tr>
            )}
            {revenueByCustomer.rows.map(r => (
              <tr key={r.customerId} className="border-b">
                <td className="py-2 pr-2">{r.customerName}</td>
                <td className="py-2 pr-2">{moneyText(r.baseAmount)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-2 font-medium">Total</td>
              <td className="py-2 pr-2 font-medium">{moneyText(revenueByCustomer.grandTotalBase)}</td>
            </tr>
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
