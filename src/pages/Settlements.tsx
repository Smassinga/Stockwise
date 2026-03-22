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

type SettlementRow = {
  kind: SettlementKind
  id: string
  orderNo: string
  counterparty: string
  orderDate: string | null
  dueDate: string | null
  currency: string
  workflowStatus: string
  workflowLabel: string
  balanceStatus: OrderSettlementStatus
  balanceLabel: string
  originalAmount: number
  originalBase: number
  settledBase: number
  outstandingBase: number
  agingDays: number
  history: HistoryRow[]
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

export default function SettlementsPage() {
  const { companyId, companyName } = useOrg()
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
  const settlementSummaryLabel = (status?: OrderSettlementStatus | null) => {
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

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [baseCode, setBaseCode] = useState('MZN')
  const [rows, setRows] = useState(emptyRows)
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [bankRefsSupported, setBankRefsSupported] = useState<boolean | null>(() => getBankTransactionRefSupport())

  const [tab, setTab] = useState<'receive' | 'pay'>('receive')
  const [search, setSearch] = useState('')
  const [partyFilter, setPartyFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [currencyFilter, setCurrencyFilter] = useState('ALL')
  const [dueFilter, setDueFilter] = useState<'all' | 'overdue' | 'due_soon' | 'current'>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const [activeRow, setActiveRow] = useState<SettlementRow | null>(null)
  const [dialogTab, setDialogTab] = useState<'settle' | 'history'>('settle')
  const [settleMethod, setSettleMethod] = useState<'cash' | 'bank'>('cash')
  const [settleAmount, setSettleAmount] = useState('')
  const [settleDate, setSettleDate] = useState(todayISO())
  const [settleMemo, setSettleMemo] = useState('')
  const [settleBankId, setSettleBankId] = useState('')

  const money = (amount: number) => formatMoneyBase(amount, baseCode, lang === 'pt' ? 'pt-MZ' : 'en-MZ')

  useEffect(() => {
    if (bankRefsSupported === false && settleMethod === 'bank') {
      setSettleMethod('cash')
    }
  }, [bankRefsSupported, settleMethod])

  useEffect(() => {
    if (!banks.length) return
    if (!settleBankId || !banks.some(bank => bank.id === settleBankId)) {
      setSettleBankId(banks[0].id)
    }
  }, [banks, settleBankId])

  useEffect(() => {
    if (!companyId) {
      setRows(emptyRows)
      setBanks([])
      setActiveRow(null)
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetchBankTransactions(bankIds: string[]) {
      if (!bankIds.length) return [] as BankTx[]

      if (getBankTransactionRefSupport() !== false) {
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
      }

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

        const [banksRes, soRes, poRes, cashRes] = await Promise.all([
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
            .from('cash_transactions')
            .select('id,happened_at,type,ref_type,ref_id,memo,amount_base')
            .eq('company_id', companyId)
            .in('ref_type', ['SO', 'PO']),
        ])

        if (banksRes.error) throw banksRes.error
        if (soRes.error) throw soRes.error
        if (poRes.error) throw poRes.error
        if (cashRes.error) throw cashRes.error

        const bankList = (banksRes.data || []) as BankAccount[]
        const bankTxRows = await fetchBankTransactions(bankList.map(bank => bank.id))
        const bankById = new Map(bankList.map(bank => [bank.id, bank]))

        const historyByKey = new Map<string, HistoryRow[]>()
        const settledByKey = new Map<string, number>()

        const pushHistory = (kind: SettlementKind, refId: string, entry: HistoryRow, amountBase: number) => {
          const key = `${kind}:${refId}`
          historyByKey.set(key, [...(historyByKey.get(key) || []), entry])
          settledByKey.set(key, (settledByKey.get(key) || 0) + normalizeSettledAmount(kind, amountBase))
        }

        for (const tx of (cashRes.data || []) as CashTx[]) {
          if ((tx.ref_type !== 'SO' && tx.ref_type !== 'PO') || !tx.ref_id) continue
          pushHistory(tx.ref_type, tx.ref_id, {
            id: tx.id,
            source: 'cash',
            sourceLabel: tt('settlements.cashSource', 'Cash'),
            happenedAt: tx.happened_at,
            amountBase: normalizeSettledAmount(tx.ref_type, n(tx.amount_base)),
            memo: tx.memo,
          }, n(tx.amount_base))
        }

        for (const tx of bankTxRows) {
          if ((tx.ref_type !== 'SO' && tx.ref_type !== 'PO') || !tx.ref_id) continue
          pushHistory(tx.ref_type, tx.ref_id, {
            id: tx.id,
            source: 'bank',
            sourceLabel: bankById.get(tx.bank_id)?.name || tt('settlements.bankSource', 'Bank'),
            happenedAt: tx.happened_at,
            amountBase: normalizeSettledAmount(tx.ref_type, n(tx.amount_base)),
            memo: tx.memo,
          }, n(tx.amount_base))
        }

        const receiveRows = ((soRes.data || []) as SalesOrderStateRow[])
          .filter(order => !isCancelled(order.legacy_status) && order.workflow_status !== 'cancelled')
          .map(order => {
            const settled = n(order.legacy_settled_base ?? settledByKey.get(`SO:${order.id}`))
            const outstanding = n(order.legacy_outstanding_base)
            const balanceStatus = order.settlement_status

            return {
              kind: 'SO' as const,
              id: order.id,
              orderNo: order.order_no || order.id,
              counterparty: order.counterparty_name || tt('common.none', 'None'),
              orderDate: order.order_date,
              dueDate: order.due_date,
              currency: order.currency_code || baseCurrency || 'MZN',
              workflowStatus: order.workflow_status,
              workflowLabel: salesWorkflowLabel(order.workflow_status),
              balanceStatus,
              balanceLabel: settlementSummaryLabel(balanceStatus),
              originalAmount: n(order.total_amount_ccy),
              originalBase: n(order.total_amount_base),
              settledBase: settled,
              outstandingBase: outstanding,
              agingDays: daysOverdue(order.due_date),
              history: (historyByKey.get(`SO:${order.id}`) || []).sort((a, b) => String(b.happenedAt).localeCompare(String(a.happenedAt))),
            }
          })
          .filter(row => row.outstandingBase > 0.005)
          .sort((a, b) => (b.agingDays - a.agingDays) || String(a.orderDate || '').localeCompare(String(b.orderDate || '')))

        const payRows = ((poRes.data || []) as PurchaseOrderStateRow[])
          .filter(order => !isCancelled(order.legacy_status) && order.workflow_status !== 'cancelled')
          .map(order => {
            const settled = n(order.legacy_paid_base ?? settledByKey.get(`PO:${order.id}`))
            const outstanding = n(order.legacy_outstanding_base)
            const balanceStatus = order.settlement_status

            return {
              kind: 'PO' as const,
              id: order.id,
              orderNo: order.order_no || order.id,
              counterparty: order.counterparty_name || tt('common.none', 'None'),
              orderDate: order.order_date,
              dueDate: order.due_date,
              currency: order.currency_code || baseCurrency || 'MZN',
              workflowStatus: order.workflow_status,
              workflowLabel: purchaseWorkflowLabel(order.workflow_status),
              balanceStatus,
              balanceLabel: settlementSummaryLabel(balanceStatus),
              originalAmount: n(order.total_amount_ccy),
              originalBase: n(order.total_amount_base),
              settledBase: settled,
              outstandingBase: outstanding,
              agingDays: daysOverdue(order.due_date),
              history: (historyByKey.get(`PO:${order.id}`) || []).sort((a, b) => String(b.happenedAt).localeCompare(String(a.happenedAt))),
            }
          })
          .filter(row => row.outstandingBase > 0.005)
          .sort((a, b) => (b.agingDays - a.agingDays) || String(a.orderDate || '').localeCompare(String(b.orderDate || '')))

        if (!cancelled) {
          setBaseCode(baseCurrency || 'MZN')
          setBanks(bankList)
          setRows({ receive: receiveRows, pay: payRows })
        }
      } catch (error: any) {
        console.error(error)
        if (!cancelled) {
          setRows(emptyRows)
          setBanks([])
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
        const haystack = `${row.orderNo} ${row.counterparty} ${row.workflowStatus} ${row.workflowLabel} ${row.balanceStatus} ${row.balanceLabel}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (partyFilter !== 'ALL' && row.counterparty !== partyFilter) return false
      if (statusFilter !== 'ALL' && String(row.workflowStatus).toLowerCase() !== statusFilter.toLowerCase()) return false
      if (currencyFilter !== 'ALL' && row.currency !== currencyFilter) return false
      if (fromDate && row.orderDate && row.orderDate < fromDate) return false
      if (toDate && row.orderDate && row.orderDate > toDate) return false
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

  function openSettlement(row: SettlementRow, nextDialogTab: 'settle' | 'history' = 'settle') {
    setActiveRow(row)
    setDialogTab(nextDialogTab)
    setSettleMethod('cash')
    setSettleAmount(row.outstandingBase.toFixed(2))
    setSettleDate(todayISO())
    setSettleMemo(buildSettlementMemo(row.kind, row.orderNo, {
      receive: tt('settlements.defaultReceiveMemo', 'Receipt for {orderNo}'),
      pay: tt('settlements.defaultPayMemo', 'Payment for {orderNo}'),
    }))
    setSettleBankId(banks[0]?.id || '')
  }

  async function submitSettlement() {
    if (!companyId || !activeRow) return

    const amount = n(settleAmount, Number.NaN)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tt('settlements.amountInvalid', 'Enter a settlement amount greater than zero'))
      return
    }
    if (amount > activeRow.outstandingBase + 0.005) {
      toast.error(tt('settlements.amountTooHigh', 'Settlement amount cannot exceed the outstanding balance'))
      return
    }

    const signedAmount = activeRow.kind === 'SO' ? amount : amount * -1
    setSaving(true)

    try {
      if (settleMethod === 'cash') {
        const { error } = await supabase.from('cash_transactions').insert({
          company_id: companyId,
          happened_at: settleDate,
          type: activeRow.kind === 'SO' ? 'sale_receipt' : 'purchase_payment',
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
        if (bankRefsSupported === false) {
          toast.error(tt('settlements.bankMigrationNeeded', 'Bank-linked settlements need the latest migration before they can be posted'))
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
          if (isMissingBankTransactionRefColumns(error)) {
            setBankTransactionRefSupport(false)
            setBankRefsSupported(false)
            throw new Error(tt('settlements.bankMigrationNeeded', 'Bank-linked settlements need the latest migration before they can be posted'))
          }
          throw error
        }
      }

      toast.success(activeRow.kind === 'SO' ? tt('settlements.receiptSaved', 'Receipt saved') : tt('settlements.paymentSaved', 'Payment saved'))
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
    navigate(`/orders?tab=${row.kind === 'SO' ? 'sales' : 'purchase'}&orderId=${row.id}`)
  }

  const activeHistory = activeRow?.history || []

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('settlements.eyebrow', 'Settlement workflow')}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('settlements.title', 'Receivables & Payables')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {tt('settlements.subtitle', 'Track legacy order-linked balances in one place during the transition, then post cash receipts or supplier payments without digging through recent transactions.')}
            </p>
          </div>
        </div>

        <Badge variant="outline" className="w-fit px-3 py-1 text-xs">
          {companyName || tt('company.selectCompany', 'Select company')}
        </Badge>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <p className="font-medium">{tt('settlements.transitionTitle', 'Legacy order-linked view')}</p>
        <p className="mt-1 leading-6">
          {tt(
            'settlements.transitionNote',
            'This screen still derives balances from linked orders and settlement rows. Shipped, received, approved, or completed orders can still be unpaid, and balance badges should be read separately from order workflow status.',
          )}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('settlements.pendingReceive', 'Pending to receive')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{money(receiveTotal)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('settlements.pendingReceiveHelp', '{count} sales orders still appear with legacy order-linked balances to collect.', { count: rows.receive.length })}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('settlements.pendingPay', 'Pending to pay')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{money(payTotal)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('settlements.pendingPayHelp', '{count} purchase orders still appear with legacy order-linked balances to pay.', { count: rows.pay.length })}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('settlements.overdue', 'Overdue balances')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{overdueCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('settlements.overdueHelp', 'Rows flagged overdue are ordered to the top using the currently derived order-linked due dates.')}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle>{tt('settlements.filters', 'Filters')}</CardTitle>
          <CardDescription>{tt('settlements.filtersHelp', 'Narrow by counterparty, order workflow status, order date, or derived due state without leaving the active company context.')}</CardDescription>
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
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tt('settlements.searchPlaceholder', 'Order number, customer, supplier, or workflow status')} />
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
          <CardDescription>
            {tab === 'receive'
              ? tt('settlements.receiveHelp', 'Sales orders stay here while this transition view still tracks outstanding balances against linked orders.')
              : tt('settlements.payHelp', 'Purchase orders stay here while this transition view still tracks outstanding balances against linked orders.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('settlements.empty', 'No legacy order-linked balances match the current filters.')}</p>
          ) : (
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{tt('orders.order', 'Order')}</th>
                  <th className="py-2 pr-3">{tt('settlements.counterparty', 'Counterparty')}</th>
                  <th className="py-2 pr-3">{tt('table.date', 'Date')}</th>
                  <th className="py-2 pr-3">{tt('orders.dueDate', 'Due Date')}</th>
                  <th className="py-2 pr-3 text-right">{tt('settlements.originalAmount', 'Original')}</th>
                  <th className="py-2 pr-3 text-right">{tt('settlements.settledAmount', 'Settled')}</th>
                  <th className="py-2 pr-3 text-right">{tt('settlements.outstandingAmount', 'Outstanding')}</th>
                  <th className="py-2 pr-3">{tt('settlements.balanceStatus', 'Balance status')}</th>
                  <th className="py-2 pr-3 text-right">{tt('settlements.aging', 'Aging')}</th>
                  <th className="py-2 text-right">{tt('orders.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={`${row.kind}:${row.id}`} className="border-b align-top">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{row.orderNo}</div>
                      <div className="text-xs text-muted-foreground">{row.workflowLabel ? `${row.kind} - ${row.workflowLabel}` : row.kind}</div>
                    </td>
                    <td className="py-3 pr-3">{row.counterparty}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{row.orderDate || tt('common.dash', '-')}</td>
                    <td className={`py-3 pr-3 whitespace-nowrap ${dueTone(row)}`}>
                      {row.dueDate || tt('common.dash', '-')}
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <div className="font-mono tabular-nums">{row.originalAmount.toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {row.currency}</div>
                      <div className="text-xs text-muted-foreground">{money(row.originalBase)}</div>
                    </td>
                    <td className="py-3 pr-3 text-right font-mono tabular-nums">{money(row.settledBase)}</td>
                    <td className="py-3 pr-3 text-right font-mono tabular-nums font-semibold">{money(row.outstandingBase)}</td>
                    <td className="py-3 pr-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row)}`}>
                        {row.balanceLabel}
                      </span>
                    </td>
                    <td className={`py-3 pr-3 text-right font-mono tabular-nums ${row.agingDays > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-muted-foreground'}`}>
                      {row.agingDays > 0 ? `${row.agingDays}d` : tt('common.dash', '-')}
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => openSettlement(row, 'settle')}>
                          {row.kind === 'SO' ? tt('settlements.receiveAction', 'Receive cash') : tt('settlements.payAction', 'Pay cash')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => viewOrder(row)}>
                          {tt('settlements.viewOrder', 'View order')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openSettlement(row, 'history')}>
                          {tt('settlements.viewHistory', 'History')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!activeRow} onOpenChange={(open) => { if (!open) setActiveRow(null) }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {activeRow
                ? `${activeRow.kind === 'SO' ? tt('settlements.receiveAction', 'Receive cash') : tt('settlements.payAction', 'Pay cash')} - ${activeRow.orderNo}`
                : tt('settlements.title', 'Receivables & Payables')}
            </DialogTitle>
            <DialogDescription>
              {activeRow
                ? tt('settlements.dialogHelp', 'Post a full or partial settlement, or review prior entries linked to this order. Order workflow and balance status can diverge during the transition.')
                : tt('settlements.subtitle', 'Track legacy order-linked balances')}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="pr-1">
            {activeRow && (
              <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <Card className="border-border/70 shadow-none">
                  <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</CardTitle></CardHeader>
                  <CardContent className="font-mono tabular-nums">{money(activeRow.originalBase)}</CardContent>
                </Card>
                <Card className="border-border/70 shadow-none">
                  <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</CardTitle></CardHeader>
                  <CardContent className="font-mono tabular-nums">{money(activeRow.settledBase)}</CardContent>
                </Card>
                <Card className="border-border/70 shadow-none">
                  <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</CardTitle></CardHeader>
                  <CardContent className="font-mono tabular-nums font-semibold">{money(activeRow.outstandingBase)}</CardContent>
                </Card>
                <Card className="border-border/70 shadow-none">
                  <CardHeader className="pb-2"><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{tt('orders.dueDate', 'Due Date')}</CardTitle></CardHeader>
                  <CardContent className={dueTone(activeRow)}>{activeRow.dueDate || tt('common.dash', '-')}</CardContent>
                </Card>
              </div>

              <Tabs value={dialogTab} onValueChange={(value) => setDialogTab(value as 'settle' | 'history')}>
                <TabsList className="h-auto w-full justify-start gap-1 rounded-xl bg-muted/70 p-1 md:w-auto">
                  <TabsTrigger value="settle" className="min-w-[140px] rounded-lg">{tt('settlements.settleTab', 'Settle')}</TabsTrigger>
                  <TabsTrigger value="history" className="min-w-[140px] rounded-lg">{tt('settlements.historyTab', 'History')}</TabsTrigger>
                </TabsList>

                <TabsContent value="settle" className="mt-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label>{tt('settlements.method', 'Method')}</Label>
                      <Select value={settleMethod} onValueChange={(value) => setSettleMethod(value as 'cash' | 'bank')}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">{tt('settlements.cashMethod', 'Cash')}</SelectItem>
                          <SelectItem value="bank" disabled={bankRefsSupported === false}>{tt('settlements.bankMethod', 'Bank')}</SelectItem>
                        </SelectContent>
                      </Select>
                      {bankRefsSupported === false && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {tt('settlements.bankMigrationHint', 'Bank settlements stay disabled until the bank transaction reference migration is applied and the page is refreshed.')}
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
                      {tt('settlements.viewOrder', 'View order')}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="history" className="mt-4">
                  {activeHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tt('settlements.historyEmpty', 'No settlements have been posted for this order yet.')}</p>
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
            {dialogTab === 'settle' && (
              <Button onClick={submitSettlement} disabled={saving}>
                {saving ? tt('actions.saving', 'Saving') : activeRow?.kind === 'SO' ? tt('settlements.receiveAction', 'Receive cash') : tt('settlements.payAction', 'Pay cash')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
