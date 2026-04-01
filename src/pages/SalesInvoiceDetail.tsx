import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Download, Printer, ReceiptText, Share2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Textarea } from '../components/ui/textarea'
import { useOrg } from '../hooks/useOrg'
import { supabase } from '../lib/supabase'
import { useI18n, withI18nFallback } from '../lib/i18n'
import {
  createAndIssueFullCreditNoteForInvoice,
  getSalesInvoiceDraftPreview,
  getSalesInvoiceDocument,
  issueSalesInvoice,
  listFinanceEvents,
  listFiscalArtifacts,
  listSalesCreditNotesForInvoice,
  listSalesInvoiceDocumentLines,
  type FinanceDocumentEventRow,
  type FiscalDocumentArtifactRow,
  type SalesCreditNoteRow,
  type SalesInvoiceDraftPreview,
  type SalesInvoiceDocumentLineRow,
  type SalesInvoiceDocumentRow,
  updateSalesInvoiceDraftDates,
} from '../lib/mzFinance'
import {
  buildSalesInvoiceOutputModel,
  downloadSalesInvoicePdf,
  printSalesInvoiceDocument,
  shareSalesInvoiceDocument,
} from '../lib/mzInvoiceOutput'

function workflowTone(status: SalesInvoiceDocumentRow['document_workflow_status']) {
  switch (status) {
    case 'issued':
      return 'default'
    case 'voided':
      return 'destructive'
    default:
      return 'secondary'
  }
}

function shortDate(value?: string | null) {
  const text = String(value || '').trim()
  return text ? text.slice(0, 10) : '-'
}

export default function SalesInvoiceDetailPage() {
  const { invoiceId } = useParams()
  const navigate = useNavigate()
  const { companyId } = useOrg()
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'

  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<SalesInvoiceDocumentRow | null>(null)
  const [lines, setLines] = useState<SalesInvoiceDocumentLineRow[]>([])
  const [events, setEvents] = useState<FinanceDocumentEventRow[]>([])
  const [artifacts, setArtifacts] = useState<FiscalDocumentArtifactRow[]>([])
  const [creditNotes, setCreditNotes] = useState<SalesCreditNoteRow[]>([])
  const [draftPreview, setDraftPreview] = useState<SalesInvoiceDraftPreview | null>(null)
  const [invoiceDateDraft, setInvoiceDateDraft] = useState('')
  const [dueDateDraft, setDueDateDraft] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [creditDialogOpen, setCreditDialogOpen] = useState(false)
  const [creditReason, setCreditReason] = useState('')
  const [creatingCredit, setCreatingCredit] = useState(false)

  const money = (amount: number, currencyCode: string) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode || 'MZN',
    }).format(amount || 0)

  const joinAddressParts = (...parts: Array<string | null | undefined>) =>
    parts.map((part) => String(part || '').trim()).filter(Boolean).join(', ')

  function reportRuntimeError(event: string, error: unknown, context: Record<string, unknown> = {}) {
    console.error(`[mz-runtime] SalesInvoiceDetail.${event}`, {
      companyId,
      invoiceId,
      ...context,
      error,
    })
  }

  async function loadWorkspace() {
    if (!companyId || !invoiceId) {
      setLoading(false)
      setInvoice(null)
      setLines([])
      setEvents([])
      setArtifacts([])
      setCreditNotes([])
      setDraftPreview(null)
      return
    }

    try {
      setLoading(true)
      const nextInvoice = await getSalesInvoiceDocument(companyId, invoiceId)
      const [nextLines, nextEvents, nextArtifacts, nextCreditNotes] = await Promise.all([
        listSalesInvoiceDocumentLines(companyId, invoiceId),
        listFinanceEvents(companyId, 'sales_invoice', invoiceId),
        listFiscalArtifacts(companyId, 'sales_invoice', invoiceId),
        listSalesCreditNotesForInvoice(companyId, invoiceId),
      ])
      let nextDraftPreview: SalesInvoiceDraftPreview | null = null

      if (nextInvoice?.document_workflow_status === 'draft') {
        try {
          nextDraftPreview = await getSalesInvoiceDraftPreview(companyId, nextInvoice)
        } catch (error) {
          reportRuntimeError('loadDraftPreview', error, {
            salesOrderId: nextInvoice.sales_order_id,
            customerId: nextInvoice.customer_id,
          })
        }
      }

      setInvoice(nextInvoice)
      setLines(nextLines)
      setEvents(nextEvents)
      setArtifacts(nextArtifacts)
      setCreditNotes(nextCreditNotes)
      setDraftPreview(nextDraftPreview)
      setInvoiceDateDraft(nextInvoice?.invoice_date || '')
      setDueDateDraft(nextInvoice?.due_date || '')
    } catch (error: any) {
      reportRuntimeError('loadWorkspace', error)
      toast.error(error?.message || tt('financeDocs.salesInvoices.loadFailed', 'Failed to load sales invoice'))
      setInvoice(null)
      setDraftPreview(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadWorkspace()
  }, [companyId, invoiceId])

  const isDraft = invoice?.document_workflow_status === 'draft'
  const isIssued = invoice?.document_workflow_status === 'issued'
  const mznPreview = useMemo(() => {
    if (!invoice) return null
    const fxToBase = Number(invoice.fx_to_base || 0) > 0 ? Number(invoice.fx_to_base) : 1
    const roundCurrency = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

    return {
      subtotal: roundCurrency(Number(invoice.subtotal || 0) * fxToBase),
      tax: roundCurrency(Number(invoice.tax_total || 0) * fxToBase),
      total: roundCurrency(Number(invoice.total_amount || 0) * fxToBase),
    }
  }, [invoice])
  const visibleBuyerName = invoice?.buyer_legal_name_snapshot || draftPreview?.buyer_legal_name || tt('common.none', 'None')
  const visibleComputerPhrase = invoice?.computer_processed_phrase_snapshot || draftPreview?.computer_processed_phrase || tt('financeDocs.mz.notFrozenYet', 'Will be frozen on issue')
  const visibleSellerName = invoice?.seller_trade_name_snapshot || invoice?.seller_legal_name_snapshot || draftPreview?.seller_trade_name || draftPreview?.seller_legal_name || '-'
  const visibleSellerLegalName = invoice?.seller_legal_name_snapshot || draftPreview?.seller_legal_name || '-'
  const visibleSellerTaxId = invoice?.seller_nuit_snapshot || draftPreview?.seller_nuit || '-'
  const visibleSellerAddress = joinAddressParts(
    invoice?.seller_address_line1_snapshot || draftPreview?.seller_address_line1,
    invoice?.seller_address_line2_snapshot || draftPreview?.seller_address_line2,
    joinAddressParts(invoice?.seller_city_snapshot || draftPreview?.seller_city, invoice?.seller_state_snapshot || draftPreview?.seller_state),
    invoice?.seller_postal_code_snapshot || draftPreview?.seller_postal_code,
    invoice?.seller_country_code_snapshot || draftPreview?.seller_country_code,
  ) || '-'
  const visibleBuyerTaxId = invoice?.buyer_nuit_snapshot || draftPreview?.buyer_nuit || '-'
  const visibleBuyerAddress = joinAddressParts(
    invoice?.buyer_address_line1_snapshot || draftPreview?.buyer_address_line1,
    invoice?.buyer_address_line2_snapshot || draftPreview?.buyer_address_line2,
    joinAddressParts(invoice?.buyer_city_snapshot || draftPreview?.buyer_city, invoice?.buyer_state_snapshot || draftPreview?.buyer_state),
    invoice?.buyer_postal_code_snapshot || draftPreview?.buyer_postal_code,
    invoice?.buyer_country_code_snapshot || draftPreview?.buyer_country_code,
  ) || '-'
  const outputModel = useMemo(
    () => (invoice && isIssued ? buildSalesInvoiceOutputModel(invoice, lines) : null),
    [invoice, isIssued, lines],
  )

  async function handleSaveDraftDates() {
    if (!companyId || !invoice || !isDraft) return
    try {
      setSavingDraft(true)
      const updated = await updateSalesInvoiceDraftDates(companyId, invoice.id, invoiceDateDraft, dueDateDraft)
      setInvoice(updated)
      toast.success(tt('financeDocs.mz.draftDatesSaved', 'Draft invoice dates saved'))
      await loadWorkspace()
    } catch (error: any) {
      reportRuntimeError('saveDraftDates', error, {
        draftInvoiceDate: invoiceDateDraft,
        draftDueDate: dueDateDraft,
      })
      toast.error(error?.message || tt('financeDocs.mz.draftDatesSaveFailed', 'Failed to save draft invoice dates'))
    } finally {
      setSavingDraft(false)
    }
  }

  async function handleIssueInvoice() {
    if (!invoice || !isDraft) return
    try {
      setIssuing(true)
      await issueSalesInvoice(invoice.id)
      toast.success(tt('financeDocs.mz.issueSuccess', 'Sales invoice issued'))
      await loadWorkspace()
    } catch (error: any) {
      reportRuntimeError('issueInvoice', error, {
        documentWorkflowStatus: invoice.document_workflow_status,
      })
      toast.error(error?.message || tt('financeDocs.mz.issueFailed', 'Failed to issue sales invoice'))
    } finally {
      setIssuing(false)
    }
  }

  async function handlePrint() {
    if (!outputModel) return
    try {
      await printSalesInvoiceDocument(outputModel)
    } catch (error: any) {
      reportRuntimeError('printInvoice', error, {
        internalReference: outputModel.legalReference,
      })
      toast.error(error?.message || tt('financeDocs.mz.printFailed', 'Unable to open the invoice print view'))
    }
  }

  async function handleDownloadPdf() {
    if (!outputModel) return
    try {
      await downloadSalesInvoicePdf(outputModel)
    } catch (error: any) {
      reportRuntimeError('downloadPdf', error, {
        internalReference: outputModel.legalReference,
      })
      toast.error(error?.message || tt('financeDocs.mz.pdfFailed', 'Unable to generate the invoice PDF'))
    }
  }

  async function handleShare() {
    if (!outputModel) return
    try {
      await shareSalesInvoiceDocument(outputModel)
    } catch (error: any) {
      reportRuntimeError('shareInvoice', error, {
        internalReference: outputModel.legalReference,
      })
      toast.error(error?.message || tt('financeDocs.mz.shareFailed', 'Sharing is not available for this invoice on the current device'))
    }
  }

  async function handleCreateCreditNote() {
    if (!companyId || !invoice) return
    try {
      setCreatingCredit(true)
      const note = await createAndIssueFullCreditNoteForInvoice(companyId, invoice.id, creditReason)
      toast.success(tt('financeDocs.mz.creditNoteIssued', 'Credit note {reference} issued', { reference: note.internal_reference }))
      setCreditDialogOpen(false)
      setCreditReason('')
      await loadWorkspace()
    } catch (error: any) {
      reportRuntimeError('createCreditNote', error, {
        correctionReasonLength: creditReason.trim().length,
      })
      toast.error(error?.message || tt('financeDocs.mz.creditNoteFailed', 'Failed to issue the credit note'))
    } finally {
      setCreatingCredit(false)
    }
  }

  async function openArtifact(artifact: FiscalDocumentArtifactRow) {
    if (!artifact.storage_bucket || !artifact.storage_path) {
      toast.error(tt('financeDocs.mz.archiveNotReady', 'This archive entry has no retrievable storage file yet'))
      return
    }

    try {
      const { data, error } = await supabase.storage
        .from(artifact.storage_bucket)
        .createSignedUrl(artifact.storage_path, 60)

      if (error || !data?.signedUrl) throw error || new Error('Signed URL unavailable')
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (error: any) {
      reportRuntimeError('openArtifact', error, {
        artifactId: artifact.id,
        artifactType: artifact.artifact_type,
        storageBucket: artifact.storage_bucket,
        storagePath: artifact.storage_path,
      })
      toast.error(error?.message || tt('financeDocs.mz.archiveOpenFailed', 'Unable to open the archived file'))
    }
  }

  const orderLink = invoice?.sales_order_id
    ? `/orders?tab=sales&orderId=${encodeURIComponent(invoice.sales_order_id)}`
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {tt('financeDocs.back', 'Back')}
        </Button>
        <Button asChild variant="outline">
          <Link to="/sales-invoices">{tt('financeDocs.salesInvoices.title', 'Sales Invoices')}</Link>
        </Button>
        {orderLink ? (
          <Button asChild variant="outline">
            <Link to={orderLink}>{tt('financeDocs.viewLinkedOrder', 'View linked order')}</Link>
          </Button>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
      ) : !invoice ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {tt('financeDocs.salesInvoices.notFound', 'Sales invoice not found for the active company.')}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
                {tt('financeDocs.eyebrow', 'Finance documents')}
              </div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">{invoice.internal_reference}</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {isIssued
                  ? tt('financeDocs.mz.issuedHelper', 'Issued invoices are immutable. Corrections must be issued as credit notes.')
                  : tt('financeDocs.mz.draftHelper', 'Draft invoices remain editable only for minimal preparation dates until the compliance-gated issue action is run.')}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant={workflowTone(invoice.document_workflow_status)}>
                {invoice.document_workflow_status.toUpperCase()}
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
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{tt('financeDocs.mz.fiscalIdentity', 'Fiscal identity')}</CardTitle>
                <CardDescription>
                  {tt('financeDocs.mz.fiscalIdentityHelp', 'The visible legal reference stays operator-facing, while internal workflow continues to use stable ids.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.internalReference', 'Internal reference')}</div>
                  <div className="mt-1 font-medium">{invoice.internal_reference}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.customer', 'Customer')}</div>
                  <div className="mt-1">{visibleBuyerName}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.invoiceDate', 'Invoice date')}</div>
                  {isDraft ? (
                    <Input type="date" value={invoiceDateDraft} onChange={(event) => setInvoiceDateDraft(event.target.value)} />
                  ) : (
                    <div className="mt-1">{shortDate(invoice.invoice_date)}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.dueDate', 'Due date')}</div>
                  {isDraft ? (
                    <Input type="date" value={dueDateDraft} onChange={(event) => setDueDateDraft(event.target.value)} />
                  ) : (
                    <div className="mt-1">{shortDate(invoice.due_date)}</div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.computerPhrase', 'Computer processed wording')}</div>
                  <div className="mt-1 font-medium uppercase tracking-[0.08em]">
                    {visibleComputerPhrase}
                  </div>
                  {isDraft ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {tt('financeDocs.mz.previewFreezesOnIssue', 'Draft values preview the linked order and company settings. The stored fiscal snapshot is frozen on issue.')}
                    </div>
                  ) : null}
                </div>
                {isDraft ? (
                  <div className="md:col-span-2 flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => void handleSaveDraftDates()} disabled={savingDraft || issuing}>
                      {savingDraft ? tt('common.saving', 'Saving...') : tt('financeDocs.mz.saveDraftDates', 'Save draft dates')}
                    </Button>
                    <Button onClick={() => void handleIssueInvoice()} disabled={savingDraft || issuing}>
                      <ReceiptText className="mr-2 h-4 w-4" />
                      {issuing ? tt('financeDocs.mz.issuing', 'Issuing...') : tt('financeDocs.mz.issueInvoice', 'Issue invoice')}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{tt('financeDocs.fields.total', 'Total')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <span>{tt('financeDocs.fields.subtotal', 'Subtotal')}</span>
                  <span className="font-mono tabular-nums">{money(invoice.subtotal, invoice.currency_code)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>{tt('financeDocs.fields.taxTotal', 'Tax')}</span>
                  <span className="font-mono tabular-nums">{money(invoice.tax_total, invoice.currency_code)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-lg font-semibold">
                  <span>{tt('financeDocs.fields.total', 'Total')}</span>
                  <span className="font-mono tabular-nums">{money(invoice.total_amount, invoice.currency_code)}</span>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">MZN</div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>{tt('financeDocs.fields.subtotal', 'Subtotal')}</span>
                      <span className="font-mono tabular-nums">{money(isDraft ? (mznPreview?.subtotal || 0) : invoice.subtotal_mzn, 'MZN')}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>{tt('financeDocs.fields.taxTotal', 'Tax')}</span>
                      <span className="font-mono tabular-nums">{money(isDraft ? (mznPreview?.tax || 0) : invoice.tax_total_mzn, 'MZN')}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 font-semibold">
                      <span>{tt('financeDocs.fields.total', 'Total')}</span>
                      <span className="font-mono tabular-nums">{money(isDraft ? (mznPreview?.total || 0) : invoice.total_amount_mzn, 'MZN')}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{tt('financeDocs.mz.sellerSnapshot', 'Seller snapshot')}</CardTitle>
                {isDraft ? (
                  <CardDescription>{tt('financeDocs.mz.sellerPreviewHelp', 'Draft preview comes from the current company profile until issue freezes the seller snapshot.')}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="font-medium">{visibleSellerName}</div>
                {(invoice.seller_trade_name_snapshot || draftPreview?.seller_trade_name) ? <div>{visibleSellerLegalName}</div> : null}
                <div>{tt('company.taxId', 'Tax ID')}: {visibleSellerTaxId}</div>
                <div>{visibleSellerAddress}</div>
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{tt('financeDocs.mz.buyerSnapshot', 'Buyer snapshot')}</CardTitle>
                {isDraft ? (
                  <CardDescription>{tt('financeDocs.mz.buyerPreviewHelp', 'Draft preview comes from the linked sales order and customer until issue freezes the buyer snapshot.')}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="font-medium">{visibleBuyerName || '-'}</div>
                <div>{tt('company.taxId', 'Tax ID')}: {visibleBuyerTaxId}</div>
                <div>{visibleBuyerAddress}</div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('financeDocs.fields.lines', 'Lines')}</CardTitle>
              <CardDescription>
                {tt('financeDocs.mz.linesHelp', 'Issued invoices keep these line values immutable and separate from the source sales order.')}
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
                      <TableHead className="text-right">{tt('orders.unitPrice', 'Unit price')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.subtotal', 'Subtotal')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.taxTotal', 'Tax')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.total', 'Total')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <div className="font-medium">{line.description || tt('common.dash', '-')}</div>
                          {line.unit_of_measure_snapshot ? <div className="text-xs text-muted-foreground">{line.unit_of_measure_snapshot}</div> : null}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{line.qty}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(line.unit_price, invoice.currency_code)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(line.line_total, invoice.currency_code)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(line.tax_amount, invoice.currency_code)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(line.line_total + line.tax_amount, invoice.currency_code)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('financeDocs.mz.creditNotes', 'Credit notes')}</CardTitle>
              <CardDescription>
                {tt('financeDocs.mz.creditNotesHelp', 'Corrections must flow through credit notes. The invoice itself is not edited after issue.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isIssued ? (
                <Button onClick={() => setCreditDialogOpen(true)}>
                  {tt('financeDocs.mz.issueCreditNote', 'Issue full credit note')}
                </Button>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {tt('financeDocs.mz.creditNotesIssueOnly', 'Credit notes can only be created from issued invoices.')}
                </div>
              )}

              {creditNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.creditNotesEmpty', 'No credit notes have been issued against this invoice yet.')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tt('financeDocs.fields.internalReference', 'Internal reference')}</TableHead>
                      <TableHead>{tt('financeDocs.fields.invoiceDate', 'Date')}</TableHead>
                      <TableHead>{tt('financeDocs.fields.workflow', 'Workflow')}</TableHead>
                      <TableHead>{tt('orders.notes', 'Notes')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.total', 'Total')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditNotes.map((note) => (
                      <TableRow key={note.id}>
                        <TableCell className="font-medium">{note.internal_reference}</TableCell>
                        <TableCell>{shortDate(note.credit_note_date)}</TableCell>
                        <TableCell>
                          <Badge variant={note.document_workflow_status === 'issued' ? 'default' : 'secondary'}>
                            {note.document_workflow_status.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>{note.correction_reason_text}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(note.total_amount, note.currency_code)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
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
                            {event.from_status || '—'} → {event.to_status || '—'}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{tt('financeDocs.mz.archiveTitle', 'Archive and artifacts')}</CardTitle>
                <CardDescription>
                  {tt('financeDocs.mz.archiveHelp', 'Archived artifacts come from the fiscal_document_artifacts registry. Local PDF downloads do not create a retained archive record by themselves.')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {artifacts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tt('financeDocs.mz.archiveEmpty', 'No archived invoice artifacts are registered for this document yet.')}</p>
                ) : (
                  <div className="space-y-3">
                    {artifacts.map((artifact) => (
                      <div key={artifact.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium">{artifact.file_name || artifact.storage_path}</div>
                            <div className="text-xs text-muted-foreground">
                              {artifact.artifact_type} · {tt('financeDocs.mz.retainedUntil', 'Retained until')} {shortDate(artifact.retained_until)}
                            </div>
                          </div>
                          <Button variant="outline" size="sm" onClick={() => void openArtifact(artifact)}>
                            {tt('bank.view', 'View')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{tt('financeDocs.mz.creditDialogTitle', 'Issue credit note')}</DialogTitle>
                <DialogDescription>
                  {tt('financeDocs.mz.creditDialogHelp', 'This path creates a full credit note from the issued invoice lines and issues it through the live DB helper.')}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="credit-note-reason">{tt('financeDocs.mz.creditReason', 'Correction reason')}</Label>
                    <Textarea
                      id="credit-note-reason"
                      value={creditReason}
                      onChange={(event) => setCreditReason(event.target.value)}
                      placeholder={tt('financeDocs.mz.creditReasonPlaceholder', 'Describe why the invoice is being corrected')}
                      rows={4}
                    />
                  </div>
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreditDialogOpen(false)} disabled={creatingCredit}>
                  {tt('common.cancel', 'Cancel')}
                </Button>
                <Button onClick={() => void handleCreateCreditNote()} disabled={creatingCredit}>
                  {creatingCredit ? tt('financeDocs.mz.crediting', 'Issuing...') : tt('financeDocs.mz.confirmCreditNote', 'Issue credit note')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
