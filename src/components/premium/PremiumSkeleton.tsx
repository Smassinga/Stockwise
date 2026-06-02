import { cn } from '../../lib/utils'

export function PremiumSkeleton({
  className,
  lines = 3,
}: {
  className?: string
  lines?: number
}) {
  return (
    <div className={cn('animate-pulse rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-5', className)}>
      <div className="h-3 w-28 rounded-full bg-muted" />
      <div className="mt-4 h-8 w-44 rounded-full bg-muted" />
      <div className="mt-5 space-y-2">
        {Array.from({ length: lines }).map((_, index) => (
          <div key={index} className={cn('h-3 rounded-full bg-muted', index === lines - 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    </div>
  )
}
