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
  logo_path?: string | null;
};

const MAIL = requireMailConfig(getMailConfig());
const FALLBACK_BRAND = MAIL.defaultFromName || "StockWise";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REMINDER_HOOK_SECRET = Deno.env.get("REMINDER_HOOK_SECRET") ?? "";
const DEBUG_LOG = (Deno.env.get("DEBUG_LOG") ?? "false").toLowerCase() === "true";
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "false").toLowerCase() === "true";
const MAX_ATTEMPTS = Number(Deno.env.get("DUE_REMINDER_MAX_ATTEMPTS") ?? "8");

type Lang = "en" | "pt";

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

function trimText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
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
      // ignore and fall back
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

function buildDocumentUrl(base: string, code: string, download: boolean) {
  if (!trimText(base)) return undefined;
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
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase() === "download") url.searchParams.delete(key);
    }
    if (download) url.searchParams.set("download", "1");
    return url.toString();
  } catch {
    const joiner = base.includes("?") ? "&" : "?";
    return download
      ? `${base.replace(/\/$/, "")}/${encodeURIComponent(code)}${joiner}download=1`
      : `${base.replace(/\/$/, "")}/${encodeURIComponent(code)}`;
  }
}

function buildViewOrderUrl(base: string, code: string) {
  return buildDocumentUrl(base, code, false);
}

function buildDownloadPdfUrl(base: string, code: string) {
  return buildDocumentUrl(base, code, true);
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

function reminderCopy(lang: Lang) {
  return lang === "pt"
    ? {
        title: "Aviso de vencimento",
        intro: (customerName?: string | null) => (customerName ? `Olá ${customerName},` : "Olá,"),
        bodyLead: (orderNumber: string, dueSentence: string) =>
          `Informamos que o pedido ${orderNumber} ${dueSentence}.`,
        alreadyPaid: "Caso o pagamento já tenha sido efectuado, por favor desconsidere esta mensagem.",
        actionsNote:
          "Para consultar os detalhes do pedido ou descarregar o respectivo documento, utilize as opções abaixo.",
        subject: (orderNumber: string) => `Aviso de vencimento, Pedido ${orderNumber}`,
        preview: (orderNumber: string, previewSuffix: string) =>
          `O pedido ${orderNumber} ${previewSuffix}. Consulte os detalhes e descarregue o documento.`,
        labels: {
          orderNumber: "Pedido",
          dueDate: "Data de vencimento",
          amount: "Montante em aberto",
          status: "Estado",
          fallbackLinks: "Se os botões não funcionarem, utilize estes links:",
          viewLink: "Ver pedido",
          downloadLink: "Descarregar PDF",
          phone: "Telefone",
          website: "Website",
          address: "Endereço",
          email: "Email",
        },
        buttons: {
          view: "Ver pedido",
          download: "Descarregar PDF",
        },
        supportTitle: "Precisa de apoio?",
        supportText:
          "Para regularizar a situação ou esclarecer qualquer dúvida, contacte-nos através dos meios abaixo.",
        signatureLead: "Com os melhores cumprimentos,",
        signatureTeam: (companyName: string) => `Equipa ${companyName}`,
        footer: "Mensagem automática enviada pelo StockWise em nome da sua empresa.",
      }
    : {
        title: "Payment reminder",
        intro: (customerName?: string | null) => (customerName ? `Hello ${customerName},` : "Hello,"),
        bodyLead: (orderNumber: string, dueSentence: string) =>
          `This is a reminder that Sales Order ${orderNumber} ${dueSentence}.`,
        alreadyPaid: "If payment has already been made, please disregard this message.",
        actionsNote:
          "To review the order details or download the document, please use the options below.",
        subject: (orderNumber: string) => `Payment reminder, Sales Order ${orderNumber}`,
        preview: (orderNumber: string, previewSuffix: string) =>
          `Sales Order ${orderNumber} ${previewSuffix}. Review the details or download the document.`,
        labels: {
          orderNumber: "Sales Order",
          dueDate: "Due date",
          amount: "Outstanding amount",
          status: "Status",
          fallbackLinks: "If the buttons do not work, use these links:",
          viewLink: "View order",
          downloadLink: "Download PDF",
          phone: "Phone",
          website: "Website",
          address: "Address",
          email: "Email",
        },
        buttons: {
          view: "View order",
          download: "Download PDF",
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
  orderNumber: string;
  dueDateFormatted: string;
  amountFormatted: string;
  statusLabel: string;
  dueSentence: string;
  viewOrderUrl?: string;
  downloadPdfUrl?: string;
  companyPhone?: string | null;
  companyWebsite?: string | null;
  companyWebsiteUrl?: string | null;
  companyAddress?: string | null;
  companySupportEmail?: string | null;
  footerNote?: string | null;
}) {
  const copy = reminderCopy(opts.lang);
  const companyName = escapeHtml(opts.companyName);
  const showDownload = !!opts.downloadPdfUrl && opts.downloadPdfUrl !== opts.viewOrderUrl;
  const supportEmail = trimText(opts.companySupportEmail);
  const websiteLabel = trimText(opts.companyWebsite);
  const websiteUrl = trimText(opts.companyWebsiteUrl);
  const address = trimText(opts.companyAddress);
  const footerNote = trimText(opts.footerNote);
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
                  ${escapeHtml(copy.bodyLead(opts.orderNumber, opts.dueSentence))}
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px 0;background:#f8fafc;border:1px solid #e5e7eb;border-radius:14px;">
                  <tr>
                    <td style="padding:20px 22px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
                        <tr>
                          <td style="padding:0 0 10px 0;font-size:12px;line-height:18px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(copy.labels.orderNumber)}</td>
                          <td style="padding:0 0 10px 0;font-size:12px;line-height:18px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;" align="right">${escapeHtml(copy.labels.status)}</td>
                        </tr>
                        <tr>
                          <td style="padding:0 0 16px 0;font-size:18px;line-height:24px;color:#111827;font-weight:700;">${escapeHtml(opts.orderNumber)}</td>
                          <td style="padding:0 0 16px 0;font-size:14px;line-height:20px;color:#0f172a;font-weight:600;" align="right">${escapeHtml(opts.statusLabel)}</td>
                        </tr>
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
                <p style="margin:0 0 20px 0;font-size:14px;line-height:22px;color:#475569;">
                  ${escapeHtml(copy.actionsNote)}
                </p>

                ${
                  opts.viewOrderUrl
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 12px 0;">
                        <tr>
                          <td>
                            <a href="${escapeHtml(opts.viewOrderUrl)}" target="_blank" style="display:block;padding:14px 18px;border-radius:10px;background:#0f172a;color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:600;text-align:center;">
                              ${escapeHtml(copy.buttons.view)}
                            </a>
                          </td>
                        </tr>
                      </table>`
                    : ""
                }
                ${
                  showDownload
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px 0;">
                        <tr>
                          <td>
                            <a href="${escapeHtml(opts.downloadPdfUrl)}" target="_blank" style="display:block;padding:14px 18px;border-radius:10px;background:#ffffff;border:1px solid #cbd5e1;color:#0f172a;text-decoration:none;font-size:15px;line-height:20px;font-weight:600;text-align:center;">
                              ${escapeHtml(copy.buttons.download)}
                            </a>
                          </td>
                        </tr>
                      </table>`
                    : ""
                }

                ${
                  opts.viewOrderUrl || showDownload
                    ? `<div style="margin:0 0 24px 0;padding-top:4px;font-size:12px;line-height:18px;color:#6b7280;">
                        <div style="margin:0 0 8px 0;font-weight:600;">${escapeHtml(copy.labels.fallbackLinks)}</div>
                        ${
                          opts.viewOrderUrl
                            ? `<div style="margin:0 0 6px 0;">
                                <strong>${escapeHtml(copy.labels.viewLink)}:</strong><br/>
                                <a href="${escapeHtml(opts.viewOrderUrl)}" target="_blank" style="color:#2563eb;text-decoration:none;word-break:break-all;">${escapeHtml(opts.viewOrderUrl)}</a>
                              </div>`
                            : ""
                        }
                        ${
                          showDownload
                            ? `<div style="margin:0;">
                                <strong>${escapeHtml(copy.labels.downloadLink)}:</strong><br/>
                                <a href="${escapeHtml(opts.downloadPdfUrl)}" target="_blank" style="color:#2563eb;text-decoration:none;word-break:break-all;">${escapeHtml(opts.downloadPdfUrl)}</a>
                              </div>`
                            : ""
                        }
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
  orderNumber: string;
  dueDateFormatted: string;
  amountFormatted: string;
  statusLabel: string;
  dueSentence: string;
  viewOrderUrl?: string;
  downloadPdfUrl?: string;
  companyPhone?: string | null;
  companyWebsite?: string | null;
  companyAddress?: string | null;
  companySupportEmail?: string | null;
  footerNote?: string | null;
}) {
  const copy = reminderCopy(opts.lang);
  const showDownload = !!opts.downloadPdfUrl && opts.downloadPdfUrl !== opts.viewOrderUrl;
  const lines = [
    copy.title,
    "",
    copy.intro(opts.customerName),
    copy.bodyLead(opts.orderNumber, opts.dueSentence),
    "",
    `${copy.labels.orderNumber}: ${opts.orderNumber}`,
    `${copy.labels.dueDate}: ${opts.dueDateFormatted}`,
    `${copy.labels.amount}: ${opts.amountFormatted}`,
    `${copy.labels.status}: ${opts.statusLabel}`,
    "",
    copy.alreadyPaid,
    copy.actionsNote,
    "",
    opts.viewOrderUrl ? `${copy.labels.viewLink}: ${opts.viewOrderUrl}` : "",
    showDownload ? `${copy.labels.downloadLink}: ${opts.downloadPdfUrl}` : "",
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
    let query = sb.from("due_reminder_queue").update(values).eq("id", jobId)
    if (expectedStatus) query = query.eq("status", expectedStatus)
    return query
  })()

  if (!isMissingProcessingStartedAtColumn(withProcessingStarted.error) || !Object.prototype.hasOwnProperty.call(values, "processing_started_at")) {
    return withProcessingStarted
  }

  const fallbackValues = { ...values }
  delete fallbackValues.processing_started_at

  return await (() => {
    let query = sb.from("due_reminder_queue").update(fallbackValues).eq("id", jobId)
    if (expectedStatus) query = query.eq("status", expectedStatus)
    return query
  })()
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
    const langSetting = trimText(job.payload?.lang) || trimText(company.preferred_lang);
    const lang: Lang =
      langSetting?.toLowerCase() === "pt"
        ? "pt"
        : langSetting?.toLowerCase() === "en"
          ? "en"
          : isPortugueseSpeakingCountry(company.country_code)
            ? "pt"
            : "en";
    const copy = reminderCopy(lang);
    const documentBaseUrl = trimText(job.payload?.invoice_base_url) ||
      trimText(settingsDue?.invoiceBaseUrl) ||
      "";
    const branding = resolveCompanyBranding(sb, company, settingsData);
    const bcc = (job.payload?.bcc?.length ? job.payload.bcc : (settingsDue?.bcc ?? [])) as string[];

    let sent = 0;
    for (const row of reminderBatch.reminders) {
      const to = (row as any)._toEmail && /\S+@\S+\.\S+/.test((row as any)._toEmail) ? [(row as any)._toEmail] : [];
      if (!to.length) continue;

      const displayCode = row.so_code || row.so_id;
      const dueMeta = buildDuePhrase(lang, row.days_until_due);
      const amountFormatted = formatAmount(row.amount, (row as any)._currency, lang);
      const dueDateFormatted = formatDate(row.due_date, lang);
      const viewOrderUrl = documentBaseUrl && displayCode ? buildViewOrderUrl(documentBaseUrl, displayCode) : undefined;
      const downloadPdfUrl = documentBaseUrl && displayCode
        ? buildDownloadPdfUrl(documentBaseUrl, displayCode)
        : undefined;
      const previewText = copy.preview(displayCode, dueMeta.previewSuffix);
      const subject = copy.subject(displayCode);
      const html = htmlBody({
        lang,
        previewText,
        companyName: branding.companyName,
        companyLogoUrl: branding.companyLogoUrl,
        customerName: row.customer_name ?? undefined,
        orderNumber: displayCode,
        dueDateFormatted,
        amountFormatted,
        statusLabel: dueMeta.statusLabel,
        dueSentence: dueMeta.dueSentence,
        viewOrderUrl,
        downloadPdfUrl,
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
        customerName: row.customer_name ?? undefined,
        orderNumber: displayCode,
        dueDateFormatted,
        amountFormatted,
        statusLabel: dueMeta.statusLabel,
        dueSentence: dueMeta.dueSentence,
        viewOrderUrl,
        downloadPdfUrl,
        companyPhone: branding.companyPhone,
        companyWebsite: branding.companyWebsite,
        companyAddress: branding.companyAddress,
        companySupportEmail: branding.companySupportEmail,
        footerNote: branding.footerNote,
      });

      if (DRY_RUN) {
        log("[DRY_RUN] would send reminder", { to, subject });
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
