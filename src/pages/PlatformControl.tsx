import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Building2,
  CalendarClock,
  Eye,
  Mail,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { EmailTemplateLab } from '../components/platform/EmailTemplateLab'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import {
  getCompanyAccessDetail,
  listCompanyAccessEvents,
  listCompanySubscriptionDashboard,
  listCompanyControlActions,
  previewCompanyAccessEmail,
  resetCompanyOperationalData,
  sendCompanyAccessEmail,
  setCompanyAccess,
  type CompanyAccessAuditRow,
  type CompanyAccessDetail,
  type CompanyAccessEmailPreview,
  type CompanyAccessEmailTemplateType,
  type CompanyAccessRow,
  type CompanyControlActionRow,
  type SubscriptionStatus,
} from '../lib/companyAccess'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { internalPlanOptions } from '../lib/pricingPlans'
import { PUBLIC_CONTACT_EMAIL } from '../lib/publicContact'
import SubscriptionAnalyticsDashboard from '../components/platform/SubscriptionAnalyticsDashboard'
import PaymentActivationAdmin from '../components/platform/PaymentActivationAdmin'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { AdministrationSectionNav } from '../components/administration/AdministrationSectionNav'
import { AdministrationAuthorityBadge } from '../components/administration/AdministrationAuthorityBadge'
import { isKnownSubscriptionStatus, subscriptionStatusKey } from '../lib/administrationPresentation'

type PlatformView = 'portfolio' | 'activation' | 'company'
type PlatformCompanySection = 'overview' | 'access' | 'communications' | 'audit' | 'danger'

const platformViews: PlatformView[] = ['portfolio', 'activation', 'company']
const companySections: PlatformCompanySection[] = ['overview', 'access', 'communications', 'audit', 'danger']

function asDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : ''
}

function formatDate(value: string | null | undefined, locale: string, fallback = '-') {
  if (!value) return fallback
  return new Date(value).toLocaleDateString(locale)
}

function formatDateTime(value: string | null | undefined, locale: string, fallback = '-') {
  if (!value) return fallback
  return new Date(value).toLocaleString(locale)
}

function statusTone(status: SubscriptionStatus) {
  switch (status) {
    case 'active_paid':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
    case 'trial':
      return 'border-informational/25 bg-informational/8 text-informational dark:border-informational/30 dark:bg-informational/10'
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

function recipientSourceLabel(source: string | null | undefined) {
  switch (source) {
    case 'company_email':
      return 'Registered company email'
    case 'owner_email':
      return 'Resolved owner email'
    case 'active_admin_email':
      return 'Active admin email fallback'
    default:
      return 'Not captured'
  }
}

function controlActionLabel(
  actionType: string | null | undefined,
  translate: (key: string, fallback: string) => string,
) {
  switch (actionType) {
    case 'operational_reset':
      return translate('platform.controlActionOperationalReset', 'Operational data reset')
    case 'access_email_expiry_warning_sent':
      return translate('platform.controlActionExpirySent', 'Expiry warning email sent')
    case 'access_email_purge_warning_sent':
      return translate('platform.controlActionPurgeSent', 'Purge warning email sent')
    case 'access_email_activation_confirmation_sent':
      return translate('platform.controlActionActivationSent', 'Activation confirmation email sent')
    default:
      return translate('platform.controlActionUnavailable', 'Control action unavailable')
  }
}

function countDeletedRows(summary: Record<string, unknown> | null | undefined) {
  if (!summary || typeof summary !== 'object') return 0
  return Object.values(summary).reduce((total, value) => total + (typeof value === 'number' ? value : 0), 0)
}

function resolveStoredExpiryDate(detail: CompanyAccessDetail | null) {
  if (!detail) return null
  if (detail.effective_status === 'active_paid' && detail.paid_until) return detail.paid_until
  return detail.trial_expires_at || detail.paid_until || null
}

function MetadataCard({
  label,
  value,
  hint,
  mono = false,
}: {
  label: string
  value: string
  hint?: string | null
  mono?: boolean
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-background p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <div
        className={`mt-2 min-w-0 text-sm font-medium leading-6 text-foreground ${mono ? 'break-all font-mono text-xs' : 'break-words'}`}
      >
        {value}
      </div>
      {hint ? <div className="mt-2 min-w-0 break-words text-xs leading-5 text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export default function PlatformControlPage() {
  const { lang, t } = useI18n()
  const tt = useCallback(
    (key: string, fallback: string, vars?: Record<string, string | number>) =>
      withI18nFallback(t, key, fallback, vars),
    [t],
  )
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const platformView: PlatformView = platformViews.includes(requestedView as PlatformView)
    ? requestedView as PlatformView
    : 'portfolio'
  const requestedSection = searchParams.get('section')
  const companySection: PlatformCompanySection = companySections.includes(requestedSection as PlatformCompanySection)
    ? requestedSection as PlatformCompanySection
    : 'overview'
  const requestedCompanyId = searchParams.get('companyId') || ''

  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [previewingTemplate, setPreviewingTemplate] = useState<CompanyAccessEmailTemplateType | null>(null)
  const [sendingTemplate, setSendingTemplate] = useState<CompanyAccessEmailTemplateType | null>(null)
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
  const [emailNote, setEmailNote] = useState('')
  const [emailPreview, setEmailPreview] = useState<CompanyAccessEmailPreview | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetReason, setResetReason] = useState('')
  const [resetConfirmation, setResetConfirmation] = useState('')
  const [portfolioError, setPortfolioError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [auditUnavailable, setAuditUnavailable] = useState(false)
  const [controlUnavailable, setControlUnavailable] = useState(false)
  const [durableResult, setDurableResult] = useState<string | null>(null)

  const subscriptionLabel = useCallback(
    (value: string | null | undefined, fallback = '-') =>
      isKnownSubscriptionStatus(value)
        ? tt(subscriptionStatusKey(value), value)
        : fallback,
    [tt],
  )

  const selectedRow = useMemo(
    () => rows.find((row) => row.company_id === selectedCompanyId) || null,
    [rows, selectedCompanyId],
  )

  const selectedCompanyName =
    detail?.company_name || selectedRow?.company_name || tt('platform.selectCompany', 'Choose a company from the portfolio below first.')

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

  const accessFormDirty = useMemo(() => {
    if (!detail) return false
    return (
      planCode !== detail.plan_code ||
      status !== detail.subscription_status ||
      paidUntil !== asDateInput(detail.paid_until) ||
      trialExpiresAt !== asDateInput(detail.trial_expires_at) ||
      purgeScheduledAt !== asDateInput(detail.purge_scheduled_at)
    )
  }, [detail, paidUntil, planCode, purgeScheduledAt, status, trialExpiresAt])

  const emailActions = useMemo(() => {
    const recipientReady = Boolean(detail?.notification_recipient_email)
    const expiryDate = resolveStoredExpiryDate(detail)
    const activationReady = Boolean(detail?.access_granted_at && detail?.paid_until && detail?.effective_status === 'active_paid')

    return [
      {
        key: 'expiry_warning' as const,
        title: tt('platform.emailExpiryTitle', 'Expiry warning'),
        body: tt(
          'platform.emailExpiryBody',
          'Warn the company that access is expiring and tell them how to request manual renewal or activation.',
        ),
        blockedReason: accessFormDirty
          ? tt('platform.emailSaveFirst', 'Save current status and date changes first so the email uses the stored access state.')
          : !recipientReady
            ? tt('platform.emailNoRecipient', 'No canonical company recipient is available yet.')
            : !expiryDate
              ? tt('platform.emailNoExpiryDate', 'Save an expiry date before sending this warning.')
              : null,
      },
      {
        key: 'purge_warning' as const,
        title: tt('platform.emailPurgeTitle', 'Purge warning'),
        body: tt(
          'platform.emailPurgeBody',
          'Warn the company that operational data is scheduled for purge if access is not renewed before the scheduled date.',
        ),
        blockedReason: accessFormDirty
          ? tt('platform.emailSaveFirst', 'Save current status and date changes first so the email uses the stored access state.')
          : !recipientReady
            ? tt('platform.emailNoRecipient', 'No canonical company recipient is available yet.')
            : !detail?.purge_scheduled_at
              ? tt('platform.emailNoPurgeDate', 'Save a purge schedule before sending this warning.')
              : null,
      },
      {
        key: 'activation_confirmation' as const,
        title: tt('platform.emailActivationTitle', 'Paid activation confirmation'),
        body: tt(
          'platform.emailActivationBody',
          'Confirm that the company was manually activated on the selected plan and show the paid access window.',
        ),
        blockedReason: accessFormDirty
          ? tt('platform.emailSaveFirst', 'Save current status and date changes first so the email uses the stored access state.')
          : !recipientReady
            ? tt('platform.emailNoRecipient', 'No canonical company recipient is available yet.')
            : !activationReady
              ? tt(
                  'platform.emailNoActivationWindow',
                  'Activation confirmation needs active paid access plus both the activation start date and the paid-until date.',
                )
              : null,
      },
    ]
  }, [accessFormDirty, detail, tt])

  const loadCompanies = useCallback(
    async (preferredCompanyId?: string) => {
      setLoading(true)
      setPortfolioError(null)
      try {
        const companyRows = await listCompanySubscriptionDashboard()
        setRows(companyRows)
        if (preferredCompanyId && !companyRows.some((row) => row.company_id === preferredCompanyId)) {
          setSearchParams({ view: 'portfolio' }, { replace: true })
        }
        setSelectedCompanyId((currentId) => {
          const targetId = preferredCompanyId || currentId
          if (targetId && companyRows.some((row) => row.company_id === targetId)) return targetId
          return companyRows[0]?.company_id || ''
        })
      } catch (error) {
        console.error(error)
        setPortfolioError(tt('platform.portfolioUnavailable', 'Company portfolio unavailable'))
      } finally {
        setLoading(false)
      }
    },
    [setSearchParams, tt],
  )

  const fetchSelectedCompanyData = useCallback(async (companyId: string) => {
    const [detailResult, eventsResult, controlResult] = await Promise.allSettled([
      getCompanyAccessDetail(companyId),
      listCompanyAccessEvents(companyId),
      listCompanyControlActions(companyId),
    ])
    if (detailResult.status === 'rejected') throw detailResult.reason
    return {
      detailRow: detailResult.value,
      events: eventsResult.status === 'fulfilled' ? eventsResult.value : [],
      controlEvents: controlResult.status === 'fulfilled' ? controlResult.value : [],
      auditUnavailable: eventsResult.status === 'rejected',
      controlUnavailable: controlResult.status === 'rejected',
    }
  }, [])

  useEffect(() => {
    void loadCompanies(requestedCompanyId)
  }, [loadCompanies, requestedCompanyId])

  useEffect(() => {
    if (platformView !== 'company' || !selectedCompanyId) {
      setDetail(null)
      setAuditRows([])
      setControlRows([])
      setAuditUnavailable(false)
      setControlUnavailable(false)
      return
    }

    let cancelled = false
    setDetail(null)
    setAuditRows([])
    setControlRows([])
    setAuditUnavailable(false)
    setControlUnavailable(false)
    setDetailLoading(true)
    setDetailError(null)

    ;(async () => {
      try {
        const result = await fetchSelectedCompanyData(selectedCompanyId)
        if (cancelled) return
        setDetail(result.detailRow)
        setAuditRows(result.events)
        setControlRows(result.controlEvents)
        setAuditUnavailable(result.auditUnavailable)
        setControlUnavailable(result.controlUnavailable)
      } catch (error) {
        if (cancelled) return
        console.error(error)
        setDetailError(tt('platform.detailUnavailable', 'Selected-company detail unavailable'))
        toast.error(tt('platform.detailLoadFailed', 'Failed to load company control details.'))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchSelectedCompanyData, platformView, selectedCompanyId, tt])

  useEffect(() => {
    if (!detail) {
      setPlanCode('starter')
      setStatus('active_paid')
      setPaidUntil('')
      setTrialExpiresAt('')
      setPurgeScheduledAt('')
      setReason('')
      setEmailNote('')
      setEmailPreview(null)
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
    setEmailNote('')
    setEmailPreview(null)
    setResetReason('')
    setResetConfirmation('')
  }, [detail])

  async function refreshSelectedCompany(companyId: string) {
    const result = await fetchSelectedCompanyData(companyId)
    setDetail(result.detailRow)
    setAuditRows(result.events)
    setControlRows(result.controlEvents)
    setAuditUnavailable(result.auditUnavailable)
    setControlUnavailable(result.controlUnavailable)
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
      await Promise.all([loadCompanies(detail.company_id), refreshSelectedCompany(detail.company_id)])
      setDurableResult(tt('platform.accessUpdatedResult', 'Access updated. The stored and effective access evidence has been refreshed.'))
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
      await Promise.all([loadCompanies(detail.company_id), refreshSelectedCompany(detail.company_id)])
      setResetOpen(false)
      setResetConfirmation('')
      setResetReason('')
      setDurableResult(
        tt('platform.resetDurableResult', 'Operational reset completed. Company identity, memberships, credentials, subscription, and control-plane evidence were retained.'),
      )
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

  async function handlePreviewEmail(templateKey: CompanyAccessEmailTemplateType) {
    if (!detail) return
    try {
      setPreviewingTemplate(templateKey)
      const preview = await previewCompanyAccessEmail({
        companyId: detail.company_id,
        templateKey,
        note: emailNote || null,
      })
      setEmailPreview(preview)
      toast.success(tt('platform.emailPreviewReady', 'Email preview is ready.'))
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('platform.emailPreviewFailed', 'Failed to build the company email preview.'))
    } finally {
      setPreviewingTemplate(null)
    }
  }

  async function handleSendEmail(templateKey: CompanyAccessEmailTemplateType) {
    if (!detail) return
    try {
      setSendingTemplate(templateKey)
      const sent = await sendCompanyAccessEmail({
        companyId: detail.company_id,
        templateKey,
        note: emailNote || null,
      })
      await refreshSelectedCompany(detail.company_id)
      setDurableResult(
        tt('platform.emailDurableResult', 'Access email sent and the control-action audit has been refreshed.'),
      )
      toast.success(
        tt('platform.emailSent', 'Company email sent to {email}.', {
          email: sent?.recipient_email || detail.notification_recipient_email || PUBLIC_CONTACT_EMAIL,
        }),
      )
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('platform.emailSendFailed', 'Failed to send the company email.'))
    } finally {
      setSendingTemplate(null)
    }
  }

  function handleSelectCompany(companyId: string) {
    setSelectedCompanyId(companyId)
    setSearchParams({ view: 'company', companyId, section: 'overview' })
  }

  return (
    <div className="space-y-6 overflow-x-hidden">
      <AlertDialog
        open={resetOpen}
        onOpenChange={(open) => {
          if (!resetting) setResetOpen(open)
        }}
      >
        <div className="space-y-6">
          <PremiumPageHeader
            title={tt('platform.controlTitle', 'Platform Control')}
            description={tt(
              'platform.controlDescription',
              'Review tenant access, assisted activation, manual communications, audit evidence, and guarded operational resets.',
            )}
            context={<AdministrationAuthorityBadge authority="platform" label={tt('platform.adminBadge', 'Platform admin')} />}
            actions={
              <Button variant="outline" asChild>
                <Link to="/dashboard">
                  <ArrowLeft className="h-4 w-4" />
                  {tt('platform.backToDashboard', 'Back to dashboard')}
                </Link>
              </Button>
            }
          />

          <AdministrationSectionNav
            label={tt('platform.viewNavigation', 'Platform Control views')}
            value={platformView}
            onChange={(view) => {
              if (accessFormDirty && !window.confirm(tt('platform.unsavedWarning', 'Discard unsaved access changes?'))) return
              setSearchParams({ view })
            }}
            sections={[
              { value: 'portfolio', label: tt('platform.portfolio', 'Portfolio') },
              { value: 'activation', label: tt('platform.activationRequests', 'Activation requests') },
              { value: 'company', label: tt('platform.selectedCompany', 'Selected company') },
            ]}
          />

          {platformView === 'company' ? (
            <AdministrationSectionNav
              label={tt('platform.companySectionNavigation', 'Selected company sections')}
              value={companySection}
              onChange={(section) => {
                if (accessFormDirty && !window.confirm(tt('platform.unsavedWarning', 'Discard unsaved access changes?'))) return
                setSearchParams({ view: 'company', companyId: selectedCompanyId, section })
              }}
              sections={[
                { value: 'overview', label: tt('platform.sectionOverview', 'Overview') },
                { value: 'access', label: tt('platform.sectionAccess', 'Access') },
                { value: 'communications', label: tt('platform.sectionCommunications', 'Communications') },
                { value: 'audit', label: tt('platform.sectionAudit', 'Audit') },
                { value: 'danger', label: tt('platform.sectionDanger', 'Danger') },
              ]}
            />
          ) : null}

          {durableResult ? (
            <div role="status" tabIndex={-1} className="rounded-lg border border-primary/25 bg-primary/5 p-4">
              <div className="font-medium">{durableResult}</div>
            </div>
          ) : null}

          {platformView === 'portfolio' && !portfolioError ? <SubscriptionAnalyticsDashboard
            rows={rows}
            loading={loading}
            locale={locale}
            selectedCompanyId={selectedCompanyId}
            onRefresh={() => loadCompanies(selectedCompanyId)}
            onSelectCompany={handleSelectCompany}
            tt={tt}
          /> : null}

          {platformView === 'portfolio' && !portfolioError ? <EmailTemplateLab language={lang} /> : null}

          {platformView === 'portfolio' && portfolioError ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
              <div className="font-medium">{portfolioError}</div>
              <Button className="mt-3" variant="outline" onClick={() => void loadCompanies()}>{tt('actions.retry', 'Retry')}</Button>
            </div>
          ) : null}

          {platformView === 'activation' ? <PaymentActivationAdmin
            locale={locale}
            onOpenCompany={handleSelectCompany}
            tt={tt}
          /> : null}

          {platformView === 'company' ? <div className="space-y-6">
              <Card id="platform-company-workspace" className="border-border/70 bg-card">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>{tt('platform.detailTitle', 'Selected company')}</CardTitle>
                      <CardDescription className="break-words">{selectedCompanyName}</CardDescription>
                    </div>
                    {selectedCompanyId ? (
                      <Badge className={`rounded-full border px-3 py-1 font-medium capitalize ${statusTone(selectedStatus as SubscriptionStatus)}`}>
                        {subscriptionLabel(selectedStatus)}
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
                      {tt('platform.loadingDetail', 'Loading company detail and control history...')}
                    </div>
                  ) : detail ? (
                    <>
                      <div className={companySection === 'overview' ? 'grid gap-4 xl:grid-cols-[1.05fr_0.95fr]' : 'hidden'}>
                        <div className="rounded-2xl border border-border/70 bg-muted/10 p-5">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            <Building2 className="h-3.5 w-3.5" />
                            {tt('platform.companySummary', 'Company summary')}
                          </div>
                          <div className="mt-4 grid auto-rows-fr gap-3 sm:grid-cols-2">
                            <MetadataCard label={tt('platform.companyName', 'Company name')} value={detail.company_name || '-'} />
                            <MetadataCard label={tt('platform.companyCreated', 'Created')} value={formatDate(detail.company_created_at, locale)} />
                            <MetadataCard label={tt('platform.companyEmail', 'Registered company email')} value={detail.company_email || '-'} />
                            <MetadataCard label={tt('platform.language', 'Preferred language')} value={detail.company_preferred_lang || '-'} />
                            <MetadataCard label={tt('platform.legalName', 'Legal name')} value={detail.legal_name || '-'} />
                            <MetadataCard label={tt('platform.tradeName', 'Trade name')} value={detail.trade_name || '-'} />
                            <details className="rounded-lg border border-border/70 bg-background p-3 sm:col-span-2">
                              <summary className="cursor-pointer text-sm font-medium">{tt('platform.technicalMetadata', 'Technical metadata')}</summary>
                              <div className="mt-2 break-all font-mono text-xs text-muted-foreground">{detail.company_id}</div>
                            </details>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-border/70 bg-muted/10 p-5">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            <UserRound className="h-3.5 w-3.5" />
                            {tt('platform.ownerAndActivity', 'Owner and access activity')}
                          </div>
                          <div className="mt-4 grid auto-rows-fr gap-3 sm:grid-cols-2">
                            <MetadataCard
                              label={tt('platform.owner', 'Owner')}
                              value={detail.owner_full_name || detail.owner_email || tt('platform.notCaptured', 'Not captured')}
                            />
                            <MetadataCard
                              label={tt('platform.ownerEmail', 'Owner email')}
                              value={detail.owner_email || '-'}
                            />
                            <MetadataCard
                              label={tt('platform.ownerSource', 'Owner source')}
                              value={ownerSourceLabel(detail.owner_source)}
                            />
                            <MetadataCard
                              label={tt('platform.ownerRole', 'Owner membership')}
                              value={
                                [
                                  detail.owner_member_role
                                    ? tt(`users.roles.${detail.owner_member_role.toLowerCase()}`, tt('platform.notCaptured', 'Not captured'))
                                    : tt('platform.notCaptured', 'Not captured'),
                                  detail.owner_member_status
                                    ? tt(`users.statuses.${detail.owner_member_status.toLowerCase()}`, tt('platform.notCaptured', 'Not captured'))
                                    : tt('platform.notCaptured', 'Not captured'),
                                ]
                                  .filter((value) => value !== '-')
                                  .join(' / ') || '-'
                              }
                            />
                            <MetadataCard
                              label={tt('platform.ownerSince', 'Owner since')}
                              value={formatDate(detail.owner_member_since, locale)}
                            />
                            <MetadataCard
                              label={tt('platform.memberCounts', 'Members')}
                              value={`${detail.active_member_count} / ${detail.member_count}`}
                              hint={tt('platform.memberCountsHint', 'Active members / total company members')}
                            />
                            <MetadataCard
                              label={tt('platform.ownerLastSignIn', 'Owner last sign-in')}
                              value={formatDateTime(detail.owner_last_sign_in_at, locale, tt('platform.notCaptured', 'Not captured'))}
                            />
                            <MetadataCard
                              label={tt('platform.latestSignIn', 'Latest recorded sign-in')}
                              value={formatDateTime(detail.latest_member_last_sign_in_at, locale, tt('platform.notCaptured', 'Not captured'))}
                              hint={detail.latest_member_email || detail.latest_member_full_name || tt('platform.notCaptured', 'Not captured')}
                            />
                          </div>
                        </div>
                      </div>

                      <div className={companySection === 'access' ? 'grid gap-4 xl:grid-cols-[1.05fr_0.95fr]' : 'hidden'}>
                        <div className="rounded-2xl border border-border/70 bg-background p-5">
                          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/15 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {tt('platform.proposedAccess', 'Proposed access change')}
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
                            {tt('platform.currentAccess', 'Current access')}
                          </div>
                          <div className="mt-4 grid auto-rows-fr gap-3 sm:grid-cols-2">
                            <MetadataCard label={tt('platform.planCode', 'Plan code')} value={detail.plan_code} />
                            <MetadataCard label={tt('platform.subscriptionStatus', 'Stored status')} value={subscriptionLabel(detail.subscription_status)} />
                            <MetadataCard label={tt('platform.trialStarted', 'Trial started')} value={formatDate(detail.trial_started_at, locale)} />
                            <MetadataCard label={tt('platform.trialEnds', 'Trial ends')} value={formatDate(detail.trial_expires_at, locale)} />
                            <MetadataCard label={tt('platform.activationGrantedAt', 'Activated on')} value={formatDate(detail.access_granted_at, locale)} />
                            <MetadataCard
                              label={tt('platform.paidUntil', 'Paid until')}
                              value={formatDate(detail.paid_until, locale, tt('platform.manualWindow', 'Manual window'))}
                            />
                            <MetadataCard label={tt('platform.purgeSchedule', 'Purge schedule')} value={formatDate(detail.purge_scheduled_at, locale)} />
                            <MetadataCard label={tt('platform.purgeCompleted', 'Reset / purge completed')} value={formatDateTime(detail.purge_completed_at, locale)} />
                            <MetadataCard
                              label={tt('platform.accessEnabled', 'Access enabled')}
                              value={detail.access_enabled ? tt('platform.enabled', 'Enabled') : tt('platform.blocked', 'Blocked')}
                              hint={
                                detail.manual_activation_only
                                  ? tt('platform.manualActivationOnly', 'Paid access remains manual in this phase.')
                                  : tt('platform.paymentAutomationReady', 'The current control plane can accept automated activation later.')
                              }
                            />
                          </div>
                        </div>
                      </div>

                      <div className={companySection === 'communications' ? 'rounded-2xl border border-border/70 bg-muted/10 p-5' : 'hidden'}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                              <BellRing className="h-3.5 w-3.5" />
                              {tt('platform.notificationWorkspace', 'Commercial and access emails')}
                            </div>
                            <div className="mt-3 text-lg font-semibold text-foreground">
                              {tt('platform.notificationTitle', 'Send company access notices')}
                            </div>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                              {tt(
                                'platform.notificationBody',
                                'Outbound access emails always go to the selected company recipient. Inbound activation and support requests still route to geral@stockwiseapp.com.',
                              )}
                            </p>
                          </div>
                          <div className="min-w-[220px] rounded-2xl border border-border/70 bg-background p-4 text-sm leading-6 text-muted-foreground">
                            <div className="font-medium text-foreground">{tt('platform.notificationRecipient', 'Company recipient')}</div>
                            <div className="mt-2 break-all font-medium text-foreground">
                              {detail.notification_recipient_email || tt('platform.notCaptured', 'Not captured')}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {detail.notification_recipient_name || tt('platform.notCaptured', 'Not captured')}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {recipientSourceLabel(detail.notification_recipient_source)}
                            </div>
                            <div className="mt-3 font-medium text-foreground">{tt('platform.inboundSupport', 'Inbound support inbox')}</div>
                            <div className="mt-1 break-all text-xs text-muted-foreground">{PUBLIC_CONTACT_EMAIL}</div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2">
                          <Label>{tt('platform.emailInternalNote', 'Internal note for audit')}</Label>
                          <Textarea
                            value={emailNote}
                            onChange={(event) => setEmailNote(event.target.value)}
                            placeholder={tt(
                              'platform.emailInternalNotePlaceholder',
                              'Optional note for the control log. This note is not inserted into the outbound email body.',
                            )}
                          />
                        </div>

                        {accessFormDirty ? (
                          <div className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                            {tt(
                              'platform.emailSaveFirst',
                              'Save current status and date changes first so the email uses the stored access state.',
                            )}
                          </div>
                        ) : null}

                        <div className="mt-4 grid gap-4 xl:grid-cols-3">
                          {emailActions.map((action) => {
                            const busy = previewingTemplate === action.key || sendingTemplate === action.key
                            return (
                              <div key={action.key} className="rounded-2xl border border-border/70 bg-background p-4">
                                <div className="text-sm font-semibold text-foreground">{action.title}</div>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">{action.body}</p>
                                {action.blockedReason ? (
                                  <div className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
                                    {action.blockedReason}
                                  </div>
                                ) : (
                                  <div className="mt-3 text-xs leading-5 text-muted-foreground">
                                    {tt('platform.emailActionReady', 'This notice uses the stored plan, status, recipient, and access dates.')}
                                  </div>
                                )}
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <Button
                                    variant="outline"
                                    disabled={Boolean(action.blockedReason) || busy}
                                    onClick={() => void handlePreviewEmail(action.key)}
                                  >
                                    <Eye className="mr-2 h-4 w-4" />
                                    {previewingTemplate === action.key
                                      ? tt('platform.previewing', 'Previewing')
                                      : tt('platform.previewEmail', 'Preview')}
                                  </Button>
                                  <Button
                                    disabled={Boolean(action.blockedReason) || busy}
                                    onClick={() => void handleSendEmail(action.key)}
                                  >
                                    <Send className="mr-2 h-4 w-4" />
                                    {sendingTemplate === action.key
                                      ? tt('platform.sendingEmail', 'Sending')
                                      : tt('platform.sendEmail', 'Send')}
                                  </Button>
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {emailPreview ? (
                          <div className="mt-4 rounded-2xl border border-border/70 bg-background p-5">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/15 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                  <Mail className="h-3.5 w-3.5" />
                                  {tt('platform.previewTitle', 'Email preview')}
                                </div>
                                <div className="mt-3 text-lg font-semibold text-foreground">{emailPreview.subject}</div>
                              </div>
                              <Button variant="ghost" onClick={() => setEmailPreview(null)}>
                                {tt('platform.clearPreview', 'Clear preview')}
                              </Button>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              <MetadataCard
                                label={tt('platform.previewRecipient', 'Send to')}
                                value={emailPreview.recipient_email}
                                hint={`${emailPreview.recipient_name || tt('platform.notCaptured', 'Not captured')} / ${recipientSourceLabel(emailPreview.recipient_source)}`}
                              />
                              <MetadataCard
                                label={tt('platform.previewReplyTo', 'Reply-to / support')}
                                value={emailPreview.support_email}
                              />
                            </div>
                            <div className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-white">
                              <div
                                className="max-h-[720px] overflow-auto"
                                dangerouslySetInnerHTML={{ __html: emailPreview.html }}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className={companySection === 'danger' ? 'rounded-2xl border border-rose-200/70 bg-rose-50/60 p-5 dark:border-rose-500/20 dark:bg-rose-500/10' : 'hidden'}>
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
                          <Button variant="destructive" disabled={!detail.reset_allowed} onClick={() => setResetOpen(true)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {tt('platform.resetOperationalAction', 'Reset operational company data')}
                          </Button>
                        </div>

                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                          <div className="rounded-2xl border border-rose-200/80 bg-background p-4 dark:border-rose-500/20">
                            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              {tt('platform.resetRemoves', 'Reset removes')}
                            </div>
                            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                              {resetDeletes.map((entry) => (
                                <li key={entry}>{entry}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="rounded-2xl border border-border/70 bg-background p-4">
                            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              {tt('platform.resetKeeps', 'Reset preserves')}
                            </div>
                            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                              {resetKeeps.map((entry) => (
                                <li key={entry}>{entry}</li>
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
                    <div role={detailError ? 'alert' : undefined} className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6 text-sm text-muted-foreground">
                      {detailError || tt('platform.detailUnavailable', 'The selected company detail could not be loaded. Refresh the register and try again.')}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className={companySection === 'audit' ? 'border-border/70 bg-card' : 'hidden'}>
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
                  {auditUnavailable ? (
                    <div role="alert" className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-5 text-sm text-muted-foreground">
                      {tt('platform.auditUnavailable', 'Access audit unavailable. Company access evidence remains available.')}
                    </div>
                  ) : auditRows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-5 text-sm text-muted-foreground">
                      {tt('platform.auditEmpty', 'No manual access events are recorded for the selected company yet.')}
                    </div>
                  ) : (
                    auditRows.map((row) => (
                      <div key={row.id} className="rounded-2xl border border-border/70 bg-background p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">
                              {row.previous_status ? subscriptionLabel(row.previous_status) : tt('platform.notCaptured', 'Not captured')}
                              {' → '}
                              {subscriptionLabel(row.next_status)}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {tt('platform.planChange', '{from} to {to}', {
                                from: row.previous_plan_code || '-',
                                to: row.next_plan_code || '-',
                              })}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(row.created_at, locale)}</div>
                        </div>
                        {row.reason ? <div className="mt-3 text-sm text-muted-foreground">{row.reason}</div> : null}
                        <div className="mt-3 text-xs text-muted-foreground">
                          {row.actor_email || tt('platform.systemActor', 'System / not captured')}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className={companySection === 'audit' ? 'border-border/70 bg-card' : 'hidden'}>
                <CardHeader>
                  <CardTitle>{tt('platform.controlActionsTitle', 'Control actions')}</CardTitle>
                  <CardDescription>
                    {tt(
                      'platform.controlActionsHelp',
                      'Operational resets and commercial notification sends are logged separately from status changes.',
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {controlUnavailable ? (
                    <div role="alert" className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-5 text-sm text-muted-foreground">
                      {tt('platform.controlActionsUnavailable', 'Control-action history unavailable. Company access evidence remains available.')}
                    </div>
                  ) : controlRows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-5 text-sm text-muted-foreground">
                      {tt('platform.controlActionsEmpty', 'No critical control actions are recorded for the selected company yet.')}
                    </div>
                  ) : (
                    controlRows.map((row) => {
                      const deletedSummary = row.context?.deleted_summary as Record<string, unknown> | undefined
                      const emailRecipient =
                        typeof row.context?.recipient_email === 'string' ? row.context.recipient_email : null
                      const emailSubject = typeof row.context?.subject === 'string' ? row.context.subject : null
                      const emailSource =
                        typeof row.context?.recipient_source === 'string' ? row.context.recipient_source : null

                      return (
                        <div key={row.id} className="rounded-2xl border border-border/70 bg-background p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{controlActionLabel(row.action_type, tt)}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {row.actor_email || tt('platform.systemActor', 'System / not captured')}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">{formatDateTime(row.created_at, locale)}</div>
                          </div>
                          {row.reason ? <div className="mt-3 text-sm text-muted-foreground">{row.reason}</div> : null}
                          {emailRecipient ? (
                            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                              <div className="break-all">
                                {tt('platform.emailAuditRecipient', 'Recipient')}: {emailRecipient}
                              </div>
                              {emailSource ? (
                                <div>
                                  {tt('platform.emailAuditSource', 'Recipient source')}: {recipientSourceLabel(emailSource)}
                                </div>
                              ) : null}
                              {emailSubject ? (
                                <div className="break-words">
                                  {tt('platform.emailAuditSubject', 'Subject')}: {emailSubject}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
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
          </div> : null}
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
              <div className="font-medium text-foreground">{detail?.company_name || selectedRow?.company_name || '-'}</div>
              <div className="mt-1 break-all font-mono text-xs">{detail?.company_id || selectedCompanyId || '-'}</div>
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
              {resetting ? tt('actions.saving', 'Saving') : tt('platform.resetOperationalAction', 'Reset operational company data')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
