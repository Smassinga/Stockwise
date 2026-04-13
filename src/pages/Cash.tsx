import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { useI18n, withI18nFallback } from '../lib/i18n'
import type { SettlementKind } from '../lib/orderFinance'
import { fetchOrderReferenceMap, formatOrderReference } from '../lib/orderRefs'
import { financeCan } from '../lib/permissions'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/ui/sheet'

type CashSummary = { beginning: number; inflows: number; outflows: number; net: number; ending: number }
type CashTx = {
  id: string
  happened_at: string
  type: 'sale_receipt' | 'purchase_payment' | 'adjustment'
  ref_type: SettlementKind | 'ADJ' | null
  ref_id: string | null
  memo: string | null
  amount_base: number
  running_balance: number
}
type CashBook = {
  id: string
  company_id: string
  beginning_balance_base: number
  beginning_as_of: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthStartISO = () => {
  const date = new Date()
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const cashTone = (type: CashTx['type']) => {
  switch (type) {
    case 'sale_receipt':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
    case 'purchase_payment':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
  }
}

export default function CashPage() {
  const { t } = useI18n()
  const tf = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { companyId, companyName, myRole } = useOrg()
  const canManageSettlement = financeCan.settlementSensitive(myRole)

  const [from, setFrom] = useState<string>(monthStartISO())
  const [to, setTo] = useState<string>(todayISO())
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [summary, setSummary] = useState<CashSummary | null>(null)
  const [rows, setRows] = useState<CashTx[]>([])
  const [orderRefByKey, setOrderRefByKey] = useState<Record<string, string>>({})
  const [book, setBook] = useState<CashBook | null>(null)
  const [openAdd, setOpenAdd] = useState(false)
  const [savingBeg, setSavingBeg] = useState(false)
  const [savingTx, setSavingTx] = useState(false)
  const [baseCurrency, setBaseCurrency] = useState<string>('MZN')

  const [addForm, setAddForm] = useState<{
    date: string
    type: CashTx['type']
    amount: string
    memo: string
    refType: SettlementKind | 'ADJ' | 'none'
    refId: string
  }>({ date: todayISO(), type: 'sale_receipt', amount: '', memo: '', refType: 'none', refId: '' })

  useEffect(() => {
    if (canManageSettlement) return
    setAddForm((current) => {
      if (current.type === 'adjustment' && (current.refType === 'none' || current.refType === 'ADJ')) return current
      return {
        ...current,
        type: 'adjustment',
        refType: 'none',
        refId: '',
      }
    })
  }, [canManageSettlement])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const code = await getBaseCurrencyCode()
        if (mounted && code) setBaseCurrency(code)
      } catch (error) {
        console.warn('Failed to load base currency in Cash:', error)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!companyId) return
    loadBook()
    loadData()
  }, [companyId, from, to, typeFilter])

  async function loadBook() {
    if (!companyId) return
    const rpc = await supabase.rpc('cash_get_book', { p_company: companyId })
    if (!rpc.error && rpc.data) {
      const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data
      if (row) {
        setBook({
          id: row.id,
          company_id: row.company_id,
          beginning_balance_base: Number(row.beginning_balance_base ?? 0),
          beginning_as_of: String(row.beginning_as_of ?? todayISO()),
        })
        return
      }
      setBook(null)
      return
    }

    const { data, error } = await supabase
      .from('cash_books')
      .select('id, company_id, beginning_balance_base, beginning_as_of')
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) {
      console.warn('cash_books load skipped:', error.message)
      setBook(null)
      return
    }
    setBook(data as CashBook)
  }

  async function loadData() {
    const { data: sum, error: summaryError } = await supabase.rpc('cash_summary', {
      p_company: companyId,
      p_from: from,
      p_to: to,
    })
    if (summaryError) {
      console.warn('cash_summary not ready:', summaryError.message)
      setSummary({ beginning: 0, inflows: 0, outflows: 0, net: 0, ending: 0 })
    } else {
      const row: any = Array.isArray(sum) ? sum[0] : sum
      setSummary({
        beginning: Number(row?.beginning ?? 0),
        inflows: Number(row?.inflows ?? 0),
        outflows: Number(row?.outflows ?? 0),
        net: Number(row?.net ?? 0),
        ending: Number(row?.ending ?? 0),
      })
    }

    const { data: ledger, error: ledgerError } = await supabase.rpc('cash_ledger', {
      p_company: companyId,
      p_from: from,
      p_to: to,
    })
    if (ledgerError) {
      console.warn('cash_ledger not ready:', ledgerError.message)
      setRows([])
      setOrderRefByKey({})
      return
    }

    let list = (ledger as CashTx[]) || []
    if (typeFilter !== 'all') list = list.filter((row) => row.type === typeFilter)
    setRows(list)
    try {
      setOrderRefByKey(await fetchOrderReferenceMap(supabase, companyId, list))
    } catch (error) {
      console.warn('Failed to resolve cash order references:', error)
      setOrderRefByKey({})
    }
  }

  async function upsertBeginningBalance() {
    if (!companyId) return
    setSavingBeg(true)
    try {
      if (book?.id) {
        const { error } = await supabase
          .from('cash_books')
          .update({
            beginning_balance_base: book.beginning_balance_base,
            beginning_as_of: book.beginning_as_of,
          })
          .eq('id', book.id)
        if (error) throw error
        toast.success(tf('cash.toast.beginningUpdated', 'Beginning balance updated'))
      } else {
        const { data, error } = await supabase
          .from('cash_books')
          .insert({
            company_id: companyId,
            beginning_balance_base: 0,
            beginning_as_of: todayISO(),
          })
          .select()
          .single()
        if (error) throw error
        setBook(data as CashBook)
        toast.success(tf('cash.toast.beginningCreated', 'Beginning balance created'))
      }
      await loadData()
    } catch (error) {
      console.error(error)
      toast.error(tf('cash.toast.beginningSaveFailed', 'Failed to save beginning balance'))
    } finally {
      setSavingBeg(false)
    }
  }

  async function addTransaction() {
    if (!companyId) return
    const amount = Number(addForm.amount)
    if (!Number.isFinite(amount) || amount === 0) {
      toast.error(tf('cash.toast.amountNonZero', 'Amount must be non-zero'))
      return
    }

    const needsRef = addForm.refType === 'SO' || addForm.refType === 'PO' || addForm.refType === 'SI' || addForm.refType === 'VB'
    const disallowRef = addForm.refType === 'ADJ'
    const receiveAnchor = addForm.refType === 'SO' || addForm.refType === 'SI'
    const payAnchor = addForm.refType === 'PO' || addForm.refType === 'VB'

    if (receiveAnchor && addForm.type !== 'sale_receipt') {
      toast.error(tf('cash.toast.receiveAnchorTypeMismatch', 'Sales-order and sales-invoice references must use the sale receipt cash type.'))
      return
    }
    if (payAnchor && addForm.type !== 'purchase_payment') {
      toast.error(tf('cash.toast.payAnchorTypeMismatch', 'Purchase-order and vendor-bill references must use the purchase payment cash type.'))
      return
    }
    if (addForm.refType === 'ADJ' && addForm.type !== 'adjustment') {
      toast.error(tf('cash.toast.adjustmentTypeMismatch', 'Adjustment references must use the adjustment cash type.'))
      return
    }
    if (needsRef && !UUID_RE.test(addForm.refId)) {
      toast.error(tf('cash.toast.invalidRefUuid', 'Provide a valid internal reference ID (UUID) for the selected settlement anchor.'))
      return
    }
    if (disallowRef && addForm.refId.trim()) {
      toast.error(tf('cash.toast.adjustmentNoRef', 'Adjustments (ADJ) must not carry a reference ID.'))
      return
    }
    if (!canManageSettlement && (needsRef || addForm.type !== 'adjustment')) {
      toast.error(tf('financeDocs.approval.financeAuthorityRequired', 'Finance authority is required for legal-document issue, post, void, adjustment, and settlement actions.'))
      return
    }

    const payload = {
      company_id: companyId,
      happened_at: addForm.date,
      type: addForm.type,
      ref_type: addForm.refType === 'none' ? null : addForm.refType,
      ref_id: needsRef ? addForm.refId : null,
      memo: addForm.memo || null,
      amount_base: amount,
    }

    setSavingTx(true)
    try {
      const { error } = await supabase.from('cash_transactions').insert(payload)
      if (error) throw error

      toast.success(tf('cash.toast.added', 'Transaction added'))
      setOpenAdd(false)
      setAddForm({ date: todayISO(), type: 'sale_receipt', amount: '', memo: '', refType: 'none', refId: '' })
      await loadData()
    } catch (error) {
      console.error(error)
      toast.error(tf('cash.toast.addFailed', 'Could not add transaction'))
    } finally {
      setSavingTx(false)
    }
  }

  const cashTypeLabel = (type: CashTx['type']) => {
    if (type === 'sale_receipt') return tf('cash.saleReceipt', 'Sale receipt (in)')
    if (type === 'purchase_payment') return tf('cash.purchasePayment', 'Purchase payment (out)')
    return tf('cash.adjustment', 'Adjustment')
  }

  const referenceHref = (type: CashTx['ref_type'], id: string | null) => {
    if (!id) return null
    if (type === 'SI') return `/sales-invoices/${id}`
    if (type === 'VB') return `/vendor-bills/${id}`
    if (type === 'SO') return `/orders?tab=sales&orderId=${encodeURIComponent(id)}`
    if (type === 'PO') return `/orders?tab=purchase&orderId=${encodeURIComponent(id)}`
    return null
  }

  const summaryCards = useMemo(
    () => [
      { key: 'beginning', label: tf('cash.beginning', 'Beginning'), value: summary?.beginning ?? 0 },
      { key: 'inflows', label: tf('cash.inflows', 'Inflows'), value: summary?.inflows ?? 0 },
      { key: 'outflows', label: tf('cash.outflows', 'Outflows'), value: summary?.outflows ?? 0 },
      { key: 'net', label: tf('cash.net', 'Net'), value: summary?.net ?? 0 },
      { key: 'ending', label: tf('cash.ending', 'Ending'), value: summary?.ending ?? 0 },
    ],
    [summary, tf],
  )

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.05] p-6 shadow-[0_30px_80px_-56px_rgba(15,23,42,0.48)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-primary/75">
              {tf('cash.eyebrow', 'Treasury workspace')}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{tf('cash.title', 'Cash book')}</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {tf(
                  'cash.subtitle',
                  'Manage the company cash ledger, opening balance, and manual adjustments from one place. Settlement-linked receipts and payments still follow the finance authority rules and should normally be posted from Settlements.',
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 lg:items-end">
            <Badge variant="outline" className="px-3 py-1 text-xs">
              {companyName || tf('company.selectCompany', 'Select company')}
            </Badge>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/settlements">{tf('nav.settlements', 'Settlements')}</Link>
              </Button>
              <Sheet open={openAdd} onOpenChange={setOpenAdd}>
                <SheetTrigger asChild>
                  <Button>+ {tf('cash.addTx', 'Add transaction')}</Button>
                </SheetTrigger>
                <SheetContent className="sm:max-w-xl">
                  <SheetHeader>
                    <SheetTitle>{tf('cash.addCashTx', 'Add cash transaction')}</SheetTitle>
                    <SheetDescription>
                      {tf(
                        'cash.sheetDescription',
                        'Use this panel for opening-balance adjustments or other company cash movements. Settlement-linked entries must keep the correct finance anchor and cash type.',
                      )}
                    </SheetDescription>
                  </SheetHeader>
                  <SheetBody className="mt-5 pr-1">
                    <div className="space-y-6">
                      <Card className="border-border/70 shadow-none">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">{tf('cash.sheet.txTitle', 'Transaction setup')}</CardTitle>
                          <CardDescription>
                            {tf('cash.sheet.txHelp', 'Choose the right cash movement type first. Settlement-linked receipts and payments require finance authority and a matching anchor type.')}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2">
                            <Label>{tf('table.date', 'Date')}</Label>
                            <Input type="date" value={addForm.date} onChange={(e) => setAddForm((current) => ({ ...current, date: e.target.value }))} />
                          </div>
                          <div className="space-y-2">
                            <Label>{tf('filters.type', 'Type')}</Label>
                            <Select value={addForm.type} onValueChange={(value: any) => setAddForm((current) => ({ ...current, type: value }))}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="sale_receipt" disabled={!canManageSettlement}>{tf('cash.saleReceipt', 'Sale receipt (in)')}</SelectItem>
                                <SelectItem value="purchase_payment" disabled={!canManageSettlement}>{tf('cash.purchasePayment', 'Purchase payment (out)')}</SelectItem>
                                <SelectItem value="adjustment">{tf('cash.adjustment', 'Adjustment')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>{tf('cash.amount', 'Amount ({code})', { code: baseCurrency || 'MZN' })}</Label>
                            <Input
                              inputMode="decimal"
                              placeholder={tf('cash.placeholder.amount', 'e.g. 1500 or -450')}
                              value={addForm.amount}
                              onChange={(e) => setAddForm((current) => ({ ...current, amount: e.target.value }))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{tf('cash.memo', 'Memo')}</Label>
                            <Input
                              placeholder={tf('cash.optional', 'Optional')}
                              value={addForm.memo}
                              onChange={(e) => setAddForm((current) => ({ ...current, memo: e.target.value }))}
                            />
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-border/70 shadow-none">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-base">{tf('cash.sheet.anchorTitle', 'Settlement anchor')}</CardTitle>
                          <CardDescription>
                            {tf('cash.sheet.anchorHelp', 'Leave the anchor empty for pure cash adjustments. Use the correct internal document or order ID only when you are intentionally linking the cash movement to settlement history.')}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-3">
                          <div className="space-y-2">
                            <Label>{tf('filters.ref', 'Reference')}</Label>
                            <Select value={addForm.refType} onValueChange={(value: any) => setAddForm((current) => ({ ...current, refType: value }))}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">{tf('common.none', 'None')}</SelectItem>
                                <SelectItem value="SO" disabled={!canManageSettlement}>SO</SelectItem>
                                <SelectItem value="PO" disabled={!canManageSettlement}>PO</SelectItem>
                                <SelectItem value="SI" disabled={!canManageSettlement}>SI</SelectItem>
                                <SelectItem value="VB" disabled={!canManageSettlement}>VB</SelectItem>
                                <SelectItem value="ADJ">ADJ</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label>{tf('movements.refId', 'Reference ID')}</Label>
                            <Input
                              placeholder={tf('cash.placeholder.refId', 'Internal reference ID (UUID)')}
                              value={addForm.refId}
                              onChange={(e) => setAddForm((current) => ({ ...current, refId: e.target.value }))}
                            />
                          </div>
                        </CardContent>
                      </Card>

                      {!canManageSettlement ? (
                        <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                          {tf('cash.financeAuthorityNotice', 'Only finance-authority users can post settlement-linked cash receipts and payments.')}
                        </div>
                      ) : null}

                      <div className="flex justify-end">
                        <Button disabled={savingTx} onClick={addTransaction}>
                          {savingTx ? tf('actions.saving', 'Saving...') : tf('cash.add', 'Add')}
                        </Button>
                      </div>
                    </div>
                  </SheetBody>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </div>

      {!canManageSettlement ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          {tf('cash.readOnlySettlement', 'Settlement-linked cash posting remains visible here for context, but only finance-authority users can post receipts and payments against legal settlement anchors.')}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle>{tf('cash.filtersTitle', 'Ledger filters')}</CardTitle>
            <CardDescription>
              {tf('cash.filtersHelpRefined', 'Narrow the visible cash ledger by date range and movement type without leaving the active company context.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{tf('filters.from', 'From')}</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{tf('filters.to', 'To')}</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{tf('filters.type', 'Type')}</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder={tf('filters.type.all', 'All')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tf('cash.allTypes', 'All')}</SelectItem>
                  <SelectItem value="sale_receipt">{tf('cash.saleReceipt', 'Sale receipt (in)')}</SelectItem>
                  <SelectItem value="purchase_payment">{tf('cash.purchasePayment', 'Purchase payment (out)')}</SelectItem>
                  <SelectItem value="adjustment">{tf('cash.adjustment', 'Adjustment')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-muted/20">
          <CardHeader className="pb-3">
            <CardTitle>{tf('cash.policyTitle', 'Posting policy')}</CardTitle>
            <CardDescription>
              {tf('cash.settlementsHint', 'Use Settlements when you need cash movements to hit a sales invoice, vendor bill, sales order, or purchase order settlement chain. Use this page for the company cash book and controlled manual entries.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/settlements">{tf('cash.openSettlements', 'Open Settlements')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {summaryCards.map((card) => (
          <Card key={card.key} className="border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold tracking-tight">
              {formatMoneyBase(card.value)}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle>{tf('cash.beginningBalance', 'Beginning balance')}</CardTitle>
            <CardDescription>
              {tf('cash.beginningHelp', 'This cash book uses one company-level opening balance and opening date. Keep it aligned with the period you want the ledger to roll forward from.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_auto] md:items-end">
            <div className="space-y-2">
              <Label>{tf('cash.asOf', 'As of')}</Label>
              <Input
                type="date"
                value={book?.beginning_as_of ?? todayISO()}
                onChange={(e) =>
                  setBook((current) =>
                    current
                      ? { ...current, beginning_as_of: e.target.value }
                      : { id: '', company_id: companyId!, beginning_balance_base: 0, beginning_as_of: e.target.value },
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{tf('cash.amount', 'Amount ({code})', { code: baseCurrency || 'MZN' })}</Label>
              <Input
                inputMode="decimal"
                value={String(book?.beginning_balance_base ?? 0)}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  setBook((current) =>
                    current
                      ? { ...current, beginning_balance_base: value }
                      : { id: '', company_id: companyId!, beginning_balance_base: value, beginning_as_of: todayISO() },
                  )
                }}
              />
            </div>
            <Button onClick={upsertBeginningBalance} disabled={savingBeg}>
              {savingBeg
                ? tf('actions.saving', 'Saving...')
                : book?.id
                  ? tf('cash.update', 'Update')
                  : tf('cash.create', 'Create')}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.03]">
          <CardHeader className="pb-3">
            <CardTitle>{tf('cash.workspaceTitle', 'Cash book guidance')}</CardTitle>
            <CardDescription>
              {tf('cash.workspaceHelp', 'Keep ordinary cash operations clear: the cash book is a company ledger, not a catch-all for bank settlements or unresolved finance postings.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              {tf('cash.guidance.one', 'Use the opening balance section to set the starting position for the company cash ledger.')}
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              {tf('cash.guidance.two', 'Use manual transactions for genuine cash-book adjustments or direct cash movements that are not better handled through the bank workspace.')}
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              {tf('cash.guidance.three', 'Use Settlements for receipt and payment posting against the active legal finance anchor so cash history, reconciliation, and document chains stay aligned.')}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden border-border/70">
        <CardHeader className="pb-3">
          <CardTitle>{tf('cash.ledger', 'Transactions')}</CardTitle>
          <CardDescription>
            {tf('cash.ledgerHelp', 'Review every visible cash-book movement with anchor context, memo, signed value, and running balance.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto overflow-y-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-left">
              <tr>
                <th className="py-2 pr-3">{tf('table.date', 'Date')}</th>
                <th className="py-2 pr-3">{tf('filters.type', 'Type')}</th>
                <th className="py-2 pr-3">{tf('table.ref', 'Reference')}</th>
                <th className="py-2 pr-3">{tf('bank.memo', 'Memo')}</th>
                <th className="py-2 pr-3 text-right">{tf('cash.amount', 'Amount ({code})', { code: baseCurrency || 'MZN' })}</th>
                <th className="py-2 pl-3 text-right">{tf('cash.running', 'Running')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = referenceHref(row.ref_type, row.ref_id)
                return (
                  <tr key={row.id} className="border-t border-border/70">
                    <td className="py-3 pr-3 align-top">{row.happened_at}</td>
                    <td className="py-3 pr-3 align-top">
                      <Badge variant="outline" className={cashTone(row.type)}>
                        {cashTypeLabel(row.type)}
                      </Badge>
                    </td>
                    <td className="py-3 pr-3 align-top">
                      {href ? (
                        <Link className="text-primary underline-offset-4 hover:underline" to={href}>
                          {formatOrderReference(row.ref_type, row.ref_id, orderRefByKey, tf('common.dash', '—'))}
                        </Link>
                      ) : (
                        formatOrderReference(row.ref_type, row.ref_id, orderRefByKey, tf('common.dash', '—'))
                      )}
                    </td>
                    <td className="py-3 pr-3 align-top text-muted-foreground">{row.memo ?? tf('common.dash', '—')}</td>
                    <td className="py-3 pr-3 text-right align-top">{formatMoneyBase(row.amount_base)}</td>
                    <td className="py-3 pl-3 text-right align-top font-medium">{formatMoneyBase(row.running_balance)}</td>
                  </tr>
                )
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted-foreground">
                    {tf('cash.emptyLedger', 'No cash-book transactions match the current filters.')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
