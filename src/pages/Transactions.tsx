import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, Repeat2, SlidersHorizontal } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'
import { useOrg } from '../hooks/useOrg'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { supabase } from '../lib/supabase'

type MovementRow = {
  id: string
  item_id: string
  qty_base: number | null
  type: 'receive' | 'issue' | 'transfer' | 'adjust' | null
  created_at: string
  unit_cost: number | null
  total_value: number | null
  ref_type?: string | null
  ref_id?: string | null
  notes?: string | null
}
type Item = { id: string; name: string; sku: string }

const PAGE_SIZE = 50
const TYPE_VALUES = ['ALL', 'receive', 'issue', 'transfer', 'adjust'] as const
const num = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const startOf30Ago = () => { const date = new Date(); date.setDate(date.getDate() - 30); return ymd(date) }
const today = () => ymd(new Date())
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default function Transactions() {
  const { t, lang } = useI18n()
  const { companyId } = useOrg()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) => withI18nFallback(t, key, fallback, vars)

  const [baseCode, setBaseCode] = useState('MZN')
  const [from, setFrom] = useState(startOf30Ago())
  const [to, setTo] = useState(today())
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [refFilter, setRefFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [rowsAll, setRowsAll] = useState<MovementRow[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [soNoById, setSoNoById] = useState<Record<string, string>>({})
  const [poNoById, setPoNoById] = useState<Record<string, string>>({})
  const [productionNoById, setProductionNoById] = useState<Record<string, string>>({})
  const [soNotesById, setSoNotesById] = useState<Record<string, string>>({})

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])

  useEffect(() => {
    if (!companyId) {
      setBaseCode('MZN')
      setItems([])
      setRowsAll([])
      setLoading(false)
      return
    }
    let active = true
    void Promise.all([
      getBaseCurrencyCode(companyId),
      supabase.from('items').select('id,sku,name').eq('company_id', companyId).order('name'),
    ]).then(([currency, itemResult]) => {
      if (!active) return
      setBaseCode(currency || 'MZN')
      if (!itemResult.error) setItems((itemResult.data || []) as Item[])
    }).catch(console.error)
    return () => { active = false }
  }, [companyId])

  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, from, to])
  useEffect(() => { setPage(1) }, [companyId, from, to, typeFilter, refFilter, search])

  async function load() {
    if (!companyId) { setRowsAll([]); setLoading(false); return }
    setLoading(true)
    setLoadError(null)

    const { data, error } = await supabase
      .from('stock_movements')
      .select('id,item_id,qty_base,type,created_at,unit_cost,total_value,ref_type,ref_id,notes')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .gte('created_at', `${from} 00:00:00`)
      .lte('created_at', `${to} 23:59:59`)
      .limit(5000)

    if (error) {
      console.error(error)
      setLoadError(tt('financeUx.transactionsLoadFailed', 'Stock movements could not be loaded. Retry the register.'))
      setRowsAll([])
      setSoNoById({})
      setPoNoById({})
      setProductionNoById({})
      setSoNotesById({})
      setLoading(false)
      return
    }

    const list = (data || []) as MovementRow[]
    setRowsAll(list)

    const soIds = Array.from(new Set(list.filter((row) => ['SO', 'SO_REVERSAL'].includes(String(row.ref_type)) && row.ref_id && uuidPattern.test(row.ref_id)).map((row) => row.ref_id!)))
    const poIds = Array.from(new Set(list.filter((row) => row.ref_type === 'PO' && row.ref_id && uuidPattern.test(row.ref_id)).map((row) => row.ref_id!)))
    const productionIds = Array.from(new Set(list.filter((row) => ['PRODUCTION_RUN', 'PRODUCTION_RUN_REVERSAL'].includes(String(row.ref_type)) && row.ref_id && uuidPattern.test(row.ref_id)).map((row) => row.ref_id!)))

    const [soResult, poResult, productionResult] = await Promise.all([
      soIds.length ? supabase.from('sales_orders').select('id,order_no,notes').eq('company_id', companyId).in('id', soIds) : Promise.resolve({ data: [], error: null }),
      poIds.length ? supabase.from('purchase_orders').select('id,order_no').eq('company_id', companyId).in('id', poIds) : Promise.resolve({ data: [], error: null }),
      productionIds.length ? supabase.from('production_runs').select('id,reference_no').eq('company_id', companyId).in('id', productionIds) : Promise.resolve({ data: [], error: null }),
    ])

    const soNos: Record<string, string> = {}
    const soNotes: Record<string, string> = {}
    if (!soResult.error) for (const row of soResult.data || []) {
      soNos[(row as any).id] = (row as any).order_no || (row as any).id
      soNotes[(row as any).id] = (row as any).notes || ''
    }
    const poNos: Record<string, string> = {}
    if (!poResult.error) for (const row of poResult.data || []) poNos[(row as any).id] = (row as any).order_no || (row as any).id
    const productionNos: Record<string, string> = {}
    if (!productionResult.error) for (const row of productionResult.data || []) productionNos[(row as any).id] = (row as any).reference_no || (row as any).id

    setSoNoById(soNos)
    setSoNotesById(soNotes)
    setPoNoById(poNos)
    setProductionNoById(productionNos)
    setLoading(false)
  }

  const effectiveNotes = (row: MovementRow) => {
    const movementNote = String(row.notes || '').trim()
    if (['SO', 'SO_REVERSAL'].includes(String(row.ref_type)) && row.ref_id) {
      const orderNote = String(soNotesById[row.ref_id] || '').trim()
      if (orderNote && (!movementNote || /cash sale\s*\(auto\)/i.test(movementNote))) return orderNote
    }
    return movementNote
  }

  const refLabel = (value: string) => {
    switch (value) {
      case 'SO': return tt('ref.soPlural', 'Sales orders')
      case 'SO_REVERSAL': return tt('ref.soReversalPlural', 'Sales order reversals')
      case 'PO': return tt('ref.poPlural', 'Purchase orders')
      case 'PRODUCTION_RUN': return tt('ref.productionRuns', 'Production runs')
      case 'PRODUCTION_RUN_REVERSAL': return tt('ref.productionRunReversals', 'Production reversals')
      case 'BUILD': return tt('ref.builds', 'Assembly / builds')
      case 'GROWTH_BATCH_INPUT': return tt('ref.growthInputs', 'Growth batch inputs')
      case 'GROWTH_BATCH_INPUT_REVERSAL': return tt('ref.growthInputReversals', 'Growth input reversals')
      case 'GROWTH_BATCH_HARVEST': return tt('ref.growthHarvests', 'Growth batch harvests')
      case 'GROWTH_BATCH_HARVEST_REVERSAL': return tt('ref.growthHarvestReversals', 'Growth harvest reversals')
      case 'TRANSFER': return tt('ref.transfer', 'Transfers')
      case 'ADJ':
      case 'ADJUST': return tt('ref.adjust', 'Stock adjustments')
      case 'WRITE_OFF': return tt('ref.writeOff', 'Write offs')
      case 'INTERNAL_USE': return tt('ref.internalUse', 'Internal use')
      case 'CASH_SALE': return tt('ref.cashSale', 'Cash sales')
      case 'POS': return tt('ref.pos', 'POS')
      case 'CASH': return tt('ref.cash', 'Cash')
      default: return value.replaceAll('_', ' ').toLowerCase().replace(/^./, (character) => character.toUpperCase())
    }
  }

  const refPretty = (row: MovementRow) => {
    const type = String(row.ref_type || '')
    const id = String(row.ref_id || '')
    if (!type && !id) return '—'
    if (type === 'SO') return `${tt('ref.so', 'SO')} ${soNoById[id] || id.slice(0, 8)}`
    if (type === 'SO_REVERSAL') return `${tt('ref.soReversal', 'SO reversal')} ${soNoById[id] || id.slice(0, 8)}`
    if (type === 'PO') return `${tt('ref.po', 'PO')} ${poNoById[id] || id.slice(0, 8)}`
    if (type === 'PRODUCTION_RUN') return `${tt('ref.productionRun', 'Production run')} ${productionNoById[id] || id.slice(0, 8)}`
    if (type === 'PRODUCTION_RUN_REVERSAL') return `${tt('ref.productionRunReversal', 'Production reversal')} ${productionNoById[id] || id.slice(0, 8)}`
    if (type === 'ADJ') return id ? `${tt('ref.adjust', 'Stock adjustment')} · ${id}` : tt('ref.adjust', 'Stock adjustment')
    if (type === 'BUILD') return id ? `${tt('ref.build', 'Assembly / build')} · ${id}` : tt('ref.build', 'Assembly / build')
    if (type.startsWith('GROWTH_BATCH_')) return id ? `${refLabel(type)} · ${id.slice(0, 12)}` : refLabel(type)
    return id ? `${refLabel(type)} · ${id.slice(0, 12)}` : refLabel(type)
  }

  const availableRefTypes = useMemo(
    () => Array.from(new Set(rowsAll.map((row) => String(row.ref_type || '')).filter(Boolean))).sort((left, right) => refLabel(left).localeCompare(refLabel(right))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowsAll, lang],
  )

  const rowsFiltered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rowsAll.filter((row) => {
      if (typeFilter !== 'ALL' && row.type !== typeFilter) return false
      if (refFilter !== 'ALL' && row.ref_type !== refFilter) return false
      if (!term) return true
      const item = itemById.get(row.item_id)
      return `${item?.name || ''} ${item?.sku || ''} ${refPretty(row)} ${effectiveNotes(row)}`.toLowerCase().includes(term)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsAll, search, typeFilter, refFilter, itemById, soNoById, poNoById, productionNoById, soNotesById])

  const pageCount = Math.max(1, Math.ceil(rowsFiltered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = rowsFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const valueOf = (row: MovementRow) => Number.isFinite(row.total_value) ? num(row.total_value) : num(row.unit_cost) * num(row.qty_base)

  const typeBadge = (type: MovementRow['type']) => {
    switch (type) {
      case 'receive': return <PremiumStatusBadge tone="success" icon={<ArrowDownToLine />}>{tt('movement.receive', 'Receive')}</PremiumStatusBadge>
      case 'issue': return <PremiumStatusBadge tone="info" icon={<ArrowUpFromLine />}>{tt('movement.issue', 'Issue')}</PremiumStatusBadge>
      case 'transfer': return <PremiumStatusBadge tone="neutral" icon={<Repeat2 />}>{tt('movement.transfer', 'Transfer')}</PremiumStatusBadge>
      case 'adjust': return <PremiumStatusBadge tone="warning" icon={<SlidersHorizontal />}>{tt('movement.adjust', 'Adjust')}</PremiumStatusBadge>
      default: return <PremiumStatusBadge tone="neutral">—</PremiumStatusBadge>
    }
  }

  const typeLabel = (value: typeof TYPE_VALUES[number]) => value === 'ALL' ? tt('filters.type.all', 'All types') : tt(`movement.${value}`, value)
  const applyQuick = (days: number) => {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - (days - 1))
    setFrom(ymd(start))
    setTo(ymd(end))
  }

  return (
    <div className="space-y-6">
      <PremiumRegisterHeader
        title={tt('transactions.title', 'Transactions')}
        description={tt('financeUx.transactionsScope', 'Review the governed stock movements behind receipts, issues, transfers, and adjustments. Cash and settlement-account activity remains in its own ledgers.')}
      />

      <section aria-label={tt('financeUx.transactionFilters', 'Transaction filters')} className="border-y border-border py-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(9rem,0.7fr)_minmax(9rem,0.7fr)_minmax(9rem,0.75fr)_minmax(12rem,1fr)_minmax(14rem,1.4fr)_auto] xl:items-end">
          <div><Label htmlFor="transactions-from">{tt('filters.from', 'From')}</Label><Input id="transactions-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-2" /></div>
          <div><Label htmlFor="transactions-to">{tt('filters.to', 'To')}</Label><Input id="transactions-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-2" /></div>
          <div>
            <Label>{tt('filters.type', 'Type')}</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger aria-label={tt('filters.type', 'Type')} className="mt-2 w-full"><SelectValue /></SelectTrigger><SelectContent>{TYPE_VALUES.map((value) => <SelectItem key={value} value={value}>{typeLabel(value)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div>
            <Label>{tt('filters.ref', 'Reference')}</Label>
            <Select value={refFilter} onValueChange={setRefFilter}><SelectTrigger aria-label={tt('filters.ref', 'Reference')} className="mt-2 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">{tt('filters.ref.all', 'All references')}</SelectItem>{availableRefTypes.map((value) => <SelectItem key={value} value={value}>{refLabel(value)}</SelectItem>)}</SelectContent></Select>
          </div>
          <div><Label htmlFor="transactions-search">{tt('common.search', 'Search')}</Label><Input id="transactions-search" className="mt-2" placeholder={tt('financeUx.transactionSearchPlaceholder', 'Item, reference, or notes')} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1 xl:flex-nowrap"><Button variant="secondary" onClick={() => applyQuick(7)}>{tt('quick.7d', '7d')}</Button><Button variant="secondary" onClick={() => applyQuick(30)}>{tt('quick.30d', '30d')}</Button><Button onClick={() => void load()}>{tt('common.apply', 'Apply')}</Button></div>
        </div>
      </section>

      <section aria-labelledby="transactions-results-title" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 id="transactions-results-title" className="text-lg font-semibold">{tt('transactions.results', 'Results')}</h2><p className="mt-1 text-sm text-muted-foreground">{rowsFiltered.length} {tt('financeUx.movements', 'movements')} · {tt('financeUx.pageOf', 'Page {page} of {pages}', { page: safePage, pages: pageCount })}</p></div>
          {pageCount > 1 ? <div className="flex gap-2"><Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{tt('common.previous', 'Previous')}</Button><Button variant="outline" size="sm" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>{tt('common.next', 'Next')}</Button></div> : null}
        </div>

        {loading ? <PremiumStatePanel kind="loading" title={tt('financeUx.loadingTransactions', 'Loading stock movements')} />
          : loadError ? <PremiumStatePanel kind="error" icon={<CircleAlert />} title={loadError} description={tt('financeUx.transactionsLoadFailedHelp', 'No empty register or zero movement count has been inferred.')} action={<Button variant="outline" onClick={() => void load()}>{tt('common.retry', 'Retry')}</Button>} />
          : rowsFiltered.length === 0 ? <PremiumStatePanel kind="empty" title={search || typeFilter !== 'ALL' || refFilter !== 'ALL' ? tt('financeUx.transactionFilterEmpty', 'No movements match these filters.') : tt('financeUx.transactionEmpty', 'No stock movements exist in this period.')} description={tt('financeUx.transactionEmptyHelp', 'Change the date range or review the operational workflow that creates the movement.')} />
          : <>
            <div className="hidden overflow-x-auto border-y border-border md:block">
              <table className="w-full min-w-[980px] text-sm">
                <thead className="sticky top-0 z-10 border-b bg-background"><tr><th className="w-48">{tt('table.date', 'Date')}</th><th className="w-28">{tt('table.type', 'Type')}</th><th className="w-64">{tt('table.ref', 'Reference')}</th><th>{tt('table.item', 'Item')}</th><th className="w-28 text-right">{tt('table.qtyBase', 'Qty (base)')}</th><th className="w-36 text-right">{tt('table.value', 'Value')}</th><th>{tt('table.notes', 'Notes')}</th></tr></thead>
                <tbody>{pageRows.map((row) => { const item = itemById.get(row.item_id); const note = effectiveNotes(row); return <tr key={row.id} className="border-b border-border last:border-b-0"><td className="whitespace-nowrap px-3 py-3">{new Date(row.created_at).toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ')}</td><td className="px-3 py-3">{typeBadge(row.type)}</td><td className="break-words px-3 py-3 font-medium">{refPretty(row)}</td><td className="break-words px-3 py-3">{item ? `${item.name} (${item.sku})` : tt('financeUx.itemUnavailable', 'Item unavailable')}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{num(row.qty_base)}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{formatMoneyBase(valueOf(row), baseCode)}</td><td className="max-w-[22rem] break-words px-3 py-3 text-muted-foreground">{note || '—'}</td></tr> })}</tbody>
              </table>
            </div>
            <div className="divide-y divide-border border-y border-border md:hidden">{pageRows.map((row) => { const item = itemById.get(row.item_id); const note = effectiveNotes(row); return <article key={row.id} className="py-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{item?.name || tt('financeUx.itemUnavailable', 'Item unavailable')}</h3><p className="mt-1 break-words text-xs text-muted-foreground">{refPretty(row)}</p></div>{typeBadge(row.type)}</div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="premium-label">{tt('table.date', 'Date')}</dt><dd className="mt-1">{new Date(row.created_at).toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ')}</dd></div><div className="text-right"><dt className="premium-label">{tt('table.value', 'Value')}</dt><dd className="mt-1 font-mono tabular-nums">{formatMoneyBase(valueOf(row), baseCode)}</dd></div><div><dt className="premium-label">{tt('table.qtyBase', 'Qty (base)')}</dt><dd className="mt-1 font-mono tabular-nums">{num(row.qty_base)}</dd></div><div className="text-right"><dt className="premium-label">{tt('table.item', 'Item')}</dt><dd className="mt-1 break-words">{item?.sku || '—'}</dd></div></dl>{note ? <p className="mt-3 break-words text-sm text-muted-foreground">{note}</p> : null}</article> })}</div>
          </>}
      </section>
    </div>
  )
}
