// supabase/functions/admin-users/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Role = "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
type Status = "invited" | "active" | "disabled";

// ---- CORS ----
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// ---- Secrets: prefer SB_* names, then SUPABASE_* fallbacks ----
const SUPABASE_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY =
  Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SB_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");

// Public site (where auth should return)
const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") ?? "").replace(/\/+$/, "");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error("Missing one of SB_URL / SB_SERVICE_ROLE_KEY / SB_ANON_KEY (or SUPABASE_* fallbacks)");
}

// Build the correct redirectTo for invites / magic links
function makeRedirectTo(req: Request) {
  // Always use the canonical URL for production
  // This ensures that even if the client forgets to pass a redirect, 
  // Auth knows where to send users after verifying the token
  if (PUBLIC_SITE_URL) return `${PUBLIC_SITE_URL}/auth/callback`;

  const origin = req.headers.get("origin");
  if (origin) return `${origin.replace(/\/+$/, "")}/auth/callback`;

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}/auth/callback`;

  // Final fallback (dev)
  return "http://localhost:3000/auth/callback";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // --- Auth (caller must be logged in) ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    if (!jwt) return json({ error: "missing bearer token" }, 401);

    // NB: use anon client to parse the JWT without service role
    const anon = createClient(SUPABASE_URL!, ANON_KEY!);
    const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "invalid token" }, 401);

    const userId = userData.user.id;
    const userEmail = (userData.user.email ?? "").toLowerCase();

    // Service-role client (bypasses RLS for admin ops inside this function)
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

    const url = new URL(req.url);
    const pathname = url.pathname;
    const companyId = url.searchParams.get("company_id");

    // Helper: only allow OWNER/ADMIN/MANAGER & status=active
    async function assertPrivileged(company_id: string) {
      // Accept either a bound user_id membership OR an email-invite membership
      const { data: me, error: meErr } = await admin
        .from("company_members")
        .select("role,status,email,user_id")
        .eq("company_id", company_id)
        .or(
          // PostgREST OR syntax: or=(A,B)
          // allow: (user_id == caller) OR (email is not null AND email ilike callerEmail)
          `user_id.eq.${userId},and(email.not.is.null,email.ilike.${userEmail})`
        )
        .maybeSingle();

      if (meErr) return `db: ${meErr.message}`;
      if (!me) return "not_member";
      // invited users can exist, but are NOT privileged
      if (me.status !== "active") return "inactive";
      if (!["OWNER", "ADMIN", "MANAGER"].includes((me.role as Role) ?? "VIEWER")) return "not_privileged";
      return null;
    }

    // ---------- GET /?company_id=... ----------
    if (req.method === "GET") {
      if (!companyId) return json({ error: "company_id is required" }, 400);

      const guard = await assertPrivileged(companyId);
      if (guard) return json({ error: guard }, 403);

      const { data: rows, error: rowsErr } = await admin
        .from("company_members")
        .select("email,user_id,role,status,invited_by,created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

      if (rowsErr) return json({ error: rowsErr.message }, 400);

      // Enrich with auth meta (last sign-in, email confirmation)
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const meta = new Map<string, { last_sign_in_at: string | null; email_confirmed_at: string | null }>();
      for (const u of list?.users ?? []) {
        meta.set(u.id, {
          last_sign_in_at: u.last_sign_in_at ?? null,
          email_confirmed_at: u.email_confirmed_at ?? null,
        });
      }

      const users = rows.map((r) => ({
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

    // ---------- POST /invite ----------
    if (req.method === "POST" && pathname.endsWith("/invite")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email, role } = body as {
        company_id?: string; email?: string; role?: Role;
      };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if (guard) return json({ error: guard }, 403);

      const lower = String(email).toLowerCase();

      // NOTE: Upsert relies on a UNIQUE constraint on (company_id, email)
      const { error: upErr } = await admin.from("company_members").upsert({
        company_id,
        email: lower,
        role: (role ?? "VIEWER") as Role,
        status: "invited" as Status,
        invited_by: userId,
      }, { onConflict: "company_id,email" });
      if (upErr) return json({ error: upErr.message }, 400);

      // Send Auth invite
      const redirectTo = makeRedirectTo(req);
      try {
        await admin.auth.admin.inviteUserByEmail(lower, { redirectTo });
        return json({ ok: true, redirectTo });
      } catch (_e) {
        // Keep the row; invite can be resent later
        return json({ ok: true, warning: "invite_email_failed", redirectTo });
      }
    }

    // ---------- POST /invite-link (upsert + return a shareable action_link) ----------
    if (req.method === "POST" && pathname.endsWith("/invite-link")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email, role } = body as { company_id?: string; email?: string; role?: Role };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if (guard) return json({ error: guard }, 403);

      const lower = String(email).toLowerCase();

      const { error: upErr } = await admin.from("company_members").upsert({
        company_id,
        email: lower,
        role: (role ?? "VIEWER") as Role,
        status: "invited" as Status,
        invited_by: userId,
      }, { onConflict: "company_id,email" });
      if (upErr) return json({ error: upErr.message }, 400);

      const redirectTo = makeRedirectTo(req);
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: "invite",
        email: lower,
        options: { redirectTo }
      });
      if (linkErr) return json({ error: linkErr.message }, 400);

      interface LinkData {
        properties?: { action_link?: string };
        action_link?: string;
      }
      const ld = linkData as LinkData | null;
      const action_link =
        ld?.properties?.action_link ||
        ld?.action_link ||
        null;
      if (!action_link) return json({ error: "failed to generate link" }, 400);

      return json({ ok: true, link: action_link, redirectTo });
    }

    // ---------- POST /reinvite ----------
    if (req.method === "POST" && pathname.endsWith("/reinvite")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email } = body as { company_id?: string; email?: string };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if (guard) return json({ error: guard }, 403);

      const redirectTo = makeRedirectTo(req);
      try {
        await admin.auth.admin.inviteUserByEmail(String(email).toLowerCase(), { redirectTo });
        return json({ ok: true, redirectTo });
      } catch (_e) {
        return json({ error: "invite email failed", redirectTo }, 400);
      }
    }

    // ---------- PATCH /member (update role/status) ----------
    if (req.method === "PATCH" && pathname.endsWith("/member")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email, role, status } = body as {
        company_id?: string; email?: string; role?: Role; status?: Status;
      };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if (guard) return json({ error: guard }, 403);

      const updates: Record<string, unknown> = {};
      if (role) updates.role = role;
      if (status) updates.status = status;

      const { error: updErr } = await admin
        .from("company_members")
        .update(updates)
        .eq("company_id", company_id)
        .eq("email", String(email).toLowerCase());

      if (updErr) return json({ error: updErr.message }, 400);
      return json({ ok: true });
    }

    // ---------- DELETE /member ----------
    if (req.method === "DELETE" && pathname.endsWith("/member")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email } = body as { company_id?: string; email?: string };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if (guard) return json({ error: guard }, 403);

      if (String(email).toLowerCase() === userEmail.toLowerCase()) {
        return json({ error: "cannot remove yourself" }, 400);
      }

      const { error: delErr } = await admin
        .from("company_members")
        .delete()
        .eq("company_id", company_id)
        .eq("email", String(email).toLowerCase());

      if (delErr) return json({ error: delErr.message }, 400);
      return json({ ok: true });
    }

    // ---------- POST /sync (link invites + activate them) ----------
    if (req.method === "POST" && pathname.endsWith("/sync")) {
      // NOTE: your DB should have an RPC 'link_invites_to_user'. If not, see SQL in section 2 below.
      const { data, error } = await admin.rpc("link_invites_to_user", {
        p_user_id: userId,
        p_email: userEmail,
      });
      if (error) return json({ error: error.message }, 400);

      // flip any linked invites from "invited" -> "active"
      const { error: actErr, count: activatedCount } = await admin
        .from("company_members")
        .update({ status: "active" as Status })
        .eq("user_id", userId)
        .eq("status", "invited" as Status)
        .select("*", { count: "exact", head: true });
      // ADD THIS (best-effort): create “user joined” notifications for all companies they just joined
try {
  // which companies did this user just become active in?
  const { data: nowActive } = await admin
    .from("company_members")
    .select("company_id, role")
    .eq("user_id", userId)
    .eq("status", "active");

  // basic display name
  const displayName =
    (userData.user.user_metadata?.name as string) ||
    (userData.user.email?.split("@")[0]) ||
    "New member";

  // insert one notification per company
  const rows =
    (nowActive ?? []).map((m) => ({
      company_id: m.company_id,
      user_id: null,                 // broadcast (visible to everyone in company)
      level: "info",
      title: "New team member joined",
      body: `${displayName} joined the company${m.role ? ` as ${m.role}` : ""}.`,
      url: "/users",
      icon: null,
      meta: null,
    }));

  if (rows.length) {
    await admin.from("notifications").insert(rows);
  }
} catch (_e) {
  // swallow – notification shouldn’t block the flow
}
      if (actErr) {
        return json({ ok: true, linked: data ?? 0, activated: 0, warning: actErr.message });
      }

      return json({ ok: true, linked: data ?? 0, activated: activatedCount ?? 0 });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
