import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowLeft, Download, Printer, Share2 } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Checkbox } from '../components/ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Textarea } from '../components/ui/textarea'
import FinanceChainCard, { type FinanceChainItem } from '../components/finance/FinanceChainCard'
import FinanceTimelineCard from '../components/finance/FinanceTimelineCard'
import { useBrandForDocs } from '../hooks/useBrandForDocs'
import { useOrg } from '../hooks/useOrg'
import { getCompanyProfile, type CompanyProfile } from '../lib/companyProfile'
import { getBaseCurrencyCode } from '../lib/currency'
import { supabase } from '../lib/db'
import {
  financeActorLabel,
  financeEventSummary,
  financeEventTitle,
  financeEventTone,
  financeEventTransition,
  getAdjustmentReasonLabel,
  getAdjustmentReasonOptions,
  listFinanceActorDirectory,
  listFinanceSettlementAuditEvents,
  type FinanceActorDirectory,
  type FinanceSettlementAuditEvent,
  type FinanceTimelineEntry,
  type VendorBillRowLike,
} from '../lib/financeAudit'
import {
  VENDOR_BILL_STATE_VIEW,
  financeDocumentApprovalLabelKey,
  isMissingFinanceViewError,
  vendorBillAdjustmentLabelKey,
  vendorBillResolutionLabelKey,
  vendorBillWorkflowLabelKey,
  type VendorBillLineRow,
  type VendorBillStateRow,
} from '../lib/financeDocuments'
import {
  buildVendorBillOutputModel,
  buildVendorCreditNoteOutputModel,
  buildVendorDebitNoteOutputModel,
  downloadFinanceDocumentPdf,
  printFinanceDocument,
  shareFinanceDocument,
  type FinanceDocumentOutputModel,
} from '../lib/financeDocumentOutput'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { financeCan } from '../lib/permissions'
import {
  approveVendorBill,
  createAndPostVendorCreditNoteForBill,
  createAndPostVendorDebitNoteForBill,
  listVendorCreditNoteLines,
  listVendorCreditNotesForBill,
  listVendorDebitNoteLines,
  listVendorDebitNotesForBill,
  postVendorBill,
  requestVendorBillApproval,
  returnVendorBillToDraft,
  updateVendorBillDraftHeader,
  type FinanceDocumentEventRow,
  type VendorCreditNoteLineRow,
  type VendorCreditNoteRow,
  type VendorDebitNoteLineRow,
  type VendorDebitNoteRow,
  voidVendorBill,
} from '../lib/mzFinance'
import { settlementLabelKey } from '../lib/orderState'

type SupplierProfile = {
  name: string | null
  tax_id: string | null
}

type AdjustmentMode = 'full' | 'partial'

type AdjustmentLineDraft = {
  selected: boolean
  quantity: string
  amount: string
}

type CreditAvailabilityRow = {
  line: VendorBillLineRow
  alreadyCreditedQty: number
  alreadyCreditedNet: number
  alreadyCreditedTax: number
  availableQty: number
  availableNet: number
  availableTax: number
  availableGross: number
}

function workflowTone(status: 'draft' | 'posted' | 'voided') {
  switch (status) {
    case 'posted':
      return 'default'
    case 'voided':
      return 'destructive'
    default:
      return 'secondary'
  }
}

function approvalTone(status: VendorBillStateRow['approval_status']) {
  switch (status) {
    case 'approved':
      return 'default'
    case 'pending_approval':
      return 'secondary'
    default:
      return 'outline'
  }
}

function resolutionTone(status: VendorBillStateRow['resolution_status']) {
  switch (status) {
    case 'posted_settled':
    case 'posted_fully_credited':
      return 'default'
    case 'posted_overdue':
      return 'destructive'
    default:
      return 'secondary'
  }
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

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}

export default function VendorBillDetailPage() {
  const { billId } = useParams()
  const navigate = useNavigate()
  const { companyId, myRole } = useOrg()
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const brand = useBrandForDocs(companyId)

  const [loading, setLoading] = useState(true)
  const [missingView, setMissingView] = useState(false)
  const [posting, setPosting] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [row, setRow] = useState<VendorBillStateRow | null>(null)
  const [billAuditRow, setBillAuditRow] = useState<VendorBillRowLike | null>(null)
  const [lines, setLines] = useState<VendorBillLineRow[]>([])
  const [events, setEvents] = useState<FinanceDocumentEventRow[]>([])
  const [actorDirectory, setActorDirectory] = useState<FinanceActorDirectory>({})
  const [settlementEvents, setSettlementEvents] = useState<FinanceSettlementAuditEvent[]>([])
  const [creditNotes, setCreditNotes] = useState<VendorCreditNoteRow[]>([])
  const [creditNoteLines, setCreditNoteLines] = useState<VendorCreditNoteLineRow[]>([])
  const [debitNotes, setDebitNotes] = useState<VendorDebitNoteRow[]>([])
  const [debitNoteLines, setDebitNoteLines] = useState<VendorDebitNoteLineRow[]>([])
  const [baseCode, setBaseCode] = useState('MZN')
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null)
  const [supplierProfile, setSupplierProfile] = useState<SupplierProfile | null>(null)
  const [draftSupplierInvoiceReference, setDraftSupplierInvoiceReference] = useState('')
  const [draftSupplierInvoiceDate, setDraftSupplierInvoiceDate] = useState('')
  const [draftBillDate, setDraftBillDate] = useState(isoToday())
  const [draftDueDate, setDraftDueDate] = useState(isoToday())
  const [savingDraftHeader, setSavingDraftHeader] = useState(false)

  const [creditDialogOpen, setCreditDialogOpen] = useState(false)
  const [creditMode, setCreditMode] = useState<AdjustmentMode>('full')
  const [creditReasonCode, setCreditReasonCode] = useState('')
  const [creditReason, setCreditReason] = useState('')
  const [creditSupplierReference, setCreditSupplierReference] = useState('')
  const [creditNoteDate, setCreditNoteDate] = useState(isoToday())
  const [creditLineDrafts, setCreditLineDrafts] = useState<Record<string, AdjustmentLineDraft>>({})
  const [creatingCredit, setCreatingCredit] = useState(false)

  const [debitDialogOpen, setDebitDialogOpen] = useState(false)
  const [debitMode, setDebitMode] = useState<AdjustmentMode>('full')
  const [debitReasonCode, setDebitReasonCode] = useState('')
  const [debitReason, setDebitReason] = useState('')
  const [debitSupplierReference, setDebitSupplierReference] = useState('')
  const [debitNoteDate, setDebitNoteDate] = useState(isoToday())
  const [debitDueDate, setDebitDueDate] = useState(isoToday())
  const [debitLineDrafts, setDebitLineDrafts] = useState<Record<string, AdjustmentLineDraft>>({})
  const [creatingDebit, setCreatingDebit] = useState(false)

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
  }, [billId, companyId])

  const loadWorkspace = useCallback(async () => {
    if (!companyId || !billId) {
      setLoading(false)
      setRow(null)
      setBillAuditRow(null)
      setLines([])
      setEvents([])
      setActorDirectory({})
      setSettlementEvents([])
      setCreditNotes([])
      setCreditNoteLines([])
      setDebitNotes([])
      setDebitNoteLines([])
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
          setBillAuditRow(null)
          setLines([])
          setEvents([])
          setActorDirectory({})
          setSettlementEvents([])
          setCreditNotes([])
          setCreditNoteLines([])
          setDebitNotes([])
          setDebitNoteLines([])
          return
        }
        throw error
      }

      if (!data) {
        setRow(null)
        setBillAuditRow(null)
        setLines([])
        setEvents([])
        setActorDirectory({})
        setSettlementEvents([])
        setCreditNotes([])
        setCreditNoteLines([])
        setDebitNotes([])
        setDebitNoteLines([])
        return
      }

      const nextRow = data as VendorBillStateRow
      const [lineRes, eventRes, rawBillRes, nextCompanyProfile, supplierRes, nextCreditNotes, nextDebitNotes] = await Promise.all([
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
        supabase
          .from('vendor_bills')
          .select('id,internal_reference,supplier_invoice_reference,purchase_order_id,created_by,approval_requested_at,approval_requested_by,approved_at,approved_by,posted_at,posted_by,voided_at,voided_by,void_reason,created_at')
          .eq('company_id', companyId)
          .eq('id', billId)
          .maybeSingle<VendorBillRowLike>(),
        getCompanyProfile(companyId),
        nextRow.supplier_id
          ? supabase
              .from('suppliers')
              .select('name,tax_id')
              .eq('company_id', companyId)
              .eq('id', nextRow.supplier_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        listVendorCreditNotesForBill(companyId, billId),
        listVendorDebitNotesForBill(companyId, billId),
      ])

      if (lineRes.error) throw lineRes.error
      if (eventRes.error) throw eventRes.error
      if (rawBillRes.error) throw rawBillRes.error
      if (supplierRes.error) throw supplierRes.error

      let nextActorDirectory: FinanceActorDirectory = {}
      let nextSettlementEvents: FinanceSettlementAuditEvent[] = []
      const [nextCreditNoteLines, nextDebitNoteLines] = await Promise.all([
        listVendorCreditNoteLines(companyId, nextCreditNotes.map((note) => note.id)),
        listVendorDebitNoteLines(companyId, nextDebitNotes.map((note) => note.id)),
      ])

      try {
        const actorIds = Array.from(new Set([
          rawBillRes.data?.created_by,
          rawBillRes.data?.approval_requested_by,
          rawBillRes.data?.approved_by,
          rawBillRes.data?.posted_by,
          rawBillRes.data?.voided_by,
          ...((eventRes.data || []) as FinanceDocumentEventRow[]).map((event) => event.actor_user_id),
          ...nextCreditNotes.flatMap((note) => [note.created_by, note.posted_by, note.voided_by]),
          ...nextDebitNotes.flatMap((note) => [note.created_by, note.posted_by, note.voided_by]),
        ].filter(Boolean) as string[]))

        const [actorRes, settlementRes] = await Promise.all([
          listFinanceActorDirectory(companyId, actorIds),
          nextRow.document_workflow_status === 'posted'
            ? listFinanceSettlementAuditEvents(companyId, 'vendor_bill', billId)
            : Promise.resolve([] as FinanceSettlementAuditEvent[]),
        ])

        nextActorDirectory = actorRes
        nextSettlementEvents = settlementRes
      } catch (auditError) {
        console.warn('[finance-audit] VendorBillDetail audit context fallback', auditError)
      }

      setRow(nextRow)
      setBillAuditRow((rawBillRes.data || null) as VendorBillRowLike | null)
      setLines((lineRes.data || []) as VendorBillLineRow[])
      setEvents((eventRes.data || []) as FinanceDocumentEventRow[])
      setActorDirectory(nextActorDirectory)
      setSettlementEvents(nextSettlementEvents)
      setCreditNotes(nextCreditNotes)
      setCreditNoteLines(nextCreditNoteLines)
      setDebitNotes(nextDebitNotes)
      setDebitNoteLines(nextDebitNoteLines)
      setCompanyProfile(nextCompanyProfile)
      setSupplierProfile((supplierRes.data || null) as SupplierProfile | null)
    } catch (error: any) {
      console.error(error)
      toast.error(
        error?.message
        || withI18nFallback(t, 'financeDocs.vendorBills.loadFailed', 'Failed to load vendor bills'),
      )
      setRow(null)
      setBillAuditRow(null)
      setLines([])
      setEvents([])
      setActorDirectory({})
      setSettlementEvents([])
      setCreditNotes([])
      setCreditNoteLines([])
      setDebitNotes([])
      setDebitNoteLines([])
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

  const supplierParty = useMemo(
    () => ({
      name: supplierProfile?.name || row?.counterparty_name || null,
      taxId: supplierProfile?.tax_id || null,
      address: [] as Array<string | null | undefined>,
    }),
    [row?.counterparty_name, supplierProfile?.name, supplierProfile?.tax_id],
  )

  const companyParty = useMemo(
    () => ({
      legalName: companyProfile?.legal_name || null,
      tradeName: companyProfile?.trade_name || null,
      taxId: companyProfile?.tax_id || null,
      address: [
        companyProfile?.address_line1,
        companyProfile?.address_line2,
        [companyProfile?.city, companyProfile?.state].filter(Boolean).join(', '),
        companyProfile?.postal_code,
        companyProfile?.country_code,
      ],
    }),
    [
      companyProfile?.address_line1,
      companyProfile?.address_line2,
      companyProfile?.city,
      companyProfile?.country_code,
      companyProfile?.legal_name,
      companyProfile?.postal_code,
      companyProfile?.state,
      companyProfile?.tax_id,
      companyProfile?.trade_name,
    ],
  )

  const outputModel = useMemo(() => {
    if (!row || !companyProfile) return null
    return buildVendorBillOutputModel(row, lines, {
      brandName: brand.name,
      logoUrl: brand.logoUrl,
      lang,
      supplier: supplierParty,
      company: companyParty,
    })
  }, [brand.logoUrl, brand.name, companyParty, companyProfile, lang, lines, row, supplierParty])

  const creditNoteLinesByNoteId = useMemo(() => {
    const map = new Map<string, VendorCreditNoteLineRow[]>()
    creditNoteLines.forEach((line) => {
      const current = map.get(line.vendor_credit_note_id) || []
      current.push(line)
      map.set(line.vendor_credit_note_id, current)
    })
    return map
  }, [creditNoteLines])

  const debitNoteLinesByNoteId = useMemo(() => {
    const map = new Map<string, VendorDebitNoteLineRow[]>()
    debitNoteLines.forEach((line) => {
      const current = map.get(line.vendor_debit_note_id) || []
      current.push(line)
      map.set(line.vendor_debit_note_id, current)
    })
    return map
  }, [debitNoteLines])

  const postedCreditNoteIds = useMemo(
    () => new Set(creditNotes.filter((note) => note.document_workflow_status === 'posted').map((note) => note.id)),
    [creditNotes],
  )

  const postedDebitNoteIds = useMemo(
    () => new Set(debitNotes.filter((note) => note.document_workflow_status === 'posted').map((note) => note.id)),
    [debitNotes],
  )

  const creditAvailability = useMemo<CreditAvailabilityRow[]>(() => {
    const rollupByLineId = new Map<string, { qty: number; lineTotal: number; taxAmount: number }>()

    creditNoteLines.forEach((line) => {
      if (!postedCreditNoteIds.has(line.vendor_credit_note_id) || !line.vendor_bill_line_id) return
      const current = rollupByLineId.get(line.vendor_bill_line_id) || { qty: 0, lineTotal: 0, taxAmount: 0 }
      current.qty = roundMoney(current.qty + Number(line.qty || 0))
      current.lineTotal = roundMoney(current.lineTotal + Number(line.line_total || 0))
      current.taxAmount = roundMoney(current.taxAmount + Number(line.tax_amount || 0))
      rollupByLineId.set(line.vendor_bill_line_id, current)
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
  }, [creditNoteLines, lines, postedCreditNoteIds])

  const debitRollupByLineId = useMemo(() => {
    const rollupByLineId = new Map<string, { qty: number; lineTotal: number; taxAmount: number }>()
    debitNoteLines.forEach((line) => {
      if (!postedDebitNoteIds.has(line.vendor_debit_note_id) || !line.vendor_bill_line_id) return
      const current = rollupByLineId.get(line.vendor_bill_line_id) || { qty: 0, lineTotal: 0, taxAmount: 0 }
      current.qty = roundMoney(current.qty + Number(line.qty || 0))
      current.lineTotal = roundMoney(current.lineTotal + Number(line.line_total || 0))
      current.taxAmount = roundMoney(current.taxAmount + Number(line.tax_amount || 0))
      rollupByLineId.set(line.vendor_bill_line_id, current)
    })
    return rollupByLineId
  }, [debitNoteLines, postedDebitNoteIds])

  const postedCreditedDocumentTotal = useMemo(
    () => roundMoney(creditNotes.filter((note) => note.document_workflow_status === 'posted').reduce((sum, note) => sum + Number(note.total_amount || 0), 0)),
    [creditNotes],
  )

  const postedDebitedDocumentTotal = useMemo(
    () => roundMoney(debitNotes.filter((note) => note.document_workflow_status === 'posted').reduce((sum, note) => sum + Number(note.total_amount || 0), 0)),
    [debitNotes],
  )
  const creditReasonOptions = useMemo(() => getAdjustmentReasonOptions('vendor_credit', lang), [lang])
  const debitReasonOptions = useMemo(() => getAdjustmentReasonOptions('vendor_debit', lang), [lang])

  useEffect(() => {
    if (!creditDialogOpen) return
    setCreditMode('full')
    setCreditReasonCode('')
    setCreditReason('')
    setCreditSupplierReference('')
    setCreditNoteDate(isoToday())
    setCreditLineDrafts(
      Object.fromEntries(
        creditAvailability.map((availability) => [
          availability.line.id,
          { selected: false, quantity: '', amount: '' },
        ]),
      ),
    )
  }, [creditAvailability, creditDialogOpen])

  useEffect(() => {
    if (!debitDialogOpen) return
    const today = isoToday()
    setDebitMode('full')
    setDebitReasonCode('')
    setDebitReason('')
    setDebitSupplierReference('')
    setDebitNoteDate(today)
    setDebitDueDate(row?.due_date || today)
    setDebitLineDrafts(
      Object.fromEntries(
        lines.map((line) => [
          line.id,
          { selected: false, quantity: '', amount: '' },
        ]),
      ),
    )
  }, [debitDialogOpen, lines, row?.due_date])

  const creditPreview = useMemo(() => {
    const previewLines: Array<{
      vendorBillLineId: string
      itemId?: string | null
      description?: string | null
      qty: number
      unitCost?: number | null
      taxRate?: number | null
      taxAmount: number
      lineTotal: number
      sortOrder?: number | null
    }> = []
    const validationErrors: string[] = []

    creditAvailability.forEach((availability) => {
      const { line, availableQty, availableNet, availableTax } = availability
      if (creditMode === 'full') {
        if (availableNet <= 0 && availableTax <= 0) return
        previewLines.push({
          vendorBillLineId: line.id,
          description: line.description,
          qty: availableQty,
          unitCost: availableQty > 0 ? roundMoney(availableNet / availableQty) : roundMoney(availableNet),
          taxRate: line.tax_rate,
          taxAmount: availableTax,
          lineTotal: availableNet,
          sortOrder: line.sort_order,
        })
        return
      }

      const draft = creditLineDrafts[line.id]
      if (!draft?.selected) return

      const requestedQty = roundMoney(parseDraftNumber(draft.quantity))
      const requestedAmount = roundMoney(parseDraftNumber(draft.amount))

      if (requestedQty <= 0 && requestedAmount <= 0) {
        validationErrors.push(
          tt('financeDocs.vendorBills.creditLineEmpty', 'Enter a quantity and/or amount for {description}.', {
            description: line.description || tt('common.dash', '-'),
          }),
        )
        return
      }

      if (requestedQty - availableQty > 0.005) {
        validationErrors.push(
          tt('financeDocs.vendorBills.creditQtyTooHigh', 'Credited quantity cannot exceed the remaining quantity on {description}.', {
            description: line.description || tt('common.dash', '-'),
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
          tt('financeDocs.vendorBills.creditAmountTooHigh', 'Credited amount cannot exceed the remaining value on {description}.', {
            description: line.description || tt('common.dash', '-'),
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

      previewLines.push({
        vendorBillLineId: line.id,
        description: line.description,
        qty: requestedQty,
        unitCost: requestedQty > 0 ? roundMoney(derivedAmount / requestedQty) : roundMoney(derivedAmount),
        taxRate: line.tax_rate,
        taxAmount: Math.min(lineTaxAmount, availableTax),
        lineTotal: Math.min(derivedAmount, availableNet),
        sortOrder: line.sort_order,
      })
    })

    const noteNet = roundMoney(previewLines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0))
    const noteTax = roundMoney(previewLines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0))
    const noteTotal = roundMoney(noteNet + noteTax)
    const creditedAfterThisNote = roundMoney(postedCreditedDocumentTotal + noteTotal)
    const adjustedLegalAfterThisNote = roundMoney(
      Math.max(Number(row?.total_amount || 0) - creditedAfterThisNote + postedDebitedDocumentTotal, 0),
    )
    const outstandingAfterThisNote = roundMoney(
      Math.max(adjustedLegalAfterThisNote - Number(row?.settled_base || 0), 0),
    )

    return {
      lines: previewLines,
      noteNet,
      noteTax,
      noteTotal,
      creditedAfterThisNote,
      adjustedLegalAfterThisNote,
      outstandingAfterThisNote,
      validationErrors: Array.from(new Set(validationErrors)),
    }
  }, [creditAvailability, creditLineDrafts, creditMode, postedCreditedDocumentTotal, postedDebitedDocumentTotal, row?.settled_base, row?.total_amount, tt])

  const debitPreview = useMemo(() => {
    const previewLines: Array<{
      vendorBillLineId: string
      itemId?: string | null
      description?: string | null
      qty: number
      unitCost?: number | null
      taxRate?: number | null
      taxAmount: number
      lineTotal: number
      sortOrder?: number | null
    }> = []
    const validationErrors: string[] = []

    lines.forEach((line) => {
      const lineNet = roundMoney(Number(line.line_total || 0))
      const lineTax = roundMoney(Number(line.tax_amount || 0))

      if (debitMode === 'full') {
        if (lineNet <= 0 && lineTax <= 0) return
        previewLines.push({
          vendorBillLineId: line.id,
          description: line.description,
          qty: roundMoney(Number(line.qty || 0)),
          unitCost: roundMoney(Number(line.unit_cost || 0)),
          taxRate: line.tax_rate,
          taxAmount: lineTax,
          lineTotal: lineNet,
          sortOrder: line.sort_order,
        })
        return
      }

      const draft = debitLineDrafts[line.id]
      if (!draft?.selected) return

      const requestedQty = roundMoney(parseDraftNumber(draft.quantity))
      const requestedAmount = roundMoney(parseDraftNumber(draft.amount))

      if (requestedQty <= 0 && requestedAmount <= 0) {
        validationErrors.push(
          tt('financeDocs.vendorBills.debitLineEmpty', 'Enter a quantity and/or amount for {description}.', {
            description: line.description || tt('common.dash', '-'),
          }),
        )
        return
      }

      const derivedAmount = requestedAmount > 0
        ? requestedAmount
        : requestedQty > 0 && Number(line.qty || 0) > 0
          ? roundMoney((lineNet / Number(line.qty || 0)) * requestedQty)
          : 0

      if (derivedAmount <= 0) {
        validationErrors.push(
          tt('financeDocs.vendorBills.debitAmountRequired', 'Enter a debit amount for {description}.', {
            description: line.description || tt('common.dash', '-'),
          }),
        )
        return
      }

      const taxRatio = lineNet > 0 ? lineTax / lineNet : 0
      const lineTaxAmount = roundMoney(derivedAmount * taxRatio)

      previewLines.push({
        vendorBillLineId: line.id,
        description: line.description,
        qty: requestedQty,
        unitCost: requestedQty > 0 ? roundMoney(derivedAmount / requestedQty) : roundMoney(derivedAmount),
        taxRate: line.tax_rate,
        taxAmount: lineTaxAmount,
        lineTotal: derivedAmount,
        sortOrder: line.sort_order,
      })
    })

    const noteNet = roundMoney(previewLines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0))
    const noteTax = roundMoney(previewLines.reduce((sum, line) => sum + Number(line.taxAmount || 0), 0))
    const noteTotal = roundMoney(noteNet + noteTax)
    const debitedAfterThisNote = roundMoney(postedDebitedDocumentTotal + noteTotal)
    const adjustedLegalAfterThisNote = roundMoney(
      Math.max(Number(row?.total_amount || 0) - postedCreditedDocumentTotal + debitedAfterThisNote, 0),
    )
    const outstandingAfterThisNote = roundMoney(
      Math.max(adjustedLegalAfterThisNote - Number(row?.settled_base || 0), 0),
    )

    return {
      lines: previewLines,
      noteNet,
      noteTax,
      noteTotal,
      debitedAfterThisNote,
      adjustedLegalAfterThisNote,
      outstandingAfterThisNote,
      validationErrors: Array.from(new Set(validationErrors)),
    }
  }, [debitLineDrafts, debitMode, lines, postedCreditedDocumentTotal, postedDebitedDocumentTotal, row?.settled_base, row?.total_amount, tt])

  const adjustmentStatusLabel = row?.adjustment_status
    ? tt(vendorBillAdjustmentLabelKey(row.adjustment_status), row.adjustment_status)
    : tt('financeDocs.adjustments.none', 'No adjustments')
  const approvalStatus = row?.approval_status || 'draft'
  const approvalStatusLabel = tt(
    financeDocumentApprovalLabelKey(approvalStatus),
    approvalStatus,
  )
  const creditStatusLabel = row?.credit_status === 'fully_credited'
    ? tt('financeDocs.mz.creditStatus.fullyCredited', 'Fully credited')
    : row?.credit_status === 'partially_credited'
      ? tt('financeDocs.mz.creditStatus.partiallyCredited', 'Partially credited')
      : tt('financeDocs.mz.creditStatus.notCredited', 'Not credited')
  const settlementStatusLabel = row?.settlement_status
    ? tt(settlementLabelKey(row.settlement_status), row.settlement_status)
    : tt('common.dash', '-')
  const resolutionStatusLabel = row?.resolution_status
    ? tt(vendorBillResolutionLabelKey(row.resolution_status), row.resolution_status)
    : tt('common.dash', '-')
  const canSubmitDraftForApproval = Boolean(
    row
    && row.document_workflow_status === 'draft'
    && approvalStatus === 'draft'
    && financeCan.submitForApproval(myRole),
  )
  const canApproveDraft = Boolean(
    row
    && row.document_workflow_status === 'draft'
    && approvalStatus === 'pending_approval'
    && financeCan.approve(myRole),
  )
  const canReturnDraftToEdit = Boolean(
    row
    && row.document_workflow_status === 'draft'
    && approvalStatus !== 'draft'
    && financeCan.approve(myRole),
  )
  const canEditDraft = Boolean(
    row
    && row.document_workflow_status === 'draft'
    && approvalStatus === 'draft'
    && financeCan.editDraft(myRole),
  )
  const canPostApprovedDraft = Boolean(
    row
    && row.document_workflow_status === 'draft'
    && approvalStatus === 'approved'
    && financeCan.postVendorBill(myRole),
  )
  const canVoidBill = Boolean(
    row
    && row.document_workflow_status !== 'voided'
    && (row.document_workflow_status === 'draft'
      ? financeCan.voidDraft(myRole)
      : financeCan.voidIssuedOrPosted(myRole)),
  )
  const canPostVendorAdjustments = Boolean(
    row
    && row.document_workflow_status === 'posted'
    && financeCan.postVendorAdjustment(myRole),
  )
  const canCreateCreditNote = canPostVendorAdjustments && row?.credit_status !== 'fully_credited'
  const canCreateDebitNote = canPostVendorAdjustments

  useEffect(() => {
    if (!row) return
    setDraftSupplierInvoiceReference(row.supplier_invoice_reference || '')
    setDraftSupplierInvoiceDate(row.supplier_invoice_date || '')
    setDraftBillDate(row.bill_date || isoToday())
    setDraftDueDate(row.due_date || row.bill_date || isoToday())
  }, [row])

  function updateCreditLineDraft(lineId: string, patch: Partial<AdjustmentLineDraft>) {
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

  function updateDebitLineDraft(lineId: string, patch: Partial<AdjustmentLineDraft>) {
    setDebitLineDrafts((current) => ({
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

  function toggleDebitLineSelection(line: VendorBillLineRow, checked: boolean) {
    if (!checked) {
      updateDebitLineDraft(line.id, {
        selected: false,
        quantity: '',
        amount: '',
      })
      return
    }

    updateDebitLineDraft(line.id, {
      selected: true,
      quantity: formatDraftNumber(Number(line.qty || 0)),
      amount: '',
    })
  }

  function buildCreditNoteModel(note: VendorCreditNoteRow): FinanceDocumentOutputModel | null {
    if (!companyProfile || !row) return null
    return buildVendorCreditNoteOutputModel(note, creditNoteLinesByNoteId.get(note.id) || [], {
      brandName: brand.name,
      logoUrl: brand.logoUrl,
      lang,
      originalBillReference: row.primary_reference || row.internal_reference,
      supplier: supplierParty,
      company: companyParty,
    })
  }

  function buildDebitNoteModel(note: VendorDebitNoteRow): FinanceDocumentOutputModel | null {
    if (!companyProfile || !row) return null
    return buildVendorDebitNoteOutputModel(note, debitNoteLinesByNoteId.get(note.id) || [], {
      brandName: brand.name,
      logoUrl: brand.logoUrl,
      lang,
      originalBillReference: row.primary_reference || row.internal_reference,
      supplier: supplierParty,
      company: companyParty,
    })
  }

  async function handleSaveDraftHeader() {
    if (!companyId || !row || !canEditDraft) return

    try {
      setSavingDraftHeader(true)
      await updateVendorBillDraftHeader(companyId, row.id, {
        supplierInvoiceReference: draftSupplierInvoiceReference,
        supplierInvoiceDate: draftSupplierInvoiceDate,
        billDate: draftBillDate,
        dueDate: draftDueDate,
      })
      toast.success(tt('financeDocs.vendorBills.draftSaved', 'Vendor bill draft saved'))
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.vendorBills.draftSaveFailed', 'Failed to save the vendor bill draft'))
    } finally {
      setSavingDraftHeader(false)
    }
  }

  async function handleSubmitForApproval() {
    if (!row || !canSubmitDraftForApproval) return

    try {
      setPosting(true)
      await requestVendorBillApproval(row.id)
      toast.success(tt('financeDocs.approval.requested', 'Document sent for approval'))
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.approval.requestFailed', 'Failed to send the document for approval'))
    } finally {
      setPosting(false)
    }
  }

  async function handleApproveDraft() {
    if (!row || !canApproveDraft) return

    try {
      setPosting(true)
      await approveVendorBill(row.id)
      toast.success(tt('financeDocs.approval.approvedToast', 'Document approved'))
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.approval.approveFailed', 'Failed to approve the document'))
    } finally {
      setPosting(false)
    }
  }

  async function handleReturnDraftToEdit() {
    if (!row || !canReturnDraftToEdit) return

    try {
      setPosting(true)
      await returnVendorBillToDraft(row.id)
      toast.success(tt('financeDocs.approval.returnedToast', 'Document returned to draft'))
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.approval.returnFailed', 'Failed to return the document to draft'))
    } finally {
      setPosting(false)
    }
  }

  async function handlePostBill() {
    if (!row || !canPostApprovedDraft) return
    if (!window.confirm(tt('financeDocs.vendorBills.confirmPost', 'Post this vendor bill and move settlement truth to the AP document?'))) return

    try {
      setPosting(true)
      await postVendorBill(row.id)
      toast.success(tt('financeDocs.vendorBills.postSuccess', 'Vendor bill posted'))
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.vendorBills.postFailed', 'Failed to post the vendor bill'))
    } finally {
      setPosting(false)
    }
  }

  async function handleVoidBill() {
    if (!row || !canVoidBill) return
    if (!window.confirm(tt('financeDocs.vendorBills.confirmVoid', 'Void this vendor bill?'))) return

    try {
      setVoiding(true)
      await voidVendorBill(row.id)
      toast.success(tt('financeDocs.vendorBills.voidSuccess', 'Vendor bill voided'))
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.vendorBills.voidFailed', 'Failed to void the vendor bill'))
    } finally {
      setVoiding(false)
    }
  }

  async function handleCreateCreditNote() {
    if (!companyId || !row || !canPostVendorAdjustments) return
    if (!creditReasonCode) {
      toast.error(tt('financeDocs.audit.reasonCodeRequired', 'Select a structured reason code before issuing the adjustment document.'))
      return
    }
    if (!creditReason.trim()) {
      toast.error(tt('financeDocs.vendorBills.creditReasonRequired', 'An adjustment reason is required before posting the supplier credit note.'))
      return
    }
    if (!creditPreview.lines.length) {
      toast.error(tt('financeDocs.vendorBills.creditSelectionRequired', 'Select at least one vendor bill line to credit.'))
      return
    }
    if (creditPreview.validationErrors.length) {
      toast.error(creditPreview.validationErrors[0])
      return
    }

    try {
      setCreatingCredit(true)
      const note = await createAndPostVendorCreditNoteForBill(companyId, row.id, {
        adjustmentReasonCode: creditReasonCode,
        adjustmentReasonText: creditReason,
        supplierDocumentReference: creditSupplierReference,
        noteDate: creditNoteDate,
        lines: creditPreview.lines,
      })
      toast.success(
        tt('financeDocs.vendorBills.creditNotePosted', 'Supplier credit note {reference} posted', {
          reference: note.supplier_document_reference || note.internal_reference,
        }),
      )
      setCreditDialogOpen(false)
      setCreditReasonCode('')
      setCreditReason('')
      setCreditSupplierReference('')
      setCreditLineDrafts({})
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.vendorBills.creditNoteFailed', 'Failed to post the supplier credit note'))
    } finally {
      setCreatingCredit(false)
    }
  }

  async function handleCreateDebitNote() {
    if (!companyId || !row || !canPostVendorAdjustments) return
    if (!debitReasonCode) {
      toast.error(tt('financeDocs.audit.reasonCodeRequired', 'Select a structured reason code before issuing the adjustment document.'))
      return
    }
    if (!debitReason.trim()) {
      toast.error(tt('financeDocs.vendorBills.debitReasonRequired', 'An adjustment reason is required before posting the supplier debit note.'))
      return
    }
    if (!debitPreview.lines.length) {
      toast.error(tt('financeDocs.vendorBills.debitSelectionRequired', 'Select at least one vendor bill line to debit.'))
      return
    }
    if (debitPreview.validationErrors.length) {
      toast.error(debitPreview.validationErrors[0])
      return
    }

    try {
      setCreatingDebit(true)
      const note = await createAndPostVendorDebitNoteForBill(companyId, row.id, {
        adjustmentReasonCode: debitReasonCode,
        adjustmentReasonText: debitReason,
        supplierDocumentReference: debitSupplierReference,
        noteDate: debitNoteDate,
        dueDate: debitDueDate,
        lines: debitPreview.lines,
      })
      toast.success(
        tt('financeDocs.vendorBills.debitNotePosted', 'Supplier debit note {reference} posted', {
          reference: note.supplier_document_reference || note.internal_reference,
        }),
      )
      setDebitDialogOpen(false)
      setDebitReasonCode('')
      setDebitReason('')
      setDebitSupplierReference('')
      setDebitLineDrafts({})
      await loadWorkspace()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.vendorBills.debitNoteFailed', 'Failed to post the supplier debit note'))
    } finally {
      setCreatingDebit(false)
    }
  }

  async function handlePrintDocument(model: FinanceDocumentOutputModel | null) {
    if (!model) return
    try {
      await printFinanceDocument(model)
    } catch (error: any) {
      toast.error(error?.message || tt('financeDocs.mz.printFailed', 'Unable to open the invoice print view'))
    }
  }

  async function handleDownloadPdf(model: FinanceDocumentOutputModel | null) {
    if (!model) return
    try {
      await downloadFinanceDocumentPdf(model)
    } catch (error: any) {
      toast.error(error?.message || tt('financeDocs.mz.pdfFailed', 'Unable to generate the invoice PDF'))
    }
  }

  async function handleShareDocument(model: FinanceDocumentOutputModel | null) {
    if (!model) return
    try {
      await shareFinanceDocument(model)
    } catch (error: any) {
      toast.error(error?.message || tt('financeDocs.mz.shareFailed', 'Sharing is not available for this invoice on the current device'))
    }
  }

  const currentLegalDocumentTotal = roundMoney(
    Math.max(Number(row?.total_amount || 0) - postedCreditedDocumentTotal + postedDebitedDocumentTotal, 0),
  )
  const formatAuditTimestamp = (value?: string | null) => {
    const text = String(value || '').trim()
    if (!text) return tt('common.dash', '-')
    return new Intl.DateTimeFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(text))
  }
  const settlementEventIdsInJournal = useMemo(
    () => new Set(
      events
        .map((event) => String(event.payload?.transaction_id || '').trim())
        .filter(Boolean),
    ),
    [events],
  )
  const auditTimelineEntries = useMemo<FinanceTimelineEntry[]>(() => {
    if (!row) return []

    const entries: FinanceTimelineEntry[] = events.map((event) => ({
      id: `event:${event.id}`,
      sortAt: event.occurred_at,
      occurredAt: formatAuditTimestamp(event.occurred_at),
      title: financeEventTitle(event.event_type, lang),
      summary: financeEventSummary(event, lang),
      transition: financeEventTransition(event, lang),
      actorLabel: financeActorLabel(event.actor_user_id, actorDirectory, lang),
      tone: financeEventTone(event.event_type),
    }))

    const source = billAuditRow || row
    const hasEvent = (type: string) => events.some((event) => event.event_type === type)

    if (!hasEvent('draft_created') && source.created_at) {
      entries.push({
        id: `synthetic:created:${row.id}`,
        sortAt: source.created_at,
        occurredAt: formatAuditTimestamp(source.created_at),
        title: financeEventTitle('draft_created', lang),
        summary: row.primary_reference,
        transition: '- -> draft',
        actorLabel: financeActorLabel(source.created_by, actorDirectory, lang),
        tone: financeEventTone('draft_created'),
      })
    }

    if (!hasEvent('approval_requested') && source.approval_requested_at) {
      entries.push({
        id: `synthetic:approvalRequested:${row.id}`,
        sortAt: source.approval_requested_at,
        occurredAt: formatAuditTimestamp(source.approval_requested_at),
        title: financeEventTitle('approval_requested', lang),
        summary: row.primary_reference,
        transition: 'draft -> pending_approval',
        actorLabel: financeActorLabel(source.approval_requested_by, actorDirectory, lang),
        tone: financeEventTone('approval_requested'),
      })
    }

    if (!hasEvent('approved') && source.approved_at) {
      entries.push({
        id: `synthetic:approved:${row.id}`,
        sortAt: source.approved_at,
        occurredAt: formatAuditTimestamp(source.approved_at),
        title: financeEventTitle('approved', lang),
        summary: row.primary_reference,
        transition: 'pending_approval -> approved',
        actorLabel: financeActorLabel(source.approved_by, actorDirectory, lang),
        tone: financeEventTone('approved'),
      })
    }

    if (!hasEvent('posted') && source.posted_at) {
      entries.push({
        id: `synthetic:posted:${row.id}`,
        sortAt: source.posted_at,
        occurredAt: formatAuditTimestamp(source.posted_at),
        title: financeEventTitle('posted', lang),
        summary: row.primary_reference,
        transition: 'approved -> posted',
        actorLabel: financeActorLabel(source.posted_by, actorDirectory, lang),
        tone: financeEventTone('posted'),
      })
    }

    if (!hasEvent('voided') && source.voided_at) {
      entries.push({
        id: `synthetic:voided:${row.id}`,
        sortAt: source.voided_at,
        occurredAt: formatAuditTimestamp(source.voided_at),
        title: financeEventTitle('voided', lang),
        summary: source.void_reason || row.primary_reference,
        transition: `${row.document_workflow_status} -> voided`,
        actorLabel: financeActorLabel(source.voided_by, actorDirectory, lang),
        tone: financeEventTone('voided'),
      })
    }

    creditNotes.forEach((note) => {
      const noteSummary = [
        note.supplier_document_reference || note.internal_reference,
        getAdjustmentReasonLabel('vendor_credit', note.adjustment_reason_code, lang),
        note.adjustment_reason_text,
      ].filter(Boolean).join(' - ')

      if (!events.some((event) => event.payload?.related_document_id === note.id)) {
        entries.push({
          id: `synthetic:vendorCreditCreated:${note.id}`,
          sortAt: note.created_at,
          occurredAt: formatAuditTimestamp(note.created_at),
          title: financeEventTitle('related_vendor_credit_note_created', lang),
          summary: noteSummary,
          actorLabel: financeActorLabel(note.created_by, actorDirectory, lang),
          tone: financeEventTone('related_vendor_credit_note_created'),
        })
        if (note.posted_at && note.document_workflow_status === 'posted') {
          entries.push({
            id: `synthetic:vendorCreditPosted:${note.id}`,
            sortAt: note.posted_at,
            occurredAt: formatAuditTimestamp(note.posted_at),
            title: financeEventTitle('related_vendor_credit_note_posted', lang),
            summary: noteSummary,
            actorLabel: financeActorLabel(note.posted_by, actorDirectory, lang),
            tone: financeEventTone('related_vendor_credit_note_posted'),
          })
        }
      }
    })

    debitNotes.forEach((note) => {
      const noteSummary = [
        note.supplier_document_reference || note.internal_reference,
        getAdjustmentReasonLabel('vendor_debit', note.adjustment_reason_code, lang),
        note.adjustment_reason_text,
      ].filter(Boolean).join(' - ')

      if (!events.some((event) => event.payload?.related_document_id === note.id)) {
        entries.push({
          id: `synthetic:vendorDebitCreated:${note.id}`,
          sortAt: note.created_at,
          occurredAt: formatAuditTimestamp(note.created_at),
          title: financeEventTitle('related_vendor_debit_note_created', lang),
          summary: noteSummary,
          actorLabel: financeActorLabel(note.created_by, actorDirectory, lang),
          tone: financeEventTone('related_vendor_debit_note_created'),
        })
        if (note.posted_at && note.document_workflow_status === 'posted') {
          entries.push({
            id: `synthetic:vendorDebitPosted:${note.id}`,
            sortAt: note.posted_at,
            occurredAt: formatAuditTimestamp(note.posted_at),
            title: financeEventTitle('related_vendor_debit_note_posted', lang),
            summary: noteSummary,
            actorLabel: financeActorLabel(note.posted_by, actorDirectory, lang),
            tone: financeEventTone('related_vendor_debit_note_posted'),
          })
        }
      }
    })

    settlementEvents
      .filter((event) => !settlementEventIdsInJournal.has(event.id))
      .forEach((event) => {
        const eventType = event.channel === 'cash' ? 'cash_payment_recorded' : 'bank_payment_recorded'
        entries.push({
          id: `settlement:${event.channel}:${event.id}`,
          sortAt: event.createdAt,
          occurredAt: formatAuditTimestamp(event.createdAt),
          title: financeEventTitle(eventType, lang),
          summary: event.memo || row.primary_reference,
          actorLabel: financeActorLabel(null, actorDirectory, lang, event.actorLabel),
          amount: formatBaseMoney(event.amountBase),
          tone: financeEventTone(eventType),
        })
      })

    return entries.sort((left, right) => right.sortAt.localeCompare(left.sortAt))
  }, [
    actorDirectory,
    billAuditRow,
    creditNotes,
    debitNotes,
    events,
    formatBaseMoney,
    lang,
    row,
    settlementEventIdsInJournal,
    settlementEvents,
  ])
  const chainItems = useMemo<FinanceChainItem[]>(() => {
    if (!row) return []

    const items: FinanceChainItem[] = []

    if (orderLink) {
      items.push({
        id: `po:${row.purchase_order_id}`,
        eyebrow: tt('orders.po', 'PO'),
        title: row.order_no || tt('financeDocs.viewLinkedOrder', 'Linked purchase order'),
        description: tt('financeDocs.audit.purchaseChainHelp', 'Operational source before the legal liability moved into the posted vendor bill.'),
        status: tt('orders.po', 'PO'),
        href: orderLink,
        hrefLabel: tt('financeDocs.viewLinkedOrder', 'View linked order'),
        metrics: [
          { label: tt('orders.anchorStatus', 'Anchor'), value: tt('orders.po', 'PO') },
        ],
      })
    }

    items.push({
      id: `bill:${row.id}`,
      eyebrow: tt('financeDocs.vendorBills.title', 'Vendor Bills'),
      title: row.primary_reference,
      description: tt('financeDocs.audit.vendorBillChainHelp', 'This posted vendor bill is the active AP anchor for payments, supplier credit notes, supplier debit notes, and residual liability.'),
      status: resolutionStatusLabel,
      metrics: [
        { label: tt('financeDocs.vendorBills.originalTotal', 'Original total'), value: formatBaseMoney(row.total_amount_base) },
        { label: tt('financeDocs.vendorBills.currentLegalAmount', 'Current AP total'), value: formatBaseMoney(row.current_legal_total_base) },
        { label: tt('settlements.settledAmount', 'Settled'), value: formatBaseMoney(row.settled_base) },
        { label: tt('settlements.outstandingAmount', 'Outstanding'), value: formatBaseMoney(row.outstanding_base) },
      ],
    })

    creditNotes.forEach((note) => {
      items.push({
        id: `vendor-credit:${note.id}`,
        eyebrow: tt('financeDocs.vendorBills.creditNotesTitle', 'Supplier credit notes'),
        title: note.supplier_document_reference || note.internal_reference,
        description: [getAdjustmentReasonLabel('vendor_credit', note.adjustment_reason_code, lang), note.adjustment_reason_text].filter(Boolean).join(' - '),
        status: note.document_workflow_status === 'posted'
          ? tt('financeDocs.workflow.posted', 'Posted')
          : note.document_workflow_status,
        metrics: [
          { label: tt('financeDocs.audit.noteDate', 'Document date'), value: note.note_date || tt('common.dash', '-') },
          { label: tt('financeDocs.vendorBills.currentCredit', 'Credited'), value: formatBaseMoney(note.total_amount_base) },
        ],
      })
    })

    debitNotes.forEach((note) => {
      items.push({
        id: `vendor-debit:${note.id}`,
        eyebrow: tt('financeDocs.vendorBills.debitNotesTitle', 'Supplier debit notes'),
        title: note.supplier_document_reference || note.internal_reference,
        description: [getAdjustmentReasonLabel('vendor_debit', note.adjustment_reason_code, lang), note.adjustment_reason_text].filter(Boolean).join(' - '),
        status: note.document_workflow_status === 'posted'
          ? tt('financeDocs.workflow.posted', 'Posted')
          : note.document_workflow_status,
        metrics: [
          { label: tt('financeDocs.audit.noteDate', 'Document date'), value: note.note_date || tt('common.dash', '-') },
          { label: tt('financeDocs.vendorBills.currentDebit', 'Debited'), value: formatBaseMoney(note.total_amount_base) },
        ],
      })
    })

    return items
  }, [creditNotes, debitNotes, formatBaseMoney, lang, orderLink, resolutionStatusLabel, row, tt])

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
        {orderLink ? (
          <Button asChild variant="outline">
            <Link to={orderLink}>{tt('financeDocs.viewLinkedOrder', 'View linked order')}</Link>
          </Button>
        ) : null}
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
                    ? tt('financeDocs.vendorBills.postedHelper', 'Posted vendor bills are the AP settlement anchor. Supplier credit notes, supplier debit notes, payments, and outstanding exposure all resolve against this document chain instead of the original purchase order.')
                    : approvalStatus === 'pending_approval'
                      ? tt('financeDocs.approval.pendingHelp', 'This draft is locked while it waits for finance approval. Return it to draft before making further edits.')
                      : approvalStatus === 'approved'
                        ? tt('financeDocs.approval.approvedHelp', 'This draft has finance approval and is now locked pending the legal issue action.')
                        : tt('financeDocs.vendorBills.draftHelper', 'Draft vendor bills stay editable until posting. Posting transfers settlement truth from the purchase order into the AP document.')}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant={workflowTone(row.document_workflow_status)}>
                  {tt(vendorBillWorkflowLabelKey(row.document_workflow_status), row.document_workflow_status)}
                </Badge>
                <Badge variant={approvalTone(approvalStatus)}>
                  {approvalStatusLabel}
                </Badge>
                <Badge variant={resolutionTone(row.resolution_status)}>{resolutionStatusLabel}</Badge>
                <Badge variant={row.credit_status === 'fully_credited' ? 'default' : 'outline'}>{creditStatusLabel}</Badge>
                <Badge variant={row.adjustment_status === 'debited' || row.adjustment_status === 'credited_and_debited' ? 'outline' : 'secondary'}>
                  {adjustmentStatusLabel}
                </Badge>
              <Badge variant={row.settlement_status === 'overdue' ? 'destructive' : 'secondary'}>
                {settlementStatusLabel}
              </Badge>
              {outputModel ? (
                <>
                  <Button variant="outline" onClick={() => void handlePrintDocument(outputModel)}>
                    <Printer className="mr-2 h-4 w-4" />
                    {tt('financeDocs.mz.printInvoice', 'Print')}
                  </Button>
                  <Button variant="outline" onClick={() => void handleDownloadPdf(outputModel)}>
                    <Download className="mr-2 h-4 w-4" />
                    {tt('financeDocs.mz.downloadPdf', 'Download PDF')}
                  </Button>
                  <Button variant="outline" onClick={() => void handleShareDocument(outputModel)}>
                    <Share2 className="mr-2 h-4 w-4" />
                    {tt('financeDocs.mz.shareInvoice', 'Share')}
                  </Button>
                </>
              ) : null}
              {canSubmitDraftForApproval ? (
                <Button variant="outline" onClick={() => void handleSubmitForApproval()} disabled={posting || voiding}>
                  {posting ? tt('common.saving', 'Saving...') : tt('financeDocs.approval.submit', 'Submit for approval')}
                </Button>
              ) : null}
              {canEditDraft ? (
                <Button variant="outline" onClick={() => void handleSaveDraftHeader()} disabled={posting || voiding || savingDraftHeader}>
                  {savingDraftHeader ? tt('common.saving', 'Saving...') : tt('financeDocs.vendorBills.saveDraft', 'Save draft')}
                </Button>
              ) : null}
              {canApproveDraft ? (
                <Button variant="outline" onClick={() => void handleApproveDraft()} disabled={posting || voiding}>
                  {posting ? tt('common.saving', 'Saving...') : tt('financeDocs.approval.approveAction', 'Approve')}
                </Button>
              ) : null}
              {canReturnDraftToEdit ? (
                <Button variant="outline" onClick={() => void handleReturnDraftToEdit()} disabled={posting || voiding}>
                  {posting ? tt('common.saving', 'Saving...') : tt('financeDocs.approval.returnToDraft', 'Return to draft')}
                </Button>
              ) : null}
              {canPostApprovedDraft ? (
                <Button onClick={() => void handlePostBill()} disabled={posting || voiding}>
                  {posting ? tt('financeDocs.vendorBills.posting', 'Posting...') : tt('financeDocs.vendorBills.postBill', 'Post vendor bill')}
                </Button>
              ) : null}
              {row.document_workflow_status === 'posted' && canPostVendorAdjustments ? (
                <>
                  <Button variant="outline" onClick={() => setCreditDialogOpen(true)}>
                    {tt('financeDocs.vendorBills.issueCreditNote', 'Issue supplier credit note')}
                  </Button>
                  <Button variant="outline" onClick={() => setDebitDialogOpen(true)}>
                    {tt('financeDocs.vendorBills.issueDebitNote', 'Issue supplier debit note')}
                  </Button>
                </>
              ) : null}
              {canVoidBill ? (
                <Button variant="outline" onClick={() => void handleVoidBill()} disabled={posting || voiding}>
                  {voiding ? tt('financeDocs.vendorBills.voiding', 'Voiding...') : tt('financeDocs.vendorBills.voidBill', 'Void bill')}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card className="border-border/80 shadow-sm">
              <CardHeader>
                <CardTitle>{tt('financeDocs.vendorBills.apIdentity', 'AP identity')}</CardTitle>
                <CardDescription>
                  {tt('financeDocs.vendorBills.apIdentityHelp', 'The supplier invoice reference is entered from the supplier document. Stockwise keeps a separate internal key for audit trail, search, and linked AP adjustments.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {tt('financeDocs.fields.supplierInvoiceReference', 'Supplier invoice reference')}
                  </div>
                  {canEditDraft ? (
                    <Input
                      className="mt-2 bg-background"
                      value={draftSupplierInvoiceReference}
                      onChange={(event) => setDraftSupplierInvoiceReference(event.target.value)}
                      placeholder={tt('financeDocs.vendorBills.supplierReferencePlaceholder', 'Enter the supplier invoice reference')}
                    />
                  ) : (
                    <div className="mt-1 font-medium">{row.supplier_invoice_reference || tt('common.dash', '-')}</div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    {tt('financeDocs.vendorBills.supplierReferenceHelp', 'Supplier-origin document reference, entered manually and kept visible for AP operations.')}
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {tt('financeDocs.vendorBills.stockwiseKey', 'Stockwise internal key')}
                  </div>
                  <div className="mt-1 font-medium">{row.internal_reference}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.internal_reference.startsWith('COD-')
                      ? tt('financeDocs.vendorBills.legacyInternalKeyHelp', 'Legacy internal key retained for audit continuity. New AP references use clear VB / VCN / VDN prefixes.')
                      : tt('financeDocs.vendorBills.internalKeyHelp', 'System-generated audit key used for lookup, reconciliation, and linked AP adjustments.')}
                  </div>
                </div>
                {row.duplicate_supplier_reference_exists ? (
                  <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-medium">{tt('financeDocs.vendorBills.duplicateWarning', 'Duplicate supplier reference detected')}</div>
                        <div className="mt-1 text-xs">{tt('financeDocs.vendorBills.duplicateHelp', 'Draft duplicates are allowed for review, but posting must resolve the conflict or keep the existing posted document voided first.')}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.supplier', 'Supplier')}</div>
                  <div className="mt-1">{row.counterparty_name || tt('common.none', 'None')}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.linkedOrder', 'Linked order')}</div>
                  <div className="mt-1">{row.order_no || tt('financeDocs.fields.noLinkedOrder', 'No linked order')}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.supplierInvoiceDate', 'Supplier invoice date')}</div>
                  {canEditDraft ? (
                    <Input
                      className="mt-2 bg-background"
                      type="date"
                      value={draftSupplierInvoiceDate}
                      onChange={(event) => setDraftSupplierInvoiceDate(event.target.value)}
                    />
                  ) : (
                    <div className="mt-1">{row.supplier_invoice_date || tt('common.dash', '-')}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.date', 'Date')}</div>
                  {canEditDraft ? (
                    <Input
                      className="mt-2 bg-background"
                      type="date"
                      value={draftBillDate}
                      onChange={(event) => setDraftBillDate(event.target.value)}
                    />
                  ) : (
                    <div className="mt-1">{row.bill_date}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.dueDate', 'Due date')}</div>
                  {canEditDraft ? (
                    <Input
                      className="mt-2 bg-background"
                      type="date"
                      value={draftDueDate}
                      onChange={(event) => setDraftDueDate(event.target.value)}
                    />
                  ) : (
                    <div className="mt-1">{row.due_date}</div>
                  )}
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
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.approval', 'Approval')}</div>
                  <div className="mt-1">
                    <Badge variant={approvalTone(approvalStatus)}>
                      {approvalStatusLabel}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.fields.approvalTimestamp', 'Approval checkpoint')}</div>
                  <div className="mt-1">
                    {approvalStatus === 'approved'
                      ? row.approved_at || tt('common.dash', '-')
                      : approvalStatus === 'pending_approval'
                        ? row.approval_requested_at || tt('common.dash', '-')
                        : tt('common.dash', '-')}
                  </div>
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
                  {tt('financeDocs.vendorBills.settlementHelp', 'Posted vendor bills remain the AP settlement anchor. Supplier credits reduce the legal liability, supplier debits increase it, and payments reduce the same live document chain.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.originalTotal', 'Original total')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{formatBaseMoney(row.total_amount_base)}</div>
                      <div className="text-xs text-muted-foreground">{formatDocumentMoney(row.total_amount, row.currency_code)}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.creditedTotal', 'Credited total')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{formatBaseMoney(row.credited_total_base)}</div>
                      <div className="text-xs text-muted-foreground">{tt('financeDocs.vendorBills.creditNotesCount', '{count} supplier credit notes posted', { count: row.credit_note_count })}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.debitedTotal', 'Debited total')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{formatBaseMoney(row.debited_total_base)}</div>
                      <div className="text-xs text-muted-foreground">{tt('financeDocs.vendorBills.debitNotesCount', '{count} supplier debit notes posted', { count: row.debit_note_count })}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 shadow-none">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.currentLegalAmount', 'Current AP total')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      <div className="font-mono tabular-nums">{formatBaseMoney(row.current_legal_total_base)}</div>
                      <div className="text-xs text-muted-foreground">{formatDocumentMoney(currentLegalDocumentTotal, row.currency_code)}</div>
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

                <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                  {row.adjustment_status === 'credited_and_debited'
                    ? tt('financeDocs.vendorBills.adjustmentSummaryMixed', 'This vendor bill already has both supplier credit and supplier debit adjustments. The current AP total reflects the full net document chain before payments are deducted.')
                    : row.adjustment_status === 'debited'
                      ? tt('financeDocs.vendorBills.adjustmentSummaryDebited', 'Supplier debit notes have increased the legal AP amount on this bill. Outstanding liability reflects those posted upward adjustments.')
                      : row.credit_status === 'partially_credited'
                        ? tt('financeDocs.vendorBills.adjustmentSummaryCredited', 'Supplier credit notes have reduced part of this AP document. Outstanding liability reflects the remaining legal amount after credits and payments.')
                        : row.credit_status === 'fully_credited'
                          ? tt('financeDocs.vendorBills.adjustmentSummaryFullyCredited', 'This vendor bill has been fully credited. It no longer carries an open supplier liability.')
                          : tt('financeDocs.vendorBills.adjustmentSummaryOpen', 'No AP adjustment documents have changed this vendor bill yet.')}
                </div>
              </CardContent>
            </Card>
          </div>

          <FinanceChainCard
            title={tt('financeDocs.audit.chainTitle', 'Document chain')}
            description={tt('financeDocs.audit.apChainHelp', 'See the operational source, the active vendor bill, and every linked supplier adjustment in the same AP chain.')}
            items={chainItems}
          />

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('financeDocs.fields.lines', 'Lines')}</CardTitle>
              <CardDescription>
                {tt('financeDocs.vendorBills.linesHelp', 'Posted vendor bills keep their line values immutable. Supplier credit and debit notes adjust this AP chain without editing the posted document itself.')}
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
              <CardTitle>{tt('financeDocs.vendorBills.creditNotesTitle', 'Supplier credit notes')}</CardTitle>
              <CardDescription>
                {tt('financeDocs.vendorBills.creditNotesHelp', 'Use supplier credit notes for reductions, returns, allowances, and other downward AP corrections linked back to the posted vendor bill.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {row.document_workflow_status === 'posted' ? (
                canCreateCreditNote ? (
                  <Button onClick={() => setCreditDialogOpen(true)}>
                    {tt('financeDocs.vendorBills.issueCreditNote', 'Issue supplier credit note')}
                  </Button>
                ) : (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                    {!canPostVendorAdjustments
                      ? tt('financeDocs.approval.financeAuthorityRequired', 'Finance authority is required for legal-document issue, post, void, adjustment, and settlement actions.')
                      : tt('financeDocs.vendorBills.creditNotesResolved', 'This vendor bill is already fully credited. No further supplier credit note can be posted against it.')}
                  </div>
                )
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {tt('financeDocs.vendorBills.creditNotesPostedOnly', 'Supplier credit notes can only be created from posted vendor bills.')}
                </div>
              )}

              {creditNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tt('financeDocs.vendorBills.creditNotesEmpty', 'No supplier credit notes have been posted against this vendor bill yet.')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tt('financeDocs.fields.reference', 'Reference')}</TableHead>
                      <TableHead>{tt('financeDocs.fields.date', 'Date')}</TableHead>
                      <TableHead>{tt('financeDocs.fields.status', 'Status')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.total', 'Total')}</TableHead>
                      <TableHead className="text-right">{tt('orders.actions', 'Actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditNotes.map((note) => {
                      const noteModel = buildCreditNoteModel(note)
                      return (
                        <TableRow key={note.id}>
                          <TableCell>
                            <div className="font-medium">{note.supplier_document_reference || note.internal_reference}</div>
                            <div className="text-xs text-muted-foreground">
                              {tt('financeDocs.vendorBills.internalKeyValue', 'Stockwise key {reference}', { reference: note.internal_reference })}
                            </div>
                            {note.adjustment_reason_code ? (
                              <div className="mt-2">
                                <Badge variant="outline">
                                  {getAdjustmentReasonLabel('vendor_credit', note.adjustment_reason_code, lang)}
                                </Badge>
                              </div>
                            ) : null}
                            {note.adjustment_reason_text ? (
                              <div className="mt-1 text-xs text-muted-foreground">{note.adjustment_reason_text}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>{note.note_date}</TableCell>
                          <TableCell>
                            <Badge variant={workflowTone(note.document_workflow_status)}>
                              {note.document_workflow_status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-mono tabular-nums">{formatDocumentMoney(note.total_amount, note.currency_code)}</div>
                            <div className="text-xs text-muted-foreground">{formatBaseMoney(note.total_amount_base)}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => void handlePrintDocument(noteModel)}>
                                <Printer className="mr-2 h-4 w-4" />
                                {tt('financeDocs.mz.printInvoice', 'Print')}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => void handleDownloadPdf(noteModel)}>
                                <Download className="mr-2 h-4 w-4" />
                                {tt('financeDocs.mz.downloadPdf', 'Download PDF')}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => void handleShareDocument(noteModel)}>
                                <Share2 className="mr-2 h-4 w-4" />
                                {tt('financeDocs.mz.shareInvoice', 'Share')}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('financeDocs.vendorBills.debitNotesTitle', 'Supplier debit notes')}</CardTitle>
              <CardDescription>
                {tt('financeDocs.vendorBills.debitNotesHelp', 'Use supplier debit notes for additional charges, omitted supplier value, and other upward AP corrections linked back to the posted vendor bill.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {row.document_workflow_status === 'posted' ? (
                canCreateDebitNote ? (
                  <Button onClick={() => setDebitDialogOpen(true)}>
                    {tt('financeDocs.vendorBills.issueDebitNote', 'Issue supplier debit note')}
                  </Button>
                ) : (
                  <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                    {tt('financeDocs.approval.financeAuthorityRequired', 'Finance authority is required for legal-document issue, post, void, adjustment, and settlement actions.')}
                  </div>
                )
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {tt('financeDocs.vendorBills.debitNotesPostedOnly', 'Supplier debit notes can only be created from posted vendor bills.')}
                </div>
              )}

              {debitNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tt('financeDocs.vendorBills.debitNotesEmpty', 'No supplier debit notes have been posted against this vendor bill yet.')}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{tt('financeDocs.fields.reference', 'Reference')}</TableHead>
                      <TableHead>{tt('financeDocs.fields.date', 'Date')}</TableHead>
                      <TableHead>{tt('financeDocs.fields.status', 'Status')}</TableHead>
                      <TableHead className="text-right">{tt('financeDocs.fields.total', 'Total')}</TableHead>
                      <TableHead className="text-right">{tt('orders.actions', 'Actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {debitNotes.map((note) => {
                      const noteModel = buildDebitNoteModel(note)
                      return (
                        <TableRow key={note.id}>
                          <TableCell>
                            <div className="font-medium">{note.supplier_document_reference || note.internal_reference}</div>
                            <div className="text-xs text-muted-foreground">
                              {tt('financeDocs.vendorBills.internalKeyValue', 'Stockwise key {reference}', { reference: note.internal_reference })}
                            </div>
                            {note.adjustment_reason_code ? (
                              <div className="mt-2">
                                <Badge variant="outline">
                                  {getAdjustmentReasonLabel('vendor_debit', note.adjustment_reason_code, lang)}
                                </Badge>
                              </div>
                            ) : null}
                            {note.adjustment_reason_text ? (
                              <div className="mt-1 text-xs text-muted-foreground">{note.adjustment_reason_text}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>{note.note_date}</TableCell>
                          <TableCell>
                            <Badge variant={workflowTone(note.document_workflow_status)}>
                              {note.document_workflow_status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-mono tabular-nums">{formatDocumentMoney(note.total_amount, note.currency_code)}</div>
                            <div className="text-xs text-muted-foreground">{formatBaseMoney(note.total_amount_base)}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => void handlePrintDocument(noteModel)}>
                                <Printer className="mr-2 h-4 w-4" />
                                {tt('financeDocs.mz.printInvoice', 'Print')}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => void handleDownloadPdf(noteModel)}>
                                <Download className="mr-2 h-4 w-4" />
                                {tt('financeDocs.mz.downloadPdf', 'Download PDF')}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => void handleShareDocument(noteModel)}>
                                <Share2 className="mr-2 h-4 w-4" />
                                {tt('financeDocs.mz.shareInvoice', 'Share')}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <FinanceTimelineCard
            title={tt('financeDocs.audit.timelineTitle', 'Activity journal')}
            emptyLabel={tt('financeDocs.mz.auditEmpty', 'No audit events have been captured for this document yet.')}
            entries={auditTimelineEntries}
          />

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('financeDocs.audit.rawTitle', 'Raw event registry')}</CardTitle>
              <CardDescription>
                {tt('financeDocs.audit.rawHelp', 'Underlying finance-document event rows kept for low-level inspection and troubleshooting.')}
              </CardDescription>
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

          <Dialog open={creditDialogOpen} onOpenChange={setCreditDialogOpen}>
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle>{tt('financeDocs.vendorBills.creditDialogTitle', 'Issue supplier credit note')}</DialogTitle>
                <DialogDescription>
                  {tt('financeDocs.vendorBills.creditDialogHelp', 'Choose a full remaining reduction or build a partial supplier credit note from selected vendor-bill lines. The posted vendor bill remains the AP anchor while credited value accumulates against it.')}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <div className="space-y-5">
                  <RadioGroup value={creditMode} onValueChange={(value) => setCreditMode(value as AdjustmentMode)} className="grid gap-3 md:grid-cols-2">
                    <label htmlFor="vendor-credit-mode-full" className={`rounded-2xl border p-4 ${creditMode === 'full' ? 'border-primary bg-primary/5' : 'border-border/70 bg-background'}`}>
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="vendor-credit-mode-full" value="full" className="mt-1" />
                        <div className="space-y-1">
                          <div className="font-medium">{tt('financeDocs.vendorBills.creditModeFull', 'Full remaining credit')}</div>
                          <div className="text-sm text-muted-foreground">{tt('financeDocs.vendorBills.creditModeFullHelp', 'Credit every remaining eligible line balance still open on this vendor bill.')}</div>
                        </div>
                      </div>
                    </label>
                    <label htmlFor="vendor-credit-mode-partial" className={`rounded-2xl border p-4 ${creditMode === 'partial' ? 'border-primary bg-primary/5' : 'border-border/70 bg-background'}`}>
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="vendor-credit-mode-partial" value="partial" className="mt-1" />
                        <div className="space-y-1">
                          <div className="font-medium">{tt('financeDocs.vendorBills.creditModePartial', 'Partial credit')}</div>
                          <div className="text-sm text-muted-foreground">{tt('financeDocs.vendorBills.creditModePartialHelp', 'Select specific lines, reduce quantities, or enter a smaller supplier credit value for a partial AP adjustment.')}</div>
                        </div>
                      </div>
                    </label>
                  </RadioGroup>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label htmlFor="vendor-credit-supplier-reference">{tt('financeDocs.fields.supplierInvoiceReference', 'Supplier invoice reference')}</Label>
                      <Input id="vendor-credit-supplier-reference" value={creditSupplierReference} onChange={(event) => setCreditSupplierReference(event.target.value)} placeholder={tt('financeDocs.vendorBills.adjustmentReferencePlaceholder', 'Enter the supplier note reference if available')} />
                    </div>
                    <div>
                      <Label htmlFor="vendor-credit-note-date">{tt('financeDocs.fields.date', 'Date')}</Label>
                      <Input id="vendor-credit-note-date" type="date" value={creditNoteDate} onChange={(event) => setCreditNoteDate(event.target.value)} />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="vendor-credit-reason-code">{tt('financeDocs.audit.reasonCode', 'Reason code')}</Label>
                    <Select value={creditReasonCode} onValueChange={setCreditReasonCode}>
                      <SelectTrigger id="vendor-credit-reason-code" className="mt-2">
                        <SelectValue placeholder={tt('financeDocs.audit.reasonCodePlaceholder', 'Select a structured reason code')} />
                      </SelectTrigger>
                      <SelectContent>
                        {creditReasonOptions.map((option) => (
                          <SelectItem key={option.code} value={option.code}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {creditReasonCode ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {creditReasonOptions.find((option) => option.code === creditReasonCode)?.help || ''}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <Label htmlFor="vendor-credit-reason">{tt('financeDocs.vendorBills.adjustmentReason', 'Adjustment reason')}</Label>
                    <Textarea id="vendor-credit-reason" value={creditReason} onChange={(event) => setCreditReason(event.target.value)} rows={4} placeholder={tt('financeDocs.vendorBills.creditReasonPlaceholder', 'Describe why the supplier amount is being reduced')} />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.originalTotal', 'Original total')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(row.total_amount, row.currency_code)}</div></div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.alreadyCredited', 'Already credited')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(postedCreditedDocumentTotal, row.currency_code)}</div></div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.thisCreditNote', 'This supplier credit note')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(creditPreview.noteTotal, row.currency_code)}</div></div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.currentLegalAmount', 'Current AP total')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(creditPreview.adjustedLegalAfterThisNote, row.currency_code)}</div></div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.outstandingAfterThisNote', 'Outstanding after this note')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(creditPreview.outstandingAfterThisNote, row.currency_code)}</div></div>
                  </div>

                  {creditMode === 'partial' ? (
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium">{tt('financeDocs.vendorBills.creditLinesTitle', 'Select vendor-bill lines to credit')}</div>
                        <div className="text-sm text-muted-foreground">{tt('financeDocs.vendorBills.creditLinesHelp', 'Use quantity for returned units or enter a smaller net amount for a partial supplier allowance or reduction.')}</div>
                      </div>
                      <div className="space-y-3">
                        {creditAvailability.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">{tt('financeDocs.vendorBills.creditLinesEmpty', 'No vendor-bill lines are available for crediting.')}</div>
                        ) : (
                          creditAvailability.map((availability) => {
                            const lineDraft = creditLineDrafts[availability.line.id] || { selected: false, quantity: '', amount: '' }
                            return (
                              <div key={availability.line.id} className="rounded-2xl border border-border/70 bg-background p-4">
                                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <label className="flex items-start gap-3">
                                      <Checkbox checked={lineDraft.selected} onCheckedChange={(checked) => toggleCreditLineSelection(availability, checked === true)} disabled={availability.availableNet <= 0 && availability.availableTax <= 0} aria-label={availability.line.description || tt('common.dash', '-')} />
                                      <div className="min-w-0"><div className="font-medium">{availability.line.description || tt('common.dash', '-')}</div></div>
                                    </label>
                                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                                      <div>{tt('financeDocs.vendorBills.availableQty', 'Remaining qty')}: <span className="font-mono tabular-nums">{availability.availableQty}</span></div>
                                      <div>{tt('financeDocs.vendorBills.availableNet', 'Remaining net')}: <span className="font-mono tabular-nums">{formatDocumentMoney(availability.availableNet, row.currency_code)}</span></div>
                                      <div>{tt('financeDocs.vendorBills.availableTax', 'Remaining VAT')}: <span className="font-mono tabular-nums">{formatDocumentMoney(availability.availableTax, row.currency_code)}</span></div>
                                      <div>{tt('financeDocs.vendorBills.alreadyCreditedShort', 'Already credited')}: <span className="font-mono tabular-nums">{formatDocumentMoney(availability.alreadyCreditedNet + availability.alreadyCreditedTax, row.currency_code)}</span></div>
                                    </div>
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[320px]">
                                    <div className="space-y-2"><Label htmlFor={`vendor-credit-line-qty-${availability.line.id}`}>{tt('financeDocs.vendorBills.creditQty', 'Credited qty')}</Label><Input id={`vendor-credit-line-qty-${availability.line.id}`} type="number" min="0" step="0.01" value={lineDraft.quantity} onChange={(event) => updateCreditLineDraft(availability.line.id, { quantity: event.target.value, selected: true })} disabled={!lineDraft.selected} /></div>
                                    <div className="space-y-2"><Label htmlFor={`vendor-credit-line-amount-${availability.line.id}`}>{tt('financeDocs.vendorBills.creditAmount', 'Credited net amount')}</Label><Input id={`vendor-credit-line-amount-${availability.line.id}`} type="number" min="0" step="0.01" value={lineDraft.amount} onChange={(event) => updateCreditLineDraft(availability.line.id, { amount: event.target.value, selected: true })} disabled={!lineDraft.selected} /></div>
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
                        ? tt('financeDocs.vendorBills.creditFullPreview', 'This action will credit every remaining eligible line balance still open on the posted vendor bill.')
                        : tt('financeDocs.vendorBills.creditNothingRemaining', 'No remaining creditable value is left on this vendor bill.')}
                    </div>
                  )}

                  {creditPreview.validationErrors.length > 0 ? (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{creditPreview.validationErrors[0]}</div>
                  ) : null}
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreditDialogOpen(false)} disabled={creatingCredit}>{tt('common.cancel', 'Cancel')}</Button>
                <Button onClick={() => void handleCreateCreditNote()} disabled={creatingCredit || !creditReasonCode || !creditPreview.lines.length || creditPreview.validationErrors.length > 0}>
                  {creatingCredit ? tt('financeDocs.vendorBills.crediting', 'Posting...') : tt('financeDocs.vendorBills.confirmCreditNote', 'Post supplier credit note')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={debitDialogOpen} onOpenChange={setDebitDialogOpen}>
            <DialogContent className="max-w-5xl">
              <DialogHeader>
                <DialogTitle>{tt('financeDocs.vendorBills.debitDialogTitle', 'Issue supplier debit note')}</DialogTitle>
                <DialogDescription>
                  {tt('financeDocs.vendorBills.debitDialogHelp', 'Choose a full AP uplift or build a partial supplier debit note from selected vendor-bill lines. The posted vendor bill remains the AP anchor while debited value accumulates against it.')}
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <div className="space-y-5">
                  <RadioGroup value={debitMode} onValueChange={(value) => setDebitMode(value as AdjustmentMode)} className="grid gap-3 md:grid-cols-2">
                    <label htmlFor="vendor-debit-mode-full" className={`rounded-2xl border p-4 ${debitMode === 'full' ? 'border-primary bg-primary/5' : 'border-border/70 bg-background'}`}>
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="vendor-debit-mode-full" value="full" className="mt-1" />
                        <div className="space-y-1">
                          <div className="font-medium">{tt('financeDocs.vendorBills.debitModeFull', 'Full bill uplift')}</div>
                          <div className="text-sm text-muted-foreground">{tt('financeDocs.vendorBills.debitModeFullHelp', 'Replicate the posted vendor-bill lines as a full upward AP correction when the supplier value was understated as a whole.')}</div>
                        </div>
                      </div>
                    </label>
                    <label htmlFor="vendor-debit-mode-partial" className={`rounded-2xl border p-4 ${debitMode === 'partial' ? 'border-primary bg-primary/5' : 'border-border/70 bg-background'}`}>
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="vendor-debit-mode-partial" value="partial" className="mt-1" />
                        <div className="space-y-1">
                          <div className="font-medium">{tt('financeDocs.vendorBills.debitModePartial', 'Partial debit')}</div>
                          <div className="text-sm text-muted-foreground">{tt('financeDocs.vendorBills.debitModePartialHelp', 'Select specific lines, add extra quantity, or enter a value-only increase for additional supplier charges and short-billed value.')}</div>
                        </div>
                      </div>
                    </label>
                  </RadioGroup>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div><Label htmlFor="vendor-debit-supplier-reference">{tt('financeDocs.fields.supplierInvoiceReference', 'Supplier invoice reference')}</Label><Input id="vendor-debit-supplier-reference" value={debitSupplierReference} onChange={(event) => setDebitSupplierReference(event.target.value)} placeholder={tt('financeDocs.vendorBills.adjustmentReferencePlaceholder', 'Enter the supplier note reference if available')} /></div>
                    <div><Label htmlFor="vendor-debit-note-date">{tt('financeDocs.fields.date', 'Date')}</Label><Input id="vendor-debit-note-date" type="date" value={debitNoteDate} onChange={(event) => setDebitNoteDate(event.target.value)} /></div>
                    <div><Label htmlFor="vendor-debit-due-date">{tt('financeDocs.fields.dueDate', 'Due date')}</Label><Input id="vendor-debit-due-date" type="date" value={debitDueDate} onChange={(event) => setDebitDueDate(event.target.value)} /></div>
                  </div>

                  <div>
                    <Label htmlFor="vendor-debit-reason-code">{tt('financeDocs.audit.reasonCode', 'Reason code')}</Label>
                    <Select value={debitReasonCode} onValueChange={setDebitReasonCode}>
                      <SelectTrigger id="vendor-debit-reason-code" className="mt-2">
                        <SelectValue placeholder={tt('financeDocs.audit.reasonCodePlaceholder', 'Select a structured reason code')} />
                      </SelectTrigger>
                      <SelectContent>
                        {debitReasonOptions.map((option) => (
                          <SelectItem key={option.code} value={option.code}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {debitReasonCode ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {debitReasonOptions.find((option) => option.code === debitReasonCode)?.help || ''}
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <Label htmlFor="vendor-debit-reason">{tt('financeDocs.vendorBills.adjustmentReason', 'Adjustment reason')}</Label>
                    <Textarea id="vendor-debit-reason" value={debitReason} onChange={(event) => setDebitReason(event.target.value)} rows={4} placeholder={tt('financeDocs.vendorBills.debitReasonPlaceholder', 'Describe why the supplier amount must increase')} />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.originalTotal', 'Original total')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(row.total_amount, row.currency_code)}</div></div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.alreadyCredited', 'Already credited')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(postedCreditedDocumentTotal, row.currency_code)}</div></div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.alreadyDebited', 'Already debited')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(postedDebitedDocumentTotal, row.currency_code)}</div></div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.currentLegalAmount', 'Current AP total')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(debitPreview.adjustedLegalAfterThisNote, row.currency_code)}</div></div>
                    <div className="rounded-2xl border border-border/70 bg-muted/20 p-3"><div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('financeDocs.vendorBills.outstandingAfterThisNote', 'Outstanding after this note')}</div><div className="mt-2 font-mono tabular-nums font-semibold">{formatDocumentMoney(debitPreview.outstandingAfterThisNote, row.currency_code)}</div></div>
                  </div>

                  {debitMode === 'partial' ? (
                    <div className="space-y-3">
                      <div>
                        <div className="text-sm font-medium">{tt('financeDocs.vendorBills.debitLinesTitle', 'Select vendor-bill lines to debit')}</div>
                        <div className="text-sm text-muted-foreground">{tt('financeDocs.vendorBills.debitLinesHelp', 'Use quantity when the supplier value was short-billed, or enter a net amount for a pure value increase linked back to the vendor-bill line.')}</div>
                      </div>
                      <div className="space-y-3">
                        {lines.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">{tt('financeDocs.vendorBills.debitLinesEmpty', 'No vendor-bill lines are available for debit adjustments.')}</div>
                        ) : (
                          lines.map((line) => {
                            const lineDraft = debitLineDrafts[line.id] || { selected: false, quantity: '', amount: '' }
                            const rollup = debitRollupByLineId.get(line.id)
                            return (
                              <div key={line.id} className="rounded-2xl border border-border/70 bg-background p-4">
                                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <label className="flex items-start gap-3">
                                      <Checkbox checked={lineDraft.selected} onCheckedChange={(checked) => toggleDebitLineSelection(line, checked === true)} aria-label={line.description || tt('common.dash', '-')} />
                                      <div className="min-w-0"><div className="font-medium">{line.description || tt('common.dash', '-')}</div></div>
                                    </label>
                                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                                      <div>{tt('financeDocs.vendorBills.originalQty', 'Original qty')}: <span className="font-mono tabular-nums">{Number(line.qty || 0)}</span></div>
                                      <div>{tt('financeDocs.vendorBills.originalNet', 'Original net')}: <span className="font-mono tabular-nums">{formatDocumentMoney(Number(line.line_total || 0), row.currency_code)}</span></div>
                                      <div>{tt('financeDocs.vendorBills.originalTax', 'Original VAT')}: <span className="font-mono tabular-nums">{formatDocumentMoney(Number(line.tax_amount || 0), row.currency_code)}</span></div>
                                      <div>{tt('financeDocs.vendorBills.alreadyDebitedShort', 'Already debited')}: <span className="font-mono tabular-nums">{formatDocumentMoney((rollup?.lineTotal || 0) + (rollup?.taxAmount || 0), row.currency_code)}</span></div>
                                    </div>
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[320px]">
                                    <div className="space-y-2"><Label htmlFor={`vendor-debit-line-qty-${line.id}`}>{tt('financeDocs.vendorBills.debitQty', 'Debited qty')}</Label><Input id={`vendor-debit-line-qty-${line.id}`} type="number" min="0" step="0.01" value={lineDraft.quantity} onChange={(event) => updateDebitLineDraft(line.id, { quantity: event.target.value, selected: true })} disabled={!lineDraft.selected} /></div>
                                    <div className="space-y-2"><Label htmlFor={`vendor-debit-line-amount-${line.id}`}>{tt('financeDocs.vendorBills.debitAmount', 'Debited net amount')}</Label><Input id={`vendor-debit-line-amount-${line.id}`} type="number" min="0" step="0.01" value={lineDraft.amount} onChange={(event) => updateDebitLineDraft(line.id, { amount: event.target.value, selected: true })} disabled={!lineDraft.selected} /></div>
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
                      {debitPreview.lines.length > 0
                        ? tt('financeDocs.vendorBills.debitFullPreview', 'This action will replicate the posted vendor-bill lines as a full upward AP adjustment tied back to the same supplier document chain.')
                        : tt('financeDocs.vendorBills.debitNothingAvailable', 'No debitable source lines are stored on this vendor bill.')}
                    </div>
                  )}

                  {debitPreview.validationErrors.length > 0 ? (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{debitPreview.validationErrors[0]}</div>
                  ) : null}
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDebitDialogOpen(false)} disabled={creatingDebit}>{tt('common.cancel', 'Cancel')}</Button>
                <Button onClick={() => void handleCreateDebitNote()} disabled={creatingDebit || !debitReasonCode || !debitPreview.lines.length || debitPreview.validationErrors.length > 0}>
                  {creatingDebit ? tt('financeDocs.vendorBills.debiting', 'Posting...') : tt('financeDocs.vendorBills.confirmDebitNote', 'Post supplier debit note')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
