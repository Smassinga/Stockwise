import { useEffect, useMemo, useState } from 'react'
import { Search, UserPlus, Users as UsersIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import { authFetch } from '../lib/authFetch'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { hasMinRole, canAssignRole, canInviteRole } from '../lib/roles'

type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'
type Status = 'invited' | 'active' | 'disabled'

type Member = {
  email: string | null
  user_id: string | null
  role: Role
  status: Status
  invited_by?: string | null
  created_at?: string | null
  last_sign_in_at?: string | null
  email_confirmed_at?: string | null
}

const roleRank = (role: Role) => ({ OWNER: 0, ADMIN: 1, MANAGER: 2, OPERATOR: 3, VIEWER: 4 }[role] ?? 99)

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

export default function Users() {
  const { companyId, companyName, myRole } = useOrg()
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)

  const canAccessUsersPage = hasMinRole(myRole, 'MANAGER')
  const canManageUsers = canAccessUsersPage
  const canInviteAdmins = hasMinRole(myRole, 'ADMIN')

  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('VIEWER')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all')

  const [myEmail, setMyEmail] = useState<string | null>(null)
  const [myName, setMyName] = useState<string | null>(null)

  const roleLabel = (role: Role) => tt(`users.roles.${role.toLowerCase()}`, role)
  const statusLabel = (status: Status) => tt(`users.statuses.${status}`, status.charAt(0).toUpperCase() + status.slice(1))

  const higherThanMe = (role: Role) => (myRole ? roleRank(role) < roleRank(myRole) : false)

  useEffect(() => {
    ;(async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        const user = sessionData.session?.user
        setMyEmail(user?.email ?? null)
        setMyName((user?.user_metadata?.name as string) || (user?.email ? user.email.split('@')[0] : '') || null)
        if (sessionData.session?.access_token) {
          try {
            await supabase.rpc('sync_invites_for_me')
          } catch {
            // best-effort only
          }
        }
      } catch {
        // non-fatal bootstrap
      }
    })()
  }, [])

  useEffect(() => {
    if (!companyId) {
      setMembers([])
      setLoading(false)
      return
    }
    void refreshMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function refreshMembers() {
    if (!companyId) return
    try {
      setLoading(true)
      const data = await authFetch<{ users?: Member[] }>(`admin-users/?company_id=${encodeURIComponent(companyId)}`, {
        method: 'GET',
      })
      setMembers((data?.users || []) as Member[])
    } catch (e: any) {
      console.error(e)
      const message = extractFnErr(e)
      toast.error(message || tt('users.toast.loadFailed', 'Failed to load members'))
    } finally {
      setLoading(false)
    }
  }

  async function callMailerInvite(options: {
    company_id: string
    company_name?: string
    invite_link: string
    email: string
    role: Role
    inviter_name?: string | null
    inviter_email?: string | null
    mode: 'email' | 'link'
  }): Promise<{ ok: boolean; link?: string }> {
    try {
      const { data, error } = await supabase.functions.invoke('mailer-invite', {
        body: options,
      })
      if (error) {
        const message = extractFnErr(error)
        console.error('mailer-invite 4xx/5xx:', { message, raw: error })
        toast.error(tt('users.toast.inviteFailed', 'Invite failed: {message}', { message }))
        return { ok: false }
      }
      if (data?.warning) toast(tt('users.toast.inviteWarning', 'Invite created with warning: {warning}', { warning: data.warning }))
      return { ok: true, link: data?.link }
    } catch (e: any) {
      console.error('mailer-invite threw:', e)
      toast.error(e?.message || tt('users.toast.inviteFailedNetwork', 'Invite failed (network)'))
      return { ok: false }
    }
  }

  async function invite() {
    if (!companyId) return
    if (!canManageUsers) return toast.error(t('users.noPermissionToInvite'))
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error(t('users.emailRequired'))
    if (!canInviteRole(myRole as import('../lib/roles').CompanyRole, inviteRole)) {
      return toast.error(t('users.cannotInviteRole'))
    }

    try {
      setSendingInvite(true)
      const { data: token, error } = await supabase.rpc('invite_company_member', {
        p_company: companyId,
        p_email: email,
        p_role: inviteRole,
      })
      if (error) throw error

      const link = `${window.location.origin}/accept-invite?token=${token}`
      const result = await callMailerInvite({
        company_id: companyId,
        company_name: companyName || 'StockWise',
        invite_link: link,
        email,
        role: inviteRole,
        inviter_name: myName,
        inviter_email: myEmail,
        mode: 'email',
      })

      if (!result.ok) {
        try {
          await navigator.clipboard.writeText(link)
          toast.error(t('users.emailSendFailed'))
        } catch {
          toast.error(t('users.couldNotCopyLink'))
        }
      } else {
        toast.success(t('users.inviteSent', { email }))
      }

      setInviteEmail('')
      setInviteRole('VIEWER')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('users.toast.inviteCreateFailed', 'Failed to invite'))
    } finally {
      setSendingInvite(false)
    }
  }

  async function copyInviteLink() {
    if (!companyId) return
    if (!canManageUsers) return toast.error(tt('users.noPermissionToInvite', 'You do not have permission to invite users.'))
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error(tt('users.toast.enterEmailFirst', 'Enter an email first (the link is tied to that email)'))
    if (!canInviteAdmins && (inviteRole === 'OWNER' || inviteRole === 'ADMIN')) {
      return toast.error(tt('users.cannotAssignOwnerAdmin', 'You cannot invite owners/admins.'))
    }
    try {
      const { data: token, error } = await supabase.rpc('reinvite_company_member', {
        p_company: companyId,
        p_email: email,
      })
      if (error) throw error
      const link = `${window.location.origin}/accept-invite?token=${token}`
      await navigator.clipboard.writeText(link)
      toast.success(tt('users.toast.linkCopied', 'Invite link copied'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('users.toast.linkGenerateFailed', 'Could not generate link'))
    }
  }

  async function reinvite(email: string) {
    if (!email) return toast.error(tt('users.noEmailRecord', 'No email on record for this member.'))
    if (!companyId) return
    if (!canManageUsers) return toast.error(tt('users.toast.noPermissionReinvite', 'You do not have permission to reinvite.'))
    try {
      const { data: token, error } = await supabase.rpc('reinvite_company_member', {
        p_company: companyId,
        p_email: email,
      })
      if (error) throw error

      const link = `${window.location.origin}/accept-invite?token=${token}`
      const result = await callMailerInvite({
        company_id: companyId,
        company_name: companyName || 'StockWise',
        invite_link: link,
        email,
        role: 'VIEWER',
        inviter_name: myName,
        inviter_email: myEmail,
        mode: 'email',
      })

      if (!result.ok) {
        try {
          await navigator.clipboard.writeText(link)
          toast.error(tt('users.emailSendFailed', 'Email send failed; invite link copied to clipboard.'))
        } catch {
          toast.error(tt('users.couldNotCopyLink', 'Email send failed; could not copy link.'))
        }
      } else {
        toast.success(tt('users.toast.reinviteSent', 'Invite re-sent to {email}.', { email }))
      }
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('users.toast.reinviteFailed', 'Failed to reinvite'))
    }
  }

  async function updateMember(email: string, next: Partial<Pick<Member, 'role' | 'status'>>, currentRowRole: Role) {
    if (!email) return toast.error(t('users.noEmailRecord'))
    if (!companyId) return
    if (!canManageUsers) return toast.error(t('users.noPermissionToUpdate'))
    if (higherThanMe(currentRowRole)) {
      return toast.error(t('users.cannotModifyHigherRole'))
    }
    if (next.role && !canAssignRole(myRole as import('../lib/roles').CompanyRole, next.role)) {
      return toast.error(t('users.cannotAssignRole'))
    }
    if (!canInviteAdmins && (next.role === 'OWNER' || next.role === 'ADMIN')) {
      return toast.error(t('users.cannotAssignOwnerAdmin'))
    }

    try {
      await authFetch('admin-users/member', {
        method: 'PATCH',
        body: {
          company_id: companyId,
          email,
          ...next,
        },
      })
      toast.success(t('users.memberUpdated'))
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      const message = extractFnErr(e)
      toast.error(message || t('users.failedToUpdateMember'))
    }
  }

  async function removeMember(email: string, targetRole: Role) {
    if (!email) return toast.error(tt('users.noEmailRecord', 'No email on record for this member.'))
    if (!companyId) return
    if (!canManageUsers) return toast.error('You do not have permission to remove members.')
    if (myEmail && email.toLowerCase() === myEmail.toLowerCase()) {
      return toast.error(tt('users.cannotRemoveSelf', 'You cannot remove yourself'))
    }
    if (higherThanMe(targetRole)) {
      return toast.error('You cannot remove a member with a higher role than yours.')
    }

    try {
      await authFetch('admin-users/member', {
        method: 'DELETE',
        body: {
          company_id: companyId,
          email,
        },
      })
      toast.success(tt('users.toast.memberRemoved', 'Member removed'))
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      const message = extractFnErr(e)
      toast.error(message || tt('users.toast.memberRemoveFailed', 'Failed to remove member'))
    }
  }

  const roleOptions: Role[] = (['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'] as Role[]).filter((role) =>
    canInviteRole(myRole as import('../lib/roles').CompanyRole, role)
  )

  const sortedMembers = useMemo(
    () =>
      [...members].sort((left, right) => {
        const roleSort = roleRank(left.role) - roleRank(right.role)
        if (roleSort !== 0) return roleSort
        if (left.status !== right.status) return left.status.localeCompare(right.status)
        return (left.email || '').localeCompare(right.email || '')
      }),
    [members]
  )

  const filteredMembers = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase()
    return sortedMembers.filter((member) => {
      const matchesStatus = statusFilter === 'all' ? true : member.status === statusFilter
      const matchesSearch = needle
        ? [member.email || '', member.role, member.status].join(' ').toLowerCase().includes(needle)
        : true
      return matchesStatus && matchesSearch
    })
  }, [searchTerm, sortedMembers, statusFilter])

  const memberStats = useMemo(() => {
    const active = members.filter((member) => member.status === 'active').length
    const invited = members.filter((member) => member.status === 'invited').length
    const disabled = members.filter((member) => member.status === 'disabled').length
    return { total: members.length, active, invited, disabled }
  }, [members])

  if (!canAccessUsersPage) {
    return <div className="text-sm text-muted-foreground">{t('users.noPermission')}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('sections.users.title')}</h1>
          <p className="text-muted-foreground">
            {tt('users.subtitle', 'Invite teammates, track pending access, and manage company roles from one page.')}
          </p>
        </div>
        {companyId ? (
          <div className="text-sm text-muted-foreground">
            {t('users.company')}: {companyName || companyId}
            {myRole ? ` - ${t('users.yourRole')}: ${myRole}` : ''}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('users.summary.members', 'Members')}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-semibold">{memberStats.total}</div>
              <div className="text-xs text-muted-foreground">{tt('users.summary.membersHelp', 'Active and invited company records')}</div>
            </div>
            <UsersIcon className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('users.summary.active', 'Active')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{memberStats.active}</div>
            <div className="text-xs text-muted-foreground">{tt('users.summary.activeHelp', 'Members currently able to access the company')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('users.summary.invited', 'Invited')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{memberStats.invited}</div>
            <div className="text-xs text-muted-foreground">{tt('users.summary.invitedHelp', 'Pending acceptances you may need to follow up')}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('users.summary.disabled', 'Disabled')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{memberStats.disabled}</div>
            <div className="text-xs text-muted-foreground">{tt('users.summary.disabledHelp', 'Historical users kept without active access')}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {tt('users.inviteTitle', 'Invite teammate')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!companyId ? (
            <p className="text-muted-foreground">{t('users.noCompany')}</p>
          ) : (
            <div className="space-y-4">
              <p className="max-w-3xl text-sm text-muted-foreground">
                {tt(
                  'users.inviteHelp',
                  'Invite records stay visible until the teammate accepts, which makes it easier to resend links or adjust access without losing the trail.'
                )}
              </p>
              <div className="grid max-w-4xl gap-3 sm:grid-cols-3 sm:items-end">
                <div>
                  <Label>{t('users.email')}</Label>
                  <Input
                    placeholder={tt('users.placeholder.email', 'name@example.com')}
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label>{t('users.role')}</Label>
                  <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as Role)} disabled={!canManageUsers}>
                    <SelectTrigger>
                      <SelectValue placeholder={tt('users.placeholder.role', 'Select role')} />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((role) => (
                        <SelectItem
                          key={role}
                          value={role}
                          disabled={!canInviteAdmins && (role === 'OWNER' || role === 'ADMIN')}
                        >
                          {role}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button onClick={invite} disabled={!canManageUsers || sendingInvite}>
                    {sendingInvite ? t('loading') : t('users.inviteAndEmail')}
                  </Button>
                  <Button variant="outline" onClick={copyInviteLink} disabled={!canManageUsers}>
                    {t('users.copyInviteLink')}
                  </Button>
                  <Button variant="outline" onClick={() => { setInviteEmail(''); setInviteRole('VIEWER') }}>
                    {t('common.clear')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('users.members')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={tt('users.searchPlaceholder', 'Search members by email, role, or status')}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | Status)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tt('users.filters.allStatuses', 'All statuses')}</SelectItem>
                <SelectItem value="active">{tt('users.summary.active', 'Active')}</SelectItem>
                <SelectItem value="invited">{tt('users.summary.invited', 'Invited')}</SelectItem>
                <SelectItem value="disabled">{tt('users.summary.disabled', 'Disabled')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <p className="text-muted-foreground">{t('loading')}</p>
          ) : filteredMembers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
              <div className="text-lg font-medium">
                {searchTerm || statusFilter !== 'all'
                  ? tt('users.empty.filteredTitle', 'No members match the current filters.')
                  : tt('users.empty.title', 'No members yet.')}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {searchTerm || statusFilter !== 'all'
                  ? tt('users.empty.filteredBody', 'Clear the filters or search for a different email.')
                  : tt('users.empty.body', 'Invite the first teammate to start managing company access from here.')}
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[1040px] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">{t('users.role')}</th>
                  <th className="py-2 pr-2">{tt('users.status', 'Status')}</th>
                  <th className="py-2 pr-2">{t('users.table.confirmed')}</th>
                  <th className="py-2 pr-2">{t('users.table.lastSignin')}</th>
                  <th className="py-2 pr-2 text-right">{t('users.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => {
                  const isSelf = !!myEmail && !!member.email && member.email.toLowerCase() === myEmail.toLowerCase()
                  const isHigher = higherThanMe(member.role)
                  const removeDisabled = !canManageUsers || isSelf || isHigher
                  const removeTitle = !canManageUsers
                    ? tt('common.noPermission', 'No permission')
                    : isSelf
                      ? t('users.cannotRemoveSelf')
                      : isHigher
                        ? t('users.cannotRemoveHigherRole')
                        : t('users.removeMember')

                  return (
                    <tr key={member.user_id || member.email || `${member.role}-${member.status}-${member.created_at}`} className="border-b">
                      <td className="py-3 pr-2">
                        <div className="flex flex-col gap-1">
                          <span className="font-medium">{member.email || t('common.dash')}</span>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {member.user_id ? <span>{tt('users.linkedAccount', 'Linked account')}</span> : <span>{tt('users.inviteOnly', 'Invite only')}</span>}
                            {isSelf ? <span>{tt('users.thisIsYou', 'This is you')}</span> : null}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <Select
                          value={member.role}
                          onValueChange={(value) => member.email && updateMember(member.email, { role: value as Role }, member.role)}
                          disabled={!canManageUsers || isHigher || !member.email}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roleOptions.map((role) => (
                              <SelectItem
                                key={role}
                                value={role}
                                disabled={!canAssignRole(myRole as import('../lib/roles').CompanyRole, role) || isHigher}
                              >
                            {roleLabel(role)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="space-y-2">
                          <Badge
                            variant={member.status === 'active' ? 'default' : member.status === 'invited' ? 'secondary' : 'outline'}
                            className={member.status === 'disabled' ? 'border-destructive/30 text-destructive' : ''}
                          >
                            {statusLabel(member.status)}
                          </Badge>
                          <Select
                            value={member.status}
                            onValueChange={(value) => member.email && updateMember(member.email, { status: value as Status }, member.role)}
                            disabled={!canManageUsers || isHigher || !member.email}
                          >
                            <SelectTrigger className="w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(['invited', 'active', 'disabled'] as Status[]).map((status) => (
                                <SelectItem key={status} value={status}>
                                  {statusLabel(status)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        {member.email_confirmed_at ? new Date(member.email_confirmed_at).toLocaleString() : t('common.dash')}
                      </td>
                      <td className="py-2 pr-2">
                        {member.last_sign_in_at ? new Date(member.last_sign_in_at).toLocaleString() : t('common.dash')}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex gap-2">
                            {member.status === 'invited' && member.email ? (
                              <>
                                <Button
                                  variant="outline"
                                  onClick={() => reinvite(member.email!)}
                                  disabled={!canManageUsers || isHigher}
                                  title={isHigher ? t('users.higherRole') : t('users.resendEmail')}
                                >
                                  {t('users.resendEmail')}
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={async () => {
                                    if (!canManageUsers || isHigher || !member.email) return
                                    try {
                                      const { data: token, error } = await supabase.rpc('reinvite_company_member', {
                                        p_company: companyId!,
                                        p_email: member.email,
                                      })
                                      if (error) throw error
                                      const link = `${window.location.origin}/accept-invite?token=${token}`
                                      await navigator.clipboard.writeText(link)
                                      toast.success(t('users.copyInviteLink'))
                                    } catch (e: any) {
                                      toast.error(e?.message || t('users.couldNotCopyLink'))
                                    }
                                  }}
                                  disabled={!canManageUsers || isHigher || !member.email}
                                  title={isHigher ? t('users.higherRole') : t('users.copyInviteLink')}
                                >
                                  {t('users.copyLink')}
                                </Button>
                              </>
                            ) : null}
                            <Button
                              variant="outline"
                              onClick={() => member.email && removeMember(member.email, member.role)}
                              disabled={removeDisabled || !member.email}
                              title={removeTitle}
                            >
                              {t('common.remove')}
                            </Button>
                          </div>
                          {isHigher ? (
                            <Button
                              variant="secondary"
                              disabled
                              className="h-7 cursor-not-allowed px-2 text-xs opacity-60"
                            >
                              {t('users.higherRole')}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
