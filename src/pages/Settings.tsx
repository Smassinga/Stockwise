// src/pages/Settings.tsx
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

import {
  Settings as SettingsIcon,
  Users,
  Building2 as WarehouseIcon,
  Package,
  Globe,
  Bell,
  FileText,
} from 'lucide-react'

type Warehouse = { id: string; name: string }

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
  notifications: { dailyDigest: boolean; lowStock: { channel: 'email' | 'slack' | 'whatsapp' | 'none' } }
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
  notifications: { dailyDigest: false, lowStock: { channel: 'email' } },
}

function deepMerge<T extends Record<string, any>>(a: T, b: Partial<T>): T {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object') return (b as T) ?? a
  const out: any = { ...a }
  for (const k of Object.keys(b ?? {})) out[k] = deepMerge(a?.[k], (b as any)[k])
  return out
}

const clone = <T,>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T)

function Settings() {
  const { t, setLang } = useI18n()
  const { companyId, myRole } = useOrg()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [missingRow, setMissingRow] = useState(false)
  const [data, setData] = useState<SettingsData>(DEFAULTS)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

    // AFTER
    const roleUpper = useMemo(() => String(myRole || '').toUpperCase(), [myRole])
    const canEditAll = useMemo(() => ['OWNER', 'ADMIN'].includes(roleUpper), [roleUpper])
    const canEditOps = useMemo(() => canEditAll || roleUpper === 'MANAGER', [canEditAll, roleUpper])


  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId) { setLoading(false); return }
      try {
        setLoading(true)
        setMissingRow(false)

        // ---- Load company settings (no 406s)
        const res = await supabase
          .from('company_settings')
          .select('data')
          .eq('company_id', companyId)
          .maybeSingle()

        if (res.error) {
          console.error(res.error)
        }

        if (!res.data) {
          setMissingRow(true)
          // If admin/owner, seed immediately by calling RPC with defaults
          if (canEditAll) {
            const rpc = await supabase.rpc('update_company_settings', {
              p_company_id: companyId,
              p_patch: DEFAULTS,
            })
            if (rpc.error) {
              console.error(rpc.error)
            } else {
              const merged = deepMerge(DEFAULTS, (rpc.data as Partial<SettingsData>) ?? {})
              if (!cancelled) {
                setData(merged)
                setLang(merged.locale.language)
              }
            }
          } else {
            // Non-admins see defaults until an admin initializes
            if (!cancelled) {
              setData(DEFAULTS)
              setLang(DEFAULTS.locale.language)
            }
          }
        } else {
          const merged = deepMerge(DEFAULTS, (res.data.data as Partial<SettingsData>) ?? {})
          if (!cancelled) {
            setData(merged)
            setLang(merged.locale.language)
          }
        }

        // ---- Warehouses (for selects)
        const wh = await supabase
          .from('warehouses')
          .select('id,name')
          .order('name', { ascending: true })
        if (wh.error) throw wh.error
        if (!cancelled) setWarehouses((wh.data ?? []) as Warehouse[])

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

  const save = async () => {
    if (!companyId) return
    if (!canEditOps) { toast.error('You do not have permission to edit settings'); return }

    try {
      setSaving(true)
      const { data: updated, error } = await supabase.rpc('update_company_settings', {
        p_company_id: companyId,
        p_patch: data, // RPC will sanitize based on your role
      })
      if (error) throw error

      // Merge result (server is source of truth)
      const merged = deepMerge(DEFAULTS, (updated as Partial<SettingsData>) ?? {})
      setData(merged)
      setLang(merged.locale.language)
      toast.success(t('actions.save'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Save failed')
    } finally {
      setSaving(false)
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
        <Button onClick={save} disabled={saving || !canEditOps}>
          {saving ? t('actions.saving') : t('actions.save')}
        </Button>
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
            <Button asChild><Link to="/items">{t('sections.uom.button')}</Link></Button>
          </CardContent>
        </Card>
      </div>

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
              disabled={!canEditAll} // managers cannot change
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="order_total_first">{t('fields.revenueRule.order_total_first')}</SelectItem>
                <SelectItem value="lines_only">{t('fields.revenueRule.lines_only')}</SelectItem>
              </SelectContent>
            </Select>
            {!canEditAll && (
              <div className="text-xs text-muted-foreground mt-1">
                Admins only
              </div>
            )}
          </div>

          <div>
            <Label>{t('fields.allocateMissingRevenueBy')}</Label>
            <Select
              value={data.sales.allocateMissingRevenueBy}
              onValueChange={(v) => setField('sales.allocateMissingRevenueBy', v)}
              disabled={!canEditAll} // managers cannot change
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cogs_share">{t('fields.allocateMissingRevenueBy.cogs_share')}</SelectItem>
                <SelectItem value="line_share">{t('fields.allocateMissingRevenueBy.line_share')}</SelectItem>
              </SelectContent>
            </Select>
            {!canEditAll && (
              <div className="text-xs text-muted-foreground mt-1">
                Admins only
              </div>
            )}
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
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={data.notifications.dailyDigest}
              onCheckedChange={(v) => setField('notifications.dailyDigest', v)}
              disabled={!canEditOps}
            />
            <Label>{t('fields.dailyDigest')}</Label>
          </div>
        </CardContent>
      </Card>

      {/* Documents & Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> {t('sections.documents.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>{t('fields.companyName')}</Label>
            <Input
              value={data.documents.brand.name}
              onChange={(e) => setField('documents.brand.name', e.target.value)}
              disabled={!canEditOps}
            />
          </div>

          <div>
            <Label>{t('fields.logoUrl')}</Label>
            <Input
              value={data.documents.brand.logoUrl}
              onChange={(e) => setField('documents.brand.logoUrl', e.target.value)}
              disabled={!canEditOps}
            />
          </div>

          <div className="flex items-center gap-3">
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
