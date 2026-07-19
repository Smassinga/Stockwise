import type { ComponentType } from 'react'
import {
  Banknote,
  Bell,
  Boxes,
  Building2,
  CircleDollarSign,
  FileCheck2,
  FileUp,
  Landmark,
  MapPin,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Ruler,
  ShieldCheck,
  Store,
  Truck,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useI18n, withI18nFallback } from '../../lib/i18n'
import type { SetupArea, SetupAreaKey, SetupAuthority, SetupReadiness } from '../../lib/companySetupReadiness'
import { Button } from '../ui/button'
import { PremiumStatusBadge, type PremiumTone } from '../premium/PremiumStatusBadge'
import { PremiumSkeleton } from '../premium/PremiumSkeleton'

const icons: Record<SetupAreaKey, ComponentType<{ className?: string }>> = {
  company_identity: Building2,
  fiscal_identity: ShieldCheck,
  sales_tax: ReceiptText,
  purchase_tax: CircleDollarSign,
  pos_mode: Store,
  fiscal_documents: FileCheck2,
  currency: CircleDollarSign,
  uom: Ruler,
  locations: MapPin,
  items: Boxes,
  opening_data: FileUp,
  customers: Users,
  suppliers: Truck,
  team: Users,
  banks: Landmark,
  document_branding: PackageCheck,
  notifications: Bell,
  due_reminders: Banknote,
}

const readinessTone: Record<SetupReadiness, PremiumTone> = {
  ready: 'positive',
  needs_action: 'warning',
  in_progress: 'info',
  optional: 'neutral',
  not_applicable: 'neutral',
  unavailable: 'negative',
}

function authorityAction(authority: SetupAuthority) {
  return ['can_manage', 'can_review', 'read_only'].includes(authority)
}

function SetupAreaCard({ area }: { area: SetupArea }) {
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const Icon = icons[area.key]
  const values = Object.fromEntries(
    Object.entries(area.evidence).filter((entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number'),
  )
  const canOpen = Boolean(area.route && authorityAction(area.authority))

  return (
    <article className="flex min-h-[190px] flex-col rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-surface-elevated p-4 shadow-[0_16px_34px_-30px_hsl(var(--foreground)/0.28)] sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border/70 bg-background text-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-5 text-foreground">
            {tt(`setup.areas.${area.key}.title`, area.key.replaceAll('_', ' '))}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <PremiumStatusBadge tone={readinessTone[area.readiness]}>
              {tt(`setup.readiness.${area.readiness}`, area.readiness.replaceAll('_', ' '))}
            </PremiumStatusBadge>
            <PremiumStatusBadge tone="neutral">
              {tt(`setup.authority.${area.authority}`, area.authority.replaceAll('_', ' '))}
            </PremiumStatusBadge>
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-foreground/85">
        {tt(area.summaryKey, tt('setup.status.unavailableSummary', 'This setup evidence could not be loaded.'), values)}
      </p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {tt(area.consequenceKey, 'Review the affected workflow before relying on this setup area.')}
      </p>
      {canOpen ? (
        <Button asChild variant="ghost" className="mt-auto h-auto justify-start px-0 pt-4 text-sm font-semibold text-primary hover:text-primary">
          <Link to={area.route!}>
            {tt(area.readiness === 'ready' ? 'setup.actions.review' : 'setup.actions.continue', area.readiness === 'ready' ? 'Review' : 'Continue setup')}
          </Link>
        </Button>
      ) : area.authority === 'ask_owner_admin' || area.authority === 'ask_manager' ? (
        <p className="mt-auto pt-4 text-xs font-medium text-muted-foreground">
          {tt(`setup.guidance.${area.authority}`, 'Ask an authorized company administrator to complete this area.')}
        </p>
      ) : null}
    </article>
  )
}

export function SetupReadinessPanel({
  areas,
  loading,
  nextArea,
  summary,
  onRefresh,
}: {
  areas: SetupArea[]
  loading: boolean
  nextArea: SetupArea | null
  summary: { ready: number; needsAction: number; unavailable: number }
  onRefresh: () => void
}) {
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const core = areas.filter((area) => area.group === 'core')
  const extensions = areas.filter((area) => area.group === 'extension')
  const nextAreaValues = nextArea
    ? Object.fromEntries(
        Object.entries(nextArea.evidence).filter(
          (entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number',
        ),
      )
    : undefined

  if (loading && areas.length === 0) {
    return <PremiumSkeleton lines={5} />
  }

  return (
    <section aria-labelledby="company-setup-title" className="space-y-6">
      <div className="rounded-[calc(var(--radius)+0.25rem)] border border-card-border bg-card p-4 shadow-[0_20px_48px_-38px_hsl(var(--foreground)/0.28)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="premium-label">{tt('setup.eyebrow', 'Company setup')}</div>
            <h2 id="company-setup-title" className="mt-2 text-xl font-semibold tracking-tight text-foreground">
              {tt('setup.title', 'Capability readiness')}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {tt('setup.description', 'Review evidence-backed setup by workflow. Optional areas are not counted as missing.')}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onRefresh} disabled={loading} className="w-full sm:w-auto">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {tt('setup.actions.refresh', 'Refresh evidence')}
          </Button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius)] border border-border/70 bg-background p-4">
            <div className="text-2xl font-semibold tabular-nums">{summary.ready}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tt('setup.summary.ready', 'Core areas ready')}</div>
          </div>
          <div className="rounded-[var(--radius)] border border-border/70 bg-background p-4">
            <div className="text-2xl font-semibold tabular-nums">{summary.needsAction}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tt('setup.summary.attention', 'Core areas needing attention')}</div>
          </div>
          <div className="rounded-[var(--radius)] border border-border/70 bg-background p-4">
            <div className="text-2xl font-semibold tabular-nums">{summary.unavailable}</div>
            <div className="mt-1 text-xs text-muted-foreground">{tt('setup.summary.unavailable', 'Evidence sources unavailable')}</div>
          </div>
        </div>

        {nextArea ? (
          <div className="mt-5 flex flex-col gap-3 rounded-[var(--radius)] border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">{tt('setup.next.title', 'Next recommended action')}</div>
              <div className="mt-1 font-medium">{tt(`setup.areas.${nextArea.key}.title`, nextArea.key.replaceAll('_', ' '))}</div>
              <div className="mt-1 text-sm text-muted-foreground">{tt(nextArea.summaryKey, 'Review this setup area.', nextAreaValues)}</div>
            </div>
            {nextArea.route && authorityAction(nextArea.authority) ? (
              <Button asChild className="w-full sm:w-auto"><Link to={nextArea.route}>{tt('setup.actions.continue', 'Continue setup')}</Link></Button>
            ) : (
              <div className="text-sm text-muted-foreground">{tt(`setup.guidance.${nextArea.authority}`, 'Ask an authorized company administrator to complete this area.')}</div>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <h2 className="text-lg font-semibold">{tt('setup.groups.core', 'Core foundation')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tt('setup.groups.coreHelp', 'Foundation used by the company workflows that apply to your current catalog and tax configuration.')}</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{core.map((area) => <SetupAreaCard key={area.key} area={area} />)}</div>
      </div>

      <div>
        <h2 className="text-lg font-semibold">{tt('setup.groups.extensions', 'Operational extensions')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{tt('setup.groups.extensionsHelp', 'Use these when the related workflow is part of your operation. An unused extension is not a setup failure.')}</p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">{extensions.map((area) => <SetupAreaCard key={area.key} area={area} />)}</div>
      </div>
    </section>
  )
}
