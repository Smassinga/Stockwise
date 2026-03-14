import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileDown, Package, RefreshCw, Search, Warehouse as WarehouseIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Badge } from '../components/ui/badge'
import { toast } from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'

interface Item {
  id: string
  sku: string
  name: string
  min_stock: number | null
  reorder_point: number | null
}

interface Warehouse {
  id: string
  code: string
  name: string
}

interface StockLevelRow {
  id: string
  item_id: string
  warehouse_id: string
  qty: number | null
  avg_cost: number | null
  updated_at?: string | null
}

type SortOption =
  | 'value_desc'
  | 'qty_desc'
  | 'item_asc'
  | 'warehouse_asc'
  | 'risk_desc'

type StockStatus = 'healthy' | 'low' | 'out'

type StockRow = {
  id: string
  itemId: string
  itemName: string
  sku: string
  warehouseId: string
  warehouseName: string
  warehouseCode: string
  onHandQty: number
  avgCost: number
  totalValue: number
  minStock: number
  shortageQty: number
  status: StockStatus
}

function formatQuantity(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

function downloadCSV(data: StockRow[], filename: string, formatCurrency: (n: number) => string) {
  if (!data.length) {
    return false
  }
  const headers = ['Item', 'SKU', 'Warehouse', 'On hand', 'Min stock', 'Avg cost', 'Total value', 'Status']
  const csv = [
    headers.join(','),
    ...data.map((row) =>
      [
        row.itemName,
        row.sku,
        row.warehouseName,
        row.onHandQty,
        row.minStock,
        formatCurrency(row.avgCost),
        formatCurrency(row.totalValue),
        row.status,
      ]
        .map((value) => {
          const text = String(value).replace(/"/g, '""')
          return /[",\n]/.test(text) ? `"${text}"` : text
        })
        .join(',')
    ),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return true
}

export function StockLevels() {
  const { companyId } = useOrg()
  const { t } = useI18n()

  const [items, setItems] = useState<Item[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [stockLevels, setStockLevels] = useState<StockLevelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [baseCode, setBaseCode] = useState('MZN')

  const [search, setSearch] = useState('')
  const [itemFilter, setItemFilter] = useState<string>('all')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortOption>('value_desc')

  useEffect(() => {
    if (!companyId) return
    getBaseCurrencyCode(companyId)
      .then((code) => setBaseCode(code || 'MZN'))
      .catch(() => setBaseCode('MZN'))
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const loadData = async () => {
    if (!companyId) return
    try {
      setLoading(true)
      setError(null)

      const { data: whsData, error: warehouseError } = await supabase
        .from('warehouses')
        .select('id,code,name')
        .eq('company_id', companyId)
        .order('name', { ascending: true })
      if (warehouseError) throw warehouseError
      const whs = (whsData ?? []) as Warehouse[]
      setWarehouses(whs)

      const { data: itemsData, error: itemError } = await supabase
        .from('items')
        .select('id,sku,name,min_stock,reorder_point')
        .eq('company_id', companyId)
        .order('name', { ascending: true })
      if (itemError) throw itemError
      setItems((itemsData ?? []) as Item[])

      const warehouseIds = whs.map((warehouse) => warehouse.id)
      if (!warehouseIds.length) {
        setStockLevels([])
        return
      }

      const { data: stockData, error: stockError } = await supabase
        .from('stock_levels')
        .select('id,item_id,warehouse_id,qty,avg_cost,updated_at')
        .eq('company_id', companyId)
        .in('warehouse_id', warehouseIds)

      if (stockError) throw stockError
      setStockLevels((stockData ?? []) as StockLevelRow[])
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const warehouseById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const mapped = stockLevels
      .map((stockLevel) => {
        const item = itemById.get(stockLevel.item_id)
        const warehouse = warehouseById.get(stockLevel.warehouse_id)
        const onHandQty = Number(stockLevel.qty ?? 0)
        const avgCost = Number(stockLevel.avg_cost ?? 0)
        const minStock = Number(item?.min_stock ?? item?.reorder_point ?? 0)
        const shortageQty = minStock > 0 ? Math.max(minStock - onHandQty, 0) : 0
        const status: StockStatus =
          onHandQty <= 0 ? 'out' : shortageQty > 0 ? 'low' : 'healthy'

        return {
          id: stockLevel.id,
          itemId: stockLevel.item_id,
          itemName: item?.name || stockLevel.item_id,
          sku: item?.sku || '',
          warehouseId: stockLevel.warehouse_id,
          warehouseName: warehouse?.name || stockLevel.warehouse_id,
          warehouseCode: warehouse?.code || '',
          onHandQty,
          avgCost,
          totalValue: onHandQty * avgCost,
          minStock,
          shortageQty,
          status,
        } satisfies StockRow
      })
      .filter((row) => (itemFilter === 'all' ? true : row.itemId === itemFilter))
      .filter((row) => (warehouseFilter === 'all' ? true : row.warehouseId === warehouseFilter))
      .filter((row) =>
        needle
          ? [row.itemName, row.sku, row.warehouseName, row.warehouseCode]
              .join(' ')
              .toLowerCase()
              .includes(needle)
          : true
      )

    return mapped.sort((left, right) => {
      switch (sortBy) {
        case 'qty_desc':
          return right.onHandQty - left.onHandQty
        case 'item_asc':
          return left.itemName.localeCompare(right.itemName)
        case 'warehouse_asc':
          return left.warehouseName.localeCompare(right.warehouseName)
        case 'risk_desc': {
          const riskRank = { out: 0, low: 1, healthy: 2 }
          const statusSort = riskRank[left.status] - riskRank[right.status]
          if (statusSort !== 0) return statusSort
          return right.shortageQty - left.shortageQty
        }
        case 'value_desc':
        default:
          return right.totalValue - left.totalValue
      }
    })
  }, [itemById, itemFilter, search, sortBy, stockLevels, warehouseById, warehouseFilter])

  const totals = useMemo(() => {
    const totalUnits = rows.reduce((sum, row) => sum + row.onHandQty, 0)
    const totalValue = rows.reduce((sum, row) => sum + row.totalValue, 0)
    const lowStock = rows.filter((row) => row.status !== 'healthy').length
    const outOfStock = rows.filter((row) => row.status === 'out').length
    const filteredWarehouses = new Set(rows.map((row) => row.warehouseId)).size
    return {
      totalUnits,
      totalValue,
      lowStock,
      outOfStock,
      filteredWarehouses,
      positions: rows.length,
    }
  }, [rows])

  const activeWarehouse = warehouseFilter === 'all' ? null : warehouses.find((warehouse) => warehouse.id === warehouseFilter)

  const formatCurrency = (value: number) => formatMoneyBase(value, baseCode)

  if (!companyId) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">{t('org.noCompany') ?? ''}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">{t('nav.stockLevels')}</h1>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="grid gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-28 rounded-xl bg-muted" />
            ))}
          </div>
          <div className="h-24 rounded-xl bg-muted" />
          <div className="h-72 rounded-xl bg-muted" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <h2 className="mb-2 text-xl font-bold">{t('errors.title') ?? 'Error'}</h2>
        <p className="mb-4 text-muted-foreground">{error}</p>
        <Button onClick={() => void loadData()}>{t('common.retry') ?? 'Retry'}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('nav.stockLevels')}</h1>
          <p className="text-muted-foreground">
            Review on-hand quantity, weighted average cost, and inventory value by warehouse.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Base currency: {baseCode}</Badge>
            <Badge variant="outline">
              {activeWarehouse ? `Warehouse: ${activeWarehouse.name}` : 'All warehouses'}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadData()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('common.refresh') ?? 'Refresh'}
          </Button>
          <Button
            onClick={() => {
              const ok = downloadCSV(rows, 'stock_levels.csv', formatCurrency)
              if (!ok) {
                toast(t('common.headsUp'))
                return
              }
              toast.success(t('export.done'))
            }}
          >
            <FileDown className="mr-2 h-4 w-4" />
            {t('export.csv') ?? 'Export CSV'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Inventory value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatCurrency(totals.totalValue)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Value of the filtered stock position using average cost.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">On-hand units</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatQuantity(totals.totalUnits)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{totals.positions} stock positions in view.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Low stock positions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{totals.lowStock}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Includes {totals.outOfStock} positions already at zero stock.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Warehouse coverage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{totals.filteredWarehouses}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Warehouses represented in the current filtered result.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('reports.filters')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1.3fr_repeat(3,minmax(0,1fr))_auto]">
          <div>
            <Label htmlFor="search">{t('common.search')}</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                placeholder={t('stock.searchPlaceholder') ?? ''}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div>
            <Label>{t('table.item')}</Label>
            <Select value={itemFilter} onValueChange={setItemFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('stock.allItems') ?? ''} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('stock.allItems') ?? ''}</SelectItem>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} ({item.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('warehouses.warehouse')}</Label>
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger>
                <SelectValue placeholder={t('filters.warehouse.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('filters.warehouse.all')}</SelectItem>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name} ({warehouse.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sort by</Label>
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="value_desc">Value (high to low)</SelectItem>
                <SelectItem value="qty_desc">Quantity (high to low)</SelectItem>
                <SelectItem value="risk_desc">Stock risk first</SelectItem>
                <SelectItem value="item_asc">Item name</SelectItem>
                <SelectItem value="warehouse_asc">Warehouse name</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSearch('')
                setItemFilter('all')
                setWarehouseFilter('all')
                setSortBy('value_desc')
              }}
            >
              {t('common.clear')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('transactions.results')} ({rows.length})</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Use this view to review stock valuation and identify rows that need replenishment attention.
            </p>
          </div>
          {totals.lowStock > 0 ? (
            <div className="flex items-center gap-2 rounded-full border border-amber-300/60 bg-amber-50 px-3 py-1 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              {totals.lowStock} positions need attention
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-3 pr-4">Item</th>
                    <th className="py-3 pr-4">Warehouse</th>
                    <th className="py-3 pr-4 text-right">On hand</th>
                    <th className="py-3 pr-4 text-right">Min stock</th>
                    <th className="py-3 pr-4 text-right">{t('stock.avgCost')}</th>
                    <th className="py-3 pr-4 text-right">{t('stock.totalValue')}</th>
                    <th className="py-3 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const rowTone =
                      row.status === 'out'
                        ? 'bg-destructive/5'
                        : row.status === 'low'
                          ? 'bg-amber-500/5'
                          : ''
                    const badgeClass =
                      row.status === 'out'
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : row.status === 'low'
                          ? 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                          : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'

                    return (
                      <tr key={row.id} className={`border-b align-top ${rowTone}`}>
                        <td className="py-4 pr-4">
                          <div className="flex flex-col gap-1">
                            <div className="font-medium">{row.itemName}</div>
                            <div className="text-xs text-muted-foreground">{row.sku || t('common.dash')}</div>
                          </div>
                        </td>
                        <td className="py-4 pr-4">
                          <div className="flex flex-col gap-1">
                            <div className="font-medium">{row.warehouseName}</div>
                            <div className="text-xs text-muted-foreground">{row.warehouseCode || t('common.dash')}</div>
                          </div>
                        </td>
                        <td className="py-4 pr-4 text-right font-medium">{formatQuantity(row.onHandQty)}</td>
                        <td className="py-4 pr-4 text-right">
                          {row.minStock > 0 ? formatQuantity(row.minStock) : t('common.dash')}
                        </td>
                        <td className="py-4 pr-4 text-right">{formatCurrency(row.avgCost)}</td>
                        <td className="py-4 pr-4 text-right font-medium">{formatCurrency(row.totalValue)}</td>
                        <td className="py-4 pr-4">
                          <div className="flex flex-col gap-2">
                            <Badge variant="outline" className={badgeClass}>
                              {row.status === 'out' ? 'Out of stock' : row.status === 'low' ? 'Low stock' : 'Healthy'}
                            </Badge>
                            {row.shortageQty > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                Short by {formatQuantity(row.shortageQty)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
              <Package className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
              <div className="text-lg font-medium">
                {search || itemFilter !== 'all' || warehouseFilter !== 'all'
                  ? 'No stock positions match the current filters.'
                  : t('stock.none')}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {search || itemFilter !== 'all' || warehouseFilter !== 'all'
                  ? 'Clear or relax the filters to widen the stock view.'
                  : 'Receive stock or post movements to start building a live valuation view.'}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default StockLevels
