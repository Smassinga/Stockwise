// src/pages/AuthCallback.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'

/** LocalStorage key used by /accept-invite to cache the pending token */
const LS_INVITE_KEY = 'sw:inviteToken'

/**
 * Support both PKCE magic-link (?code=...) and hash-style callbacks
 * (#access_token=...&refresh_token=...).
 */
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
  const [msg, setMsg] = useState('Finishing sign-in…')
  const [showHomeBtn, setShowHomeBtn] = useState(false)

  useEffect(() => {
    const run = async () => {
      try {
        // If a session already exists (e.g., user refreshed), route immediately.
        {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.user) {
            await maybeRedeemInviteToken()
            await routeByMembership(nav)
            return
          }
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

        // 1) PKCE / magic link first (?code=…)
        let authed = false
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href)
          if (!error) authed = true
        }

        // 2) Hash tokens fallback
        if (!authed && access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (!error) authed = true
        }

        // 3) Give up with a helpful message
        if (!authed) {
          setMsg(
            'Could not complete sign-in. Open the link in the SAME browser/profile where you started, or resend the email and try again.'
          )
          setShowHomeBtn(true)
          return
        }

        // Clean the URL (prevents refresh loops)
        try {
          const clean = `${window.location.origin}/auth/callback`
          window.history.replaceState({}, '', clean)
        } catch {}

        // Best-effort: link pending invites to this user (ignore failures)
        try { await supabase.functions.invoke('admin-users/sync', { body: {} }) } catch {}

        // If user arrived via /accept-invite then /auth, redeem the cached token now
        await maybeRedeemInviteToken()

        setMsg('Signed in. Redirecting…')
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
      {showHomeBtn && (
        <Button onClick={() => location.assign('/auth')}>Back to sign-in</Button>
      )}
    </div>
  )
}

/** Try to redeem a cached invite token created by /accept-invite. */
async function maybeRedeemInviteToken() {
  const token = localStorage.getItem(LS_INVITE_KEY)
  if (!token) return
  try {
    await supabase.rpc('accept_invite_with_token', { p_token: token })
  } catch (e) {
    console.warn('invite token redeem failed (callback):', (e as any)?.message || e)
  } finally {
    localStorage.removeItem(LS_INVITE_KEY)
  }
}

/** After auth, decide where to send the user. */
async function routeByMembership(nav: ReturnType<typeof useNavigate>) {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) {
    nav('/auth', { replace: true })
    return
  }

  // Prefer active membership; if none, go to onboarding (which handles verify-gate)
  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (membership?.company_id) nav('/dashboard', { replace: true })
  else nav('/onboarding', { replace: true })
}
