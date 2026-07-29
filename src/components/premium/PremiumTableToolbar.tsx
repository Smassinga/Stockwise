import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

export function PremiumTableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchLabel = 'Search',
  filters,
  actions,
  summary,
  className,
}: {
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  searchLabel?: string
  filters?: ReactNode
  actions?: ReactNode
  summary?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-3 rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-3 shadow-[0_18px_42px_-36px_hsl(var(--foreground)/0.34)] sm:p-4', className)}>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(16rem,1.2fr)_minmax(0,2fr)_auto] xl:items-end">
        <div className="min-w-0">
          {onSearchChange ? (
            <label className="relative block">
              <span className="sr-only">{searchLabel}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue ?? ''}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={searchPlaceholder}
                className="pl-10"
              />
            </label>
          ) : null}
        </div>
        {filters ? <div className="grid min-w-0 grid-cols-1 gap-3 min-[430px]:grid-cols-2 md:grid-cols-2 xl:grid-cols-3">{filters}</div> : <div />}
        {actions ? <div className="flex flex-wrap items-end gap-2 xl:justify-end">{actions}</div> : null}
      </div>
      {summary ? <div className="premium-meta">{summary}</div> : null}
    </div>
  )
}
