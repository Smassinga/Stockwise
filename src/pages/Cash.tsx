// src/pages/Cash.tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '../components/ui/sheet'
import toast from 'react-hot-toast'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { useI18n, withI18nFallback } from '../lib/i18n'
import type { SettlementKind } from '../lib/orderFinance'
import { fetchOrderReferenceMap, formatOrderReference } from '../lib/orderRefs'
import { financeCan } from '../lib/permissions'

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
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

// ✅ strict RFC4122-ish UUID check (prevents 400 on ref_id)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default function CashPage() {
  const { t } = useI18n()
  const { companyId, myRole } = useOrg()
  const tf = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
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
  // Resolve base currency via effect; fallback to MZN
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
      } catch (e) {
        console.warn('Failed to load base currency in Cash:', e)
      }
    })()
    return () => { mounted = false }
  }, [])

  // Load all data whenever company or filters change
  useEffect(() => {
    if (!companyId) return
    loadBook()
    loadData()
  }, [companyId, from, to, typeFilter])

  async function loadBook() {
    if (!companyId) return
    // Prefer SECURITY DEFINER RPC if available
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
    // Fallback to direct select (in case RPC isn’t deployed in dev)
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
    const { data: sum, error: e1 } = await supabase.rpc('cash_summary', {
      p_company: companyId,
      p_from: from,
      p_to: to, // inclusive handled in SQL
    })
    if (e1) {
      console.warn('cash_summary not ready:', e1.message)
      setSummary({ beginning: 0, inflows: 0, outflows: 0, net: 0, ending: 0 })
    } else {
      const s: any = Array.isArray(sum) ? sum[0] : sum
      setSummary({
        beginning: Number(s?.beginning ?? 0),
        inflows: Number(s?.inflows ?? 0),
        outflows: Number(s?.outflows ?? 0),
        net: Number(s?.net ?? 0),
        ending: Number(s?.ending ?? 0),
      })
    }

    const { data: ledger, error: e2 } = await supabase.rpc('cash_ledger', {
      p_company: companyId,
      p_from: from,
      p_to: to,
    })
    if (e2) {
      console.warn('cash_ledger not ready:', e2.message)
      setRows([])
      setOrderRefByKey({})
      return
    }
    let list = (ledger as CashTx[]) || []
    if (typeFilter !== 'all') list = list.filter((r) => r.type === typeFilter)
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
    } catch (err: any) {
      toast.error(tf('cash.toast.beginningSaveFailed', 'Failed to save beginning balance'))
      console.error(err)
    } finally {
      setSavingBeg(false)
    }
  }

  async function addTransaction() {
    if (!companyId) return
    const amt = Number(addForm.amount)
    if (!Number.isFinite(amt) || amt === 0) {
      toast.error(tf('cash.toast.amountNonZero', 'Amount must be non-zero'))
      return
    }

    // ✅ enforce ref semantics BEFORE hitting the DB
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

    // ✅ normalize payload (null out ref_id unless needed)
    const payload = {
      company_id: companyId,
      happened_at: addForm.date,
      type: addForm.type,
      ref_type: addForm.refType === 'none' ? null : addForm.refType,
      ref_id: needsRef ? addForm.refId : null,
      memo: addForm.memo || null,
      amount_base: amt,
    }

    setSavingTx(true)
    try {
      const { error } = await supabase.from('cash_transactions').insert(payload)
      if (error) throw error
      toast.success(tf('cash.toast.added', 'Transaction added'))
      setOpenAdd(false)
      setAddForm({ date: todayISO(), type: 'sale_receipt', amount: '', memo: '', refType: 'none', refId: '' })
      await loadData()
    } catch (err: any) {
      toast.error(tf('cash.toast.addFailed', 'Could not add transaction'))
      console.error(err)
    } finally {
      setSavingTx(false)
    }
  }

  const cashTypeLabel = (type: CashTx['type']) => {
    if (type === 'sale_receipt') return t('cash.saleReceipt')
    if (type === 'purchase_payment') return t('cash.purchasePayment')
    return t('cash.adjustment')
  }
  const referenceHref = (type: CashTx['ref_type'], id: string | null) => {
    if (!id) return null
    if (type === 'SI') return `/sales-invoices/${id}`
    if (type === 'VB') return `/vendor-bills/${id}`
    if (type === 'SO') return `/orders?tab=sales&orderId=${encodeURIComponent(id)}`
    if (type === 'PO') return `/orders?tab=purchase&orderId=${encodeURIComponent(id)}`
    return null
  }

  return (
    <div className="space-y-4">
      {/* Filters + Add */}
      <div className="flex items-end gap-2">
        <div>
          <Label>{t('filters.from')}</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label>{t('filters.to')}</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <Label>{t('filters.type')}</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder={t('filters.type.all')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('cash.allTypes')}</SelectItem>
              <SelectItem value="sale_receipt">{t('cash.saleReceipt')}</SelectItem>
              <SelectItem value="purchase_payment">{t('cash.purchasePayment')}</SelectItem>
              <SelectItem value="adjustment">{t('cash.adjustment')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline">
            <Link to="/settlements">{t('nav.settlements')}</Link>
          </Button>
          <Sheet open={openAdd} onOpenChange={setOpenAdd}>
            <SheetTrigger asChild>
              <Button>+ {t('cash.addTx')}</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{t('cash.addCashTx')}</SheetTitle>
                <SheetDescription className="sr-only">
                  {t('cash.addCashTx')}
                </SheetDescription>
              </SheetHeader>
              <SheetBody className="mt-4 pr-1">
                <div className="space-y-3">
                  <div>
                    <Label>{t('table.date')}</Label>
                    <Input type="date" value={addForm.date} onChange={(e) => setAddForm((v) => ({ ...v, date: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{t('filters.type')}</Label>
                    <Select value={addForm.type} onValueChange={(v: any) => setAddForm((f) => ({ ...f, type: v }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sale_receipt" disabled={!canManageSettlement}>{t('cash.saleReceipt')}</SelectItem>
                        <SelectItem value="purchase_payment" disabled={!canManageSettlement}>{t('cash.purchasePayment')}</SelectItem>
                        <SelectItem value="adjustment">{t('cash.adjustment')}</SelectItem>
                      </SelectContent>
                    </Select>
                    {!canManageSettlement ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {tf('cash.financeAuthorityNotice', 'Only finance-authority users can post settlement-linked cash receipts and payments.')}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label>{t('cash.amount', { code: baseCurrency || 'MZN' })}</Label>
                    <Input
                      inputMode="decimal"
                      placeholder={tf('cash.placeholder.amount', 'e.g. 1500 or -450')}
                      value={addForm.amount}
                      onChange={(e) => setAddForm((v) => ({ ...v, amount: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>{t('cash.memo')}</Label>
                    <Input placeholder={t('cash.optional')} value={addForm.memo} onChange={(e) => setAddForm((v) => ({ ...v, memo: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <Label>{t('filters.ref')}</Label>
                      <Select value={addForm.refType} onValueChange={(v: any) => setAddForm((f) => ({ ...f, refType: v }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t('common.none')}</SelectItem>
                          <SelectItem value="SO" disabled={!canManageSettlement}>SO</SelectItem>
                          <SelectItem value="PO" disabled={!canManageSettlement}>PO</SelectItem>
                          <SelectItem value="SI" disabled={!canManageSettlement}>SI</SelectItem>
                          <SelectItem value="VB" disabled={!canManageSettlement}>VB</SelectItem>
                          <SelectItem value="ADJ">ADJ</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <Label>{t('movements.refId')}</Label>
                      <Input
                        placeholder={tf('cash.placeholder.refId', 'Internal reference ID (UUID)')}
                        value={addForm.refId}
                        onChange={(e) => setAddForm((v) => ({ ...v, refId: e.target.value }))}
                      />
                    </div>
                  </div>
                  <Button disabled={savingTx} onClick={addTransaction}>
                    {savingTx ? t('actions.saving') : t('cash.add')}
                  </Button>
                </div>
              </SheetBody>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
        <p className="text-sm font-medium">{t('nav.settlements')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('cash.settlementsHint')}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <Card>
          <CardHeader><CardTitle>{t('cash.beginning')}</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(summary?.beginning ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('cash.inflows')}</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(summary?.inflows ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('cash.outflows')}</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(summary?.outflows ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('cash.net')}</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(summary?.net ?? 0)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('cash.ending')}</CardTitle></CardHeader>
          <CardContent className="text-2xl">{formatMoneyBase(summary?.ending ?? 0)}</CardContent>
        </Card>
      </div>

      {/* Beginning balance editor */}
      <Card>
        <CardHeader><CardTitle>{t('cash.beginningBalance')}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label>{t('cash.asOf')}</Label>
            <Input
              type="date"
              value={book?.beginning_as_of ?? todayISO()}
              onChange={(e) =>
                setBook((b) =>
                  b
                    ? { ...b, beginning_as_of: e.target.value }
                    : { id: '', company_id: companyId!, beginning_balance_base: 0, beginning_as_of: e.target.value }
                )
              }
            />
          </div>
          <div>
            <Label>{t('cash.amount', { code: baseCurrency || 'MZN' })}</Label>
            <Input
              inputMode="decimal"
              value={String(book?.beginning_balance_base ?? 0)}
              onChange={(e) => {
                const v = e.target.value
                setBook((b) =>
                  b
                    ? { ...b, beginning_balance_base: Number(v) }
                    : { id: '', company_id: companyId!, beginning_balance_base: Number(v), beginning_as_of: todayISO() }
                )
              }}
            />
          </div>
          <Button onClick={upsertBeginningBalance} disabled={savingBeg}>
            {savingBeg ? t('actions.saving') : book?.id ? t('cash.update') : t('cash.create')}
          </Button>
        </CardContent>
      </Card>

      {/* Ledger table */}
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('cash.ledger')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto overflow-y-auto max-h-[55vh]">
          <table className="w-full text-sm">
            <thead className="text-left sticky top-0 bg-background">
              <tr>
                <th className="py-2 pr-3">{t('table.date')}</th>
                <th className="py-2 pr-3">{t('filters.type')}</th>
                <th className="py-2 pr-3">{t('table.ref')}</th>
                <th className="py-2 pr-3">{t('bank.memo')}</th>
                <th className="py-2 pr-3 text-right">{t('cash.amount', { code: baseCurrency || 'MZN' })}</th>
                <th className="py-2 pl-3 text-right">{t('cash.running')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-3">{r.happened_at}</td>
                  <td className="py-2 pr-3">{cashTypeLabel(r.type)}</td>
                  <td className="py-2 pr-3">
                    {referenceHref(r.ref_type, r.ref_id) ? (
                      <Link className="text-primary underline-offset-4 hover:underline" to={referenceHref(r.ref_type, r.ref_id)!}>
                        {formatOrderReference(r.ref_type, r.ref_id, orderRefByKey, t('common.dash'))}
                      </Link>
                    ) : (
                      formatOrderReference(r.ref_type, r.ref_id, orderRefByKey, t('common.dash'))
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.memo ?? t('common.dash')}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyBase(r.amount_base)}</td>
                  <td className="py-2 pl-3 text-right font-medium">{formatMoneyBase(r.running_balance)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="py-6 text-muted-foreground" colSpan={6}>
                    {t('bank.noTx')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
