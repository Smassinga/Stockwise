// src/lib/supabase.ts
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'stockwise.auth',
    },
    realtime: {
      // Keep this lightweight. Do NOT put apikey/token manually.
      params: { eventsPerSecond: 10 },
    },
  }
)

/** A one-time gate: components can await this before creating channels. */
let _resolveReady: (v: unknown) => void = () => {}
export const realtimeReady = new Promise((res) => { _resolveReady = res })

/** Seed the realtime socket with the current access token (if any). */
;(async () => {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''
  supabase.realtime.setAuth(token)
  console.log('[Supabase] Initial token set for realtime', { hasToken: !!token, userId: session?.user?.id })
  _resolveReady(null)
})()

/** Keep the socket's token in sync after login/refresh/logout. */
supabase.auth.onAuthStateChange((_event, session) => {
  const token = session?.access_token ?? ''
  supabase.realtime.setAuth(token)
  console.log('[Supabase] Auth state changed, updating realtime token', { 
    event: _event, 
    hasToken: !!token, 
    userId: session?.user?.id 
  })
})

/** Optional helper: creates a channel that joins with a token in params as well. */
export async function createAuthedChannel(
  name: string,
  params?: Record<string, string>
): Promise<RealtimeChannel> {
  await realtimeReady
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''
  // defensive: set it on the shared socket
  supabase.realtime.setAuth(token)
  console.log('[Supabase] Creating authed channel', { 
    name, 
    hasToken: !!token, 
    userId: session?.user?.id 
  })
  // belt + suspenders: also include on the channel join
  const config: any = { config: { params: { token, access_token: token, ...(params ?? {}) } } }
  return supabase.channel(name, config)
}