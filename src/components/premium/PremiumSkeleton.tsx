import { cn } from '../../lib/utils'

export function PremiumSkeleton({
  className,
  lines = 3,
  rows,
  variant = 'summary',
  label = 'Loading content',
}: {
  className?: string
  lines?: number
  rows?: number
  variant?: 'summary' | 'table' | 'list' | 'detail'
  label?: string
}) {
  const rowCount = rows ?? lines

  return (
    <div
      className={cn('rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-5', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {variant === 'table' ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[minmax(8rem,1.5fr)_minmax(5rem,1fr)_minmax(4rem,0.7fr)] gap-3 border-b border-border pb-3">
              {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-3 rounded bg-muted motion-safe:animate-pulse" />)}
            </div>
            {Array.from({ length: rowCount }).map((_, index) => (
              <div key={index} className="grid min-h-10 grid-cols-[minmax(8rem,1.5fr)_minmax(5rem,1fr)_minmax(4rem,0.7fr)] items-center gap-3 border-b border-border/70 last:border-0">
                <div className="h-3 w-4/5 rounded bg-muted motion-safe:animate-pulse" />
                <div className="h-3 w-3/5 rounded bg-muted motion-safe:animate-pulse" />
                <div className="ml-auto h-3 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        ) : variant === 'list' ? (
          <div className="space-y-3">
            {Array.from({ length: rowCount }).map((_, index) => (
              <div key={index} className="flex min-h-14 items-center gap-3 border-b border-border/70 pb-3 last:border-0 last:pb-0">
                <div className="h-9 w-9 shrink-0 rounded-lg bg-muted motion-safe:animate-pulse" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-2/5 rounded bg-muted motion-safe:animate-pulse" />
                  <div className="h-3 w-4/5 rounded bg-muted motion-safe:animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : variant === 'detail' ? (
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)]">
            <div className="space-y-4">
              <div className="h-4 w-28 rounded bg-muted motion-safe:animate-pulse" />
              <div className="h-9 w-3/5 rounded-lg bg-muted motion-safe:animate-pulse" />
              {Array.from({ length: rowCount }).map((_, index) => <div key={index} className={cn('h-3 rounded bg-muted motion-safe:animate-pulse', index === rowCount - 1 ? 'w-2/3' : 'w-full')} />)}
            </div>
            <div className="min-h-32 rounded-lg border border-border bg-surface-muted/50" />
          </div>
        ) : (
          <>
            <div className="h-3 w-28 rounded bg-muted motion-safe:animate-pulse" />
            <div className="mt-4 h-8 w-44 max-w-[72%] rounded-lg bg-muted motion-safe:animate-pulse" />
            <div className="mt-5 space-y-2">
              {Array.from({ length: rowCount }).map((_, index) => (
                <div key={index} className={cn('h-3 rounded bg-muted motion-safe:animate-pulse', index === rowCount - 1 ? 'w-2/3' : 'w-full')} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
