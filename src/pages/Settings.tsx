import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { supabase } from "../lib/supabase";
import { useI18n, withI18nFallback } from "../lib/i18n";
import { useOrg } from "../hooks/useOrg";

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

// Existing uploader (fast preview / storage)
import LogoUploader from "../components/settings/LogoUploader";

import { Globe, Bell, FileText, Building, Clock, Plus, X } from "lucide-react";

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
    invoiceBaseUrl?: string;
    hours?: number[];
    sendAt?: string;
  };
};

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
    invoiceBaseUrl: "https://app.stockwise.app/invoices",
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
  const { t, setLang } = useI18n();
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars);
  const { companyId, myRole } = useOrg();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [missingRow, setMissingRow] = useState(false);

  const [data, setData] = useState<SettingsData>(DEFAULTS);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [dueReminderTimeInput, setDueReminderTimeInput] = useState(
    formatDueReminderTime(DEFAULTS.dueReminders),
  );
  const [dueReminderLeadDaysError, setDueReminderLeadDaysError] = useState<string | null>(null);
  const [dueReminderBeforeDraft, setDueReminderBeforeDraft] = useState("");
  const [dueReminderAfterDraft, setDueReminderAfterDraft] = useState("");

  const roleUpper = useMemo(() => String(myRole || "").toUpperCase(), [myRole]);
  const canEditAll = useMemo(
    () => ["OWNER", "ADMIN"].includes(roleUpper),
    [roleUpper],
  );
  const canEditOps = useMemo(
    () => canEditAll || roleUpper === "MANAGER",
    [canEditAll, roleUpper],
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
      if (!companyId) {
        setLoading(false);
        return;
      }

      const cachedLang = readCachedLang(companyId);
      if (cachedLang) setLang(cachedLang);

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
          if (canEditAll) {
            const rpc = await supabase.rpc("update_company_settings", {
              p_company_id: companyId,
              p_patch: DEFAULTS,
            });
            if (!rpc.error && !cancelled) {
              const merged = deepMerge(
                DEFAULTS,
                (rpc.data as Partial<SettingsData>) ?? {},
              );
              setData(merged);
              setLang(merged.locale.language);
              writeCachedLang(companyId, merged.locale.language);
            }
          } else {
            if (!cancelled) {
              setData(DEFAULTS);
              setLang(DEFAULTS.locale.language);
              writeCachedLang(companyId, DEFAULTS.locale.language);
            }
          }
        } else {
          const merged = deepMerge(
            DEFAULTS,
            (resSettings.data.data as Partial<SettingsData>) ?? {},
          );
          if (!cancelled) {
            setData(merged);
            setLang(merged.locale.language);
            writeCachedLang(companyId, merged.locale.language);
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
      const reminderTime = parseDueReminderTime(dueReminderTimeInput);
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

      normalized.dueReminders = {
        ...normalized.dueReminders,
        sendAt: reminderTime.normalized,
        hours: [reminderTime.legacyHourValue],
        leadDays: reminderLeadDays,
      };

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
            <p className="text-muted-foreground">{t("settings.subtitle")}</p>
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">{t("settings.title")}</h1>
          <p className="text-muted-foreground">{t("settings.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={saveProfile}
            disabled={savingProfile || !canEditOps}
            variant="secondary"
          >
            {savingProfile ? t("actions.saving") : tt("settings.actions.saveCompany", "Save company")}
          </Button>
          <Button onClick={save} disabled={saving || !canEditOps}>
            {saving ? t("actions.saving") : t("actions.save")}
          </Button>
        </div>
      </div>

      {!canEditOps && (
        <div className="text-sm text-muted-foreground">
          {tt("settings.readOnly", "Read-only: only Owners / Admins / Managers can edit settings.")}
        </div>
      )}

      {missingRow && !canEditAll && (
        <div className="text-sm text-muted-foreground">
          {tt(
            "settings.notInitialized",
            "Settings are not initialized yet. Ask an Owner or Admin to open this page once to create them."
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tt("settings.summary.companyTitle", "Company profile")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{settingsSummary.companyLabel}</div>
            <div className="text-xs text-muted-foreground">
              {tt(
                "settings.summary.companyHelp",
                "Maintained from the live company profile used in onboarding, exports, and printed documents."
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tt("settings.summary.warehouseTitle", "Default warehouse")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{settingsSummary.defaultWarehouse}</div>
            <div className="text-xs text-muted-foreground">
              {tt(
                "settings.summary.warehouseHelp",
                "Used as the default operational context for the dashboard and sales defaults."
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tt("settings.summary.valuationTitle", "Inventory valuation")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold">{settingsSummary.valuationMethod}</div>
            <div className="text-xs text-muted-foreground">
              {tt(
                "settings.summary.valuationHelp",
                "Live inventory, stock levels, and landed cost revaluations currently use weighted average costing."
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===================== Company Profile (companies) ===================== */}
      <Card>
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
              <div className="text-xs text-muted-foreground">
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
              <div className="text-xs text-muted-foreground">
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
              <div className="text-xs text-muted-foreground">
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
              <div className="text-[11px] text-muted-foreground">
                {t("settings.companyProfile.logoPath.helper")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Localization & UI */}
      <Card>
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
      <Card>
        <CardHeader>
          <CardTitle>{t("sections.sales.title")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 text-sm text-muted-foreground">
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

      <Card>
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> {tt("settings.digest.title", "Daily digest")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 text-sm text-muted-foreground">
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
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" /> {t("settings.dueReminders.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2 text-sm text-muted-foreground">
            {tt(
              "settings.dueReminders.help",
              "Due reminders run on your company timezone, send to the billing email on each sales order, and can add internal BCC copies when needed."
            )}
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={
                data.dueReminders?.enabled ??
                DEFAULTS.dueReminders?.enabled ??
                true
              }
              onCheckedChange={(v) => setField("dueReminders.enabled", v)}
              disabled={!canEditOps}
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
              disabled={!canEditOps}
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
                disabled={!canEditOps}
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
                disabled={!canEditOps}
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
                    "Use this for early reminders such as 7, 3, or 1 day before the invoice is due."
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
                        disabled={!canEditOps}
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
                    disabled={!canEditOps}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => addReminderOffset("before")}
                    disabled={!canEditOps}
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
                    disabled={!canEditOps}
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
                        disabled={!canEditOps}
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
                    disabled={!canEditOps}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => addReminderOffset("after")}
                    disabled={!canEditOps}
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
              disabled={!canEditOps}
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
              "Invoice links in reminders follow the app's document routing automatically. The document URL pattern is product logic, not a company setup field."
            )}
          </div>
        </CardContent>
      </Card>

      {/* Documents & Templates (kept) */}
      <Card>
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
  );
}

export default Settings;
export { Settings };


