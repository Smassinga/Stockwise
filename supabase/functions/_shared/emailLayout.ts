import { STOCKWISE_EMAIL_BRAND, type EmailBrand } from "./emailBrand.ts";
import type { EmailLanguage } from "./emailMoney.ts";

export type EmailSemanticVariant = "standard" | "informational" | "warning" | "destructive" | "success";
export type EmailDetailSection = {
  title?: string;
  rows: Array<{ label: string; value: string }>;
  emphasis?: "default" | "metrics" | "warning";
};

export const escapeEmailHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const variantStyle: Record<EmailSemanticVariant, { border: string; tint: string }> = {
  standard: { border: "#D7DEE5", tint: "#F7F9F8" },
  informational: { border: "#BFDCD4", tint: "#F2F8F6" },
  warning: { border: "#D9C99D", tint: "#FCFAF3" },
  destructive: { border: "#D8A8A8", tint: "#FFF6F5" },
  success: { border: "#A9D2C5", tint: "#F1F9F6" },
};

function renderSection(section: EmailDetailSection) {
  const rows = section.rows.map((row) => `<tr><td style="padding:9px 0;color:#5F6B66;vertical-align:top">${escapeEmailHtml(row.label)}</td><td style="padding:9px 0 9px 18px;text-align:right;font-weight:700;color:#17211D;vertical-align:top">${escapeEmailHtml(row.value)}</td></tr>`).join("");
  return `<div style="margin-top:18px;padding:16px 18px;border:1px solid #DDE4E0;border-radius:12px;background:${section.emphasis === "warning" ? "#FFF8F6" : "#F8FAF9"}">${section.title ? `<div style="margin-bottom:5px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#52615B">${escapeEmailHtml(section.title)}</div>` : ""}<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse">${rows}</table></div>`;
}

export function renderEmailLayout(input: {
  language: EmailLanguage;
  brand: EmailBrand;
  heading: string;
  intro: string;
  body?: string;
  notice?: string;
  sections?: EmailDetailSection[];
  actionLabel?: string;
  actionUrl?: string;
  qa?: boolean;
  variant: EmailSemanticVariant;
}) {
  const pt = input.language === "pt";
  const qaLabel = "TEST EMAIL";
  const qaCopy = pt ? "Este é um email de teste do StockWise. Não é necessária qualquer acção." : "This is a StockWise test email. No action is required.";
  const fallback = pt ? "Se o botão não funcionar, copie esta ligação:" : "If the button does not work, copy this link:";
  const contact = [input.brand.contactEmail, input.brand.contactPhone].filter(Boolean).join(" · ");
  const identity = input.brand.companyName || STOCKWISE_EMAIL_BRAND.name;
  const logo = input.brand.logoUrl
    ? `<img src="${escapeEmailHtml(input.brand.logoUrl)}" alt="${escapeEmailHtml(identity)} logo" style="display:block;max-width:176px;max-height:58px;width:auto;height:auto;margin:0 0 14px">`
    : `<div style="font-size:19px;font-weight:800;letter-spacing:-.02em;color:${STOCKWISE_EMAIL_BRAND.accent}">StockWise</div>`;
  const action = input.actionUrl && input.actionLabel
    ? `<div style="margin:26px 0 18px"><a href="${escapeEmailHtml(input.actionUrl)}" style="display:inline-block;min-width:168px;padding:14px 20px;border-radius:9px;background:${STOCKWISE_EMAIL_BRAND.accent};color:#FFFFFF;text-align:center;text-decoration:none;font-size:15px;font-weight:800;line-height:1.2">${escapeEmailHtml(input.actionLabel)}</a></div><div style="font-size:12px;line-height:1.6;color:#66736D">${fallback}<br><span style="word-break:break-all">${escapeEmailHtml(input.actionUrl)}</span></div>`
    : "";
  const style = variantStyle[input.variant];
  const sections = (input.sections || []).filter((section) => section.rows.length).map(renderSection).join("");
  const notice = input.notice ? `<div style="margin-top:18px;padding:14px 16px;border-left:4px solid ${input.variant === "destructive" ? "#A63D40" : STOCKWISE_EMAIL_BRAND.accent};background:${style.tint};color:#34423C;font-size:14px;line-height:1.65">${escapeEmailHtml(input.notice)}</div>` : "";

  return `<!doctype html><html lang="${input.language}"><body style="margin:0;padding:0;background:#F3F6F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#17211D"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;background:#F3F6F4"><tr><td align="center" style="padding:24px 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:620px;background:#FFFFFF;border:1px solid ${style.border};border-radius:14px;overflow:hidden"><tr><td style="padding:26px 28px 22px;border-top:5px solid ${input.variant === "destructive" ? "#A63D40" : STOCKWISE_EMAIL_BRAND.accent}">${logo}<div style="margin-top:9px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#52615B">${escapeEmailHtml(identity)}</div><h1 style="margin:10px 0 0;font-size:27px;line-height:1.25;color:#17211D">${escapeEmailHtml(input.heading)}</h1></td></tr>${input.qa ? `<tr><td style="padding:0 28px 4px"><div style="padding:12px 14px;border:1px dashed #7BAA9B;border-radius:9px;background:#F1F6F4;color:#30443C"><div style="font-size:11px;font-weight:900;letter-spacing:.12em;color:${STOCKWISE_EMAIL_BRAND.accent}">${qaLabel}</div><div style="margin-top:4px;font-size:13px;line-height:1.5">${escapeEmailHtml(qaCopy)}</div></div></td></tr>` : ""}<tr><td style="padding:22px 28px 30px"><p style="margin:0;font-size:16px;line-height:1.7;color:#24312C">${escapeEmailHtml(input.intro)}</p>${input.body ? `<p style="margin:15px 0 0;font-size:14px;line-height:1.75;color:#46534E">${escapeEmailHtml(input.body)}</p>` : ""}${sections}${notice}${action}</td></tr><tr><td style="padding:19px 28px;background:#F7F9F8;border-top:1px solid #E0E6E3;font-size:12px;line-height:1.65;color:#65716C"><strong style="color:#34423C">StockWise</strong><br>${pt ? "Um produto da WiseCore Technologies" : "A WiseCore Technologies product"}${input.brand.legalName ? `<br>${escapeEmailHtml(input.brand.legalName)}` : ""}${contact ? `<br>${escapeEmailHtml(contact)}` : ""}</td></tr></table></td></tr></table></body></html>`;
}
