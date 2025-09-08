// src/pages/Users.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { authFetch } from '../lib/authFetch'
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

  // current user email (for self-protect on delete)
  const [myEmail, setMyEmail] = useState<string | null>(null)

  // ----- Resolve my company (prefer active membership) -----
  useEffect(() => {
    (async () => {
      try {
        setLoading(true)

        // Store my email for self-protection
        const { data: sessionData } = await supabase.auth.getSession()
        setMyEmail(sessionData.session?.user?.email ?? null)
        const myUserId = sessionData.session?.user?.id

        // Best-effort: link any pending invites to me (no-op if none)
        await authFetch('admin-users/sync', { method: 'POST' }).catch(() => {})

        let resolved: Company | null = null

        if (myUserId) {
          // 1) Prefer my *active* membership (invited users will have this after /sync)
          const { data: membership, error: memErr } = await supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', myUserId)
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
          // 2) Fallback: first company row (keeps old behavior for owners/empty membership)
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

  // ----- Load members when company is available -----
  useEffect(() => {
    if (!company) return
    refreshMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id])

  async function refreshMembers() {
    if (!company) return
    try {
      setLoading(true)
      interface UsersApiResponse {
        users: Member[]
        [key: string]: unknown
      }
      const json: UsersApiResponse = await authFetch(
        `admin-users/?company_id=${encodeURIComponent(company.id)}`,
        { method: 'GET' }
      )
      setMembers(json?.users ?? [])
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }

  // ----- Actions -----
  async function invite() {
    if (!company) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error('Email is required')
    try {
      const json = await authFetch('admin-users/invite', {
        method: 'POST',
        body: JSON.stringify({ company_id: company.id, email, role: inviteRole }),
      }) as any
      if (json?.error) throw new Error(json.error)
      toast.success(
        json?.warning === 'invite_email_failed'
          ? 'Added as invited (email failed to send)'
          : 'Invite sent'
      )
      setInviteEmail('')
      setInviteRole('VIEWER')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to invite')
    }
  }

  /** Generate a shareable invite link (works even if emails arrive late). */
  async function copyInviteLink() {
    if (!company) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error('Enter an email first (the link is tied to that email)')
    try {
      const json = await authFetch('admin-users/invite-link', {
        method: 'POST',
        body: JSON.stringify({ company_id: company.id, email, role: inviteRole }),
      }) as any
      if (json?.error) throw new Error(json.error)
      const link = json?.link as string | undefined
      if (!link) throw new Error('No link returned')
      await navigator.clipboard.writeText(link)
      toast.success('Invite link copied to clipboard')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Could not generate link')
    }
  }

  async function reinvite(email: string) {
    if (!company) return
    try {
      const json = await authFetch('admin-users/reinvite', {
        method: 'POST',
        body: JSON.stringify({ company_id: company.id, email }),
      }) as any
      if (json?.error) throw new Error(json.error)
      toast.success('Invite email resent')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to reinvite')
    }
  }

  async function updateMember(email: string, next: Partial<Pick<Member, 'role' | 'status'>>) {
    if (!company) return
    try {
      const json = await authFetch('admin-users/member', {
        method: 'PATCH',
        body: JSON.stringify({ company_id: company.id, email, ...next }),
      }) as any
      if (json?.error) throw new Error(json.error)
      toast.success('Member updated')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update member')
    }
  }

  async function removeMember(email: string) {
    if (!company) return
    if (myEmail && email.toLowerCase() === myEmail.toLowerCase()) {
      return toast.error('You cannot remove yourself')
    }
    try {
      const json = await authFetch('admin-users/member', {
        method: 'DELETE',
        body: JSON.stringify({ company_id: company.id, email }),
      }) as any
      if (json?.error) throw new Error(json.error)
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
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                  <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={invite}>Invite</Button>
                <Button variant="outline" onClick={copyInviteLink}>Copy invite link</Button>
                <Button
                  variant="outline"
                  onClick={() => { setInviteEmail(''); setInviteRole('VIEWER') }}
                >
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
                  return (
                    <tr key={m.email} className="border-b">
                      <td className="py-2 pr-2">{m.email}</td>
                      <td className="py-2 pr-2">
                        <Select value={m.role} onValueChange={(v) => updateMember(m.email, { role: v as Role })}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {roleOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="py-2 pr-2">
                        <Select value={m.status} onValueChange={(v) => updateMember(m.email, { status: v as Status })}>
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
                              <Button variant="outline" onClick={() => reinvite(m.email)}>Resend invite</Button>
                              {/* Convenience: regenerate + copy a link for this person */}
                              <Button
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const json = await authFetch('admin-users/invite-link', {
                                      method: 'POST',
                                      body: JSON.stringify({ company_id: company!.id, email: m.email, role: m.role }),
                                    }) as any
                                    const link = json?.link as string | undefined
                                    if (!link) throw new Error('No link returned')
                                    await navigator.clipboard.writeText(link)
                                    toast.success('Invite link copied')
                                  } catch (e: any) {
                                    toast.error(e?.message || 'Could not copy link')
                                  }
                                }}
                              >
                                Copy link
                              </Button>
                            </>
                          )}
                          <Button
                            variant="outline"
                            onClick={() => removeMember(m.email)}
                            disabled={!!isSelf}
                            title={isSelf ? 'You cannot remove yourself' : 'Remove member'}
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
