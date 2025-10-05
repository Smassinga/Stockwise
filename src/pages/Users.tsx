// src/pages/Users.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import toast from 'react-hot-toast'
import { useOrg } from '../hooks/useOrg'

type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'
type Status = 'invited' | 'active' | 'disabled'

type Member = {
  email: string
  user_id: string | null
  role: Role
  status: Status
  invited_by?: string | null
  created_at?: string | null
  last_sign_in_at?: string | null
  email_confirmed_at?: string | null
}

// rank helpers
const roleRank = (r: Role) => ({ OWNER: 0, ADMIN: 1, MANAGER: 2, OPERATOR: 3, VIEWER: 4 }[r] ?? 99)

// Pull any helpful text out of the Edge Function error
function extractFnErr(err: any): string {
  const ctx = err?.context
  if (!ctx) return err?.message || 'Unknown error'
  if (ctx.body) {
    try {
      const obj = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body
      return obj?.error || obj?.message || (typeof ctx.body === 'string' ? ctx.body : err?.message)
    } catch {
      return typeof ctx.body === 'string' ? ctx.body : (err?.message || 'Unknown error')
    }
  }
  return err?.message || 'Unknown error'
}

export default function Users() {
  const { companyId, companyName, myRole } = useOrg()

  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('VIEWER')
  const [sendingInvite, setSendingInvite] = useState(false)

  // current user identity
  const [myEmail, setMyEmail] = useState<string | null>(null)
  const [myName, setMyName] = useState<string | null>(null)

  // derived perms (computed locally from myRole)
  const canManageUsers = !!myRole && (myRole === 'OWNER' || myRole === 'ADMIN' || myRole === 'MANAGER')
  const canInviteAdmins = !!myRole && (myRole === 'OWNER' || myRole === 'ADMIN')
  const higherThanMe = (r: Role) => (myRole ? roleRank(r) < roleRank(myRole) : false)

  // Resolve session (email, id, display name), sync invites once
  useEffect(() => {
    (async () => {
      try {
        const { data: sessionData, error: sessErr } = await supabase.auth.getSession()
        if (sessErr) throw sessErr
        const u = sessionData.session?.user
        setMyEmail(u?.email ?? null)
        setMyName(
          (u?.user_metadata?.name as string) ||
          (u?.email ? u.email.split('@')[0] : '') ||
          null
        )
        // Best-effort: link any pending invites for this account
        await supabase.rpc('sync_invites_for_me')
      } catch {
        // non-fatal
      }
    })()
  }, [])

  // Load members whenever active company changes (and only then)
  useEffect(() => {
    if (!companyId) {
      setMembers([])
      setLoading(false)
      return
    }
    refreshMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function refreshMembers() {
    if (!companyId) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('company_members_with_auth')
        .select('email, user_id, role, status, invited_by, created_at, email_confirmed_at, last_sign_in_at')
        .eq('company_id', companyId)
        .order('role', { ascending: true })

      if (error) throw error
      setMembers((data || []) as Member[])
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }

  async function callMailerInvite(opts: {
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
        body: opts,
      })
      if (error) {
        const msg = extractFnErr(error)
        console.error('mailer-invite 4xx/5xx:', { message: msg, raw: error })
        toast.error(`Invite failed: ${msg}`)
        return { ok: false }
      }
      if (data?.warning) {
        toast(`Invite created with warning: ${data.warning}`)
      }
      return { ok: true, link: data?.link }
    } catch (e: any) {
      console.error('mailer-invite threw:', e)
      toast.error(e?.message || 'Invite failed (network)')
      return { ok: false }
    }
  }

  async function invite() {
    if (!companyId) return
    if (!canManageUsers) return toast.error('You do not have permission to invite users.')
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error('Email is required')
    if (!canInviteAdmins && (inviteRole === 'OWNER' || inviteRole === 'ADMIN')) {
      return toast.error('You cannot invite owners/admins.')
    }

    try {
      setSendingInvite(true)

      // 1) create invite token (RPC) — note: p_company (not p_company_id)
      const { data: token, error } = await supabase.rpc('invite_company_member', {
        p_company: companyId,
        p_email: email,
        p_role: inviteRole,
      })
      if (error) throw error

      const link = `${window.location.origin}/accept-invite?token=${token}`

      // 2) ask Edge Function to send email
      const res = await callMailerInvite({
        company_id: companyId,
        company_name: companyName || 'StockWise',
        invite_link: link,
        email,
        role: inviteRole,
        inviter_name: myName,
        inviter_email: myEmail,
        mode: 'email',
      })

      if (!res.ok) {
        try {
          await navigator.clipboard.writeText(link)
          toast.error('Email send failed; invite link copied to clipboard.')
        } catch {
          toast.error('Email send failed; could not copy link.')
        }
      } else {
        toast.success(`Invite sent to ${email}.`)
      }

      setInviteEmail('')
      setInviteRole('VIEWER')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to invite')
    } finally {
      setSendingInvite(false)
    }
  }

  async function copyInviteLink() {
    if (!companyId) return
    if (!canManageUsers) return toast.error('You do not have permission to invite users.')
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error('Enter an email first (the link is tied to that email)')
    if (!canInviteAdmins && (inviteRole === 'OWNER' || inviteRole === 'ADMIN')) {
      return toast.error('You cannot invite owners/admins.')
    }
    try {
      const { data: token, error } = await supabase.rpc('reinvite_company_member', {
        p_company: companyId,
        p_email: email,
      })
      if (error) throw error
      const link = `${window.location.origin}/accept-invite?token=${token}`
      await navigator.clipboard.writeText(link)
      toast.success('Invite link copied')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Could not generate link')
    }
  }

  async function reinvite(email: string) {
    if (!companyId) return
    if (!canManageUsers) return toast.error('You do not have permission to reinvite.')
    try {
      const { data: token, error } = await supabase.rpc('reinvite_company_member', {
        p_company: companyId,
        p_email: email,
      })
      if (error) throw error

      const link = `${window.location.origin}/accept-invite?token=${token}`

      const res = await callMailerInvite({
        company_id: companyId,
        company_name: companyName || 'StockWise',
        invite_link: link,
        email,
        role: 'VIEWER',
        inviter_name: myName,
        inviter_email: myEmail,
        mode: 'email',
      })

      if (!res.ok) {
        try {
          await navigator.clipboard.writeText(link)
          toast.error('Email send failed; invite link copied to clipboard.')
        } catch {
          toast.error('Email send failed; could not copy link.')
        }
      } else {
        toast.success(`Invite re-sent to ${email}.`)
      }
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to reinvite')
    }
  }

  async function updateMember(email: string, next: Partial<Pick<Member, 'role' | 'status'>>, currentRowRole: Role) {
    if (!companyId) return
    if (!canManageUsers) return toast.error('You do not have permission to update members.')

    // Block changes to users with higher role than me
    if (higherThanMe(currentRowRole)) {
      return toast.error('You cannot modify a member with a higher role than yours.')
    }

    // Additional guard: block assigning OWNER/ADMIN if you aren’t allowed
    if (!canInviteAdmins && (next.role === 'OWNER' || next.role === 'ADMIN')) {
      return toast.error('You cannot assign owners/admins.')
    }

    try {
      const { error } = await supabase
        .from('company_members')
        .update(next)
        .eq('company_id', companyId)
        .eq('email', email)
      if (error) throw error
      toast.success('Member updated')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update member')
    }
  }

  async function removeMember(email: string, targetRole: Role) {
    if (!companyId) return
    if (!canManageUsers) return toast.error('You do not have permission to remove members.')
    if (myEmail && email.toLowerCase() === myEmail.toLowerCase()) {
      return toast.error('You cannot remove yourself')
    }
    // Prevent removing higher roles
    if (higherThanMe(targetRole)) {
      return toast.error('You cannot remove a member with a higher role than yours.')
    }

    try {
      const { error } = await supabase
        .from('company_members')
        .delete()
        .eq('company_id', companyId)
        .eq('email', email)
      if (error) throw error
      toast.success('Member removed')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to remove member')
    }
  }

  const roleOptions: Role[] = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER']

  const sorted = useMemo(
    () =>
      [...members].sort((a, b) => {
        const s = roleRank(a.role) - roleRank(b.role)
        if (s !== 0) return s
        if (a.status !== b.status) return a.status.localeCompare(b.status)
        return (a.email || '').localeCompare(b.email || '')
      }),
    [members]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Users</h1>
        {companyId && (
          <div className="text-sm text-muted-foreground">
            Company: {companyName || companyId}
            {myRole ? ` — Your role: ${myRole}` : ''}
          </div>
        )}
      </div>

      {/* Invite */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Invite a user</CardTitle>
        </CardHeader>
        <CardContent>
          {!companyId ? (
            <p className="text-muted-foreground">No company available.</p>
          ) : (
            <div className="grid sm:grid-cols-3 gap-3 items-end max-w-3xl">
              <div>
                <Label>Email</Label>
                <Input
                  placeholder="name@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div>
                <Label>Role</Label>
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as Role)}
                  disabled={!canManageUsers}
                >
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map(r => (
                      <SelectItem
                        key={r}
                        value={r}
                        disabled={!canInviteAdmins && (r === 'OWNER' || r === 'ADMIN')}
                      >
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={invite} disabled={!canManageUsers || sendingInvite}>
                  {sendingInvite ? 'Sending…' : 'Invite & email'}
                </Button>
                <Button variant="outline" onClick={copyInviteLink} disabled={!canManageUsers}>
                  Copy invite link
                </Button>
                <Button variant="outline" onClick={() => { setInviteEmail(''); setInviteRole('VIEWER') }}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : sorted.length === 0 ? (
            <p className="text-muted-foreground">No members yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">Email</th>
                  <th className="py-2 pr-2">Role</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Confirmed</th>
                  <th className="py-2 pr-2">Last Sign-in</th>
                  <th className="py-2 pr-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const isSelf = myEmail && m.email.toLowerCase() === myEmail.toLowerCase()
                  const isHigher = higherThanMe(m.role)
                  const removeDisabled = !canManageUsers || !!isSelf || isHigher
                  const removeTitle = !canManageUsers
                    ? 'No permission'
                    : isSelf
                      ? 'You cannot remove yourself'
                      : isHigher
                        ? 'You cannot remove a higher role'
                        : 'Remove member'

                  return (
                    <tr key={m.email} className="border-b">
                      <td className="py-2 pr-2">{m.email}</td>
                      <td className="py-2 pr-2">
                        <Select
                          value={m.role}
                          onValueChange={(v) => updateMember(m.email, { role: v as Role }, m.role)}
                          disabled={!canManageUsers || isHigher}
                        >
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {roleOptions.map(r => (
                              <SelectItem
                                key={r}
                                value={r}
                                disabled={
                                  (!canInviteAdmins && (r === 'OWNER' || r === 'ADMIN')) ||
                                  isHigher // cannot change higher role rows at all
                                }
                              >
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pr-2">
                        <Select
                          value={m.status}
                          onValueChange={(v) => updateMember(m.email, { status: v as Status }, m.role)}
                          disabled={!canManageUsers || isHigher}
                        >
                          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(['invited','active','disabled'] as Status[]).map(s => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pr-2">
                        {m.email_confirmed_at ? new Date(m.email_confirmed_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 pr-2">
                        {m.last_sign_in_at ? new Date(m.last_sign_in_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex gap-2">
                            {m.status === 'invited' && (
                              <>
                                <Button
                                  variant="outline"
                                  onClick={() => reinvite(m.email)}
                                  disabled={!canManageUsers || isHigher}
                                  title={isHigher ? 'Higher role' : 'Resend invite email'}
                                >
                                  Resend email
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={async () => {
                                    if (!canManageUsers || isHigher) return
                                    try {
                                      const { data: token, error } = await supabase.rpc('reinvite_company_member', {
                                        p_company: companyId!,
                                        p_email: m.email,
                                      })
                                      if (error) throw error
                                      const link = `${window.location.origin}/accept-invite?token=${token}`
                                      await navigator.clipboard.writeText(link)
                                      toast.success('Invite link copied')
                                    } catch (e: any) {
                                      toast.error(e?.message || 'Could not copy link')
                                    }
                                  }}
                                  disabled={!canManageUsers || isHigher}
                                  title={isHigher ? 'Higher role' : 'Copy invite link'}
                                >
                                  Copy link
                                </Button>
                              </>
                            )}
                            <Button
                              variant="outline"
                              onClick={() => removeMember(m.email, m.role)}
                              disabled={removeDisabled}
                              title={removeTitle}
                            >
                              Remove
                            </Button>
                          </div>

                          {/* Grey helper chip when blocked by higher role */}
                          {isHigher && (
                            <Button
                              variant="secondary"
                              disabled
                              className="opacity-60 cursor-not-allowed h-7 px-2 text-xs"
                            >
                              Higher role
                            </Button>
                          )}
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
