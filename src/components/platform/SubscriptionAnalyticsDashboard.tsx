import { useMemo, useState } from 'react'
import {
  BarChart3,
  BadgeDollarSign,
  Building2,
  CalendarClock,
  Clock3,
  Filter,
  Search,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { CompanyAccessRow, SubscriptionStatus } from '../../lib/companyAccess'
import { formatMzn } from '../../lib/pricingPlans'

type CopyFn = (key: string, fallback: string, vars?: Record<string, string | number>) => string

type Props = {
  rows: CompanyAccessRow[]
  loading: boolean
  locale: string
  selectedCompanyId: string
  onRefresh: () => void | Promise<void>
  onSelectCompany: (companyId: string) => void
  tt: CopyFn
}

type ExpiryWindowFilter = 'all' | '14' | '30' | 'expired_30' | 'missing_dates'
type StatusFilter = 'all' | SubscriptionStatus

const statusOrder: SubscriptionStatus[] = ['active_paid', 'trial', 'expired', 'suspended', 'disabled']

const statusColors: Record<SubscriptionStatus, string> = {
  active_paid: '#16a34a',
  trial: '#0284c7',
  expired: '#f59e0b',
  suspended: '#f43f5e',
  disabled: '#7c3aed',
}

function toNumber(value: number | string | null | undefined) {
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : 0
}

function formatDate(value: string | null | undefined, locale: string, fallback = '-') {
  if (!value) return fallback
  return new Date(value).toLocaleDateString(locale)
}

function formatDateTime(value: string | null | undefined, locale: string, fallback = '-') {
  if (!value) return fallback
  return new Date(value).toLocaleString(locale)
}

function formatStatus(status: string | null | undefined, fallback = '-') {
  return status ? status.replaceAll('_', ' ') : fallback
}

function statusTone(status: SubscriptionStatus) {
  switch (status) {
    case 'active_paid':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
    case 'trial':
      return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
    case 'expired':
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
    case 'suspended':
    case 'disabled':
      return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
    default:
      return 'border-border bg-muted/20 text-foreground'
  }
}

function normalizedMonthlyValue(row: CompanyAccessRow) {
  if (toNumber(row.monthly_price_mzn) > 0) return toNumber(row.monthly_price_mzn)
  if (toNumber(row.annual_price_mzn) > 0) return toNumber(row.annual_price_mzn) / 12
  if (toNumber(row.starting_price_mzn) > 0) return toNumber(row.starting_price_mzn) / 12
  return 0
}

function normalizedAnnualValue(row: CompanyAccessRow) {
  if (toNumber(row.annual_price_mzn) > 0) return toNumber(row.annual_price_mzn)
  if (toNumber(row.monthly_price_mzn) > 0) return toNumber(row.monthly_price_mzn) * 12
  if (toNumber(row.starting_price_mzn) > 0) return toNumber(row.starting_price_mzn)
  return 0
}

function dayDelta(value: string | null | undefined) {
  if (!value) return null
  const expiresAt = new Date(value)
  if (Number.isNaN(expiresAt.getTime())) return null
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfExpiry = new Date(expiresAt.getFullYear(), expiresAt.getMonth(), expiresAt.getDate())
  const diffMs = startOfExpiry.getTime() - startOfToday.getTime()
  return Math.round(diffMs / 86400000)
}

function isExpiringSoon(row: CompanyAccessRow, windowDays: number) {
  if (!row.access_enabled) return false
  if (row.effective_status !== 'trial' && row.effective_status !== 'active_paid') return false
  const diff = dayDelta(row.access_expires_at)
  return diff != null && diff >= 0 && diff <= windowDays
}

function isRecentlyExpired(row: CompanyAccessRow, windowDays: number) {
  if (row.effective_status !== 'expired') return false
  const diff = dayDelta(row.access_expires_at)
  return diff != null && diff < 0 && Math.abs(diff) <= windowDays
}

function needsMetadataAttention(row: CompanyAccessRow) {
  if (!row.plan_code || !row.plan_name) return true
  if ((row.effective_status === 'trial' || row.effective_status === 'active_paid' || row.effective_status === 'expired') && !row.access_expires_at) {
    return true
  }
  if (!row.notification_recipient_email) return true
  return false
}

function matchesSearch(row: CompanyAccessRow, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [
    row.company_name,
    row.company_id,
    row.plan_code,
    row.plan_name,
    row.company_email,
    row.notification_recipient_email,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized))
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint: string
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.4)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</div>
    </div>
  )
}

function MonitoringList({
  title,
  description,
  rows,
  locale,
  emptyText,
  variant = 'default',
  actionLabel,
  onSelectCompany,
}: {
  title: string
  description: string
  rows: CompanyAccessRow[]
  locale: string
  emptyText: string
  variant?: 'default' | 'warning'
  actionLabel: string
  onSelectCompany: (companyId: string) => void
}) {
  return (
    <Card className="border-border/70 bg-card">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-4 text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.company_id}
              className={`rounded-2xl border p-4 ${
                variant === 'warning'
                  ? 'border-amber-200/70 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/10'
                  : 'border-border/70 bg-background'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{row.company_name || row.company_id}</div>
                  <div className="mt-1 break-all text-xs text-muted-foreground">
                    {row.notification_recipient_email || row.company_email || '-'}
                  </div>
                </div>
                <Badge className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row.effective_status)}`}>
                  {formatStatus(row.effective_status)}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>{formatDate(row.access_expires_at, locale, 'No expiry')}</div>
                <div>{formatDateTime(row.latest_member_last_sign_in_at, locale, 'No sign-in captured')}</div>
              </div>
              <Button className="mt-4" variant="outline" size="sm" onClick={() => onSelectCompany(row.company_id)}>
                {actionLabel}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export default function SubscriptionAnalyticsDashboard({
  rows,
  loading,
  locale,
  selectedCompanyId,
  onRefresh,
  onSelectCompany,
  tt,
}: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [planFilter, setPlanFilter] = useState<string>('all')
  const [expiryWindowFilter, setExpiryWindowFilter] = useState<ExpiryWindowFilter>('all')

  const planOptions = useMemo(
    () =>
      Array.from(
        new Map(
          rows
            .filter((row) => row.plan_code)
            .map((row) => [row.plan_code, { code: row.plan_code, name: row.plan_name || row.plan_code }]),
        ).values(),
      ).sort((left, right) => left.name.localeCompare(right.name)),
    [rows],
  )

  const overallMetrics = useMemo(() => {
    const total = rows.length
    const enabled = rows.filter((row) => row.access_enabled).length
    const trial = rows.filter((row) => row.effective_status === 'trial').length
    const paid = rows.filter((row) => row.effective_status === 'active_paid').length
    const expired = rows.filter((row) => row.effective_status === 'expired').length
    const restricted = rows.filter((row) => row.effective_status === 'suspended' || row.effective_status === 'disabled').length
    const expiringSoon = rows.filter((row) => isExpiringSoon(row, 14)).length
    const catalogMrr = rows
      .filter((row) => row.effective_status === 'active_paid')
      .reduce((sum, row) => sum + normalizedMonthlyValue(row), 0)
    const catalogArr = rows
      .filter((row) => row.effective_status === 'active_paid')
      .reduce((sum, row) => sum + normalizedAnnualValue(row), 0)

    return {
      total,
      enabled,
      trial,
      paid,
      expired,
      restricted,
      expiringSoon,
      catalogMrr,
      catalogArr,
    }
  }, [rows])

  const planDistribution = useMemo(
    () =>
      Array.from(
        rows.reduce<Map<string, { label: string; count: number; paidCount: number }>>((map, row) => {
          const key = row.plan_code || 'unassigned'
          const existing = map.get(key) || { label: row.plan_name || key, count: 0, paidCount: 0 }
          existing.count += 1
          if (row.effective_status === 'active_paid') existing.paidCount += 1
          map.set(key, existing)
          return map
        }, new Map()),
      )
        .map(([code, value]) => ({ code, ...value }))
        .sort((left, right) => right.count - left.count),
    [rows],
  )

  const statusDistribution = useMemo(
    () =>
      statusOrder.map((status) => ({
        status,
        label: formatStatus(status),
        count: rows.filter((row) => row.effective_status === status).length,
      })),
    [rows],
  )

  const expiringSoonRows = useMemo(
    () =>
      rows
        .filter((row) => isExpiringSoon(row, 14))
        .sort((left, right) => (dayDelta(left.access_expires_at) ?? 9999) - (dayDelta(right.access_expires_at) ?? 9999))
        .slice(0, 5),
    [rows],
  )

  const recentlyExpiredRows = useMemo(
    () =>
      rows
        .filter((row) => isRecentlyExpired(row, 30))
        .sort((left, right) => new Date(right.access_expires_at || 0).getTime() - new Date(left.access_expires_at || 0).getTime())
        .slice(0, 5),
    [rows],
  )

  const metadataAttentionRows = useMemo(
    () => rows.filter((row) => needsMetadataAttention(row)).slice(0, 5),
    [rows],
  )

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!matchesSearch(row, search)) return false
      if (statusFilter !== 'all' && row.effective_status !== statusFilter) return false
      if (planFilter !== 'all' && row.plan_code !== planFilter) return false
      if (expiryWindowFilter === '14' && !isExpiringSoon(row, 14)) return false
      if (expiryWindowFilter === '30' && !isExpiringSoon(row, 30)) return false
      if (expiryWindowFilter === 'expired_30' && !isRecentlyExpired(row, 30)) return false
      if (expiryWindowFilter === 'missing_dates' && !needsMetadataAttention(row)) return false
      return true
    })
  }, [rows, search, statusFilter, planFilter, expiryWindowFilter])

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card shadow-[0_26px_70px_-48px_rgba(15,23,42,0.5)]">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              {tt('platform.subscriptionAnalytics', 'Subscription analytics')}
            </div>
            <CardTitle className="mt-4 text-2xl tracking-tight">
              {tt('platform.subscriptionAnalyticsTitle', 'Platform subscription portfolio')}
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl text-sm leading-6">
              {tt(
                'platform.subscriptionAnalyticsBody',
                'This dashboard tracks company access distribution, catalogue-based recurring value, expiring tenants, and manual-control readiness. Revenue cards reflect current plan catalogue values, not collected payment revenue.',
              )}
            </CardDescription>
          </div>
          <Button variant="outline" onClick={() => void onRefresh()}>
            <TrendingUp className="mr-2 h-4 w-4" />
            {loading ? tt('platform.refreshing', 'Refreshing') : tt('platform.refreshPortfolio', 'Refresh portfolio')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
            <KpiCard
              label={tt('platform.kpiTotalCompanies', 'Total companies')}
              value={overallMetrics.total}
              hint={tt('platform.kpiTotalCompaniesHelp', 'All companies currently represented in the access-control catalogue.')}
            />
            <KpiCard
              label={tt('platform.kpiAccessEnabled', 'Access enabled')}
              value={overallMetrics.enabled}
              hint={tt('platform.kpiAccessEnabledHelp', 'Companies that can currently operate because access is still enabled.')}
            />
            <KpiCard
              label={tt('platform.kpiTrials', 'Trials')}
              value={overallMetrics.trial}
              hint={tt('platform.kpiTrialsHelp', 'Companies still running inside the active trial window.')}
            />
            <KpiCard
              label={tt('platform.kpiPaid', 'Active paid')}
              value={overallMetrics.paid}
              hint={tt('platform.kpiPaidHelp', 'Companies currently marked as active paid in the control plane.')}
            />
            <KpiCard
              label={tt('platform.kpiExpired', 'Expired')}
              value={overallMetrics.expired}
              hint={tt('platform.kpiExpiredHelp', 'Companies that already lost access because the trial or paid window expired.')}
            />
            <KpiCard
              label={tt('platform.kpiRestricted', 'Suspended / disabled')}
              value={overallMetrics.restricted}
              hint={tt('platform.kpiRestrictedHelp', 'Companies blocked manually through suspension or full disablement.')}
            />
            <KpiCard
              label={tt('platform.kpiCatalogMrr', 'Catalog MRR')}
              value={formatMzn(overallMetrics.catalogMrr, locale)}
              hint={tt('platform.kpiCatalogMrrHelp', 'Estimated from the current plan catalogue and active paid companies only.')}
            />
            <KpiCard
              label={tt('platform.kpiCatalogArr', 'Catalog ARR')}
              value={formatMzn(overallMetrics.catalogArr, locale)}
              hint={tt('platform.kpiCatalogArrHelp', 'Catalogue-based annualized value. This is not gateway-settled revenue.')}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Card className="border-border/70 bg-background">
              <CardHeader>
                <CardTitle className="text-lg">{tt('platform.planDistributionTitle', 'Plan distribution')}</CardTitle>
                <CardDescription>
                  {tt('platform.planDistributionHelp', 'Company counts by current plan code, with paid companies called out inside each plan bucket.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="h-72 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={planDistribution} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={0} angle={-18} textAnchor="end" height={56} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                      <Tooltip cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
                      <Bar dataKey="count" radius={[10, 10, 0, 0]} fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {planDistribution.map((plan) => (
                    <div key={plan.code} className="rounded-2xl border border-border/70 bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">{plan.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{plan.code}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-semibold text-foreground">{plan.count}</div>
                          <div className="text-xs text-muted-foreground">
                            {tt('platform.planDistributionPaid', '{count} paid', { count: plan.paidCount })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-background">
              <CardHeader>
                <CardTitle className="text-lg">{tt('platform.statusDistributionTitle', 'Status distribution')}</CardTitle>
                <CardDescription>
                  {tt('platform.statusDistributionHelp', 'Operational access posture across trial, active paid, expired, suspended, and disabled companies.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="h-72 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusDistribution} layout="vertical" margin={{ top: 8, right: 18, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                      <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                      <YAxis dataKey="label" type="category" width={96} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                      <Tooltip cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
                      <Bar dataKey="count" radius={[0, 10, 10, 0]}>
                        {statusDistribution.map((entry) => (
                          <Cell key={entry.status} fill={statusColors[entry.status]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {statusDistribution.map((entry) => (
                    <div key={entry.status} className="rounded-2xl border border-border/70 bg-card p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: statusColors[entry.status] }} />
                          <span className="font-medium text-foreground">{entry.label}</span>
                        </div>
                        <div className="text-lg font-semibold text-foreground">{entry.count}</div>
                      </div>
                    </div>
                  ))}
                  <div className="rounded-2xl border border-border/70 bg-muted/10 p-4 text-xs leading-5 text-muted-foreground">
                    {tt(
                      'platform.catalogRevenueNote',
                      'Catalog MRR and ARR cards use the current plan catalogue plus active paid companies. They intentionally do not represent payment-gateway cash collection.',
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <MonitoringList
              title={tt('platform.expiringSoonTitle', 'Companies expiring soon')}
              description={tt('platform.expiringSoonHelp', 'Companies with active trial or paid access ending in the next 14 days.')}
              rows={expiringSoonRows}
              locale={locale}
              emptyText={tt('platform.expiringSoonEmpty', 'No active companies are expiring in the next 14 days.')}
              variant="warning"
              actionLabel={tt('platform.openControl', 'Open control')}
              onSelectCompany={onSelectCompany}
            />
            <MonitoringList
              title={tt('platform.recentlyExpiredTitle', 'Recently expired')}
              description={tt('platform.recentlyExpiredHelp', 'Companies that expired in the last 30 days and may need follow-up or reactivation.')}
              rows={recentlyExpiredRows}
              locale={locale}
              emptyText={tt('platform.recentlyExpiredEmpty', 'No company expired within the last 30 days.')}
              actionLabel={tt('platform.openControl', 'Open control')}
              onSelectCompany={onSelectCompany}
            />
            <MonitoringList
              title={tt('platform.metadataAttentionTitle', 'Metadata attention')}
              description={tt('platform.metadataAttentionHelp', 'Companies missing a clear expiry, plan, or canonical recipient should be fixed before operational follow-up.')}
              rows={metadataAttentionRows}
              locale={locale}
              emptyText={tt('platform.metadataAttentionEmpty', 'All listed companies currently have plan, expiry, and recipient metadata in place.')}
              actionLabel={tt('platform.openControl', 'Open control')}
              onSelectCompany={onSelectCompany}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card">
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              {tt('platform.subscriptionRegister', 'Subscription register')}
            </div>
            <CardTitle className="mt-4 text-xl tracking-tight">
              {tt('platform.subscriptionRegisterTitle', 'Company subscription table')}
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl text-sm leading-6">
              {tt(
                'platform.subscriptionRegisterHelp',
                'Use search and filters to isolate expiring, trial, paid, or restricted companies, then open the company workspace below for manual action.',
              )}
            </CardDescription>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-xs leading-5 text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <BadgeDollarSign className="h-4 w-4 text-primary" />
              {tt('platform.subscriptionRegisterNoteTitle', 'No fake revenue')}
            </div>
            <div className="mt-1">
              {tt(
                'platform.subscriptionRegisterNoteBody',
                'Rows below use real company access state. Price-derived indicators come only from the current plan catalogue.',
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,0.65fr))]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={tt('platform.subscriptionSearchPlaceholder', 'Search company, plan, UUID, or contact email')}
                className="pl-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger>
                <SelectValue placeholder={tt('platform.status', 'Status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('platform.filterAllStatuses', 'All statuses')}</SelectItem>
                {statusOrder.map((status) => (
                  <SelectItem key={status} value={status}>
                    {formatStatus(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger>
                <SelectValue placeholder={tt('platform.plan', 'Plan')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('platform.filterAllPlans', 'All plans')}</SelectItem>
                {planOptions.map((option) => (
                  <SelectItem key={option.code} value={option.code}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={expiryWindowFilter} onValueChange={(value) => setExpiryWindowFilter(value as ExpiryWindowFilter)}>
              <SelectTrigger>
                <SelectValue placeholder={tt('platform.expiryWindow', 'Expiry window')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('platform.filterAllExpiries', 'All expiry states')}</SelectItem>
                <SelectItem value="14">{tt('platform.filterExpiring14', 'Expiring in 14 days')}</SelectItem>
                <SelectItem value="30">{tt('platform.filterExpiring30', 'Expiring in 30 days')}</SelectItem>
                <SelectItem value="expired_30">{tt('platform.filterExpired30', 'Expired in last 30 days')}</SelectItem>
                <SelectItem value="missing_dates">{tt('platform.filterMissingDates', 'Missing metadata')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-2xl border border-border/70">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/35 text-left">
                  <tr>
                    <th className="px-4 py-3">{tt('platform.company', 'Company')}</th>
                    <th className="px-4 py-3">{tt('platform.plan', 'Plan')}</th>
                    <th className="px-4 py-3">{tt('platform.status', 'Status')}</th>
                    <th className="px-4 py-3">{tt('platform.expiry', 'Expiry')}</th>
                    <th className="px-4 py-3">{tt('platform.accessType', 'Access type')}</th>
                    <th className="px-4 py-3">{tt('platform.contact', 'Contact')}</th>
                    <th className="px-4 py-3">{tt('platform.latestActivity', 'Latest sign-in')}</th>
                    <th className="px-4 py-3 text-right">{tt('platform.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const marker =
                      row.effective_status === 'active_paid'
                        ? tt('platform.paidMarker', 'Paid')
                        : row.effective_status === 'trial'
                          ? tt('platform.trialMarker', 'Trial')
                          : tt('platform.restrictedMarker', 'Restricted')

                    return (
                      <tr
                        key={row.company_id}
                        className={`border-t transition-colors hover:bg-muted/20 ${selectedCompanyId === row.company_id ? 'bg-muted/25' : ''}`}
                      >
                        <td className="px-4 py-4 align-top">
                          <div className="flex items-start gap-3">
                            <span className="mt-1 rounded-xl border border-border/70 bg-background p-2 text-muted-foreground">
                              <Building2 className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">{row.company_name || row.company_id}</div>
                              <div className="mt-1 break-all text-xs text-muted-foreground">{row.company_id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="font-medium text-foreground">{row.plan_name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{row.plan_code}</div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <Badge className={`rounded-full border px-2.5 py-1 font-medium capitalize ${statusTone(row.effective_status)}`}>
                            {formatStatus(row.effective_status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="font-medium text-foreground">
                            {formatDate(row.access_expires_at, locale, tt('platform.noExpiry', 'No expiry'))}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.purge_scheduled_at
                              ? tt('platform.purgeOn', 'Purge on {date}', {
                                  date: formatDate(row.purge_scheduled_at, locale),
                                })
                              : tt('platform.noPurgeScheduled', 'No purge scheduled')}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="font-medium text-foreground">{marker}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.manual_activation_only
                              ? tt('platform.manualActivationOnly', 'Manual activation only')
                              : tt('platform.autoReady', 'Automation-ready')}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="break-all font-medium text-foreground">
                            {row.notification_recipient_email || row.company_email || tt('platform.notCaptured', 'Not captured')}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top">
                          <div className="font-medium text-foreground">
                            {formatDateTime(row.latest_member_last_sign_in_at, locale, tt('platform.notCaptured', 'Not captured'))}
                          </div>
                        </td>
                        <td className="px-4 py-4 align-top text-right">
                          <Button variant="outline" size="sm" onClick={() => onSelectCompany(row.company_id)}>
                            <CalendarClock className="mr-2 h-4 w-4" />
                            {tt('platform.openControl', 'Open control')}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}

                  {!loading && filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center">
                        <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6 text-sm text-muted-foreground">
                          <div className="flex items-center justify-center gap-2 font-medium text-foreground">
                            <Clock3 className="h-4 w-4 text-primary" />
                            {tt('platform.subscriptionTableEmptyTitle', 'No companies match the current filters')}
                          </div>
                          <p className="mt-2 leading-6">
                            {tt(
                              'platform.subscriptionTableEmptyBody',
                              'Adjust the plan, status, expiry, or search filters to restore the subscription portfolio view.',
                            )}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
            <div>
              {tt('platform.filteredRows', 'Showing {count} companies in the current filtered view.', {
                count: filteredRows.length,
              })}
            </div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-300" />
              {tt(
                'platform.catalogRevenueDisclosure',
                'MRR and ARR cards are catalogue-based control indicators. They are not payment-gateway revenue.',
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
