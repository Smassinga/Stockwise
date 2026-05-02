import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Badge } from '../components/ui/badge'
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
import { financeCan } from '../lib/permissions'
import {
  salesInvoiceWorkflowLabelKey,
  vendorBillWorkflowLabelKey,
  type FinanceDocumentSettlementStatus,
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
  type OrderSettlementStatus,
  type PurchaseOrderStateRow,
  type SalesOrderStateRow,
} from '../lib/orderState'

type CashTx = {
  id: string
  happened_at: string
  type: 'sale_receipt' | 'purchase_payment' | 'adjustment'
  ref_type: SettlementKind | 'ADJ' | null
  ref_id: string | null
  memo: string | null
  amount_base: number
}

type BankTx = {
  id: string
  bank_id: string
  happened_at: string
  memo: string | null
  amount_base: number
  created_at?: string | null
  ref_type?: SettlementKind | null
  ref_id?: string | null
}

type BankAccount = {
  id: string
  name: string
  currency_code?: string | null
}

type HistoryRow = {
  id: string
  source: 'cash' | 'bank'
  sourceLabel: string
  happenedAt: string
  amountBase: number
  memo: string | null
}

type SettlementBalanceStatus = OrderSettlementStatus | FinanceDocumentSettlementStatus

type SettlementRow = {
  kind: SettlementKind
  id: string
  reference: string
  counterparty: string
  documentDate: string | null
  dueDate: string | null
  currency: string
  workflowStatus: string
  workflowLabel: string
  balanceStatus: SettlementBalanceStatus
  balanceLabel: string
  originalAmount: number
  originalBase: number
  creditedBase: number
  debitedBase: number
  currentLegalBase: number
  settledBase: number
  outstandingBase: number
  cashBase: number
  bankBase: number
  agingDays: number
  history: HistoryRow[]
  sourceLabel: string
}

function isMissingStateViewError(error: any, viewName: string) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  const name = viewName.toLowerCase()

  return code === 'PGRST205'
    || ((message.includes(name) || details.includes(name) || hint.includes(name))
      && (
        message.includes('could not find')
        || message.includes('does not exist')
        || details.includes('does not exist')
        || hint.includes('schema cache')
      ))
}

const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const emptyRows = { receive: [] as SettlementRow[], pay: [] as SettlementRow[] }
const isCancelled = (status?: string | null) => ['cancelled', 'canceled'].includes(String(status || '').toLowerCase())

const statusTone = (row: SettlementRow) => {
  if (row.outstandingBase <= 0.005) return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (row.agingDays > 0) return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
  if (row.settledBase > 0) return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
}

const dueTone = (row: SettlementRow) => {
  if (!row.dueDate) return 'text-muted-foreground'
  if (row.agingDays > 0) return 'text-rose-600 dark:text-rose-300'
  return 'text-foreground'
}

const isFinanceDocumentRow = (row: SettlementRow) => row.kind === 'SI' || row.kind === 'VB'

const reviewTone = (state: FinanceReviewState) => {
  switch (state) {
    case 'exception':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
    case 'overdue':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
    case 'attention':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
    case 'resolved':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
    default:
      return 'border-border/70 bg-muted/30 text-muted-foreground'
  }
}

const exceptionSeverityTone = (severity: FinanceReconciliationExceptionRow['severity']) =>
  severity === 'critical'
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'

export default function SettlementsPage() {
  const { companyId, companyName, myRole } = useOrg()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
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
  const [refreshKey, setRefreshKey] = useState(0)
  const [baseCode, setBaseCode] = useState('MZN')
  const [rows, setRows] = useState(emptyRows)
  const [stateViewsUnavailable, setStateViewsUnavailable] = useState(false)
  const [reconciliationViewsUnavailable, setReconciliationViewsUnavailable] = useState(false)
  const [reviewRows, setReviewRows] = useState<FinanceReconciliationRow[]>([])
  const [reviewExceptions, setReviewExceptions] = useState<FinanceReconciliationExceptionRow[]>([])
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [bankRefsSupported, setBankRefsSupported] = useState<boolean | null>(() => getBankTransactionRefSupport())

  const [workspace, setWorkspace] = useState<'settlement' | 'reconciliation'>('settlement')
  const [tab, setTab] = useState<'receive' | 'pay'>('receive')
  const [search, setSearch] = useState('')
  const [partyFilter, setPartyFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [currencyFilter, setCurrencyFilter] = useState('ALL')
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'due_soon' | 'current'>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reviewSide, setReviewSide] = useState<FinanceReconciliationRow['ledger_side']>('AR')
  const [reviewSearch, setReviewSearch] = useState('')
  const [reviewPartyFilter, setReviewPartyFilter] = useState('ALL')
  const [reviewCurrencyFilter, setReviewCurrencyFilter] = useState('ALL')
  const [reviewDueFilter, setReviewDueFilter] = useState<'all' | 'overdue' | 'due_soon' | 'current' | 'resolved' | 'undated'>('all')
  const [reviewStateFilter, setReviewStateFilter] = useState<'all' | FinanceReviewState>('all')
  const [reviewFromDate, setReviewFromDate] = useState('')
  const [reviewToDate, setReviewToDate] = useState('')

  const [activeRow, setActiveRow] = useState<SettlementRow | null>(null)
  const [dialogTab, setDialogTab] = useState<'settle' | 'history'>('settle')
  const [settleMethod, setSettleMethod] = useState<'cash' | 'bank'>('cash')
  const [settleAmount, setSettleAmount] = useState('')
  const [settleDate, setSettleDate] = useState(todayISO())
  const [settleMemo, setSettleMemo] = useState('')
  const [settleBankId, setSettleBankId] = useState('')

  const money = (amount: number) => formatMoneyBase(amount, baseCode, lang === 'pt' ? 'pt-MZ' : 'en-MZ')

  useEffect(() => {
    if (!banks.length) return
    if (!settleBankId || !banks.some(bank => bank.id === settleBankId)) {
      setSettleBankId(banks[0].id)
    }
  }, [banks, settleBankId])

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

      return ((fallback.data || []) as any[]).map(row => ({
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
          supabase.from('bank_accounts').select('id,name,currency_code').eq('company_id', companyId).order('name', { ascending: true }),
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
              reference: order.order_no || order.id,
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
          .filter(row => row.outstandingBase > 0.005)
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
          .filter(row => row.outstandingBase > 0.005)
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
              reference: order.order_no || order.id,
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
          .filter(row => row.outstandingBase > 0.005)
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
          .filter(row => row.outstandingBase > 0.005)
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
          setStateViewsUnavailable(false)
          setReconciliationViewsUnavailable(false)
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

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return currentRows.filter(row => {
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
  }, [currentRows, currencyFilter, dueFilter, fromDate, partyFilter, search, statusFilter, toDate])
  const filteredBridgeTotals = useMemo(() => ({
    originalBase: filteredRows.reduce((sum, row) => sum + row.originalBase, 0),
    creditedBase: filteredRows.reduce((sum, row) => sum + row.creditedBase, 0),
    debitedBase: filteredRows.reduce((sum, row) => sum + row.debitedBase, 0),
    currentLegalBase: filteredRows.reduce((sum, row) => sum + row.currentLegalBase, 0),
    settledBase: filteredRows.reduce((sum, row) => sum + row.settledBase, 0),
    outstandingBase: filteredRows.reduce((sum, row) => sum + row.outstandingBase, 0),
  }), [filteredRows])

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

    const amount = n(settleAmount, Number.NaN)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tt('settlements.amountInvalid', 'Enter a settlement amount greater than zero'))
      return
    }
    if (amount > activeRow.outstandingBase + 0.005) {
      toast.error(tt('settlements.amountTooHigh', 'Settlement amount cannot exceed the outstanding balance'))
      return
    }

    const signedAmount = activeRow.kind === 'SO' || activeRow.kind === 'SI' ? amount : amount * -1
    setSaving(true)

    try {
      if (settleMethod === 'cash') {
        const { error } = await supabase.from('cash_transactions').insert({
          company_id: companyId,
          happened_at: settleDate,
          type: activeRow.kind === 'SO' || activeRow.kind === 'SI' ? 'sale_receipt' : 'purchase_payment',
          ref_type: activeRow.kind,
          ref_id: activeRow.id,
          memo: settleMemo || null,
          amount_base: signedAmount,
        })
        if (error) throw error
      } else {
        if (!settleBankId) {
          toast.error(tt('settlements.bankRequired', 'Choose a bank account before posting a bank settlement'))
          return
        }

        const { error } = await supabase.from('bank_transactions').insert({
          bank_id: settleBankId,
          happened_at: settleDate,
          memo: settleMemo || null,
          amount_base: signedAmount,
          reconciled: false,
          ref_type: activeRow.kind,
          ref_id: activeRow.id,
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
      }

      toast.success(activeRow.kind === 'SO' || activeRow.kind === 'SI'
        ? tt('settlements.receiptSaved', 'Receipt saved')
        : tt('settlements.paymentSaved', 'Payment saved'))
      setActiveRow(null)
      setDialogTab('settle')
      setSettleAmount('')
      setSettleMemo('')
      setSettleDate(todayISO())
      setRefreshKey(key => key + 1)
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('settlements.saveFailed', 'Failed to save settlement'))
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

  const activeHistory = activeRow?.history || []

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('settlements.eyebrow', 'Settlement workflow')}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('settlements.title', 'Receivables & Payables')}</h1>
            <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
              {tt('settlements.subtitle', 'Track receivables and payables from the current settlement truth. Orders remain temporary placeholders only until a sales invoice or vendor bill becomes the anchor.')}
            </p>
          </div>
        </div>

        <Badge variant="outline" className="w-fit px-3 py-1 text-xs">
          {companyName || tt('company.selectCompany', 'Select company')}
        </Badge>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 sm:p-4">
        <p className="font-medium">{tt('settlements.transitionTitle', 'Settlement anchor policy')}</p>
        <p className="mt-1 hidden leading-6 sm:block">
          {tt(
            'settlements.transitionNote',
            'Approved orders can hold temporary settlement exposure only until the finance document exists. Once a sales invoice is issued or a vendor bill is posted, the finance document becomes the single settlement anchor and prior cash links are reassociated there.',
          )}
        </p>
      </div>

      {!canManageSettlement ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          {tt('settlements.financeAuthorityNotice', 'Settlement history remains visible, but only finance-authority users can post settlement entries from this workspace.')}
        </div>
      ) : null}

      <Tabs value={workspace} onValueChange={(value) => setWorkspace(value as 'settlement' | 'reconciliation')} className="space-y-6">
        <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.04] p-4 shadow-[0_28px_80px_-54px_rgba(15,23,42,0.52)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/75">
                {tt('settlements.workspaceEyebrow', 'Phase 3 reconciliation')}
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  {tt('settlements.workspaceTitle', 'Settlement operations and controller review')}
                </h2>
                <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
                  {tt(
                    'settlements.workspaceHelp',
                    'Use the operational workspace to post receipts and payments. Use reconciliation review to bridge original value, adjustments, settlement, current legal exposure, due position, and exceptions from the active finance anchor.',
                  )}
                </p>
              </div>
            </div>
            <TabsList className="h-auto w-full justify-start gap-1 rounded-2xl bg-muted/70 p-1 lg:w-auto">
              <TabsTrigger value="settlement" className="min-w-[190px] rounded-xl">
                {tt('settlements.workspaceSettlement', 'Settlement workflow')}
              </TabsTrigger>
              <TabsTrigger value="reconciliation" className="min-w-[190px] rounded-xl">
                {tt('settlements.workspaceReconciliation', 'Reconciliation review')}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="settlement" className="mt-0 space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('settlements.pendingReceive', 'Pending to receive')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{money(receiveTotal)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('settlements.pendingReceiveHelp', '{count} receivable anchors are open across sales orders awaiting issue and issued sales invoices.', { count: rows.receive.length })}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('settlements.pendingPay', 'Pending to pay')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{money(payTotal)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('settlements.pendingPayHelp', '{count} payable anchors are open across purchase orders awaiting booking and posted vendor bills.', { count: rows.pay.length })}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('settlements.overdue', 'Overdue balances')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{overdueCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('settlements.overdueHelp', 'Overdue rows are ranked using the due date of the active settlement anchor, whether that anchor is still an order or already a finance document.')}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 bg-gradient-to-br from-background via-background to-primary/[0.03] shadow-[0_24px_70px_-48px_rgba(15,23,42,0.45)]">
        <CardHeader className="pb-3">
          <CardTitle>{tt('settlements.filters', 'Filters')}</CardTitle>
          <CardDescription className="hidden sm:block">{tt('settlements.filtersHelp', 'Filter by counterparty, anchor type, workflow, anchor date, or due state without leaving the active company context.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(value) => setTab(value as 'receive' | 'pay')}>
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
          {stateViewsUnavailable && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {tt('settlements.stateViewsUnavailable', 'The settlement state views are not available yet. Apply the settlement-anchor migration and refresh this page.')}
            </div>
          )}
          {loading ? (
            <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
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
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.originalBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.originalAmountHelp', 'Issued or posted starting amount before adjustments and settlements')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.adjustmentsAmount', 'Adjustments')}</div>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex items-center justify-between gap-3 text-rose-700 dark:text-rose-300">
                        <span>{tt('settlements.creditedAmount', 'Credited')}</span>
                        <span className="font-mono font-semibold tabular-nums">{money(filteredBridgeTotals.creditedBase)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sky-700 dark:text-sky-300">
                        <span>{tt('settlements.debitedAmount', 'Debited')}</span>
                        <span className="font-mono font-semibold tabular-nums">{money(filteredBridgeTotals.debitedBase)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.52)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.currentLegalAmount', 'Current legal')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.currentLegalBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.currentLegalHelp', 'Original minus credits plus debits')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.settledBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.settledAmountHelp', 'Actual cash and bank settlement only')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.52)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.outstandingBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.outstandingHelp', 'Current legal minus settled')}</div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/95 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.48)]">
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
                          <span className="font-mono tabular-nums text-rose-700 dark:text-rose-300">{money(row.creditedBase)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted-foreground">{tt('settlements.debitedAmount', 'Debited')}</span>
                          <span className="font-mono tabular-nums text-sky-700 dark:text-sky-300">{money(row.debitedBase)}</span>
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
                    <td className={`px-4 py-4 text-right font-mono tabular-nums ${row.agingDays > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-muted-foreground'}`}>
                      {row.agingDays > 0 ? `${row.agingDays}d` : tt('common.dash', '-')}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {canManageSettlement ? (
                          <Button size="sm" className="shadow-sm transition-transform duration-200 hover:-translate-y-0.5" onClick={() => openSettlement(row, 'settle')}>
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

          <Card className="border-border/80 bg-gradient-to-br from-background via-background to-primary/[0.03] shadow-[0_24px_70px_-48px_rgba(15,23,42,0.45)]">
            <CardHeader className="pb-3">
              <CardTitle>{tt('financeDocs.reconciliation.filters', 'Review filters')}</CardTitle>
              <CardDescription className="hidden sm:block">{tt('financeDocs.reconciliation.filtersHelp', 'Switch between AR and AP, then filter by counterparty, due position, review state, currency, or document date without leaving the active company.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={reviewSide} onValueChange={(value) => setReviewSide(value as FinanceReconciliationRow['ledger_side'])}>
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
            <Card className="border-amber-200 bg-amber-50/80 text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <CardContent className="pt-6 text-sm">
                {tt('financeDocs.reconciliation.viewsUnavailable', 'The reconciliation review views are not available yet. Apply the Phase 3A reconciliation migration and refresh this page.')}
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
                          className="rounded-2xl border border-border/70 bg-background/95 p-4 text-left shadow-[0_18px_48px_-34px_rgba(15,23,42,0.45)] transition-transform duration-200 hover:-translate-y-0.5 hover:border-primary/30"
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
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.original)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.adjustmentsAmount', 'Adjustments')}</div>
                        <div className={`mt-2 font-mono text-lg font-semibold tabular-nums ${reviewTotals.netAdjustments < 0 ? 'text-rose-700 dark:text-rose-300' : reviewTotals.netAdjustments > 0 ? 'text-sky-700 dark:text-sky-300' : ''}`}>{money(reviewTotals.netAdjustments)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.52)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.currentLegal)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.settled)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.52)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.outstanding)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.45)]">
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
                    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/95 shadow-[0_24px_70px_-48px_rgba(15,23,42,0.48)]">
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
                              <td className={`px-4 py-4 text-right font-mono tabular-nums ${n(row.net_adjustment_base) < 0 ? 'text-rose-700 dark:text-rose-300' : n(row.net_adjustment_base) > 0 ? 'text-sky-700 dark:text-sky-300' : ''}`}>{money(n(row.net_adjustment_base))}</td>
                              <td className="px-4 py-4 text-right font-mono tabular-nums font-semibold">{money(n(row.current_legal_total_base))}</td>
                              <td className="px-4 py-4 text-right font-mono tabular-nums">{money(n(row.settled_base))}</td>
                              <td className="px-4 py-4 text-right">
                                <div className="font-mono tabular-nums font-semibold">{money(n(row.outstanding_base))}</div>
                                {n(row.over_settled_base) > 0.005 ? (
                                  <div className="mt-1 text-xs text-rose-700 dark:text-rose-300">
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
                                <div className="font-medium">{String(row.resolution_status || row.settlement_status || tt('common.dash', '-')).replaceAll('_', ' ')}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{String(row.adjustment_status || row.credit_status || tt('common.dash', '-')).replaceAll('_', ' ')}</div>
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
                <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.05] p-5 shadow-[0_28px_80px_-52px_rgba(15,23,42,0.55)]">
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
                      <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.55)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('table.date', 'Date')}</div>
                        <div className="mt-2 text-sm font-medium">{activeRow.documentDate || tt('common.dash', '-')}</div>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.55)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('orders.dueDate', 'Due Date')}</div>
                        <div className={`mt-2 text-sm font-medium ${dueTone(activeRow)}`}>{activeRow.dueDate || tt('common.dash', '-')}</div>
                      </div>
                      <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.55)]">
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
                  <Card className="border-border/70 bg-background/90 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.5)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums">{money(activeRow.originalBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.originalAmountHelp', 'Issued or posted starting amount before adjustments and settlements')}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/90 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.5)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.creditedAmount', 'Credited')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums text-rose-700 dark:text-rose-300">{money(activeRow.creditedBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.creditedHelp', 'Reductions from issued or posted credit notes')}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/90 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.5)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.debitedAmount', 'Debited')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums text-sky-700 dark:text-sky-300">{money(activeRow.debitedBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.debitedHelp', 'Increases from issued or posted debit notes')}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/95 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.56)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.currentLegalAmount', 'Current legal')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums font-semibold">{money(activeRow.currentLegalBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.currentLegalHelp', 'Original minus credits plus debits')}</div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/90 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.5)]">
                    <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</CardTitle></CardHeader>
                    <CardContent>
                      <div className="font-mono tabular-nums">{money(activeRow.settledBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {tt('settlements.cashShort', 'Cash')}: <span className="font-mono tabular-nums">{money(activeRow.cashBase)}</span>{' '}
                        / {tt('settlements.bankShort', 'Bank')}: <span className="font-mono tabular-nums">{money(activeRow.bankBase)}</span>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-border/70 bg-background/95 shadow-[0_18px_48px_-32px_rgba(15,23,42,0.56)]">
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
