import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, ReceiptText, Undo2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'
import { useAuth } from '../hooks/useAuth'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { FinanceExportDialog, type FinanceExportFormat } from '../components/finance/FinanceExportDialog'
import { FinanceSummaryBand } from '../components/finance/FinanceSummaryBand'
import { PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import {
  exportFinanceExcel,
  exportFinancePdf,
  maskFinanceAccountNumber,
  printFinanceReport,
  type FinanceExportLanguage,
  type FinanceExportModel,
} from '../lib/financeExport'
import {
  loadFinanceAdviceDocumentDetails,
  loadFinanceExportCompany,
  loadFinanceExportCounterparty,
} from '../lib/financeExportData'
import {
  loadFinanceSettlementActivity,
  type FinanceActivityRow,
} from '../lib/financeActivity'
import {
  getBankTransactionWriteMessage,
  getBankTransactionRefSupport,
  isMissingBankTransactionRefColumns,
  setBankTransactionRefSupport,
} from '../lib/bankTransactionRefs'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import {
  SettlementKind,
  daysOverdue,
  normalizeSettledAmount,
  toIsoDate,
} from '../lib/orderFinance'
import { buildSettlementMemo } from '../lib/orderRefs'
import { ReceiptActions } from '../components/receipts/ReceiptActions'
import { financeCan } from '../lib/permissions'
import {
  clearPostingRequestKey,
  getPostingRequestKeyForFingerprint,
  stablePostingFingerprint,
  type PostingRequestKeyRef,
} from '../lib/postingRequestKeys'
import {
  allocateCustomerReceiptOldestFirst,
  buildCustomerReceiptPostingPayload,
  classifyCustomerReceiptError,
  normalizeReceiptMoney,
  summarizeCustomerReceipt,
  type CustomerReceiptAllocationInput,
} from '../lib/customerReceipts'
import {
  salesInvoiceWorkflowLabelKey,
  vendorBillWorkflowLabelKey,
  type SalesInvoiceStateRow,
  type VendorBillStateRow,
} from '../lib/financeDocuments'
import {
  financeAgingBucketLabelKey,
  financeDuePositionLabelKey,
  financeExceptionGroupLabelKey,
  financeExceptionLabelKey,
  financeReviewStateLabelKey,
  FINANCE_RECONCILIATION_EXCEPTIONS_VIEW,
  FINANCE_RECONCILIATION_VIEW,
  type FinanceReconciliationExceptionRow,
  type FinanceReconciliationRow,
  type FinanceReviewState,
} from '../lib/financeReconciliation'
import {
  purchaseWorkflowLabelKey,
  salesWorkflowLabelKey,
  settlementLabelKey,
  type PurchaseOrderStateRow,
  type SalesOrderStateRow,
} from '../lib/orderState'
import {
  salesInvoiceResolutionPresentation,
  vendorBillResolutionPresentation,
} from '../lib/commercialWorkflowPresentation'

import {
  activityStartISO,
  dueTone,
  emptyRows,
  exceptionSeverityTone,
  isCancelled,
  isFinanceDocumentRow,
  isMissingStateViewError,
  n,
  normalizeMoneyValue,
  reviewTone,
  statusTone,
  todayISO,
  validWorkspaceSides,
  validWorkspaceViews,
  type BankAccount,
  type BankTx,
  type CashTx,
  type CustomerReceivableExposure,
  type CustomerReceiptAllocationState,
  type CustomerReceiptCustomer,
  type CustomerReceiptState,
  type CustomerUnappliedCredit,
  type FinanceExportRequest,
  type FinanceWorkspaceSide,
  type FinanceWorkspaceView,
  type HistoryRow,
  type SettlementBalanceStatus,
  type SettlementRow,
} from '../features/settlements/settlementModel'
import { SettlementActivityWorkspace } from '../features/settlements/SettlementActivityWorkspace'

export default function SettlementsPage() {
  const { companyId, companyName, myRole } = useOrg()
  const { user } = useAuth()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view') as FinanceWorkspaceView | null
  const sideParam = searchParams.get('side') as FinanceWorkspaceSide | null
  const workspaceView: FinanceWorkspaceView = viewParam && validWorkspaceViews.has(viewParam) ? viewParam : 'exposure'
  const workspaceSide: FinanceWorkspaceSide = sideParam && validWorkspaceSides.has(sideParam) ? sideParam : 'ar'
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const salesWorkflowLabel = (status?: SalesOrderStateRow['workflow_status'] | null) => {
    switch (status) {
      case 'draft':
        return tt(salesWorkflowLabelKey(status), 'Draft')
      case 'awaiting_approval':
        return tt(salesWorkflowLabelKey(status), 'Awaiting approval')
      case 'approved':
        return tt(salesWorkflowLabelKey(status), 'Approved')
      case 'cancelled':
        return tt(salesWorkflowLabelKey(status), 'Cancelled')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }
  const purchaseWorkflowLabel = (status?: PurchaseOrderStateRow['workflow_status'] | null) => {
    switch (status) {
      case 'draft':
        return tt(purchaseWorkflowLabelKey(status), 'Draft')
      case 'approved':
        return tt(purchaseWorkflowLabelKey(status), 'Approved')
      case 'cancelled':
        return tt(purchaseWorkflowLabelKey(status), 'Cancelled')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }
  const invoiceWorkflowLabel = (status?: SalesInvoiceStateRow['document_workflow_status'] | null) => {
    switch (status) {
      case 'draft':
        return tt(salesInvoiceWorkflowLabelKey(status), 'Draft')
      case 'issued':
        return tt(salesInvoiceWorkflowLabelKey(status), 'Issued')
      case 'voided':
        return tt(salesInvoiceWorkflowLabelKey(status), 'Voided')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }
  const vendorBillWorkflowLabel = (status?: VendorBillStateRow['document_workflow_status'] | null) => {
    switch (status) {
      case 'draft':
        return tt(vendorBillWorkflowLabelKey(status), 'Draft')
      case 'posted':
        return tt(vendorBillWorkflowLabelKey(status), 'Posted')
      case 'voided':
        return tt(vendorBillWorkflowLabelKey(status), 'Voided')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }
  const settlementSummaryLabel = (status?: SettlementBalanceStatus | null) => {
    switch (status) {
      case 'unsettled':
        return tt(settlementLabelKey(status), 'Unsettled')
      case 'partially_settled':
        return tt(settlementLabelKey(status), 'Partially settled')
      case 'settled':
        return tt(settlementLabelKey(status), 'Settled')
      case 'overdue':
        return tt(settlementLabelKey(status), 'Overdue')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }
  const rowSourceLabel = (kind: SettlementKind) => {
    switch (kind) {
      case 'SI':
        return tt('financeDocs.salesInvoices.title', 'Sales Invoices')
      case 'VB':
        return tt('financeDocs.vendorBills.title', 'Vendor Bills')
      case 'SO':
        return tt('orders.sales', 'Sales')
      default:
        return tt('orders.purchase', 'Purchase')
    }
  }
  const settlementActionLabel = (kind: SettlementKind) =>
    kind === 'SO' || kind === 'SI'
      ? tt('settlements.receiveAction', 'Receive cash')
      : tt('settlements.payAction', 'Pay cash')
  const viewAnchorLabel = (kind: SettlementKind) =>
    kind === 'SI' || kind === 'VB'
      ? tt('financeDocs.viewDocument', 'View')
      : tt('settlements.viewOrder', 'View order')
  const canManageSettlement = financeCan.settlementSensitive(myRole)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const settlementPostingRequestRef = useRef<PostingRequestKeyRef>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [baseCode, setBaseCode] = useState('MZN')
  const [rows, setRows] = useState(emptyRows)
  const [stateViewsUnavailable, setStateViewsUnavailable] = useState(false)
  const [reconciliationViewsUnavailable, setReconciliationViewsUnavailable] = useState(false)
  const [reviewRows, setReviewRows] = useState<FinanceReconciliationRow[]>([])
  const [reviewExceptions, setReviewExceptions] = useState<FinanceReconciliationExceptionRow[]>([])
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [bankRefsSupported, setBankRefsSupported] = useState<boolean | null>(() => getBankTransactionRefSupport())
  const [receiptCustomers, setReceiptCustomers] = useState<CustomerReceiptCustomer[]>([])
  const [receiptExposures, setReceiptExposures] = useState<CustomerReceivableExposure[]>([])
  const [customerUnappliedCredits, setCustomerUnappliedCredits] = useState<CustomerUnappliedCredit[]>([])
  const [customerReceipts, setCustomerReceipts] = useState<CustomerReceiptState[]>([])
  const [receiptAllocations, setReceiptAllocations] = useState<CustomerReceiptAllocationState[]>([])
  const [receiptsLoading, setReceiptsLoading] = useState(false)
  const [receiptsError, setReceiptsError] = useState<string | null>(null)
  const [receiptCustomerFilter, setReceiptCustomerFilter] = useState(searchParams.get('customerId') || 'ALL')
  const [activeReceiptId, setActiveReceiptId] = useState<string | null>(null)

  const customerReceiptPostingRequestRef = useRef<PostingRequestKeyRef>(null)
  const allocationRequestRef = useRef<PostingRequestKeyRef>(null)
  const reversalRequestRef = useRef<PostingRequestKeyRef>(null)
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [receiptStep, setReceiptStep] = useState<1 | 2 | 3>(1)
  const [receiptCustomerId, setReceiptCustomerId] = useState(searchParams.get('customerId') || '')
  const [receiptAmount, setReceiptAmount] = useState('')
  const [receiptDate, setReceiptDate] = useState(todayISO())
  const [receiptMethod, setReceiptMethod] = useState<'cash' | 'bank'>('cash')
  const [receiptBankId, setReceiptBankId] = useState('')
  const [receiptExternalReference, setReceiptExternalReference] = useState('')
  const [receiptNote, setReceiptNote] = useState('')
  const [receiptAllocationValues, setReceiptAllocationValues] = useState<Record<string, string>>({})
  const [receiptSaving, setReceiptSaving] = useState(false)
  const [laterAllocationInvoiceId, setLaterAllocationInvoiceId] = useState('')
  const [laterAllocationAmount, setLaterAllocationAmount] = useState('')
  const [reversalAllocation, setReversalAllocation] = useState<CustomerReceiptAllocationState | null>(null)
  const [reversalReason, setReversalReason] = useState('')

  const [search, setSearch] = useState('')
  const [partyFilter, setPartyFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [currencyFilter, setCurrencyFilter] = useState('ALL')
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'due_soon' | 'current'>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reviewSearch, setReviewSearch] = useState('')
  const [reviewPartyFilter, setReviewPartyFilter] = useState('ALL')
  const [reviewCurrencyFilter, setReviewCurrencyFilter] = useState('ALL')
  const [reviewDueFilter, setReviewDueFilter] = useState<'all' | 'overdue' | 'due_soon' | 'current' | 'resolved' | 'undated'>('all')
  const [reviewStateFilter, setReviewStateFilter] = useState<'all' | FinanceReviewState>('all')
  const [reviewFromDate, setReviewFromDate] = useState('')
  const [reviewToDate, setReviewToDate] = useState('')
  const [activityFrom, setActivityFrom] = useState(activityStartISO())
  const [activityTo, setActivityTo] = useState(todayISO())
  const [activityMethod, setActivityMethod] = useState<'all' | 'cash' | 'bank'>('all')
  const [activitySearch, setActivitySearch] = useState('')
  const [activityRows, setActivityRows] = useState<FinanceActivityRow[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [exportRequest, setExportRequest] = useState<FinanceExportRequest | null>(null)
  const [lastSettlementResult, setLastSettlementResult] = useState<{
    activity: FinanceActivityRow
    outstandingAfter: number
    replayed: boolean
  } | null>(null)

  const [activeRow, setActiveRow] = useState<SettlementRow | null>(null)
  const [dialogTab, setDialogTab] = useState<'settle' | 'history'>('settle')
  const [settleMethod, setSettleMethod] = useState<'cash' | 'bank'>('cash')
  const [settleAmount, setSettleAmount] = useState('')
  const [settleDate, setSettleDate] = useState(todayISO())
  const [settleMemo, setSettleMemo] = useState('')
  const [settleBankId, setSettleBankId] = useState('')

  const money = (amount: number) => formatMoneyBase(amount, baseCode, lang === 'pt' ? 'pt-MZ' : 'en-MZ')
  const customerReceiptErrorMessage = (error: unknown, fallback: 'post' | 'allocation' | 'reversal') => {
    switch (classifyCustomerReceiptError(error)) {
      case 'baseCurrencyOnly':
        return tt('customerReceipts.baseCurrencyOnly', 'Multi-invoice receipts can only use company-base-currency invoices.')
      case 'overAllocated':
        return tt('customerReceipts.overAllocated', 'Allocated amount cannot exceed the amount received.')
      case 'invoiceOverAllocated':
        return tt('customerReceipts.invoiceOverAllocated', 'An allocation exceeds the invoice outstanding balance. Refresh and review the allocations.')
      case 'customerMismatch':
        return tt('customerReceipts.customerMismatch', 'Every selected invoice must belong to the selected customer.')
      case 'creditChanged':
        return tt('customerReceipts.creditChanged', 'The available receipt credit changed. Refresh and review the allocation.')
      case 'stale':
        return tt('customerReceipts.stale', 'This receipt or invoice is no longer available. Refresh and review the latest state.')
      case 'alreadyReversed':
        return tt('customerReceipts.alreadyReversed', 'This allocation has already been reversed. Refresh to see the latest state.')
      case 'permissionDenied':
        return tt('customerReceipts.permissionDenied', 'You do not have permission to manage customer receipts for this company.')
      case 'bankRequired':
        return tt('customerReceipts.bankRequired', 'Choose a bank account before posting a bank receipt.')
      case 'reasonRequired':
        return tt('customerReceipts.reasonRequired', 'Enter a reason for the allocation reversal.')
      case 'requestConflict':
        return tt('customerReceipts.requestConflict', 'This receipt request changed or is still being processed. Refresh and try again.')
      default:
        return fallback === 'post'
          ? tt('customerReceipts.postFailed', 'The customer receipt could not be posted.')
          : fallback === 'allocation'
            ? tt('customerReceipts.allocationFailed', 'Receipt credit could not be allocated.')
            : tt('customerReceipts.reversalFailed', 'The allocation could not be reversed.')
    }
  }
  const tab: 'receive' | 'pay' = workspaceSide === 'ar' ? 'receive' : 'pay'
  const reviewSide: FinanceReconciliationRow['ledger_side'] = workspaceSide === 'ar' ? 'AR' : 'AP'

  const updateWorkspaceQuery = (
    next: Partial<{ view: FinanceWorkspaceView; side: FinanceWorkspaceSide }>,
  ) => {
    const params = new URLSearchParams(searchParams)
    params.set('view', next.view || workspaceView)
    params.set('side', next.side || workspaceSide)
    setSearchParams(params)
  }

  useEffect(() => {
    if (!banks.length) return
    if (!settleBankId || !banks.some(bank => bank.id === settleBankId)) {
      setSettleBankId(banks[0].id)
    }
  }, [banks, settleBankId])

  useEffect(() => {
    setSearch('')
    setPartyFilter('ALL')
    setStatusFilter('ALL')
    setCurrencyFilter('ALL')
    setDueFilter('all')
    setFromDate('')
    setToDate('')
    setReviewSearch('')
    setReviewPartyFilter('ALL')
    setReviewCurrencyFilter('ALL')
    setReviewDueFilter('all')
    setReviewStateFilter('all')
    setReviewFromDate('')
    setReviewToDate('')
    setActivitySearch('')
    setActivityMethod('all')
    setActivityFrom(activityStartISO())
    setActivityTo(todayISO())
    setActiveRow(null)
    setExportRequest(null)
    setLastSettlementResult(null)
    setReceiptCustomers([])
    setReceiptExposures([])
    setCustomerUnappliedCredits([])
    setCustomerReceipts([])
    setReceiptAllocations([])
    setActiveReceiptId(null)
  }, [companyId])

  useEffect(() => {
    if (!companyId) {
      setActivityRows([])
      setActivityError(null)
      setActivityLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setActivityLoading(true)
      setActivityError(null)
      try {
        const nextRows = await loadFinanceSettlementActivity(companyId, activityFrom, activityTo)
        if (!cancelled) setActivityRows(nextRows)
      } catch (error) {
        console.error('[settlements] failed to load settlement activity', error)
        if (!cancelled) {
          setActivityRows([])
          setActivityError(tt('financeUx.activityUnavailable', 'Settlement activity evidence is unavailable.'))
        }
      } finally {
        if (!cancelled) setActivityLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activityFrom, activityTo, companyId, refreshKey])

  useEffect(() => {
    if (!companyId) {
      setReceiptCustomers([])
      setReceiptExposures([])
      setCustomerUnappliedCredits([])
      setCustomerReceipts([])
      setReceiptAllocations([])
      setReceiptsError(null)
      setReceiptsLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      setReceiptsLoading(true)
      setReceiptsError(null)
      try {
        const [customersResult, exposuresResult, receiptsResult, allocationsResult, unappliedResult] = await Promise.all([
          supabase.from('customers').select('id,code,name,email,phone').eq('company_id', companyId).order('name'),
          supabase
            .from('v_customer_receivable_exposures')
            .select('company_id,customer_id,anchor_id,anchor_kind,document_reference,document_date,due_date,customer_name,document_currency_code,base_currency_code,original_amount_base,outstanding_amount_base,collection_status,collection_next_action_at,collection_pause_until,dispute_category,current_promise_id,collections_suppressed,collection_suppression_reason,due_position,days_past_due')
            .eq('company_id', companyId)
            .order('due_date', { ascending: true, nullsFirst: false }),
          supabase
            .from('v_customer_receipt_state')
            .select('*')
            .eq('company_id', companyId)
            .order('received_on', { ascending: false })
            .order('created_at', { ascending: false }),
          supabase
            .from('v_customer_receipt_allocations')
            .select('*')
            .eq('company_id', companyId)
            .order('created_at', { ascending: true }),
          supabase
            .from('v_customer_unapplied_credit')
            .select('company_id,customer_id,currency_code,unapplied_credit_base,receipt_count')
            .eq('company_id', companyId),
        ])
        const error = customersResult.error || exposuresResult.error || receiptsResult.error || allocationsResult.error || unappliedResult.error
        if (error) throw error
        if (cancelled) return

        const customers = (customersResult.data || []) as CustomerReceiptCustomer[]
        const receipts = (receiptsResult.data || []) as CustomerReceiptState[]
        const requestedCustomerId = searchParams.get('customerId')
        const requestedReceiptId = searchParams.get('receiptId')
        const requestedCompanyId = searchParams.get('companyId')
        const validRequestedCustomer = requestedCustomerId
          ? (!requestedCompanyId || requestedCompanyId === companyId)
            && customers.some((customer) => customer.id === requestedCustomerId)
          : false
        setReceiptCustomers(customers)
        setReceiptExposures((exposuresResult.data || []) as CustomerReceivableExposure[])
        setCustomerUnappliedCredits((unappliedResult.data || []) as CustomerUnappliedCredit[])
        setCustomerReceipts(receipts)
        setReceiptAllocations((allocationsResult.data || []) as CustomerReceiptAllocationState[])
        if (validRequestedCustomer && requestedCustomerId) {
          setReceiptCustomerFilter(requestedCustomerId)
          setReceiptCustomerId(requestedCustomerId)
        } else if (requestedCustomerId) {
          setReceiptCustomerFilter('ALL')
          setReceiptCustomerId('')
          const params = new URLSearchParams(searchParams)
          params.delete('customerId')
          setSearchParams(params, { replace: true })
        }
        const requestedReceipt = requestedReceiptId
          && (!requestedCompanyId || requestedCompanyId === companyId)
          ? receipts.find((receipt) => receipt.id === requestedReceiptId) || null
          : null
        if (requestedReceipt) {
          setActiveReceiptId(requestedReceipt.id)
          setReceiptCustomerFilter(requestedReceipt.customer_id)
          setReceiptCustomerId(requestedReceipt.customer_id)
        } else if (requestedReceiptId) {
          setActiveReceiptId(null)
          const params = new URLSearchParams(searchParams)
          params.delete('receiptId')
          setSearchParams(params, { replace: true })
        }
      } catch (error) {
        console.error('[settlements] failed to load customer receipts', error)
        if (!cancelled) {
          setReceiptCustomers([])
          setReceiptExposures([])
          setCustomerUnappliedCredits([])
          setCustomerReceipts([])
          setReceiptAllocations([])
          setReceiptsError(tt('customerReceipts.loadFailed', 'Customer receipts are unavailable. Try again.'))
        }
      } finally {
        if (!cancelled) setReceiptsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId, refreshKey, searchParams, setSearchParams])

  useEffect(() => {
    if (!companyId) {
      setRows(emptyRows)
      setReviewRows([])
      setReviewExceptions([])
      setBanks([])
      setStateViewsUnavailable(false)
      setReconciliationViewsUnavailable(false)
      setActiveRow(null)
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchBankTransactions(bankIds: string[]) {
      if (!bankIds.length) return [] as BankTx[]

      const withRefs = await supabase
        .from('bank_transactions')
        .select('id,bank_id,happened_at,memo,amount_base,created_at,ref_type,ref_id')
        .in('bank_id', bankIds)

      if (!withRefs.error) {
        setBankTransactionRefSupport(true)
        if (!cancelled) setBankRefsSupported(true)
        return (withRefs.data || []) as BankTx[]
      }
      if (!isMissingBankTransactionRefColumns(withRefs.error)) throw withRefs.error

      setBankTransactionRefSupport(false)
      if (!cancelled) setBankRefsSupported(false)

      const fallback = await supabase
        .from('bank_transactions')
        .select('id,bank_id,happened_at,memo,amount_base,created_at')
        .in('bank_id', bankIds)

      if (fallback.error) throw fallback.error

      return ((fallback.data || []) as BankTx[]).map(row => ({
        ...row,
        ref_type: null,
        ref_id: null,
      })) as BankTx[]
    }

    async function load() {
      try {
        setLoading(true)
        const baseCurrency = await getBaseCurrencyCode(companyId)

        const [banksRes, soRes, poRes, siRes, vbRes, cashRes, reviewRes, exceptionRes] = await Promise.all([
          supabase.from('bank_accounts').select('id,name,bank_name,account_number,currency_code').eq('company_id', companyId).order('name', { ascending: true }),
          supabase
            .from('v_sales_order_state')
            .select('*')
            .eq('company_id', companyId),
          supabase
            .from('v_purchase_order_state')
            .select('*')
            .eq('company_id', companyId),
          supabase
            .from('v_sales_invoice_state')
            .select('*')
            .eq('company_id', companyId),
          supabase
            .from('v_vendor_bill_state')
            .select('*')
            .eq('company_id', companyId),
          supabase
            .from('cash_transactions')
            .select('id,happened_at,type,ref_type,ref_id,memo,amount_base')
            .eq('company_id', companyId)
            .in('ref_type', ['SO', 'PO', 'SI', 'VB']),
          supabase
            .from(FINANCE_RECONCILIATION_VIEW)
            .select('*')
            .eq('company_id', companyId),
          supabase
            .from(FINANCE_RECONCILIATION_EXCEPTIONS_VIEW)
            .select('*')
            .eq('company_id', companyId),
        ])

        if (banksRes.error) throw banksRes.error
        if (cashRes.error) throw cashRes.error

        const missingViews = [
          ['v_sales_order_state', soRes.error],
          ['v_purchase_order_state', poRes.error],
          ['v_sales_invoice_state', siRes.error],
          ['v_vendor_bill_state', vbRes.error],
        ].some(([viewName, error]) => isMissingStateViewError(error, String(viewName)))
        const missingReconciliationViews = [
          [FINANCE_RECONCILIATION_VIEW, reviewRes.error],
          [FINANCE_RECONCILIATION_EXCEPTIONS_VIEW, exceptionRes.error],
        ].some(([viewName, error]) => isMissingStateViewError(error, String(viewName)))
        if (missingViews) {
          if (!cancelled) {
            setBaseCode(baseCurrency || 'MZN')
            setBanks((banksRes.data || []) as BankAccount[])
            setRows(emptyRows)
            setReviewRows([])
            setReviewExceptions([])
            setStateViewsUnavailable(true)
            setReconciliationViewsUnavailable(missingReconciliationViews)
          }
          return
        }

        if (soRes.error) throw soRes.error
        if (poRes.error) throw poRes.error
        if (siRes.error) throw siRes.error
        if (vbRes.error) throw vbRes.error
        if (!missingReconciliationViews && reviewRes.error) throw reviewRes.error
        if (!missingReconciliationViews && exceptionRes.error) throw exceptionRes.error

        const bankList = (banksRes.data || []) as BankAccount[]
        const bankTxRows = await fetchBankTransactions(bankList.map(bank => bank.id))
        const bankById = new Map(bankList.map(bank => [bank.id, bank]))

        const historyByKey = new Map<string, HistoryRow[]>()
        const pushHistory = (kind: SettlementKind, refId: string, entry: HistoryRow) => {
          const key = `${kind}:${refId}`
          historyByKey.set(key, [...(historyByKey.get(key) || []), entry])
        }
        const settlementBreakdown = (kind: SettlementKind, refId: string) =>
          (historyByKey.get(`${kind}:${refId}`) || []).reduce(
            (totals, entry) => {
              if (entry.source === 'cash') totals.cash += n(entry.amountBase)
              if (entry.source === 'bank') totals.bank += n(entry.amountBase)
              return totals
            },
            { cash: 0, bank: 0 },
          )

        for (const tx of (cashRes.data || []) as CashTx[]) {
          if ((tx.ref_type !== 'SO' && tx.ref_type !== 'PO' && tx.ref_type !== 'SI' && tx.ref_type !== 'VB') || !tx.ref_id) continue
          pushHistory(tx.ref_type, tx.ref_id, {
            id: tx.id,
            source: 'cash',
            sourceLabel: tt('settlements.cashSource', 'Cash'),
            happenedAt: tx.happened_at,
            amountBase: normalizeSettledAmount(tx.ref_type, n(tx.amount_base)),
            memo: tx.memo,
          })
        }

        for (const tx of bankTxRows) {
          if ((tx.ref_type !== 'SO' && tx.ref_type !== 'PO' && tx.ref_type !== 'SI' && tx.ref_type !== 'VB') || !tx.ref_id) continue
          pushHistory(tx.ref_type, tx.ref_id, {
            id: tx.id,
            source: 'bank',
            sourceLabel: bankById.get(tx.bank_id)?.name || tt('settlements.bankSource', 'Bank'),
            happenedAt: tx.happened_at,
            amountBase: normalizeSettledAmount(tx.ref_type, n(tx.amount_base)),
            memo: tx.memo,
          })
        }

        const receiveRows = [
          ...((soRes.data || []) as SalesOrderStateRow[])
          .filter(order => !isCancelled(order.legacy_status) && order.workflow_status !== 'cancelled' && order.financial_anchor === 'legacy_order_link')
          .map(order => {
            const settled = n(order.legacy_settled_base)
            const outstanding = n(order.legacy_outstanding_base)
            const balanceStatus = order.settlement_status
            const breakdown = settlementBreakdown('SO', order.id)

            return {
              kind: 'SO' as const,
              id: order.id,
              reference: order.order_no || tt('financeUx.unresolvedReference', 'Unresolved reference'),
              counterparty: order.counterparty_name || tt('common.none', 'None'),
              documentDate: order.order_date,
              dueDate: order.due_date,
              currency: order.currency_code || baseCurrency || 'MZN',
              workflowStatus: order.workflow_status,
              workflowLabel: salesWorkflowLabel(order.workflow_status),
              balanceStatus,
              balanceLabel: settlementSummaryLabel(balanceStatus),
              originalAmount: n(order.total_amount_ccy),
              originalBase: n(order.total_amount_base),
              creditedBase: 0,
              debitedBase: 0,
              currentLegalBase: n(order.total_amount_base),
              settledBase: settled,
              outstandingBase: outstanding,
              cashBase: breakdown.cash,
              bankBase: breakdown.bank,
              agingDays: daysOverdue(order.due_date),
              history: (historyByKey.get(`SO:${order.id}`) || []).sort((a, b) => String(b.happenedAt).localeCompare(String(a.happenedAt))),
              sourceLabel: rowSourceLabel('SO'),
            }
          })
          .filter(row => normalizeMoneyValue(row.outstandingBase) > 0)
          .sort((a, b) => (b.agingDays - a.agingDays) || String(a.documentDate || '').localeCompare(String(b.documentDate || ''))),
          ...((siRes.data || []) as SalesInvoiceStateRow[])
          .filter(invoice => invoice.document_workflow_status === 'issued')
          .map(invoice => {
            const balanceStatus = invoice.settlement_status
            const breakdown = settlementBreakdown('SI', invoice.id)

            return {
              kind: 'SI' as const,
              id: invoice.id,
              reference: invoice.internal_reference,
              counterparty: invoice.counterparty_name || tt('common.none', 'None'),
              documentDate: invoice.invoice_date,
              dueDate: invoice.due_date,
              currency: invoice.currency_code || baseCurrency || 'MZN',
              workflowStatus: invoice.document_workflow_status,
              workflowLabel: invoiceWorkflowLabel(invoice.document_workflow_status),
              balanceStatus,
              balanceLabel: settlementSummaryLabel(balanceStatus),
              originalAmount: n(invoice.total_amount),
              originalBase: n(invoice.total_amount_base),
              creditedBase: n(invoice.credited_total_base),
              debitedBase: n(invoice.debited_total_base),
              currentLegalBase: n(
                invoice.current_legal_total_base,
                n(invoice.total_amount_base) - n(invoice.credited_total_base) + n(invoice.debited_total_base),
              ),
              settledBase: n(invoice.settled_base),
              outstandingBase: n(invoice.outstanding_base),
              cashBase: breakdown.cash,
              bankBase: breakdown.bank,
              agingDays: daysOverdue(invoice.due_date),
              history: (historyByKey.get(`SI:${invoice.id}`) || []).sort((a, b) => String(b.happenedAt).localeCompare(String(a.happenedAt))),
              sourceLabel: rowSourceLabel('SI'),
            }
          })
          .filter(row => normalizeMoneyValue(row.outstandingBase) > 0)
          .sort((a, b) => (b.agingDays - a.agingDays) || String(a.documentDate || '').localeCompare(String(b.documentDate || ''))),
        ]

        const payRows = [
          ...((poRes.data || []) as PurchaseOrderStateRow[])
          .filter(order => !isCancelled(order.legacy_status) && order.workflow_status !== 'cancelled' && order.financial_anchor === 'legacy_order_link')
          .map(order => {
            const settled = n(order.legacy_paid_base)
            const outstanding = n(order.legacy_outstanding_base)
            const balanceStatus = order.settlement_status
            const breakdown = settlementBreakdown('PO', order.id)

            return {
              kind: 'PO' as const,
              id: order.id,
              reference: order.order_no || tt('financeUx.unresolvedReference', 'Unresolved reference'),
              counterparty: order.counterparty_name || tt('common.none', 'None'),
              documentDate: order.order_date,
              dueDate: order.due_date,
              currency: order.currency_code || baseCurrency || 'MZN',
              workflowStatus: order.workflow_status,
              workflowLabel: purchaseWorkflowLabel(order.workflow_status),
              balanceStatus,
              balanceLabel: settlementSummaryLabel(balanceStatus),
              originalAmount: n(order.total_amount_ccy),
              originalBase: n(order.total_amount_base),
              creditedBase: 0,
              debitedBase: 0,
              currentLegalBase: n(order.total_amount_base),
              settledBase: settled,
              outstandingBase: outstanding,
              cashBase: breakdown.cash,
              bankBase: breakdown.bank,
              agingDays: daysOverdue(order.due_date),
              history: (historyByKey.get(`PO:${order.id}`) || []).sort((a, b) => String(b.happenedAt).localeCompare(String(a.happenedAt))),
              sourceLabel: rowSourceLabel('PO'),
            }
          })
          .filter(row => normalizeMoneyValue(row.outstandingBase) > 0)
          .sort((a, b) => (b.agingDays - a.agingDays) || String(a.documentDate || '').localeCompare(String(b.documentDate || ''))),
          ...((vbRes.data || []) as VendorBillStateRow[])
          .filter(bill => bill.document_workflow_status === 'posted')
          .map(bill => {
            const balanceStatus = bill.settlement_status
            const breakdown = settlementBreakdown('VB', bill.id)

            return {
              kind: 'VB' as const,
              id: bill.id,
              reference: bill.primary_reference,
              counterparty: bill.counterparty_name || tt('common.none', 'None'),
              documentDate: bill.bill_date,
              dueDate: bill.due_date,
              currency: bill.currency_code || baseCurrency || 'MZN',
              workflowStatus: bill.document_workflow_status,
              workflowLabel: vendorBillWorkflowLabel(bill.document_workflow_status),
              balanceStatus,
              balanceLabel: settlementSummaryLabel(balanceStatus),
              originalAmount: n(bill.total_amount),
              originalBase: n(bill.total_amount_base),
              creditedBase: n(bill.credited_total_base),
              debitedBase: n(bill.debited_total_base),
              currentLegalBase: n(
                bill.current_legal_total_base,
                n(bill.total_amount_base) - n(bill.credited_total_base) + n(bill.debited_total_base),
              ),
              settledBase: n(bill.settled_base),
              outstandingBase: n(bill.outstanding_base),
              cashBase: breakdown.cash,
              bankBase: breakdown.bank,
              agingDays: daysOverdue(bill.due_date),
              history: (historyByKey.get(`VB:${bill.id}`) || []).sort((a, b) => String(b.happenedAt).localeCompare(String(a.happenedAt))),
              sourceLabel: rowSourceLabel('VB'),
            }
          })
          .filter(row => normalizeMoneyValue(row.outstandingBase) > 0)
          .sort((a, b) => (b.agingDays - a.agingDays) || String(a.documentDate || '').localeCompare(String(b.documentDate || ''))),
        ]

        if (!cancelled) {
          setBaseCode(baseCurrency || 'MZN')
          setBanks(bankList)
          setRows({ receive: receiveRows, pay: payRows })
          setStateViewsUnavailable(false)
          setReviewRows(missingReconciliationViews ? [] : ((reviewRes.data || []) as FinanceReconciliationRow[]))
          setReviewExceptions(missingReconciliationViews ? [] : ((exceptionRes.data || []) as FinanceReconciliationExceptionRow[]))
          setReconciliationViewsUnavailable(missingReconciliationViews)
        }
      } catch (error: any) {
        console.error(error)
        if (!cancelled) {
          setRows(emptyRows)
          setReviewRows([])
          setReviewExceptions([])
          setBanks([])
          setStateViewsUnavailable(true)
          setReconciliationViewsUnavailable(true)
          toast.error(error?.message || tt('settlements.loadFailed', 'Failed to load settlements'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [companyId, refreshKey])

  const receiveTotal = useMemo(() => rows.receive.reduce((sum, row) => sum + row.outstandingBase, 0), [rows.receive])
  const payTotal = useMemo(() => rows.pay.reduce((sum, row) => sum + row.outstandingBase, 0), [rows.pay])
  const overdueCount = useMemo(() => [...rows.receive, ...rows.pay].filter(row => row.agingDays > 0).length, [rows])

  const currentRows = tab === 'receive' ? rows.receive : rows.pay
  const partyOptions = useMemo(() => Array.from(new Set(currentRows.map(row => row.counterparty))).sort((a, b) => a.localeCompare(b)), [currentRows])
  const currencyOptions = useMemo(() => Array.from(new Set(currentRows.map(row => row.currency))).sort((a, b) => a.localeCompare(b)), [currentRows])
  const requestedExposureCustomerId = workspaceView === 'exposure' && workspaceSide === 'ar'
    && (!searchParams.get('companyId') || searchParams.get('companyId') === companyId)
    && receiptCustomers.some((customer) => customer.id === searchParams.get('customerId'))
    ? searchParams.get('customerId')
    : null
  const requestedExposureCustomer = requestedExposureCustomerId
    ? receiptCustomers.find((customer) => customer.id === requestedExposureCustomerId) || null
    : null
  const requestedExposureAnchorKeys = useMemo(
    () => new Set(
      requestedExposureCustomerId
        ? receiptExposures
            .filter((exposure) => exposure.customer_id === requestedExposureCustomerId)
            .map((exposure) => `${exposure.anchor_kind === 'sales_invoice' ? 'SI' : 'SO'}:${exposure.anchor_id}`)
        : [],
    ),
    [receiptExposures, requestedExposureCustomerId],
  )
  const requestedExposureRows = useMemo(
    () => requestedExposureCustomerId
      ? receiptExposures.filter((exposure) => (
          exposure.customer_id === requestedExposureCustomerId
          && Number(exposure.outstanding_amount_base) > 0.005
        ))
      : [],
    [receiptExposures, requestedExposureCustomerId],
  )
  const requestedExposureOutstanding = requestedExposureRows.reduce(
    (total, exposure) => total + Number(exposure.outstanding_amount_base),
    0,
  )
  const requestedExposureInvoiceOutstanding = requestedExposureRows
    .filter((exposure) => exposure.anchor_kind === 'sales_invoice')
    .reduce((total, exposure) => total + Number(exposure.outstanding_amount_base), 0)
  const requestedExposureUnapplied = requestedExposureCustomerId
    ? customerUnappliedCredits.find((credit) => (
        credit.customer_id === requestedExposureCustomerId
        && credit.currency_code === baseCode
      )) || null
    : null

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return currentRows.filter(row => {
      if (requestedExposureCustomerId && !requestedExposureAnchorKeys.has(`${row.kind}:${row.id}`)) return false
      if (query) {
        const haystack = `${row.reference} ${row.counterparty} ${row.workflowStatus} ${row.workflowLabel} ${row.balanceStatus} ${row.balanceLabel} ${row.sourceLabel}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (partyFilter !== 'ALL' && row.counterparty !== partyFilter) return false
      if (statusFilter !== 'ALL' && String(row.workflowStatus).toLowerCase() !== statusFilter.toLowerCase()) return false
      if (currencyFilter !== 'ALL' && row.currency !== currencyFilter) return false
      if (fromDate && row.documentDate && row.documentDate < fromDate) return false
      if (toDate && row.documentDate && row.documentDate > toDate) return false
      if (dueFilter === 'overdue' && row.agingDays <= 0) return false
      if (dueFilter === 'current' && row.agingDays > 0) return false
      if (dueFilter === 'due_soon') {
        if (!row.dueDate || row.agingDays > 0) return false
        const diff = new Date(`${row.dueDate}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()
        if (diff < 0 || diff > 7 * 86_400_000) return false
      }
      return true
    })
  }, [currentRows, currencyFilter, dueFilter, fromDate, partyFilter, requestedExposureAnchorKeys, requestedExposureCustomerId, search, statusFilter, toDate])
  const filteredBridgeTotals = useMemo(() => ({
    originalBase: filteredRows.reduce((sum, row) => sum + row.originalBase, 0),
    creditedBase: filteredRows.reduce((sum, row) => sum + row.creditedBase, 0),
    debitedBase: filteredRows.reduce((sum, row) => sum + row.debitedBase, 0),
    currentLegalBase: filteredRows.reduce((sum, row) => sum + row.currentLegalBase, 0),
    settledBase: filteredRows.reduce((sum, row) => sum + row.settledBase, 0),
    outstandingBase: filteredRows.reduce((sum, row) => sum + row.outstandingBase, 0),
  }), [filteredRows])
  const filteredActivityRows = useMemo(() => {
    const query = activitySearch.trim().toLowerCase()
    const side = workspaceSide === 'ar' ? 'AR' : 'AP'
    return activityRows.filter((row) => {
      if (row.ledgerSide !== side) return false
      if (activityMethod !== 'all' && row.channel !== activityMethod) return false
      if (query) {
        const haystack = [
          row.anchorReference,
          row.operationalReference,
          row.counterpartyName,
          row.memo,
          row.bankName,
          row.bankInstitution,
          row.refType,
        ].join(' ').toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [activityMethod, activityRows, activitySearch, workspaceSide])
  const activityTotal = useMemo(
    () => filteredActivityRows.reduce((sum, row) => sum + row.amountBase, 0),
    [filteredActivityRows],
  )

  const currentReviewRows = useMemo(
    () => reviewRows.filter((row) => row.ledger_side === reviewSide),
    [reviewRows, reviewSide],
  )
  const reviewPartyOptions = useMemo(
    () => Array.from(new Set(currentReviewRows.map((row) => row.counterparty_name || tt('common.none', 'None')))).sort((a, b) => a.localeCompare(b)),
    [currentReviewRows, tt],
  )
  const reviewCurrencyOptions = useMemo(
    () => Array.from(new Set(currentReviewRows.map((row) => row.currency_code || baseCode || 'MZN'))).sort((a, b) => a.localeCompare(b)),
    [baseCode, currentReviewRows],
  )
  const filteredReviewRows = useMemo(() => {
    const query = reviewSearch.trim().toLowerCase()
    return currentReviewRows.filter((row) => {
      if (query) {
        const haystack = [
          row.anchor_reference,
          row.operational_reference,
          row.counterparty_name,
          row.resolution_status,
          row.settlement_status,
          row.review_state,
          row.due_position,
        ].join(' ').toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (reviewPartyFilter !== 'ALL' && (row.counterparty_name || tt('common.none', 'None')) !== reviewPartyFilter) return false
      if (reviewCurrencyFilter !== 'ALL' && (row.currency_code || baseCode || 'MZN') !== reviewCurrencyFilter) return false
      if (reviewStateFilter !== 'all' && row.review_state !== reviewStateFilter) return false
      if (reviewFromDate && row.document_date && row.document_date < reviewFromDate) return false
      if (reviewToDate && row.document_date && row.document_date > reviewToDate) return false
      if (reviewDueFilter === 'overdue' && row.due_position !== 'overdue') return false
      if (reviewDueFilter === 'due_soon' && row.due_position !== 'due_soon' && row.due_position !== 'due_today') return false
      if (reviewDueFilter === 'current' && row.due_position !== 'current') return false
      if (reviewDueFilter === 'resolved' && row.due_position !== 'resolved') return false
      if (reviewDueFilter === 'undated' && row.due_position !== 'undated') return false
      return true
    })
  }, [
    baseCode,
    currentReviewRows,
    reviewCurrencyFilter,
    reviewDueFilter,
    reviewFromDate,
    reviewPartyFilter,
    reviewSearch,
    reviewStateFilter,
    reviewToDate,
    tt,
  ])
  const filteredReviewExceptions = useMemo(() => {
    const query = reviewSearch.trim().toLowerCase()
    return reviewExceptions
      .filter((row) => row.ledger_side === reviewSide)
      .filter((row) => {
        if (query) {
          const haystack = [
            row.anchor_reference,
            row.operational_reference,
            row.counterparty_name,
            row.exception_code,
            row.exception_group,
            row.severity,
          ].join(' ').toLowerCase()
          if (!haystack.includes(query)) return false
        }
        if (reviewPartyFilter !== 'ALL' && (row.counterparty_name || tt('common.none', 'None')) !== reviewPartyFilter) return false
        if (reviewFromDate && row.document_date && row.document_date < reviewFromDate) return false
        if (reviewToDate && row.document_date && row.document_date > reviewToDate) return false
        return true
      })
  }, [reviewExceptions, reviewFromDate, reviewPartyFilter, reviewSearch, reviewSide, reviewToDate, tt])
  const reviewTotals = useMemo(() => ({
    original: filteredReviewRows.reduce((sum, row) => sum + n(row.original_total_base), 0),
    netAdjustments: filteredReviewRows.reduce((sum, row) => sum + n(row.net_adjustment_base), 0),
    currentLegal: filteredReviewRows.reduce((sum, row) => sum + n(row.current_legal_total_base), 0),
    settled: filteredReviewRows.reduce((sum, row) => sum + n(row.settled_base), 0),
    outstanding: filteredReviewRows.reduce((sum, row) => sum + n(row.outstanding_base), 0),
    overSettled: filteredReviewRows.reduce((sum, row) => sum + n(row.over_settled_base), 0),
    exceptionCount: filteredReviewRows.reduce((sum, row) => sum + n(row.exception_count), 0),
    overdueCount: filteredReviewRows.filter((row) => row.due_position === 'overdue').length,
    reviewCount: filteredReviewRows.filter((row) => row.needs_review).length,
  }), [filteredReviewRows])
  const reviewStateCounts = useMemo(() => ({
    exception: filteredReviewRows.filter((row) => row.review_state === 'exception').length,
    overdue: filteredReviewRows.filter((row) => row.review_state === 'overdue').length,
    attention: filteredReviewRows.filter((row) => row.review_state === 'attention').length,
    open: filteredReviewRows.filter((row) => row.review_state === 'open').length,
    resolved: filteredReviewRows.filter((row) => row.review_state === 'resolved').length,
  }), [filteredReviewRows])

  const duePositionLabel = (position?: FinanceReconciliationRow['due_position'] | null) => {
    switch (position) {
      case 'resolved':
        return tt(financeDuePositionLabelKey(position), 'Resolved')
      case 'undated':
        return tt(financeDuePositionLabelKey(position), 'No due date')
      case 'current':
        return tt(financeDuePositionLabelKey(position), 'Current')
      case 'due_soon':
        return tt(financeDuePositionLabelKey(position), 'Due soon')
      case 'due_today':
        return tt(financeDuePositionLabelKey(position), 'Due today')
      case 'overdue':
        return tt(financeDuePositionLabelKey(position), 'Overdue')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }

  const agingBucketLabel = (bucket?: FinanceReconciliationRow['aging_bucket'] | null) => {
    switch (bucket) {
      case 'resolved':
        return tt(financeAgingBucketLabelKey(bucket), 'Resolved')
      case 'undated':
        return tt(financeAgingBucketLabelKey(bucket), 'No due date')
      case 'current':
        return tt(financeAgingBucketLabelKey(bucket), 'Current')
      case '1_30':
        return tt(financeAgingBucketLabelKey(bucket), '1–30 days overdue')
      case '31_60':
        return tt(financeAgingBucketLabelKey(bucket), '31–60 days overdue')
      case '61_90':
        return tt(financeAgingBucketLabelKey(bucket), '61–90 days overdue')
      case '91_plus':
        return tt(financeAgingBucketLabelKey(bucket), '91+ days overdue')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }

  const reviewStateLabel = (state?: FinanceReviewState | null) => {
    switch (state) {
      case 'exception':
        return tt(financeReviewStateLabelKey(state), 'Exception')
      case 'overdue':
        return tt(financeReviewStateLabelKey(state), 'Overdue')
      case 'attention':
        return tt(financeReviewStateLabelKey(state), 'Attention')
      case 'open':
        return tt(financeReviewStateLabelKey(state), 'Open')
      case 'resolved':
        return tt(financeReviewStateLabelKey(state), 'Resolved')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }

  const exceptionLabel = (code?: string | null) => tt(financeExceptionLabelKey(code), 'Finance review exception')
  const exceptionGroupLabel = (group?: FinanceReconciliationExceptionRow['exception_group'] | null) => {
    switch (group) {
      case 'bridge':
        return tt(financeExceptionGroupLabelKey(group), 'Bridge')
      case 'chain':
        return tt(financeExceptionGroupLabelKey(group), 'Chain')
      case 'issue_readiness':
        return tt(financeExceptionGroupLabelKey(group), 'Issue readiness')
      default:
        return tt('orders.status.unknown', 'Unknown')
    }
  }
  const resolutionContextLabel = (row: FinanceReconciliationRow) => {
    if (row.anchor_kind === 'sales_invoice' || row.anchor_kind === 'sales_invoice_draft') {
      const presentation = salesInvoiceResolutionPresentation(
        row.resolution_status as Parameters<typeof salesInvoiceResolutionPresentation>[0],
      )
      return tt(presentation.labelKey, presentation.fallback)
    }
    if (row.anchor_kind === 'vendor_bill') {
      const presentation = vendorBillResolutionPresentation(
        row.resolution_status as Parameters<typeof vendorBillResolutionPresentation>[0],
      )
      return tt(presentation.labelKey, presentation.fallback)
    }
    return settlementSummaryLabel(row.settlement_status as SettlementBalanceStatus)
  }

  const receiptCustomerById = useMemo(
    () => new Map(receiptCustomers.map((customer) => [customer.id, customer])),
    [receiptCustomers],
  )
  const receiptExposureById = useMemo(
    () => new Map(receiptExposures.map((exposure) => [exposure.anchor_id, exposure])),
    [receiptExposures],
  )
  const selectedCustomerExposures = useMemo(
    () => receiptExposures.filter((exposure) => (
      exposure.customer_id === receiptCustomerId
      && exposure.anchor_kind === 'sales_invoice'
      && exposure.document_currency_code === exposure.base_currency_code
      && Number(exposure.outstanding_amount_base) > 0.005
    )),
    [receiptCustomerId, receiptExposures],
  )
  const receiptAllocationInputs = useMemo<CustomerReceiptAllocationInput[]>(
    () => Object.entries(receiptAllocationValues).flatMap(([salesInvoiceId, rawAmount]) => {
      const amountBase = normalizeReceiptMoney(Number(rawAmount))
      return Number.isFinite(amountBase) && amountBase > 0 ? [{ salesInvoiceId, amountBase }] : []
    }),
    [receiptAllocationValues],
  )
  const currentReceiptSummary = useMemo(
    () => summarizeCustomerReceipt(Number(receiptAmount), receiptAllocationInputs),
    [receiptAllocationInputs, receiptAmount],
  )
  const visibleCustomerReceipts = useMemo(
    () => customerReceipts.filter((receipt) => (
      receiptCustomerFilter === 'ALL' || receipt.customer_id === receiptCustomerFilter
    )),
    [customerReceipts, receiptCustomerFilter],
  )
  const activeCustomerReceipt = useMemo(
    () => customerReceipts.find((receipt) => receipt.id === activeReceiptId) || null,
    [activeReceiptId, customerReceipts],
  )
  const activeCustomerReceiptAllocations = useMemo(
    () => receiptAllocations.filter((allocation) => allocation.customer_receipt_id === activeReceiptId),
    [activeReceiptId, receiptAllocations],
  )
  const laterAllocationExposures = useMemo(
    () => receiptExposures.filter((exposure) => (
      exposure.customer_id === activeCustomerReceipt?.customer_id
      && exposure.anchor_kind === 'sales_invoice'
      && exposure.document_currency_code === activeCustomerReceipt?.currency_code
      && Number(exposure.outstanding_amount_base) > 0.005
    )),
    [activeCustomerReceipt, receiptExposures],
  )
  const receiptContextCustomer = receiptCustomerFilter === 'ALL'
    ? null
    : receiptCustomerById.get(receiptCustomerFilter) || null
  const receiptContextExposures = useMemo(
    () => receiptCustomerFilter === 'ALL' ? [] : receiptExposures.filter((exposure) => (
      exposure.customer_id === receiptCustomerFilter
      && Number(exposure.outstanding_amount_base) > 0.005
    )),
    [receiptCustomerFilter, receiptExposures],
  )
  const receiptContextOutstanding = useMemo(
    () => receiptContextExposures.reduce((total, exposure) => total + Number(exposure.outstanding_amount_base), 0),
    [receiptContextExposures],
  )
  const receiptContextAllocatableExposures = useMemo(
    () => receiptContextExposures.filter((exposure) => (
      exposure.anchor_kind === 'sales_invoice'
      && exposure.document_currency_code === exposure.base_currency_code
    )),
    [receiptContextExposures],
  )
  const receiptContextAllocatableOutstanding = useMemo(
    () => receiptContextAllocatableExposures.reduce(
      (total, exposure) => total + Number(exposure.outstanding_amount_base),
      0,
    ),
    [receiptContextAllocatableExposures],
  )
  const receiptContextUnapplied = receiptCustomerFilter === 'ALL'
    ? null
    : customerUnappliedCredits.find((credit) => (
      credit.customer_id === receiptCustomerFilter && credit.currency_code === baseCode
    )) || null

  function updateReceiptCustomerQuery(customerId: string) {
    const params = new URLSearchParams(searchParams)
    params.set('view', 'receipts')
    params.set('side', 'ar')
    if (companyId) params.set('companyId', companyId)
    if (customerId === 'ALL') params.delete('customerId')
    else params.set('customerId', customerId)
    setReceiptCustomerFilter(customerId)
    setSearchParams(params)
  }

  function openCustomerReceiptDetail(receipt: CustomerReceiptState) {
    const params = new URLSearchParams(searchParams)
    params.set('view', 'receipts')
    params.set('side', 'ar')
    if (companyId) params.set('companyId', companyId)
    params.set('customerId', receipt.customer_id)
    params.set('receiptId', receipt.id)
    setReceiptCustomerFilter(receipt.customer_id)
    setReceiptCustomerId(receipt.customer_id)
    setActiveReceiptId(receipt.id)
    setSearchParams(params)
  }

  function closeCustomerReceiptDetail() {
    const params = new URLSearchParams(searchParams)
    params.delete('receiptId')
    setActiveReceiptId(null)
    setSearchParams(params, { replace: true })
  }

  function openCustomerReceiptDialog(customerId = '') {
    setReceiptCustomerId(customerId)
    setReceiptAmount('')
    setReceiptDate(todayISO())
    setReceiptMethod('cash')
    setReceiptBankId(banks[0]?.id || '')
    setReceiptExternalReference('')
    setReceiptNote('')
    setReceiptAllocationValues({})
    setReceiptStep(customerId ? 2 : 1)
    clearPostingRequestKey(customerReceiptPostingRequestRef)
    setReceiptDialogOpen(true)
  }

  function allocateOldestFirst() {
    const suggested = allocateCustomerReceiptOldestFirst(
      Number(receiptAmount),
      selectedCustomerExposures.map((exposure) => ({
        anchorId: exposure.anchor_id,
        dueDate: exposure.due_date,
        outstandingAmountBase: Number(exposure.outstanding_amount_base),
      })),
    )
    setReceiptAllocationValues(Object.fromEntries(
      suggested.map((allocation) => [allocation.salesInvoiceId, allocation.amountBase.toFixed(2)]),
    ))
  }

  async function submitCustomerReceipt() {
    if (!companyId || !canManageSettlement) return
    try {
      const fingerprint = stablePostingFingerprint({
        companyId,
        customerId: receiptCustomerId,
        receivedOn: receiptDate,
        amountReceived: normalizeReceiptMoney(Number(receiptAmount)),
        currencyCode: baseCode,
        paymentChannel: receiptMethod,
        bankAccountId: receiptMethod === 'bank' ? receiptBankId : null,
        externalReference: receiptExternalReference.trim() || null,
        note: receiptNote.trim() || null,
        allocations: receiptAllocationInputs,
      })
      const requestKey = getPostingRequestKeyForFingerprint(customerReceiptPostingRequestRef, fingerprint)
      const payload = buildCustomerReceiptPostingPayload({
        companyId,
        customerId: receiptCustomerId,
        receivedOn: receiptDate,
        amountReceived: Number(receiptAmount),
        currencyCode: baseCode,
        paymentChannel: receiptMethod,
        bankAccountId: receiptBankId,
        externalReference: receiptExternalReference,
        note: receiptNote,
        allocations: receiptAllocationInputs,
        requestKey,
      })
      setReceiptSaving(true)
      const { data, error } = await supabase.rpc('post_customer_receipt', payload)
      if (error) throw error
      const result = (Array.isArray(data) ? data[0] : data) as { replayed?: boolean } | null
      toast.success(result?.replayed
        ? tt('customerReceipts.replayed', 'The original receipt result was restored.')
        : tt('customerReceipts.posted', 'Customer receipt posted.'))
      setReceiptDialogOpen(false)
      clearPostingRequestKey(customerReceiptPostingRequestRef)
      updateReceiptCustomerQuery(receiptCustomerId)
      setRefreshKey((key) => key + 1)
    } catch (error: any) {
      console.error('[settlements] failed to post customer receipt', error)
      toast.error(customerReceiptErrorMessage(error, 'post'))
    } finally {
      setReceiptSaving(false)
    }
  }

  async function submitLaterAllocation() {
    if (!activeCustomerReceipt || !laterAllocationInvoiceId) return
    const amountBase = normalizeReceiptMoney(Number(laterAllocationAmount))
    if (!Number.isFinite(amountBase) || amountBase <= 0) {
      toast.error(tt('customerReceipts.allocationPositive', 'Enter an allocation greater than zero.'))
      return
    }
    const fingerprint = stablePostingFingerprint({
      receiptId: activeCustomerReceipt.id,
      salesInvoiceId: laterAllocationInvoiceId,
      amountBase,
    })
    const requestKey = getPostingRequestKeyForFingerprint(allocationRequestRef, fingerprint)
    setReceiptSaving(true)
    try {
      const { error } = await supabase.rpc('allocate_customer_receipt', {
        p_customer_receipt_id: activeCustomerReceipt.id,
        p_sales_invoice_id: laterAllocationInvoiceId,
        p_amount_base: amountBase,
        p_request_key: requestKey,
      })
      if (error) throw error
      toast.success(tt('customerReceipts.allocationPosted', 'Receipt credit allocated.'))
      setLaterAllocationInvoiceId('')
      setLaterAllocationAmount('')
      clearPostingRequestKey(allocationRequestRef)
      setRefreshKey((key) => key + 1)
    } catch (error: any) {
      console.error('[settlements] failed to allocate receipt credit', error)
      toast.error(customerReceiptErrorMessage(error, 'allocation'))
    } finally {
      setReceiptSaving(false)
    }
  }

  async function submitAllocationReversal() {
    if (!reversalAllocation || !reversalReason.trim()) return
    const fingerprint = stablePostingFingerprint({ allocationId: reversalAllocation.id, reason: reversalReason.trim() })
    const requestKey = getPostingRequestKeyForFingerprint(reversalRequestRef, fingerprint)
    setReceiptSaving(true)
    try {
      const { error } = await supabase.rpc('reverse_customer_receipt_allocation', {
        p_allocation_id: reversalAllocation.id,
        p_reason: reversalReason.trim(),
        p_request_key: requestKey,
      })
      if (error) throw error
      toast.success(tt('customerReceipts.reversalPosted', 'Allocation reversed. The receipt credit and invoice outstanding were restored.'))
      setReversalAllocation(null)
      setReversalReason('')
      clearPostingRequestKey(reversalRequestRef)
      setRefreshKey((key) => key + 1)
    } catch (error: any) {
      console.error('[settlements] failed to reverse receipt allocation', error)
      toast.error(customerReceiptErrorMessage(error, 'reversal'))
    } finally {
      setReceiptSaving(false)
    }
  }

  function openSettlement(row: SettlementRow, nextDialogTab: 'settle' | 'history' = 'settle') {
    setActiveRow(row)
    setDialogTab(nextDialogTab === 'settle' && !canManageSettlement ? 'history' : nextDialogTab)
    setSettleMethod('cash')
    setSettleAmount(row.outstandingBase.toFixed(2))
    setSettleDate(todayISO())
    setSettleMemo(buildSettlementMemo(row.kind, row.reference, {
      receive: tt('settlements.defaultReceiveMemo', 'Receipt for {orderNo}'),
      pay: tt('settlements.defaultPayMemo', 'Payment for {orderNo}'),
    }))
    setSettleBankId(banks[0]?.id || '')
  }

  async function submitSettlement() {
    if (!companyId || !activeRow) return
    if (!canManageSettlement) {
      toast.error(tt('financeDocs.approval.financeAuthorityRequired', 'Finance authority is required for legal-document issue, post, void, adjustment, and settlement actions.'))
      return
    }

    const amount = normalizeMoneyValue(n(settleAmount, Number.NaN))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tt('settlements.amountInvalid', 'Enter a settlement amount greater than zero'))
      return
    }
    if (amount > normalizeMoneyValue(activeRow.outstandingBase)) {
      toast.error(tt('settlements.amountTooHigh', 'Settlement amount cannot exceed the outstanding balance'))
      return
    }

    const requestFingerprint = stablePostingFingerprint({
      anchorId: activeRow.id,
      anchorType: activeRow.kind,
      amountBase: amount,
      bankId: settleMethod === 'bank' ? settleBankId : null,
      happenedAt: settleDate,
      memo: settleMemo.trim() || null,
      method: settleMethod,
    })
    const requestKey = getPostingRequestKeyForFingerprint(settlementPostingRequestRef, requestFingerprint)
    setSaving(true)

    try {
      type SettlementPostingResult = {
        transaction_id?: string
        replayed?: boolean
        amount_base?: number
      } | null
      let postingResult: SettlementPostingResult = null
      if (settleMethod === 'cash') {
        const { data, error } = await supabase.rpc('post_cash_settlement', {
          p_company_id: companyId,
          p_ref_type: activeRow.kind,
          p_ref_id: activeRow.id,
          p_happened_at: settleDate,
          p_amount_base: amount,
          p_memo: settleMemo.trim() || null,
          p_request_key: requestKey,
        })
        if (error) throw error
        postingResult = (Array.isArray(data) ? data[0] : data) as SettlementPostingResult
        if (postingResult?.replayed) {
          toast.success(tt('settlements.replaySaved', 'The earlier settlement was already posted. Its original result has been restored.'))
        }
      } else {
        if (!settleBankId) {
          toast.error(tt('settlements.bankRequired', 'Choose a bank account before posting a bank settlement'))
          return
        }

        const { data, error } = await supabase.rpc('post_bank_settlement', {
          p_company_id: companyId,
          p_bank_id: settleBankId,
          p_ref_type: activeRow.kind,
          p_ref_id: activeRow.id,
          p_happened_at: settleDate,
          p_amount_base: amount,
          p_memo: settleMemo.trim() || null,
          p_request_key: requestKey,
        })

        if (error) {
          const mappedMessage = getBankTransactionWriteMessage(error, tt)
          if (isMissingBankTransactionRefColumns(error)) {
            setBankTransactionRefSupport(false)
            setBankRefsSupported(false)
          }
          if (mappedMessage) {
            throw new Error(mappedMessage)
          }
          throw error
        }

        setBankTransactionRefSupport(true)
        setBankRefsSupported(true)
        postingResult = (Array.isArray(data) ? data[0] : data) as SettlementPostingResult
        if (postingResult?.replayed) {
          toast.success(tt('settlements.replaySaved', 'The earlier settlement was already posted. Its original result has been restored.'))
        }
      }

      const bank = settleMethod === 'bank' ? banks.find((item) => item.id === settleBankId) || null : null
      const anchorKind: FinanceActivityRow['anchorKind'] =
        activeRow.kind === 'SI'
          ? 'sales_invoice'
          : activeRow.kind === 'VB'
            ? 'vendor_bill'
            : activeRow.kind === 'SO'
              ? 'sales_order'
              : 'purchase_order'
      const transactionId = String(postingResult?.transaction_id || '')
      if (transactionId) {
        setLastSettlementResult({
          activity: {
            id: transactionId,
            ledgerSide: activeRow.kind === 'SO' || activeRow.kind === 'SI' ? 'AR' : 'AP',
            channel: settleMethod,
            happenedAt: settleDate,
            createdAt: new Date().toISOString(),
            amountBase: Number(postingResult?.amount_base || amount),
            memo: settleMemo.trim() || null,
            refType: activeRow.kind,
            refId: activeRow.id,
            anchorKind,
            anchorId: activeRow.id,
            anchorReference: activeRow.reference,
            operationalReference: isFinanceDocumentRow(activeRow) ? null : activeRow.reference,
            counterpartyName: activeRow.counterparty,
            documentDate: activeRow.documentDate,
            dueDate: activeRow.dueDate,
            originalLegalBase: activeRow.originalBase,
            creditedBase: activeRow.creditedBase,
            debitedBase: activeRow.debitedBase,
            currentLegalBase: activeRow.currentLegalBase,
            settledBase: normalizeMoneyValue(activeRow.settledBase + amount),
            outstandingBase: normalizeMoneyValue(Math.max(0, activeRow.outstandingBase - amount)),
            reviewState: null,
            bankId: bank?.id || null,
            bankName: bank?.name || null,
            bankInstitution: bank?.bank_name || null,
            maskedAccountNumber: maskFinanceAccountNumber(bank?.account_number),
            bankOperatingCurrency: bank?.currency_code || null,
            reconciled: settleMethod === 'bank' ? false : null,
            unresolvedReference: false,
          },
          outstandingAfter: normalizeMoneyValue(Math.max(0, activeRow.outstandingBase - amount)),
          replayed: Boolean(postingResult?.replayed),
        })
      }
      toast.success(activeRow.kind === 'SO' || activeRow.kind === 'SI'
        ? tt('settlements.receiptSaved', 'Receipt saved')
        : tt('settlements.paymentSaved', 'Payment saved'))
      setActiveRow(null)
      setDialogTab('settle')
      setSettleAmount('')
      setSettleMemo('')
      setSettleDate(todayISO())
      clearPostingRequestKey(settlementPostingRequestRef)
      setRefreshKey(key => key + 1)
    } catch (error: any) {
      console.error(error)
      const message = String(error?.message || '').toLowerCase()
      if (message.includes('request_key_required')) {
        toast.error(tt('settlements.requestKeyRequired', 'Refresh the settlement and try again with a valid posting key.'))
      } else if (message.includes('idempotency_key_payload_mismatch')) {
        toast.error(tt('settlements.payloadMismatch', 'This retry key belongs to different settlement inputs. Review the form and submit again.'))
      } else if (message.includes('request_in_progress')) {
        toast.error(tt('settlements.requestInProgress', 'This settlement is already being posted. Wait a moment and refresh.'))
      } else if (message.includes('settlement_amount_exceeds_outstanding')) {
        toast.error(tt('settlements.amountTooHigh', 'Settlement amount cannot exceed the outstanding balance'))
      } else if (message.includes('settlement_already_resolved')) {
        toast.error(tt('settlements.alreadyResolved', 'This settlement anchor is already fully resolved. Refresh the settlement workspace.'))
      } else if (message.includes('finance_document_became_active_anchor')) {
        toast.error(tt('settlements.financeAnchorChanged', 'A finance document is now the active settlement anchor. Refresh and post against that document.'))
      } else if (message.includes('settlement_anchor_not_ready') || message.includes('settlement_anchor_not_found')) {
        toast.error(tt('settlements.anchorStale', 'This settlement anchor is no longer ready. Refresh the settlement workspace.'))
      } else if (message.includes('insufficient_company_role')) {
        toast.error(tt('settlements.permissionDenied', 'You do not have permission to post settlements for this company.'))
      } else if (message.includes('company_access_disabled')) {
        toast.error(tt('settlements.companyAccessDisabled', 'Company access is disabled, so settlement posting is unavailable.'))
      } else if (message.includes('cross_company')) {
        toast.error(tt('settlements.companyAccessDenied', 'Switch to the correct company before posting this settlement.'))
      } else {
        toast.error(error?.message || tt('settlements.saveFailed', 'Failed to save settlement'))
      }
    } finally {
      setSaving(false)
    }
  }

  function viewOrder(row: SettlementRow) {
    if (row.kind === 'SI') {
      navigate(`/sales-invoices/${row.id}`)
      return
    }
    if (row.kind === 'VB') {
      navigate(`/vendor-bills/${row.id}`)
      return
    }
    navigate(`/orders?tab=${row.kind === 'SO' ? 'sales' : 'purchase'}&orderId=${row.id}`)
  }

  function viewReconciliationAnchor(anchorKind: FinanceReconciliationRow['anchor_kind'], anchorId: string) {
    if (anchorKind === 'sales_invoice' || anchorKind === 'sales_invoice_draft') {
      navigate(`/sales-invoices/${anchorId}`)
      return
    }
    if (anchorKind === 'vendor_bill') {
      navigate(`/vendor-bills/${anchorId}`)
      return
    }
    if (anchorKind === 'sales_order') {
      navigate(`/orders?tab=sales&orderId=${anchorId}`)
      return
    }
    if (anchorKind === 'purchase_order') {
      navigate(`/orders?tab=purchase&orderId=${anchorId}`)
    }
  }

  function activityAnchorKindLabel(anchorKind: FinanceActivityRow['anchorKind']) {
    if (anchorKind === 'sales_invoice' || anchorKind === 'sales_invoice_draft') return tt('nav.salesInvoices', 'Sales Invoices')
    if (anchorKind === 'vendor_bill') return tt('nav.vendorBills', 'Vendor Bills')
    if (anchorKind === 'sales_order') return tt('nav.salesOrders', 'Sales Orders')
    if (anchorKind === 'purchase_order') return tt('nav.purchaseOrders', 'Purchase Orders')
    return tt('financeUx.unresolvedReference', 'Unresolved reference')
  }

  const exportDialogLabels = {
    report: tt('financeUx.export.report', 'Report'),
    scope: tt('financeUx.export.scope', 'Scope'),
    period: tt('financeUx.export.period', 'Period'),
    recordCount: tt('financeUx.export.recordCount', 'Record count'),
    currencyBasis: tt('financeUx.export.currencyBasis', 'Currency basis'),
    language: tt('financeUx.export.language', 'Output language'),
    english: tt('financeUx.export.english', 'English'),
    portuguese: tt('financeUx.export.portuguese', 'Portuguese'),
    bilingual: tt('financeUx.export.bilingual', 'Bilingual'),
    downloadExcel: tt('financeUx.export.downloadExcel', 'Download Excel'),
    downloadPdf: tt('financeUx.export.downloadPdf', 'Download PDF'),
    print: tt('financeUx.export.print', 'Print'),
    cancel: tt('common.cancel', 'Cancel'),
    preparing: tt('financeUx.export.preparing', 'Preparing...'),
    failed: tt('financeUx.export.failed', 'The finance output could not be prepared. No partial file was downloaded.'),
  }

  const defaultExportLanguage: FinanceExportLanguage = lang === 'pt' ? 'pt' : 'en'
  const outputLabel = (language: FinanceExportLanguage, pt: string, en: string) =>
    language === 'bi' ? `${pt} / ${en}` : language === 'pt' ? pt : en

  const adviceTitle = (row: FinanceActivityRow, language: FinanceExportLanguage) => {
    if (language === 'bi') {
      return row.ledgerSide === 'AP'
        ? 'Aviso de pagamento / Remittance Advice'
        : 'Aviso de alocação do recebimento / Receipt Allocation Advice'
    }
    if (language === 'pt') {
      return row.ledgerSide === 'AP' ? 'Aviso de pagamento' : 'Aviso de alocação do recebimento'
    }
    return row.ledgerSide === 'AP' ? 'Remittance Advice' : 'Receipt Allocation Advice'
  }

  const adviceDisclaimer = (row: FinanceActivityRow, language: FinanceExportLanguage) => {
    const en = row.ledgerSide === 'AP'
      ? 'This remittance advice records the payment allocation in StockWise. It is not a bank-issued proof of transfer or confirmation that funds have cleared.'
      : 'This advice confirms how the receipt was allocated in StockWise. It is not a fiscal receipt or bank-issued confirmation.'
    const pt = row.ledgerSide === 'AP'
      ? 'Este aviso regista a alocação do pagamento no StockWise. Não constitui prova bancária de transferência nem confirmação de que os fundos foram compensados.'
      : 'Este aviso confirma como o recebimento foi alocado no StockWise. Não constitui recibo fiscal nem confirmação emitida pelo banco.'
    return language === 'bi' ? `${pt}\n${en}` : language === 'pt' ? pt : en
  }

  async function buildFinanceExportModel(
    request: FinanceExportRequest,
    language: FinanceExportLanguage,
  ): Promise<FinanceExportModel> {
    if (!companyId) throw new Error('finance_export_company_required')
    const company = await loadFinanceExportCompany(companyId)
    const dateStamp = todayISO()
    const generatedAt = new Date().toISOString()
    const sideLabel = workspaceSide === 'ar'
      ? (language === 'pt' ? 'Contas a receber' : 'Accounts receivable')
      : (language === 'pt' ? 'Contas a pagar' : 'Accounts payable')

    if (request.kind === 'advice') {
      const row = request.activity
      if (!row.anchorKind || !row.anchorId || row.unresolvedReference) throw new Error('finance_export_counterparty_unresolved')
      const [counterparty, details] = await Promise.all([
        loadFinanceExportCounterparty({
          companyId,
          ledgerSide: row.ledgerSide,
          anchorKind: row.anchorKind,
          anchorId: row.anchorId,
          fallbackName: row.counterpartyName,
        }),
        loadFinanceAdviceDocumentDetails(companyId, row.anchorKind, row.anchorId),
      ])
      if (!counterparty?.name) throw new Error('finance_export_counterparty_unresolved')
      const title = adviceTitle(row, language)
      const method = row.channel === 'bank'
        ? outputLabel(language, 'Banco', 'Bank')
        : outputLabel(language, 'Livro de caixa', 'Cash Book')
      const methodLabel = row.ledgerSide === 'AP'
        ? outputLabel(language, 'Método de pagamento', 'Payment method')
        : outputLabel(language, 'Método de recebimento', 'Receipt method')
      const allocationLabel = row.ledgerSide === 'AP'
        ? outputLabel(language, 'Alocação do pagamento', 'Payment allocation')
        : outputLabel(language, 'Alocação do recebimento', 'Receipt allocation')
      const reconciliationStatus = row.reconciled == null
        ? outputLabel(language, 'Não aplicável ao livro de caixa', 'Not applicable to Cash Book')
        : row.reconciled
          ? outputLabel(language, 'Reconciliado', 'Reconciled')
          : outputLabel(language, 'Não reconciliado', 'Unreconciled')
      const filenameParty = counterparty.code || counterparty.name
      return {
        filename: `StockWise_${row.ledgerSide === 'AP' ? 'Remittance' : 'Receipt_Allocation'}_${filenameParty}_${dateStamp}`,
        orientation: 'portrait',
        context: {
          title,
          subtitle: outputLabel(language, 'Registado no StockWise', 'Recorded in StockWise'),
          language,
          generatedAt,
          generatedBy: user?.name || null,
          company,
          counterparty,
          bank: row.channel === 'bank'
            ? {
              name: row.bankName || (language === 'pt' ? 'Conta bancária' : 'Bank account'),
              bankName: row.bankInstitution,
              maskedAccountNumber: row.maskedAccountNumber,
              operatingCurrency: row.bankOperatingCurrency,
            }
            : null,
          period: { from: row.happenedAt, to: row.happenedAt },
          filters: [
            `${methodLabel}: ${method}`,
            `${outputLabel(language, 'Estado de reconciliação', 'Reconciliation status')}: ${reconciliationStatus}`,
          ],
          baseCurrency: baseCode,
          disclaimer: adviceDisclaimer(row, language),
        },
        summary: [
          { label: outputLabel(language, 'Data', 'Date'), value: row.happenedAt },
          { label: methodLabel, value: method },
          { label: outputLabel(language, 'Valor registado', 'Recorded amount'), value: row.amountBase, type: 'currency' },
        ],
        sections: [
          {
            title: outputLabel(language, 'Documento', 'Document'),
            columns: [
              { key: 'external', label: row.ledgerSide === 'AP' ? outputLabel(language, 'Referência da factura do fornecedor', 'Supplier invoice reference') : outputLabel(language, 'Referência da factura de venda', 'Sales Invoice reference'), width: 22 },
              { key: 'finance', label: outputLabel(language, 'Referência StockWise', 'StockWise reference'), width: 20 },
              { key: 'operational', label: outputLabel(language, 'Referência operacional', 'Operational reference'), width: 20 },
              { key: 'date', label: outputLabel(language, 'Data do documento', 'Document date'), type: 'date', width: 14 },
              { key: 'due', label: outputLabel(language, 'Vencimento', 'Due date'), type: 'date', width: 14 },
            ],
            rows: [{
              external: details.externalReference || '—',
              finance: details.primaryReference || row.anchorReference || '—',
              operational: details.operationalReference || row.operationalReference || '—',
              date: details.documentDate || row.documentDate || '—',
              due: details.dueDate || row.dueDate || '—',
            }],
          },
          {
            title: allocationLabel,
            columns: [
              { key: 'original', label: outputLabel(language, 'Valor legal original', 'Original legal amount'), type: 'currency', width: 18 },
              { key: 'credits', label: outputLabel(language, 'Créditos', 'Credits'), type: 'currency', width: 15 },
              { key: 'debits', label: outputLabel(language, 'Débitos', 'Debits'), type: 'currency', width: 15 },
              { key: 'legal', label: outputLabel(language, 'Valor legal actual', 'Current legal amount'), type: 'currency', width: 18 },
              { key: 'allocated', label: allocationLabel, type: 'currency', width: 18 },
              { key: 'outstanding', label: outputLabel(language, 'Em aberto actualmente', 'Current outstanding'), type: 'currency', width: 18 },
            ],
            rows: [{
              original: row.originalLegalBase,
              credits: row.creditedBase,
              debits: row.debitedBase,
              legal: row.currentLegalBase,
              allocated: row.amountBase,
              outstanding: row.outstandingBase,
            }],
            totals: [{
              legal: outputLabel(language, 'Total', 'Total'),
              allocated: row.amountBase,
            }],
          },
        ],
      }
    }

    if (request.kind === 'activity') {
      const title = language === 'pt'
        ? `Actividade de liquidação — ${sideLabel}`
        : `Settlement Activity — ${sideLabel}`
      return {
        filename: `StockWise_${workspaceSide.toUpperCase()}_Settlement_Activity_${dateStamp}`,
        orientation: 'landscape',
        context: {
          title,
          language,
          generatedAt,
          generatedBy: user?.name || null,
          company,
          counterpartyScope: language === 'pt' ? 'Múltiplas contrapartes' : 'Multiple counterparties',
          period: { from: activityFrom, to: activityTo },
          filters: [
            activityMethod === 'all'
              ? (language === 'pt' ? 'Todos os métodos' : 'All methods')
              : activityMethod === 'cash'
                ? (language === 'pt' ? 'Livro de caixa' : 'Cash Book')
                : (language === 'pt' ? 'Banco' : 'Bank'),
          ],
          baseCurrency: baseCode,
        },
        summary: [
          { label: language === 'pt' ? 'Registos' : 'Records', value: filteredActivityRows.length, type: 'number' },
          { label: language === 'pt' ? 'Valor total' : 'Total amount', value: activityTotal, type: 'currency' },
        ],
        sections: [{
          title,
          columns: [
            { key: 'date', label: language === 'pt' ? 'Data' : 'Date', type: 'date', width: 13 },
            { key: 'side', label: language === 'pt' ? 'Lado' : 'Side', width: 8 },
            { key: 'method', label: language === 'pt' ? 'Método' : 'Method', width: 12 },
            { key: 'source', label: language === 'pt' ? 'Origem' : 'Source', width: 18 },
            { key: 'counterparty', label: language === 'pt' ? 'Contraparte' : 'Counterparty', width: 24 },
            { key: 'anchor', label: language === 'pt' ? 'Documento principal' : 'Active anchor', width: 20 },
            { key: 'operational', label: language === 'pt' ? 'Referência operacional' : 'Operational reference', width: 20 },
            { key: 'memo', label: language === 'pt' ? 'Memorando' : 'Memo', width: 28 },
            { key: 'amount', label: language === 'pt' ? 'Valor base' : 'Base amount', type: 'currency', width: 16 },
            { key: 'reconciled', label: language === 'pt' ? 'Reconciliação' : 'Reconciliation', width: 16 },
          ],
          rows: filteredActivityRows.map((row) => ({
            date: row.happenedAt,
            side: row.ledgerSide,
            method: row.channel === 'bank' ? (language === 'pt' ? 'Banco' : 'Bank') : (language === 'pt' ? 'Caixa' : 'Cash'),
            source: row.bankName || (language === 'pt' ? 'Livro de caixa' : 'Cash Book'),
            counterparty: row.counterpartyName || (language === 'pt' ? 'Contraparte não resolvida' : 'Unresolved counterparty'),
            anchor: row.anchorReference || (language === 'pt' ? 'Referência não resolvida' : 'Unresolved reference'),
            operational: row.operationalReference || '—',
            memo: row.memo || '—',
            amount: row.amountBase,
            reconciled: row.reconciled == null
              ? '—'
              : row.reconciled
                ? (language === 'pt' ? 'Reconciliado' : 'Reconciled')
                : (language === 'pt' ? 'Não reconciliado' : 'Unreconciled'),
          })),
          totals: [{ memo: language === 'pt' ? 'Total' : 'Total', amount: activityTotal }],
        }],
      }
    }

    if (request.kind === 'reconciliation') {
      const partyNames = Array.from(new Set(filteredReviewRows.map((row) => row.counterparty_name).filter(Boolean)))
      const singleParty = partyNames.length === 1 ? partyNames[0] : null
      const title = singleParty
        ? workspaceSide === 'ar'
          ? language === 'pt' ? 'Relatório de reconciliação do cliente' : 'Customer Reconciliation Report'
          : language === 'pt' ? 'Relatório de reconciliação do fornecedor' : 'Supplier Reconciliation Report'
        : language === 'pt'
          ? `Reconciliação — ${sideLabel}`
          : `${sideLabel} Reconciliation`
      const counterparty = singleParty && filteredReviewRows[0]
        ? await loadFinanceExportCounterparty({
          companyId,
          ledgerSide: filteredReviewRows[0].ledger_side,
          anchorKind: filteredReviewRows[0].anchor_kind,
          anchorId: filteredReviewRows[0].anchor_id,
          fallbackName: singleParty,
        })
        : null
      return {
        filename: singleParty
          ? `StockWise_${workspaceSide.toUpperCase()}_Reconciliation_${singleParty}_${dateStamp}`
          : `StockWise_${workspaceSide.toUpperCase()}_Reconciliation_${dateStamp}`,
        orientation: 'landscape',
        context: {
          title,
          language,
          generatedAt,
          generatedBy: user?.name || null,
          company,
          counterparty,
          counterpartyScope: counterparty
            ? null
            : singleParty
              ? language === 'pt'
                ? `Contraparte não resolvida: ${singleParty}`
                : `Unresolved counterparty: ${singleParty}`
              : language === 'pt'
                ? `Múltiplos ${workspaceSide === 'ar' ? 'clientes' : 'fornecedores'}`
                : `Multiple ${workspaceSide === 'ar' ? 'customers' : 'suppliers'}`,
          period: { from: reviewFromDate || null, to: reviewToDate || null },
          filters: [
            reviewPartyFilter !== 'ALL' ? reviewPartyFilter : '',
            reviewDueFilter !== 'all' ? duePositionLabel(reviewDueFilter as FinanceReconciliationRow['due_position']) : '',
            reviewStateFilter !== 'all' ? reviewStateLabel(reviewStateFilter) : '',
          ].filter(Boolean),
          baseCurrency: baseCode,
        },
        summary: [
          { label: language === 'pt' ? 'Documentos' : 'Documents', value: filteredReviewRows.length, type: 'number' },
          { label: language === 'pt' ? 'Valor original' : 'Original total', value: reviewTotals.original, type: 'currency' },
          { label: language === 'pt' ? 'Ajustamentos líquidos' : 'Net adjustments', value: reviewTotals.netAdjustments, type: 'currency' },
          { label: language === 'pt' ? 'Valor legal actual' : 'Current legal amount', value: reviewTotals.currentLegal, type: 'currency' },
          { label: language === 'pt' ? 'Liquidado' : 'Settled', value: reviewTotals.settled, type: 'currency' },
          { label: language === 'pt' ? 'Em aberto' : 'Outstanding', value: reviewTotals.outstanding, type: 'currency' },
          { label: language === 'pt' ? 'Liquidado em excesso' : 'Over-settled', value: reviewTotals.overSettled, type: 'currency' },
          { label: language === 'pt' ? 'Documentos vencidos' : 'Overdue documents', value: reviewTotals.overdueCount, type: 'number' },
          { label: language === 'pt' ? 'Necessitam revisão' : 'Needs review', value: reviewTotals.reviewCount, type: 'number' },
          { label: language === 'pt' ? 'Excepções' : 'Exceptions', value: reviewTotals.exceptionCount, type: 'number' },
        ],
        sections: [
          {
            title: language === 'pt' ? 'Documentos' : 'Documents',
            columns: [
              { key: 'anchor', label: language === 'pt' ? 'Documento principal' : 'Active anchor', width: 20 },
              { key: 'operational', label: language === 'pt' ? 'Referência operacional' : 'Operational reference', width: 20 },
              { key: 'counterparty', label: language === 'pt' ? 'Contraparte' : 'Counterparty', width: 24 },
              { key: 'date', label: language === 'pt' ? 'Data' : 'Date', type: 'date', width: 13 },
              { key: 'due', label: language === 'pt' ? 'Vencimento' : 'Due date', type: 'date', width: 13 },
              { key: 'original', label: language === 'pt' ? 'Original' : 'Original', type: 'currency', width: 16 },
              { key: 'credits', label: language === 'pt' ? 'Créditos' : 'Credits', type: 'currency', width: 16 },
              { key: 'debits', label: language === 'pt' ? 'Débitos' : 'Debits', type: 'currency', width: 16 },
              { key: 'legal', label: language === 'pt' ? 'Valor legal actual' : 'Current legal', type: 'currency', width: 17 },
              { key: 'settled', label: language === 'pt' ? 'Liquidado' : 'Settled', type: 'currency', width: 16 },
              { key: 'rawOutstanding', label: language === 'pt' ? 'Em aberto bruto' : 'Raw outstanding', type: 'currency', width: 16 },
              { key: 'outstanding', label: language === 'pt' ? 'Em aberto' : 'Outstanding', type: 'currency', width: 16 },
              { key: 'overSettled', label: language === 'pt' ? 'Liquidado em excesso' : 'Over-settled', type: 'currency', width: 16 },
              { key: 'duePosition', label: language === 'pt' ? 'Posição de vencimento' : 'Due position', width: 16 },
              { key: 'aging', label: language === 'pt' ? 'Antiguidade' : 'Aging', width: 16 },
              { key: 'review', label: language === 'pt' ? 'Revisão' : 'Review state', width: 16 },
              { key: 'exceptions', label: language === 'pt' ? 'Excepções' : 'Exceptions', width: 28 },
            ],
            rows: filteredReviewRows.map((row) => ({
              anchor: row.anchor_reference,
              operational: row.operational_reference || '—',
              counterparty: row.counterparty_name || (language === 'pt' ? 'Não resolvida' : 'Unresolved'),
              date: row.document_date || '—',
              due: row.due_date || '—',
              original: Number(row.original_total_base || 0),
              credits: Number(row.credited_total_base || 0),
              debits: Number(row.debited_total_base || 0),
              legal: Number(row.current_legal_total_base || 0),
              settled: Number(row.settled_base || 0),
              rawOutstanding: Number(row.raw_outstanding_base || 0),
              outstanding: Number(row.outstanding_base || 0),
              overSettled: Number(row.over_settled_base || 0),
              duePosition: duePositionLabel(row.due_position),
              aging: agingBucketLabel(row.aging_bucket),
              review: reviewStateLabel(row.review_state),
              exceptions: (row.exception_codes || []).map(exceptionLabel).join('; ') || '—',
            })),
            totals: [{
              counterparty: language === 'pt' ? 'Total' : 'Total',
              original: reviewTotals.original,
              credits: filteredReviewRows.reduce((sum, row) => sum + n(row.credited_total_base), 0),
              debits: filteredReviewRows.reduce((sum, row) => sum + n(row.debited_total_base), 0),
              legal: reviewTotals.currentLegal,
              settled: reviewTotals.settled,
              rawOutstanding: filteredReviewRows.reduce((sum, row) => sum + n(row.raw_outstanding_base), 0),
              outstanding: reviewTotals.outstanding,
              overSettled: reviewTotals.overSettled,
            }],
          },
          {
            title: language === 'pt' ? 'Excepções' : 'Exceptions',
            columns: [
              { key: 'anchor', label: language === 'pt' ? 'Documento principal' : 'Active anchor', width: 20 },
              { key: 'counterparty', label: language === 'pt' ? 'Contraparte' : 'Counterparty', width: 24 },
              { key: 'severity', label: language === 'pt' ? 'Severidade' : 'Severity', width: 14 },
              { key: 'group', label: language === 'pt' ? 'Grupo' : 'Group', width: 18 },
              { key: 'exception', label: language === 'pt' ? 'Excepção' : 'Exception', width: 36 },
              { key: 'outstanding', label: language === 'pt' ? 'Em aberto' : 'Outstanding', type: 'currency', width: 16 },
            ],
            rows: filteredReviewExceptions.map((row) => ({
              anchor: row.anchor_reference,
              counterparty: row.counterparty_name || (language === 'pt' ? 'Não resolvida' : 'Unresolved'),
              severity: row.severity === 'critical'
                ? (language === 'pt' ? 'Crítica' : 'Critical')
                : (language === 'pt' ? 'Aviso' : 'Warning'),
              group: exceptionGroupLabel(row.exception_group),
              exception: exceptionLabel(row.exception_code),
              outstanding: Number(row.outstanding_base || 0),
            })),
          },
        ],
      }
    }

    const title = language === 'pt'
      ? `Saldos em aberto — ${sideLabel}`
      : `${sideLabel} Exposure`
    return {
      filename: `StockWise_${workspaceSide.toUpperCase()}_Exposure_${dateStamp}`,
      orientation: 'landscape',
      context: {
        title,
        language,
        generatedAt,
        generatedBy: user?.name || null,
        company,
        counterpartyScope: language === 'pt' ? 'Múltiplas contrapartes' : 'Multiple counterparties',
        period: { from: fromDate || null, to: toDate || null },
        filters: [partyFilter !== 'ALL' ? partyFilter : '', dueFilter !== 'all' ? dueFilter : ''].filter(Boolean),
        baseCurrency: baseCode,
      },
      summary: [
        { label: language === 'pt' ? 'Documentos' : 'Documents', value: filteredRows.length, type: 'number' },
        { label: language === 'pt' ? 'Valor legal actual' : 'Current legal amount', value: filteredBridgeTotals.currentLegalBase, type: 'currency' },
        { label: language === 'pt' ? 'Liquidado' : 'Settled', value: filteredBridgeTotals.settledBase, type: 'currency' },
        { label: language === 'pt' ? 'Em aberto' : 'Outstanding', value: filteredBridgeTotals.outstandingBase, type: 'currency' },
      ],
      sections: [{
        title,
        columns: [
          { key: 'counterparty', label: language === 'pt' ? 'Contraparte' : 'Counterparty', width: 24 },
          { key: 'anchor', label: language === 'pt' ? 'Documento principal' : 'Active anchor', width: 20 },
          { key: 'anchorType', label: language === 'pt' ? 'Tipo de documento' : 'Anchor type', width: 18 },
          { key: 'date', label: language === 'pt' ? 'Data' : 'Date', type: 'date', width: 13 },
          { key: 'due', label: language === 'pt' ? 'Vencimento' : 'Due date', type: 'date', width: 13 },
          { key: 'legal', label: language === 'pt' ? 'Valor legal actual' : 'Current legal', type: 'currency', width: 17 },
          { key: 'settled', label: language === 'pt' ? 'Liquidado' : 'Settled', type: 'currency', width: 16 },
          { key: 'outstanding', label: language === 'pt' ? 'Em aberto' : 'Outstanding', type: 'currency', width: 16 },
          { key: 'aging', label: language === 'pt' ? 'Antiguidade' : 'Aging', width: 16 },
          { key: 'workflow', label: language === 'pt' ? 'Fluxo' : 'Workflow', width: 18 },
        ],
        rows: filteredRows.map((row) => ({
          counterparty: row.counterparty,
          anchor: row.reference,
          anchorType: isFinanceDocumentRow(row)
            ? (language === 'pt' ? 'Documento financeiro' : 'Finance document')
            : (language === 'pt' ? 'Encomenda operacional' : 'Operational order'),
          date: row.documentDate || '—',
          due: row.dueDate || '—',
          legal: row.currentLegalBase,
          settled: row.settledBase,
          outstanding: row.outstandingBase,
          aging: row.agingDays > 0 ? `${row.agingDays}d` : '—',
          workflow: row.workflowLabel,
        })),
        totals: [{
          counterparty: language === 'pt' ? 'Total' : 'Total',
          legal: filteredBridgeTotals.currentLegalBase,
          settled: filteredBridgeTotals.settledBase,
          outstanding: filteredBridgeTotals.outstandingBase,
        }],
      }],
    }
  }

  async function generateFinanceExport(format: FinanceExportFormat, language: FinanceExportLanguage) {
    if (!exportRequest) return
    const model = await buildFinanceExportModel(exportRequest, language)
    if (format === 'excel') await exportFinanceExcel(model)
    else if (format === 'pdf') await exportFinancePdf(model)
    else await printFinanceReport(model)
  }

  const exportDialogMeta = useMemo(() => {
    if (!exportRequest) return null
    if (exportRequest.kind === 'advice') {
      const row = exportRequest.activity
      return {
        title: adviceTitle(row, defaultExportLanguage),
        scope: row.counterpartyName || tt('financeUx.unresolvedCounterparty', 'Unresolved counterparty'),
        period: row.happenedAt,
        recordCount: 1,
        allowBilingual: true,
      }
    }
    if (exportRequest.kind === 'activity') {
      return {
        title: tt('financeUx.activityExportTitle', 'Export settlement activity'),
        scope: workspaceSide === 'ar' ? tt('financeUx.receivables', 'Accounts receivable') : tt('financeUx.payables', 'Accounts payable'),
        period: `${activityFrom} — ${activityTo}`,
        recordCount: filteredActivityRows.length,
        allowBilingual: false,
      }
    }
    if (exportRequest.kind === 'reconciliation') {
      return {
        title: workspaceSide === 'ar' ? tt('financeUx.exportArReconciliation', 'Export current AR reconciliation') : tt('financeUx.exportApReconciliation', 'Export current AP reconciliation'),
        scope: reviewPartyFilter === 'ALL' ? tt('financeUx.currentFilteredView', 'Current filtered view') : reviewPartyFilter,
        period: reviewFromDate || reviewToDate ? `${reviewFromDate || '—'} — ${reviewToDate || '—'}` : null,
        recordCount: filteredReviewRows.length,
        allowBilingual: false,
      }
    }
    return {
      title: workspaceSide === 'ar' ? tt('financeUx.exportArExposure', 'Export current AR exposure') : tt('financeUx.exportApExposure', 'Export current AP exposure'),
      scope: partyFilter === 'ALL' ? tt('financeUx.currentFilteredView', 'Current filtered view') : partyFilter,
      period: fromDate || toDate ? `${fromDate || '—'} — ${toDate || '—'}` : null,
      recordCount: filteredRows.length,
      allowBilingual: false,
    }
  }, [
    activityFrom,
    activityTo,
    defaultExportLanguage,
    exportRequest,
    filteredActivityRows.length,
    filteredReviewRows.length,
    filteredRows.length,
    fromDate,
    partyFilter,
    reviewFromDate,
    reviewPartyFilter,
    reviewToDate,
    toDate,
    workspaceSide,
  ])

  const activeHistory = activeRow?.history || []

  return (
    <div className="app-page app-page--workspace space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('settlements.title', 'Receivables & Payables')}</h1>
            <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
              {tt('settlements.subtitle', 'Track receivables and payables from the current settlement truth. Orders remain temporary placeholders only until a sales invoice or vendor bill becomes the anchor.')}
            </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="w-fit text-sm text-muted-foreground">
            {companyName || tt('company.selectCompany', 'Select company')}
          </span>
          {canManageSettlement ? (
            <Button onClick={() => openCustomerReceiptDialog(searchParams.get('customerId') || '')}>
              <ReceiptText className="h-4 w-4" />
              {tt('customerReceipts.receivePayment', 'Receive payment')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="border-l-2 border-status-info-border bg-status-info-muted px-4 py-3 text-sm text-status-info-foreground">
        <p className="font-medium">{tt('settlements.transitionTitle', 'Settlement anchor policy')}</p>
        <p className="mt-1 hidden leading-6 sm:block">
          {tt(
            'settlements.transitionNote',
            'Approved orders can hold temporary settlement exposure only until the finance document exists. Once a sales invoice is issued or a vendor bill is posted, the finance document becomes the single settlement anchor and prior cash links are reassociated there.',
          )}
        </p>
      </div>

      {!canManageSettlement ? (
        <div className="border-l-2 border-status-info-border bg-status-info-muted px-4 py-3 text-sm text-status-info-foreground">
          {tt('settlements.financeAuthorityNotice', 'Settlement history remains visible, but only finance-authority users can post settlement entries from this workspace.')}
        </div>
      ) : null}

      {lastSettlementResult ? (
        <section
          className="border border-status-success-border bg-status-success-muted p-4 sm:p-5"
          role="status"
          aria-live="polite"
          tabIndex={-1}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="premium-label text-status-success-foreground">
                {lastSettlementResult.activity.ledgerSide === 'AR'
                  ? tt('financeUx.receiptRecorded', 'Receipt recorded')
                  : tt('financeUx.paymentRecorded', 'Payment recorded')}
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight">{lastSettlementResult.activity.counterpartyName}</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{tt('financeUx.activeAnchor', 'Active financial anchor')}</dt>
                  <dd className="font-medium">{lastSettlementResult.activity.anchorReference}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tt('table.date', 'Date')}</dt>
                  <dd className="font-medium">{lastSettlementResult.activity.happenedAt}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tt('financeUx.method', 'Method')}</dt>
                  <dd className="font-medium">{lastSettlementResult.activity.channel === 'bank' ? lastSettlementResult.activity.bankName : tt('financeUx.cashBook', 'Cash Book')}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tt('financeUx.amountBase', 'Amount in company base currency')}</dt>
                  <dd className="font-mono font-semibold tabular-nums">{money(lastSettlementResult.activity.amountBase)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tt('financeUx.outstandingAfter', 'Outstanding after posting')}</dt>
                  <dd className="font-mono font-semibold tabular-nums">{money(lastSettlementResult.outstandingAfter)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{tt('financeUx.replayStatus', 'Replay status')}</dt>
                  <dd className="font-medium">{lastSettlementResult.replayed ? tt('financeUx.replayed', 'Restored idempotent result') : tt('financeUx.newPosting', 'New posting')}</dd>
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setExportRequest({ kind: 'advice', activity: lastSettlementResult.activity })}>
                <Download className="h-4 w-4" />
                {lastSettlementResult.activity.ledgerSide === 'AP'
                  ? tt('financeUx.remittanceAdvice', 'Remittance Advice')
                  : tt('financeUx.receiptAdvice', 'Receipt Allocation Advice')}
              </Button>
              <Button variant="outline" onClick={() => updateWorkspaceQuery({
                view: 'activity',
                side: lastSettlementResult.activity.ledgerSide === 'AR' ? 'ar' : 'ap',
              })}>
                {tt('financeUx.openActivity', 'Open Activity')}
              </Button>
              {lastSettlementResult.activity.anchorKind ? (
                <Button onClick={() => viewReconciliationAnchor(lastSettlementResult.activity.anchorKind!, lastSettlementResult.activity.anchorId || lastSettlementResult.activity.refId)}>
                  {tt('financeUx.viewAnchor', 'View anchor')}
                </Button>
              ) : null}
            </div>
          </div>
          {lastSettlementResult.activity.ledgerSide === 'AR' ? (
            <div className="mt-4"><ReceiptActions settlementId={lastSettlementResult.activity.id} compact /></div>
          ) : null}
        </section>
      ) : null}

      <Tabs value={workspaceView} onValueChange={(value) => updateWorkspaceQuery({ view: value as FinanceWorkspaceView })} className="space-y-6">
        <div className="border-y border-border py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {tt('financeUx.workspaceTitle', 'Exposure, settlement activity, and reconciliation')}
                </h2>
                <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
                  {tt(
                    'settlements.workspaceHelp',
                    'Review open exposure, retain posted receipt and payment evidence, and investigate reconciliation exceptions without duplicating the active finance anchor.',
                  )}
                </p>
              </div>
            </div>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl bg-muted/70 p-1 sm:grid-cols-4 lg:w-auto">
              <TabsTrigger value="exposure" className="min-w-0 rounded-xl lg:min-w-[150px]">
                {tt('financeUx.exposure', 'Exposure')}
              </TabsTrigger>
              <TabsTrigger value="receipts" className="min-w-0 rounded-xl lg:min-w-[150px]">
                {tt('customerReceipts.title', 'Customer receipts')}
              </TabsTrigger>
              <TabsTrigger value="activity" className="min-w-0 rounded-xl lg:min-w-[170px]">
                {tt('financeUx.activity', 'Settlement activity')}
              </TabsTrigger>
              <TabsTrigger value="reconciliation" className="min-w-0 rounded-xl lg:min-w-[150px]">
                {tt('financeUx.reconciliation', 'Reconciliation')}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="exposure" className="mt-0 space-y-6">
      <FinanceSummaryBand
        label={tt('financeUx.exposureSummary', 'Exposure summary')}
        items={[
          {
            label: tt('settlements.pendingReceive', 'Pending to receive'),
            value: loading ? tt('common.loading', 'Loading...') : stateViewsUnavailable ? tt('common.unavailable', 'Unavailable') : money(receiveTotal),
            detail: stateViewsUnavailable ? tt('settlements.stateViewsUnavailable', 'Settlement evidence is unavailable. Refresh the page or contact support if the problem continues.') : tt('settlements.pendingReceiveHelp', '{count} receivable anchors are open across sales orders awaiting issue and issued sales invoices.', { count: rows.receive.length }),
          },
          {
            label: tt('settlements.pendingPay', 'Pending to pay'),
            value: loading ? tt('common.loading', 'Loading...') : stateViewsUnavailable ? tt('common.unavailable', 'Unavailable') : money(payTotal),
            detail: stateViewsUnavailable ? tt('settlements.stateViewsUnavailable', 'Settlement evidence is unavailable. Refresh the page or contact support if the problem continues.') : tt('settlements.pendingPayHelp', '{count} payable anchors are open across purchase orders awaiting booking and posted vendor bills.', { count: rows.pay.length }),
          },
          {
            label: tt('settlements.overdue', 'Overdue balances'),
            value: loading ? tt('common.loading', 'Loading...') : stateViewsUnavailable ? tt('common.unavailable', 'Unavailable') : overdueCount,
            detail: stateViewsUnavailable ? tt('settlements.stateViewsUnavailable', 'Settlement evidence is unavailable. Refresh the page or contact support if the problem continues.') : tt('settlements.overdueHelp', 'Overdue rows are ranked using the due date of the active settlement anchor, whether that anchor is still an order or already a finance document.'),
            tone: overdueCount > 0 && !loading && !stateViewsUnavailable ? 'warning' : 'neutral',
          },
        ]}
      />

      {requestedExposureCustomer ? (
        <section
          className="border-l-2 border-status-info-border bg-status-info-muted px-4 py-4"
          aria-labelledby="alert-receivables-context-title"
          data-testid="alert-receivables-context"
        >
          <h3 id="alert-receivables-context-title" className="font-semibold">
            {tt('customerReceipts.exposureForCustomer', 'Receivables for {customer}', { customer: requestedExposureCustomer.name })}
          </h3>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{tt('customerReceipts.totalOpenReceivables', 'Total open receivables')}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(requestedExposureOutstanding)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{tt('customerReceipts.allocatableInvoiceOutstanding', 'Allocatable issued-invoice outstanding')}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(requestedExposureInvoiceOutstanding)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{tt('customerReceipts.unappliedCreditContext', 'Unapplied credit (separate)')}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(Number(requestedExposureUnapplied?.unapplied_credit_base || 0))}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            {tt('customerReceipts.exposureAnchorHelp', 'The table below includes Sales Order and Sales Invoice anchors. Only issued Sales Invoices can receive allocations; unapplied credit is not silently netted.')}
          </p>
        </section>
      ) : null}

      <Card className="border-border/80 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle>{tt('settlements.filters', 'Filters')}</CardTitle>
          <CardDescription className="hidden sm:block">{tt('settlements.filtersHelp', 'Filter by counterparty, anchor type, workflow, anchor date, or due state without leaving the active company context.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(value) => updateWorkspaceQuery({ side: value === 'receive' ? 'ar' : 'ap' })}>
            <TabsList className="h-auto w-full justify-start gap-1 rounded-xl bg-muted/70 p-1 md:w-auto">
              <TabsTrigger value="receive" className="min-w-[180px] rounded-lg">{tt('settlements.pendingReceive', 'Pending to receive')}</TabsTrigger>
              <TabsTrigger value="pay" className="min-w-[180px] rounded-lg">{tt('settlements.pendingPay', 'Pending to pay')}</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <div className="xl:col-span-2">
                  <Label>{tt('common.search', 'Search')}</Label>
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tt('settlements.searchPlaceholder', 'Reference, counterparty, anchor type, or workflow status')} />
                </div>
                <div>
                  <Label>{tt('settlements.counterparty', 'Counterparty')}</Label>
                  <Select value={partyFilter} onValueChange={setPartyFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                      {partyOptions.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('settlements.workflowStatus', 'Order workflow')}</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                      {Array.from(new Map(currentRows.map(row => [row.workflowStatus, row.workflowLabel])).entries()).sort((left, right) => left[1].localeCompare(right[1])).map(([option, label]) => (
                        <SelectItem key={option} value={option}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('orders.currency', 'Currency')}</Label>
                  <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                      {currencyOptions.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('settlements.dueState', 'Due state')}</Label>
                  <Select value={dueFilter} onValueChange={(value) => setDueFilter(value as typeof dueFilter)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                      <SelectItem value="overdue">{tt('settlements.overdue', 'Overdue')}</SelectItem>
                      <SelectItem value="due_soon">{tt('settlements.dueSoon', 'Due soon')}</SelectItem>
                      <SelectItem value="current">{tt('settlements.current', 'Current')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <Label>{tt('filters.from', 'From')}</Label>
                  <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                </div>
                <div>
                  <Label>{tt('filters.to', 'To')}</Label>
                  <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full sm:w-auto"
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setPartyFilter('ALL')
                      setStatusFilter('ALL')
                      setCurrencyFilter('ALL')
                      setDueFilter('all')
                      setFromDate('')
                      setToDate('')
                    }}
                  >
                    {tt('common.clear', 'Clear')}
                  </Button>
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full sm:w-auto"
                    variant="outline"
                    onClick={() => setExportRequest({ kind: 'exposure' })}
                    disabled={loading || stateViewsUnavailable}
                  >
                    <Download className="h-4 w-4" />
                    {workspaceSide === 'ar'
                      ? tt('financeUx.exportArExposure', 'Export current AR exposure')
                      : tt('financeUx.exportApExposure', 'Export current AP exposure')}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>{tab === 'receive' ? tt('settlements.pendingReceive', 'Pending to receive') : tt('settlements.pendingPay', 'Pending to pay')}</CardTitle>
          <CardDescription className="hidden sm:block">
            {tab === 'receive'
              ? tt('settlements.receiveHelp', 'Receivables appear here from approved sales orders before issue and from issued sales invoices after issue. Once issued, the invoice becomes the canonical settlement anchor.')
              : tt('settlements.payHelp', 'Payables appear here from approved purchase orders before booking and from posted vendor bills after booking. Once posted, the vendor bill becomes the canonical settlement anchor.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
          ) : stateViewsUnavailable ? (
            <PremiumStatePanel
              variant="error"
              title={tt('financeUx.exposureUnavailable', 'Settlement exposure unavailable')}
              description={tt('settlements.stateViewsUnavailable', 'Settlement evidence is unavailable. Refresh the page or contact support if the problem continues.')}
            />
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('settlements.empty', 'No settlement anchors match the current filters.')}</p>
          ) : (
            <>
              <div className="rounded-2xl border border-border/70 bg-muted/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/75">
                      {tt('settlements.reconciliationTitle', 'Settlement bridge')}
                    </div>
                    <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
                      {tt('settlements.reconciliationHelp', 'Current legal equals original minus credits plus debits. Outstanding equals current legal minus actual cash and bank settlement.')}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tt('settlements.filteredAnchorsCount', '{count} active anchors in the current view', { count: filteredRows.length })}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-5">
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.originalBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.originalAmountHelp', 'Issued or posted starting amount before adjustments and settlements')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.adjustmentsAmount', 'Adjustments')}</div>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex items-center justify-between gap-3 text-status-danger-foreground">
                        <span>{tt('settlements.creditedAmount', 'Credited')}</span>
                        <span className="font-mono font-semibold tabular-nums">{money(filteredBridgeTotals.creditedBase)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-status-info-foreground">
                        <span>{tt('settlements.debitedAmount', 'Debited')}</span>
                        <span className="font-mono font-semibold tabular-nums">{money(filteredBridgeTotals.debitedBase)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.52)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.currentLegalAmount', 'Current legal')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.currentLegalBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.currentLegalHelp', 'Original minus credits plus debits')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.settledBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.settledAmountHelp', 'Actual cash and bank settlement only')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.52)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.outstandingBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.outstandingHelp', 'Current legal minus settled')}</div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/95 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.48)]">
                <table className="w-full min-w-[1480px] text-sm">
                  <thead className="bg-muted/30">
                    <tr className="border-b border-border/60 text-left">
                      <th className="px-4 py-3">{tt('table.ref', 'Reference')}</th>
                      <th className="px-4 py-3">{tt('settlements.counterparty', 'Counterparty')}</th>
                      <th className="px-4 py-3">{tt('table.date', 'Date')}</th>
                      <th className="px-4 py-3">{tt('orders.dueDate', 'Due Date')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.originalAmount', 'Original')}</th>
                      <th className="px-4 py-3">{tt('settlements.adjustmentsAmount', 'Adjustments')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.currentLegalAmount', 'Current legal')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.settledAmount', 'Settled')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.outstandingAmount', 'Outstanding')}</th>
                      <th className="px-4 py-3">{tt('settlements.balanceStatus', 'Balance status')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.aging', 'Aging')}</th>
                      <th className="px-4 py-3 text-right">{tt('orders.actions', 'Actions')}</th>
                    </tr>
                  </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={`${row.kind}:${row.id}`} className="border-b border-border/50 align-top transition-colors duration-200 hover:bg-muted/20">
                    <td className="px-4 py-4 [&>div:last-child]:hidden">
                      <div className="font-medium">{row.reference}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{`${row.sourceLabel} / ${row.workflowLabel || row.kind}`}</div>
                      <div className="mt-2 inline-flex rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {isFinanceDocumentRow(row)
                          ? tt('settlements.financeAnchor', 'Finance anchor')
                          : tt('settlements.orderStageAnchor', 'Order-stage anchor')}
                      </div>
                      <div className="text-xs text-muted-foreground">{`${row.sourceLabel} · ${row.workflowLabel || row.kind}`}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-foreground">{row.counterparty}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">{row.documentDate || tt('common.dash', '-')}</td>
                    <td className={`px-4 py-4 whitespace-nowrap ${dueTone(row)}`}>
                      {row.dueDate || tt('common.dash', '-')}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-mono tabular-nums">{row.originalAmount.toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {row.currency}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{money(row.originalBase)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="min-w-[180px] rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted-foreground">{tt('settlements.creditedAmount', 'Credited')}</span>
                          <span className="font-mono tabular-nums text-status-danger-foreground">{money(row.creditedBase)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted-foreground">{tt('settlements.debitedAmount', 'Debited')}</span>
                          <span className="font-mono tabular-nums text-status-info-foreground">{money(row.debitedBase)}</span>
                        </div>
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          {isFinanceDocumentRow(row)
                            ? tt('settlements.adjustmentNote', 'Legal adjustments from linked notes stay separate from settlement.')
                            : tt('settlements.noAdjustments', 'No document adjustments are active on order-stage anchors.')}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-mono text-base font-semibold tabular-nums">{money(row.currentLegalBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.creditedBase > 0.005 || row.debitedBase > 0.005
                          ? tt('settlements.currentLegalHelp', 'Original minus credits plus debits')
                          : tt('settlements.currentLegalMatchesOriginal', 'Matches the original legal amount')}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-mono text-base tabular-nums">{money(row.settledBase)}</div>
                      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                        <div>{tt('settlements.cashShort', 'Cash')}: <span className="font-mono tabular-nums">{money(row.cashBase)}</span></div>
                        <div>{tt('settlements.bankShort', 'Bank')}: <span className="font-mono tabular-nums">{money(row.bankBase)}</span></div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-mono text-base font-semibold tabular-nums">{money(row.outstandingBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.outstandingHelp', 'Current legal minus settled')}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row)}`}>
                        {row.balanceLabel}
                      </span>
                    </td>
                    <td className={`px-4 py-4 text-right font-mono tabular-nums ${row.agingDays > 0 ? 'text-status-danger-foreground' : 'text-muted-foreground'}`}>
                      {row.agingDays > 0 ? `${row.agingDays}d` : tt('common.dash', '-')}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {canManageSettlement ? (
                          <Button size="sm" onClick={() => openSettlement(row, 'settle')}>
                            {settlementActionLabel(row.kind)}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" className="transition-colors duration-200 hover:bg-muted" onClick={() => viewOrder(row)}>
                          {viewAnchorLabel(row.kind)}
                        </Button>
                        <Button size="sm" variant="outline" className="transition-colors duration-200 hover:bg-muted" onClick={() => openSettlement(row, 'history')}>
                          {tt('settlements.viewHistory', 'History')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="receipts" className="mt-0 space-y-6">
          <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {tt('customerReceipts.title', 'Customer receipts')}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {tt('customerReceipts.scope', 'One real payment remains one receipt and one cash or bank transaction. Allocations connect that receipt to issued invoices.')}
              </p>
            </div>
            {canManageSettlement ? (
              <Button onClick={() => openCustomerReceiptDialog(receiptCustomerFilter === 'ALL' ? '' : receiptCustomerFilter)}>
                <ReceiptText className="h-4 w-4" />
                {tt('customerReceipts.receivePayment', 'Receive payment')}
              </Button>
            ) : null}
          </div>

          <FinanceSummaryBand
            label={tt('customerReceipts.summary', 'Receipt summary')}
            items={[
              {
                label: tt('customerReceipts.received', 'Received'),
                value: receiptsLoading ? tt('common.loading', 'Loading...') : money(visibleCustomerReceipts.reduce((sum, receipt) => sum + Number(receipt.amount_received_base), 0)),
                detail: tt('customerReceipts.receivedHelp', 'Actual cash and bank receipts in the current customer scope.'),
              },
              {
                label: tt('customerReceipts.allocated', 'Allocated'),
                value: receiptsLoading ? tt('common.loading', 'Loading...') : money(visibleCustomerReceipts.reduce((sum, receipt) => sum + Number(receipt.allocated_base), 0)),
                detail: tt('customerReceipts.allocatedHelp', 'Only posted allocations reduce invoice outstanding.'),
              },
              {
                label: tt('customerReceipts.unallocated', 'Unallocated'),
                value: receiptsLoading ? tt('common.loading', 'Loading...') : money(visibleCustomerReceipts.reduce((sum, receipt) => sum + Number(receipt.unallocated_base), 0)),
                detail: tt('customerReceipts.unallocatedHelp', 'Received customer credit that remains available for later allocation.'),
                tone: visibleCustomerReceipts.some((receipt) => Number(receipt.unallocated_base) > 0.005) ? 'info' : 'neutral',
              },
            ]}
          />

          <div className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-sm">
              <Label>{tt('customerReceipts.customer', 'Customer')}</Label>
              <Select value={receiptCustomerFilter} onValueChange={updateReceiptCustomerQuery}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                  {receiptCustomers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.code ? `${customer.code} — ` : ''}{customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-sm text-muted-foreground">
              {tt('customerReceipts.recordCount', '{count} receipts', { count: visibleCustomerReceipts.length })}
            </span>
          </div>

          {!receiptsLoading && !receiptsError && receiptContextCustomer ? (
            <section
              className="space-y-5 border-b border-border pb-6"
              aria-labelledby="customer-receivables-context-title"
              data-testid="customer-receivables-context"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="customer-receivables-context-title" className="text-xl font-semibold tracking-tight">
                    {receiptContextCustomer.name}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {receiptContextCustomer.code ? <span>{receiptContextCustomer.code}</span> : null}
                    {receiptContextCustomer.email ? <span className="break-all">{receiptContextCustomer.email}</span> : null}
                    {receiptContextCustomer.phone ? <span>{receiptContextCustomer.phone}</span> : null}
                    {!receiptContextCustomer.code && !receiptContextCustomer.email && !receiptContextCustomer.phone
                      ? <span>{tt('customerReceipts.noContact', 'No customer contact details are recorded.')}</span>
                      : null}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3 sm:text-right">
                  <div>
                    <dt className="text-xs text-muted-foreground">{tt('customerReceipts.totalOpenReceivables', 'Total open receivables')}</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(receiptContextOutstanding)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{tt('customerReceipts.allocatableInvoiceOutstanding', 'Allocatable issued-invoice outstanding')}</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(receiptContextAllocatableOutstanding)}</dd>
                  </div>
                  <div data-testid="customer-unapplied-credit">
                    <dt className="text-xs text-muted-foreground">{tt('customerReceipts.unappliedCreditContext', 'Unapplied credit (separate)')}</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                      {money(Number(receiptContextUnapplied?.unapplied_credit_base || 0))}
                    </dd>
                  </div>
                </dl>
              </div>

              <p className="text-sm text-muted-foreground">
                {tt('customerReceipts.creditNotNetted', 'Unapplied credit is shown as receipt context and is never netted against outstanding until an allocation is posted.')}
              </p>

              <div data-testid="customer-receivables-open-documents">
                <h4 className="font-semibold">{tt('customerReceipts.openDocuments', 'Open receivables')}</h4>
                {receiptContextExposures.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {tt('customerReceipts.noOpenDocuments', 'This customer has no open receivable anchors in the current company scope.')}
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-border border-y border-border">
                    {receiptContextExposures.map((exposure) => (
                      <article key={exposure.anchor_id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(9rem,0.6fr))_minmax(12rem,0.8fr)_auto] lg:items-center">
                        <div>
                          <p className="font-medium">{exposure.document_reference}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tt('table.date', 'Date')}: {exposure.document_date || tt('common.dash', '-')}
                            {' · '}{tt('orders.dueDate', 'Due date')}: {exposure.due_date || tt('common.dash', '-')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</p>
                          <p className="mt-1 font-mono tabular-nums">{money(Number(exposure.original_amount_base))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</p>
                          <p className="mt-1 font-mono font-semibold tabular-nums">{money(Number(exposure.outstanding_amount_base))}</p>
                        </div>
                        <div className="text-sm">
                          {Number(exposure.days_past_due) > 0 ? (
                            <p className="font-medium text-status-danger-foreground">
                              {tt('customerReceipts.daysPastDue', '{count} days past due', { count: Number(exposure.days_past_due) })}
                            </p>
                          ) : (
                            <p className="text-muted-foreground">{tt('customerReceipts.notOverdue', 'Not overdue')}</p>
                          )}
                          {exposure.collections_suppressed ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {tt('customerReceipts.collectionsSuppressed', 'Collections suppressed')}: {exposure.collection_suppression_reason || exposure.collection_status}
                            </p>
                          ) : exposure.current_promise_id ? (
                            <p className="mt-1 text-xs text-muted-foreground">{tt('customerReceipts.promiseOpen', 'Promise to pay recorded')}</p>
                          ) : exposure.dispute_category ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {tt('customerReceipts.disputeOpen', 'Dispute')}: {exposure.dispute_category}
                            </p>
                          ) : null}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => navigate(
                          exposure.anchor_kind === 'sales_invoice'
                            ? `/sales-invoices/${exposure.anchor_id}`
                            : `/orders?tab=sales&orderId=${encodeURIComponent(exposure.anchor_id)}`,
                        )}>
                          {tt('financeDocs.viewDocument', 'View')}
                        </Button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {receiptsLoading ? (
            <PremiumStatePanel kind="loading" title={tt('customerReceipts.loading', 'Loading customer receipts')} />
          ) : receiptsError ? (
            <PremiumStatePanel
              kind="error"
              title={tt('customerReceipts.unavailable', 'Customer receipts unavailable')}
              description={receiptsError}
              action={<Button variant="outline" onClick={() => setRefreshKey((key) => key + 1)}>{tt('common.retry', 'Retry')}</Button>}
            />
          ) : visibleCustomerReceipts.length === 0 ? (
            <PremiumStatePanel
              kind="empty"
              title={tt('customerReceipts.empty', 'No customer receipts in this scope')}
              description={tt('customerReceipts.emptyHelp', 'Record a payment when money has actually been received from a known customer.')}
              action={canManageSettlement ? (
                <Button onClick={() => openCustomerReceiptDialog(receiptCustomerFilter === 'ALL' ? '' : receiptCustomerFilter)}>
                  {tt('customerReceipts.receivePayment', 'Receive payment')}
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="overflow-hidden border-y border-border">
              <div className="divide-y divide-border md:hidden">
                {visibleCustomerReceipts.map((receipt) => (
                  <button
                    key={receipt.id}
                    type="button"
                    className="block w-full px-1 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openCustomerReceiptDetail(receipt)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{receipt.receipt_reference}</p>
                        <p className="mt-1 break-words text-sm text-muted-foreground">{receiptCustomerById.get(receipt.customer_id)?.name || tt('common.none', 'None')}</p>
                      </div>
                      <span className="font-mono font-semibold tabular-nums">{money(Number(receipt.amount_received_base))}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{receipt.received_on}</span>
                      <span>{receipt.payment_channel === 'bank' ? tt('customerReceipts.bank', 'Bank') : tt('customerReceipts.cash', 'Cash')}</span>
                      <span>{tt('customerReceipts.unallocated', 'Unallocated')}: {money(Number(receipt.unallocated_base))}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/35 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">{tt('customerReceipts.reference', 'Receipt')}</th>
                      <th className="px-4 py-3">{tt('customerReceipts.customer', 'Customer')}</th>
                      <th className="px-4 py-3">{tt('table.date', 'Date')}</th>
                      <th className="px-4 py-3">{tt('customerReceipts.method', 'Method')}</th>
                      <th className="px-4 py-3 text-right">{tt('customerReceipts.received', 'Received')}</th>
                      <th className="px-4 py-3 text-right">{tt('customerReceipts.allocated', 'Allocated')}</th>
                      <th className="px-4 py-3 text-right">{tt('customerReceipts.unallocated', 'Unallocated')}</th>
                      <th className="px-4 py-3 text-right"><span className="sr-only">{tt('common.actions', 'Actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleCustomerReceipts.map((receipt) => (
                      <tr key={receipt.id}>
                        <td className="px-4 py-4 font-medium">{receipt.receipt_reference}</td>
                        <td className="px-4 py-4">{receiptCustomerById.get(receipt.customer_id)?.name || tt('common.none', 'None')}</td>
                        <td className="px-4 py-4">{receipt.received_on}</td>
                        <td className="px-4 py-4">{receipt.payment_channel === 'bank' ? tt('customerReceipts.bank', 'Bank') : tt('customerReceipts.cash', 'Cash')}</td>
                        <td className="px-4 py-4 text-right font-mono tabular-nums">{money(Number(receipt.amount_received_base))}</td>
                        <td className="px-4 py-4 text-right font-mono tabular-nums">{money(Number(receipt.allocated_base))}</td>
                        <td className="px-4 py-4 text-right font-mono font-semibold tabular-nums">{money(Number(receipt.unallocated_base))}</td>
                        <td className="px-4 py-4 text-right">
                          <Button size="sm" variant="outline" onClick={() => openCustomerReceiptDetail(receipt)}>
                            {tt('common.view', 'View')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeCustomerReceipt ? (
            <section className="border-t border-border pt-6" aria-labelledby="customer-receipt-detail-title">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="customer-receipt-detail-title" className="text-xl font-semibold tracking-tight">
                    {activeCustomerReceipt.receipt_reference}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {receiptCustomerById.get(activeCustomerReceipt.customer_id)?.name || tt('common.none', 'None')}
                  </p>
                </div>
                <Button variant="ghost" onClick={closeCustomerReceiptDetail}>{tt('common.close', 'Close')}</Button>
              </div>
              <dl className="mt-5 grid gap-x-6 gap-y-4 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.received', 'Received')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(Number(activeCustomerReceipt.amount_received_base))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.allocated', 'Allocated')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(Number(activeCustomerReceipt.allocated_base))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.unallocated', 'Unallocated')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(Number(activeCustomerReceipt.unallocated_base))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.transaction', 'Financial transaction')}</dt><dd className="mt-1 break-all font-mono text-xs">{activeCustomerReceipt.financial_transaction_id}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('table.date', 'Date')}</dt><dd className="mt-1">{activeCustomerReceipt.received_on}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.method', 'Method')}</dt><dd className="mt-1">{activeCustomerReceipt.payment_channel === 'bank' ? tt('customerReceipts.bank', 'Bank') : tt('customerReceipts.cash', 'Cash')}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.externalReference', 'External reference')}</dt><dd className="mt-1 break-words">{activeCustomerReceipt.external_reference || tt('common.dash', '-')}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.note', 'Note')}</dt><dd className="mt-1 break-words">{activeCustomerReceipt.note || tt('common.dash', '-')}</dd></div>
              </dl>

              <div className="mt-6">
                <h4 className="font-semibold">{tt('customerReceipts.allocations', 'Invoice allocations')}</h4>
                {activeCustomerReceiptAllocations.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{tt('customerReceipts.noAllocations', 'No invoice allocations have been posted.')}</p>
                ) : (
                  <div className="mt-3 divide-y divide-border border-y border-border">
                    {activeCustomerReceiptAllocations.map((allocation) => {
                      const exposure = receiptExposureById.get(allocation.sales_invoice_id)
                      return (
                        <div key={allocation.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-medium">{exposure?.document_reference || allocation.sales_invoice_id}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{allocation.created_at}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <span className={`font-mono font-semibold tabular-nums ${allocation.is_reversed ? 'text-muted-foreground line-through' : ''}`}>
                              {money(Number(allocation.amount_base))}
                            </span>
                            {allocation.is_reversed ? (
                              <span className="text-xs text-muted-foreground">{tt('customerReceipts.reversed', 'Reversed')}</span>
                            ) : canManageSettlement ? (
                              <Button size="sm" variant="outline" onClick={() => { setReversalAllocation(allocation); setReversalReason('') }}>
                                <Undo2 className="h-4 w-4" />
                                {tt('customerReceipts.reverseAllocation', 'Reverse allocation')}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {canManageSettlement && Number(activeCustomerReceipt.unallocated_base) > 0.005 ? (
                <div className="mt-6 border-l-2 border-status-info-border bg-status-info-muted px-4 py-4">
                  <h4 className="font-semibold">{tt('customerReceipts.allocateCredit', 'Allocate existing receipt credit')}</h4>
                  <p className="mt-1 text-sm text-muted-foreground">{tt('customerReceipts.allocateCreditHelp', 'This allocation changes invoice outstanding without creating another cash or bank transaction.')}</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)_auto] md:items-end">
                    <div>
                      <Label>{tt('customerReceipts.invoice', 'Invoice')}</Label>
                      <Select value={laterAllocationInvoiceId} onValueChange={setLaterAllocationInvoiceId}>
                        <SelectTrigger><SelectValue placeholder={tt('customerReceipts.selectInvoice', 'Select an invoice')} /></SelectTrigger>
                        <SelectContent>
                          {laterAllocationExposures.map((exposure) => (
                            <SelectItem key={exposure.anchor_id} value={exposure.anchor_id}>
                              {exposure.document_reference} — {money(Number(exposure.outstanding_amount_base))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="later-allocation-amount">{tt('customerReceipts.allocationAmount', 'Allocation amount')}</Label>
                      <Input id="later-allocation-amount" type="number" min="0.01" step="0.01" value={laterAllocationAmount} onChange={(event) => setLaterAllocationAmount(event.target.value)} />
                    </div>
                    <Button disabled={receiptSaving || !laterAllocationInvoiceId} onClick={submitLaterAllocation}>
                      {receiptSaving ? tt('common.saving', 'Saving...') : tt('customerReceipts.allocate', 'Allocate')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </TabsContent>

        <SettlementActivityWorkspace
          tt={tt}
          workspaceSide={workspaceSide}
          activityLoading={activityLoading}
          activityError={activityError}
          filteredActivityRows={filteredActivityRows}
          activityTotal={activityTotal}
          activityFrom={activityFrom}
          activityTo={activityTo}
          activitySearch={activitySearch}
          activityMethod={activityMethod}
          money={money}
          activityAnchorKindLabel={activityAnchorKindLabel}
          onWorkspaceSideChange={(side) => updateWorkspaceQuery({ side })}
          onActivitySearchChange={setActivitySearch}
          onActivityFromChange={setActivityFrom}
          onActivityToChange={setActivityTo}
          onActivityMethodChange={setActivityMethod}
          onExportActivity={() => setExportRequest({ kind: 'activity' })}
          onExportAdvice={(activity) => setExportRequest({ kind: 'advice', activity })}
          onViewAnchor={(row) => {
            if (row.anchorKind) viewReconciliationAnchor(row.anchorKind, row.anchorId || row.refId)
          }}
        />

        <TabsContent value="reconciliation" className="mt-0 space-y-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Card className="border-border/80 shadow-sm xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('financeDocs.reconciliation.reviewTitle', 'Review register')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{filteredReviewRows.length}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tt('financeDocs.reconciliation.reviewHelp', 'Review the active AR/AP anchors using current legal value, settlement, due position, and exception signals from the DB-backed reconciliation model.')}
                </p>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{money(reviewTotals.currentLegal)}</div>
                <p className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.currentLegalHelp', 'Original minus credits plus debits across the filtered review set.')}</p>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{money(reviewTotals.outstanding)}</div>
                <p className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.outstandingHelp', 'Outstanding is based on current legal value after adjustments and actual settlement only.')}</p>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('financeDocs.reconciliation.overdueCount', 'Overdue')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{reviewTotals.overdueCount}</div>
                <p className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.overdueHelp', 'Overdue state is bucketed from the legal outstanding balance, not the gross original document value.')}</p>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('financeDocs.reconciliation.exceptionQueue', 'Exception queue')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{filteredReviewExceptions.length}</div>
                <p className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.exceptionHelp', 'Critical and warning exceptions surface broken bridges, anchor-chain defects, and issue/post blockers that need controller review.')}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle>{tt('financeDocs.reconciliation.filters', 'Review filters')}</CardTitle>
              <CardDescription className="hidden sm:block">{tt('financeDocs.reconciliation.filtersHelp', 'Switch between AR and AP, then filter by counterparty, due position, review state, currency, or document date without leaving the active company.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={reviewSide} onValueChange={(value) => updateWorkspaceQuery({ side: value === 'AR' ? 'ar' : 'ap' })}>
                <TabsList className="h-auto w-full justify-start gap-1 rounded-xl bg-muted/70 p-1 md:w-auto">
                  <TabsTrigger value="AR" className="min-w-[180px] rounded-lg">{tt('financeDocs.reconciliation.arTitle', 'Accounts receivable')}</TabsTrigger>
                  <TabsTrigger value="AP" className="min-w-[180px] rounded-lg">{tt('financeDocs.reconciliation.apTitle', 'Accounts payable')}</TabsTrigger>
                </TabsList>
                <TabsContent value={reviewSide} className="mt-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <div className="xl:col-span-2">
                      <Label>{tt('common.search', 'Search')}</Label>
                      <Input value={reviewSearch} onChange={(event) => setReviewSearch(event.target.value)} placeholder={tt('financeDocs.reconciliation.searchPlaceholder', 'Reference, counterparty, due state, review state, or exception')} />
                    </div>
                    <div>
                      <Label>{tt('settlements.counterparty', 'Counterparty')}</Label>
                      <Select value={reviewPartyFilter} onValueChange={setReviewPartyFilter}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                          {reviewPartyOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('orders.currency', 'Currency')}</Label>
                      <Select value={reviewCurrencyFilter} onValueChange={setReviewCurrencyFilter}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                          {reviewCurrencyOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('settlements.dueState', 'Due state')}</Label>
                      <Select value={reviewDueFilter} onValueChange={(value) => setReviewDueFilter(value as typeof reviewDueFilter)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                          <SelectItem value="overdue">{tt('financeDocs.reconciliation.due.overdue', 'Overdue')}</SelectItem>
                          <SelectItem value="due_soon">{tt('financeDocs.reconciliation.due.dueSoon', 'Due soon')}</SelectItem>
                          <SelectItem value="current">{tt('financeDocs.reconciliation.due.current', 'Current')}</SelectItem>
                          <SelectItem value="resolved">{tt('financeDocs.reconciliation.due.resolved', 'Resolved')}</SelectItem>
                          <SelectItem value="undated">{tt('financeDocs.reconciliation.due.undated', 'No due date')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('financeDocs.reconciliation.reviewState', 'Review state')}</Label>
                      <Select value={reviewStateFilter} onValueChange={(value) => setReviewStateFilter(value as typeof reviewStateFilter)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                          <SelectItem value="exception">{reviewStateLabel('exception')}</SelectItem>
                          <SelectItem value="overdue">{reviewStateLabel('overdue')}</SelectItem>
                          <SelectItem value="attention">{reviewStateLabel('attention')}</SelectItem>
                          <SelectItem value="open">{reviewStateLabel('open')}</SelectItem>
                          <SelectItem value="resolved">{reviewStateLabel('resolved')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <Label>{tt('filters.from', 'From')}</Label>
                      <Input type="date" value={reviewFromDate} onChange={(event) => setReviewFromDate(event.target.value)} />
                    </div>
                    <div>
                      <Label>{tt('filters.to', 'To')}</Label>
                      <Input type="date" value={reviewToDate} onChange={(event) => setReviewToDate(event.target.value)} />
                    </div>
                    <div className="xl:col-span-2 flex flex-wrap items-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setReviewSearch('')
                          setReviewPartyFilter('ALL')
                          setReviewCurrencyFilter('ALL')
                          setReviewDueFilter('all')
                          setReviewStateFilter('all')
                          setReviewFromDate('')
                          setReviewToDate('')
                        }}
                      >
                        {tt('common.clear', 'Clear')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setExportRequest({ kind: 'reconciliation' })}
                        disabled={loading || reconciliationViewsUnavailable}
                      >
                        <Download className="h-4 w-4" />
                        {workspaceSide === 'ar'
                          ? tt('financeUx.exportArReconciliation', 'Export current AR reconciliation')
                          : tt('financeUx.exportApReconciliation', 'Export current AP reconciliation')}
                      </Button>
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone('exception')}`}>{reviewStateLabel('exception')}: {reviewStateCounts.exception}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone('overdue')}`}>{reviewStateLabel('overdue')}: {reviewStateCounts.overdue}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone('attention')}`}>{reviewStateLabel('attention')}: {reviewStateCounts.attention}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone('resolved')}`}>{reviewStateLabel('resolved')}: {reviewStateCounts.resolved}</span>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {reconciliationViewsUnavailable ? (
            <Card className="border-status-warning-border bg-status-warning-muted text-status-warning-foreground shadow-none">
              <CardContent className="pt-6 text-sm">
                {tt('financeDocs.reconciliation.viewsUnavailable', 'Reconciliation evidence is unavailable. No zero or all-clear result has been inferred. Refresh the page or contact support if the problem continues.')}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-border/80 shadow-sm">
                <CardHeader>
                  <CardTitle>{tt('financeDocs.reconciliation.exceptionQueue', 'Exception queue')}</CardTitle>
                  <CardDescription className="hidden sm:block">{tt('financeDocs.reconciliation.exceptionQueueHelp', 'Flag records that need controller attention because the bridge, anchor chain, or issue/post readiness is inconsistent with finance expectations.')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
                  ) : filteredReviewExceptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tt('financeDocs.reconciliation.exceptionQueueEmpty', 'No reconciliation exceptions match the current review filters.')}</p>
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {filteredReviewExceptions.map((row) => (
                        <button
                          key={`${row.anchor_id}:${row.exception_code}`}
                          type="button"
                          onClick={() => viewReconciliationAnchor(row.anchor_kind, row.anchor_id)}
                          className="rounded-xl border border-border/70 bg-background p-4 text-left hover:border-primary/30"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-semibold tracking-tight">{row.anchor_reference}</div>
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${exceptionSeverityTone(row.severity)}`}>
                              {row.severity === 'critical' ? tt('financeDocs.reconciliation.severityCritical', 'Critical') : tt('financeDocs.reconciliation.severityWarning', 'Warning')}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {row.counterparty_name || tt('common.none', 'None')}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <span className="inline-flex rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-muted-foreground">
                              {exceptionGroupLabel(row.exception_group)}
                            </span>
                            <span className="inline-flex rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-muted-foreground">
                              {row.ledger_side}
                            </span>
                          </div>
                          <div className="mt-3 text-sm font-medium">{exceptionLabel(row.exception_code)}</div>
                          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                            <div>{tt('table.date', 'Date')}: {row.document_date || tt('common.dash', '-')}</div>
                            <div>{tt('orders.dueDate', 'Due Date')}: {row.due_date || tt('common.dash', '-')}</div>
                            <div>{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}: <span className="font-mono tabular-nums">{money(n(row.current_legal_total_base))}</span></div>
                            <div>{tt('settlements.outstandingAmount', 'Outstanding')}: <span className="font-mono tabular-nums">{money(n(row.outstanding_base))}</span></div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-sm">
                <CardHeader>
                  <CardTitle>{tt('financeDocs.reconciliation.registerTitle', 'Reconciliation register')}</CardTitle>
                  <CardDescription className="hidden sm:block">{tt('financeDocs.reconciliation.registerHelp', 'Scan every active finance anchor with original value, net adjustments, current legal amount, settlement, outstanding balance, due logic, and controller review state in one register.')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-muted/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
                    <div className="grid gap-3 xl:grid-cols-6">
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.original)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.adjustmentsAmount', 'Adjustments')}</div>
                        <div className={`mt-2 font-mono text-lg font-semibold tabular-nums ${reviewTotals.netAdjustments < 0 ? 'text-status-danger-foreground' : reviewTotals.netAdjustments > 0 ? 'text-status-info-foreground' : ''}`}>{money(reviewTotals.netAdjustments)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.52)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.currentLegal)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.settled)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.52)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.outstanding)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('financeDocs.reconciliation.needsReview', 'Needs review')}</div>
                        <div className="mt-2 text-lg font-semibold tracking-tight">{reviewTotals.reviewCount}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.overSettled', 'Over-settled total')}: <span className="font-mono tabular-nums">{money(reviewTotals.overSettled)}</span></div>
                      </div>
                    </div>
                  </div>

                  {loading ? (
                    <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
                  ) : filteredReviewRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tt('financeDocs.reconciliation.registerEmpty', 'No reconciliation rows match the current review filters.')}</p>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/95 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.48)]">
                      <table className="w-full min-w-[1640px] text-sm">
                        <thead className="bg-muted/30">
                          <tr className="border-b border-border/60 text-left">
                            <th className="px-4 py-3">{tt('table.ref', 'Reference')}</th>
                            <th className="px-4 py-3">{tt('settlements.counterparty', 'Counterparty')}</th>
                            <th className="px-4 py-3">{tt('table.date', 'Date')}</th>
                            <th className="px-4 py-3">{tt('orders.dueDate', 'Due Date')}</th>
                            <th className="px-4 py-3 text-right">{tt('settlements.originalAmount', 'Original')}</th>
                            <th className="px-4 py-3 text-right">{tt('financeDocs.reconciliation.netAdjustment', 'Net adjustments')}</th>
                            <th className="px-4 py-3 text-right">{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}</th>
                            <th className="px-4 py-3 text-right">{tt('settlements.settledAmount', 'Settled')}</th>
                            <th className="px-4 py-3 text-right">{tt('settlements.outstandingAmount', 'Outstanding')}</th>
                            <th className="px-4 py-3">{tt('settlements.dueState', 'Due state')}</th>
                            <th className="px-4 py-3">{tt('settlements.aging', 'Aging')}</th>
                            <th className="px-4 py-3">{tt('financeDocs.reconciliation.resolutionContext', 'Resolution context')}</th>
                            <th className="px-4 py-3">{tt('financeDocs.reconciliation.reviewState', 'Review state')}</th>
                            <th className="px-4 py-3 text-right">{tt('orders.actions', 'Actions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredReviewRows.map((row) => (
                            <tr key={`${row.ledger_side}:${row.anchor_id}`} className="border-b border-border/50 align-top transition-colors duration-200 hover:bg-muted/20">
                              <td className="px-4 py-4">
                                <div className="font-medium">{row.anchor_reference}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {row.operational_reference
                                    ? tt('financeDocs.reconciliation.anchorBridge', 'Operational {operational} -> Finance {anchor}', {
                                      operational: row.operational_reference,
                                      anchor: row.anchor_reference,
                                    })
                                    : tt('financeDocs.reconciliation.anchorOnly', 'Finance anchor only')}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-medium">{row.counterparty_name || tt('common.none', 'None')}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{row.ledger_side}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">{row.document_date || tt('common.dash', '-')}</td>
                              <td className="px-4 py-4 whitespace-nowrap">{row.due_date || tt('common.dash', '-')}</td>
                              <td className="px-4 py-4 text-right font-mono tabular-nums">{money(n(row.original_total_base))}</td>
                              <td className={`px-4 py-4 text-right font-mono tabular-nums ${n(row.net_adjustment_base) < 0 ? 'text-status-danger-foreground' : n(row.net_adjustment_base) > 0 ? 'text-status-info-foreground' : ''}`}>{money(n(row.net_adjustment_base))}</td>
                              <td className="px-4 py-4 text-right font-mono tabular-nums font-semibold">{money(n(row.current_legal_total_base))}</td>
                              <td className="px-4 py-4 text-right font-mono tabular-nums">{money(n(row.settled_base))}</td>
                              <td className="px-4 py-4 text-right">
                                <div className="font-mono tabular-nums font-semibold">{money(n(row.outstanding_base))}</div>
                                {n(row.over_settled_base) > 0.005 ? (
                                  <div className="mt-1 text-xs text-status-danger-foreground">
                                    {tt('financeDocs.reconciliation.overSettledShort', 'Over-settled')}: <span className="font-mono tabular-nums">{money(n(row.over_settled_base))}</span>
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-medium">{duePositionLabel(row.due_position)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {row.days_past_due > 0
                                    ? tt('financeDocs.reconciliation.daysPastDue', '{count} days past due', { count: row.days_past_due })
                                    : row.days_until_due != null
                                      ? tt('financeDocs.reconciliation.daysUntilDue', '{count} days until due', { count: row.days_until_due })
                                      : tt('common.dash', '-')}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-medium">{agingBucketLabel(row.aging_bucket)}</div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-medium">{resolutionContextLabel(row)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{reviewStateLabel(row.review_state)}</div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex flex-wrap gap-2">
                                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone(row.review_state)}`}>
                                    {reviewStateLabel(row.review_state)}
                                  </span>
                                  {row.exception_count > 0 ? (
                                    <span className="inline-flex rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                      {tt('financeDocs.reconciliation.exceptionCount', '{count} exceptions', { count: row.exception_count })}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <Button size="sm" variant="outline" onClick={() => viewReconciliationAnchor(row.anchor_kind, row.anchor_id)}>
                                  {tt('financeDocs.viewDocument', 'View')}
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>

      {exportDialogMeta ? (
        <FinanceExportDialog
          open={Boolean(exportRequest)}
          onOpenChange={(open) => { if (!open) setExportRequest(null) }}
          title={exportDialogMeta.title}
          description={tt('financeUx.export.confirmHelp', 'Confirm the report scope before generating a read-only finance output.')}
          scope={exportDialogMeta.scope}
          period={exportDialogMeta.period}
          recordCount={exportDialogMeta.recordCount}
          currencyBasis={`${tt('financeUx.companyBaseCurrency', 'Company base currency')}: ${baseCode}`}
          language={defaultExportLanguage}
          allowBilingual={exportDialogMeta.allowBilingual}
          labels={exportDialogLabels}
          onGenerate={generateFinanceExport}
        />
      ) : null}

      <Dialog open={receiptDialogOpen} onOpenChange={(open) => { if (!receiptSaving) setReceiptDialogOpen(open) }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{tt('customerReceipts.receivePayment', 'Receive payment')}</DialogTitle>
            <DialogDescription>
              {receiptStep === 1
                ? tt('customerReceipts.chooseCustomerHelp', 'Choose the customer that made the payment.')
                : receiptStep === 2
                  ? tt('customerReceipts.detailsHelp', 'Record the real payment, then allocate any portion that belongs to issued invoices.')
                  : tt('customerReceipts.reviewHelp', 'Review the financial transaction and invoice allocations before posting.')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <ol className="flex flex-wrap gap-x-5 gap-y-2 border-b border-border pb-4 text-sm" aria-label={tt('customerReceipts.steps', 'Receipt steps')}>
              {[
                [1, tt('customerReceipts.stepCustomer', 'Customer')],
                [2, tt('customerReceipts.stepDetails', 'Receipt and allocation')],
                [3, tt('customerReceipts.stepReview', 'Review')],
              ].map(([step, label]) => (
                <li key={String(step)} className={Number(step) === receiptStep ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                  {step}. {label}
                </li>
              ))}
            </ol>

            {receiptStep === 1 ? (
              <div className="py-5">
                <Label>{tt('customerReceipts.customer', 'Customer')}</Label>
                <Select
                  value={receiptCustomerId}
                  onValueChange={(value) => {
                    setReceiptCustomerId(value)
                    setReceiptAllocationValues({})
                  }}
                >
                  <SelectTrigger><SelectValue placeholder={tt('customerReceipts.selectCustomer', 'Select a customer')} /></SelectTrigger>
                  <SelectContent>
                    {receiptCustomers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.code ? `${customer.code} — ` : ''}{customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {receiptStep === 2 ? (
              <div className="space-y-6 py-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="customer-receipt-amount">{tt('customerReceipts.amountReceived', 'Amount received')}</Label>
                    <Input id="customer-receipt-amount" type="number" min="0.01" step="0.01" value={receiptAmount} onChange={(event) => setReceiptAmount(event.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="customer-receipt-date">{tt('table.date', 'Date')}</Label>
                    <Input id="customer-receipt-date" type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} />
                  </div>
                  <div>
                    <Label>{tt('orders.currency', 'Currency')}</Label>
                    <Input value={baseCode} readOnly aria-readonly="true" />
                  </div>
                  <div>
                    <Label>{tt('customerReceipts.method', 'Method')}</Label>
                    <Select value={receiptMethod} onValueChange={(value) => setReceiptMethod(value as 'cash' | 'bank')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">{tt('customerReceipts.cash', 'Cash')}</SelectItem>
                        <SelectItem value="bank">{tt('customerReceipts.bank', 'Bank')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {receiptMethod === 'bank' ? (
                    <div>
                      <Label>{tt('customerReceipts.bankAccount', 'Bank account')}</Label>
                      <Select value={receiptBankId} onValueChange={setReceiptBankId}>
                        <SelectTrigger><SelectValue placeholder={tt('customerReceipts.selectBank', 'Select a bank account')} /></SelectTrigger>
                        <SelectContent>
                          {banks.filter((bank) => !bank.currency_code || String(bank.currency_code).toUpperCase() === baseCode.toUpperCase()).map((bank) => (
                            <SelectItem key={bank.id} value={bank.id}>{bank.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div>
                    <Label htmlFor="customer-receipt-external-reference">{tt('customerReceipts.externalReference', 'External reference')}</Label>
                    <Input id="customer-receipt-external-reference" value={receiptExternalReference} onChange={(event) => setReceiptExternalReference(event.target.value)} />
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="customer-receipt-note">{tt('customerReceipts.note', 'Note')}</Label>
                    <Input id="customer-receipt-note" value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} />
                  </div>
                </div>

                <div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h3 className="font-semibold">{tt('customerReceipts.openInvoices', 'Open invoices')}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{tt('customerReceipts.openInvoicesHelp', 'Only issued invoices in company base currency are eligible in this version.')}</p>
                    </div>
                    <Button variant="outline" onClick={allocateOldestFirst} disabled={!Number.isFinite(currentReceiptSummary.received) || currentReceiptSummary.received <= 0 || selectedCustomerExposures.length === 0}>
                      {tt('customerReceipts.allocateOldestFirst', 'Allocate oldest first')}
                    </Button>
                  </div>
                  {selectedCustomerExposures.length === 0 ? (
                    <p className="mt-4 border-y border-border py-4 text-sm text-muted-foreground">
                      {tt('customerReceipts.noEligibleInvoices', 'This customer has no eligible open base-currency invoices. The receipt may remain entirely unallocated.')}
                    </p>
                  ) : (
                    <div className="mt-4 overflow-x-auto border-y border-border">
                      <table className="min-w-full text-sm">
                        <thead className="bg-muted/35 text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-3">{tt('customerReceipts.invoice', 'Invoice')}</th>
                            <th className="px-3 py-3">{tt('table.date', 'Date')}</th>
                            <th className="px-3 py-3">{tt('orders.dueDate', 'Due Date')}</th>
                            <th className="px-3 py-3 text-right">{tt('settlements.originalAmount', 'Original')}</th>
                            <th className="px-3 py-3 text-right">{tt('settlements.outstandingAmount', 'Outstanding')}</th>
                            <th className="min-w-[10rem] px-3 py-3 text-right">{tt('customerReceipts.allocationAmount', 'Allocation amount')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {selectedCustomerExposures.map((exposure) => (
                            <tr key={exposure.anchor_id}>
                              <td className="px-3 py-3 font-medium">{exposure.document_reference}</td>
                              <td className="px-3 py-3">{exposure.document_date || tt('common.dash', '-')}</td>
                              <td className="px-3 py-3">{exposure.due_date || tt('common.dash', '-')}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">{money(Number(exposure.original_amount_base))}</td>
                              <td className="px-3 py-3 text-right font-mono tabular-nums">{money(Number(exposure.outstanding_amount_base))}</td>
                              <td className="px-3 py-3">
                                <Label htmlFor={`receipt-allocation-${exposure.anchor_id}`} className="sr-only">
                                  {tt('customerReceipts.allocationFor', 'Allocation for {reference}', { reference: exposure.document_reference })}
                                </Label>
                                <Input
                                  id={`receipt-allocation-${exposure.anchor_id}`}
                                  className="text-right font-mono tabular-nums"
                                  type="number"
                                  min="0"
                                  max={Number(exposure.outstanding_amount_base)}
                                  step="0.01"
                                  value={receiptAllocationValues[exposure.anchor_id] || ''}
                                  onChange={(event) => setReceiptAllocationValues((current) => ({ ...current, [exposure.anchor_id]: event.target.value }))}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <dl className="grid gap-4 border-y border-border py-4 sm:grid-cols-3" aria-live="polite">
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.received', 'Received')}</dt><dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(currentReceiptSummary.received)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.allocated', 'Allocated')}</dt><dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(currentReceiptSummary.allocated)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.unallocated', 'Unallocated')}</dt><dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${currentReceiptSummary.unallocated < 0 ? 'text-status-danger-foreground' : ''}`}>{money(currentReceiptSummary.unallocated)}</dd></div>
                </dl>
                {currentReceiptSummary.unallocated >= 0 ? (
                  <p className="text-sm text-muted-foreground">{tt('customerReceipts.creditTruth', 'Unallocated customer credit is valid and does not reduce any invoice until an allocation is posted.')}</p>
                ) : (
                  <p className="text-sm text-status-danger-foreground" role="alert">{tt('customerReceipts.overAllocated', 'Allocated amount cannot exceed the amount received.')}</p>
                )}
              </div>
            ) : null}

            {receiptStep === 3 ? (
              <div className="space-y-5 py-5">
                <dl className="grid gap-x-6 gap-y-4 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.customer', 'Customer')}</dt><dd className="mt-1 font-medium">{receiptCustomerById.get(receiptCustomerId)?.name}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.received', 'Received')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(currentReceiptSummary.received)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.allocated', 'Allocated')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(currentReceiptSummary.allocated)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.unallocated', 'Unallocated')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(currentReceiptSummary.unallocated)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('table.date', 'Date')}</dt><dd className="mt-1">{receiptDate}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.method', 'Method')}</dt><dd className="mt-1">{receiptMethod === 'bank' ? tt('customerReceipts.bank', 'Bank') : tt('customerReceipts.cash', 'Cash')}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('orders.currency', 'Currency')}</dt><dd className="mt-1">{baseCode}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.financialEntries', 'Financial entries')}</dt><dd className="mt-1 font-semibold">1</dd></div>
                </dl>
                <div>
                  <h3 className="font-semibold">{tt('customerReceipts.allocations', 'Invoice allocations')}</h3>
                  {receiptAllocationInputs.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">{tt('customerReceipts.noAllocationsReview', 'No allocations. The full receipt will remain as unapplied customer credit.')}</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-border border-y border-border">
                      {receiptAllocationInputs.map((allocation) => (
                        <li key={allocation.salesInvoiceId} className="flex items-center justify-between gap-4 py-3">
                          <span>{receiptExposureById.get(allocation.salesInvoiceId)?.document_reference || allocation.salesInvoiceId}</span>
                          <span className="font-mono font-semibold tabular-nums">{money(allocation.amountBase)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            {receiptStep > 1 ? <Button variant="outline" disabled={receiptSaving} onClick={() => setReceiptStep((receiptStep - 1) as 1 | 2)}>{tt('common.back', 'Back')}</Button> : null}
            {receiptStep === 1 ? (
              <Button disabled={!receiptCustomerId} onClick={() => setReceiptStep(2)}>{tt('common.continue', 'Continue')}</Button>
            ) : receiptStep === 2 ? (
              <Button
                disabled={!Number.isFinite(currentReceiptSummary.received) || currentReceiptSummary.received <= 0 || currentReceiptSummary.unallocated < 0 || !receiptDate || (receiptMethod === 'bank' && !receiptBankId)}
                onClick={() => setReceiptStep(3)}
              >
                {tt('customerReceipts.reviewReceipt', 'Review receipt')}
              </Button>
            ) : (
              <Button disabled={receiptSaving} onClick={submitCustomerReceipt}>
                {receiptSaving ? tt('customerReceipts.posting', 'Posting...') : tt('customerReceipts.postReceipt', 'Post receipt')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reversalAllocation)} onOpenChange={(open) => { if (!open && !receiptSaving) setReversalAllocation(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tt('customerReceipts.reverseAllocation', 'Reverse allocation')}</DialogTitle>
            <DialogDescription>{tt('customerReceipts.reverseHelp', 'The receipt remains unchanged. This restores receipt credit and invoice outstanding through append-only reversal evidence.')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="receipt-allocation-reversal-reason">{tt('customerReceipts.reversalReason', 'Reason')}</Label>
            <Input id="receipt-allocation-reversal-reason" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={receiptSaving} onClick={() => setReversalAllocation(null)}>{tt('common.cancel', 'Cancel')}</Button>
            <Button variant="destructive" disabled={receiptSaving || !reversalReason.trim()} onClick={submitAllocationReversal}>
              {receiptSaving ? tt('common.saving', 'Saving...') : tt('customerReceipts.reverseAllocation', 'Reverse allocation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!activeRow} onOpenChange={(open) => { if (!open) setActiveRow(null) }}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {activeRow
                ? `${settlementActionLabel(activeRow.kind)} - ${activeRow.reference}`
                : tt('settlements.title', 'Receivables & Payables')}
            </DialogTitle>
            <DialogDescription>
              {activeRow
                ? tt('settlements.dialogHelp', 'Post a full or partial settlement, or review prior entries linked to the active settlement anchor. This workspace follows the current source of truth, not a duplicated order/document exposure.')
                : tt('settlements.subtitle', 'Track receivables and payables from the active settlement anchor')}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="pr-1">
            {activeRow && (
              <div className="space-y-4">
                <div className="border-y border-border py-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/75">
                        {isFinanceDocumentRow(activeRow)
                          ? tt('settlements.financeAnchor', 'Finance anchor')
                          : tt('settlements.orderStageAnchor', 'Order-stage anchor')}
                      </div>
                      <div>
                        <div className="text-2xl font-semibold tracking-tight">{activeRow.reference}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{activeRow.counterparty}</div>
                      </div>
                      <div className="text-xs text-muted-foreground">{`${activeRow.sourceLabel} / ${activeRow.workflowLabel}`}</div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3 shadow-[0_14px_36px_-30px_rgba(0,0,0,0.55)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('table.date', 'Date')}</div>
                        <div className="mt-2 text-sm font-medium">{activeRow.documentDate || tt('common.dash', '-')}</div>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3 shadow-[0_14px_36px_-30px_rgba(0,0,0,0.55)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('orders.dueDate', 'Due Date')}</div>
                        <div className={`mt-2 text-sm font-medium ${dueTone(activeRow)}`}>{activeRow.dueDate || tt('common.dash', '-')}</div>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3 shadow-[0_14px_36px_-30px_rgba(0,0,0,0.55)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('settlements.balanceStatus', 'Balance status')}</div>
                        <div className="mt-2">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(activeRow)}`}>
                            {activeRow.balanceLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{tt('settlements.reconciliationTitle', 'Settlement bridge')}:</span>{' '}
                  {tt('settlements.dialogBridgeHelp', 'Current legal = original - credits + debits. Outstanding = current legal - settled. Credits never count as settlement.')}
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <Card className="border-border/70 bg-background/90 shadow-[0_16px_40px_-32px_rgba(0,0,0,0.5)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums">{money(activeRow.originalBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.originalAmountHelp', 'Issued or posted starting amount before adjustments and settlements')}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/90 shadow-[0_16px_40px_-32px_rgba(0,0,0,0.5)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.creditedAmount', 'Credited')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums text-status-danger-foreground">{money(activeRow.creditedBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.creditedHelp', 'Reductions from issued or posted credit notes')}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/90 shadow-[0_16px_40px_-32px_rgba(0,0,0,0.5)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.debitedAmount', 'Debited')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums text-status-info-foreground">{money(activeRow.debitedBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.debitedHelp', 'Increases from issued or posted debit notes')}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/95 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.56)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.currentLegalAmount', 'Current legal')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums font-semibold">{money(activeRow.currentLegalBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.currentLegalHelp', 'Original minus credits plus debits')}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/90 shadow-[0_16px_40px_-32px_rgba(0,0,0,0.5)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums">{money(activeRow.settledBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {tt('settlements.cashShort', 'Cash')}: <span className="font-mono tabular-nums">{money(activeRow.cashBase)}</span>{' '}
                        / {tt('settlements.bankShort', 'Bank')}: <span className="font-mono tabular-nums">{money(activeRow.bankBase)}</span>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/95 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.56)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums font-semibold">{money(activeRow.outstandingBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.outstandingHelp', 'Current legal minus settled')}</div>
                    </CardContent>
                  </Card>
                </div>

              <Tabs value={dialogTab} onValueChange={(value) => setDialogTab(value as 'settle' | 'history')}>
                <TabsList className="h-auto w-full justify-start gap-1 rounded-xl bg-muted/70 p-1 md:w-auto">
                  {canManageSettlement ? (
                    <TabsTrigger value="settle" className="min-w-[140px] rounded-lg">{tt('settlements.settleTab', 'Settle')}</TabsTrigger>
                  ) : null}
                  <TabsTrigger value="history" className="min-w-[140px] rounded-lg">{tt('settlements.historyTab', 'History')}</TabsTrigger>
                </TabsList>

                {canManageSettlement ? (
                  <TabsContent value="settle" className="mt-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label>{tt('settlements.method', 'Method')}</Label>
                      <Select value={settleMethod} onValueChange={(value) => setSettleMethod(value as 'cash' | 'bank')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">{tt('settlements.cashMethod', 'Cash')}</SelectItem>
                          <SelectItem value="bank">{tt('settlements.bankMethod', 'Bank')}</SelectItem>
                        </SelectContent>
                      </Select>
                      {bankRefsSupported === false && (
                        <p className="mt-2 text-xs text-muted-foreground">
              {tt('settlements.bankMigrationHint', 'Bank settlement references were unavailable on the last probe. StockWise will retry schema detection automatically before posting again.')}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label>{tt('settlements.amountBase', 'Amount ({code})', { code: baseCode })}</Label>
                      <Input inputMode="decimal" value={settleAmount} onChange={(event) => setSettleAmount(event.target.value)} />
                    </div>
                    <div>
                      <Label>{tt('table.date', 'Date')}</Label>
                      <Input type="date" value={settleDate} onChange={(event) => setSettleDate(event.target.value)} />
                    </div>
                    {settleMethod === 'bank' && (
                      <div>
                        <Label>{tt('banks.title', 'Banks')}</Label>
                        <Select value={settleBankId} onValueChange={setSettleBankId}>
                          <SelectTrigger><SelectValue placeholder={tt('settlements.selectBank', 'Select bank')} /></SelectTrigger>
                          <SelectContent>
                            {banks.length === 0 ? (
                              <SelectItem value="NONE" disabled>{tt('banks.empty', 'No banks yet.')}</SelectItem>
                            ) : (
                              banks.map(bank => <SelectItem key={bank.id} value={bank.id}>{bank.name}</SelectItem>)
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div>
                    <Label>{tt('cash.memo', 'Memo')}</Label>
                    <Input value={settleMemo} onChange={(event) => setSettleMemo(event.target.value)} />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setSettleAmount(activeRow.outstandingBase.toFixed(2))}>
                      {tt('settlements.fillOutstanding', 'Fill outstanding')}
                    </Button>
                    <Button variant="outline" onClick={() => viewOrder(activeRow)}>
                      {viewAnchorLabel(activeRow.kind)}
                    </Button>
                  </div>
                  </TabsContent>
                ) : null}

                <TabsContent value="history" className="mt-4">
                  {activeHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tt('settlements.historyEmpty', 'No settlements have been posted for this anchor yet.')}</p>
                  ) : (
                    <div className="max-h-[320px] overflow-auto rounded-xl border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left">
                            <th className="py-2 px-3">{tt('table.date', 'Date')}</th>
                            <th className="py-2 px-3">{tt('settlements.source', 'Source')}</th>
                            <th className="py-2 px-3">{tt('cash.memo', 'Memo')}</th>
                            <th className="py-2 px-3 text-right">{tt('settlements.amountBase', 'Amount ({code})', { code: baseCode })}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeHistory.map(entry => (
                            <tr key={entry.id} className="border-b">
                              <td className="py-2 px-3 whitespace-nowrap">{toIsoDate(entry.happenedAt) || entry.happenedAt}</td>
                              <td className="py-2 px-3">{entry.sourceLabel}</td>
                              <td className="py-2 px-3">{entry.memo || tt('common.dash', '-')}</td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums">{money(entry.amountBase)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
              </div>
            )}
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveRow(null)}>{tt('common.cancel', 'Cancel')}</Button>
            {canManageSettlement && dialogTab === 'settle' && (
              <Button onClick={submitSettlement} disabled={saving}>
                {saving ? tt('actions.saving', 'Saving') : activeRow ? settlementActionLabel(activeRow.kind) : tt('settlements.title', 'Receivables & Payables')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
