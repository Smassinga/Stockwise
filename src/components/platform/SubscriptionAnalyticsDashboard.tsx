import { useMemo, useState } from 'react'
import {
  BadgeDollarSign,
  BarChart3,
  Building2,
  CalendarClock,
  Clock3,
  Filter,
  Info,
  Search,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import type { CompanyAccessRow, SubscriptionStatus } from '../../lib/companyAccess'
import { formatMzn } from '../../lib/pricingPlans'
import { cn } from '../../lib/utils'

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

function sharePercent(count: number, total: number) {
  if (total <= 0) return 0
  return Math.round((count / total) * 100)
}

function summaryTone(tone: 'default' | 'primary' | 'success' | 'warning' | 'danger') {
  switch (tone) {
    case 'primary':
      return 'border-primary/20 bg-primary/[0.06]'
    case 'success':
      return 'border-emerald-200/80 bg-emerald-50/80 dark:border-emerald-500/20 dark:bg-emerald-500/10'
    case 'warning':
      return 'border-amber-200/80 bg-amber-50/80 dark:border-amber-500/20 dark:bg-amber-500/10'
    case 'danger':
      return 'border-rose-200/80 bg-rose-50/80 dark:border-rose-500/20 dark:bg-rose-500/10'
    default:
      return 'border-border/70 bg-background'
  }
}

function PortfolioMetricCard({
  title,
  description,
  tone = 'default',
  metrics,
  footer,
  metricLayout = 'grid',
  metricSurface = 'plain',
  metricValueClassName,
}: {
  title: string
  description?: string
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger'
  metrics: Array<{ label: string; value: string | number; caption?: string }>
  footer?: string
  metricLayout?: 'grid' | 'stacked'
  metricSurface?: 'plain' | 'panel'
  metricValueClassName?: string
}) {
  const stackedMetrics = metricLayout === 'stacked'
  const panelMetrics = metricSurface === 'panel'

  return (
    <div
      data-subscription-metric-card={title}
      className={`rounded-[1.5rem] border p-5 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.6)] ${summaryTone(tone)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div> : null}
        </div>
      </div>
      <div
        className={cn(
          'mt-5 grid gap-4',
          stackedMetrics || metrics.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
        )}
      >
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className={cn(
              'min-w-0',
              panelMetrics && 'rounded-2xl border border-border/70 bg-background/75 px-4 py-4 dark:bg-background/60',
            )}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {metric.label}
            </div>
            <div
              className={cn(
                'mt-2 font-semibold leading-none tracking-[-0.03em] text-foreground',
                metricValueClassName ?? 'text-[clamp(1.7rem,2.2vw,2.35rem)]',
              )}
            >
              {metric.value}
            </div>
            {metric.caption ? <div className="mt-2 text-xs leading-5 text-muted-foreground">{metric.caption}</div> : null}
          </div>
        ))}
      </div>
      {footer ? <div className="mt-4 border-t border-border/60 pt-3 text-xs leading-5 text-muted-foreground">{footer}</div> : null}
    </div>
  )
}

function InsightTile({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
    </div>
  )
}

function LegendPill({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="truncate text-muted-foreground">{label}</span>
      </div>
      <span className="font-semibold text-foreground">{value}</span>
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
    <Card className="border-border/70 bg-card shadow-[0_22px_50px_-42px_rgba(15,23,42,0.55)]">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-sm leading-6">{description}</CardDescription>
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
                  <div className="mt-1 break-all text-xs leading-5 text-muted-foreground">
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
              <Button className="mt-4 w-full sm:w-auto" variant="outline" size="sm" onClick={() => onSelectCompany(row.company_id)}>
                {actionLabel}
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function MobileCompanyCard({
  row,
  locale,
  selectedCompanyId,
  onSelectCompany,
  tt,
}: {
  row: CompanyAccessRow
  locale: string
  selectedCompanyId: string
  onSelectCompany: (companyId: string) => void
  tt: CopyFn
}) {
  const expiryDelta = dayDelta(row.access_expires_at)
  const expiryCaption =
    expiryDelta == null
      ? tt('platform.noExpiry', 'No expiry')
      : expiryDelta < 0
        ? tt('platform.expiredDaysAgo', 'Expired {days} days ago', { days: Math.abs(expiryDelta) })
        : tt('platform.expiresInDays', 'Expires in {days} days', { days: expiryDelta })
  const accessMarker =
    row.effective_status === 'active_paid'
      ? tt('platform.paidMarker', 'Paid')
      : row.effective_status === 'trial'
        ? tt('platform.trialMarker', 'Trial')
        : tt('platform.restrictedMarker', 'Restricted')

  return (
    <div
      data-subscription-company-card={row.company_id}
      className={`rounded-[1.5rem] border p-4 shadow-[0_20px_45px_-40px_rgba(15,23,42,0.55)] ${
        selectedCompanyId === row.company_id ? 'border-primary/40 bg-primary/[0.04]' : 'border-border/70 bg-background'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-foreground">{row.company_name || row.company_id}</div>
          <div className="mt-1 break-all text-xs leading-5 text-muted-foreground">{row.company_id}</div>
        </div>
        <Badge className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row.effective_status)}`}>
          {formatStatus(row.effective_status)}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="secondary" className="rounded-full bg-muted/60 px-2.5 py-1 font-medium text-foreground">
          {row.plan_name || row.plan_code}
        </Badge>
        <Badge variant="outline" className="rounded-full px-2.5 py-1 text-xs font-medium">
          {accessMarker}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-muted/10 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {tt('platform.expiry', 'Expiry')}
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">
            {formatDate(row.access_expires_at, locale, tt('platform.noExpiry', 'No expiry'))}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{expiryCaption}</div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-muted/10 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {tt('platform.latestActivity', 'Latest sign-in')}
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">
            {formatDateTime(row.latest_member_last_sign_in_at, locale, tt('platform.notCaptured', 'Not captured'))}
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            {row.active_member_count} / {row.member_count} {tt('platform.members', 'Members').toLowerCase()}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border/70 bg-muted/10 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {tt('platform.contact', 'Contact')}
        </div>
        <div className="mt-2 break-all text-sm font-medium text-foreground">
          {row.notification_recipient_email || row.company_email || tt('platform.notCaptured', 'Not captured')}
        </div>
      </div>

      <Button className="mt-4 w-full" variant="outline" onClick={() => onSelectCompany(row.company_id)}>
        <CalendarClock className="mr-2 h-4 w-4" />
        {tt('platform.openControl', 'Open control')}
      </Button>
    </div>
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
    const recentlyExpired = rows.filter((row) => isRecentlyExpired(row, 30)).length
    const metadataAttention = rows.filter((row) => needsMetadataAttention(row)).length
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
      recentlyExpired,
      metadataAttention,
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

  const metadataAttentionRows = useMemo(() => rows.filter((row) => needsMetadataAttention(row)).slice(0, 5), [rows])

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

  const leadPlan = planDistribution[0] || null
  const unassignedPlanCount = planDistribution.find((plan) => plan.code === 'unassigned')?.count ?? 0

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <Card className="overflow-hidden border-border/70 bg-card shadow-[0_30px_80px_-52px_rgba(15,23,42,0.55)]">
          <CardHeader className="gap-6 border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.04] pb-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-4xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  <BarChart3 className="h-3.5 w-3.5" />
                  {tt('platform.subscriptionAnalytics', 'Subscription analytics')}
                </div>
                <CardTitle className="mt-4 text-2xl tracking-tight md:text-3xl">
                  {tt('platform.subscriptionAnalyticsTitle', 'Platform subscription portfolio')}
                </CardTitle>
                <CardDescription className="mt-2 max-w-3xl text-sm leading-6">
                  {tt(
                    'platform.subscriptionPortfolioSubtitle',
                    'Monitor company access health, plan mix, renewal pressure, and catalogue-based recurring value from one admin-only portfolio view.',
                  )}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-xs leading-5 text-muted-foreground">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <BadgeDollarSign className="h-4 w-4 text-primary" />
                    {tt('platform.catalogOnlyLabel', 'Catalogue indicators only')}
                  </div>
                  <div className="mt-1">
                    {tt(
                      'platform.catalogRevenueDisclosure',
                      'MRR and ARR below are catalogue-based control indicators, not collected payment revenue.',
                    )}
                  </div>
                </div>
                <Button variant="outline" onClick={() => void onRefresh()}>
                  <TrendingUp className="mr-2 h-4 w-4" />
                  {loading ? tt('platform.refreshing', 'Refreshing') : tt('platform.refreshPortfolio', 'Refresh portfolio')}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <InsightTile
                label={tt('platform.portfolioCoverage', 'Access enabled')}
                value={`${overallMetrics.enabled} / ${overallMetrics.total}`}
              />
              <InsightTile
                label={tt('platform.portfolioRenewalPressure', 'Expiring in 14 days')}
                value={overallMetrics.expiringSoon}
              />
              <InsightTile
                label={tt('platform.portfolioPlanLeader', 'Largest plan bucket')}
                value={leadPlan ? leadPlan.label : tt('platform.notCaptured', 'Not captured')}
              />
              <InsightTile
                label={tt('platform.portfolioDataAttention', 'Metadata attention')}
                value={overallMetrics.metadataAttention}
              />
            </div>
          </CardHeader>

          <CardContent className="space-y-6 p-6">
            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-[1fr_1fr_1fr_1fr_1.05fr]">
              <PortfolioMetricCard
                title={tt('platform.portfolioReachTitle', 'Portfolio reach')}
                description={tt('platform.portfolioReachHelp', 'How much of the tenant portfolio is currently operable.')}
                metrics={[
                  {
                    label: tt('platform.kpiTotalCompanies', 'Total companies'),
                    value: overallMetrics.total,
                  },
                  {
                    label: tt('platform.kpiAccessEnabled', 'Access enabled'),
                    value: overallMetrics.enabled,
                    caption: tt('platform.accessEnabledShare', '{share}% of companies', {
                      share: sharePercent(overallMetrics.enabled, overallMetrics.total),
                    }),
                  },
                ]}
              />

              <PortfolioMetricCard
                title={tt('platform.portfolioActiveTitle', 'Active pipeline')}
                description={tt('platform.portfolioActiveHelp', 'Trials and active paid companies currently inside a valid access window.')}
                tone="success"
                metrics={[
                  {
                    label: tt('platform.kpiTrials', 'Trials'),
                    value: overallMetrics.trial,
                  },
                  {
                    label: tt('platform.kpiPaid', 'Active paid'),
                    value: overallMetrics.paid,
                  },
                ]}
              />

              <PortfolioMetricCard
                title={tt('platform.portfolioRiskTitle', 'Restricted and expired')}
                description={tt('platform.portfolioRiskHelp', 'Companies that already require manual intervention or reactivation.')}
                tone="warning"
                metrics={[
                  {
                    label: tt('platform.kpiExpired', 'Expired'),
                    value: overallMetrics.expired,
                    caption: tt('platform.recentlyExpiredShort', '{count} recent', {
                      count: overallMetrics.recentlyExpired,
                    }),
                  },
                  {
                    label: tt('platform.kpiRestricted', 'Suspended / disabled'),
                    value: overallMetrics.restricted,
                  },
                ]}
              />

              <PortfolioMetricCard
                title={tt('platform.portfolioValueTitle', 'Catalogue value')}
                description={tt('platform.portfolioValueHelp', 'Commercial sizing derived only from active paid companies and the current plan catalogue.')}
                tone="primary"
                metricLayout="stacked"
                metricSurface="panel"
                metricValueClassName="text-[clamp(1.45rem,1.75vw,1.95rem)]"
                metrics={[
                  {
                    label: tt('platform.kpiCatalogMrr', 'Catalog MRR'),
                    value: formatMzn(overallMetrics.catalogMrr, locale),
                  },
                  {
                    label: tt('platform.kpiCatalogArr', 'Catalog ARR'),
                    value: formatMzn(overallMetrics.catalogArr, locale),
                  },
                ]}
                footer={tt(
                  'platform.catalogValueFooter',
                  'Use these as portfolio sizing indicators only. They do not represent gateway-settled revenue.',
                )}
              />

              <PortfolioMetricCard
                title={tt('platform.portfolioAttentionTitle', 'Follow-up queue')}
                description={tt('platform.portfolioAttentionHelp', 'Renewal pressure and missing metadata that deserve platform-admin attention next.')}
                tone="danger"
                metrics={[
                  {
                    label: tt('platform.kpiExpiringSoon', 'Expiring soon'),
                    value: overallMetrics.expiringSoon,
                    caption: tt('platform.expiringWindowShort', 'Next 14 days'),
                  },
                  {
                    label: tt('platform.kpiMetadataAttention', 'Metadata attention'),
                    value: overallMetrics.metadataAttention,
                  },
                ]}
              />
            </div>

            <div className="grid gap-6 2xl:grid-cols-[1.15fr_0.85fr]">
              <Card
                data-subscription-distribution="plans"
                className="border-border/70 bg-background shadow-[0_24px_55px_-46px_rgba(15,23,42,0.6)]"
              >
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{tt('platform.planDistributionTitle', 'Plan distribution')}</CardTitle>
                      <CardDescription className="mt-1 text-sm leading-6">
                        {tt('platform.planDistributionShort', 'Plan mix across the full company portfolio, with active paid coverage inside each bucket.')}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" className="rounded-full bg-muted/60 px-3 py-1 font-medium text-foreground">
                      {tt('platform.planBuckets', '{count} plan buckets', { count: planDistribution.length })}
                    </Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <InsightTile
                      label={tt('platform.largestPlan', 'Largest plan')}
                      value={leadPlan ? leadPlan.label : tt('platform.notCaptured', 'Not captured')}
                    />
                    <InsightTile
                      label={tt('platform.paidCoverage', 'Paid coverage')}
                      value={`${sharePercent(overallMetrics.paid, overallMetrics.total)}%`}
                    />
                    <InsightTile
                      label={tt('platform.unassignedPlans', 'Unassigned')}
                      value={unassignedPlanCount}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {planDistribution.map((plan) => {
                    const distributionWidth = sharePercent(plan.count, Math.max(overallMetrics.total, 1))
                    const paidShare = sharePercent(plan.paidCount, Math.max(plan.count, 1))

                    return (
                      <div
                        key={plan.code}
                        data-plan-row={plan.code}
                        className="rounded-[1.35rem] border border-border/70 bg-card p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">{plan.label}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{plan.code}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-foreground">{plan.count}</div>
                            <div className="text-xs text-muted-foreground">
                              {tt('platform.planShare', '{share}% of portfolio', { share: distributionWidth })}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted/45">
                          <div
                            className="h-full rounded-full bg-primary transition-[width]"
                            style={{ width: `${distributionWidth}%` }}
                          />
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>{tt('platform.planDistributionPaid', '{count} paid', { count: plan.paidCount })}</span>
                          <span>{tt('platform.planPaidShare', '{share}% of this bucket', { share: paidShare })}</span>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>

              <Card
                data-subscription-distribution="statuses"
                className="border-border/70 bg-background shadow-[0_24px_55px_-46px_rgba(15,23,42,0.6)]"
              >
                <CardHeader className="gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{tt('platform.statusDistributionTitle', 'Status distribution')}</CardTitle>
                      <CardDescription className="mt-1 text-sm leading-6">
                        {tt('platform.statusDistributionShort', 'Operational subscription health across paid, trial, expired, suspended, and disabled states.')}
                      </CardDescription>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/15 px-3 py-1 text-xs font-medium text-muted-foreground"
                        >
                          <Info className="h-3.5 w-3.5" />
                          {tt('platform.catalogNote', 'Catalogue note')}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs leading-5">
                        {tt(
                          'platform.catalogRevenueDisclosure',
                          'MRR and ARR below are catalogue-based control indicators, not collected payment revenue.',
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <LegendPill
                      label={tt('platform.activeStates', 'Access enabled')}
                      value={`${sharePercent(overallMetrics.enabled, overallMetrics.total)}%`}
                      color={statusColors.active_paid}
                    />
                    <LegendPill
                      label={tt('platform.recentlyExpiredTitle', 'Recently expired')}
                      value={overallMetrics.recentlyExpired}
                      color={statusColors.expired}
                    />
                    <LegendPill
                      label={tt('platform.kpiRestricted', 'Suspended / disabled')}
                      value={overallMetrics.restricted}
                      color={statusColors.suspended}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {statusDistribution.map((entry) => {
                    const distributionWidth = sharePercent(entry.count, Math.max(overallMetrics.total, 1))

                    return (
                      <div
                        key={entry.status}
                        data-status-row={entry.status}
                        className="rounded-[1.35rem] border border-border/70 bg-card p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColors[entry.status] }} />
                            <span className="truncate font-medium text-foreground">{entry.label}</span>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-foreground">{entry.count}</div>
                            <div className="text-xs text-muted-foreground">{distributionWidth}%</div>
                          </div>
                        </div>
                        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-muted/45">
                          <div
                            className="h-full rounded-full transition-[width]"
                            style={{ width: `${distributionWidth}%`, backgroundColor: statusColors[entry.status] }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">{tt('platform.followUpTitle', 'Operational follow-up')}</div>
                  <div className="mt-1 text-sm leading-6 text-muted-foreground">
                    {tt(
                      'platform.followUpHelp',
                      'Use these queues to open the selected company workspace below when renewal, restriction, or metadata cleanup is needed.',
                    )}
                  </div>
                </div>
              </div>
              <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-[1fr_1fr_0.9fr]">
                <MonitoringList
                  title={tt('platform.expiringSoonTitle', 'Companies expiring soon')}
                  description={tt('platform.expiringSoonHelp', 'Active trial or paid companies whose access ends within the next 14 days.')}
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
                  description={tt('platform.metadataAttentionHelp', 'Missing plan, expiry, or canonical recipient details that weaken subscription operations.')}
                  rows={metadataAttentionRows}
                  locale={locale}
                  emptyText={tt('platform.metadataAttentionEmpty', 'All listed companies currently have plan, expiry, and recipient metadata in place.')}
                  actionLabel={tt('platform.openControl', 'Open control')}
                  onSelectCompany={onSelectCompany}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          data-subscription-register="true"
          className="border-border/70 bg-card shadow-[0_28px_70px_-52px_rgba(15,23,42,0.55)]"
        >
          <CardHeader className="gap-4 border-b border-border/70 bg-gradient-to-br from-background via-background to-muted/10">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
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
                    'Search the portfolio, isolate the companies that need attention, and open the company workspace below for manual action.',
                  )}
                </CardDescription>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-xs leading-5 text-muted-foreground">
                {tt(
                  'platform.subscriptionRegisterCompactNote',
                  'Rows reflect real access state. Commercial values still come only from the current plan catalogue.',
                )}
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.8fr))]">
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
          </CardHeader>

          <CardContent className="space-y-4 p-6">
            <div className="grid gap-3 md:hidden">
              {filteredRows.map((row) => (
                <MobileCompanyCard
                  key={row.company_id}
                  row={row}
                  locale={locale}
                  selectedCompanyId={selectedCompanyId}
                  onSelectCompany={onSelectCompany}
                  tt={tt}
                />
              ))}

              {!loading && filteredRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2 font-medium text-foreground">
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
              ) : null}
            </div>

            <div className="hidden overflow-hidden rounded-[1.5rem] border border-border/70 md:block">
              <div className="overflow-x-auto">
                <table className="min-w-[920px] w-full text-sm">
                  <thead className="bg-muted/35 text-left">
                    <tr>
                      <th className="px-4 py-3">{tt('platform.company', 'Company')}</th>
                      <th className="px-4 py-3">{tt('platform.plan', 'Plan')}</th>
                      <th className="px-4 py-3">{tt('platform.status', 'Status')}</th>
                      <th className="px-4 py-3">{tt('platform.expiry', 'Expiry')}</th>
                      <th className="px-4 py-3">{tt('platform.contact', 'Contact')}</th>
                      <th className="px-4 py-3">{tt('platform.latestActivity', 'Latest sign-in')}</th>
                      <th className="px-4 py-3 text-right">{tt('platform.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const expiryDelta = dayDelta(row.access_expires_at)
                      const expiryLabel =
                        expiryDelta == null
                          ? tt('platform.noExpiry', 'No expiry')
                          : expiryDelta < 0
                            ? tt('platform.expiredDaysAgo', 'Expired {days} days ago', { days: Math.abs(expiryDelta) })
                            : tt('platform.expiresInDays', 'Expires in {days} days', { days: expiryDelta })

                      const accessMarker =
                        row.effective_status === 'active_paid'
                          ? tt('platform.paidMarker', 'Paid')
                          : row.effective_status === 'trial'
                            ? tt('platform.trialMarker', 'Trial')
                            : tt('platform.restrictedMarker', 'Restricted')

                      return (
                        <tr
                          key={row.company_id}
                          data-subscription-row={row.company_id}
                          className={`border-t transition-colors hover:bg-muted/20 ${selectedCompanyId === row.company_id ? 'bg-primary/[0.04]' : ''}`}
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
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Badge variant="secondary" className="rounded-full bg-muted/60 px-2.5 py-1 font-medium text-foreground">
                                {row.plan_code}
                              </Badge>
                              <Badge variant="outline" className="rounded-full px-2.5 py-1 text-xs font-medium">
                                {accessMarker}
                              </Badge>
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <Badge className={`rounded-full border px-2.5 py-1 font-medium capitalize ${statusTone(row.effective_status)}`}>
                              {formatStatus(row.effective_status)}
                            </Badge>
                            <div className="mt-2 text-xs text-muted-foreground">
                              {row.active_member_count} / {row.member_count} {tt('platform.members', 'Members').toLowerCase()}
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="font-medium text-foreground">
                              {formatDate(row.access_expires_at, locale, tt('platform.noExpiry', 'No expiry'))}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{expiryLabel}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {row.purge_scheduled_at
                                ? tt('platform.purgeOn', 'Purge on {date}', {
                                    date: formatDate(row.purge_scheduled_at, locale),
                                  })
                                : tt('platform.noPurgeScheduled', 'No purge scheduled')}
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
                        <td colSpan={7} className="px-4 py-12 text-center">
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
                  'platform.subscriptionRegisterCompactNote',
                  'Rows reflect real access state. Commercial values still come only from the current plan catalogue.',
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  )
}
