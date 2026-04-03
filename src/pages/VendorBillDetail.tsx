import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowLeft, Download, Printer, Share2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { useBrandForDocs } from '../hooks/useBrandForDocs'
import { getBaseCurrencyCode } from '../lib/currency'
import { getCompanyProfile, type CompanyProfile } from '../lib/companyProfile'
import {
  VENDOR_BILL_STATE_VIEW,
  isMissingFinanceViewError,
  vendorBillResolutionLabelKey,
  vendorBillWorkflowLabelKey,
  type VendorBillLineRow,
  type VendorBillStateRow,
} from '../lib/financeDocuments'
import { useI18n, withI18nFallback } from '../lib/i18n'
import type { FinanceDocumentEventRow } from '../lib/mzFinance'
import { settlementLabelKey } from '../lib/orderState'
import {
  buildVendorBillOutputModel,
  downloadFinanceDocumentPdf,
  printFinanceDocument,
  shareFinanceDocument,
} from '../lib/financeDocumentOutput'

type SupplierProfile = {
  name: string | null
  tax_id: string | null
}

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

function resolutionTone(status: VendorBillStateRow['resolution_status']) {
  switch (status) {
    case 'posted_settled':
      return 'default'
    case 'posted_overdue':
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
  const brand = useBrandForDocs(companyId)

  const [loading, setLoading] = useState(true)
  const [missingView, setMissingView] = useState(false)
  const [posting, setPosting] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [row, setRow] = useState<VendorBillStateRow | null>(null)
  const [lines, setLines] = useState<VendorBillLineRow[]>([])
  const [events, setEvents] = useState<FinanceDocumentEventRow[]>([])
  const [baseCode, setBaseCode] = useState('MZN')
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null)
  const [supplierProfile, setSupplierProfile] = useState<SupplierProfile | null>(null)

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

  const loadWorkspace = useCallback(async () => {
    if (!companyId || !billId) {
      setLoading(false)
      setRow(null)
      setLines([])
      setEvents([])
      setCompanyProfile(null)
      setSupplierProfile(null)
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
          setMissingView(true)
          setRow(null)
          setLines([])
          setEvents([])
          return
        }
        throw error
      }

      if (!data) {
        setRow(null)
        setLines([])
        setEvents([])
        return
      }

      const nextRow = data as VendorBillStateRow
      const [lineRes, eventRes, nextCompanyProfile, supplierRes] = await Promise.all([
        supabase
          .from('vendor_bill_lines')
          .select('id,vendor_bill_id,description,qty,unit_cost,tax_rate,tax_amount,line_total,sort_order')
          .eq('company_id', companyId)
          .eq('vendor_bill_id', billId)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('finance_document_events')
          .select('*')
          .eq('company_id', companyId)
          .eq('document_kind', 'vendor_bill')
          .eq('document_id', billId)
          .order('occurred_at', { ascending: false }),
        getCompanyProfile(companyId),
        nextRow.supplier_id
          ? supabase
              .from('suppliers')
              .select('name,tax_id')
              .eq('company_id', companyId)
              .eq('id', nextRow.supplier_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])

      if (lineRes.error) throw lineRes.error
      if (eventRes.error) throw eventRes.error
      if (supplierRes.error) throw supplierRes.error

      setRow(nextRow)
      setLines((lineRes.data || []) as VendorBillLineRow[])
      setEvents((eventRes.data || []) as FinanceDocumentEventRow[])
      setCompanyProfile(nextCompanyProfile)
      setSupplierProfile((supplierRes.data || null) as SupplierProfile | null)
    } catch (error: any) {
      console.error(error)
      toast.error(
        error?.message
        || withI18nFallback(t, 'financeDocs.vendorBills.loadFailed', 'Failed to load vendor bills'),
      )
      setRow(null)
      setLines([])
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [billId, companyId, t])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

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

  const outputModel = useMemo(() => {
    if (!row || !companyProfile) return null
    return buildVendorBillOutputModel(row, lines, {
      brandName: brand.name,
      logoUrl: brand.logoUrl,
      supplier: {
        name: supplierProfile?.name || row.counterparty_name,
        taxId: supplierProfile?.tax_id || null,
      },
      company: {
        legalName: companyProfile.legal_name,
        tradeName: companyProfile.trade_name,
        taxId: companyProfile.tax_id,
        address: [
          companyProfile.address_line1,
          companyProfile.address_line2,
          [companyProfile.city, companyProfile.state].filter(Boolean).join(', '),
          companyProfile.postal_code,
          companyProfile.country_code,
        ],
      },
    })
  }, [brand.logoUrl, brand.name, companyProfile, lines, row, supplierProfile?.name, supplierProfile?.tax_id])

  async function handleWorkflowChange(nextStatus: 'posted' | 'voided') {
    if (!companyId || !billId || !row) return
    const confirmMessage = nextStatus === 'posted'
      ? tt('financeDocs.vendorBills.confirmPost', 'Post this vendor bill and move settlement truth to the AP document?')
      : tt('financeDocs.vendorBills.confirmVoid', 'Void this vendor bill?')
    if (!window.confirm(confirmMessage)) return

    try {
      if (nextStatus === 'posted') setPosting(true)
      else setVoiding(true)

      const patch = nextStatus === 'posted'
        ? { document_workflow_status: 'posted' as const }
        : { document_workflow_status: 'voided' as const }

      const { error } = await supabase
        .from('vendor_bills')
        .update(patch)
        .eq('company_id', companyId)
        .eq('id', billId)

      if (error) throw error

      toast.success(
        nextStatus === 'posted'
          ? tt('financeDocs.vendorBills.postSuccess', 'Vendor bill posted')
          : tt('financeDocs.vendorBills.voidSuccess', 'Vendor bill voided'),
      )
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(
        error?.message || (
          nextStatus === 'posted'
            ? tt('financeDocs.vendorBills.postFailed', 'Failed to post the vendor bill')
            : tt('financeDocs.vendorBills.voidFailed', 'Failed to void the vendor bill')
        ),
      )
    } finally {
      setPosting(false)
      setVoiding(false)
    }
  }

  async function handlePrint() {
    if (!outputModel) return
    try {
      await printFinanceDocument(outputModel)
    } catch (error: any) {
      toast.error(error?.message || tt('financeDocs.mz.printFailed', 'Unable to open the invoice print view'))
    }
  }

  async function handleDownloadPdf() {
    if (!outputModel) return
    try {
      await downloadFinanceDocumentPdf(outputModel)
    } catch (error: any) {
      toast.error(error?.message || tt('financeDocs.mz.pdfFailed', 'Unable to generate the invoice PDF'))
    }
  }

  async function handleShare() {
    if (!outputModel) return
    try {
      await shareFinanceDocument(outputModel)
    } catch (error: any) {
      toast.error(error?.message || tt('financeDocs.mz.shareFailed', 'Sharing is not available for this invoice on the current device'))
    }
  }

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
        <Button asChild variant="outline">
          <Link to="/settlements">{tt('financeDocs.vendorBills.settlementsLink', 'Settlement workspace')}</Link>
        </Button>
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
                {tt('financeDocs.eyebrow', 'Finance documents')}
              </div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">{row.primary_reference}</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {row.document_workflow_status === 'posted'
                  ? tt('financeDocs.vendorBills.postedHelper', 'Posted vendor bills are the AP settlement anchor. Payments and outstanding exposure now belong to this document, not to the original purchase order.')
                  : tt('financeDocs.vendorBills.draftHelper', 'Draft vendor bills stay editable until posting. Posting transfers settlement truth from the purchase order into the AP document.')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant={workflowTone(row.document_workflow_status)}>
                {tt(vendorBillWorkflowLabelKey(row.document_workflow_status), row.document_workflow_status)}
              </Badge>
              {outputModel ? (
                <>
                  <Button variant="outline" onClick={() => void handlePrint()}>
                    <Printer className="mr-2 h-4 w-4" />
                    {tt('financeDocs.mz.printInvoice', 'Print')}
                  </Button>
                  <Button variant="outline" onClick={() => void handleDownloadPdf()}>
                    <Download className="mr-2 h-4 w-4" />
                    {tt('financeDocs.mz.downloadPdf', 'Download PDF')}
                  </Button>
                  <Button variant="outline" onClick={() => void handleShare()}>
                    <Share2 className="mr-2 h-4 w-4" />
                    {tt('financeDocs.mz.shareInvoice', 'Share')}
                  </Button>
                </>
              ) : null}
              {row.document_workflow_status === 'draft' ? (
                <Button onClick={() => void handleWorkflowChange('posted')} disabled={posting || voiding}>
                  {posting ? tt('financeDocs.vendorBills.posting', 'Posting...') : tt('financeDocs.vendorBills.postBill', 'Post vendor bill')}
                </Button>
              ) : null}
              {row.document_workflow_status !== 'voided' ? (
                <Button variant="outline" onClick={() => void handleWorkflowChange('voided')} disabled={posting || voiding}>
                  {voiding ? tt('financeDocs.vendorBills.voiding', 'Voiding...') : tt('financeDocs.vendorBills.voidBill', 'Void bill')}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{tt('financeDocs.vendorBills.apIdentity', 'AP identity')}</CardTitle>
                <CardDescription>
                  {tt('financeDocs.vendorBills.apIdentityHelp', 'Supplier-facing references stay visible, while the internal reference and linked purchase order remain the controlled audit trail.')}
                </CardDescription>
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
                <CardTitle>{tt('financeDocs.vendorBills.settlementTitle', 'Settlement and resolution')}</CardTitle>
                <CardDescription>
                  {tt('financeDocs.vendorBills.settlementHelp', 'Once posted, this vendor bill becomes the payable anchor. Payments reduce the same AP document instead of leaving the purchase order as a duplicate liability target.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={resolutionTone(row.resolution_status)}>
                    {tt(vendorBillResolutionLabelKey(row.resolution_status), row.resolution_status)}
                  </Badge>
                  <Badge variant={row.settlement_status === 'overdue' ? 'destructive' : 'secondary'}>
                    {tt(settlementLabelKey(row.settlement_status), row.settlement_status)}
                  </Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.total', 'Total')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{formatBaseMoney(row.total_amount_base)}</div>
                      <div className="text-xs text-muted-foreground">{formatDocumentMoney(row.total_amount, row.currency_code)}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{formatBaseMoney(row.settled_base)}</div>
                      <div className="text-xs text-muted-foreground">
                        {tt('financeDocs.vendorBills.paymentsBreakdown', 'Cash {cash} · Bank {bank}', {
                          cash: formatBaseMoney(row.cash_paid_base),
                          bank: formatBaseMoney(row.bank_paid_base),
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums font-semibold">{formatBaseMoney(row.outstanding_base)}</div>
                      <div className="text-xs text-muted-foreground">{tt('financeDocs.vendorBills.anchorReference', 'Settlement anchor: vendor bill')}</div>
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('financeDocs.fields.lines', 'Lines')}</CardTitle>
              <CardDescription>
                {tt('financeDocs.vendorBills.linesHelp', 'Posted vendor bills keep their line values immutable and separate from the source purchase order.')}
              </CardDescription>
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
                        <TableCell className="text-right font-mono tabular-nums">{formatDocumentMoney(line.line_total + line.tax_amount, row.currency_code)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('financeDocs.mz.auditTrail', 'Audit trail')}</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.auditEmpty', 'No audit events have been captured for this document yet.')}</p>
              ) : (
                <div className="space-y-3">
                  {events.map((event) => (
                    <div key={event.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-medium">{event.event_type}</div>
                        <div className="text-xs text-muted-foreground">{event.occurred_at.replace('T', ' ').slice(0, 19)}</div>
                      </div>
                      {(event.from_status || event.to_status) ? (
                        <div className="mt-1 text-sm text-muted-foreground">
                          {event.from_status || '-'} {'->'} {event.to_status || '-'}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
