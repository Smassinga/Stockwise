import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type QueueRow = {
  id: number;
  company_id: string;
  run_for_local_date: string; // YYYY-MM-DD
  timezone: string;
  payload: {
    channels?: { email?: boolean };
    recipients?: { emails?: string[] };
    lead_days?: number[];          // e.g., [3,1,0,-3]
    invoice_base_url?: string;     // e.g., https://app.stockwise.app/invoices
    bcc?: string[];
    lang?: "en" | "pt";
  };
  status: "pending" | "processing" | "done" | "failed";
  attempts?: number | null;
  next_attempt_at?: string | null;
  created_at: string;
};

type Batch = {
  window: { local_day: string; timezone: string; start_utc: string; end_utc: string };
  reminders: Array<{
    so_id: string;
    so_code: string | null;
    due_date: string;  // YYYY-MM-DD
    amount: number;
    email: string | null;
    customer_name?: string | null;
    days_until_due: number;
    // Add properties for currency and order metadata
    _currency?: string;
  }>;
};

// Define type for sales order metadata
type SalesOrderMeta = {
  id: string;
  order_no: string | null;
  code: string | null;
  currency_code: string | null;
  bill_to_email: string | null;
};

const SENDGRID_API_KEY = Deno.env.get("SENDGRID_API_KEY") ?? "";
const FROM_EMAIL       = Deno.env.get("FROM_EMAIL")       ?? "no-reply@stockwiseapp.com";
const REPLY_TO_EMAIL   = Deno.env.get("REPLY_TO_EMAIL")   ?? "support@stockwiseapp.com";
const BRAND_NAME       = Deno.env.get("BRAND_NAME")       ?? "Stockwise";

const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const REMINDER_HOOK_SECRET = Deno.env.get("REMINDER_HOOK_SECRET") ?? "";
const DEBUG_LOG            = (Deno.env.get("DEBUG_LOG") ?? "false").toLowerCase() === "true";
const DRY_RUN              = (Deno.env.get("DRY_RUN") ?? "false").toLowerCase() === "true";

type Lang = "en" | "pt";

function brandForSubject(company: {
  email_subject_prefix?: string | null;
  trade_name?: string | null;
  legal_name?: string | null;
  name?: string | null;
} | undefined | null): string {
  return (
    (company?.email_subject_prefix && company.email_subject_prefix.trim()) ||
    (company?.trade_name && company.trade_name.trim()) ||
    (company?.legal_name && company.legal_name.trim()) ||
    (company?.name && company.name.trim()) ||
    BRAND_NAME
  );
}

// Helper function to determine if a country code represents a Portuguese-speaking country
function isPortugueseSpeakingCountry(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  const normalizedCode = countryCode.toUpperCase();
  // Portuguese-speaking countries: Portugal, Brazil, Mozambique, Angola, Cape Verde, 
  // Guinea-Bissau, São Tomé and Príncipe, Timor-Leste
  // Also accept tolerant variants of Mozambique
  const portugueseCountries = ['PT', 'BR', 'MZ', 'AO', 'CV', 'GW', 'ST', 'TL'];
  return portugueseCountries.includes(normalizedCode);
}

function supa() {
  if (!SERVICE_ROLE_KEY) throw new Error("SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function log(...a: unknown[]) { if (DEBUG_LOG) console.log(...a); }
function safeErr(e: unknown) { if (e instanceof Error) return e.message; try { return JSON.stringify(e); } catch { return String(e); } }
function currency(n: number) { try { return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); } catch { return n.toFixed(2); } }

// Helper function to build invoice URLs that handles both path-style and query-style endpoints
function buildInvoiceUrl(base: string, code: string): string | undefined {
  if (!base) return undefined;
  try {
    const u = new URL(base);
    // if caller already uses a ?code= param, overwrite it; otherwise add it
    const hasCodeParam = Array.from(u.searchParams.keys()).some(k => k.toLowerCase() === "code");
    if (hasCodeParam) {
      // normalize param name to 'code' for safety
      for (const k of [...u.searchParams.keys()]) {
        if (k.toLowerCase() === "code") u.searchParams.delete(k);
      }
      u.searchParams.set("code", code);
    } else {
      // append as a path segment
      if (!u.pathname.endsWith("/")) u.pathname += "/";
      u.pathname += encodeURIComponent(code);
    }
    // ensure download=1 if not present
    if (![...u.searchParams.keys()].some(k => k.toLowerCase() === "download")) {
      u.searchParams.set("download", "1");
    }
    return u.toString();
  } catch {
    // If base is not absolute, fall back to path join
    return `${base.replace(/\/$/, '')}/${encodeURIComponent(code)}`;
  }
}

function subjectFor(lang: Lang, prefix: string, code: string, days: number) {
  if (lang === "pt") {
    if (days > 0) return `${prefix}: ${code} vence em ${days} dia${days === 1 ? "" : "s"}`;
    if (days === 0) return `${prefix}: ${code} vence hoje`;
    return `${prefix}: ${code} está em atraso há ${Math.abs(days)} dia${Math.abs(days) === 1 ? "" : "s"}`;
  } else {
    if (days > 0) return `${prefix}: ${code} is due in ${days} day${days === 1 ? "" : "s"}`;
    if (days === 0) return `${prefix}: ${code} is due today`;
    return `${prefix}: ${code} is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  }
}

function htmlBody(opts: {
  lang: Lang;
  customer?: string | null;
  soCode: string;
  dueDate: string;
  amountText: string;
  days: number;
  invoiceUrl?: string;
  brandForCopy: string;
  company?: {
    name?: string | null; email?: string | null; phone?: string | null; website?: string | null;
    address_line1?: string | null; address_line2?: string | null; city?: string | null;
    state?: string | null; postal_code?: string | null; print_footer_note?: string | null;
  };
}) {
  const t = (k: string) => {
    const dict: Record<Lang, Record<string, string>> = {
      en: {
        hi: "Hi",
        invoice: "Invoice",
        dueIn: "is due in",
        dueToday: "is due today",
        overdueBy: "is overdue by",
        days: "day(s)",
        dueDate: "Due date",
        amount: "Amount",
        pleaseContact: "For settlement or questions, use the contact details below.",
        download: "Download invoice",
        help: "Need help",
        contact: "For settlement or information, contact",
        at: "at",
        phone: "Phone",
        website: "Website",
        address: "Address",
        email: "Email",
        alreadyPaid: "If you have already paid, please ignore this notice.",
        thanksLead: "Thanks from",
      },
      pt: {
        hi: "Olá",
        invoice: "Fatura",
        dueIn: "vence em",
        dueToday: "vence hoje",
        overdueBy: "está em atraso há",
        days: "dia(s)",
        dueDate: "Data de vencimento",
        amount: "Montante",
        pleaseContact: "Para regularizar ou esclarecer dúvidas, utilize os contactos abaixo.",
        download: "Descarregar fatura",
        help: "Pedir ajuda",
        alreadyPaid: "Se o pagamento já foi efetuado, por favor ignore este aviso.",
        thanksLead: "Obrigado, equipa",
        contact: "Para regularização ou informações, contacte",
        at: "em",
        phone: "Telefone",
        website: "Website",
        address: "Endereço",
        email: "Email",
      }
    };
    return dict[opts.lang][k];
  };

  const greeting = opts.customer ? `${t("hi")} ${opts.customer},` : `${t("hi")},`;
  const line =
    opts.days > 0 ? `${t("dueIn")} <b>${opts.days}</b> ${t("days")}` :
    opts.days === 0 ? `${t("dueToday")}` :
    `${t("overdueBy")} <b>${Math.abs(opts.days)}</b> ${t("days")}`;

  const view = opts.invoiceUrl
    ? `<a href="${opts.invoiceUrl}" target="_blank" style="display:inline-block;padding:10px 14px;border:1px solid #ccc;border-radius:6px;text-decoration:none;">${t("download")}</a>`
    : ``;

  const co = opts.company || {};
  const helpMail = `mailto:${REPLY_TO_EMAIL}?subject=${encodeURIComponent(opts.lang==='pt'?'Ajuda com fatura ':'Help with invoice ')}${encodeURIComponent(opts.soCode)}`;

  return `
  <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;padding:16px;line-height:1.5;">
    <p style="margin:0 0 12px 0;">${greeting}</p>
    <p style="margin:0 0 12px 0;">
      ${t("invoice")} <b>${opts.soCode}</b> ${line}.<br/>
      ${t("dueDate")}: <b>${opts.dueDate}</b><br/>
      ${t("amount")}: <b>${opts.amountText}</b>
    </p>
    <p style="margin:0 0 12px 0;font-size:13px;color:#666;">${t("alreadyPaid")}</p>
    <p style="margin:0 0 12px 0;font-size:14px;color:#666;">
      ${t("pleaseContact")}
    </p>
    <div style="margin:16px 0;display:flex;gap:8px;">
      ${view}
      <a href="${helpMail}" style="display:inline-block;padding:10px 14px;border:1px solid #ccc;border-radius:6px;text-decoration:none;">${t("help")}</a>
    </div>

    <!-- neat contact card -->
    ${(() => {
      const co = opts.company || {};

      const addrParts = [
        co.address_line1,
        co.address_line2,
        [co.city, co.state].filter(Boolean).join(", "),
        co.postal_code
      ].filter(Boolean);

      const websitePretty = co.website
        ? (co.website.startsWith("http") ? co.website : `https://${co.website}`)
        : "";

      return `
        <div style="margin-top:12px;padding:12px;border:1px solid #eee;border-radius:8px;">
          ${co.name ? `<div style="font-weight:600;margin-bottom:6px;">${co.name}</div>` : ""}
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:13px;">
            ${co.phone ? `<div>${t("phone")}:</div><div>${co.phone}</div>` : ""}
            ${websitePretty ? `<div>${t("website")}:</div><div><a href="${websitePretty}" target="_blank" rel="noopener">${websitePretty}</a></div>` : ""}
            ${addrParts.length ? `<div>${t("address")}:</div><div>${addrParts.join(" · ")}</div>` : ""}
            ${co.email ? `<div>${t("email")}:</div><div>${co.email}</div>` : ""}
          </div>
        </div>
      `;
    })()}
    
    ${co.print_footer_note ? `<div style="margin-top:12px;padding:8px;background:#f8f8f8;border-radius:4px;font-size:12px;color:#666;">${co.print_footer_note}</div>` : ""}

    <p style="color:#666;margin-top:16px;">${t("thanksLead")} ${opts.brandForCopy}.</p>
  </div>`;
}

function textBody(opts: {
  lang: Lang;
  customer?: string | null;
  soCode: string;
  dueDate: string;
  amountText: string;
  days: number;
  invoiceUrl?: string;
  brandForCopy: string;
  company?: { name?: string | null; email?: string | null; phone?: string | null; website?: string | null; };
}) {
  const t = (k: string) => {
    const dict: Record<Lang, Record<string,string>> = {
      en: { hi: "Hi", invoice: "Invoice", dueIn: "is due in", dueToday: "is due today", overdueBy: "is overdue by", days: "day(s)", dueDate: "Due date", amount: "Amount", download: "Download", help: "Help", contact: "Contact", alreadyPaid: "If you have already paid, please ignore this notice.", thanksLead: "Thanks from" },
      pt: { hi: "Olá", invoice: "Fatura",  dueIn: "vence em", dueToday: "vence hoje", overdueBy: "está em atraso há", days: "dia(s)", dueDate: "Data de vencimento", amount: "Montante", download: "Descarregar", help: "Ajuda", contact: "Contacto", alreadyPaid: "Se o pagamento já foi efetuado, por favor ignore este aviso.", thanksLead: "Obrigado, equipa" }
    };
    return dict[opts.lang][k];
  };

  return [
    `${opts.customer ? `${t("hi")} ${opts.customer},` : `${t("hi")},`}`, ``,
    `${t("invoice")} ${opts.soCode} ${opts.days > 0 ? `${t("dueIn")} ${opts.days} ${t("days")}` : opts.days === 0 ? t("dueToday") : `${t("overdueBy")} ${Math.abs(opts.days)} ${t("days")}`}.`,
    `${t("dueDate")}: ${opts.dueDate}`,
    `${t("amount")}: ${opts.amountText}`,
    opts.invoiceUrl ? `${t("download")}: ${opts.invoiceUrl}` : ``,
    ``,
    `${t("alreadyPaid")}`,
    ``,
    `${t("thanksLead")} ${opts.brandForCopy}.`
  ].filter(Boolean).join("\n");
}

function authorized(req: Request) {
  if (!REMINDER_HOOK_SECRET) return false;
  const hdr = req.headers.get("x-webhook-secret") ?? "";
  return hdr === REMINDER_HOOK_SECRET;
}

serve(async (req) => {
  try {
    if (!authorized(req)) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

    const sb = supa();
    const nowIso = new Date().toISOString();

    // pick one eligible pending job
    const { data: jobs, error: qErr } = await sb.from("due_reminder_queue")
      .select("*")
      .or(`and(status.eq.pending,next_attempt_at.is.null),and(status.eq.pending,next_attempt_at.lte.${nowIso})`)
      .order("created_at", { ascending: true })
      .limit(1);
    if (qErr) throw new Error(`queue.select: ${safeErr(qErr)}`);
    if (!jobs?.length) return new Response(JSON.stringify({ ok: true, message: "no pending jobs", mode: DRY_RUN ? "dry" : "live" }), { status: 200 });

    const job = jobs[0] as QueueRow;

    // claim
    const { error: claimErr } = await sb.from("due_reminder_queue")
      .update({ status: "processing" })
      .eq("id", job.id)
      .eq("status", "pending");
    if (claimErr) throw new Error(`queue.claim: ${safeErr(claimErr)}`);

    const { data: verify } = await sb.from("due_reminder_queue").select("status").eq("id", job.id).limit(1);
    if (!verify || verify[0]?.status !== "processing") {
      return new Response(JSON.stringify({ ok: true, message: "job already taken" }), { status: 200 });
    }

    const leadDays = job.payload?.lead_days?.length ? job.payload.lead_days : [3,1,0,-3];
    const { data: batch, error: rpcErr } = await sb.rpc("build_due_reminder_batch", {
      p_company_id: job.company_id,
      p_local_day: job.run_for_local_date,
      p_timezone: job.timezone,
      p_lead_days: leadDays
    });
    if (rpcErr) throw new Error(`rpc.build_due_reminder_batch: ${safeErr(rpcErr)}`);

    const b = batch as Batch;

    // fill human codes if missing
    const needs = (b.reminders || []).filter(r => !r.so_code || r.so_code === r.so_id).map(r => r.so_id);
    if (needs.length) {
      const { data: rows, error } = await sb.from("sales_orders").select("id, code").in("id", needs);
      if (error) throw new Error(`lookup.so_codes: ${safeErr(error)}`);
      const map = new Map((rows || []).map((x: any) => [x.id, x.code]));
      for (const r of b.reminders) {
        if (!r.so_code || r.so_code === r.so_id) {
          const code = map.get(r.so_id);
          if (code && typeof code === 'string') r.so_code = code;
        }
      }
    }

    // 2) When fetching meta, include bill_to_email and use it as the sole "To"
    const ids = (b.reminders || []).map(r => r.so_id);
    const { data: metaRows, error: metaErr } = await sb
      .from("sales_orders")
      .select("id, order_no, code, currency_code, bill_to_email")
      .in("id", ids);
    if (metaErr) throw new Error(`lookup.so_meta: ${safeErr(metaErr)}`);

    const meta = new Map((metaRows || []).map((x: any) => [x.id, x]));
    for (const r of b.reminders) {
      const m: any = meta.get(r.so_id);
      r.so_code = m?.order_no || m?.code || r.so_id;  // prefer order_no
      (r as any)._currency = m?.currency_code || "";
      (r as any)._toEmail  = m?.bill_to_email || r.email || null;   // <-- staged for later
    }

    if (!b?.reminders?.length) {
      await sb.from("due_reminder_queue")
        .update({ status: "done", processed_at: new Date().toISOString() })
        .eq("id", job.id);
      return new Response(JSON.stringify({ ok: true, message: "no reminders for window" }), { status: 200 });
    }

    // company footer + lang
    const { data: coRow, error: coErr } = await sb.from("companies")
      .select(`
        name,email,phone,website,country_code,preferred_lang,email_subject_prefix,
        address_line1,address_line2,city,state,postal_code,print_footer_note
      `)
      .eq("id", job.company_id)
      .single();
    if (coErr) throw new Error(`company.lookup: ${safeErr(coErr)}`);
    const company = (coRow || {}) as { name?: string|null; email?: string|null; phone?: string|null; website?: string|null; country_code?: string|null; preferred_lang?: string|null; address_line1?: string|null; address_line2?: string|null; city?: string|null; state?: string|null; postal_code?: string|null; print_footer_note?: string|null; };

    // Language selection with preferred_lang taking precedence
    const lang: Lang = (job.payload?.lang as Lang) || 
                      (company.preferred_lang as Lang) || 
                      (isPortugueseSpeakingCountry(company.country_code) ? "pt" : "en");
    const subjPrefix = brandForSubject(company);

    const wantsEmail = job.payload?.channels?.email !== false;
    if (!wantsEmail) throw new Error("Email channel disabled for this job.");

    // 3) Pull bcc and default baseUrl from company_settings.data.dueReminders (if not provided in payload)
    const { data: settingsRow, error: settingsErr } = await sb
      .from("company_settings")
      .select("data")
      .eq("company_id", job.company_id)
      .single();
    if (settingsErr && settingsErr.code !== "PGRST116") { // ignore "no rows" gracefully
      throw new Error(`settings.lookup: ${safeErr(settingsErr)}`);
    }
    const settingsData = (settingsRow?.data ?? {}) as any;
    const settingsDue = settingsData?.dueReminders ?? {};

    const baseUrl = job.payload?.invoice_base_url ?? settingsDue?.invoiceBaseUrl ?? "";
    const bcc = (job.payload?.bcc?.length ? job.payload.bcc : (settingsDue?.bcc ?? [])) as string[];

    let sent = 0;

    for (const r of b.reminders) {
      // use only bill_to_email
      const to = ((r as any)._toEmail && /\S+@\S+\.\S+/.test((r as any)._toEmail)) ? [(r as any)._toEmail] : [];
      if (!to.length) continue; // cash customers -> skip

      const displayCode = r.so_code || r.so_id;
      const curr = (r as any)._currency || "";
      const amountStr = curr ? `${currency(r.amount)} ${curr}` : currency(r.amount);
      const invoiceUrl = baseUrl && displayCode ? buildInvoiceUrl(baseUrl, displayCode) : undefined;

      const subject = subjectFor(lang, subjPrefix, displayCode, r.days_until_due);
      const html = htmlBody({ lang, customer: r.customer_name ?? undefined, soCode: displayCode, dueDate: r.due_date, amountText: amountStr, days: r.days_until_due, invoiceUrl, brandForCopy: subjPrefix, company });
      const text = textBody({ lang, customer: r.customer_name ?? undefined, soCode: displayCode, dueDate: r.due_date, amountText: amountStr, days: r.days_until_due, invoiceUrl, brandForCopy: subjPrefix, company });

      if (DRY_RUN) {
        log("[DRY_RUN] would send:", { to, subject });
      } else {
        if (!SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY not set");
        const body: Record<string, unknown> = {
          personalizations: [{ to: to.map(e => ({ email: e })), ...(bcc?.length ? { bcc: bcc.map(e => ({ email: e })) } : {}) }],
          from: { email: FROM_EMAIL, name: subjPrefix },
          reply_to: { email: company.email || REPLY_TO_EMAIL },
          subject,
          content: [
            { type: "text/plain", value: text },
            { type: "text/html",  value: html }
          ],
        };
        const rres = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (rres.status !== 202) throw new Error(`SendGrid ${rres.status} ${await rres.text()}`);
      }
      sent++;
    }

    await sb.from("due_reminder_queue")
      .update({ status: "done", processed_at: new Date().toISOString() })
      .eq("id", job.id);

    return new Response(JSON.stringify({ ok: true, sent, mode: DRY_RUN ? "dry" : "live" }), { status: 200 });
  } catch (e) {
    // best-effort: unstick
    try {
      const sb = supa();
      const nowIso = new Date().toISOString();
      await sb.from("due_reminder_queue")
        .update({ status: "pending", next_attempt_at: nowIso })
        .eq("status", "processing");
    } catch {}
    const msg = e instanceof Error ? e.message : safeErr(e);
    if (DEBUG_LOG) console.error("[error]", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
  }
});