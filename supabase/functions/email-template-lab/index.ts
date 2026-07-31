import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getMailConfig, requireMailConfig, sendTransactionalEmail } from "../_shared/mailer.ts";
import { EMAIL_TEMPLATE_KEYS, EMAIL_TEMPLATES, renderEmailTemplate, type EmailTemplateKey } from "../_shared/emailTemplates.ts";
import type { EmailLanguage } from "../_shared/emailMoney.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const allowedRecipients = new Set((Deno.env.get("EMAIL_QA_ALLOWED_RECIPIENTS") || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
const cors = { "Access-Control-Allow-Origin": Deno.env.get("PUBLIC_SITE_URL") || "https://app.stockwise.co.mz", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

serve(async (req) => {
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
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    if (mode === "list") return json({ templates: EMAIL_TEMPLATE_KEYS.map((key) => ({ key, version: EMAIL_TEMPLATES[key].version, languages: EMAIL_TEMPLATES[key].supportedLanguages })) });
    if (mode === "recent") {
      const { data, error } = await userClient.rpc("platform_admin_list_mail_dispatches", { p_limit: 100 });
      if (error) throw error;
      return json({ dispatches: data });
    }
    const key = String(body.template_key || "") as EmailTemplateKey;
    if (!EMAIL_TEMPLATE_KEYS.includes(key)) return json({ error: "template_not_found" }, 400);
    const language: EmailLanguage = body.language === "pt" ? "pt" : "en";
    const recipient = String(body.recipient || "").trim().toLowerCase();
    const scenario = {
      brand: { companyName: "QA Example Company", legalName: "QA Example Company, Lda.", contactEmail: "qa@example.invalid", contactPhone: "+258 84 000 0000" },
      recipientName: "QA Recipient", documentReference: key.includes("invoice") ? "QA-INV-0001" : "QA-SO-0001",
      amount: 1250, currencyCode: "MZN", dueDate: "2026-08-15", role: "MANAGER", reportName: language === "pt" ? "Desempenho operacional" : "Operational performance",
      period: "2026-07-01 – 2026-07-31", planName: "Business", primaryDate: "2026-08-15", secondaryDate: "2027-08-15",
      actionUrl: "https://app.stockwise.co.mz/qa-email-preview", metrics: { "Operational sales": "MZN 1,250.00", "Gross profit": "Unavailable" },
    };
    const rendered = renderEmailTemplate(key, language, scenario, true);
    if (mode === "preview") return json({ rendered });
    if (!recipient || !allowedRecipients.has(recipient)) return json({ error: "qa_recipient_not_allowed" }, 403);
    requireMailConfig(getMailConfig());
    const result = await sendTransactionalEmail({ to: [recipient], subject: rendered.subject, html: rendered.html, text: rendered.text }, getMailConfig(), { notificationType: key, workerId: "email-template-lab" });
    await admin.rpc("record_mail_dispatch_event", { p_event: { worker: "email-template-lab", template_key: key, template_version: rendered.templateVersion, language, recipient, subject: rendered.subject, status: "accepted", provider: "brevo_smtp", provider_message_id: result.messageId || null, attempt: 1, qa: true } });
    return json({ accepted: true, provider: "Brevo SMTP", providerMessageId: result.messageId || null, templateKey: key, templateVersion: rendered.templateVersion, language, subject: rendered.subject, recipient, timestamp: new Date().toISOString() });
  } catch (error) {
    return json({ error: "template_lab_failed", message: error instanceof Error ? error.message : String(error) }, 500);
  }
});
