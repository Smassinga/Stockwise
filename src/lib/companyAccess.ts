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

export type CompanyAccessRow = {
  company_id: string
  company_name: string | null
  owner_user_id: string | null
  plan_code: string
  plan_name: string
  subscription_status: SubscriptionStatus
  effective_status: SubscriptionStatus
  trial_started_at: string | null
  trial_expires_at: string | null
  paid_until: string | null
  purge_scheduled_at: string | null
  purge_completed_at: string | null
  member_count: number
  active_member_count: number
  access_enabled: boolean
  updated_at: string
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

export async function getPlatformAdminStatus() {
  const { data, error } = await supabase.rpc('get_platform_admin_status')
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load platform admin status.'))
  return unwrapSingle<PlatformAdminStatus>(data) || { is_admin: false }
}

export async function listCompanyAccess(search?: string) {
  const { data, error } = await supabase.rpc('platform_admin_list_company_access', {
    p_search: search?.trim() || null,
  })
  if (error) throw new Error(toFriendlyAccessError(error, 'Failed to load company access records.'))
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
