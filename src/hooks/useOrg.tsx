// src/hooks/useOrg.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { authFetch } from '../lib/authFetch'
import type { CompanyRole } from '../lib/roles'

type MemberStatus = 'invited' | 'active' | 'disabled'

type OrgState = {
  loading: boolean
  companyId: string | null
  companyName: string | null
  myRole: CompanyRole | null
  /** 'active' | 'invited' when a membership exists; otherwise null */
  memberStatus: MemberStatus | null
  error?: string
}

const OrgContext = createContext<OrgState>({
  loading: true,
  companyId: null,
  companyName: null,
  myRole: null,
  memberStatus: null,
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrgState>({
    loading: true,
    companyId: null,
    companyName: null,
    myRole: null,
    memberStatus: null,
  })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (cancelled) return
      setState(s => ({ ...s, loading: true, error: undefined }))

      // Ensure we actually have a session before asking for membership
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) {
        if (!cancelled) {
          setState({
            loading: false,
            companyId: null,
            companyName: null,
            myRole: null,
            memberStatus: null,
          })
        }
        return
      }

      // Link pending invites → current user (best-effort; ignore errors)
      try { await authFetch('admin-users/sync', { method: 'POST' }) } catch {}

      // Prefer ACTIVE membership, but fall back to INVITED (so invited users don't see "Create company")
      const rank = (s: MemberStatus) => ({ active: 0, invited: 1, disabled: 2 }[s] ?? 3)

      // 1) Try by user_id first (after sync this should usually hit)
      let rows: Array<{ company_id: string; role: CompanyRole; status: MemberStatus }> = []
      {
        const r = await supabase
          .from('company_members')
          .select('company_id, role, status')
          .eq('user_id', user.id)
          .in('status', ['active', 'invited'] as MemberStatus[])
        if (!r.error && r.data) rows = r.data as any
      }

      // 2) If none found via user_id, try matching by email as a fallback
      if (rows.length === 0 && user.email) {
        const r2 = await supabase
          .from('company_members')
          .select('company_id, role, status')
          .eq('email', user.email.toLowerCase())
          .in('status', ['active', 'invited'] as MemberStatus[])
        if (!r2.error && r2.data) rows = r2.data as any
      }

      // Pick the "best" membership (active beats invited; oldest first)
      rows.sort((a, b) => rank(a.status) - rank(b.status))

      const picked = rows[0] ?? null
      const companyId: string | null = picked?.company_id ?? null
      const myRole: CompanyRole | null = (picked?.role ?? null) as CompanyRole | null
      const memberStatus: MemberStatus | null = (picked?.status ?? null) as MemberStatus | null

      // Optional: fetch company name (don’t block if RLS denies)
      let companyName: string | null = null
      if (companyId) {
        const co = await supabase.from('companies').select('name').eq('id', companyId).maybeSingle()
        companyName = co.data?.name ?? null
        // ignore co.error by design
      }

      if (!cancelled) {
        setState({
          loading: false,
          companyId,
          companyName,
          myRole,
          memberStatus,
        })
      }
    }

    // Initial load
    load()

    // Re-load on login/logout/token refresh
    const { data: authSub } = supabase.auth.onAuthStateChange(() => {
      load()
    })

    return () => {
      cancelled = true
      authSub?.subscription?.unsubscribe?.()
    }
  }, [])

  return <OrgContext.Provider value={state}>{children}</OrgContext.Provider>
}

export function useOrg() {
  return useContext(OrgContext)
}
