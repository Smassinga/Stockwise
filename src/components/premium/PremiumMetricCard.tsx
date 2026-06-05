import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { IconBadge } from './IconBadge'
import type { PremiumTone } from './PremiumStatusBadge'

const toneText: Record<PremiumTone, string> = {
  neutral: 'text-financial-neutral dark:text-panel-premium-muted',
  positive: 'text-financial-positive dark:text-emerald-200',
  negative: 'text-financial-negative dark:text-rose-200',
  warning: 'text-financial-warning dark:text-amber-200',
  critical: 'text-financial-critical dark:text-rose-200',
  info: 'text-sky-700 dark:text-sky-200',
}

export function PremiumMetricCard({
  label,
  value,
  description,
  meta,
  icon,
  tone = 'neutral',
  variant = 'default',
  className,
}: {
  label: ReactNode
  value: ReactNode
  description?: ReactNode
  meta?: ReactNode
  icon?: ReactNode
  tone?: PremiumTone
  variant?: 'default' | 'panel'
  className?: string
}) {
  const panel = variant === 'panel'

  return (
    <div
      className={cn(
        'min-w-0 rounded-[calc(var(--radius)+0.15rem)] border p-4 shadow-[0_18px_40px_-34px_hsl(var(--foreground)/0.34)]',
        panel
          ? 'border-card-border bg-surface-elevated text-card-foreground dark:border-panel-premium-border dark:bg-white/[0.055] dark:text-panel-premium-foreground'
          : 'border-card-border bg-card text-card-foreground',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={cn('premium-label truncate', panel && 'text-muted-foreground dark:text-panel-premium-muted')}>{label}</div>
          <div className={cn('mt-2 premium-kpi-value min-w-0 break-words', panel ? 'text-foreground dark:text-panel-premium-foreground' : toneText[tone])}>
            {value}
          </div>
        </div>
        {icon ? (
          <IconBadge tone={tone} size="card">
            {icon}
          </IconBadge>
        ) : null}
      </div>
      {description ? (
        <p className={cn('mt-3 text-sm leading-5', panel ? 'text-muted-foreground dark:text-panel-premium-muted' : 'text-muted-foreground')}>{description}</p>
      ) : null}
      {meta ? <div className={cn('mt-3 premium-meta', panel && 'text-muted-foreground dark:text-panel-premium-muted')}>{meta}</div> : null}
    </div>
  )
}
