import { supabase } from './supabase'

export type SubscriptionStatus = 'trial' | 'active_paid' | 'expired' | 'suspended' | 'disabled'

export type CompanyAccessState = {
  company_id: string
  company_name: string | null
  plan_code: string
  plan_name: string
  subscription_status: SubscriptionStatus
  effective_status: SubscriptionStatus
  trial_started_at: string | null
  trial_expires_at: string | null
  paid_until: string | null
  purge_scheduled_at: string | null
  purge_completed_at: string | null
  access_enabled: boolean
  manual_activation_only: boolean
}

export type PlatformAdminStatus = {
  is_admin: boolean
}

export type AssistedCompanyState = {
  company_id: string
  company_name: string
  provisioned_by: string
  provisioned_at: string
  intended_owner_email: string | null
  owner_state: 'unassigned' | 'pending' | 'active'
  owner_user_id: string | null
  owner_invited_at: string | null
  owner_activated_at: string | null
  subscription_status: SubscriptionStatus
  trial_started_at: string | null
  trial_expires_at: string | null
  workspace_open: boolean
}

export type AssistedWorkspaceContext = {
  company_id: string
  company_name: string
  expires_at: string
}

export type AssistedOwnerInvitation = {
  invite_id: string
  invite_token: string
  company_id: string
  owner_email: string
  expires_at: string
}

export type AssistedTrialResult = {
  company_id: string
  trial_started_at: string
  trial_expires_at: string
  purge_scheduled_at: string
  started_now: boolean
}

export type CompanyAccessRow = {
  company_id: string
  company_name: string | null
  company_email: string | null
  owner_user_id: string | null
  plan_code: string
  plan_name: string
  subscription_status: SubscriptionStatus
  effective_status: SubscriptionStatus
  trial_started_at: string | null
  trial_expires_at: string | null
  paid_until: string | null
  access_expires_at: string | null
  purge_scheduled_at: string | null
  purge_completed_at: string | null
  member_count: number
  active_member_count: number
  access_enabled: boolean
  updated_at: string
  company_created_at: string | null
  latest_member_last_sign_in_at: string | null
  notification_recipient_email: string | null
  monthly_price_mzn: number | null
  annual_price_mzn: number | null
  starting_price_mzn: number | null
  manual_activation_only: boolean
}

export type CompanyAccessAuditRow = {
  id: string
  company_id: string
  previous_plan_code: string | null
  next_plan_code: string | null
  previous_status: SubscriptionStatus | null
  next_status: SubscriptionStatus
  actor_user_id: string | null
  actor_email: string | null
  reason: string | null
  context: Record<string, unknown> | null
  created_at: string
}

export type CompanyAccessDetail = {
  company_id: string
  company_name: string | null
  legal_name: string | null
  trade_name: string | null
  company_email: string | null
  company_preferred_lang: string | null
  company_created_at: string | null
  owner_user_id: string | null
  owner_full_name: string | null
  owner_email: string | null
  owner_member_role: string | null
  owner_member_status: string | null
  owner_member_since: string | null
  owner_source: string | null
  owner_last_sign_in_at: string | null
  latest_member_user_id: string | null
  latest_member_full_name: string | null
  latest_member_email: string | null
  latest_member_role: string | null
  latest_member_last_sign_in_at: string | null
  member_count: number
  active_member_count: number
  plan_code: string
  plan_name: string
  subscription_status: SubscriptionStatus
  effective_status: SubscriptionStatus
  trial_started_at: string | null
  trial_expires_at: string | null
  access_granted_at: string | null
  paid_until: string | null
  purge_scheduled_at: string | null
  purge_completed_at: string | null
  access_enabled: boolean
  manual_activation_only: boolean
  notification_recipient_email: string | null
  notification_recipient_name: string | null
  notification_recipient_source: string | null
  reset_allowed: boolean
  reset_blocked_reason: string | null
}

export type CompanyControlActionRow = {
  id: string
  company_id: string
  action_type: string
  actor_user_id: string | null
  actor_email: string | null
  reason: string | null
  context: Record<string, unknown> | null
  created_at: string
}

export type CompanyResetResult = {
  company_id: string
  performed_at: string
  deleted_summary: Record<string, number>
  preserved_scope: Record<string, unknown>
}

export type CompanyAccessEmailTemplateType = 'expiry_warning' | 'purge_warning' | 'activation_confirmation'

export type CompanyAccessEmailPreview = {
  template_key: CompanyAccessEmailTemplateType
  recipient_email: string
  recipient_name: string | null
  recipient_source: string
  subject: string
  html: string
  text: string
  support_email: string
}

export type CompanyAccessEmailSendResult = {
  template_key: CompanyAccessEmailTemplateType
  recipient_email: string
  recipient_source: string
  subject: string
}

type SetCompanyAccessInput = {
  companyId: string
  planCode: string
  status: SubscriptionStatus
  paidUntil?: string | null
  trialExpiresAt?: string | null
  purgeScheduledAt?: string | null
  reason?: string | null
}

type ResetCompanyOperationalDataInput = {
  companyId: string
  confirmation: string
  reason: string
}

function unwrapSingle<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null
  if (data && typeof data === 'object') return data as T
  return null
}

function unwrapMany<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

function extractFnErr(error: any): string {
  const ctx = error?.context
  if (!ctx) return error?.message || 'Unknown error'
  if (ctx.body) {
    try {
      const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body
      return parsed?.error || parsed?.message || (typeof ctx.body === 'string' ? ctx.body : error?.message)
    } catch {
      return typeof ctx.body === 'string' ? ctx.body : error?.message || 'Unknown error'
    }
  }
  return error?.message || 'Unknown error'
}

function toFriendlyAccessError(error: any, fallback: string) {
  const message = String(error?.message || '').toLowerCase()

  if (message.includes('platform_admin_required')) {
    return 'Platform admin access is required for this action.'
  }
  if (message.includes('company_reset_confirmation_mismatch')) {
    return 'Confirmation must match the selected company UUID.'
  }
  if (message.includes('company_reset_reason_required')) {
    return 'A reset reason is required.'
  }
  if (message.includes('company_reset_active_paid_not_allowed')) {
    return 'Move the company out of active paid access before resetting operational data.'
  }
  if (message.includes('company_not_found')) {
    return 'The selected company no longer exists.'
  }
  if (message.includes('company_subscription_state_missing')) {
    return 'This company is missing subscription state and cannot be managed until that is repaired.'
  }
  if (message.includes('assisted_company_not_found')) {
    return 'This company was not created through assisted provisioning.'
  }
  if (message.includes('assisted_company_owner_already_active')) {
    return 'This company already has an active customer owner.'
  }
  if (message.includes('assisted_company_handed_over_or_not_found')) {
    return 'This setup workspace is no longer available because owner handover has completed.'
  }
  if (message.includes('assisted_owner_activation_required_before_trial')) {
    return 'The intended customer owner must explicitly accept the invitation before the 7-day trial can start.'
  }
  if (message.includes('assisted_trial_requires_disabled_access_state')) {
    return 'The assisted trial can start only while access is still disabled; existing paid or other access state was preserved.'
  }
  if (message.includes('platform_workspace_required')) {
    return 'Open this assisted company from Platform Control before changing its setup.'
  }
  if (message.includes('assisted_trial_requires_explicit_start')) {
    return 'Use the assisted-company trial action. The general access control cannot start this trial.'
  }
  if (message.includes('assisted_trial_cannot_be_restarted')) {
    return 'The assisted 7-day trial has already been used and cannot be restarted.'
  }
  if (message.includes('idempotency_key_payload_mismatch')) {
    return 'This request identifier was already used with different company details.'
  }
  if (message.includes('invalid_plan_code')) {
    return 'The selected plan code is no longer valid.'
  }
  if (message.includes('platform_admin_company_reset_rate_limited')) {
    return 'This reset control was used too quickly. Wait a few minutes and try again.'
  }
  if (message.includes('company_notification_recipient_missing')) {
    return 'No canonical company recipient is configured. Add a company email or ensure the owner/admin email is present first.'
  }
  if (message.includes('company_access_expiry_date_missing')) {
    return 'This company has no stored expiry date yet. Save the access dates first.'
  }
  if (message.includes('company_access_purge_date_missing')) {
    return 'This company has no stored purge schedule yet. Save the purge date first.'
  }
  if (message.includes('company_access_activation_confirmation_not_ready')) {
    return 'Activation confirmation is only available for companies that are already in active paid access.'
  }
  if (message.includes('company_access_activation_window_missing')) {
    return 'Activation confirmation requires both the activation start date and the paid-until date.'
  }
  if (message.includes('company_access_email_audit_failed')) {
    return 'The email was sent, but the control-plane audit could not be written. Review the action log before retrying.'
  }
  if (message.includes('company_access_email_template_invalid')) {
    return 'The selected company email template is no longer valid.'
  }
  if (message.includes('rate_limited')) {
    return 'This control was used too quickly. Wait a moment and try again.'
  }
  return fallback
}

export async function getMyCompanyAccessState(companyId?: string | null) {
  const { data, error } = await supabase.rpc('get_my_company_access_state', {
    p_company_id: companyId ?? null,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load company access status.'))
  return unwrapSingle<CompanyAccessState>(data)
}

const PLATFORM_ADMIN_STATUS_CACHE_MS = 5000

type PlatformAdminStatusCacheEntry = {
  key: string
  value: PlatformAdminStatus
  expiresAt: number
}

type PlatformAdminStatusInFlight = {
  key: string
  promise: Promise<PlatformAdminStatus>
}

let platformAdminStatusCache: PlatformAdminStatusCacheEntry | null = null
let platformAdminStatusInFlight: PlatformAdminStatusInFlight | null = null

export async function getPlatformAdminStatus(options?: { force?: boolean }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const cacheKey = session?.user?.id || 'anonymous'
  const now = Date.now()

  if (!options?.force) {
    if (
      platformAdminStatusCache?.key === cacheKey
      && platformAdminStatusCache.expiresAt > now
    ) {
      return platformAdminStatusCache.value
    }

    if (platformAdminStatusInFlight?.key === cacheKey) {
      return platformAdminStatusInFlight.promise
    }
  }

  const promise = (async () => {
    const { data, error } = await supabase.rpc('get_platform_admin_status')
    if (error) {
      throw new Error(toFriendlyAccessError(error, 'Failed to load platform admin status.'))
    }

    const value = unwrapSingle<PlatformAdminStatus>(data) || { is_admin: false }
    platformAdminStatusCache = {
      key: cacheKey,
      value,
      expiresAt: Date.now() + PLATFORM_ADMIN_STATUS_CACHE_MS,
    }
    return value
  })()

  platformAdminStatusInFlight = { key: cacheKey, promise }
  try {
    return await promise
  } finally {
    if (platformAdminStatusInFlight?.promise === promise) {
      platformAdminStatusInFlight = null
    }
  }
}

export async function provisionAssistedCustomerCompany(input: {
  name: string
  intendedOwnerEmail?: string | null
  companyEmail?: string | null
  phone?: string | null
  preferredLanguage?: 'pt' | 'en'
  countryCode?: string
  requestKey: string
}) {
  const { data, error } = await supabase.rpc('platform_admin_provision_customer_company', {
    p_name: input.name,
    p_intended_owner_email: input.intendedOwnerEmail?.trim().toLowerCase() || null,
    p_company_email: input.companyEmail?.trim().toLowerCase() || null,
    p_phone: input.phone?.trim() || null,
    p_preferred_lang: input.preferredLanguage || 'pt',
    p_country_code: input.countryCode?.trim().toUpperCase() || 'MZ',
    p_request_key: input.requestKey,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to provision the customer company.'))
  return unwrapSingle<{
    company_id: string
    company_name: string
    owner_state: 'unassigned' | 'pending' | 'active'
    subscription_status: SubscriptionStatus
    trial_started_at: string | null
    provisioned_at: string
  }>(data)
}

export async function getAssistedCompanyState(companyId: string) {
  const { data, error } = await supabase.rpc('platform_admin_get_assisted_company_state', {
    p_company_id: companyId,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load assisted provisioning state.'))
  return unwrapSingle<AssistedCompanyState>(data)
}

export async function openAssistedCustomerWorkspace(companyId: string) {
  const { data, error } = await supabase.rpc('platform_admin_open_customer_workspace', {
    p_company_id: companyId,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to open the customer workspace.'))
  return unwrapSingle<AssistedWorkspaceContext>(data)
}

export async function closeAssistedCustomerWorkspace() {
  const { data, error } = await supabase.rpc('platform_admin_close_customer_workspace')
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to close the customer workspace.'))
  return Boolean(data)
}

export async function inviteAssistedCustomerOwner(companyId: string, email: string) {
  const { data, error } = await supabase.rpc('platform_admin_invite_assisted_owner', {
    p_company_id: companyId,
    p_email: email.trim().toLowerCase(),
    p_expires_at: null,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to create the customer owner invitation.'))
  return unwrapSingle<AssistedOwnerInvitation>(data)
}

export async function startAssistedCustomerTrial(companyId: string) {
  const { data, error } = await supabase.rpc('platform_admin_start_assisted_trial', {
    p_company_id: companyId,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to start the assisted customer trial.'))
  return unwrapSingle<AssistedTrialResult>(data)
}

export async function listCompanyAccess(search?: string) {
  const { data, error } = await supabase.rpc('platform_admin_list_company_access', {
    p_search: search?.trim() || null,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load company access records.'))
  return unwrapMany<CompanyAccessRow>(data)
}

export async function listCompanySubscriptionDashboard(search?: string) {
  const { data, error } = await supabase.rpc('platform_admin_list_company_subscription_dashboard', {
    p_search: search?.trim() || null,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load company subscription analytics.'))
  return unwrapMany<CompanyAccessRow>(data)
}

export async function listCompanyAccessEvents(companyId: string) {
  const { data, error } = await supabase.rpc('platform_admin_list_company_access_events', {
    p_company_id: companyId,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load access audit history.'))
  return unwrapMany<CompanyAccessAuditRow>(data)
}

export async function getCompanyAccessDetail(companyId: string) {
  const { data, error } = await supabase.rpc('platform_admin_get_company_detail', {
    p_company_id: companyId,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load company detail.'))
  return unwrapSingle<CompanyAccessDetail>(data)
}

export async function listCompanyControlActions(companyId: string) {
  const { data, error } = await supabase.rpc('platform_admin_list_company_control_actions', {
    p_company_id: companyId,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load company control actions.'))
  return unwrapMany<CompanyControlActionRow>(data)
}

export async function setCompanyAccess(input: SetCompanyAccessInput) {
  const { data, error } = await supabase.rpc('platform_admin_set_company_access', {
    p_company_id: input.companyId,
    p_plan_code: input.planCode,
    p_status: input.status,
    p_paid_until: input.paidUntil || null,
    p_trial_expires_at: input.trialExpiresAt || null,
    p_purge_scheduled_at: input.purgeScheduledAt || null,
    p_reason: input.reason || null,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to update company access state.'))
  return unwrapSingle<CompanyAccessState>(data)
}

export async function resetCompanyOperationalData(input: ResetCompanyOperationalDataInput) {
  const { data, error } = await supabase.rpc('platform_admin_reset_company_operational_data', {
    p_company_id: input.companyId,
    p_confirmation: input.confirmation,
    p_reason: input.reason,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to reset company operational data.'))
  return unwrapSingle<CompanyResetResult>(data)
}

export async function previewCompanyAccessEmail(input: {
  companyId: string
  templateKey: CompanyAccessEmailTemplateType
  note?: string | null
}) {
  try {
    const { data, error } = await supabase.functions.invoke('mailer-company-access', {
      body: {
        company_id: input.companyId,
        template_key: input.templateKey,
        mode: 'preview',
        note: input.note || null,
      },
    })
    if (error) throw new Error(toFriendlyAccessError({ message: extractFnErr(error) }, 'Failed to preview company email.'))
    return (data?.preview || null) as CompanyAccessEmailPreview | null
  } catch (error: any) {
    throw new Error(toFriendlyAccessError(error, 'Failed to preview company email.'))
  }
}

export async function sendCompanyAccessEmail(input: {
  companyId: string
  templateKey: CompanyAccessEmailTemplateType
  note?: string | null
}) {
  try {
    const { data, error } = await supabase.functions.invoke('mailer-company-access', {
      body: {
        company_id: input.companyId,
        template_key: input.templateKey,
        mode: 'send',
        note: input.note || null,
      },
    })
    if (error) throw new Error(toFriendlyAccessError({ message: extractFnErr(error) }, 'Failed to send company email.'))
    return (data?.sent || null) as CompanyAccessEmailSendResult | null
  } catch (error: any) {
    throw new Error(toFriendlyAccessError(error, 'Failed to send company email.'))
  }
}
