import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getMailConfig,
  requireMailConfig,
  sendTransactionalEmail,
} from "../_shared/mailer.ts";

type QueueRow = {
  id: number;
  company_id: string;
  run_for_local_date: string;
  timezone: string;
  payload: {
    channels?: { email?: boolean };
    recipients?: { emails?: string[] };
    lead_days?: number[];
    document_base_url?: string;
    invoice_base_url?: string;
    bcc?: string[];
    lang?: "en" | "pt";
  };
  status: "pending" | "processing" | "done" | "failed";
  attempts?: number | null;
  next_attempt_at?: string | null;
  processing_started_at?: string | null;
  created_at: string;
};

type Lang = "en" | "pt";
type ReminderAnchorKind = "sales_order" | "sales_invoice";

type BatchReminderRow = {
  anchor_kind?: ReminderAnchorKind | null;
  anchor_id?: string | null;
  document_reference?: string | null;
  due_date: string;
  amount: number;
  email: string | null;
  customer_name?: string | null;
  days_until_due: number;
  currency_code?: string | null;
  settlement_status?: string | null;
  resolution_status?: string | null;
  sales_order_id?: string | null;
  sales_order_reference?: string | null;
  sales_invoice_id?: string | null;
  sales_invoice_reference?: string | null;
  language_hint?: Lang | null;
  so_id?: string | null;
  so_code?: string | null;
  _currency?: string | null;
};

type Batch = {
  window: { local_day: string; timezone: string; start_utc: string; end_utc: string };
  reminders: BatchReminderRow[];
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
  logo_path?: string | null;
};

type ReminderCopy = {
  title: string;
  intro: (customerName?: string | null) => string;
  bodyLead: (documentReference: string, dueSentence: string) => string;
  alreadyPaid: string;
  actionsNote: string;
  subject: (documentReference: string) => string;
  preview: (documentReference: string, previewSuffix: string) => string;
  labels: {
    documentReference: string;
    dueDate: string;
    amount: string;
    status: string;
    linkedOrder: string;
    fallbackLinks: string;
    viewLink: string;
    phone: string;
    website: string;
    address: string;
    email: string;
  };
  buttons: {
    view: string;
  };
  supportTitle: string;
  supportText: string;
  signatureLead: string;
  signatureTeam: (companyName: string) => string;
  footer: string;
};

type NormalizedReminder = {
  anchorKind: ReminderAnchorKind;
  anchorId: string;
  documentReference: string;
  dueDate: string;
  amount: number;
  email: string | null;
  customerName: string | null;
  daysUntilDue: number;
  currencyCode: string | null;
  settlementStatus: string | null;
  resolutionStatus: string | null;
  salesOrderId: string | null;
  salesOrderReference: string | null;
  salesInvoiceId: string | null;
  salesInvoiceReference: string | null;
  languageHint: Lang | null;
};

const MAIL = requireMailConfig(getMailConfig());
const FALLBACK_BRAND = MAIL.defaultFromName || "StockWise";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REMINDER_HOOK_SECRET = Deno.env.get("REMINDER_HOOK_SECRET") ?? "";
const DEBUG_LOG = (Deno.env.get("DEBUG_LOG") ?? "false").toLowerCase() === "true";
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "false").toLowerCase() === "true";
const MAX_ATTEMPTS = Number(Deno.env.get("DUE_REMINDER_MAX_ATTEMPTS") ?? "8");
const PUBLIC_SITE_URL =
  trimText(Deno.env.get("PUBLIC_SITE_URL")) ||
  trimText(Deno.env.get("VITE_SITE_URL")) ||
  trimText(Deno.env.get("SITE_URL"));

function isPortugueseSpeakingCountry(countryCode: string | null | undefined) {
  if (!countryCode) return false;
  return ["PT", "BR", "MZ", "AO", "CV", "GW", "ST", "TL"].includes(countryCode.toUpperCase());
}

function trimText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeReminderLang(value: string | null | undefined): Lang | null {
  const text = trimText(value)?.toLowerCase() ?? "";
  if (text.startsWith("pt")) return "pt";
  if (text.startsWith("en")) return "en";
  return null;
}

function normalizeEmailList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const email = trimText(value)?.toLowerCase();
    if (!email || !/\S+@\S+\.\S+/.test(email) || seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }
  return normalized;
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

function formatNumber(value: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function formatAmount(value: number, currencyCode: string | null | undefined, lang: Lang) {
  const code = trimText(currencyCode)?.toUpperCase() ?? "";
  const locale = lang === "pt" ? "pt-PT" : "en-US";
  if (code) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // fall through
    }
  }
  return code ? `${formatNumber(value)} ${code}` : formatNumber(value);
}

function formatDate(value: string, lang: Lang) {
  try {
    return new Intl.DateTimeFormat(lang === "pt" ? "pt-PT" : "en-US", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  } catch {
    return value;
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

function isAbsoluteUrl(value: string | null | undefined) {
  return !!value && /^(https?:)?\/\//i.test(value);
}

function resolveUrlOrigin(raw: string | null | undefined) {
  const text = trimText(raw);
  if (!text || !isAbsoluteUrl(text)) return null;
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function resolveAppBaseUrl(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const origin = resolveUrlOrigin(candidate);
    if (origin) return origin;
  }
  return null;
}

function resolvePublicStorageUrl(
  sb: ReturnType<typeof supa>,
  raw: string | null | undefined,
  fallbackBucket?: string,
) {
  const text = trimText(raw);
  if (!text) return null;
  if (isAbsoluteUrl(text)) return text;

  const cleaned = text.replace(/^\/+/, "");
  if (fallbackBucket) {
    const { data } = sb.storage.from(fallbackBucket).getPublicUrl(cleaned);
    return data?.publicUrl ?? null;
  }

  const slash = cleaned.indexOf("/");
  if (slash <= 0) return null;
  const bucket = cleaned.slice(0, slash);
  const objectPath = cleaned.slice(slash + 1);
  const { data } = sb.storage.from(bucket).getPublicUrl(objectPath);
  return data?.publicUrl ?? null;
}

function normalizeWebsite(website: string | null | undefined) {
  const text = trimText(website);
  if (!text) return null;
  return text.startsWith("http://") || text.startsWith("https://") ? text : `https://${text}`;
}

function buildAnchorViewUrl(base: string | null | undefined, row: NormalizedReminder) {
  const origin = resolveUrlOrigin(base);
  if (!origin) return undefined;

  if (row.anchorKind === "sales_invoice") {
    return `${origin}/sales-invoices/${encodeURIComponent(row.anchorId)}`;
  }

  const orderId = row.salesOrderId || row.anchorId;
  const url = new URL(`${origin}/orders`);
  url.searchParams.set("tab", "sales");
  url.searchParams.set("orderId", orderId);
  return url.toString();
}

function companyAddress(company?: CompanyRow | null) {
  return [
    company?.address_line1,
    company?.address_line2,
    [company?.city, company?.state].filter(Boolean).join(", "),
    company?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

function buildDuePhrase(lang: Lang, days: number) {
  if (lang === "pt") {
    if (days > 0) {
      return {
        dueSentence: `vence em ${days} dia${days === 1 ? "" : "s"}`,
        previewSuffix: `vence em ${days} dia${days === 1 ? "" : "s"}`,
        statusLabel: "A vencer",
      };
    }
    if (days === 0) {
      return {
        dueSentence: "vence hoje",
        previewSuffix: "vence hoje",
        statusLabel: "Vence hoje",
      };
    }
    return {
      dueSentence: `está vencido há ${Math.abs(days)} dia${Math.abs(days) === 1 ? "" : "s"}`,
      previewSuffix: `está vencido há ${Math.abs(days)} dia${Math.abs(days) === 1 ? "" : "s"}`,
      statusLabel: "Em atraso",
    };
  }

  if (days > 0) {
    return {
      dueSentence: `is due in ${days} day${days === 1 ? "" : "s"}`,
      previewSuffix: `is due in ${days} day${days === 1 ? "" : "s"}`,
      statusLabel: "Due soon",
    };
  }
  if (days === 0) {
    return {
      dueSentence: "is due today",
      previewSuffix: "is due today",
      statusLabel: "Due today",
    };
  }
  return {
    dueSentence: `is overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`,
    previewSuffix: `is overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`,
    statusLabel: "Overdue",
  };
}

function reminderCopy(lang: Lang, anchorKind: ReminderAnchorKind): ReminderCopy {
  const documentLabelPt = anchorKind === "sales_invoice" ? "Fatura" : "Pedido";
  const documentLabelEn = anchorKind === "sales_invoice" ? "Sales Invoice" : "Sales Order";
  const viewLabelPt = anchorKind === "sales_invoice" ? "Ver fatura" : "Ver pedido";
  const viewLabelEn = anchorKind === "sales_invoice" ? "View invoice" : "View order";

  if (lang === "pt") {
    return {
      title: "Aviso de vencimento",
      intro: (customerName?: string | null) => (customerName ? `Olá ${customerName},` : "Olá,"),
      bodyLead: (documentReference: string, dueSentence: string) =>
        `Informamos que ${documentLabelPt.toLowerCase()} ${documentReference} ${dueSentence}.`,
      alreadyPaid: "Caso o pagamento já tenha sido efectuado, por favor desconsidere esta mensagem.",
      actionsNote: "Para consultar os detalhes do documento, utilize a ligação abaixo.",
      subject: (documentReference: string) => `Aviso de vencimento, ${documentLabelPt} ${documentReference}`,
      preview: (documentReference: string, previewSuffix: string) =>
        `${documentLabelPt} ${documentReference} ${previewSuffix}. Consulte os detalhes do documento.`,
      labels: {
        documentReference: documentLabelPt,
        dueDate: "Data de vencimento",
        amount: "Montante em aberto",
        status: "Estado",
        linkedOrder: "Pedido associado",
        fallbackLinks: "Se o botão não funcionar, utilize este link:",
        viewLink: viewLabelPt,
        phone: "Telefone",
        website: "Website",
        address: "Endereço",
        email: "Email",
      },
      buttons: {
        view: viewLabelPt,
      },
      supportTitle: "Precisa de apoio?",
      supportText: "Para regularizar a situação ou esclarecer qualquer dúvida, contacte-nos através dos meios abaixo.",
      signatureLead: "Com os melhores cumprimentos,",
      signatureTeam: (companyName: string) => `Equipa ${companyName}`,
      footer: "Mensagem automática enviada pelo StockWise em nome da sua empresa.",
    };
  }

  return {
    title: "Payment reminder",
    intro: (customerName?: string | null) => (customerName ? `Hello ${customerName},` : "Hello,"),
    bodyLead: (documentReference: string, dueSentence: string) =>
      `This is a reminder that ${documentLabelEn} ${documentReference} ${dueSentence}.`,
    alreadyPaid: "If payment has already been made, please disregard this message.",
    actionsNote: "To review the document details, please use the link below.",
    subject: (documentReference: string) => `Payment reminder, ${documentLabelEn} ${documentReference}`,
    preview: (documentReference: string, previewSuffix: string) =>
      `${documentLabelEn} ${documentReference} ${previewSuffix}. Review the document details.`,
    labels: {
      documentReference: documentLabelEn,
      dueDate: "Due date",
      amount: "Outstanding amount",
      status: "Status",
      linkedOrder: "Linked sales order",
      fallbackLinks: "If the button does not work, use this link:",
      viewLink: viewLabelEn,
      phone: "Phone",
      website: "Website",
      address: "Address",
      email: "Email",
    },
    buttons: {
      view: viewLabelEn,
    },
    supportTitle: "Need assistance?",
    supportText: "If you need any help or clarification, please contact us using the details below.",
    signatureLead: "Kind regards,",
    signatureTeam: (companyName: string) => `${companyName} team`,
    footer: "Automated message sent by StockWise on behalf of your company.",
  };
}

function resolveCompanyBranding(
  sb: ReturnType<typeof supa>,
  company: CompanyRow | null | undefined,
  settingsData: Record<string, unknown>,
) {
  const settingsBrand = ((settingsData?.documents as any)?.brand ?? {}) as { name?: unknown; logoUrl?: unknown };
  const companyName =
    trimText(settingsBrand.name) ||
    trimText(company?.email_subject_prefix) ||
    trimText(company?.trade_name) ||
    trimText(company?.legal_name) ||
    trimText(company?.name) ||
    FALLBACK_BRAND;
  const companyLogoUrl =
    resolvePublicStorageUrl(sb, trimText(settingsBrand.logoUrl)) ||
    resolvePublicStorageUrl(sb, company?.logo_path, "brand-logos");

  return {
    companyName,
    companyLogoUrl,
    companySupportEmail:
      trimText(company?.email) || trimText(MAIL.defaultReplyToEmail) || trimText(MAIL.defaultFromEmail),
    companyPhone: trimText(company?.phone),
    companyWebsite: trimText(company?.website),
    companyWebsiteUrl: normalizeWebsite(company?.website),
    companyAddress: trimText(companyAddress(company)),
    footerNote: trimText(company?.print_footer_note),
  };
}

function htmlBody(opts: {
  lang: Lang;
  previewText: string;
  companyName: string;
  companyLogoUrl?: string | null;
  customerName?: string | null;
  anchorKind: ReminderAnchorKind;
  documentReference: string;
  linkedOrderReference?: string | null;
  dueDateFormatted: string;
  amountFormatted: string;
  statusLabel: string;
  dueSentence: string;
  viewDocumentUrl?: string;
  companyPhone?: string | null;
  companyWebsite?: string | null;
  companyWebsiteUrl?: string | null;
  companyAddress?: string | null;
  companySupportEmail?: string | null;
  footerNote?: string | null;
}) {
  const copy = reminderCopy(opts.lang, opts.anchorKind);
  const companyName = escapeHtml(opts.companyName);
  const supportEmail = trimText(opts.companySupportEmail);
  const websiteLabel = trimText(opts.companyWebsite);
  const websiteUrl = trimText(opts.companyWebsiteUrl);
  const address = trimText(opts.companyAddress);
  const footerNote = trimText(opts.footerNote);
  const linkedOrderReference = trimText(opts.linkedOrderReference);
  const logoBlock = opts.companyLogoUrl
    ? `<img src="${escapeHtml(opts.companyLogoUrl)}" alt="${companyName}" width="160" style="display:block;max-width:160px;width:auto;height:auto;max-height:52px;border:0;outline:none;text-decoration:none;margin:0 auto;" />`
    : "";
  const brandTextStyle = opts.companyLogoUrl
    ? "font-size:14px;line-height:20px;font-weight:600;color:#4b5563;margin-top:10px;"
    : "font-size:26px;line-height:1.2;font-weight:700;color:#111827;";

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(opts.previewText)}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0;padding:0;background:#f4f4f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:28px 32px 20px 32px;border-bottom:1px solid #e5e7eb;">
                ${logoBlock}
                <div style="${brandTextStyle}">${companyName}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 20px 32px;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#111827;">
                <div style="font-size:28px;line-height:1.2;font-weight:700;margin:0 0 12px 0;">${escapeHtml(copy.title)}</div>
                <p style="margin:0 0 8px 0;font-size:16px;line-height:24px;">${escapeHtml(copy.intro(opts.customerName))}</p>
                <p style="margin:0 0 20px 0;font-size:16px;line-height:24px;color:#374151;">
                  ${escapeHtml(copy.bodyLead(opts.documentReference, opts.dueSentence))}
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px 0;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;">
                  <tr>
                    <td style="padding:20px 22px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
                        <tr>
                          <td style="padding:0 0 10px 0;font-size:12px;line-height:18px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(copy.labels.documentReference)}</td>
                          <td style="padding:0 0 10px 0;font-size:12px;line-height:18px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;" align="right">${escapeHtml(copy.labels.status)}</td>
                        </tr>
                        <tr>
                          <td style="padding:0 0 16px 0;font-size:18px;line-height:24px;color:#111827;font-weight:700;">${escapeHtml(opts.documentReference)}</td>
                          <td style="padding:0 0 16px 0;font-size:14px;line-height:20px;color:#0f172a;font-weight:600;" align="right">${escapeHtml(opts.statusLabel)}</td>
                        </tr>
                        ${
                          linkedOrderReference && opts.anchorKind === "sales_invoice"
                            ? `<tr>
                                 <td colspan="2" style="padding:0 0 16px 0;font-size:13px;line-height:20px;color:#475569;">
                                   <strong>${escapeHtml(copy.labels.linkedOrder)}:</strong> ${escapeHtml(linkedOrderReference)}
                                 </td>
                               </tr>`
                            : ""
                        }
                        <tr>
                          <td style="padding:0 12px 0 0;width:50%;vertical-align:top;">
                            <div style="font-size:12px;line-height:18px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 6px 0;">${escapeHtml(copy.labels.dueDate)}</div>
                            <div style="font-size:15px;line-height:22px;color:#111827;font-weight:600;">${escapeHtml(opts.dueDateFormatted)}</div>
                          </td>
                          <td style="padding:0 0 0 12px;width:50%;vertical-align:top;" align="right">
                            <div style="font-size:12px;line-height:18px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin:0 0 6px 0;">${escapeHtml(copy.labels.amount)}</div>
                            <div style="font-size:15px;line-height:22px;color:#111827;font-weight:700;">${escapeHtml(opts.amountFormatted)}</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 8px 0;font-size:14px;line-height:22px;color:#475569;">
                  ${escapeHtml(copy.alreadyPaid)}
                </p>
                ${
                  opts.viewDocumentUrl
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px 0;">
                        <tr>
                          <td style="padding:0 0 12px 0;font-size:14px;line-height:22px;color:#475569;">
                            ${escapeHtml(copy.actionsNote)}
                          </td>
                        </tr>
                        <tr>
                          <td>
                            <a href="${escapeHtml(opts.viewDocumentUrl)}" target="_blank" style="display:block;padding:14px 18px;border-radius:10px;background:#0f172a;color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:600;text-align:center;">
                              ${escapeHtml(copy.buttons.view)}
                            </a>
                          </td>
                        </tr>
                      </table>`
                    : ""
                }

                ${
                  opts.viewDocumentUrl
                    ? `<div style="margin:0 0 24px 0;padding-top:4px;font-size:12px;line-height:18px;color:#6b7280;">
                        <div style="margin:0 0 8px 0;font-weight:600;">${escapeHtml(copy.labels.fallbackLinks)}</div>
                        <div style="margin:0;">
                          <strong>${escapeHtml(copy.labels.viewLink)}:</strong><br/>
                          <a href="${escapeHtml(opts.viewDocumentUrl)}" target="_blank" style="color:#2563eb;text-decoration:none;word-break:break-all;">${escapeHtml(opts.viewDocumentUrl)}</a>
                        </div>
                      </div>`
                    : ""
                }

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px 0;background:#fafaf9;border:1px solid #e7e5e4;border-radius:14px;">
                  <tr>
                    <td style="padding:18px 20px;">
                      <div style="font-size:18px;line-height:24px;font-weight:700;color:#111827;margin:0 0 8px 0;">${escapeHtml(copy.supportTitle)}</div>
                      <p style="margin:0 0 14px 0;font-size:14px;line-height:22px;color:#57534e;">${escapeHtml(copy.supportText)}</p>
                      ${
                        supportEmail || trimText(opts.companyPhone) || websiteLabel || address
                          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
                              ${supportEmail ? `<tr><td style="padding:0 0 8px 0;font-size:14px;line-height:20px;color:#111827;"><strong>${escapeHtml(copy.labels.email)}:</strong> <a href="mailto:${escapeHtml(supportEmail)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(supportEmail)}</a></td></tr>` : ""}
                              ${trimText(opts.companyPhone) ? `<tr><td style="padding:0 0 8px 0;font-size:14px;line-height:20px;color:#111827;"><strong>${escapeHtml(copy.labels.phone)}:</strong> ${escapeHtml(opts.companyPhone)}</td></tr>` : ""}
                              ${websiteLabel && websiteUrl ? `<tr><td style="padding:0 0 8px 0;font-size:14px;line-height:20px;color:#111827;"><strong>${escapeHtml(copy.labels.website)}:</strong> <a href="${escapeHtml(websiteUrl)}" target="_blank" style="color:#2563eb;text-decoration:none;">${escapeHtml(websiteLabel)}</a></td></tr>` : ""}
                              ${address ? `<tr><td style="padding:0;font-size:14px;line-height:20px;color:#111827;"><strong>${escapeHtml(copy.labels.address)}:</strong> ${escapeHtml(address)}</td></tr>` : ""}
                            </table>`
                          : ""
                      }
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 6px 0;font-size:14px;line-height:22px;color:#111827;">${escapeHtml(copy.signatureLead)}</p>
                <p style="margin:0;font-size:14px;line-height:22px;color:#111827;font-weight:600;">${escapeHtml(copy.signatureTeam(opts.companyName))}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 24px 32px;background:#fafaf9;border-top:1px solid #e5e7eb;font-family:Segoe UI,Roboto,Arial,sans-serif;">
                ${footerNote ? `<div style="font-size:12px;line-height:18px;color:#57534e;margin:0 0 8px 0;">${escapeHtml(footerNote)}</div>` : ""}
                <div style="font-size:12px;line-height:18px;color:#78716c;">${escapeHtml(copy.footer)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function textBody(opts: {
  lang: Lang;
  companyName: string;
  customerName?: string | null;
  anchorKind: ReminderAnchorKind;
  documentReference: string;
  linkedOrderReference?: string | null;
  dueDateFormatted: string;
  amountFormatted: string;
  statusLabel: string;
  dueSentence: string;
  viewDocumentUrl?: string;
  companyPhone?: string | null;
  companyWebsite?: string | null;
  companyAddress?: string | null;
  companySupportEmail?: string | null;
  footerNote?: string | null;
}) {
  const copy = reminderCopy(opts.lang, opts.anchorKind);
  const lines = [
    copy.title,
    "",
    copy.intro(opts.customerName),
    copy.bodyLead(opts.documentReference, opts.dueSentence),
    "",
    `${copy.labels.documentReference}: ${opts.documentReference}`,
    opts.linkedOrderReference && opts.anchorKind === "sales_invoice"
      ? `${copy.labels.linkedOrder}: ${opts.linkedOrderReference}`
      : "",
    `${copy.labels.dueDate}: ${opts.dueDateFormatted}`,
    `${copy.labels.amount}: ${opts.amountFormatted}`,
    `${copy.labels.status}: ${opts.statusLabel}`,
    "",
    copy.alreadyPaid,
    opts.viewDocumentUrl ? copy.actionsNote : "",
    "",
    opts.viewDocumentUrl ? `${copy.labels.viewLink}: ${opts.viewDocumentUrl}` : "",
    "",
    copy.supportTitle,
    copy.supportText,
    opts.companySupportEmail ? `${copy.labels.email}: ${opts.companySupportEmail}` : "",
    opts.companyPhone ? `${copy.labels.phone}: ${opts.companyPhone}` : "",
    opts.companyWebsite ? `${copy.labels.website}: ${opts.companyWebsite}` : "",
    opts.companyAddress ? `${copy.labels.address}: ${opts.companyAddress}` : "",
    "",
    copy.signatureLead,
    copy.signatureTeam(opts.companyName),
    opts.footerNote ?? "",
  ].filter(Boolean);

  return lines.join("\n");
}

function normalizeBatchReminder(row: BatchReminderRow): NormalizedReminder | null {
  const anchorKind = row.anchor_kind === "sales_invoice" ? "sales_invoice" : "sales_order";
  const salesOrderId = trimText(row.sales_order_id) || trimText(row.so_id);
  const salesInvoiceId = trimText(row.sales_invoice_id);
  const anchorId =
    trimText(row.anchor_id) ||
    (anchorKind === "sales_invoice" ? salesInvoiceId : salesOrderId);

  if (!anchorId) return null;

  return {
    anchorKind,
    anchorId,
    documentReference:
      trimText(row.document_reference) ||
      trimText(anchorKind === "sales_invoice" ? row.sales_invoice_reference : row.sales_order_reference) ||
      trimText(row.so_code) ||
      anchorId,
    dueDate: row.due_date,
    amount: Number(row.amount ?? 0),
    email: trimText(row.email),
    customerName: trimText(row.customer_name),
    daysUntilDue: Number(row.days_until_due ?? 0),
    currencyCode: trimText(row.currency_code) || trimText(row._currency),
    settlementStatus: trimText(row.settlement_status),
    resolutionStatus: trimText(row.resolution_status),
    salesOrderId,
    salesOrderReference: trimText(row.sales_order_reference) || trimText(row.so_code),
    salesInvoiceId,
    salesInvoiceReference: trimText(row.sales_invoice_reference),
    languageHint: normalizeReminderLang(row.language_hint),
  };
}

function authorized(req: Request) {
  if (!REMINDER_HOOK_SECRET) return false;
  const headerSecret = req.headers.get("x-webhook-secret") ?? "";
  return headerSecret === REMINDER_HOOK_SECRET;
}

function isMissingProcessingStartedAtColumn(error: { code?: string; message?: string; details?: string; hint?: string } | null | undefined) {
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ").toLowerCase();
  return text.includes("processing_started_at");
}

async function claimDueReminderJob(sb: ReturnType<typeof supa>, candidateId: number) {
  const processingStartedAt = new Date().toISOString();
  const withProcessingStarted = await sb
    .from("due_reminder_queue")
    .update({ status: "processing", processing_started_at: processingStartedAt })
    .eq("id", candidateId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (!isMissingProcessingStartedAtColumn(withProcessingStarted.error)) {
    return withProcessingStarted;
  }

  return await sb
    .from("due_reminder_queue")
    .update({ status: "processing" })
    .eq("id", candidateId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
}

async function updateDueReminderJob(
  sb: ReturnType<typeof supa>,
  jobId: number,
  values: Record<string, unknown>,
  expectedStatus?: QueueRow["status"],
) {
  const withProcessingStarted = await (() => {
    let query = sb.from("due_reminder_queue").update(values).eq("id", jobId);
    if (expectedStatus) query = query.eq("status", expectedStatus);
    return query;
  })();

  if (!isMissingProcessingStartedAtColumn(withProcessingStarted.error) || !Object.prototype.hasOwnProperty.call(values, "processing_started_at")) {
    return withProcessingStarted;
  }

  const fallbackValues = { ...values };
  delete fallbackValues.processing_started_at;

  return await (() => {
    let query = sb.from("due_reminder_queue").update(fallbackValues).eq("id", jobId);
    if (expectedStatus) query = query.eq("status", expectedStatus);
    return query;
  })();
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
    const { data: job, error: claimError } = await claimDueReminderJob(sb, candidate.id);
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
    const reminderBatch = (batch as Batch) ?? { window: {} as Batch["window"], reminders: [] };
    const reminders = (reminderBatch.reminders || [])
      .map(normalizeBatchReminder)
      .filter((row): row is NormalizedReminder => !!row);

    const orderIds = Array.from(
      new Set(reminders.map((row) => row.salesOrderId).filter((value): value is string => !!value)),
    );
    const invoiceIds = Array.from(
      new Set(
        reminders
          .map((row) => row.salesInvoiceId || (row.anchorKind === "sales_invoice" ? row.anchorId : null))
          .filter((value): value is string => !!value),
      ),
    );

    const orderMetaById = new Map<string, { id: string; order_no?: string | null; code?: string | null; currency_code?: string | null; bill_to_email?: string | null }>();
    if (orderIds.length) {
      const { data: orderRows, error: orderMetaError } = await sb
        .from("sales_orders")
        .select("id, order_no, code, currency_code, bill_to_email")
        .in("id", orderIds);
      if (orderMetaError) throw new Error(`lookup.so_meta: ${safeErr(orderMetaError)}`);
      for (const row of orderRows || []) {
        orderMetaById.set(row.id, row as any);
      }
    }

    const invoiceMetaById = new Map<string, { id: string; internal_reference?: string | null; document_language_code_snapshot?: string | null; sales_order_id?: string | null }>();
    if (invoiceIds.length) {
      const { data: invoiceRows, error: invoiceMetaError } = await sb
        .from("sales_invoices")
        .select("id, internal_reference, document_language_code_snapshot, sales_order_id")
        .in("id", invoiceIds);
      if (invoiceMetaError) throw new Error(`lookup.si_meta: ${safeErr(invoiceMetaError)}`);
      for (const row of invoiceRows || []) {
        invoiceMetaById.set(row.id, row as any);
      }
    }

    for (const row of reminders) {
      const invoiceId = row.salesInvoiceId || (row.anchorKind === "sales_invoice" ? row.anchorId : null);
      if (invoiceId) {
        const invoiceMeta = invoiceMetaById.get(invoiceId);
        if (invoiceMeta) {
          row.salesInvoiceId = invoiceId;
          row.salesInvoiceReference = row.salesInvoiceReference || trimText(invoiceMeta.internal_reference) || row.documentReference;
          row.languageHint = row.languageHint || normalizeReminderLang(invoiceMeta.document_language_code_snapshot);
          row.salesOrderId = row.salesOrderId || trimText(invoiceMeta.sales_order_id);
        }
      }

      const orderId = row.salesOrderId;
      if (orderId) {
        const orderMeta = orderMetaById.get(orderId);
        if (orderMeta) {
          row.salesOrderReference = row.salesOrderReference || trimText(orderMeta.order_no) || trimText(orderMeta.code) || orderId;
          row.currencyCode = row.currencyCode || trimText(orderMeta.currency_code);
          row.email = row.email || trimText(orderMeta.bill_to_email);
        }
      }

      if (row.anchorKind === "sales_invoice") {
        row.documentReference = row.salesInvoiceReference || row.documentReference;
      } else {
        row.documentReference = row.salesOrderReference || row.documentReference;
      }
    }

    if (!reminders.length) {
      await updateDueReminderJob(
        sb,
        job.id,
        {
          status: "done",
          processed_at: new Date().toISOString(),
          next_attempt_at: null,
          processing_started_at: null,
        },
      );
      return new Response(JSON.stringify({ ok: true, message: "no reminders for window" }), { status: 200 });
    }

    const { data: companyRow, error: companyError } = await sb
      .from("companies")
      .select("name,trade_name,legal_name,email_subject_prefix,email,phone,website,country_code,preferred_lang,address_line1,address_line2,city,state,postal_code,print_footer_note,logo_path")
      .eq("id", job.company_id)
      .single();
    if (companyError) throw new Error(`company.lookup: ${safeErr(companyError)}`);
    const company = (companyRow || {}) as CompanyRow;
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
    const defaultLang =
      normalizeReminderLang(job.payload?.lang) ||
      normalizeReminderLang(company.preferred_lang) ||
      (isPortugueseSpeakingCountry(company.country_code) ? "pt" : "en");
    const documentBaseUrl = resolveAppBaseUrl(
      PUBLIC_SITE_URL,
      job.payload?.document_base_url,
      job.payload?.invoice_base_url,
      trimText(settingsDue?.documentBaseUrl),
      trimText(settingsDue?.invoiceBaseUrl),
    );
    const branding = resolveCompanyBranding(sb, company, settingsData);
    const bcc = normalizeEmailList(job.payload?.bcc?.length ? job.payload.bcc : settingsDue?.bcc ?? []);
    const overrideRecipients = normalizeEmailList(job.payload?.recipients?.emails ?? settingsDue?.recipients ?? []);

    let sent = 0;
    for (const row of reminders) {
      const to = overrideRecipients.length
        ? overrideRecipients
        : row.email && /\S+@\S+\.\S+/.test(row.email)
          ? [row.email]
          : [];
      if (!to.length) continue;

      const lang = row.languageHint || defaultLang;
      const copy = reminderCopy(lang, row.anchorKind);
      const dueMeta = buildDuePhrase(lang, row.daysUntilDue);
      const amountFormatted = formatAmount(row.amount, row.currencyCode, lang);
      const dueDateFormatted = formatDate(row.dueDate, lang);
      const viewDocumentUrl = buildAnchorViewUrl(documentBaseUrl, row);
      const previewText = copy.preview(row.documentReference, dueMeta.previewSuffix);
      const subject = copy.subject(row.documentReference);
      const linkedOrderReference = row.anchorKind === "sales_invoice" ? row.salesOrderReference : null;
      const html = htmlBody({
        lang,
        previewText,
        companyName: branding.companyName,
        companyLogoUrl: branding.companyLogoUrl,
        customerName: row.customerName ?? undefined,
        anchorKind: row.anchorKind,
        documentReference: row.documentReference,
        linkedOrderReference,
        dueDateFormatted,
        amountFormatted,
        statusLabel: dueMeta.statusLabel,
        dueSentence: dueMeta.dueSentence,
        viewDocumentUrl,
        companyPhone: branding.companyPhone,
        companyWebsite: branding.companyWebsite,
        companyWebsiteUrl: branding.companyWebsiteUrl,
        companyAddress: branding.companyAddress,
        companySupportEmail: branding.companySupportEmail,
        footerNote: branding.footerNote,
      });
      const text = textBody({
        lang,
        companyName: branding.companyName,
        customerName: row.customerName ?? undefined,
        anchorKind: row.anchorKind,
        documentReference: row.documentReference,
        linkedOrderReference,
        dueDateFormatted,
        amountFormatted,
        statusLabel: dueMeta.statusLabel,
        dueSentence: dueMeta.dueSentence,
        viewDocumentUrl,
        companyPhone: branding.companyPhone,
        companyWebsite: branding.companyWebsite,
        companyAddress: branding.companyAddress,
        companySupportEmail: branding.companySupportEmail,
        footerNote: branding.footerNote,
      });

      if (DRY_RUN) {
        log("[DRY_RUN] would send reminder", { to, subject, anchorKind: row.anchorKind, reference: row.documentReference });
      } else {
        await sendTransactionalEmail(
          {
            to,
            bcc,
            subject,
            html,
            text,
            fromName: branding.companyName,
            replyTo: branding.companySupportEmail || MAIL.defaultReplyToEmail,
          },
          MAIL,
          { notificationType: "due_reminder", jobId: job.id, workerId: "due-reminder-worker" },
        );
      }
      sent++;
    }

    await updateDueReminderJob(
      sb,
      job.id,
      {
        status: "done",
        processed_at: new Date().toISOString(),
        next_attempt_at: null,
        processing_started_at: null,
      },
    );

    return new Response(JSON.stringify({ ok: true, sent, mode: DRY_RUN ? "dry" : "live" }), { status: 200 });
  } catch (error) {
    try {
      const sb = supa();
      if (claimedJobId !== null) {
        const nextAttempts = claimedAttempts + 1;
        const shouldFail = nextAttempts >= MAX_ATTEMPTS;
        const backoffMinutes = Math.min(60, Math.max(1, 2 ** Math.min(nextAttempts, 6)));
        const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
        await updateDueReminderJob(
          sb,
          claimedJobId,
          {
            attempts: nextAttempts,
            status: shouldFail ? "failed" : "pending",
            next_attempt_at: shouldFail ? null : nextAttemptAt,
            processing_started_at: null,
          },
          "processing",
        );
      }
    } catch {
      // best effort only
    }

    const message = error instanceof Error ? error.message : safeErr(error);
    if (DEBUG_LOG) console.error("[error]", message);
    return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
  }
});
