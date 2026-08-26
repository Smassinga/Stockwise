import type { ReactNode } from 'react'
import { PremiumMetricCard } from '../premium/PremiumMetricCard'
import { cn } from '../../lib/utils'

type FinanceSummaryTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export type FinanceSummaryItem = {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  tone?: FinanceSummaryTone
}

const columnClasses: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 xl:grid-cols-3',
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
    <section
      aria-label={label}
      className={cn(
        'grid gap-3',
        columnClasses[Math.min(Math.max(items.length, 1), 6)],
        className,
      )}
    >
      {items.map((item, index) => (
        <PremiumMetricCard
          key={index}
          label={item.label}
          value={item.value}
          description={item.detail}
          tone={item.tone ?? 'neutral'}
        />
      ))}
    </section>
  )
}
