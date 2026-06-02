import type { ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'
import { cn } from '../../lib/utils'
import { PremiumEmptyState } from './PremiumEmptyState'
import { PremiumPagination, type PremiumPaginationLabels } from './PremiumPagination'
import { PremiumSkeleton } from './PremiumSkeleton'

export function PremiumMobileCardList<T>({
  rows,
  getRowId,
  renderCard,
  loading = false,
  error,
  emptyState,
  pagination,
  className,
}: {
  rows: T[]
  getRowId: (row: T) => string
  renderCard: (row: T) => ReactNode
  loading?: boolean
  error?: ReactNode
  emptyState?: ReactNode
  pagination?: {
    page: number
    pageSize: number
    totalItems: number
    onPageChange: (page: number) => void
    onPageSizeChange?: (pageSize: number) => void
    pageSizeOptions?: number[]
    labels?: PremiumPaginationLabels
  }
  className?: string
}) {
  if (error) {
    return <PremiumEmptyState icon={<AlertCircle />} title={error} compact className={className} />
  }

  if (loading) {
    return (
      <div className={cn('mobile-register-list space-y-3', className)}>
        {Array.from({ length: 3 }).map((_, index) => (
          <PremiumSkeleton key={index} lines={4} />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return <>{emptyState ?? <PremiumEmptyState icon={<Inbox />} title="No rows found" compact className={className} />}</>
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="mobile-register-list space-y-3">
        {rows.map((row) => (
          <div key={getRowId(row)}>{renderCard(row)}</div>
        ))}
      </div>
      {pagination ? (
        <PremiumPagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
          pageSizeOptions={pagination.pageSizeOptions}
          labels={pagination.labels}
        />
      ) : null}
    </div>
  )
}
