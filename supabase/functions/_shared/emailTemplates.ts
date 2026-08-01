import { renderEmailLayout } from "./emailLayout.ts";
import type { EmailBrand } from "./emailBrand.ts";
import { formatEmailMoney, type EmailLanguage } from "./emailMoney.ts";

export const EMAIL_TEMPLATE_KEYS = [
  "due_reminder_sales_order", "due_reminder_sales_invoice", "daily_digest", "member_invite", "report_ready",
  "company_access_expiry", "company_access_purge", "company_access_activation",
] as const;
export type EmailTemplateKey = typeof EMAIL_TEMPLATE_KEYS[number];

export type EmailTemplateInput = {
  brand: EmailBrand;
  recipientName?: string;
  documentReference?: string;
  amount?: number;
  currencyCode?: string;
  dueDate?: string;
  role?: string;
  actionUrl?: string;
  reportName?: string;
  period?: string;
  planName?: string;
  primaryDate?: string;
  secondaryDate?: string;
  metrics?: Record<string, string | number | null>;
};

export type RenderedEmail = { templateKey: EmailTemplateKey; templateVersion: number; language: EmailLanguage; subject: string; html: string; text: string };
export type EmailTemplateDefinition = { key: EmailTemplateKey; version: number; supportedLanguages: readonly EmailLanguage[]; render: (language: EmailLanguage, input: EmailTemplateInput, qa?: boolean) => RenderedEmail };

const roleName = (role: string | undefined, language: EmailLanguage) => ({ OWNER: language === "pt" ? "Proprietário" : "Owner", ADMIN: language === "pt" ? "Administrador" : "Administrator", MANAGER: language === "pt" ? "Gestor" : "Manager", OPERATOR: language === "pt" ? "Operador" : "Operator", VIEWER: language === "pt" ? "Leitor" : "Viewer" }[String(role || '').toUpperCase()] || (language === "pt" ? "Membro" : "Member"));

function definition(key: EmailTemplateKey, version: number): EmailTemplateDefinition {
  return { key, version, supportedLanguages: ["en", "pt"], render(language, input, qa = false) {
    const pt = language === "pt";
    const money = formatEmailMoney(input.amount || 0, input.currencyCode || "MZN", language);
    const copy: Record<EmailTemplateKey, { subject: string; heading: string; intro: string; body: string; action: string }> = {
      due_reminder_sales_order: { subject: pt ? `Pagamento da Ordem de Venda ${input.documentReference}` : `Sales Order ${input.documentReference} payment reminder`, heading: pt ? "Lembrete de pagamento" : "Payment reminder", intro: pt ? `A Ordem de Venda ${input.documentReference} tem um saldo de ${money}.` : `Sales Order ${input.documentReference} has an outstanding balance of ${money}.`, body: pt ? "Este lembrete segue o documento financeiro activo." : "This reminder follows the active financial document.", action: pt ? "Ver Ordem de Venda" : "View Sales Order" },
      due_reminder_sales_invoice: { subject: pt ? `Pagamento da Fatura ${input.documentReference}` : `Invoice ${input.documentReference} payment reminder`, heading: pt ? "Lembrete de pagamento" : "Payment reminder", intro: pt ? `A Fatura de Venda ${input.documentReference} tem um saldo de ${money}.` : `Sales Invoice ${input.documentReference} has an outstanding balance of ${money}.`, body: pt ? "Se já efectuou o pagamento, agradecemos que ignore este lembrete." : "If payment has already been made, please disregard this reminder.", action: pt ? "Ver Fatura" : "View Invoice" },
      daily_digest: { subject: pt ? "Resumo operacional diário" : "Daily operational digest", heading: pt ? "Resumo operacional" : "Operational digest", intro: pt ? `Resultados de ${input.period || "hoje"}.` : `Results for ${input.period || "today"}.`, body: pt ? "O lucro bruto fica indisponível quando faltam custos." : "Gross profit remains unavailable when cost evidence is missing.", action: pt ? "Abrir painel" : "Open dashboard" },
      member_invite: { subject: pt ? `Convite para ${input.brand.companyName}` : `Invitation to ${input.brand.companyName}`, heading: pt ? "Foi convidado para o StockWise" : "You are invited to StockWise", intro: pt ? `Junte-se à ${input.brand.companyName} como ${roleName(input.role,language)}.` : `Join ${input.brand.companyName} as ${roleName(input.role,language)}.`, body: pt ? "Aceite apenas se reconhecer a empresa e o remetente. Nunca partilhe a sua palavra-passe." : "Accept only if you recognise the company and sender. Never share your password.", action: pt ? "Aceitar convite" : "Accept invitation" },
      report_ready: { subject: pt ? `Relatório disponível: ${input.reportName}` : `Report ready: ${input.reportName}`, heading: pt ? "O seu relatório está disponível" : "Your report is ready", intro: pt ? `${input.reportName} está pronto para consulta segura.` : `${input.reportName} is ready for secure review.`, body: pt ? "A ligação é controlada pelo StockWise e pode expirar." : "The link is controlled by StockWise and may expire.", action: pt ? "Abrir relatório" : "Open report" },
      company_access_expiry: { subject: pt ? `Acesso da ${input.brand.companyName} termina em ${input.primaryDate}` : `${input.brand.companyName} access expires on ${input.primaryDate}`, heading: pt ? "Aviso de fim de acesso" : "Access expiry warning", intro: pt ? `O acesso actual termina em ${input.primaryDate}.` : `Current access ends on ${input.primaryDate}.`, body: pt ? "A renovação e activação paga continuam manuais. Não existe cobrança automática." : "Renewal and paid activation remain manual. There is no automatic billing.", action: pt ? "Contactar StockWise" : "Contact StockWise" },
      company_access_purge: { subject: pt ? `Aviso de eliminação de dados da ${input.brand.companyName}` : `${input.brand.companyName} data purge warning`, heading: pt ? "Aviso de eliminação operacional" : "Operational data purge warning", intro: pt ? `Os dados operacionais estão programados para eliminação em ${input.primaryDate}.` : `Operational data is scheduled for purge on ${input.primaryDate}.`, body: pt ? "As credenciais de autenticação não são eliminadas por este processo." : "Authentication credentials are not deleted by this process.", action: pt ? "Contactar StockWise" : "Contact StockWise" },
      company_access_activation: { subject: pt ? `Acesso da ${input.brand.companyName} activado` : `${input.brand.companyName} access activated`, heading: pt ? "Confirmação de activação paga" : "Paid activation confirmation", intro: pt ? `O plano ${input.planName || "StockWise"} está activo até ${input.secondaryDate || input.primaryDate}.` : `The ${input.planName || "StockWise"} plan is active until ${input.secondaryDate || input.primaryDate}.`, body: pt ? "Esta é uma activação manual; não confirma cobrança automática." : "This is a manual activation; it does not confirm automatic billing.", action: pt ? "Abrir StockWise" : "Open StockWise" },
    };
    const c = copy[key];
    const subject = `${qa ? "[StockWise QA] " : ""}${c.subject}`;
    const summary = Object.entries(input.metrics || {}).map(([label,value]) => ({ label, value: value == null ? (pt ? "Indisponível" : "Unavailable") : String(value) }));
    if (input.documentReference) summary.unshift({ label: pt ? "Referência" : "Reference", value: input.documentReference });
    if (key === "report_ready" && input.period) summary.push({ label: pt ? "Período" : "Reporting period", value: input.period });
    if (input.dueDate && key !== "report_ready") summary.push({ label: pt ? "Data de vencimento" : "Due date", value: input.dueDate });
    if (input.primaryDate && key.startsWith("company_access_")) summary.push({ label: key === "company_access_activation" ? (pt ? "Activa desde" : "Active from") : (pt ? "Data principal" : "Primary date"), value: input.primaryDate });
    if (input.secondaryDate && key.startsWith("company_access_")) summary.push({ label: pt ? "Activa até" : "Active until", value: input.secondaryDate });
    const html = renderEmailLayout({ language, brand: input.brand, heading: c.heading, intro: c.intro, body: c.body, summary, actionLabel: c.action, actionUrl: input.actionUrl, qa });
    const qaLine = qa ? (pt ? "Teste de email do StockWise — nenhuma ação é necessária." : "StockWise email test — no action is required.") : "";
    const contact = input.brand.contactEmail || "geral@stockwiseapp.com";
    const text = [qaLine,c.heading,c.intro,c.body,...summary.map((row)=>`${row.label}: ${row.value}`),input.actionUrl || "",`${pt ? "Contacto" : "Contact"}: ${contact}`,pt ? "Gerado pelo StockWise" : "Generated by StockWise"].filter(Boolean).join("\n\n");
    return { templateKey:key,templateVersion:version,language,subject,html,text };
  }};
}

export const EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplateDefinition> = Object.fromEntries(EMAIL_TEMPLATE_KEYS.map((key) => [key,definition(key,key === "report_ready" ? 2 : 1)])) as Record<EmailTemplateKey,EmailTemplateDefinition>;
export function renderEmailTemplate(key: EmailTemplateKey, language: EmailLanguage, input: EmailTemplateInput, qa = false) { return EMAIL_TEMPLATES[key].render(language,input,qa); }
