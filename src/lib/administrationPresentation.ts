import type { SubscriptionStatus } from './companyAccess'

export type AdministrationAuthority =
  | 'company'
  | 'manager'
  | 'admin'
  | 'owner'
  | 'finance'
  | 'platform'
  | 'read_only'

export type AdministrationTone = 'neutral' | 'info' | 'positive' | 'warning' | 'danger'

export function administrationAuthorityTone(authority: AdministrationAuthority): AdministrationTone {
  if (authority === 'platform') return 'warning'
  if (authority === 'finance' || authority === 'admin' || authority === 'owner') return 'info'
  if (authority === 'read_only') return 'neutral'
  return 'positive'
}

export function subscriptionStatusTone(status: SubscriptionStatus): AdministrationTone {
  if (status === 'active_paid') return 'positive'
  if (status === 'trial') return 'info'
  if (status === 'expired') return 'warning'
  return 'danger'
}

export function subscriptionStatusKey(status: SubscriptionStatus) {
  return `administration.subscription.${status}` as const
}

export function isKnownSubscriptionStatus(value: string | null | undefined): value is SubscriptionStatus {
  return ['trial', 'active_paid', 'expired', 'suspended', 'disabled'].includes(String(value))
}

export function safeBusinessLabel(value: string | null | undefined, unavailable: string) {
  const normalized = value?.trim()
  return normalized || unavailable
}
