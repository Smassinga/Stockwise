import { type ReactNode } from 'react'
import { ArrowLeft, Building2 } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import BrandLockup from '../brand/BrandLockup'
import LocaleToggle from '../LocaleToggle'
import ThemeToggle from '../ThemeToggle'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { useOrg } from '../../hooks/useOrg'
import { useI18n, withI18nFallback } from '../../lib/i18n'

const workspaceRoutes = [
  { path: 'settings', labelKey: 'settings.title', fallback: 'Company settings' },
  { path: 'warehouses', labelKey: 'sections.warehouses.title', fallback: 'Warehouses' },
  { path: 'items', labelKey: 'items.title', fallback: 'Items' },
  { path: 'customers', labelKey: 'customers.title', fallback: 'Customers' },
  { path: 'suppliers', labelKey: 'suppliers.title', fallback: 'Suppliers' },
  { path: 'setup/import', labelKey: 'setup.areas.opening_data.title', fallback: 'Opening data' },
  { path: 'users', labelKey: 'sections.users.title', fallback: 'Users' },
  { path: 'currency', labelKey: 'currency.title', fallback: 'Currency' },
] as const

export function AssistedWorkspaceShell({ children }: { children: ReactNode }) {
  const { companyId: routeCompanyId } = useParams()
  const { pathname } = useLocation()
  const { companyId, companyName, loading, authorityMode } = useOrg()
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => withI18nFallback(t, key, fallback)
  const base = `/platform-workspace/${routeCompanyId || companyId || ''}`

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-app-background p-6 text-sm text-muted-foreground">
        {tt('platform.assisted.loadingWorkspace', 'Opening the customer workspace...')}
      </div>
    )
  }

  if (!companyId || companyId !== routeCompanyId || authorityMode !== 'platform_workspace') {
    return (
      <div className="min-h-[100dvh] bg-app-background p-6">
        <div role="alert" className="mx-auto max-w-2xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-medium">
            {tt('platform.assisted.workspaceUnavailable', 'The platform administration context is unavailable or expired.')}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/platform-control">{tt('platform.assisted.returnControl', 'Return to Platform Control')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-app-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <BrandLockup compact subtitle="" />
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle compact />
            <Button asChild variant="outline">
              <Link to="/platform-control">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {tt('platform.assisted.returnControl', 'Return to Platform Control')}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div
        role="status"
        className="border-b border-informational/25 bg-informational/8 text-informational-foreground"
      >
        <div className="mx-auto flex max-w-[96rem] items-start gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Building2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-semibold">{tt('platform.assisted.contextLabel', 'Platform administration')}</div>
            <div className="text-sm">
              {companyName || tt('platform.assisted.companyFallback', 'Customer company')}
              {' · '}
              {tt('platform.assisted.notMembership', 'Administrative workspace; this is not customer membership or ownership.')}
            </div>
          </div>
        </div>
      </div>

      <nav
        aria-label={tt('platform.assisted.workspaceNavigation', 'Customer workspace setup')}
        className="border-b border-border bg-background"
      >
        <div className="mx-auto flex max-w-[96rem] gap-1 overflow-x-auto px-4 py-2 sm:flex-wrap sm:px-6 lg:px-8">
          {workspaceRoutes.map((route) => {
            const to = `${base}/${route.path}`
            const active = pathname === to || pathname.startsWith(`${to}/`)
            return (
              <Link
                key={route.path}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'min-h-11 shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {tt(route.labelKey, route.fallback)}
              </Link>
            )
          })}
        </div>
      </nav>

      <main className="mx-auto max-w-[96rem] px-4 pb-10 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
