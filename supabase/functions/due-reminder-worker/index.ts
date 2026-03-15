import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getMailConfig, sendMailViaSendGrid } from "../_shared/sendgrid.ts";

type QueueRow = {
  id: number;
  company_id: string;
  run_for_local_date: string;
  timezone: string;
  payload: {
    channels?: { email?: boolean };
    recipients?: { emails?: string[] };
    lead_days?: number[];
    invoice_base_url?: string;
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
    due_date: string;
    amount: number;
    email: string | null;
    customer_name?: string | null;
    days_until_due: number;
    _currency?: string;
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
  country_code?: string | null;
  preferred_lang?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  print_footer_note?: string | null;
};

const MAIL = getMailConfig();
const FALLBACK_BRAND = MAIL.defaultFromName || "StockWise";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REMINDER_HOOK_SECRET = Deno.env.get("REMINDER_HOOK_SECRET") ?? "";
const DEBUG_LOG = (Deno.env.get("DEBUG_LOG") ?? "false").toLowerCase() === "true";
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "false").toLowerCase() === "true";
const MAX_ATTEMPTS = Number(Deno.env.get("DUE_REMINDER_MAX_ATTEMPTS") ?? "8");

type Lang = "en" | "pt";

function brandForSubject(company?: CompanyRow | null) {
  return (
    company?.email_subject_prefix?.trim() ||
    company?.trade_name?.trim() ||
    company?.legal_name?.trim() ||
    company?.name?.trim() ||
    FALLBACK_BRAND
  );
}

function isPortugueseSpeakingCountry(countryCode: string | null | undefined) {
  if (!countryCode) return false;
  return ["PT", "BR", "MZ", "AO", "CV", "GW", "ST", "TL"].includes(countryCode.toUpperCase());
}

function supa() {
  if (!SERVICE_ROLE_KEY) throw new Error("SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

function log(...args: unknown[]) {
  if (DEBUG_LOG) console.log(...args);
}

function safeErr(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function currency(value: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInvoiceUrl(base: string, code: string) {
  if (!base) return undefined;
  try {
    const url = new URL(base);
    const hasCodeParam = Array.from(url.searchParams.keys()).some((key) => key.toLowerCase() === "code");
    if (hasCodeParam) {
      for (const key of [...url.searchParams.keys()]) {
        if (key.toLowerCase() === "code") url.searchParams.delete(key);
      }
      url.searchParams.set("code", code);
    } else {
      if (!url.pathname.endsWith("/")) url.pathname += "/";
      url.pathname += encodeURIComponent(code);
    }
    if (![...url.searchParams.keys()].some((key) => key.toLowerCase() === "download")) {
      url.searchParams.set("download", "1");
    }
    return url.toString();
  } catch {
    return `${base.replace(/\/$/, "")}/${encodeURIComponent(code)}`;
  }
}

function subjectFor(lang: Lang, prefix: string, code: string, days: number) {
  if (lang === "pt") {
    if (days > 0) return `${prefix}: ${code} vence em ${days} dia${days === 1 ? "" : "s"}`;
    if (days === 0) return `${prefix}: ${code} vence hoje`;
    return `${prefix}: ${code} está em atraso há ${Math.abs(days)} dia${Math.abs(days) === 1 ? "" : "s"}`;
  }
  if (days > 0) return `${prefix}: ${code} is due in ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return `${prefix}: ${code} is due today`;
  return `${prefix}: ${code} is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
}

function translations(lang: Lang) {
  return lang === "pt"
    ? {
        hi: "Olá",
        invoice: "Pedido",
        dueIn: "vence em",
        dueToday: "vence hoje",
        overdueBy: "está em atraso há",
        days: "dia(s)",
        dueDate: "Data de vencimento",
        amount: "Montante",
        alreadyPaid: "Se o pagamento já foi efectuado, por favor ignore este aviso.",
        pleaseContact: "Para regularizar ou esclarecer dúvidas, utilize os contactos abaixo.",
        download: "Descarregar documento",
        help: "Pedir ajuda",
        phone: "Telefone",
        website: "Website",
        address: "Endereço",
        email: "Email",
        thanksLead: "Obrigado, equipa",
      }
    : {
        hi: "Hi",
        invoice: "Order",
        dueIn: "is due in",
        dueToday: "is due today",
        overdueBy: "is overdue by",
        days: "day(s)",
        dueDate: "Due date",
        amount: "Amount",
        alreadyPaid: "If you have already paid, please ignore this notice.",
        pleaseContact: "For settlement or questions, use the contact details below.",
        download: "Download document",
        help: "Need help",
        phone: "Phone",
        website: "Website",
        address: "Address",
        email: "Email",
        thanksLead: "Thanks from",
      };
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

function htmlBody(opts: {
  lang: Lang;
  customer?: string | null;
  soCode: string;
  dueDate: string;
  amountText: string;
  days: number;
  invoiceUrl?: string;
  brandForCopy: string;
  company?: CompanyRow | null;
}) {
  const t = translations(opts.lang);
  const greeting = opts.customer ? `${t.hi} ${escapeHtml(opts.customer)},` : `${t.hi},`;
  const statusLine =
    opts.days > 0
      ? `${t.dueIn} <strong>${opts.days}</strong> ${t.days}`
      : opts.days === 0
        ? t.dueToday
        : `${t.overdueBy} <strong>${Math.abs(opts.days)}</strong> ${t.days}`;
  const address = escapeHtml(companyAddress(opts.company));
  const companyName = escapeHtml(opts.company?.trade_name || opts.company?.legal_name || opts.company?.name || opts.brandForCopy);
  const helpMail = `mailto:${encodeURIComponent(opts.company?.email || MAIL.defaultReplyTo)}?subject=${encodeURIComponent(`${opts.brandForCopy}: ${opts.soCode}`)}`;

  return `
    <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;padding:16px;line-height:1.5;color:#0f172a;">
      <p style="margin:0 0 12px 0;">${greeting}</p>
      <p style="margin:0 0 12px 0;">
        ${t.invoice} <strong>${escapeHtml(opts.soCode)}</strong> ${statusLine}.<br/>
        ${t.dueDate}: <strong>${escapeHtml(opts.dueDate)}</strong><br/>
        ${t.amount}: <strong>${escapeHtml(opts.amountText)}</strong>
      </p>
      <p style="margin:0 0 12px 0;font-size:13px;color:#64748b;">${t.alreadyPaid}</p>
      <p style="margin:0 0 12px 0;font-size:14px;color:#64748b;">${t.pleaseContact}</p>
      <div style="margin:16px 0;display:flex;gap:8px;flex-wrap:wrap;">
        ${
          opts.invoiceUrl
            ? `<a href="${escapeHtml(opts.invoiceUrl)}" target="_blank" style="display:inline-block;padding:10px 14px;border:1px solid #cbd5e1;border-radius:6px;text-decoration:none;color:#0f172a;">${t.download}</a>`
            : ""
        }
        <a href="${helpMail}" style="display:inline-block;padding:10px 14px;border:1px solid #cbd5e1;border-radius:6px;text-decoration:none;color:#0f172a;">${t.help}</a>
      </div>

      <div style="margin-top:12px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;">
        <div style="font-weight:600;margin-bottom:6px;">${companyName}</div>
        ${
          opts.company?.phone
            ? `<div style="font-size:13px;">${t.phone}: ${escapeHtml(opts.company.phone)}</div>`
            : ""
        }
        ${
          opts.company?.website
            ? `<div style="font-size:13px;">${t.website}: <a href="${escapeHtml(opts.company.website.startsWith("http") ? opts.company.website : `https://${opts.company.website}`)}" target="_blank">${escapeHtml(opts.company.website)}</a></div>`
            : ""
        }
        ${address ? `<div style="font-size:13px;">${t.address}: ${address}</div>` : ""}
        ${opts.company?.email ? `<div style="font-size:13px;">${t.email}: ${escapeHtml(opts.company.email)}</div>` : ""}
      </div>

      ${
        opts.company?.print_footer_note
          ? `<div style="margin-top:12px;padding:8px;background:#f8fafc;border-radius:4px;font-size:12px;color:#64748b;">${escapeHtml(opts.company.print_footer_note)}</div>`
          : ""
      }

      <p style="color:#64748b;margin-top:16px;">${t.thanksLead} ${escapeHtml(opts.brandForCopy)}.</p>
    </div>
  `;
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
  company?: CompanyRow | null;
}) {
  const t = translations(opts.lang);
  const lines = [
    `${opts.customer ? `${t.hi} ${opts.customer},` : `${t.hi},`}`,
    "",
    `${t.invoice} ${opts.soCode} ${
      opts.days > 0
        ? `${t.dueIn} ${opts.days} ${t.days}`
        : opts.days === 0
          ? t.dueToday
          : `${t.overdueBy} ${Math.abs(opts.days)} ${t.days}`
    }.`,
    `${t.dueDate}: ${opts.dueDate}`,
    `${t.amount}: ${opts.amountText}`,
    opts.invoiceUrl ? `${t.download}: ${opts.invoiceUrl}` : "",
    "",
    t.alreadyPaid,
    "",
    `${t.thanksLead} ${opts.brandForCopy}.`,
  ].filter(Boolean);

  if (opts.company?.email) lines.push(`${t.email}: ${opts.company.email}`);
  if (opts.company?.phone) lines.push(`${t.phone}: ${opts.company.phone}`);
  return lines.join("\n");
}

function authorized(req: Request) {
  if (!REMINDER_HOOK_SECRET) return false;
  const headerSecret = req.headers.get("x-webhook-secret") ?? "";
  return headerSecret === REMINDER_HOOK_SECRET;
}

serve(async (req) => {
  let claimedJobId: number | null = null;
  let claimedAttempts = 0;
  try {
    if (!authorized(req)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    }

    const sb = supa();
    const nowIso = new Date().toISOString();
    const { data: jobs, error: queueError } = await sb
      .from("due_reminder_queue")
      .select("*")
      .eq("status", "pending")
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
      .order("created_at", { ascending: true })
      .limit(1);
    if (queueError) throw new Error(`queue.select: ${safeErr(queueError)}`);
    if (!jobs?.length) {
      return new Response(JSON.stringify({ ok: true, message: "no pending jobs", mode: DRY_RUN ? "dry" : "live" }), {
        status: 200,
      });
    }

    const candidate = jobs[0] as QueueRow;
    const { data: job, error: claimError } = await sb
      .from("due_reminder_queue")
      .update({ status: "processing" })
      .eq("id", candidate.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (claimError) throw new Error(`queue.claim: ${safeErr(claimError)}`);
    if (!job) {
      return new Response(JSON.stringify({ ok: true, message: "job already taken" }), { status: 200 });
    }
    claimedJobId = job.id;
    claimedAttempts = Number(job.attempts ?? 0);

    const leadDays = job.payload?.lead_days?.length ? job.payload.lead_days : [3, 1, 0, -3];
    const { data: batch, error: batchError } = await sb.rpc("build_due_reminder_batch", {
      p_company_id: job.company_id,
      p_local_day: job.run_for_local_date,
      p_timezone: job.timezone,
      p_lead_days: leadDays,
    });
    if (batchError) throw new Error(`rpc.build_due_reminder_batch: ${safeErr(batchError)}`);
    const reminderBatch = batch as Batch;

    const needsCodes = (reminderBatch.reminders || [])
      .filter((row) => !row.so_code || row.so_code === row.so_id)
      .map((row) => row.so_id);
    if (needsCodes.length) {
      const { data: rows, error } = await sb.from("sales_orders").select("id, code").in("id", needsCodes);
      if (error) throw new Error(`lookup.so_codes: ${safeErr(error)}`);
      const codeById = new Map((rows || []).map((row: any) => [row.id, row.code]));
      for (const row of reminderBatch.reminders) {
        if (!row.so_code || row.so_code === row.so_id) {
          const code = codeById.get(row.so_id);
          if (code && typeof code === "string") row.so_code = code;
        }
      }
    }

    const orderIds = (reminderBatch.reminders || []).map((row) => row.so_id);
    const { data: orderMetaRows, error: orderMetaError } = await sb
      .from("sales_orders")
      .select("id, order_no, code, currency_code, bill_to_email")
      .in("id", orderIds);
    if (orderMetaError) throw new Error(`lookup.so_meta: ${safeErr(orderMetaError)}`);
    const orderMeta = new Map((orderMetaRows || []).map((row: any) => [row.id, row]));
    for (const row of reminderBatch.reminders) {
      const meta = orderMeta.get(row.so_id);
      row.so_code = meta?.order_no || meta?.code || row.so_id;
      (row as any)._currency = meta?.currency_code || "";
      (row as any)._toEmail = meta?.bill_to_email || row.email || null;
    }

    if (!reminderBatch?.reminders?.length) {
      await sb
        .from("due_reminder_queue")
        .update({ status: "done", processed_at: new Date().toISOString(), next_attempt_at: null })
        .eq("id", job.id);
      return new Response(JSON.stringify({ ok: true, message: "no reminders for window" }), { status: 200 });
    }

    const { data: companyRow, error: companyError } = await sb
      .from("companies")
      .select("name,trade_name,legal_name,email_subject_prefix,email,phone,website,country_code,preferred_lang,address_line1,address_line2,city,state,postal_code,print_footer_note")
      .eq("id", job.company_id)
      .single();
    if (companyError) throw new Error(`company.lookup: ${safeErr(companyError)}`);
    const company = (companyRow || {}) as CompanyRow;

    const lang: Lang =
      (job.payload?.lang as Lang) ||
      (company.preferred_lang as Lang) ||
      (isPortugueseSpeakingCountry(company.country_code) ? "pt" : "en");
    const subjectPrefix = brandForSubject(company);
    const wantsEmail = job.payload?.channels?.email !== false;
    if (!wantsEmail) throw new Error("Email channel disabled for this job");

    const { data: settingsRow, error: settingsError } = await sb
      .from("company_settings")
      .select("data")
      .eq("company_id", job.company_id)
      .single();
    if (settingsError && settingsError.code !== "PGRST116") {
      throw new Error(`settings.lookup: ${safeErr(settingsError)}`);
    }
    const settingsData = (settingsRow?.data ?? {}) as any;
    const settingsDue = settingsData?.dueReminders ?? {};
    const baseUrl = job.payload?.invoice_base_url ?? settingsDue?.invoiceBaseUrl ?? "";
    const bcc = (job.payload?.bcc?.length ? job.payload.bcc : (settingsDue?.bcc ?? [])) as string[];

    let sent = 0;
    for (const row of reminderBatch.reminders) {
      const to = (row as any)._toEmail && /\S+@\S+\.\S+/.test((row as any)._toEmail) ? [(row as any)._toEmail] : [];
      if (!to.length) continue;

      const displayCode = row.so_code || row.so_id;
      const amountText = (row as any)._currency
        ? `${currency(row.amount)} ${(row as any)._currency}`
        : currency(row.amount);
      const invoiceUrl = baseUrl && displayCode ? buildInvoiceUrl(baseUrl, displayCode) : undefined;
      const subject = subjectFor(lang, subjectPrefix, displayCode, row.days_until_due);
      const html = htmlBody({
        lang,
        customer: row.customer_name ?? undefined,
        soCode: displayCode,
        dueDate: row.due_date,
        amountText,
        days: row.days_until_due,
        invoiceUrl,
        brandForCopy: subjectPrefix,
        company,
      });
      const text = textBody({
        lang,
        customer: row.customer_name ?? undefined,
        soCode: displayCode,
        dueDate: row.due_date,
        amountText,
        days: row.days_until_due,
        invoiceUrl,
        brandForCopy: subjectPrefix,
        company,
      });

      if (DRY_RUN) {
        log("[DRY_RUN] would send reminder", { to, subject });
      } else {
        await sendMailViaSendGrid(
          {
            to,
            bcc,
            subject,
            html,
            text,
            fromName: subjectPrefix,
            replyTo: company.email || MAIL.defaultReplyTo,
          },
          MAIL,
        );
      }
      sent++;
    }

    await sb
      .from("due_reminder_queue")
      .update({ status: "done", processed_at: new Date().toISOString(), next_attempt_at: null })
      .eq("id", job.id);

    return new Response(JSON.stringify({ ok: true, sent, mode: DRY_RUN ? "dry" : "live" }), { status: 200 });
  } catch (error) {
    try {
      const sb = supa();
      if (claimedJobId !== null) {
        const nextAttempts = claimedAttempts + 1;
        const shouldFail = nextAttempts >= MAX_ATTEMPTS;
        const backoffMinutes = Math.min(60, Math.max(1, 2 ** Math.min(nextAttempts, 6)));
        const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
        await sb
          .from("due_reminder_queue")
          .update({
            attempts: nextAttempts,
            status: shouldFail ? "failed" : "pending",
            next_attempt_at: shouldFail ? null : nextAttemptAt,
          })
          .eq("id", claimedJobId)
          .eq("status", "processing");
      }
    } catch {
      // best effort only
    }

    const message = error instanceof Error ? error.message : safeErr(error);
    if (DEBUG_LOG) console.error("[error]", message);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
  }
});
