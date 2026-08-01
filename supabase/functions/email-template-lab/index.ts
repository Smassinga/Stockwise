import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getMailConfig, requireMailConfig, sendTransactionalEmail } from "../_shared/mailer.ts";
import { EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATES, renderDiscriminatedEmail, type EmailTemplateInputMap, type EmailTemplateKey } from "../_shared/emailTemplates.ts";
import type { EmailLanguage } from "../_shared/emailMoney.ts";
import { resolveEmailIdentity } from "../_shared/emailIdentity.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const allowedRecipients = new Set((Deno.env.get("EMAIL_QA_ALLOWED_RECIPIENTS") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
const configuredSiteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "").replace(/\/+$/, "");
const allowedOrigins = new Set([
  "https://stockwiseapp.com",
  "https://www.stockwiseapp.com",
  "https://app.stockwise.co.mz",
  configuredSiteUrl,
].filter(Boolean));
const corsForRequest = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://stockwiseapp.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
};

serve(async (req) => {
  const cors = corsForRequest(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "not_authenticated" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: userData } = await userClient.auth.getUser(token);
    if (!userData.user) return json({ error: "not_authenticated" }, 401);
    const { data: isAdmin, error: adminError } = await userClient.rpc("is_platform_admin");
    if (adminError || !isAdmin) return json({ error: "platform_admin_required" }, 403);
    const { data: activeCompanyId } = await userClient.rpc("current_company_id");
    const admin = SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } }) : null;
    const body = await req.json();
    const mode = body.mode === "send" ? "send" : body.mode === "recent" ? "recent" : body.mode === "list" ? "list" : "preview";
    if (mode === "list") return json({ templates: EMAIL_TEMPLATE_KEYS.map((key) => ({ key, version: EMAIL_TEMPLATES[key].version, languages: EMAIL_TEMPLATES[key].supportedLanguages, semanticVariant: EMAIL_TEMPLATES[key].semanticVariant, requiredFields: EMAIL_TEMPLATES[key].requiredFields, scenarioLabel: `synthetic_${key}` })) });
    if (mode === "recent") {
      const { data, error } = await userClient.rpc("platform_admin_list_mail_dispatches", { p_limit: 100 });
      if (error) throw error;
      return json({ dispatches: data });
    }
    const key = String(body.template_key || "") as EmailTemplateKey;
    if (!EMAIL_TEMPLATE_KEYS.includes(key)) return json({ error: "template_not_found" }, 400);
    const language: EmailLanguage = body.language === "pt" ? "pt" : "en";
    const recipient = String(body.recipient || "").trim().toLowerCase();
    const config = getMailConfig();
    const qaCompany = { name: "QA Example Company", email: "qa@example.invalid" };
    const identity = resolveEmailIdentity({ templateKey: key, reportAudience: key === "report_ready" ? "customer" : undefined, company: qaCompany, communicationSettings: { financeEmail: "finance@example.invalid", invitationReplyToEmail: "inviter@example.invalid" }, inviter: { name: "QA Inviter", email: "inviter@example.invalid" }, language, technicalFromEmail: config.defaultFromEmail, stockWiseReplyToEmail: config.defaultReplyToEmail, stockWiseReplyToName: config.defaultReplyToName });
    const brand = { companyName: qaCompany.name, legalName: "QA Example Company, Lda.", contactEmail: qaCompany.email, contactPhone: "+258 84 000 0000", subjectCompanyLabel: identity.subjectCompanyLabel, sentOnBehalfOf: identity.identityCategory !== "platform" };
    const actionUrl = "https://app.stockwise.co.mz/qa-email-preview";
    const scenarios = {
      member_invite: { templateKey: "member_invite", brand, recipientName: "QA Recipient", inviterName: "QA Inviter", role: "MANAGER", expiresAt: "2026-08-15", actionUrl },
      report_ready: { templateKey: "report_ready", brand, recipientName: "QA Recipient", reportName: language === "pt" ? "Desempenho operacional" : "Operational performance", period: "2026-07-01 – 2026-07-31", filters: [language === "pt" ? "Todos os armazéns" : "All warehouses"], generatedAt: "2026-08-01", actionUrl },
      daily_digest: { templateKey: "daily_digest", brand, period: "2026-07-31", actionUrl, metrics: { operationalSales: 1250, knownCogs: 500, grossProfit: null, grossMargin: null, transactions: 5, openOrders: 2, lowStockItems: 1, outOfStockItems: 0, missingCostEvidence: 1, topProductsServices: [language === "pt" ? "Serviço QA" : "QA Service"], currencyCode: "MZN" } },
      due_reminder_sales_order: { templateKey: "due_reminder_sales_order", brand, recipientName: "QA Recipient", documentReference: "QA-SO-0001", dueDate: language === "pt" ? "15 de Agosto de 2026" : "15 August 2026", totalAmount: 1250, outstandingAmount: 1250, currencyCode: "MZN", actionUrl, stageOffsetDays: Number(body.stage_offset_days ?? 3), daysUntilDue: Number(body.stage_offset_days ?? 3), relativeState: Number(body.stage_offset_days ?? 3) === 1 ? "due_tomorrow" : Number(body.stage_offset_days ?? 3) === 0 ? "due_today" : Number(body.stage_offset_days ?? 3) < 0 ? "overdue" : "upcoming", tone: Number(body.stage_offset_days ?? 3) >= 7 ? "friendly" : Number(body.stage_offset_days ?? 3) > 0 ? "gentle_urgency" : Number(body.stage_offset_days ?? 3) === 0 ? "action_required" : Number(body.stage_offset_days ?? 3) >= -7 ? "overdue" : "escalated" },
      due_reminder_sales_invoice: { templateKey: "due_reminder_sales_invoice", brand, recipientName: "QA Recipient", documentReference: "QA-INV-0002", issueDate: language === "pt" ? "31 de Julho de 2026" : "31 July 2026", dueDate: language === "pt" ? "15 de Agosto de 2026" : "15 August 2026", totalAmount: 1250, outstandingAmount: 1250, currencyCode: "MZN", actionUrl, stageOffsetDays: Number(body.stage_offset_days ?? 3), daysUntilDue: Number(body.stage_offset_days ?? 3), relativeState: Number(body.stage_offset_days ?? 3) === 1 ? "due_tomorrow" : Number(body.stage_offset_days ?? 3) === 0 ? "due_today" : Number(body.stage_offset_days ?? 3) < 0 ? "overdue" : "upcoming", tone: Number(body.stage_offset_days ?? 3) >= 7 ? "friendly" : Number(body.stage_offset_days ?? 3) > 0 ? "gentle_urgency" : Number(body.stage_offset_days ?? 3) === 0 ? "action_required" : Number(body.stage_offset_days ?? 3) >= -7 ? "overdue" : "escalated" },
      company_access_expiry: { templateKey: "company_access_expiry", brand, currentPlan: "Business", accessEndsAt: "2026-08-15", actionUrl, supportEmail: "qa@example.invalid" },
      company_access_purge: { templateKey: "company_access_purge", brand, accessEndedAt: "2026-08-15", purgeAt: "2026-08-30", actionUrl, supportEmail: "qa@example.invalid" },
      company_access_activation: { templateKey: "company_access_activation", brand, planName: "Business", activeFrom: "2026-08-15", activeUntil: "2027-08-15", actionUrl, supportEmail: "qa@example.invalid" },
    } satisfies EmailTemplateInputMap;
    const scenario = scenarios[key];
    const rendered = renderDiscriminatedEmail(language, scenario, true);
    const reminderStageOffset = Number(body.stage_offset_days ?? 3);
    const reminderDueDateVersion = new Date(Date.now() + reminderStageOffset * 86_400_000).toISOString().slice(0, 10);
    const metadata = { requiredFields: EMAIL_TEMPLATES[key].requiredFields, semanticVariant: EMAIL_TEMPLATES[key].semanticVariant, scenarioLabel: `synthetic_${key}`, identity, reminderStage: key.startsWith("due_reminder_") ? { offsetDays: reminderStageOffset, dueDateVersion: reminderDueDateVersion } : null };
    if (mode === "preview") return json({ rendered, metadata });
    if (!recipient || !allowedRecipients.has(recipient)) return json({ error: "qa_recipient_not_allowed" }, 403);
    requireMailConfig(config);
    let stageId: string | null = null;
    if (key.startsWith("due_reminder_") && activeCompanyId && admin) {
      const anchorId = key === "due_reminder_sales_invoice" ? "00000000-0000-4000-8000-000000000033" : "00000000-0000-4000-8000-000000000032";
      const offset = reminderStageOffset;
      const dueDateVersion = reminderDueDateVersion;
      const { data: stageRecord, error: stageError } = await admin.rpc("reserve_due_reminder_stage", { p_event: { company_id: activeCompanyId, anchor_kind: key === "due_reminder_sales_invoice" ? "sales_invoice" : "sales_order", anchor_id: anchorId, document_reference: key === "due_reminder_sales_invoice" ? "QA-INV-0002" : "QA-SO-0001", due_date: dueDateVersion, stage_offset_days: offset, relative_state: offset === 1 ? "due_tomorrow" : offset === 0 ? "due_today" : offset < 0 ? "overdue" : "upcoming", tone: offset >= 7 ? "friendly" : offset > 0 ? "gentle_urgency" : offset === 0 ? "action_required" : offset >= -7 ? "overdue" : "escalated", recipient, language, outstanding_amount: 1250, currency_code: "MZN", from_name: identity.fromName, from_email: identity.fromEmail, reply_to_name: identity.replyToName, reply_to_email: identity.replyToEmail, identity_category: identity.identityCategory, company_name: qaCompany.name } });
      if (stageError) throw stageError;
      stageId = (stageRecord as { id?: string } | null)?.id || null;
      if (!stageId) return json({ error: "qa_stage_already_accepted" }, 409);
    }
    try {
      const result = await sendTransactionalEmail(
      { to: [recipient], subject: rendered.subject, html: rendered.html, text: rendered.text, fromName: identity.fromName, fromEmail: identity.fromEmail, replyTo: identity.replyToEmail, replyToName: identity.replyToName },
      config,
      { notificationType: key, workerId: "email-template-lab", templateVersion: rendered.templateVersion, language, companyId: activeCompanyId || null, qa: true, identityCategory: identity.identityCategory, companyNameSnapshot: qaCompany.name },
      );
      if (stageId && admin) await admin.rpc("finish_due_reminder_stage", { p_stage_id: stageId, p_status: "accepted", p_provider_message_id: result.messageId || null, p_dispatch_audit_id: result.dispatchIds?.[0] || null, p_reason: null });
      return json({ accepted: true, provider: "Brevo SMTP", providerMessageId: result.messageId || null, dispatchId: result.dispatchIds?.[0] || null, stageLedgerId: stageId, templateKey: key, templateVersion: rendered.templateVersion, language, subject: rendered.subject, recipient, timestamp: new Date().toISOString() });
    } catch (sendError) {
      if (stageId && admin) await admin.rpc("finish_due_reminder_stage", { p_stage_id: stageId, p_status: "failed", p_provider_message_id: null, p_dispatch_audit_id: null, p_reason: "provider_send_failed" });
      throw sendError;
    }
  } catch (error) {
    return json({ error: "template_lab_failed", message: error instanceof Error ? error.message : String(error) }, 500);
  }
});
