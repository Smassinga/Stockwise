import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Clock3, LockKeyhole, RefreshCw, ShieldAlert } from 'lucide-react'
import BrandLockup from '../components/brand/BrandLockup'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import CompanySwitcher from '../components/CompanySwitcher'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { getMyCompanyAccessState, getPlatformAdminStatus, type CompanyAccessState } from '../lib/companyAccess'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { buildPublicMailto } from '../lib/publicContact'

function formatDate(value: string | null, locale: string) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString(locale)
}

export default function CompanyAccessStatusPage() {
  const { companyId, companyName } = useOrg()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { lang, t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const activationHref = buildPublicMailto(
    lang === 'pt' ? 'Pedido de ativação StockWise' : 'StockWise activation request',
  )

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [state, setState] = useState<CompanyAccessState | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)

  async function loadState(showSpinner = true) {
    if (!companyId) {
      setState(null)
      setLoading(false)
      return
    }

    try {
      if (showSpinner) setLoading(true)
      else setRefreshing(true)

      const [accessState, adminStatus] = await Promise.all([
        getMyCompanyAccessState(companyId),
        getPlatformAdminStatus(),
      ])

      setState(accessState)
      setIsPlatformAdmin(Boolean(adminStatus?.is_admin))

      if (accessState?.access_enabled) {
        navigate('/dashboard', { replace: true })
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadState(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const statusCopy = useMemo(() => {
    switch (state?.effective_status) {
      case 'expired':
        return {
          icon: Clock3,
          title: tt('access.expiredTitle', 'Trial expired'),
          body: tt(
            'access.expiredBody',
            'This company can no longer be used normally. Your login remains intact, but the workspace stays blocked until StockWise restores or activates access.',
          ),
        }
      case 'suspended':
        return {
          icon: ShieldAlert,
          title: tt('access.suspendedTitle', 'Workspace suspended'),
          body: tt(
            'access.suspendedBody',
            'This company was suspended by the StockWise team. Operational routes remain blocked until the suspension is lifted.',
          ),
        }
      case 'disabled':
        return {
          icon: LockKeyhole,
          title: tt('access.disabledTitle', 'Workspace disabled'),
          body: tt(
            'access.disabledBody',
            'This company is disabled. Credentials remain active, but company operations are intentionally locked.',
          ),
        }
      default:
        return {
          icon: AlertTriangle,
          title: tt('access.genericTitle', 'Workspace access restricted'),
          body: tt(
            'access.genericBody',
            'This company cannot be used normally right now. Review the access state below or switch to another company you can still access.',
          ),
        }
    }
  }, [state?.effective_status, tt])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {tt('loading', 'Loading...')}
      </div>
    )
  }

  const Icon = statusCopy.icon

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link to="/">
            <BrandLockup compact />
          </Link>
          <Button variant="ghost" onClick={() => logout()}>
            {tt('common.signOut', 'Sign out')}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="overflow-hidden border-border/70 bg-card shadow-[0_28px_90px_-56px_rgba(15,23,42,0.55)]">
            <CardHeader className="border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.05]">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/85 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {tt('access.workspaceState', 'Workspace state')}
              </div>
              <CardTitle className="mt-4 text-3xl tracking-tight">{statusCopy.title}</CardTitle>
              <CardDescription className="max-w-2xl text-base leading-7">{statusCopy.body}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 p-6 md:grid-cols-2">
              <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {tt('access.companyLabel', 'Company')}
                </div>
                <div className="mt-2 text-lg font-semibold">{state?.company_name || companyName || '-'}</div>
                <div className="mt-2 text-sm text-muted-foreground">{state?.plan_name || '-'}</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {tt('access.statusLabel', 'Effective status')}
                </div>
                <div className="mt-2 text-lg font-semibold">{String(state?.effective_status || '-').replaceAll('_', ' ')}</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {tt(
                    'access.manualActivationNote',
                    'Paid access remains manually activated by the StockWise team for now.',
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {tt('access.trialEnds', 'Trial ends')}
                </div>
                <div className="mt-2 text-base font-medium">{formatDate(state?.trial_expires_at || null, locale)}</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background p-4">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {tt('access.paidUntil', 'Paid until')}
                </div>
                <div className="mt-2 text-base font-medium">{formatDate(state?.paid_until || null, locale)}</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background p-4 md:col-span-2">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {tt('access.purgeSchedule', 'Operational purge schedule')}
                </div>
                <div className="mt-2 text-base font-medium">{formatDate(state?.purge_scheduled_at || null, locale)}</div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  {tt(
                    'access.purgeHelp',
                    'Operational company data can be scheduled for purge after trial expiry. Login credentials stay intact so the workspace can be restored or activated later.',
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/70 bg-card shadow-[0_24px_80px_-56px_rgba(15,23,42,0.48)]">
              <CardHeader>
                <CardTitle>{tt('access.nextStepTitle', 'Next step')}</CardTitle>
                <CardDescription>
                  {tt(
                    'access.nextStepBody',
                    'Switch to another company, or request manual activation from the StockWise team if this workspace should continue operating.',
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CompanySwitcher />
                <div className="grid gap-3">
                  <Button variant="outline" onClick={() => void loadState(false)} disabled={refreshing}>
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? tt('common.loading', 'Loading...') : tt('access.refreshStatus', 'Refresh status')}
                  </Button>
                  <Button asChild>
                    <a href={activationHref}>{tt('access.requestActivation', 'Request activation')}</a>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/#pricing">{tt('access.openPricing', 'Open pricing')}</Link>
                  </Button>
                  {isPlatformAdmin ? (
                    <Button variant="outline" asChild>
                      <Link to="/platform-control">{tt('access.platformControl', 'Open platform control')}</Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card">
              <CardHeader>
                <CardTitle>{tt('access.retainedTitle', 'What stays intact')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm leading-6 text-muted-foreground">
                <p>
                  {tt(
                    'access.retainedUsers',
                    'User credentials remain in place. Trial expiry does not delete login identity.',
                  )}
                </p>
                <p>
                  {tt(
                    'access.retainedControl',
                    'Access grants and revokes remain audited for internal control and future payment automation.',
                  )}
                </p>
                <p>
                  {tt(
                    'access.retainedManual',
                    'Automatic payment collection is intentionally deferred. Manual activation remains the current commercial model.',
                  )}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

