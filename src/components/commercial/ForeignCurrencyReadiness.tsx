import { AlertTriangle, CheckCircle2, CircleDollarSign, LoaderCircle } from 'lucide-react'
import { PremiumStatusBadge } from '../premium/PremiumStatusBadge'
import type { FxReadinessState } from '../../lib/commercialWorkflowPresentation'

export function ForeignCurrencyReadiness({
  state,
  currencyCode,
  baseCurrencyCode,
  translate,
}: {
  state: FxReadinessState
  currencyCode: string
  baseCurrencyCode: string
  translate: (key: string, fallback: string) => string
}) {
  const copy = (() => {
    switch (state.status) {
      case 'base':
        return {
          tone: 'neutral' as const,
          icon: <CircleDollarSign />,
          label: translate('commercial.fx.base', 'Base currency'),
          detail: translate('commercial.fx.baseHelp', 'Base-currency orders use a fixed 1:1 rate.'),
        }
      case 'loading':
        return {
          tone: 'info' as const,
          icon: <LoaderCircle className="animate-spin" />,
          label: translate('commercial.fx.loading', 'Loading configured rate'),
          detail: translate('commercial.fx.loadingHelp', 'Checking the latest company-configured exchange rate.'),
        }
      case 'loaded':
        return {
          tone: 'positive' as const,
          icon: <CheckCircle2 />,
          label: translate('commercial.fx.loaded', 'Configured rate loaded'),
          detail: state.sourceDate
            ? `${translate('commercial.fx.loadedDated', 'Configured rate dated')} ${state.sourceDate}`
            : translate('commercial.fx.loadedLatest', 'Latest configured rate'),
        }
      case 'manual':
        return {
          tone: 'warning' as const,
          icon: <CircleDollarSign />,
          label: translate('commercial.fx.manual', 'Manual rate'),
          detail: translate('commercial.fx.manualHelp', 'Base-currency totals use the positive rate entered here.'),
        }
      case 'invalid':
        return {
          tone: 'critical' as const,
          icon: <AlertTriangle />,
          label: translate('commercial.fx.invalid', 'Rate invalid'),
          detail: translate('commercial.fx.invalidHelp', 'Enter a positive finite exchange rate before creating the draft.'),
        }
      default:
        return {
          tone: 'warning' as const,
          icon: <AlertTriangle />,
          label: translate('commercial.fx.unavailable', 'Rate unavailable'),
          detail: translate('commercial.fx.unavailableHelp', 'No configured rate was found. Enter and review a positive manual rate before creating the draft.'),
        }
    }
  })()

  return (
    <div className="mt-2 rounded-lg border border-border/70 bg-muted/20 p-3" role="status" aria-live="polite">
      <PremiumStatusBadge tone={copy.tone} icon={copy.icon}>{copy.label}</PremiumStatusBadge>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        {currencyCode} to {baseCurrencyCode}. {copy.detail}
      </p>
    </div>
  )
}
