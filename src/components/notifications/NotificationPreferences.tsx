import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../../hooks/useAuth";
import { useOrg } from "../../hooks/useOrg";
import { useI18n } from "../../lib/i18n";
import { supabase } from "../../lib/supabase";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const categories = ["approvals", "inventory", "orders", "service_jobs", "receivables", "payables", "users_access", "imports", "communications", "system"] as const;
type Category = typeof categories[number];
type Mode = "immediate" | "digest" | "off";
type Preference = { category: Category; in_app_mode: Mode; email_mode: Mode };

export function NotificationPreferences() {
  const { companyId } = useOrg();
  const { user } = useAuth();
  const { lang } = useI18n();
  const [rows, setRows] = useState<Preference[]>([]);
  const labels: Record<Category, { en: string; pt: string }> = {
    approvals: { en: "Approvals", pt: "Aprovações" }, inventory: { en: "Inventory exceptions", pt: "Excepções de inventário" },
    orders: { en: "Orders and fulfilment", pt: "Encomendas e cumprimento" }, service_jobs: { en: "Service Jobs", pt: "Serviços" },
    receivables: { en: "Receivables", pt: "Contas a receber" }, payables: { en: "Payables", pt: "Contas a pagar" },
    users_access: { en: "Users and access", pt: "Utilizadores e acesso" }, imports: { en: "Imports", pt: "Importações" },
    communications: { en: "Communications failures", pt: "Falhas de comunicações" }, system: { en: "System", pt: "Sistema" },
  };
  const modeLabels: Record<Mode, { en: string; pt: string }> = {
    immediate: { en: "Immediate", pt: "Imediata" }, digest: { en: "Digest", pt: "Resumo" }, off: { en: "Off", pt: "Desligada" },
  };

  useEffect(() => {
    if (!companyId || !user?.id) return;
    void supabase.from("notification_preferences").select("category,in_app_mode,email_mode").eq("company_id", companyId).eq("user_id", user.id)
      .then(({ data }) => setRows((data || []) as Preference[]));
  }, [companyId, user?.id]);

  async function update(category: Category, field: "in_app_mode" | "email_mode", value: Mode) {
    if (!companyId || !user?.id) return;
    const previous = rows.find((row) => row.category === category) || { category, in_app_mode: "immediate" as Mode, email_mode: "off" as Mode };
    const next = { ...previous, [field]: value };
    setRows((current) => [...current.filter((row) => row.category !== category), next]);
    const { error } = await supabase.from("notification_preferences").upsert({ company_id: companyId, user_id: user.id, ...next }, { onConflict: "company_id,user_id,category" });
    if (error) { setRows((current) => [...current.filter((row) => row.category !== category), previous]); toast.error(lang === "pt" ? "Não foi possível guardar a preferência." : "Could not save the preference."); }
  }

  return <div className="md:col-span-2 space-y-3 border-t border-border/70 pt-4">
    <div><Label>{lang === "pt" ? "Preferências por categoria" : "Category preferences"}</Label><p className="text-xs text-muted-foreground">{lang === "pt" ? "As notificações na aplicação e por email são controladas separadamente. Os avisos críticos do sistema permanecem activos." : "In-app and email notifications are controlled separately. Critical system notices remain enabled."}</p></div>
    <div className="grid gap-2">
      {categories.map((category) => { const value = rows.find((row) => row.category === category) || { category, in_app_mode: "immediate" as Mode, email_mode: "off" as Mode }; return <div key={category} className="grid gap-2 rounded-xl border border-border/70 p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:items-center">
        <span className="text-sm font-medium">{labels[category][lang === "pt" ? "pt" : "en"]}</span>
        <Select value={value.in_app_mode} onValueChange={(mode: Mode) => void update(category, "in_app_mode", mode)} disabled={category === "system"}><SelectTrigger aria-label={`${labels[category].en} in-app`}><SelectValue /></SelectTrigger><SelectContent>{(["immediate", "digest", "off"] as Mode[]).map((mode) => <SelectItem key={mode} value={mode}>{modeLabels[mode][lang === "pt" ? "pt" : "en"]}</SelectItem>)}</SelectContent></Select>
        <Select value={value.email_mode} onValueChange={(mode: Mode) => void update(category, "email_mode", mode)}><SelectTrigger aria-label={`${labels[category].en} email`}><SelectValue /></SelectTrigger><SelectContent>{(["immediate", "digest", "off"] as Mode[]).map((mode) => <SelectItem key={mode} value={mode}>{modeLabels[mode][lang === "pt" ? "pt" : "en"]}</SelectItem>)}</SelectContent></Select>
      </div> })}
    </div>
  </div>;
}
