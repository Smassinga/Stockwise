import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function PremiumBulkActionBar({
  selectedCount,
  label,
  actions,
  className,
}: {
  selectedCount: number
  label?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  if (selectedCount <= 0) return null

  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="text-sm font-medium text-foreground">{label ?? `${selectedCount} selected`}</div>
      {actions ? <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div> : null}
    </div>
  )
}
