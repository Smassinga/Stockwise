import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'
import type { PremiumTone } from './PremiumStatusBadge'

const actionToneClasses: Record<PremiumTone, string> = {
  neutral: 'border-card-border bg-card text-foreground',
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-300/25 dark:bg-emerald-300/10 dark:text-emerald-100',
  negative: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-300/25 dark:bg-rose-300/10 dark:text-rose-100',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/25 dark:bg-amber-300/10 dark:text-amber-100',
  critical: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-300/30 dark:bg-rose-300/20 dark:text-rose-100',
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-300/25 dark:bg-sky-300/10 dark:text-sky-100',
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
