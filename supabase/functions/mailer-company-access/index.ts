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

type Lang = "en" | "pt";
type Mode = "preview" | "send";
type TemplateKey = "expiry_warning" | "purge_warning" | "activation_confirmation";

type CompanyAccessDetailRow = {
  company_id: string;
  company_name: string | null;
  legal_name: string | null;
  trade_name: string | null;
  company_email: string | null;
  company_preferred_lang: string | null;
  company_created_at: string | null;
  plan_code: string;
  plan_name: string;
  subscription_status: string;
  effective_status: string;
  trial_expires_at: string | null;
  access_granted_at: string | null;
  paid_until: string | null;
  purge_scheduled_at: string | null;
  notification_recipient_email: string | null;
  notification_recipient_name: string | null;
  notification_recipient_source: string | null;
};

type TemplatePreview = {
  template_key: TemplateKey;
  recipient_email: string;
  recipient_name: string | null;
  recipient_source: string;
  subject: string;
  html: string;
  text: string;
  support_email: string;
};

type TemplateCopy = {
  subject: (input: { companyName: string; planName: string; primaryDate: string }) => string;
  heading: string;
  intro: (input: { companyName: string; planName: string; primaryDate: string; secondaryDate?: string | null }) => string;
  detailLabel: string;
  detailBody: (input: { companyName: string; planName: string; primaryDate: string; secondaryDate?: string | null }) => string;
  noteTitle: string;
  noteBody: string;
  actionBody: string;
  footer: string;
  tags: {
    company: string;
    plan: string;
    primaryDate: string;
    secondaryDate?: string;
    recipient: string;
  };
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPABASE_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  "";
const ANON_KEY = Deno.env.get("SB_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const MAIL = getMailConfig();
const BRAND_NAME = MAIL.defaultFromName || "StockWise";
const SUPPORT_EMAIL = (Deno.env.get("SUPPORT_EMAIL") ?? "support@stockwiseapp.com").trim().toLowerCase();
const PUBLIC_SITE_URL = (MAIL.publicSiteUrl ?? "").replace(/\/+$/, "");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error("Missing one of SB_URL / SB_SERVICE_ROLE_KEY / SB_ANON_KEY (or SUPABASE_* fallbacks)");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

function getBearer(req: Request): string {
  const auth = req.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : auth;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeLang(value: string | null | undefined): Lang {
  return String(value ?? "").trim().toLowerCase().startsWith("pt") ? "pt" : "en";
}

function parseMode(value: unknown): Mode {
  return String(value ?? "preview").trim().toLowerCase() === "send" ? "send" : "preview";
}

function parseTemplateKey(value: unknown): TemplateKey {
  const key = String(value ?? "").trim().toLowerCase();
  if (key === "expiry_warning" || key === "purge_warning" || key === "activation_confirmation") {
    return key;
  }
  throw new HttpError(400, "company_access_email_template_invalid", "Invalid company access email template");
}

function ensureText(value: string | null | undefined, code: string, message: string) {
  const text = String(value ?? "").trim();
  if (!text) throw new HttpError(400, code, message);
  return text;
}

function formatDate(value: string, lang: Lang) {
  return new Intl.DateTimeFormat(lang === "pt" ? "pt-MZ" : "en-MZ", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Maputo",
  }).format(new Date(value));
}

function companyLabel(detail: CompanyAccessDetailRow) {
  return (
    detail.trade_name?.trim() ||
    detail.legal_name?.trim() ||
    detail.company_name?.trim() ||
    detail.company_id
  );
}

function resolveExpiryDate(detail: CompanyAccessDetailRow) {
  if (detail.effective_status === "active_paid" && detail.paid_until) return detail.paid_until;
  if (detail.trial_expires_at) return detail.trial_expires_at;
  if (detail.paid_until) return detail.paid_until;
  return null;
}

function templateCopy(lang: Lang, templateKey: TemplateKey): TemplateCopy {
  if (lang === "pt") {
    switch (templateKey) {
      case "expiry_warning":
        return {
          subject: ({ companyName, primaryDate }) => `StockWise: acesso da empresa ${companyName} expira em ${primaryDate}`,
          heading: "Aviso de expiração de acesso",
          intro: ({ companyName, primaryDate }) =>
            `O acesso operacional da empresa ${companyName} está configurado para expirar em ${primaryDate}.`,
          detailLabel: "O que isto significa",
          detailBody: ({ planName, primaryDate }) =>
            `O plano atual é ${planName}. Se o acesso precisar continuar sem interrupção depois de ${primaryDate}, a renovação ou ativação deve ser pedida à equipa StockWise.`,
          noteTitle: "Próximo passo",
          noteBody: "Este aviso não confirma qualquer cobrança automática. A ativação e a renovação continuam a ser tratadas manualmente pela equipa StockWise.",
          actionBody: "Para continuar a usar a empresa sem interrupção, responda a este email ou contacte a equipa StockWise antes da data indicada.",
          footer: "As credenciais de utilizador permanecem intactas. Este aviso trata apenas do estado de acesso da empresa.",
          tags: {
            company: "Empresa",
            plan: "Plano",
            primaryDate: "Data de expiração",
            recipient: "Destinatário",
          },
        };
      case "purge_warning":
        return {
          subject: ({ companyName, primaryDate }) => `StockWise: dados operacionais de ${companyName} agendados para purge em ${primaryDate}`,
          heading: "Aviso de purge operacional",
          intro: ({ companyName, primaryDate }) =>
            `Os dados operacionais da empresa ${companyName} estão agendados para purge em ${primaryDate} caso o acesso não seja renovado a tempo.`,
          detailLabel: "Política atual",
          detailBody: ({ secondaryDate, primaryDate }) =>
            secondaryDate
              ? `O acesso atual expira em ${secondaryDate}. Se continuar inativo, o purge operacional está agendado para ${primaryDate}.`
              : `Se a empresa continuar sem acesso ativo, o purge operacional está agendado para ${primaryDate}.`,
          noteTitle: "Escopo do purge",
          noteBody: "O purge operacional remove dados da empresa, como documentos, movimentos, stock e registos operacionais. As credenciais de autenticação não são eliminadas por este processo.",
          actionBody: "Se a empresa precisar de ser mantida ativa, contacte a equipa StockWise antes da data de purge para rever o estado do acesso.",
          footer: "Este aviso não implica eliminação de utilizadores ou credenciais. Aplica-se apenas aos dados operacionais da empresa.",
          tags: {
            company: "Empresa",
            plan: "Plano",
            primaryDate: "Data de purge",
            secondaryDate: "Data de expiração",
            recipient: "Destinatário",
          },
        };
      case "activation_confirmation":
        return {
          subject: ({ companyName, planName }) => `StockWise: ${companyName} ativada no plano ${planName}`,
          heading: "Confirmação de ativação paga",
          intro: ({ companyName, planName }) =>
            `A equipa StockWise confirmou a ativação da empresa ${companyName} no plano ${planName}.`,
          detailLabel: "Janela de acesso",
          detailBody: ({ planName, primaryDate, secondaryDate }) =>
            `O acesso pago no plano ${planName} está ativo de ${primaryDate} até ${secondaryDate || primaryDate}.`,
          noteTitle: "Modelo comercial atual",
          noteBody: "Esta confirmação regista uma ativação manual feita pela equipa StockWise. Não significa que checkout automático ou faturação automática estejam ativos.",
          actionBody: "Se precisar de apoio com onboarding, utilizadores ou preparação operacional, contacte a equipa StockWise e indique a empresa ativada.",
          footer: "A confirmação reflete o estado atual guardado no controlo de plataforma.",
          tags: {
            company: "Empresa",
            plan: "Plano",
            primaryDate: "Ativa desde",
            secondaryDate: "Válida até",
            recipient: "Destinatário",
          },
        };
    }
  }

  switch (templateKey) {
    case "expiry_warning":
      return {
        subject: ({ companyName, primaryDate }) => `StockWise: ${companyName} access expires on ${primaryDate}`,
        heading: "Company access expiry warning",
        intro: ({ companyName, primaryDate }) =>
          `Company access for ${companyName} is scheduled to expire on ${primaryDate}.`,
        detailLabel: "What this means",
        detailBody: ({ planName, primaryDate }) =>
          `The current plan is ${planName}. If access needs to continue beyond ${primaryDate}, renewal or paid activation must be arranged with the StockWise team.`,
        noteTitle: "Next step",
        noteBody: "This notice does not confirm any automatic billing. Activation and renewal are still handled manually by the StockWise team.",
        actionBody: "If uninterrupted access is required, reply to this email or contact StockWise support before the stated expiry date.",
        footer: "User credentials remain intact. This notice only concerns the company's access state.",
        tags: {
          company: "Company",
          plan: "Plan",
          primaryDate: "Expiry date",
          recipient: "Recipient",
        },
      };
    case "purge_warning":
      return {
        subject: ({ companyName, primaryDate }) => `StockWise: ${companyName} operational data is scheduled for purge on ${primaryDate}`,
        heading: "Operational purge warning",
        intro: ({ companyName, primaryDate }) =>
          `Operational data for ${companyName} is scheduled for purge on ${primaryDate} unless access is renewed before then.`,
        detailLabel: "Current policy",
        detailBody: ({ secondaryDate, primaryDate }) =>
          secondaryDate
            ? `Current access expires on ${secondaryDate}. If access is not restored, operational company data is scheduled for purge on ${primaryDate}.`
            : `If access is not restored, operational company data is scheduled for purge on ${primaryDate}.`,
        noteTitle: "What the purge affects",
        noteBody: "Operational purge removes company business data such as documents, stock, settlements, and operational master data. Authentication credentials are retained.",
        actionBody: "If this company still needs to operate, contact the StockWise team before the purge date to review renewal or activation.",
        footer: "This warning does not imply deletion of user credentials. It applies only to operational company data.",
        tags: {
          company: "Company",
          plan: "Plan",
          primaryDate: "Purge date",
          secondaryDate: "Expiry date",
          recipient: "Recipient",
        },
      };
    case "activation_confirmation":
      return {
        subject: ({ companyName, planName }) => `StockWise: ${companyName} is now active on the ${planName} plan`,
        heading: "Paid activation confirmation",
        intro: ({ companyName, planName }) =>
          `The StockWise team has confirmed paid access for ${companyName} on the ${planName} plan.`,
        detailLabel: "Access window",
        detailBody: ({ planName, primaryDate, secondaryDate }) =>
          `Paid access on the ${planName} plan is active from ${primaryDate} to ${secondaryDate || primaryDate}.`,
        noteTitle: "Current commercial model",
        noteBody: "This is a manual activation confirmation from the StockWise team. It does not imply automated checkout or automatic billing.",
        actionBody: "If you need help with onboarding, users, or operational setup, reply to this email or contact StockWise support.",
        footer: "This confirmation reflects the access state currently saved in platform control.",
        tags: {
          company: "Company",
          plan: "Plan",
          primaryDate: "Active from",
          secondaryDate: "Paid until",
          recipient: "Recipient",
        },
      };
  }
}

function buildPreview(detail: CompanyAccessDetailRow, templateKey: TemplateKey): TemplatePreview {
  const lang = normalizeLang(detail.company_preferred_lang);
  const companyName = companyLabel(detail);
  const planName = detail.plan_name || detail.plan_code;
  const recipientEmail = ensureText(
    detail.notification_recipient_email,
    "company_notification_recipient_missing",
    "No canonical company recipient is available for this company.",
  );
  const recipientName = detail.notification_recipient_name?.trim() || null;
  const recipientSource = detail.notification_recipient_source?.trim() || "not_captured";

  let primaryDateIso: string | null = null;
  let secondaryDateIso: string | null = null;

  if (templateKey === "expiry_warning") {
    primaryDateIso = resolveExpiryDate(detail);
    if (!primaryDateIso) {
      throw new HttpError(400, "company_access_expiry_date_missing", "No expiry date is configured for this company.");
    }
  } else if (templateKey === "purge_warning") {
    primaryDateIso = detail.purge_scheduled_at;
    if (!primaryDateIso) {
      throw new HttpError(400, "company_access_purge_date_missing", "No purge schedule is configured for this company.");
    }
    secondaryDateIso = resolveExpiryDate(detail);
  } else {
    if (detail.effective_status !== "active_paid") {
      throw new HttpError(400, "company_access_activation_confirmation_not_ready", "Activation confirmation is only available for companies in active paid access.");
    }
    primaryDateIso = detail.access_granted_at;
    secondaryDateIso = detail.paid_until;
    if (!primaryDateIso || !secondaryDateIso) {
      throw new HttpError(400, "company_access_activation_window_missing", "Activation confirmation requires both access-granted and paid-until dates.");
    }
  }

  const primaryDate = formatDate(primaryDateIso, lang);
  const secondaryDate = secondaryDateIso ? formatDate(secondaryDateIso, lang) : null;
  const copy = templateCopy(lang, templateKey);
  const subject = copy.subject({ companyName, planName, primaryDate });
  const intro = copy.intro({ companyName, planName, primaryDate, secondaryDate });
  const detailBody = copy.detailBody({ companyName, planName, primaryDate, secondaryDate });

  const html = `
    <div style="background:#f4f7fb;padding:24px;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:24px;overflow:hidden;">
        <div style="padding:28px 32px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#f8fbff 0%,#eef5ff 100%);">
          <div style="font-size:13px;line-height:1.4;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#3b82f6;">StockWise</div>
          <div style="margin-top:14px;font-size:30px;line-height:1.15;font-weight:700;color:#0f172a;">${escapeHtml(copy.heading)}</div>
          <div style="margin-top:12px;font-size:16px;line-height:1.7;color:#334155;">${escapeHtml(intro)}</div>
        </div>
        <div style="padding:28px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0 12px;">
            <tr>
              <td style="padding:16px 18px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc;">
                <div style="font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(copy.tags.company)}</div>
                <div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:600;color:#0f172a;">${escapeHtml(companyName)}</div>
              </td>
              <td style="padding:16px 18px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc;">
                <div style="font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(copy.tags.plan)}</div>
                <div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:600;color:#0f172a;">${escapeHtml(planName)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 18px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc;">
                <div style="font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(copy.tags.primaryDate)}</div>
                <div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:600;color:#0f172a;">${escapeHtml(primaryDate)}</div>
              </td>
              <td style="padding:16px 18px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc;">
                <div style="font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(copy.tags.recipient)}</div>
                <div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:600;color:#0f172a;">${escapeHtml(recipientName || recipientEmail)}</div>
                <div style="margin-top:4px;font-size:13px;line-height:1.6;color:#475569;word-break:break-word;">${escapeHtml(recipientEmail)}</div>
              </td>
            </tr>
            ${
              copy.tags.secondaryDate && secondaryDate
                ? `<tr>
                     <td colspan="2" style="padding:16px 18px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc;">
                       <div style="font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(copy.tags.secondaryDate)}</div>
                       <div style="margin-top:8px;font-size:16px;line-height:1.5;font-weight:600;color:#0f172a;">${escapeHtml(secondaryDate)}</div>
                     </td>
                   </tr>`
                : ""
            }
          </table>

          <div style="margin-top:8px;padding:20px;border:1px solid #dbe4f0;border-radius:20px;background:#f8fbff;">
            <div style="font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(copy.detailLabel)}</div>
            <div style="margin-top:10px;font-size:15px;line-height:1.8;color:#334155;">${escapeHtml(detailBody)}</div>
          </div>

          <div style="margin-top:16px;padding:20px;border:1px solid #e2e8f0;border-radius:20px;background:#ffffff;">
            <div style="font-size:12px;line-height:1.4;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(copy.noteTitle)}</div>
            <div style="margin-top:10px;font-size:15px;line-height:1.8;color:#334155;">${escapeHtml(copy.noteBody)}</div>
            <div style="margin-top:12px;font-size:15px;line-height:1.8;color:#334155;">${escapeHtml(copy.actionBody)}</div>
          </div>
        </div>
        <div style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <div style="font-size:14px;line-height:1.8;color:#334155;">
            ${escapeHtml(copy.footer)}
          </div>
          <div style="margin-top:10px;font-size:14px;line-height:1.8;color:#334155;">
            ${lang === "pt" ? "Suporte StockWise" : "StockWise support"}:
            <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(SUPPORT_EMAIL)}</a>
          </div>
          ${
            PUBLIC_SITE_URL
              ? `<div style="margin-top:4px;font-size:13px;line-height:1.7;color:#64748b;">${escapeHtml(PUBLIC_SITE_URL)}</div>`
              : ""
          }
        </div>
      </div>
    </div>
  `.trim();

  const textLines = [
    copy.heading,
    "",
    intro,
    "",
    `${copy.tags.company}: ${companyName}`,
    `${copy.tags.plan}: ${planName}`,
    `${copy.tags.primaryDate}: ${primaryDate}`,
    copy.tags.secondaryDate && secondaryDate ? `${copy.tags.secondaryDate}: ${secondaryDate}` : "",
    `${copy.tags.recipient}: ${recipientName || recipientEmail} <${recipientEmail}>`,
    "",
    `${copy.detailLabel}: ${detailBody}`,
    "",
    `${copy.noteTitle}: ${copy.noteBody}`,
    copy.actionBody,
    "",
    copy.footer,
    `${lang === "pt" ? "Suporte StockWise" : "StockWise support"}: ${SUPPORT_EMAIL}`,
    PUBLIC_SITE_URL || "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    template_key: templateKey,
    recipient_email: recipientEmail,
    recipient_name: recipientName,
    recipient_source: recipientSource,
    subject,
    html,
    text: textLines,
    support_email: SUPPORT_EMAIL,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await readJsonBody(req, 12_000);
    const companyId = requireText(body.company_id, "company_id", 64);
    const templateKey = parseTemplateKey(body.template_key);
    const mode = parseMode(body.mode);
    const note = optionalText(body.note, 500);
    const jwt = getBearer(req);
    if (!jwt) throw new HttpError(401, "missing_bearer_token", "Missing bearer token");

    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await anon.auth.getUser(jwt);
    if (userError || !userData?.user) {
      throw new HttpError(401, "invalid_token", "Invalid bearer token");
    }

    const userId = userData.user.id;
    const clientIp = getClientIp(req) ?? "unknown";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    await enforceRateLimit(admin, {
      scope: mode === "send" ? "platform-control:company-access-email-send" : "platform-control:company-access-email-preview",
      subject: `${companyId}:${templateKey}:${userId}:${clientIp}`,
      windowSeconds: mode === "send" ? 1800 : 300,
      maxHits: mode === "send" ? 6 : 20,
    });

    const { data: detailData, error: detailError } = await userClient.rpc("platform_admin_get_company_detail", {
      p_company_id: companyId,
    });
    if (detailError) {
      if (String(detailError.message || "").toLowerCase().includes("platform_admin_required")) {
        throw new HttpError(403, "platform_admin_required", "Platform admin access is required for this action.");
      }
      throw new HttpError(500, "company_detail_load_failed", detailError.message);
    }

    const detail = Array.isArray(detailData) ? detailData[0] : detailData;
    if (!detail) {
      throw new HttpError(404, "company_not_found", "The selected company no longer exists.");
    }

    const preview = buildPreview(detail as CompanyAccessDetailRow, templateKey);
    if (mode === "preview") {
      return json({ ok: true, preview });
    }

    requireMailConfig(MAIL);
    const sendResult = await sendTransactionalEmail(
      {
        to: [preview.recipient_email],
        subject: preview.subject,
        html: preview.html,
        text: preview.text,
        fromEmail: MAIL.defaultFromEmail,
        fromName: BRAND_NAME,
        replyTo: SUPPORT_EMAIL,
      },
      MAIL,
      {
        notificationType: `company_access_${templateKey}`,
        workerId: "mailer-company-access",
      },
    );

    const { error: auditError } = await userClient.rpc("platform_admin_record_company_access_email", {
      p_company_id: companyId,
      p_template_key: templateKey,
      p_recipient_email: preview.recipient_email,
      p_recipient_source: preview.recipient_source,
      p_subject: preview.subject,
      p_reason: note ?? null,
      p_context: {
        mode: "send",
        message_id: sendResult?.messageId ?? null,
      },
    });
    if (auditError) {
      throw new HttpError(500, "company_access_email_audit_failed", `Email sent but audit logging failed: ${auditError.message}`);
    }

    return json({
      ok: true,
      sent: {
        template_key: preview.template_key,
        recipient_email: preview.recipient_email,
        recipient_source: preview.recipient_source,
        subject: preview.subject,
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.code, message: error.message, details: error.details }, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: "unexpected", message }, 500);
  }
});
