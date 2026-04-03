import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { useOrg } from '../hooks/useOrg'
import { useVendorBills } from '../hooks/useFinanceDocuments'
import { getBaseCurrencyCode } from '../lib/currency'
import { vendorBillWorkflowLabelKey, type VendorBillStateRow } from '../lib/financeDocuments'
import { useI18n, withI18nFallback } from '../lib/i18n'

function workflowTone(status: VendorBillStateRow['document_workflow_status']) {
  switch (status) {
    case 'posted':
      return 'default'
    case 'voided':
      return 'destructive'
    default:
      return 'secondary'
  }
}

export default function VendorBillsPage() {
  const { companyId } = useOrg()
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { rows, loading, error, missingView } = useVendorBills(companyId)
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
    if (error) toast.error(error.message || tt('financeDocs.vendorBills.loadFailed', 'Failed to load vendor bills'))
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
      `${right.bill_date} ${right.primary_reference}`.localeCompare(`${left.bill_date} ${left.primary_reference}`),
    )
    if (!needle) return sorted
    return sorted.filter((row) =>
      [
        row.internal_reference,
        row.supplier_invoice_reference,
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
            <h1 className="text-3xl font-bold tracking-tight">{tt('financeDocs.vendorBills.title', 'Vendor Bills')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {tt('financeDocs.vendorBills.subtitle', 'Supplier invoice references stay primary in AP-facing work while the Stockwise internal reference remains the audit trail and system lookup key.')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/orders?tab=purchase">{tt('financeDocs.vendorBills.ordersLink', 'View purchase orders')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/settlements">{tt('financeDocs.vendorBills.settlementsLink', 'Settlement workspace')}</Link>
          </Button>
        </div>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>{tt('financeDocs.vendorBills.listTitle', 'AP register')}</CardTitle>
            <CardDescription>{tt('financeDocs.vendorBills.listHelp', 'Search by supplier invoice reference or internal reference. Draft duplicates are warned here before posting blocks them.')}</CardDescription>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-10"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={tt('financeDocs.vendorBills.searchPlaceholder', 'Search supplier invoice or internal reference')}
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
              <div className="text-lg font-medium">{tt('financeDocs.vendorBills.emptyTitle', 'No vendor bills yet.')}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {tt(
                  'financeDocs.vendorBills.emptyBody',
                  'Vendor bills appear here after approved purchase orders are booked into AP documents.',
                )}
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tt('financeDocs.fields.supplierInvoiceReference', 'Supplier invoice reference')}</TableHead>
                  <TableHead>{tt('financeDocs.fields.supplier', 'Supplier')}</TableHead>
                  <TableHead>{tt('financeDocs.fields.supplierInvoiceDate', 'Supplier invoice date')}</TableHead>
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
                      <div className="font-medium">{row.primary_reference}</div>
                      <div className="text-xs text-muted-foreground">
                        {tt('financeDocs.fields.internalReferenceValue', 'Internal {reference}', { reference: row.internal_reference })}
                      </div>
                      {row.duplicate_supplier_reference_exists && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>{tt('financeDocs.vendorBills.duplicateWarning', 'Duplicate supplier reference detected')}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div>{row.counterparty_name || tt('common.none', 'None')}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.order_no ? tt('financeDocs.fields.linkedOrderValue', 'Order {orderNo}', { orderNo: row.order_no }) : tt('financeDocs.fields.noLinkedOrder', 'No linked order')}
                      </div>
                    </TableCell>
                    <TableCell>{row.supplier_invoice_date || tt('common.dash', '-')}</TableCell>
                    <TableCell>{row.due_date}</TableCell>
                    <TableCell>
                      <Badge variant={workflowTone(row.document_workflow_status)}>
                        {tt(vendorBillWorkflowLabelKey(row.document_workflow_status), row.document_workflow_status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono tabular-nums">{formatDocumentMoney(row.total_amount, row.currency_code)}</div>
                      <div className="text-xs text-muted-foreground">{formatBaseMoney(row.total_amount_base)}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/vendor-bills/${row.id}`}>{tt('financeDocs.viewDocument', 'View')}</Link>
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
