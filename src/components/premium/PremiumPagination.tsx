import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { cn } from '../../lib/utils'

export type PremiumPaginationLabels = {
  rowsPerPage?: ReactNode
  previous?: ReactNode
  next?: ReactNode
  pageSummary?: (page: number, totalPages: number) => ReactNode
  rangeSummary?: (from: number, to: number, total: number) => ReactNode
}

export function getPremiumTotalPages(totalItems: number, pageSize: number) {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(totalItems / pageSize))
}

export function getPremiumPageRows<T>(rows: T[], page: number, pageSize: number) {
  const totalPages = getPremiumTotalPages(rows.length, pageSize)
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const start = (safePage - 1) * pageSize
  return rows.slice(start, start + pageSize)
}

export function PremiumPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  labels,
  className,
}: {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  labels?: PremiumPaginationLabels
  className?: string
}) {
  const totalPages = getPremiumTotalPages(totalItems, pageSize)
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const from = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, totalItems)

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-card-border bg-surface-muted/35 px-3 py-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="text-xs text-muted-foreground">
        {labels?.rangeSummary ? labels.rangeSummary(from, to, totalItems) : `${from}-${to} of ${totalItems}`}
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {onPageSizeChange ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{labels?.rowsPerPage ?? 'Rows'}</span>
            <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
              <SelectTrigger className="h-9 w-[5.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage <= 1}
            aria-label={String(labels?.previous ?? 'Previous')}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{labels?.previous ?? 'Previous'}</span>
          </Button>
          <div className="min-w-24 text-center text-xs text-muted-foreground">
            {labels?.pageSummary ? labels.pageSummary(safePage, totalPages) : `Page ${safePage} of ${totalPages}`}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages}
            aria-label={String(labels?.next ?? 'Next')}
          >
            <span className="hidden sm:inline">{labels?.next ?? 'Next'}</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
