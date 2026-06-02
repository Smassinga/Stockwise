import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function PremiumChartCard({
  title,
  description,
  stat,
  action,
  children,
  footer,
  variant = 'default',
  className,
}: {
  title: ReactNode
  description?: ReactNode
  stat?: ReactNode
  action?: ReactNode
  children: ReactNode
  footer?: ReactNode
  variant?: 'default' | 'panel'
  className?: string
}) {
  const panel = variant === 'panel'

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[calc(var(--radius)+0.35rem)] border shadow-[0_24px_60px_-44px_hsl(var(--foreground)/0.42)]',
        panel
          ? 'border-card-border bg-card text-card-foreground dark:border-panel-premium-border dark:bg-panel-premium dark:text-panel-premium-foreground'
          : 'border-card-border bg-card text-card-foreground',
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h3 className={cn('text-base font-semibold leading-6 tracking-tight', panel && 'dark:text-panel-premium-foreground')}>{title}</h3>
          {description ? <p className={cn('mt-1 text-sm leading-6', panel ? 'text-muted-foreground dark:text-panel-premium-muted' : 'text-muted-foreground')}>{description}</p> : null}
        </div>
        {stat || action ? (
          <div className="flex shrink-0 items-center gap-2">
            {stat}
            {action}
          </div>
        ) : null}
      </div>
      <div className="p-4 sm:p-6">{children}</div>
      {footer ? (
        <div className={cn('border-t px-5 py-3 text-xs leading-5 sm:px-6', panel ? 'border-card-border text-muted-foreground dark:border-panel-premium-border dark:text-panel-premium-muted' : 'border-card-border text-muted-foreground')}>
          {footer}
        </div>
      ) : null}
    </div>
  )
}
