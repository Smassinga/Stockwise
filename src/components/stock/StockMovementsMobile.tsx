import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'

type MovementType = 'receive' | 'issue' | 'transfer' | 'adjust'

type MovementLogRow = {
  id: string
  item_id: string
  type: MovementType
  qty_base?: number | null
  unit_cost?: number | null
  total_value?: number | null
  warehouse_from_id?: string | null
  warehouse_to_id?: string | null
  bin_from_id?: string | null
  bin_to_id?: string | null
  ref_type?: string | null
  ref_id?: string | null
  notes?: string | null
  created_at: string
}

type ItemRow = {
  id: string
  name: string
  sku: string | null
}

type BinContentGroup = {
  key: string
  label: string
  totalQty: number
  rows: Array<{
    item: {
      id: string
      name: string
      sku: string | null
    }
    onHandQty: number
    avgCost: number
  }>
}

type Translator = (key: string, fallback: string) => string

export function StockMovementMobileBinContents({
  hasSelection,
  groups,
  tt,
  formatValue,
}: {
  hasSelection: boolean
  groups: BinContentGroup[]
  tt: Translator
  formatValue: (value: number) => string
}) {
  if (!hasSelection) {
    return <div className="text-sm text-muted-foreground">{tt('movements.pickBinToSee', 'Pick a bin to see contents')}</div>
  }

  if (!groups.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-6 text-sm text-muted-foreground">
        {tt('movements.emptyBin', 'Empty bin')}
      </div>
    )
  }

  return (
    <div className="mobile-register-list space-y-3">
      {groups.map((group) => (
        <div key={group.key} className="rounded-2xl border border-border/70 bg-background/92 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">{group.label}</div>
            <Badge variant="outline">
              {tt('movements.total', 'Total')}: {formatValue(group.totalQty)}
            </Badge>
          </div>
          <div className="mt-3 space-y-2">
            {group.rows.map((row) => (
              <div key={row.item.id} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{row.item.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.item.sku ?? ''}</div>
                  </div>
                  <div className="text-right text-sm font-semibold">{formatValue(row.onHandQty)}</div>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{tt('movements.avgCost', 'Avg Cost')}</span>
                  <span>{formatValue(row.avgCost)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function StockMovementMobileLog({
  rows,
  items,
  lang,
  tt,
  expandedMovementId,
  onToggleDetails,
  movementTypeBadge,
  warehouseLabel,
  refLabel,
  formatValue,
  loading,
}: {
  rows: MovementLogRow[]
  items: ItemRow[]
  lang: string
  tt: Translator
  expandedMovementId: string
  onToggleDetails: (id: string) => void
  movementTypeBadge: (type: MovementType) => ReactNode
  warehouseLabel: (warehouseId?: string | null, binId?: string | null) => string
  refLabel: (row: MovementLogRow) => string
  formatValue: (value: number) => string
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-6 text-center text-sm text-muted-foreground">
        {tt('loading', 'Loading')}
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-muted/15 px-4 py-6 text-center text-sm text-muted-foreground">
        {tt('movements.logEmpty', 'No movements match the current filters.')}
      </div>
    )
  }

  return (
    <div className="mobile-register-list space-y-3">
      {rows.map((row) => {
        const item = items.find((entry) => entry.id === row.item_id)
        const detailsOpen = expandedMovementId === row.id
        const orderHref = row.ref_type === 'SO' && row.ref_id
          ? `/orders?tab=sales&orderId=${row.ref_id}`
          : row.ref_type === 'PO' && row.ref_id
            ? `/orders?tab=purchase&orderId=${row.ref_id}`
            : ''

        return (
          <div key={row.id} className="rounded-2xl border border-border/70 bg-background/92 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString(lang)}</div>
                <div className="mt-1 truncate font-medium">{item?.name || row.item_id}</div>
                <div className="truncate text-xs text-muted-foreground">{item?.sku || ''}</div>
              </div>
              {movementTypeBadge(row.type)}
            </div>

            <div className="mt-3 rounded-2xl border border-border/60 bg-muted/20 p-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('movements.route', 'Route')}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                <div>{warehouseLabel(row.warehouse_from_id, row.bin_from_id)}</div>
                <div className="mt-1">-&gt; {warehouseLabel(row.warehouse_to_id, row.bin_to_id)}</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('table.qtyBase', 'Qty (base)')}</div>
                <div className="mt-1 text-sm font-semibold">{formatValue(Number(row.qty_base ?? 0))}</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('movements.avgCost', 'Unit Cost')}</div>
                <div className="mt-1 text-sm font-semibold">{formatValue(Number(row.unit_cost ?? 0))}</div>
              </div>
            </div>

            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('table.ref', 'Ref')}</div>
              <div className="mt-1 truncate font-medium">{refLabel(row)}</div>
            </div>

            {detailsOpen ? (
              <div className="mt-3 space-y-2 rounded-2xl border border-border/60 bg-muted/20 p-3 text-sm">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('table.notes', 'Notes')}</div>
                  <div className="mt-1 text-muted-foreground">{row.notes || '-'}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('table.value', 'Value')}</div>
                  <div className="mt-1 font-mono tabular-nums">{formatValue(Number(row.total_value ?? 0))}</div>
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex flex-col gap-2">
              {orderHref ? (
                <Button asChild size="sm" variant="ghost" className="justify-start">
                  <Link to={orderHref}>{tt('movements.viewSource', 'View source')}</Link>
                </Button>
              ) : null}
              <Button size="sm" variant="outline" className="justify-start" onClick={() => onToggleDetails(row.id)}>
                {detailsOpen ? tt('common.hide', 'Hide') : tt('common.details', 'Details')}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
