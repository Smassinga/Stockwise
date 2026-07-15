import { Sentry, sentryEnabled } from './sentry'

export type SentryProductionSmokeResult = {
  eventId: string
  flushed: boolean
}

// TEMPORARY: Remove this helper immediately after production Sentry validation is complete.
export async function runSentryProductionSmoke(): Promise<SentryProductionSmokeResult> {
  if (!import.meta.env.PROD || !sentryEnabled) {
    throw new Error('sentry_production_monitoring_not_enabled')
  }

  const error = new Error(
    'stockwise_sentry_production_smoke_v1 route=/reset?access_token=synthetic-only recovery_token=synthetic-only',
  )
  error.name = 'StockWiseSentrySmokeError'

  let eventId = ''
  Sentry.withScope((scope) => {
    scope.setTag('stockwise.smoke', 'frontend-v1')
    scope.setFingerprint(['stockwise-sentry-production-smoke-v1'])
    scope.setExtra(
      'synthetic_url',
      'https://stockwiseapp.com/accept-invite?invitation_token=synthetic-only#ignored',
    )
    scope.setExtra('synthetic_note', 'Recovery failed recovery_token=synthetic-only')
    eventId = Sentry.captureException(error)
  })

  const flushed = await Sentry.flush(5000)
  return { eventId, flushed }
}
