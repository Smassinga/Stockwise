import { Link } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

export type FinanceChainMetric = {
  label: string
  value: string
}

export type FinanceChainItem = {
  id: string
  eyebrow: string
  title: string
  description?: string
  status?: string
  href?: string | null
  hrefLabel?: string | null
  metrics?: FinanceChainMetric[]
}

type Props = {
  title: string
  description: string
  items: FinanceChainItem[]
}

export default function FinanceChainCard({ title, description, items }: Props) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? null : (
          <div className="grid gap-4 xl:grid-cols-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-[1.25rem] border border-border/75 bg-gradient-to-br from-background via-background to-muted/20 p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.75)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-30px_rgba(15,23,42,0.85)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{item.eyebrow}</div>
                    <div className="text-base font-semibold tracking-tight">{item.title}</div>
                    {item.description ? <div className="text-sm text-muted-foreground">{item.description}</div> : null}
                  </div>
                  {item.status ? <Badge variant="outline">{item.status}</Badge> : null}
                </div>

                {item.metrics?.length ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {item.metrics.map((metric) => (
                      <div key={metric.label} className="rounded-2xl border border-border/70 bg-muted/25 px-3 py-2.5">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{metric.label}</div>
                        <div className="mt-1 font-mono text-sm font-semibold tabular-nums">{metric.value}</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {item.href && item.hrefLabel ? (
                  <div className="mt-4">
                    <Link
                      to={item.href}
                      className="inline-flex rounded-full border border-border/70 bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      {item.hrefLabel}
                    </Link>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
