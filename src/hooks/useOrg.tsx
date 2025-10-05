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

type MemberStatus = "invited" | "active" | "disabled";
export type OrgCompany = { id: string; name: string | null };

type OrgState = {
  loading: boolean;
  companyId: string | null;
  companyName: string | null;
  myRole: CompanyRole | null;
  memberStatus: MemberStatus | null;
  companies: OrgCompany[];
  refresh: () => Promise<void>;
  setActiveCompany: (id: string) => void;
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
});

const LAST_COMPANY_KEY = "sw:lastCompanyId";

function statusRank(s: MemberStatus) {
  return { active: 0, invited: 1, disabled: 2 }[s] ?? 3;
}
function roleRank(r: CompanyRole) {
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

  function pickBest(
    rows: Array<{ company_id: string; role: CompanyRole; status: MemberStatus; created_at?: string }>
  ) {
    // Choose best status, then best role, then earliest created_at as tie-breaker
    const map = new Map<
      string,
      { role: CompanyRole; status: MemberStatus; created_at?: string }
    >();
    for (const r of rows) {
      const prev = map.get(r.company_id);
      if (
        !prev ||
        statusRank(r.status) < statusRank(prev.status) ||
        (statusRank(r.status) === statusRank(prev.status) &&
          roleRank(r.role) < roleRank(prev.role)) ||
        (statusRank(r.status) === statusRank(prev.status) &&
          roleRank(r.role) === roleRank(prev.role) &&
          (new Date(r.created_at || 0).getTime() <
            new Date(prev.created_at || 0).getTime()))
      ) {
        map.set(r.company_id, {
          role: r.role,
          status: r.status,
          created_at: r.created_at,
        });
      }
    }
    return map;
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
      .select("company_id, role, status, created_at")
      .in("status", ["active", "invited"] as MemberStatus[])
      .eq("user_id", user.id);

    if (memErr) {
      console.error("[Org] load memberships:", memErr);
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
    if (compErr) console.error("[Org] load companies:", compErr);

    const list: OrgCompany[] = (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name ?? null,
    }));
    setCompanies(list);

    // choose active company
    const cached = localStorage.getItem(LAST_COMPANY_KEY);
    const chosenId = cached && ids.includes(cached) ? cached : ids[0];
    const chosen = list.find((c) => c.id === chosenId) ?? list[0];
    const chosenMeta = chosen ? meta.get(chosen.id)! : null;

    setCompanyId(chosen?.id ?? null);
    setCompanyName(chosen?.name ?? null);
    setMyRole(chosenMeta?.role ?? null);
    setMemberStatus(chosenMeta?.status ?? null);

    if (chosen?.id) {
      localStorage.setItem(LAST_COMPANY_KEY, chosen.id);

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
    (async () => {
      if (mounted) await refresh();
    })();

    // Re-resolve on auth changes (login, logout, token refresh)
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      // Do not await to avoid blocking the callback
      refresh();
    });

    // Cross-tab sync of chosen company
    function onStorage(e: StorageEvent) {
      if (e.key === LAST_COMPANY_KEY) refresh();
    }
    window.addEventListener("storage", onStorage);

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
      window.removeEventListener("storage", onStorage);
    };
  }, []); // eslint-disable-line

  const setActiveCompany = (id: string) => {
    if (!id || id === companyId) return;

    // optimistic local update
    const found = companies.find((c) => c.id === id);
    setCompanyId(id);
    setCompanyName(found?.name ?? null);
    localStorage.setItem(LAST_COMPANY_KEY, id);

    // Sync JWT and DB; then soft refresh
    (async () => {
      try {
        await ensureCompanyClaim(id);
        const { error: rpcErr } = await supabase.rpc("set_active_company", {
          p_company_id: id,
        });
        if (rpcErr) console.warn("[Org] set_active_company RPC failed:", rpcErr);
      } finally {
        await refresh();
      }
    })().catch((e) => console.warn("[Org] setActiveCompany error:", e));
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
    }),
    [loading, companyId, companyName, myRole, memberStatus, companies]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}
