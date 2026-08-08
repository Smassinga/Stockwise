import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import type { PremiumTone } from './PremiumStatusBadge'

const actionToneClasses: Record<PremiumTone, string> = {
  neutral: 'border-card-border bg-card text-foreground',
  positive: 'border-status-success-border bg-status-success-muted text-status-success-foreground',
  success: 'border-status-success-border bg-status-success-muted text-status-success-foreground',
  negative: 'border-status-danger-border bg-status-danger-muted text-status-danger-foreground',
  danger: 'border-status-danger-border bg-status-danger-muted text-status-danger-foreground',
  warning: 'border-status-warning-border bg-status-warning-muted text-status-warning-foreground',
  critical: 'border-status-danger-border bg-status-danger-muted text-status-danger-foreground',
  info: 'border-status-info-border bg-status-info-muted text-status-info-foreground',
}

export type MobileQuickAction = {
  label: ReactNode
  icon: ReactNode
  onClick: () => void
  tone?: PremiumTone
}

export function MobileQuickActionGroup({
  actions,
  className,
}: {
  actions: MobileQuickAction[]
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 md:hidden', className)}>
      {actions.map((action, index) => (
        <button
          key={index}
          type="button"
          onClick={action.onClick}
          className={cn(
            'flex min-h-[5rem] flex-col items-start justify-between rounded-[calc(var(--radius)+0.2rem)] border p-3 text-left text-sm font-semibold shadow-[0_16px_36px_-32px_hsl(var(--foreground)/0.4)] active:translate-y-px',
            actionToneClasses[action.tone || 'neutral'],
          )}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-background/80 [&_svg]:h-4 [&_svg]:w-4">
            {action.icon}
          </span>
          <span className="mt-3 leading-tight">{action.label}</span>
        </button>
      ))}
    </div>
  )
}
