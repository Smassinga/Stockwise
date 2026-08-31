import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

type VendorBillResolutionMetric = {
  label: string
  value: string
  help: string
  emphasize?: boolean
}

type VendorBillResolutionCardProps = {
  title: string
  description: string
  isActive: boolean
  inactiveMessage: string
  metrics: VendorBillResolutionMetric[]
  summary: string
}

export default function VendorBillResolutionCard({
  title,
  description,
  isActive,
  inactiveMessage,
  metrics,
  summary,
}: VendorBillResolutionCardProps) {
  return (
    <Card className="border-border/80 shadow-sm">
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
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
