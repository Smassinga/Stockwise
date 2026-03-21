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
  requireText,
} from "../_shared/security.ts";

type Role = "OWNER" | "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const MAIL = requireMailConfig(getMailConfig());
const SUPABASE_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";
const ANON_KEY = Deno.env.get("SB_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error("Missing one of SB_URL / SB_SERVICE_ROLE_KEY / SB_ANON_KEY (or SUPABASE_* fallbacks)");
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors, ...extraHeaders },
  });
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeEmails(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => normalizeEmail(value))
    .filter((value, index, list) => /\S+@\S+\.\S+/.test(value) && list.indexOf(value) === index);
}

function getBearer(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : auth;
}

function roleRank(role: Role) {
  return { OWNER: 0, ADMIN: 1, MANAGER: 2, OPERATOR: 3, VIEWER: 4 }[role] ?? 99;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function getActorRole(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  userId: string,
  userEmail: string,
): Promise<Role | null> {
  const { data: byUser, error: byUserErr } = await admin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (byUserErr) throw byUserErr;
  const activeUserRole = (byUser ?? [])
    .map((row) => row.role as Role)
    .sort((a, b) => roleRank(a) - roleRank(b))[0];
  if (activeUserRole) return activeUserRole;

  if (!userEmail) return null;
  const { data: byEmail, error: byEmailErr } = await admin
    .from("company_members")
    .select("role,status")
    .eq("company_id", companyId)
    .eq("email", userEmail)
    .eq("status", "active");
  if (byEmailErr) throw byEmailErr;
  return (byEmail ?? [])
    .map((row) => row.role as Role)
    .sort((a, b) => roleRank(a) - roleRank(b))[0] ?? null;
}

function textTemplate(opts: {
  brandName: string;
  companyName: string;
  reportTitle: string;
  reportPeriod?: string;
  message?: string;
  downloadUrl?: string;
}) {
  return [
    `${opts.brandName} - ${opts.reportTitle}`,
    "",
    `Company: ${opts.companyName}`,
    opts.reportPeriod ? `Period: ${opts.reportPeriod}` : "",
    opts.message || "Your report is ready.",
    opts.downloadUrl ? `Download: ${opts.downloadUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function htmlTemplate(opts: {
  brandName: string;
  companyName: string;
  reportTitle: string;
  reportPeriod?: string;
  message?: string;
  downloadUrl?: string;
}) {
  return `
    <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;padding:16px;line-height:1.5;color:#0f172a;">
      <h2 style="margin:0 0 8px 0;font-size:20px;">${escapeHtml(opts.brandName)} - ${escapeHtml(opts.reportTitle)}</h2>
      <p style="margin:0 0 8px 0;color:#475569;"><strong>Company:</strong> ${escapeHtml(opts.companyName)}</p>
      ${opts.reportPeriod ? `<p style="margin:0 0 8px 0;color:#475569;"><strong>Period:</strong> ${escapeHtml(opts.reportPeriod)}</p>` : ""}
      <p style="margin:0 0 16px 0;color:#475569;">${escapeHtml(opts.message || "Your report is ready.")}</p>
      ${
        opts.downloadUrl
          ? `<p style="margin:0 0 20px 0;"><a href="${escapeHtml(opts.downloadUrl)}" style="display:inline-block;background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">Open report</a></p>`
          : ""
      }
      <p style="font-size:12px;color:#94a3b8;">Sent by ${escapeHtml(opts.brandName)}.</p>
    </div>
  `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await readJsonBody(req, 16 * 1024);
    const companyId = requireText(body.company_id, "company_id", 64);
    const to = normalizeEmails(body.to);
    const reportTitle = requireText(body.report_title ?? body.title, "report_title", 160);
    const reportPeriod = optionalText(body.report_period, 120) ?? "";
    const downloadUrl = optionalText(body.download_url ?? body.url, 2048) ?? "";
    const message = optionalText(body.message, 2000) ?? "";

    if (!to.length) return json({ error: "recipient_required" }, 400);
    if (to.length > 10) return json({ error: "too_many_recipients" }, 400);

    const jwt = getBearer(req);
    if (!jwt) return json({ error: "missing_bearer_token" }, 401);

    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: userData, error: userErr } = await anon.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401);

    const userId = userData.user.id;
    const userEmail = normalizeEmail(userData.user.email);
    const clientIp = getClientIp(req) ?? "unknown";
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const actorRole = await getActorRole(admin, companyId, userId, userEmail);
    if (!actorRole || roleRank(actorRole) > roleRank("MANAGER")) {
      return json({ error: "not_privileged" }, 403);
    }

    await enforceRateLimit(admin, {
      scope: "mailer-report:send",
      subject: `${companyId}:${userId}:${clientIp}`,
      windowSeconds: 3600,
      maxHits: 6,
    });

    const { data: company, error: companyErr } = await admin
      .from("companies")
      .select("name,trade_name,legal_name,email_subject_prefix,email")
      .eq("id", companyId)
      .maybeSingle();
    if (companyErr) throw companyErr;

    const brandName =
      company?.email_subject_prefix?.trim() ||
      company?.trade_name?.trim() ||
      company?.legal_name?.trim() ||
      company?.name?.trim() ||
      MAIL.defaultFromName ||
      "StockWise";
    const companyName =
      company?.trade_name?.trim() ||
      company?.legal_name?.trim() ||
      company?.name?.trim() ||
      "Your company";
    const subject = `${brandName} - ${reportTitle}${reportPeriod ? ` (${reportPeriod})` : ""}`;
    const html = htmlTemplate({ brandName, companyName, reportTitle, reportPeriod, message, downloadUrl });
    const text = textTemplate({ brandName, companyName, reportTitle, reportPeriod, message, downloadUrl });

    await sendTransactionalEmail({
      to,
      subject,
      html,
      text,
      fromName: brandName,
      replyTo: company?.email || MAIL.defaultReplyToEmail,
    }, MAIL, { notificationType: "report_email", workerId: "mailer-report" });

    return json({ ok: true, sent: to.length });
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.code, details: error.details }, error.status, { "x-error": error.code });
    }
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: "unexpected", details: message }, 500, { "x-error": message });
  }
});
