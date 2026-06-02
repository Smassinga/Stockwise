import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function MobileWorkflowHeader({
  title,
  description,
  status,
  meta,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  status?: ReactNode
  meta?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-[calc(var(--radius)+0.25rem)] border border-card-border bg-card p-4 shadow-[0_18px_42px_-34px_hsl(var(--foreground)/0.34)] md:hidden', className)}>
      {status ? <div className="mb-3 flex flex-wrap items-center gap-2">{status}</div> : null}
      <h1 className="text-2xl font-semibold leading-tight tracking-tight">{title}</h1>
      {description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {meta ? <div className="mt-3 text-xs text-muted-foreground">{meta}</div> : null}
    </div>
  )
}
