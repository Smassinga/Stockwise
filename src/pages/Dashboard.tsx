// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { useOrg } from '../hooks/useOrg'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Button } from '../components/ui/button'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../components/ui/sheet'
import { Badge } from '../components/ui/badge'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { cn } from '../lib/utils'

// per-icon imports to avoid lucide bundle resolution issues
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Calendar,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Coins,
  DollarSign,
  Package,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

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
const shippedLike = (s: string) => ['shipped', 'completed', 'delivered', 'closed'].includes(String(s).toLowerCase())
const MS_PER_DAY = 24 * 60 * 60 * 1000

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
  const { companyId, companyName } = useOrg()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [windowLoading, setWindowLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [baseCode, setBaseCode] = useState<string>('MZN')
  const money = (amount: number) => formatMoneyBase(amount, baseCode, lang === 'pt' ? 'pt-MZ' : 'en-MZ')

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
          setShipmentsWin([]); setMvByIdWin(new Map())
          setBaseCode('MZN')
          return
        }

        const base = await getBaseCurrencyCode(companyId)

        // All reads explicitly fenced by company_id
        const [whRes, itRes, slRes, mvRes] = await Promise.all([
          supabase.from('warehouses').select('id,name').eq('company_id', companyId).order('name', { ascending: true }),
          // IMPORTANT: base table + snake_case column
          supabase.from('items').select('id,sku,name,min_stock').eq('company_id', companyId),
          supabase.from('stock_levels').select('id,item_id,warehouse_id,bin_id,qty,avg_cost,updated_at').eq('company_id', companyId),
          supabase
            .from('stock_movements')
            .select('id,item_id,qty_base,type,created_at,unit_cost,total_value,warehouse_from_id,warehouse_to_id,ref_type,ref_id,ref_line_id')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(5),
        ])

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
          if (!whRes.data?.length) setWarehouseId('ALL')
        }
      } catch (e: any) {
        console.error(e)
        if (!cancelled) setError(e?.message || tt('dashboard.loadError', 'Failed to load dashboard data'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [companyId])

  const periodAnchorMs = useMemo(() => Date.now(), [companyId, windowDays])
  const windowDurationMs = useMemo(() => windowDays * MS_PER_DAY, [windowDays])
  const currentWindowStartMs = useMemo(() => periodAnchorMs - windowDurationMs, [periodAnchorMs, windowDurationMs])
  const comparisonWindowStartMs = useMemo(() => currentWindowStartMs - windowDurationMs, [currentWindowStartMs, windowDurationMs])
  const currentWindowStartISO = useMemo(() => new Date(currentWindowStartMs).toISOString(), [currentWindowStartMs])
  const comparisonWindowStartISO = useMemo(() => new Date(comparisonWindowStartMs).toISOString(), [comparisonWindowStartMs])
  const periodEndISO = useMemo(() => new Date(periodAnchorMs).toISOString(), [periodAnchorMs])

  // Current + prior-window reads for KPIs, comparisons, top products, and the daily sheet.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId) {
        setSOs([])
        setSOL([])
        setShipmentsWin([])
        setMvByIdWin(new Map())
        return
      }

      try {
        setWindowLoading(true)
        const [updatedOrdersRes, createdOrdersRes, shipRowsRes] = await Promise.all([
          supabase
            .from('sales_orders')
            .select('id,status,currency_code,fx_to_base,total_amount,updated_at,created_at')
            .eq('company_id', companyId)
            .gte('updated_at', comparisonWindowStartISO),
          supabase
            .from('sales_orders')
            .select('id,status,currency_code,fx_to_base,total_amount,updated_at,created_at')
            .eq('company_id', companyId)
            .is('updated_at', null)
            .gte('created_at', comparisonWindowStartISO),
          supabase
            .from('sales_shipments')
            .select('id,so_id,item_id,qty_base,created_at,company_id,movement_id')
            .eq('company_id', companyId)
            .gte('created_at', comparisonWindowStartISO)
            .lte('created_at', periodEndISO),
        ])

        if (updatedOrdersRes.error) throw updatedOrdersRes.error
        if (createdOrdersRes.error) throw createdOrdersRes.error
        if (shipRowsRes.error) throw shipRowsRes.error

        const mergedOrders = new Map<string, SO>()
        for (const order of (updatedOrdersRes.data || []) as SO[]) mergedOrders.set(order.id, order)
        for (const order of (createdOrdersRes.data || []) as SO[]) mergedOrders.set(order.id, order)

        const shippedOrders = Array.from(mergedOrders.values()).filter(order => shippedLike(order.status))
        const ships = (shipRowsRes.data || []) as ShipmentRowDash[]
        const soIds = shippedOrders.map(order => order.id)
        const mvIds = Array.from(new Set(ships.map(s => s.movement_id).filter(Boolean))) as string[]
        const mvMap = new Map<string, MovementCostRow>()
        const [lineRowsRes, mvRowsRes] = await Promise.all([
          soIds.length
            ? supabase
                .from('sales_order_lines')
                .select('so_id,item_id,uom_id,qty,unit_price,line_total')
                .eq('company_id', companyId)
                .in('so_id', soIds)
            : Promise.resolve({ data: [], error: null }),
          mvIds.length
            ? supabase
                .from('stock_movements')
                .select('id,qty_base,unit_cost,total_value,ref_type,type,company_id')
                .in('id', mvIds)
                .eq('company_id', companyId)
                .eq('ref_type', 'SO')
                .eq('type', 'issue')
            : Promise.resolve({ data: [], error: null }),
        ])

        if (lineRowsRes.error) throw lineRowsRes.error
        if (mvRowsRes.error) throw mvRowsRes.error

        for (const movement of (mvRowsRes.data || []) as MovementCostRow[]) mvMap.set(movement.id, movement)

        if (!cancelled) {
          setSOs(shippedOrders)
          setSOL((lineRowsRes.data || []) as SOL[])
          setShipmentsWin(ships)
          setMvByIdWin(mvMap)
        }
      } catch (e: any) {
        console.error(e)
        if (!cancelled) {
          setError(e?.message || tt('dashboard.refreshError', 'Failed to refresh dashboard metrics'))
          setSOs([])
          setSOL([])
          setShipmentsWin([])
          setMvByIdWin(new Map())
        }
      } finally {
        if (!cancelled) setWindowLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, comparisonWindowStartISO, periodEndISO])

  // stock filtered by warehouse
  const stockFiltered = useMemo(() => (warehouseId === 'ALL' ? stock : stock.filter(r => r.warehouse_id === warehouseId)), [stock, warehouseId])

  // Inventory value
  const inventoryValue = useMemo(() => stockFiltered.reduce((s, r) => s + num(r.qty) * num(r.avg_cost), 0), [stockFiltered])
  const inventoryUnits = useMemo(() => stockFiltered.reduce((s, r) => s + num(r.qty), 0), [stockFiltered])

  const orderActivityMs = (order: SO) => {
    const value = order.updated_at || order.created_at
    const parsed = value ? new Date(value).getTime() : Number.NaN
    return Number.isFinite(parsed) ? parsed : null
  }

  const shippedCurrent = useMemo(
    () => sos.filter((order) => {
      const activityMs = orderActivityMs(order)
      return activityMs !== null && activityMs >= currentWindowStartMs
    }),
    [currentWindowStartMs, sos],
  )

  const shippedPrevious = useMemo(
    () => sos.filter((order) => {
      const activityMs = orderActivityMs(order)
      return activityMs !== null && activityMs >= comparisonWindowStartMs && activityMs < currentWindowStartMs
    }),
    [comparisonWindowStartMs, currentWindowStartMs, sos],
  )

  const shippedCurrentIds = useMemo(() => new Set(shippedCurrent.map((order) => order.id)), [shippedCurrent])
  const shippedPreviousIds = useMemo(() => new Set(shippedPrevious.map((order) => order.id)), [shippedPrevious])

  const shipmentsCurrent = useMemo(
    () => shipmentsWin.filter((shipment) => new Date(shipment.created_at).getTime() >= currentWindowStartMs),
    [currentWindowStartMs, shipmentsWin],
  )

  const shipmentsPrevious = useMemo(
    () =>
      shipmentsWin.filter((shipment) => {
        const createdMs = new Date(shipment.created_at).getTime()
        return createdMs >= comparisonWindowStartMs && createdMs < currentWindowStartMs
      }),
    [comparisonWindowStartMs, currentWindowStartMs, shipmentsWin],
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
    for (const soId of shippedCurrentIds) sum += revenueBaseBySO.get(soId) || 0
    return sum
  }, [revenueBaseBySO, shippedCurrentIds])

  const revenuePrevious = useMemo(() => {
    let sum = 0
    for (const soId of shippedPreviousIds) sum += revenueBaseBySO.get(soId) || 0
    return sum
  }, [revenueBaseBySO, shippedPreviousIds])

  // --- NEW: COGS in window from shipments → linked SO/issue movements
  const cogsWindow = useMemo(() => {
    let sum = 0
    for (const s of shipmentsCurrent) {
      const mv = s.movement_id ? mvByIdWin.get(s.movement_id) : undefined
      sum += movementCost(mv, s.qty_base)
    }
    return sum
  }, [mvByIdWin, shipmentsCurrent])

  const cogsPrevious = useMemo(() => {
    let sum = 0
    for (const s of shipmentsPrevious) {
      const mv = s.movement_id ? mvByIdWin.get(s.movement_id) : undefined
      sum += movementCost(mv, s.qty_base)
    }
    return sum
  }, [mvByIdWin, shipmentsPrevious])

  // Gross margin
  const grossMargin = revenueWindow - cogsWindow
  const grossMarginPrevious = revenuePrevious - cogsPrevious
  const grossMarginPct = revenueWindow > 0 ? (grossMargin / revenueWindow) : 0
  const hasRevenueData = revenueWindow > 0 || shippedCurrentIds.size > 0
  const hasShipmentData = cogsWindow > 0 || shipmentsCurrent.length > 0
  const hasPreviousRevenueData = revenuePrevious > 0 || shippedPreviousIds.size > 0
  const hasPreviousShipmentData = cogsPrevious > 0 || shipmentsPrevious.length > 0

  // Low stock list
  const lowStock = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of stockFiltered) totals.set(r.item_id, (totals.get(r.item_id) || 0) + num(r.qty))
    return items
      .filter(i => typeof i.minStock === 'number')
      .map(i => {
        const onHand = totals.get(i.id) || 0
        const min = Number(i.minStock)
        const ratio = min > 0 ? onHand / min : 1
        return {
          item: i,
          onHand,
          min,
          shortage: Math.max(0, min - onHand),
          severity: onHand <= 0 ? 'critical' : ratio <= 0.5 ? 'high' : 'medium',
        }
      })
      .filter(x => x.onHand < x.min)
      .sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2 }
        return order[a.severity as keyof typeof order] - order[b.severity as keyof typeof order] || b.shortage - a.shortage
      })
      .slice(0, 6)
  }, [items, stockFiltered])

  // ---------- Top Products by GM (shipment-linked costs) ----------
  const topGM = useMemo(() => {
    // revenue distribution (same logic as before)
    const lineRevBySOItem = new Map<string, Map<string, number>>() // soId -> (itemId -> rev)
    const linesRevSO = new Map<string, number>()                    // soId -> rev sum
    const shippedSet = new Set(shippedCurrent.map((order) => order.id))
    for (const l of sol) {
      const soId = l.so_id
      if (!soId) continue
      if (!shippedSet.has(soId)) continue
      const fx = fxBySO.get(soId) ?? 1
      const r = num(l.line_total) * fx
      if (!lineRevBySOItem.has(soId)) lineRevBySOItem.set(soId, new Map())
      const m = lineRevBySOItem.get(soId)!
      m.set(l.item_id, (m.get(l.item_id) || 0) + r)
      linesRevSO.set(soId, (linesRevSO.get(soId) || 0) + r)
    }

    // Shipment-linked cost by order + item for the current window.
    const costBySOItem = new Map<string, Map<string, number>>() // soId -> (itemId -> cost)
    const costSumBySO = new Map<string, number>()
    for (const s of shipmentsCurrent) {
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

    // Shipment-linked COGS by item for the current window.
    const cogsByItem = new Map<string, number>()
    for (const s of shipmentsCurrent) {
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
  }, [fxBySO, itemById, mvByIdWin, revenueBaseBySO, shippedCurrent, shipmentsCurrent, sol])

  // ----- Available years for Daily selector -----
  const availableYears = useMemo(() => {
    const set = new Set<number>()
    for (const s of sos) {
      const d = s.updated_at || s.created_at
      if (!d) continue
      const y = new Date(d).getFullYear()
      if (!Number.isNaN(y)) set.add(y)
    }
    for (const shipment of shipmentsWin) {
      const y = new Date(shipment.created_at).getFullYear()
      if (!Number.isNaN(y)) set.add(y)
    }
    const arr = Array.from(set).sort((a, b) => a - b)
    return arr.length ? arr : [nowDate.getFullYear()]
  }, [sos, shipmentsWin, nowDate])

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

  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const recentMoves = moves.slice(0, 5)
  const itemsWithoutMinStock = useMemo(() => items.filter((item) => item.minStock == null).length, [items])
  const criticalLowStockCount = lowStock.filter((entry) => entry.severity === 'critical').length
  const marginUnderPressure = hasRevenueData && grossMargin < 0
  const hasAnyOperationalData = items.length > 0 || stock.length > 0 || sos.length > 0 || moves.length > 0
  const urgentActionCount = lowStock.length + (itemsWithoutMinStock > 0 ? 1 : 0) + (marginUnderPressure ? 1 : 0)
  const latestMovement = recentMoves[0] || null
  const currentWindowLabel = tt(`window.${windowDays}`, `Last ${windowDays} days`)

  const operatingStatus = !hasAnyOperationalData
    ? 'setup'
    : criticalLowStockCount > 0 || marginUnderPressure
      ? 'critical'
      : lowStock.length > 0 || itemsWithoutMinStock > 0
        ? 'attention'
        : 'healthy'

  if (loading || (windowLoading && !sos.length && !shipmentsWin.length)) {
    return (
      <div className="app-page app-page--analytics space-y-6">
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
    <div className={`flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background ${className}`} aria-hidden>
      {children}
    </div>
  )

  const formatCount = (value: number) => value.toLocaleString(locale)
  const formatShortDateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

  const formatSignedCount = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toLocaleString(locale)}`
  const formatSignedMoney = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${money(Math.abs(value))}`
  const formatSignedPercent = (value: number) => `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(1)}%`

  const comparisonCopy = (
    current: number,
    previous: number,
    hasPrevious: boolean,
    formatter: (value: number) => string,
  ) => {
    if (!hasPrevious) {
      return tt('dashboard.previousUnavailable', 'Not enough prior history yet.')
    }

    const delta = current - previous
    if (Math.abs(delta) < 0.005) {
      return tt('dashboard.sameAsPrevious', 'Flat vs previous window')
    }

    return `${formatter(delta)} ${tt('dashboard.previousWindow', 'vs previous window')}`
  }

  const movementLabel = (type: MovementRow['type']) => {
    switch (type) {
      case 'receive': return t('movement.receive')
      case 'issue': return t('movement.issue')
      case 'transfer': return t('movement.transfer')
      case 'adjust': return t('movement.adjust')
      default: return t('common.dash')
    }
  }

  const statusMeta = {
    healthy: {
      label: tt('dashboard.statusHealthy', 'Operating normally'),
      summary: tt(
        'dashboard.summaryHealthy',
        'Stock, activity, and operational margin look stable in the selected window.',
      ),
      badgeClass:
        'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/40 dark:bg-emerald-300/20 dark:text-emerald-100',
      iconClass: 'text-emerald-700 dark:text-emerald-300',
      icon: <CheckCircle2 size={18} />,
    },
    attention: {
      label: tt('dashboard.statusAttention', 'Needs attention'),
      summary: tt(
        'dashboard.summaryAttention',
        'There are stock or setup exceptions worth reviewing today.',
      ),
      badgeClass:
        'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/50 dark:bg-amber-300/20 dark:text-amber-100',
      iconClass: 'text-amber-700 dark:text-amber-300',
      icon: <CircleAlert size={18} />,
    },
    critical: {
      label: tt('dashboard.statusCritical', 'Action required'),
      summary: tt(
        'dashboard.summaryCritical',
        'Stock outages or negative gross margin need review in the selected window.',
      ),
      badgeClass:
        'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-300/50 dark:bg-rose-300/20 dark:text-rose-100',
      iconClass: 'text-rose-700 dark:text-rose-300',
      icon: <AlertTriangle size={18} />,
    },
    setup: {
      label: tt('dashboard.statusSetup', 'Setup in progress'),
      summary: tt(
        'dashboard.summarySetup',
        'Complete initial stock, sales, or item setup so the dashboard becomes a live operating view.',
      ),
      badgeClass:
        'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-300/50 dark:bg-sky-300/20 dark:text-sky-100',
      iconClass: 'text-sky-700 dark:text-sky-300',
      icon: <Clock3 size={18} />,
    },
  }[operatingStatus]

  const latestMovementAt = latestMovement ? new Date(latestMovement.created_at).getTime() : Number.NaN
  const daysSinceLatestMovement = Number.isFinite(latestMovementAt)
    ? Math.max(0, Math.floor((Date.now() - latestMovementAt) / 86_400_000))
    : null
  const activityFreshness = latestMovement
    ? daysSinceLatestMovement === 0
      ? tt('dashboard.activityFreshToday', 'Updated today')
      : daysSinceLatestMovement != null && daysSinceLatestMovement <= 7
        ? tt('dashboard.activityFreshRecent', 'Updated {count} days ago', { count: daysSinceLatestMovement })
        : tt('dashboard.activityFreshQuiet', 'No movement in {count} days', { count: daysSinceLatestMovement ?? 0 })
    : tt('dashboard.activityFreshNone', 'No warehouse movement recorded yet')

  const statusPanelClass = {
    healthy: 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-300/25 dark:bg-emerald-300/10',
    attention: 'border-amber-200/80 bg-amber-50/75 dark:border-amber-300/30 dark:bg-amber-300/10',
    critical: 'border-rose-200/80 bg-rose-50/75 dark:border-rose-300/30 dark:bg-rose-300/10',
    setup: 'border-sky-200/80 bg-sky-50/75 dark:border-sky-300/30 dark:bg-sky-300/10',
  }[operatingStatus]

  const primaryAction = lowStock.length > 0
    ? {
        label: tt('dashboard.primaryActionLowStock', 'Start with low stock'),
        help: tt('dashboard.primaryActionLowStockHelp', 'Review replenishment gaps before lower-priority metrics.'),
        action: () => navigate('/items'),
      }
    : itemsWithoutMinStock > 0
      ? {
          label: tt('dashboard.primaryActionSetup', 'Complete item thresholds'),
          help: tt('dashboard.primaryActionSetupHelp', 'Set minimum stock levels so exception signals become reliable.'),
          action: () => navigate('/items'),
        }
      : marginUnderPressure
        ? {
            label: tt('dashboard.primaryActionMargin', 'Review margin pressure'),
            help: tt('dashboard.primaryActionMarginHelp', 'Open movements connected to the selected operating window.'),
            action: () => navigate('/transactions'),
          }
        : hasAnyOperationalData
          ? {
              label: tt('dashboard.primaryActionActivity', 'Review latest movements'),
              help: tt('dashboard.primaryActionActivityHelp', 'Use the activity trail to confirm what changed most recently.'),
              action: () => navigate('/transactions'),
            }
          : {
              label: tt('dashboard.primaryActionSetupFirst', 'Add first items'),
              help: tt('dashboard.primaryActionSetupFirstHelp', 'Create items and stock movements to turn this into a live operating dashboard.'),
              action: () => navigate('/items'),
            }

  const executiveTiles = [
    {
      label: tt('dashboard.executiveTileActions', 'Urgent actions'),
      value: formatCount(urgentActionCount),
      help: urgentActionCount
        ? tt('dashboard.actionHelpLow', 'Low stock is ordered by severity so the most urgent gaps surface first.')
        : tt('dashboard.actionHelpClear', 'There are no urgent stock exceptions in the current warehouse view.'),
      tone: urgentActionCount ? 'critical' : 'healthy',
    },
    {
      label: tt('dashboard.executiveTileLowStock', 'Low stock'),
      value: formatCount(lowStock.length),
      help: lowStock.length
        ? tt('dashboard.inventoryAttention', '{count} items are below minimum stock.', { count: lowStock.length })
        : tt('dashboard.inventoryHealthy', 'No low-stock exceptions in the current view.'),
      tone: lowStock.length ? 'attention' : 'healthy',
    },
    {
      label: tt('dashboard.executiveTileMargin', 'Gross margin'),
      value: hasRevenueData ? `${(grossMarginPct * 100).toFixed(1)}%` : t('common.dash'),
      help: revenueWindow > 0
        ? (grossMargin >= 0
            ? tt('dashboard.marginPositive', 'Operational revenue remains ahead of COGS in the active window.')
            : tt('dashboard.marginNegative', 'COGS is currently higher than operational revenue in the active window.'))
        : tt('dashboard.marginEmpty', 'Margin will appear once shipment-linked operational revenue is present in the selected window.'),
      tone: !hasRevenueData ? 'neutral' : grossMargin >= 0 ? 'healthy' : 'critical',
    },
    {
      label: tt('dashboard.executiveTileLatest', 'Latest movement'),
      value: latestMovement ? movementLabel(latestMovement.type) : t('common.dash'),
      help: latestMovement ? `${activityFreshness} - ${formatShortDateTime(latestMovement.created_at)}` : activityFreshness,
      tone: latestMovement ? 'neutral' : 'attention',
    },
  ]

  const actionCards = [
    lowStock.length > 0
      ? {
          title: tt('dashboard.actionCardLowStockTitle', 'Replenish low stock'),
          body: tt('dashboard.actionCardLowStockBody', '{count} items are already below minimum stock.', { count: lowStock.length }),
          count: formatCount(lowStock.length),
          tone: 'critical',
          actionLabel: tt('dashboard.reviewItems', 'Review items'),
          action: () => navigate('/items'),
        }
      : null,
    itemsWithoutMinStock > 0
      ? {
          title: tt('dashboard.actionCardSetupTitle', 'Complete stock setup'),
          body: tt('dashboard.actionCardSetupBody', '{count} items still need a minimum-stock threshold.', { count: itemsWithoutMinStock }),
          count: formatCount(itemsWithoutMinStock),
          tone: 'attention',
          actionLabel: tt('dashboard.reviewItems', 'Review items'),
          action: () => navigate('/items'),
        }
      : null,
    marginUnderPressure
      ? {
          title: tt('dashboard.actionCardMarginTitle', 'Review margin pressure'),
          body: tt('dashboard.actionCardMarginBody', 'Operational gross margin is negative in the active window.'),
          count: money(grossMargin),
          tone: 'critical',
          actionLabel: tt('dashboard.reviewTransactions', 'Review movements'),
          action: () => navigate('/transactions'),
        }
      : null,
    !lowStock.length && !itemsWithoutMinStock && !marginUnderPressure
      ? {
          title: tt('dashboard.actionCardMonitorTitle', 'Monitor current flow'),
          body: tt('dashboard.actionCardMonitorBody', 'No urgent exceptions are open right now.'),
          count: formatCount(shippedCurrent.length),
          tone: 'healthy',
          actionLabel: tt('dashboard.reviewTransactions', 'Review movements'),
          action: () => navigate('/transactions'),
        }
      : null,
  ].filter(Boolean) as Array<{
    title: string
    body: string
    count: string
    tone: 'critical' | 'attention' | 'healthy'
    actionLabel: string
    action: () => void
  }>

  const operationalSummary = [
    {
      label: tt('dashboard.activityOrders', 'Shipped orders'),
      value: formatCount(shippedCurrent.length),
      help: comparisonCopy(
        shippedCurrent.length,
        shippedPrevious.length,
        hasPreviousRevenueData,
        formatSignedCount,
      ),
    },
    {
      label: tt('dashboard.activityShipments', 'Shipment issues'),
      value: formatCount(shipmentsCurrent.length),
      help: comparisonCopy(
        shipmentsCurrent.length,
        shipmentsPrevious.length,
        hasPreviousShipmentData,
        formatSignedCount,
      ),
    },
    {
      label: tt('dashboard.activityLatest', 'Latest movement'),
      value: latestMovement ? movementLabel(latestMovement.type) : t('common.dash'),
      help: latestMovement ? formatShortDateTime(latestMovement.created_at) : tt('dashboard.noRecentMovement', 'No recent movement yet'),
    },
  ]

  const sectionTitle = ({ title, description, action }: { title: string; description: string; action?: ReactNode }) => (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="screen-intro">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="screen-subtitle">{description}</p>
      </div>
      {action}
    </div>
  )

  const monthName = (m: number) => new Date(2000, m, 1).toLocaleString(lang, { month: 'long' })

  return (
    <div className="app-page app-page--analytics">
      <section className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-card/96 shadow-[0_22px_50px_-34px_hsl(var(--foreground)/0.24)]">
        <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)] xl:items-start xl:p-8 2xl:grid-cols-[minmax(0,1.24fr)_minmax(24rem,0.76fr)]">
          <div className="screen-intro">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5 rounded-full border-primary/20 bg-primary/8 px-3 py-1 text-primary">
                <Building2 className="h-3.5 w-3.5" />
                <span className="truncate">{companyName || tt('company.selectCompany', 'Company')}</span>
              </Badge>
              <Badge variant="outline" className="rounded-full px-3 py-1">
                {tt('filters.warehouse.label', 'Warehouse')}: {warehouseId === 'ALL' ? t('filters.warehouse.all') : warehouses.find(w => w.id === warehouseId)?.name || tt('filters.warehouse.label', 'Warehouse')}
              </Badge>
              {windowLoading && (
                <Badge variant="outline" className="rounded-full px-3 py-1 text-primary">
                  {tt('common.refresh', 'Refreshing')}...
                </Badge>
              )}
            </div>
            <div>
              <h1 className="screen-title text-2xl sm:text-3xl">{t('dashboard.title')}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {tt('dashboard.subtitle', "Use this dashboard to spot today's operating risks, recent changes, and shipment-linked performance without leaving the main workspace.")}
              </p>
            </div>
          </div>

          <Card className="border-border/70 bg-background/88 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{tt('reports.filters', 'Filters')}</CardTitle>
            <CardDescription>
              {tt('dashboard.filtersHelp', 'Adjust the date window and warehouse without losing context. The daily breakdown follows the current window.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,14rem)_auto] md:items-end">
            {/* Date window (KPIs/top products) */}
            <div className="w-full">
              <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))} disabled={windowLoading}>
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
            <div className="w-full">
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
            <div className="flex flex-wrap items-center gap-3">
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
                    <SheetDescription>{tt('daily.desc', 'Daily totals for the selected window')}</SheetDescription>
                  </SheetHeader>

                  <SheetBody className="px-4 pb-6 md:px-0">
                    <div className="mt-2 mb-4 flex flex-wrap items-center gap-2">
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
                      <span className="text-xs text-muted-foreground">
                        {tt('dashboard.dailyWindowNote', 'Daily rows reflect the active dashboard window.')}
                      </span>
                    </div>

                    <div className="mt-2 rounded-md border">
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
                                <td className="py-2 pr-2">{money(r.revenue)}</td>
                                <td className="py-2 pr-2">{money(r.cogs)}</td>
                                <td className="py-2 pr-2">{money(r.revenue - r.cogs)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </SheetBody>
                </SheetContent>
              </Sheet>
            </div>
          </CardContent>
        </Card>
        </div>
      </section>

      {error && (
        <Card className="border-red-200 bg-red-50/70 shadow-sm dark:border-red-500/30 dark:bg-red-500/10">
          <CardHeader><CardTitle>{t('common.headsUp')}</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-red-600">{error}</p></CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {sectionTitle({
          title: tt('dashboard.executiveSection', 'Operating status'),
          description: tt('dashboard.executiveHelp', 'Use this section to decide quickly whether the business is operating normally or needs attention today.'),
        })}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(19rem,0.82fr)]">
          <section className={cn('overflow-hidden rounded-[1.5rem] border p-5 shadow-sm sm:p-6', statusPanelClass)}>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn('w-fit rounded-full px-3 py-1 text-xs font-medium', statusMeta.badgeClass)}>
                    {tt('dashboard.operatingAnswer', 'Operating answer')}: {statusMeta.label}
                  </Badge>
                  <span className="text-xs font-medium text-muted-foreground">{currentWindowLabel}</span>
                </div>

                <div>
                  <h3 className="text-2xl font-semibold tracking-tight">{statusMeta.label}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{statusMeta.summary}</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button onClick={primaryAction.action} className="w-full sm:w-auto">
                    {primaryAction.label}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <p className="text-xs leading-5 text-muted-foreground sm:max-w-md">{primaryAction.help}</p>
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-background/80 bg-background/92 p-4 shadow-[0_20px_42px_-34px_hsl(var(--foreground)/0.48)] dark:border-white/10 dark:bg-background/80">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {tt('dashboard.executiveTileActions', 'Urgent actions')}
                    </div>
                    <div className={cn('mt-2 text-4xl font-semibold tracking-tight tabular-nums', urgentActionCount > 0 && statusMeta.iconClass)}>
                      {formatCount(urgentActionCount)}
                    </div>
                  </div>
                  <Chip className={statusMeta.iconClass}>{statusMeta.icon}</Chip>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {urgentActionCount > 0
                    ? tt('dashboard.actionHelpLow', 'Low stock is ordered by severity so the most urgent gaps surface first.')
                    : tt('dashboard.actionHelpClear', 'There are no urgent stock exceptions in the current warehouse view.')}
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {executiveTiles.map((tile) => (
                <div key={tile.label} className="rounded-[1rem] border border-background/80 bg-background/72 p-4 shadow-[0_14px_32px_-30px_hsl(var(--foreground)/0.38)] transition-colors hover:bg-background/88 dark:border-white/10">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tile.label}</div>
                  <div
                    className={cn(
                      'mt-2 text-xl font-semibold tracking-tight tabular-nums',
                      tile.tone === 'critical' && 'text-rose-600 dark:text-rose-300',
                      tile.tone === 'attention' && 'text-amber-700 dark:text-amber-300',
                      tile.tone === 'healthy' && 'text-emerald-700 dark:text-emerald-300',
                    )}
                  >
                    {tile.value}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{tile.help}</p>
                </div>
              ))}
            </div>
          </section>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="space-y-1">
              <CardTitle className="text-lg">{tt('dashboard.currentWindowSection', 'Current window')}</CardTitle>
              <CardDescription>
                {tt('dashboard.currentWindowHelp', 'Compact signals for the selected {days}-day operating window.', { days: windowDays })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-[1.15rem] border border-border/70 bg-background/75 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t('kpi.revenue.title', { days: windowDays })}</div>
                <div className="mt-2 text-xl font-semibold tracking-tight">{money(revenueWindow)}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {hasRevenueData
                    ? tt('dashboard.revenueOrders', '{count} shipped orders contributed to this operational revenue view.', { count: shippedCurrent.length })
                    : tt('dashboard.revenueEmpty', 'No shipment-linked order revenue is available in the selected window.')}
                </div>
              </div>

              <div className="rounded-[1.15rem] border border-border/70 bg-background/75 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t('kpi.cogs.title', { days: windowDays })}</div>
                <div className="mt-2 text-xl font-semibold tracking-tight">{money(cogsWindow)}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {hasShipmentData
                    ? tt('dashboard.cogsShipments', '{count} shipped issue movements contributed to COGS.', { count: shipmentsCurrent.length })
                    : tt('dashboard.cogsEmpty', 'No shipped issue movements were found in the selected window.')}
                </div>
              </div>

              <div className="rounded-[1.15rem] border border-border/70 bg-background/75 px-4 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t('kpi.grossMargin.title')}</div>
                <div className={cn('mt-2 text-xl font-semibold tracking-tight', grossMargin < 0 && 'text-rose-600 dark:text-rose-300')}>
                  {money(grossMargin)}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {revenueWindow > 0
                    ? `${(grossMarginPct * 100).toFixed(1)}% ${t('kpi.grossMargin.help_pct')}`
                    : tt('dashboard.marginEmpty', 'Margin will appear once shipment-linked operational revenue is present in the selected window.')}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        {sectionTitle({
          title: tt('dashboard.actionSection', 'Action needed'),
          description: lowStock.length || itemsWithoutMinStock || marginUnderPressure
            ? tt('dashboard.actionHelpLow', 'Low stock is ordered by severity so the most urgent gaps surface first.')
            : tt('dashboard.actionHelpClear', 'There are no urgent stock exceptions in the current warehouse view.'),
        })}

        <div className="grid gap-4 lg:grid-cols-3">
          {actionCards.map((card) => (
            <Card key={card.title} className="group border-border/80 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_22px_44px_-34px_hsl(var(--foreground)/0.42)]">
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{card.title}</div>
                    <div className={cn(
                      'mt-2 text-2xl font-semibold tracking-tight',
                      card.tone === 'critical' && 'text-rose-600 dark:text-rose-300',
                      card.tone === 'attention' && 'text-amber-600 dark:text-amber-300',
                      card.tone === 'healthy' && 'text-emerald-600 dark:text-emerald-300',
                    )}>
                      {card.count}
                    </div>
                  </div>
                  <Chip
                    className={cn(
                      card.tone === 'critical' && 'text-rose-700 dark:text-rose-300',
                      card.tone === 'attention' && 'text-amber-700 dark:text-amber-300',
                      card.tone === 'healthy' && 'text-emerald-700 dark:text-emerald-300',
                    )}
                  >
                    {card.tone === 'healthy' ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
                  </Chip>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{card.body}</p>
                <Button variant="ghost" className="mt-auto h-auto justify-start px-0 text-sm font-medium text-primary hover:text-primary" onClick={card.action}>
                  {card.actionLabel}
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)] 2xl:grid-cols-[minmax(0,1.18fr)_minmax(22rem,0.82fr)]">
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <span>{t('lowStock.title')}</span>
                </CardTitle>
                <CardDescription>
                  {warehouseId !== 'ALL'
                    ? `${t('lowStock.warehouseOnly')} ${warehouses.find(w => w.id === warehouseId)?.name || ''}`
                    : tt('dashboard.lowStockHelp', 'Items shown here are below their configured minimum stock level.')}
                </CardDescription>
              </div>
              <Badge variant="outline" className="w-fit px-2.5 py-1">
                {lowStock.length} {tt('dashboard.itemsLabel', 'items')}
              </Badge>
            </CardHeader>
            <CardContent>
              {lowStock.length === 0 ? (
                <div className="rounded-[1.25rem] border border-dashed border-border/70 bg-muted/10 px-4 py-8 text-center">
                  <p className="text-sm font-medium">
                    {tt('dashboard.lowStockClear', 'Everything in the current view is at or above minimum stock.')}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {itemsWithoutMinStock
                      ? tt('dashboard.actionCardSetupBody', '{count} items still need a minimum-stock threshold.', { count: itemsWithoutMinStock })
                      : tt('dashboard.inventoryHealthy', 'No low-stock exceptions in the current view.')}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {lowStock.map(({ item, onHand, min, shortage, severity }) => (
                    <div key={item.id} className="rounded-[1.2rem] border border-border/70 bg-background/65 p-4 shadow-[0_14px_30px_-28px_hsl(var(--foreground)/0.32)]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{item.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{item.sku}</div>
                        </div>
                        <span
                          className={cn(
                            'inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-medium',
                            severity === 'critical'
                              ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
                              : severity === 'high'
                                ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
                                : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
                          )}
                        >
                          {severity === 'critical'
                            ? tt('dashboard.urgencyCritical', 'Out of stock')
                            : severity === 'high'
                              ? tt('dashboard.urgencyHigh', 'Critical')
                              : tt('dashboard.urgencyMedium', 'Low')}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-2.5">
                          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t('table.onHand')}</div>
                          <div className="mt-1 font-mono text-base tabular-nums">{formatCount(onHand)}</div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-2.5">
                          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{t('table.minStock')}</div>
                          <div className="mt-1 font-mono text-base tabular-nums">{formatCount(min)}</div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-background/75 px-3 py-2.5">
                          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('dashboard.shortfall', 'Shortfall')}</div>
                          <div className="mt-1 font-mono text-base tabular-nums">{formatCount(shortage)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-lg">{tt('dashboard.reviewQueueTitle', 'Review queue')}</CardTitle>
                  <CardDescription>
                    {tt('dashboard.reviewQueueHelp', 'Keep the next operational follow-up visible without opening a separate report.')}
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate('/transactions')} className="w-full sm:w-auto">
                  <ArrowUpRight className="mr-2 h-4 w-4" />
                  {tt('dashboard.reviewTransactions', 'Review movements')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {urgentActionCount === 0 ? (
                <div className="rounded-[1.25rem] border border-dashed border-border/70 bg-muted/10 px-4 py-8 text-center">
                  <p className="text-sm font-medium">{tt('dashboard.reviewQueueClear', 'No review items are open right now.')}</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {tt('dashboard.actionCardMonitorBody', 'No urgent exceptions are open right now.')}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {lowStock.length > 0 && (
                    <div className="rounded-[1.15rem] border border-border/70 bg-background/68 px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{tt('dashboard.actionCardLowStockTitle', 'Replenish low stock')}</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {tt('dashboard.actionCardLowStockBody', '{count} items are already below minimum stock.', { count: lowStock.length })}
                          </div>
                        </div>
                        <Badge variant="outline" className="rounded-full px-2.5 py-1">{formatCount(lowStock.length)}</Badge>
                      </div>
                    </div>
                  )}

                  {itemsWithoutMinStock > 0 && (
                    <div className="rounded-[1.15rem] border border-border/70 bg-background/68 px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{tt('dashboard.actionCardSetupTitle', 'Complete stock setup')}</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {tt('dashboard.actionCardSetupBody', '{count} items still need a minimum-stock threshold.', { count: itemsWithoutMinStock })}
                          </div>
                        </div>
                        <Badge variant="outline" className="rounded-full px-2.5 py-1">{formatCount(itemsWithoutMinStock)}</Badge>
                      </div>
                    </div>
                  )}

                  {marginUnderPressure && (
                    <div className="rounded-[1.15rem] border border-rose-200/70 bg-rose-50/70 px-4 py-3.5 dark:border-rose-500/25 dark:bg-rose-500/10">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-rose-700 dark:text-rose-200">{tt('dashboard.actionCardMarginTitle', 'Review margin pressure')}</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {tt('dashboard.actionCardMarginBody', 'Operational gross margin is negative in the active window.')}
                          </div>
                        </div>
                        <Badge variant="outline" className="rounded-full border-rose-200 bg-white/70 px-2.5 py-1 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                          {money(grossMargin)}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        {sectionTitle({
          title: tt('dashboard.performanceSection', 'Performance snapshot'),
          description: tt('dashboard.performanceHelp', 'Current period numbers stay contextual, with previous-window references only when real data exists.'),
        })}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/80 shadow-sm">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardDescription className="text-xs font-medium uppercase tracking-[0.16em]">{t('kpi.inventoryValue.title')}</CardDescription>
                  <CardTitle className="mt-2 font-mono text-2xl tracking-tight tabular-nums">{money(inventoryValue)}</CardTitle>
                </div>
                <Chip className="text-sky-700 dark:text-sky-300"><Package size={18} /></Chip>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm font-medium">
                {formatCount(inventoryUnits)} {tt('dashboard.inventoryUnits', 'units on hand')}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {lowStock.length
                  ? tt('dashboard.inventoryAttention', '{count} items are below minimum stock.', { count: lowStock.length })
                  : tt('dashboard.inventoryHealthy', 'No low-stock exceptions in the current view.')}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardDescription className="text-xs font-medium uppercase tracking-[0.16em]">{t('kpi.revenue.title', { days: windowDays })}</CardDescription>
                  <CardTitle className="mt-2 font-mono text-2xl tracking-tight tabular-nums">{money(revenueWindow)}</CardTitle>
                </div>
                <Chip className="text-emerald-700 dark:text-emerald-300"><DollarSign size={18} /></Chip>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm font-medium">
                {hasRevenueData
                  ? tt('dashboard.revenueOrders', '{count} shipped orders contributed to this operational revenue view.', { count: shippedCurrent.length })
                  : tt('dashboard.revenueEmpty', 'No shipment-linked order revenue is available in the selected window.')}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {comparisonCopy(revenueWindow, revenuePrevious, hasPreviousRevenueData, formatSignedMoney)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardDescription className="text-xs font-medium uppercase tracking-[0.16em]">{t('kpi.cogs.title', { days: windowDays })}</CardDescription>
                  <CardTitle className="mt-2 font-mono text-2xl tracking-tight tabular-nums">{money(cogsWindow)}</CardTitle>
                </div>
                <Chip className="text-amber-700 dark:text-amber-300"><Coins size={18} /></Chip>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm font-medium">
                {hasShipmentData
                  ? tt('dashboard.cogsShipments', '{count} shipped issue movements contributed to COGS.', { count: shipmentsCurrent.length })
                  : tt('dashboard.cogsEmpty', 'No shipped issue movements were found in the selected window.')}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {comparisonCopy(cogsWindow, cogsPrevious, hasPreviousShipmentData, formatSignedMoney)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="space-y-3 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardDescription className="text-xs font-medium uppercase tracking-[0.16em]">{t('kpi.grossMargin.title')}</CardDescription>
                  <CardTitle className={cn('mt-2 font-mono text-2xl tracking-tight tabular-nums', grossMargin < 0 && 'text-rose-600 dark:text-rose-300')}>
                    {money(grossMargin)}
                  </CardTitle>
                </div>
                <Chip className={grossMargin >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}>
                  {grossMargin >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
                </Chip>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className={`text-sm font-medium ${grossMargin < 0 ? 'text-rose-600 dark:text-rose-300' : ''}`}>
                {revenueWindow > 0
                  ? `${(grossMarginPct * 100).toFixed(1)}% ${t('kpi.grossMargin.help_pct')}`
                  : tt('dashboard.marginEmpty', 'Margin will appear once shipment-linked operational revenue is present in the selected window.')}
              </div>
              <div className="text-xs leading-5 text-muted-foreground">
                {comparisonCopy(grossMarginPct * 100, grossMarginPrevious === 0 && revenuePrevious === 0 ? 0 : (revenuePrevious > 0 ? (grossMarginPrevious / revenuePrevious) * 100 : 0), hasPreviousRevenueData, formatSignedPercent)}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        {sectionTitle({
          title: tt('dashboard.activitySection', 'Operational activity'),
          description: tt('dashboard.activityHelp', 'Confirm the system is active and see what changed most recently.'),
          action: (
            <Button size="sm" variant="outline" onClick={() => setDailyOpen(true)} className="w-full sm:w-auto">
              <Calendar className="mr-2 h-4 w-4" />
              {t('daily.button')}
            </Button>
          ),
        })}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">{tt('dashboard.currentWindowSection', 'Current window')}</CardTitle>
              <CardDescription>{currentWindowLabel}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              {operationalSummary.map((summary) => (
                <div key={summary.label} className="rounded-[1.1rem] border border-border/70 bg-background/72 px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{summary.label}</div>
                  <div className="mt-2 text-xl font-semibold tracking-tight">{summary.value}</div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">{summary.help}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">{t('recentMovements.title')}</CardTitle>
              <CardDescription>
                {tt('dashboard.recentActivityHelp', 'The latest warehouse activity helps confirm that the tenant and warehouse context are aligned.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentMoves.length === 0 ? (
                <div className="rounded-[1.25rem] border border-dashed border-border/70 bg-muted/10 px-4 py-8 text-center">
                  <p className="text-sm font-medium">{t('recentMovements.empty')}</p>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{tt('dashboard.activityEmpty', 'No recent warehouse movement is available yet.')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentMoves.map((movement) => {
                    const item = itemById.get(movement.item_id)
                    const label = item ? `${item.name}${item.sku ? ` (${item.sku})` : ''}` : movement.item_id
                    const value = Number.isFinite(movement.total_value) ? num(movement.total_value) : num(movement.unit_cost) * num(movement.qty_base)

                    return (
                      <div key={movement.id} className="flex flex-col gap-2 rounded-[1.1rem] border border-border/70 bg-background/68 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{formatShortDateTime(movement.created_at)}</div>
                          </div>
                          <Badge variant="outline" className="rounded-full px-2.5 py-1">
                            {movementLabel(movement.type)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                          <span>{t('table.qtyBase')}: <span className="font-mono tabular-nums text-foreground">{formatCount(num(movement.qty_base))}</span></span>
                          <span>{t('table.value')}: <span className="font-mono tabular-nums text-foreground">{money(value)}</span></span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-4">
        {sectionTitle({
          title: tt('dashboard.insightsSection', 'Performance insights'),
          description: topGM.length
            ? tt('dashboard.insightsHelp', 'Operational revenue is attributed per item using line totals first, then shipment-linked COGS when line detail is missing. This is not a settlement-cleared margin view.')
            : tt('dashboard.insightsEmpty', 'No shipped orders were found in the active window, so the operational margin table is intentionally empty.'),
        })}

        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">{t('topProducts.title', { days: windowDays })}</CardTitle>
            <CardDescription>
              {topGM.length
                ? tt('dashboard.topProductsHelp', 'Use this table to see which shipped products are creating or destroying operational margin in the selected window. It does not imply the related orders are settled.')
                : t('topProducts.empty')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {topGM.length === 0 ? (
              <div className="rounded-[1.25rem] border border-dashed border-border/70 bg-muted/10 px-4 py-8 text-center">
                <p className="text-sm font-medium">{t('topProducts.empty')}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {tt('dashboard.activityHelp', 'Confirm the system is active and see what changed most recently.')}
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {topGM.map((row, index) => (
                    <div key={row.itemId} className="rounded-[1.15rem] border border-border/70 bg-background/68 px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">#{index + 1}</div>
                          <div className="truncate text-sm font-semibold">{row.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{row.sku || t('common.dash')}</div>
                        </div>
                        <div className={cn('text-sm font-semibold', row.gm < 0 && 'text-rose-600 dark:text-rose-300')}>
                          {money(row.gm)}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('table.revenue')}</div>
                          <div className="mt-1 font-mono text-sm tabular-nums">{money(row.revenue)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('table.cogs')}</div>
                          <div className="mt-1 font-mono text-sm tabular-nums">{money(row.cogs)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('table.gmPct')}</div>
                          <div className={cn('mt-1 font-mono text-sm tabular-nums', row.pct < 0 && 'text-rose-600 dark:text-rose-300')}>
                            {row.revenue > 0 ? `${(row.pct * 100).toFixed(1)}%` : t('common.dash')}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-2">{tt('dashboard.rank', 'Rank')}</th>
                        <th className="py-2 pr-2">{t('table.item')}</th>
                        <th className="py-2 pr-2">{t('table.sku')}</th>
                        <th className="py-2 pr-2 text-right">{t('table.revenue')}</th>
                        <th className="py-2 pr-2 text-right">{t('table.cogs')}</th>
                        <th className="py-2 pr-2 text-right">{t('table.grossMargin')}</th>
                        <th className="py-2 pr-2 text-right">{t('table.gmPct')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topGM.map((row, index) => {
                        const pctStr = row.revenue > 0 ? `${(row.pct * 100).toFixed(1)}%` : t('common.dash')
                        const pctClass = row.revenue > 0 && row.pct < 0 ? 'text-rose-600 dark:text-rose-300' : ''
                        return (
                          <tr key={row.itemId} className="border-b transition-colors hover:bg-muted/20">
                            <td className="py-2 pr-2 text-muted-foreground">#{index + 1}</td>
                            <td className="py-2 pr-2 max-w-[160px] truncate font-medium">{row.name}</td>
                            <td className="py-2 pr-2">{row.sku}</td>
                            <td className="py-2 pr-2 text-right font-mono tabular-nums">{money(row.revenue)}</td>
                            <td className="py-2 pr-2 text-right font-mono tabular-nums">{money(row.cogs)}</td>
                            <td className={`py-2 pr-2 text-right font-mono tabular-nums ${row.gm < 0 ? 'text-rose-600 dark:text-rose-300' : ''}`}>{money(row.gm)}</td>
                            <td className={`py-2 pr-2 text-right font-mono tabular-nums ${pctClass}`}>{pctStr}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className="text-xs text-muted-foreground mt-3 hidden sm:block">
              {t('topProducts.footnote')}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
