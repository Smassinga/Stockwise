import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { runAdminUserSyncIfNeeded } from '../lib/adminSync'
import { readInviteToken } from '../lib/inviteToken'
import { supabase } from '../lib/supabase'
import { withTimeout } from '../lib/withTimeout'
const SESSION_LOOKUP_TIMEOUT_MS = 5000
const AUTH_FINISH_TIMEOUT_MS = 15000
const MEMBERSHIP_LOOKUP_TIMEOUT_MS = 6000
const BEST_EFFORT_SYNC_TIMEOUT_MS = 5000

function parseHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return {
    access_token: params.get('access_token') ?? undefined,
    refresh_token: params.get('refresh_token') ?? undefined,
    error_description: params.get('error_description') ?? undefined,
    error: params.get('error') ?? undefined,
  }
}

export default function AuthCallback() {
  const nav = useNavigate()
  const [msg, setMsg] = useState('Finishing sign-in...')
  const [showHomeBtn, setShowHomeBtn] = useState(false)

  useEffect(() => {
    const run = async () => {
      try {
        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_LOOKUP_TIMEOUT_MS,
          'auth callback session lookup'
        )

        if (session?.user) {
          if (readInviteToken()) {
            nav('/accept-invite', { replace: true })
            return
          }
          await routeByMembership(nav)
          return
        }

        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        const errQuery = url.searchParams.get('error_description') || url.searchParams.get('error')
        const { access_token, refresh_token, error_description: errHash, error: errHash2 } = parseHash()

        if (errQuery || errHash || errHash2) {
          setMsg(decodeURIComponent(errQuery || errHash || errHash2!))
          setShowHomeBtn(true)
          return
        }

        let authed = false
        if (code) {
          const { error } = await withTimeout(
            supabase.auth.exchangeCodeForSession(window.location.href),
            AUTH_FINISH_TIMEOUT_MS,
            'magic link exchange'
          )
          if (!error) authed = true
        }

        if (!authed && access_token && refresh_token) {
          const { error } = await withTimeout(
            supabase.auth.setSession({ access_token, refresh_token }),
            AUTH_FINISH_TIMEOUT_MS,
            'auth session restore'
          )
          if (!error) authed = true
        }

        if (!authed) {
          setMsg(
            'Could not complete sign-in. Open the link in the same browser/profile where you started, or resend the email and try again.'
          )
          setShowHomeBtn(true)
          return
        }

        try {
          const clean = `${window.location.origin}/auth/callback`
          window.history.replaceState({}, '', clean)
        } catch {}

        const syncedUserId = (await supabase.auth.getSession()).data.session?.user?.id
        if (syncedUserId) {
          try {
            await withTimeout(
              runAdminUserSyncIfNeeded(syncedUserId),
              BEST_EFFORT_SYNC_TIMEOUT_MS,
              'admin user sync'
            )
          } catch (e) {
            console.warn('admin user sync failed during auth callback:', e)
          }
        }

        if (readInviteToken()) {
          setMsg('Signed in. Redirecting to your invitation...')
          nav('/accept-invite', { replace: true })
          return
        }

        setMsg('Signed in. Redirecting...')
        await routeByMembership(nav)
      } catch (e: any) {
        setMsg(e?.message || 'Unexpected error while finishing sign-in')
        setShowHomeBtn(true)
      }
    }

    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="text-center text-sm text-muted-foreground">{msg}</div>
      {showHomeBtn && <Button onClick={() => location.assign('/login')}>Back to sign-in</Button>}
    </div>
  )
}

async function routeByMembership(nav: ReturnType<typeof useNavigate>) {
  const {
    data: { session },
  } = await withTimeout(
    supabase.auth.getSession(),
    SESSION_LOOKUP_TIMEOUT_MS,
    'membership session lookup'
  )
  const userId = session?.user?.id
  if (!userId) {
    nav('/login', { replace: true })
    return
  }

  try {
    const { data: membership } = await withTimeout(
      supabase
        .from('company_members')
        .select('company_id')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
      MEMBERSHIP_LOOKUP_TIMEOUT_MS,
      'membership lookup'
    )

    if (membership?.company_id) nav('/dashboard', { replace: true })
    else nav('/onboarding', { replace: true })
  } catch (e) {
    console.warn('membership lookup failed during auth callback:', e)
    nav('/onboarding', { replace: true })
  }
}
