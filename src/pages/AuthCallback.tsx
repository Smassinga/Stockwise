// src/pages/AuthCallback.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

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

  useEffect(() => {
    const run = async () => {
      try {
        const href = window.location.href
        const url = new URL(href)
        const code = url.searchParams.get('code')
        const errQuery = url.searchParams.get('error_description') || url.searchParams.get('error')
        const { access_token, refresh_token, error_description: errHash, error: errHash2 } = parseHash()

        if (errQuery || errHash || errHash2) {
          setMsg(decodeURIComponent(errQuery || errHash || errHash2!))
          return
        }

        // Complete auth
        let authed = false

        // A) PKCE
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(href)
          if (!error) authed = true
        }

        // B) Hash tokens (email link without PKCE)
        if (!authed && access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (!error) authed = true
        }

        if (!authed) {
          setMsg(
            'Could not complete sign-in. Open the link in the SAME browser/profile where you started, or resend the email and try again.'
          )
          return
        }

        // Link + auto-activate any pending invites
        try {
          await supabase.functions.invoke('admin-users/sync', { body: {} })
        } catch {
          // best-effort only
        }

        // Decide destination right now (avoid flicker)
        const { data: { session } } = await supabase.auth.getSession()
        const userId = session?.user?.id
        if (!userId) {
          setMsg('Signed in, but no session found. Please try again.')
          return
        }

        const { data: membership, error: memErr } = await supabase
          .from('company_members')
          .select('company_id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (memErr) {
          // If this check fails, let the app’s route guards figure it out
          nav('/', { replace: true })
          return
        }

        setMsg('Signed in. Redirecting…')
        if (membership?.company_id) {
          // Invited user now active in inviter’s company
          nav('/dashboard', { replace: true })
        } else {
          // No membership yet → onboarding flow
          nav('/onboarding', { replace: true })
        }
      } catch (e: any) {
        setMsg(e?.message || 'Unexpected error while finishing sign-in')
      }
    }

    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center text-sm text-muted-foreground">{msg}</div>
    </div>
  )
}
