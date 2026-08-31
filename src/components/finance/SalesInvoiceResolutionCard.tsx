import type { ComponentProps } from 'react'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

type BadgeVariant = ComponentProps<typeof Badge>['variant']

type SalesInvoiceResolutionBadge = {
  label: string
  variant: BadgeVariant
}

type SalesInvoiceResolutionMetric = {
  label: string
  value: string
  help: string
  emphasize?: boolean
}

type SalesInvoiceResolutionCardProps = {
  title: string
  description: string
  isActive: boolean
  inactiveMessage: string
  badges: SalesInvoiceResolutionBadge[]
  metrics: SalesInvoiceResolutionMetric[]
  summary: string
}

export default function SalesInvoiceResolutionCard({
  title,
  description,
  isActive,
  inactiveMessage,
  badges,
  metrics,
  summary,
}: SalesInvoiceResolutionCardProps) {
  return (
    <Card className="border-border/80 shadow-sm lg:col-span-2">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="hidden sm:block">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isActive ? (
          <div className="border-l-2 border-status-neutral-border bg-status-neutral-muted px-4 py-3 text-sm text-status-neutral-foreground">
            {inactiveMessage}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {badges.map((badge) => (
                <Badge key={`${badge.label}-${badge.variant || 'default'}`} variant={badge.variant}>
                  {badge.label}
                </Badge>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              {metrics.map((metric) => (
                <Card key={metric.label} className="border-border/70 shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {metric.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <div className={`font-mono tabular-nums${metric.emphasize ? ' font-semibold' : ''}`}>
                      {metric.value}
                    </div>
                    <div className="text-xs text-muted-foreground">{metric.help}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
              {summary}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
