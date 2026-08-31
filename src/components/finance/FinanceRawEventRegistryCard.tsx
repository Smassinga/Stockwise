import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'

type Translate = (key: string, fallback: string) => string

type RawFinanceEvent = {
  id: string
  event_type: string
  occurred_at: string
  from_status?: string | null
  to_status?: string | null
}

type FinanceRawEventRegistryCardProps = {
  events: RawFinanceEvent[]
  translate: Translate
  transitionStyle: 'unicode' | 'ascii'
}

export default function FinanceRawEventRegistryCard({
  events,
  translate,
  transitionStyle,
}: FinanceRawEventRegistryCardProps) {
  const emptyStatus = transitionStyle === 'unicode' ? '—' : '-'
  const transitionArrow = transitionStyle === 'unicode' ? '→' : '->'

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle>{translate('financeDocs.audit.rawTitle', 'Raw event registry')}</CardTitle>
        <CardDescription className="hidden sm:block">
          {translate(
            'financeDocs.audit.rawHelp',
            'Underlying finance-document event rows kept for low-level inspection and troubleshooting.',
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {translate('financeDocs.mz.auditEmpty', 'No audit events have been captured for this document yet.')}
          </p>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">{event.event_type}</div>
                  <div className="text-xs text-muted-foreground">
                    {event.occurred_at.replace('T', ' ').slice(0, 19)}
                  </div>
                </div>
                {event.from_status || event.to_status ? (
                  <div className="mt-1 text-sm text-muted-foreground">
                    {event.from_status || emptyStatus} {transitionArrow} {event.to_status || emptyStatus}
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
