import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { getBaseCurrencyCode } from '../lib/currency'
import {
  VENDOR_BILL_STATE_VIEW,
  isMissingFinanceViewError,
  vendorBillWorkflowLabelKey,
  type VendorBillLineRow,
  type VendorBillStateRow,
} from '../lib/financeDocuments'
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

export default function VendorBillDetailPage() {
  const { billId } = useParams()
  const navigate = useNavigate()
  const { companyId } = useOrg()
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)

  const [loading, setLoading] = useState(true)
  const [missingView, setMissingView] = useState(false)
  const [row, setRow] = useState<VendorBillStateRow | null>(null)
  const [lines, setLines] = useState<VendorBillLineRow[]>([])
  const [baseCode, setBaseCode] = useState('MZN')

  useEffect(() => {
    if (!companyId || !billId) return
    ;(async () => {
      try {
        const code = await getBaseCurrencyCode(companyId)
        if (code) setBaseCode(code)
      } catch {
        setBaseCode('MZN')
      }
    })()
  }, [companyId, billId])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (!companyId || !billId) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setMissingView(false)

        const { data, error } = await supabase
          .from(VENDOR_BILL_STATE_VIEW)
          .select('*')
          .eq('company_id', companyId)
          .eq('id', billId)
          .maybeSingle()

        if (error) {
          if (isMissingFinanceViewError(error, VENDOR_BILL_STATE_VIEW)) {
            if (!cancelled) {
              setMissingView(true)
              setRow(null)
              setLines([])
            }
            return
          }
          throw error
        }

        if (!data) {
          if (!cancelled) {
            setRow(null)
            setLines([])
          }
          return
        }

        const lineRes = await supabase
          .from('vendor_bill_lines')
          .select('id,vendor_bill_id,description,qty,unit_cost,tax_rate,tax_amount,line_total,sort_order')
          .eq('company_id', companyId)
          .eq('vendor_bill_id', billId)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })

        if (lineRes.error) throw lineRes.error

        if (!cancelled) {
          setRow(data as VendorBillStateRow)
          setLines((lineRes.data || []) as VendorBillLineRow[])
        }
      } catch (error: any) {
        console.error(error)
        if (!cancelled) {
          toast.error(error?.message || tt('financeDocs.vendorBills.loadFailed', 'Failed to load vendor bills'))
          setRow(null)
          setLines([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [billId, companyId, tt])

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

  const orderLink = useMemo(() => {
    if (!row?.purchase_order_id) return null
    return `/orders?tab=purchase&orderId=${encodeURIComponent(row.purchase_order_id)}`
  }, [row])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {tt('financeDocs.back', 'Back')}
        </Button>
        <Button asChild variant="outline">
          <Link to="/vendor-bills">{tt('financeDocs.vendorBills.title', 'Vendor Bills')}</Link>
        </Button>
        {orderLink && (
          <Button asChild variant="outline">
            <Link to={orderLink}>{tt('financeDocs.viewLinkedOrder', 'View linked order')}</Link>
          </Button>
        )}
      </div>

      {missingView ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {tt('financeDocs.stateViewsUnavailable', 'The Step 2 finance-document views are not available yet. Apply the Step 2 migration and refresh this page.')}
        </div>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
      ) : !row ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {tt('financeDocs.vendorBills.notFound', 'Vendor bill not found for the active company.')}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{row.primary_reference}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.internalReference', 'Internal reference')}</div>
                  <div className="mt-1 font-medium">{row.internal_reference}</div>
                </div>
                {row.duplicate_supplier_reference_exists && (
                  <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-medium">{tt('financeDocs.vendorBills.duplicateWarning', 'Duplicate supplier reference detected')}</div>
                        <div className="mt-1 text-xs">{tt('financeDocs.vendorBills.duplicateHelp', 'Draft duplicates are allowed for review, but posting must resolve the conflict or keep the existing posted document voided first.')}</div>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.supplier', 'Supplier')}</div>
                  <div className="mt-1">{row.counterparty_name || tt('common.none', 'None')}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.workflow', 'Workflow')}</div>
                  <div className="mt-1">
                    <Badge variant={workflowTone(row.document_workflow_status)}>
                      {tt(vendorBillWorkflowLabelKey(row.document_workflow_status), row.document_workflow_status)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.supplierInvoiceReference', 'Supplier invoice reference')}</div>
                  <div className="mt-1">{row.supplier_invoice_reference || tt('common.dash', '-')}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.supplierInvoiceDate', 'Supplier invoice date')}</div>
                  <div className="mt-1">{row.supplier_invoice_date || tt('common.dash', '-')}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.billDate', 'Bill date')}</div>
                  <div className="mt-1">{row.bill_date}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.dueDate', 'Due date')}</div>
                  <div className="mt-1">{row.due_date}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.linkedOrder', 'Linked order')}</div>
                  <div className="mt-1">{row.order_no || tt('financeDocs.fields.noLinkedOrder', 'No linked order')}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.lines', 'Lines')}</div>
                  <div className="mt-1">{row.line_count}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{tt('financeDocs.fields.total', 'Total')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.subtotal', 'Subtotal')}</div>
                  <div className="mt-1 font-mono tabular-nums">{formatDocumentMoney(row.subtotal, row.currency_code)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.taxTotal', 'Tax')}</div>
                  <div className="mt-1 font-mono tabular-nums">{formatDocumentMoney(row.tax_total, row.currency_code)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.total', 'Total')}</div>
                  <div className="mt-1 font-mono tabular-nums text-lg font-semibold">{formatDocumentMoney(row.total_amount, row.currency_code)}</div>
                  <div className="text-xs text-muted-foreground">{formatBaseMoney(row.total_amount_base)}</div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('financeDocs.fields.lines', 'Lines')}</CardTitle>
            </CardHeader>
            <CardContent>
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tt('financeDocs.linesEmpty', 'No document lines have been stored for this finance document yet.')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tt('orders.description', 'Description')}</TableHead>
                      <TableHead className="text-right">{tt('orders.qty', 'Qty')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.unitCost', 'Unit cost')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.taxTotal', 'Tax')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.total', 'Total')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>{line.description || tt('common.dash', '-')}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{line.qty}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatDocumentMoney(line.unit_cost, row.currency_code)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatDocumentMoney(line.tax_amount, row.currency_code)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{formatDocumentMoney(line.line_total, row.currency_code)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
