import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, CircleDollarSign, ExternalLink, FileDown, FilterX, Package, PackageSearch, RefreshCw, Warehouse as WarehouseIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { toast } from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { useIsMobile } from '../hooks/use-mobile'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { exportExcelReport, loadCompanyExportHeader } from '../lib/excelExport'
import { PremiumColumnVisibilityMenu } from '../components/premium/PremiumColumnVisibilityMenu'
import {
  PremiumDataTable,
  sortPremiumRows,
  type PremiumColumnVisibilityState,
  type PremiumDataTableColumn,
  type PremiumDataTableSortState,
} from '../components/premium/PremiumDataTable'
import { PremiumEmptyState, PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumImportExportActions } from '../components/premium/PremiumImportExportActions'
import { PremiumMetricCard } from '../components/premium/PremiumMetricCard'
import { PremiumMobileCardList } from '../components/premium/PremiumMobileCardList'
import { getPremiumPageRows } from '../components/premium/PremiumPagination'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'
import { PremiumTableFilter } from '../components/premium/PremiumTableFilter'
import { PremiumTableToolbar } from '../components/premium/PremiumTableToolbar'

interface Item {
  id: string
  sku: string
  name: string
  min_stock: number | null
  reorder_point: number | null
  base_uom_id: string | null
}

interface Uom { id: string; code: string }

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
  allocated_qty?: number | null
  avg_cost: number | null
  updated_at?: string | null
}

type SortOption =
  | 'value_desc'
  | 'qty_desc'
  | 'item_asc'
  | 'warehouse_asc'
  | 'risk_desc'

type StockStatus = 'healthy' | 'low' | 'out' | 'negative' | 'threshold_unconfigured'
type StockRiskFilter = 'all' | StockStatus

type StockRow = {
  id: string
  itemId: string
  itemName: string
  sku: string
  warehouseId: string
  warehouseName: string
  warehouseCode: string
  onHandQty: number
  allocatedQty: number
  availableQty: number
  uomCode: string
  avgCost: number
  totalValue: number
  minStock: number
  thresholdConfigured: boolean
  shortageQty: number
  status: StockStatus
  integrityIssue: boolean
}

function formatQuantity(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

export function StockLevels() {
  const { companyId } = useOrg()
  const { t } = useI18n()
  const isMobile = useIsMobile()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)

  const [items, setItems] = useState<Item[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [stockLevels, setStockLevels] = useState<StockLevelRow[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [baseCode, setBaseCode] = useState('MZN')
  const [exporting, setExporting] = useState(false)

  const [search, setSearch] = useState('')
  const [itemFilter, setItemFilter] = useState<string>('all')
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all')
  const [riskFilter, setRiskFilter] = useState<StockRiskFilter>('all')
  const [sortBy, setSortBy] = useState<SortOption>('value_desc')
  const [stockSort, setStockSort] = useState<PremiumDataTableSortState>({ columnId: 'totalValue', direction: 'desc' })
  const [stockColumnVisibility, setStockColumnVisibility] = useState<PremiumColumnVisibilityState>({})
  const [stockPage, setStockPage] = useState(1)
  const [stockPageSize, setStockPageSize] = useState(10)

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
        .select('id,sku,name,min_stock,reorder_point,base_uom_id')
        .eq('company_id', companyId)
        .order('name', { ascending: true })
      if (itemError) throw itemError
      setItems((itemsData ?? []) as Item[])

      const { data: uomData, error: uomError } = await supabase
        .from('uoms')
        .select('id,code')
      if (uomError) throw uomError
      setUoms((uomData ?? []) as Uom[])

      const warehouseIds = whs.map((warehouse) => warehouse.id)
      if (!warehouseIds.length) {
        setStockLevels([])
        return
      }

      const { data: stockData, error: stockError } = await supabase
        .from('stock_levels')
        .select('id,item_id,warehouse_id,qty,allocated_qty,avg_cost,updated_at')
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
  const uomById = useMemo(() => new Map(uoms.map((uom) => [uom.id, uom])), [uoms])

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const grouped = new Map<string, {
      itemId: string
      warehouseId: string
      onHandQty: number
      allocatedQty: number
      totalValue: number
    }>()

    for (const stockLevel of stockLevels) {
      const key = `${stockLevel.item_id}:${stockLevel.warehouse_id}`
      const current = grouped.get(key) ?? {
        itemId: stockLevel.item_id,
        warehouseId: stockLevel.warehouse_id,
        onHandQty: 0,
        allocatedQty: 0,
        totalValue: 0,
      }
      const bucketQty = Number(stockLevel.qty ?? 0)
      current.onHandQty += bucketQty
      current.allocatedQty += Number(stockLevel.allocated_qty ?? 0)
      current.totalValue += bucketQty * Number(stockLevel.avg_cost ?? 0)
      grouped.set(key, current)
    }

    const mapped = Array.from(grouped.entries())
      .map(([id, position]) => {
        const item = itemById.get(position.itemId)
        const warehouse = warehouseById.get(position.warehouseId)
        const { onHandQty, allocatedQty, totalValue } = position
        const avgCost = onHandQty === 0 ? 0 : totalValue / onHandQty
        const thresholdConfigured = item?.min_stock != null || item?.reorder_point != null
        const minStock = Number(item?.min_stock ?? item?.reorder_point ?? 0)
        const shortageQty = minStock > 0 ? Math.max(minStock - onHandQty, 0) : 0
        const status: StockStatus =
          onHandQty < 0
            ? 'negative'
            : onHandQty === 0
              ? 'out'
              : !thresholdConfigured
                ? 'threshold_unconfigured'
                : shortageQty > 0 ? 'low' : 'healthy'

        return {
          id,
          itemId: position.itemId,
          itemName: item?.name || tt('stock.integrity.unknownItem', 'Unknown item reference'),
          sku: item?.sku || '',
          warehouseId: position.warehouseId,
          warehouseName: warehouse?.name || tt('stock.integrity.unknownWarehouse', 'Unknown warehouse reference'),
          warehouseCode: warehouse?.code || '',
          onHandQty,
          allocatedQty,
          availableQty: onHandQty - allocatedQty,
          uomCode: uomById.get(item?.base_uom_id || '')?.code || tt('stock.uomUnknown', 'UoM unavailable'),
          avgCost,
          totalValue,
          minStock,
          thresholdConfigured,
          shortageQty,
          status,
          integrityIssue: !item || !warehouse,
        } satisfies StockRow
      })
      .filter((row) => (itemFilter === 'all' ? true : row.itemId === itemFilter))
      .filter((row) => (warehouseFilter === 'all' ? true : row.warehouseId === warehouseFilter))
      .filter((row) => (riskFilter === 'all' ? true : row.status === riskFilter))
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
          const riskRank = { negative: 0, out: 1, low: 2, threshold_unconfigured: 3, healthy: 4 }
          const statusSort = riskRank[left.status] - riskRank[right.status]
          if (statusSort !== 0) return statusSort
          return right.shortageQty - left.shortageQty
        }
        case 'value_desc':
        default:
          return right.totalValue - left.totalValue
      }
    })
  }, [itemById, itemFilter, riskFilter, search, sortBy, stockLevels, tt, uomById, warehouseById, warehouseFilter])

  const totals = useMemo(() => {
    const totalValue = rows.reduce((sum, row) => sum + row.totalValue, 0)
    const attention = rows.filter((row) => row.status !== 'healthy').length
    const critical = rows.filter((row) => row.status === 'out' || row.status === 'negative').length
    return {
      totalValue,
      attention,
      critical,
      positions: rows.length,
      warehouseCount: new Set(rows.map((row) => row.warehouseId)).size,
    }
  }, [rows])

  useEffect(() => {
    setStockPage(1)
  }, [itemFilter, riskFilter, search, sortBy, warehouseFilter])

  const activeWarehouse = warehouseFilter === 'all' ? null : warehouses.find((warehouse) => warehouse.id === warehouseFilter)

  const formatCurrency = (value: number) => formatMoneyBase(value, baseCode)
  const statusLabel = (status: StockStatus) => {
    if (status === 'negative') return tt('stock.status.negative', 'Negative stock')
    if (status === 'out') return tt('stock.status.out', 'Out of stock')
    if (status === 'low') return tt('stock.status.low', 'Low stock')
    if (status === 'threshold_unconfigured') return tt('stock.status.thresholdUnconfigured', 'Minimum threshold not configured')
    return tt('stock.status.healthy', 'Healthy')
  }

  const statusTone = (status: StockStatus): PremiumTone => {
    if (status === 'out' || status === 'negative') return 'critical'
    if (status === 'low' || status === 'threshold_unconfigured') return 'warning'
    return 'positive'
  }

  const paginationLabels = {
    rowsPerPage: tt('register.rowsPerPage', 'Rows'),
    previous: tt('register.previous', 'Previous'),
    next: tt('register.next', 'Next'),
    pageSummary: (page: number, total: number) =>
      tt('register.pageSummary', 'Page {page} of {total}', { page, total }),
    rangeSummary: (from: number, to: number, total: number) =>
      tt('register.rangeSummary', '{from}-{to} of {total}', { from, to, total }),
  }

  const stockColumns: PremiumDataTableColumn<StockRow>[] = [
    {
      id: 'item',
      header: tt('table.item', 'Item'),
      cell: (row) => (
        <div className="min-w-0 space-y-1">
          <div className="font-medium">{row.itemName}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.sku || tt('common.dash', '-')}</div>
        </div>
      ),
      sortValue: (row) => row.itemName,
      minWidth: 220,
      enableHiding: false,
    },
    {
      id: 'warehouse',
      header: tt('warehouses.warehouse', 'Warehouse'),
      cell: (row) => (
        <div className="min-w-0 space-y-1">
          <div className="font-medium">{row.warehouseName}</div>
          <div className="font-mono text-xs text-muted-foreground">{row.warehouseCode || tt('common.dash', '-')}</div>
        </div>
      ),
      sortValue: (row) => row.warehouseName,
      minWidth: 190,
      enableHiding: false,
    },
    {
      id: 'qty',
      header: tt('table.onHand', 'On hand'),
      cell: (row) => (
        <div className="text-right">
          <div className="font-mono font-medium tabular-nums">{formatQuantity(row.onHandQty)}</div>
          <div className="text-xs text-muted-foreground">{row.uomCode}</div>
        </div>
      ),
      sortValue: (row) => row.onHandQty,
      align: 'right',
      minWidth: 120,
    },
    {
      id: 'available',
      header: tt('stock.available', 'Available'),
      cell: (row) => (
        <div className="text-right">
          <div className="font-mono tabular-nums">{formatQuantity(row.availableQty)}</div>
          {row.allocatedQty > 0 ? <div className="text-xs text-muted-foreground">{tt('stock.allocated', '{qty} allocated', { qty: formatQuantity(row.allocatedQty) })}</div> : null}
        </div>
      ),
      sortValue: (row) => row.availableQty,
      align: 'right',
      minWidth: 130,
    },
    {
      id: 'minStock',
      header: tt('table.minStock', 'Min stock'),
      cell: (row) => <span className="font-mono tabular-nums">{row.thresholdConfigured ? `${formatQuantity(row.minStock)} ${row.uomCode}` : tt('stock.notConfigured', 'Not configured')}</span>,
      sortValue: (row) => row.minStock,
      align: 'right',
      minWidth: 120,
    },
    {
      id: 'avgCost',
      header: t('stock.avgCost'),
      cell: (row) => <span className="font-mono tabular-nums">{formatCurrency(row.avgCost)}</span>,
      sortValue: (row) => row.avgCost,
      align: 'right',
      minWidth: 140,
    },
    {
      id: 'totalValue',
      header: t('stock.totalValue'),
      cell: (row) => <span className="font-mono font-medium tabular-nums">{formatCurrency(row.totalValue)}</span>,
      sortValue: (row) => row.totalValue,
      align: 'right',
      minWidth: 150,
    },
    {
      id: 'status',
      header: tt('stock.status', 'Status'),
      cell: (row) => (
        <div className="flex flex-col gap-2">
          <PremiumStatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</PremiumStatusBadge>
          {row.shortageQty > 0 ? (
            <span className="text-xs text-muted-foreground">
              {tt('stock.shortBy', 'Short by {qty}', { qty: formatQuantity(row.shortageQty) })}
            </span>
          ) : null}
          {row.integrityIssue ? <PremiumStatusBadge tone="critical">{tt('stock.integrity.label', 'Data integrity warning')}</PremiumStatusBadge> : null}
        </div>
      ),
      sortValue: (row) => {
        const rank = { negative: 0, out: 1, low: 2, threshold_unconfigured: 3, healthy: 4 }
        return rank[row.status]
      },
      minWidth: 170,
    },
    {
      id: 'actions',
      header: tt('common.actions', 'Actions'),
      cell: () => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/movements">
              <ExternalLink className="h-4 w-4" />
              {tt('items.actions.movement', 'Movement')}
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/items">
              <ExternalLink className="h-4 w-4" />
              {tt('table.item', 'Item')}
            </Link>
          </Button>
        </div>
      ),
      align: 'right',
      minWidth: 210,
      enableHiding: false,
    },
  ]

  const sortedRows = sortPremiumRows(rows, stockColumns, stockSort)
  const pagedRows = getPremiumPageRows(sortedRows, stockPage, stockPageSize)

  const stockExportActions = (
    <PremiumImportExportActions
      exportAction={
        <Button onClick={() => void exportToExcel()} disabled={exporting}>
          <FileDown className="h-4 w-4" />
          {exporting ? t('actions.saving') : tt('export.xlsx', 'Export Excel')}
        </Button>
      }
    />
  )

  async function exportToExcel() {
    if (!companyId) return
    if (!rows.length) {
      toast(tt('stock.export.empty', 'There are no stock positions to export right now.'))
      return
    }

    try {
      setExporting(true)
      const company = await loadCompanyExportHeader(companyId)
      const selectedItem = itemFilter === 'all' ? null : items.find((item) => item.id === itemFilter)
      const filters = [
        `${tt('stock.export.baseCurrency', 'Base currency')}: ${baseCode}`,
        `${tt('warehouses.warehouse', 'Warehouse')}: ${activeWarehouse?.name || tt('filters.warehouse.all', 'All warehouses')}`,
        `${tt('stock.filters.status', 'Stock status')}: ${riskFilter === 'all' ? tt('stock.filters.statusAll', 'All statuses') : statusLabel(riskFilter)}`,
        `${tt('stock.sortBy', 'Sort by')}: ${tt(`stock.sort.${sortBy.replace('_desc', '').replace('_asc', '')}`, sortBy)}`,
      ]
      if (selectedItem) filters.push(`${tt('table.item', 'Item')}: ${selectedItem.name} (${selectedItem.sku})`)
      if (search.trim()) filters.push(`${tt('common.search', 'Search')}: ${search.trim()}`)

      await exportExcelReport({
        filename: `stock_levels_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: tt('nav.stockLevels', 'Stock Levels'),
        title: tt('stock.export.title', 'Inventory valuation report'),
        subtitle: tt('stock.export.subtitle', 'On-hand quantity, weighted average cost, and stock value by warehouse.'),
        filters,
        company,
        labels: {
          generated: tt('export.generated', 'Generated'),
          filters: tt('export.filters', 'Filters'),
          taxId: tt('company.taxId', 'Tax ID'),
          email: tt('common.email', 'Email'),
          phone: tt('common.phone', 'Phone'),
        },
        columns: [
          { label: tt('table.item', 'Item'), value: (row) => row.itemName, width: 30 },
          { label: tt('table.sku', 'SKU'), value: (row) => row.sku || tt('common.dash', '—'), width: 16 },
          { label: tt('warehouses.warehouse', 'Warehouse'), value: (row) => row.warehouseName, width: 20 },
          { label: tt('table.onHand', 'On hand'), value: (row) => `${row.onHandQty} ${row.uomCode}`, width: 16 },
          { label: tt('stock.available', 'Available'), value: (row) => `${row.availableQty} ${row.uomCode}`, width: 16 },
          { label: tt('table.minStock', 'Min stock'), value: (row) => row.thresholdConfigured ? `${row.minStock} ${row.uomCode}` : tt('stock.notConfigured', 'Not configured'), width: 16 },
          { label: `${tt('stock.avgCost', 'Average cost')} (${baseCode})`, value: (row) => row.avgCost, type: 'currency', width: 16 },
          { label: `${tt('stock.totalValue', 'Total value')} (${baseCode})`, value: (row) => row.totalValue, type: 'currency', width: 18 },
          { label: tt('stock.status', 'Status'), value: (row) => statusLabel(row.status), width: 16 },
          { label: tt('stock.shortage', 'Shortage'), value: (row) => row.shortageQty, type: 'number', width: 14 },
        ],
        rows,
      })
      toast.success(t('export.done'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('stock.export.failed', 'Failed to generate the Excel export'))
    } finally {
      setExporting(false)
    }
  }

  if (!companyId) {
    return (
      <div className="app-page app-page--workspace flex h-64 items-center justify-center">
        <p className="text-muted-foreground">{t('org.noCompany') ?? ''}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="app-page app-page--workspace space-y-6">
        <PremiumSkeleton className="min-h-44" lines={4} />
        <div className="grid gap-4 md:grid-cols-3">
          <PremiumSkeleton lines={2} />
          <PremiumSkeleton lines={2} />
          <PremiumSkeleton lines={2} />
        </div>
        <PremiumSkeleton className="min-h-80" lines={7} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="app-page app-page--workspace">
        <PremiumStatePanel
          kind="error"
          icon={<AlertTriangle />}
          title={tt('stock.loadErrorTitle', 'Stock levels unavailable')}
          description={tt('stock.loadErrorBody', 'StockWise could not confirm the current inventory balances. Retry before relying on quantities or valuation.')}
          action={<Button onClick={() => void loadData()}>{t('common.retry') ?? 'Retry'}</Button>}
        />
      </div>
    )
  }

  const stockEmptyState = (
    <PremiumEmptyState
      icon={<Package />}
      title={
        search || itemFilter !== 'all' || warehouseFilter !== 'all' || riskFilter !== 'all'
          ? tt('stock.empty.filteredTitle', 'No stock positions match the current filters.')
          : t('stock.none')
      }
      description={
        search || itemFilter !== 'all' || warehouseFilter !== 'all' || riskFilter !== 'all'
          ? tt('stock.empty.filteredBody', 'Clear or relax the filters to widen the stock view.')
          : tt('stock.empty.defaultBody', 'Receive stock or post movements to start building a live valuation view.')
      }
    />
  )

  return (
    <div className="app-page app-page--workspace space-y-6">
      <PremiumRegisterHeader
        eyebrow={tt('stock.eyebrow', 'Inventory valuation')}
        title={t('nav.stockLevels')}
        description={tt('stock.description', 'Read-only inventory position by warehouse. Quantities remain in each item base unit and value uses weighted average cost.')}
        badges={
          <>
            <PremiumStatusBadge tone="info" icon={<CircleDollarSign />}>
              {tt('stock.export.baseCurrency', 'Base currency')}: {baseCode}
            </PremiumStatusBadge>
            <PremiumStatusBadge tone="neutral" icon={<WarehouseIcon />}>
              {activeWarehouse
                ? `${tt('warehouses.warehouse', 'Warehouse')}: ${activeWarehouse.name}`
                : tt('filters.warehouse.all', 'All warehouses')}
            </PremiumStatusBadge>
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void loadData()}>
              <RefreshCw className="h-4 w-4" />
              {t('common.refresh') ?? 'Refresh'}
            </Button>
            {stockExportActions}
          </>
        }
        metrics={
          <>
            <PremiumMetricCard
              label={tt('stock.summary.value', 'Inventory value')}
              value={formatCurrency(totals.totalValue)}
              description={tt('stock.summary.valueHelp', 'Value of the filtered stock position using average cost.')}
              icon={<CircleDollarSign />}
              tone="positive"
            />
            <PremiumMetricCard
              label={tt('stock.summary.positions', 'Stock positions')}
              value={totals.positions}
              description={tt('stock.summary.positionsHelp', 'Item and warehouse positions in the current filtered result; mixed units are not added together.')}
              icon={<Boxes />}
            />
            <PremiumMetricCard
              label={tt('stock.summary.attention', 'Positions needing attention')}
              value={totals.attention}
              description={tt('stock.summary.lowHelp', 'Includes {count} zero or negative positions.', { count: totals.critical })}
              icon={<AlertTriangle />}
              tone={totals.attention > 0 ? 'warning' : 'positive'}
            />
            <PremiumMetricCard
              label={tt('stock.summary.coverage', 'Warehouse coverage')}
              value={totals.warehouseCount}
              description={tt('stock.summary.coverageHelp', 'Warehouses represented in the current filtered result.')}
              icon={<WarehouseIcon />}
              tone="info"
            />
          </>
        }
      />

      <PremiumTableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('stock.searchPlaceholder') ?? ''}
        searchLabel={t('common.search') ?? 'Search'}
        filters={
          <>
            <PremiumTableFilter label={t('table.item')}>
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
            </PremiumTableFilter>
            <PremiumTableFilter label={t('warehouses.warehouse')}>
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
            </PremiumTableFilter>
            <PremiumTableFilter label={tt('stock.filters.status', 'Stock status')}>
              <Select value={riskFilter} onValueChange={(value) => setRiskFilter(value as StockRiskFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tt('stock.filters.statusAll', 'All statuses')}</SelectItem>
                  <SelectItem value="healthy">{statusLabel('healthy')}</SelectItem>
                  <SelectItem value="low">{statusLabel('low')}</SelectItem>
                  <SelectItem value="out">{statusLabel('out')}</SelectItem>
                  <SelectItem value="negative">{statusLabel('negative')}</SelectItem>
                  <SelectItem value="threshold_unconfigured">{statusLabel('threshold_unconfigured')}</SelectItem>
                </SelectContent>
              </Select>
            </PremiumTableFilter>
            <PremiumTableFilter label={tt('stock.sortBy', 'Sort by')}>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="value_desc">{tt('stock.sort.value', 'Value (high to low)')}</SelectItem>
                  <SelectItem value="qty_desc">{tt('stock.sort.qty', 'Quantity (high to low)')}</SelectItem>
                  <SelectItem value="risk_desc">{tt('stock.sort.risk', 'Stock risk first')}</SelectItem>
                  <SelectItem value="item_asc">{tt('stock.sort.item', 'Item name')}</SelectItem>
                  <SelectItem value="warehouse_asc">{tt('stock.sort.warehouse', 'Warehouse name')}</SelectItem>
                </SelectContent>
              </Select>
            </PremiumTableFilter>
          </>
        }
        actions={
          <>
            <PremiumColumnVisibilityMenu
              columns={stockColumns}
              visibility={stockColumnVisibility}
              onVisibilityChange={setStockColumnVisibility}
              label={tt('register.columns', 'Columns')}
              menuLabel={tt('register.visibleColumns', 'Visible columns')}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearch('')
                setItemFilter('all')
                setWarehouseFilter('all')
                setRiskFilter('all')
                setSortBy('value_desc')
              }}
            >
              <FilterX className="h-4 w-4" />
              {t('common.clear')}
            </Button>
          </>
        }
        summary={
          <div className="flex flex-wrap items-center gap-2">
            <span>{tt('stock.registerCount', '{count} stock positions in view', { count: rows.length })}</span>
            {totals.attention > 0 ? (
              <PremiumStatusBadge tone="warning" icon={<AlertTriangle />}>
                {tt('stock.resultsAttention', '{count} positions need attention', { count: totals.attention })}
              </PremiumStatusBadge>
            ) : null}
          </div>
        }
      />

      <div className="rounded-[calc(var(--radius)+0.25rem)] border border-card-border bg-card p-3 shadow-[0_20px_48px_-36px_hsl(var(--foreground)/0.24)] sm:p-4">
        {isMobile ? (
          <PremiumMobileCardList
            rows={pagedRows}
            getRowId={(row) => row.id}
            emptyState={stockEmptyState}
            pagination={{
              page: stockPage,
              pageSize: stockPageSize,
              totalItems: sortedRows.length,
              onPageChange: setStockPage,
              onPageSizeChange: (nextPageSize) => {
                setStockPageSize(nextPageSize)
                setStockPage(1)
              },
              labels: paginationLabels,
            }}
            renderCard={(row) => (
              <article className="rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-surface-elevated p-4 shadow-[0_16px_34px_-30px_hsl(var(--foreground)/0.34)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.itemName}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{row.sku || tt('common.dash', '-')}</div>
                  </div>
                  <PremiumStatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</PremiumStatusBadge>
                </div>

                <div className="mt-3 rounded-xl border border-card-border bg-surface-muted/35 p-3">
                  <div className="premium-label">{tt('warehouses.warehouse', 'Warehouse')}</div>
                  <div className="mt-1 text-sm font-medium">{row.warehouseName}</div>
                  <div className="font-mono text-xs text-muted-foreground">{row.warehouseCode || tt('common.dash', '-')}</div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-card-border bg-surface-muted/35 p-3">
                    <div className="premium-label">{tt('table.onHand', 'On hand')}</div>
                    <div className="mt-1 text-sm font-semibold">{formatQuantity(row.onHandQty)} {row.uomCode}</div>
                  </div>
                  <div className="rounded-xl border border-card-border bg-surface-muted/35 p-3">
                    <div className="premium-label">{tt('table.minStock', 'Min stock')}</div>
                    <div className="mt-1 text-sm font-semibold">{row.thresholdConfigured ? `${formatQuantity(row.minStock)} ${row.uomCode}` : tt('stock.notConfigured', 'Not configured')}</div>
                  </div>
                  <div className="rounded-xl border border-card-border bg-surface-muted/35 p-3">
                    <div className="premium-label">{t('stock.avgCost')}</div>
                    <div className="mt-1 text-sm font-semibold">{formatCurrency(row.avgCost)}</div>
                  </div>
                  <div className="rounded-xl border border-card-border bg-surface-muted/35 p-3">
                    <div className="premium-label">{t('stock.totalValue')}</div>
                    <div className="mt-1 text-sm font-semibold">{formatCurrency(row.totalValue)}</div>
                  </div>
                </div>

                {row.shortageQty > 0 ? (
                  <div className="mt-3 text-sm text-muted-foreground">
                    {tt('stock.shortBy', 'Short by {qty}', { qty: formatQuantity(row.shortageQty) })}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/movements">
                      <ExternalLink className="h-4 w-4" />
                      {tt('items.actions.movement', 'Movement')}
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/items">
                      <PackageSearch className="h-4 w-4" />
                      {tt('table.item', 'Item')}
                    </Link>
                  </Button>
                </div>
              </article>
            )}
          />
        ) : (
          <PremiumDataTable
            rows={rows}
            columns={stockColumns}
            getRowId={(row) => row.id}
            sort={stockSort}
            onSortChange={setStockSort}
            columnVisibility={stockColumnVisibility}
            ariaLabel={t('nav.stockLevels')}
            emptyState={stockEmptyState}
            rowClassName={(row) =>
              row.status === 'out' || row.status === 'negative' ? 'bg-destructive/5' : row.status === 'low' || row.status === 'threshold_unconfigured' ? 'bg-amber-500/5' : undefined
            }
            pagination={{
              page: stockPage,
              pageSize: stockPageSize,
              onPageChange: setStockPage,
              onPageSizeChange: (nextPageSize) => {
                setStockPageSize(nextPageSize)
                setStockPage(1)
              },
              labels: paginationLabels,
            }}
          />
        )}
      </div>
    </div>
  )
}

export default StockLevels
