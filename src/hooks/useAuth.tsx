// src/hooks/useAuth.ts
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type AppUser = {
  id: string
  email: string
  name: string
  orgId?: string | null
  orgName?: string | null
}

type AuthContextValue = {
  user: AppUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (
    name: string,
    email: string,
    password: string,
    _role?: unknown
  ) => Promise<{ success: boolean; error?: string }>
  requestPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function mapUser(u: User): AppUser {
  const name =
    (u.user_metadata?.name as string) ||
    (u.email ? u.email.split('@')[0] : 'User')
  return { id: u.id, email: u.email || '', name }
}

/** Build the redirect used in magic/verify emails. Must be on your allowlist. */
function buildEmailRedirect(): string {
  // Prefer explicit env if you set one (e.g. in Vite)
  // VITE_SITE_URL should be like https://stockwiseapp.com
  const env = (import.meta as any)?.env?.VITE_SITE_URL as string | undefined
  const base =
    (env && env.trim()) ||
    // fallback to current origin for local dev / preview
    window.location.origin
  return `${base.replace(/\/$/, '')}/auth/callback`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const applySession = (session: Session | null) => {
    const u = session?.user ?? null
    setUser(u ? mapUser(u) : null)
  }

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (!cancelled) {
          if (error) setUser(null)
          else applySession(data.session)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      applySession(session)
      setLoading(false)
    })

    // belt & suspenders: if auth never responds, stop the spinner
    const safety = setTimeout(() => setLoading(false), 5000)

    return () => {
      clearTimeout(safety)
      // @ts-ignore - supabase types vary by version
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  async function login(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { success: false, error: error.message }

      // If signIn succeeds we already have a session; map the user
      const u = data.user ?? (await supabase.auth.getUser()).data.user
      if (u) setUser(mapUser(u))
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Unknown error' }
    }
  }

  /**
   * Registration starts the email verification flow.
   * We DO NOT set an authenticated user here; the app will show the
   * "awaiting verification" screen and the user finishes via magic link.
   */
  async function register(name: string, email: string, password: string, _role?: unknown) {
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: buildEmailRedirect(), // must be on your Supabase allowlist
        },
      })
      if (error) return { success: false, error: error.message }

      // Do not setUser here; we want them to verify first.
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Unknown error' }
    }
  }

  async function requestPasswordReset(email: string) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildEmailRedirect(), // send them back to auth callback after reset
      })
      if (error) return { success: false, error: error.message }
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Unknown error' }
    }
  }

  async function logout() {
    try {
      await supabase.auth.signOut()
    } finally {
      setUser(null)
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, requestPasswordReset, logout }),
    [user, loading]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
