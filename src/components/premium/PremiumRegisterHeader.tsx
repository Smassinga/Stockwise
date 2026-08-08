import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

type PremiumRegisterHeaderProps = {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  metrics?: ReactNode
  className?: string
}

export function PremiumRegisterHeader(props: PremiumRegisterHeaderProps) {
  const { title, description, badges, actions, metrics, className } = props

  return (
    <section
      className={cn(
        'border-b border-border pb-5 sm:pb-6',
        className,
      )}
    >
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div>
            <h1 className="screen-title">{title}</h1>
            {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
          </div>
          {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2 xl:justify-end">{actions}</div> : null}
      </div>
      {metrics ? <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{metrics}</div> : null}
    </section>
  )
}
