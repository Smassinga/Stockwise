// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useOrg } from '../hooks/useOrg'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Button } from '../components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'

// per-icon imports to avoid lucide bundle resolution issues
import { Package, DollarSign, Coins, AlertTriangle, TrendingUp, TrendingDown, Calendar } from 'lucide-react'

type Item = { id: string; name: string; sku: string; minStock?: number | null }
type StockRow = { id: string; item_id: string; warehouse_id: string; bin_id: string | null; qty: number | null; avg_cost: number | null; updated_at?: string | null }
type MovementRow = {
  id: string
  item_id: string
  qty_base: number | null
  type: 'receive' | 'issue' | 'transfer' | 'adjust' | null
  created_at: string
  unit_cost: number | null
  total_value: number | null
  warehouse_from_id?: string | null
  warehouse_to_id?: string | null
  ref_type?: 'SO' | 'PO' | 'ADJUST' | 'TRANSFER' | 'WRITE_OFF' | 'INTERNAL_USE' | 'CASH_SALE' | 'POS' | 'CASH' | 'SO_REVERSAL' | null
  ref_id?: string | null
  ref_line_id?: string | null
}
type SO = {
  id: string
  status: string
  currency_code?: string | null
  fx_to_base?: number | null
  total_amount?: number | null
  updated_at?: string | null
  created_at?: string | null
}
type SOL = { so_id: string; item_id: string; uom_id: string; qty: number | null; unit_price: number | null; line_total: number | null }
type Warehouse = { id: string; name: string }

// --- NEW: window-scoped shipments + their linked movements (for COGS everywhere)
type ShipmentRowDash = {
  id: string
  so_id: string | null
  item_id: string
  qty_base: number | null
  created_at: string
  movement_id: string | null
  company_id?: string | null
}
type MovementCostRow = {
  id: string
  qty_base: number | null
  unit_cost: number | null
  total_value: number | null
  ref_type?: string | null
  type?: string | null
  company_id?: string | null
}

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const withinWindow = (iso: string | null | undefined, sinceMs: number) => !!iso && new Date(iso).getTime() >= sinceMs
const shippedLike = (s: string) => ['shipped', 'completed', 'delivered', 'closed'].includes(String(s).toLowerCase())

// tiny i18n fallback helper (avoids showing raw keys)
const withFallback = (t: (k: string, v?: any) => string, key: string, fallback: string, vars?: Record<string, any>) => {
  const s = t(key, vars)
  return s === key ? fallback : s
}

// build YYYY-MM-DD without UTC shifting
const toISODateLocal = (d: Date) => {
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

// --- NEW: cost helper (prefers total_value, falls back to unit_cost * qty)
const mnum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const movementCost = (mv?: MovementCostRow, fallbackQty?: number | null) => {
  if (!mv) return 0
  const tv = mnum(mv.total_value)
  if (tv !== 0) return tv
  const qty = mnum(mv.qty_base) || mnum(fallbackQty)
  return mnum(mv.unit_cost) * qty
}

export default function Dashboard() {
  const { t, lang } = useI18n()
  const { companyId } = useOrg()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) => withFallback(t, key, fallback, vars)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [baseCode, setBaseCode] = useState<string>('MZN')

  // filters
  const [windowDays, setWindowDays] = useState<number>(30)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState<string>('ALL')

  // Daily sheet controls
  const nowDate = new Date()
  const [dailyYear, setDailyYear] = useState<number>(nowDate.getFullYear())
  const [dailyMonth, setDailyMonth] = useState<number>(nowDate.getMonth()) // 0-11

  // sheet
  const [dailyOpen, setDailyOpen] = useState(false)

  // data
  const [items, setItems] = useState<Item[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [moves, setMoves] = useState<MovementRow[]>([])
  const [sos, setSOs] = useState<SO[]>([])
  const [sol, setSOL] = useState<SOL[]>([])

  // --- NEW: window-scoped shipments + movements used for COGS
  const [shipmentsWin, setShipmentsWin] = useState<ShipmentRowDash[]>([])
  const [mvByIdWin, setMvByIdWin] = useState<Map<string, MovementCostRow>>(new Map())

  // quick lookups
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)

        if (!companyId) {
          // no company yet -> empty state
          setWarehouses([]); setItems([]); setStock([]); setMoves([]); setSOs([]); setSOL([])
          setBaseCode((await getBaseCurrencyCode()) || 'MZN')
          return
        }

        const base = await getBaseCurrencyCode()

        // All reads explicitly fenced by company_id
        const [whRes, itRes, slRes, mvRes, soRes] = await Promise.all([
          supabase.from('warehouses').select('id,name').eq('company_id', companyId).order('name', { ascending: true }),
          // IMPORTANT: base table + snake_case column
          supabase.from('items').select('id,sku,name,min_stock').eq('company_id', companyId),
          supabase.from('stock_levels').select('id,item_id,warehouse_id,bin_id,qty,avg_cost,updated_at').eq('company_id', companyId),
          supabase
            .from('stock_movements')
            .select('id,item_id,qty_base,type,created_at,unit_cost,total_value,warehouse_from_id,warehouse_to_id,ref_type,ref_id,ref_line_id')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(2000),
          supabase.from('sales_orders').select('id,status,currency_code,fx_to_base,total_amount,updated_at,created_at').eq('company_id', companyId),
        ])

        const { data: lineRows, error: lineErr } = await supabase
          .from('sales_order_lines')
          .select('so_id,item_id,uom_id,qty,unit_price,line_total')
          .eq('company_id', companyId)
        if (lineErr) throw lineErr

        if (!cancelled) {
          setBaseCode(base || 'MZN')
          setWarehouses((whRes.data || []) as Warehouse[])
          setItems(((itRes.data || []) as any[]).map(x => ({
            id: x.id,
            name: x.name,
            sku: x.sku,
            minStock: (x as any).min_stock ?? null,
          })))
          setStock((slRes.data || []) as StockRow[])
          setMoves((mvRes.data || []) as MovementRow[])
          setSOs((soRes.data || []) as SO[])
          setSOL((lineRows || []) as SOL[])
          if (!whRes.data?.length) setWarehouseId('ALL')
        }
      } catch (e: any) {
        console.error(e)
        if (!cancelled) setError(e?.message || 'Failed to load dashboard data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [companyId])

  // ----- filter helpers
  const now = Date.now()
  const since = now - windowDays * 24 * 60 * 60 * 1000

  // --- NEW: fetch shipments inside the KPI window + their SO/issue movements
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId) { setShipmentsWin([]); setMvByIdWin(new Map()); return }

      const startISO = new Date(since).toISOString()
      const endISO = new Date().toISOString()

      try {
        // 1) shipments for this company within window
        const { data: shipRows, error: shipErr } = await supabase
          .from('sales_shipments')
          .select('id,so_id,item_id,qty_base,created_at,company_id,movement_id')
          .eq('company_id', companyId)
          .gte('created_at', startISO)
          .lte('created_at', endISO)
        if (shipErr) throw shipErr
        const ships = (shipRows || []) as ShipmentRowDash[]

        // 2) fetch ONLY the movements they link to (SO issues)
        const mvIds = Array.from(new Set(ships.map(s => s.movement_id).filter(Boolean))) as string[]
        const mvMap = new Map<string, MovementCostRow>()
        if (mvIds.length) {
          const { data: mvRows, error: mvErr } = await supabase
            .from('stock_movements')
            .select('id,qty_base,unit_cost,total_value,ref_type,type,company_id')
            .in('id', mvIds)
            .eq('company_id', companyId)
            .eq('ref_type', 'SO')
            .eq('type', 'issue')
          if (mvErr) throw mvErr
          for (const r of (mvRows || []) as MovementCostRow[]) mvMap.set(r.id, r)
        }

        if (!cancelled) { setShipmentsWin(ships); setMvByIdWin(mvMap) }
      } catch (e) {
        console.error(e)
        if (!cancelled) { setShipmentsWin([]); setMvByIdWin(new Map()) }
      }
    })()
    return () => { cancelled = true }
  }, [companyId, since, windowDays])

  // stock filtered by warehouse
  const stockFiltered = useMemo(() => (warehouseId === 'ALL' ? stock : stock.filter(r => r.warehouse_id === warehouseId)), [stock, warehouseId])

  // Inventory value
  const inventoryValue = useMemo(() => stockFiltered.reduce((s, r) => s + num(r.qty) * num(r.avg_cost), 0), [stockFiltered])

  // Shipped SOs in window and FX
  const shippedInWindow = useMemo(
    () => new Set(sos.filter(s => shippedLike(s.status) && withinWindow(s.updated_at ?? s.created_at ?? null, since)).map(s => s.id)),
    [sos, since]
  )
  const fxBySO = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of sos) m.set(s.id, num(s.fx_to_base, 1))
    return m
  }, [sos])

  // Per-SO line sums in base (for fallback)
  const lineSumBaseBySO = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of sol) {
      const fx = fxBySO.get(l.so_id) ?? 1
      map.set(l.so_id, (map.get(l.so_id) || 0) + num(l.line_total) * fx)
    }
    return map
  }, [sol, fxBySO])

  // Revenue per SO in base
  const revenueBaseBySO = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sos) {
      if (!shippedLike(s.status)) continue
      const fx = num(s.fx_to_base, 1)
      const totalAmt = (s as any).total_amount ?? (s as any).total
      if (totalAmt !== null && totalAmt !== undefined) {
        map.set(s.id, num(totalAmt) * fx)
      } else {
        map.set(s.id, lineSumBaseBySO.get(s.id) || 0)
      }
    }
    return map
  }, [sos, lineSumBaseBySO])

  // KPI Revenue (window)
  const revenueWindow = useMemo(() => {
    let sum = 0
    for (const soId of shippedInWindow) sum += revenueBaseBySO.get(soId) || 0
    return sum
  }, [shippedInWindow, revenueBaseBySO])

  // --- NEW: COGS in window from shipments → linked SO/issue movements
  const cogsWindow = useMemo(() => {
    let sum = 0
    for (const s of shipmentsWin) {
      const mv = s.movement_id ? mvByIdWin.get(s.movement_id) : undefined
      sum += movementCost(mv, s.qty_base)
    }
    return sum
  }, [shipmentsWin, mvByIdWin])

  // Gross margin
  const grossMargin = revenueWindow - cogsWindow
  const grossMarginPct = revenueWindow > 0 ? (grossMargin / revenueWindow) : 0

  // Low stock list
  const lowStock = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of stockFiltered) totals.set(r.item_id, (totals.get(r.item_id) || 0) + num(r.qty))
    return items
      .filter(i => typeof i.minStock === 'number')
      .map(i => ({ item: i, onHand: totals.get(i.id) || 0, min: Number(i.minStock) }))
      .filter(x => x.onHand < x.min)
      .slice(0, 5)
  }, [items, stockFiltered])

  // ---------- Top Products by GM (shipment-linked costs) ----------
  const topGM = useMemo(() => {
    // revenue distribution (same logic as before)
    const lineRevBySOItem = new Map<string, Map<string, number>>() // soId -> (itemId -> rev)
    const linesRevSO = new Map<string, number>()                    // soId -> rev sum
    for (const l of sol) {
      const soId = l.so_id
      if (!soId) continue
      if (!sos.find(s => s.id === soId && shippedLike(s.status))) continue
      const fx = fxBySO.get(soId) ?? 1
      const r = num(l.line_total) * fx
      if (!lineRevBySOItem.has(soId)) lineRevBySOItem.set(soId, new Map())
      const m = lineRevBySOItem.get(soId)!
      m.set(l.item_id, (m.get(l.item_id) || 0) + r)
      linesRevSO.set(soId, (linesRevSO.get(soId) || 0) + r)
    }

    // --- NEW: cost by SO->item using shipmentsWin
    const costBySOItem = new Map<string, Map<string, number>>() // soId -> (itemId -> cost)
    const costSumBySO = new Map<string, number>()
    for (const s of shipmentsWin) {
      const soId = s.so_id || ''
      if (!soId) continue
      const mv = s.movement_id ? mvByIdWin.get(s.movement_id) : undefined
      const val = movementCost(mv, s.qty_base)
      if (!costBySOItem.has(soId)) costBySOItem.set(soId, new Map())
      const m = costBySOItem.get(soId)!
      m.set(s.item_id, (m.get(s.item_id) || 0) + val)
      costSumBySO.set(soId, (costSumBySO.get(soId) || 0) + val)
    }

    // per-item revenue allocation (unchanged, but can fall back to cost weights)
    const perItemRevenue = new Map<string, number>()
    const shippedSet = new Set(sos.filter(s => shippedLike(s.status)).map(s => s.id))
    for (const soId of shippedSet) {
      const orderRev = revenueBaseBySO.get(soId) || 0
      if (orderRev <= 0) continue

      const byItem = lineRevBySOItem.get(soId)
      const linesSum = linesRevSO.get(soId) || 0

      if (byItem && linesSum > 0) {
        for (const [itemId, r] of byItem.entries()) {
          perItemRevenue.set(itemId, (perItemRevenue.get(itemId) || 0) + r)
        }
        const diff = orderRev - linesSum
        if (Math.abs(diff) > 1e-6) {
          for (const [itemId, r] of byItem.entries()) {
            const add = (r / linesSum) * diff
            perItemRevenue.set(itemId, (perItemRevenue.get(itemId) || 0) + add)
          }
        }
      } else {
        // fallback: allocate by cost weights if revenue lines are missing
        const costMap = costBySOItem.get(soId)
        const costSum = costSumBySO.get(soId) || 0
        if (costMap && costSum > 0) {
          for (const [itemId, c] of costMap.entries()) {
            const share = c / costSum
            perItemRevenue.set(itemId, (perItemRevenue.get(itemId) || 0) + orderRev * share)
          }
        }
      }
    }

    // --- NEW: per-item COGS from shipmentsWin
    const cogsByItem = new Map<string, number>()
    for (const s of shipmentsWin) {
      const mv = s.movement_id ? mvByIdWin.get(s.movement_id) : undefined
      const val = movementCost(mv, s.qty_base)
      cogsByItem.set(s.item_id, (cogsByItem.get(s.item_id) || 0) + val)
    }

    const itemIds = new Set<string>([...perItemRevenue.keys(), ...cogsByItem.keys()])
    const rows = Array.from(itemIds).map(itemId => {
      const revenue = perItemRevenue.get(itemId) || 0
      const cogs = cogsByItem.get(itemId) || 0
      const gm = revenue - cogs
      const pct = revenue > 0 ? gm / revenue : 0
      const it = itemById.get(itemId)
      return { itemId, name: it?.name || itemId, sku: it?.sku || '', revenue, cogs, gm, pct }
    })
    rows.sort((a, b) => b.gm - a.gm)
    return rows.slice(0, 10)
  }, [sos, sol, fxBySO, shipmentsWin, mvByIdWin, revenueBaseBySO, itemById])

  // ----- Available years for Daily selector -----
  const availableYears = useMemo(() => {
    const set = new Set<number>()
    for (const s of sos) {
      const d = s.updated_at || s.created_at
      if (!d) continue
      const y = new Date(d).getFullYear()
      if (!Number.isNaN(y)) set.add(y)
    }
    for (const m of moves) {
      const y = new Date(m.created_at).getFullYear()
      if (!Number.isNaN(y)) set.add(y)
    }
    const arr = Array.from(set).sort((a, b) => a - b)
    return arr.length ? arr : [nowDate.getFullYear()]
  }, [sos, moves])

  // month days without UTC shift
  const monthDaysISO = useMemo(() => {
    const lastDay = new Date(dailyYear, dailyMonth + 1, 0).getDate()
    const arr: string[] = []
    for (let d = 1; d <= lastDay; d++) {
      arr.push(toISODateLocal(new Date(dailyYear, dailyMonth, d)))
    }
    return arr
  }, [dailyYear, dailyMonth])

  // --- NEW: Daily table rows using shipment-linked costs (+ revenue allocation by cost day-weights)
  const dailyRows = useMemo(() => {
    const revByDate = new Map<string, number>()
    const cogsByDate = new Map<string, number>()

    // Cost per SO per day from shipments
    const costBySODate = new Map<string, Map<string, number>>() // soId -> (date -> cost)
    const costSumBySO = new Map<string, number>()
    for (const s of shipmentsWin) {
      const iso = (s.created_at || '').slice(0, 10)
      if (!iso) continue
      const d = new Date(iso)
      if (d.getFullYear() !== dailyYear || d.getMonth() !== dailyMonth) continue
      const soId = s.so_id || ''
      if (!soId) continue
      const mv = s.movement_id ? mvByIdWin.get(s.movement_id) : undefined
      const val = movementCost(mv, s.qty_base)

      cogsByDate.set(iso, (cogsByDate.get(iso) || 0) + val)

      if (!costBySODate.has(soId)) costBySODate.set(soId, new Map())
      const inner = costBySODate.get(soId)!
      inner.set(iso, (inner.get(iso) || 0) + val)
      costSumBySO.set(soId, (costSumBySO.get(soId) || 0) + val)
    }

    // Revenue allocation by cost weights (or SO updated_at if no costs in month)
    for (const s of sos) {
      if (!shippedLike(s.status)) continue
      const soId = s.id
      const orderRev = revenueBaseBySO.get(soId) || 0
      if (orderRev <= 0) continue

      const costDays = costBySODate.get(soId)
      const costSum = costSumBySO.get(soId) || 0

      if (costDays && costSum > 0) {
        for (const [iso, dayCost] of costDays.entries()) {
          revByDate.set(iso, (revByDate.get(iso) || 0) + orderRev * (dayCost / costSum))
        }
      } else {
        const iso = (s.updated_at || s.created_at || '').slice(0, 10)
        if (iso) {
          const d = new Date(iso)
          if (d.getFullYear() === dailyYear && d.getMonth() === dailyMonth) {
            revByDate.set(iso, (revByDate.get(iso) || 0) + orderRev)
          }
        }
      }
    }

    return monthDaysISO.map(d => ({
      date: d,
      revenue: revByDate.get(d) || 0,
      cogs: cogsByDate.get(d) || 0,
    }))
  }, [sos, revenueBaseBySO, shipmentsWin, mvByIdWin, dailyYear, dailyMonth, monthDaysISO])

  // recent movements (5)
  const recentMoves = useMemo(() => moves.slice(0, 5), [moves])

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">{t('dashboard.title')}</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-6 animate-pulse h-24" /></Card>
          ))}
        </div>
        <Card><CardContent className="p-6 animate-pulse h-48" /></Card>
      </div>
    )
  }

  const Chip = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
    <div className={`h-9 w-9 rounded-xl flex items-center justify-center shadow-sm ${className}`} aria-hidden>
      {children}
    </div>
  )

  const movementLabel = (type: MovementRow['type']) => {
    switch (type) {
      case 'receive': return t('movement.receive')
      case 'issue': return t('movement.issue')
      case 'transfer': return t('movement.transfer')
      case 'adjust': return t('movement.adjust')
      default: return t('common.dash')
    }
  }

  const monthName = (m: number) => new Date(2000, m, 1).toLocaleString(lang, { month: 'long' })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-bold">{t('dashboard.title')}</h1>

        <div className="flex flex-wrap gap-2">
          {/* Date window (KPIs/top products) */}
          <div className="w-full sm:w-40">
            <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t('filters.window.label')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">{t('window.30')}</SelectItem>
                <SelectItem value="60">{t('window.60')}</SelectItem>
                <SelectItem value="90">{t('window.90')}</SelectItem>
                <SelectItem value="180">{t('window.180')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Warehouse filter */}
          <div className="w-full sm:w-56">
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="w-full"><SelectValue placeholder={t('filters.warehouse.label')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('filters.warehouse.all')}</SelectItem>
                {warehouses.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Daily sheet */}
          <Sheet open={dailyOpen} onOpenChange={setDailyOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                <Calendar className="w-4 h-4 mr-2" />
                {t('daily.button')}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:w-[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
              <SheetHeader className="px-4 md:px-0 pt-4 md:pt-0">
                <SheetTitle>{t('daily.title')}</SheetTitle>
                <SheetDescription className="sr-only">{t('daily.desc')}</SheetDescription>
              </SheetHeader>

              {/* Date controls */}
              <div className="px-4 md:px-0 mt-2 mb-4 flex flex-wrap items-center gap-2">
                <div className="w-full sm:w-48">
                  <Select value={String(dailyMonth)} onValueChange={(v) => setDailyMonth(Number(v))}>
                    <SelectTrigger><SelectValue placeholder={t('common.month')} /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }).map((_, i) => (
                        <SelectItem key={i} value={String(i)} className="capitalize">
                          {monthName(i)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full sm:w-32">
                  <Select value={String(dailyYear)} onValueChange={(v) => setDailyYear(Number(v))}>
                    <SelectTrigger><SelectValue placeholder={t('common.year')} /></SelectTrigger>
                    <SelectContent>
                      {availableYears.map(y => (
                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const d = new Date()
                    setDailyYear(d.getFullYear())
                    setDailyMonth(d.getMonth())
                  }}
                  className="w-full sm:w-auto"
                >
                  {tt('common.thisMonth', 'This month')}
                </Button>
              </div>

              {/* SCROLLABLE daily table */}
              <div className="mt-2 px-4 md:px-0">
                <div className="max-h-[360px] overflow-auto overscroll-contain rounded-md border">
                  <div className="min-w-[560px] md:min-w-0 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-2 pr-2">{t('table.date')}</th>
                          <th className="py-2 pr-2">{t('table.revenue')}</th>
                          <th className="py-2 pr-2">{t('table.cogs')}</th>
                          <th className="py-2 pr-2">{t('table.grossMargin')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dailyRows.map(r => (
                          <tr key={r.date} className="border-b">
                            <td className="py-2 pr-2">{r.date}</td>
                            <td className="py-2 pr-2">{formatMoneyBase(r.revenue, baseCode)}</td>
                            <td className="py-2 pr-2">{formatMoneyBase(r.cogs, baseCode)}</td>
                            <td className="py-2 pr-2">{formatMoneyBase(r.revenue - r.cogs, baseCode)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {error && (
        <Card>
          <CardHeader><CardTitle>{t('common.headsUp')}</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-red-600">{error}</p></CardContent>
        </Card>
      )}

      {/* KPI row - responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-sky-50 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Chip className="bg-sky-100 text-sky-700"><Package size={18} /></Chip>
              <span className="text-sm sm:text-base">{t('kpi.inventoryValue.title')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-semibold">
              {formatMoneyBase(inventoryValue, baseCode)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 hidden sm:block">
              {t('kpi.inventoryValue.help')}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-50 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Chip className="bg-emerald-100 text-emerald-700"><DollarSign size={18} /></Chip>
              <span className="text-sm sm:text-base">{t('kpi.revenue.title', { days: windowDays })}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-semibold">
              {formatMoneyBase(revenueWindow, baseCode)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 hidden sm:block">
              {t('kpi.revenue.help')}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Chip className="bg-amber-100 text-amber-700"><Coins size={18} /></Chip>
              <span className="text-sm sm:text-base">{t('kpi.cogs.title', { days: windowDays })}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-semibold">
              {formatMoneyBase(cogsWindow, baseCode)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 hidden sm:block">
              {t('kpi.cogs.help')}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-indigo-50 to-transparent">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Chip className={grossMargin >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}>
                {grossMargin >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
              </Chip>
              <span className="text-sm sm:text-base">{t('kpi.grossMargin.title')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-semibold">
              {formatMoneyBase(grossMargin, baseCode)}
            </div>
            <div className="text-xs text-muted-foreground mt-1 hidden sm:block">
              {revenueWindow > 0 ? `${(grossMarginPct * 100).toFixed(1)}% ${t('kpi.grossMargin.help_pct')}` : t('common.dash')}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Low stock */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <span className="text-lg">{t('lowStock.title')} {warehouseId !== 'ALL' ? t('lowStock.warehouseOnly') : ''}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lowStock.length === 0 ? (
            <p className="text-muted-foreground">{t('lowStock.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">{t('table.item')}</th>
                    <th className="py-2 pr-2">{t('table.sku')}</th>
                    <th className="py-2 pr-2">{t('table.onHand')}</th>
                    <th className="py-2 pr-2">{t('table.minStock')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map(({ item, onHand, min }) => (
                    <tr key={item.id} className="border-b">
                      <td className="py-2 pr-2 max-w-[120px] truncate">{item.name}</td>
                      <td className="py-2 pr-2">{item.sku}</td>
                      <td className={`py-2 pr-2 ${onHand < min ? 'text-rose-600 font-medium' : ''}`}>{onHand}</td>
                      <td className="py-2 pr-2">{min}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top products by GM */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('topProducts.title', { days: windowDays })}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {topGM.length === 0 ? (
            <p className="text-muted-foreground">{t('topProducts.empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">{t('table.item')}</th>
                  <th className="py-2 pr-2">{t('table.sku')}</th>
                  <th className="py-2 pr-2">{t('table.revenue')}</th>
                  <th className="py-2 pr-2">{t('table.cogs')}</th>
                  <th className="py-2 pr-2">{t('table.grossMargin')}</th>
                  <th className="py-2 pr-2">{t('table.gmPct')}</th>
                </tr>
              </thead>
              <tbody>
                {topGM.map(row => {
                  const pctStr = row.revenue > 0 ? (row.pct * 100).toFixed(1) + '%' : t('common.dash')
                  const pctClass = row.revenue > 0 && row.pct < 0 ? 'text-rose-600' : ''
                  return (
                    <tr key={row.itemId} className="border-b">
                      <td className="py-2 pr-2 max-w-[100px] truncate">{row.name}</td>
                      <td className="py-2 pr-2">{row.sku}</td>
                      <td className="py-2 pr-2">{formatMoneyBase(row.revenue, baseCode)}</td>
                      <td className="py-2 pr-2">{formatMoneyBase(row.cogs, baseCode)}</td>
                      <td className={`py-2 pr-2 ${row.gm < 0 ? 'text-rose-600' : ''}`}>{formatMoneyBase(row.gm, baseCode)}</td>
                      <td className={`py-2 pr-2 ${pctClass}`}>{pctStr}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="text-xs text-muted-foreground mt-2 hidden sm:block">
            {t('topProducts.footnote')}
          </div>
        </CardContent>
      </Card>

      {/* Recent movements (5) + "All Transactions" button */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg flex items-center gap-2">
              {t('recentMovements.title')}
            </CardTitle>
            <Button size="sm" variant="outline" onClick={() => navigate('/transactions')} className="w-full sm:w-auto">
              {tt('recentMovements.all', 'All Transactions')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recentMoves.length === 0 ? (
            <p className="text-muted-foreground">{t('recentMovements.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">{t('table.date')}</th>
                    <th className="py-2 pr-2">{t('table.type')}</th>
                    <th className="py-2 pr-2">{t('table.item')}</th>
                    <th className="py-2 pr-2">{t('table.qtyBase')}</th>
                    <th className="py-2 pr-2">{t('table.value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentMoves.map(m => {
                    const it = itemById.get(m.item_id)
                    const label = it ? `${it.name} (${it.sku})` : m.item_id
                    const val = Number.isFinite(m.total_value) ? num(m.total_value) : num(m.unit_cost) * num(m.qty_base)
                    return (
                      <tr key={m.id} className="border-b">
                        <td className="py-2 pr-2 whitespace-nowrap text-xs">{new Date(m.created_at).toLocaleDateString(lang)}</td>
                        <td className="py-2 pr-2 capitalize">
                          {movementLabel(m.type)}
                        </td>
                        <td className="py-2 pr-2 max-w-[100px] truncate">{label}</td>
                        <td className="py-2 pr-2">{num(m.qty_base)}</td>
                        <td className="py-2 pr-2">{formatMoneyBase(val, baseCode)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}