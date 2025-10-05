import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { RefreshCw, FileDown, Package, Warehouse as WarehouseIcon, Search } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'

interface Item {
  id: string
  sku: string
  name: string
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
}

interface StockLevel {
  id: string
  itemId: string
  warehouseId: string
  onHandQty: number
  avgCost: number
}

export function StockLevels() {
  const { companyId } = useOrg()

  const [items, setItems] = useState<Item[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [itemFilter, setItemFilter] = useState<string>('all')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all')

  useEffect(() => {
    if (!companyId) return
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const loadData = async () => {
    if (!companyId) return
    try {
      setLoading(true)
      setError(null)

      // 1) Warehouses for this company
      const { data: whsData, error: wErr } = await supabase
        .from('warehouses')
        .select('id,code,name')
        .eq('company_id', companyId)
        .order('name', { ascending: true })

      if (wErr) throw wErr
      const whs = (whsData ?? []) as Warehouse[]
      setWarehouses(whs)

      // 2) Items for this company (keeps picker consistent with company scope)
      const { data: itemsData, error: iErr } = await supabase
        .from('items')
        .select('id,sku,name')
        .eq('company_id', companyId)
        .order('name', { ascending: true })

      if (iErr) throw iErr
      setItems((itemsData ?? []) as Item[])

      // 3) Stock levels for company warehouses
      const whIds = whs.map(w => w.id)
      let stockData: StockLevelRow[] = []
      if (whIds.length) {
        const { data: slData, error: sErr } = await supabase
          .from('stock_levels')
          .select('id,item_id,warehouse_id,qty,avg_cost')
          .in('warehouse_id', whIds)

        if (sErr) throw sErr
        stockData = (slData ?? []) as StockLevelRow[]
      }

      const mapped: StockLevel[] = (stockData ?? []).map((r) => ({
        id: r.id,
        itemId: r.item_id,
        warehouseId: r.warehouse_id,
        onHandQty: Number(r.qty ?? 0),
        avgCost: Number(r.avg_cost ?? 0),
      }))
      setStockLevels(mapped)
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const whById = useMemo(() => new Map(warehouses.map(w => [w.id, w])), [warehouses])

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return stockLevels
      .map(sl => {
        const item = itemById.get(sl.itemId)
        const wh = whById.get(sl.warehouseId)
        const onHandQty = Number(sl.onHandQty)
        const avgCost = Number(sl.avgCost || 0)
        return {
          id: sl.id,
          itemId: sl.itemId,
          itemName: item?.name || sl.itemId,
          sku: item?.sku || '',
          warehouseId: sl.warehouseId,
          warehouseName: wh?.name || sl.warehouseId,
          onHandQty,
          avgCost,
          totalValue: onHandQty * avgCost
        }
      })
      .filter(r => (itemFilter === 'all' ? true : r.itemId === itemFilter))
      .filter(r => (warehouseFilter === 'all' ? true : r.warehouseId === warehouseFilter))
      .filter(r =>
        s
          ? r.itemName.toLowerCase().includes(s) ||
            r.sku.toLowerCase().includes(s) ||
            r.warehouseName.toLowerCase().includes(s)
          : true
      )
      .sort((a, b) => a.itemName.localeCompare(b.itemName))
  }, [stockLevels, itemById, whById, itemFilter, warehouseFilter, search])

  const totals = useMemo(() => {
    const qty = rows.reduce((sum, r) => sum + r.onHandQty, 0)
    const value = rows.reduce((sum, r) => sum + r.totalValue, 0)
    return { qty, value }
  }, [rows])

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-MZ', { style: 'currency', currency: 'MZN' }).format(n)

  const downloadCSV = (data: typeof rows, filename: string) => {
    if (!data.length) {
      toast('No data to export')
      return
    }
    const headers = ['Item', 'SKU', 'Warehouse', 'On Hand Qty', 'Avg Cost', 'Total Value']
    const csv = [
      headers.join(','),
      ...data.map(r =>
        [
          r.itemName,
          r.sku,
          r.warehouseName,
          r.onHandQty,
          r.avgCost,
          r.totalValue
        ]
          .map(v => {
            const s = String(v).replace(/"/g, '""')
            return /[",\n]/.test(s) ? `"${s}"` : s
          })
          .join(',')
      )
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Export complete')
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Join or create a company to view stock levels.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Stock Levels</h1>
        </div>
        <div className="animate-pulse">
          <div className="h-10 bg-muted rounded mb-4" />
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <h2 className="text-xl font-bold mb-2">Stock Levels Error</h2>
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={loadData}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Stock Levels</h1>
          <p className="text-muted-foreground">View on-hand by item and warehouse</p>
        </div>
        <Button variant="outline" onClick={loadData}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <Label htmlFor="search">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Item name, SKU, warehouse..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <div>
            <Label>Item</Label>
            <Select value={itemFilter} onValueChange={setItemFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All items" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All items</SelectItem>
                {items.map(i => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} ({i.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Warehouse</Label>
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All warehouses</SelectItem>
                {warehouses.map(w => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Summary + Export */}
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              <div>
                <div className="text-xs text-muted-foreground">Total Qty</div>
                <div className="text-xl font-semibold">{totals.qty}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <WarehouseIcon className="w-5 h-5" />
              <div>
                <div className="text-xs text-muted-foreground">Total Value</div>
                <div className="text-xl font-semibold">{formatCurrency(totals.value)}</div>
              </div>
            </div>
          </div>
          <Button onClick={() => downloadCSV(rows, 'stock_levels.csv')}>
            <FileDown className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle>Results ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <div className="w-full overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-6 px-3 py-2 text-xs uppercase text-muted-foreground">
                  <div>Item</div>
                  <div>SKU</div>
                  <div>Warehouse</div>
                  <div className="text-right">On Hand</div>
                  <div className="text-right">Avg Cost</div>
                  <div className="text-right">Total Value</div>
                </div>
                <div className="divide-y">
                  {rows.map(r => (
                    <div key={r.id} className="grid grid-cols-6 px-3 py-2 text-sm">
                      <div className="truncate">{r.itemName}</div>
                      <div className="truncate">{r.sku}</div>
                      <div className="truncate">{r.warehouseName}</div>
                      <div className="text-right">{r.onHandQty}</div>
                      <div className="text-right">{formatCurrency(r.avgCost)}</div>
                      <div className="text-right">{formatCurrency(r.totalValue)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No stock levels match your filters.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default StockLevels
