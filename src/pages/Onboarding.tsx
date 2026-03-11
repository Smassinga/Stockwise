import { Mail } from 'lucide-react'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { buildAuthCallbackUrl } from '../lib/authRedirect'
import { runAdminUserSyncIfNeeded } from '../lib/adminSync'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { withTimeout } from '../lib/withTimeout'

const LS_INVITE_KEY = 'sw:inviteToken'
const SESSION_LOOKUP_TIMEOUT_MS = 5000
const MEMBERSHIP_LOOKUP_TIMEOUT_MS = 6000
const BEST_EFFORT_SYNC_TIMEOUT_MS = 5000
const INVITE_REDEEM_TIMEOUT_MS = 6000
const CREATE_COMPANY_TIMEOUT_MS = 15000

async function waitForMembership(timeoutMs = 8000, stepMs = 400) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const {
      data: { session },
    } = await withTimeout(
      supabase.auth.getSession(),
      SESSION_LOOKUP_TIMEOUT_MS,
      'membership poll session lookup'
    )
    const userId = session?.user?.id
    if (!userId) return null

    const { data } = await withTimeout(
      supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      MEMBERSHIP_LOOKUP_TIMEOUT_MS,
      'membership poll'
    )

    if (data?.company_id) return data.company_id
    await new Promise((resolve) => setTimeout(resolve, stepMs))
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
  const [startupError, setStartupError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        setStartupError(null)

        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_LOOKUP_TIMEOUT_MS,
          'onboarding session lookup'
        )
        const user = session?.user
        if (!user) {
          nav('/login', { replace: true })
          return
        }

        const confirmed =
          (user as any)?.email_confirmed_at ||
          user?.identities?.some?.((identity) => (identity as any)?.identity_data?.email_confirmed_at)

        if (!confirmed) {
          setUnverifiedEmail(user.email ?? 'your email')
          setLoading(false)
          return
        }

        try {
          await withTimeout(
            runAdminUserSyncIfNeeded(user.id),
            BEST_EFFORT_SYNC_TIMEOUT_MS,
            'admin user sync'
          )
        } catch (e) {
          console.warn('admin user sync failed during onboarding:', e)
        }

        try {
          const token = localStorage.getItem(LS_INVITE_KEY)
          if (token) {
            await withTimeout(
              supabase.rpc('accept_invite_with_token', { p_token: token }),
              INVITE_REDEEM_TIMEOUT_MS,
              'invite redeem'
            )
            localStorage.removeItem(LS_INVITE_KEY)
          }
        } catch (e) {
          console.warn('invite token redeem failed (onboarding):', (e as any)?.message || e)
        }

        const active = await withTimeout(
          supabase
            .from('company_members')
            .select('company_id')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle(),
          MEMBERSHIP_LOOKUP_TIMEOUT_MS,
          'active membership lookup'
        )

        if (active.data?.company_id) {
          nav('/dashboard', { replace: true })
          return
        }

        setLoading(false)
      } catch (e: any) {
        console.error(e)
        const message = e?.message || t('common.headsUp')
        setStartupError(message)
        toast.error(message)
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
        options: { emailRedirectTo: buildAuthCallbackUrl() },
      })
      if (error) toast.error(error.message)
      else toast.success(t('auth.toast.resetSent'))
    } finally {
      setResending(false)
    }
  }

  async function createCompany() {
    const name = companyName.trim()
    if (!name) {
      toast.error('Please enter a company name')
      return
    }

    try {
      setCreating(true)
      const { error } = await withTimeout(
        supabase.rpc('create_company_and_bootstrap', { p_name: name }),
        CREATE_COMPANY_TIMEOUT_MS,
        'create company'
      )
      if (error) {
        toast.error(error.message)
        return
      }

      await withTimeout(
        supabase.auth.refreshSession(),
        SESSION_LOOKUP_TIMEOUT_MS,
        'refresh session'
      )

      setLoading(true)
      const companyId = await waitForMembership(8000, 400)
      if (!companyId) console.warn('Membership not visible yet; navigating anyway.')
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

  if (startupError) {
    return (
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Could not finish sign-in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{startupError}</p>
            <p className="text-sm text-muted-foreground">
              Authentication completed, but company membership data is temporarily unavailable.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => window.location.reload()}>Retry</Button>
              <Button variant="secondary" onClick={() => location.assign('/login')}>
                Back to sign-in
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (unverifiedEmail) {
    return (
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>{t('onboarding.verifyTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('onboarding.verifyDesc', { email: unverifiedEmail })}
            </p>
            <div className="flex gap-2">
              <Button onClick={resendVerification} disabled={resending}>
                <Mail className="h-4 w-4 mr-2" />
                {resending ? t('actions.saving') : t('onboarding.resend')}
              </Button>
              <Button variant="secondary" onClick={() => location.assign('/login')}>
                {t('onboarding.useDifferent')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('onboarding.already')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>{t('onboarding.createCompanyTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('onboarding.notInCompany')}</p>
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
            If you were invited by someone, you&apos;ll be routed straight to their company after signing in.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
