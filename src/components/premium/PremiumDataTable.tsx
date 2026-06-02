import type { CSSProperties, ReactNode } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, Inbox } from 'lucide-react'
import { Button } from '../ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { cn } from '../../lib/utils'
import { PremiumEmptyState } from './PremiumEmptyState'
import { PremiumPagination, getPremiumPageRows, type PremiumPaginationLabels } from './PremiumPagination'

export type PremiumDataTableSortDirection = 'asc' | 'desc'

export type PremiumDataTableSortState = {
  columnId: string
  direction: PremiumDataTableSortDirection
}

export type PremiumColumnVisibilityState = Record<string, boolean>

export type PremiumDataTableColumn<T> = {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  sortValue?: (row: T) => string | number | boolean | Date | null | undefined
  align?: 'left' | 'center' | 'right'
  className?: string
  headerClassName?: string
  minWidth?: number | string
  enableHiding?: boolean
  skeleton?: ReactNode
}

function comparePremiumValues(left: unknown, right: unknown) {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1

  const leftValue = left instanceof Date ? left.getTime() : left
  const rightValue = right instanceof Date ? right.getTime() : right

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue
  }

  if (typeof leftValue === 'boolean' && typeof rightValue === 'boolean') {
    return Number(leftValue) - Number(rightValue)
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function alignmentClass(align?: PremiumDataTableColumn<unknown>['align']) {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
}

function widthStyle(width?: number | string): CSSProperties | undefined {
  if (!width) return undefined
  return { minWidth: typeof width === 'number' ? `${width}px` : width }
}

export function sortPremiumRows<T>(
  rows: T[],
  columns: PremiumDataTableColumn<T>[],
  sort?: PremiumDataTableSortState | null,
) {
  if (!sort) return rows
  const column = columns.find((item) => item.id === sort.columnId)
  if (!column?.sortValue) return rows
  const direction = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((left, right) => comparePremiumValues(column.sortValue!(left), column.sortValue!(right)) * direction)
}

export function getVisiblePremiumColumns<T>(
  columns: PremiumDataTableColumn<T>[],
  visibility?: PremiumColumnVisibilityState,
) {
  return columns.filter((column) => column.enableHiding === false || visibility?.[column.id] !== false)
}

export function PremiumDataTable<T>({
  rows,
  columns,
  getRowId,
  loading = false,
  error,
  emptyState,
  sort,
  onSortChange,
  columnVisibility,
  pagination,
  rowClassName,
  ariaLabel,
  skeletonRows = 5,
  className,
}: {
  rows: T[]
  columns: PremiumDataTableColumn<T>[]
  getRowId: (row: T) => string
  loading?: boolean
  error?: ReactNode
  emptyState?: ReactNode
  sort?: PremiumDataTableSortState | null
  onSortChange?: (sort: PremiumDataTableSortState) => void
  columnVisibility?: PremiumColumnVisibilityState
  pagination?: {
    page: number
    pageSize: number
    onPageChange: (page: number) => void
    onPageSizeChange?: (pageSize: number) => void
    pageSizeOptions?: number[]
    labels?: PremiumPaginationLabels
  }
  rowClassName?: (row: T) => string | undefined
  ariaLabel?: string
  skeletonRows?: number
  className?: string
}) {
  const visibleColumns = getVisiblePremiumColumns(columns, columnVisibility)
  const sortedRows = sortPremiumRows(rows, columns, sort)
  const displayRows = pagination ? getPremiumPageRows(sortedRows, pagination.page, pagination.pageSize) : sortedRows

  const toggleSort = (column: PremiumDataTableColumn<T>) => {
    if (!column.sortValue || !onSortChange) return
    const direction: PremiumDataTableSortDirection =
      sort?.columnId === column.id && sort.direction === 'asc' ? 'desc' : 'asc'
    onSortChange({ columnId: column.id, direction })
  }

  if (error) {
    return (
      <PremiumEmptyState
        icon={<AlertCircle />}
        title={error}
        compact
        className={className}
      />
    )
  }

  if (!loading && rows.length === 0) {
    return <>{emptyState ?? <PremiumEmptyState icon={<Inbox />} title="No rows found" compact className={className} />}</>
  }

  return (
    <div className={cn('space-y-3', className)}>
      <Table aria-label={ariaLabel}>
        <TableHeader>
          <TableRow>
            {visibleColumns.map((column) => {
              const sorted = sort?.columnId === column.id
              const SortIcon = !sorted ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown
              return (
                <TableHead
                  key={column.id}
                  className={cn(alignmentClass(column.align), column.headerClassName)}
                  style={widthStyle(column.minWidth)}
                >
                  {column.sortValue && onSortChange ? (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex max-w-full items-center gap-1.5 rounded-md py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                        column.align === 'right' && 'ml-auto justify-end',
                      )}
                      onClick={() => toggleSort(column)}
                      aria-label={`Sort by ${String(column.header)}`}
                    >
                      <span className="truncate">{column.header}</span>
                      <SortIcon className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  ) : (
                    column.header
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {visibleColumns.map((column, columnIndex) => (
                    <TableCell key={`${column.id}-${rowIndex}`} className={cn(alignmentClass(column.align), column.className)}>
                      {column.skeleton ?? (
                        <div
                          className={cn(
                            'h-3 rounded-full bg-muted',
                            columnIndex === 0 ? 'w-36' : column.align === 'right' ? 'ml-auto w-20' : 'w-24',
                          )}
                        />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : displayRows.map((row) => (
                <TableRow key={getRowId(row)} className={rowClassName?.(row)}>
                  {visibleColumns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(alignmentClass(column.align), column.className)}
                      style={widthStyle(column.minWidth)}
                    >
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>

      {pagination && rows.length > 0 ? (
        <PremiumPagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalItems={rows.length}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          pageSizeOptions={pagination.pageSizeOptions}
          labels={pagination.labels}
        />
      ) : null}
    </div>
  )
}
