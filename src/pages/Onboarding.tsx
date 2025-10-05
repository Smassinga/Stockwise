// src/pages/Onboarding.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import toast from 'react-hot-toast'
import { Mail } from 'lucide-react'
import { useI18n } from '../lib/i18n'

/** LocalStorage key shared with /accept-invite and AuthCallback */
const LS_INVITE_KEY = 'sw:inviteToken'

/** Polls for a newly-created membership to become visible through RLS. */
async function waitForMembership(timeoutMs = 8000, stepMs = 400) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return null
    const { data } = await supabase
      .from('company_members')
      .select('company_id')
      .eq('user_id', uid)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (data?.company_id) return data.company_id
    await new Promise(r => setTimeout(r, stepMs))
  }
  return null
}

export default function Onboarding() {
  const { t } = useI18n()
  const nav = useNavigate()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        setLoading(true)
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) { nav('/auth', { replace: true }); return }

        // If email not confirmed, show verify-gate here.
        // Works for both classic email + SSO identity cases.
        const confirmed =
          // classic field
          (user as any)?.email_confirmed_at ||
          // some providers expose confirm on identity_data
          user?.identities?.some?.(i => (i as any)?.identity_data?.email_confirmed_at)

        if (!confirmed) {
          setUnverifiedEmail(user.email ?? 'your email')
          setLoading(false)
          return
        }

        // Best-effort: link pending invites to this user (ignore failures)
        try { await supabase.functions.invoke('admin-users/sync', { body: {} }) } catch {}

        // Optional: if user came via invite then verified, redeem cached token here too
        try {
          const token = localStorage.getItem(LS_INVITE_KEY)
          if (token) {
            await supabase.rpc('accept_invite_with_token', { p_token: token })
            localStorage.removeItem(LS_INVITE_KEY)
          }
        } catch (e) {
          console.warn('invite token redeem failed (onboarding):', (e as any)?.message || e)
        }

        // If already an active member, head to dashboard.
        const active = await supabase
          .from('company_members')
          .select('company_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (active.data?.company_id) { nav('/dashboard', { replace: true }); return }

        setLoading(false)
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || t('common.headsUp'))
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function resendVerification() {
    if (!unverifiedEmail) return
    try {
      setResending(true)
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: unverifiedEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) toast.error(error.message)
      else toast.success(t('auth.toast.resetSent'))
    } finally {
      setResending(false)
    }
  }

  async function createCompany() {
    const name = companyName.trim()
    if (!name) { toast.error('Please enter a company name'); return }

    try {
      setCreating(true)
      const { error } = await supabase.rpc('create_company_and_bootstrap', { p_name: name })
      if (error) { toast.error(error.message); return }

      // Refresh auth (some RLS paths rely on fresh claims)
      await supabase.auth.refreshSession()

      // Wait briefly for RLS to reflect membership then go.
      setLoading(true)
      const cid = await waitForMembership(8000, 400)
      if (!cid) console.warn('Membership not visible yet; navigating anyway.')
      nav('/dashboard', { replace: true })
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Could not create company')
      setLoading(false)
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground">
        {t('loading')}
      </div>
    )
  }

  // Verify-email screen for unverified accounts
  if (unverifiedEmail) {
    return (
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader><CardTitle>{t('onboarding.verifyTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('onboarding.verifyDesc', { email: unverifiedEmail })}
            </p>
            <div className="flex gap-2">
              <Button onClick={resendVerification} disabled={resending}>
                <Mail className="h-4 w-4 mr-2" />
                {resending ? t('actions.saving') : t('onboarding.resend')}
              </Button>
              <Button variant="secondary" onClick={() => location.assign('/auth')}>
                {t('onboarding.useDifferent')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding.already')}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Normal onboarding when verified & not yet in a company
  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader><CardTitle>{t('onboarding.createCompanyTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('onboarding.notInCompany')}
          </p>
          <div className="grid sm:grid-cols-3 items-end gap-3">
            <div className="sm:col-span-2">
              <Label htmlFor="companyName">{t('onboarding.companyName')}</Label>
              <Input
                id="companyName"
                placeholder="Acme Inc."
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={createCompany} disabled={creating}>
                {creating ? t('actions.saving') : t('onboarding.create')}
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
