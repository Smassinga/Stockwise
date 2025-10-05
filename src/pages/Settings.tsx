import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useOrg } from '../hooks/useOrg'

import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'

// Existing uploader (fast preview / storage)
import LogoUploader from '../components/settings/LogoUploader'

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
} from 'lucide-react'

type Warehouse = { id: string; name: string }

// ---------------- company profile (companies table) ----------------
type CompanyProfile = {
  id: string
  legal_name: string | null
  trade_name: string | null
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
}

// ---------------- Settings shape (company_settings.data) ------------
type SettingsData = {
  locale: { language: 'en' | 'pt' }
  dashboard: { defaultWindowDays: number; defaultWarehouseId: string; hideZeros: boolean }
  sales: {
    allowLineShip: boolean
    autoCompleteWhenShipped: boolean
    revenueRule: 'order_total_first' | 'lines_only'
    allocateMissingRevenueBy: 'cogs_share' | 'line_share'
    defaultFulfilWarehouseId: string
  }
  documents: { brand: { name: string; logoUrl: string }; packingSlipShowsPrices: boolean }
  revenueSources: {
    ordersSource?: string
    cashSales?: {
      source?: string
      dateCol?: string
      customerCol?: string
      amountCol?: string
      currencyCol?: string
    }
  }
  notifications: {
    dailyDigest: boolean
    dailyDigestTime?: string
    timezone?: string
    dailyDigestChannels?: { email: boolean; sms: boolean; whatsapp: boolean }
    recipients?: { emails: string[]; phones: string[]; whatsapp: string[] }
    lowStock: { channel: 'email' | 'slack' | 'whatsapp' | 'none' }
  }
}

const DEFAULTS: SettingsData = {
  locale: { language: 'en' },
  dashboard: { defaultWindowDays: 30, defaultWarehouseId: 'ALL', hideZeros: false },
  sales: {
    allowLineShip: true,
    autoCompleteWhenShipped: true,
    revenueRule: 'order_total_first',
    allocateMissingRevenueBy: 'cogs_share',
    defaultFulfilWarehouseId: '',
  },
  documents: { brand: { name: '', logoUrl: '' }, packingSlipShowsPrices: false },
  revenueSources: {
    ordersSource: '',
    cashSales: {
      source: '',
      dateCol: 'created_at',
      customerCol: 'customer_id',
      amountCol: 'amount',
      currencyCol: 'currency_code',
    },
  },
  notifications: {
    dailyDigest: false,
    dailyDigestTime: '08:00',
    timezone: 'Africa/Maputo',
    dailyDigestChannels: { email: true, sms: false, whatsapp: false },
    recipients: { emails: [], phones: [], whatsapp: [] },
    lowStock: { channel: 'email' },
  },
}

function deepMerge<T extends Record<string, any>>(a: T, b: Partial<T>): T {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object') return (b as T) ?? a
  const out: any = { ...a }
  for (const k of Object.keys(b ?? {})) out[k] = deepMerge(a?.[k], (b as any)[k])
  return out
}

const clone = <T,>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T)

function listToCSV(list: string[]) { return (list || []).join(', ') }
function csvToList(s: string) {
  return (s || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
}

// ----- per-company language cache -----
const langKey = (companyId?: string | null) => (companyId ? `ui:lang:${companyId}` : 'ui:lang')
function readCachedLang(companyId?: string | null): 'en' | 'pt' | null {
  const c = companyId ? localStorage.getItem(langKey(companyId)) : null
  return c === 'en' || c === 'pt' ? c : null
}
function writeCachedLang(companyId: string | null | undefined, lang: 'en' | 'pt') {
  if (!companyId) return
  localStorage.setItem(langKey(companyId), lang)
}

// extract storage path from public URL for brand-logos bucket
function pathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = '/storage/v1/object/public/brand-logos/'
  const i = url.indexOf(marker)
  if (i === -1) return null
  return url.slice(i + marker.length)
}

function Settings() {
  const { t, setLang } = useI18n()
  const { companyId, myRole } = useOrg()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [missingRow, setMissingRow] = useState(false)

  const [data, setData] = useState<SettingsData>(DEFAULTS)
  const [profile, setProfile] = useState<CompanyProfile | null>(null)

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  const roleUpper = useMemo(() => String(myRole || '').toUpperCase(), [myRole])
  const canEditAll = useMemo(() => ['OWNER', 'ADMIN'].includes(roleUpper), [roleUpper])
  const canEditOps = useMemo(() => canEditAll || roleUpper === 'MANAGER', [canEditAll, roleUpper])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId) { setLoading(false); return }

      const cachedLang = readCachedLang(companyId)
      if (cachedLang) setLang(cachedLang)

      try {
        setLoading(true)
        setMissingRow(false)

        // load settings + company + warehouses in parallel (snappier)
        const [resSettings, resCompany, resWh] = await Promise.all([
          supabase.from('company_settings').select('data').eq('company_id', companyId).maybeSingle(),
          supabase.from('companies').select(`
            id, legal_name, trade_name, tax_id, registration_no, phone, email, website,
            address_line1, address_line2, city, state, postal_code, country_code,
            print_footer_note, logo_path
          `).eq('id', companyId).maybeSingle(),
          supabase.from('warehouses').select('id,name').order('name', { ascending: true }),
        ])

        // settings
        if (resSettings.error) console.error(resSettings.error)
        if (!resSettings.data) {
          setMissingRow(true)
          if (canEditAll) {
            const rpc = await supabase.rpc('update_company_settings', {
              p_company_id: companyId,
              p_patch: DEFAULTS,
            })
            if (!rpc.error && !cancelled) {
              const merged = deepMerge(DEFAULTS, (rpc.data as Partial<SettingsData>) ?? {})
              setData(merged); setLang(merged.locale.language); writeCachedLang(companyId, merged.locale.language)
            }
          } else {
            if (!cancelled) {
              setData(DEFAULTS); setLang(DEFAULTS.locale.language); writeCachedLang(companyId, DEFAULTS.locale.language)
            }
          }
        } else {
          const merged = deepMerge(DEFAULTS, (resSettings.data.data as Partial<SettingsData>) ?? {})
          if (!cancelled) { setData(merged); setLang(merged.locale.language); writeCachedLang(companyId, merged.locale.language) }
        }

        // company
        if (!resCompany.error && !cancelled) setProfile((resCompany.data as any) ?? null)
        // warehouses
        if (!resWh.error && !cancelled) setWarehouses((resWh.data ?? []) as Warehouse[])

      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load settings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, canEditAll, setLang])

  const setField = (path: string, value: any) => {
    setData(prev => {
      const copy: any = clone(prev ?? {})
      const parts = path.split('.')
      let cur = copy
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = cur[parts[i]] ?? {}
        cur = cur[parts[i]]
      }
      cur[parts[parts.length - 1]] = value
      return copy as SettingsData
    })
  }

  const setProfileField = (key: keyof CompanyProfile, value: any) => {
    setProfile(p => (p ? { ...p, [key]: value } : p))
  }

  const save = async () => {
    if (!companyId) return
    if (!canEditOps) { toast.error('You do not have permission to edit settings'); return }

    try {
      setSaving(true)
      const { data: updated, error } = await supabase.rpc('update_company_settings', {
        p_company_id: companyId,
        p_patch: data,
      })
      if (error) throw error

      const merged = deepMerge(DEFAULTS, (updated as Partial<SettingsData>) ?? {})
      setData(merged)
      setLang(merged.locale.language)
      writeCachedLang(companyId, merged.locale.language)
      toast.success('Settings saved')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const saveProfile = async () => {
    if (!companyId || !profile) return
    if (!canEditOps) { toast.error('You do not have permission to edit company profile'); return }
    try {
      setSavingProfile(true)
      const upd = { ...profile }
      // Ensure only writable cols are sent (id is used in filter, not payload)
      delete (upd as any).id
      const { error } = await supabase.from('companies').update(upd).eq('id', companyId)
      if (error) throw error
      toast.success('Company profile saved')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Save failed')
    } finally {
      setSavingProfile(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
            <p className="text-muted-foreground">{t('settings.subtitle')}</p>
          </div>
        </div>
        <Card><CardContent className="p-6 animate-pulse h-40" /></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('settings.title')}</h1>
          <p className="text-muted-foreground">{t('settings.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={saveProfile} disabled={savingProfile || !canEditOps} variant="secondary">
            {savingProfile ? t('actions.saving') : 'Save Company'}
          </Button>
          <Button onClick={save} disabled={saving || !canEditOps}>
            {saving ? t('actions.saving') : t('actions.save')}
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
          Settings not initialized yet. Ask an Owner/Admin to open this page once to create them.
        </div>
      )}

      {/* Quick links */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" /> {t('sections.users.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">{t('sections.users.desc')}</p>
            <Button asChild><Link to="/users">{t('sections.users.button')}</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WarehouseIcon className="w-5 h-5" /> {t('sections.warehouses.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">{t('sections.warehouses.desc')}</p>
            <Button asChild><Link to="/warehouses">{t('sections.warehouses.button')}</Link></Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" /> {t('sections.uom.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground">{t('sections.uom.desc')}</p>
            <Button asChild><Link to="/uom">{t('sections.uom.button')}</Link></Button>
          </CardContent>
        </Card>
      </div>

      {/* ===================== Company Profile (companies) ===================== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="w-5 h-5" /> {t('settings.companyProfile.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.tradeName')}</Label>
              <Input
                value={profile?.trade_name ?? ''}
                onChange={(e) => setProfileField('trade_name', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.legalName')}</Label>
              <Input
                value={profile?.legal_name ?? ''}
                onChange={(e) => setProfileField('legal_name', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.taxId')}</Label>
              <Input
                value={profile?.tax_id ?? ''}
                onChange={(e) => setProfileField('tax_id', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.registrationNo')}</Label>
              <Input
                value={profile?.registration_no ?? ''}
                onChange={(e) => setProfileField('registration_no', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.phone')}</Label>
              <Input
                value={profile?.phone ?? ''}
                onChange={(e) => setProfileField('phone', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('orders.email')}</Label>
              <Input
                value={profile?.email ?? ''}
                onChange={(e) => setProfileField('email', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.website')}</Label>
              <Input
                value={profile?.website ?? ''}
                onChange={(e) => setProfileField('website', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{t('settings.companyProfile.printFooter')}</Label>
              <Input
                value={profile?.print_footer_note ?? ''}
                onChange={(e) => setProfileField('print_footer_note', e.target.value)}
                disabled={!canEditOps}
                placeholder={t('settings.companyProfile.printFooter.placeholder')}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2 md:col-span-3">
              <Label>{t('settings.companyProfile.address1')}</Label>
              <Input
                value={profile?.address_line1 ?? ''}
                onChange={(e) => setProfileField('address_line1', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label>{t('settings.companyProfile.address2')}</Label>
              <Input
                value={profile?.address_line2 ?? ''}
                onChange={(e) => setProfileField('address_line2', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.city')}</Label>
              <Input
                value={profile?.city ?? ''}
                onChange={(e) => setProfileField('city', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.state')}</Label>
              <Input
                value={profile?.state ?? ''}
                onChange={(e) => setProfileField('state', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.postal')}</Label>
              <Input
                value={profile?.postal_code ?? ''}
                onChange={(e) => setProfileField('postal_code', e.target.value)}
                disabled={!canEditOps}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.country')}</Label>
              <Input
                value={profile?.country_code ?? ''}
                onChange={(e) => setProfileField('country_code', e.target.value)}
                disabled={!canEditOps}
                placeholder={t('settings.companyProfile.country.placeholder')}
              />
            </div>
          </div>

          {/* Logo (write settings.brand.logoUrl for immediate prints; also try to store logo_path) */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('settings.companyProfile.logo')}</Label>
              <LogoUploader
                value={data.documents.brand.logoUrl}
                onChange={(url) => {
                  setField('documents.brand.logoUrl', url)
                  const p = pathFromPublicUrl(url)
                  if (p) setProfileField('logo_path', p)
                }}
                companyId={companyId}
                disabled={!canEditOps}
              />
              <div className="text-xs text-muted-foreground">
                {t('settings.companyProfile.logo.helper')}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm text-muted-foreground">{t('settings.companyProfile.logoPath')}</Label>
              <Input
                value={profile?.logo_path ?? ''}
                onChange={(e) => setProfileField('logo_path', e.target.value)}
                disabled={!canEditOps}
                placeholder={t('settings.companyProfile.logoPath.placeholder')}
              />
              <div className="text-[11px] text-muted-foreground">{t('settings.companyProfile.logoPath.helper')}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Localization & UI */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" /> {t('sections.localization.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>{t('fields.language')}</Label>
            <Select
              value={data.locale.language}
              onValueChange={(v) => {
                setField('locale.language', v)
                setLang(v as 'en' | 'pt')
                writeCachedLang(companyId, v as 'en' | 'pt')
              }}
              disabled={!canEditOps}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="pt">Português</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t('fields.dashboardWindow')}</Label>
            <Select
              value={String(data.dashboard.defaultWindowDays)}
              onValueChange={(v) => setField('dashboard.defaultWindowDays', Number(v))}
              disabled={!canEditOps}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">{t('window.30')}</SelectItem>
                <SelectItem value="60">{t('window.60')}</SelectItem>
                <SelectItem value="90">{t('window.90')}</SelectItem>
                <SelectItem value="180">{t('window.180')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t('fields.defaultWarehouse')}</Label>
            <Select
              value={data.dashboard.defaultWarehouseId}
              onValueChange={(v) => setField('dashboard.defaultWarehouseId', v)}
              disabled={!canEditOps}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Warehouses</SelectItem>
                {warehouses.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={data.dashboard.hideZeros}
              onCheckedChange={(v) => setField('dashboard.hideZeros', v)}
              disabled={!canEditOps}
            />
            <Label>{t('fields.hideZeros')}</Label>
          </div>
        </CardContent>
      </Card>

      {/* Sales & Fulfilment */}
      <Card>
        <CardHeader>
          <CardTitle>{t('sections.sales.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center gap-3">
            <Switch
              checked={data.sales.allowLineShip}
              onCheckedChange={(v) => setField('sales.allowLineShip', v)}
              disabled={!canEditOps}
            />
            <Label>{t('fields.allowLineShip')}</Label>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={data.sales.autoCompleteWhenShipped}
              onCheckedChange={(v) => setField('sales.autoCompleteWhenShipped', v)}
              disabled={!canEditOps}
            />
            <Label>{t('fields.autoCompleteWhenShipped')}</Label>
          </div>

          <div>
            <Label>{t('fields.revenueRule')}</Label>
            <Select
              value={data.sales.revenueRule}
              onValueChange={(v) => setField('sales.revenueRule', v)}
              disabled={!canEditAll}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="order_total_first">{t('fields.revenueRule.order_total_first')}</SelectItem>
                <SelectItem value="lines_only">{t('fields.revenueRule.lines_only')}</SelectItem>
              </SelectContent>
            </Select>
            {!canEditAll && <div className="text-xs text-muted-foreground mt-1">Admins only</div>}
          </div>

          <div>
            <Label>{t('fields.allocateMissingRevenueBy')}</Label>
            <Select
              value={data.sales.allocateMissingRevenueBy}
              onValueChange={(v) => setField('sales.allocateMissingRevenueBy', v)}
              disabled={!canEditAll}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cogs_share">{t('fields.allocateMissingRevenueBy.cogs_share')}</SelectItem>
                <SelectItem value="line_share">{t('fields.allocateMissingRevenueBy.line_share')}</SelectItem>
              </SelectContent>
            </Select>
            {!canEditAll && <div className="text-xs text-muted-foreground mt-1">Admins only</div>}
          </div>

          <div>
            <Label>{t('fields.defaultFulfilWarehouse')}</Label>
            <Select
              value={data.sales.defaultFulfilWarehouseId || 'NONE'}
              onValueChange={(v) => setField('sales.defaultFulfilWarehouseId', v === 'NONE' ? '' : v)}
              disabled={!canEditOps}
            >
              <SelectTrigger><SelectValue placeholder={t('none')} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t('none')}</SelectItem>
                {warehouses.map(w => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
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
            <DollarSign className="w-5 h-5" /> Revenue Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Orders / Invoices source (table or view name)</Label>
            <Input
              placeholder='e.g. "sales_orders" or "orders_view"'
              value={data.revenueSources.ordersSource || ''}
              onChange={(e) => setField('revenueSources.ordersSource', e.target.value)}
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground mt-1">
              Table/view should include: <code>id</code>, <code>customer_id/customerId</code>, <code>status</code>,
              <code>currency_code/currencyCode</code>, <code>total/grand_total/net_total</code>, and a date column <code>created_at/createdAt</code>.
            </div>
          </div>

          <div className="md:col-span-2 pt-2">
            <Label>Cash / POS sales source (table or view)</Label>
            <Input
              placeholder='e.g. "cash_sales_view"'
              value={data.revenueSources.cashSales?.source || ''}
              onChange={(e) => setField('revenueSources.cashSales.source', e.target.value)}
              disabled={!canEditOps}
            />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
              <div>
                <Label>Date column</Label>
                <Input
                  placeholder="created_at"
                  value={data.revenueSources.cashSales?.dateCol || ''}
                  onChange={(e) => setField('revenueSources.cashSales.dateCol', e.target.value)}
                  disabled={!canEditOps}
                />
              </div>
              <div>
                <Label>Customer column</Label>
                <Input
                  placeholder="customer_id"
                  value={data.revenueSources.cashSales?.customerCol || ''}
                  onChange={(e) => setField('revenueSources.cashSales.customerCol', e.target.value)}
                  disabled={!canEditOps}
                />
              </div>
              <div>
                <Label>Amount column</Label>
                <Input
                  placeholder="amount"
                  value={data.revenueSources.cashSales?.amountCol || ''}
                  onChange={(e) => setField('revenueSources.cashSales.amountCol', e.target.value)}
                  disabled={!canEditOps}
                />
              </div>
              <div>
                <Label>Currency column (optional)</Label>
                <Input
                  placeholder="currency_code"
                  value={data.revenueSources.cashSales?.currencyCol || ''}
                  onChange={(e) => setField('revenueSources.cashSales.currencyCol', e.target.value)}
                  disabled={!canEditOps}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              We’ll include walk-in/cash sales in Reports → Revenue and in the Daily Digest.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="w-5 h-5" /> {t('sections.notifications.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>{t('fields.lowStockChannel')}</Label>
            <Select
              value={data.notifications.lowStock.channel}
              onValueChange={(v) => setField('notifications.lowStock.channel', v)}
              disabled={!canEditOps}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{t('common.email')}</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="none">{t('common.none')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={data.notifications.dailyDigest}
              onCheckedChange={(v) => setField('notifications.dailyDigest', v)}
              disabled={!canEditOps}
            />
            <Label>{t('notifications.dailyDigestLabel')}</Label>
          </div>

          <div>
            <Label>{t('notifications.digestTime')}</Label>
            <Input
              type="time"
              value={data.notifications.dailyDigestTime || '08:00'}
              onChange={(e) => setField('notifications.dailyDigestTime', e.target.value)}
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground mt-1">{t('notifications.digestTime.helper')}</div>
          </div>

          <div>
            <Label>{t('notifications.timezone')}</Label>
            <Input
              placeholder={t('notifications.timezone.placeholder')}
              value={data.notifications.timezone || 'Africa/Maputo'}
              onChange={(e) => setField('notifications.timezone', e.target.value)}
              disabled={!canEditOps}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={!!data.notifications.dailyDigestChannels?.email}
                onCheckedChange={(v) => setField('notifications.dailyDigestChannels.email', v)}
                disabled={!canEditOps}
              />
              <Label>{t('orders.email')}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!data.notifications.dailyDigestChannels?.sms}
                onCheckedChange={(v) => setField('notifications.dailyDigestChannels.sms', v)}
                disabled={!canEditOps}
              />
              <Label>SMS</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!data.notifications.dailyDigestChannels?.whatsapp}
                onCheckedChange={(v) => setField('notifications.dailyDigestChannels.whatsapp', v)}
                disabled={!canEditOps}
              />
              <Label>WhatsApp</Label>
            </div>
          </div>

          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>{t('notifications.recipientEmails')}</Label>
              <Input
                placeholder={t('notifications.recipientEmails.placeholder')}
                value={listToCSV(data.notifications.recipients?.emails || [])}
                onChange={(e) => setField('notifications.recipients.emails', csvToList(e.target.value))}
                disabled={!canEditOps}
              />
            </div>
            <div>
              <Label>{t('notifications.recipientPhones')}</Label>
              <Input
                placeholder={t('notifications.recipientPhones.placeholder')}
                value={listToCSV(data.notifications.recipients?.phones || [])}
                onChange={(e) => setField('notifications.recipients.phones', csvToList(e.target.value))}
                disabled={!canEditOps}
              />
            </div>
            <div>
              <Label>{t('notifications.recipientWhatsapp')}</Label>
              <Input
                placeholder={t('notifications.recipientWhatsapp.placeholder')}
                value={listToCSV(data.notifications.recipients?.whatsapp || [])}
                onChange={(e) => setField('notifications.recipients.whatsapp', csvToList(e.target.value))}
                disabled={!canEditOps}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Documents & Templates (kept) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> {t('sections.documents.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('fields.companyName')}</Label>
            <Input
              value={data.documents.brand.name}
              onChange={(e) => setField('documents.brand.name', e.target.value)}
              disabled={!canEditOps}
              placeholder="Leave blank to use your organization name"
            />
            <div className="text-xs text-muted-foreground">
              Display name on documents. If empty, we’ll use your organization’s company name.
            </div>
          </div>

          <div className="space-y-2">
            <LogoUploader
              value={data.documents.brand.logoUrl}
              onChange={(url) => {
                setField('documents.brand.logoUrl', url)
                const p = pathFromPublicUrl(url)
                if (p) setProfileField('logo_path', p)
              }}
              companyId={companyId}
              disabled={!canEditOps}
            />
            <div className="text-xs text-muted-foreground">
              Paste a URL or upload to Supabase Storage (public). PNG/SVG recommended.
            </div>
          </div>

          <div className="flex items-center gap-3 md:col-span-2">
            <Switch
              checked={data.documents.packingSlipShowsPrices}
              onCheckedChange={(v) => setField('documents.packingSlipShowsPrices', v)}
              disabled={!canEditOps}
            />
            <Label>{t('fields.packingSlipShowsPrices')}</Label>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <Card>
        <CardContent className="p-10 text-center">
          <SettingsIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">{t('more.title')}</h3>
          <p className="text-muted-foreground">{t('more.body')}</p>
        </CardContent>
      </Card>
    </div>
  )
}

export default Settings
export { Settings }
