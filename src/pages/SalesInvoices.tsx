import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { useOrg } from '../hooks/useOrg'
import { useSalesInvoices } from '../hooks/useFinanceDocuments'
import { getBaseCurrencyCode } from '../lib/currency'
import { salesInvoiceWorkflowLabelKey, type SalesInvoiceStateRow } from '../lib/financeDocuments'
import { useI18n, withI18nFallback } from '../lib/i18n'

function workflowTone(status: SalesInvoiceStateRow['document_workflow_status']) {
  switch (status) {
    case 'issued':
      return 'default'
    case 'voided':
      return 'destructive'
    default:
      return 'secondary'
  }
}

export default function SalesInvoicesPage() {
  const { companyId } = useOrg()
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { rows, loading, error, missingView } = useSalesInvoices(companyId)
  const [baseCode, setBaseCode] = useState('MZN')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      try {
        const code = await getBaseCurrencyCode(companyId)
        if (code) setBaseCode(code)
      } catch {
        setBaseCode('MZN')
      }
    })()
  }, [companyId])

  useEffect(() => {
    if (error) toast.error(error.message || tt('financeDocs.salesInvoices.loadFailed', 'Failed to load sales invoices'))
  }, [error, tt])

  const formatDocumentMoney = (amount: number, code: string) =>
    new Intl.NumberFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
      style: 'currency',
      currency: code || baseCode || 'MZN',
    }).format(amount || 0)

  const formatBaseMoney = (amount: number) =>
    new Intl.NumberFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
      style: 'currency',
      currency: baseCode || 'MZN',
    }).format(amount || 0)

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const sorted = [...rows].sort((left, right) =>
      `${right.invoice_date} ${right.internal_reference}`.localeCompare(`${left.invoice_date} ${left.internal_reference}`),
    )
    if (!needle) return sorted
    return sorted.filter((row) =>
      [
        row.internal_reference,
        row.counterparty_name,
        row.order_no,
        row.document_workflow_status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [rows, search])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('financeDocs.eyebrow', 'Finance documents')}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('financeDocs.salesInvoices.title', 'Sales Invoices')}</h1>
            <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
              {tt('financeDocs.salesInvoices.subtitle', 'Issued sales invoices are the legal fiscal truth for Mozambique while sales orders remain operational and commercial documents only.')}
            </p>
          </div>
        </div>

        <div className="mobile-primary-actions">
          <Button asChild variant="outline">
            <Link to="/orders?tab=sales">{tt('financeDocs.salesInvoices.ordersLink', 'View sales orders')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/compliance/mz">{tt('nav.complianceMz', 'Mozambique compliance')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/settlements">{tt('financeDocs.salesInvoices.settlementsLink', 'Settlement workspace')}</Link>
          </Button>
        </div>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>{tt('financeDocs.salesInvoices.listTitle', 'Invoice register')}</CardTitle>
            <CardDescription className="hidden sm:block">{tt('financeDocs.salesInvoices.listHelp', 'Search by legal reference, customer, or linked order. Draft invoices are created from sales orders, then issued through the compliance-gated runtime path.')}</CardDescription>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-10"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tt('financeDocs.salesInvoices.searchPlaceholder', 'Search internal reference, customer, or order')}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {missingView && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {tt('financeDocs.stateViewsUnavailable', 'The Step 2 finance-document views are not available yet. Apply the Step 2 migration and refresh this page.')}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
              <div className="text-lg font-medium">{tt('financeDocs.salesInvoices.emptyTitle', 'No sales invoices yet.')}</div>
              <div className="mt-2 text-sm text-muted-foreground">{tt('financeDocs.salesInvoices.emptyBody', 'Create the first draft from a confirmed sales order, then issue it from the sales invoice detail page.')}</div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tt('financeDocs.fields.internalReference', 'Internal reference')}</TableHead>
                  <TableHead>{tt('financeDocs.fields.customer', 'Customer')}</TableHead>
                  <TableHead>{tt('financeDocs.fields.invoiceDate', 'Invoice date')}</TableHead>
                  <TableHead>{tt('financeDocs.fields.dueDate', 'Due date')}</TableHead>
                  <TableHead>{tt('financeDocs.fields.workflow', 'Workflow')}</TableHead>
                  <TableHead className="text-right">{tt('financeDocs.fields.total', 'Total')}</TableHead>
                  <TableHead className="text-right">{tt('orders.actions', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.internal_reference}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.order_no ? tt('financeDocs.fields.linkedOrderValue', 'Order {orderNo}', { orderNo: row.order_no }) : tt('financeDocs.fields.noLinkedOrder', 'No linked order')}
                      </div>
                    </TableCell>
                    <TableCell>{row.counterparty_name || tt('common.none', 'None')}</TableCell>
                    <TableCell>{row.invoice_date}</TableCell>
                    <TableCell>{row.due_date}</TableCell>
                    <TableCell>
                      <Badge variant={workflowTone(row.document_workflow_status)}>
                        {tt(salesInvoiceWorkflowLabelKey(row.document_workflow_status), row.document_workflow_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono tabular-nums">{formatDocumentMoney(row.total_amount, row.currency_code)}</div>
                      <div className="text-xs text-muted-foreground">{formatBaseMoney(row.total_amount_base)}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/sales-invoices/${row.id}`}>{tt('financeDocs.viewDocument', 'View')}</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
