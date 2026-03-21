// supabase/functions/mailer-invite/index.ts
// Sends invite emails via the shared transactional mailer. Requires authenticated MANAGER+ membership.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getMailConfig,
  requireMailConfig,
  sendTransactionalEmail,
} from "../_shared/mailer.ts";
import {
  enforceRateLimit,
  getClientIp,
  HttpError,
  optionalText,
  readJsonBody,
  requireEmail,
  requireText,
} from "../_shared/security.ts";

type Role = "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";
type Status = "invited" | "active" | "disabled";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";
const ANON_KEY = Deno.env.get("SB_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const MAIL = requireMailConfig(getMailConfig());
const MAIL_FROM = MAIL.defaultFromEmail || "no-reply@stockwiseapp.com";
const MAIL_FROM_NAME = MAIL.defaultFromName || "StockWise";
const MAIL_REPLY_TO = MAIL.defaultReplyToEmail || MAIL_FROM;
const PUBLIC_SITE_URL = (MAIL.publicSiteUrl ?? "").replace(/\/+$/, "");
const MAILER_ALLOWED_ORIGINS = (Deno.env.get("MAILER_ALLOWED_ORIGINS") ?? PUBLIC_SITE_URL)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error("Missing one of SB_URL / SB_SERVICE_ROLE_KEY / SB_ANON_KEY (or SUPABASE_* fallbacks)");
}

function j(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors, ...extraHeaders },
  });
}

function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function getBearer(req: Request): string {
  const auth = req.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : auth;
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

function parseMode(value: unknown): "email" | "preview" {
  return String(value ?? "email").trim().toLowerCase() === "preview" ? "preview" : "email";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isAllowedInviteLink(inviteLink: string): boolean {
  let url: URL;
  try {
    url = new URL(inviteLink);
  } catch {
    return false;
  }

  if (!MAILER_ALLOWED_ORIGINS.length) return true;
  return MAILER_ALLOWED_ORIGINS.some((allowed) => {
    try {
      const allowedUrl = new URL(allowed);
      return allowedUrl.origin === url.origin;
    } catch {
      return false;
    }
  });
}

async function getActorRole(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  userId: string,
  userEmail: string
): Promise<Role | null> {
  const { data: byUser, error: byUserErr } = await admin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .in("status", ["active", "invited"]);

  if (byUserErr) throw byUserErr;
  const activeUserRole = (byUser ?? [])
    .filter((r) => r.status === "active")
    .map((r) => r.role as Role)
    .sort((a, b) => roleRank(a) - roleRank(b))[0];
  if (activeUserRole) return activeUserRole;

  if (!userEmail) return null;

  const { data: byEmail, error: byEmailErr } = await admin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("email", userEmail)
    .in("status", ["active", "invited"]);

  if (byEmailErr) throw byEmailErr;
  const activeEmailRole = (byEmail ?? [])
    .filter((r) => r.status === "active")
    .map((r) => r.role as Role)
    .sort((a, b) => roleRank(a) - roleRank(b))[0];
  return activeEmailRole ?? null;
}

async function getInviteRow(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  email: string
): Promise<{ role: Role; status: Status } | null> {
  const { data, error } = await admin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { role: data.role as Role, status: data.status as Status };
}

function htmlTemplate(opts: {
  companyName: string;
  inviteLink: string;
  role?: string;
  inviterName?: string;
  brandName: string;
}) {
  const companyName = escapeHtml(opts.companyName);
  const inviteLink = escapeHtml(opts.inviteLink);
  const role = opts.role ? escapeHtml(opts.role) : "";
  const inviterName = opts.inviterName ? escapeHtml(opts.inviterName) : "";
  const brandName = escapeHtml(opts.brandName);

  const roleLine = role ? ` as <strong>${role}</strong>` : "";
  const inviter = inviterName ? ` - invited by ${inviterName}` : "";
  const preheader = `You have been invited to join ${companyName}${role ? ` as ${role}` : ""}.`;

  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;padding:16px;line-height:1.5;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${preheader}
    </div>

    <h2 style="margin:0 0 8px 0;font-size:20px;">${brandName} - Invitation</h2>
    <p style="margin:0 0 8px 0;color:#555;">
      You have been invited to join <strong>${companyName}</strong>${roleLine}${inviter}.
    </p>
    <p style="margin:0 0 16px 0;color:#555;">
      Click the button below to accept the invitation and finish setting up your account.
    </p>

    <p style="margin:0 0 24px 0;">
      <a href="${inviteLink}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">
        Accept Invitation
      </a>
    </p>

    <p style="font-size:12px;color:#777;">
      If the button does not work, paste this link into your browser:<br/>
      <span style="word-break:break-all;">${inviteLink}</span>
    </p>

    <p style="font-size:12px;color:#999;margin-top:24px;">
      Sent by ${brandName}.
    </p>
  </div>`;
}

function textTemplate(opts: {
  companyName: string;
  inviteLink: string;
  role?: string;
  inviterName?: string;
  brandName: string;
}) {
  const roleLine = opts.role ? ` as ${opts.role}` : "";
  const inviter = opts.inviterName ? ` - invited by ${opts.inviterName}` : "";
  return `${opts.brandName} - Invitation

You have been invited to join ${opts.companyName}${roleLine}${inviter}.
Accept your invitation:
${opts.inviteLink}

If you cannot click, paste the link above into your browser.`;
}

async function sendInviteEmail(to: string, subject: string, html: string, text: string) {
  if (!MAIL.smtpLogin || !MAIL.smtpKey || !MAIL_FROM) {
    return j(
      { error: "server_misconfigured", details: "BREVO_SMTP_LOGIN/BREVO_SMTP_KEY and/or BREVO_SENDER_EMAIL not set" },
      500,
      { "x-error": "missing BREVO_SMTP_LOGIN/BREVO_SMTP_KEY or BREVO_SENDER_EMAIL" }
    );
  }
  try {
    await sendTransactionalEmail({
      to: [to],
      subject,
      html,
      text,
      fromEmail: MAIL_FROM,
      fromName: MAIL_FROM_NAME,
      replyTo: MAIL_REPLY_TO,
    }, MAIL, { notificationType: "invite_email", workerId: "mailer-invite" });
    return j({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return j(
      { error: "mail_delivery_failed", details: msg },
      500,
      { "x-error": "mail:failed" }
    );
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  try {
    const body = await readJsonBody(req, 8192);

    const companyId = requireText(body.company_id, "company_id", 64);
    const email = requireEmail(body.email);
    const inviteLink = requireText(body.invite_link ?? body.link, "invite_link", 2048);
    const companyName = optionalText(body.company_name ?? body.companyName, 160) ?? "Your company";
    const inviterName = optionalText(body.inviter_name ?? body.inviterName, 160);
    const mode = parseMode(body.mode);

    if (!isAllowedInviteLink(inviteLink)) return j({ error: "invite_link_not_allowed" }, 400);

    const jwt = getBearer(req);
    if (!jwt) return j({ error: "missing_bearer_token" }, 401);

    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userData?.user) return j({ error: "invalid_token" }, 401);

    const userId = userData.user.id;
    const userEmail = normalizeEmail(userData.user.email);
    const clientIp = getClientIp(req) ?? "unknown";

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const actorRole = await getActorRole(admin, companyId, userId, userEmail);
    if (!actorRole || roleRank(actorRole) > roleRank("MANAGER")) {
      return j({ error: "not_privileged" }, 403);
    }

    await enforceRateLimit(admin, {
      scope: mode === "preview" ? "mailer-invite:preview" : "mailer-invite:send",
      subject: `${companyId}:${userId}:${clientIp}`,
      windowSeconds: mode === "preview" ? 300 : 900,
      maxHits: mode === "preview" ? 20 : 10,
    });
    await enforceRateLimit(admin, {
      scope: "mailer-invite:recipient",
      subject: `${companyId}:${email}:${clientIp}`,
      windowSeconds: 1800,
      maxHits: 3,
    });

    const invite = await getInviteRow(admin, companyId, email);
    if (!invite) return j({ error: "invite_not_found" }, 404);
    if (invite.status === "disabled") return j({ error: "invite_disabled" }, 400);
    if (!canInviteRole(actorRole, invite.role)) return j({ error: "role_not_allowed" }, 403);

    const subject = `${MAIL_FROM_NAME} - Invitation to join ${companyName}`;
    const html = htmlTemplate({
      companyName,
      inviteLink,
      role: invite.role,
      inviterName,
      brandName: MAIL_FROM_NAME,
    });
    const text = textTemplate({
      companyName,
      inviteLink,
      role: invite.role,
      inviterName,
      brandName: MAIL_FROM_NAME,
    });

    if (mode === "preview") return j({ ok: true, preview: { subject, text, html } });

    return await sendInviteEmail(email, subject, html, text);
  } catch (e) {
    if (e instanceof HttpError) {
      return j({ error: e.code, details: e.details }, e.status, { "x-error": e.code });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return j({ error: "unexpected", details: msg }, 500, { "x-error": msg });
  }
});
