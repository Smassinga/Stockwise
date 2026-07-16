import { cn } from '../../lib/utils'

export function PremiumSkeleton({
  className,
  lines = 3,
  label = 'Loading content',
}: {
  className?: string
  lines?: number
  label?: string
}) {
  return (
    <div
      className={cn('rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-5', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div className="h-3 w-28 rounded-full bg-muted motion-safe:animate-pulse" aria-hidden="true" />
      <div className="mt-4 h-8 w-44 rounded-full bg-muted motion-safe:animate-pulse" aria-hidden="true" />
      <div className="mt-5 space-y-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className={cn('h-3 rounded-full bg-muted motion-safe:animate-pulse', index === lines - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </div>
  )
}
