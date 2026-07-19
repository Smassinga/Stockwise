import { type ReactNode, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useI18n, withI18nFallback } from "../lib/i18n";
import { useOrg } from "../hooks/useOrg";
import { financeCan } from "../lib/permissions";
import { getPlatformAdminStatus } from "../lib/companyAccess";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { PremiumMetricCard } from "../components/premium/PremiumMetricCard";
import { PremiumPageHeader } from "../components/premium/PremiumPageHeader";
import { PremiumStatusBadge, type PremiumTone } from "../components/premium/PremiumStatusBadge";
import { IconBadge } from "../components/premium/IconBadge";
import { BankIcon } from "@phosphor-icons/react/dist/csr/Bank";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { ClockIcon } from "@phosphor-icons/react/dist/csr/Clock";
import { CoinsIcon } from "@phosphor-icons/react/dist/csr/Coins";
import { FileTextIcon as PhosphorFileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { ScalesIcon } from "@phosphor-icons/react/dist/csr/Scales";
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { WarehouseIcon } from "@phosphor-icons/react/dist/csr/Warehouse";

// Existing uploader (fast preview / storage)
import LogoUploader from "../components/settings/LogoUploader";
import { CommercialTaxSettings } from "../components/settings/CommercialTaxSettings";
import { SetupReadinessPanel } from "../components/setup/SetupReadinessPanel";
import { useCompanySetupReadiness } from "../hooks/useCompanySetupReadiness";

import {
  Bell,
  Building,
  ChevronRight,
  ArrowLeft,
  Clock,
  FileText,
  Globe,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";

type Warehouse = { id: string; name: string };

// ---------------- company profile (companies table) ----------------
type CompanyProfile = {
  id: string
  legal_name: string | null
  trade_name: string | null
  email_subject_prefix: string | null // NEW
  tax_id: string | null
  registration_no: string | null
  phone: string | null
  email: string | null
  website: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country_code: string | null
  print_footer_note: string | null
  logo_path: string | null
  preferred_lang: 'en' | 'pt' | null;
};

// ---------------- Settings shape (company_settings.data) ------------
type SettingsData = {
  locale: { language: "en" | "pt" };
  dashboard: {
    defaultWindowDays: number;
    defaultWarehouseId: string;
    hideZeros: boolean;
  };
  sales: {
    allowLineShip: boolean;
    autoCompleteWhenShipped: boolean;
    revenueRule: "order_total_first" | "lines_only";
    allocateMissingRevenueBy: "cogs_share" | "line_share";
    defaultFulfilWarehouseId: string;
  };
  documents: {
    brand: { name: string; logoUrl: string };
    packingSlipShowsPrices: boolean;
  };
  revenueSources: {
    ordersSource?: string;
    cashSales?: {
      source?: string;
      dateCol?: string;
      customerCol?: string;
      amountCol?: string;
      currencyCol?: string;
    };
  };
  notifications: {
    dailyDigest: boolean;
    dailyDigestTime?: string;
    timezone?: string;
    dailyDigestChannels?: { email: boolean; sms: boolean; whatsapp: boolean };
    recipients?: { emails: string[]; phones: string[]; whatsapp: string[] };
    lowStock: { channel: "email" | "slack" | "whatsapp" | "none" };
  };
  // Due Reminder Worker settings
  dueReminders?: {
    enabled?: boolean;
    leadDays?: number[];
    recipients?: string[];
    bcc?: string[];
    timezone?: string;
    invoiceBaseUrl?: string; // hidden legacy fallback for app/document links
    hours?: number[];
    sendAt?: string;
  };
};

type SettingsGuideCard = {
  key: string;
  title: string;
  description: string;
  status: string;
  actionLabel?: string;
  href?: string;
  section?: SettingsSectionKey;
  tone: PremiumTone;
  icon: ReactNode;
};

type SettingsSectionKey =
  | "company-profile"
  | "commercial-tax"
  | "localization"
  | "operations"
  | "inventory"
  | "notifications"
  | "due-reminders"
  | "documents";

const settingsGuideCopy = {
  en: {
    eyebrow: "Company setup",
    headerTitle: "Settings command centre",
    headerBody:
      "Open only the setup area you need, then return to this map without scrolling through every company control.",
    saveCompany: "Save company",
    saveChanges: "Save changes",
    backToSettings: "Back to settings",
    operatingMapTitle: "Operating setup map",
    operatingMapBody:
      "Use these backed setup areas to move directly to the right workspace. Only live routes and editable sections are shown.",
    review: "Review",
    open: "Open",
    statusReady: "Ready",
    statusNeedsWork: "Needs review",
    statusBacked: "Backed workflow",
    statusCurrent: "Current",
    statusPlatform: "Platform-managed",
    cards: {
      companyProfile: {
        title: "Company Profile",
        description:
          "Legal and trading identity, contacts, address, logo, and print footer used by onboarding, exports, and documents.",
      },
      fiscalLegal: {
        title: "Fiscal & Legal",
        description:
          "NUIT, legal identity, Mozambique fiscal readiness, document language, and issued-document compliance checks.",
      },
      usersRoles: {
        title: "Users & Roles",
        description:
          "Invite teammates, track pending access, and review canonical role boundaries before assigning authority.",
      },
      warehousesBins: {
        title: "Warehouses & Bins",
        description:
          "Maintain physical stock locations and bin structures used by movements, receiving, picking, and stock review.",
      },
      localization: {
        title: "Localization & UI",
        description:
          "Set company language, default dashboard window, default warehouse, and zero-value display preferences.",
      },
      operations: {
        title: "Sales & Dashboard Defaults",
        description:
          "Control fulfilment defaults and dashboard workflow settings without changing posting rules.",
      },
      inventory: {
        title: "Inventory Valuation",
        description:
          "Review the current weighted-average valuation policy used by stock levels and landed-cost revaluations.",
      },
      dueReminders: {
        title: "Due Reminders",
        description:
          "Configure receivable reminder timing, offsets, timezone, and internal BCC controls.",
      },
      documents: {
        title: "Documents & Branding",
        description:
          "Maintain printed document brand name, logo, and packing-slip price visibility.",
      },
      currencies: {
        title: "Currencies",
        description:
          "Set the company base currency, allowed currencies, and recent exchange rates used by commercial documents.",
      },
      numbering: {
        title: "Document Numbering",
        description:
          "Fiscal series and legal references are governed by the Mozambique compliance workspace, not by manual Settings edits.",
      },
      banks: {
        title: "Bank Accounts",
        description:
          "Configure settlement and reconciliation bank accounts used by finance workflows and statement imports.",
      },
      notifications: {
        title: "Notifications",
        description:
          "Control daily digest recipients and due-reminder policy from the current Settings form.",
      },
      importsExports: {
        title: "Import/Export",
        description:
          "Open the governed opening-data importer and keep exports on the registers and reports that already support them.",
      },
      subscription: {
        title: "Platform Access Control",
        description:
          "Open platform-only access controls for paid activation, suspension, purge schedule, and audit review.",
      },
    },
  },
  pt: {
    eyebrow: "Configuração da empresa",
    headerTitle: "Centro de comando das definições",
    headerBody:
      "Abra apenas a área de configuração necessária e volte a este mapa sem percorrer todos os controlos da empresa.",
    saveCompany: "Guardar empresa",
    saveChanges: "Guardar alterações",
    backToSettings: "Voltar às definições",
    operatingMapTitle: "Mapa de configuração operacional",
    operatingMapBody:
      "Use estas áreas suportadas para ir diretamente ao workspace certo. Só são mostradas rotas reais e secções editáveis.",
    review: "Rever",
    open: "Abrir",
    statusReady: "Pronto",
    statusNeedsWork: "Rever",
    statusBacked: "Workflow suportado",
    statusCurrent: "Actual",
    statusPlatform: "Gerido pela plataforma",
    cards: {
      companyProfile: {
        title: "Perfil da Empresa",
        description:
          "Identidade legal e comercial, contactos, morada, logótipo e rodapé usados por onboarding, exportações e documentos.",
      },
      fiscalLegal: {
        title: "Fiscal & Legal",
        description:
          "NUIT, identidade legal, prontidão fiscal de Moçambique, idioma documental e verificações de conformidade de documentos emitidos.",
      },
      usersRoles: {
        title: "Utilizadores & Funções",
        description:
          "Convide colegas, acompanhe acessos pendentes e reveja limites canónicos de função antes de atribuir autoridade.",
      },
      warehousesBins: {
        title: "Armazéns & Locais",
        description:
          "Mantenha localizações físicas de stock e estruturas de locais usadas por movimentos, recepção, picking e revisão de stock.",
      },
      localization: {
        title: "Localização & UI",
        description:
          "Defina idioma da empresa, janela padrão do dashboard, armazém padrão e preferências de valores zero.",
      },
      operations: {
        title: "Padrões de Vendas & Dashboard",
        description:
          "Controle padrões de fulfilment e fluxo do dashboard sem alterar regras de lançamento.",
      },
      inventory: {
        title: "Valorização de Inventário",
        description:
          "Reveja a política atual de média ponderada usada por stock e revalorizações de custo landed.",
      },
      dueReminders: {
        title: "Lembretes de Vencimento",
        description:
          "Configure hora, intervalos, timezone e BCC interno para lembretes de contas a receber.",
      },
      documents: {
        title: "Documentos & Marca",
        description:
          "Mantenha nome de marca documental, logótipo e visibilidade de preços em packing slips.",
      },
      currencies: {
        title: "Moedas",
        description:
          "Defina a moeda base da empresa, moedas permitidas e taxas de câmbio recentes usadas por documentos comerciais.",
      },
      numbering: {
        title: "Numeração Documental",
        description:
          "Séries fiscais e referências legais são governadas pelo workspace de conformidade de Moçambique, não por edição manual nas Definições.",
      },
      banks: {
        title: "Contas Bancárias",
        description:
          "Configure contas bancárias de liquidação e reconciliação usadas por workflows financeiros e importação de extractos.",
      },
      notifications: {
        title: "Notificações",
        description:
          "Controle destinatários do resumo diário e política de lembretes de vencimento a partir do formulário actual de Definições.",
      },
      importsExports: {
        title: "Importação/Exportação",
        description:
          "Abra o importador governado de dados iniciais e mantenha exportações nos registos e relatórios que já as suportam.",
      },
      subscription: {
        title: "Controlo de Acesso da Plataforma",
        description:
          "Abra controlos exclusivos da plataforma para ativação paga, suspensão, purga e auditoria.",
      },
    },
  },
} as const;

const DEFAULTS: SettingsData = {
  locale: { language: "en" },
  dashboard: {
    defaultWindowDays: 30,
    defaultWarehouseId: "ALL",
    hideZeros: false,
  },
  sales: {
    allowLineShip: true,
    autoCompleteWhenShipped: true,
    revenueRule: "order_total_first",
    allocateMissingRevenueBy: "cogs_share",
    defaultFulfilWarehouseId: "",
  },
  documents: {
    brand: { name: "", logoUrl: "" },
    packingSlipShowsPrices: false,
  },
  revenueSources: {
    ordersSource: "",
    cashSales: {
      source: "",
      dateCol: "created_at",
      customerCol: "customer_id",
      amountCol: "amount",
      currencyCol: "currency_code",
    },
  },
  notifications: {
    dailyDigest: false,
    dailyDigestTime: "08:00",
    timezone: "Africa/Maputo",
    dailyDigestChannels: { email: true, sms: false, whatsapp: false },
    recipients: { emails: [], phones: [], whatsapp: [] },
    lowStock: { channel: "email" },
  },
  // Due Reminder Worker defaults
  dueReminders: {
    enabled: true,
    leadDays: [3, 1, 0, -3],
    recipients: [],
    bcc: [],
    timezone: "Africa/Maputo",
    invoiceBaseUrl: "https://stockwiseapp.com",
    hours: [9],
    sendAt: "09:00",
  },
};

function deepMerge<T extends Record<string, any>>(a: T, b: Partial<T>): T {
  if (
    Array.isArray(a) ||
    Array.isArray(b) ||
    typeof a !== "object" ||
    typeof b !== "object"
  )
    return (b as T) ?? a;
  const out: any = { ...a };
  for (const k of Object.keys(b ?? {}))
    out[k] = deepMerge(a?.[k], (b as any)[k]);
  return out;
}

const clone = <T,>(v: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);

function listToCSV(list: string[]) {
  return (list || []).join(", ");
}
function csvToList(s: string) {
  return (s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDueReminderTime(settings?: SettingsData["dueReminders"]) {
  const explicit = settings?.sendAt?.trim();
  if (explicit && /^\d{2}:\d{2}$/.test(explicit)) return explicit;

  const hoursValue = settings?.hours?.length
    ? Number(settings.hours[0])
    : Number(DEFAULTS.dueReminders.hours?.[0] ?? 9);

  if (!Number.isFinite(hoursValue)) return DEFAULTS.dueReminders.sendAt || "09:00";

  const hours = Math.max(0, Math.min(23, Math.floor(hoursValue)));
  const minutes = Math.max(0, Math.min(59, Math.round((hoursValue - hours) * 60)));
  return `${pad2(hours)}:${pad2(minutes)}`;
}

function parseDueReminderTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec((value || "").trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return {
    normalized: `${pad2(hours)}:${pad2(minutes)}`,
    legacyHourValue: Number((hours + minutes / 60).toFixed(4)),
  };
}

function normalizeLeadDays(values?: number[]) {
  const unique = Array.from(
    new Set(
      (values || [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value))
        .map((value) => Math.trunc(value)),
    ),
  );

  return unique.sort((a, b) => {
    const bucket = (value: number) => (value > 0 ? 0 : value === 0 ? 1 : 2);
    const bucketDiff = bucket(a) - bucket(b);
    if (bucketDiff !== 0) return bucketDiff;
    if (a > 0 && b > 0) return b - a;
    if (a < 0 && b < 0) return Math.abs(a) - Math.abs(b);
    return a - b;
  });
}

// ----- per-company language cache -----
const langKey = (companyId?: string | null) =>
  companyId ? `ui:lang:${companyId}` : "ui:lang";
function readCachedLang(companyId?: string | null): "en" | "pt" | null {
  const c = companyId ? localStorage.getItem(langKey(companyId)) : null;
  return c === "en" || c === "pt" ? c : null;
}
function readActiveLang(): "en" | "pt" | null {
  const value = localStorage.getItem("app:lang");
  return value === "en" || value === "pt" ? value : null;
}
function writeCachedLang(
  companyId: string | null | undefined,
  lang: "en" | "pt",
) {
  if (!companyId) return;
  localStorage.setItem(langKey(companyId), lang);
}

// extract storage path from public URL for brand-logos bucket
function pathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/storage/v1/object/public/brand-logos/";
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return url.slice(i + marker.length);
}

function Settings() {
  const { lang, t, setLang } = useI18n();
  const copy = settingsGuideCopy[lang];
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars);
  const { companyId, myRole } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();
  const setupReadiness = useCompanySetupReadiness(companyId, myRole);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [missingRow, setMissingRow] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  const [data, setData] = useState<SettingsData>(DEFAULTS);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [dueReminderTimeInput, setDueReminderTimeInput] = useState(
    formatDueReminderTime(DEFAULTS.dueReminders),
  );
  const [dueReminderLeadDaysError, setDueReminderLeadDaysError] = useState<string | null>(null);
  const [dueReminderBeforeDraft, setDueReminderBeforeDraft] = useState("");
  const [dueReminderAfterDraft, setDueReminderAfterDraft] = useState("");

  useEffect(() => {
    const section = searchParams.get("section");
    const allowedSections: SettingsSectionKey[] = [
      "company-profile",
      "commercial-tax",
      "localization",
      "operations",
      "inventory",
      "notifications",
      "due-reminders",
      "documents",
    ];
    setActiveSection(section && allowedSections.includes(section as SettingsSectionKey)
      ? section as SettingsSectionKey
      : null);
  }, [searchParams]);

  useEffect(() => {
    if (!activeSection || loading) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`settings-${activeSection}`);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target?.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, loading]);

  const roleUpper = useMemo(() => String(myRole || "").toUpperCase(), [myRole]);
  const canEditAll = useMemo(
    () => ["OWNER", "ADMIN"].includes(roleUpper),
    [roleUpper],
  );
  const canEditOps = useMemo(
    () => canEditAll || roleUpper === "MANAGER",
    [canEditAll, roleUpper],
  );
  const canEditDueReminders = useMemo(
    () => financeCan.reminderSettings(myRole),
    [myRole],
  );
  const settingsSummary = useMemo(() => {
    const companyLabel =
      profile?.trade_name ||
      profile?.legal_name ||
      data.documents.brand.name ||
      tt("settings.summary.companyFallback", "Company profile not set");
    const defaultWarehouse =
      warehouses.find((warehouse) => warehouse.id === data.dashboard.defaultWarehouseId)?.name ||
      (data.dashboard.defaultWarehouseId === "ALL"
        ? tt("filters.warehouse.all", "All warehouses")
        : tt("settings.summary.notSet", "Not set"));
    const valuationMethod = tt("reports.weightedAverage", "Weighted Average");
    return { companyLabel, defaultWarehouse, valuationMethod };
  }, [data.dashboard.defaultWarehouseId, data.documents.brand.name, profile?.legal_name, profile?.trade_name, t, warehouses]);

  const profileReady = Boolean((profile?.trade_name || profile?.legal_name) && profile?.country_code);
  const fiscalReady = Boolean(profile?.legal_name && profile?.tax_id && profile?.country_code);
  const settingsGuideCards = useMemo<SettingsGuideCard[]>(
    () => {
      const cards: SettingsGuideCard[] = [
        {
          key: "company-profile",
          title: copy.cards.companyProfile.title,
          description: copy.cards.companyProfile.description,
          status: profileReady ? copy.statusReady : copy.statusNeedsWork,
          actionLabel: copy.review,
          section: "company-profile",
          tone: profileReady ? "positive" : "warning",
          icon: <BuildingsIcon weight="duotone" />,
        },
        {
          key: "fiscal-legal",
          title: copy.cards.fiscalLegal.title,
          description: copy.cards.fiscalLegal.description,
          status: fiscalReady ? copy.statusReady : copy.statusNeedsWork,
          actionLabel: copy.open,
          href: "/compliance/mz",
          tone: fiscalReady ? "positive" : "warning",
          icon: <ClipboardTextIcon weight="duotone" />,
        },
        {
          key: "commercial-tax",
          title: tt("commercialTax.settingsCard.title", "Commercial tax"),
          description: tt("commercialTax.settingsCard.description", "Configure allowed line-level tax treatments and separate Sales Order and Purchase Order defaults."),
          status: canEditAll ? copy.statusBacked : tt("settings.readOnlyShort", "Read-only"),
          actionLabel: copy.review,
          section: "commercial-tax",
          tone: canEditAll ? "info" : "neutral",
          icon: <CoinsIcon weight="duotone" />,
        },
        {
          key: "users-roles",
          title: copy.cards.usersRoles.title,
          description: copy.cards.usersRoles.description,
          status: canEditOps ? copy.statusBacked : tt("settings.readOnlyShort", "Read-only"),
          actionLabel: copy.open,
          href: "/users",
          tone: canEditOps ? "info" : "neutral",
          icon: <UsersThreeIcon weight="duotone" />,
        },
        {
          key: "warehouses-bins",
          title: copy.cards.warehousesBins.title,
          description: copy.cards.warehousesBins.description,
          status: warehouses.length
            ? tt("warehouses.summary.totalCount", "{count} warehouses", { count: warehouses.length })
            : copy.statusNeedsWork,
          actionLabel: copy.open,
          href: "/warehouses",
          tone: warehouses.length ? "positive" : "warning",
          icon: <WarehouseIcon weight="duotone" />,
        },
        {
          key: "localization",
          title: copy.cards.localization.title,
          description: copy.cards.localization.description,
          status: copy.statusCurrent,
          actionLabel: copy.review,
          section: "localization",
          tone: "info",
          icon: <GlobeIcon weight="duotone" />,
        },
        {
          key: "operations",
          title: copy.cards.operations.title,
          description: copy.cards.operations.description,
          status: copy.statusCurrent,
          actionLabel: copy.review,
          section: "operations",
          tone: "info",
          icon: <ListChecksIcon weight="duotone" />,
        },
        {
          key: "inventory",
          title: copy.cards.inventory.title,
          description: copy.cards.inventory.description,
          status: copy.statusCurrent,
          actionLabel: copy.review,
          section: "inventory",
          tone: "neutral",
          icon: <ScalesIcon weight="duotone" />,
        },
        {
          key: "currencies",
          title: copy.cards.currencies.title,
          description: copy.cards.currencies.description,
          status: copy.statusCurrent,
          actionLabel: copy.open,
          href: "/currency",
          tone: "info",
          icon: <CoinsIcon weight="duotone" />,
        },
        {
          key: "document-numbering",
          title: copy.cards.numbering.title,
          description: copy.cards.numbering.description,
          status: copy.statusBacked,
          actionLabel: copy.open,
          href: "/compliance/mz",
          tone: "info",
          icon: <ListChecksIcon weight="duotone" />,
        },
        {
          key: "bank-accounts",
          title: copy.cards.banks.title,
          description: copy.cards.banks.description,
          status: copy.statusBacked,
          actionLabel: copy.open,
          href: "/banks",
          tone: "neutral",
          icon: <BankIcon weight="duotone" />,
        },
        {
          key: "notifications",
          title: copy.cards.notifications.title,
          description: copy.cards.notifications.description,
          status: data.notifications.dailyDigest ? copy.statusCurrent : copy.statusNeedsWork,
          actionLabel: copy.review,
          section: "notifications",
          tone: data.notifications.dailyDigest ? "positive" : "neutral",
          icon: <BellIcon weight="duotone" />,
        },
        {
          key: "due-reminders",
          title: copy.cards.dueReminders.title,
          description: copy.cards.dueReminders.description,
          status: canEditDueReminders ? copy.statusCurrent : tt("settings.readOnlyShort", "Read-only"),
          actionLabel: copy.review,
          section: "due-reminders",
          tone: canEditDueReminders ? "info" : "neutral",
          icon: <ClockIcon weight="duotone" />,
        },
        {
          key: "documents",
          title: copy.cards.documents.title,
          description: copy.cards.documents.description,
          status: copy.statusCurrent,
          actionLabel: copy.review,
          section: "documents",
          tone: "info",
          icon: <PhosphorFileTextIcon weight="duotone" />,
        },
        {
          key: "imports-exports",
          title: copy.cards.importsExports.title,
          description: copy.cards.importsExports.description,
          status: copy.statusBacked,
          actionLabel: copy.open,
          href: "/setup/import",
          tone: "info",
          icon: <UploadSimpleIcon weight="duotone" />,
        },
      ];

      if (canEditAll) {
        cards.push({
          key: "payment-activation",
          title: tt("activation.title", "Activation and renewal"),
          description: tt("activation.settingsDescription", "Submit private payment proof for platform-admin verification and track the request status."),
          status: copy.statusCurrent,
          actionLabel: copy.open,
          href: "/activation",
          tone: "info",
          icon: <KeyIcon weight="duotone" />,
        });
      }

      if (isPlatformAdmin) {
        cards.push({
          key: "subscription-access",
          title: copy.cards.subscription.title,
          description: copy.cards.subscription.description,
          status: copy.statusPlatform,
          actionLabel: copy.open,
          href: "/platform-control",
          tone: "neutral",
          icon: <KeyIcon weight="duotone" />,
        });
      }

      return cards;
    },
    [
      canEditOps,
      canEditDueReminders,
      canEditAll,
      copy,
      data.notifications.dailyDigest,
      fiscalReady,
      isPlatformAdmin,
      profileReady,
      t,
      tt,
      warehouses.length,
    ],
  );
  const activeSectionTitle = activeSection
    ? settingsGuideCards.find((card) => card.section === activeSection)?.title
    : null;

  const reminderLeadDays = useMemo(
    () =>
      normalizeLeadDays(
        data.dueReminders?.leadDays || DEFAULTS.dueReminders?.leadDays,
      ),
    [data.dueReminders?.leadDays?.join(",")],
  );
  const reminderOffsetsBefore = useMemo(
    () => reminderLeadDays.filter((value) => value > 0),
    [reminderLeadDays],
  );
  const reminderOffsetsAfter = useMemo(
    () => reminderLeadDays.filter((value) => value < 0),
    [reminderLeadDays],
  );
  const reminderOffsetOnDue = reminderLeadDays.includes(0);

  useEffect(() => {
    setDueReminderTimeInput(formatDueReminderTime(data.dueReminders || DEFAULTS.dueReminders));
    setDueReminderLeadDaysError(null);
  }, [
    data.dueReminders?.sendAt,
    data.dueReminders?.hours?.join(","),
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await getPlatformAdminStatus();
        if (!cancelled) setIsPlatformAdmin(Boolean(status?.is_admin));
      } catch {
        if (!cancelled) setIsPlatformAdmin(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!companyId) {
        setLoading(false);
        return;
      }

      const activeLang = readActiveLang();
      const cachedLang = readCachedLang(companyId);
      const fallbackLang = activeLang ?? cachedLang;
      if (fallbackLang) setLang(fallbackLang);

      try {
        setLoading(true);
        setMissingRow(false);

        // load settings + company + warehouses in parallel (snappier)
        const [resSettings, profileRow, resWh] = await Promise.all([
          supabase
            .from("company_settings")
            .select("data")
            .eq("company_id", companyId)
            .maybeSingle(),
          supabase
            .from('companies')
            .select(
              'id, legal_name, trade_name, email_subject_prefix, tax_id, registration_no, phone, email, website, address_line1, address_line2, city, state, postal_code, country_code, print_footer_note, logo_path, preferred_lang'
            )
            .eq('id', companyId)
            .single()
            .then(({ data, error }) => {
              if (error) {
                console.error(error);
                return null;
              }
              return data;
            }),
          supabase
            .from("warehouses")
            .select("id,name")
            .eq("company_id", companyId)
            .order("name", { ascending: true }),
        ]);

        // settings
        if (resSettings.error) console.error(resSettings.error);
        if (!resSettings.data) {
          setMissingRow(true);
          if (!cancelled) {
            const effectiveLang = activeLang ?? cachedLang ?? DEFAULTS.locale.language;
            setData({ ...DEFAULTS, locale: { language: effectiveLang } });
          }
        } else {
          const stored = (resSettings.data.data as Partial<SettingsData>) ?? {};
          const merged = deepMerge(DEFAULTS, stored);
          const storedLang = stored.locale?.language;
          const effectiveLang =
            storedLang === "en" || storedLang === "pt"
              ? storedLang
              : activeLang ?? cachedLang ?? DEFAULTS.locale.language;
          merged.locale.language = effectiveLang;
          if (!cancelled) {
            setData(merged);
            setLang(effectiveLang);
            writeCachedLang(companyId, effectiveLang);
          }
        }

        // company
        if (profileRow && !cancelled)
          setProfile(profileRow);
        // warehouses
        if (!resWh.error && !cancelled)
          setWarehouses((resWh.data ?? []) as Warehouse[]);
      } catch (e: any) {
        console.error(e);
        toast.error(e?.message || tt("settings.toast.loadFailed", "Failed to load settings"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, canEditAll, setLang]);

  const setField = (path: string, value: any) => {
    setData((prev) => {
      const copy: any = clone(prev ?? {});
      const parts = path.split(".");
      let cur = copy;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = cur[parts[i]] ?? {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
      return copy as SettingsData;
    });
  };

  const setProfileField = (key: keyof CompanyProfile, value: any) => {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
  };

  const setReminderLeadDays = (values: number[]) => {
    const normalized = normalizeLeadDays(values);
    setField("dueReminders.leadDays", normalized);
    setDueReminderLeadDaysError(null);
  };

  const addReminderOffset = (direction: "before" | "after") => {
    const raw = direction === "before" ? dueReminderBeforeDraft : dueReminderAfterDraft;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      const message = tt(
        "settings.toast.reminderOffsetInvalid",
        "Enter a whole number of days greater than zero."
      );
      setDueReminderLeadDaysError(message);
      toast.error(message);
      return;
    }

    const offset = direction === "before" ? parsed : -parsed;
    setReminderLeadDays([...reminderLeadDays, offset]);
    if (direction === "before") setDueReminderBeforeDraft("");
    else setDueReminderAfterDraft("");
  };

  const removeReminderOffset = (offset: number) => {
    setReminderLeadDays(reminderLeadDays.filter((value) => value !== offset));
  };

  const save = async () => {
    if (!companyId) return;
    if (!canEditOps) {
      toast.error(tt("settings.toast.noEditPermission", "You do not have permission to edit settings"));
      return;
    }

    try {
      setSaving(true);
      const normalized = clone(data);
      const reminderTime = canEditDueReminders ? parseDueReminderTime(dueReminderTimeInput) : null;
      if (canEditDueReminders) {
        if (!reminderTime) {
          toast.error(
            tt(
              "settings.toast.reminderTimeInvalid",
              "Choose a valid due-reminder time in HH:MM format."
            )
          );
          return;
        }

        if (!reminderLeadDays.length) {
          const message = tt(
            "settings.toast.reminderOffsetRequired",
            "Add at least one reminder offset before saving."
          );
          setDueReminderLeadDaysError(message);
          toast.error(message);
          return;
        }
      }

      normalized.notifications = {
        ...normalized.notifications,
        dailyDigestChannels: { email: true, sms: false, whatsapp: false },
        recipients: {
          emails: normalized.notifications.recipients?.emails || [],
          phones: normalized.notifications.recipients?.phones || [],
          whatsapp: normalized.notifications.recipients?.whatsapp || [],
        },
      };

      if (
        normalized.notifications.dailyDigest &&
        !(normalized.notifications.recipients?.emails || []).length
      ) {
        toast.error(
          tt(
            "settings.toast.digestRecipientsRequired",
            "Add at least one email recipient before enabling the daily digest."
          )
        );
        return;
      }

      if (canEditDueReminders && reminderTime) {
        normalized.dueReminders = {
          ...normalized.dueReminders,
          sendAt: reminderTime.normalized,
          hours: [reminderTime.legacyHourValue],
          leadDays: reminderLeadDays,
        };
      } else {
        delete normalized.dueReminders;
      }

      const { data: updated, error } = await supabase.rpc(
        "update_company_settings",
        {
          p_company_id: companyId,
          p_patch: normalized,
        },
      );
      if (error) throw error;

      const merged = deepMerge(
        DEFAULTS,
        (updated as Partial<SettingsData>) ?? {},
      );
      setData(merged);
      setLang(merged.locale.language);
      writeCachedLang(companyId, merged.locale.language);
      toast.success(tt("settings.toast.saved", "Settings saved"));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || tt("settings.toast.saveFailed", "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    if (!companyId || !profile) return;
    if (!canEditOps) {
      toast.error(tt("settings.toast.noProfilePermission", "You do not have permission to edit company profile"));
      return;
    }
    try {
      setSavingProfile(true);
      const upd = { ...profile };
      // Ensure only writable cols are sent (id is used in filter, not payload)
      delete (upd as any).id;
      const { error } = await supabase
        .from("companies")
        .update(upd)
        .eq("id", companyId);
      if (error) throw error;
      toast.success(tt("settings.toast.companySaved", "Company profile saved"));
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || tt("settings.toast.saveFailed", "Save failed"));
    } finally {
      setSavingProfile(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
            <p className="hidden text-muted-foreground sm:block">{t("settings.subtitle")}</p>
          </div>
        </div>
        <Card>
          <CardContent className="p-6 animate-pulse h-40" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PremiumPageHeader
        title={copy.headerTitle}
        description={copy.headerBody}
        context={
          <PremiumStatusBadge tone={canEditOps ? "positive" : "neutral"} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
            {canEditOps ? tt("settings.editableStatus", "Editable setup") : tt("settings.readOnlyShort", "Read-only")}
          </PremiumStatusBadge>
        }
        meta={
          <>
            <span>{tt("settings.title", "Settings")}</span>
            <span aria-hidden="true">/</span>
            {activeSectionTitle ? (
              <span>{activeSectionTitle}</span>
            ) : (
              <>
                <span>{settingsSummary.defaultWarehouse}</span>
                <span aria-hidden="true">/</span>
                <span>{data.dashboard.defaultWindowDays}d</span>
              </>
            )}
          </>
        }
        actions={
          activeSection && activeSection !== "inventory" && activeSection !== "commercial-tax" ? (
            <div className="mobile-primary-actions">
              {activeSection === "company-profile" ? (
                <Button
                  onClick={saveProfile}
                  disabled={savingProfile || !canEditOps}
                >
                  {savingProfile ? t("actions.saving") : copy.saveCompany}
                </Button>
              ) : (
                <Button onClick={save} disabled={saving || !canEditOps}>
                  {saving ? t("actions.saving") : copy.saveChanges}
                </Button>
              )}
            </div>
          ) : null
        }
      />

      {!canEditOps && (
        <div className="rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-surface-muted/35 px-4 py-3 text-sm text-muted-foreground">
          {tt("settings.readOnly", "Read-only: only Owners / Admins / Managers can edit settings.")}
        </div>
      )}

      {missingRow && !canEditAll && (
        <div className="rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-surface-muted/35 px-4 py-3 text-sm text-muted-foreground">
          {tt(
            "settings.notInitialized",
            "Settings are not initialized yet. Ask an Owner or Admin to open this page once to create them."
          )}
        </div>
      )}

      {!activeSection ? (
        <SetupReadinessPanel
          areas={setupReadiness.areas}
          loading={setupReadiness.loading}
          nextArea={setupReadiness.nextArea}
          summary={setupReadiness.summary}
          onRefresh={() => void setupReadiness.refresh()}
        />
      ) : null}

      {!activeSection ? <div className="grid gap-4 md:grid-cols-3">
        <PremiumMetricCard
          label={tt("settings.summary.companyTitle", "Company profile")}
          value={settingsSummary.companyLabel}
          description={tt(
            "settings.summary.companyHelp",
            "Maintained from the live company profile used in onboarding, exports, and printed documents."
          )}
          icon={<BuildingsIcon weight="duotone" />}
          tone={profileReady ? "positive" : "warning"}
        />
        <PremiumMetricCard
          label={tt("settings.summary.warehouseTitle", "Default warehouse")}
          value={settingsSummary.defaultWarehouse}
          description={tt(
            "settings.summary.warehouseHelp",
            "Used as the default operational context for the dashboard and sales defaults."
          )}
          icon={<WarehouseIcon weight="duotone" />}
          tone={warehouses.length ? "info" : "neutral"}
        />
        <PremiumMetricCard
          label={tt("settings.summary.valuationTitle", "Inventory valuation")}
          value={settingsSummary.valuationMethod}
          description={tt(
            "settings.summary.valuationHelp",
            "Live inventory, stock levels, and landed cost revaluations currently use weighted average costing."
          )}
          icon={<ScalesIcon weight="duotone" />}
          tone="neutral"
        />
      </div> : null}

      {activeSection ? (
        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => {
              setSearchParams({ view: "setup" });
              void setupReadiness.refresh();
            }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {copy.backToSettings}
          </Button>

      {/* ===================== Company Profile (companies) ===================== */}
      <Card id="settings-company-profile" tabIndex={-1} className={activeSection === "company-profile" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="w-5 h-5" />{" "}
            {t("settings.companyProfile.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.tradeName")}</Label>
              <Input
                value={profile?.trade_name ?? ""}
                onChange={(e) => setProfileField("trade_name", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.legalName")}</Label>
              <Input
                value={profile?.legal_name ?? ""}
                onChange={(e) => setProfileField("legal_name", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.emailSubjectPrefix")}</Label>
              <Input
                value={profile?.email_subject_prefix ?? ""}
                onChange={(e) => setProfileField("email_subject_prefix", e.target.value)}
                disabled={!canEditOps}
                placeholder={t("settings.companyProfile.emailSubjectPrefix.placeholder")}
              />
              <div className="hidden text-xs text-muted-foreground sm:block">
                {t("settings.companyProfile.emailSubjectPrefix.helper")}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.taxId")}</Label>
              <Input
                value={profile?.tax_id ?? ""}
                onChange={(e) => setProfileField("tax_id", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.registrationNo")}</Label>
              <Input
                value={profile?.registration_no ?? ""}
                onChange={(e) =>
                  setProfileField("registration_no", e.target.value)
                }
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.phone")}</Label>
              <Input
                value={profile?.phone ?? ""}
                onChange={(e) => setProfileField("phone", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("orders.email")}</Label>
              <Input
                value={profile?.email ?? ""}
                onChange={(e) => setProfileField("email", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.website")}</Label>
              <Input
                value={profile?.website ?? ""}
                onChange={(e) => setProfileField("website", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{t("settings.companyProfile.printFooter")}</Label>
              <Input
                value={profile?.print_footer_note ?? ""}
                onChange={(e) =>
                  setProfileField("print_footer_note", e.target.value)
                }
                disabled={!canEditOps}
                placeholder={t(
                  "settings.companyProfile.printFooter.placeholder",
                )}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2 md:col-span-3">
              <Label>{t("settings.companyProfile.address1")}</Label>
              <Input
                value={profile?.address_line1 ?? ""}
                onChange={(e) =>
                  setProfileField("address_line1", e.target.value)
                }
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>{t("settings.companyProfile.address2")}</Label>
              <Input
                value={profile?.address_line2 ?? ""}
                onChange={(e) =>
                  setProfileField("address_line2", e.target.value)
                }
                disabled={!canEditOps}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.city")}</Label>
              <Input
                value={profile?.city ?? ""}
                onChange={(e) => setProfileField("city", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.state")}</Label>
              <Input
                value={profile?.state ?? ""}
                onChange={(e) => setProfileField("state", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.postal")}</Label>
              <Input
                value={profile?.postal_code ?? ""}
                onChange={(e) => setProfileField("postal_code", e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.country")}</Label>
              <Select
                value={profile?.country_code ?? ""}
                onValueChange={(value) =>
                  setProfileField("country_code", value)
                }
                disabled={!canEditOps}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("settings.companyProfile.country.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{tt("settings.companyProfile.country.common", "Common countries")}</SelectLabel>
                    <SelectItem value="MZ">Mozambique (MZ)</SelectItem>
                    <SelectItem value="PT">Portugal (PT)</SelectItem>
                    <SelectItem value="BR">Brazil (BR)</SelectItem>
                    <SelectItem value="AO">Angola (AO)</SelectItem>
                    <SelectItem value="CV">Cape Verde (CV)</SelectItem>
                    <SelectItem value="GW">Guinea-Bissau (GW)</SelectItem>
                    <SelectItem value="ST">São Tomé and Príncipe (ST)</SelectItem>
                    <SelectItem value="TL">Timor-Leste (TL)</SelectItem>
                    <SelectItem value="US">United States (US)</SelectItem>
                    <SelectItem value="GB">United Kingdom (GB)</SelectItem>
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>{tt("settings.companyProfile.country.other", "Other countries")}</SelectLabel>
                    <SelectItem value="AF">Afghanistan (AF)</SelectItem>
                    <SelectItem value="AL">Albania (AL)</SelectItem>
                    <SelectItem value="DZ">Algeria (DZ)</SelectItem>
                    <SelectItem value="AD">Andorra (AD)</SelectItem>
                    <SelectItem value="AR">Argentina (AR)</SelectItem>
                    <SelectItem value="AM">Armenia (AM)</SelectItem>
                    <SelectItem value="AU">Australia (AU)</SelectItem>
                    <SelectItem value="AT">Austria (AT)</SelectItem>
                    <SelectItem value="AZ">Azerbaijan (AZ)</SelectItem>
                    <SelectItem value="BS">Bahamas (BS)</SelectItem>
                    <SelectItem value="BH">Bahrain (BH)</SelectItem>
                    <SelectItem value="BD">Bangladesh (BD)</SelectItem>
                    <SelectItem value="BB">Barbados (BB)</SelectItem>
                    <SelectItem value="BY">Belarus (BY)</SelectItem>
                    <SelectItem value="BE">Belgium (BE)</SelectItem>
                    <SelectItem value="BZ">Belize (BZ)</SelectItem>
                    <SelectItem value="BJ">Benin (BJ)</SelectItem>
                    <SelectItem value="BT">Bhutan (BT)</SelectItem>
                    <SelectItem value="BO">Bolivia (BO)</SelectItem>
                    <SelectItem value="BA">Bosnia and Herzegovina (BA)</SelectItem>
                    <SelectItem value="BW">Botswana (BW)</SelectItem>
                    <SelectItem value="BN">Brunei (BN)</SelectItem>
                    <SelectItem value="BG">Bulgaria (BG)</SelectItem>
                    <SelectItem value="BF">Burkina Faso (BF)</SelectItem>
                    <SelectItem value="BI">Burundi (BI)</SelectItem>
                    <SelectItem value="KH">Cambodia (KH)</SelectItem>
                    <SelectItem value="CM">Cameroon (CM)</SelectItem>
                    <SelectItem value="CA">Canada (CA)</SelectItem>
                    <SelectItem value="CF">Central African Republic (CF)</SelectItem>
                    <SelectItem value="TD">Chad (TD)</SelectItem>
                    <SelectItem value="CL">Chile (CL)</SelectItem>
                    <SelectItem value="CN">China (CN)</SelectItem>
                    <SelectItem value="CO">Colombia (CO)</SelectItem>
                    <SelectItem value="KM">Comoros (KM)</SelectItem>
                    <SelectItem value="CG">Congo (CG)</SelectItem>
                    <SelectItem value="CD">Congo, Democratic Republic (CD)</SelectItem>
                    <SelectItem value="CR">Costa Rica (CR)</SelectItem>
                    <SelectItem value="CI">Côte d'Ivoire (CI)</SelectItem>
                    <SelectItem value="HR">Croatia (HR)</SelectItem>
                    <SelectItem value="CU">Cuba (CU)</SelectItem>
                    <SelectItem value="CY">Cyprus (CY)</SelectItem>
                    <SelectItem value="CZ">Czech Republic (CZ)</SelectItem>
                    <SelectItem value="DK">Denmark (DK)</SelectItem>
                    <SelectItem value="DJ">Djibouti (DJ)</SelectItem>
                    <SelectItem value="DM">Dominica (DM)</SelectItem>
                    <SelectItem value="DO">Dominican Republic (DO)</SelectItem>
                    <SelectItem value="EC">Ecuador (EC)</SelectItem>
                    <SelectItem value="EG">Egypt (EG)</SelectItem>
                    <SelectItem value="SV">El Salvador (SV)</SelectItem>
                    <SelectItem value="GQ">Equatorial Guinea (GQ)</SelectItem>
                    <SelectItem value="ER">Eritrea (ER)</SelectItem>
                    <SelectItem value="EE">Estonia (EE)</SelectItem>
                    <SelectItem value="SZ">Eswatini (SZ)</SelectItem>
                    <SelectItem value="ET">Ethiopia (ET)</SelectItem>
                    <SelectItem value="FJ">Fiji (FJ)</SelectItem>
                    <SelectItem value="FI">Finland (FI)</SelectItem>
                    <SelectItem value="FR">France (FR)</SelectItem>
                    <SelectItem value="GA">Gabon (GA)</SelectItem>
                    <SelectItem value="GM">Gambia (GM)</SelectItem>
                    <SelectItem value="GE">Georgia (GE)</SelectItem>
                    <SelectItem value="DE">Germany (DE)</SelectItem>
                    <SelectItem value="GH">Ghana (GH)</SelectItem>
                    <SelectItem value="GR">Greece (GR)</SelectItem>
                    <SelectItem value="GD">Grenada (GD)</SelectItem>
                    <SelectItem value="GT">Guatemala (GT)</SelectItem>
                    <SelectItem value="GN">Guinea (GN)</SelectItem>
                    <SelectItem value="GY">Guyana (GY)</SelectItem>
                    <SelectItem value="HT">Haiti (HT)</SelectItem>
                    <SelectItem value="HN">Honduras (HN)</SelectItem>
                    <SelectItem value="HU">Hungary (HU)</SelectItem>
                    <SelectItem value="IS">Iceland (IS)</SelectItem>
                    <SelectItem value="IN">India (IN)</SelectItem>
                    <SelectItem value="ID">Indonesia (ID)</SelectItem>
                    <SelectItem value="IR">Iran (IR)</SelectItem>
                    <SelectItem value="IQ">Iraq (IQ)</SelectItem>
                    <SelectItem value="IE">Ireland (IE)</SelectItem>
                    <SelectItem value="IL">Israel (IL)</SelectItem>
                    <SelectItem value="IT">Italy (IT)</SelectItem>
                    <SelectItem value="JM">Jamaica (JM)</SelectItem>
                    <SelectItem value="JP">Japan (JP)</SelectItem>
                    <SelectItem value="JO">Jordan (JO)</SelectItem>
                    <SelectItem value="KZ">Kazakhstan (KZ)</SelectItem>
                    <SelectItem value="KE">Kenya (KE)</SelectItem>
                    <SelectItem value="KI">Kiribati (KI)</SelectItem>
                    <SelectItem value="KP">Korea, North (KP)</SelectItem>
                    <SelectItem value="KR">Korea, South (KR)</SelectItem>
                    <SelectItem value="KW">Kuwait (KW)</SelectItem>
                    <SelectItem value="KG">Kyrgyzstan (KG)</SelectItem>
                    <SelectItem value="LA">Laos (LA)</SelectItem>
                    <SelectItem value="LV">Latvia (LV)</SelectItem>
                    <SelectItem value="LB">Lebanon (LB)</SelectItem>
                    <SelectItem value="LS">Lesotho (LS)</SelectItem>
                    <SelectItem value="LR">Liberia (LR)</SelectItem>
                    <SelectItem value="LY">Libya (LY)</SelectItem>
                    <SelectItem value="LI">Liechtenstein (LI)</SelectItem>
                    <SelectItem value="LT">Lithuania (LT)</SelectItem>
                    <SelectItem value="LU">Luxembourg (LU)</SelectItem>
                    <SelectItem value="MG">Madagascar (MG)</SelectItem>
                    <SelectItem value="MW">Malawi (MW)</SelectItem>
                    <SelectItem value="MY">Malaysia (MY)</SelectItem>
                    <SelectItem value="MV">Maldives (MV)</SelectItem>
                    <SelectItem value="ML">Mali (ML)</SelectItem>
                    <SelectItem value="MT">Malta (MT)</SelectItem>
                    <SelectItem value="MH">Marshall Islands (MH)</SelectItem>
                    <SelectItem value="MR">Mauritania (MR)</SelectItem>
                    <SelectItem value="MU">Mauritius (MU)</SelectItem>
                    <SelectItem value="MX">Mexico (MX)</SelectItem>
                    <SelectItem value="FM">Micronesia (FM)</SelectItem>
                    <SelectItem value="MD">Moldova (MD)</SelectItem>
                    <SelectItem value="MC">Monaco (MC)</SelectItem>
                    <SelectItem value="MN">Mongolia (MN)</SelectItem>
                    <SelectItem value="ME">Montenegro (ME)</SelectItem>
                    <SelectItem value="MA">Morocco (MA)</SelectItem>
                    <SelectItem value="MZ">Mozambique (MZ)</SelectItem>
                    <SelectItem value="MM">Myanmar (MM)</SelectItem>
                    <SelectItem value="NA">Namibia (NA)</SelectItem>
                    <SelectItem value="NR">Nauru (NR)</SelectItem>
                    <SelectItem value="NP">Nepal (NP)</SelectItem>
                    <SelectItem value="NL">Netherlands (NL)</SelectItem>
                    <SelectItem value="NZ">New Zealand (NZ)</SelectItem>
                    <SelectItem value="NI">Nicaragua (NI)</SelectItem>
                    <SelectItem value="NE">Niger (NE)</SelectItem>
                    <SelectItem value="NG">Nigeria (NG)</SelectItem>
                    <SelectItem value="MK">North Macedonia (MK)</SelectItem>
                    <SelectItem value="NO">Norway (NO)</SelectItem>
                    <SelectItem value="OM">Oman (OM)</SelectItem>
                    <SelectItem value="PK">Pakistan (PK)</SelectItem>
                    <SelectItem value="PW">Palau (PW)</SelectItem>
                    <SelectItem value="PA">Panama (PA)</SelectItem>
                    <SelectItem value="PG">Papua New Guinea (PG)</SelectItem>
                    <SelectItem value="PY">Paraguay (PY)</SelectItem>
                    <SelectItem value="PE">Peru (PE)</SelectItem>
                    <SelectItem value="PH">Philippines (PH)</SelectItem>
                    <SelectItem value="PL">Poland (PL)</SelectItem>
                    <SelectItem value="pt">{tt("settings.language.pt", "Portuguese")}</SelectItem>
                    <SelectItem value="QA">Qatar (QA)</SelectItem>
                    <SelectItem value="RO">Romania (RO)</SelectItem>
                    <SelectItem value="RU">Russia (RU)</SelectItem>
                    <SelectItem value="RW">Rwanda (RW)</SelectItem>
                    <SelectItem value="KN">Saint Kitts and Nevis (KN)</SelectItem>
                    <SelectItem value="LC">Saint Lucia (LC)</SelectItem>
                    <SelectItem value="VC">Saint Vincent and the Grenadines (VC)</SelectItem>
                    <SelectItem value="WS">Samoa (WS)</SelectItem>
                    <SelectItem value="SM">San Marino (SM)</SelectItem>
                    <SelectItem value="ST">Sao Tome and Principe (ST)</SelectItem>
                    <SelectItem value="SA">Saudi Arabia (SA)</SelectItem>
                    <SelectItem value="SN">Senegal (SN)</SelectItem>
                    <SelectItem value="RS">Serbia (RS)</SelectItem>
                    <SelectItem value="SC">Seychelles (SC)</SelectItem>
                    <SelectItem value="SL">Sierra Leone (SL)</SelectItem>
                    <SelectItem value="SG">Singapore (SG)</SelectItem>
                    <SelectItem value="SK">Slovakia (SK)</SelectItem>
                    <SelectItem value="SI">Slovenia (SI)</SelectItem>
                    <SelectItem value="SB">Solomon Islands (SB)</SelectItem>
                    <SelectItem value="SO">Somalia (SO)</SelectItem>
                    <SelectItem value="ZA">South Africa (ZA)</SelectItem>
                    <SelectItem value="SS">South Sudan (SS)</SelectItem>
                    <SelectItem value="ES">Spain (ES)</SelectItem>
                    <SelectItem value="LK">Sri Lanka (LK)</SelectItem>
                    <SelectItem value="SD">Sudan (SD)</SelectItem>
                    <SelectItem value="SR">Suriname (SR)</SelectItem>
                    <SelectItem value="SE">Sweden (SE)</SelectItem>
                    <SelectItem value="CH">Switzerland (CH)</SelectItem>
                    <SelectItem value="SY">Syria (SY)</SelectItem>
                    <SelectItem value="TJ">Tajikistan (TJ)</SelectItem>
                    <SelectItem value="TZ">Tanzania (TZ)</SelectItem>
                    <SelectItem value="TH">Thailand (TH)</SelectItem>
                    <SelectItem value="TG">Togo (TG)</SelectItem>
                    <SelectItem value="TO">Tonga (TO)</SelectItem>
                    <SelectItem value="TT">Trinidad and Tobago (TT)</SelectItem>
                    <SelectItem value="TN">Tunisia (TN)</SelectItem>
                    <SelectItem value="TR">Turkey (TR)</SelectItem>
                    <SelectItem value="TM">Turkmenistan (TM)</SelectItem>
                    <SelectItem value="TV">Tuvalu (TV)</SelectItem>
                    <SelectItem value="UG">Uganda (UG)</SelectItem>
                    <SelectItem value="UA">Ukraine (UA)</SelectItem>
                    <SelectItem value="AE">United Arab Emirates (AE)</SelectItem>
                    <SelectItem value="GB">United Kingdom (GB)</SelectItem>
                    <SelectItem value="US">United States (US)</SelectItem>
                    <SelectItem value="UY">Uruguay (UY)</SelectItem>
                    <SelectItem value="UZ">Uzbekistan (UZ)</SelectItem>
                    <SelectItem value="VU">Vanuatu (VU)</SelectItem>
                    <SelectItem value="VA">Vatican City (VA)</SelectItem>
                    <SelectItem value="VE">Venezuela (VE)</SelectItem>
                    <SelectItem value="VN">Vietnam (VN)</SelectItem>
                    <SelectItem value="YE">Yemen (YE)</SelectItem>
                    <SelectItem value="ZM">Zambia (ZM)</SelectItem>
                    <SelectItem value="ZW">Zimbabwe (ZW)</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preferred Language Selector */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-4">
              <Label>{t("settings.companyProfile.preferredLang")}</Label>
              <Select
                value={profile?.preferred_lang ?? "auto"}
                onValueChange={(v) => setProfileField("preferred_lang", v === "auto" ? null : v as "en" | "pt")}
                disabled={!canEditOps}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("settings.companyProfile.preferredLang.auto")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t("settings.companyProfile.preferredLang.auto")}</SelectItem>
                  <SelectItem value="en">{tt("settings.language.en", "English")}</SelectItem>
                  <SelectItem value="pt">{tt("settings.language.pt", "Portuguese")}</SelectItem>
                </SelectContent>
              </Select>
              <div className="hidden text-xs text-muted-foreground sm:block">
                {t("settings.companyProfile.preferredLang.helper")}
              </div>
            </div>
          </div>

          {/* Logo (write settings.brand.logoUrl for immediate prints; also try to store logo_path) */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("settings.companyProfile.logo")}</Label>
              <LogoUploader
                value={data.documents.brand.logoUrl}
                onChange={(url) => {
                  setField("documents.brand.logoUrl", url);
                  const p = pathFromPublicUrl(url);
                  if (p) setProfileField("logo_path", p);
                }}
                companyId={companyId}
                disabled={!canEditOps}
              />
              <div className="hidden text-xs text-muted-foreground sm:block">
                {t("settings.companyProfile.logo.helper")}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">
                {t("settings.companyProfile.logoPath")}
              </Label>
              <Input
                value={profile?.logo_path ?? ""}
                onChange={(e) => setProfileField("logo_path", e.target.value)}
                disabled={!canEditOps}
                placeholder={t("settings.companyProfile.logoPath.placeholder")}
              />
              <div className="hidden text-[11px] text-muted-foreground sm:block">
                {t("settings.companyProfile.logoPath.helper")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div id="settings-commercial-tax" tabIndex={-1} className={activeSection === "commercial-tax" ? "scroll-mt-24" : "hidden"}>
        <CommercialTaxSettings companyId={companyId} canEdit={canEditAll} />
      </div>

      {/* Localization & UI */}
      <Card id="settings-localization" tabIndex={-1} className={activeSection === "localization" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" /> {t("sections.localization.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>{t("fields.language")}</Label>
            <Select
              value={data.locale.language}
              onValueChange={(v) => {
                setField("locale.language", v);
                setLang(v as "en" | "pt");
                writeCachedLang(companyId, v as "en" | "pt");
              }}
              disabled={!canEditOps}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{tt("settings.language.en", "English")}</SelectItem>
                <SelectItem value="pt">{tt("settings.language.pt", "Portuguese")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t("fields.dashboardWindow")}</Label>
            <Select
              value={String(data.dashboard.defaultWindowDays)}
              onValueChange={(v) =>
                setField("dashboard.defaultWindowDays", Number(v))
              }
              disabled={!canEditOps}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">{t("window.30")}</SelectItem>
                <SelectItem value="60">{t("window.60")}</SelectItem>
                <SelectItem value="90">{t("window.90")}</SelectItem>
                <SelectItem value="180">{t("window.180")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t("fields.defaultWarehouse")}</Label>
            <Select
              value={data.dashboard.defaultWarehouseId}
              onValueChange={(v) => setField("dashboard.defaultWarehouseId", v)}
              disabled={!canEditOps}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{tt("filters.warehouse.all", "All warehouses")}</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={data.dashboard.hideZeros}
              onCheckedChange={(v) => setField("dashboard.hideZeros", v)}
              disabled={!canEditOps}
            />
            <Label>{t("fields.hideZeros")}</Label>
          </div>
        </CardContent>
      </Card>

      {/* Sales & Fulfilment */}
      <Card id="settings-operations" tabIndex={-1} className={activeSection === "operations" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle>{t("sections.sales.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="hidden text-sm text-muted-foreground sm:block md:col-span-2">
            {tt(
              "settings.sales.help",
              "Keep only the operational defaults your team actually controls here. Revenue recognition logic stays in product behavior, not company setup."
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={data.sales.allowLineShip}
              onCheckedChange={(v) => setField("sales.allowLineShip", v)}
              disabled={!canEditOps}
            />
            <Label>{t("fields.allowLineShip")}</Label>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={data.sales.autoCompleteWhenShipped}
              onCheckedChange={(v) =>
                setField("sales.autoCompleteWhenShipped", v)
              }
              disabled={!canEditOps}
            />
            <Label>{t("fields.autoCompleteWhenShipped")}</Label>
          </div>

          <div>
            <Label>{t("fields.defaultFulfilWarehouse")}</Label>
            <Select
              value={data.sales.defaultFulfilWarehouseId || "NONE"}
              onValueChange={(v) =>
                setField(
                  "sales.defaultFulfilWarehouseId",
                  v === "NONE" ? "" : v,
                )
              }
              disabled={!canEditOps}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("common.none")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t("common.none")}</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card id="settings-inventory" tabIndex={-1} className={activeSection === "inventory" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle>{tt("settings.inventory.title", "Inventory valuation")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{tt("settings.inventory.method", "Valuation method")}</Label>
            <Input value={tt("reports.weightedAverage", "Weighted Average")} disabled />
            <div className="text-xs text-muted-foreground">
              {tt(
                "settings.inventory.methodHelp",
                "Operational inventory, stock levels, purchase receipts, and landed cost revaluations currently use weighted average costing."
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label>{tt("settings.inventory.futureMethods", "Other methods")}</Label>
            <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {tt(
                "settings.inventory.futureMethodsHelp",
                "FIFO and LIFO are not yet available for live company inventory valuation, so they are not exposed as selectable company options."
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card id="settings-notifications" tabIndex={-1} className={activeSection === "notifications" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> {tt("settings.digest.title", "Daily digest")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="hidden text-sm text-muted-foreground sm:block md:col-span-2">
            {tt(
              "settings.digest.help",
              "The daily digest is queued once per local day after the selected time and is currently delivered by email only."
            )}
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={data.notifications.dailyDigest}
              onCheckedChange={(v) => setField("notifications.dailyDigest", v)}
              disabled={!canEditOps}
            />
            <Label>{t("notifications.dailyDigestLabel")}</Label>
          </div>

          <div>
            <Label>{t("notifications.digestTime")}</Label>
            <Input
              type="time"
              value={data.notifications.dailyDigestTime || "08:00"}
              onChange={(e) =>
                setField("notifications.dailyDigestTime", e.target.value)
              }
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground mt-1">
              {t("notifications.digestTime.helper")}
            </div>
          </div>

          <div>
            <Label>{t("notifications.timezone")}</Label>
            <Input
              placeholder={t("notifications.timezone.placeholder")}
              value={data.notifications.timezone || "Africa/Maputo"}
              onChange={(e) =>
                setField("notifications.timezone", e.target.value)
              }
              disabled={!canEditOps}
            />
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
            {tt(
              "settings.digest.emailOnly",
              "Email recipients below are the addresses the digest worker will send to when this feature is enabled."
            )}
          </div>

          <div className="md:col-span-2">
            <div>
              <Label>{t("notifications.recipientEmails")}</Label>
              <Input
                placeholder={t("notifications.recipientEmails.placeholder")}
                value={listToCSV(data.notifications.recipients?.emails || [])}
                onChange={(e) =>
                  setField(
                    "notifications.recipients.emails",
                    csvToList(e.target.value),
                  )
                }
                disabled={!canEditOps}
              />
              <div className="mt-1 text-xs text-muted-foreground">
                {tt(
                  "settings.digest.recipientsHelp",
                  "Use one or more company email addresses, separated by commas. SMS and WhatsApp delivery are not active for the daily digest yet."
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Due Reminder Worker Settings */}
      <Card id="settings-due-reminders" tabIndex={-1} className={activeSection === "due-reminders" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" /> {t("settings.dueReminders.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="hidden text-sm text-muted-foreground sm:block md:col-span-2">
            {tt(
              "settings.dueReminders.help",
              "Due reminders run on your company timezone, follow the active AR anchor, and use the billing email on the active order or invoice chain by default."
            )}
          </div>
          {!canEditDueReminders ? (
            <div className="md:col-span-2 rounded-xl border border-informational/25 bg-informational/8 px-3 py-3 text-sm text-informational dark:border-informational/30 dark:bg-informational/10">
              {tt(
                "settings.dueReminders.restricted",
                "Only finance-authority users can change due-reminder settings because reminder policy follows the active legal receivable anchor."
              )}
            </div>
          ) : null}
          <div className="flex items-center gap-3">
            <Switch
              checked={
                data.dueReminders?.enabled ??
                DEFAULTS.dueReminders?.enabled ??
                true
              }
              onCheckedChange={(v) => setField("dueReminders.enabled", v)}
              disabled={!canEditDueReminders}
            />
            <Label>{t("settings.dueReminders.enable")}</Label>
          </div>

          <div>
            <Label>{t("settings.dueReminders.timezone")}</Label>
            <Input
              placeholder={t("settings.dueReminders.timezone.placeholder")}
              value={
                data.dueReminders?.timezone ||
                DEFAULTS.dueReminders?.timezone ||
                "Africa/Maputo"
              }
                onChange={(e) =>
                  setField("dueReminders.timezone", e.target.value)
                }
                disabled={!canEditDueReminders}
              />
            <div className="text-xs text-muted-foreground mt-1">
              {t("settings.dueReminders.timezone.helper")}
            </div>
          </div>

          <div>
            <Label>{t("settings.dueReminders.hours")}</Label>
            <div className="flex gap-2">
              <Input
                type="time"
                step={60}
                value={dueReminderTimeInput}
                onChange={(e) => {
                  setDueReminderTimeInput(e.target.value);
                }}
                onBlur={() => {
                  const parsed = parseDueReminderTime(dueReminderTimeInput);
                  if (!parsed) {
                    setDueReminderTimeInput(
                      formatDueReminderTime(
                        data.dueReminders || DEFAULTS.dueReminders,
                      ),
                    );
                    return;
                  }
                  setDueReminderTimeInput(parsed.normalized);
                  setField("dueReminders.sendAt", parsed.normalized);
                  setField("dueReminders.hours", [parsed.legacyHourValue]);
                }}
                  disabled={!canEditDueReminders}
              />
              {/* <Button 
                variant="outline" 
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.rpc('enqueue_due_reminders_for_all_companies', {
                      p_local_day: new Date().toISOString().split('T')[0],
                      p_force: true, // Add this for testing; resets today's rows to pending
                    });
                    if (error) throw error;
                    toast.success(`Enqueued ${data} reminder jobs`);
                  } catch (e: any) {
                    console.error(e);
                    toast.error(e?.message || 'Failed to enqueue reminders');
                  }
                }}
                      disabled={!canEditDueReminders}
                className="shrink-0"
              >
                Run Now
              </Button> */}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {tt(
                "settings.dueReminders.hours.helper",
                "Company local time, with minute precision."
              )}
            </div>
          </div>

          <div className="md:col-span-2 space-y-3">
            <div>
              <Label>{t("settings.dueReminders.leadDays")}</Label>
              <div className="mt-1 text-xs text-muted-foreground">
                {tt(
                  "settings.dueReminders.leadDays.helper",
                  "Choose when reminders should go out before, on, or after the due date."
                )}
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)]">
              <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
                <div className="text-sm font-medium">
                  {tt("settings.dueReminders.before.title", "Before due date")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tt(
                    "settings.dueReminders.before.help",
                    "Use this for early reminders such as 7, 3, or 1 day before the active receivable document is due."
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {reminderOffsetsBefore.length ? (
                    reminderOffsetsBefore.map((offset) => (
                      <button
                        key={`before-${offset}`}
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background px-3 py-1.5 text-sm"
                        onClick={() => removeReminderOffset(offset)}
                      disabled={!canEditDueReminders}
                      >
                        <span>
                          {tt(
                            offset === 1
                              ? "settings.dueReminders.offsetBefore.one"
                              : "settings.dueReminders.offsetBefore.other",
                            offset === 1 ? "1 day before" : "{count} days before",
                            { count: offset }
                          )}
                        </span>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {tt("settings.dueReminders.before.empty", "No early reminders yet.")}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={dueReminderBeforeDraft}
                    onChange={(e) => {
                      setDueReminderBeforeDraft(e.target.value);
                      if (dueReminderLeadDaysError) setDueReminderLeadDaysError(null);
                    }}
                    placeholder={tt("settings.dueReminders.before.placeholder", "Add days before")}
                      disabled={!canEditDueReminders}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => addReminderOffset("before")}
                disabled={!canEditDueReminders}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {tt("settings.dueReminders.addOffset", "Add")}
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
                <div className="text-sm font-medium">
                  {tt("settings.dueReminders.onDue.title", "On due date")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tt(
                    "settings.dueReminders.onDue.help",
                    "Turn this on if customers should also receive a reminder on the exact due date."
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-3">
                  <div className="text-sm font-medium">
                    {tt("settings.dueReminders.offsetOnDue", "On due date")}
                  </div>
                  <Switch
                    checked={reminderOffsetOnDue}
                    onCheckedChange={(enabled) => {
                      const withoutCurrentDay = reminderLeadDays.filter((value) => value !== 0);
                      setReminderLeadDays(enabled ? [...withoutCurrentDay, 0] : withoutCurrentDay);
                    }}
                    disabled={!canEditDueReminders}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
                <div className="text-sm font-medium">
                  {tt("settings.dueReminders.after.title", "After due date")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {tt(
                    "settings.dueReminders.after.help",
                    "Use this for overdue follow-ups such as 1 or 3 days after the due date passes."
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {reminderOffsetsAfter.length ? (
                    reminderOffsetsAfter.map((offset) => (
                      <button
                        key={`after-${offset}`}
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-background px-3 py-1.5 text-sm"
                        onClick={() => removeReminderOffset(offset)}
                        disabled={!canEditDueReminders}
                      >
                        <span>
                          {tt(
                            Math.abs(offset) === 1
                              ? "settings.dueReminders.offsetAfter.one"
                              : "settings.dueReminders.offsetAfter.other",
                            Math.abs(offset) === 1 ? "1 day after" : "{count} days after",
                            { count: Math.abs(offset) }
                          )}
                        </span>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {tt("settings.dueReminders.after.empty", "No overdue reminders yet.")}
                    </div>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={dueReminderAfterDraft}
                    onChange={(e) => {
                      setDueReminderAfterDraft(e.target.value);
                      if (dueReminderLeadDaysError) setDueReminderLeadDaysError(null);
                    }}
                    placeholder={tt("settings.dueReminders.after.placeholder", "Add days after")}
                    disabled={!canEditDueReminders}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => addReminderOffset("after")}
                    disabled={!canEditDueReminders}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {tt("settings.dueReminders.addOffset", "Add")}
                  </Button>
                </div>
              </div>
            </div>

            <div className={`text-xs ${dueReminderLeadDaysError ? "text-destructive" : "text-muted-foreground"}`}>
              {dueReminderLeadDaysError ||
                tt(
                  "settings.dueReminders.leadDays.summary",
                  "You can mix early, on-date, and overdue reminders. Click an existing reminder chip to remove it."
                )}
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>{t("settings.dueReminders.bcc")}</Label>
            <Input
              placeholder={t("settings.dueReminders.bcc.placeholder")}
              value={listToCSV(data.dueReminders?.bcc || [])}
              onChange={(e) =>
                setField("dueReminders.bcc", csvToList(e.target.value))
              }
              disabled={!canEditDueReminders}
            />
            <div className="text-xs text-muted-foreground mt-1">
              {tt(
                "settings.dueReminders.bccHelp",
                "Optional internal email addresses that should receive a blind-copy when customer due reminders are sent."
              )}
            </div>
          </div>

          <div className="md:col-span-2 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
            {tt(
              "settings.dueReminders.linkingHelp",
              "Reminder links follow the active AR anchor automatically. Sales orders are used only until an issued sales invoice becomes the legal reminder anchor."
            )}
          </div>
        </CardContent>
      </Card>

      {/* Documents & Templates (kept) */}
      <Card id="settings-documents" tabIndex={-1} className={activeSection === "documents" ? "scroll-mt-24" : "hidden"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> {t("sections.documents.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("fields.companyName")}</Label>
            <Input
              value={data.documents.brand.name}
              onChange={(e) => setField("documents.brand.name", e.target.value)}
              disabled={!canEditOps}
              placeholder={tt("settings.documents.brandPlaceholder", "Leave blank to use your company profile name")}
            />
            <div className="text-xs text-muted-foreground">
              {tt("settings.documents.brandHelp", "Display name on printed documents and exports. If left blank, the company profile name is used.")}
            </div>
          </div>

          <div className="space-y-2">
            <LogoUploader
              value={data.documents.brand.logoUrl}
              onChange={(url) => {
                setField("documents.brand.logoUrl", url);
                const p = pathFromPublicUrl(url);
                if (p) setProfileField("logo_path", p);
              }}
              companyId={companyId}
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground">
              {tt("settings.documents.logoHelp", "Paste a URL or upload to Supabase Storage. PNG or SVG works best for printed documents and branded exports.")}
            </div>
          </div>

          <div className="flex items-center gap-3 md:col-span-2">
            <Switch
              checked={data.documents.packingSlipShowsPrices}
              onCheckedChange={(v) =>
                setField("documents.packingSlipShowsPrices", v)
              }
              disabled={!canEditOps}
            />
            <Label>{t("fields.packingSlipShowsPrices")}</Label>
          </div>
        </CardContent>
      </Card>
        </div>
      ) : null}
    </div>
  );
}

export default Settings;
export { Settings };


