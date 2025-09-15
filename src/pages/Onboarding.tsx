// src/pages/Onboarding.tsx
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

        // Ensure session
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) { nav('/auth', { replace: true }); return }

        const myEmail = (user.email || '').toLowerCase()

        // Best-effort: activate invites
        try { await supabase.functions.invoke('admin-users/sync', { body: {} }) } catch {}

        // Already a member?
        const active = await supabase
          .from('company_members')
          .select('company_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (active.data?.company_id) { nav('/dashboard', { replace: true }); return }

        // Invite row by email? Try to attach once more.
        const invited = await supabase
          .from('company_members')
          .select('company_id, status, user_id')
          .eq('email', myEmail)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (invited.data) {
          try { await supabase.functions.invoke('admin-users/sync', { body: {} }) } catch {}
          const recheck = await supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()
          if (recheck.data?.company_id) { nav('/dashboard', { replace: true }); return }
        }

        // Show create form
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
    if (!name) { toast.error('Please enter a company name'); return }

    try {
      setCreating(true)
      // Use the SECURITY DEFINER RPC so RLS never blocks this bootstrap
      const { error } = await supabase.rpc('create_company_and_bootstrap', { p_name: name })
      if (error) { toast.error(error.message); setCreating(false); return }

      toast.success('Company created')
      nav('/dashboard', { replace: true })
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Could not create company')
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
            <Button onClick={createCompany} disabled={creating}>
              {creating ? 'Creating…' : 'Create company'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            If you were invited by someone, you’ll be routed straight to their company after signing in.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
