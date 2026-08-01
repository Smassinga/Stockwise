export type EmailLanguage = "en" | "pt";

export function formatEmailMoney(value: number, currencyCode = "MZN", language: EmailLanguage = "en") {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const code = String(currencyCode || "MZN").toUpperCase();
  const number = new Intl.NumberFormat(language === "pt" ? "pt-BR" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(Math.abs(amount));
  return `${amount < 0 ? "-" : ""}${code} ${number}`;
}
