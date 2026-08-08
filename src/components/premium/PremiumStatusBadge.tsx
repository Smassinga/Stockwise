import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type PremiumTone = 'neutral' | 'positive' | 'success' | 'negative' | 'danger' | 'warning' | 'critical' | 'info'

const toneClasses: Record<PremiumTone, string> = {
  neutral:
    'border-status-neutral-border bg-status-neutral-muted text-status-neutral-foreground',
  positive:
    'border-status-success-border bg-status-success-muted text-status-success-foreground',
  success:
    'border-status-success-border bg-status-success-muted text-status-success-foreground',
  negative:
    'border-status-danger-border bg-status-danger-muted text-status-danger-foreground',
  danger:
    'border-status-danger-border bg-status-danger-muted text-status-danger-foreground',
  warning:
    'border-status-warning-border bg-status-warning-muted text-status-warning-foreground',
  critical:
    'border-status-danger-border bg-status-danger-muted text-status-danger-foreground',
  info:
    'border-status-info-border bg-status-info-muted text-status-info-foreground',
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
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}
