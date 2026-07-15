import { useI18n, withI18nFallback } from '../lib/i18n'

export function AppErrorFallback() {
  const { t } = useI18n()

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-lg" role="alert" aria-live="assertive">
        <p className="text-sm font-semibold text-muted-foreground">
          {withI18nFallback(t, 'appError.eyebrow', 'StockWise')}
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          {withI18nFallback(t, 'appError.title', 'Something went wrong')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {withI18nFallback(
            t,
            'appError.description',
            'This page could not be displayed safely. Reload it or return to the dashboard.',
          )}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            {withI18nFallback(t, 'appError.reload', 'Reload page')}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground"
            onClick={() => window.location.assign('/dashboard')}
          >
            {withI18nFallback(t, 'appError.dashboard', 'Return to dashboard')}
          </button>
        </div>
      </section>
    </main>
  )
}
