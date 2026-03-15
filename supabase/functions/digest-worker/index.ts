// Sends one daily digest email through SendGrid.
// Auth gate: X-Webhook-Secret header, Authorization: Bearer <secret>, or ?key= when DEBUG_ACCEPT_QUERY_KEY=true.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMailConfig, sendMailViaSendGrid } from "../_shared/sendgrid.ts";

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
  attempts?: number | null;
  next_attempt_at?: string | null;
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

type CompanyRow = {
  name?: string | null;
  trade_name?: string | null;
  legal_name?: string | null;
  email_subject_prefix?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  print_footer_note?: string | null;
};

const MAIL = getMailConfig();
const FALLBACK_BRAND = MAIL.defaultFromName || "StockWise";
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "").toLowerCase() === "true";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DIGEST_HOOK_SECRET = Deno.env.get("DIGEST_HOOK_SECRET") ?? "";
const DEBUG_ACCEPT_QUERY_KEY = (Deno.env.get("DEBUG_ACCEPT_QUERY_KEY") ?? "false").toLowerCase() === "true";
const DEBUG_LOG = (Deno.env.get("DEBUG_LOG") ?? "false").toLowerCase() === "true";
const MAX_ATTEMPTS = Number(Deno.env.get("DIGEST_MAX_ATTEMPTS") ?? "5");

function supa() {
  if (!SERVICE_ROLE_KEY) throw new Error("SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function log(...args: unknown[]) {
  if (DEBUG_LOG) console.log(...args);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function currency(value: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function ddmmyyyy(localDayISO: string) {
  const [y, m, d] = localDayISO.split("-").map(Number);
  if (!y || !m || !d) return localDayISO;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function companyBrand(company?: CompanyRow | null) {
  return (
    company?.email_subject_prefix?.trim() ||
    company?.trade_name?.trim() ||
    company?.legal_name?.trim() ||
    company?.name?.trim() ||
    FALLBACK_BRAND
  );
}

function companyLabel(company?: CompanyRow | null) {
  return company?.trade_name?.trim() || company?.legal_name?.trim() || company?.name?.trim() || FALLBACK_BRAND;
}

function companyAddress(company?: CompanyRow | null) {
  return [
    company?.address_line1,
    company?.address_line2,
    [company?.city, company?.state].filter(Boolean).join(", "),
    company?.postal_code,
  ]
    .filter(Boolean)
    .join(" | ");
}

function textEmail(digest: DigestPayload, company?: CompanyRow | null) {
  const brand = companyBrand(company);
  const label = companyLabel(company);
  const lines: string[] = [];

  lines.push(`${brand} - Daily Digest`);
  lines.push(`Date: ${ddmmyyyy(digest.window.local_day)} (${digest.window.timezone})`);
  lines.push(`Company: ${label}`);
  lines.push("");
  lines.push(`Revenue: ${currency(digest.totals.revenue)}`);
  lines.push(`COGS: ${currency(digest.totals.cogs)}`);
  lines.push(`Gross Profit: ${currency(digest.totals.gross_profit)}`);
  lines.push(`Gross Margin: ${digest.totals.gross_margin_pct}%`);
  lines.push("");
  lines.push("Top products:");

  if (!digest.by_product.length) {
    lines.push("- No product rows for this day.");
  } else {
    for (const row of digest.by_product.slice(0, 20)) {
      const labelText = row.item_label || row.item_name || row.item_id;
      lines.push(
        `- ${labelText} | Qty ${row.qty} | Revenue ${currency(row.revenue)} | COGS ${currency(row.cogs)} | GP ${currency(row.gross_profit)} | GM ${row.gross_margin_pct}%`,
      );
    }
  }

  lines.push("");
  lines.push(`Window (UTC): ${digest.window.start_utc} -> ${digest.window.end_utc}`);

  const address = companyAddress(company);
  if (company?.email || company?.phone || company?.website || address) {
    lines.push("");
    lines.push("Contact:");
    if (company?.email) lines.push(`Email: ${company.email}`);
    if (company?.phone) lines.push(`Phone: ${company.phone}`);
    if (company?.website) lines.push(`Website: ${company.website}`);
    if (address) lines.push(`Address: ${address}`);
  }

  if (company?.print_footer_note) {
    lines.push("");
    lines.push(company.print_footer_note);
  }

  return lines.join("\n");
}

function htmlEmail(digest: DigestPayload, company?: CompanyRow | null) {
  const brand = escapeHtml(companyBrand(company));
  const label = escapeHtml(companyLabel(company));
  const address = escapeHtml(companyAddress(company));
  const rows = digest.by_product
    .slice(0, 20)
    .map((row) => {
      const labelText = escapeHtml(row.item_label || row.item_name || row.item_id);
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;">${labelText}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${row.qty}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${currency(row.revenue)}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${currency(row.cogs)}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${currency(row.gross_profit)}</td>
          <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;">${row.gross_margin_pct}%</td>
        </tr>
      `;
    })
    .join("");

  return `
    <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;padding:24px;line-height:1.5;color:#0f172a;">
      <div style="margin-bottom:20px;">
        <div style="font-size:22px;font-weight:700;">${brand}</div>
        <div style="font-size:14px;color:#475569;">Daily Digest for ${escapeHtml(ddmmyyyy(digest.window.local_day))}</div>
      </div>

      <div style="padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;margin-bottom:20px;">
        <div style="font-size:16px;font-weight:600;margin-bottom:6px;">${label}</div>
        <div style="font-size:13px;color:#64748b;">${escapeHtml(digest.window.local_day)} (${escapeHtml(digest.window.timezone)})</div>
      </div>

      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr>
          <td style="padding:10px;background:#eff6ff;border:1px solid #bfdbfe;font-weight:600;">Revenue</td>
          <td style="padding:10px;background:#eff6ff;border:1px solid #bfdbfe;text-align:right;">${currency(digest.totals.revenue)}</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #e2e8f0;">COGS</td>
          <td style="padding:10px;border:1px solid #e2e8f0;text-align:right;">${currency(digest.totals.cogs)}</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #e2e8f0;">Gross Profit</td>
          <td style="padding:10px;border:1px solid #e2e8f0;text-align:right;">${currency(digest.totals.gross_profit)}</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #e2e8f0;">Gross Margin</td>
          <td style="padding:10px;border:1px solid #e2e8f0;text-align:right;">${digest.totals.gross_margin_pct}%</td>
        </tr>
      </table>

      <h3 style="margin:0 0 10px 0;font-size:16px;">Top products</h3>
      <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th align="left" style="padding:8px;">Item</th>
            <th align="right" style="padding:8px;">Qty</th>
            <th align="right" style="padding:8px;">Revenue</th>
            <th align="right" style="padding:8px;">COGS</th>
            <th align="right" style="padding:8px;">Gross Profit</th>
            <th align="right" style="padding:8px;">GM%</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6" style="padding:12px;border:1px solid #e2e8f0;color:#64748b;">No product rows for this day.</td></tr>`}
        </tbody>
      </table>

      <div style="font-size:12px;color:#64748b;margin-bottom:16px;">
        Window (UTC): ${escapeHtml(digest.window.start_utc)} -> ${escapeHtml(digest.window.end_utc)}
      </div>

      ${
        company?.email || company?.phone || company?.website || address || company?.print_footer_note
          ? `
            <div style="padding-top:12px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569;">
              ${company?.email ? `<div>Email: ${escapeHtml(company.email)}</div>` : ""}
              ${company?.phone ? `<div>Phone: ${escapeHtml(company.phone)}</div>` : ""}
              ${company?.website ? `<div>Website: ${escapeHtml(company.website)}</div>` : ""}
              ${address ? `<div>Address: ${address}</div>` : ""}
              ${company?.print_footer_note ? `<div style="margin-top:8px;color:#64748b;">${escapeHtml(company.print_footer_note)}</div>` : ""}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function authorized(req: Request) {
  if (!DIGEST_HOOK_SECRET) return false;
  const headerSecret = req.headers.get("x-webhook-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const querySecret = new URL(req.url).searchParams.get("key") ?? "";
  const ok =
    headerSecret === DIGEST_HOOK_SECRET ||
    bearer === DIGEST_HOOK_SECRET ||
    (DEBUG_ACCEPT_QUERY_KEY && querySecret === DIGEST_HOOK_SECRET);
  log("[auth]", { header: !!headerSecret, bearer: !!bearer, query: !!querySecret, ok });
  return ok;
}

serve(async (req: Request) => {
  let claimedJobId: number | null = null;
  let claimedCompanyId: string | null = null;
  let claimedAttempts = 0;

  try {
    if (!authorized(req)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    const supabase = supa();
    const nowIso = new Date().toISOString();
    const { data: jobs, error: queueError } = await supabase
      .from("digest_queue")
      .select("*")
      .eq("status", "pending")
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .order("created_at", { ascending: true })
      .limit(1);

    if (queueError) {
      return new Response(JSON.stringify({ ok: false, error: queueError.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    if (!jobs?.length) {
      return new Response(JSON.stringify({ ok: true, mode: DRY_RUN ? "dry" : "live", message: "no pending jobs" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const candidate = jobs[0] as DigestQueueRow;
    const { data: job, error: claimError } = await supabase
      .from("digest_queue")
      .update({ status: "processing" })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (claimError) {
      return new Response(JSON.stringify({ ok: false, error: claimError.message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    if (!job) {
      return new Response(JSON.stringify({ ok: true, message: "job already taken" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    claimedJobId = job.id;
    claimedCompanyId = job.company_id;
    claimedAttempts = Number(job.attempts ?? 0);
    log("[job] claimed", { id: job.id, company: job.company_id, attempts: claimedAttempts });

    const { data: payload, error: payloadError } = await supabase.rpc("build_daily_digest_payload", {
      p_company_id: job.company_id,
      p_local_day: job.run_for_local_date,
      p_timezone: job.timezone,
    });
    if (payloadError) throw payloadError;
    const digest = payload as DigestPayload;

    const { data: company } = await supabase
      .from("companies")
      .select("name,trade_name,legal_name,email_subject_prefix,email,phone,website,address_line1,address_line2,city,state,postal_code,print_footer_note")
      .eq("id", job.company_id)
      .maybeSingle();
    const companyRow = (company || null) as CompanyRow | null;
    const brand = companyBrand(companyRow);

    const emails = job.payload?.recipients?.emails ?? [];
    const wantsEmail = job.payload?.channels?.email !== false;
    if (!emails.length || !wantsEmail) throw new Error("No email recipients configured for this job");

    const subject = `${brand} - Daily digest (${digest.window.local_day})`;
    const html = htmlEmail(digest, companyRow);
    const text = textEmail(digest, companyRow);

    if (DRY_RUN) {
      log("[DRY_RUN] would send digest", { to: emails, subject });
    } else {
      await sendMailViaSendGrid(
        {
          to: emails,
          subject,
          html,
          text,
          fromName: brand,
          replyTo: companyRow?.email || MAIL.defaultReplyTo,
        },
        MAIL,
      );
    }

    await supabase
      .from("digest_queue")
      .update({ status: "done", processed_at: new Date().toISOString(), error: null, next_attempt_at: null })
      .eq("id", job.id);

    await supabase
      .from("company_digest_state")
      .update({ last_status: "sent", last_error: null, last_attempt_at: new Date().toISOString() })
      .eq("company_id", job.company_id);

    return new Response(JSON.stringify({ ok: true, mode: DRY_RUN ? "dry" : "live", message: "sent" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      if (claimedJobId !== null) {
        const sb = supa();
        const nextAttempts = claimedAttempts + 1;
        const shouldFail = nextAttempts >= MAX_ATTEMPTS;
        const backoffMinutes = Math.min(60, Math.max(2, 2 ** Math.min(nextAttempts, 6)));
        const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();

        await sb
          .from("digest_queue")
          .update({
            status: shouldFail ? "failed" : "pending",
            attempts: nextAttempts,
            next_attempt_at: shouldFail ? null : nextAttemptAt,
            error: message,
          })
          .eq("id", claimedJobId)
          .eq("status", "processing");

        if (claimedCompanyId) {
          await sb
            .from("company_digest_state")
            .update({ last_status: "failed", last_error: message, last_attempt_at: new Date().toISOString() })
            .eq("company_id", claimedCompanyId);
        }
      }
    } catch (recoverError) {
      log("[recover] failed to update digest queue", recoverError);
    }

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
