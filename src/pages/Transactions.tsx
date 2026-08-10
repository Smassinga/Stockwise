// src/pages/Transactions.tsx (company-scoped drop-in)
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, Repeat2, SlidersHorizontal } from 'lucide-react'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { useOrg } from '../hooks/useOrg' // <-- company scope

// ---------------- Types ----------------
type MovementRow = {
  id: string
  item_id: string
  qty_base: number | null
  type: 'receive' | 'issue' | 'transfer' | 'adjust' | null
  created_at: string
  unit_cost: number | null
  total_value: number | null
  ref_type?:
    | 'SO'
    | 'PO'
    | 'ADJUST'
    | 'TRANSFER'
    | 'WRITE_OFF'
    | 'INTERNAL_USE'
    | 'CASH_SALE'
    | 'POS'
    | 'CASH'
    | 'SO_REVERSAL'
    | null
  ref_id?: string | null
  notes?: string | null
}

type Item = { id: string; name: string; sku: string }

// ---------------- Utils ----------------
const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const startOf30Ago = () => { const d = new Date(); d.setDate(d.getDate() - 30); return ymd(d) }
const today = () => ymd(new Date())

const TYPE_VALUES = ['ALL', 'receive', 'issue', 'transfer', 'adjust'] as const
// --- NEW: include SO_REVERSAL in ref filters
const REF_VALUES = [
  'ALL',
  'SO',
  'SO_REVERSAL',
  'PO',
  'CASH_SALE',
  'POS',
  'CASH',
  'TRANSFER',
  'ADJUST',
  'WRITE_OFF',
  'INTERNAL_USE',
] as const

export default function Transactions() {
  const { t, lang } = useI18n()
  const { companyId } = useOrg()
  const tt = (key: string, fallback: string, vars?: Record<string, any>) =>
    withI18nFallback(t, key, fallback, vars)

  const [baseCode, setBaseCode] = useState('MZN')

  // filters (server-side)
  const [from, setFrom] = useState<string>(startOf30Ago())
  const [to, setTo] = useState<string>(today())
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const [refFilter, setRefFilter] = useState<string>('ALL')

  // client search
  const [search, setSearch] = useState<string>('')

  // data
  const [rowsAll, setRowsAll] = useState<MovementRow[]>([]) // server-filtered
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // friendly ref maps
  const [soNoById, setSoNoById] = useState<Record<string, string>>({})
  const [poNoById, setPoNoById] = useState<Record<string, string>>({})
  const [soNotesById, setSoNotesById] = useState<Record<string, string>>({})

  // helper: choose which note to display/search
  const autoCashRegex = /cash sale\s*\(auto\)/i
  const effectiveNotes = (r: MovementRow): string => {
    const movementNote = (r.notes || '').trim()
    if ((r.ref_type === 'SO' || r.ref_type === 'SO_REVERSAL') && r.ref_id) {
      const soNote = (soNotesById[r.ref_id] || '').trim()
      if (soNote && (!movementNote || autoCashRegex.test(movementNote))) {
        return soNote
      }
    }
    return movementNote
  }

  // initial load + whenever company changes
  useEffect(() => {
    (async () => {
      try {
        if (!companyId) { setBaseCode('MZN'); setItems([]); setRowsAll([]); setSoNoById({}); setPoNoById({}); setSoNotesById({}); return }
        setBaseCode((await getBaseCurrencyCode(companyId)) || 'MZN')

        // Items: scope to company (align with StockLevels)
        const { data: itemsData, error: itemsErr } = await supabase
          .from('items')
          .select('id,sku,name')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (!itemsErr) setItems((itemsData || []) as Item[])

        await load()
      } catch (e) {
        console.error(e)
        setLoadError(tt('financeUx.transactionsLoadFailed', 'Stock movements could not be loaded. Retry the register.'))
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // reload when server-side filters change
  useEffect(() => { load() /* eslint-disable-next-line */ }, [from, to, typeFilter, refFilter])

  async function load() {
    if (!companyId) { setRowsAll([]); setLoading(false); return }
    setLoading(true)
    setLoadError(null)

    // Base query: strictly company-scoped
    let q = supabase
      .from('stock_movements')
      .select('id,item_id,qty_base,type,created_at,unit_cost,total_value,ref_type,ref_id,notes')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .gte('created_at', `${from} 00:00:00`)
      .lte('created_at', `${to} 23:59:59`)
      .limit(5000)

    if (typeFilter !== 'ALL') q = q.eq('type', typeFilter)
    if (refFilter !== 'ALL') q = q.eq('ref_type', refFilter)

    const { data, error } = await q
    if (error) {
      console.error(error)
      setLoadError(tt('financeUx.transactionsLoadFailed', 'Stock movements could not be loaded. Retry the register.'))
      setRowsAll([]); setSoNoById({}); setPoNoById({}); setSoNotesById({})
      setLoading(false)
      return
    }

    const list = (data || []) as MovementRow[]
    setRowsAll(list)

    // map SO/PO ids → order_no (& SO notes) for pretty refs and notes override
    const soIds = Array.from(
      new Set(
        list
          .filter(r => (r.ref_type === 'SO' || r.ref_type === 'SO_REVERSAL') && r.ref_id)
          .map(r => r.ref_id!) // reversals also point to the original SO
      )
    )
    const poIds = Array.from(new Set(list.filter(r => r.ref_type === 'PO' && r.ref_id).map(r => r.ref_id!)))

    if (soIds.length) {
      const { data: so, error: soErr } = await supabase
        .from('sales_orders')
        .select('id,order_no,notes')
        .eq('company_id', companyId)
        .in('id', soIds)
      if (!soErr) {
        const mNo: Record<string, string> = {}
        const mNotes: Record<string, string> = {}
        for (const s of so || []) {
          const id = (s as any).id
          mNo[id] = (s as any).order_no || id
          mNotes[id] = (s as any).notes || ''
        }
        setSoNoById(mNo)
        setSoNotesById(mNotes)
      } else { setSoNoById({}); setSoNotesById({}) }
    } else { setSoNoById({}); setSoNotesById({}) }

    if (poIds.length) {
      const { data: po, error: poErr } = await supabase
        .from('purchase_orders')
        .select('id,order_no')
        .eq('company_id', companyId)
        .in('id', poIds)
      if (!poErr) {
        const m: Record<string, string> = {}
        for (const p of po || []) m[(p as any).id] = (p as any).order_no || (p as any).id
        setPoNoById(m)
      } else setPoNoById({})
    } else setPoNoById({})
    setLoading(false)
  }

  // client-side instant search filtering (include effective notes)
  const rowsFiltered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rowsAll
    return rowsAll.filter(r => {
      const it = itemById.get(r.item_id)
      const hay = `${it?.name ?? ''} ${it?.sku ?? ''} ${r.ref_type ?? ''} ${r.ref_id ?? ''} ${effectiveNotes(r)}`.toLowerCase()
      return hay.includes(term)
    })
  }, [rowsAll, search, itemById, soNotesById])

  const valueOf = (r: MovementRow) =>
    Number.isFinite(r.total_value) ? num(r.total_value) : num(r.unit_cost) * num(r.qty_base)

  // (requested) summary = only number of transactions (no money total)
  const txCount = rowsFiltered.length

  const typeBadge = (tp: MovementRow['type']) => {
    switch (tp) {
      case 'receive':  return <PremiumStatusBadge tone="success" icon={<ArrowDownToLine />}>{tt('movement.receive', 'Receive')}</PremiumStatusBadge>
      case 'issue':    return <PremiumStatusBadge tone="info" icon={<ArrowUpFromLine />}>{tt('movement.issue', 'Issue')}</PremiumStatusBadge>
      case 'transfer': return <PremiumStatusBadge tone="neutral" icon={<Repeat2 />}>{tt('movement.transfer', 'Transfer')}</PremiumStatusBadge>
      case 'adjust':   return <PremiumStatusBadge tone="warning" icon={<SlidersHorizontal />}>{tt('movement.adjust', 'Adjust')}</PremiumStatusBadge>
      default:         return <PremiumStatusBadge tone="neutral">{tt('common.dash', '—')}</PremiumStatusBadge>
    }
  }

  // --- NEW: pretty label for SO_REVERSAL too
  const refPretty = (r: MovementRow) => {
    const rt = String(r.ref_type || '')
    const id = r.ref_id || ''
    if (!id) return rt || '—'
    if (rt === 'SO')           return `${tt('ref.so', 'SO')} ${soNoById[id] || id.slice(0, 8)}`
    if (rt === 'SO_REVERSAL')  return `${tt('ref.soReversal', 'SO reversal')} ${soNoById[id] || id.slice(0, 8)}`
    if (rt === 'PO')           return `${tt('ref.po', 'PO')} ${poNoById[id] || id.slice(0, 8)}`
    if (rt === 'CASH_SALE')    return tt('ref.cashSale', 'Cash sale')
    if (rt === 'POS')          return tt('ref.pos', 'POS')
    if (rt === 'CASH')         return tt('ref.cash', 'Cash')
    if (rt === 'TRANSFER')     return tt('ref.transfer', 'TRANSFER')
    if (rt === 'ADJUST')       return tt('ref.adjust', 'ADJUST')
    if (rt === 'WRITE_OFF')    return tt('ref.writeOff', 'Write off')
    if (rt === 'INTERNAL_USE') return tt('ref.internalUse', 'Internal use')
    return rt || id.slice(0, 8)
  }

  const typeLabel = (v: typeof TYPE_VALUES[number]) =>
    v === 'ALL' ? tt('filters.type.all', 'All types')
      : v === 'receive' ? tt('movement.receive', 'Receive')
      : v === 'issue' ? tt('movement.issue', 'Issue')
      : v === 'transfer' ? tt('movement.transfer', 'Transfer')
      : v === 'adjust' ? tt('movement.adjust', 'Adjust')
      : v

  // --- NEW: i18n fallbacks for SO reversal options
  const refLabelOption = (v: typeof REF_VALUES[number]) =>
    v === 'ALL' ? tt('filters.ref.all', 'All refs')
      : v === 'SO' ? tt('ref.soPlural', 'Sales orders')
      : v === 'SO_REVERSAL' ? tt('ref.soReversalPlural', 'SO reversals')
      : v === 'PO' ? tt('ref.poPlural', 'Purchase orders')
      : v === 'CASH_SALE' ? tt('ref.cashSale', 'Cash sale')
      : v === 'POS' ? tt('ref.pos', 'POS')
      : v === 'CASH' ? tt('ref.cash', 'Cash')
      : v === 'TRANSFER' ? tt('ref.transfer', 'Transfer')
      : v === 'ADJUST' ? tt('ref.adjust', 'Adjust')
      : v === 'WRITE_OFF' ? tt('ref.writeOff', 'Write off')
      : v === 'INTERNAL_USE' ? tt('ref.internalUse', 'Internal use')
      : v

  const applyQuick = (days: number) => {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - (days - 1))
    setFrom(ymd(start)); setTo(ymd(end))
  }

  return (
    <div className="space-y-6">
      <PremiumRegisterHeader
        title={tt('transactions.title', 'Transactions')}
        description={tt('financeUx.transactionsScope', 'Review the governed stock movements behind receipts, issues, transfers, and adjustments. Cash and bank settlement activity remains in its own ledgers.')}
      />

      <section aria-label={tt('financeUx.transactionFilters', 'Transaction filters')} className="border-y border-border py-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(9rem,0.7fr)_minmax(9rem,0.7fr)_minmax(9rem,0.75fr)_minmax(12rem,1fr)_minmax(14rem,1.4fr)_auto] xl:items-end">
        <div>
          <Label htmlFor="transactions-from">{tt('filters.from', 'From')}</Label>
          <Input id="transactions-from" type="date" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} className="mt-2" />
        </div>
        <div>
          <Label htmlFor="transactions-to">{tt('filters.to', 'To')}</Label>
          <Input id="transactions-to" type="date" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} className="mt-2" />
        </div>
        <div>
          <Label>{tt('filters.type', 'Type')}</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger aria-label={tt('filters.type', 'Type')} className="mt-2 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPE_VALUES.map(v => <SelectItem key={v} value={v}>{typeLabel(v)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{tt('filters.ref', 'Reference')}</Label>
          <Select value={refFilter} onValueChange={setRefFilter}>
            <SelectTrigger aria-label={tt('filters.ref', 'Reference')} className="mt-2 w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REF_VALUES.map(v => <SelectItem key={v} value={v}>{refLabelOption(v)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="transactions-search">{tt('common.search', 'Search')}</Label>
          <Input
            id="transactions-search"
            className="mt-2"
            placeholder={tt('financeUx.transactionSearchPlaceholder', 'Item, reference, or notes')}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1 xl:flex-nowrap">
          <Button variant="secondary" onClick={() => applyQuick(7)}>{tt('quick.7d', '7d')}</Button>
          <Button variant="secondary" onClick={() => applyQuick(30)}>{tt('quick.30d', '30d')}</Button>
          <Button onClick={() => void load()}>{tt('common.apply', 'Apply')}</Button>
        </div>
        </div>
      </section>

      <section aria-labelledby="transactions-results-title" className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="transactions-results-title" className="text-lg font-semibold">{tt('transactions.results', 'Results')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{tt('financeUx.transactionResultCount', '{count} movements in the current view', { count: txCount })}</p>
          </div>
        </div>

        {loading ? (
          <PremiumStatePanel kind="loading" title={tt('financeUx.loadingTransactions', 'Loading stock movements')} />
        ) : loadError ? (
          <PremiumStatePanel
            kind="error"
            icon={<CircleAlert />}
            title={loadError}
            description={tt('financeUx.transactionsLoadFailedHelp', 'No empty register or zero movement count has been inferred.')}
            action={<Button variant="outline" onClick={() => void load()}>{tt('common.retry', 'Retry')}</Button>}
          />
        ) : rowsFiltered.length === 0 ? (
          <PremiumStatePanel
            kind="empty"
            title={search || typeFilter !== 'ALL' || refFilter !== 'ALL'
              ? tt('financeUx.transactionFilterEmpty', 'No movements match these filters.')
              : tt('financeUx.transactionEmpty', 'No stock movements exist in this period.')}
            description={tt('financeUx.transactionEmptyHelp', 'Change the date range or review the operational workflow that creates the movement.')}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto border-y border-border md:block">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="sticky top-0 z-10 border-b bg-background">
                  <tr className="text-left">
                    <th className="py-2 px-3 w-48">{tt('table.date', 'Date')}</th>
                    <th className="py-2 px-3 w-28">{tt('table.type', 'Type')}</th>
                    <th className="py-2 px-3 w-60">{tt('table.ref', 'Ref')}</th>
                    <th className="py-2 px-3">{tt('table.item', 'Item')}</th>
                    <th className="py-2 px-3 text-right w-28">{tt('table.qtyBase', 'Qty (base)')}</th>
                    <th className="py-2 px-3 text-right w-36">{tt('table.value', 'Value')}</th>
                    <th className="py-2 px-3">{tt('table.notes', 'Notes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsFiltered.map(r => {
                    const it = itemById.get(r.item_id)
                    const val = valueOf(r)
                    const note = effectiveNotes(r)
                    return (
                      <tr key={r.id} className="border-b border-border last:border-b-0">
                        <td className="whitespace-nowrap px-3 py-3">{new Date(r.created_at).toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ')}</td>
                        <td className="py-2 px-3">{typeBadge(r.type)}</td>
                        <td className="break-words px-3 py-3 font-medium">{refPretty(r)}</td>
                        <td className="break-words px-3 py-3">{it ? `${it.name} (${it.sku})` : tt('financeUx.itemUnavailable', 'Item unavailable')}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{num(r.qty_base)}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoneyBase(val, baseCode)}</td>
                        <td className="max-w-[22rem] break-words px-3 py-3 text-muted-foreground">{note || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-border border-y border-border md:hidden">
              {rowsFiltered.map((row) => {
                const item = itemById.get(row.item_id)
                const note = effectiveNotes(row)
                return (
                  <article key={row.id} className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold">{item?.name || tt('financeUx.itemUnavailable', 'Item unavailable')}</h3>
                        <p className="mt-1 break-words text-xs text-muted-foreground">{refPretty(row)}</p>
                      </div>
                      {typeBadge(row.type)}
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div><dt className="premium-label">{tt('table.date', 'Date')}</dt><dd className="mt-1">{new Date(row.created_at).toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ')}</dd></div>
                      <div className="text-right"><dt className="premium-label">{tt('table.value', 'Value')}</dt><dd className="mt-1 font-mono tabular-nums">{formatMoneyBase(valueOf(row), baseCode)}</dd></div>
                      <div><dt className="premium-label">{tt('table.qtyBase', 'Qty (base)')}</dt><dd className="mt-1 font-mono tabular-nums">{num(row.qty_base)}</dd></div>
                      <div className="text-right"><dt className="premium-label">{tt('table.item', 'Item')}</dt><dd className="mt-1 break-words">{item?.sku || '—'}</dd></div>
                    </dl>
                    {note ? <p className="mt-3 break-words text-sm text-muted-foreground">{note}</p> : null}
                  </article>
                )
              })}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
