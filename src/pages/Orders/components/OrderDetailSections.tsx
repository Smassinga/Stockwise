import { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { cn } from '../../../lib/utils'

type DetailSectionProps = {
  title: string
  description?: string
  children: ReactNode
  className?: string
  contentClassName?: string
}

type WorkflowStat = {
  label: string
  value: ReactNode
  hint?: string
}

type WorkflowStripProps = {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  stats?: WorkflowStat[]
  className?: string
}

type AuditField = {
  label: string
  value: ReactNode
}

export function OrderDetailSection({
  title,
  description,
  children,
  className,
  contentClassName,
}: DetailSectionProps) {
  return (
    <Card className={cn('rounded-xl border-border/80 shadow-sm', className)}>
      <CardHeader className="pb-4">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className={cn('space-y-4', contentClassName)}>{children}</CardContent>
    </Card>
  )
}

export function OrderWorkflowStrip({
  eyebrow,
  title,
  description,
  actions,
  stats = [],
  className,
}: WorkflowStripProps) {
  return (
    <Card className={cn('rounded-xl border-border/80 shadow-sm', className)}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
          </div>
          {actions ? <div className="flex flex-wrap items-start gap-2 lg:justify-end">{actions}</div> : null}
        </div>

        {!!stats.length && (
          <div className="grid gap-3 md:grid-cols-3">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border/70 bg-muted/25 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                <div className="mt-1 text-lg font-semibold">{stat.value}</div>
                {stat.hint ? <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function OrderAuditGrid({
  title,
  description,
  fields,
}: {
  title: string
  description?: string
  fields: AuditField[]
}) {
  return (
    <OrderDetailSection title={title} description={description}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((field) => (
          <div key={field.label}>
            <div className="text-sm font-medium">{field.label}</div>
            <div className="mt-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm">{field.value}</div>
          </div>
        ))}
      </div>
    </OrderDetailSection>
  )
}
