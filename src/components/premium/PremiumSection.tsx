import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function PremiumSection({
  title,
  description,
  action,
  children,
  className,
  headerClassName,
  contentClassName,
}: {
  title?: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  headerClassName?: string
  contentClassName?: string
}) {
  return (
    <section className={cn('space-y-4', className)}>
      {title || description || action ? (
        <div className={cn('flex flex-col gap-3 md:flex-row md:items-end md:justify-between', headerClassName)}>
          <div className="min-w-0">
            {title ? <h2 className="text-[1.05rem] font-semibold leading-7 tracking-tight text-foreground">{title}</h2> : null}
            {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </section>
  )
}
