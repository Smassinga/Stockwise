import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getMailConfig, requireMailConfig, sendTransactionalEmail } from "../_shared/mailer.ts";
import { EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATES, renderDiscriminatedEmail, type EmailTemplateInputMap, type EmailTemplateKey } from "../_shared/emailTemplates.ts";
import type { EmailLanguage } from "../_shared/emailMoney.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
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
    const brand = { companyName: "QA Example Company", legalName: "QA Example Company, Lda.", contactEmail: "qa@example.invalid", contactPhone: "+258 84 000 0000" };
    const actionUrl = "https://app.stockwise.co.mz/qa-email-preview";
    const scenarios = {
      member_invite: { templateKey: "member_invite", brand, recipientName: "QA Recipient", inviterName: "QA Inviter", role: "MANAGER", expiresAt: "2026-08-15", actionUrl },
      report_ready: { templateKey: "report_ready", brand, recipientName: "QA Recipient", reportName: language === "pt" ? "Desempenho operacional" : "Operational performance", period: "2026-07-01 – 2026-07-31", filters: [language === "pt" ? "Todos os armazéns" : "All warehouses"], generatedAt: "2026-08-01", actionUrl },
      daily_digest: { templateKey: "daily_digest", brand, period: "2026-07-31", actionUrl, metrics: { operationalSales: 1250, knownCogs: 500, grossProfit: null, grossMargin: null, transactions: 5, openOrders: 2, lowStockItems: 1, outOfStockItems: 0, missingCostEvidence: 1, topProductsServices: [language === "pt" ? "Serviço QA" : "QA Service"], currencyCode: "MZN" } },
      due_reminder_sales_order: { templateKey: "due_reminder_sales_order", brand, recipientName: "QA Recipient", documentReference: "QA-SO-0001", dueDate: "2026-08-15", totalAmount: 1250, outstandingAmount: 1250, currencyCode: "MZN", actionUrl },
      due_reminder_sales_invoice: { templateKey: "due_reminder_sales_invoice", brand, recipientName: "QA Recipient", documentReference: "QA-INV-0001", issueDate: "2026-07-31", dueDate: "2026-08-15", totalAmount: 1250, outstandingAmount: 1250, currencyCode: "MZN", actionUrl },
      company_access_expiry: { templateKey: "company_access_expiry", brand, currentPlan: "Business", accessEndsAt: "2026-08-15", actionUrl, supportEmail: "qa@example.invalid" },
      company_access_purge: { templateKey: "company_access_purge", brand, accessEndedAt: "2026-08-15", purgeAt: "2026-08-30", actionUrl, supportEmail: "qa@example.invalid" },
      company_access_activation: { templateKey: "company_access_activation", brand, planName: "Business", activeFrom: "2026-08-15", activeUntil: "2027-08-15", actionUrl, supportEmail: "qa@example.invalid" },
    } satisfies EmailTemplateInputMap;
    const scenario = scenarios[key];
    const rendered = renderDiscriminatedEmail(language, scenario, true);
    const metadata = { requiredFields: EMAIL_TEMPLATES[key].requiredFields, semanticVariant: EMAIL_TEMPLATES[key].semanticVariant, scenarioLabel: `synthetic_${key}` };
    if (mode === "preview") return json({ rendered, metadata });
    if (!recipient || !allowedRecipients.has(recipient)) return json({ error: "qa_recipient_not_allowed" }, 403);
    requireMailConfig(getMailConfig());
    const result = await sendTransactionalEmail(
      { to: [recipient], subject: rendered.subject, html: rendered.html, text: rendered.text },
      getMailConfig(),
      { notificationType: key, workerId: "email-template-lab", templateVersion: rendered.templateVersion, language, qa: true },
    );
    return json({ accepted: true, provider: "Brevo SMTP", providerMessageId: result.messageId || null, templateKey: key, templateVersion: rendered.templateVersion, language, subject: rendered.subject, recipient, timestamp: new Date().toISOString() });
  } catch (error) {
    return json({ error: "template_lab_failed", message: error instanceof Error ? error.message : String(error) }, 500);
  }
});
