// supabase/functions/mailer-invite/index.ts
// Public function (no JWT) that sends invite emails via SendGrid.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// ---- CORS ----
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

// ---- Env (with sensible fallbacks to your existing names) ----
const SENDGRID_API_KEY =
  Deno.env.get("SENDGRID_API_KEY") ??
  Deno.env.get("SG_API_KEY") ??
  "";

const MAIL_FROM =
  Deno.env.get("MAIL_FROM") ??
  Deno.env.get("FROM_EMAIL") ??                // your digest-worker env
  "no-reply@stockwiseapp.com";

const MAIL_FROM_NAME =
  Deno.env.get("MAIL_FROM_NAME") ??
  Deno.env.get("BRAND_NAME") ??                // your digest-worker env
  "StockWise";

const MAIL_REPLY_TO =
  Deno.env.get("MAIL_REPLY_TO") ??
  Deno.env.get("REPLY_TO_EMAIL") ??            // your digest-worker env
  MAIL_FROM;

function j(body: unknown, status = 200, extraHeaders: Record<string,string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors, ...extraHeaders },
  });
}

function htmlTemplate(opts: {
  companyName: string;
  inviteLink: string;
  role?: string;
  inviterName?: string;
  brandName: string;
}) {
  const { companyName, inviteLink, role, inviterName, brandName } = opts;
  const roleLine = role ? ` as <strong>${role}</strong>` : "";
  const inviter = inviterName ? ` — invited by ${inviterName}` : "";
  const preheader = `You’ve been invited to join ${companyName}${role ? ` as ${role}` : ""}.`;

  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;padding:16px;line-height:1.5;">
    <!-- preheader -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${preheader}
    </div>

    <h2 style="margin:0 0 8px 0;font-size:20px;">${brandName} — Invitation</h2>
    <p style="margin:0 0 8px 0;color:#555;">
      You’ve been invited to join <strong>${companyName}</strong>${roleLine}${inviter}.
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
      If the button doesn’t work, paste this link into your browser:<br/>
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
  const { companyName, inviteLink, role, inviterName, brandName } = opts;
  const roleLine = role ? ` as ${role}` : "";
  const inviter = inviterName ? ` — invited by ${inviterName}` : "";
  return `${brandName} — Invitation

You’ve been invited to join ${companyName}${roleLine}${inviter}.
Accept your invitation:
${inviteLink}

If you can’t click, paste the link above into your browser.`;
}

async function sendViaSendGrid(to: string, subject: string, html: string, text: string) {
  if (!SENDGRID_API_KEY || !MAIL_FROM) {
    return j(
      { error: "server_misconfigured", details: "SENDGRID_API_KEY and/or MAIL_FROM not set" },
      500,
      { "x-error": "missing SENDGRID_API_KEY or MAIL_FROM" }
    );
  }
  const body = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: MAIL_FROM, name: MAIL_FROM_NAME },
    reply_to: { email: MAIL_REPLY_TO },
    subject,
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html },
    ],
  };

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (resp.status !== 202) {
    const msg = await resp.text().catch(() => "");
    return j(
      { error: "sendgrid_failed", details: `${resp.status} ${msg}` },
      500,
      { "x-error": `sendgrid:${resp.status}` }
    );
  }

  return j({ ok: true });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    // Accept multiple field names for robustness with your client
    const email = String(body.email ?? "").trim().toLowerCase();
    const inviteLink = String(body.invite_link ?? body.link ?? "").trim();
    const companyName = String(body.company_name ?? body.companyName ?? "Your company");
    const role = body.role ? String(body.role) : undefined;
    const inviterName = body.inviter_name
      ? String(body.inviter_name)
      : (body.inviterName ? String(body.inviterName) : undefined);
    const brandName = MAIL_FROM_NAME;

    if (!email) return j({ error: "email_required" }, 400);
    if (!inviteLink) return j({ error: "invite_link_required" }, 400);

    const subject = `${brandName} — Invitation to join ${companyName}`;
    const html = htmlTemplate({ companyName, inviteLink, role, inviterName, brandName });
    const text = textTemplate({ companyName, inviteLink, role, inviterName, brandName });

    // Optional preview mode (no send)
    const mode = String(body.mode ?? "email");
    if (mode === "preview") return j({ ok: true, preview: { subject, text, html } });

    return await sendViaSendGrid(email, subject, html, text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return j({ error: "unexpected", details: msg }, 500, { "x-error": msg });
  }
});
