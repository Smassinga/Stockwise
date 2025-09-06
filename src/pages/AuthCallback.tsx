// src/pages/AuthCallback.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

async function callSync() {
  // include JWT or the edge function will return 401
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    // best-effort only; don't block sign-in
  }
}

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
      const href = window.location.href
      const url = new URL(href)
      const code = url.searchParams.get('code')
      const errQuery =
        url.searchParams.get('error_description') || url.searchParams.get('error')
      const { access_token, refresh_token, error_description: errHash, error: errHash2 } = parseHash()

      if (errQuery || errHash || errHash2) {
        setMsg(decodeURIComponent(errQuery || errHash || errHash2!))
        return
      }

      let ok = false

      // A) Preferred PKCE flow
      if (code) {
        try {
          const { error } = await supabase.auth.exchangeCodeForSession(href)
          if (error) throw error
          ok = true
        } catch {
          // fall through to hash token path
        }
      }

      // B) Hash tokens (non-PKCE) → set session manually
      if (!ok && access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token })
        if (!error) ok = true
      }

      if (!ok) {
        setMsg(
          'Could not complete sign-in. Open the link in the SAME browser/profile where you started, or resend the email and try again.'
        )
        return
      }

      // Link any pending invites to this account (best-effort)
      await callSync()

      setMsg('Signed in. Redirecting…')
      // Let your guards decide Dashboard vs Onboarding
      nav('/', { replace: true })
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
