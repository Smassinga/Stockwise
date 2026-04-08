import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import type { FinanceTimelineEntry } from '../../lib/financeAudit'

type Props = {
  title: string
  emptyLabel: string
  entries: FinanceTimelineEntry[]
}

function toneClasses(tone: FinanceTimelineEntry['tone']) {
  switch (tone) {
    case 'success':
      return 'border-emerald-300/70 bg-emerald-500/5 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-200'
    case 'warning':
      return 'border-amber-300/70 bg-amber-500/5 text-amber-700 dark:border-amber-500/40 dark:text-amber-200'
    case 'danger':
      return 'border-rose-300/70 bg-rose-500/5 text-rose-700 dark:border-rose-500/40 dark:text-rose-200'
    default:
      return 'border-border/70 bg-background/70 text-foreground'
  }
}

export default function FinanceTimelineCard({ title, emptyLabel, entries }: Props) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <div className="space-y-4">
            {entries.map((entry, index) => (
              <div key={entry.id} className="relative pl-8">
                {index < entries.length - 1 ? (
                  <div className="absolute left-[0.62rem] top-5 h-[calc(100%+0.75rem)] w-px bg-border/70" />
                ) : null}
                <div className={`absolute left-0 top-1.5 h-5 w-5 rounded-full border shadow-sm ${toneClasses(entry.tone)}`} />

                <div className="rounded-2xl border border-border/70 bg-card/90 p-4 shadow-[0_12px_34px_-28px_rgba(15,23,42,0.65)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_38px_-28px_rgba(15,23,42,0.75)]">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold tracking-tight">{entry.title}</div>
                      {entry.summary ? (
                        <div className="text-sm text-muted-foreground">{entry.summary}</div>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{entry.occurredAt}</div>
                      {entry.actorLabel ? <div className="mt-1">{entry.actorLabel}</div> : null}
                    </div>
                  </div>

                  {(entry.transition || entry.amount || entry.href) ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {entry.transition ? (
                        <span className="rounded-full border border-border/70 bg-muted/35 px-2.5 py-1">{entry.transition}</span>
                      ) : null}
                      {entry.amount ? (
                        <span className="rounded-full border border-border/70 bg-muted/35 px-2.5 py-1">{entry.amount}</span>
                      ) : null}
                      {entry.href && entry.hrefLabel ? (
                        <Link
                          to={entry.href}
                          className="rounded-full border border-border/70 bg-background px-2.5 py-1 font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          {entry.hrefLabel}
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
