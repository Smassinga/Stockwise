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

const apiBase = import.meta.env.VITE_SUPABASE_URL as string
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

async function authFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  return fetch(`${apiBase}/functions/v1/admin-users${path}`, {
    method: init?.method ?? 'GET',
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  })
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

  // Load my company + my email
  useEffect(() => {
    (async () => {
      try {
        setLoading(true)
        const session = await supabase.auth.getSession()
        setMyEmail(session.data.session?.user?.email ?? null)

        // optional: sync invitations to this user
        await authFetch('/sync', { method: 'POST' }).catch(() => {})

        const { data, error } = await supabase
          .from('companies')
          .select('id,name')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (error) throw error
        if (!data) {
          setCompany(null)
          setMembers([])
          toast.error('No company found for this user.')
          return
        }
        setCompany(data)
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load company')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Load members when company available
  useEffect(() => {
    if (!company) return
    refreshMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.id])

  async function refreshMembers() {
    if (!company) return
    try {
      setLoading(true)
      const res = await authFetch(`/?company_id=${encodeURIComponent(company.id)}`, { method: 'GET' })
      const text = await res.text()
      if (!res.ok) {
        try {
          const j = JSON.parse(text || '{}')
          throw new Error(j.error || j.message || text || 'list failed')
        } catch {
          throw new Error(text || 'list failed')
        }
      }
      const json = JSON.parse(text || '{}')
      setMembers(json.users ?? [])
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }

  async function invite() {
    if (!company) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return toast.error('Email is required')
    try {
      const res = await authFetch(`/invite`, {
        method: 'POST',
        body: JSON.stringify({ company_id: company.id, email, role: inviteRole }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || (json && json.error)) {
        throw new Error(json?.error || json?.message || 'Invite failed')
      }
      toast.success(json?.warning === 'invite_email_failed'
        ? 'Added as invited (email failed to send)'
        : 'Invite sent')
      setInviteEmail('')
      setInviteRole('VIEWER')
      await refreshMembers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to invite')
    }
  }

  async function reinvite(email: string) {
    if (!company) return
    try {
      const res = await authFetch(`/reinvite`, {
        method: 'POST',
        body: JSON.stringify({ company_id: company.id, email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) throw new Error(json?.error || 'Reinvite failed')
      toast.success('Invite email resent')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to reinvite')
    }
  }

  async function updateMember(email: string, next: Partial<Pick<Member, 'role' | 'status'>>) {
    if (!company) return
    try {
      const res = await authFetch(`/member`, {
        method: 'PATCH',
        body: JSON.stringify({ company_id: company.id, email, ...next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) throw new Error(json?.error || 'Update failed')
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
      const res = await authFetch(`/member`, {
        method: 'DELETE',
        body: JSON.stringify({ company_id: company.id, email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.error) throw new Error(json?.error || 'Remove failed')
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
        {company && <div className="text-sm text-muted-foreground">Company: {company.name || company.id}</div>}
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button onClick={invite}>Invite</Button>
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
                      <td className="py-2 pr-2 text-right flex gap-2 justify-end">
                        {m.status === 'invited' && (
                          <Button variant="outline" onClick={() => reinvite(m.email)}>Resend invite</Button>
                        )}
                        <Button
                          variant="outline"
                          onClick={() => removeMember(m.email)}
                          disabled={!!isSelf}
                          title={isSelf ? 'You cannot remove yourself' : 'Remove member'}
                        >
                          Remove
                        </Button>
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
