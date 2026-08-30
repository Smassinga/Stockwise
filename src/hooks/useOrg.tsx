import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { setActiveCompanyRpc } from "../lib/setActiveCompanyRpc";
import type { CompanyRole } from "../lib/roles";
import type { MemberStatus } from "../lib/enums";
import { withTimeout } from "../lib/withTimeout";
import {
  listActiveOrgMemberships,
  listOrgCompanies,
  pickBestOrgMemberships,
  type OrgMembershipRow,
} from "../lib/orgMemberships";
import {
  closeAssistedCustomerWorkspace,
  openAssistedCustomerWorkspace,
} from "../lib/companyAccess";
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
  setActiveCompany: (id: string) => Promise<boolean>;
  switching: boolean;
  authorityMode: 'membership' | 'platform_workspace';
};

const OrgContext = createContext<OrgState>({
  loading: true,
  companyId: null,
  companyName: null,
  myRole: null,
  memberStatus: null,
  companies: [],
  refresh: async () => {},
  setActiveCompany: async () => false,
  switching: false,
  authorityMode: 'membership',
});

const LAST_COMPANY_KEY = (userId: string | undefined) =>
  `sw:lastCompanyId:${userId ?? 'anon'}`;

const ORG_QUERY_TIMEOUT_MS = 8000;
const ACTIVE_COMPANY_SYNC_TIMEOUT_MS = 6000;
const ORG_REFRESH_RETRY_MS = 700;

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  return String((error as any)?.message || '').trim()
}

function isTransientOrgFetchError(error: unknown) {
  const message = normalizeErrorMessage(error).toLowerCase()
  const code = String((error as any)?.code || '').trim().toLowerCase()

  return (
    message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('network request failed')
    || message.includes('load failed')
    || message.includes('timeout')
    || code === 'aborterror'
  )
}

async function syncActiveCompanyContext(id: string) {
  try {
    const { error: rpcErr } = await withTimeout(
      setActiveCompanyRpc(id),
      ACTIVE_COMPANY_SYNC_TIMEOUT_MS,
      "set_active_company"
    );
    if (rpcErr) {
      console.warn("[Org] set_active_company RPC failed:", rpcErr);
      return false;
    }
  } catch (e) {
    console.warn("[Org] set_active_company background sync failed:", e);
    return false;
  }

  return true;
}

export function OrgProvider({
  children,
  platformWorkspaceCompanyId = null,
}: {
  children: ReactNode
  platformWorkspaceCompanyId?: string | null
}) {
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<OrgCompany[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<CompanyRole | null>(null);
  const [memberStatus, setMemberStatus] = useState<MemberStatus | null>(null);
  const [switching, setSwitching] = useState(false);
  const { toast } = useToast();
  const lastResolvedUserRef = useRef<string | null>(null);
  const lastSyncedContextRef = useRef<string | null>(null);
  const syncInFlightRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const orgSnapshotRef = useRef<{
    companyId: string | null
    companyName: string | null
    myRole: CompanyRole | null
    memberStatus: MemberStatus | null
    companies: OrgCompany[]
  }>({
    companyId: null,
    companyName: null,
    myRole: null,
    memberStatus: null,
    companies: [],
  });

  useEffect(() => {
    orgSnapshotRef.current = {
      companyId,
      companyName,
      myRole,
      memberStatus,
      companies,
    };
  }, [companies, companyId, companyName, memberStatus, myRole]);

  const maybeSyncCompanyContext = async (
    userId: string,
    id: string,
    options?: { force?: boolean }
  ) => {
    const key = `${userId}:${id}`;
    const force = options?.force === true;

    if (!force && (lastSyncedContextRef.current === key || syncInFlightRef.current === key)) {
      return;
    }

    syncInFlightRef.current = key;

    try {
      const ok = await syncActiveCompanyContext(id);
      if (ok) lastSyncedContextRef.current = key;
    } finally {
      if (syncInFlightRef.current === key) {
        syncInFlightRef.current = null;
      }
    }
  };

  const scheduleRetryRefresh = () => {
    if (typeof window === 'undefined') return;
    if (retryTimerRef.current != null) return;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      void refresh();
    }, ORG_REFRESH_RETRY_MS);
  };

  const resolve = async () => {
    const {
      data: { session },
    } = await withTimeout(supabase.auth.getSession(), ORG_QUERY_TIMEOUT_MS, "auth session lookup");
    const user = session?.user;

    if (!user) {
      lastResolvedUserRef.current = null;
      lastSyncedContextRef.current = null;
      syncInFlightRef.current = null;
      setCompanies([]);
      setCompanyId(null);
      setCompanyName(null);
      setMyRole(null);
      setMemberStatus(null);
      return;
    }

    if (platformWorkspaceCompanyId) {
      const workspace = await withTimeout(
        openAssistedCustomerWorkspace(platformWorkspaceCompanyId),
        ORG_QUERY_TIMEOUT_MS,
        'assisted customer workspace',
      )
      if (!workspace || workspace.company_id !== platformWorkspaceCompanyId) {
        throw new Error('assisted_workspace_context_unavailable')
      }

      const workspaceCompany = {
        id: workspace.company_id,
        name: workspace.company_name || null,
      }
      setCompanies([workspaceCompany])
      setCompanyId(workspaceCompany.id)
      setCompanyName(workspaceCompany.name)
      setMyRole('ADMIN')
      setMemberStatus('active')
      return
    }

    if (lastResolvedUserRef.current !== user.id) {
      lastResolvedUserRef.current = user.id;
      lastSyncedContextRef.current = null;
      syncInFlightRef.current = null;
    }

    let mergedMemberships: OrgMembershipRow[] = [];
    let memErr: unknown = null;
    try {
      mergedMemberships = await listActiveOrgMemberships(
        user.id,
        user.email,
        ORG_QUERY_TIMEOUT_MS
      );
    } catch (e) {
      memErr = e;
    }

    if (memErr) {
      const snapshot = orgSnapshotRef.current;
      const keepCurrentOrg =
        isTransientOrgFetchError(memErr)
        && (
          Boolean(snapshot.companyId)
          || snapshot.companies.length > 0
          || lastResolvedUserRef.current === user.id
        );

      if (keepCurrentOrg) {
        scheduleRetryRefresh();
        return;
      }

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

    const meta = pickBestOrgMemberships(mergedMemberships);
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
    let rows: OrgCompany[] | null = null;
    let compErr: unknown = null;
    try {
      rows = await listOrgCompanies(ids, ORG_QUERY_TIMEOUT_MS);
    } catch (e) {
      compErr = e;
    }
    if (compErr) {
      if (isTransientOrgFetchError(compErr) && orgSnapshotRef.current.companies.length > 0) {
        scheduleRetryRefresh();
        rows = orgSnapshotRef.current.companies;
        compErr = null;
      } else {
        console.error("[Org] load companies:", compErr);
        toast({
          title: "Error",
          description: "Failed to load company information",
          variant: "destructive",
        });
      }
    }

    const list: OrgCompany[] = (rows ?? ids.map((id) => ({ id, name: null }))).map((r) => ({
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
    
    const activeIds = ids.filter((id) => meta.get(id)?.status === 'active');
    const chosenId = cached && activeIds.includes(cached)
      ? cached
      : activeIds[0] ?? (cached && ids.includes(cached) ? cached : ids[0]);
    const chosen = list.find((c) => c.id === chosenId) ?? list[0];
    const chosenMeta = chosen ? meta.get(chosen.id)! : null;

    setCompanyId(chosen?.id ?? null);
    setCompanyName(chosen?.name ?? null);
    setMyRole(chosenMeta?.role ?? null);
    setMemberStatus(chosenMeta?.status ?? null);

    if (chosen?.id && chosenMeta?.status === 'active') {
      localStorage.setItem(userSpecificKey, chosen.id);
      void maybeSyncCompanyContext(user.id, chosen.id);
    }
  };

  const refresh = async () => {
    if (refreshInFlightRef.current) {
      return await refreshInFlightRef.current;
    }

    const work = (async () => {
      if (retryTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      setLoading(true);
      try {
        await resolve();
      } catch (e) {
        if (isTransientOrgFetchError(e) && (orgSnapshotRef.current.companyId || orgSnapshotRef.current.companies.length > 0)) {
          scheduleRetryRefresh();
          return;
        }

        console.error("[Org] refresh failed:", e);
        setCompanies([]);
        setCompanyId(null);
        setCompanyName(null);
        setMyRole(null);
        setMemberStatus(null);
      } finally {
        setLoading(false);
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = work;
    return await work;
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
      if (!platformWorkspaceCompanyId) {
        try {
          await closeAssistedCustomerWorkspace()
        } catch {
          // Normal company resolution must remain available even if this user
          // has no platform-administration context to close.
        }
      }
      if (mounted) await refresh();
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!["SIGNED_IN", "SIGNED_OUT"].includes(event)) return;
      void refresh();
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
      if (retryTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      sub?.subscription?.unsubscribe?.();
      if (isBrowser) {
        window.removeEventListener("storage", onStorage);
      }
      if (platformWorkspaceCompanyId) {
        void closeAssistedCustomerWorkspace().catch((error) => {
          console.warn('[Org] assisted workspace close failed:', error)
        })
      }
    };
  }, []); // eslint-disable-line

  const setActiveCompany = async (id: string): Promise<boolean> => {
    if (platformWorkspaceCompanyId) return id === companyId
    if (!id || id === companyId) return Boolean(id && id === companyId);

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
    try {
        // Existing DB session context
        const { error: rpcErr } = await withTimeout(
          setActiveCompanyRpc(id),
          ACTIVE_COMPANY_SYNC_TIMEOUT_MS,
          'set_active_company'
        );
        if (rpcErr) throw rpcErr;
        
        // After successful RPC call, also update the user-specific key
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId && isBrowser) {
          const userSpecificKey = LAST_COMPANY_KEY(userId);
          localStorage.setItem(userSpecificKey, id);
          lastResolvedUserRef.current = userId;
          lastSyncedContextRef.current = `${userId}:${id}`;
          syncInFlightRef.current = null;
        }
        
        await refresh(); // only after success
        return true
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
        return false
      } finally {
        setSwitching(false);
      }
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
      authorityMode: platformWorkspaceCompanyId ? 'platform_workspace' : 'membership',
    }),
    [loading, companyId, companyName, myRole, memberStatus, companies, switching, platformWorkspaceCompanyId]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  return useContext(OrgContext);
}
