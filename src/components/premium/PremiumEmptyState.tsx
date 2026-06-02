import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

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
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[calc(var(--radius)+0.15rem)] border border-dashed border-card-border bg-surface-muted/45 text-center',
        compact ? 'px-4 py-6' : 'px-5 py-10',
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-card-border bg-card text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </div>
      ) : null}
      <p className="max-w-xl text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
