import { useI18n, withI18nFallback } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import BrandLockup from '../brand/BrandLockup'

export function AppLoadingState({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const label = withI18nFallback(t, 'loading', 'Loading')

  return (
    <div
      className={cn(
        'flex w-full items-center justify-center bg-app-background px-4 py-8 text-foreground',
        compact ? 'min-h-[22rem]' : 'min-h-[60dvh]',
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div className="w-full max-w-3xl" aria-hidden="true">
        {!compact ? <BrandLockup compact className="mb-6" /> : null}
        <div className="rounded-[calc(var(--radius)+0.35rem)] border border-card-border bg-surface-elevated p-5 shadow-[0_24px_56px_-42px_hsl(var(--foreground)/0.32)] sm:p-6">
          <div className="h-3 w-24 rounded-full bg-muted motion-safe:animate-pulse" />
          <div className="mt-4 h-8 w-52 max-w-[72%] rounded-lg bg-muted motion-safe:animate-pulse" />
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-xl border border-border/70 bg-card p-4">
                <div className="h-3 w-16 rounded-full bg-muted motion-safe:animate-pulse" />
                <div className="mt-4 h-6 w-24 rounded-md bg-muted motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
