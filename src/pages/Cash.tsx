// src/pages/Cash.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription } from '../components/ui/sheet'
import toast from 'react-hot-toast'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { useI18n } from '../lib/i18n'

type CashSummary = { beginning: number; inflows: number; outflows: number; net: number; ending: number }
type CashTx = {
  id: string
  happened_at: string
  type: 'sale_receipt' | 'purchase_payment' | 'adjustment'
  ref_type: 'SO' | 'PO' | 'ADJ' | null
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

type QueueRow = {
  kind: 'SO' | 'PO'
  ref_id: string
  order_no: string
  status: string
  total_amount_base: number
  cash_posted_base: number
  balance_due_base: number
  suggested_amount_base: number
  last_activity_at: string | null
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthStartISO = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export default function CashPage() {
  const { t } = useI18n()
  const { companyId } = useOrg()
  const [from, setFrom] = useState<string>(monthStartISO())
  const [to, setTo] = useState<string>(todayISO())
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [summary, setSummary] = useState<CashSummary | null>(null)
  const [rows, setRows] = useState<CashTx[]>([])
  const [book, setBook] = useState<CashBook | null>(null)
  const [openAdd, setOpenAdd] = useState(false)
  const [savingBeg, setSavingBeg] = useState(false)
  const [savingTx, setSavingTx] = useState(false)
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [queueKind, setQueueKind] = useState<'ALL' | 'SO' | 'PO'>('ALL')

  // Resolve base currency via effect; fallback to MZN
  const [baseCurrency, setBaseCurrency] = useState<string>('MZN')

  const [addForm, setAddForm] = useState<{
    date: string
    type: CashTx['type']
    amount: string
    memo: string
    refType: 'SO' | 'PO' | 'ADJ' | 'none'
    refId: string
  }>({ date: todayISO(), type: 'sale_receipt', amount: '', memo: '', refType: 'none', refId: '' })

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
    loadQueue()
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
      return
    }
    let list = (ledger as CashTx[]) || []
    if (typeFilter !== 'all') list = list.filter((r) => r.type === typeFilter)
    setRows(list)
  }

  async function loadQueue() {
    const { data, error } = await supabase.rpc('get_cash_approvals_queue', {
      p_company: companyId,
    })
    if (error) {
      console.warn('queue rpc error:', error.message)
      setQueue([])
      return
    }
    // Coerce numerics
    const coerced = (data as any[]).map((r) => ({
      ...r,
      total_amount_base: Number(r.total_amount_base ?? 0),
      cash_posted_base: Number(r.cash_posted_base ?? 0),
      balance_due_base: Number(r.balance_due_base ?? 0),
      suggested_amount_base: Number(r.suggested_amount_base ?? 0),
    })) as QueueRow[]
    setQueue(coerced)
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
        toast.success('Beginning balance updated')
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
        toast.success('Beginning balance created')
      }
      await loadData()
    } catch (err: any) {
      toast.error('Failed to save beginning balance')
      console.error(err)
    } finally {
      setSavingBeg(false)
    }
  }

  async function addTransaction() {
    if (!companyId) return
    const amt = Number(addForm.amount)
    if (Number.isNaN(amt) || amt === 0) {
      toast.error('Amount must be non-zero')
      return
    }
    setSavingTx(true)
    try {
      const { error } = await supabase.from('cash_transactions').insert({
        company_id: companyId,
        happened_at: addForm.date,
        type: addForm.type,
        ref_type: addForm.refType === 'none' ? null : addForm.refType,
        ref_id: addForm.refId || null,
        memo: addForm.memo || null,
        amount_base: amt,
      })
      if (error) throw error
      toast.success('Transaction added')
      setOpenAdd(false)
      setAddForm({ date: todayISO(), type: 'sale_receipt', amount: '', memo: '', refType: 'none', refId: '' })
      await Promise.all([loadData(), loadQueue()])
    } catch (err: any) {
      toast.error('Could not add (check permissions)')
      console.error(err)
    } finally {
      setSavingTx(false)
    }
  }

  const filteredQueue = useMemo(() => {
    if (queueKind === 'ALL') return queue
    return queue.filter(q => q.kind === queueKind)
  }, [queue, queueKind])

  function approveRow(r: QueueRow) {
    const isSO = r.kind === 'SO'
    const signedAmt = isSO ? r.suggested_amount_base : -r.suggested_amount_base
    const memoBase = isSO ? 'Collect for' : 'Pay for'
    setAddForm({
      date: todayISO(),
      type: isSO ? 'sale_receipt' : 'purchase_payment',
      amount: String(signedAmt),
      memo: `${memoBase} ${r.order_no}`,
      refType: r.kind,
      refId: r.ref_id,
    })
    setOpenAdd(true)
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
              <div className="space-y-3 mt-4">
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
                      <SelectItem value="sale_receipt">{t('cash.saleReceipt')}</SelectItem>
                      <SelectItem value="purchase_payment">{t('cash.purchasePayment')}</SelectItem>
                      <SelectItem value="adjustment">{t('cash.adjustment')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t('cash.amount', { code: baseCurrency || 'MZN' })}</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="e.g. 1500 or -450"
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
                        <SelectItem value="SO">SO</SelectItem>
                        <SelectItem value="PO">PO</SelectItem>
                        <SelectItem value="ADJ">ADJ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>{t('movements.refId')}</Label>
                    <Input
                      placeholder="UUID"
                      value={addForm.refId}
                      onChange={(e) => setAddForm((v) => ({ ...v, refId: e.target.value }))}
                    />
                  </div>
                </div>
                <Button disabled={savingTx} onClick={addTransaction}>
                  {savingTx ? t('actions.saving') : t('cash.add')}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
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

      {/* Awaiting approvals */}
      <Card className="overflow-hidden">
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t('cash.awaiting')}</CardTitle>
          <div className="flex items-center gap-2">
            <Label>{t('cash.kind')}</Label>
            <Select value={queueKind} onValueChange={(v: 'ALL' | 'SO' | 'PO') => setQueueKind(v)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('common.all') ?? 'All'}</SelectItem>
                <SelectItem value="SO">SO</SelectItem>
                <SelectItem value="PO">PO</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        {/* 👇 scrollable area with sticky header */}
        <CardContent className="overflow-x-auto overflow-y-auto max-h-[45vh]">
          <table className="w-full text-sm">
            <thead className="text-left sticky top-0 bg-background">
              <tr>
                <th className="py-2 pr-3">{t('cash.kind')}</th>
                <th className="py-2 pr-3">{t('cash.order')}</th>
                <th className="py-2 pr-3">{t('cash.status')}</th>
                <th className="py-2 pr-3 text-right">{t('cash.total')}</th>
                <th className="py-2 pr-3 text-right">{t('cash.posted')}</th>
                <th className="py-2 pr-3 text-right">{t('cash.due')}</th>
                <th className="py-2 pr-3 text-right">{t('cash.suggest')}</th>
                <th className="py-2 pr-3">{t('cash.lastActivity')}</th>
                <th className="py-2 pr-0 text-right">{t('cash.action')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredQueue.map((q) => (
                <tr key={`${q.kind}:${q.ref_id}`} className="border-t">
                  <td className="py-2 pr-3">{q.kind}</td>
                  <td className="py-2 pr-3">{q.order_no}</td>
                  <td className="py-2 pr-3">{q.status}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyBase(q.total_amount_base)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyBase(q.cash_posted_base)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyBase(q.balance_due_base)}</td>
                  <td className="py-2 pr-3 text-right">{formatMoneyBase(q.suggested_amount_base)}</td>
                  <td className="py-2 pr-3">{q.last_activity_at ?? '—'}</td>
                  <td className="py-2 pr-0 text-right">
                    <Button size="sm" onClick={() => approveRow(q)}>{t('cash.approve')}</Button>
                  </td>
                </tr>
              ))}
              {filteredQueue.length === 0 && (
                <tr>
                  <td className="py-6 text-muted-foreground" colSpan={9}>
                    {t('cash.nothing')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Ledger table */}
      <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('cash.ledger')}</CardTitle>
        </CardHeader>
        {/* 👇 scrollable area with sticky header */}
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
                  <td className="py-2 pr-3">{r.type}</td>
                  <td className="py-2 pr-3">{r.ref_type ? `${r.ref_type}${r.ref_id ? `:${r.ref_id.slice(0, 8)}…` : ''}` : t('common.dash')}</td>
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
