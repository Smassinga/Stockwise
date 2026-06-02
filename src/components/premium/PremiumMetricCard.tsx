import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import type { PremiumTone } from './PremiumStatusBadge'

const toneText: Record<PremiumTone, string> = {
  neutral: 'text-financial-neutral dark:text-panel-premium-muted',
  positive: 'text-financial-positive dark:text-emerald-200',
  negative: 'text-financial-negative dark:text-rose-200',
  warning: 'text-financial-warning dark:text-amber-200',
  critical: 'text-financial-critical dark:text-rose-200',
  info: 'text-sky-700 dark:text-sky-200',
}

const toneIcon: Record<PremiumTone, string> = {
  neutral: 'border-border/70 bg-surface-muted text-financial-neutral dark:border-panel-border dark:bg-white/5 dark:text-panel-premium-muted',
  positive: 'border-emerald-200 bg-emerald-50 text-financial-positive dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:text-emerald-200',
  negative: 'border-rose-200 bg-rose-50 text-financial-negative dark:border-rose-300/25 dark:bg-rose-300/10 dark:text-rose-200',
  warning: 'border-amber-200 bg-amber-50 text-financial-warning dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-200',
  critical: 'border-rose-200 bg-rose-50 text-financial-critical dark:border-rose-300/30 dark:bg-rose-300/20 dark:text-rose-200',
  info: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-300/25 dark:bg-sky-300/10 dark:text-sky-200',
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
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border [&_svg]:h-4 [&_svg]:w-4', toneIcon[tone])}>
            {icon}
          </div>
        ) : null}
      </div>
      {description ? (
        <p className={cn('mt-3 text-sm leading-5', panel ? 'text-muted-foreground dark:text-panel-premium-muted' : 'text-muted-foreground')}>{description}</p>
      ) : null}
      {meta ? <div className={cn('mt-3 premium-meta', panel && 'text-muted-foreground dark:text-panel-premium-muted')}>{meta}</div> : null}
    </div>
  )
}
