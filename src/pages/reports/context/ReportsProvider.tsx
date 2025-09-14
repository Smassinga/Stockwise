// src/pages/reports/context/ReportsProvider.tsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, db } from '../../../lib/db'
import { useAuth } from '../../../hooks/useAuth'
import { useOrg } from '../../../hooks/useOrg'
import toast from 'react-hot-toast'

type Warehouse = { id: string; name: string; code?: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }
type Item = { id: string; name: string; sku: string; baseUomId: string }
type Currency = { code: string; name: string }
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

type CashSaleLite = OrderLite

type StockLevel = {
  id: string
  itemId: string
  warehouseId: string
  binId?: string | null
  onHandQty: number
  avgCost?: number
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

type CostMethod = 'WA' | 'FIFO'

/* -------------------- small helpers -------------------- */
const n = (v: any, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d }
const getTime = (row: any): number => {
  const s = row?.createdAt ?? row?.created_at ?? row?.createdat
  return s ? new Date(s).getTime() : 0
}
const normalizeType = (t: string, qty: number | undefined): 'IN' | 'OUT' | 'ADJ' | 'TRANSFER' => {
  const s = (t || '').toLowerCase()
  if (s === 'receipt' || s === 'in' || s === 'purchase' || s === 'receive') return 'IN'
  if (s === 'issue' || s === 'out' || s === 'sale' || s === 'ship') return 'OUT'
  if (s === 'transfer') return 'TRANSFER'
  if (s === 'adj' || s === 'adjustment' || s === 'stock_adjustment') return 'ADJ'
  if (n(qty, 0) > 0) return 'IN'
  if (n(qty, 0) < 0) return 'OUT'
  return 'ADJ'
}
const resolveWarehouse = (m: Movement, dir: 'IN' | 'OUT') => {
  if (m.warehouseId) return m.warehouseId
  if (dir === 'IN') return (m.warehouseToId || m.warehouseFromId || '') || ''
  return (m.warehouseFromId || m.warehouseToId || '') || ''
}
const pickString = (...cs: any[]) => {
  for (const c of cs) if (typeof c === 'string' && c.trim()) return c.trim()
  return undefined
}
const at = (obj: any, path: string): any => {
  try { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj) } catch { return undefined }
}
const fmtPositive = (x: number, d = 2) => {
  const fixed = (Math.abs(x) || 0).toFixed(d)
  const [i, dec] = fixed.split('.')
  const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec != null ? `${withCommas}.${dec}` : withCommas
}
const fmt = (x: number, d = 2) => (x < 0 ? '-' : '') + fmtPositive(x, d)
const fmtAccounting = (x: number, d = 2) => (x < 0 ? `(${fmtPositive(x, d)})` : fmtPositive(x, d))
const lastNDays = (days: number) => {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - days)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

/* -------------------- context shape -------------------- */
type ReportsContextType = {
  // filters & fx
  startDate: string; endDate: string; setStartDate: (s: string) => void; setEndDate: (s: string) => void
  costMethod: CostMethod; setCostMethod: (m: CostMethod) => void
  valuationAsOfEnd: boolean; setValuationAsOfEnd: (b: boolean) => void
  baseCurrency: string; displayCurrency: string; setDisplayCurrency: (s: string) => void
  fxRate: number; setFxRate: (n: number) => void; autoFx: boolean; setAutoFx: (b: boolean) => void
  fxNote: string
  currencyOptions: string[]
  lastNDays: (n: number) => { start: string; end: string }

  // master data
  warehouses: Warehouse[]; bins: Bin[]; items: Item[]
  currencies: Currency[]; customers: Customer[]
  levels: StockLevel[]; moves: Movement[]
  orders: OrderLite[]; cashSales: CashSaleLite[]
  ordersUnavailable: boolean; cashUnavailable: boolean

  // indexes & helpers
  itemById: Map<string, Item>
  whById: Map<string, Warehouse>
  binById: Map<string, Bin>
  customerById: Map<string, Customer>
  moneyText: (x: number) => string
  fmt: typeof fmt
  fmtAccounting: typeof fmtAccounting

  // derived period
  period: { startMs: number; endMs: number; inRange: Movement[] }

  // computed for tabs reuse
  valuationCurrent: {
    total: number
    byWH: Map<string, number>
    byBin: Map<string, number>
    byItem: Map<string, number>
  }
  valuationEngine: {
    valuationByWH_AsOfEnd: Map<string, number>
    asOfEndQtyByKey: Map<string, number>
    asOfEndAvgCostByKey: Map<string, number>
    cogsByItemInPeriod: Map<string, number>
    soldUnitsByItemInPeriod: Map<string, number>
  }
  turnoverPerItem: {
    daysInPeriod: number
    rows: Array<{
      itemId: string; name: string; sku: string
      sold: number; beginUnits: number; endUnits: number; avgUnits: number
      turns: number; avgDaysToSell: number | null; cogs?: number
    }>
  }
  turnoverSummary: {
    totalSold: number; avgInv: number; turns: number; avgDaysToSell: number | null; days: number; currentVal: number; totalCOGS: number
  }
  bestWorst: { best: { item?: Item; qty: number } | null; worst: { item?: Item; qty: number } | null; zeroSales: number }
  aging: {
    buckets: string[]
    rowsWH: Array<{ warehouseId: string; warehouseName: string; qty: number; value: number; byBucket: Record<string, { qty: number; value: number }> }>
    rowsBin: Array<{ warehouseId: string; binId: string | null; warehouseName: string; binCode: string; qty: number; value: number; byBucket: Record<string, { qty: number; value: number }> }>
  }
  revenueByCustomer: {
    rows: Array<{ customerId: string; customerName: string; baseAmount: number }>
    grandTotalBase: number
  }

  // ui
  ui: {
    companyName: string
    subtitle: string
    costMethod: CostMethod
    fxNote: string
  }
  setUi: React.Dispatch<React.SetStateAction<{ companyName: string; subtitle: string; costMethod: CostMethod; fxNote: string }>>
}

const Ctx = createContext<ReportsContextType | undefined>(undefined)

export function ReportsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { companyId, companyName: orgCompanyName } = useOrg()

  // UI + filters
  const [ui, setUi] = useState({ companyName: orgCompanyName || user?.orgName || 'Your Company', subtitle: 'Inventory Reports', costMethod: 'WA' as CostMethod, fxNote: '' })
  const def = lastNDays(90)
  const [startDate, setStartDate] = useState(def.start)
  const [endDate, setEndDate] = useState(def.end)
  const [costMethod, setCostMethod] = useState<CostMethod>('WA')
  const [valuationAsOfEnd, setValuationAsOfEnd] = useState(false)

  // FX
  const [baseCurrency, setBaseCurrency] = useState('MZN')
  const [displayCurrency, setDisplayCurrency] = useState('MZN')
  const [fxRate, setFxRate] = useState(1)
  const [autoFx, setAutoFx] = useState(true)
  const [fxNote, setFxNote] = useState('')

  // master
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [levels, setLevels] = useState<StockLevel[]>([])
  const [moves, setMoves] = useState<Movement[]>([])
  const [orders, setOrders] = useState<OrderLite[]>([])
  const [cashSales, setCashSales] = useState<CashSaleLite[]>([])

  // revenue config
  const [ordersSource, setOrdersSource] = useState<string>('')
  const [cashSource, setCashSource] = useState<string>('')
  const [ordersUnavailable, setOrdersUnavailable] = useState(false)
  const [cashUnavailable, setCashUnavailable] = useState(false)
  const ordersFetchKeyRef = useRef(''); const cashFetchKeyRef = useRef('')

  /* ---------- load company brand for header ---------- */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId) return
      const res = await supabase.from('company_settings').select('data').eq('company_id', companyId).limit(1)
      if (cancelled) return
      const name = (Array.isArray(res.data) && res.data[0]?.data?.documents?.brand?.name) || null
      if (typeof name === 'string' && name.trim()) setUi(s => ({ ...s, companyName: name.trim() }))
    })()
    return () => { cancelled = true }
  }, [companyId])

  /* ---------- load settings + master ---------- */
  useEffect(() => {
    ;(async () => {
      try {
        const { data: settingsRows } = await supabase.from('settings').select('*').eq('id', 'app').limit(1)
        const setting: any = Array.isArray(settingsRows) && settingsRows.length ? settingsRows[0] : null

        const [wh, bb, it, sl, mv, cs, custs] = await Promise.all([
          db.warehouses.list({ orderBy: { name: 'asc' } }),
          db.bins.list({ orderBy: { code: 'asc' } }),
          db.items.list({ orderBy: { name: 'asc' } }),
          db.stockLevels.list(),
          db.movements.list({ orderBy: { createdAt: 'asc' } }),
          db.currencies.list({ orderBy: { code: 'asc' } }),
          supabase.from('customers').select('id,name,code').order('name', { ascending: true }),
        ])

        setWarehouses(wh || []); setBins(bb || []); setItems(it || [])
        setLevels(sl || []); setMoves(mv || []); setCurrencies(cs || [])
        if ((custs as any)?.data) setCustomers((custs as any).data as Customer[])

        const baseCur = pickString(
          setting?.baseCurrencyCode, setting?.base_currency_code,
          at(setting, 'documents.finance.baseCurrency'),
          at(setting, 'documents.reports.baseCurrency'),
          at(setting, 'finance.baseCurrency')
        ) || 'MZN'
        setBaseCurrency(baseCur); setDisplayCurrency(prev => prev || baseCur)

        const ordersSrc = pickString(
          setting?.ordersSource, setting?.orders_source, setting?.ordersView, setting?.orders_table,
          at(setting, 'documents.revenue.ordersSource'),
          at(setting, 'reports.revenue.ordersSource')
        )
        const cashSrc = pickString(
          setting?.cashSalesSource, setting?.cash_sales_source, setting?.posSource, setting?.pos_source,
          setting?.cashSalesView, setting?.cash_sales_view,
          at(setting, 'documents.revenue.cashSalesSource'),
          at(setting, 'reports.revenue.cashSalesSource'),
          at(setting, 'reports.revenue.posSource')
        )
        if (ordersSrc) setOrdersSource(ordersSrc)
        if (cashSrc) setCashSource(cashSrc)
      } catch (err: any) {
        console.error(err)
        toast.error(err?.message || 'Failed to load report prerequisites')
      }
    })()
  }, [])

  /* ---------- revenue sources by date window ---------- */
  useEffect(() => {
    ;(async () => {
      const key = `${ordersSource}|${startDate}|${endDate}`
      if (ordersFetchKeyRef.current === key) return
      ordersFetchKeyRef.current = key
      setOrders([]); setOrdersUnavailable(false)
      if (!ordersSource) { setOrdersUnavailable(true); return }

      const startIso = `${startDate}T00:00:00Z`; const endIso = `${endDate}T23:59:59.999Z`
      type DateCol = 'createdAt' | 'created_at'
      const run = (col: DateCol) =>
        supabase.from(ordersSource)
          .select(`id,customerId,customer_id,status,currencyCode,currency_code,total,grandTotal,netTotal,total_amount,grand_total,net_total,${col}`)
          .gte(col, startIso)
          .lte(col, endIso)
          .order(col, { ascending: true })

      try {
        let resp = await run('createdAt')
        if (resp.error) {
          const msg = (resp.error.message || '').toLowerCase()
          if (msg.includes('column') && msg.includes('does not exist')) {
            const r2 = await run('created_at')
            if (r2.error) { setOrdersUnavailable(true); return }
            setOrders((r2.data || []) as OrderLite[]); return
          }
          if (msg.includes('relation') || msg.includes('not found')) { setOrdersUnavailable(true); return }
          setOrdersUnavailable(true); return
        }
        setOrders((resp.data || []) as OrderLite[])
      } catch { setOrdersUnavailable(true) }
    })()
  }, [ordersSource, startDate, endDate])

  useEffect(() => {
    ;(async () => {
      const key = `${cashSource}|${startDate}|${endDate}`
      if (cashFetchKeyRef.current === key) return
      cashFetchKeyRef.current = key
      setCashSales([]); setCashUnavailable(false)
      if (!cashSource) { setCashUnavailable(true); return }

      const startIso = `${startDate}T00:00:00Z`; const endIso = `${endDate}T23:59:59.999Z`
      type DateCol = 'createdAt' | 'created_at'
      const run = (col: DateCol) =>
        supabase.from(cashSource)
          .select(`id,customerId,customer_id,status,currencyCode,currency_code,total,grandTotal,netTotal,total_amount,grand_total,net_total,${col}`)
          .gte(col, startIso)
          .lte(col, endIso)
          .order(col, { ascending: true })

      try {
        let resp = await run('createdAt')
        if (resp.error) {
          const msg = (resp.error.message || '').toLowerCase()
          if (msg.includes('column') && msg.includes('does not exist')) {
            const r2 = await run('created_at')
            if (r2.error) { setCashUnavailable(true); return }
            setCashSales((r2.data || []) as CashSaleLite[]); return
          }
          if (msg.includes('relation') || msg.includes('not found')) { setCashUnavailable(true); return }
          setCashUnavailable(true); return
        }
        setCashSales((resp.data || []) as CashSaleLite[])
      } catch { setCashUnavailable(true) }
    })()
  }, [cashSource, startDate, endDate])

  /* ---------- auto FX ---------- */
  useEffect(() => {
    ;(async () => {
      if (!autoFx) return
      try {
        if (!displayCurrency || !baseCurrency) return
        if (displayCurrency === baseCurrency) { setFxRate(1); setFxNote(''); return }
        const { data: direct } = await supabase
          .from('fx_rates')
          .select('rate,date,fromCode,toCode')
          .eq('fromCode', baseCurrency).eq('toCode', displayCurrency)
          .lte('date', endDate).order('date', { ascending: false }).limit(1)
        if (direct && direct.length) {
          setFxRate(Number(direct[0].rate) || 1)
          setFxNote(`Using ${baseCurrency}→${displayCurrency} @ ${direct[0].rate} from ${direct[0].date}`)
          setUi(s => ({ ...s, fxNote: `Using ${baseCurrency}→${displayCurrency} @ ${direct[0].rate} from ${direct[0].date}` }))
          return
        }
        const { data: inverse } = await supabase
          .from('fx_rates')
          .select('rate,date,fromCode,toCode')
          .eq('fromCode', displayCurrency).eq('toCode', baseCurrency)
          .lte('date', endDate).order('date', { ascending: false }).limit(1)
        if (inverse && inverse.length) {
          const r = Number(inverse[0].rate) || 1
          const inv = r !== 0 ? 1 / r : 1
          setFxRate(inv)
          setFxNote(`Using inverse ${displayCurrency}→${baseCurrency} @ ${r} (so ${inv.toFixed(6)}) from ${inverse[0].date}`)
          setUi(s => ({ ...s, fxNote: `Using inverse ${displayCurrency}→${baseCurrency} @ ${r} (so ${inv.toFixed(6)}) from ${inverse[0].date}` }))
          return
        }
        setFxRate(1); setFxNote(`No FX found on/before ${endDate}. Using 1.0`)
        setUi(s => ({ ...s, fxNote: `No FX found on/before ${endDate}. Using 1.0` }))
      } catch {
        setFxRate(1); setFxNote('FX lookup failed. Using 1.0')
        setUi(s => ({ ...s, fxNote: 'FX lookup failed. Using 1.0' }))
      }
    })()
  }, [autoFx, endDate, displayCurrency, baseCurrency])

  /* ---------- indexes ---------- */
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const whById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])
  const binById = useMemo(() => new Map(bins.map(b => [b.id, b])), [bins])
  const customerById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers])

  /* ---------- period ---------- */
  const period = useMemo(() => {
    const startMs = new Date(startDate + 'T00:00:00Z').getTime()
    const endMs = new Date(endDate + 'T23:59:59Z').getTime()
    const inRange = moves.filter(m => {
      const t = getTime(m)
      return t >= startMs && t <= endMs
    })
    return { startMs, endMs, inRange }
  }, [moves, startDate, endDate])

  /* ---------- revenue aggregation ---------- */
  const revenueByCustomer = useMemo(() => {
    const BAD = new Set(['cancelled', 'canceled', 'void', 'draft', 'rejected', 'refunded'])
    const agg = new Map<string, number>()
    let grand = 0
    const getAmount = (o: any) => {
      const a = o?.grandTotal ?? o?.total ?? o?.netTotal ?? o?.total_amount ?? o?.grand_total ?? o?.net_total
      const v = Number(a); return Number.isFinite(v) ? v : 0
    }
    const getStatus = (o: any) => String(o?.status || '').toLowerCase()
    const getCustomer = (o: any) => (o?.customerId ?? o?.customer_id ?? null) as (string | null)
    const addRow = (o: any) => {
      if (BAD.has(getStatus(o))) return
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
    }).sort((a, b) => b.baseAmount - a.baseAmount)
    return { rows, grandTotalBase: grand }
  }, [orders, cashSales, customerById])

  /* ---------- costing engine (FIFO/WA) ---------- */
  const valuationEngine = useMemo(() => {
    type Key = string; type Layer = { qty: number; cost: number }
    type WAState = { qty: number; avgCost: number }
    const start = period.startMs, end = period.endMs
    const cogsByItemInPeriod = new Map<string, number>()
    const soldUnitsByItemInPeriod = new Map<string, number>()
    const asOfEndQtyByKey = new Map<Key, number>()
    const asOfEndAvgCostByKey = new Map<Key, number>()
    const valuationByWH_AsOfEnd = new Map<string, number>()
    const wa = new Map<Key, WAState>()
    const fifo = new Map<Key, Layer[]>()
    const keyOf = (whId: string, itemId: string) => `${whId}|${itemId}`
    const takeFromFIFO = (layers: Layer[], qty: number) => {
      let remaining = qty, cogs = 0; const taken: Layer[] = []
      while (remaining > 0 && layers.length > 0) {
        const first = layers[0]
        const take = Math.min(remaining, first.qty)
        if (take > 0) {
          cogs += take * first.cost; taken.push({ qty: take, cost: first.cost })
          first.qty -= take; remaining -= take
          if (first.qty <= 1e-7) layers.shift()
        } else break
      }
      if (remaining > 1e-6) {
        const lastCost = layers.length > 0 ? layers[0].cost : 0
        cogs += remaining * lastCost; taken.push({ qty: remaining, cost: lastCost })
      }
      return { cogs, taken }
    }
    const sorted = [...moves].sort((a, b) => getTime(a) - getTime(b))
    const getWA = (k: Key) => wa.get(k) || { qty: 0, avgCost: 0 }
    const getFIFO = (k: Key) => fifo.get(k) || []
    for (const m of sorted) {
      const t = getTime(m); const qty = Math.abs(n(m.qtyBase ?? m.qty, 0)); if (qty <= 0) continue
      const nt = normalizeType(m.type, m.qtyBase ?? m.qty); const unitCost = n(m.unitCost, 0)
      if (nt === 'TRANSFER') {
        const srcWh = resolveWarehouse(m, 'OUT'); const dstWh = resolveWarehouse(m, 'IN')
        if (!srcWh || !dstWh) continue
        const kSrc = keyOf(srcWh, m.itemId); const kDst = keyOf(dstWh, m.itemId)
        if (costMethod === 'FIFO') {
          const srcLayers = getFIFO(kSrc); const { taken } = takeFromFIFO(srcLayers, qty); fifo.set(kSrc, srcLayers)
          const dstLayers = getFIFO(kDst); taken.forEach(l => dstLayers.push({ qty: l.qty, cost: l.cost })); fifo.set(kDst, dstLayers)
        } else {
          const s = getWA(kSrc); const moveCost = s.avgCost; s.qty = Math.max(0, s.qty - qty); wa.set(kSrc, s)
          const d = getWA(kDst); const totalVal = d.avgCost * d.qty + moveCost * qty; d.qty += qty; d.avgCost = d.qty > 0 ? totalVal / d.qty : d.avgCost; wa.set(kDst, d)
        }
        continue
      }
      let dir: 'IN' | 'OUT'
      if (nt === 'ADJ') dir = (n(m.qtyBase ?? m.qty, 0) >= 0) ? 'IN' : 'OUT'
      else dir = (nt === 'IN') ? 'IN' : 'OUT'
      const wh = resolveWarehouse(m, dir); if (!wh) continue
      const k = keyOf(wh, m.itemId)
      if (dir === 'IN') {
        if (costMethod === 'FIFO') {
          const layers = getFIFO(k); const c = unitCost || (n(m.totalValue, 0) / Math.max(1, qty)); layers.push({ qty, cost: c }); fifo.set(k, layers)
        } else {
          const s = getWA(k); const c = unitCost || s.avgCost || (n(m.totalValue, 0) / Math.max(1, qty))
          const totalVal = s.avgCost * s.qty + c * qty; s.qty += qty; s.avgCost = s.qty > 0 ? totalVal / s.qty : s.avgCost; wa.set(k, s)
        }
      } else {
        if (costMethod === 'FIFO') {
          const layers = getFIFO(k); const { cogs } = takeFromFIFO(layers, qty); fifo.set(k, layers)
          if (t >= start && t <= end) { cogsByItemInPeriod.set(m.itemId, (cogsByItemInPeriod.get(m.itemId) || 0) + cogs); soldUnitsByItemInPeriod.set(m.itemId, (soldUnitsByItemInPeriod.get(m.itemId) || 0) + qty) }
        } else {
          const s = getWA(k); const cogs = qty * s.avgCost; s.qty = Math.max(0, s.qty - qty); wa.set(k, s)
          if (t >= start && t <= end) { cogsByItemInPeriod.set(m.itemId, (cogsByItemInPeriod.get(m.itemId) || 0) + cogs); soldUnitsByItemInPeriod.set(m.itemId, (soldUnitsByItemInPeriod.get(m.itemId) || 0) + qty) }
        }
      }
    }
    const keys = new Set<string>([...wa.keys(), ...fifo.keys()])
    for (const k of keys) {
      const [whId] = k.split('|'); let qty = 0; let avgCostForDisplay = 0; let val = 0
      if (costMethod === 'FIFO') {
        const layers = fifo.get(k) || []; qty = layers.reduce((s, l) => s + l.qty, 0); const totalVal = layers.reduce((s, l) => s + l.qty * l.cost, 0); val = totalVal; avgCostForDisplay = qty > 0 ? totalVal / qty : 0
      } else {
        const s = wa.get(k) || { qty: 0, avgCost: 0 }; qty = s.qty; avgCostForDisplay = s.avgCost; val = s.qty * s.avgCost
      }
      asOfEndQtyByKey.set(k, qty); asOfEndAvgCostByKey.set(k, avgCostForDisplay)
      valuationByWH_AsOfEnd.set(whId, (valuationByWH_AsOfEnd.get(whId) || 0) + val)
    }
    return { valuationByWH_AsOfEnd, asOfEndQtyByKey, asOfEndAvgCostByKey, cogsByItemInPeriod, soldUnitsByItemInPeriod }
  }, [moves, period.startMs, period.endMs, costMethod])

  /* ---------- valuation from snapshot ---------- */
  const valuationCurrent = useMemo(() => {
    const byWH = new Map<string, number>()
    const byBin = new Map<string, number>()
    const byItem = new Map<string, number>()
    let total = 0
    for (const s of levels) {
      const qty = n(s.onHandQty, 0); const cost = n(s.avgCost, 0); const val = qty * cost
      if (val === 0) continue
      total += val
      byItem.set(s.itemId, (byItem.get(s.itemId) || 0) + val)
      byWH.set(s.warehouseId, (byWH.get(s.warehouseId) || 0) + val)
      const keyBin = `${s.warehouseId}|${s.binId || ''}`
      byBin.set(keyBin, (byBin.get(keyBin) || 0) + val)
    }
    return { total, byWH, byBin, byItem }
  }, [levels])

  /* ---------- units in/out & begin/end ---------- */
  const unitsByItem = useMemo(() => {
    const sold = new Map<string, number>(); const received = new Map<string, number>()
    for (const m of period.inRange) {
      const nt = normalizeType(m.type, m.qtyBase ?? m.qty); const qty = Math.abs(n(m.qtyBase ?? m.qty, 0))
      if (nt === 'OUT') sold.set(m.itemId, (sold.get(m.itemId) || 0) + qty)
      if (nt === 'IN') received.set(m.itemId, (received.get(m.itemId) || 0) + qty)
      if (nt === 'ADJ') {
        if (n(m.qtyBase ?? m.qty, 0) > 0) received.set(m.itemId, (received.get(m.itemId) || 0) + qty)
        else sold.set(m.itemId, (sold.get(m.itemId) || 0) + qty)
      }
    }
    return { sold, received }
  }, [period.inRange])

  const beginUnitsByItem = useMemo(() => {
    const endUnits = new Map<string, number>()
    for (const s of levels) endUnits.set(s.itemId, (endUnits.get(s.itemId) || 0) + n(s.onHandQty, 0))
    const begin = new Map<string, number>()
    const allIds = new Set<string>([...endUnits.keys(), ...unitsByItem.sold.keys(), ...unitsByItem.received.keys()])
    for (const id of allIds) {
      const end = endUnits.get(id) || 0; const sold = unitsByItem.sold.get(id) || 0; const rec = unitsByItem.received.get(id) || 0
      const b = Math.max(0, end + sold - rec); begin.set(id, b)
    }
    return { begin, end: endUnits }
  }, [levels, unitsByItem])

  /* ---------- turnover ---------- */
  const turnoverPerItem = useMemo(() => {
    const days = Math.max(1, Math.round((period.endMs - period.startMs) / (1000 * 60 * 60 * 24)) + 1)
    const rows: Array<{
      itemId: string; name: string; sku: string
      sold: number; beginUnits: number; endUnits: number; avgUnits: number
      turns: number; avgDaysToSell: number | null; cogs?: number
    }> = []
    const allIds = new Set<string>([...beginUnitsByItem.begin.keys(), ...beginUnitsByItem.end.keys(), ...unitsByItem.sold.keys()])
    for (const id of allIds) {
      const it = itemById.get(id); if (!it) continue
      const sold = unitsByItem.sold.get(id) || 0
      const b = beginUnitsByItem.begin.get(id) || 0
      const e = beginUnitsByItem.end.get(id) || 0
      const avg = (b + e) / 2
      const turns = avg > 0 ? sold / avg : 0
      const dailySold = days > 0 ? sold / days : 0
      const avgDays = dailySold > 0 ? avg / dailySold : null
      rows.push({
        itemId: id, name: it.name, sku: it.sku,
        sold, beginUnits: b, endUnits: e, avgUnits: avg, turns, avgDaysToSell: avgDays,
        cogs: valuationEngine.cogsByItemInPeriod.get(id) || 0,
      })
    }
    rows.sort((a, b) => b.turns - a.turns)
    return { daysInPeriod: days, rows }
  }, [period, unitsByItem, beginUnitsByItem, itemById, valuationEngine.cogsByItemInPeriod])

  const turnoverSummary = useMemo(() => {
    const rows = turnoverPerItem.rows; const days = turnoverPerItem.daysInPeriod
    const totalSold = rows.reduce((s, r) => s + r.sold, 0)
    const totalBegin = rows.reduce((s, r) => s + r.beginUnits, 0)
    const totalEnd = rows.reduce((s, r) => s + r.endUnits, 0)
    const avgInv = (totalBegin + totalEnd) / 2
    const turns = avgInv > 0 ? totalSold / avgInv : 0
    const dailySold = days > 0 ? totalSold / days : 0
    const avgDaysToSell = dailySold > 0 ? (avgInv / dailySold) : null
    const currentVal = valuationCurrent.total
    const totalCOGS = Array.from(valuationEngine.cogsByItemInPeriod.values()).reduce((s, v) => s + v, 0)
    return { totalSold, avgInv, turns, avgDaysToSell, days, currentVal, totalCOGS }
  }, [turnoverPerItem, valuationCurrent, valuationEngine.cogsByItemInPeriod])

  /* ---------- best/worst ---------- */
  const bestWorst = useMemo(() => {
    const arr = Array.from(valuationEngine.soldUnitsByItemInPeriod.entries())
      .map(([id, qty]) => ({ id, qty, item: itemById.get(id) }))
      .filter(r => !!r.item)
    if (arr.length === 0) return { best: null, worst: null, zeroSales: items.length }
    arr.sort((a, b) => b.qty - a.qty)
    return { best: { item: arr[0].item, qty: arr[0].qty }, worst: { item: arr[arr.length - 1].item, qty: arr[arr.length - 1].qty }, zeroSales: items.length - arr.length }
  }, [valuationEngine.soldUnitsByItemInPeriod, itemById, items.length])

  /* ---------- aging ---------- */
  const aging = useMemo(() => {
    const lastReceipt = new Map<string, number>()
    for (const m of moves) {
      const nt = normalizeType(m.type, m.qtyBase ?? m.qty)
      if (nt !== 'IN') continue
      const t = getTime(m); const prev = lastReceipt.get(m.itemId)
      if (!prev || t > prev) lastReceipt.set(m.itemId, t)
    }
    const buckets = [
      { key: '0-30', min: 0, max: 30 },
      { key: '31-60', min: 31, max: 60 },
      { key: '61-90', min: 61, max: 90 },
      { key: '91-180', min: 91, max: 180 },
      { key: '181+', min: 181, max: 100000 },
    ] as const
    type Row = { qty: number; value: number; byBucket: Record<string, { qty: number; value: number }> }
    const byWH = new Map<string, Row>(); const byBin = new Map<string, Row>()
    const now = Date.now()
    function add(map: Map<string, Row>, key: string, ageDays: number, qty: number, val: number) {
      let row = map.get(key)
      if (!row) { row = { qty: 0, value: 0, byBucket: {} as any }; buckets.forEach(b => (row!.byBucket[b.key] = { qty: 0, value: 0 })); map.set(key, row) }
      row.qty += qty; row.value += val
      const b = buckets.find(b => ageDays >= b.min && ageDays <= b.max) || buckets[buckets.length - 1]
      row.byBucket[b.key].qty += qty; row.byBucket[b.key].value += val
    }
    for (const s of levels) {
      const qty = n(s.onHandQty, 0); if (qty <= 0) continue
      const cost = n(s.avgCost, 0); const val = qty * cost
      const lr = lastReceipt.get(s.itemId)
      const ageDays = lr ? Math.max(0, Math.floor((now - lr) / (1000 * 60 * 60 * 24))) : 9999
      add(byWH, s.warehouseId, ageDays, qty, val)
      const keyBin = `${s.warehouseId}|${s.binId || ''}`; add(byBin, keyBin, ageDays, qty, val)
    }
    const rowsWH = Array.from(byWH.entries()).map(([id, r]) => ({ warehouseId: id, warehouseName: whById.get(id)?.name || id, ...r }))
    const rowsBin = Array.from(byBin.entries()).map(([key, r]) => {
      const [wid, bid] = key.split('|'); const whName = whById.get(wid)?.name || wid
      const b = bid ? (binById.get(bid)?.code || bid) : '(no bin)'
      return { warehouseId: wid, binId: bid || null, warehouseName: whName, binCode: b, ...r }
    })
    rowsWH.sort((a, b) => b.value - a.value); rowsBin.sort((a, b) => b.value - a.value)
    return { buckets: buckets.map(b => b.key), rowsWH, rowsBin }
  }, [levels, moves, whById, binById])

  /* ---------- currency options ---------- */
  const currencyOptions = useMemo(() => {
    const codes = new Set<string>(); const list: string[] = []
    if (baseCurrency) { list.push(baseCurrency); codes.add(baseCurrency) }
    for (const c of currencies) { if (!codes.has(c.code)) { list.push(c.code); codes.add(c.code) } }
    return list
  }, [currencies, baseCurrency])

  /* ---------- money text ---------- */
  const moneyText = (x: number) => `${displayCurrency} ${fmtAccounting(x * fxRate, 2)}`

  /* ---------- subtitle (reactive) ---------- */
  useEffect(() => {
    setUi(s => ({ ...s, costMethod }))
  }, [costMethod])
  const subtitle = useMemo(() => 'Inventory Reports', [])
  useEffect(() => { setUi(s => ({ ...s, subtitle, fxNote })) }, [subtitle, fxNote])

  const value: ReportsContextType = {
    // filters & fx
    startDate, endDate, setStartDate, setEndDate,
    costMethod, setCostMethod,
    valuationAsOfEnd, setValuationAsOfEnd,
    baseCurrency, displayCurrency, setDisplayCurrency,
    fxRate, setFxRate, autoFx, setAutoFx,
    fxNote, currencyOptions, lastNDays,

    // data
    warehouses, bins, items, currencies, customers, levels, moves, orders, cashSales,
    ordersUnavailable, cashUnavailable,

    // indexes
    itemById, whById, binById, customerById, moneyText, fmt, fmtAccounting,

    // period
    period,

    // computed
    valuationCurrent,
    valuationEngine,
    turnoverPerItem,
    turnoverSummary,
    bestWorst,
    aging,
    revenueByCustomer,

    // ui
    ui, setUi,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReports() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useReports must be used inside <ReportsProvider>')
  return ctx
}
