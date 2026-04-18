import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CalendarDays,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import {
  getCompanyAccessDetail,
  listCompanyAccess,
  listCompanyAccessEvents,
  listCompanyControlActions,
  resetCompanyOperationalData,
  setCompanyAccess,
  type CompanyAccessAuditRow,
  type CompanyAccessDetail,
  type CompanyAccessRow,
  type CompanyControlActionRow,
  type SubscriptionStatus,
} from '../lib/companyAccess'
import { internalPlanOptions } from '../lib/pricingPlans'
import { useI18n, withI18nFallback } from '../lib/i18n'

function asDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : ''
}

function formatDate(value: string | null | undefined, locale: string, fallback = '—') {
  if (!value) return fallback
  return new Date(value).toLocaleDateString(locale)
}

function formatDateTime(value: string | null | undefined, locale: string, fallback = '—') {
  if (!value) return fallback
  return new Date(value).toLocaleString(locale)
}

function formatStatus(status: string | null | undefined, fallback = '—') {
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

function ownerSourceLabel(source: string | null | undefined) {
  switch (source) {
    case 'company_owner':
      return 'Company owner field'
    case 'active_owner_member':
      return 'Active owner membership'
    case 'active_admin_member':
      return 'Active admin membership fallback'
    default:
      return 'Not captured'
  }
}

function controlActionLabel(actionType: string | null | undefined) {
  switch (actionType) {
    case 'operational_reset':
      return 'Operational data reset'
    default:
      return actionType ? actionType.replaceAll('_', ' ') : 'Control action'
  }
}

function countDeletedRows(summary: Record<string, unknown> | null | undefined) {
  if (!summary || typeof summary !== 'object') return 0
  return Object.values(summary).reduce((total, value) => total + (typeof value === 'number' ? value : 0), 0)
}

export default function PlatformControlPage() {
  const { lang, t } = useI18n()
  const tt = useCallback(
    (key: string, fallback: string, vars?: Record<string, string | number>) =>
      withI18nFallback(t, key, fallback, vars),
    [t],
  )
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'

  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<CompanyAccessRow[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [detail, setDetail] = useState<CompanyAccessDetail | null>(null)
  const [auditRows, setAuditRows] = useState<CompanyAccessAuditRow[]>([])
  const [controlRows, setControlRows] = useState<CompanyControlActionRow[]>([])
  const [status, setStatus] = useState<SubscriptionStatus>('active_paid')
  const [planCode, setPlanCode] = useState<string>('starter')
  const [paidUntil, setPaidUntil] = useState('')
  const [trialExpiresAt, setTrialExpiresAt] = useState('')
  const [purgeScheduledAt, setPurgeScheduledAt] = useState('')
  const [reason, setReason] = useState('')
  const [resetOpen, setResetOpen] = useState(false)
  const [resetReason, setResetReason] = useState('')
  const [resetConfirmation, setResetConfirmation] = useState('')

  const selectedRow = useMemo(
    () => rows.find((row) => row.company_id === selectedCompanyId) || null,
    [rows, selectedCompanyId],
  )

  const selectedCompanyName =
    detail?.company_name || selectedRow?.company_name || tt('platform.selectCompany', 'Choose a company from the register first.')

  const selectedStatus = detail?.effective_status || selectedRow?.effective_status || 'trial'

  const resetDeletes = useMemo(
    () => [
      tt('platform.resetDeletesOrders', 'Sales orders, purchase orders, invoices, vendor bills, and related adjustments'),
      tt('platform.resetDeletesTreasury', 'Bank transactions, cash transactions, settlements, and treasury movement history'),
      tt('platform.resetDeletesInventory', 'Items, BOM data, stock levels, stock movements, warehouses, bins, and builds'),
      tt('platform.resetDeletesParties', 'Customers, suppliers, reminders, notifications, and company-scoped operational activity'),
    ],
    [tt],
  )

  const resetKeeps = useMemo(
    () => [
      tt('platform.resetKeepsCompany', 'Company shell, company settings, and company memberships'),
      tt('platform.resetKeepsAccess', 'Subscription state, access audit history, purge history, and platform-control audit'),
      tt('platform.resetKeepsIdentity', 'Auth users, credentials, and platform-admin identity records'),
      tt('platform.resetKeepsFiscal', 'Payment terms, currencies, fiscal settings, fiscal series, and numbering counters'),
    ],
    [tt],
  )

  const summary = useMemo(() => {
    return rows.reduce<Record<string, number>>((totals, row) => {
      totals[row.effective_status] = (totals[row.effective_status] || 0) + 1
      return totals
    }, {})
  }, [rows])

  const loadCompanies = useCallback(
    async (nextSearch?: string, preferredCompanyId?: string) => {
      setLoading(true)
      try {
        const companyRows = await listCompanyAccess(nextSearch ?? search)
        setRows(companyRows)
        setSelectedCompanyId((currentId) => {
          const targetId = preferredCompanyId ?? currentId
          if (targetId && companyRows.some((row) => row.company_id === targetId)) return targetId
          return companyRows[0]?.company_id || ''
        })
      } finally {
        setLoading(false)
      }
    },
    [search],
  )

  const fetchSelectedCompanyData = useCallback(async (companyId: string) => {
    const [detailRow, events, controlEvents] = await Promise.all([
      getCompanyAccessDetail(companyId),
      listCompanyAccessEvents(companyId),
      listCompanyControlActions(companyId),
    ])
    return {
      detailRow,
      events,
      controlEvents,
    }
  }, [])

  useEffect(() => {
    void loadCompanies()
  }, [loadCompanies])

  useEffect(() => {
    if (!selectedCompanyId) {
      setDetail(null)
      setAuditRows([])
      setControlRows([])
      return
    }

    let cancelled = false
    setDetail(null)
    setAuditRows([])
    setControlRows([])
    setDetailLoading(true)

    ;(async () => {
      try {
        const { detailRow, events, controlEvents } = await fetchSelectedCompanyData(selectedCompanyId)
        if (cancelled) return
        setDetail(detailRow)
        setAuditRows(events)
        setControlRows(controlEvents)
      } catch (error) {
        if (cancelled) return
        console.error(error)
        toast.error(tt('platform.detailLoadFailed', 'Failed to load company control details.'))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchSelectedCompanyData, selectedCompanyId, tt])

  useEffect(() => {
    if (!detail) {
      setPlanCode('starter')
      setStatus('active_paid')
      setPaidUntil('')
      setTrialExpiresAt('')
      setPurgeScheduledAt('')
      setReason('')
      setResetReason('')
      setResetConfirmation('')
      return
    }

    setPlanCode(detail.plan_code)
    setStatus(detail.subscription_status)
    setPaidUntil(asDateInput(detail.paid_until))
    setTrialExpiresAt(asDateInput(detail.trial_expires_at))
    setPurgeScheduledAt(asDateInput(detail.purge_scheduled_at))
    setReason('')
    setResetReason('')
    setResetConfirmation('')
  }, [detail])

  async function refreshSelectedCompany(companyId: string) {
    const { detailRow, events, controlEvents } = await fetchSelectedCompanyData(companyId)
    setDetail(detailRow)
    setAuditRows(events)
    setControlRows(controlEvents)
  }

  async function applyChange() {
    if (!detail) return
    try {
      setSaving(true)
      await setCompanyAccess({
        companyId: detail.company_id,
        planCode,
        status,
        paidUntil: paidUntil || null,
        trialExpiresAt: trialExpiresAt || null,
        purgeScheduledAt: purgeScheduledAt || null,
        reason: reason || null,
      })
      await Promise.all([loadCompanies(undefined, detail.company_id), refreshSelectedCompany(detail.company_id)])
      toast.success(tt('platform.saved', 'Company access updated.'))
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('platform.saveFailed', 'Failed to update company access.'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmReset() {
    if (!detail) return
    try {
      setResetting(true)
      const result = await resetCompanyOperationalData({
        companyId: detail.company_id,
        confirmation: resetConfirmation,
        reason: resetReason,
      })
      await Promise.all([loadCompanies(undefined, detail.company_id), refreshSelectedCompany(detail.company_id)])
      setResetOpen(false)
      setResetConfirmation('')
      setResetReason('')
      toast.success(
        tt('platform.resetSuccess', 'Operational company data reset completed ({count} rows removed).', {
          count: countDeletedRows(result?.deleted_summary),
        }),
      )
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('platform.resetFailed', 'Failed to reset company operational data.'))
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
      <AlertDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!resetting) setResetOpen(open)
        }}
      >
        <div className="mx-auto max-w-7xl space-y-6">
          <Card className="overflow-hidden border-border/70 bg-card shadow-[0_28px_90px_-56px_rgba(15,23,42,0.55)]">
            <CardHeader className="border-b border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.05]">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-background/85 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                {tt('platform.eyebrow', 'Platform control')}
              </div>
              <CardTitle className="mt-4 text-3xl tracking-tight">
                {tt('platform.title', 'Manual subscription and access control')}
              </CardTitle>
              <CardDescription className="max-w-3xl text-base leading-7">
                {tt(
                  'platform.description',
                  'This control plane governs 7-day trials, manual paid activation, suspensions, expiry, and guarded operational resets. Payment automation remains intentionally deferred.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 p-6 md:grid-cols-4">
              {([
                ['trial', tt('platform.trial', 'Trial')],
                ['active_paid', tt('platform.activePaid', 'Active paid')],
                ['expired', tt('platform.expired', 'Expired')],
                ['suspended', tt('platform.restricted', 'Suspended / disabled')],
              ] as const).map(([key, label]) => (
                <div key={key} className="rounded-2xl border border-border/70 bg-background p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                  <div className="mt-2 text-3xl font-semibold">{summary[key] || 0}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card">
            <CardHeader>
              <CardTitle>{tt('platform.adminAccessTitle', 'Admin access and first setup')}</CardTitle>
              <CardDescription>
                {tt(
                  'platform.adminAccessBody',
                  'Platform control is permission-based. The route is /platform-control and it only appears in navigation for active platform admins.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 text-sm leading-6 text-muted-foreground">
                <div className="font-medium text-foreground">
                  {tt('platform.bootstrapTitle', 'Bootstrap the first platform admin')}
                </div>
                <p className="mt-2">
                  {tt(
                    'platform.bootstrapBody',
                    'Sign in with the target user first, then run the documented bootstrap command from the repo root with service-role credentials available in .env.',
                  )}
                </p>
                <pre className="mt-3 overflow-x-auto rounded-xl border border-border/70 bg-background px-4 py-3 text-xs text-foreground">
                  npm run bootstrap:platform-admin -- admin@company.com --note "Initial platform admin"
                </pre>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background p-4 text-sm leading-6 text-muted-foreground">
                <div className="font-medium text-foreground">
                  {tt('platform.manualActivationTitle', 'Current operating model')}
                </div>
                <ul className="mt-3 space-y-2">
                  <li>{tt('platform.manualActivationOnly', 'Paid access remains manual in this phase.')}</li>
                  <li>{tt('platform.paymentDeferred', 'Payment checkout and automatic activation remain intentionally deferred.')}</li>
                  <li>{tt('platform.routeDirect', 'Active platform admins can open this route directly or use the Platform section in navigation.')}</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <Card className="border-border/70 bg-card">
              <CardHeader>
                <CardTitle>{tt('platform.companyRegister', 'Company access register')}</CardTitle>
                <CardDescription>
                  {tt(
                    'platform.companyRegisterHelp',
                    'Search the tenant list, then open one company at a time for manual access control.',
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void loadCompanies(event.currentTarget.value)
                      }}
                      placeholder={tt('platform.searchPlaceholder', 'Search company, UUID, or plan code')}
                      className="pl-9"
                    />
                  </div>
                  <Button variant="outline" onClick={() => void loadCompanies()}>
                    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border/70">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/35 text-left">
                      <tr>
                        <th className="px-4 py-3">{tt('platform.company', 'Company')}</th>
                        <th className="px-4 py-3">{tt('platform.plan', 'Plan')}</th>
                        <th className="px-4 py-3">{tt('platform.status', 'Status')}</th>
                        <th className="px-4 py-3">{tt('platform.members', 'Members')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.company_id}
                          className={`cursor-pointer border-t transition-colors hover:bg-muted/20 ${selectedCompanyId === row.company_id ? 'bg-muted/25' : ''}`}
                          onClick={() => setSelectedCompanyId(row.company_id)}
                        >
                          <td className="px-4 py-4 align-top">
                            <div className="font-medium">{row.company_name || row.company_id}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{row.company_id}</div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div>{row.plan_name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{row.plan_code}</div>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row.effective_status)}`}
                            >
                              {formatStatus(row.effective_status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div>
                              {row.active_member_count} / {row.member_count}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {row.paid_until ? row.paid_until.slice(0, 10) : tt('platform.manualWindow', 'Manual window')}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!loading && rows.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                            {tt('platform.empty', 'No company access rows matched the current search.')}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-border/70 bg-card">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>{tt('platform.detailTitle', 'Selected company')}</CardTitle>
                      <CardDescription>{selectedCompanyName}</CardDescription>
                    </div>
                    {selectedCompanyId ? (
                      <Badge className={`rounded-full border px-3 py-1 font-medium capitalize ${statusTone(selectedStatus as SubscriptionStatus)}`}>
                        {formatStatus(selectedStatus)}
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-6">
                  {!selectedCompanyId ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6 text-sm text-muted-foreground">
                      {tt('platform.selectPrompt', 'Select one company from the register to review or change its access state.')}
                    </div>
                  ) : detailLoading ? (
                    <div className="rounded-2xl border border-border/70 bg-muted/10 p-6 text-sm text-muted-foreground">
                      {tt('platform.loadingDetail', 'Loading company detail and control history…')}
                    </div>
                  ) : detail ? (
                    <>
                      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                        <div className="rounded-2xl border border-border/70 bg-muted/10 p-5">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                            {tt('platform.companySummary', 'Company summary')}
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.companyName', 'Company name')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{detail.company_name || '—'}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.companyCreated', 'Created')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDate(detail.company_created_at, locale)}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4 sm:col-span-2">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.companyUuid', 'Company UUID')}</div>
                              <div className="mt-2 break-all font-mono text-xs text-foreground">{detail.company_id}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.legalName', 'Legal name')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{detail.legal_name || '—'}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.tradeName', 'Trade name')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{detail.trade_name || '—'}</div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/70 bg-muted/10 p-5">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            <UserRound className="h-3.5 w-3.5" />
                            {tt('platform.ownerAndActivity', 'Owner and access activity')}
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.owner', 'Owner')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{detail.owner_full_name || detail.owner_email || tt('platform.notCaptured', 'Not captured')}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.ownerEmail', 'Owner email')}</div>
                              <div className="mt-2 break-all text-sm font-medium text-foreground">{detail.owner_email || '—'}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.ownerSource', 'Owner source')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{ownerSourceLabel(detail.owner_source)}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.ownerRole', 'Owner membership')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">
                                {[formatStatus(detail.owner_member_role), formatStatus(detail.owner_member_status)].filter((value) => value !== '—').join(' · ') || '—'}
                              </div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.ownerSince', 'Owner since')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDate(detail.owner_member_since, locale)}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.memberCounts', 'Members')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">
                                {detail.active_member_count} / {detail.member_count}
                              </div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.ownerLastSignIn', 'Owner last sign-in')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDateTime(detail.owner_last_sign_in_at, locale, tt('platform.notCaptured', 'Not captured'))}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.latestSignIn', 'Latest recorded sign-in')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDateTime(detail.latest_member_last_sign_in_at, locale, tt('platform.notCaptured', 'Not captured'))}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {detail.latest_member_email || detail.latest_member_full_name || tt('platform.notCaptured', 'Not captured')}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                        <div className="rounded-2xl border border-border/70 bg-background p-5">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/15 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {tt('platform.accessControls', 'Access and commercial controls')}
                          </div>
                          <div className="mt-4 grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label>{tt('platform.plan', 'Plan')}</Label>
                              <Select value={planCode} onValueChange={setPlanCode}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {internalPlanOptions.map((option) => (
                                    <SelectItem key={option.code} value={option.code}>
                                      {option.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>{tt('platform.status', 'Status')}</Label>
                              <Select value={status} onValueChange={(value) => setStatus(value as SubscriptionStatus)}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="trial">{tt('platform.trial', 'Trial')}</SelectItem>
                                  <SelectItem value="active_paid">{tt('platform.activePaid', 'Active paid')}</SelectItem>
                                  <SelectItem value="expired">{tt('platform.expired', 'Expired')}</SelectItem>
                                  <SelectItem value="suspended">{tt('platform.suspended', 'Suspended')}</SelectItem>
                                  <SelectItem value="disabled">{tt('platform.disabled', 'Disabled')}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-2">
                              <Label>{tt('platform.paidUntil', 'Paid until')}</Label>
                              <Input type="date" value={paidUntil} onChange={(event) => setPaidUntil(event.target.value)} />
                            </div>
                            <div className="space-y-2">
                              <Label>{tt('platform.trialEnds', 'Trial ends')}</Label>
                              <Input type="date" value={trialExpiresAt} onChange={(event) => setTrialExpiresAt(event.target.value)} />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                              <Label>{tt('platform.purgeSchedule', 'Purge schedule')}</Label>
                              <Input type="date" value={purgeScheduledAt} onChange={(event) => setPurgeScheduledAt(event.target.value)} />
                            </div>
                          </div>

                          <div className="mt-4 space-y-2">
                            <Label>{tt('platform.reason', 'Reason')}</Label>
                            <Textarea
                              value={reason}
                              onChange={(event) => setReason(event.target.value)}
                              placeholder={tt(
                                'platform.reasonPlaceholder',
                                'Record why access was granted, suspended, expired, or manually extended',
                              )}
                            />
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button onClick={() => void applyChange()} disabled={saving}>
                              {saving ? tt('actions.saving', 'Saving') : tt('platform.apply', 'Apply change')}
                            </Button>
                            <Button variant="outline" asChild>
                              <Link to="/#pricing">{tt('platform.openLanding', 'Open public pricing')}</Link>
                            </Button>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/70 bg-muted/10 p-5">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            <CalendarClock className="h-3.5 w-3.5" />
                            {tt('platform.commercialDates', 'Commercial dates and posture')}
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.planCode', 'Plan code')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{detail.plan_code}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.subscriptionStatus', 'Stored status')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatStatus(detail.subscription_status)}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.trialStarted', 'Trial started')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDate(detail.trial_started_at, locale)}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.trialEnds', 'Trial ends')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDate(detail.trial_expires_at, locale)}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.paidUntil', 'Paid until')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDate(detail.paid_until, locale, tt('platform.manualWindow', 'Manual window'))}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.purgeSchedule', 'Purge schedule')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDate(detail.purge_scheduled_at, locale, '—')}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.purgeCompleted', 'Reset / purge completed')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">{formatDateTime(detail.purge_completed_at, locale, '—')}</div>
                            </div>
                            <div className="rounded-xl border border-border/70 bg-background p-4">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('platform.accessEnabled', 'Access enabled')}</div>
                              <div className="mt-2 text-sm font-medium text-foreground">
                                {detail.access_enabled ? tt('platform.enabled', 'Enabled') : tt('platform.blocked', 'Blocked')}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {detail.manual_activation_only
                                  ? tt('platform.manualActivationOnly', 'Paid access remains manual in this phase.')
                                  : tt('platform.paymentAutomationReady', 'The current control plane can accept automated activation later.')}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-rose-200/70 bg-rose-50/60 p-5 dark:border-rose-500/20 dark:bg-rose-500/10">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-rose-200/80 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-rose-700 dark:border-rose-500/30 dark:text-rose-300">
                              <ShieldAlert className="h-3.5 w-3.5" />
                              {tt('platform.criticalActions', 'Critical actions')}
                            </div>
                            <div className="mt-3 text-lg font-semibold text-foreground">
                              {tt('platform.resetTitle', 'Reset company operational data')}
                            </div>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                              {tt(
                                'platform.resetBody',
                                'This action removes company-scoped operational data while retaining the company shell, identity credentials, memberships, and control-plane history. Confirmation requires the company UUID and a written reason.',
                              )}
                            </p>
                          </div>
                          <Button
                            variant="destructive"
                            disabled={!detail.reset_allowed}
                            onClick={() => setResetOpen(true)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {tt('platform.resetAction', 'Reset company data')}
                          </Button>
                        </div>

                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                          <div className="rounded-2xl border border-rose-200/80 bg-background p-4 dark:border-rose-500/20">
                            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              {tt('platform.resetRemoves', 'Reset removes')}
                            </div>
                            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                              {resetDeletes.map((entry) => (
                                <li key={entry}>• {entry}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background p-4">
                            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              {tt('platform.resetKeeps', 'Reset preserves')}
                            </div>
                            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                              {resetKeeps.map((entry) => (
                                <li key={entry}>• {entry}</li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-300" />
                          {detail.reset_allowed
                            ? tt('platform.resetReady', 'Reset is available because this company is not in active paid access.')
                            : detail.reset_blocked_reason || tt('platform.resetBlocked', 'Reset is blocked for the current access state.')}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6 text-sm text-muted-foreground">
                      {tt('platform.detailUnavailable', 'The selected company detail could not be loaded. Refresh the register and try again.')}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card">
                <CardHeader>
                  <CardTitle>{tt('platform.auditTitle', 'Access audit')}</CardTitle>
                  <CardDescription>
                    {tt(
                      'platform.auditHelp',
                      'Every manual grant, revoke, suspension, expiry, or trial adjustment is recorded here.',
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {auditRows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-5 text-sm text-muted-foreground">
                      {tt('platform.auditEmpty', 'No manual access events are recorded for the selected company yet.')}
                    </div>
                  ) : (
                    auditRows.map((row) => (
                      <div key={row.id} className="rounded-2xl border border-border/70 bg-background p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">
                              {formatStatus(row.previous_status)} to {formatStatus(row.next_status)}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {(row.previous_plan_code || '—')} to {(row.next_plan_code || '—')}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(row.created_at, locale)}</div>
                        </div>
                        {row.reason ? <div className="mt-3 text-sm text-muted-foreground">{row.reason}</div> : null}
                        <div className="mt-3 text-xs text-muted-foreground">
                          {row.actor_email || row.actor_user_id || tt('platform.systemActor', 'System / not captured')}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card">
                <CardHeader>
                  <CardTitle>{tt('platform.controlActionsTitle', 'Control actions')}</CardTitle>
                  <CardDescription>
                    {tt(
                      'platform.controlActionsHelp',
                      'Operational resets and other critical control-plane actions are logged separately from status changes.',
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {controlRows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-5 text-sm text-muted-foreground">
                      {tt('platform.controlActionsEmpty', 'No critical control actions are recorded for the selected company yet.')}
                    </div>
                  ) : (
                    controlRows.map((row) => {
                      const deletedSummary = row.context?.deleted_summary as Record<string, unknown> | undefined
                      return (
                        <div key={row.id} className="rounded-2xl border border-border/70 bg-background p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{controlActionLabel(row.action_type)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {row.actor_email || row.actor_user_id || tt('platform.systemActor', 'System / not captured')}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">{formatDateTime(row.created_at, locale)}</div>
                          </div>
                          {row.reason ? <div className="mt-3 text-sm text-muted-foreground">{row.reason}</div> : null}
                          {deletedSummary ? (
                            <div className="mt-3 text-xs text-muted-foreground">
                              {tt('platform.controlActionDeletedSummary', 'Deleted operational rows: {count}', {
                                count: countDeletedRows(deletedSummary),
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{tt('platform.resetDialogTitle', 'Confirm operational data reset')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tt(
                'platform.resetDialogDescription',
                'This action removes company-scoped operational data and keeps the company shell, memberships, credentials, and control-plane records. To proceed, enter the exact company UUID and record the reason.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-muted/10 p-4 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">{detail?.company_name || selectedRow?.company_name || '—'}</div>
              <div className="mt-1 break-all font-mono text-xs">{detail?.company_id || selectedCompanyId || '—'}</div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-2">
                <Label>{tt('platform.resetConfirmUuid', 'Type the company UUID')}</Label>
                <Input value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{tt('platform.reason', 'Reason')}</Label>
                <Textarea
                  value={resetReason}
                  onChange={(event) => setResetReason(event.target.value)}
                  placeholder={tt('platform.resetReasonPlaceholder', 'Record why this operational reset is being performed')}
                />
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>{tt('actions.cancel', 'Cancel')}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                resetting ||
                !detail ||
                !detail.reset_allowed ||
                resetConfirmation.trim() !== detail.company_id ||
                !resetReason.trim()
              }
              onClick={() => void confirmReset()}
            >
              {resetting ? tt('actions.saving', 'Saving') : tt('platform.resetAction', 'Reset company data')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
