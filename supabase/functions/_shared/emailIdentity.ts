import type { EmailTemplateKey } from "./emailTemplates.ts";
import type { EmailLanguage } from "./emailMoney.ts";

export type EmailIdentityCategory = "commercial" | "internal_intelligence" | "member_invitation" | "platform";
export type EmailIdentityCompany = { id?: string | null; name?: string | null; trade_name?: string | null; legal_name?: string | null; email?: string | null };
export type EmailCommunicationSettings = { financeEmail?: string | null; invitationReplyToEmail?: string | null };
export type ResolvedEmailIdentity = {
  fromName: string; fromEmail: string; replyToEmail: string; replyToName: string;
  subjectCompanyLabel: string; identityCategory: EmailIdentityCategory; companyNameSnapshot: string;
};

const clean = (value: unknown) => String(value ?? "").trim();
const email = (value: unknown) => { const normalized = clean(value).toLowerCase(); return /^\S+@\S+\.\S+$/.test(normalized) ? normalized : ""; };
export const companyEmailName = (company: EmailIdentityCompany) => clean(company.trade_name) || clean(company.legal_name) || clean(company.name) || "Company";

export function resolveEmailIdentity(input: {
  templateKey: EmailTemplateKey;
  company: EmailIdentityCompany;
  communicationSettings?: EmailCommunicationSettings | null;
  inviter?: { name?: string | null; email?: string | null } | null;
  language?: EmailLanguage;
  reportAudience?: "customer" | "internal";
  technicalFromEmail: string;
  stockWiseReplyToEmail: string;
  stockWiseReplyToName?: string;
}): ResolvedEmailIdentity {
  const companyName = companyEmailName(input.company);
  const general = email(input.company.email);
  const finance = email(input.communicationSettings?.financeEmail);
  const invitation = email(input.communicationSettings?.invitationReplyToEmail);
  const fallback = email(input.stockWiseReplyToEmail) || email(input.technicalFromEmail);
  const pt = input.language === "pt";
  let identityCategory: EmailIdentityCategory;
  let fromName: string;
  let replyToEmail: string;
  let replyToName: string;

  if (input.templateKey === "company_access_expiry" || input.templateKey === "company_access_purge" || input.templateKey === "company_access_activation") {
    identityCategory = "platform"; fromName = "StockWise"; replyToEmail = fallback; replyToName = clean(input.stockWiseReplyToName) || "StockWise";
  } else if (input.templateKey === "member_invite") {
    identityCategory = "member_invitation"; fromName = `${companyName} via StockWise`;
    replyToEmail = email(input.inviter?.email) || invitation || general || fallback;
    replyToName = clean(input.inviter?.name) || companyName;
  } else if (input.templateKey === "daily_digest" || (input.templateKey === "report_ready" && input.reportAudience !== "customer")) {
    identityCategory = "internal_intelligence"; fromName = `StockWise for ${companyName}`;
    replyToEmail = general || fallback; replyToName = companyName;
  } else {
    identityCategory = "commercial"; fromName = companyName;
    replyToEmail = finance || general || fallback; replyToName = `${companyName} — ${pt ? "Financeiro" : "Finance"}`;
  }

  return {
    fromName, fromEmail: email(input.technicalFromEmail), replyToEmail, replyToName,
    subjectCompanyLabel: identityCategory === "platform" ? "StockWise" : companyName,
    identityCategory, companyNameSnapshot: companyName,
  };
}
