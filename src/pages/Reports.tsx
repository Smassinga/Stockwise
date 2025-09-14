// src/pages/Reports.tsx  — PART 1/3
import { useEffect, useMemo, useRef, useState } from 'react'
import { db, supabase } from '../lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { useAuth } from '../hooks/useAuth'
import { Link } from 'react-router-dom'
import { useOrg } from '../hooks/useOrg'
import toast from 'react-hot-toast'

// Export libs
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// Minimal type to satisfy didParseCell callback without pulling full typings
type AutoTableCellData = {
  section: 'head' | 'body' | 'foot'
  column: { index: number }
  cell: { raw: unknown; text: string[] }
}

type Warehouse = { id: string; name: string; code?: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }
type Item = { id: string; name: string; sku: string; baseUomId: string }
type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }

// Revenue tab types
type Customer = { id: string; name: string; code?: string | null }
type OrderLite = {
  id: string
  customerId?: string | null
  customer_id?: string | null
  createdAt?: string | null
  created_at?: string | null
  status?: string | null
  currencyCode?: string | null
  currency_code?: string | null
  total?: number | null
  grandTotal?: number | null
  netTotal?: number | null
  total_amount?: number | null
  grand_total?: number | null
  net_total?: number | null
}

// Cash/POS sales (may live in a separate table)
type CashSaleLite = {
  id: string
  customerId?: string | null
  customer_id?: string | null
  createdAt?: string | null
  created_at?: string | null
  status?: string | null
  currencyCode?: string | null
  currency_code?: string | null
  total?: number | null
  grandTotal?: number | null
  netTotal?: number | null
  total_amount?: number | null
  grand_total?: number | null
  net_total?: number | null
}

type StockLevel = {
  id: string
  itemId: string
  warehouseId: string
  binId?: string | null
  onHandQty: number
  allocatedQty?: number
  avgCost?: number
  updatedAt?: string | null
}

type Movement = {
  id: string
  type: string
  itemId: string
  qty?: number
  qtyBase?: number
  unitCost?: number
  totalValue?: number
  warehouseId?: string | null
  warehouseFromId?: string | null
  warehouseToId?: string | null
  binFromId?: string | null
  binToId?: string | null
  createdAt?: string | null
  created_at?: string | null
  createdat?: string | null
}

type TabKey = 'summary' | 'valuation' | 'turnover' | 'aging' | 'revenue'

/** ----------------- formatting helpers (accounting style) ----------------- */
function fmtPositive(x: number, decimals = 2) {
  const fixed = (Math.abs(x) || 0).toFixed(decimals)
  const [intPart, decPart] = fixed.split('.')
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decPart != null ? `${withCommas}.${decPart}` : withCommas
}
function fmt(x: number, decimals = 2) {
  return (x < 0 ? '-' : '') + fmtPositive(x, decimals)
}
function fmtAccounting(x: number, decimals = 2) {
  return x < 0 ? `(${fmtPositive(x, decimals)})` : fmtPositive(x, decimals)
}

const getTime = (row: any): number => {
  const s = row?.createdAt ?? row?.created_at ?? row?.createdat
  return s ? new Date(s).getTime() : 0
}
const lastNDays = (days: number) => {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - days)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}
const n = (v: any, d = 0) => {
  const num = Number(v)
  return Number.isFinite(num) ? num : d
}

/** Normalize type strings to canonical form */
type NormType = 'IN' | 'OUT' | 'ADJ' | 'TRANSFER'
function normalizeType(t: string, qty: number | undefined): NormType {
  const s = (t || '').toLowerCase()
  if (s === 'receipt' || s === 'in' || s === 'purchase' || s === 'receive') return 'IN'
  if (s === 'issue' || s === 'out' || s === 'sale' || s === 'ship') return 'OUT'
  if (s === 'transfer') return 'TRANSFER'
  if (s === 'adj' || s === 'adjustment' || s === 'stock_adjustment') return 'ADJ'
  if (n(qty, 0) > 0) return 'IN'
  if (n(qty, 0) < 0) return 'OUT'
  return 'ADJ'
}
function resolveWarehouse(m: Movement, dir: 'IN' | 'OUT'): string {
  if (m.warehouseId) return m.warehouseId
  if (dir === 'IN') return (m.warehouseToId || m.warehouseFromId || '') || ''
  return (m.warehouseFromId || m.warehouseToId || '') || ''
}

/** -----------------------------------------------------------
 * Settings helpers (ONLY CHANGE introduced; everything else unchanged)
 * Robustly read possibly-renamed keys coming from settings.tsx.
 * ----------------------------------------------------------- */
function pickString(...candidates: Array<any>): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return undefined
}
function at(obj: any, path: string): any {
  try {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
  } catch {
    return undefined
  }
}

/** ----------------- component ----------------- */
export default function Reports() {
  const { user } = useAuth()
  const { companyId, companyName: orgCompanyName } = useOrg()

  // Brand name from org settings (company_settings.data.documents.brand.name)
  const [brandName, setBrandName] = useState<string | null>(null)
  const companyName = brandName || orgCompanyName || user?.orgName || 'Your Company'

  // master data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])

  // snapshot + history
  const [levels, setLevels] = useState<StockLevel[]>([])
  const [moves, setMoves] = useState<Movement[]>([])
  const [orders, setOrders] = useState<OrderLite[]>([])
  const [cashSales, setCashSales] = useState<CashSaleLite[]>([])

  // revenue config + guards
  const [ordersSource, setOrdersSource] = useState<string>('') // table or view name for orders
  const [cashSource, setCashSource] = useState<string>('')     // table or view name for cash/POS sales
  const [ordersUnavailable, setOrdersUnavailable] = useState<boolean>(false)
  const [cashUnavailable, setCashUnavailable] = useState<boolean>(false)
  const ordersFetchKeyRef = useRef<string>('') // suppress duplicate fetch in Strict Mode dev
  const cashFetchKeyRef = useRef<string>('')

  // UI
  const [tab, setTab] = useState<TabKey>('summary')
  const def = lastNDays(90)
  const [startDate, setStartDate] = useState(def.start)
  const [endDate, setEndDate] = useState(def.end)

  // costing & valuation
  const [costMethod, setCostMethod] = useState<'WA' | 'FIFO'>('WA')
  const [valuationAsOfEnd, setValuationAsOfEnd] = useState<boolean>(false)

  // FX
  const [baseCurrency, setBaseCurrency] = useState<string>('MZN')
  const [displayCurrency, setDisplayCurrency] = useState<string>('MZN')
  const [fxRate, setFxRate] = useState<number>(1) // 1 base -> fxRate display
  const [autoFx, setAutoFx] = useState<boolean>(true)
  const [fxNote, setFxNote] = useState<string>('')

  const moneyText = (x: number) => `${displayCurrency} ${fmtAccounting(x * fxRate, 2)}`

  // Load company brand from company_settings (per org)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId) { setBrandName(null); return }
      const res = await supabase
        .from('company_settings')
        .select('data')
        .eq('company_id', companyId)
        .limit(1) // array mode avoids 406 when row is missing
      if (!cancelled) {
        const row = Array.isArray(res.data) && res.data.length ? (res.data[0] as any) : null
        const name = row?.data?.documents?.brand?.name
        setBrandName(typeof name === 'string' && name.trim() ? name.trim() : null)
      }
    })().catch(() => { if (!cancelled) setBrandName(null) })
    return () => { cancelled = true }
  }, [companyId])

  // load (settings + master)
  useEffect(() => {
    ;(async () => {
      try {
        // Safe app-level settings fetch (array mode only)
        const { data: settingsRows, error: settingsErr } = await supabase
          .from('settings')
          .select('*')
          .eq('id', 'app')
          .limit(1) // array mode, avoids 406
        if (settingsErr) console.warn('[settings] fetch warning:', settingsErr?.message)
        const setting = Array.isArray(settingsRows) && settingsRows.length > 0 ? (settingsRows[0] as any) : null

        const [wh, bb, it, sl, mv, cs, custs] = await Promise.all([
          db.warehouses.list({ orderBy: { name: 'asc' } }),
          db.bins.list({ orderBy: { code: 'asc' } }),
          db.items.list({ orderBy: { name: 'asc' } }),
          db.stockLevels.list(),
          db.movements.list({ orderBy: { createdAt: 'asc' } }),
          db.currencies.list({ orderBy: { code: 'asc' } }),
          supabase.from('customers').select('id,name,code').order('name', { ascending: true }),
        ])

        setWarehouses(wh || [])
        setBins(bb || [])
        setItems(it || [])
        setLevels(sl || [])
        setMoves(mv || [])
        setCurrencies(cs || [])
        if ((custs as any)?.data) setCustomers((custs as any).data as Customer[])

        /** 
         * -------------- THE ONLY LOGIC CHANGE --------------
         * Wire up to possible new keys coming from settings.tsx,
         * while remaining 100% backward-compatible with the old keys.
         */
        const baseCur = pickString(
          // old
          setting?.baseCurrencyCode,
          setting?.base_currency_code,
          // possible new shapes from settings.tsx
          at(setting, 'documents.finance.baseCurrency'),
          at(setting, 'documents.finance.base_currency'),
          at(setting, 'documents.reports.baseCurrency'),
          at(setting, 'documents.reports.base_currency'),
          at(setting, 'finance.baseCurrency'),
          at(setting, 'finance.base_currency'),
        )

        const ordersSrc = pickString(
          // old
          setting?.ordersSource,
          setting?.orders_source,
          // also used historically:
          setting?.ordersView,
          setting?.orders_table,
          // possible new shapes from settings.tsx
          at(setting, 'documents.revenue.ordersSource'),
          at(setting, 'documents.revenue.orders_source'),
          at(setting, 'reports.revenue.ordersSource'),
          at(setting, 'reports.revenue.orders_source')
        )

        const cashSrc = pickString(
          // old
          setting?.cashSalesSource,
          setting?.cash_sales_source,
          setting?.posSource,
          setting?.pos_source,
          // possible new names
          setting?.cashSalesView,
          setting?.cash_sales_view,
          // possible new shapes from settings.tsx
          at(setting, 'documents.revenue.cashSalesSource'),
          at(setting, 'documents.revenue.cash_sales_source'),
          at(setting, 'documents.revenue.posSource'),
          at(setting, 'documents.revenue.pos_source'),
          at(setting, 'reports.revenue.cashSalesSource'),
          at(setting, 'reports.revenue.cash_sales_source'),
          at(setting, 'reports.revenue.posSource'),
          at(setting, 'reports.revenue.pos_source')
        )

        if (baseCur) {
          setBaseCurrency(baseCur)
          setDisplayCurrency(prev => prev || baseCur)
        } else {
          setBaseCurrency(prev => prev || 'MZN')
          setDisplayCurrency(prev => prev || 'MZN')
        }

        if (ordersSrc) setOrdersSource(ordersSrc)
        if (cashSrc) setCashSource(cashSrc)
      } catch (err: any) {
        console.error(err)
        toast.error(err?.message || 'Failed to load reports data')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load orders for revenue tab when date window or source changes (with Strict Mode guard)
  useEffect(() => {
    ;(async () => {
      const key = `${ordersSource}|${startDate}|${endDate}`
      if (ordersFetchKeyRef.current === key) return
      ordersFetchKeyRef.current = key

      // reset
      setOrders([])
      setOrdersUnavailable(false)

      if (!ordersSource) {
        setOrdersUnavailable(true)
        return
      }

      const startIso = `${startDate}T00:00:00Z`
      const endIso   = `${endDate}T23:59:59.999Z`

      type DateCol = 'createdAt' | 'created_at'
      const run = (dateCol: DateCol) =>
        
        supabase
          .from(ordersSource)
          .select(`id,customerId,customer_id,status,currencyCode,currency_code,total,grandTotal,netTotal,total_amount,grand_total,net_total,${dateCol}`)
          .gte(dateCol, startIso)
          .lte(dateCol, endIso)
          .order(dateCol, { ascending: true })

      try {
        // Try camelCase first, fall back to snake_case ONLY if first fails with bad column.
        let resp = await run('createdAt')
        if (resp.error) {
          const msg = (resp.error?.message || '').toLowerCase()
          if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('relation')) {
            setOrdersUnavailable(true)
            return
          }
          if (msg.includes('column') && msg.includes('does not exist')) {
            const resp2 = await run('created_at')
            if (resp2.error) {
              setOrdersUnavailable(true)
              return
            }
            setOrders((resp2.data || []) as OrderLite[])
            return
          }
          setOrdersUnavailable(true)
          return
        }
        setOrders((resp.data || []) as OrderLite[])
      } catch {
        setOrdersUnavailable(true)
      }
    })()
  }, [ordersSource, startDate, endDate])

  // Load cash/POS sales (optional) with same date window
  useEffect(() => {
    ;(async () => {
      const key = `${cashSource}|${startDate}|${endDate}`
      if (cashFetchKeyRef.current === key) return
      cashFetchKeyRef.current = key

      setCashSales([])
      setCashUnavailable(false)

      if (!cashSource) {
        setCashUnavailable(true)
        return
      }

      const startIso = `${startDate}T00:00:00Z`
      const endIso   = `${endDate}T23:59:59.999Z`
      
      type DateCol = 'createdAt' | 'created_at'
      const run = (dateCol: DateCol) =>
        supabase
          .from(cashSource)
          .select(`id,customerId,customer_id,status,currencyCode,currency_code,total,grandTotal,netTotal,total_amount,grand_total,net_total,${dateCol}`)
          .gte(dateCol, startIso)
          .lte(dateCol, endIso)
          .order(dateCol, { ascending: true })

      try {
        let resp = await run('createdAt')
        if (resp.error) {
          const msg = (resp.error?.message || '').toLowerCase()
          if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('relation')) {
            setCashUnavailable(true)
            return
          }
          if (msg.includes('column') && msg.includes('does not exist')) {
            const resp2 = await run('created_at')
            if (resp2.error) {
              setCashUnavailable(true)
              return
            }
            setCashSales((resp2.data || []) as CashSaleLite[])
            return
          }
          setCashUnavailable(true)
          return
        }
        setCashSales((resp.data || []) as CashSaleLite[])
      } catch {
        setCashUnavailable(true)
      }
    })()
  }, [cashSource, startDate, endDate])

  // auto FX: fetch latest rate on/before end date (base -> display)
  useEffect(() => {
    ;(async () => {
      if (!autoFx) return
      try {
        if (!displayCurrency || !baseCurrency) return
        if (displayCurrency === baseCurrency) {
          setFxRate(1); setFxNote(''); return
        }
        const { data: direct, error: e1 } = await supabase
          .from('fx_rates')
          .select('rate,date,fromCode,toCode')
          .eq('fromCode', baseCurrency)
          .eq('toCode', displayCurrency)
          .lte('date', endDate)
          .order('date', { ascending: false })
          .limit(1)
        if (e1) throw e1
        if (direct && direct.length > 0) {
          setFxRate(Number(direct[0].rate) || 1)
          setFxNote(`Using ${baseCurrency}→${displayCurrency} @ ${direct[0].rate} from ${direct[0].date}`)
          return
        }
        const { data: inverse, error: e2 } = await supabase
          .from('fx_rates')
          .select('rate,date,fromCode,toCode')
          .eq('fromCode', displayCurrency)
          .eq('toCode', baseCurrency)
          .lte('date', endDate)
          .order('date', { ascending: false })
          .limit(1)
        if (e2) throw e2
        if (inverse && inverse.length > 0) {
          const r = Number(inverse[0].rate) || 1
          const inv = r !== 0 ? 1 / r : 1
          setFxRate(inv)
          setFxNote(`Using inverse ${displayCurrency}→${baseCurrency} @ ${r} (so ${inv.toFixed(6)}) from ${inverse[0].date}`)
          return
        }
        setFxRate(1); setFxNote(`No FX found on/before ${endDate}. Using 1.0`)
      } catch (err) {
        console.error(err)
        setFxRate(1); setFxNote('FX lookup failed. Using 1.0')
      }
    })()
  }, [autoFx, endDate, displayCurrency, baseCurrency])

  // indexes
  const itemById = useMemo(() => {
    const m = new Map<string, Item>()
    items.forEach(it => m.set(it.id, it))
    return m
  }, [items])
  const whById = useMemo(() => {
    const m = new Map<string, Warehouse>()
    warehouses.forEach(w => m.set(w.id, w))
    return m
  }, [warehouses])
  const binById = useMemo(() => {
    const m = new Map<string, Bin>()
    bins.forEach(b => m.set(b.id, b))
    return m
  }, [bins])
  const customerById = useMemo(() => {
    const m = new Map<string, Customer>()
    customers.forEach(c => m.set(c.id, c))
    return m
  }, [customers])

  /** ----------------- Period selection ----------------- */
  const period = useMemo(() => {
    const startMs = new Date(startDate + 'T00:00:00Z').getTime()
    const endMs = new Date(endDate + 'T23:59:59Z').getTime()
    const inRange = moves.filter(m => {
      const t = getTime(m)
      return t >= startMs && t <= endMs
    })
    return { startMs, endMs, inRange }
  }, [moves, startDate, endDate])

  /** ----------------- Revenue by Customer (Orders + Cash/POS) ----------------- */
  const revenueByCustomer = useMemo(() => {
    // Exclude obviously non-revenue states
    const BAD_STATUSES = new Set(['cancelled', 'canceled', 'void', 'draft', 'rejected', 'refunded'])

    const agg = new Map<string, number>()
    let grand = 0

    // helper to pull amount robustly
    const getAmount = (o: any) => {
      const a = o?.grandTotal ?? o?.total ?? o?.netTotal ?? o?.total_amount ?? o?.grand_total ?? o?.net_total
      const v = Number(a)
      return Number.isFinite(v) ? v : 0
    }
    const getStatus = (o: any) => String(o?.status || '').toLowerCase()
    const getCustomer = (o: any) => (o?.customerId ?? o?.customer_id ?? null) as (string | null)

    const addRow = (o: any) => {
      const status = getStatus(o)
      if (status && BAD_STATUSES.has(status)) return
      const amount = getAmount(o)
      const custId = getCustomer(o) || 'unknown'
      agg.set(custId, (agg.get(custId) || 0) + amount)
      grand += amount
    }

    for (const o of orders) addRow(o)
    for (const c of cashSales) addRow(c)

    const rows = Array.from(agg.entries()).map(([customerId, baseAmount]) => {
      const c = customerById.get(customerId)
      return {
        customerId,
        customerName: c?.name || (customerId === 'unknown' ? '(no customer)' : customerId),
        baseAmount,
      }
    })

    rows.sort((a, b) => b.baseAmount - a.baseAmount)

    return {
      rows,
      grandTotalBase: grand,
    }
  }, [orders, cashSales, customerById])

  /** ----------------- Cost engine (FIFO / WA) by wh|item ----------------- */
  type Key = string // `${whId}|${itemId}`
  type Layer = { qty: number; cost: number }
  type WAState = { qty: number; avgCost: number }
  type EngineResult = {
    asOfEndQtyByKey: Map<Key, number>
    asOfEndAvgCostByKey: Map<Key, number>
    valuationByWH_AsOfEnd: Map<string, number>
    cogsByItemInPeriod: Map<string, number>
    soldUnitsByItemInPeriod: Map<string, number>
  }

  const engine: EngineResult = useMemo(() => {
    const start = period.startMs
    const end = period.endMs

    const cogsByItemInPeriod = new Map<string, number>()
    const soldUnitsByItemInPeriod = new Map<string, number>()
    const asOfEndQtyByKey = new Map<Key, number>()
    const asOfEndAvgCostByKey = new Map<Key, number>()
    const valuationByWH_AsOfEnd = new Map<string, number>()

    const wa = new Map<Key, WAState>()
    const fifo = new Map<Key, Layer[]>()

    const keyOf = (whId: string, itemId: string) => `${whId}|${itemId}`
    const takeFromFIFO = (layers: Layer[], qty: number): { cogs: number; taken: Layer[] } => {
      let remaining = qty
      let cogs = 0
      const taken: Layer[] = []
      while (remaining > 0 && layers.length > 0) {
        const first = layers[0]
        const take = Math.min(remaining, first.qty)
        if (take > 0) {
          cogs += take * first.cost
          taken.push({ qty: take, cost: first.cost })
          first.qty -= take
          remaining -= take
          if (first.qty <= 0.0000001) layers.shift()
        } else {
          break
        }
      }
      if (remaining > 0.000001) {
        const lastCost = layers.length > 0 ? layers[0].cost : 0
        cogs += remaining * lastCost
        taken.push({ qty: remaining, cost: lastCost })
      }
      return { cogs, taken }
    }

    const sorted = [...moves].sort((a, b) => getTime(a) - getTime(b))
    const getWA = (k: Key) => wa.get(k) || { qty: 0, avgCost: 0 }
    const getFIFO = (k: Key) => fifo.get(k) || []

    for (const m of sorted) {
      const t = getTime(m)
      const qty = Math.abs(n(m.qtyBase ?? m.qty, 0))
      if (qty <= 0) continue
      const nt = normalizeType(m.type, m.qtyBase ?? m.qty)
      const unitCost = n(m.unitCost, 0)

      if (nt === 'TRANSFER') {
        const srcWh = resolveWarehouse(m, 'OUT')
        const dstWh = resolveWarehouse(m, 'IN')
        if (!srcWh || !dstWh) continue
        const kSrc = keyOf(srcWh, m.itemId)
        const kDst = keyOf(dstWh, m.itemId)

        if (costMethod === 'FIFO') {
          const srcLayers = getFIFO(kSrc)
          const { taken } = takeFromFIFO(srcLayers, qty)
          fifo.set(kSrc, srcLayers)
          const dstLayers = getFIFO(kDst)
          taken.forEach(l => dstLayers.push({ qty: l.qty, cost: l.cost }))
          fifo.set(kDst, dstLayers)
        } else {
          const s = getWA(kSrc)
          const moveCost = s.avgCost
          s.qty = Math.max(0, s.qty - qty)
          wa.set(kSrc, s)
          const d = getWA(kDst)
          const totalVal = d.avgCost * d.qty + moveCost * qty
          d.qty += qty
          d.avgCost = d.qty > 0 ? totalVal / d.qty : d.avgCost
          wa.set(kDst, d)
        }
        continue
      }

      let dir: 'IN' | 'OUT'
      if (nt === 'ADJ') {
        dir = (n(m.qtyBase ?? m.qty, 0) >= 0) ? 'IN' : 'OUT'
      } else {
        dir = (nt === 'IN') ? 'IN' : 'OUT'
      }

      const wh = resolveWarehouse(m, dir)
      if (!wh) continue
      const k = keyOf(wh, m.itemId)

      if (dir === 'IN') {
        if (costMethod === 'FIFO') {
          const layers = getFIFO(k)
          const c = unitCost || (n(m.totalValue, 0) / Math.max(1, qty))
          layers.push({ qty, cost: c })
          fifo.set(k, layers)
        } else {
          const s = getWA(k)
          const c = unitCost || s.avgCost || (n(m.totalValue, 0) / Math.max(1, qty))
          const totalVal = s.avgCost * s.qty + c * qty
          s.qty += qty
          s.avgCost = s.qty > 0 ? totalVal / s.qty : s.avgCost
          wa.set(k, s)
        }
      } else {
        if (costMethod === 'FIFO') {
          const layers = getFIFO(k)
          const { cogs } = takeFromFIFO(layers, qty)
          fifo.set(k, layers)
          if (t >= start && t <= end) {
            cogsByItemInPeriod.set(m.itemId, (cogsByItemInPeriod.get(m.itemId) || 0) + cogs)
            soldUnitsByItemInPeriod.set(m.itemId, (soldUnitsByItemInPeriod.get(m.itemId) || 0) + qty)
          }
        } else {
          const s = getWA(k)
          const cogs = qty * s.avgCost
          s.qty = Math.max(0, s.qty - qty)
          wa.set(k, s)
          if (t >= start && t <= end) {
            cogsByItemInPeriod.set(m.itemId, (cogsByItemInPeriod.get(m.itemId) || 0) + cogs)
            soldUnitsByItemInPeriod.set(m.itemId, (soldUnitsByItemInPeriod.get(m.itemId) || 0) + qty)
          }
        }
      }
    }

    const keys = new Set<string>([...wa.keys(), ...fifo.keys()])
    for (const k of keys) {
      const [whId] = k.split('|')
      let qty = 0
      let avgCostForDisplay = 0
      let val = 0
      if (costMethod === 'FIFO') {
        const layers = fifo.get(k) || []
        qty = layers.reduce((s, l) => s + l.qty, 0)
        const totalVal = layers.reduce((s, l) => s + l.qty * l.cost, 0)
        val = totalVal
        avgCostForDisplay = qty > 0 ? totalVal / qty : 0
      } else {
        const s = wa.get(k) || { qty: 0, avgCost: 0 }
        qty = s.qty
        avgCostForDisplay = s.avgCost
        val = s.qty * s.avgCost
      }
      asOfEndQtyByKey.set(k, qty)
      asOfEndAvgCostByKey.set(k, avgCostForDisplay)
      valuationByWH_AsOfEnd.set(whId, (valuationByWH_AsOfEnd.get(whId) || 0) + val)
    }

    return { asOfEndQtyByKey, asOfEndAvgCostByKey, valuationByWH_AsOfEnd, cogsByItemInPeriod, soldUnitsByItemInPeriod }
  }, [moves, period.startMs, period.endMs, costMethod])

  /** ----------------- Valuation from current snapshot ----------------- */
  const valuationCurrent = useMemo(() => {
    const byWH = new Map<string, number>()
    const byBin = new Map<string, number>()
    const byItem = new Map<string, number>()
    let total = 0
    for (const s of levels) {
      const qty = n(s.onHandQty, 0)
      const cost = n(s.avgCost, 0)
      const val = qty * cost
      if (val === 0) continue
      total += val
      byItem.set(s.itemId, (byItem.get(s.itemId) || 0) + val)
      byWH.set(s.warehouseId, (byWH.get(s.warehouseId) || 0) + val)
      const keyBin = `${s.warehouseId}|${s.binId || ''}`
      byBin.set(keyBin, (byBin.get(keyBin) || 0) + val)
    }
    return { total, byWH, byBin, byItem }
  }, [levels])

  /** ----------------- Detailed valuation (warehouse→item) ----------------- */
  const valuationDetailsByWH = useMemo(() => {
    const map = new Map<string, { qty: number; value: number }>()
    for (const s of levels) {
      const qty = n(s.onHandQty, 0)
      const cost = n(s.avgCost, 0)
      if (qty === 0 && cost === 0) continue
      const key = `${s.warehouseId}|${s.itemId}`
      const prev = map.get(key) || { qty: 0, value: 0 }
      prev.qty += qty
      prev.value += qty * cost
      map.set(key, prev)
    }
    const rows = Array.from(map.entries()).map(([key, agg]) => {
      const [wid, itemId] = key.split('|')
      const it = itemById.get(itemId)
      const wh = whById.get(wid)
      const unitCost = agg.qty > 0 ? agg.value / agg.qty : 0
      return {
        warehouseId: wid,
        warehouseName: wh?.name || wid,
        itemId,
        itemName: it?.name || itemId,
        sku: it?.sku || '',
        qty: agg.qty,
        unitCost,
        value: agg.value,
      }
    })
    rows.sort((a, b) => (a.warehouseName === b.warehouseName ? b.value - a.value : a.warehouseName.localeCompare(b.warehouseName)))
    return rows
  }, [levels, itemById, whById])

  /** ----------------- Detailed valuation (bin→item) ----------------- */
  const valuationDetailsByBin = useMemo(() => {
    const rows: Array<{
      warehouseId: string
      warehouseName: string
      binId: string | null
      binCode: string
      itemId: string
      itemName: string
      sku: string
      qty: number
      unitCost: number
      value: number
    }> = []
    for (const s of levels) {
      const qty = n(s.onHandQty, 0)
      const cost = n(s.avgCost, 0)
      if (qty === 0 && cost === 0) continue
      const wh = whById.get(s.warehouseId)
      const b = s.binId ? binById.get(s.binId) : undefined
      const it = itemById.get(s.itemId)
      rows.push({
        warehouseId: s.warehouseId,
        warehouseName: wh?.name || s.warehouseId,
        binId: s.binId ?? null,
        binCode: b?.code || '(no bin)',
        itemId: s.itemId,
        itemName: it?.name || s.itemId,
        sku: it?.sku || '',
        qty,
        unitCost: cost,
        value: qty * cost,
      })
    }
    rows.sort((a, b) => {
      if (a.warehouseName !== b.warehouseName) return a.warehouseName.localeCompare(b.warehouseName)
      if (a.binCode !== b.binCode) return a.binCode.localeCompare(b.binCode)
      return b.value - a.value
    })
    return rows
  }, [levels, itemById, whById, binById])

  /** ----------------- Units IN/OUT during period ----------------- */
  const unitsByItem = useMemo(() => {
    const sold = new Map<string, number>()
    const received = new Map<string, number>()
    for (const m of period.inRange) {
      const nt = normalizeType(m.type, m.qtyBase ?? m.qty)
      const qty = Math.abs(n(m.qtyBase ?? m.qty, 0))
      if (nt === 'OUT') sold.set(m.itemId, (sold.get(m.itemId) || 0) + qty)
      if (nt === 'IN') received.set(m.itemId, (received.get(m.itemId) || 0) + qty)
      if (nt === 'ADJ') {
        if (n(m.qtyBase ?? m.qty, 0) > 0) received.set(m.itemId, (received.get(m.itemId) || 0) + qty)
        else sold.set(m.itemId, (sold.get(m.itemId) || 0) + qty)
      }
    }
    return { sold, received }
  }, [period.inRange])

  /** ----------------- Begin/End units approximation ----------------- */
  const beginUnitsByItem = useMemo(() => {
    const endUnits = new Map<string, number>()
    for (const s of levels) {
      endUnits.set(s.itemId, (endUnits.get(s.itemId) || 0) + n(s.onHandQty, 0))
    }
    const begin = new Map<string, number>()
    const allItemIds = new Set<string>([
      ...Array.from(endUnits.keys()),
      ...Array.from(unitsByItem.sold.keys()),
      ...Array.from(unitsByItem.received.keys()),
    ])
    for (const id of allItemIds) {
      const end = endUnits.get(id) || 0
      const sold = unitsByItem.sold.get(id) || 0
      const rec = unitsByItem.received.get(id) || 0
      const b = Math.max(0, end + sold - rec)
      begin.set(id, b)
    }
    return { begin, end: endUnits }
  }, [levels, unitsByItem])
  /** ----------------- Turnover & Avg Days ----------------- */
  const turnoverPerItem = useMemo(() => {
    const days = Math.max(1, Math.round((period.endMs - period.startMs) / (1000 * 60 * 60 * 24)) + 1)
    const rows: Array<{
      itemId: string
      name: string
      sku: string
      sold: number
      beginUnits: number
      endUnits: number
      avgUnits: number
      turns: number
      avgDaysToSell: number | null
      cogs?: number
    }> = []
    const allIds = new Set<string>([
      ...beginUnitsByItem.begin.keys(),
      ...beginUnitsByItem.end.keys(),
      ...unitsByItem.sold.keys(),
    ])
    for (const id of allIds) {
      const it = itemById.get(id)
      if (!it) continue
      const sold = unitsByItem.sold.get(id) || 0
      const b = beginUnitsByItem.begin.get(id) || 0
      const e = beginUnitsByItem.end.get(id) || 0
      const avg = (b + e) / 2
      const turns = avg > 0 ? sold / avg : 0
      const dailySold = days > 0 ? sold / days : 0
      const avgDays = dailySold > 0 ? avg / dailySold : null
      rows.push({
        itemId: id,
        name: it.name,
        sku: it.sku,
        sold,
        beginUnits: b,
        endUnits: e,
        avgUnits: avg,
        turns,
        avgDaysToSell: avgDays,
        cogs: engine.cogsByItemInPeriod.get(id) || 0,
      })
    }
    rows.sort((a, b) => b.turns - a.turns)
    return { daysInPeriod: days, rows }
  }, [period, unitsByItem, beginUnitsByItem, itemById, engine.cogsByItemInPeriod])

  const turnoverSummary = useMemo(() => {
    const rows = turnoverPerItem.rows
    const days = turnoverPerItem.daysInPeriod
    const totalSold = rows.reduce((s, r) => s + r.sold, 0)
    const totalBegin = rows.reduce((s, r) => s + r.beginUnits, 0)
    const totalEnd = rows.reduce((s, r) => s + r.endUnits, 0)
    const avgInv = (totalBegin + totalEnd) / 2
    const turns = avgInv > 0 ? totalSold / avgInv : 0
    const dailySold = days > 0 ? totalSold / days : 0
    const avgDaysToSell = dailySold > 0 ? (avgInv / dailySold) : null
    const currentVal = valuationCurrent.total
    const totalCOGS = Array.from(engine.cogsByItemInPeriod.values()).reduce((s, v) => s + v, 0)
    return { totalSold, avgInv, turns, avgDaysToSell, days, currentVal, totalCOGS }
  }, [turnoverPerItem, valuationCurrent, engine.cogsByItemInPeriod])

  /** ----------------- Best/Worst ----------------- */
  const bestWorst = useMemo(() => {
    const arr = Array.from(engine.soldUnitsByItemInPeriod.entries()).map(([id, qty]) => ({
      id, qty, item: itemById.get(id),
    })).filter(r => !!r.item)
    if (arr.length === 0) return { best: null as any, worst: null as any, zeroSales: items.length }
    arr.sort((a, b) => b.qty - a.qty)
    return { best: arr[0], worst: arr[arr.length - 1], zeroSales: items.length - arr.length }
  }, [engine.soldUnitsByItemInPeriod, itemById, items.length])

  /** ----------------- Aging ----------------- */
  const aging = useMemo(() => {
    const lastReceipt = new Map<string, number>()
    for (const m of moves) {
      const nt = normalizeType(m.type, m.qtyBase ?? m.qty)
      if (nt !== 'IN') continue
      const t = getTime(m)
      const prev = lastReceipt.get(m.itemId)
      if (!prev || t > prev) lastReceipt.set(m.itemId, t)
    }
    const buckets = [
      { key: '0-30', min: 0, max: 30 },
      { key: '31-60', min: 31, max: 60 },
      { key: '61-90', min: 61, max: 90 },
      { key: '91-180', min: 91, max: 180 },
      { key: '181+', min: 181, max: 100000 },
    ] as const

    type Row = { scope: string; qty: number; value: number; byBucket: Record<string, { qty: number; value: number }> }
    const byWH = new Map<string, Row>()
    const byBin = new Map<string, Row>()
    const now = Date.now()

    function add(map: Map<string, Row>, key: string, ageDays: number, qty: number, val: number) {
      let row = map.get(key)
      if (!row) {
        row = { scope: key, qty: 0, value: 0, byBucket: {} as any }
        buckets.forEach(b => (row!.byBucket[b.key] = { qty: 0, value: 0 }))
        map.set(key, row)
      }
      row.qty += qty
      row.value += val
      const b = buckets.find(b => ageDays >= b.min && ageDays <= b.max) || buckets[buckets.length - 1]
      row.byBucket[b.key].qty += qty
      row.byBucket[b.key].value += val
    }

    for (const s of levels) {
      const qty = n(s.onHandQty, 0)
      if (qty <= 0) continue
      const cost = n(s.avgCost, 0)
      const val = qty * cost
      const lr = lastReceipt.get(s.itemId)
      const ageDays = lr ? Math.max(0, Math.floor((now - lr) / (1000 * 60 * 60 * 24))) : 9999
      add(byWH, s.warehouseId, ageDays, qty, val)
      const keyBin = `${s.warehouseId}|${s.binId || ''}`
      add(byBin, keyBin, ageDays, qty, val)
    }

    const rowsWH = Array.from(byWH.entries()).map(([id, r]) => ({
      warehouseId: id,
      warehouseName: whById.get(id)?.name || id,
      ...r,
    }))
    const rowsBin = Array.from(byBin.entries()).map(([key, r]) => {
      const [wid, bid] = key.split('|')
      const whName = whById.get(wid)?.name || wid
      const b = bid ? (binById.get(bid)?.code || bid) : '(no bin)'
      return { warehouseId: wid, binId: bid || null, warehouseName: whName, binCode: b, ...r }
    })

    rowsWH.sort((a, b) => b.value - a.value)
    rowsBin.sort((a, b) => b.value - a.value)

    return { buckets: buckets.map(b => b.key), rowsWH, rowsBin }
  }, [levels, moves, whById, binById])

  /** ========================== EXPORT ROWS (for CSV/XLSX/PDF) ========================== */
  // ---------- valuation totals ----------
  const valuationByWHRows = useMemo<(string | number)[][]>(() => {
    const rows: (string | number)[][] = [['Warehouse', `Value (${displayCurrency})`]]
    const pairs = valuationAsOfEnd
      ? Array.from(engine.valuationByWH_AsOfEnd.entries())
      : Array.from(valuationCurrent.byWH.entries())
    pairs.sort((a, b) => b[1] - a[1]).forEach(([wid, val]) => {
      rows.push([whById.get(wid)?.name || wid, (val * fxRate)])
    })
    const total = pairs.reduce((s, [, v]) => s + v, 0)
    rows.push(['Total', total * fxRate])
    return rows
  }, [engine.valuationByWH_AsOfEnd, valuationCurrent.byWH, valuationAsOfEnd, whById, fxRate, displayCurrency])

  const valuationByBinRows = useMemo<(string | number)[][]>(() => {
    const rows: (string | number)[][] = [['Warehouse', 'Bin', `Value (${displayCurrency})`]]
    const pairs = Array.from(valuationCurrent.byBin.entries())
    pairs.sort((a, b) => b[1] - a[1]).forEach(([key, val]) => {
      const [wid, bid] = key.split('|')
      const whName = whById.get(wid)?.name || wid
      const binCode = bid ? (binById.get(bid)?.code || bid) : '(no bin)'
      rows.push([whName, binCode, (val * fxRate)])
    })
    return rows
  }, [valuationCurrent.byBin, whById, binById, fxRate, displayCurrency])

  // ---------- valuation details ----------
  const valuationWHItemRows = useMemo<(string | number)[][]>(() => {
    const rows: (string | number)[][] = [['Warehouse', 'Item', 'SKU', 'Qty', 'Unit Cost', `Value (${displayCurrency})`]]
    valuationDetailsByWH.forEach(r => {
      rows.push([
        r.warehouseName,
        r.itemName,
        r.sku,
        r.qty,
        r.unitCost * fxRate,
        r.value * fxRate,
      ])
    })
    return rows
  }, [valuationDetailsByWH, fxRate, displayCurrency])

  const valuationBinItemRows = useMemo<(string | number)[][]>(() => {
    const rows: (string | number)[][] = [['Warehouse', 'Bin', 'Item', 'SKU', 'Qty', 'Unit Cost', `Value (${displayCurrency})`]]
    valuationDetailsByBin.forEach(r => {
      rows.push([
        r.warehouseName,
        r.binCode,
        r.itemName,
        r.sku,
        r.qty,
        r.unitCost * fxRate,
        r.value * fxRate,
      ])
    })
    return rows
  }, [valuationDetailsByBin, fxRate, displayCurrency])

  // ---------- turnover ----------
  const turnoverRows = useMemo<(string | number)[][]>(() => {
    const rows: (string | number)[][] = [[
      'Item', 'SKU', 'Sold (period)', 'Begin Units', 'End Units', 'Avg Units', 'Turns', 'Avg Days to Sell', `COGS (${displayCurrency})`
    ]]
    turnoverPerItem.rows.forEach(r => {
      rows.push([
        r.name, r.sku, r.sold,
        Number(r.beginUnits.toFixed(2)),
        Number(r.endUnits.toFixed(2)),
        Number(r.avgUnits.toFixed(2)),
        Number(r.turns.toFixed(2)),
        r.avgDaysToSell != null ? Number(r.avgDaysToSell.toFixed(1)) : '',
        (n(r.cogs, 0) * fxRate)
      ])
    })
    return rows
  }, [turnoverPerItem.rows, fxRate, displayCurrency])

  // ---------- aging ----------
  const agingWHRows = useMemo<(string | number)[][]>(() => {
    const head = ['Warehouse', 'Total Qty', `Total Value (${displayCurrency})`, ...aging.buckets]
    const rows: (string | number)[][] = [head]
    aging.rowsWH.forEach(r => {
      rows.push([
        r.warehouseName,
        Number(r.qty.toFixed(2)),
        (r.value * fxRate),
        ...aging.buckets.map(b => `${fmt(r.byBucket[b].qty, 2)} / ${displayCurrency} ${fmtAccounting(r.byBucket[b].value * fxRate, 2)}`)
      ])
    })
    return rows
  }, [aging.rowsWH, aging.buckets, fxRate, displayCurrency])

  const agingBinRows = useMemo<(string | number)[][]>(() => {
    const head = ['Warehouse', 'Bin', 'Total Qty', `Total Value (${displayCurrency})`, ...aging.buckets]
    const rows: (string | number)[][] = [head]
    aging.rowsBin.forEach(r => {
      rows.push([
        r.warehouseName,
        r.binCode,
        Number(r.qty.toFixed(2)),
        (r.value * fxRate),
        ...aging.buckets.map(b => `${fmt(r.byBucket[b].qty, 2)} / ${displayCurrency} ${fmtAccounting(r.byBucket[b].value * fxRate, 2)}`)
      ])
    })
    return rows
  }, [aging.rowsBin, aging.buckets, fxRate, displayCurrency])

  // ---------- revenue (export rows) ----------
  const revenueRows = useMemo<(string | number)[][]>(() => {
    const rows: (string | number)[][] = [['Customer', `Revenue (${displayCurrency})`]]
    revenueByCustomer.rows.forEach(r => {
      rows.push([r.customerName, r.baseAmount * fxRate])
    })
    rows.push(['Total', revenueByCustomer.grandTotalBase * fxRate])
    return rows
  }, [revenueByCustomer, fxRate, displayCurrency])

  /** ========================== EXPORT HELPERS ========================== */
  const buildHeaderRows = (title: string): (string | number)[][] => ([
    [companyName],
    [title],
    [`Period: ${startDate} → ${endDate}`],
    [`Currency: ${displayCurrency}${fxRate !== 1 ? `  (FX ${fxRate.toFixed(6)} per ${baseCurrency})` : ''}`],
    [fxNote ? fxNote : ''],
    [''],
  ])

  const formatRowsForCSV = (rows: (string | number)[][], moneyCols: number[] = [], qtyCols: number[] = []) => {
    return rows.map((r, i) => {
      if (i === 0) return r
      return r.map((cell, ci) => {
        if (typeof cell === 'number') {
          if (moneyCols.includes(ci)) return `${displayCurrency} ${fmtAccounting(cell, 2)}`
          if (qtyCols.includes(ci)) return fmt(cell, 2)
          return fmt(cell, 2)
        }
        return String(cell ?? '')
      })
    })
  }

  const downloadCSV = (filename: string, rows: (string | number)[][]) => {
    const csv = rows.map(r =>
      r.map(cell => {
        const s = String(cell ?? '')
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    saveAs(blob, filename)
  }

  function formatSheetNumbers(ws: XLSX.WorkSheet, dataStartRow: number, moneyCols: number[] = [], qtyCols: number[] = []) {
    if (!ws['!ref']) return
    const range = XLSX.utils.decode_range(ws['!ref'])
    const moneyFmt = '#,##0.00;(#,##0.00)'
    const qtyFmt = '#,##0.00;[Red]-#,##0.00'
    for (let R = dataStartRow; R <= range.e.r; R++) {
      for (const C of moneyCols) {
        const address = XLSX.utils.encode_cell({ r: R, c: C })
        const cell = ws[address]
        if (cell && typeof cell.v === 'number') cell.z = moneyFmt
      }
      for (const C of qtyCols) {
        const address = XLSX.utils.encode_cell({ r: R, c: C })
        const cell = ws[address]
        if (cell && typeof cell.v === 'number') cell.z = qtyFmt
      }
    }
  }

  /** ========================== EXPORT TRIGGERS ========================== */
  const handleExportCSV = () => {
    const stamp = endDate.replace(/-/g, '')

    if (tab === 'valuation') {
      downloadCSV(`valuation_by_warehouse_${stamp}.csv`, [
        ...buildHeaderRows(`Stock Valuation — ${valuationAsOfEnd ? `as of ${endDate} (${costMethod})` : 'current snapshot'}`),
        ...formatRowsForCSV(valuationByWHRows, [1]),
      ])
      downloadCSV(`valuation_by_bin_${stamp}.csv`, [
        ...buildHeaderRows('Stock Valuation — By Bin (current snapshot)'),
        ...formatRowsForCSV(valuationByBinRows, [2]),
      ])
      downloadCSV(`valuation_details_by_warehouse_${stamp}.csv`, [
        ...buildHeaderRows('Stock Valuation — Details by Warehouse & Item'),
        ...formatRowsForCSV(valuationWHItemRows, [4, 5], [3]),
      ])
      downloadCSV(`valuation_details_by_bin_${stamp}.csv`, [
        ...buildHeaderRows('Stock Valuation — Details by Bin & Item'),
        ...formatRowsForCSV(valuationBinItemRows, [5, 6], [4]),
      ])
      toast.success('Exported valuation CSVs (warehouse/bin + detailed)')
      return
    }

    if (tab === 'turnover') {
      downloadCSV(`turnover_${stamp}.csv`, [
        ...buildHeaderRows('Inventory Turnover & Avg Days to Sell'),
        ...formatRowsForCSV(turnoverRows, [8], [2,3,4,5,6,7]),
      ])
      toast.success('Exported turnover CSV')
      return
    }

    if (tab === 'aging') {
      downloadCSV(`aging_by_warehouse_${stamp}.csv`, [
        ...buildHeaderRows('Inventory Aging — By Warehouse'),
        ...agingWHRows,
      ])
      downloadCSV(`aging_by_bin_${stamp}.csv`, [
        ...buildHeaderRows('Inventory Aging — By Bin'),
        ...agingBinRows,
      ])
      toast.success('Exported aging CSVs (warehouse & bin)')
      return
    }

    if (tab === 'revenue') {
      downloadCSV(`revenue_by_customer_${stamp}.csv`, [
        ...buildHeaderRows('Revenue by Customer'),
        ...formatRowsForCSV(revenueRows, [1]),
      ])
      toast.success('Exported revenue CSV')
      return
    }

    toast('Nothing to export on Summary (try Valuation/Turnover/Aging/Revenue)', { icon: 'ℹ️' })
  }

  const handleExportXLSX = () => {
    const wb = XLSX.utils.book_new()
    const addSheet = (title: string, bodyRows: (string | number)[][], header: string, moneyCols: number[] = [], qtyCols: number[] = []) => {
      const pre = buildHeaderRows(header)
      const aoa = [...pre, ...bodyRows]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      XLSX.utils.book_append_sheet(wb, ws, title.substring(0, 31))
      const dataStart = pre.length + 1
      formatSheetNumbers(ws, dataStart, moneyCols, qtyCols)
    }
    const stamp = endDate.replace(/-/g, '')

    if (tab === 'valuation') {
      addSheet('Valuation by WH', valuationByWHRows,
        `Stock Valuation — ${valuationAsOfEnd ? `as of ${endDate} (${costMethod})` : 'current snapshot'}`, [1])
      addSheet('Valuation by Bin', valuationByBinRows,
        'Stock Valuation — By Bin (current snapshot)', [2])
      addSheet('Details WH-Item', valuationWHItemRows,
        'Stock Valuation — Details by Warehouse & Item', [4,5], [3])
      addSheet('Details Bin-Item', valuationBinItemRows,
        'Stock Valuation — Details by Bin & Item', [5,6], [4])

      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      saveAs(new Blob([wbout], { type: 'application/octet-stream' }), `valuation_${stamp}.xlsx`)
      toast.success('Exported valuation XLSX (incl. detailed)')
      return
    }

    if (tab === 'turnover') {
      addSheet('Turnover', turnoverRows, 'Inventory Turnover & Avg Days to Sell', [8], [2,3,4,5,6,7])
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      saveAs(new Blob([wbout], { type: 'application/octet-stream' }), `turnover_${stamp}.xlsx`)
      toast.success('Exported turnover XLSX')
      return
    }

    if (tab === 'aging') {
      addSheet('Aging by WH', agingWHRows, 'Inventory Aging — By Warehouse', [2], [1])
      addSheet('Aging by Bin', agingBinRows, 'Inventory Aging — By Bin', [3], [2])
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      saveAs(new Blob([wbout], { type: 'application/octet-stream' }), `aging_${stamp}.xlsx`)
      toast.success('Exported aging XLSX')
      return
    }

    if (tab === 'revenue') {
      addSheet('Revenue by Customer', revenueRows, 'Revenue by Customer', [1])
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      saveAs(new Blob([wbout], { type: 'application/octet-stream' }), `revenue_${stamp}.xlsx`)
      toast.success('Exported revenue XLSX')
      return
    }

    toast('Nothing to export on Summary (try Valuation/Turnover/Aging/Revenue)', { icon: 'ℹ️' })
  }

  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    const stamp = endDate.replace(/-/g, '')

    const addHeader = (title: string) => {
      doc.setFontSize(12)
      doc.text(companyName, 40, 36)
      doc.setFontSize(14)
      doc.text(title, 40, 58)
      doc.setFontSize(10)
      doc.text(`Period: ${startDate} → ${endDate}`, 40, 76)
      let fxLine = `Currency: ${displayCurrency}${fxRate !== 1 ? `  (FX ${fxRate.toFixed(6)} per ${baseCurrency})` : ''}`
      if (fxNote) fxLine += ` • ${fxNote}`
      doc.text(fxLine, 40, 92)
      doc.setDrawColor(200); doc.line(40, 100, 800, 100)
    }

    const toMoney = (v: number) => `${displayCurrency} ${fmtAccounting(v * fxRate, 2)}`
    const tableStyle = { styles: { fontSize: 9 as const, cellPadding: 4 }, headStyles: { fillColor: [240,240,240] as [number, number, number] } }

    if (tab === 'valuation') {
      addHeader(`Stock Valuation — ${valuationAsOfEnd ? `as of ${endDate} (${costMethod})` : 'current snapshot'}`)
      autoTable(doc, {
        startY: 110,
        head: [['Warehouse', `Value (${displayCurrency})`]],
        body: valuationByWHRows.slice(1),
        ...tableStyle,
        didParseCell(data: AutoTableCellData) {
          if (data.section === 'body' && data.column.index === 1 && typeof data.cell.raw === 'number') {
            data.cell.text = [toMoney(data.cell.raw as number)]
          }
        },
      })
      doc.addPage()
      addHeader('Stock Valuation — By Bin (current snapshot)')
      autoTable(doc, {
        startY: 110,
        head: [['Warehouse', 'Bin', `Value (${displayCurrency})`]],
        body: valuationByBinRows.slice(1),
        ...tableStyle,
        didParseCell(data: AutoTableCellData) {
          if (data.section === 'body' && data.column.index === 2 && typeof data.cell.raw === 'number') {
            data.cell.text = [toMoney(data.cell.raw as number)]
          }
        },
      })
      doc.addPage()
      addHeader('Details — By Warehouse & Item')
      autoTable(doc, {
        startY: 110,
        head: [['Warehouse', 'Item', 'SKU', 'Qty', 'Unit Cost', 'Value']],
        body: valuationWHItemRows.slice(1).map(r => {
          const row = [...r]
          row[3] = typeof row[3] === 'number' ? fmt(row[3] as number, 2) : row[3]
          row[4] = typeof row[4] === 'number' ? toMoney(row[4] as number) : row[4]
          row[5] = typeof row[5] === 'number' ? toMoney(row[5] as number) : row[5]
          return row
        }),
        ...tableStyle,
      })
      doc.addPage()
      addHeader('Details — By Bin & Item')
      autoTable(doc, {
        startY: 110,
        head: [['Warehouse', 'Bin', 'Item', 'SKU', 'Qty', 'Unit Cost', 'Value']],
        body: valuationBinItemRows.slice(1).map(r => {
          const row = [...r]
          row[4] = typeof row[4] === 'number' ? fmt(row[4] as number, 2) : row[4]
          row[5] = typeof row[5] === 'number' ? toMoney(row[5] as number) : row[5]
          row[6] = typeof row[6] === 'number' ? toMoney(row[6] as number) : row[6]
          return row
        }),
        ...tableStyle,
      })
      doc.save(`valuation_${stamp}.pdf`)
      toast.success('Exported valuation PDF (incl. detailed)')
      return
    }

    if (tab === 'turnover') {
      addHeader('Inventory Turnover & Avg Days to Sell')
      autoTable(doc, {
        startY: 110,
        head: [['Item','SKU','Sold','Begin','End','Avg','Turns','Avg Days','COGS']],
        body: turnoverRows.slice(1).map(r => {
          const arr = [...r]
          arr[2] = typeof arr[2] === 'number' ? fmt(arr[2] as number, 2) : arr[2]
          arr[3] = typeof arr[3] === 'number' ? fmt(arr[3] as number, 2) : arr[3]
          arr[4] = typeof arr[4] === 'number' ? fmt(arr[4] as number, 2) : arr[4]
          arr[5] = typeof arr[5] === 'number' ? fmt(arr[5] as number, 2) : arr[5]
          arr[6] = typeof arr[6] === 'number' ? fmt(arr[6] as number, 2) : arr[6]
          arr[7] = typeof arr[7] === 'number' ? fmt(arr[7] as number, 1) : arr[7]
          arr[8] = typeof arr[8] === 'number' ? toMoney(arr[8] as number) : arr[8]
          return arr
        }),
        ...tableStyle,
      })
      doc.save(`turnover_${stamp}.pdf`)
      toast.success('Exported turnover PDF')
      return
    }

    if (tab === 'aging') {
      addHeader('Inventory Aging — By Warehouse')
      autoTable(doc, {
        startY: 110,
        head: [agingWHRows[0] as string[]],
        body: agingWHRows.slice(1),
        ...tableStyle,
      })
      doc.addPage()
      addHeader('Inventory Aging — By Bin')
      autoTable(doc, {
        startY: 110,
        head: [agingBinRows[0] as string[]],
        body: agingBinRows.slice(1),
        ...tableStyle,
      })
      doc.save(`aging_${stamp}.pdf`)
      toast.success('Exported aging PDF')
      return
    }

    if (tab === 'revenue') {
      addHeader('Revenue by Customer')
      autoTable(doc, {
        startY: 110,
        head: [['Customer', `Revenue (${displayCurrency})`]],
        body: revenueRows.slice(1).map(r => {
          const row = [...r]
          row[1] = typeof row[1] === 'number' ? toMoney(row[1] as number) : row[1]
          return row
        }),
        ...tableStyle,
      })
      doc.save(`revenue_${stamp}.pdf`)
      toast.success('Exported revenue PDF')
      return
    }

    toast('Nothing to export on Summary (try Valuation/Turnover/Aging/Revenue)', { icon: 'ℹ️' })
  }
  /** ----------------- UI ----------------- */
  const subtitle =
    tab === 'valuation'
      ? `Stock Valuation ${valuationAsOfEnd ? `(as of ${endDate})` : `(current)`} [${costMethod}]`
      : tab === 'turnover'
      ? 'Inventory Turnover & Avg Days to Sell'
      : tab === 'aging'
      ? 'Inventory Aging'
      : tab === 'revenue'
      ? (
          ordersUnavailable && cashUnavailable
            ? 'Revenue by Customer (no sources connected)'
            : ordersUnavailable
            ? 'Revenue by Customer (orders source not connected; showing Cash/POS only)'
            : cashUnavailable
            ? 'Revenue by Customer (cash/POS source not connected; showing Orders only)'
            : 'Revenue by Customer'
        )
      : 'Inventory Reports'

  const currencyOptions = useMemo(() => {
    const codes = new Set<string>()
    const list: string[] = []
    if (baseCurrency) { list.push(baseCurrency); codes.add(baseCurrency) }
    for (const c of currencies) {
      if (!codes.has(c.code)) { list.push(c.code); codes.add(c.code) }
    }
    return list
  }, [currencies, baseCurrency])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl md:text-3xl font-bold">
          <Link to="/settings" className="underline decoration-dotted underline-offset-4 hover:opacity-80">
            {companyName}
          </Link>
          {' — '}
          {subtitle}
        </h1>
        <div className="text-xs text-muted-foreground">
          Money shown in {displayCurrency}{fxRate !== 1 ? ` @ FX ${fxRate.toFixed(6)} per ${baseCurrency}` : ''}{fxNote ? ` • ${fxNote}` : ''}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Start</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <div className="flex gap-2 flex-wrap">
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(30); setStartDate(d.start); setEndDate(d.end) }}>Last 30d</Button>
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(90); setStartDate(d.start); setEndDate(d.end) }}>Last 90d</Button>
                <Button type="button" variant="outline" onClick={() => { const d = lastNDays(365); setStartDate(d.start); setEndDate(d.end) }}>Last 365d</Button>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>Costing Method</Label>
              <select className="w-full border rounded-md h-9 px-2" value={costMethod} onChange={e => setCostMethod(e.target.value === 'FIFO' ? 'FIFO' : 'WA')}>
                <option value="WA">Weighted Average</option>
                <option value="FIFO">FIFO</option>
              </select>
            </div>
            <div>
              <Label>Valuation Timing</Label>
              <div className="flex items-center gap-2 h-9">
                <input id="asof" type="checkbox" className="h-4 w-4" checked={valuationAsOfEnd} onChange={e => setValuationAsOfEnd(e.target.checked)} />
                <Label htmlFor="asof">Use valuation as of end date (warehouse level)</Label>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Bin-level valuation uses the current snapshot until movements include bin IDs.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Currency</Label>
                <select className="w-full border rounded-md h-9 px-2" value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>
                  {currencyOptions.map(code => (<option key={code} value={code}>{code}</option>))}
                </select>
              </div>
              <div>
                <Label>FX rate (per {baseCurrency})</Label>
                <Input type="number" step="0.000001" value={fxRate} onChange={e => setFxRate(Number(e.target.value) || 0)} disabled={autoFx} />
                <div className="flex items-center gap-2 mt-1">
                  <input id="autofx" type="checkbox" className="h-4 w-4" checked={autoFx} onChange={e => setAutoFx(e.target.checked)} />
                  <Label htmlFor="autofx" className="text-xs">Auto FX (use latest rate on/before End date)</Label>
                </div>
              </div>
            </div>
          </div>

          {/* Export buttons */}
          <div className="mt-4 flex gap-2">
            <Button type="button" variant="outline" onClick={handleExportCSV}>Export CSV</Button>
            <Button type="button" variant="outline" onClick={handleExportXLSX}>Export XLSX</Button>
            <Button type="button" variant="outline" onClick={handleExportPDF}>Export PDF</Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 flex-wrap">
        <Button variant={tab === 'summary' ? 'default' : 'outline'} onClick={() => setTab('summary')}>Summary</Button>
        <Button variant={tab === 'valuation' ? 'default' : 'outline'} onClick={() => setTab('valuation')}>Valuation</Button>
        <Button variant={tab === 'turnover' ? 'default' : 'outline'} onClick={() => setTab('turnover')}>Turnover</Button>
        <Button variant={tab === 'aging' ? 'default' : 'outline'} onClick={() => setTab('aging')}>Aging</Button>
        <Button variant={tab === 'revenue' ? 'default' : 'outline'} onClick={() => setTab('revenue')}>Revenue</Button>
      </div>

      {/* ---------- TABS ---------- */}
      {tab === 'summary' && (
        <Card>
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <KPI label="Days in period" value={fmt(turnoverPerItem.daysInPeriod, 0)} />
              <KPI label="Units sold" value={fmt(turnoverSummary.totalSold, 2)} />
              <KPI label="Avg inventory (units)" value={fmt(turnoverSummary.avgInv, 2)} />
              <KPI label="Turns (units)" value={fmt(turnoverSummary.turns, 2)} />
              <KPI label="Avg days to sell" value={turnoverSummary.avgDaysToSell != null ? fmt(turnoverSummary.avgDaysToSell, 1) : '—'} />
              <KPI label="COGS (period)" value={moneyText(turnoverSummary.totalCOGS)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <Card className="border-dashed">
                <CardHeader><CardTitle>Best & Worst Sellers (by units)</CardTitle></CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b">
                        <td className="py-2 pr-2 font-medium">Best</td>
                        <td className="py-2 pr-2">
                          {bestWorst.best ? `${bestWorst.best.item!.name} (${fmt(bestWorst.best.qty, 2)} units)` : '—'}
                        </td>
                      </tr>
                      <tr className="border-b">
                        <td className="py-2 pr-2 font-medium">Worst</td>
                        <td className="py-2 pr-2">
                          {bestWorst.worst ? `${bestWorst.worst.item!.name} (${fmt(bestWorst.worst.qty, 2)} units)` : '—'}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-2 font-medium">Zero sales</td>
                        <td className="py-2 pr-2">{fmt(bestWorst.zeroSales, 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card className="border-dashed md:col-span-2">
                <CardHeader><CardTitle>Valuation by Warehouse {valuationAsOfEnd ? `(as of ${endDate}, ${costMethod})` : `(current snapshot)`}</CardTitle></CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b">
                      <th className="py-2 pr-2">Warehouse</th>
                      <th className="py-2 pr-2">Value</th>
                    </tr></thead>
                    <tbody>
                      {(valuationAsOfEnd
                        ? Array.from(engine.valuationByWH_AsOfEnd.entries())
                        : Array.from(valuationCurrent.byWH.entries())
                      ).sort((a,b)=>b[1]-a[1]).map(([wid, val]) => (
                        <tr key={wid} className="border-b">
                          <td className="py-2 pr-2">{whById.get(wid)?.name || wid}</td>
                          <td className="py-2 pr-2">{moneyText(val)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-2 pr-2 font-medium">Total</td>
                        <td className="py-2 pr-2 font-medium">
                          {moneyText(valuationAsOfEnd
                            ? Array.from(engine.valuationByWH_AsOfEnd.values()).reduce((s,v)=>s+v,0)
                            : valuationCurrent.total)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>

            <div className="mt-6">
              <Card className="border-dashed">
                <CardHeader><CardTitle>Movements (in period) — Audit trail</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left border-b">
                        <th className="py-2 pr-2">Time</th>
                        <th className="py-2 pr-2">Type</th>
                        <th className="py-2 pr-2">Item</th>
                        <th className="py-2 pr-2">Qty</th>
                        <th className="py-2 pr-2">Unit Cost</th>
                        <th className="py-2 pr-2">Warehouse From</th>
                        <th className="py-2 pr-2">Warehouse To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {period.inRange.length === 0 && (
                        <tr><td colSpan={7} className="py-4 text-muted-foreground">No movements in the selected period.</td></tr>
                      )}
                      {period.inRange.map(m => {
                        const t = new Date(getTime(m)).toLocaleString()
                        const it = itemById.get(m.itemId)
                        const wFrom = m.warehouseFromId ? (whById.get(m.warehouseFromId)?.name || m.warehouseFromId) : ''
                        const wTo = m.warehouseToId ? (whById.get(m.warehouseToId)?.name || m.warehouseToId) : (m.warehouseId ? (whById.get(m.warehouseId)?.name || m.warehouseId) : '')
                        const qty = Math.abs(n(m.qtyBase ?? m.qty, 0))
                        return (
                          <tr key={m.id} className="border-b">
                            <td className="py-2 pr-2">{t}</td>
                            <td className="py-2 pr-2">{normalizeType(m.type, m.qtyBase ?? m.qty)}</td>
                            <td className="py-2 pr-2">{it?.name || m.itemId}</td>
                            <td className="py-2 pr-2">{fmt(qty, 2)}</td>
                            <td className="py-2 pr-2">{moneyText(n(m.unitCost, 0))}</td>
                            <td className="py-2 pr-2">{wFrom || '—'}</td>
                            <td className="py-2 pr-2">{wTo || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'valuation' && (
        <Card>
          <CardHeader><CardTitle>Stock Valuation</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            {/* Totals by Warehouse */}
            <div className="overflow-x-auto">
              <h3 className="font-medium mb-2">By Warehouse {valuationAsOfEnd ? `(as of ${endDate}, ${costMethod})` : `(current snapshot)`}</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th className="py-2 pr-2">Warehouse</th>
                  <th className="py-2 pr-2">Value</th>
                </tr></thead>
                <tbody>
                  {(valuationAsOfEnd
                    ? Array.from(engine.valuationByWH_AsOfEnd.entries())
                    : Array.from(valuationCurrent.byWH.entries())
                  ).sort((a,b)=>b[1]-a[1]).map(([wid, val]) => (
                    <tr key={wid} className="border-b">
                      <td className="py-2 pr-2">{whById.get(wid)?.name || wid}</td>
                      <td className="py-2 pr-2">{moneyText(val)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-2 font-medium">Total</td>
                    <td className="py-2 pr-2 font-medium">
                      {moneyText(valuationAsOfEnd
                        ? Array.from(engine.valuationByWH_AsOfEnd.values()).reduce((s,v)=>s+v,0)
                        : valuationCurrent.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Totals by Bin */}
            <div className="overflow-x-auto">
              <h3 className="font-medium mb-2">By Bin (current snapshot)</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th className="py-2 pr-2">Warehouse</th>
                  <th className="py-2 pr-2">Bin</th>
                  <th className="py-2 pr-2">Value</th>
                </tr></thead>
                <tbody>
                  {Array.from(valuationCurrent.byBin.entries()).sort((a,b)=>b[1]-a[1]).map(([key, val]) => {
                    const [wid, bid] = key.split('|')
                    const whName = whById.get(wid)?.name || wid
                    const binCode = bid ? (binById.get(bid)?.code || bid) : '(no bin)'
                    return (
                      <tr key={key} className="border-b">
                        <td className="py-2 pr-2">{whName}</td>
                        <td className="py-2 pr-2">{binCode}</td>
                        <td className="py-2 pr-2">{moneyText(val)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="text-xs text-muted-foreground mt-2">
                To enable FIFO by Bin, record <code>binFromId</code>/<code>binToId</code> on movements.
              </div>
            </div>

            {/* Details by Warehouse → Item */}
            <div className="overflow-x-auto">
              <h3 className="font-medium mb-2">Details — By Warehouse & Item</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th className="py-2 pr-2">Warehouse</th>
                  <th className="py-2 pr-2">Item</th>
                  <th className="py-2 pr-2">SKU</th>
                  <th className="py-2 pr-2">Qty</th>
                  <th className="py-2 pr-2">Unit Cost</th>
                  <th className="py-2 pr-2">Value</th>
                </tr></thead>
                <tbody>
                  {valuationDetailsByWH.map(r => (
                    <tr key={`${r.warehouseId}|${r.itemId}`} className="border-b">
                      <td className="py-2 pr-2">{r.warehouseName}</td>
                      <td className="py-2 pr-2">{r.itemName}</td>
                      <td className="py-2 pr-2">{r.sku}</td>
                      <td className="py-2 pr-2">{fmt(r.qty, 2)}</td>
                      <td className="py-2 pr-2">{moneyText(r.unitCost)}</td>
                      <td className="py-2 pr-2">{moneyText(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Details by Bin → Item */}
            <div className="overflow-x-auto">
              <h3 className="font-medium mb-2">Details — By Bin & Item</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left border-b">
                  <th className="py-2 pr-2">Warehouse</th>
                  <th className="py-2 pr-2">Bin</th>
                  <th className="py-2 pr-2">Item</th>
                  <th className="py-2 pr-2">SKU</th>
                  <th className="py-2 pr-2">Qty</th>
                  <th className="py-2 pr-2">Unit Cost</th>
                  <th className="py-2 pr-2">Value</th>
                </tr></thead>
                <tbody>
                  {valuationDetailsByBin.map(r => (
                    <tr key={`${r.warehouseId}|${r.binId || ''}|${r.itemId}`} className="border-b">
                      <td className="py-2 pr-2">{r.warehouseName}</td>
                      <td className="py-2 pr-2">{r.binCode}</td>
                      <td className="py-2 pr-2">{r.itemName}</td>
                      <td className="py-2 pr-2">{r.sku}</td>
                      <td className="py-2 pr-2">{fmt(r.qty, 2)}</td>
                      <td className="py-2 pr-2">{moneyText(r.unitCost)}</td>
                      <td className="py-2 pr-2">{moneyText(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'turnover' && (
        <Card>
          <CardHeader><CardTitle>Turnover (Units) & Avg Days to Sell</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b">
                <th className="py-2 pr-2">Item</th>
                <th className="py-2 pr-2">SKU</th>
                <th className="py-2 pr-2">Sold (period)</th>
                <th className="py-2 pr-2">Begin Units</th>
                <th className="py-2 pr-2">End Units</th>
                <th className="py-2 pr-2">Avg Units</th>
                <th className="py-2 pr-2">Turns</th>
                <th className="py-2 pr-2">Avg Days to Sell</th>
                <th className="py-2 pr-2">COGS</th>
              </tr></thead>
              <tbody>
                {turnoverPerItem.rows.length === 0 && (
                  <tr><td colSpan={9} className="py-4 text-muted-foreground">No movements in the selected period.</td></tr>
                )}
                {turnoverPerItem.rows.map(r => (
                  <tr key={r.itemId} className="border-b">
                    <td className="py-2 pr-2">{r.name}</td>
                    <td className="py-2 pr-2">{r.sku}</td>
                    <td className="py-2 pr-2">{fmt(r.sold, 2)}</td>
                    <td className="py-2 pr-2">{fmt(r.beginUnits, 2)}</td>
                    <td className="py-2 pr-2">{fmt(r.endUnits, 2)}</td>
                    <td className="py-2 pr-2">{fmt(r.avgUnits, 2)}</td>
                    <td className="py-2 pr-2">{fmt(r.turns, 2)}</td>
                    <td className="py-2 pr-2">{r.avgDaysToSell != null ? fmt(r.avgDaysToSell, 1) : '—'}</td>
                    <td className="py-2 pr-2">{moneyText(n(r.cogs, 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === 'aging' && (
        <Card>
          <CardHeader><CardTitle>Aging Buckets</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <div className="overflow-x-auto">
              <h3 className="font-medium mb-2">By Warehouse</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">Warehouse</th>
                    <th className="py-2 pr-2">Total Qty</th>
                    <th className="py-2 pr-2">Total Value</th>
                    {aging.buckets.map(b => <th key={b} className="py-2 pr-2">{b}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {aging.rowsWH.map(r => (
                    <tr key={r.warehouseId} className="border-b">
                      <td className="py-2 pr-2">{r.warehouseName}</td>
                      <td className="py-2 pr-2">{fmt(r.qty, 2)}</td>
                      <td className="py-2 pr-2">{moneyText(r.value)}</td>
                      {aging.buckets.map(b => (
                        <td key={b} className="py-2 pr-2">
                          {fmt(r.byBucket[b].qty, 2)} / {moneyText(r.byBucket[b].value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <h3 className="font-medium mb-2">By Bin (current snapshot)</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">Warehouse</th>
                    <th className="py-2 pr-2">Bin</th>
                    <th className="py-2 pr-2">Total Qty</th>
                    <th className="py-2 pr-2">Total Value</th>
                    {aging.buckets.map(b => <th key={b} className="py-2 pr-2">{b}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {aging.rowsBin.map(r => (
                    <tr key={`${r.warehouseId}|${r.binId || ''}`} className="border-b">
                      <td className="py-2 pr-2">{r.warehouseName}</td>
                      <td className="py-2 pr-2">{r.binCode}</td>
                      <td className="py-2 pr-2">{fmt(r.qty, 2)}</td>
                      <td className="py-2 pr-2">{moneyText(r.value)}</td>
                      {aging.buckets.map(b => (
                        <td key={b} className="py-2 pr-2">
                          {fmt(r.byBucket[b].qty, 2)} / {moneyText(r.byBucket[b].value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'revenue' && (
        <Card>
          <CardHeader><CardTitle>Revenue by Customer</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {(ordersUnavailable || cashUnavailable) && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
                {ordersUnavailable && cashUnavailable && 'No revenue sources are connected. Configure order/cash sources in Settings.'}
                {ordersUnavailable && !cashUnavailable && 'Orders source not connected — showing only Cash/POS sales.'}
                {!ordersUnavailable && cashUnavailable && 'Cash/POS source not connected — showing only Orders.'}
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {revenueByCustomer.rows.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-4 text-muted-foreground">No revenue in the selected period.</td>
                  </tr>
                )}
                {revenueByCustomer.rows.map(r => (
                  <tr key={r.customerId} className="border-b">
                    <td className="py-2 pr-2">{r.customerName}</td>
                    <td className="py-2 pr-2">{moneyText(r.baseAmount)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 pr-2 font-medium">Total</td>
                  <td className="py-2 pr-2 font-medium">{moneyText(revenueByCustomer.grandTotalBase)}</td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Small KPI tile */
function KPI({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1 break-words">{value}</div>
    </div>
  )
}
