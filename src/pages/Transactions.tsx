// src/pages/Transactions.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { cn } from '../lib/utils'

type MovementRow = {
  id: string
  item_id: string
  qty_base: number | null
  type: 'receive' | 'issue' | 'transfer' | 'adjust' | null
  created_at: string
  unit_cost: number | null
  total_value: number | null
  ref_type?: 'SO' | 'PO' | 'ADJUST' | 'TRANSFER' | 'WRITE_OFF' | 'INTERNAL_USE' | 'CASH_SALE' | 'POS' | 'CASH' | null
  ref_id?: string | null
  notes?: string | null
}
type Item = { id: string; name: string; sku: string }

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const startOf30Ago = () => { const d = new Date(); d.setDate(d.getDate() - 30); return ymd(d) }
const today = () => ymd(new Date())

const TYPE_VALUES = ['ALL', 'receive', 'issue', 'transfer', 'adjust'] as const
const REF_VALUES = ['ALL', 'SO', 'PO', 'CASH_SALE', 'POS', 'CASH', 'TRANSFER', 'ADJUST', 'WRITE_OFF', 'INTERNAL_USE'] as const

export default function Transactions() {
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, any>) => {
    const s = t(key, vars)
    return s === key ? fallback : s
  }

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
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // friendly ref maps
  const [soNoById, setSoNoById] = useState<Record<string, string>>({})
  const [poNoById, setPoNoById] = useState<Record<string, string>>({})

  // initial load
  useEffect(() => {
    (async () => {
      setBaseCode((await getBaseCurrencyCode()) || 'MZN')
      const { data } = await supabase.from('items_view').select('id,sku,name')
      setItems((data || []) as Item[])
      await load()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // reload when server-side filters change
  useEffect(() => { load() /* eslint-disable-next-line */ }, [from, to, typeFilter, refFilter])

  async function load() {
    let q = supabase
      .from('stock_movements')
      .select('id,item_id,qty_base,type,created_at,unit_cost,total_value,ref_type,ref_id,notes')
      .order('created_at', { ascending: false })
      .gte('created_at', `${from} 00:00:00`)
      .lte('created_at', `${to} 23:59:59`)
      .limit(5000)

    if (typeFilter !== 'ALL') q = q.eq('type', typeFilter)
    if (refFilter !== 'ALL') q = q.eq('ref_type', refFilter)

    const { data, error } = await q
    if (error) { console.error(error); setRowsAll([]); return }
    const list = (data || []) as MovementRow[]
    setRowsAll(list)

    // map SO/PO ids → order_no for pretty refs
    const soIds = Array.from(new Set(list.filter(r => r.ref_type === 'SO' && r.ref_id).map(r => r.ref_id!)))
    const poIds = Array.from(new Set(list.filter(r => r.ref_type === 'PO' && r.ref_id).map(r => r.ref_id!)))

    if (soIds.length) {
      const { data: so } = await supabase.from('sales_orders').select('id,order_no').in('id', soIds)
      const m: Record<string, string> = {}
      for (const s of so || []) m[(s as any).id] = (s as any).order_no || (s as any).id
      setSoNoById(m)
    } else setSoNoById({})

    if (poIds.length) {
      const { data: po } = await supabase.from('purchase_orders').select('id,order_no').in('id', poIds)
      const m: Record<string, string> = {}
      for (const p of po || []) m[(p as any).id] = (p as any).order_no || (p as any).id
      setPoNoById(m)
    } else setPoNoById({})
  }

  // client-side instant search filtering
  const rowsFiltered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rowsAll
    return rowsAll.filter(r => {
      const it = itemById.get(r.item_id)
      const hay =
        `${it?.name ?? ''} ${it?.sku ?? ''} ${r.ref_type ?? ''} ${r.ref_id ?? ''} ${r.notes ?? ''}`.toLowerCase()
      return hay.includes(term)
    })
  }, [rowsAll, search, itemById])

  const valueOf = (r: MovementRow) =>
    Number.isFinite(r.total_value) ? num(r.total_value) : num(r.unit_cost) * num(r.qty_base)

  // (requested) summary = only number of transactions (no money total)
  const txCount = rowsFiltered.length

  const typeBadge = (tp: MovementRow['type']) => {
    const base = 'px-2 py-0.5 rounded-md text-xs font-medium'
    switch (tp) {
      case 'receive': return <span className={cn(base, 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300')}>{tt('movement.receive', 'receive')}</span>
      case 'issue':   return <span className={cn(base, 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300')}>{tt('movement.issue', 'issue')}</span>
      case 'transfer':return <span className={cn(base, 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300')}>{tt('movement.transfer', 'transfer')}</span>
      case 'adjust':  return <span className={cn(base, 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300')}>{tt('movement.adjust', 'adjust')}</span>
      default:        return <span className={cn(base, 'bg-muted text-foreground/70')}>{tt('common.dash', '—')}</span>
    }
  }

  const refPretty = (r: MovementRow) => {
    const rt = String(r.ref_type || '')
    const id = r.ref_id || ''
    if (!id) return rt || '—'
    if (rt === 'SO') return `${tt('ref.so', 'SO')} ${soNoById[id] || id.slice(0, 8)}`
    if (rt === 'PO') return `${tt('ref.po', 'PO')} ${poNoById[id] || id.slice(0, 8)}`
    if (rt === 'CASH_SALE') return tt('ref.cashSale', 'Cash sale')
    if (rt === 'POS') return tt('ref.pos', 'POS')
    if (rt === 'CASH') return tt('ref.cash', 'Cash')
    if (rt === 'TRANSFER') return tt('ref.transfer', 'TRANSFER')
    if (rt === 'ADJUST') return tt('ref.adjust', 'ADJUST')
    if (rt === 'WRITE_OFF') return tt('ref.writeOff', 'Write off')
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

  const refLabelOption = (v: typeof REF_VALUES[number]) =>
    v === 'ALL' ? tt('filters.ref.all', 'All refs')
      : v === 'SO' ? tt('ref.soPlural', 'Sales orders')
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
    <div className="space-y-4">
      <h1 className="text-3xl font-bold">{tt('transactions.title', 'Transactions')}</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <div className="text-xs mb-1">{tt('filters.from', 'From')}</div>
          <Input type="date" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} className="w-44" />
        </div>
        <div>
          <div className="text-xs mb-1">{tt('filters.to', 'To')}</div>
          <Input type="date" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} className="w-44" />
        </div>
        <div>
          <div className="text-xs mb-1">{tt('filters.type', 'Type')}</div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPE_VALUES.map(v => <SelectItem key={v} value={v}>{typeLabel(v)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-xs mb-1">{tt('filters.ref', 'Ref')}</div>
          <Select value={refFilter} onValueChange={setRefFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REF_VALUES.map(v => <SelectItem key={v} value={v}>{refLabelOption(v)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs mb-1">{tt('common.search', 'Search')}</div>
          <Input
            placeholder={tt('transactions.searchHint', 'Search item, ref, or notes…')}
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="secondary" onClick={() => applyQuick(7)}>{tt('quick.7d', '7d')}</Button>
          <Button variant="secondary" onClick={() => applyQuick(30)}>{tt('quick.30d', '30d')}</Button>
          <Button onClick={load}>{tt('common.apply', 'Apply')}</Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {tt('transactions.results', 'Results')}
            <span className="ml-2 text-muted-foreground font-normal">
              {tt('transactions.summary', 'Transactions')}: <Badge variant="outline" className="align-middle">{txCount}</Badge>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border overflow-hidden">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background/95 backdrop-blur border-b z-10">
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
                <tbody className="[&_tr:nth-child(even)]:bg-muted/30">
                  {rowsFiltered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 px-3 text-muted-foreground text-center">
                        {tt('transactions.empty', 'No transactions')}
                      </td>
                    </tr>
                  )}
                  {rowsFiltered.map(r => {
                    const it = itemById.get(r.item_id)
                    const val = valueOf(r)
                    return (
                      <tr key={r.id} className="border-b">
                        <td className="py-2 px-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString(lang)}</td>
                        <td className="py-2 px-3">{typeBadge(r.type)}</td>
                        <td className="py-2 px-3 font-medium">{refPretty(r)}</td>
                        <td className="py-2 px-3">{it ? `${it.name} (${it.sku})` : r.item_id}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{num(r.qty_base)}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoneyBase(val, baseCode)}</td>
                        <td className="py-2 px-3 text-muted-foreground">{r.notes || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
