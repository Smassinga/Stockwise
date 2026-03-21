import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/button'
import { clearInviteToken, stashInviteToken } from '../lib/inviteToken'
import { supabase } from '../lib/supabase'
import { withTimeout } from '../lib/withTimeout'
const SESSION_LOOKUP_TIMEOUT_MS = 5000
const MEMBERSHIP_LOOKUP_TIMEOUT_MS = 6000
const INVITE_REDEEM_TIMEOUT_MS = 6000

export default function AcceptInvite() {
  const nav = useNavigate()
  const [msg, setMsg] = useState('Processing your invite...')
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

        stashInviteToken(token)

        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_LOOKUP_TIMEOUT_MS,
          'invite session lookup'
        )
        const userId = session?.user?.id

        if (!userId) {
          setMsg('Please sign in (or create an account) to accept your invite.')
          setShowAuthBtn(true)
          return
        }

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
      {showAuthBtn && <Button onClick={() => nav('/login', { replace: true })}>Go to sign-in</Button>}
    </div>
  )
}

async function redeemAndRoute(nav: ReturnType<typeof useNavigate>, token: string) {
  const { error } = await withTimeout(
    supabase.rpc('accept_invite_with_token', { p_token: token }),
    INVITE_REDEEM_TIMEOUT_MS,
    'invite redeem'
  )
  clearInviteToken()

  if (error) {
    console.warn('invite redeem failed:', error.message)
  }
  await routeByMembership(nav)
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
    console.warn('membership lookup failed during invite accept:', e)
    nav('/onboarding', { replace: true })
  }
}
