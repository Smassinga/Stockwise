export type EmailBrand = {
  companyName: string;
  legalName?: string | null;
  logoUrl?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

export const STOCKWISE_EMAIL_BRAND = {
  name: "StockWise",
  accent: "#009679",
  charcoal: "#172B4D",
  surface: "#F8FAFC",
};
