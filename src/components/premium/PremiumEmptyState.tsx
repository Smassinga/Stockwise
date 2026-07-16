import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import { IconBadge } from './IconBadge'

export type PremiumStateKind = 'empty' | 'error' | 'blocked' | 'success' | 'neutral'

const stateClasses: Record<PremiumStateKind, string> = {
  empty: 'border-card-border bg-surface-muted/45',
  error: 'border-destructive/35 bg-destructive/5',
  blocked: 'border-amber-300/40 bg-amber-300/5',
  success: 'border-emerald-300/35 bg-emerald-300/5',
  neutral: 'border-card-border bg-surface-muted/45',
}

const stateIconTone = {
  empty: 'neutral',
  error: 'critical',
  blocked: 'warning',
  success: 'positive',
  neutral: 'info',
} as const

export function PremiumStatePanel({
  kind = 'neutral',
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: {
  kind?: PremiumStateKind
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  const assertive = kind === 'error' || kind === 'blocked'

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[calc(var(--radius)+0.15rem)] border border-dashed text-center',
        stateClasses[kind],
        compact ? 'px-4 py-6' : 'px-5 py-10',
        className,
      )}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
    >
      {icon ? (
        <IconBadge tone={stateIconTone[kind]} size="empty" className="mb-3 bg-card">
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
