import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { PremiumStatusBadge } from '../premium/PremiumStatusBadge'
import { cn } from '../../lib/utils'
import type { CommercialLifecycleItem } from '../../lib/commercialWorkflowPresentation'

export function CommercialLifecycleStrip({
  items,
  translate,
  action,
  className,
}: {
  items: CommercialLifecycleItem[]
  translate: (key: string, fallback: string) => string
  action?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-4 shadow-[0_18px_42px_-36px_hsl(var(--foreground)/0.34)]',
        className,
      )}
      aria-label={translate('commercial.lifecycle.label', 'Commercial lifecycle')}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item, index) => (
          <div key={item.id} className="relative min-w-0 rounded-lg border border-border/70 bg-surface-muted/35 p-3">
            {index < items.length - 1 ? (
              <ArrowRight
                className="absolute -right-5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-muted-foreground/55 xl:block"
                aria-hidden="true"
              />
            ) : null}
            <div className="premium-label">
              {translate(item.eyebrowKey, item.eyebrowFallback)}
            </div>
            <div className="mt-2">
              <PremiumStatusBadge tone={item.tone}>
                {translate(item.labelKey, item.fallback)}
              </PremiumStatusBadge>
            </div>
            {item.descriptionKey && item.descriptionFallback ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {translate(item.descriptionKey, item.descriptionFallback)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {action ? <div className="mt-4 flex flex-wrap justify-end gap-2">{action}</div> : null}
    </section>
  )
}
