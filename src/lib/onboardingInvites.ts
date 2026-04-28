import type { MemberRole } from './enums'
import { clearInviteToken, readInviteToken } from './inviteToken'
import { setActiveCompanyRpc } from './setActiveCompanyRpc'
import { supabase } from './supabase'
import { withTimeout } from './withTimeout'

const INVITE_LIST_TIMEOUT_MS = 6000
const INVITE_ACCEPT_TIMEOUT_MS = 6000
const ACTIVE_COMPANY_TIMEOUT_MS = 6000

export type PendingCompanyInvitation = {
  company_id: string
  company_name: string | null
  role: MemberRole
  invitation_status: string | null
  invited_at: string | null
  expires_at: string | null
  inviter_user_id: string | null
  inviter_name: string | null
  inviter_email: string | null
  source: 'invite' | 'membership'
}

export type InviteErrorCode =
  | 'invalid_or_expired'
  | 'email_mismatch'
  | 'not_authenticated'
  | 'not_found'
  | 'generic'

type InviteResult =
  | { status: 'none' }
  | { status: 'accepted'; companyId: string | null }
  | { status: 'error'; code: InviteErrorCode; rawMessage: string }

function errorMessage(error: { message?: string } | null | undefined) {
  return String(error?.message || '').trim()
}

export function getInviteErrorCode(error: { message?: string } | null | undefined): InviteErrorCode {
  const message = errorMessage(error).toLowerCase()
  if (
    message.includes('invalid_or_expired')
    || message.includes('invite_invalid_or_expired')
    || message.includes('invite_unavailable')
  ) {
    return 'invalid_or_expired'
  }
  if (message.includes('invite_email_mismatch')) return 'email_mismatch'
  if (message.includes('not_authenticated') || message.includes('unauthenticated')) {
    return 'not_authenticated'
  }
  if (message.includes('invite_not_found') || message.includes('invite not found')) {
    return 'not_found'
  }
  return 'generic'
}

function unwrapCompanyId(payload: unknown) {
  if (payload && typeof payload === 'object' && 'company_id' in payload) {
    return String((payload as { company_id?: string | null }).company_id || '') || null
  }
  if (Array.isArray(payload)) {
    return unwrapCompanyId(payload[0])
  }
  return null
}

export async function listMyPendingCompanyInvitations() {
  const { data, error } = await withTimeout(
    supabase.rpc('list_my_pending_company_invitations'),
    INVITE_LIST_TIMEOUT_MS,
    'pending invite lookup',
  )
  if (error) throw error
  return ((data || []) as PendingCompanyInvitation[]).sort((left, right) => {
    const leftAt = left.invited_at ? Date.parse(left.invited_at) : 0
    const rightAt = right.invited_at ? Date.parse(right.invited_at) : 0
    if (leftAt !== rightAt) return rightAt - leftAt
    return String(left.company_name || '').localeCompare(String(right.company_name || ''))
  })
}

export async function acceptPendingCompanyInvitation(companyId: string) {
  const { error } = await withTimeout(
    supabase.rpc('accept_my_invite', { p_company_id: companyId }),
    INVITE_ACCEPT_TIMEOUT_MS,
    'pending invite accept',
  )
  if (error) throw error

  const { error: activeError } = await withTimeout(
    setActiveCompanyRpc(companyId),
    ACTIVE_COMPANY_TIMEOUT_MS,
    'set active company after invite accept',
  )
  if (activeError) throw activeError
}

export async function redeemStoredInviteToken(): Promise<InviteResult> {
  const token = readInviteToken()
  if (!token) return { status: 'none' }

  const { data, error } = await withTimeout(
    supabase.rpc('accept_invite_with_token', { p_token: token }),
    INVITE_ACCEPT_TIMEOUT_MS,
    'token invite accept',
  )

  if (error) {
    const code = getInviteErrorCode(error)
    if (code !== 'email_mismatch' && code !== 'not_authenticated') {
      clearInviteToken()
    }
    return {
      status: 'error',
      code,
      rawMessage: errorMessage(error),
    }
  }

  clearInviteToken()
  const companyId = unwrapCompanyId(data)
  if (companyId) {
    const { error: activeError } = await withTimeout(
      setActiveCompanyRpc(companyId),
      ACTIVE_COMPANY_TIMEOUT_MS,
      'set active company after token invite accept',
    )
    if (activeError) {
      return {
        status: 'error',
        code: getInviteErrorCode(activeError),
        rawMessage: errorMessage(activeError),
      }
    }
  }

  return { status: 'accepted', companyId }
}
