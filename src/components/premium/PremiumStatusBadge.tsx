import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type PremiumTone = 'neutral' | 'positive' | 'negative' | 'warning' | 'critical' | 'info'

const toneClasses: Record<PremiumTone, string> = {
  neutral:
    'border-border/80 bg-surface-muted text-financial-neutral dark:border-panel-border dark:bg-surface-muted/70 dark:text-panel-premium-muted',
  positive:
    'border-emerald-200 bg-emerald-50 text-financial-positive dark:border-emerald-300/30 dark:bg-emerald-300/10 dark:text-emerald-200',
  negative:
    'border-rose-200 bg-rose-50 text-financial-negative dark:border-rose-300/30 dark:bg-rose-300/10 dark:text-rose-200',
  warning:
    'border-amber-200 bg-amber-50 text-financial-warning dark:border-amber-300/30 dark:bg-amber-300/10 dark:text-amber-200',
  critical:
    'border-rose-200 bg-rose-50 text-financial-critical dark:border-rose-300/30 dark:bg-rose-300/20 dark:text-rose-200',
  info:
    'border-informational/25 bg-informational/8 text-informational dark:border-informational/30 dark:bg-informational/10 dark:text-informational',
}

export function premiumToneClass(tone: PremiumTone) {
  return toneClasses[tone]
}

export function PremiumStatusBadge({
  children,
  tone = 'neutral',
  icon,
  className,
}: {
  children: ReactNode
  tone?: PremiumTone
  icon?: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
        toneClasses[tone],
        className,
      )}
    >
      {icon ? <span className="shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  )
}
