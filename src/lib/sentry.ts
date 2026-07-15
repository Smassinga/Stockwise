import * as Sentry from '@sentry/react'
import type {
  Breadcrumb,
  Event,
  Exception,
  RequestEventData,
  StackFrame,
  Stacktrace,
  User,
} from '@sentry/react'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|password|token|secret|email|username|display.?name|phone|nuit|tax.?id|company|organi[sz]ation|legal.?name|customer|supplier|bank|account|invoice|vendor.?bill|payment.?proof|request.?body|body|payload|api.?key|signature)/i
const AUTHORIZATION_ASSIGNMENT_PATTERN = /\b(authorization)\s*([=:])\s*(?:(?:Bearer|Basic)\s+)?[^\s,;]+/gi
const SENSITIVE_ASSIGNMENT_PATTERN = /\b(access_token|refresh_token|recovery_token|invitation_token|invite_token|confirmation_token|token|code|password|authorization|api_key|apikey|secret|signature|proof_token)\s*([=:])\s*([^\s,;&]+)/gi
const EMBEDDED_URL_PATTERN = /(?:https?:\/\/|\/\/|#\/|\.\.?\/|\/)?[^\s"'<>?]+\?[^\s"'<>#]*(?:#[^\s"'<>]*)?|https?:\/\/[^\s"'<>]+|\/\/[^\s"'<>]+/gi
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi
const MAX_CONTEXT_DEPTH = 5

function stripUrlQueryAndFragment(value: string): string {
  if (value.startsWith('#/')) {
    const queryIndex = value.indexOf('?')
    const nestedFragmentIndex = value.indexOf('#', 1)
    const cutAt = [queryIndex, nestedFragmentIndex]
      .filter((index) => index >= 0)
      .reduce((lowest, index) => Math.min(lowest, index), value.length)
    return value.slice(0, cutAt)
  }

  const queryIndex = value.indexOf('?')
  const fragmentIndex = value.indexOf('#')
  const cutAt = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), value.length)
  return value.slice(0, cutAt)
}

export function sanitizeUrl(value: string | undefined): string | undefined {
  if (!value) return value

  const trimmed = value.trim()
  if (!trimmed) return trimmed

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed)
      return `${parsed.origin}${parsed.pathname}`
    }

    if (trimmed.startsWith('//')) {
      const parsed = new URL(`https:${trimmed}`)
      return `//${parsed.host}${parsed.pathname}`
    }

    // A fixed base validates relative URL forms without depending on window.
    new URL(trimmed.startsWith('#/') ? trimmed.slice(1) : trimmed, 'https://stockwise.invalid/')
    return stripUrlQueryAndFragment(trimmed)
  } catch {
    return stripUrlQueryAndFragment(trimmed)
  }
}

export function sanitizeText(value: string): string {
  const withoutUrlQueries = value.replace(
    EMBEDDED_URL_PATTERN,
    (urlLike) => sanitizeUrl(urlLike) ?? '[Filtered URL]',
  )

  return withoutUrlQueries
    .replace(AUTHORIZATION_ASSIGNMENT_PATTERN, (_match, key: string, separator: string) => `${key}${separator}[Redacted]`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string, separator: string) => `${key}${separator}[Redacted]`)
    .replace(EMAIL_PATTERN, '[Filtered email]')
    .replace(JWT_PATTERN, '[Filtered token]')
    .replace(BEARER_PATTERN, 'Bearer [Filtered]')
}

function sanitizeContextualValue(
  value: unknown,
  key = '',
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  try {
    if (value === null || value === undefined) return value
    if (SENSITIVE_KEY_PATTERN.test(key)) return '[Filtered]'
    if (typeof value === 'string') return sanitizeText(value)
    if (typeof value === 'number') return Number.isFinite(value) ? value : '[Filtered]'
    if (typeof value === 'boolean') return value
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'symbol' || typeof value === 'function') return '[Filtered]'
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Filtered]' : value.toISOString()
    if (depth >= MAX_CONTEXT_DEPTH) return '[Truncated]'
    if (seen.has(value)) return '[Circular]'

    seen.add(value)

    if (Array.isArray(value)) {
      return value.map((entry) => sanitizeContextualValue(entry, '', depth + 1, seen))
    }

    const sanitized: Record<string, unknown> = {}
    let descriptors: PropertyDescriptorMap
    try {
      descriptors = Object.getOwnPropertyDescriptors(value)
    } catch {
      return '[Filtered]'
    }

    for (const [entryKey, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue
      if (!('value' in descriptor)) {
        sanitized[entryKey] = '[Filtered]'
        continue
      }
      sanitized[entryKey] = sanitizeContextualValue(descriptor.value, entryKey, depth + 1, seen)
    }

    return sanitized
  } catch {
    return '[Filtered]'
  }
}

export function sanitizeStackFrame(frame: StackFrame): StackFrame {
  return {
    filename: sanitizeUrl(frame.filename),
    abs_path: sanitizeUrl(frame.abs_path),
    function: frame.function ? sanitizeText(frame.function) : frame.function,
    module: frame.module ? sanitizeText(frame.module) : frame.module,
    platform: frame.platform ? sanitizeText(frame.platform) : frame.platform,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
    instruction_addr: frame.instruction_addr ? sanitizeText(frame.instruction_addr) : frame.instruction_addr,
    addr_mode: frame.addr_mode ? sanitizeText(frame.addr_mode) : frame.addr_mode,
    debug_id: frame.debug_id ? sanitizeText(frame.debug_id) : frame.debug_id,
  }
}

function sanitizeStacktrace(stacktrace: Stacktrace | undefined): Stacktrace | undefined {
  if (!stacktrace) return undefined
  return {
    frames: stacktrace.frames?.map(sanitizeStackFrame),
    frames_omitted: stacktrace.frames_omitted ? [...stacktrace.frames_omitted] : undefined,
  }
}

function sanitizeExceptionValue(exception: Exception): Exception {
  return {
    type: exception.type ? sanitizeText(exception.type) : exception.type,
    value: exception.value ? sanitizeText(exception.value) : exception.value,
    module: exception.module ? sanitizeText(exception.module) : exception.module,
    thread_id: exception.thread_id,
    mechanism: exception.mechanism
      ? sanitizeContextualValue(exception.mechanism) as Exception['mechanism']
      : undefined,
    stacktrace: sanitizeStacktrace(exception.stacktrace),
  }
}

function sanitizeException(exception: Event['exception']): Event['exception'] {
  if (!exception) return undefined
  return { values: exception.values?.map(sanitizeExceptionValue) }
}

function sanitizeRequest(request: RequestEventData | undefined): RequestEventData | undefined {
  if (!request) return undefined
  return {
    url: sanitizeUrl(request.url),
    method: request.method ? sanitizeText(request.method) : request.method,
  }
}

function sanitizeUser(user: User | undefined): User | undefined {
  const opaqueUserId = typeof user?.id === 'string' && UUID_PATTERN.test(user.id)
    ? user.id
    : undefined
  return opaqueUserId ? { id: opaqueUserId } : undefined
}

function isUsefulBreadcrumb(breadcrumb: Breadcrumb): boolean {
  const category = breadcrumb.category ?? ''
  if (category === 'console' || category.startsWith('ui.')) return false
  return breadcrumb.type === 'navigation'
    || breadcrumb.type === 'http'
    || category === 'navigation'
    || category === 'fetch'
    || category === 'xhr'
}

function sanitizeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (!isUsefulBreadcrumb(breadcrumb)) return null
  return {
    type: breadcrumb.type ? sanitizeText(breadcrumb.type) : breadcrumb.type,
    level: breadcrumb.level,
    event_id: breadcrumb.event_id,
    category: breadcrumb.category ? sanitizeText(breadcrumb.category) : breadcrumb.category,
    message: breadcrumb.message ? sanitizeText(breadcrumb.message) : breadcrumb.message,
    data: breadcrumb.data
      ? sanitizeContextualValue(breadcrumb.data) as Breadcrumb['data']
      : undefined,
    timestamp: breadcrumb.timestamp,
  }
}

function sanitizeTags(tags: Event['tags']): Event['tags'] {
  if (!tags) return undefined
  return Object.fromEntries(
    Object.entries(tags)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, value]) => [
        sanitizeText(key),
        typeof value === 'string' ? sanitizeText(value) : value,
      ]),
  )
}

type EventWithFormattedLogentry = Event & {
  logentry?: Event['logentry'] & { formatted?: string }
}

export function sanitizeSentryEvent(event: Event): Event {
  try {
    const source = event as EventWithFormattedLogentry
    const sanitizedLogentry = source.logentry
      ? {
          message: source.logentry.message ? sanitizeText(source.logentry.message) : source.logentry.message,
          formatted: source.logentry.formatted ? sanitizeText(source.logentry.formatted) : source.logentry.formatted,
          params: source.logentry.params?.map((param) => sanitizeContextualValue(param)),
        }
      : undefined

    return {
      ...event,
      message: event.message ? sanitizeText(event.message) : event.message,
      logentry: sanitizedLogentry,
      exception: sanitizeException(event.exception),
      request: sanitizeRequest(event.request),
      user: sanitizeUser(event.user),
      breadcrumbs: event.breadcrumbs
        ?.map(sanitizeBreadcrumb)
        .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null),
      transaction: event.transaction ? sanitizeText(event.transaction) : event.transaction,
      tags: sanitizeTags(event.tags),
      extra: sanitizeContextualValue(event.extra) as Event['extra'],
      contexts: sanitizeContextualValue(event.contexts) as Event['contexts'],
      fingerprint: event.fingerprint?.map(sanitizeText),
    }
  } catch {
    return {
      event_id: event.event_id,
      timestamp: event.timestamp,
      level: event.level,
      platform: event.platform,
      release: event.release,
      environment: event.environment,
      sdk: event.sdk,
      message: 'Application error',
    }
  }
}

const enabledFlag = import.meta.env.VITE_SENTRY_ENABLED?.trim().toLowerCase() === 'true'
const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()

export const sentryEnabled = import.meta.env.PROD && enabledFlag && Boolean(dsn)

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim() || 'production',
    sendDefaultPii: false,
    sampleRate: 1.0,
    attachStacktrace: true,
    beforeSend(event) {
      return sanitizeSentryEvent(event)
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeBreadcrumb(breadcrumb)
    },
  })
}

export { Sentry }
