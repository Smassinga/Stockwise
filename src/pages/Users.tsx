// src/pages/Users.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import toast from 'react-hot-toast'

type Company = { id: string; name?: string | null }

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

export default function Users() {
  const [company, setCompany] = useState<Company | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('VIEWER')

  // current user identity
  const [myEmail, setMyEmail] = useState<string | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<Role | null>(null)

  // derived perms (computed locally from myRole)
  const canManageUsers = !!myRole && (myRole === 'OWNER' || myRole === 'ADMIN' || myRole === 'MANAGER')
  const canInviteAdmins = !!myRole && (myRole === 'OWNER' || myRole === 'ADMIN')

  // ----- Resolve session + run invite sync, then resolve company -----
  useEffect(() => {
    (async () => {
      try {
        setLoading(true)

        // Session
        const { data: sessionData, error: sessErr } = await supabase.auth.getSession()
        if (sessErr) throw sessErr
        const session = sessionData.session
        setMyEmail(session?.user?.email ?? null)
        setMyUserId(session?.user?.id ?? null)

        // Link any email-based invites to this account (no-op if none)
        {
          const { error: _syncErr } = await supabase.rpc('sync_invites_for_me')
          // swallow _syncErr; it's best-effort
        }

        // Resolve preferred company:
        // 1) my active membership, else 2) first company row
        let resolved: Company | null = null
        if (session?.user?.id) {
          const { data: membership, error: memErr } = await supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', session.user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          if (memErr) throw memErr
          if (membership?.company_id) {
            const { data: comp, error: compErr } = await supabase
              .from('companies')
              .select('id,name')
              .eq('id', membership.company_id)
              .maybeSingle()
            if (compErr) throw compErr
            if (comp) resolved = comp
          }
        }
        if (!resolved) {
          const { data: firstComp, error: firstErr } = await supabase
            .from('companies')
            .select('id,name')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          if (firstErr) throw firstErr
          if (!firstComp) {
            setCompany(null)
            setMembers([])
            toast.error('No company found for this account.')
            return
          }
          resolved = firstComp
        }
        setCompany(resolved)
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to resolve company')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ----- Load my role for this company (drives perms) -----
  useEffect(() => {
    if (!company?.id || !myUserId) return
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('company_members')
          .select('role')
          .eq('company_id', company.id)
          .eq('user_id', myUserId)
          .maybeSingle()
        if (error) throw error
        setMyRole((data?.role as Role | undefined) ?? null)
      } catch (e: any) {
        console.warn('could not resolve my role:', e?.message)
        setMyRole(null)
      }
    })()
  }, [company?.id, myUserId])

  // ----- Load members when company is available -----
  useEffect(() => {
    if (!company?.id) return
    refreshMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id])

  async function refreshMembers() {
    if (!company) return
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('company_members')
        .select('email, user_id, role, status, invited_by, created_at')
        .eq('company_id', company.id)
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

  // ----- Actions (all DB/RPC; RLS enforces) -----
  async function invite() {
    if (!company) return
    if (!canManageUsers) return toast.error('You do not have permission to invite users.')
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error('Email is required')
    if (!canInviteAdmins && (inviteRole === 'OWNER' || inviteRole === 'ADMIN')) {
      return toast.error('You cannot invite owners/admins.')
    }
    try {
      const { data: token, error } = await supabase.rpc('invite_company_member', {
        p_company: company.id,
        p_email: email,
        p_role: inviteRole,
      })
      if (error) throw error
      const link = `${window.location.origin}/accept-invite?token=${token}`
      await navigator.clipboard.writeText(link)
      toast.success('Invite created. Link copied to clipboard.')
      setInviteEmail('')
      setInviteRole('VIEWER')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to invite')
    }
  }

  async function copyInviteLink() {
    if (!company) return
    if (!canManageUsers) return toast.error('You do not have permission to invite users.')
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error('Enter an email first (the link is tied to that email)')
    if (!canInviteAdmins && (inviteRole === 'OWNER' || inviteRole === 'ADMIN')) {
      return toast.error('You cannot invite owners/admins.')
    }
    try {
      const { data: token, error } = await supabase.rpc('reinvite_company_member', {
        p_company: company.id,
        p_email: email,
      })
      if (error) throw error
      const link = `${window.location.origin}/accept-invite?token=${token}`
      await navigator.clipboard.writeText(link)
      toast.success('New invite link copied')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Could not generate link')
    }
  }

  async function reinvite(email: string) {
    if (!company) return
    if (!canManageUsers) return toast.error('You do not have permission to reinvite.')
    try {
      const { data: token, error } = await supabase.rpc('reinvite_company_member', {
        p_company: company.id,
        p_email: email,
      })
      if (error) throw error
      const link = `${window.location.origin}/accept-invite?token=${token}`
      await navigator.clipboard.writeText(link)
      toast.success('Invite link copied')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to reinvite')
    }
  }

  async function updateMember(email: string, next: Partial<Pick<Member, 'role' | 'status'>>) {
    if (!company) return
    if (!canManageUsers) return toast.error('You do not have permission to update members.')
    if (!canInviteAdmins && (next.role === 'OWNER' || next.role === 'ADMIN')) {
      return toast.error('You cannot assign owners/admins.')
    }
    try {
      const { error } = await supabase
        .from('company_members')
        .update(next)
        .eq('company_id', company.id)
        .eq('email', email)
      if (error) throw error
      toast.success('Member updated')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update member')
    }
  }

  async function removeMember(email: string) {
    if (!company) return
    if (!canManageUsers) return toast.error('You do not have permission to remove members.')
    if (myEmail && email.toLowerCase() === myEmail.toLowerCase()) {
      return toast.error('You cannot remove yourself')
    }
    try {
      const { error } = await supabase
        .from('company_members')
        .delete()
        .eq('company_id', company.id)
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
  const statusOptions: Status[] = ['invited', 'active', 'disabled']

  const sorted = useMemo(
    () =>
      [...members].sort((a, b) => {
        const roleRank = (r: Role) => ({ OWNER: 0, ADMIN: 1, MANAGER: 2, OPERATOR: 3, VIEWER: 4 }[r] ?? 99)
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
        {company && (
          <div className="text-sm text-muted-foreground">
            Company: {company.name || company.id}
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
          {!company ? (
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
                <Button onClick={invite} disabled={!canManageUsers}>Invite</Button>
                <Button variant="outline" onClick={copyInviteLink} disabled={!canManageUsers}>Copy invite link</Button>
                <Button variant="outline" onClick={() => { setInviteEmail(''); setInviteRole('VIEWER') }}>Clear</Button>
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
                  return (
                    <tr key={m.email} className="border-b">
                      <td className="py-2 pr-2">{m.email}</td>
                      <td className="py-2 pr-2">
                        <Select
                          value={m.role}
                          onValueChange={(v) => updateMember(m.email, { role: v as Role })}
                          disabled={!canManageUsers}
                        >
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
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
                      </td>
                      <td className="py-2 pr-2">
                        <Select
                          value={m.status}
                          onValueChange={(v) => updateMember(m.email, { status: v as Status })}
                          disabled={!canManageUsers}
                        >
                          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                        <div className="flex gap-2 justify-end">
                          {m.status === 'invited' && (
                            <>
                              <Button variant="outline" onClick={() => reinvite(m.email)} disabled={!canManageUsers}>Resend invite</Button>
                              <Button
                                variant="outline"
                                onClick={async () => {
                                  if (!canManageUsers) return
                                  try {
                                    const { data: token, error } = await supabase.rpc('reinvite_company_member', {
                                      p_company: company!.id,
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
                                disabled={!canManageUsers}
                              >
                                Copy link
                              </Button>
                            </>
                          )}
                          <Button
                            variant="outline"
                            onClick={() => removeMember(m.email)}
                            disabled={!canManageUsers || !!isSelf}
                            title={!canManageUsers ? 'No permission' : (isSelf ? 'You cannot remove yourself' : 'Remove member')}
                          >
                            Remove
                          </Button>
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
