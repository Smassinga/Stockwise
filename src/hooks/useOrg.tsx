// src/hooks/useOrg.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/db'
import type { CompanyRole } from '../lib/roles'

type OrgState = {
  loading: boolean
  companyId: string | null
  companyName: string | null
  myRole: CompanyRole | null
  error?: string
}

const OrgContext = createContext<OrgState>({
  loading: true,
  companyId: null,
  companyName: null,
  myRole: null,
})

export function OrgProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OrgState>({
    loading: true,
    companyId: null,
    companyName: null,
    myRole: null,
  })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      if (cancelled) return
      setState(s => ({ ...s, loading: true, error: undefined }))

      // Ensure we actually have a session before asking for membership
      const sessionRes = await supabase.auth.getSession()
      const hasSession = !!sessionRes.data.session
      if (!hasSession) {
        if (!cancelled) {
          setState({
            loading: false,
            companyId: null,
            companyName: null,
            myRole: null,
          })
        }
        return
      }

      // 1) Get my first ACTIVE membership (if any). Use array read to avoid "no rows" errors.
      const mm = await supabase
        .from('company_members')
        .select('company_id, role, status')
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)

      if (mm.error) {
        // 401 happens if JWT isn’t attached yet: treat as no membership, no hard error.
        if (!cancelled) {
          setState({
            loading: false,
            companyId: null,
            companyName: null,
            myRole: null,
            // keep the message only for diagnostics; router shouldn’t block on this
            error: mm.error.message,
          })
        }
        return
      }

      const row = (mm.data && mm.data[0]) || null
      const companyId: string | null = row?.company_id ?? null
      const myRole: CompanyRole | null = (row?.role as CompanyRole) ?? null

      // 2) Optional: fetch company name (don’t block routing if RLS denies)
      let companyName: string | null = null
      if (companyId) {
        const co = await supabase
          .from('companies')
          .select('name')
          .eq('id', companyId)
          .maybeSingle()
        companyName = co.data?.name ?? null
        // ignore co.error on purpose; name is optional
      }

      if (!cancelled) {
        setState({
          loading: false,
          companyId,
          companyName,
          myRole,
        })
      }
    }

    // Initial load
    load()

    // Re-load on login/logout/token refresh
    const { data: authSub } = supabase.auth.onAuthStateChange((_evt) => {
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
