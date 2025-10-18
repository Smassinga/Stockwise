import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import type { CompanyRole } from "../lib/roles";
import type { MemberRole, MemberStatus } from "../lib/enums";
import { useToast } from "./use-toast";

type OrgCompany = { id: string; name: string | null };

type OrgState = {
  loading: boolean;
  companyId: string | null;
  companyName: string | null;
  myRole: CompanyRole | null;
  memberStatus: MemberStatus | null;
  companies: OrgCompany[];
  refresh: () => Promise<void>;
  setActiveCompany: (id: string) => void;
  switching: boolean;
};

const OrgContext = createContext<OrgState>({
  loading: true,
  companyId: null,
  companyName: null,
  myRole: null,
  memberStatus: null,
  companies: [],
  refresh: async () => {},
  setActiveCompany: () => {},
  switching: false,
});

const LAST_COMPANY_KEY = (userId: string | undefined) =>
  `sw:lastCompanyId:${userId ?? 'anon'}`;

function statusRank(s: MemberStatus) {
  return { active: 0, invited: 1, disabled: 2 }[s] ?? 3;
}

function roleRank(r: MemberRole) {
  // Prefer higher privileges when we must pick a default
  return (
    {
      OWNER: 0,
      ADMIN: 1,
      MANAGER: 2,
      OPERATOR: 3,
      VIEWER: 4,
    } as Record<string, number>
  )[r] ?? 9
}

/** Ensure the company claim is in the JWT & refresh token so RLS sees it */
async function ensureCompanyClaim(id: string | null) {
  if (!id) return;
  try {
    const { data: u } = await supabase.auth.getUser();
    const current = (u.user?.user_metadata as any)?.company_id;
    if (current === id) return;

    const { error: updErr } = await supabase.auth.updateUser({
      data: { company_id: id },
    });
    if (updErr) {
      console.warn("[Org] updateUser(company_id) failed:", updErr);
      return;
    }

    // Important: refresh to propagate the new JWT into the client
    const { error: refErr } = await supabase.auth.refreshSession();
    if (refErr) console.warn("[Org] refreshSession failed:", refErr);
  } catch (e) {
    console.warn("[Org] ensureCompanyClaim failed:", e);
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<OrgCompany[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<CompanyRole | null>(null);
  const [memberStatus, setMemberStatus] = useState<MemberStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  const { toast } = useToast();

  function pickBest(
    rows: Array<{ company_id: string; role: MemberRole; status: MemberStatus; created_at?: string; user_id?: string | null }>
  ) {
    // Normalize to prefer user_id over email rows for same company_id
    const norm = (rows ?? []).reduce((acc, m) => {
      const k = m.company_id;
      const better =
        !acc[k] ||
        // Prefer user_id rows over email-only rows
        (!!m.user_id && !acc[k].user_id) ||
        // Prefer active over invited
        (m.status === 'active' && acc[k].status !== 'active') ||
        // If both have same user_id status, use existing logic
        (
          (!!m.user_id === !!acc[k].user_id) &&
          (statusRank(m.status) < statusRank(acc[k].status) ||
          (statusRank(m.status) === statusRank(acc[k].status) &&
            roleRank(m.role) < roleRank(acc[k].role)) ||
          (statusRank(m.status) === statusRank(acc[k].status) &&
            roleRank(m.role) === roleRank(acc[k].role) &&
            (new Date(m.created_at || 0).getTime() <
              new Date(acc[k].created_at || 0).getTime())))
        );
      if (better) acc[k] = m;
      return acc;
    }, {} as Record<string, { company_id: string; role: MemberRole; status: MemberStatus; created_at?: string; user_id?: string | null }>);

    return new Map(Object.entries(norm).map(([k, v]) => [k, v]));
  }

  const resolve = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    if (!user) {
      setCompanies([]);
      setCompanyId(null);
      setCompanyName(null);
      setMyRole(null);
      setMemberStatus(null);
      return;
    }

    // Load memberships for the current user (explicit eq for clarity; RLS should enforce anyway)
    const { data: mems, error: memErr } = await supabase
      .from("company_members")
      .select("company_id, role, status, created_at, user_id")
      .in("status", ["active", "invited"] as MemberStatus[])
      .or(`user_id.eq.${user.id},email.eq.${user.email}`);

    if (memErr) {
      console.error("[Org] load memberships:", memErr);
      toast({
        title: "Error",
        description: "Failed to load company memberships",
        variant: "destructive",
      });
      setCompanies([]);
      setCompanyId(null);
      setCompanyName(null);
      setMyRole(null);
      setMemberStatus(null);
      return;
    }

    const meta = pickBest((mems ?? []) as any);
    const ids = Array.from(meta.keys());
    if (ids.length === 0) {
      setCompanies([]);
      setCompanyId(null);
      setCompanyName(null);
      setMyRole(null);
      setMemberStatus(null);
      return;
    }

    // company names
    const { data: rows, error: compErr } = await supabase
      .from("companies")
      .select("id,name")
      .in("id", ids);
    if (compErr) {
      console.error("[Org] load companies:", compErr);
      toast({
        title: "Error",
        description: "Failed to load company information",
        variant: "destructive",
      });
    }

    const list: OrgCompany[] = (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name ?? null,
    }));
    setCompanies(list);

    // choose active company
    const userSpecificKey = LAST_COMPANY_KEY(user.id);
    const genericKey = 'sw:lastCompanyId:temp';
    
    // Try user-specific key first, then fall back to generic key
    let cached = localStorage.getItem(userSpecificKey);
    if (!cached) {
      cached = localStorage.getItem(genericKey);
      // If we found a value in the generic key, migrate it to user-specific key
      if (cached) {
        localStorage.setItem(userSpecificKey, cached);
        localStorage.removeItem(genericKey);
      }
    }
    
    const chosenId = cached && ids.includes(cached) ? cached : ids[0];
    const chosen = list.find((c) => c.id === chosenId) ?? list[0];
    const chosenMeta = chosen ? meta.get(chosen.id)! : null;

    setCompanyId(chosen?.id ?? null);
    setCompanyName(chosen?.name ?? null);
    setMyRole(chosenMeta?.role ?? null);
    setMemberStatus(chosenMeta?.status ?? null);

    if (chosen?.id) {
      localStorage.setItem(userSpecificKey, chosen.id);

      // 1) Put company_id in JWT (RLS reads this first)
      await ensureCompanyClaim(chosen.id);

      // 2) Also set DB session GUC via RPC (helps pooled/server contexts)
      const { error: rpcErr } = await supabase.rpc("set_active_company", {
        p_company_id: chosen.id,
      });
      if (rpcErr) console.warn("[Org] set_active_company RPC failed:", rpcErr);
    }
  };

  const refresh = async () => {
    setLoading(true);
    try {
      await resolve();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    // Hydrate from cache synchronously to avoid first-paint flicker
    // We'll update this with the proper user-specific key once we have the user
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser) {
      const cached = localStorage.getItem('sw:lastCompanyId:temp');
      if (cached) setCompanyId(cached);
    }
    
    (async () => {
      if (mounted) await refresh();
    })();

    // Re-resolve on auth changes (login, logout, token refresh)
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      // Do not await to avoid blocking the callback
      refresh();
    });

    // Cross-tab sync of chosen company
    let last = 0;
    function onStorage(e: StorageEvent) {
      if (e.key?.startsWith('sw:lastCompanyId')) {
        const now = Date.now();
        if (now - last > 500) {
          last = now;
          refresh();
        }
      }
    }
    if (isBrowser) {
      window.addEventListener("storage", onStorage);
    }

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
      if (isBrowser) {
        window.removeEventListener("storage", onStorage);
      }
    };
  }, []); // eslint-disable-line

  const setActiveCompany = (id: string) => {
    if (!id || id === companyId) return;

    const prev = { companyId, companyName };
    
    // optimistic local update
    const found = companies.find((c) => c.id === id);
    setCompanyId(id);
    setCompanyName(found?.name ?? null);
    
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser) {
      // Store in temporary key until we get user ID in resolve()
      localStorage.setItem('sw:lastCompanyId:temp', id);
    }

    // Sync JWT and DB; then soft refresh
    setSwitching(true);
    (async () => {
      try {
        await ensureCompanyClaim(id);

        // NEW: promote invited/email membership -> active user_id membership
        const { error: acceptErr } = await supabase.rpc('accept_my_invite', {
          p_company_id: id,
        });
        if (acceptErr) console.warn('[Org] accept_my_invite failed:', acceptErr);

        // Existing DB session context
        const { error: rpcErr } = await supabase.rpc('set_active_company', {
          p_company_id: id,
        });
        if (rpcErr) throw rpcErr;
        
        // After successful RPC call, also update the user-specific key
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId && isBrowser) {
          const userSpecificKey = LAST_COMPANY_KEY(userId);
          localStorage.setItem(userSpecificKey, id);
        }
        
        await refresh(); // only after success
      } catch (e) {
        console.warn("[Org] setActiveCompany rollback due to:", e);
        // rollback optimistic update
        setCompanyId(prev.companyId);
        setCompanyName(prev.companyName);
        if (isBrowser && prev.companyId) {
          localStorage.setItem('sw:lastCompanyId:temp', prev.companyId);
          // Also update the user-specific key on rollback
          const { data: { session } } = await supabase.auth.getSession();
          const userId = session?.user?.id;
          if (userId && isBrowser) {
            const userSpecificKey = LAST_COMPANY_KEY(userId);
            localStorage.setItem(userSpecificKey, prev.companyId);
          }
        }
        // toast error
        toast({
          title: "Error",
          description: "Failed to switch company",
          variant: "destructive",
        });
      } finally {
        setSwitching(false);
      }
    })().catch((e) => {
      console.warn("[Org] setActiveCompany error:", e);
      setSwitching(false);
    });
  };

  const value = useMemo<OrgState>(
    () => ({
      loading,
      companyId,
      companyName,
      myRole,
      memberStatus,
      companies,
      refresh,
      setActiveCompany,
      switching,
    }),
    [loading, companyId, companyName, myRole, memberStatus, companies, switching]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}