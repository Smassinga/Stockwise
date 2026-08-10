import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type FinanceSummaryTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const valueToneClasses: Record<FinanceSummaryTone, string> = {
  neutral: 'text-foreground',
  success: 'text-status-success-foreground',
  warning: 'text-status-warning-foreground',
  danger: 'text-status-danger-foreground',
  info: 'text-status-info-foreground',
}

export type FinanceSummaryItem = {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  tone?: FinanceSummaryTone
}

const columnClasses: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
  5: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
  6: 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6',
}

export function FinanceSummaryBand({
  label,
  items,
  className,
}: {
  label: string
  items: FinanceSummaryItem[]
  className?: string
}) {
  return (
    <section aria-label={label} className={cn('border-y border-border', className)}>
      <dl className={cn('grid', columnClasses[Math.min(Math.max(items.length, 1), 6)])}>
        {items.map((item, index) => (
          <div
            key={index}
            className="min-w-0 border-b border-border px-0 py-4 last:border-b-0 sm:border-b-0 sm:border-l sm:px-5 sm:first:border-l-0 sm:first:pl-0 sm:last:pr-0"
          >
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {item.label}
            </dt>
            <dd className={cn('mt-2 break-words text-xl font-semibold tracking-tight tabular-nums', valueToneClasses[item.tone ?? 'neutral'])}>
              {item.value}
            </dd>
            {item.detail ? <dd className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  )
}
