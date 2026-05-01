import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { getBaseCurrencyCode } from '../lib/currency'
import { useIsMobile } from '../hooks/use-mobile'
import {
  deriveItemProfileWarnings,
  profileFromRole,
  type ItemPrimaryRole,
  type ItemProfileRecord,
  type ItemProfileState,
  type ItemProfileWarningCode,
} from '../lib/itemProfiles'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'

type Uom = {
  id: string
  code: string
  name: string
  family: string
}

type ItemRow = ItemProfileRecord & {
  id: string
  sku: string
  name: string
  baseUomId: string
  unitPrice?: number | null
  createdAt: string | null
  updatedAt: string | null
  onHandQty?: number | null
  availableQty?: number | null
}

type RoleOption = {
  role: ItemPrimaryRole
  title: string
  description: string
}

const EMPTY_PROFILE = profileFromRole('general')

function sortByName<T extends { name?: string }>(arr: T[]) {
  return [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

function formatQty(value: number | null | undefined, fallback = '-') {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
}

function formatStockThreshold(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
}

function formatMoney(value: number | null | undefined, currencyCode: string) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${currencyCode}`
}

function warningVariant(code: ItemProfileWarningCode): 'destructive' | 'secondary' | 'outline' {
  switch (code) {
    case 'assembled_without_tracking':
    case 'bom_without_assembled_flag':
    case 'component_without_tracking':
      return 'destructive'
    default:
      return 'secondary'
  }
}

export default function ItemsPage() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { myRole, companyId } = useOrg()
  const isMobile = useIsMobile()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uoms, setUoms] = useState<Uom[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [profileFieldsSupported, setProfileFieldsSupported] = useState(false)
  const [baseCurrencyCode, setBaseCurrencyCode] = useState('MZN')

  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [baseUomId, setBaseUomId] = useState('')
  const [minStock, setMinStock] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [draftProfile, setDraftProfile] = useState<ItemProfileState>(EMPTY_PROFILE)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | ItemPrimaryRole>('all')
  const [stockFilter, setStockFilter] = useState<'all' | 'assembly' | 'stocked' | 'service'>('all')

  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editMinStock, setEditMinStock] = useState('0')
  const [savingEdit, setSavingEdit] = useState(false)

  const editingItem = useMemo(
    () => items.find((item) => item.id === editingItemId) ?? null,
    [editingItemId, items],
  )

  const uomById = useMemo(() => new Map(uoms.map((u) => [u.id, u])), [uoms])

  const roleOptions = useMemo<RoleOption[]>(
    () => [
      {
        role: 'resale',
        title: tt('items.roles.resale', 'Resale item'),
        description: tt('items.roles.resaleHelp', 'Purchased and sold from stock without assembly.'),
      },
      {
        role: 'raw_material',
        title: tt('items.roles.rawMaterial', 'Raw material'),
        description: tt('items.roles.rawMaterialHelp', 'Purchased or stocked mainly to feed BOMs and production.'),
      },
      {
        role: 'assembled_product',
        title: tt('items.roles.assembledProduct', 'Assembled product'),
        description: tt('items.roles.assembledProductHelp', 'Built from components through Assembly and then sold or stocked.'),
      },
      {
        role: 'finished_good',
        title: tt('items.roles.finishedGood', 'Finished good'),
        description: tt('items.roles.finishedGoodHelp', 'Stocked finished output that is sold without a BOM-driven build step.'),
      },
      {
        role: 'service',
        title: tt('items.roles.service', 'Service'),
        description: tt('items.roles.serviceHelp', 'Non-stock work or charge that should not participate in inventory.'),
      },
      {
        role: 'general',
        title: tt('items.roles.general', 'General item'),
        description: tt('items.roles.generalHelp', 'Use only when the role is still unclear and needs a neutral starting point.'),
      },
    ],
    [t],
  )

  const familyLabel = (family?: string) => {
    const key = String(family || 'unspecified').toLowerCase()
    const map: Record<string, string> = {
      mass: tt('items.family.mass', 'Mass'),
      volume: tt('items.family.volume', 'Volume'),
      length: tt('items.family.length', 'Length'),
      area: tt('items.family.area', 'Area'),
      count: tt('items.family.count', 'Count'),
      time: tt('items.family.time', 'Time'),
      other: tt('items.family.other', 'Other'),
      unspecified: tt('items.family.unspecified', 'Unspecified'),
    }
    return map[key] || (family ? family : tt('items.family.unspecified', 'Unspecified'))
  }

  const groupedUoms = useMemo(() => {
    const groups = new Map<string, Uom[]>()
    for (const u of uoms) {
      const family = (u.family && u.family.trim()) ? u.family : 'unspecified'
      if (!groups.has(family)) groups.set(family, [])
      groups.get(family)!.push(u)
    }
    for (const rows of groups.values()) rows.sort((a, b) => a.code.localeCompare(b.code))
    const families = Array.from(groups.keys()).sort((a, b) => familyLabel(a).localeCompare(familyLabel(b)))
    return { groups, families }
  }, [uoms])

  const draftWarnings = useMemo(
    () => deriveItemProfileWarnings({ ...draftProfile, minStock: Number(minStock || 0) || 0 }),
    [draftProfile, minStock],
  )

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items.filter((item) => {
      const matchesSearch = !needle
        || item.name.toLowerCase().includes(needle)
        || item.sku.toLowerCase().includes(needle)
      const matchesRole = roleFilter === 'all' || item.primaryRole === roleFilter
      const matchesStock =
        stockFilter === 'all'
        || (stockFilter === 'assembly' && (item.isAssembled || item.hasActiveBom || item.usedAsComponent))
        || (stockFilter === 'stocked' && item.trackInventory)
        || (stockFilter === 'service' && item.primaryRole === 'service')
      return matchesSearch && matchesRole && matchesStock
    })
  }, [items, roleFilter, search, stockFilter])

  const summary = useMemo(() => {
    const warningCount = items.reduce((acc, item) => acc + deriveItemProfileWarnings(item).length, 0)
    return {
      total: items.length,
      stocked: items.filter((item) => item.trackInventory).length,
      assembled: items.filter((item) => item.isAssembled || item.hasActiveBom).length,
      warnings: warningCount,
    }
  }, [items])

  useEffect(() => {
    void loadPage()
  }, [companyId])

  async function loadPage() {
    try {
      setLoading(true)
      const currencyCode = await getBaseCurrencyCode().catch(() => 'MZN')
      setBaseCurrencyCode(currencyCode || 'MZN')
      await Promise.all([loadUoms(), loadItems()])
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('items.toast.loadFailed', 'Failed to load items'))
    } finally {
      setLoading(false)
    }
  }

  async function loadUoms() {
    const normalize = (rows: any[]): Uom[] =>
      (rows ?? []).map((row: any) => ({
        id: String(row.id),
        code: String(row.code ?? '').toUpperCase(),
        name: String(row.name ?? ''),
        family: String(row.family ?? '').trim() || 'unspecified',
      }))

    const safeSelect = async (table: 'uoms' | 'uom', fields: string) => supabase.from(table).select(fields).order('code', { ascending: true })

    let rows: any[] = []
    let result = await safeSelect('uoms', 'id, code, name, family')
    if (result?.data?.length) {
      rows = result.data
    } else if (result?.error && result.error.status === 400) {
      const noFamily = await safeSelect('uoms', 'id, code, name')
      if (noFamily?.data?.length) rows = noFamily.data.map((row: any) => ({ ...row, family: 'unspecified' }))
    }

    if (!rows.length) {
      result = await safeSelect('uom', 'id, code, name, family')
      if (result?.data?.length) {
        rows = result.data
      } else if (result?.error && result.error.status === 400) {
        const noFamily = await safeSelect('uom', 'id, code, name')
        if (noFamily?.data?.length) rows = noFamily.data.map((row: any) => ({ ...row, family: 'unspecified' }))
      }
    }

    setUoms(normalize(rows))
  }

  function normalizeItem(row: any, fallbackProfile = false): ItemRow {
    const primaryRole = (row.primaryRole ?? row.primary_role ?? 'general') as ItemPrimaryRole
    const baseProfile = fallbackProfile ? profileFromRole(primaryRole) : {
      primaryRole,
      trackInventory: Boolean(row.trackInventory ?? row.track_inventory),
      canBuy: Boolean(row.canBuy ?? row.can_buy),
      canSell: Boolean(row.canSell ?? row.can_sell),
      isAssembled: Boolean(row.isAssembled ?? row.is_assembled),
    }

    return {
      id: String(row.id),
      sku: String(row.sku ?? ''),
      name: String(row.name ?? ''),
      baseUomId: String(row.baseUomId ?? row.base_uom_id ?? ''),
      unitPrice: row.unitPrice ?? row.unit_price ?? null,
      minStock: row.minStock ?? row.min_stock ?? null,
      createdAt: row.createdAt ?? row.created_at ?? null,
      updatedAt: row.updatedAt ?? row.updated_at ?? null,
      onHandQty: row.onHandQty ?? null,
      availableQty: row.availableQty ?? null,
      hasActiveBom: row.hasActiveBom ?? false,
      usedAsComponent: row.usedAsComponent ?? false,
      ...baseProfile,
    }
  }

  async function loadItems() {
    const extendedFields = [
      'id',
      'sku',
      'name',
      'baseUomId',
      'unitPrice',
      'minStock',
      'createdAt',
      'updatedAt',
      'primaryRole',
      'trackInventory',
      'canBuy',
      'canSell',
      'isAssembled',
      'onHandQty',
      'availableQty',
      'hasActiveBom',
      'usedAsComponent',
    ].join(',')

    const extendedRes = await supabase.from('items_view').select(extendedFields).order('name', { ascending: true })
    if (!extendedRes.error) {
      setProfileFieldsSupported(true)
      setItems(sortByName((extendedRes.data || []).map((row) => normalizeItem(row))))
      return
    }

    const basicRes = await supabase
      .from('items_view')
      .select('id,sku,name,baseUomId,unitPrice,minStock,createdAt,updatedAt')
      .order('name', { ascending: true })
    if (basicRes.error) throw basicRes.error

    setProfileFieldsSupported(false)
    setItems(sortByName((basicRes.data || []).map((row) => normalizeItem(row, true))))
  }

  async function reloadItems() {
    await loadItems()
  }

  function handleRolePreset(nextRole: ItemPrimaryRole) {
    setDraftProfile(profileFromRole(nextRole))
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()

    if (!can.createItem(role)) {
      return toast.error(tt('items.toast.createPermission', 'Only Operator and above can create items'))
    }
    if (!companyId) {
      return toast.error(tt('items.toast.noCompany', 'No active company'))
    }
    if (!name.trim() || !sku.trim() || !baseUomId) {
      return toast.error(tt('items.toast.required', 'Name, SKU, and base unit are required'))
    }

    const nextMinStock = minStock.trim() ? Number(minStock.trim()) : 0
    if (!Number.isFinite(nextMinStock) || nextMinStock < 0) {
      return toast.error(tt('items.toast.minStockInvalid', 'Minimum stock must be zero or greater'))
    }

    const normalizedUnitPrice = unitPrice.trim()
    if (draftProfile.canSell && !normalizedUnitPrice) {
      return toast.error(tt('items.toast.unitPriceRequired', 'Enter a default sell price for sellable items'))
    }

    const nextUnitPrice = normalizedUnitPrice ? Number(normalizedUnitPrice) : null
    if (draftProfile.canSell && (!Number.isFinite(nextUnitPrice) || (nextUnitPrice ?? 0) < 0)) {
      return toast.error(tt('items.toast.unitPriceInvalid', 'Default sell price must be zero or greater'))
    }

    const warnings = deriveItemProfileWarnings({ ...draftProfile, minStock: nextMinStock })
    if (warnings.includes('assembled_without_tracking') || warnings.includes('service_marked_assembled')) {
      return toast.error(tt('items.toast.profileInvalid', 'Review the item profile before creating this item'))
    }

    try {
      setSaving(true)
      const duplicateCheck = await supabase
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .ilike('sku', sku.trim())
      if (duplicateCheck.error) throw duplicateCheck.error
      if ((duplicateCheck.count ?? 0) > 0) {
        return toast.error(tt('items.toast.skuUnique', 'SKU must be unique in this company'))
      }

      const payload: Record<string, any> = {
        company_id: companyId,
        name: name.trim(),
        sku: sku.trim(),
        base_uom_id: baseUomId,
        min_stock: nextMinStock,
        unit_price: draftProfile.canSell ? nextUnitPrice : null,
      }

      if (profileFieldsSupported) {
        payload.primary_role = draftProfile.primaryRole
        payload.track_inventory = draftProfile.trackInventory
        payload.can_buy = draftProfile.canBuy
        payload.can_sell = draftProfile.canSell
        payload.is_assembled = draftProfile.isAssembled
      }

      const insert = await supabase.from('items').insert(payload).select('id').single()
      if (insert.error) {
        const msg = String(insert.error.message || '')
        const code = String((insert.error as any).code || '')
        if (code === '23505' || /duplicate key|unique/i.test(msg)) {
          return toast.error(tt('items.toast.skuUnique', 'SKU must be unique in this company'))
        }
        throw insert.error
      }

      toast.success(tt('items.toast.created', 'Item created'))
      setName('')
      setSku('')
      setBaseUomId('')
      setMinStock('')
      setUnitPrice('')
      setDraftProfile(EMPTY_PROFILE)
      await reloadItems()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('items.toast.createFailed', 'Failed to create item'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(itemId: string) {
    if (!can.deleteItem(role)) {
      return toast.error(tt('items.toast.deletePermission', 'Only Manager and above can delete items'))
    }
    try {
      const result = await supabase.from('items').delete().eq('id', itemId)
      if (result.error) throw result.error
      toast.success(tt('items.toast.deleted', 'Item deleted'))
      await reloadItems()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('items.toast.deleteFailed', 'Failed to delete item'))
    }
  }

  function openEditItem(item: ItemRow) {
    setEditingItemId(item.id)
    setEditMinStock(typeof item.minStock === 'number' ? String(item.minStock) : '0')
  }

  function closeEditItem(force = false) {
    if (savingEdit && !force) return
    setEditingItemId(null)
    setEditMinStock('0')
  }

  async function handleSaveMinStock(event: React.FormEvent) {
    event.preventDefault()
    if (!editingItem) return
    if (!can.updateItem(role)) {
      return toast.error(tt('items.toast.updatePermission', 'Only Operator and above can update minimum stock'))
    }
    if (!companyId) {
      return toast.error(tt('items.toast.noCompany', 'No active company'))
    }

    const rawValue = editMinStock.trim()
    if (!rawValue) return toast.error(tt('items.toast.minStockRequired', 'Minimum stock is required'))

    const nextMinStock = Number(rawValue)
    if (!Number.isFinite(nextMinStock) || nextMinStock < 0) {
      return toast.error(tt('items.toast.minStockInvalid', 'Minimum stock must be zero or greater'))
    }

    try {
      setSavingEdit(true)
      const update = await supabase
        .from('items')
        .update({ min_stock: nextMinStock })
        .eq('id', editingItem.id)
        .eq('company_id', companyId)
      if (update.error) throw update.error

      toast.success(tt('items.toast.updated', 'Minimum stock updated'))
      closeEditItem(true)
      await reloadItems()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('items.toast.updateFailed', 'Failed to update minimum stock'))
    } finally {
      setSavingEdit(false)
    }
  }

  function roleLabel(roleKey: ItemPrimaryRole) {
    return roleOptions.find((option) => option.role === roleKey)?.title ?? roleKey
  }

  function warningLabel(code: ItemProfileWarningCode) {
    const labels: Record<ItemProfileWarningCode, string> = {
      assembled_without_tracking: tt('items.warnings.assembledWithoutTracking', 'Assembled items should track inventory.'),
      bom_without_assembled_flag: tt('items.warnings.bomWithoutAssembledFlag', 'This item has an active BOM but is not classified as assembled.'),
      assembled_without_bom: tt('items.warnings.assembledWithoutBom', 'The item is marked as assembled but has no active BOM yet.'),
      component_without_tracking: tt('items.warnings.componentWithoutTracking', 'Component items should normally track inventory.'),
      service_with_inventory: tt('items.warnings.serviceWithInventory', 'Services should normally be non-stock items.'),
      service_marked_assembled: tt('items.warnings.serviceMarkedAssembled', 'A service cannot be an assembled product.'),
      nonstock_with_minimum: tt('items.warnings.nonStockWithMinimum', 'Minimum stock only makes sense when inventory is tracked.'),
    }
    return labels[code]
  }

  if (loading) return <div className="app-page app-page--workspace p-6">{tt('loading', 'Loading...')}</div>

  return (
    <div className="app-page app-page--workspace">
      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card/96 shadow-[0_22px_50px_-34px_hsl(var(--foreground)/0.24)]">
        <div className="grid gap-4 p-4 sm:gap-6 sm:p-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(23rem,0.92fr)] xl:p-8 2xl:grid-cols-[minmax(0,1.14fr)_minmax(27rem,0.86fr)]">
          <div className="space-y-3">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.24em]">
              {tt('items.eyebrow', 'Master data clarity')}
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">{tt('items.title', 'Items')}</h1>
              <p className="hidden max-w-3xl text-sm leading-6 text-muted-foreground sm:block">
                {tt(
                  'items.subtitle',
                  'Set up each item once with a clear operational role. Stock, purchasing, selling, and assembly should be obvious before anyone uses the item in orders, builds, or finance documents.',
                )}
              </p>
            </div>
          </div>

          <div className="hidden grid-cols-2 gap-3 sm:grid sm:grid-cols-2">
            <Card className="border-border/60 bg-background/80 shadow-sm backdrop-blur">
              <CardContent className="p-3 sm:p-5">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{tt('items.summary.total', 'Total items')}</div>
                <div className="mt-2 text-2xl font-semibold sm:text-3xl">{summary.total}</div>
                <div className="mt-2 hidden text-sm text-muted-foreground sm:block">{tt('items.summary.totalHelp', 'All item masters in the active company.')}</div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-background/80 shadow-sm backdrop-blur">
              <CardContent className="p-3 sm:p-5">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{tt('items.summary.stocked', 'Stock-tracked')}</div>
                <div className="mt-2 text-2xl font-semibold sm:text-3xl">{summary.stocked}</div>
                <div className="mt-2 hidden text-sm text-muted-foreground sm:block">{tt('items.summary.stockedHelp', 'Items that participate in inventory balances and minimum-stock alerts.')}</div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-background/80 shadow-sm backdrop-blur">
              <CardContent className="p-3 sm:p-5">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{tt('items.summary.assembled', 'Assembly-related')}</div>
                <div className="mt-2 text-2xl font-semibold sm:text-3xl">{summary.assembled}</div>
                <div className="mt-2 hidden text-sm text-muted-foreground sm:block">{tt('items.summary.assembledHelp', 'Items that are assembled themselves or consumed inside BOMs.')}</div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-background/80 shadow-sm backdrop-blur">
              <CardContent className="p-3 sm:p-5">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{tt('items.summary.attention', 'Needs attention')}</div>
                <div className="mt-2 text-2xl font-semibold sm:text-3xl">{summary.warnings}</div>
                <div className="mt-2 hidden text-sm text-muted-foreground sm:block">{tt('items.summary.attentionHelp', 'Profile mismatches that can confuse stock or assembly workflows.')}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.06fr)_minmax(20rem,0.94fr)] 2xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
        <Card className="border-border/70 bg-card shadow-sm">
          <CardHeader className="space-y-1 p-4 pb-2 sm:space-y-2 sm:p-6">
            <CardTitle className="text-base sm:text-lg">{tt('items.createTitle', 'Create a clear item master')}</CardTitle>
            <CardDescription className="hidden sm:block">
              {tt(
                'items.createHelp',
                'Choose the operational role first. After creation, the role stays locked and only minimum stock remains editable unless a controlled data fix is needed.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-4 pt-3 sm:space-y-6 sm:p-6">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-3">
              {roleOptions.map((option) => {
                const active = draftProfile.primaryRole === option.role
                return (
                  <button
                    key={option.role}
                    type="button"
                    className={`rounded-xl border p-2 text-left transition-all sm:rounded-2xl sm:p-4 ${
                      active
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border/70 bg-background hover:border-primary/40 hover:bg-muted/40'
                    }`}
                    onClick={() => handleRolePreset(option.role)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{option.title}</div>
                      {active ? <Badge>{tt('items.selected', 'Selected')}</Badge> : null}
                    </div>
                    <p className="mt-2 hidden text-sm leading-6 text-muted-foreground sm:block">{option.description}</p>
                  </button>
                )
              })}
            </div>

            <form className="grid gap-5" onSubmit={handleCreate}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="item-name">{tt('items.fields.name', 'Name')}</Label>
                  <Input id="item-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={tt('items.placeholder.name', 'e.g. Sweet Bread')} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="item-sku">{tt('items.fields.sku', 'SKU')}</Label>
                  <Input id="item-sku" value={sku} onChange={(event) => setSku(event.target.value)} placeholder={tt('items.placeholder.sku', 'e.g. BR-01')} />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[1.1fr,0.9fr,1fr]">
                <div className="space-y-2">
                  <Label>{tt('items.fields.baseUom', 'Base unit')}</Label>
                  <Select value={baseUomId} onValueChange={setBaseUomId}>
                    <SelectTrigger aria-label={tt('items.fields.baseUom', 'Base unit')}>
                      <SelectValue placeholder={tt('items.placeholder.baseUom', 'Select the unit you will stock and value')} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 overflow-auto">
                      {groupedUoms.families.map((family) => (
                        <div key={family}>
                          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{familyLabel(family)}</div>
                          {groupedUoms.groups.get(family)?.map((uom) => (
                            <SelectItem key={uom.id} value={uom.id}>
                              {uom.code} — {uom.name}
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="item-min-stock">{tt('items.fields.minStock', 'Minimum stock')}</Label>
                  <Input id="item-min-stock" type="number" min="0" step="0.0001" value={minStock} onChange={(event) => setMinStock(event.target.value)} placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="item-unit-price">
                    {tt('items.fields.unitPrice', 'Default sell price')} ({baseCurrencyCode})
                  </Label>
                  <Input
                    id="item-unit-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={unitPrice}
                    onChange={(event) => setUnitPrice(event.target.value)}
                    placeholder="0.00"
                    disabled={!draftProfile.canSell}
                  />
                  <p className="hidden text-xs leading-5 text-muted-foreground sm:block">
                    {draftProfile.canSell
                      ? tt('items.fields.unitPrice.help', 'Point of Sale and quick-sale flows start from this amount. Operators can still adjust the line price before posting.')
                      : tt('items.fields.unitPrice.disabledHelp', 'This role is not marked for selling, so no default sell price is required.')}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <div className="text-sm font-medium">{tt('items.profileTitle', 'Operational role')}</div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium">{tt('items.flags.trackInventory', 'Track inventory')}</div>
                          <div className="hidden text-sm text-muted-foreground sm:block">{tt('items.flags.trackInventoryHelp', 'Turn this off only for services and other non-stock items.')}</div>
                        </div>
                        <Switch
                          checked={draftProfile.trackInventory}
                          onCheckedChange={(checked) => setDraftProfile((prev) => ({ ...prev, trackInventory: checked }))}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium">{tt('items.flags.canBuy', 'Can be purchased')}</div>
                          <div className="hidden text-sm text-muted-foreground sm:block">{tt('items.flags.canBuyHelp', 'Use this when the supplier side should be able to source the item directly.')}</div>
                        </div>
                        <Switch
                          checked={draftProfile.canBuy}
                          onCheckedChange={(checked) => setDraftProfile((prev) => ({ ...prev, canBuy: checked }))}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium">{tt('items.flags.canSell', 'Can be sold')}</div>
                          <div className="hidden text-sm text-muted-foreground sm:block">{tt('items.flags.canSellHelp', 'Turn this on when the item should appear in sales and billing flows.')}</div>
                        </div>
                        <Switch
                          checked={draftProfile.canSell}
                          onCheckedChange={(checked) => setDraftProfile((prev) => ({ ...prev, canSell: checked }))}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium">{tt('items.flags.isAssembled', 'Built through Assembly')}</div>
                          <div className="hidden text-sm text-muted-foreground sm:block">{tt('items.flags.isAssembledHelp', 'Mark this only when production consumes components to produce the item.')}</div>
                        </div>
                        <Switch
                          checked={draftProfile.isAssembled}
                          onCheckedChange={(checked) => setDraftProfile((prev) => ({ ...prev, isAssembled: checked }))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-2xl border border-border/60 bg-background/80 p-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">{tt('items.previewTitle', 'Profile preview')}</div>
                      <div className="flex flex-wrap gap-2">
                        <Badge>{roleLabel(draftProfile.primaryRole)}</Badge>
                        <Badge variant={draftProfile.trackInventory ? 'outline' : 'secondary'}>
                          {draftProfile.trackInventory ? tt('items.preview.stocked', 'Stocked') : tt('items.preview.nonStock', 'Non-stock')}
                        </Badge>
                        {draftProfile.canBuy ? <Badge variant="outline">{tt('items.preview.bought', 'Bought')}</Badge> : null}
                        {draftProfile.canSell ? <Badge variant="outline">{tt('items.preview.sold', 'Sold')}</Badge> : null}
                        {draftProfile.isAssembled ? <Badge variant="secondary">{tt('items.preview.assembled', 'Assembled')}</Badge> : null}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="hidden text-sm font-medium sm:block">{tt('items.preview.lockingTitle', 'Post-create lock')}</div>
                      <p className="hidden text-sm leading-6 text-muted-foreground sm:block">
                        {tt(
                          'items.preview.lockingHelp',
                          'Item role, inventory behavior, buy/sell flags, and default sell price are fixed at creation time. After save, only minimum stock remains editable in normal operations.',
                        )}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">{tt('items.preview.warningTitle', 'Readiness check')}</div>
                      {draftWarnings.length ? (
                        <div className="flex flex-wrap gap-2">
                          {draftWarnings.map((warning) => (
                            <Badge key={warning} variant={warningVariant(warning)} className="max-w-full whitespace-normal">
                              {warningLabel(warning)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">{tt('items.preview.warningNone', 'No role contradictions detected for this setup.')}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <details className="rounded-2xl border border-border/70 bg-muted/15 p-3 text-sm sm:hidden">
                <summary className="cursor-pointer font-medium">{tt('items.reviewTitle', 'Classification guide')}</summary>
                <div className="mt-3 space-y-2 text-muted-foreground">
                  <p>{tt('items.guidance.inventoryBody', 'Track inventory for anything that should affect on-hand, costing, minimum stock, or assembly availability. Turn inventory off for pure services only.')}</p>
                  <p>{tt('items.guidance.commercialBody', 'Use the buy and sell flags to show whether the item belongs in supplier flows, customer flows, or both. This reduces wrong-line selection later in orders and bills.')}</p>
                </div>
              </details>

              <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/80 p-4 md:flex-row md:items-center md:justify-between">
                <div className="hidden text-sm text-muted-foreground sm:block">
                  {tt('items.createFooter', 'Create items with the right role and default sell price up front so Assembly, stock review, purchasing, and Point of Sale all start from clean master data.')}
                </div>
                <Button type="submit" disabled={saving}>
                  {saving ? tt('actions.saving', 'Saving...') : tt('items.createAction', 'Create item')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="hidden border-border/70 bg-card shadow-sm sm:block">
          <CardHeader className="space-y-2">
            <CardTitle>{tt('items.reviewTitle', 'Classification guide')}</CardTitle>
            <CardDescription>
              {tt(
                'items.reviewHelp',
                'Use these cues before you save. The role should explain how the item behaves in stock, procurement, sales, and assembly.',
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="text-sm font-medium">{tt('items.guidance.inventoryTitle', 'Inventory discipline')}</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {tt('items.guidance.inventoryBody', 'Track inventory for anything that should affect on-hand, costing, minimum stock, or assembly availability. Turn inventory off for pure services only.')}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="text-sm font-medium">{tt('items.guidance.assemblyTitle', 'Assembly discipline')}</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {tt('items.guidance.assemblyBody', 'Only assembled products should be marked as built through Assembly. Components should normally be raw materials or stocked bought items.')}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                <div className="text-sm font-medium">{tt('items.guidance.commercialTitle', 'Commercial discipline')}</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {tt('items.guidance.commercialBody', 'Use the buy and sell flags to show whether the item belongs in supplier flows, customer flows, or both. This reduces wrong-line selection later in orders and bills.')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="border-border/70 bg-card shadow-[0_20px_48px_-36px_hsl(var(--foreground)/0.24)]">
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>{tt('items.registerTitle', 'Item register')}</CardTitle>
              <CardDescription>{tt('items.registerHelp', 'Review stock behavior, commercial role, and assembly participation before the item reaches orders, production, or costing.')}</CardDescription>
            </div>
            <div className="mobile-filter-stack grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)] xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tt('items.searchPlaceholder', 'Search by name or SKU')} />
              <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as 'all' | ItemPrimaryRole)}>
                <SelectTrigger><SelectValue placeholder={tt('items.filters.role', 'All roles')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tt('items.filters.roleAll', 'All roles')}</SelectItem>
                  {roleOptions.map((option) => (
                    <SelectItem key={option.role} value={option.role}>{option.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stockFilter} onValueChange={(value) => setStockFilter(value as typeof stockFilter)}>
                <SelectTrigger><SelectValue placeholder={tt('items.filters.scope', 'All scopes')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tt('items.filters.scopeAll', 'All scopes')}</SelectItem>
                  <SelectItem value="stocked">{tt('items.filters.scopeStocked', 'Stocked only')}</SelectItem>
                  <SelectItem value="assembly">{tt('items.filters.scopeAssembly', 'Assembly-related')}</SelectItem>
                  <SelectItem value="service">{tt('items.filters.scopeService', 'Services')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {filteredItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/80 bg-muted/15 p-8 text-center">
              <div className="text-lg font-medium">{tt('items.emptyTitle', 'No items match this view')}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {items.length === 0
                  ? tt('items.emptyBody', 'Start with a resale item, raw material, or assembled product so the rest of the workflow has a clean master-data base.')
                  : tt('items.emptyFiltered', 'Clear the filters or search term to see more items.')}
              </p>
            </div>
          ) : isMobile ? (
            <div className="mobile-register-list space-y-3">
              {filteredItems.map((item) => {
                const warnings = deriveItemProfileWarnings(item)
                const baseUom = uomById.get(item.baseUomId)
                return (
                  <div key={item.id} className="rounded-2xl border border-border/70 bg-background/92 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div>
                          <div className="truncate font-medium">{item.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{item.sku}</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge>{roleLabel(item.primaryRole)}</Badge>
                          <Badge variant={item.trackInventory ? 'outline' : 'secondary'}>
                            {item.trackInventory ? tt('items.preview.stocked', 'Stocked') : tt('items.preview.nonStock', 'Non-stock')}
                          </Badge>
                          {item.canSell ? <Badge variant="outline">{tt('items.preview.sold', 'Sold')}</Badge> : null}
                          {item.isAssembled ? <Badge variant="secondary">{tt('items.preview.assembled', 'Assembled')}</Badge> : null}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('items.table.unitPrice', 'Default sell price')}</div>
                        <div className="mt-1 text-sm font-semibold">
                          {item.canSell ? formatMoney(item.unitPrice ?? 0, baseCurrencyCode) : '—'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('items.table.baseUom', 'Base UoM')}</div>
                        <div className="mt-1 text-sm">{baseUom ? `${baseUom.code} — ${baseUom.name}` : item.baseUomId}</div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('items.table.onHand', 'On hand')}</div>
                          <div className="mt-1 text-sm font-semibold">{formatQty(item.onHandQty)}</div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('items.table.available', 'Available')}</div>
                          <div className="mt-1 text-sm font-semibold">{formatQty(item.availableQty)}</div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('items.fields.minStock', 'Minimum stock')}</div>
                          <div className="mt-1 text-sm font-semibold">{formatStockThreshold(item.minStock)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{tt('items.table.readiness', 'Readiness')}</div>
                      {warnings.length ? (
                        <div className="flex flex-wrap gap-2">
                          {warnings.map((warning) => (
                            <Badge key={warning} variant={warningVariant(warning)} className="max-w-full whitespace-normal">
                              {warningLabel(warning)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">{tt('items.ready', 'Ready')}</span>
                      )}
                    </div>

                    <div className="mt-4 flex flex-col gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditItem(item)} disabled={!can.updateItem(role)}>
                        {tt('items.actions.minStock', 'Edit minimum')}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(item.id)} disabled={!can.deleteItem(role)}>
                        {tt('common.delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tt('table.item', 'Item')}</TableHead>
                  <TableHead>{tt('items.table.role', 'Role')}</TableHead>
                  <TableHead>{tt('items.table.baseUom', 'Base UoM')}</TableHead>
                  <TableHead className="text-right">{tt('items.table.unitPrice', 'Default sell price')}</TableHead>
                  <TableHead className="text-right">{tt('items.table.onHand', 'On hand')}</TableHead>
                  <TableHead className="text-right">{tt('items.table.available', 'Available')}</TableHead>
                  <TableHead className="text-right">{tt('items.fields.minStock', 'Minimum stock')}</TableHead>
                  <TableHead>{tt('items.table.readiness', 'Readiness')}</TableHead>
                  <TableHead className="text-right">{tt('common.actions', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const warnings = deriveItemProfileWarnings(item)
                  const baseUom = uomById.get(item.baseUomId)
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="align-top">
                        <div className="space-y-2">
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.sku}</div>
                          <div className="flex flex-wrap gap-2">
                            <Badge>{roleLabel(item.primaryRole)}</Badge>
                            <Badge variant={item.trackInventory ? 'outline' : 'secondary'}>
                              {item.trackInventory ? tt('items.preview.stocked', 'Stocked') : tt('items.preview.nonStock', 'Non-stock')}
                            </Badge>
                            {item.canBuy ? <Badge variant="outline">{tt('items.preview.bought', 'Bought')}</Badge> : null}
                            {item.canSell ? <Badge variant="outline">{tt('items.preview.sold', 'Sold')}</Badge> : null}
                            {item.isAssembled ? <Badge variant="secondary">{tt('items.preview.assembled', 'Assembled')}</Badge> : null}
                            {item.usedAsComponent ? <Badge variant="outline">{tt('items.table.component', 'Component')}</Badge> : null}
                            {item.hasActiveBom ? <Badge variant="outline">{tt('items.table.activeBom', 'Active BOM')}</Badge> : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">{roleLabel(item.primaryRole)}</TableCell>
                      <TableCell className="align-top text-sm text-muted-foreground">
                        {baseUom ? `${baseUom.code} — ${baseUom.name}` : item.baseUomId}
                      </TableCell>
                      <TableCell className="text-right align-top">
                        {item.canSell ? formatMoney(item.unitPrice ?? 0, baseCurrencyCode) : '—'}
                      </TableCell>
                      <TableCell className="text-right align-top">{formatQty(item.onHandQty)}</TableCell>
                      <TableCell className="text-right align-top">{formatQty(item.availableQty)}</TableCell>
                      <TableCell className="text-right align-top">{formatStockThreshold(item.minStock)}</TableCell>
                      <TableCell className="align-top">
                        {warnings.length ? (
                          <div className="flex flex-wrap gap-2">
                            {warnings.map((warning) => (
                              <Badge key={warning} variant={warningVariant(warning)} className="max-w-full whitespace-normal">
                                {warningLabel(warning)}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">{tt('items.ready', 'Ready')}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right align-top">
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEditItem(item)} disabled={!can.updateItem(role)}>
                            {tt('items.actions.minStock', 'Edit minimum')}
                          </Button>
                          <Button variant="destructive" size="sm" onClick={() => handleDelete(item.id)} disabled={!can.deleteItem(role)}>
                            {tt('common.delete', 'Delete')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => { if (!open) closeEditItem() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt('items.editTitle', 'Update minimum stock')}</DialogTitle>
            <DialogDescription>
              {tt(
                'items.editHelp',
                'Phase 3B keeps operational classification locked after creation. Use this dialog only to maintain the replenishment threshold.',
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveMinStock}>
            <DialogBody className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
                <div className="font-medium">{editingItem?.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{editingItem?.sku}</div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-min-stock">{tt('items.fields.minStock', 'Minimum stock')}</Label>
                <Input id="edit-min-stock" type="number" min="0" step="0.0001" value={editMinStock} onChange={(event) => setEditMinStock(event.target.value)} />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => closeEditItem()} disabled={savingEdit}>
                {tt('common.cancel', 'Cancel')}
              </Button>
              <Button type="submit" disabled={savingEdit}>
                {savingEdit ? tt('actions.saving', 'Saving...') : tt('actions.save', 'Save changes')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

