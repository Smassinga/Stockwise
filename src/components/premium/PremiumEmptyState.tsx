import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { IconBadge } from './IconBadge'
import { PremiumSkeleton } from './PremiumSkeleton'

export type PremiumStateKind = 'loading' | 'empty' | 'error' | 'blocked' | 'success' | 'warning' | 'info' | 'neutral'
type LegacyStateTone = 'danger' | 'success' | 'warning' | 'info' | 'neutral'

const stateClasses: Record<PremiumStateKind, string> = {
  empty: 'border-card-border bg-surface-muted/45',
  error: 'border-status-danger-border bg-status-danger-muted',
  blocked: 'border-status-warning-border bg-status-warning-muted',
  success: 'border-status-success-border bg-status-success-muted',
  warning: 'border-status-warning-border bg-status-warning-muted',
  info: 'border-status-info-border bg-status-info-muted',
  neutral: 'border-status-neutral-border bg-status-neutral-muted',
  loading: 'border-status-neutral-border bg-status-neutral-muted',
}

const stateIconTone = {
  empty: 'neutral',
  error: 'critical',
  blocked: 'warning',
  success: 'positive',
  warning: 'warning',
  info: 'info',
  neutral: 'info',
  loading: 'neutral',
} as const

function resolveStateKind(kind?: PremiumStateKind, variant?: PremiumStateKind, tone?: LegacyStateTone): PremiumStateKind {
  if (kind) return kind
  if (variant) return variant
  if (tone === 'danger') return 'error'
  return tone ?? 'neutral'
}

export function PremiumStatePanel({
  kind,
  variant,
  tone,
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: {
  kind?: PremiumStateKind
  variant?: PremiumStateKind
  tone?: LegacyStateTone
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  const resolvedKind = resolveStateKind(kind, variant, tone)
  const assertive = resolvedKind === 'error' || resolvedKind === 'blocked'

  if (resolvedKind === 'loading') {
    return (
      <PremiumSkeleton
        className={className}
        lines={compact ? 2 : 3}
        label={typeof title === 'string' ? title : 'Loading content'}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[calc(var(--radius)+0.15rem)] border border-dashed text-center',
        stateClasses[resolvedKind],
        compact ? 'px-4 py-6' : 'px-5 py-10',
        className,
      )}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
    >
      {icon ? (
        <IconBadge tone={stateIconTone[resolvedKind]} size="empty" className="mb-3 bg-card">
          {icon}
        </IconBadge>
      ) : null}
      <p className="max-w-xl text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function PremiumEmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <PremiumStatePanel
      kind="empty"
      title={title}
      description={description}
      icon={icon}
      action={action}
      compact={compact}
      className={className}
    />
  )
}
