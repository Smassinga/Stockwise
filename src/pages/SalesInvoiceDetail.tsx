import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ArrowLeft, Download, Printer, ReceiptText, Share2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Checkbox } from '../components/ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Textarea } from '../components/ui/textarea'
import { useOrg } from '../hooks/useOrg'
import { useBrandForDocs } from '../hooks/useBrandForDocs'
import { supabase } from '../lib/supabase'
import { useI18n, withI18nFallback } from '../lib/i18n'
import {
  salesInvoiceResolutionLabelKey,
  type SalesInvoiceStateRow,
} from '../lib/financeDocuments'
import { settlementLabelKey } from '../lib/orderState'
import {
  createAndIssueSalesCreditNoteForInvoice,
  getSalesInvoiceDraftPreview,
  getSalesInvoiceDocument,
  issueSalesInvoice,
  listFinanceEvents,
  listFiscalArtifacts,
  listSalesCreditNoteLines,
  listSalesCreditNotesForInvoice,
  listSalesInvoiceDocumentLines,
  type CreateSalesCreditNoteInput,
  type FinanceDocumentEventRow,
  type FiscalDocumentArtifactRow,
  type SalesCreditNoteLineRow,
  type SalesCreditNoteRow,
  type SalesInvoiceDraftPreview,
  type SalesInvoiceDocumentLineRow,
  type SalesInvoiceDocumentRow,
  prepareSalesInvoiceDraftForIssue,
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

type CreditMode = 'full' | 'partial'

type CreditLineDraft = {
  selected: boolean
  quantity: string
  amount: string
}

type CreditAvailabilityRow = {
  line: SalesInvoiceDocumentLineRow
  alreadyCreditedQty: number
  alreadyCreditedNet: number
  alreadyCreditedTax: number
  availableQty: number
  availableNet: number
  availableTax: number
  availableGross: number
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseDraftNumber(value: string) {
  const normalized = String(value || '').replace(',', '.').trim()
  if (!normalized) return 0
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatDraftNumber(value: number, digits = 2) {
  if (value <= 0) return ''
  const fixed = value.toFixed(digits)
  return fixed.replace(/\.00$/, '').replace(/(\.\d*?)0+$/, '$1')
}

export default function SalesInvoiceDetailPage() {
  const { invoiceId } = useParams()
  const navigate = useNavigate()
  const { companyId } = useOrg()
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const brand = useBrandForDocs(companyId)

  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<SalesInvoiceDocumentRow | null>(null)
  const [invoiceState, setInvoiceState] = useState<SalesInvoiceStateRow | null>(null)
  const [lines, setLines] = useState<SalesInvoiceDocumentLineRow[]>([])
  const [events, setEvents] = useState<FinanceDocumentEventRow[]>([])
  const [artifacts, setArtifacts] = useState<FiscalDocumentArtifactRow[]>([])
  const [creditNotes, setCreditNotes] = useState<SalesCreditNoteRow[]>([])
  const [creditNoteLines, setCreditNoteLines] = useState<SalesCreditNoteLineRow[]>([])
  const [draftPreview, setDraftPreview] = useState<SalesInvoiceDraftPreview | null>(null)
  const [invoiceDateDraft, setInvoiceDateDraft] = useState('')
  const [dueDateDraft, setDueDateDraft] = useState('')
  const [vatExemptionReasonDraft, setVatExemptionReasonDraft] = useState('')
  const [savingDraft, setSavingDraft] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [creditDialogOpen, setCreditDialogOpen] = useState(false)
  const [creditMode, setCreditMode] = useState<CreditMode>('full')
  const [creditReason, setCreditReason] = useState('')
  const [creditVatExemptionReason, setCreditVatExemptionReason] = useState('')
  const [creditLineDrafts, setCreditLineDrafts] = useState<Record<string, CreditLineDraft>>({})
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
      setInvoiceState(null)
      setLines([])
      setEvents([])
      setArtifacts([])
      setCreditNotes([])
      setCreditNoteLines([])
      setDraftPreview(null)
      return
    }

    try {
      setLoading(true)
      const nextInvoice = await getSalesInvoiceDocument(companyId, invoiceId)
      const [nextLines, nextEvents, nextArtifacts, nextCreditNotes, nextInvoiceStateRes] = await Promise.all([
        listSalesInvoiceDocumentLines(companyId, invoiceId),
        listFinanceEvents(companyId, 'sales_invoice', invoiceId),
        listFiscalArtifacts(companyId, 'sales_invoice', invoiceId),
        listSalesCreditNotesForInvoice(companyId, invoiceId),
        supabase
          .from('v_sales_invoice_state')
          .select('*')
          .eq('company_id', companyId)
          .eq('id', invoiceId)
          .maybeSingle(),
      ])
      let nextDraftPreview: SalesInvoiceDraftPreview | null = null
      let nextCreditNoteLines: SalesCreditNoteLineRow[] = []

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

      try {
        nextCreditNoteLines = await listSalesCreditNoteLines(
          companyId,
          nextCreditNotes.map((note) => note.id),
        )
      } catch (error) {
        reportRuntimeError('loadCreditNoteLines', error, {
          creditNoteCount: nextCreditNotes.length,
        })
      }

      setInvoice(nextInvoice)
      if (nextInvoiceStateRes.error) {
        reportRuntimeError('loadInvoiceState', nextInvoiceStateRes.error)
        setInvoiceState(null)
      } else {
        setInvoiceState((nextInvoiceStateRes.data || null) as SalesInvoiceStateRow | null)
      }
      setLines(nextLines)
      setEvents(nextEvents)
      setArtifacts(nextArtifacts)
      setCreditNotes(nextCreditNotes)
      setCreditNoteLines(nextCreditNoteLines)
      setDraftPreview(nextDraftPreview)
      setInvoiceDateDraft(nextInvoice?.invoice_date || '')
      setDueDateDraft(nextInvoice?.due_date || '')
      setVatExemptionReasonDraft(nextInvoice?.vat_exemption_reason_text || '')
    } catch (error: any) {
      reportRuntimeError('loadWorkspace', error)
      toast.error(error?.message || tt('financeDocs.salesInvoices.loadFailed', 'Failed to load sales invoice'))
      setInvoice(null)
      setCreditNoteLines([])
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
  const visibleVatExemptionReason = invoice?.vat_exemption_reason_text || tt('financeDocs.mz.vatExemptionReasonNotApplicable', 'Not applicable')
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
    () => (invoice && isIssued
      ? buildSalesInvoiceOutputModel(invoice, lines, {
        brandName: brand.name,
        logoUrl: brand.logoUrl,
      })
      : null),
    [brand.logoUrl, brand.name, invoice, isIssued, lines],
  )
  const invoiceHasExemptLines = useMemo(
    () => lines.some((line) => Number(line.line_total || 0) > 0 && Number(line.tax_rate || 0) <= 0),
    [lines],
  )
  const settlementStatusLabel = invoiceState?.settlement_status
    ? tt(settlementLabelKey(invoiceState.settlement_status), invoiceState.settlement_status)
    : tt('common.dash', '—')
  const resolutionStatusLabel = invoiceState?.resolution_status
    ? tt(salesInvoiceResolutionLabelKey(invoiceState.resolution_status), invoiceState.resolution_status)
    : tt('common.dash', '—')
  const creditStatusLabel = invoiceState?.credit_status === 'fully_credited'
    ? tt('financeDocs.mz.creditStatus.fullyCredited', 'Fully credited')
    : invoiceState?.credit_status === 'partially_credited'
      ? tt('financeDocs.mz.creditStatus.partiallyCredited', 'Partially credited')
      : tt('financeDocs.mz.creditStatus.notCredited', 'Not credited')
  const issuedCreditNoteIds = useMemo(
    () => new Set(creditNotes.filter((note) => note.document_workflow_status === 'issued').map((note) => note.id)),
    [creditNotes],
  )
  const creditAvailability = useMemo<CreditAvailabilityRow[]>(() => {
    const rollupByLineId = new Map<string, { qty: number; lineTotal: number; taxAmount: number }>()

    creditNoteLines.forEach((line) => {
      if (!issuedCreditNoteIds.has(line.sales_credit_note_id) || !line.sales_invoice_line_id) return
      const current = rollupByLineId.get(line.sales_invoice_line_id) || { qty: 0, lineTotal: 0, taxAmount: 0 }
      current.qty = roundMoney(current.qty + Number(line.qty || 0))
      current.lineTotal = roundMoney(current.lineTotal + Number(line.line_total || 0))
      current.taxAmount = roundMoney(current.taxAmount + Number(line.tax_amount || 0))
      rollupByLineId.set(line.sales_invoice_line_id, current)
    })

    return lines.map((line) => {
      const alreadyCredited = rollupByLineId.get(line.id) || { qty: 0, lineTotal: 0, taxAmount: 0 }
      const availableQty = roundMoney(Math.max(Number(line.qty || 0) - alreadyCredited.qty, 0))
      const availableNet = roundMoney(Math.max(Number(line.line_total || 0) - alreadyCredited.lineTotal, 0))
      const availableTax = roundMoney(Math.max(Number(line.tax_amount || 0) - alreadyCredited.taxAmount, 0))

      return {
        line,
        alreadyCreditedQty: alreadyCredited.qty,
        alreadyCreditedNet: alreadyCredited.lineTotal,
        alreadyCreditedTax: alreadyCredited.taxAmount,
        availableQty,
        availableNet,
        availableTax,
        availableGross: roundMoney(availableNet + availableTax),
      }
    })
  }, [creditNoteLines, issuedCreditNoteIds, lines])

  useEffect(() => {
    if (!creditDialogOpen) return

    setCreditMode('full')
    setCreditReason('')
    setCreditVatExemptionReason(invoice?.vat_exemption_reason_text || '')
    setCreditLineDrafts(
      Object.fromEntries(
        creditAvailability.map((availability) => [
          availability.line.id,
          { selected: false, quantity: '', amount: '' },
        ]),
      ),
    )
  }, [creditAvailability, creditDialogOpen, invoice?.vat_exemption_reason_text])

  const issuedCreditedDocumentTotal = useMemo(
    () => roundMoney(creditNotes
      .filter((note) => note.document_workflow_status === 'issued')
      .reduce((sum, note) => sum + Number(note.total_amount || 0), 0)),
    [creditNotes],
  )
  const creditPreview = useMemo(() => {
    const previewLines: CreateSalesCreditNoteInput['lines'] = []
    const validationErrors: string[] = []
    let requiresVatExemptionReason = false

    creditAvailability.forEach((availability) => {
      const { line, availableQty, availableNet, availableTax } = availability
      if (creditMode === 'full') {
        if (availableNet <= 0 && availableTax <= 0) return

        previewLines.push({
          salesInvoiceLineId: line.id,
          itemId: line.item_id,
          description: line.display_description || line.description,
          qty: availableQty,
          unitPrice: availableQty > 0 ? roundMoney(availableNet / availableQty) : roundMoney(availableNet),
          taxRate: line.tax_rate,
          taxAmount: availableTax,
          lineTotal: availableNet,
          sortOrder: line.sort_order,
        })

        if (Number(line.tax_rate || 0) <= 0 && availableNet > 0) {
          requiresVatExemptionReason = true
        }
        return
      }

      const draft = creditLineDrafts[line.id]
      if (!draft?.selected) return

      const requestedQty = roundMoney(parseDraftNumber(draft.quantity))
      const requestedAmount = roundMoney(parseDraftNumber(draft.amount))

      if (requestedQty <= 0 && requestedAmount <= 0) {
        validationErrors.push(
          tt('financeDocs.mz.creditLineEmpty', 'Enter a quantity and/or amount for {description}.', {
            description: line.display_description || line.description,
          }),
        )
        return
      }

      if (requestedQty - availableQty > 0.005) {
        validationErrors.push(
          tt('financeDocs.mz.creditQtyTooHigh', 'Credited quantity cannot exceed the remaining quantity on {description}.', {
            description: line.display_description || line.description,
          }),
        )
      }

      const derivedAmount = requestedAmount > 0
        ? requestedAmount
        : requestedQty > 0 && availableQty > 0
          ? roundMoney((availableNet / availableQty) * requestedQty)
          : 0

      if (derivedAmount - availableNet > 0.005) {
        validationErrors.push(
          tt('financeDocs.mz.creditAmountTooHigh', 'Credited amount cannot exceed the remaining value on {description}.', {
            description: line.display_description || line.description,
          }),
        )
      }

      if (derivedAmount <= 0) return

      const taxRatio = availableNet > 0
        ? availableTax / availableNet
        : Number(line.line_total || 0) > 0
          ? Number(line.tax_amount || 0) / Number(line.line_total || 0)
          : 0
      const lineTaxAmount = Math.abs(derivedAmount - availableNet) <= 0.01
        ? availableTax
        : roundMoney(derivedAmount * taxRatio)

      if (lineTaxAmount - availableTax > 0.01) {
        validationErrors.push(
          tt('financeDocs.mz.creditTaxTooHigh', 'Credited tax cannot exceed the remaining tax on {description}.', {
            description: line.display_description || line.description,
          }),
        )
      }

      previewLines.push({
        salesInvoiceLineId: line.id,
        itemId: line.item_id,
        description: line.display_description || line.description,
        qty: requestedQty,
        unitPrice: requestedQty > 0 ? roundMoney(derivedAmount / requestedQty) : roundMoney(derivedAmount),
        taxRate: line.tax_rate,
        taxAmount: Math.min(lineTaxAmount, availableTax),
        lineTotal: Math.min(derivedAmount, availableNet),
        sortOrder: line.sort_order,
      })

      if (Number(line.tax_rate || 0) <= 0 && derivedAmount > 0) {
        requiresVatExemptionReason = true
      }
    })

    const noteNet = roundMoney(previewLines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0))
    const noteTax = roundMoney(previewLines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0))
    const noteTotal = roundMoney(noteNet + noteTax)
    const creditedAfterThisNote = roundMoney(issuedCreditedDocumentTotal + noteTotal)
    const residualAfterThisNote = roundMoney(Math.max(Number(invoice?.total_amount || 0) - creditedAfterThisNote, 0))

    return {
      lines: previewLines,
      noteNet,
      noteTax,
      noteTotal,
      creditedAfterThisNote,
      residualAfterThisNote,
      requiresVatExemptionReason,
      validationErrors: Array.from(new Set(validationErrors)),
    }
  }, [creditAvailability, creditLineDrafts, creditMode, invoice?.total_amount, issuedCreditedDocumentTotal, tt])
  const canCreateCreditNote = isIssued && (invoiceState ? invoiceState.credit_status !== 'fully_credited' : true)

  function resolutionTone(status?: SalesInvoiceStateRow['resolution_status'] | null) {
    switch (status) {
      case 'issued_fully_credited':
      case 'issued_settled':
        return 'default'
      case 'issued_overdue':
        return 'destructive'
      default:
        return 'secondary'
    }
  }

  async function handleSaveDraftDates() {
    if (!companyId || !invoice || !isDraft) return
    try {
      setSavingDraft(true)
      const updated = await updateSalesInvoiceDraftDates(
        companyId,
        invoice.id,
        invoiceDateDraft,
        dueDateDraft,
        vatExemptionReasonDraft,
      )
      setInvoice(updated)
      toast.success(tt('financeDocs.mz.draftDatesSaved', 'Draft invoice dates saved'))
      await loadWorkspace()
    } catch (error: any) {
      reportRuntimeError('saveDraftDates', error, {
        draftInvoiceDate: invoiceDateDraft,
        draftDueDate: dueDateDraft,
        hasVatExemptionReason: Boolean(vatExemptionReasonDraft.trim()),
      })
      toast.error(error?.message || tt('financeDocs.mz.draftDatesSaveFailed', 'Failed to save draft invoice dates'))
    } finally {
      setSavingDraft(false)
    }
  }

  async function handleIssueInvoice() {
    if (!companyId || !invoice || !isDraft) return
    if (invoiceHasExemptLines && !vatExemptionReasonDraft.trim()) {
      toast.error(tt('financeDocs.mz.vatExemptionReasonRequired', 'A VAT exemption reason is required for exempt lines.'))
      return
    }
    try {
      setIssuing(true)
      await updateSalesInvoiceDraftDates(
        companyId,
        invoice.id,
        invoiceDateDraft,
        dueDateDraft,
        vatExemptionReasonDraft,
      )
      await prepareSalesInvoiceDraftForIssue(companyId, invoice.id)
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
    if (!creditReason.trim()) {
      toast.error(tt('financeDocs.mz.creditReasonRequired', 'A correction reason is required before issuing the credit note.'))
      return
    }
    if (!creditPreview.lines.length) {
      toast.error(tt('financeDocs.mz.creditSelectionRequired', 'Select at least one eligible line to credit.'))
      return
    }
    if (creditPreview.validationErrors.length) {
      toast.error(creditPreview.validationErrors[0])
      return
    }
    if (creditPreview.requiresVatExemptionReason && !creditVatExemptionReason.trim()) {
      toast.error(tt('financeDocs.mz.vatExemptionReasonRequired', 'A VAT exemption reason is required for exempt lines.'))
      return
    }

    try {
      setCreatingCredit(true)
      const note = await createAndIssueSalesCreditNoteForInvoice(companyId, invoice.id, {
        correctionReasonText: creditReason,
        vatExemptionReasonText: creditVatExemptionReason,
        lines: creditPreview.lines,
      })
      toast.success(tt('financeDocs.mz.creditNoteIssued', 'Credit note {reference} issued', { reference: note.internal_reference }))
      setCreditDialogOpen(false)
      setCreditReason('')
      setCreditVatExemptionReason('')
      setCreditLineDrafts({})
      await loadWorkspace()
    } catch (error: any) {
      reportRuntimeError('createCreditNote', error, {
        correctionReasonLength: creditReason.trim().length,
        creditMode,
        requestedLineCount: creditPreview.lines.length,
      })
      toast.error(error?.message || tt('financeDocs.mz.creditNoteFailed', 'Failed to issue the credit note'))
    } finally {
      setCreatingCredit(false)
    }
  }

  function updateCreditLineDraft(lineId: string, patch: Partial<CreditLineDraft>) {
    setCreditLineDrafts((current) => ({
      ...current,
      [lineId]: {
        selected: current[lineId]?.selected || false,
        quantity: current[lineId]?.quantity || '',
        amount: current[lineId]?.amount || '',
        ...patch,
      },
    }))
  }

  function toggleCreditLineSelection(availability: CreditAvailabilityRow, checked: boolean) {
    if (!checked) {
      updateCreditLineDraft(availability.line.id, {
        selected: false,
        quantity: '',
        amount: '',
      })
      return
    }

    updateCreditLineDraft(availability.line.id, {
      selected: true,
      quantity: formatDraftNumber(availability.availableQty),
      amount: '',
    })
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
                <div className="md:col-span-2">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {tt('financeDocs.mz.vatExemptionReason', 'VAT exemption reason')}
                  </div>
                  {isDraft ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={vatExemptionReasonDraft}
                        onChange={(event) => setVatExemptionReasonDraft(event.target.value)}
                        placeholder={tt('financeDocs.mz.vatExemptionReasonPlaceholder', 'State the Mozambique VAT exemption reason when exempt lines are present')}
                        rows={3}
                      />
                      <div className="text-xs text-muted-foreground">
                        {tt('financeDocs.mz.vatExemptionReasonHelp', 'Required only when the invoice contains exempt VAT lines. The stored wording is frozen on issue and used on the final document output.')}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-sm">{visibleVatExemptionReason}</div>
                  )}
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
            <Card className="border-border/80 shadow-sm lg:col-span-2">
              <CardHeader>
                <CardTitle>{tt('financeDocs.mz.resolutionTitle', 'Settlement and resolution')}</CardTitle>
                <CardDescription>
                  {tt('financeDocs.mz.resolutionHelp', 'Once issued, the invoice becomes the receivable anchor. Receipts and credit notes reduce the same outstanding balance instead of leaving the original order as a duplicate settlement target.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant={resolutionTone(invoiceState?.resolution_status)}>{resolutionStatusLabel}</Badge>
                  <Badge variant={invoiceState?.credit_status === 'fully_credited' ? 'default' : 'outline'}>{creditStatusLabel}</Badge>
                  <Badge variant={invoiceState?.settlement_status === 'overdue' ? 'destructive' : 'secondary'}>{settlementStatusLabel}</Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.originalAmount', 'Original total')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{money(invoiceState?.total_amount_base || invoice.total_amount_mzn, 'MZN')}</div>
                      <div className="text-xs text-muted-foreground">
                        {tt('financeDocs.mz.originalAmountHelp', 'Issued invoice total before receipts and credit notes')}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{money(invoiceState?.settled_base || 0, 'MZN')}</div>
                      <div className="text-xs text-muted-foreground">
                        {tt('financeDocs.mz.receiptsBreakdown', 'Cash {cash} · Bank {bank}', {
                          cash: money(invoiceState?.cash_received_base || 0, 'MZN'),
                          bank: money(invoiceState?.bank_received_base || 0, 'MZN'),
                        })}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.creditedAmount', 'Credited')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{money(invoiceState?.credited_total_base || 0, 'MZN')}</div>
                      <div className="text-xs text-muted-foreground">
                        {tt('financeDocs.mz.creditNotesCount', '{count} credit notes issued', { count: invoiceState?.credit_note_count || 0 })}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums font-semibold">{money(invoiceState?.outstanding_base || 0, 'MZN')}</div>
                      <div className="text-xs text-muted-foreground">
                        {tt('financeDocs.mz.anchorReference', 'Settlement anchor: issued sales invoice')}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                  {invoiceState?.credit_status === 'fully_credited'
                    ? tt('financeDocs.mz.invoiceResolvedFullyCredited', 'This invoice has been fully credited. It no longer carries an open receivable balance and should be treated as operationally resolved.')
                    : invoiceState?.credit_status === 'partially_credited'
                      ? tt('financeDocs.mz.invoiceResolvedPartiallyCredited', 'This invoice has already been partially credited. The remaining balance reflects receipts and issued credit notes together.')
                      : tt('financeDocs.mz.invoiceResolvedOpen', 'Outstanding exposure now belongs to this invoice, not to the linked sales order.')}
                </div>
              </CardContent>
            </Card>

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
                          <div className="font-medium">{line.display_description || line.description || tt('common.dash', '-')}</div>
                          {line.display_unit_of_measure ? <div className="text-xs text-muted-foreground">{line.display_unit_of_measure}</div> : null}
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
                {tt('financeDocs.mz.creditNotesHelp', 'Corrections must flow through credit notes. Choose a full remaining reversal or a partial line-by-line credit without editing the issued invoice itself.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isIssued ? (
                canCreateCreditNote ? (
                  <Button onClick={() => setCreditDialogOpen(true)}>
                    {tt('financeDocs.mz.issueCreditNote', 'Issue credit note')}
                  </Button>
                ) : (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                    {invoiceState?.credit_status === 'fully_credited'
                      ? tt('financeDocs.mz.creditNotesFullyResolved', 'This invoice is already fully credited. No further credit note can be issued against it.')
                      : tt('financeDocs.mz.creditNotesPartialResolved', 'This invoice already has credit-note adjustments. Open the credit-note workflow again if more remaining value still needs to be credited.')}
                  </div>
                )
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
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle>{tt('financeDocs.mz.creditDialogTitle', 'Issue credit note')}</DialogTitle>
                <DialogDescription>
                  {tt('financeDocs.mz.creditDialogHelp', 'Choose a full remaining reversal or build a partial credit note from selected invoice lines. The original invoice remains issued while the credited amount accumulates against it.')}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <div className="space-y-5">
                  <RadioGroup
                    value={creditMode}
                    onValueChange={(value) => setCreditMode(value as CreditMode)}
                    className="grid gap-3 md:grid-cols-2"
                  >
                    <label
                      htmlFor="credit-mode-full"
                      className={`rounded-2xl border p-4 ${creditMode === 'full' ? 'border-primary bg-primary/5' : 'border-border/70 bg-background'}`}
                    >
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="credit-mode-full" value="full" className="mt-1" />
                        <div className="space-y-1">
                          <div className="font-medium">{tt('financeDocs.mz.creditModeFull', 'Full remaining credit')}</div>
                          <div className="text-sm text-muted-foreground">
                            {tt('financeDocs.mz.creditModeFullHelp', 'Credit every remaining eligible line balance still open on this invoice.')}
                          </div>
                        </div>
                      </div>
                    </label>
                    <label
                      htmlFor="credit-mode-partial"
                      className={`rounded-2xl border p-4 ${creditMode === 'partial' ? 'border-primary bg-primary/5' : 'border-border/70 bg-background'}`}
                    >
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="credit-mode-partial" value="partial" className="mt-1" />
                        <div className="space-y-1">
                          <div className="font-medium">{tt('financeDocs.mz.creditModePartial', 'Partial credit')}</div>
                          <div className="text-sm text-muted-foreground">
                            {tt('financeDocs.mz.creditModePartialHelp', 'Select individual lines, reduce quantities, or enter a smaller credit value for a commercial adjustment.')}
                          </div>
                        </div>
                      </div>
                    </label>
                  </RadioGroup>

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

                  <div>
                    <Label htmlFor="credit-note-vat-exemption-reason">
                      {tt('financeDocs.mz.vatExemptionReason', 'VAT exemption reason')}
                    </Label>
                    <Textarea
                      id="credit-note-vat-exemption-reason"
                      value={creditVatExemptionReason}
                      onChange={(event) => setCreditVatExemptionReason(event.target.value)}
                      placeholder={tt('financeDocs.mz.vatExemptionReasonPlaceholder', 'State the Mozambique VAT exemption reason when exempt lines are present')}
                      rows={3}
                    />
                    <div className="mt-1 text-xs text-muted-foreground">
                      {tt('financeDocs.mz.creditVatExemptionReasonHelp', 'Required only when the selected credit lines are VAT exempt.')}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.originalAmount', 'Original total')}</div>
                      <div className="mt-2 font-mono tabular-nums font-semibold">{money(invoice.total_amount, invoice.currency_code)}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.alreadyCredited', 'Already credited')}</div>
                      <div className="mt-2 font-mono tabular-nums font-semibold">{money(issuedCreditedDocumentTotal, invoice.currency_code)}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.thisCreditNote', 'This credit note')}</div>
                      <div className="mt-2 font-mono tabular-nums font-semibold">{money(creditPreview.noteTotal, invoice.currency_code)}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.creditedAfterThisNote', 'Credited after this note')}</div>
                      <div className="mt-2 font-mono tabular-nums font-semibold">{money(creditPreview.creditedAfterThisNote, invoice.currency_code)}</div>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.mz.residualAfterThisNote', 'Residual after this note')}</div>
                      <div className="mt-2 font-mono tabular-nums font-semibold">{money(creditPreview.residualAfterThisNote, invoice.currency_code)}</div>
                    </div>
                  </div>

                  {creditMode === 'partial' ? (
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium">{tt('financeDocs.mz.creditLinesTitle', 'Select invoice lines to credit')}</div>
                        <div className="text-sm text-muted-foreground">
                          {tt('financeDocs.mz.creditLinesHelp', 'Use quantity for returned units or enter a smaller net amount for a partial value adjustment.')}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {creditAvailability.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                            {tt('financeDocs.mz.creditLinesEmpty', 'No invoice lines are available for crediting.')}
                          </div>
                        ) : (
                          creditAvailability.map((availability) => {
                            const lineDraft = creditLineDrafts[availability.line.id] || { selected: false, quantity: '', amount: '' }
                            const lineDescription = availability.line.display_description || availability.line.description || tt('common.dash', '-')

                            return (
                              <div key={availability.line.id} className="rounded-2xl border border-border/70 bg-background p-4">
                                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <label className="flex items-start gap-3">
                                      <Checkbox
                                        checked={lineDraft.selected}
                                        onCheckedChange={(checked) => toggleCreditLineSelection(availability, checked === true)}
                                        disabled={availability.availableNet <= 0 && availability.availableTax <= 0}
                                        aria-label={lineDescription}
                                      />
                                      <div className="min-w-0">
                                        <div className="font-medium">{lineDescription}</div>
                                        {availability.line.display_unit_of_measure ? (
                                          <div className="mt-1 text-xs text-muted-foreground">{availability.line.display_unit_of_measure}</div>
                                        ) : null}
                                      </div>
                                    </label>

                                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                                      <div>{tt('financeDocs.mz.availableQty', 'Remaining qty')}: <span className="font-mono tabular-nums">{availability.availableQty}</span></div>
                                      <div>{tt('financeDocs.mz.availableNet', 'Remaining net')}: <span className="font-mono tabular-nums">{money(availability.availableNet, invoice.currency_code)}</span></div>
                                      <div>{tt('financeDocs.mz.availableTax', 'Remaining VAT')}: <span className="font-mono tabular-nums">{money(availability.availableTax, invoice.currency_code)}</span></div>
                                      <div>{tt('financeDocs.mz.alreadyCreditedShort', 'Already credited')}: <span className="font-mono tabular-nums">{money(availability.alreadyCreditedNet + availability.alreadyCreditedTax, invoice.currency_code)}</span></div>
                                    </div>
                                  </div>

                                  <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[320px]">
                                    <div className="space-y-2">
                                      <Label htmlFor={`credit-line-qty-${availability.line.id}`}>{tt('financeDocs.mz.creditQty', 'Credited qty')}</Label>
                                      <Input
                                        id={`credit-line-qty-${availability.line.id}`}
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={lineDraft.quantity}
                                        onChange={(event) => updateCreditLineDraft(availability.line.id, { quantity: event.target.value, selected: true })}
                                        disabled={!lineDraft.selected}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor={`credit-line-amount-${availability.line.id}`}>{tt('financeDocs.mz.creditAmount', 'Credited net amount')}</Label>
                                      <Input
                                        id={`credit-line-amount-${availability.line.id}`}
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={lineDraft.amount}
                                        onChange={(event) => updateCreditLineDraft(availability.line.id, { amount: event.target.value, selected: true })}
                                        disabled={!lineDraft.selected}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                      {creditPreview.lines.length > 0
                        ? tt('financeDocs.mz.creditFullPreview', 'This action will credit every remaining eligible line balance still open on the original invoice.')
                        : tt('financeDocs.mz.creditNothingRemaining', 'No remaining creditable value is left on this invoice.')}
                    </div>
                  )}

                  {creditPreview.validationErrors.length > 0 ? (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                      {creditPreview.validationErrors[0]}
                    </div>
                  ) : null}
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreditDialogOpen(false)} disabled={creatingCredit}>
                  {tt('common.cancel', 'Cancel')}
                </Button>
                <Button
                  onClick={() => void handleCreateCreditNote()}
                  disabled={
                    creatingCredit
                    || !creditPreview.lines.length
                    || creditPreview.validationErrors.length > 0
                    || (creditPreview.requiresVatExemptionReason && !creditVatExemptionReason.trim())
                  }
                >
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
