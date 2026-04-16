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

type SetCompanyAccessInput = {
  companyId: string
  planCode: string
  status: SubscriptionStatus
  paidUntil?: string | null
  trialExpiresAt?: string | null
  purgeScheduledAt?: string | null
  reason?: string | null
}

function unwrapSingle<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null
  if (data && typeof data === 'object') return data as T
  return null
}

function unwrapMany<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

function toFriendlyAccessError(error: any, fallback: string) {
  const message = String(error?.message || '').toLowerCase()

  if (message.includes('platform_admin_required')) {
    return 'Platform admin access is required for this action.'
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
