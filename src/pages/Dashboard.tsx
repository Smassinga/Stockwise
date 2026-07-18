import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowRight,
  ArrowUpRight,
  Calendar,
  RefreshCw,
} from 'lucide-react'
import { BasketIcon } from '@phosphor-icons/react/dist/csr/Basket'
import { BuildingsIcon } from '@phosphor-icons/react/dist/csr/Buildings'
import { ChartLineUpIcon } from '@phosphor-icons/react/dist/csr/ChartLineUp'
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle'
import { ClockIcon } from '@phosphor-icons/react/dist/csr/Clock'
import { CoinsIcon } from '@phosphor-icons/react/dist/csr/Coins'
import { CurrencyCircleDollarIcon } from '@phosphor-icons/react/dist/csr/CurrencyCircleDollar'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { PackageIcon } from '@phosphor-icons/react/dist/csr/Package'
import { TrendDownIcon } from '@phosphor-icons/react/dist/csr/TrendDown'
import { TrendUpIcon } from '@phosphor-icons/react/dist/csr/TrendUp'
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { WarningIcon } from '@phosphor-icons/react/dist/csr/Warning'
import { supabase } from '../lib/supabase'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { useOrg } from '../hooks/useOrg'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import {
  allocateTotalByWeights,
  dashboardCostKey,
  resolveMovementCost,
  summarizeCostCoverage,
  valuesReconcile,
  type DashboardCostState,
} from '../lib/dashboardMetrics'
import { cn } from '../lib/utils'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet'
import { MobileCardList } from '../components/premium/MobileCardList'
import { MobileQuickActionGroup } from '../components/premium/MobileQuickActionGroup'
import { MobileWorkflowHeader } from '../components/premium/MobileWorkflowHeader'
import { PremiumActionCard } from '../components/premium/PremiumActionCard'
import { PremiumChartCard } from '../components/premium/PremiumChartCard'
import { PremiumEmptyState, PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumMetricCard } from '../components/premium/PremiumMetricCard'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { PremiumSection } from '../components/premium/PremiumSection'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'

type Item = {
  id: string
  name: string
  sku: string
  minStock: number | null
  trackInventory: boolean
}

type StockRow = {
  id: string
  item_id: string
  warehouse_id: string
  bin_id: string | null
  qty: number | null
  avg_cost: number | null
}

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
}

type SalesOrder = {
  id: string
  customer_id: string | null
  status: string
  fx_to_base: number | null
  total_amount: number | null
  updated_at: string | null
  created_at: string | null
}

type SalesOrderLine = {
  so_id: string
  item_id: string
  line_total: number | null
}

type Shipment = {
  id: string
  so_id: string | null
  item_id: string
  qty_base: number | null
  created_at: string
  movement_id: string | null
}

type MovementCostRow = {
  id: string
  qty_base: number | null
  unit_cost: number | null
  total_value: number | null
}

type Customer = { id: string; name: string; is_cash: boolean }
type Warehouse = { id: string; name: string }

type LoadPhase = 'idle' | 'loading' | 'ready' | 'error'
type LoadState = {
  phase: LoadPhase
  stale: boolean
  updatedAt: number | null
}

type ProductPerformance = {
  itemId: string
  name: string
  sku: string
  revenue: number
  knownCogs: number
  margin: number | null
  marginPct: number | null
  costState: DashboardCostState
}

type DailyPerformance = {
  date: string
  label: string
  revenue: number
  cogs: number | null
  knownCogs: number
  margin: number | null
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const SHIPPED_STATUSES = new Set(['shipped', 'completed', 'delivered', 'closed'])

const finiteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const shippedLike = (status: string) => SHIPPED_STATUSES.has(String(status).toLowerCase())

const localDayStart = (value: Date) => {
  const next = new Date(value)
  next.setHours(0, 0, 0, 0)
  return next.getTime()
}

const toLocalISODate = (value: number | Date) => {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const chunksOf = <T,>(values: T[], size = 100) => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

const initialLoadState: LoadState = { phase: 'idle', stale: false, updatedAt: null }

export default function Dashboard() {
  const { t, lang } = useI18n()
  const { companyId, companyName } = useOrg()
  const navigate = useNavigate()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)

  const [baseCode, setBaseCode] = useState('MZN')
  const [warehouseId, setWarehouseId] = useState('ALL')
  const [windowDays, setWindowDays] = useState(30)
  const [dailyOpen, setDailyOpen] = useState(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [coreState, setCoreState] = useState<LoadState>(initialLoadState)
  const [performanceState, setPerformanceState] = useState<LoadState>(initialLoadState)
  const [customerState, setCustomerState] = useState<LoadState>(initialLoadState)

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [orderLines, setOrderLines] = useState<SalesOrderLine[]>([])
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [movementCosts, setMovementCosts] = useState<Map<string, MovementCostRow>>(new Map())
  const [customers, setCustomers] = useState<Map<string, Customer>>(new Map())

  const refresh = useCallback(() => setRefreshRevision(value => value + 1), [])
  const anchorMs = useMemo(() => Date.now(), [companyId, windowDays, refreshRevision])
  const currentStartMs = useMemo(
    () => localDayStart(new Date(anchorMs)) - (windowDays - 1) * MS_PER_DAY,
    [anchorMs, windowDays],
  )
  const periodEndExclusiveMs = useMemo(() => localDayStart(new Date(anchorMs)) + MS_PER_DAY, [anchorMs])
  const previousStartMs = useMemo(() => currentStartMs - windowDays * MS_PER_DAY, [currentStartMs, windowDays])
  const previousStartISO = useMemo(() => new Date(previousStartMs).toISOString(), [previousStartMs])
  const periodEndExclusiveISO = useMemo(() => new Date(periodEndExclusiveMs).toISOString(), [periodEndExclusiveMs])

  const money = useCallback(
    (amount: number) => formatMoneyBase(amount, baseCode, lang === 'pt' ? 'pt-MZ' : 'en-MZ'),
    [baseCode, lang],
  )
  const formatCount = useCallback((amount: number) => new Intl.NumberFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
    maximumFractionDigits: 2,
  }).format(amount), [lang])
  const formatCompactMoney = useCallback((amount: number) => new Intl.NumberFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount), [lang])
  const formatDate = useCallback((value: string | number) => new Intl.DateTimeFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
    day: '2-digit',
    month: 'short',
  }).format(new Date(value)), [lang])
  const formatDateTime = useCallback((value: string) => new Intl.DateTimeFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value)), [lang])

  useEffect(() => {
    let cancelled = false

    async function loadCore() {
      if (!companyId) {
        setWarehouses([])
        setItems([])
        setStock([])
        setMovements([])
        setCoreState({ phase: 'ready', stale: false, updatedAt: Date.now() })
        return
      }

      setCoreState(previous => ({ ...previous, phase: 'loading' }))
      try {
        const [base, warehouseResult, itemResult, stockResult, movementResult] = await Promise.all([
          getBaseCurrencyCode(companyId),
          supabase.from('warehouses').select('id,name').eq('company_id', companyId).order('name'),
          supabase.from('items').select('id,sku,name,min_stock,track_inventory').eq('company_id', companyId),
          supabase.from('stock_levels').select('id,item_id,warehouse_id,bin_id,qty,avg_cost').eq('company_id', companyId),
          supabase
            .from('stock_movements')
            .select('id,item_id,qty_base,type,created_at,unit_cost,total_value,warehouse_from_id,warehouse_to_id')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(3),
        ])

        const firstError = warehouseResult.error || itemResult.error || stockResult.error || movementResult.error
        if (firstError) throw firstError
        if (cancelled) return

        setBaseCode(base || 'MZN')
        setWarehouses((warehouseResult.data || []) as Warehouse[])
        setItems((itemResult.data || []).map(row => ({
          id: row.id,
          name: row.name,
          sku: row.sku || '',
          minStock: row.min_stock === null ? null : finiteNumber(row.min_stock),
          trackInventory: row.track_inventory !== false,
        })))
        setStock((stockResult.data || []) as StockRow[])
        setMovements((movementResult.data || []) as MovementRow[])
        setCoreState({ phase: 'ready', stale: false, updatedAt: Date.now() })
      } catch (error) {
        console.error('Dashboard core read failed', error)
        if (!cancelled) {
          setCoreState(previous => ({
            phase: 'error',
            stale: previous.updatedAt !== null,
            updatedAt: previous.updatedAt,
          }))
        }
      }
    }

    void loadCore()
    return () => { cancelled = true }
  }, [companyId, refreshRevision])

  useEffect(() => {
    let cancelled = false

    async function loadPerformance() {
      if (!companyId) {
        setOrders([])
        setOrderLines([])
        setShipments([])
        setMovementCosts(new Map())
        setCustomers(new Map())
        setPerformanceState({ phase: 'ready', stale: false, updatedAt: Date.now() })
        setCustomerState({ phase: 'ready', stale: false, updatedAt: Date.now() })
        return
      }

      setPerformanceState(previous => ({ ...previous, phase: 'loading' }))
      setCustomerState(previous => ({ ...previous, phase: 'loading' }))
      try {
        const [updatedResult, createdResult] = await Promise.all([
          supabase
            .from('sales_orders')
            .select('id,customer_id,status,fx_to_base,total_amount,updated_at,created_at')
            .eq('company_id', companyId)
            .gte('updated_at', previousStartISO)
            .lt('updated_at', periodEndExclusiveISO)
            .limit(2000),
          supabase
            .from('sales_orders')
            .select('id,customer_id,status,fx_to_base,total_amount,updated_at,created_at')
            .eq('company_id', companyId)
            .is('updated_at', null)
            .gte('created_at', previousStartISO)
            .lt('created_at', periodEndExclusiveISO)
            .limit(2000),
        ])
        if (updatedResult.error) throw updatedResult.error
        if (createdResult.error) throw createdResult.error

        const merged = new Map<string, SalesOrder>()
        for (const order of (updatedResult.data || []) as SalesOrder[]) merged.set(order.id, order)
        for (const order of (createdResult.data || []) as SalesOrder[]) merged.set(order.id, order)
        const shippedOrders = Array.from(merged.values()).filter(order => shippedLike(order.status))
        const orderIds = shippedOrders.map(order => order.id)

        const lineRows: SalesOrderLine[] = []
        const shipmentRows: Shipment[] = []
        for (const ids of chunksOf(orderIds)) {
          const [lineResult, shipmentResult] = await Promise.all([
            supabase
              .from('sales_order_lines')
              .select('so_id,item_id,line_total')
              .eq('company_id', companyId)
              .in('so_id', ids),
            supabase
              .from('sales_shipments')
              .select('id,so_id,item_id,qty_base,created_at,movement_id')
              .eq('company_id', companyId)
              .in('so_id', ids),
          ])
          if (lineResult.error) throw lineResult.error
          if (shipmentResult.error) throw shipmentResult.error
          lineRows.push(...((lineResult.data || []) as SalesOrderLine[]))
          shipmentRows.push(...((shipmentResult.data || []) as Shipment[]))
        }

        const movementIds = Array.from(new Set(shipmentRows.map(row => row.movement_id).filter(Boolean))) as string[]
        const movementMap = new Map<string, MovementCostRow>()
        for (const ids of chunksOf(movementIds)) {
          const movementResult = await supabase
            .from('stock_movements')
            .select('id,qty_base,unit_cost,total_value')
            .eq('company_id', companyId)
            .eq('ref_type', 'SO')
            .eq('type', 'issue')
            .in('id', ids)
          if (movementResult.error) throw movementResult.error
          for (const movement of (movementResult.data || []) as MovementCostRow[]) movementMap.set(movement.id, movement)
        }

        if (cancelled) return
        setOrders(shippedOrders)
        setOrderLines(lineRows)
        setShipments(shipmentRows)
        setMovementCosts(movementMap)
        setPerformanceState({ phase: 'ready', stale: false, updatedAt: Date.now() })

        const customerIds = Array.from(new Set(shippedOrders.map(order => order.customer_id).filter(Boolean))) as string[]
        const customerMap = new Map<string, Customer>()
        let customerReadFailed = false
        for (const ids of chunksOf(customerIds)) {
          const customerResult = await supabase
            .from('customers')
            .select('id,name,is_cash')
            .eq('company_id', companyId)
            .in('id', ids)
          if (customerResult.error) {
            customerReadFailed = true
            console.error('Dashboard customer read failed', customerResult.error)
            break
          }
          for (const customer of (customerResult.data || []) as Customer[]) customerMap.set(customer.id, customer)
        }
        if (!cancelled) {
          if (customerReadFailed) {
            setCustomerState(previous => ({ phase: 'error', stale: previous.updatedAt !== null, updatedAt: previous.updatedAt }))
          } else {
            setCustomers(customerMap)
            setCustomerState({ phase: 'ready', stale: false, updatedAt: Date.now() })
          }
        }
      } catch (error) {
        console.error('Dashboard performance read failed', error)
        if (!cancelled) {
          setPerformanceState(previous => ({ phase: 'error', stale: previous.updatedAt !== null, updatedAt: previous.updatedAt }))
          setCustomerState(previous => ({ phase: 'error', stale: previous.updatedAt !== null, updatedAt: previous.updatedAt }))
        }
      }
    }

    void loadPerformance()
    return () => { cancelled = true }
  }, [companyId, periodEndExclusiveISO, previousStartISO])

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
  const selectedWarehouse = useMemo(
    () => warehouses.find(warehouse => warehouse.id === warehouseId),
    [warehouseId, warehouses],
  )
  const stockInScope = useMemo(
    () => warehouseId === 'ALL' ? stock : stock.filter(row => row.warehouse_id === warehouseId),
    [stock, warehouseId],
  )

  const orderActivityMs = useCallback((order: SalesOrder) => {
    const source = order.updated_at || order.created_at
    const parsed = source ? new Date(source).getTime() : Number.NaN
    return Number.isFinite(parsed) ? parsed : null
  }, [])

  const currentOrders = useMemo(() => orders.filter(order => {
    const activity = orderActivityMs(order)
    return activity !== null && activity >= currentStartMs && activity < periodEndExclusiveMs
  }), [currentStartMs, orderActivityMs, orders, periodEndExclusiveMs])
  const previousOrders = useMemo(() => orders.filter(order => {
    const activity = orderActivityMs(order)
    return activity !== null && activity >= previousStartMs && activity < currentStartMs
  }), [currentStartMs, orderActivityMs, orders, previousStartMs])
  const currentOrderIds = useMemo(() => new Set(currentOrders.map(order => order.id)), [currentOrders])
  const previousOrderIds = useMemo(() => new Set(previousOrders.map(order => order.id)), [previousOrders])
  const currentShipments = useMemo(
    () => shipments.filter(shipment => shipment.so_id && currentOrderIds.has(shipment.so_id)),
    [currentOrderIds, shipments],
  )
  const previousShipments = useMemo(
    () => shipments.filter(shipment => shipment.so_id && previousOrderIds.has(shipment.so_id)),
    [previousOrderIds, shipments],
  )

  const orderRevenue = useMemo(() => {
    const lineTotals = new Map<string, number>()
    const fxByOrder = new Map(orders.map(order => [order.id, finiteNumber(order.fx_to_base, 1)]))
    for (const line of orderLines) {
      lineTotals.set(line.so_id, (lineTotals.get(line.so_id) || 0) + finiteNumber(line.line_total) * (fxByOrder.get(line.so_id) || 1))
    }
    return new Map(orders.map(order => [
      order.id,
      order.total_amount === null || order.total_amount === undefined
        ? lineTotals.get(order.id) || 0
        : finiteNumber(order.total_amount) * finiteNumber(order.fx_to_base, 1),
    ]))
  }, [orderLines, orders])

  const currentRevenue = useMemo(
    () => currentOrders.reduce((sum, order) => sum + (orderRevenue.get(order.id) || 0), 0),
    [currentOrders, orderRevenue],
  )
  const previousRevenue = useMemo(
    () => previousOrders.reduce((sum, order) => sum + (orderRevenue.get(order.id) || 0), 0),
    [orderRevenue, previousOrders],
  )

  const currentExpectedItems = useMemo(() => {
    const ids = new Set(orderLines
      .filter(line => currentOrderIds.has(line.so_id))
      .map(line => dashboardCostKey(line.so_id, line.item_id)))
    for (const order of currentOrders) {
      const hasLine = orderLines.some(line => line.so_id === order.id)
      const hasShipment = currentShipments.some(shipment => shipment.so_id === order.id)
      if (!hasLine && !hasShipment) ids.add(dashboardCostKey(order.id, `unattributed:${order.id}`))
    }
    return ids
  }, [currentOrderIds, currentOrders, currentShipments, orderLines])
  const previousExpectedItems = useMemo(() => {
    const ids = new Set(orderLines
      .filter(line => previousOrderIds.has(line.so_id))
      .map(line => dashboardCostKey(line.so_id, line.item_id)))
    for (const order of previousOrders) {
      const hasLine = orderLines.some(line => line.so_id === order.id)
      const hasShipment = previousShipments.some(shipment => shipment.so_id === order.id)
      if (!hasLine && !hasShipment) ids.add(dashboardCostKey(order.id, `unattributed:${order.id}`))
    }
    return ids
  }, [orderLines, previousOrderIds, previousOrders, previousShipments])

  const currentCostCoverage = useMemo(
    () => summarizeCostCoverage(currentShipments, movementCosts, currentExpectedItems),
    [currentExpectedItems, currentShipments, movementCosts],
  )
  const previousCostCoverage = useMemo(
    () => summarizeCostCoverage(previousShipments, movementCosts, previousExpectedItems),
    [movementCosts, previousExpectedItems, previousShipments],
  )
  const costComplete = currentCostCoverage.state === 'supported' || currentCostCoverage.state === 'explicit_zero'
  const previousCostComplete = previousCostCoverage.state === 'supported' || previousCostCoverage.state === 'explicit_zero'
  const currentCogs = currentCostCoverage.knownAmount
  const previousCogs = previousCostCoverage.knownAmount
  const grossMargin = costComplete ? currentRevenue - currentCogs : null
  const previousMargin = previousCostComplete ? previousRevenue - previousCogs : null
  const grossMarginPct = grossMargin !== null && currentRevenue > 0 ? grossMargin / currentRevenue : null

  const inventoryCoverage = useMemo(() => {
    let knownValue = 0
    let missing = 0
    let explicitZero = 0
    let supported = 0
    for (const row of stockInScope) {
      const quantity = finiteNumber(row.qty)
      if (quantity === 0) continue
      if (row.avg_cost === null || row.avg_cost === undefined || !Number.isFinite(Number(row.avg_cost))) {
        missing += 1
        continue
      }
      const averageCost = Number(row.avg_cost)
      knownValue += quantity * averageCost
      supported += 1
      if (averageCost === 0) explicitZero += 1
    }
    const state: DashboardCostState = missing > 0 && supported > 0
      ? 'partial'
      : missing > 0
        ? 'unavailable'
        : supported > 0 && explicitZero === supported
          ? 'explicit_zero'
          : supported > 0
            ? 'supported'
            : 'not_applicable'
    return { knownValue, missing, state }
  }, [stockInScope])

  const lowStockRows = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of stockInScope) totals.set(row.item_id, (totals.get(row.item_id) || 0) + finiteNumber(row.qty))
    return items
      .filter(item => item.trackInventory && item.minStock !== null)
      .map(item => {
        const onHand = totals.get(item.id) || 0
        const minimum = item.minStock || 0
        const shortage = Math.max(0, minimum - onHand)
        const ratio = minimum > 0 ? onHand / minimum : 1
        const severity = onHand <= 0 ? 'critical' : ratio <= 0.5 ? 'high' : 'medium'
        return { item, onHand, minimum, shortage, severity }
      })
      .filter(row => row.onHand < row.minimum)
      .sort((left, right) => {
        const ranks = { critical: 0, high: 1, medium: 2 }
        return ranks[left.severity] - ranks[right.severity] || right.shortage - left.shortage
      })
  }, [items, stockInScope])
  const missingMinimumCount = useMemo(
    () => items.filter(item => item.trackInventory && item.minStock === null).length,
    [items],
  )

  const productPerformance = useMemo<ProductPerformance[]>(() => {
    const revenueByItem = new Map<string, number>()
    const knownCostByItem = new Map<string, number>()
    const availableCostCount = new Map<string, number>()
    const missingCostCount = new Map<string, number>()
    const explicitZeroCount = new Map<string, number>()
    const currentLines = orderLines.filter(line => currentOrderIds.has(line.so_id))
    const expectedPairs = new Map<string, string>()
    for (const line of currentLines) expectedPairs.set(dashboardCostKey(line.so_id, line.item_id), line.item_id)
    const shippedPairs = new Set(currentShipments.map(shipment => dashboardCostKey(shipment.so_id || 'unscoped', shipment.item_id)))

    for (const order of currentOrders) {
      const total = orderRevenue.get(order.id) || 0
      const lines = currentLines.filter(line => line.so_id === order.id)
      const lineWeights = new Map<string, number>()
      for (const line of lines) {
        const fx = finiteNumber(order.fx_to_base, 1)
        lineWeights.set(line.item_id, (lineWeights.get(line.item_id) || 0) + finiteNumber(line.line_total) * fx)
      }
      if (lineWeights.size === 0) {
        for (const shipment of currentShipments.filter(row => row.so_id === order.id)) {
          lineWeights.set(shipment.item_id, (lineWeights.get(shipment.item_id) || 0) + Math.abs(finiteNumber(shipment.qty_base)))
        }
      }
      if (lineWeights.size === 0) lineWeights.set(`unattributed:${order.id}`, 1)
      for (const [itemId, value] of allocateTotalByWeights(total, lineWeights)) {
        revenueByItem.set(itemId, (revenueByItem.get(itemId) || 0) + value)
      }
    }

    for (const shipment of currentShipments) {
      const movement = shipment.movement_id ? movementCosts.get(shipment.movement_id) : undefined
      const evidence = resolveMovementCost(movement, shipment.qty_base)
      if (!evidence.available) {
        missingCostCount.set(shipment.item_id, (missingCostCount.get(shipment.item_id) || 0) + 1)
        continue
      }
      knownCostByItem.set(shipment.item_id, (knownCostByItem.get(shipment.item_id) || 0) + evidence.amount)
      availableCostCount.set(shipment.item_id, (availableCostCount.get(shipment.item_id) || 0) + 1)
      if (evidence.explicitZero) explicitZeroCount.set(shipment.item_id, (explicitZeroCount.get(shipment.item_id) || 0) + 1)
    }

    for (const [costKey, itemId] of expectedPairs) {
      if (!shippedPairs.has(costKey)) missingCostCount.set(itemId, (missingCostCount.get(itemId) || 0) + 1)
    }

    const itemIds = new Set([...revenueByItem.keys(), ...knownCostByItem.keys(), ...missingCostCount.keys()])
    return Array.from(itemIds).map(itemId => {
      const item = itemById.get(itemId)
      const revenue = revenueByItem.get(itemId) || 0
      const knownCogs = knownCostByItem.get(itemId) || 0
      const available = availableCostCount.get(itemId) || 0
      let missing = missingCostCount.get(itemId) || 0
      if (revenue > 0 && available === 0 && missing === 0) missing = 1
      const explicitZero = explicitZeroCount.get(itemId) || 0
      const costState: DashboardCostState = missing > 0 && available > 0
        ? 'partial'
        : missing > 0
          ? 'unavailable'
          : available > 0 && explicitZero === available
            ? 'explicit_zero'
            : available > 0
              ? 'supported'
              : 'not_applicable'
      const complete = costState === 'supported' || costState === 'explicit_zero'
      const margin = complete ? revenue - knownCogs : null
      return {
        itemId,
        name: item?.name || tt('dashboard.unknownItem', 'Unknown item'),
        sku: item?.sku || t('common.dash'),
        revenue,
        knownCogs,
        margin,
        marginPct: margin !== null && revenue > 0 ? margin / revenue : null,
        costState,
      }
    }).sort((left, right) => {
      if (left.margin === null && right.margin !== null) return 1
      if (left.margin !== null && right.margin === null) return -1
      if (left.margin !== null && right.margin !== null && right.margin !== left.margin) return right.margin - left.margin
      return right.revenue - left.revenue
    }).slice(0, 10)
  }, [currentOrderIds, currentOrders, currentShipments, itemById, movementCosts, orderLines, orderRevenue, t])

  const dailyPerformance = useMemo<DailyPerformance[]>(() => {
    const rows = new Map<string, DailyPerformance>()
    for (let day = currentStartMs; day < periodEndExclusiveMs; day += MS_PER_DAY) {
      const date = toLocalISODate(day)
      rows.set(date, { date, label: formatDate(day), revenue: 0, cogs: 0, knownCogs: 0, margin: 0 })
    }

    for (const order of currentOrders) {
      const activity = orderActivityMs(order)
      if (activity === null) continue
      const date = toLocalISODate(activity)
      const row = rows.get(date)
      if (!row) continue
      row.revenue += orderRevenue.get(order.id) || 0
      const orderShipments = currentShipments.filter(shipment => shipment.so_id === order.id)
      const expectedItems = new Set(orderLines
        .filter(line => line.so_id === order.id)
        .map(line => dashboardCostKey(order.id, line.item_id)))
      if (expectedItems.size === 0 && orderShipments.length === 0) {
        expectedItems.add(dashboardCostKey(order.id, `unattributed:${order.id}`))
      }
      const coverage = summarizeCostCoverage(orderShipments, movementCosts, expectedItems)
      row.knownCogs += coverage.knownAmount
      if (coverage.state !== 'supported' && coverage.state !== 'explicit_zero') row.cogs = null
      else if (row.cogs !== null) row.cogs += coverage.knownAmount
    }

    for (const row of rows.values()) row.margin = row.cogs === null ? null : row.revenue - row.cogs
    return Array.from(rows.values())
  }, [currentOrders, currentShipments, currentStartMs, formatDate, movementCosts, orderActivityMs, orderLines, orderRevenue, periodEndExclusiveMs])

  const chartRevenueTotal = useMemo(() => dailyPerformance.reduce((sum, row) => sum + row.revenue, 0), [dailyPerformance])
  const chartKnownCogsTotal = useMemo(() => dailyPerformance.reduce((sum, row) => sum + row.knownCogs, 0), [dailyPerformance])
  const reconciled = valuesReconcile(chartRevenueTotal, currentRevenue) && valuesReconcile(chartKnownCogsTotal, currentCogs)

  const topClient = useMemo(() => {
    if (customerState.phase !== 'ready' && !customerState.stale) return null
    const totals = new Map<string, number>()
    for (const order of currentOrders) {
      if (!order.customer_id) continue
      const customer = customers.get(order.customer_id)
      if (!customer || customer.is_cash) continue
      totals.set(order.customer_id, (totals.get(order.customer_id) || 0) + (orderRevenue.get(order.id) || 0))
    }
    const first = Array.from(totals.entries()).sort((left, right) => right[1] - left[1])[0]
    if (!first) return null
    const [customerId, revenue] = first
    const customer = customers.get(customerId)
    return {
      name: customer?.name || tt('dashboard.unknownCustomer', 'Unknown customer'),
      revenue,
      share: currentRevenue > 0 ? revenue / currentRevenue : null,
    }
  }, [currentOrders, currentRevenue, customerState, customers, orderRevenue, t])

  const currentWindowLabel = tt('dashboard.scopeDates', '{start} to {end}', {
    start: formatDate(currentStartMs),
    end: formatDate(periodEndExclusiveMs - 1),
  })
  const warehouseLabel = warehouseId === 'ALL' ? t('filters.warehouse.all') : selectedWarehouse?.name || t('filters.warehouse.label')
  const performanceHasData = currentOrders.length > 0 || currentShipments.length > 0
  const hasOperationalData = items.length > 0 || stock.length > 0 || movements.length > 0 || performanceHasData
  const coreUnavailable = coreState.phase === 'error' && !coreState.stale
  const performanceUnavailable = performanceState.phase === 'error' && !performanceState.stale
  const staleData = coreState.stale || performanceState.stale
  const initialLoading = (coreState.phase === 'idle' || coreState.phase === 'loading') && coreState.updatedAt === null
  const performanceInitialLoading = (performanceState.phase === 'idle' || performanceState.phase === 'loading') && performanceState.updatedAt === null
  const refreshing = coreState.phase === 'loading' || performanceState.phase === 'loading'
  const marginNegative = grossMargin !== null && grossMargin < 0
  const costNeedsReview = performanceHasData && !costComplete
  const inventoryNeedsReview = inventoryCoverage.state === 'partial' || inventoryCoverage.state === 'unavailable'

  const urgentActionCount = lowStockRows.length
    + missingMinimumCount
    + (costNeedsReview ? 1 : 0)
    + (inventoryNeedsReview ? 1 : 0)
    + (marginNegative ? 1 : 0)
    + (coreUnavailable || performanceUnavailable || staleData ? 1 : 0)

  const statusMeta = useMemo(() => {
    if (coreUnavailable || performanceUnavailable) return {
      tone: 'critical' as PremiumTone,
      label: tt('dashboard.statusUnavailable', 'Data unavailable'),
      summary: tt('dashboard.statusUnavailableHelp', 'One or more dashboard reads failed. Retry before making an operating decision.'),
      icon: <WarningCircleIcon weight="duotone" />,
    }
    if (staleData) return {
      tone: 'warning' as PremiumTone,
      label: tt('dashboard.statusStale', 'Showing last known data'),
      summary: tt('dashboard.statusStaleHelp', 'A refresh failed. Values are retained but must be treated as stale until the next successful read.'),
      icon: <ClockIcon weight="duotone" />,
    }
    if (!hasOperationalData) return {
      tone: 'neutral' as PremiumTone,
      label: tt('dashboard.statusSetup', 'Setup needed'),
      summary: tt('dashboard.statusSetupHelp', 'Add operating data and review Point of Sale readiness before relying on this cockpit.'),
      icon: <PackageIcon weight="duotone" />,
    }
    if (lowStockRows.some(row => row.severity === 'critical') || marginNegative) return {
      tone: 'critical' as PremiumTone,
      label: tt('dashboard.statusCritical', 'Immediate review needed'),
      summary: tt('dashboard.statusCriticalHelp', 'Critical stock or performance evidence needs attention before routine follow-up.'),
      icon: <WarningCircleIcon weight="duotone" />,
    }
    if (urgentActionCount > 0) return {
      tone: 'warning' as PremiumTone,
      label: tt('dashboard.statusAttention', 'Attention needed'),
      summary: tt('dashboard.statusAttentionHelp', 'The cockpit has specific stock, setup, or cost-evidence actions to review.'),
      icon: <WarningIcon weight="duotone" />,
    }
    return {
      tone: 'positive' as PremiumTone,
      label: tt('dashboard.statusHealthy', 'Operating normally'),
      summary: tt('dashboard.statusHealthyHelp', 'No urgent exception is visible in the current company, warehouse, and period scope.'),
      icon: <CheckCircleIcon weight="duotone" />,
    }
  }, [coreUnavailable, hasOperationalData, lowStockRows, marginNegative, performanceUnavailable, staleData, t, urgentActionCount])

  const primaryAction = useMemo(() => {
    if (coreUnavailable || performanceUnavailable || staleData) return {
      label: tt('dashboard.retryData', 'Retry dashboard data'),
      help: tt('dashboard.retryDataHelp', 'Refresh the current company scope before acting on incomplete information.'),
      action: refresh,
    }
    if (lowStockRows.length > 0) return {
      label: tt('dashboard.reviewLowStock', 'Review low stock'),
      help: tt('dashboard.reviewLowStockHelp', 'Open current stock quantities and replenishment evidence.'),
      action: () => navigate('/stock-levels'),
    }
    if (costNeedsReview || inventoryNeedsReview) return {
      label: tt('dashboard.reviewCostEvidence', 'Review cost evidence'),
      help: tt('dashboard.reviewCostEvidenceHelp', 'Inspect stock movement cost records before using margin for a decision.'),
      action: () => navigate('/movements'),
    }
    if (!hasOperationalData || missingMinimumCount > 0) return {
      label: tt('dashboard.reviewItems', 'Review item setup'),
      help: tt('dashboard.reviewItemsHelp', 'Complete item and minimum-stock setup, then check Point of Sale readiness.'),
      action: () => navigate('/items'),
    }
    return {
      label: tt('dashboard.reviewMovements', 'Review latest movements'),
      help: tt('dashboard.reviewMovementsHelp', 'Continue into the stock ledger for detailed operating evidence.'),
      action: () => navigate('/movements'),
    }
  }, [coreUnavailable, costNeedsReview, hasOperationalData, inventoryNeedsReview, lowStockRows.length, missingMinimumCount, navigate, performanceUnavailable, refresh, staleData, t])

  const costStateCopy = useCallback((state: DashboardCostState) => {
    switch (state) {
      case 'supported': return tt('dashboard.costSupported', 'Supported by shipment movement cost')
      case 'explicit_zero': return tt('dashboard.costExplicitZero', 'Explicit zero-cost evidence')
      case 'partial': return tt('dashboard.costPartial', 'Partial cost coverage')
      case 'unavailable': return tt('dashboard.costUnavailable', 'Cost unavailable')
      default: return tt('dashboard.costNotApplicable', 'No cost evidence required in this scope')
    }
  }, [t])

  const comparisonCopy = useCallback((current: number, previous: number, available: boolean, percent = false) => {
    if (!available) return tt('dashboard.comparisonUnavailable', 'Previous-period comparison unavailable')
    const delta = current - previous
    if (percent) return tt('dashboard.comparisonPoints', '{value} percentage points vs previous period', { value: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` })
    return tt('dashboard.comparisonAmount', '{value} vs previous period', { value: `${delta >= 0 ? '+' : ''}${money(delta)}` })
  }, [money, t])

  const actionCards = useMemo(() => {
    if (!hasOperationalData && !coreUnavailable && !performanceUnavailable) return [
      {
        title: tt('dashboard.firstItemsTitle', 'Add operating items'),
        body: tt('dashboard.firstItemsBody', 'Create the products or services the company will buy, hold, or sell.'),
        tone: 'info' as PremiumTone,
        icon: <PackageIcon weight="duotone" />,
        actionLabel: tt('dashboard.reviewItems', 'Review item setup'),
        action: () => navigate('/items'),
      },
      {
        title: tt('dashboard.firstWarehouseTitle', 'Confirm stock locations'),
        body: tt('dashboard.firstWarehouseBody', 'Review warehouse and opening-data setup before recording routine stock activity.'),
        tone: 'neutral' as PremiumTone,
        icon: <BuildingsIcon weight="duotone" />,
        actionLabel: tt('dashboard.openWarehouses', 'Open warehouses'),
        action: () => navigate('/warehouses'),
      },
      {
        title: tt('dashboard.firstPosTitle', 'Check Point of Sale readiness'),
        body: tt('dashboard.firstPosBody', 'Open Point of Sale to confirm its tax handling, stock source, and payment destination before posting.'),
        tone: 'warning' as PremiumTone,
        icon: <BasketIcon weight="duotone" />,
        actionLabel: tt('dashboard.openPos', 'Open Point of Sale'),
        action: () => navigate('/operator'),
      },
    ]

    const cards: Array<{
      title: ReactNode
      body: ReactNode
      count?: ReactNode
      tone: PremiumTone
      icon: ReactNode
      actionLabel: ReactNode
      action: () => void
    }> = []
    if (coreUnavailable || performanceUnavailable || staleData) cards.push({
      title: tt('dashboard.dataReadAction', 'Restore dashboard reads'),
      body: tt('dashboard.dataReadActionHelp', 'Do not treat missing reads as a healthy zero. Retry the current scope.'),
      count: tt('dashboard.dataReadCount', '1 data review'),
      tone: 'critical',
      icon: <WarningCircleIcon weight="duotone" />,
      actionLabel: tt('dashboard.retryData', 'Retry dashboard data'),
      action: refresh,
    })
    if (lowStockRows.length > 0) cards.push({
      title: tt('dashboard.lowStockAction', 'Replenish low stock'),
      body: tt('dashboard.lowStockActionHelp', 'Items below minimum are ordered by severity and shortfall.'),
      count: tt('dashboard.itemsCount', '{count} items', { count: lowStockRows.length }),
      tone: lowStockRows.some(row => row.severity === 'critical') ? 'critical' : 'warning',
      icon: <WarningIcon weight="duotone" />,
      actionLabel: tt('dashboard.reviewLowStock', 'Review low stock'),
      action: () => navigate('/stock-levels'),
    })
    if (missingMinimumCount > 0) cards.push({
      title: tt('dashboard.minimumSetupAction', 'Complete stock thresholds'),
      body: tt('dashboard.minimumSetupActionHelp', 'Inventory items without a minimum cannot contribute to low-stock exceptions.'),
      count: tt('dashboard.itemsCount', '{count} items', { count: missingMinimumCount }),
      tone: 'warning',
      icon: <PackageIcon weight="duotone" />,
      actionLabel: tt('dashboard.reviewItems', 'Review item setup'),
      action: () => navigate('/items'),
    })
    if (costNeedsReview || inventoryNeedsReview) cards.push({
      title: tt('dashboard.costAction', 'Complete cost evidence'),
      body: tt('dashboard.costActionHelp', 'Margin remains unavailable where shipment or inventory cost evidence is incomplete.'),
      count: costStateCopy(currentCostCoverage.state),
      tone: 'warning',
      icon: <CoinsIcon weight="duotone" />,
      actionLabel: tt('dashboard.reviewCostEvidence', 'Review cost evidence'),
      action: () => navigate('/movements'),
    })
    if (marginNegative) cards.push({
      title: tt('dashboard.marginAction', 'Review negative gross margin'),
      body: tt('dashboard.marginActionHelp', 'The supported shipment-linked cost basis exceeds operational revenue in this period.'),
      count: grossMargin === null ? t('common.dash') : money(grossMargin),
      tone: 'critical',
      icon: <TrendDownIcon weight="duotone" />,
      actionLabel: tt('dashboard.openReports', 'Open reports'),
      action: () => navigate('/reports'),
    })
    if (cards.length === 0) cards.push({
      title: tt('dashboard.monitorAction', 'Continue operating review'),
      body: tt('dashboard.monitorActionHelp', 'No urgent action is open. Review the latest movements for detailed evidence.'),
      count: tt('dashboard.noOpenActions', 'No urgent actions'),
      tone: 'positive',
      icon: <CheckCircleIcon weight="duotone" />,
      actionLabel: tt('dashboard.reviewMovements', 'Review latest movements'),
      action: () => navigate('/movements'),
    })
    return cards.slice(0, 3)
  }, [coreUnavailable, costNeedsReview, costStateCopy, currentCostCoverage.state, grossMargin, hasOperationalData, inventoryNeedsReview, lowStockRows, marginNegative, missingMinimumCount, money, navigate, performanceUnavailable, refresh, staleData, t])

  const mobileQuickActions = useMemo(() => [
    { label: tt('dashboard.openPos', 'Open Point of Sale'), icon: <BasketIcon weight="duotone" />, onClick: () => navigate('/operator'), tone: 'info' as PremiumTone },
    { label: tt('dashboard.searchItems', 'Search items'), icon: <MagnifyingGlassIcon weight="duotone" />, onClick: () => navigate('/search') },
    { label: tt('dashboard.reviewMovements', 'Review latest movements'), icon: <ClockIcon weight="duotone" />, onClick: () => navigate('/movements') },
    { label: tt('dashboard.reviewLowStock', 'Review low stock'), icon: <PackageIcon weight="duotone" />, onClick: () => navigate('/stock-levels'), tone: lowStockRows.length ? 'warning' as PremiumTone : 'neutral' as PremiumTone },
  ], [lowStockRows.length, navigate, t])

  const chartColors = {
    revenue: 'hsl(var(--chart-revenue-line))',
    cogs: 'hsl(var(--chart-cogs-line))',
    margin: 'hsl(var(--chart-margin-line))',
    grid: 'hsl(var(--chart-grid-border))',
  }
  const chartHasData = dailyPerformance.some(row => row.revenue !== 0 || row.knownCogs !== 0)
  const chartInterpretation = !reconciled
    ? tt('dashboard.reconciliationFailed', 'Chart totals do not reconcile with the headline metrics. Refresh before using this view.')
    : !costComplete && performanceHasData
      ? tt('dashboard.chartPartialCost', 'Revenue reconciles exactly. COGS shows known shipment cost only, and margin is withheld where cost evidence is incomplete.')
      : tt('dashboard.chartReconciled', 'Revenue and shipment-linked COGS reconcile exactly to the headline period totals.')

  const renderChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="min-w-[12rem] rounded-lg border border-card-border bg-popover p-3 text-popover-foreground shadow-xl">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">{label}</div>
        {payload.map(entry => (
          <div key={entry.name} className="flex items-center justify-between gap-4 py-1 text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full border" style={{ backgroundColor: entry.color, borderColor: chartColors.grid }} />
              {entry.name}
            </span>
            <span className="font-mono tabular-nums">{money(entry.value || 0)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (initialLoading || performanceInitialLoading) {
    return (
      <div className="app-page app-page--analytics">
        <PremiumSkeleton lines={4} label={tt('dashboard.loading', 'Loading dashboard')} />
        <div className="grid gap-4 md:grid-cols-3"><PremiumSkeleton /><PremiumSkeleton /><PremiumSkeleton /></div>
      </div>
    )
  }

  return (
    <div className="app-page app-page--analytics flex flex-col gap-6">
      <MobileWorkflowHeader
        title={t('dashboard.title')}
        description={tt('dashboard.mobileSubtitleV2', 'Today, urgent operating actions, and decision-ready performance in one view.')}
        status={<PremiumStatusBadge tone={statusMeta.tone} icon={statusMeta.icon}>{statusMeta.label}</PremiumStatusBadge>}
        meta={`${currentWindowLabel} · ${warehouseLabel}`}
      />

      <PremiumPageHeader
        className="hidden md:flex"
        title={t('dashboard.title')}
        description={tt('dashboard.subtitleV2', 'Use one operating answer, a short action queue, and reconciled performance evidence to decide what needs attention next.')}
        context={(
          <>
            <PremiumStatusBadge tone="info" icon={<BuildingsIcon className="h-3.5 w-3.5" weight="duotone" />}>
              {companyName || tt('company.selectCompany', 'Company')}
            </PremiumStatusBadge>
            <PremiumStatusBadge tone="neutral">{t('filters.warehouse.label')}: {warehouseLabel}</PremiumStatusBadge>
          </>
        )}
        status={(
          <>
            <PremiumStatusBadge tone={statusMeta.tone} icon={statusMeta.icon}>{statusMeta.label}</PremiumStatusBadge>
            {refreshing ? <PremiumStatusBadge tone="info">{tt('dashboard.refreshing', 'Refreshing')}</PremiumStatusBadge> : null}
          </>
        )}
        meta={<span className="premium-meta">{currentWindowLabel}</span>}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={cn('h-4 w-4', refreshing && 'motion-safe:animate-spin')} />
              {tt('dashboard.refresh', 'Refresh')}
            </Button>
            <Button onClick={() => navigate('/operator')}>
              <BasketIcon className="h-4 w-4" weight="duotone" />
              {tt('dashboard.openPos', 'Open Point of Sale')}
            </Button>
          </div>
        )}
      />

      <Card className="border-card-border bg-card shadow-sm">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 md:grid-cols-[minmax(0,13rem)_minmax(0,15rem)_1fr_auto] md:items-end">
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">{t('filters.window.label')}</label>
            <Select value={String(windowDays)} onValueChange={value => setWindowDays(Number(value))} disabled={refreshing}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">{t('window.30')}</SelectItem>
                <SelectItem value="60">{t('window.60')}</SelectItem>
                <SelectItem value="90">{t('window.90')}</SelectItem>
                <SelectItem value="180">{t('window.180')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">{t('filters.warehouse.label')}</label>
            <Select value={warehouseId} onValueChange={setWarehouseId} disabled={coreState.phase === 'loading'}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('filters.warehouse.all')}</SelectItem>
                {warehouses.map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 rounded-md border border-border/70 bg-surface-muted/35 px-3 py-2 text-xs leading-5 text-muted-foreground sm:col-span-2 md:col-span-1">
            <span className="font-medium text-foreground">{tt('dashboard.scopeLabel', 'Scope')}:</span> {currentWindowLabel}. {tt('dashboard.scopeContract', 'Revenue and shipment-linked COGS use the same Sales Order activity window; inventory uses the current warehouse state.')}
          </div>
          <Button variant="ghost" className="sm:col-span-2 md:col-span-1" onClick={() => setDailyOpen(true)}>
            <Calendar className="h-4 w-4" />
            {tt('dashboard.dailyDetails', 'Daily details')}
          </Button>
        </CardContent>
      </Card>

      {(coreUnavailable || performanceUnavailable || staleData) ? (
        <PremiumStatePanel
          kind={coreUnavailable || performanceUnavailable ? 'error' : 'blocked'}
          compact
          icon={<WarningCircleIcon weight="duotone" />}
          title={statusMeta.label}
          description={statusMeta.summary}
          action={<Button size="sm" variant="outline" onClick={refresh}>{tt('dashboard.retryData', 'Retry dashboard data')}</Button>}
        />
      ) : null}

      <PremiumSection
        title={tt('dashboard.operatingAnswer', 'Operating answer')}
        description={tt('dashboard.operatingAnswerHelpV2', 'The answer is derived from read health, stock exceptions, setup completeness, and supported performance evidence.')}
      >
        <section className="overflow-hidden rounded-[calc(var(--radius)+0.35rem)] border border-card-border bg-card p-5 text-card-foreground shadow-[0_28px_80px_-52px_hsl(0_0%_0%/0.45)] dark:border-panel-premium-border dark:bg-panel-premium dark:text-panel-premium-foreground sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <PremiumStatusBadge tone={statusMeta.tone} icon={statusMeta.icon}>{statusMeta.label}</PremiumStatusBadge>
                <span className="text-xs text-muted-foreground dark:text-panel-premium-muted">{companyName} · {warehouseLabel}</span>
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">{statusMeta.label}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground dark:text-panel-premium-muted">{statusMeta.summary}</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button onClick={primaryAction.action} className="w-full sm:w-auto">
                  {primaryAction.label}<ArrowRight className="h-4 w-4" />
                </Button>
                <p className="text-xs leading-5 text-muted-foreground dark:text-panel-premium-muted">{primaryAction.help}</p>
              </div>
            </div>
            <PremiumMetricCard
              variant="panel"
              tone={statusMeta.tone}
              label={tt('dashboard.urgentActions', 'Urgent actions')}
              value={formatCount(urgentActionCount)}
              description={urgentActionCount > 0
                ? tt('dashboard.urgentActionsHelp', 'Each count maps to a concrete data, stock, setup, or performance review.')
                : tt('dashboard.noUrgentActionsHelp', 'No urgent exception is visible in the active scope.')}
              icon={statusMeta.icon}
            />
          </div>
        </section>
      </PremiumSection>

      <PremiumSection
        title={tt('dashboard.actionNeeded', 'Action needed')}
        description={tt('dashboard.actionNeededHelpV2', 'The queue is intentionally short and does not duplicate the same exception in multiple cards.')}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {actionCards.map(({ action, ...card }) => (
            <PremiumActionCard key={String(card.title)} {...card} onAction={action} />
          ))}
        </div>
        {lowStockRows.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {lowStockRows.slice(0, 3).map(row => (
              <div key={row.item.id} className="rounded-[calc(var(--radius)+0.1rem)] border border-border/70 bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{row.item.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{row.item.sku || t('common.dash')}</div>
                  </div>
                  <PremiumStatusBadge tone={row.severity === 'critical' ? 'critical' : 'warning'}>
                    {row.severity === 'critical' ? tt('dashboard.outOfStock', 'Out of stock') : tt('dashboard.lowStock', 'Low stock')}
                  </PremiumStatusBadge>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {tt('dashboard.stockShortfall', 'On hand {onHand}; minimum {minimum}; shortfall {shortfall}.', {
                    onHand: formatCount(row.onHand),
                    minimum: formatCount(row.minimum),
                    shortfall: formatCount(row.shortage),
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </PremiumSection>

      <MobileQuickActionGroup actions={mobileQuickActions} />

      <PremiumSection
        title={tt('dashboard.performanceSnapshot', 'Performance snapshot')}
        description={tt('dashboard.performanceSnapshotHelp', 'Period metrics and current inventory state are separated. Previous-period comparisons appear only when the required evidence is available.')}
      >
        {performanceInitialLoading ? <PremiumSkeleton lines={4} label={tt('dashboard.loadingPerformance', 'Loading performance')} /> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <PremiumMetricCard
                label={tt('dashboard.operationalRevenue', 'Operational revenue')}
                value={money(currentRevenue)}
                tone="neutral"
                icon={<CurrencyCircleDollarIcon weight="duotone" />}
                description={tt('dashboard.operationalRevenueHelp', '{count} shipped Sales Orders in the active order-activity window.', { count: currentOrders.length })}
                meta={comparisonCopy(currentRevenue, previousRevenue, previousOrders.length > 0)}
              />
              <PremiumMetricCard
                label={tt('dashboard.shipmentCogs', 'Shipment-linked COGS')}
                value={costComplete ? money(currentCogs) : tt('dashboard.unavailableValue', 'Unavailable')}
                tone={costComplete ? 'critical' : 'warning'}
                icon={<CoinsIcon weight="duotone" />}
                description={costStateCopy(currentCostCoverage.state)}
                meta={costComplete
                  ? comparisonCopy(currentCogs, previousCogs, previousCostComplete && previousOrders.length > 0)
                  : tt('dashboard.knownCostOnly', 'Known cost: {value}; missing evidence: {count}.', { value: money(currentCogs), count: currentCostCoverage.missingCount })}
              />
              <PremiumMetricCard
                label={t('kpi.grossMargin.title')}
                value={grossMargin === null ? tt('dashboard.unavailableValue', 'Unavailable') : money(grossMargin)}
                tone={grossMargin === null ? 'warning' : grossMargin < 0 ? 'critical' : 'positive'}
                icon={grossMargin !== null && grossMargin < 0 ? <TrendDownIcon weight="duotone" /> : <TrendUpIcon weight="duotone" />}
                description={grossMarginPct === null
                  ? tt('dashboard.marginWithheld', 'Margin is withheld until shipment cost coverage is complete.')
                  : `${(grossMarginPct * 100).toFixed(1)}% ${t('kpi.grossMargin.help_pct')}`}
                meta={grossMargin !== null && previousMargin !== null && currentRevenue > 0 && previousRevenue > 0
                  ? comparisonCopy(grossMarginPct! * 100, (previousMargin / previousRevenue) * 100, true, true)
                  : tt('dashboard.comparisonUnavailable', 'Previous-period comparison unavailable')}
              />
              <PremiumMetricCard
                label={t('kpi.inventoryValue.title')}
                value={inventoryCoverage.state === 'unavailable' ? tt('dashboard.unavailableValue', 'Unavailable') : money(inventoryCoverage.knownValue)}
                tone={inventoryNeedsReview || lowStockRows.length > 0 ? 'warning' : 'info'}
                icon={<PackageIcon weight="duotone" />}
                description={tt('dashboard.inventoryCurrentState', 'Current inventory valuation for {warehouse}.', { warehouse: warehouseLabel })}
                meta={inventoryCoverage.state === 'partial'
                  ? tt('dashboard.inventoryPartial', 'Partial valuation; {count} stock buckets lack average cost.', { count: inventoryCoverage.missing })
                  : costStateCopy(inventoryCoverage.state)}
              />
            </div>

            <PremiumChartCard
              className="mt-4"
              variant="panel"
              title={tt('dashboard.dailyPerformance', 'Daily performance')}
              description={tt('dashboard.dailyPerformanceHelp', 'Daily points use the same Sales Order activity date and order set as the headline revenue and shipment-linked COGS.')}
              stat={<PremiumStatusBadge tone={reconciled ? costComplete ? 'positive' : 'warning' : 'critical'}>{reconciled ? tt('dashboard.reconciled', 'Reconciled') : tt('dashboard.notReconciled', 'Not reconciled')}</PremiumStatusBadge>}
              footer={chartInterpretation}
            >
              {chartHasData ? (
                <div className="h-[19rem] min-h-[19rem] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyPerformance} margin={{ top: 10, right: 14, bottom: 2, left: 0 }}>
                      <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={18} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <YAxis axisLine={false} tickLine={false} width={76} tickFormatter={formatCompactMoney} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                      <Tooltip content={renderChartTooltip} cursor={{ stroke: chartColors.grid, strokeWidth: 1.2, strokeDasharray: '4 4' }} />
                      <Legend iconType="circle" wrapperStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 12, paddingTop: 12 }} />
                      <Line type="monotone" dataKey="revenue" name={t('table.revenue')} stroke={chartColors.revenue} strokeWidth={2.8} dot={{ r: 4, stroke: chartColors.grid }} activeDot={{ r: 5, stroke: chartColors.grid }} connectNulls={false} />
                      <Line type="monotone" dataKey="cogs" name={t('table.cogs')} stroke={chartColors.cogs} strokeWidth={2.8} dot={{ r: 4, stroke: chartColors.grid }} activeDot={{ r: 5, stroke: chartColors.grid }} connectNulls={false} />
                      <Line type="monotone" dataKey="margin" name={t('table.grossMargin')} stroke={chartColors.margin} strokeWidth={2.8} dot={{ r: 4, stroke: chartColors.grid }} activeDot={{ r: 5, stroke: chartColors.grid }} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <PremiumEmptyState
                  compact
                  icon={<ChartLineUpIcon weight="duotone" />}
                  title={tt('dashboard.noPerformanceTitle', 'No period performance yet')}
                  description={tt('dashboard.noPerformanceHelp', 'The chart will appear when shipped Sales Orders enter the selected activity window.')}
                />
              )}
            </PremiumChartCard>
          </>
        )}
      </PremiumSection>

      <PremiumSection
        title={tt('dashboard.performanceDrivers', 'Performance drivers')}
        description={tt('dashboard.performanceDriversHelp', 'Use customer concentration, cost completeness, and leading product rows to understand what drives the period result.')}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <PremiumMetricCard
            label={tt('dashboard.topClient', 'Top client')}
            value={customerState.phase === 'error' && !customerState.stale
              ? tt('dashboard.unavailableValue', 'Unavailable')
              : topClient?.name || t('common.dash')}
            tone="neutral"
            icon={<BuildingsIcon weight="duotone" />}
            description={topClient
              ? tt('dashboard.topClientRevenue', '{value} operational revenue in this period.', { value: money(topClient.revenue) })
              : tt('dashboard.topClientEmpty', 'No customer-linked operational revenue is available.')}
            meta={topClient
              ? `${tt('dashboard.namedCustomer', 'Named customer')} · ${topClient.share === null ? t('common.dash') : `${(topClient.share * 100).toFixed(1)}%`}`
              : customerState.phase === 'error' ? tt('dashboard.customerReadFailed', 'Customer read failed; no row was silently omitted.') : undefined}
          />
          <PremiumMetricCard
            label={tt('dashboard.costCoverage', 'Cost coverage')}
            value={costStateCopy(currentCostCoverage.state)}
            tone={costComplete ? currentCostCoverage.state === 'explicit_zero' ? 'neutral' : 'positive' : 'warning'}
            icon={<CoinsIcon weight="duotone" />}
            description={tt('dashboard.costCoverageCounts', '{supported} supported shipment records; {missing} missing.', {
              supported: currentCostCoverage.supportedCount,
              missing: currentCostCoverage.missingCount,
            })}
            meta={currentCostCoverage.state === 'explicit_zero'
              ? tt('dashboard.explicitZeroNotMissing', 'Zero is shown only because the movement records explicitly support zero cost.')
              : tt('dashboard.costCoverageRule', 'Missing cost never becomes zero or a healthy margin.')}
          />
          <PremiumMetricCard
            label={tt('dashboard.leadingProduct', 'Leading product')}
            value={productPerformance[0]?.name || t('common.dash')}
            tone={productPerformance[0]?.margin === null ? 'warning' : productPerformance[0]?.margin && productPerformance[0].margin < 0 ? 'critical' : 'neutral'}
            icon={<PackageIcon weight="duotone" />}
            description={productPerformance[0]
              ? tt('dashboard.leadingProductRevenue', '{value} operational revenue.', { value: money(productPerformance[0].revenue) })
              : tt('dashboard.leadingProductEmpty', 'No product performance row is available.')}
            meta={productPerformance[0]
              ? productPerformance[0].margin === null
                ? costStateCopy(productPerformance[0].costState)
                : tt('dashboard.leadingProductMargin', '{value} gross margin.', { value: money(productPerformance[0].margin) })
              : undefined}
          />
        </div>
      </PremiumSection>

      <PremiumSection
        title={tt('dashboard.latestMovements', 'Latest stock movements')}
        description={tt('dashboard.latestMovementsHelp', 'The three latest company stock events provide a short operational heartbeat; the stock ledger holds the complete history.')}
        action={<Button size="sm" variant="outline" onClick={() => navigate('/movements')}>{tt('dashboard.viewAllMovements', 'View all movements')}<ArrowUpRight className="h-4 w-4" /></Button>}
      >
        {movements.length === 0 ? (
          <PremiumEmptyState
            compact
            icon={<ClockIcon weight="duotone" />}
            title={tt('dashboard.noMovements', 'No recent stock movement')}
            description={tt('dashboard.noMovementsHelp', 'Stock activity will appear here after governed movement posting.')}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            {movements.map(movement => {
              const item = itemById.get(movement.item_id)
              const value = resolveMovementCost(movement)
              return (
                <div key={movement.id} className="rounded-[calc(var(--radius)+0.1rem)] border border-card-border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{item?.name || tt('dashboard.unknownItem', 'Unknown item')}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(movement.created_at)}</div>
                    </div>
                    <PremiumStatusBadge tone="neutral">{tt(`movement.${movement.type}`, movement.type || t('common.dash'))}</PremiumStatusBadge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <div><span className="block">{t('table.qtyBase')}</span><span className="mt-1 block font-mono text-sm text-foreground">{formatCount(finiteNumber(movement.qty_base))}</span></div>
                    <div><span className="block">{t('table.value')}</span><span className="mt-1 block font-mono text-sm text-foreground">{value.available ? money(value.amount) : tt('dashboard.unavailableValue', 'Unavailable')}</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </PremiumSection>

      <PremiumSection
        title={tt('dashboard.detailedProductPerformance', 'Detailed product performance')}
        description={tt('dashboard.detailedProductPerformanceHelp', 'Revenue is allocated from Sales Order line evidence. Margin is withheld for service, unattributed, or stock rows without complete shipment-cost evidence.')}
      >
        {productPerformance.length === 0 ? (
          <PremiumEmptyState
            icon={<CoinsIcon weight="duotone" />}
            title={tt('dashboard.noProductPerformance', 'No product performance rows')}
            description={tt('dashboard.noProductPerformanceHelp', 'Shipped Sales Orders with line or shipment evidence will appear here.')}
          />
        ) : (
          <Card className="border-border/80 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <MobileCardList>
                {productPerformance.map((row, index) => (
                  <div key={row.itemId} className="rounded-[calc(var(--radius)+0.1rem)] border border-border/70 bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">#{index + 1}</div>
                        <div className="truncate text-sm font-semibold">{row.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{row.sku}</div>
                      </div>
                      <PremiumStatusBadge tone={row.margin === null ? 'warning' : row.margin < 0 ? 'critical' : 'neutral'}>{costStateCopy(row.costState)}</PremiumStatusBadge>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <MetricCell label={t('table.revenue')} value={money(row.revenue)} />
                      <MetricCell label={t('table.cogs')} value={row.margin === null ? tt('dashboard.unavailableValue', 'Unavailable') : money(row.knownCogs)} />
                      <MetricCell label={t('table.grossMargin')} value={row.margin === null ? tt('dashboard.unavailableValue', 'Unavailable') : money(row.margin)} critical={row.margin !== null && row.margin < 0} />
                      <MetricCell label={t('table.gmPct')} value={row.marginPct === null ? t('common.dash') : `${(row.marginPct * 100).toFixed(1)}%`} critical={row.marginPct !== null && row.marginPct < 0} />
                    </div>
                  </div>
                ))}
              </MobileCardList>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="border-b text-left">
                    <th className="py-2 pr-3">{tt('dashboard.rank', 'Rank')}</th>
                    <th className="py-2 pr-3">{t('table.item')}</th>
                    <th className="py-2 pr-3">{t('table.sku')}</th>
                    <th className="py-2 pr-3 text-right">{t('table.revenue')}</th>
                    <th className="py-2 pr-3 text-right">{t('table.cogs')}</th>
                    <th className="py-2 pr-3 text-right">{t('table.grossMargin')}</th>
                    <th className="py-2 text-right">{tt('dashboard.costCoverage', 'Cost coverage')}</th>
                  </tr></thead>
                  <tbody>
                    {productPerformance.map((row, index) => (
                      <tr key={row.itemId} className="border-b transition-colors hover:bg-muted/20">
                        <td className="py-3 pr-3 text-muted-foreground">#{index + 1}</td>
                        <td className="max-w-[220px] truncate py-3 pr-3 font-medium">{row.name}</td>
                        <td className="py-3 pr-3 text-muted-foreground">{row.sku}</td>
                        <td className="py-3 pr-3 text-right font-mono tabular-nums">{money(row.revenue)}</td>
                        <td className="py-3 pr-3 text-right font-mono tabular-nums">{row.margin === null ? t('common.dash') : money(row.knownCogs)}</td>
                        <td className={cn('py-3 pr-3 text-right font-mono tabular-nums', row.margin !== null && row.margin < 0 && 'text-financial-critical')}>{row.margin === null ? t('common.dash') : money(row.margin)}</td>
                        <td className="py-3 text-right"><PremiumStatusBadge tone={row.margin === null ? 'warning' : 'neutral'}>{costStateCopy(row.costState)}</PremiumStatusBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </PremiumSection>

      <Sheet open={dailyOpen} onOpenChange={setDailyOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-2xl md:p-6">
          <SheetHeader className="px-4 pt-4 md:px-0 md:pt-0">
            <SheetTitle>{tt('dashboard.dailyDetails', 'Daily details')}</SheetTitle>
            <SheetDescription>{tt('dashboard.dailyDetailsHelp', 'Daily period rows use the same order-activity scope as the headline metrics.')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="px-4 pb-6 md:px-0">
            <div className="mt-4 overflow-x-auto rounded-md border">
              <table className="w-full min-w-[560px] text-sm">
                <thead><tr className="border-b text-left">
                  <th className="p-3">{t('table.date')}</th>
                  <th className="p-3 text-right">{t('table.revenue')}</th>
                  <th className="p-3 text-right">{t('table.cogs')}</th>
                  <th className="p-3 text-right">{t('table.grossMargin')}</th>
                </tr></thead>
                <tbody>{dailyPerformance.map(row => (
                  <tr key={row.date} className="border-b">
                    <td className="p-3">{row.date}</td>
                    <td className="p-3 text-right font-mono tabular-nums">{money(row.revenue)}</td>
                    <td className="p-3 text-right font-mono tabular-nums">{row.cogs === null ? t('common.dash') : money(row.cogs)}</td>
                    <td className="p-3 text-right font-mono tabular-nums">{row.margin === null ? t('common.dash') : money(row.margin)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{chartInterpretation}</p>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function MetricCell({ label, value, critical = false }: { label: ReactNode; value: ReactNode; critical?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-mono text-sm tabular-nums', critical && 'text-financial-critical')}>{value}</div>
    </div>
  )
}
