import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { supabase } from "../lib/supabase";
import { useI18n } from "../lib/i18n";
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

import {
  Settings as SettingsIcon,
  Users,
  Building2 as WarehouseIcon,
  Package,
  Globe,
  Bell,
  FileText,
  DollarSign,
  Building,
  Clock,
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
    invoiceBaseUrl?: string;
    hours?: number[]; // Add hours field for reminder times
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
    hours: [9], // Default to 9 AM
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
  const { companyId, myRole } = useOrg();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [missingRow, setMissingRow] = useState(false);

  const [data, setData] = useState<SettingsData>(DEFAULTS);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const roleUpper = useMemo(() => String(myRole || "").toUpperCase(), [myRole]);
  const canEditAll = useMemo(
    () => ["OWNER", "ADMIN"].includes(roleUpper),
    [roleUpper],
  );
  const canEditOps = useMemo(
    () => canEditAll || roleUpper === "MANAGER",
    [canEditAll, roleUpper],
  );

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
        toast.error(e?.message || "Failed to load settings");
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

  const save = async () => {
    if (!companyId) return;
    if (!canEditOps) {
      toast.error("You do not have permission to edit settings");
      return;
    }

    try {
      setSaving(true);
      const { data: updated, error } = await supabase.rpc(
        "update_company_settings",
        {
          p_company_id: companyId,
          p_patch: data,
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
      toast.success("Settings saved");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    if (!companyId || !profile) return;
    if (!canEditOps) {
      toast.error("You do not have permission to edit company profile");
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
      toast.success("Company profile saved");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Save failed");
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
          <p className="text-muted-foreground">{t("settings.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={saveProfile}
            disabled={savingProfile || !canEditOps}
            variant="secondary"
          >
            {savingProfile ? t("actions.saving") : "Save Company"}
          </Button>
          <Button onClick={save} disabled={saving || !canEditOps}>
            {saving ? t("actions.saving") : t("actions.save")}
          </Button>
        </div>
      </div>

      {!canEditOps && (
        <div className="text-sm text-muted-foreground">
          Read-only: only Owners / Admins / Managers can edit settings.
        </div>
      )}

      {missingRow && !canEditAll && (
        <div className="text-sm text-muted-foreground">
          Settings not initialized yet. Ask an Owner/Admin to open this page
          once to create them.
        </div>
      )}

      {/* Quick links */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" /> {t("sections.users.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">{t("sections.users.desc")}</p>
            <Button asChild>
              <Link to="/users">{t("sections.users.button")}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WarehouseIcon className="w-5 h-5" />{" "}
              {t("sections.warehouses.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">
              {t("sections.warehouses.desc")}
            </p>
            <Button asChild>
              <Link to="/warehouses">{t("sections.warehouses.button")}</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" /> {t("sections.uom.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">{t("sections.uom.desc")}</p>
            <Button asChild>
              <Link to="/uom">{t("sections.uom.button")}</Link>
            </Button>
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
                    <SelectLabel>Common Countries</SelectLabel>
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
                    <SelectLabel>Other Countries</SelectLabel>
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
                    <SelectItem value="PT">Portugal (PT)</SelectItem>
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
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="pt">Português</SelectItem>
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
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="pt">Português</SelectItem>
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
                <SelectItem value="ALL">All Warehouses</SelectItem>
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
            <Label>{t("fields.revenueRule")}</Label>
            <Select
              value={data.sales.revenueRule}
              onValueChange={(v) => setField("sales.revenueRule", v)}
              disabled={!canEditAll}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="order_total_first">
                  {t("fields.revenueRule.order_total_first")}
                </SelectItem>
                <SelectItem value="lines_only">
                  {t("fields.revenueRule.lines_only")}
                </SelectItem>
              </SelectContent>
            </Select>
            {!canEditAll && (
              <div className="text-xs text-muted-foreground mt-1">
                Admins only
              </div>
            )}
          </div>

          <div>
            <Label>{t("fields.allocateMissingRevenueBy")}</Label>
            <Select
              value={data.sales.allocateMissingRevenueBy}
              onValueChange={(v) =>
                setField("sales.allocateMissingRevenueBy", v)
              }
              disabled={!canEditAll}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cogs_share">
                  {t("fields.allocateMissingRevenueBy.cogs_share")}
                </SelectItem>
                <SelectItem value="line_share">
                  {t("fields.allocateMissingRevenueBy.line_share")}
                </SelectItem>
              </SelectContent>
            </Select>
            {!canEditAll && (
              <div className="text-xs text-muted-foreground mt-1">
                Admins only
              </div>
            )}
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
                <SelectValue placeholder={t("none")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t("none")}</SelectItem>
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

      {/* Revenue Sources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" /> {t("settings.revenueSources.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>{t("settings.revenueSources.ordersSource")}</Label>
            <Input
              placeholder={t("settings.revenueSources.ordersSource.placeholder")}
              value={data.revenueSources.ordersSource || ""}
              onChange={(e) =>
                setField("revenueSources.ordersSource", e.target.value)
              }
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground mt-1">
              {t("settings.revenueSources.ordersSource.helper")}
            </div>
          </div>

          <div className="md:col-span-2 pt-2">
            <Label>{t("settings.revenueSources.cashSales")}</Label>
            <Input
              placeholder={t("settings.revenueSources.cashSales.placeholder")}
              value={data.revenueSources.cashSales?.source || ""}
              onChange={(e) =>
                setField("revenueSources.cashSales.source", e.target.value)
              }
              disabled={!canEditOps}
            />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
              <div>
                <Label>{t("settings.revenueSources.dateCol")}</Label>
                <Input
                  placeholder={t("settings.revenueSources.dateCol.placeholder")}
                  value={data.revenueSources.cashSales?.dateCol || ""}
                  onChange={(e) =>
                    setField("revenueSources.cashSales.dateCol", e.target.value)
                  }
                  disabled={!canEditOps}
                />
              </div>
              <div>
                <Label>{t("settings.revenueSources.customerCol")}</Label>
                <Input
                  placeholder={t("settings.revenueSources.customerCol.placeholder")}
                  value={data.revenueSources.cashSales?.customerCol || ""}
                  onChange={(e) =>
                    setField(
                      "revenueSources.cashSales.customerCol",
                      e.target.value,
                    )
                  }
                  disabled={!canEditOps}
                />
              </div>
              <div>
                <Label>{t("settings.revenueSources.amountCol")}</Label>
                <Input
                  placeholder={t("settings.revenueSources.amountCol.placeholder")}
                  value={data.revenueSources.cashSales?.amountCol || ""}
                  onChange={(e) =>
                    setField(
                      "revenueSources.cashSales.amountCol",
                      e.target.value,
                    )
                  }
                  disabled={!canEditOps}
                />
              </div>
              <div>
                <Label>{t("settings.revenueSources.currencyCol")}</Label>
                <Input
                  placeholder={t("settings.revenueSources.currencyCol.placeholder")}
                  value={data.revenueSources.cashSales?.currencyCol || ""}
                  onChange={(e) =>
                    setField(
                      "revenueSources.cashSales.currencyCol",
                      e.target.value,
                    )
                  }
                  disabled={!canEditOps}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("settings.revenueSources.cashSales.helper")}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> {t("sections.notifications.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>{t("fields.lowStockChannel")}</Label>
            <Select
              value={data.notifications.lowStock.channel}
              onValueChange={(v) =>
                setField("notifications.lowStock.channel", v)
              }
              disabled={!canEditOps}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{t("common.email")}</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="none">{t("common.none")}</SelectItem>
              </SelectContent>
            </Select>
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

          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={!!data.notifications.dailyDigestChannels?.email}
                onCheckedChange={(v) =>
                  setField("notifications.dailyDigestChannels.email", v)
                }
                disabled={!canEditOps}
              />
              <Label>{t("orders.email")}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!data.notifications.dailyDigestChannels?.sms}
                onCheckedChange={(v) =>
                  setField("notifications.dailyDigestChannels.sms", v)
                }
                disabled={!canEditOps}
              />
              <Label>SMS</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!data.notifications.dailyDigestChannels?.whatsapp}
                onCheckedChange={(v) =>
                  setField("notifications.dailyDigestChannels.whatsapp", v)
                }
                disabled={!canEditOps}
              />
              <Label>WhatsApp</Label>
            </div>
          </div>

          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3">
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
            </div>
            <div>
              <Label>{t("notifications.recipientPhones")}</Label>
              <Input
                placeholder={t("notifications.recipientPhones.placeholder")}
                value={listToCSV(data.notifications.recipients?.phones || [])}
                onChange={(e) =>
                  setField(
                    "notifications.recipients.phones",
                    csvToList(e.target.value),
                  )
                }
                disabled={!canEditOps}
              />
            </div>
            <div>
              <Label>{t("notifications.recipientWhatsapp")}</Label>
              <Input
                placeholder={t("notifications.recipientWhatsapp.placeholder")}
                value={listToCSV(data.notifications.recipients?.whatsapp || [])}
                onChange={(e) =>
                  setField(
                    "notifications.recipients.whatsapp",
                    csvToList(e.target.value),
                  )
                }
                disabled={!canEditOps}
              />
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
                value={
                  data.dueReminders?.hours && data.dueReminders.hours.length > 0
                    ? `${String(data.dueReminders.hours[0]).padStart(2, '0')}:00`
                    : (DEFAULTS.dueReminders?.hours?.[0] 
                        ? `${String(DEFAULTS.dueReminders.hours[0]).padStart(2, '0')}:00`
                        : "09:00")
                }
                onChange={(e) => {
                  const [hours] = e.target.value.split(':').map(Number);
                  if (!isNaN(hours) && hours >= 0 && hours <= 23) {
                    setField("dueReminders.hours", [hours]);
                  } else {
                    setField("dueReminders.hours", []);
                  }
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
              {t("settings.dueReminders.hours.helper")}
            </div>
          </div>

          <div>
            <Label>{t("settings.dueReminders.leadDays")}</Label>
            <Input
              placeholder={t("settings.dueReminders.leadDays.placeholder")}
              value={(
                data.dueReminders?.leadDays ||
                DEFAULTS.dueReminders?.leadDays ||
                []
              ).join(",")}
              onChange={(e) => {
                const leadDays = e.target.value
                  .split(",")
                  .map((d) => parseInt(d.trim()))
                  .filter((d) => !isNaN(d));
                setField("dueReminders.leadDays", leadDays);
              }}
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground mt-1">
              {t("settings.dueReminders.leadDays.helper")}
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>{t("settings.dueReminders.recipients")}</Label>
            <Input
              placeholder={t("settings.dueReminders.recipients.placeholder")}
              value={listToCSV(data.dueReminders?.recipients || [])}
              onChange={(e) =>
                setField("dueReminders.recipients", csvToList(e.target.value))
              }
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground mt-1">
              {t("settings.dueReminders.recipients.helper")}
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
              {t("settings.dueReminders.bcc.helper")}
            </div>
          </div>

          <div className="md:col-span-2">
            <Label>{t("settings.dueReminders.invoiceBaseUrl")}</Label>
            <Input
              placeholder={t("settings.dueReminders.invoiceBaseUrl.placeholder")}
              value={
                data.dueReminders?.invoiceBaseUrl ||
                DEFAULTS.dueReminders?.invoiceBaseUrl ||
                ""
              }
              onChange={(e) =>
                setField("dueReminders.invoiceBaseUrl", e.target.value)
              }
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground mt-1">
              {t("settings.dueReminders.invoiceBaseUrl.helper")}
            </div>
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
              placeholder="Leave blank to use your organization name"
            />
            <div className="text-xs text-muted-foreground">
              Display name on documents. If empty, we’ll use your organization’s
              company name.
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
              Paste a URL or upload to Supabase Storage (public). PNG/SVG
              recommended.
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

      {/* Footer */}
      <Card>
        <CardContent className="p-10 text-center">
          <SettingsIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">{t("more.title")}</h3>
          <p className="text-muted-foreground">{t("more.body")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default Settings;
export { Settings };
