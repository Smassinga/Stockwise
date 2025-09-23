// Sends one Daily Digest via SendGrid. Uses SERVICE_ROLE_KEY to bypass RLS.
// Adds a simple auth gate: X-Webhook-Secret header (or ?key= when DEBUG_ACCEPT_QUERY_KEY=true).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type DigestQueueRow = {
  id: number;
  company_id: string;
  run_for_local_date: string;
  timezone: string;
  payload: {
    channels?: { email?: boolean; sms?: boolean; whatsapp?: boolean };
    recipients?: { emails?: string[]; phones?: string[]; whatsapp?: string[] };
  };
  status: "pending" | "processing" | "done" | "failed";
  created_at: string;
};

type DigestPayload = {
  window: { local_day: string; timezone: string; start_utc: string; end_utc: string };
  totals: { revenue: number; cogs: number; gross_profit: number; gross_margin_pct: number };
  by_product: Array<{
    item_id: string;
    item_name?: string;
    item_sku?: string;
    item_label?: string;
    uom_code?: string;
    uom_family?: string;
    qty: number;
    revenue: number;
    cogs: number;
    gross_profit: number;
    gross_margin_pct: number;
  }>;
};

const SENDGRID_API_KEY   = Deno.env.get("SENDGRID_API_KEY")   ?? "";
const FROM_EMAIL         = Deno.env.get("FROM_EMAIL")         ?? "no-reply@stockwiseapp.com";
const REPLY_TO_EMAIL     = Deno.env.get("REPLY_TO_EMAIL")     ?? "support@stockwiseapp.com";
const BRAND_NAME         = Deno.env.get("BRAND_NAME")         ?? "Stockwise";
const DRY_RUN            = (Deno.env.get("DRY_RUN") ?? "").toLowerCase() === "true";

const SUPABASE_URL       = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY   = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const DIGEST_HOOK_SECRET = Deno.env.get("DIGEST_HOOK_SECRET") ?? "";
const DEBUG_ACCEPT_QUERY_KEY = (Deno.env.get("DEBUG_ACCEPT_QUERY_KEY") ?? "false").toLowerCase() === "true";
const DEBUG_LOG          = (Deno.env.get("DEBUG_LOG") ?? "false").toLowerCase() === "true";

function supa() {
  if (!SERVICE_ROLE_KEY) throw new Error("SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function currency(n: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function htmlEmail(d: DigestPayload): string {
  const rows = d.by_product.map((p) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;">${p.item_label || p.item_name || p.item_id}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${p.qty}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${currency(p.revenue)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${currency(p.cogs)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${currency(p.gross_profit)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">${p.gross_margin_pct}%</td>
    </tr>
  `).join("");

  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:720px;padding:16px;">
    <h2 style="margin:0 0 8px 0;">${BRAND_NAME} — Daily Digest</h2>
    <div style="color:#666;margin-bottom:16px;">${d.window.local_day} (${d.window.timezone})</div>

    <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="padding:8px;background:#f7f7f7;">Revenue</td><td style="padding:8px;background:#f7f7f7;text-align:right;">${currency(d.totals.revenue)}</td></tr>
      <tr><td style="padding:8px;">COGS</td><td style="padding:8px;text-align:right;">${currency(d.totals.cogs)}</td></tr>
      <tr><td style="padding:8px;">Gross Profit</td><td style="padding:8px;text-align:right;">${currency(d.totals.gross_profit)}</td></tr>
      <tr><td style="padding:8px;">Gross Margin</td><td style="padding:8px;text-align:right;">${d.totals.gross_margin_pct}%</td></tr>
    </table>

    <h3 style="margin:16px 0 8px 0;">By Product</h3>
    <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f7f7f7;">
          <th style="padding:6px 8px;text-align:left;">Item</th>
          <th style="padding:6px 8px;text-align:right;">Qty</th>
          <th style="padding:6px 8px;text-align:right;">Revenue</th>
          <th style="padding:6px 8px;text-align:right;">COGS</th>
          <th style="padding:6px 8px;text-align:right;">Gross Profit</th>
          <th style="padding:6px 8px;text-align:right;">GM%</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" style="padding:10px;color:#666;">No product rows for this day.</td></tr>`}
      </tbody>
    </table>

    <div style="color:#999;margin-top:16px;font-size:12px;">
      Window (UTC): ${d.window.start_utc} → ${d.window.end_utc}
    </div>
  </div>
  `;
}

async function sendViaSendGrid(to: string[], subject: string, html: string) {
  const body = {
    personalizations: [{ to: to.map((e) => ({ email: e })) }],
    from: { email: FROM_EMAIL, name: BRAND_NAME },
    reply_to: { email: REPLY_TO_EMAIL },
    subject,
    content: [{ type: "text/html", value: html }],
  };
  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (resp.status !== 202) {
    const msg = await resp.text();
    throw new Error(`SendGrid error: ${resp.status} ${msg}`);
  }
}

function authorized(req: Request): boolean {
  if (!DIGEST_HOOK_SECRET) return false;
  const hdr = req.headers.get("x-webhook-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";

  const ok =
    hdr === DIGEST_HOOK_SECRET ||
    bearer === DIGEST_HOOK_SECRET ||
    (DEBUG_ACCEPT_QUERY_KEY && key === DIGEST_HOOK_SECRET);

  if (DEBUG_LOG) {
    console.log("[auth] hdr:", hdr ? "set" : "empty",
                "bearerLen:", bearer.length,
                "querySet:", key ? "yes" : "no",
                "ok:", ok);
  }
  return ok;
}

serve(async (req: Request) => {
  try {
    if (!authorized(req)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const supabase = supa();

    const { data: jobs, error: qErr } = await supabase
      .from("digest_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);

    if (qErr) {
      return new Response(JSON.stringify({ ok: false, error: qErr.message }), { status: 500 });
    }
    if (!jobs?.length) {
      return new Response(JSON.stringify({ ok: true, mode: DRY_RUN ? "dry" : "live", message: "no pending jobs" }), {
        status: 200,
      });
    }

    const job = jobs[0] as DigestQueueRow;

    // Claim atomically
    const { error: claimErr } = await supabase
      .from("digest_queue")
      .update({ status: "processing" })
      .eq("id", job.id)
      .eq("status", "pending");
    if (claimErr) {
      return new Response(JSON.stringify({ ok: false, error: claimErr.message }), { status: 500 });
    }

    // Verify we have it
    const { data: claimed } = await supabase.from("digest_queue").select("status").eq("id", job.id).limit(1);
    if (!claimed || claimed[0]?.status !== "processing") {
      return new Response(JSON.stringify({ ok: true, message: "job already taken" }), { status: 200 });
    }

    // Build digest payload via SQL
    const { data: payload, error: rpcErr } = await supabase.rpc("build_daily_digest_payload", {
      p_company_id: job.company_id,
      p_local_day: job.run_for_local_date,
      p_timezone: job.timezone,
    });
    if (rpcErr) throw rpcErr;

    const digest = payload as DigestPayload;

    const emails = job.payload?.recipients?.emails ?? [];
    const wantsEmail = job.payload?.channels?.email !== false;
    if (!emails.length || !wantsEmail) throw new Error("No email recipients configured for this job.");

    const subject = `${BRAND_NAME} — Daily Digest (${digest.window.local_day})`;
    const html = htmlEmail(digest);

    if (DRY_RUN) {
      console.log("[DRY_RUN] Would send digest to:", emails);
    } else {
      if (!SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not set");
      await sendViaSendGrid(emails, subject, html);
    }

    await supabase
      .from("digest_queue")
      .update({ status: "done", processed_at: new Date().toISOString(), error: null })
      .eq("id", job.id);

    await supabase
      .from("company_digest_state")
      .update({ last_status: "sent", last_error: null, last_attempt_at: new Date().toISOString() })
      .eq("company_id", job.company_id);

    return new Response(JSON.stringify({ ok: true, mode: DRY_RUN ? "dry" : "live", message: "sent" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
