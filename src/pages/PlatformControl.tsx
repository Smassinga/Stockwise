import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import {
  listCompanyAccess,
  listCompanyAccessEvents,
  setCompanyAccess,
  type CompanyAccessAuditRow,
  type CompanyAccessRow,
  type SubscriptionStatus,
} from '../lib/companyAccess'
import { formatMzn, internalPlanOptions } from '../lib/pricingPlans'
import { useI18n, withI18nFallback } from '../lib/i18n'

function asDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : ''
}

function formatDateTime(value: string, locale: string) {
  return new Date(value).toLocaleString(locale)
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

export default function PlatformControlPage() {
  const { lang, t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<CompanyAccessRow[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('')
  const [auditRows, setAuditRows] = useState<CompanyAccessAuditRow[]>([])
  const [status, setStatus] = useState<SubscriptionStatus>('active_paid')
  const [planCode, setPlanCode] = useState<string>('starter')
  const [paidUntil, setPaidUntil] = useState('')
  const [trialExpiresAt, setTrialExpiresAt] = useState('')
  const [purgeScheduledAt, setPurgeScheduledAt] = useState('')
  const [reason, setReason] = useState('')

  const selectedRow = useMemo(
    () => rows.find((row) => row.company_id === selectedCompanyId) || null,
    [rows, selectedCompanyId],
  )

  async function loadCompanies(nextSearch?: string) {
    setLoading(true)
    try {
      const companyRows = await listCompanyAccess(nextSearch ?? search)
      setRows(companyRows)
      if (!selectedCompanyId && companyRows[0]) setSelectedCompanyId(companyRows[0].company_id)
      if (selectedCompanyId && !companyRows.some((row) => row.company_id === selectedCompanyId)) {
        setSelectedCompanyId(companyRows[0]?.company_id || '')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadCompanies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedRow) {
      setAuditRows([])
      setPlanCode('starter')
      setStatus('active_paid')
      setPaidUntil('')
      setTrialExpiresAt('')
      setPurgeScheduledAt('')
      setReason('')
      return
    }

    setPlanCode(selectedRow.plan_code)
    setStatus(selectedRow.subscription_status)
    setPaidUntil(asDateInput(selectedRow.paid_until))
    setTrialExpiresAt(asDateInput(selectedRow.trial_expires_at))
    setPurgeScheduledAt(asDateInput(selectedRow.purge_scheduled_at))
    setReason('')

    ;(async () => {
      const events = await listCompanyAccessEvents(selectedRow.company_id)
      setAuditRows(events)
    })().catch((error) => {
      console.error(error)
      toast.error(tt('platform.auditLoadFailed', 'Failed to load access audit history.'))
    })
  }, [selectedRow, tt])

  const summary = useMemo(() => {
    return rows.reduce<Record<string, number>>((totals, row) => {
      totals[row.effective_status] = (totals[row.effective_status] || 0) + 1
      return totals
    }, {})
  }, [rows])

  async function applyChange() {
    if (!selectedRow) return
    try {
      setSaving(true)
      await setCompanyAccess({
        companyId: selectedRow.company_id,
        planCode,
        status,
        paidUntil: paidUntil || null,
        trialExpiresAt: trialExpiresAt || null,
        purgeScheduledAt: purgeScheduledAt || null,
        reason: reason || null,
      })
      toast.success(tt('platform.saved', 'Company access updated.'))
      await loadCompanies()
      const events = await listCompanyAccessEvents(selectedRow.company_id)
      setAuditRows(events)
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('platform.saveFailed', 'Failed to update company access.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
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
                'This control plane governs 7-day trials, manual paid activation, suspensions, expiry, and operational purge scheduling. Payment automation remains intentionally deferred.',
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

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
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
                        <td className="px-4 py-4">
                          <div className="font-medium">{row.company_name || row.company_id}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{row.company_id}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div>{row.plan_name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{row.plan_code}</div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row.effective_status)}`}>
                            {row.effective_status.replaceAll('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-4">
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
                <CardTitle>{tt('platform.detailTitle', 'Selected company')}</CardTitle>
                <CardDescription>
                  {selectedRow?.company_name || tt('platform.selectCompany', 'Choose a company from the register first.')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedRow ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
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

                    <div className="rounded-2xl border border-border/70 bg-muted/15 p-4 text-sm text-muted-foreground">
                      <div className="font-medium text-foreground">
                        {tt('platform.currentCommercialPosture', 'Current commercial posture')}
                      </div>
                      <div className="mt-2 grid gap-2">
                        <div>
                          {tt(
                            'platform.manualActivationCurrent',
                            'Automatic payment collection and automatic plan activation are intentionally deferred in this phase.',
                          )}
                        </div>
                        <div>
                          {tt(
                            'platform.futureReady',
                            'The control plane is structured so payment automation can be layered in later without redesigning tenant access state.',
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
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

                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void applyChange()} disabled={saving}>
                        {saving ? tt('actions.saving', 'Saving') : tt('platform.apply', 'Apply change')}
                      </Button>
                      <Button variant="outline" asChild>
                        <Link to="/#pricing">{tt('platform.openLanding', 'Open public pricing')}</Link>
                      </Button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      {([
                        ['Starter', 2001],
                        ['Growth', 3381],
                        ['Business', 5451],
                      ] as const).map(([label, monthly]) => (
                        <div key={label} className="rounded-2xl border border-border/70 bg-background p-4">
                          <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                          <div className="mt-2 text-lg font-semibold">{formatMzn(monthly, locale)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {tt('platform.monthlyReference', 'Public monthly reference')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6 text-sm text-muted-foreground">
                    {tt('platform.selectPrompt', 'Select one company from the register to review or change its access state.')}
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
                    'Every manual grant, revoke, suspension, or trial adjustment is recorded here.',
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
                            {String(row.previous_status || '-').replaceAll('_', ' ')} to {row.next_status.replaceAll('_', ' ')}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.previous_plan_code || '-'} to {row.next_plan_code || '-'}
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
          </div>
        </div>
      </div>
    </div>
  )
}

