import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function PremiumPageHeader({
  title,
  description,
  context,
  meta,
  status,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  context?: ReactNode
  meta?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-5 border-b border-border pb-5 sm:pb-6 xl:flex-row xl:items-start xl:justify-between',
        className,
      )}
    >
      <div className="min-w-0 space-y-4">
        {context || status ? (
          <div className="flex flex-wrap items-center gap-2">
            {context}
            {status}
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="screen-title">{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {meta ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-col gap-2 sm:flex-row xl:justify-end">{actions}</div> : null}
    </div>
  )
}
