// src/pages/AuthCallback.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'

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
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        const errQuery = url.searchParams.get('error_description') || url.searchParams.get('error')
        const { access_token, refresh_token, error_description: errHash, error: errHash2 } = parseHash()

        if (errQuery || errHash || errHash2) {
          setMsg(decodeURIComponent(errQuery || errHash || errHash2!))
          setShowHomeBtn(true)
          return
        }

        // 1) Try PKCE / magic link first (?code=…)
        let authed = false
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(window.location.href)
          if (!error) authed = true
        }

        // 2) Fallback: hash tokens (#access_token=…&refresh_token=…)
        if (!authed && access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (!error) authed = true
        }

        // 3) If still not authed, bail with a helpful message
        if (!authed) {
          setMsg(
            'Could not complete sign-in. Open the link in the SAME browser/profile where you started, or resend the email and try again.'
          )
          setShowHomeBtn(true)
          return
        }

        // Clean up URL (remove tokens / code to avoid refresh loops)
        try {
          const clean = `${window.location.origin}/auth/callback`
          window.history.replaceState({}, '', clean)
        } catch {}

        // Optional best-effort invite sync (ignores errors)
        try { await supabase.functions.invoke('admin-users/sync', { body: {} }) } catch {}

        // Decide destination
        const { data: { session } } = await supabase.auth.getSession()
        const userId = session?.user?.id
        if (!userId) {
          setMsg('Signed in, but no session found. Please try again.')
          setShowHomeBtn(true)
          return
        }

        setMsg('Signed in. Redirecting…')

        // If member, go to dashboard; otherwise onboarding (which now handles unverified users)
        const { data: membership, error: memErr } = await supabase
          .from('company_members')
          .select('company_id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (memErr) {
          nav('/', { replace: true })
        } else if (membership?.company_id) {
          nav('/dashboard', { replace: true })
        } else {
          nav('/onboarding', { replace: true })
        }
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
