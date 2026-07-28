import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Check, CircleAlert } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useI18n, withI18nFallback } from '../../lib/i18n'
import { cn } from '../../lib/utils'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

export type FxCurrencyMetadata = {
  code: string
  symbol?: string | null
  decimals?: number | null
}

type FxConversionPreviewProps = {
  date: string
  from: string
  to: string
  rate: string
  currencies: FxCurrencyMetadata[]
}

export type SavedFxRate = {
  date: string
  from: string
  to: string
  rate: number
}

type PreviewState =
  | { status: 'instruction' }
  | { status: 'invalid'; message: string }
  | {
      status: 'ready'
      source: number
      target: number
      sourceCurrency: FxCurrencyMetadata
      targetCurrency: FxCurrencyMetadata
      rate: number
    }

function parseAmount(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function decimalsFor(currency: FxCurrencyMetadata) {
  const decimals = Number(currency.decimals)
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 6 ? decimals : 2
}

function formatAmount(value: number, currency: FxCurrencyMetadata, locale: string) {
  const decimals = decimalsFor(currency)
  const amount = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
  return [currency.symbol?.trim(), amount, currency.code].filter(Boolean).join(' ')
}

export function FxConversionPreview({
  date,
  from,
  to,
  rate,
  currencies,
}: FxConversionPreviewProps) {
  const { lang, t } = useI18n()
  const reduceMotion = useReducedMotion()
  const amountId = useId()
  const [sourceAmount, setSourceAmount] = useState('')
  const locale = lang === 'pt' ? 'pt-MZ' : 'en-MZ'

  const state = useMemo<PreviewState>(() => {
    const amount = parseAmount(sourceAmount)
    if (amount === null) return { status: 'instruction' }
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        status: 'invalid',
        message: withI18nFallback(t, 'currency.preview.invalidAmount', 'Invalid source amount'),
      }
    }

    if (!date || !from || !to || !rate.trim()) return { status: 'instruction' }

    const parsedRate = Number(rate)
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      return {
        status: 'invalid',
        message: withI18nFallback(t, 'currency.preview.invalidRate', 'Enter a positive rate'),
      }
    }
    if (from === to) {
      return {
        status: 'invalid',
        message: withI18nFallback(t, 'currency.preview.sameCurrency', 'Source and target currencies must be different'),
      }
    }

    const sourceCurrency = currencies.find((currency) => currency.code === from)
    const targetCurrency = currencies.find((currency) => currency.code === to)
    if (!sourceCurrency || !targetCurrency) {
      return {
        status: 'invalid',
        message: withI18nFallback(t, 'currency.preview.metadataUnavailable', 'Currency information is unavailable'),
      }
    }

    return {
      status: 'ready',
      source: amount,
      target: amount * parsedRate,
      sourceCurrency,
      targetCurrency,
      rate: parsedRate,
    }
  }, [currencies, date, from, rate, sourceAmount, t, to])

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-labelledby={`${amountId}-title`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={`${amountId}-title`} className="text-lg font-semibold">
            {withI18nFallback(t, 'currency.preview.title', 'Conversion preview')}
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {withI18nFallback(t, 'currency.preview.body', 'Enter an amount and rate to review the result.')}
          </p>
        </div>
        <span className="w-fit rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          {withI18nFallback(t, 'currency.preview.disclaimer', 'Preview only')}
        </span>
      </div>

      <div className="mt-5 max-w-sm space-y-2">
        <Label htmlFor={amountId}>
          {withI18nFallback(t, 'currency.preview.sourceAmount', 'Source amount')}
        </Label>
        <Input
          id={amountId}
          inputMode="decimal"
          value={sourceAmount}
          onChange={(event) => setSourceAmount(event.target.value)}
          placeholder={withI18nFallback(t, 'currency.preview.amountPlaceholder', 'Enter an amount')}
          aria-describedby={`${amountId}-state`}
        />
      </div>

      <div id={`${amountId}-state`} className="mt-5 min-h-40" aria-live="polite">
        <AnimatePresence initial={false} mode="wait">
          {state.status === 'ready' ? (
            <motion.div
              key="ready"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={transition}
              className="rounded-xl border border-primary/25 bg-primary/5 p-4"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
                {withI18nFallback(t, 'currency.preview.ready', 'Preview ready')}
              </div>
              <div className="mt-4 grid items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    {withI18nFallback(t, 'currency.preview.from', 'From')}
                  </div>
                  <div className="mt-2 break-words text-lg font-semibold">
                    {formatAmount(state.source, state.sourceCurrency, locale)}
                  </div>
                </div>
                <div className="flex items-center justify-center text-primary" aria-label={`${from} to ${to}`}>
                  <ArrowRight className="h-5 w-5 rotate-90 sm:rotate-0" aria-hidden="true" />
                </div>
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    {withI18nFallback(t, 'currency.preview.to', 'To')}
                  </div>
                  <div className="mt-2 break-words text-lg font-semibold">
                    {formatAmount(state.target, state.targetCurrency, locale)}
                  </div>
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{withI18nFallback(t, 'currency.preview.rate', 'Rate')}</dt>
                  <dd className="mt-1 font-medium">1 {from} = {state.rate} {to}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{withI18nFallback(t, 'currency.preview.rateDate', 'Rate date')}</dt>
                  <dd className="mt-1 font-medium">{date || '-'}</dd>
                </div>
              </dl>
            </motion.div>
          ) : state.status === 'invalid' ? (
            <div
              key="invalid"
              className="flex min-h-40 items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-foreground"
            >
              <CircleAlert className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
              {state.message}
            </div>
          ) : (
            <div
              key="instruction"
              className="flex min-h-40 items-center rounded-xl border border-dashed border-border bg-muted/15 p-4 text-sm text-muted-foreground"
            >
              {withI18nFallback(t, 'currency.preview.body', 'Enter an amount and rate to review the result.')}
            </div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}

export function FxRateSavedResult({ result }: { result: SavedFxRate }) {
  const { t } = useI18n()
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.2 }}
      className={cn(
        'rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4',
        'text-sm text-foreground',
      )}
    >
      <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-200">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Check className="h-4 w-4" aria-hidden="true" />
        </span>
        {withI18nFallback(t, 'currency.saved.title', 'Rate saved')}
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">{withI18nFallback(t, 'currency.saved.date', 'Date')}</dt>
          <dd className="mt-1 font-medium">{result.date}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{withI18nFallback(t, 'currency.saved.from', 'From')}</dt>
          <dd className="mt-1 font-medium">{result.from}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{withI18nFallback(t, 'currency.saved.to', 'To')}</dt>
          <dd className="mt-1 font-medium">{result.to}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{withI18nFallback(t, 'currency.saved.rate', 'Rate')}</dt>
          <dd className="mt-1 font-medium">{result.rate}</dd>
        </div>
      </dl>
    </motion.div>
  )
}
