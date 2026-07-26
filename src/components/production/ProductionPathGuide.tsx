import { Factory, Layers3, Sprout } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useI18n, withI18nFallback } from '../../lib/i18n'
import { cn } from '../../lib/utils'

const paths = [
  {
    path: '/bom',
    icon: Layers3,
    titleKey: 'productionUx.path.recipe',
    titleFallback: 'Recipes & Assemblies',
    bodyKey: 'productionUx.path.recipeHelp',
    bodyFallback: 'Use Quick Assembly for a simple recipe-driven stock transformation.',
  },
  {
    path: '/production-runs',
    icon: Factory,
    titleKey: 'productionUx.path.run',
    titleFallback: 'Production Runs',
    bodyKey: 'productionUx.path.runHelp',
    bodyFallback: 'Use when planned versus actual output, frozen cost, and controlled reversal matter.',
  },
  {
    path: '/growth-batches',
    icon: Sprout,
    titleKey: 'productionUx.path.batch',
    titleFallback: 'Growth Batches',
    bodyKey: 'productionUx.path.batchHelp',
    bodyFallback: 'Use for a biological or agricultural group that changes through measured lifecycle events.',
  },
] as const

export function ProductionPathGuide() {
  const { pathname } = useLocation()
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)

  return (
    <section
      aria-labelledby="production-path-guide-title"
      className="border-y border-card-border bg-surface-muted/35 py-4"
    >
      <div className="mb-3">
        <h2 id="production-path-guide-title" className="text-sm font-semibold">
          {tt('productionUx.path.title', 'Choose the production workflow')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {tt('productionUx.path.help', 'Choose the lightest workflow that preserves the evidence your operation needs.')}
        </p>
      </div>
      <div className="grid gap-2 lg:grid-cols-3">
        {paths.map(({ path, icon: Icon, titleKey, titleFallback, bodyKey, bodyFallback }) => {
          const active = pathname === path
          return (
            <Link
              key={path}
              to={path}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group grid min-h-20 grid-cols-[2.25rem_minmax(0,1fr)] gap-3 border-l-2 px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active
                  ? 'border-primary bg-primary/7'
                  : 'border-transparent hover:border-border hover:bg-surface-muted/60',
              )}
            >
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-md border',
                  active
                    ? 'border-primary/35 bg-primary/10 text-primary'
                    : 'border-card-border bg-background text-muted-foreground group-hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{tt(titleKey, titleFallback)}</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {tt(bodyKey, bodyFallback)}
                </span>
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
