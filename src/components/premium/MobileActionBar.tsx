import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type MobileBarAction = {
  label: ReactNode
  icon?: ReactNode
  onClick: () => void
  primary?: boolean
}

export function MobileActionBar({
  actions,
  className,
}: {
  actions: MobileBarAction[]
  className?: string
}) {
  return (
    <div className={cn('sticky top-[calc(var(--app-shell-mobile-header)+var(--app-safe-top)+0.75rem)] z-20 md:hidden', className)}>
      <div className="flex gap-2 overflow-x-auto rounded-[calc(var(--radius)+0.25rem)] border border-card-border bg-card/96 p-2 shadow-[0_20px_50px_-36px_hsl(var(--foreground)/0.5)] backdrop-blur-xl">
        {actions.map((action, index) => (
          <button
            key={index}
            type="button"
            onClick={action.onClick}
            className={cn(
              'inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold',
              action.primary ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-foreground',
            )}
          >
            {action.icon ? <span className="[&_svg]:h-4 [&_svg]:w-4">{action.icon}</span> : null}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
