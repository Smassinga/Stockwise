// src/pages/reports/tabs/RevenueTab.tsx
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { useI18n } from '../../../lib/i18n'
import { useReports } from '../context/ReportsProvider'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'

export default function RevenueTab() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => (t(key) === key ? fallback : t(key))
  const {
    revenueByCustomer,
    moneyText,
    ordersUnavailable,
    cashUnavailable,
    startDate,
    endDate,
    displayCurrency,
    baseCurrency,
    fxRate,
    fxNote,
    ui,
  } = useReports()

  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')

  const rows: Row[] = [[tt('reports.customerLabel', 'Customer'), `${tt('reports.revenueLabel', 'Revenue')} (${displayCurrency})`]]
  revenueByCustomer.rows.forEach((row) => rows.push([row.customerName, Number(row.baseAmount)]))
  rows.push([tt('reports.summary.valuation.total', 'Total'), Number(revenueByCustomer.grandTotalBase)])

  const onCSV = async () => {
    await downloadCSV(`revenue_by_customer_${stamp}.csv`, [
      ...headerRows(ctx, tt('reports.revenueByCustomer', 'Revenue by Customer')),
      ...formatRowsForCSV(rows, ctx, [1]),
    ])
  }

  const onXLSX = async () => {
    await saveXLSX(`revenue_${stamp}.xlsx`, ctx, [
      { title: 'By Customer', headerTitle: tt('reports.revenueByCustomer', 'Revenue by Customer'), body: rows, moneyCols: [1] },
    ])
  }

  const onPDF = async () => {
    const doc = await startPDF(ctx, tt('reports.revenueByCustomer', 'Revenue by Customer'))
    await pdfTable(doc, rows[0] as string[], rows.slice(1), [1], ctx, 110)
    doc.save(`revenue_${stamp}.pdf`)
  }

  return (
    <Card className="rounded-2xl border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle>{tt('reports.revenueByCustomer', 'Revenue by Customer')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {tt('reports.revenueHelp', 'Review which customers generated revenue in the selected period and how much value they contributed in the reporting currency.')}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} className="mt-0 justify-end" />

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.customerCoverage', 'Customer coverage')}</p>
            <div className="mt-2 text-lg font-semibold">{revenueByCustomer.rows.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.customerCoverageHelp', 'Customers with revenue in the selected period.')}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.revenueLabel', 'Revenue')}</p>
            <div className="mt-2 text-lg font-semibold">{moneyText(revenueByCustomer.grandTotalBase)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.revenueTotalHelp', 'Total revenue visible from the currently connected operational sources.')}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.dataSources', 'Data sources')}</p>
            <div className="mt-2 text-lg font-semibold">
              {ordersUnavailable && cashUnavailable
                ? tt('reports.sourceNone', 'Unavailable')
                : ordersUnavailable || cashUnavailable
                ? tt('reports.sourcePartial', 'Partial')
                : tt('reports.sourceLive', 'Connected')}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.dataSourcesHelp', 'Orders and cash/POS sources should both be connected for the fullest revenue view.')}</p>
          </div>
        </div>

        {(ordersUnavailable || cashUnavailable) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {ordersUnavailable && cashUnavailable && tt('reports.revenueSourcesMissing', 'No revenue sources are connected. Review the product-level revenue configuration before relying on this report.')}
            {ordersUnavailable && !cashUnavailable && tt('reports.revenueOrdersMissing', 'Orders are not connected, so this report is showing only cash/POS revenue.')}
            {!ordersUnavailable && cashUnavailable && tt('reports.revenueCashMissing', 'Cash/POS is not connected, so this report is showing only order-based revenue.')}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2">{tt('reports.customerLabel', 'Customer')}</th>
                <th className="px-3 py-2 text-right">{tt('reports.revenueLabel', 'Revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {revenueByCustomer.rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-6 text-sm text-muted-foreground">
                    {tt('reports.noRevenueInPeriod', 'No revenue was recorded in the selected period.')}
                  </td>
                </tr>
              )}
              {revenueByCustomer.rows.map((row) => (
                <tr key={row.customerId} className="border-t">
                  <td className="px-3 py-3">{row.customerName}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{moneyText(row.baseAmount)}</td>
                </tr>
              ))}
              <tr className="border-t bg-muted/20">
                <td className="px-3 py-3 font-medium">{tt('reports.summary.valuation.total', 'Total')}</td>
                <td className="px-3 py-3 text-right font-mono font-medium tabular-nums">{moneyText(revenueByCustomer.grandTotalBase)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
