import type { MemberRole, MemberStatus } from './enums'
import { supabase } from './supabase'
import { withTimeout } from './withTimeout'

export type OrgMembershipRow = {
  company_id: string
  role: MemberRole
  status: MemberStatus
  created_at?: string | null
  user_id?: string | null
}

export type OrgCompanyRow = {
  id: string
  name: string | null
}

function statusRank(status: MemberStatus) {
  return { active: 0, invited: 1, disabled: 2 }[status] ?? 3
}

function roleRank(role: MemberRole) {
  return (
    {
      OWNER: 0,
      ADMIN: 1,
      MANAGER: 2,
      OPERATOR: 3,
      VIEWER: 4,
    } as Record<string, number>
  )[role] ?? 9
}

export function pickBestOrgMemberships(rows: OrgMembershipRow[]) {
  const normalized = rows.reduce((acc, membership) => {
    const companyId = membership.company_id
    const current = acc[companyId]
    const better =
      !current
      || (!!membership.user_id && !current.user_id)
      || (membership.status === 'active' && current.status !== 'active')
      || (
        (!!membership.user_id === !!current.user_id)
        && (
          statusRank(membership.status) < statusRank(current.status)
          || (
            statusRank(membership.status) === statusRank(current.status)
            && roleRank(membership.role) < roleRank(current.role)
          )
          || (
            statusRank(membership.status) === statusRank(current.status)
            && roleRank(membership.role) === roleRank(current.role)
            && new Date(membership.created_at || 0).getTime()
              < new Date(current.created_at || 0).getTime()
          )
        )
      )

    if (better) acc[companyId] = membership
    return acc
  }, {} as Record<string, OrgMembershipRow>)

  return new Map(Object.entries(normalized))
}

export async function listActiveOrgMemberships(
  userId: string,
  email: string | null | undefined,
  timeoutMs: number
): Promise<OrgMembershipRow[]> {
  const byUser = await withTimeout(
    supabase
      .from('company_members')
      .select('company_id, role, status, created_at, user_id')
      .eq('user_id', userId)
      .eq('status', 'active' as MemberStatus)
      .order('created_at', { ascending: true }),
    timeoutMs,
    'company membership lookup by user'
  )
  if (byUser.error) throw byUser.error

  const memberships = [...((byUser.data ?? []) as OrgMembershipRow[])]
  if (!email) return memberships

  const byEmail = await withTimeout(
    supabase
      .from('company_members')
      .select('company_id, role, status, created_at, user_id')
      .is('user_id', null)
      .eq('email', email)
      .eq('status', 'active' as MemberStatus)
      .order('created_at', { ascending: true }),
    timeoutMs,
    'company membership lookup by email'
  )
  if (byEmail.error) throw byEmail.error

  memberships.push(...((byEmail.data ?? []) as OrgMembershipRow[]))
  return memberships
}

export async function listOrgCompanies(companyIds: string[], timeoutMs: number): Promise<OrgCompanyRow[]> {
  if (companyIds.length === 0) return []

  const result = await withTimeout(
    supabase
      .from('companies')
      .select('id,name')
      .in('id', companyIds),
    timeoutMs,
    'company lookup'
  )
  if (result.error) throw result.error

  return (result.data ?? []) as OrgCompanyRow[]
}
