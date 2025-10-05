// src/pages/AcceptInvite.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button } from '../components/ui/button'

const LS_INVITE_KEY = 'sw:inviteToken'

export default function AcceptInvite() {
  const nav = useNavigate()
  const [msg, setMsg] = useState('Processing your invite…')
  const [showAuthBtn, setShowAuthBtn] = useState(false)

  useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href)
        const token = url.searchParams.get('token')?.trim()
        if (!token) {
          setMsg('Invalid invite link (missing token).')
          setShowAuthBtn(true)
          return
        }

        // Cache token so we can redeem after auth if needed
        localStorage.setItem(LS_INVITE_KEY, token)

        // Check session
        const { data: { session } } = await supabase.auth.getSession()
        const userId = session?.user?.id

        if (!userId) {
          // Not logged-in: send to /auth; after sign-in, AuthCallback will redeem
          setMsg('Please sign in (or create an account) to accept your invite.')
          setShowAuthBtn(true)
          return
        }

        // Logged-in: redeem now
        await redeemAndRoute(nav, token)
      } catch (e: any) {
        setMsg(e?.message || 'Could not process invite.')
        setShowAuthBtn(true)
      }
    }
    run()
  }, [nav])

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="text-center text-sm text-muted-foreground">{msg}</div>
      {showAuthBtn && (
        <Button onClick={() => nav('/auth', { replace: true })}>Go to sign-in</Button>
      )}
    </div>
  )
}

async function redeemAndRoute(nav: ReturnType<typeof useNavigate>, token: string) {
  // Redeem via your RPC — ensure this exists server-side.
  const { error } = await supabase.rpc('accept_invite_with_token', { p_token: token })
  // Clear cached token regardless of outcome
  localStorage.removeItem('sw:inviteToken')

  if (error) {
    // If redemption fails, still try to route by any visible membership (e.g., email-linked)
    console.warn('invite redeem failed:', error.message)
  }
  await routeByMembership(nav)
}

async function routeByMembership(nav: ReturnType<typeof useNavigate>) {
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) { nav('/auth', { replace: true }); return }

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
