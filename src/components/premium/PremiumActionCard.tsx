import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { IconBadge } from './IconBadge'
import type { PremiumTone } from './PremiumStatusBadge'
import { PremiumStatusBadge } from './PremiumStatusBadge'

export function PremiumActionCard({
  title,
  body,
  count,
  tone = 'neutral',
  icon,
  actionLabel,
  onAction,
  className,
}: {
  title: ReactNode
  body: ReactNode
  count?: ReactNode
  tone?: PremiumTone
  icon?: ReactNode
  actionLabel?: ReactNode
  onAction?: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'group flex h-full flex-col gap-4 rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-4 shadow-[0_18px_40px_-34px_hsl(var(--foreground)/0.34)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_24px_52px_-38px_hsl(var(--foreground)/0.44)]',
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {icon ? (
          <IconBadge tone={tone} size="card">
            {icon}
          </IconBadge>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-5 text-foreground">{title}</div>
          {count ? (
            <div className="mt-2">
              <PremiumStatusBadge tone={tone}>{count}</PremiumStatusBadge>
            </div>
          ) : null}
        </div>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
      {actionLabel && onAction ? (
        <Button variant="ghost" className="mt-auto h-auto justify-start px-0 text-sm font-semibold text-primary hover:text-primary" onClick={onAction}>
          {actionLabel}
          <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Button>
      ) : null}
    </div>
  )
}
