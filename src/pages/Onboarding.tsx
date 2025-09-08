import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import toast from 'react-hot-toast'

export default function Onboarding() {
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    (async () => {
      try {
        setLoading(true)

        // ---- Ensure we have a session
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) {
          nav('/auth', { replace: true })
          return
        }

        const myEmail = (user.email || '').toLowerCase()

        // ---- 1) Best-effort: link + activate any invites (server-side)
        try {
          await supabase.functions.invoke('admin-users/sync', { body: {} })
        } catch {
          // ignore; purely best-effort
        }

        // ---- 2) Check for active membership by user_id (the happy path)
        const active = await supabase
          .from('company_members')
          .select('company_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (active.data?.company_id) {
          nav('/dashboard', { replace: true })
          return
        }

        // ---- 3) Fallback: do we at least have an invite row by my email?
        const invited = await supabase
          .from('company_members')
          .select('company_id, status, user_id')
          .eq('email', myEmail)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (invited.data) {
          // Try server-side sync once more to attach/activate
          try {
            await supabase.functions.invoke('admin-users/sync', { body: {} })
          } catch {}

          const recheck = await supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

          if (recheck.data?.company_id) {
            nav('/dashboard', { replace: true })
            return
          }
        }

        // ---- 4) No membership anywhere → show create-company UI
        setLoading(false)
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to check membership')
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createCompany() {
    const name = companyName.trim()
    if (!name) {
      toast.error('Please enter a company name')
      return
    }

    try {
      setCreating(true)
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) throw new Error('Not authenticated')

      // 1) Create company
      const { data: company, error: cErr } = await supabase
        .from('companies')
        .insert({ name })
        .select('id')
        .single()
      if (cErr) throw cErr

      // 2) Make current user OWNER + active
      const { error: mErr } = await supabase
        .from('company_members')
        .insert({
          company_id: company.id,
          user_id: user.id,
          email: user.email?.toLowerCase() ?? null,
          role: 'OWNER',
          status: 'active',
          invited_by: user.id,
        })
      if (mErr) throw mErr

      toast.success('Company created')
      nav('/dashboard', { replace: true })
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Could not create company')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground">
        Checking your membership…
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Create your company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Looks like you’re not part of a company yet. Create one to get started.
          </p>
          <div className="grid sm:grid-cols-3 items-end gap-3">
            <div className="sm:col-span-2">
              <Label htmlFor="companyName">Company name</Label>
              <Input
                id="companyName"
                placeholder="Acme Inc."
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={createCompany} disabled={creating}>
                {creating ? 'Creating…' : 'Create company'}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            If you were invited by someone, you’ll be routed straight to their company after signing in.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
