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

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error("Missing one of SB_URL / SB_SERVICE_ROLE_KEY / SB_ANON_KEY (or SUPABASE_* fallbacks)");
}

// ---- Hard-coded redirect for dev (same machine) ----
const REDIRECT_TO = "http://localhost:3000/auth/callback";

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

    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "invalid token" }, 401);
    const userId = userData.user.id;
    const userEmail = userData.user.email ?? "";

    // service role client (bypasses RLS)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const url = new URL(req.url);
    const pathname = url.pathname;
    const companyId = url.searchParams.get("company_id");

    // Helper: only allow OWNER/ADMIN/MANAGER & active
    async function assertPrivileged(company_id: string) {
      const { data: me, error: meErr } = await admin
        .from("company_members")
        .select("role,status")
        .eq("company_id", company_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (meErr) return `db: ${meErr.message}`;
      if (!me) return "not_member";
      if (me.status !== "active") return "inactive";
      if (!["OWNER", "ADMIN", "MANAGER"].includes(me.role as Role)) return "not_privileged";
      return null;
    }

    // ---------- GET /?company_id=... ----------
    if (req.method === "GET") {
      if (!companyId) return json({ error: "company_id is required" }, 400);

      const guard = await assertPrivileged(companyId);
      if (guard) return json({ error: "forbidden" }, 403);

      const { data: rows, error: rowsErr } = await admin
        .from("company_members")
        .select("email,user_id,role,status,invited_by,created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });

      if (rowsErr) return json({ error: rowsErr.message }, 400);

      // enrich with auth meta
      const userIds = rows.map((r) => r.user_id).filter(Boolean) as string[];
      const meta = new Map<string, { last_sign_in_at: string | null; email_confirmed_at: string | null }>();
      if (userIds.length) {
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        for (const u of list?.users ?? []) {
          if (userIds.includes(u.id)) {
            meta.set(u.id, {
              last_sign_in_at: u.last_sign_in_at ?? null,
              email_confirmed_at: u.email_confirmed_at ?? null,
            });
          }
        }
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
      if (guard) return json({ error: "forbidden" }, 403);

      // create / update invitation row
      const { error: upErr } = await admin.from("company_members").upsert({
        company_id,
        email: String(email).toLowerCase(),
        role: (role ?? "VIEWER") as Role,
        status: "invited" as Status,
        invited_by: userId,
      }, { onConflict: "company_id,email" });
      if (upErr) return json({ error: upErr.message }, 400);

      // send Auth invite email -> ALWAYS redirect to /auth/callback on localhost
      try {
        await admin.auth.admin.inviteUserByEmail(String(email).toLowerCase(), {
          redirectTo: REDIRECT_TO,
        });
        return json({ ok: true });
      } catch (_e) {
        return json({ ok: true, warning: "invite_email_failed" });
      }
    }

    // ---------- POST /reinvite ----------
    if (req.method === "POST" && pathname.endsWith("/reinvite")) {
      const body = await req.json().catch(() => ({}));
      const { company_id, email } = body as { company_id?: string; email?: string };
      if (!company_id || !email) return json({ error: "company_id and email required" }, 400);

      const guard = await assertPrivileged(company_id);
      if (guard) return json({ error: "forbidden" }, 403);

      try {
        await admin.auth.admin.inviteUserByEmail(String(email).toLowerCase(), {
          redirectTo: REDIRECT_TO,
        });
        return json({ ok: true });
      } catch (_e) {
        return json({ error: "invite email failed" }, 400);
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
      if (guard) return json({ error: "forbidden" }, 403);

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
      if (guard) return json({ error: "forbidden" }, 403);

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

    // ---------- POST /sync (link invites to current user) ----------
    if (req.method === "POST" && pathname.endsWith("/sync")) {
      const { data, error } = await admin.rpc("link_invites_to_user", {
        p_user_id: userId,
        p_email: userEmail,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, linked: data ?? 0 });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
