// supabase/functions/admin-users/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Role = "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
type Status = "invited" | "active" | "disabled";

type MemberRow = {
  email: string | null;
  user_id: string | null;
  role: Role;
  status: Status;
  invited_by?: string | null;
  created_at?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SB_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/+$/, "");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error("Missing one of SB_URL / SB_SERVICE_ROLE_KEY / SB_ANON_KEY (or SUPABASE_* fallbacks)");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function normalizeEmail(email: string | null | undefined): string {
  return String(email ?? "").trim().toLowerCase();
}

function roleRank(role: Role): number {
  return { OWNER: 0, ADMIN: 1, MANAGER: 2, OPERATOR: 3, VIEWER: 4 }[role] ?? 99;
}

function canInviteRole(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"].includes(target);
  if (actor === "MANAGER") return ["MANAGER", "OPERATOR", "VIEWER"].includes(target);
  return false;
}

function canManageTarget(actor: Role, target: Role): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target !== "OWNER";
  if (actor === "MANAGER") return ["MANAGER", "OPERATOR", "VIEWER"].includes(target);
  return false;
}

function makeRedirectTo(req: Request) {
  if (PUBLIC_SITE_URL) return `${PUBLIC_SITE_URL}/auth/callback`;

  const origin = req.headers.get("origin");
  if (origin) return `${origin.replace(/\/+$/, "")}/auth/callback`;

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}/auth/callback`;

  return "http://localhost:3000/auth/callback";
}

function pickBestMembership(rows: MemberRow[]): MemberRow | null {
  if (!rows.length) return null;
  const active = rows.filter((r) => r.status === "active");
  if (!active.length) return null;

  const sorted = active.slice().sort((a, b) => {
    const userBonus = Number(Boolean(b.user_id)) - Number(Boolean(a.user_id));
    if (userBonus !== 0) return userBonus;

    const rankDiff = roleRank(a.role) - roleRank(b.role);
    if (rankDiff !== 0) return rankDiff;

    const aTs = new Date(a.created_at ?? 0).getTime();
    const bTs = new Date(b.created_at ?? 0).getTime();
    return aTs - bTs;
  });

  return sorted[0] ?? null;
}

async function loadActorMembership(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  userId: string,
  userEmail: string
): Promise<MemberRow | null> {
  const { data: byUser, error: byUserErr } = await admin
    .from("company_members")
    .select("email,user_id,role,status,created_at")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .in("status", ["active", "invited"]);

  if (byUserErr) throw byUserErr;

  const byUserRows = (byUser ?? []) as MemberRow[];
  if (byUserRows.length) {
    const chosen = pickBestMembership(byUserRows);
    if (chosen) return chosen;
  }

  if (!userEmail) return null;

  const { data: byEmail, error: byEmailErr } = await admin
    .from("company_members")
    .select("email,user_id,role,status,created_at")
    .eq("company_id", companyId)
    .eq("email", userEmail)
    .in("status", ["active", "invited"]);

  if (byEmailErr) throw byEmailErr;

  return pickBestMembership((byEmail ?? []) as MemberRow[]);
}

async function loadTargetMembership(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  email: string
): Promise<MemberRow | null> {
  const { data, error } = await admin
    .from("company_members")
    .select("email,user_id,role,status,created_at")
    .eq("company_id", companyId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as MemberRow | null) ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!jwt) return json({ error: "missing bearer token" }, 401);

    const anon = createClient(SUPABASE_URL!, ANON_KEY!);
    const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "invalid token" }, 401);

    const userId = userData.user.id;
    const userEmail = normalizeEmail(userData.user.email);

    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    const url = new URL(req.url);
    const pathname = url.pathname;
    const companyId = url.searchParams.get("company_id");

    async function assertPrivileged(company_id: string) {
      const me = await loadActorMembership(admin, company_id, userId, userEmail);
      if (!me) return { error: "not_member" as const };
      if (me.status !== "active") return { error: "inactive" as const };
      if (!["OWNER", "ADMIN", "MANAGER"].includes(me.role)) return { error: "not_privileged" as const };
      return { role: me.role as Role, email: normalizeEmail(me.email), userId: me.user_id };
    }

    if (req.method === "GET") {
      if (!companyId) return json({ error: "company_id is required" }, 400);

      const guard = await assertPrivileged(companyId);
      if ("error" in guard) return json({ error: guard.error }, 403);

      const { data: rows, error: rowsErr } = await admin
        .from("company_members")
        .select("email,user_id,role,status,invited_by,created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

      if (rowsErr) return json({ error: rowsErr.message }, 400);

      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const meta = new Map<string, { last_sign_in_at: string | null; email_confirmed_at: string | null }>();
      for (const u of list?.users ?? []) {
        meta.set(u.id, {
          last_sign_in_at: u.last_sign_in_at ?? null,
          email_confirmed_at: u.email_confirmed_at ?? null,
        });
      }

      const users = (rows ?? []).map((r) => ({
        email: r.email,
        user_id: r.user_id,
        role: r.role as Role,
        status: r.status as Status,
        invited_by: r.invited_by,
        created_at: r.created_at,
        last_sign_in_at: r.user_id ? meta.get(r.user_id)?.last_sign_in_at ?? null : null,
        email_confirmed_at: r.user_id ? meta.get(r.user_id)?.email_confirmed_at ?? null : null,
      }));

      return json({ users });
    }

    if (req.method === "POST" && pathname.endsWith("/invite")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email, role } = body as { company_id?: string; email?: string; role?: Role };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if ("error" in guard) return json({ error: guard.error }, 403);

      const lower = normalizeEmail(email);
      const existing = await loadTargetMembership(admin, company_id, lower);
      if (existing) {
        if (!canManageTarget(guard.role, existing.role)) return json({ error: "target_not_allowed" }, 403);
        if (existing.status === "active") return json({ error: "already_active" }, 409);
      }

      const requestedRole = (role ?? existing?.role ?? "VIEWER") as Role;
      if (!canInviteRole(guard.role, requestedRole)) return json({ error: "role_not_allowed" }, 403);

      const { error: upErr } = await admin.from("company_members").upsert(
        {
          company_id,
          email: lower,
          role: requestedRole,
          status: "invited" as Status,
          invited_by: userId,
        },
        { onConflict: "company_id,email" }
      );
      if (upErr) return json({ error: upErr.message }, 400);

      const redirectTo = makeRedirectTo(req);
      try {
        await admin.auth.admin.inviteUserByEmail(lower, { redirectTo });
        return json({ ok: true, redirectTo });
      } catch {
        return json({ ok: true, warning: "invite_email_failed", redirectTo });
      }
    }

    if (req.method === "POST" && pathname.endsWith("/invite-link")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email, role } = body as { company_id?: string; email?: string; role?: Role };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if ("error" in guard) return json({ error: guard.error }, 403);

      const lower = normalizeEmail(email);
      const existing = await loadTargetMembership(admin, company_id, lower);
      if (existing) {
        if (!canManageTarget(guard.role, existing.role)) return json({ error: "target_not_allowed" }, 403);
        if (existing.status === "active") return json({ error: "already_active" }, 409);
      }

      const requestedRole = (role ?? existing?.role ?? "VIEWER") as Role;
      if (!canInviteRole(guard.role, requestedRole)) return json({ error: "role_not_allowed" }, 403);

      const { error: upErr } = await admin.from("company_members").upsert(
        {
          company_id,
          email: lower,
          role: requestedRole,
          status: "invited" as Status,
          invited_by: userId,
        },
        { onConflict: "company_id,email" }
      );
      if (upErr) return json({ error: upErr.message }, 400);

      const redirectTo = makeRedirectTo(req);
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "invite",
        email: lower,
        options: { redirectTo },
      });
      if (linkErr) return json({ error: linkErr.message }, 400);

      const actionLink =
        (linkData as { properties?: { action_link?: string }; action_link?: string } | null)?.properties?.action_link ||
        (linkData as { action_link?: string } | null)?.action_link ||
        null;

      if (!actionLink) return json({ error: "failed to generate link" }, 400);
      return json({ ok: true, link: actionLink, redirectTo });
    }

    if (req.method === "POST" && pathname.endsWith("/reinvite")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email } = body as { company_id?: string; email?: string };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if ("error" in guard) return json({ error: guard.error }, 403);

      const target = await loadTargetMembership(admin, company_id, normalizeEmail(email));
      if (!target) return json({ error: "member_not_found" }, 404);
      if (!canManageTarget(guard.role, target.role)) return json({ error: "target_not_allowed" }, 403);

      const redirectTo = makeRedirectTo(req);
      try {
        await admin.auth.admin.inviteUserByEmail(normalizeEmail(email), { redirectTo });
        return json({ ok: true, redirectTo });
      } catch {
        return json({ error: "invite email failed", redirectTo }, 400);
      }
    }

    if (req.method === "PATCH" && pathname.endsWith("/member")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email, role, status } = body as {
        company_id?: string;
        email?: string;
        role?: Role;
        status?: Status;
      };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);
      if (!role && !status) return json({ error: "role or status required" }, 400);

      const guard = await assertPrivileged(company_id);
      if ("error" in guard) return json({ error: guard.error }, 403);

      const lower = normalizeEmail(email);
      const target = await loadTargetMembership(admin, company_id, lower);
      if (!target) return json({ error: "member_not_found" }, 404);
      if (!canManageTarget(guard.role, target.role)) return json({ error: "target_not_allowed" }, 403);

      if (role && !canInviteRole(guard.role, role)) return json({ error: "role_not_allowed" }, 403);
      if (lower === guard.email && role && role !== guard.role) return json({ error: "cannot_change_own_role" }, 400);
      if (lower === guard.email && status === "disabled") return json({ error: "cannot_disable_self" }, 400);

      const updates: Record<string, unknown> = {};
      if (role) updates.role = role;
      if (status) updates.status = status;

      const { error: updErr } = await admin
        .from("company_members")
        .update(updates)
        .eq("company_id", company_id)
        .eq("email", lower);

      if (updErr) return json({ error: updErr.message }, 400);
      return json({ ok: true });
    }

    if (req.method === "DELETE" && pathname.endsWith("/member")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email } = body as { company_id?: string; email?: string };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if ("error" in guard) return json({ error: guard.error }, 403);

      const lower = normalizeEmail(email);
      const target = await loadTargetMembership(admin, company_id, lower);
      if (!target) return json({ error: "member_not_found" }, 404);

      if (!canManageTarget(guard.role, target.role)) return json({ error: "target_not_allowed" }, 403);
      if (lower === userEmail || (target.user_id && target.user_id === userId)) {
        return json({ error: "cannot remove yourself" }, 400);
      }

      const { error: delErr } = await admin
        .from("company_members")
        .delete()
        .eq("company_id", company_id)
        .eq("email", lower);

      if (delErr) return json({ error: delErr.message }, 400);
      return json({ ok: true });
    }

    if (req.method === "POST" && pathname.endsWith("/sync")) {
      const { data, error } = await admin.rpc("link_invites_to_user", {
        p_user_id: userId,
        p_email: userEmail,
      });
      if (error) return json({ error: error.message }, 400);

      const { error: actErr, count: activatedCount } = await admin
        .from("company_members")
        .update({ status: "active" as Status })
        .eq("user_id", userId)
        .eq("status", "invited" as Status)
        .select("*", { count: "exact", head: true });

      if (actErr) return json({ ok: true, linked: data ?? 0, activated: 0, warning: actErr.message });

      const linkedCount = Number(data ?? 0);
      const activated = Number(activatedCount ?? 0);

      if (activated > 0) {
        try {
          const { data: nowActive } = await admin
            .from("company_members")
            .select("company_id, role")
            .eq("user_id", userId)
            .eq("status", "active");

          const displayName =
            (userData.user.user_metadata?.name as string) ||
            (userData.user.email?.split("@")[0] as string) ||
            "New member";

          const rows = (nowActive ?? []).map((m) => ({
            company_id: m.company_id,
            user_id: null,
            level: "info",
            title: "New team member joined",
            body: `${displayName} joined the company${m.role ? ` as ${m.role}` : ""}.`,
            url: "/users",
            icon: null,
            meta: null,
          }));

          if (rows.length) await admin.from("notifications").insert(rows);
        } catch {
          // notification write is best-effort
        }
      }

      return json({ ok: true, linked: linkedCount, activated });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
