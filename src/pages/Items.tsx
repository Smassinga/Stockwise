import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { AlertTriangle, Download, ExternalLink, Package, PackageCheck, Pencil, Plus, Settings2, Tags, Trash2, Upload, Warehouse } from 'lucide-react'
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
import { familySortIndex, isReusableUomCode } from '../lib/uom'
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
import { PremiumColumnVisibilityMenu } from '../components/premium/PremiumColumnVisibilityMenu'
import {
  PremiumDataTable,
  sortPremiumRows,
  type PremiumColumnVisibilityState,
  type PremiumDataTableColumn,
  type PremiumDataTableSortState,
} from '../components/premium/PremiumDataTable'
import { PremiumEmptyState } from '../components/premium/PremiumEmptyState'
import { PremiumImportExportActions } from '../components/premium/PremiumImportExportActions'
import { PremiumMetricCard } from '../components/premium/PremiumMetricCard'
import { PremiumMobileCardList } from '../components/premium/PremiumMobileCardList'
import { getPremiumPageRows } from '../components/premium/PremiumPagination'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'
import { PremiumTableFilter } from '../components/premium/PremiumTableFilter'
import { PremiumTableToolbar } from '../components/premium/PremiumTableToolbar'

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

function itemProfileErrorCode(error: unknown) {
  const candidate = error as { message?: string; details?: string; hint?: string }
  return [candidate?.message, candidate?.details, candidate?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .match(/item_profile_[a-z0-9_]+/)?.[0] || null
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
  const [basicOnlyAcknowledged, setBasicOnlyAcknowledged] = useState(false)
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
  const [itemSort, setItemSort] = useState<PremiumDataTableSortState>({ columnId: 'name', direction: 'asc' })
  const [itemColumnVisibility, setItemColumnVisibility] = useState<PremiumColumnVisibilityState>({
    sku: false,
    readiness: false,
  })
  const [itemPage, setItemPage] = useState(1)
  const [itemPageSize, setItemPageSize] = useState(10)

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
    const families = Array.from(groups.keys()).sort((a, b) => {
      const familyOrder = familySortIndex(a) - familySortIndex(b)
      return familyOrder || familyLabel(a).localeCompare(familyLabel(b))
    })
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
    setItemPage(1)
  }, [roleFilter, search, stockFilter])

  useEffect(() => {
    void loadPage()
  }, [companyId])

  async function loadPage() {
    try {
      setLoading(true)
      const currencyCode = await getBaseCurrencyCode(companyId).catch(() => 'MZN')
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
      (rows ?? [])
        .map((row: any) => ({
          id: String(row.id),
          code: String(row.code ?? '').toUpperCase(),
          name: String(row.name ?? ''),
          family: String(row.family ?? '').trim() || 'unspecified',
        }))
        .filter((row) => isReusableUomCode(row.code))

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
      setBasicOnlyAcknowledged(false)
      setItems(sortByName((extendedRes.data || []).map((row) => normalizeItem(row))))
      return
    }

    const basicRes = await supabase
      .from('items_view')
      .select('id,sku,name,baseUomId,unitPrice,minStock,createdAt,updatedAt')
      .order('name', { ascending: true })
    if (basicRes.error) throw basicRes.error

    setProfileFieldsSupported(false)
    setBasicOnlyAcknowledged(false)
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
    if (!profileFieldsSupported && !basicOnlyAcknowledged) {
      return toast.error(tt('items.profileCompatibility.ackRequired', 'Confirm basic-only compatibility mode before saving. Profile controls are unavailable and will not be inferred.'))
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

      const insert = profileFieldsSupported
        ? await supabase.rpc('create_item_with_profile', {
            p_company_id: companyId,
            p_sku: payload.sku,
            p_name: payload.name,
            p_base_uom_id: payload.base_uom_id,
            p_min_stock: payload.min_stock,
            p_unit_price: payload.unit_price,
            p_primary_role: draftProfile.primaryRole,
            p_track_inventory: draftProfile.trackInventory,
            p_can_buy: draftProfile.canBuy,
            p_can_sell: draftProfile.canSell,
            p_is_assembled: draftProfile.isAssembled,
          })
        : await supabase.from('items').insert(payload).select('id').single()
      if (insert.error) {
        const msg = String(insert.error.message || '')
        const code = String((insert.error as any).code || '')
        if (code === '23505' || /duplicate key|unique/i.test(msg)) {
          return toast.error(tt('items.toast.skuUnique', 'SKU must be unique in this company'))
        }
        throw insert.error
      }

      const insertedRow = Array.isArray(insert.data) ? insert.data[0] : insert.data
      const insertedId = String((insertedRow as any)?.id || '')
      if (!insertedId) throw new Error('item_profile_roundtrip_missing_id')

      if (profileFieldsSupported) {
        const { data: verified, error: verifyError } = await supabase
          .from('items')
          .select('id,primary_role,track_inventory,can_buy,can_sell,is_assembled,unit_price,min_stock')
          .eq('company_id', companyId)
          .eq('id', insertedId)
          .single()
        if (verifyError) throw verifyError

        const roundTripMatches = verified.primary_role === draftProfile.primaryRole
          && Boolean(verified.track_inventory) === draftProfile.trackInventory
          && Boolean(verified.can_buy) === draftProfile.canBuy
          && Boolean(verified.can_sell) === draftProfile.canSell
          && Boolean(verified.is_assembled) === draftProfile.isAssembled
          && Number(verified.min_stock ?? 0) === nextMinStock
          && (draftProfile.canSell
            ? Number(verified.unit_price ?? 0) === Number(nextUnitPrice ?? 0)
            : verified.unit_price == null)
        if (!roundTripMatches) throw new Error('item_profile_roundtrip_mismatch')
      }

      await reloadItems()
      const reloaded = profileFieldsSupported
        ? await supabase.from('items').select('id').eq('company_id', companyId).eq('id', insertedId).maybeSingle()
        : { data: { id: insertedId }, error: null }
      if (reloaded.error || !reloaded.data) throw reloaded.error || new Error('item_profile_roundtrip_reload_failed')

      toast.success(profileFieldsSupported
        ? tt('items.toast.createdVerified', 'Item created and profile verified')
        : tt('items.toast.createdBasicOnly', 'Basic item created in acknowledged compatibility mode'))
      setName('')
      setSku('')
      setBaseUomId('')
      setMinStock('')
      setUnitPrice('')
      setDraftProfile(EMPTY_PROFILE)
      setBasicOnlyAcknowledged(false)
    } catch (error: any) {
      console.error(error)
      toast.error(itemProfileErrorCode(error)
        ? tt('items.toast.profileCreateRejected', 'The item profile could not be saved. Review the fields and try again.')
        : (error?.message || tt('items.toast.createFailed', 'Failed to create item')))
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

  function itemStockPresentation(item: ItemRow): { label: string; tone: PremiumTone; rank: number } {
    if (!item.trackInventory) {
      return { label: tt('items.preview.nonStock', 'Non-stock'), tone: 'neutral', rank: 3 }
    }
    const onHand = Number(item.onHandQty ?? 0)
    const min = Number(item.minStock ?? 0)
    if (onHand <= 0) {
      return { label: tt('stock.status.out', 'Out of stock'), tone: 'critical', rank: 0 }
    }
    if (min > 0 && onHand < min) {
      return { label: tt('stock.status.low', 'Low stock'), tone: 'warning', rank: 1 }
    }
    return { label: tt('stock.status.healthy', 'Healthy'), tone: 'positive', rank: 2 }
  }

  function uomLabel(item: ItemRow) {
    const baseUom = uomById.get(item.baseUomId)
    return baseUom ? `${baseUom.code} - ${baseUom.name}` : item.baseUomId
  }

  function itemRoleBadges(item: ItemRow) {
    return (
      <div className="flex flex-wrap gap-2">
        <PremiumStatusBadge tone="info">{roleLabel(item.primaryRole)}</PremiumStatusBadge>
        <PremiumStatusBadge tone={item.trackInventory ? 'neutral' : 'warning'}>
          {item.trackInventory ? tt('items.preview.stocked', 'Stocked') : tt('items.preview.nonStock', 'Non-stock')}
        </PremiumStatusBadge>
        {item.canBuy ? <PremiumStatusBadge tone="neutral">{tt('items.preview.bought', 'Bought')}</PremiumStatusBadge> : null}
        {item.canSell ? <PremiumStatusBadge tone="positive">{tt('items.preview.sold', 'Sold')}</PremiumStatusBadge> : null}
        {item.isAssembled ? <PremiumStatusBadge tone="info">{tt('items.preview.assembled', 'Assembled')}</PremiumStatusBadge> : null}
        {item.usedAsComponent ? <PremiumStatusBadge tone="neutral">{tt('items.table.component', 'Component')}</PremiumStatusBadge> : null}
        {item.hasActiveBom ? <PremiumStatusBadge tone="neutral">{tt('items.table.activeBom', 'Active BOM')}</PremiumStatusBadge> : null}
      </div>
    )
  }

  function itemReadiness(item: ItemRow) {
    const warnings = deriveItemProfileWarnings(item)
    if (!warnings.length) {
      return <PremiumStatusBadge tone="positive">{tt('items.ready', 'Ready')}</PremiumStatusBadge>
    }
    return (
      <div className="flex flex-wrap gap-2">
        {warnings.map((warning) => (
          <PremiumStatusBadge
            key={warning}
            tone={warningVariant(warning) === 'destructive' ? 'critical' : 'warning'}
            className="whitespace-normal"
          >
            {warningLabel(warning)}
          </PremiumStatusBadge>
        ))}
      </div>
    )
  }

  const paginationLabels = {
    rowsPerPage: tt('register.rowsPerPage', 'Rows'),
    previous: tt('register.previous', 'Previous'),
    next: tt('register.next', 'Next'),
    pageSummary: (page: number, total: number) =>
      tt('register.pageSummary', 'Page {page} of {total}', { page, total }),
    rangeSummary: (from: number, to: number, total: number) =>
      tt('register.rangeSummary', '{from}-{to} of {total}', { from, to, total }),
  }

  const itemTableColumns: PremiumDataTableColumn<ItemRow>[] = [
    {
      id: 'sku',
      header: tt('items.fields.sku', 'SKU'),
      cell: (item) => <span className="font-mono text-xs font-medium tabular-nums">{item.sku}</span>,
      sortValue: (item) => item.sku,
      minWidth: 120,
    },
    {
      id: 'name',
      header: tt('table.item', 'Item'),
      cell: (item) => (
        <div className="min-w-0 space-y-1.5">
          <div className="font-medium">{item.name}</div>
          <div className="text-xs text-muted-foreground">{item.sku}</div>
        </div>
      ),
      sortValue: (item) => item.name,
      minWidth: 220,
      enableHiding: false,
    },
    {
      id: 'role',
      header: tt('items.table.role', 'Role'),
      cell: (item) => itemRoleBadges(item),
      sortValue: (item) => roleLabel(item.primaryRole),
      minWidth: 230,
    },
    {
      id: 'uom',
      header: tt('items.table.baseUom', 'Base UoM'),
      cell: (item) => <span className="text-sm text-muted-foreground">{uomLabel(item)}</span>,
      sortValue: (item) => uomLabel(item),
      minWidth: 180,
    },
    {
      id: 'unitPrice',
      header: tt('items.table.unitPrice', 'Default sell price'),
      cell: (item) => (item.canSell ? formatMoney(item.unitPrice ?? 0, baseCurrencyCode) : tt('common.dash', '-')),
      sortValue: (item) => (item.canSell ? Number(item.unitPrice ?? 0) : -1),
      align: 'right',
      minWidth: 150,
    },
    {
      id: 'stock',
      header: tt('items.table.stockStatus', 'Stock status'),
      cell: (item) => {
        const stock = itemStockPresentation(item)
        return (
          <div className="flex flex-col items-end gap-2">
            <PremiumStatusBadge tone={stock.tone}>{stock.label}</PremiumStatusBadge>
            <div className="text-xs text-muted-foreground">
              {tt('items.table.stockLine', '{onHand} on hand / {minStock} min', {
                onHand: formatQty(item.onHandQty),
                minStock: formatStockThreshold(item.minStock),
              })}
            </div>
          </div>
        )
      },
      sortValue: (item) => itemStockPresentation(item).rank,
      align: 'right',
      minWidth: 190,
    },
    {
      id: 'readiness',
      header: tt('items.table.readiness', 'Readiness'),
      cell: (item) => itemReadiness(item),
      sortValue: (item) => deriveItemProfileWarnings(item).length,
      minWidth: 220,
    },
    {
      id: 'actions',
      header: tt('common.actions', 'Actions'),
      cell: (item) => (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => openEditItem(item)} disabled={!can.updateItem(role)}>
            <Pencil className="h-4 w-4" />
            {tt('items.actions.minStock', 'Edit minimum')}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => handleDelete(item.id)} disabled={!can.deleteItem(role)}>
            <Trash2 className="h-4 w-4" />
            {tt('common.delete', 'Delete')}
          </Button>
        </div>
      ),
      align: 'right',
      minWidth: 210,
      enableHiding: false,
    },
  ]

  const sortedItems = sortPremiumRows(filteredItems, itemTableColumns, itemSort)
  const pagedItems = getPremiumPageRows(sortedItems, itemPage, itemPageSize)

  const itemImportExportActions = (
    <PremiumImportExportActions
      importAction={
        <Button variant="outline" asChild>
          <Link to="/setup/import">
            <Upload className="h-4 w-4" />
            {tt('register.import', 'Import')}
          </Link>
        </Button>
      }
      exportAction={
        <Button
          variant="outline"
          disabled
          title={tt('items.exportUnavailable', 'Item master export is not enabled on this register yet.')}
        >
          <Download className="h-4 w-4" />
          {tt('register.export', 'Export')}
        </Button>
      }
    />
  )

  if (loading) return <div className="app-page app-page--workspace p-6">{tt('loading', 'Loading...')}</div>

  return (
    <div className="app-page app-page--workspace">
      <PremiumRegisterHeader
        eyebrow={tt('items.eyebrow', 'Master data clarity')}
        title={tt('items.title', 'Items')}
        description={tt(
          'items.subtitle',
          'Set up each item once with a clear operational role. Stock, purchasing, selling, and assembly should be obvious before anyone uses the item in orders, builds, or finance documents.',
        )}
        badges={
          <>
            <PremiumStatusBadge tone="info" icon={<Tags />}>{tt('items.registerTitle', 'Item register')}</PremiumStatusBadge>
            <PremiumStatusBadge tone="neutral">{baseCurrencyCode}</PremiumStatusBadge>
          </>
        }
        actions={
          <>
            <Button asChild>
              <a href="#item-create">
                <Plus className="h-4 w-4" />
                {tt('items.actions.create', 'Create item')}
              </a>
            </Button>
            {itemImportExportActions}
          </>
        }
        metrics={
          <>
            <PremiumMetricCard
              label={tt('items.summary.total', 'Total items')}
              value={summary.total}
              description={tt('items.summary.totalHelp', 'All item masters in the active company.')}
              icon={<Package />}
            />
            <PremiumMetricCard
              label={tt('items.summary.stocked', 'Stock-tracked')}
              value={summary.stocked}
              description={tt('items.summary.stockedHelp', 'Items that participate in inventory balances and minimum-stock alerts.')}
              icon={<Warehouse />}
              tone="positive"
            />
            <PremiumMetricCard
              label={tt('items.summary.assembled', 'Assembly-related')}
              value={summary.assembled}
              description={tt('items.summary.assembledHelp', 'Items that are assembled themselves or consumed inside BOMs.')}
              icon={<PackageCheck />}
              tone="info"
            />
            <PremiumMetricCard
              label={tt('items.summary.attention', 'Needs attention')}
              value={summary.warnings}
              description={tt('items.summary.attentionHelp', 'Profile mismatches that can confuse stock or assembly workflows.')}
              icon={<AlertTriangle />}
              tone={summary.warnings > 0 ? 'warning' : 'positive'}
            />
          </>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.06fr)_minmax(20rem,0.94fr)] 2xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,0.9fr)]">
        <Card id="item-create" className="border-border/70 bg-card shadow-sm">
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
            {!profileFieldsSupported && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
                  <div className="space-y-3">
                    <div>
                      <div className="font-medium">{tt('items.profileCompatibility.title', 'Item profile fields are unavailable')}</div>
                      <p className="mt-1 text-muted-foreground">{tt('items.profileCompatibility.help', 'Role and inventory controls are disabled so selections cannot be silently discarded. You may create only the basic item fields after explicit acknowledgement.')}</p>
                    </div>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input type="checkbox" className="mt-1 h-4 w-4" checked={basicOnlyAcknowledged} onChange={(event) => setBasicOnlyAcknowledged(event.target.checked)} />
                      <span>{tt('items.profileCompatibility.ack', 'I understand this save contains only basic fields and no custom profile selections.')}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
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
                    disabled={!profileFieldsSupported}
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
                          disabled={!profileFieldsSupported}
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
                          disabled={!profileFieldsSupported}
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
                          disabled={!profileFieldsSupported}
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
                          disabled={!profileFieldsSupported}
                        />
                      </div>
                    </div>
                  </div>

                  {profileFieldsSupported ? <div className="space-y-4 rounded-2xl border border-border/60 bg-background/80 p-4">
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
                  </div> : (
                    <div className="rounded-2xl border border-dashed border-amber-500/50 bg-background/80 p-4 text-sm text-muted-foreground">
                      {tt('items.profileCompatibility.previewHidden', 'Profile preview is hidden in compatibility mode because no profile selection will be persisted.')}
                    </div>
                  )}
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
                <Button type="submit" disabled={saving || (!profileFieldsSupported && !basicOnlyAcknowledged)}>
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

      <section id="item-register" className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-[1.05rem] font-semibold leading-7 tracking-tight">{tt('items.registerTitle', 'Item register')}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              {tt('items.registerHelp', 'Review stock behavior, commercial role, and assembly participation before the item reaches orders, production, or costing.')}
            </p>
          </div>
        </div>

        <PremiumTableToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={tt('items.searchPlaceholder', 'Search by name or SKU')}
          searchLabel={tt('common.search', 'Search')}
          filters={
            <>
              <PremiumTableFilter label={tt('items.filters.role', 'All roles')}>
                <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as 'all' | ItemPrimaryRole)}>
                  <SelectTrigger><SelectValue placeholder={tt('items.filters.role', 'All roles')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tt('items.filters.roleAll', 'All roles')}</SelectItem>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.role} value={option.role}>{option.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PremiumTableFilter>
              <PremiumTableFilter label={tt('items.filters.scope', 'All scopes')}>
                <Select value={stockFilter} onValueChange={(value) => setStockFilter(value as typeof stockFilter)}>
                  <SelectTrigger><SelectValue placeholder={tt('items.filters.scope', 'All scopes')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{tt('items.filters.scopeAll', 'All scopes')}</SelectItem>
                    <SelectItem value="stocked">{tt('items.filters.scopeStocked', 'Stocked only')}</SelectItem>
                    <SelectItem value="assembly">{tt('items.filters.scopeAssembly', 'Assembly-related')}</SelectItem>
                    <SelectItem value="service">{tt('items.filters.scopeService', 'Services')}</SelectItem>
                  </SelectContent>
                </Select>
              </PremiumTableFilter>
            </>
          }
          actions={
            <>
              <PremiumColumnVisibilityMenu
                columns={itemTableColumns}
                visibility={itemColumnVisibility}
                onVisibilityChange={setItemColumnVisibility}
                label={tt('register.columns', 'Columns')}
                menuLabel={tt('register.visibleColumns', 'Visible columns')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setRoleFilter('all')
                  setStockFilter('all')
                }}
              >
                <Settings2 className="h-4 w-4" />
                {tt('common.clear', 'Clear')}
              </Button>
            </>
          }
          summary={tt('items.registerCount', '{count} of {total} items in view', {
            count: filteredItems.length,
            total: items.length,
          })}
        />

        <div className="rounded-[calc(var(--radius)+0.25rem)] border border-card-border bg-card p-3 shadow-[0_20px_48px_-36px_hsl(var(--foreground)/0.24)] sm:p-4">
          {isMobile ? (
            <PremiumMobileCardList
              rows={pagedItems}
              getRowId={(item) => item.id}
              pagination={{
                page: itemPage,
                pageSize: itemPageSize,
                totalItems: sortedItems.length,
                onPageChange: setItemPage,
                onPageSizeChange: (nextPageSize) => {
                  setItemPageSize(nextPageSize)
                  setItemPage(1)
                },
                labels: paginationLabels,
              }}
              emptyState={
                <PremiumEmptyState
                  icon={<Package />}
                  title={tt('items.emptyTitle', 'No items match this view')}
                  description={
                    items.length === 0
                      ? tt('items.emptyBody', 'Start with a resale item, raw material, or assembled product so the rest of the workflow has a clean master-data base.')
                      : tt('items.emptyFiltered', 'Clear the filters or search term to see more items.')
                  }
                  action={
                    items.length === 0 ? (
                      <Button asChild>
                        <a href="#item-create">{tt('items.actions.create', 'Create item')}</a>
                      </Button>
                    ) : null
                  }
                />
              }
              renderCard={(item) => {
                const stock = itemStockPresentation(item)
                return (
                  <article className="rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-surface-elevated p-4 shadow-[0_16px_34px_-30px_hsl(var(--foreground)/0.34)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.name}</div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">{item.sku}</div>
                      </div>
                      <PremiumStatusBadge tone={stock.tone}>{stock.label}</PremiumStatusBadge>
                    </div>

                    <div className="mt-3">{itemRoleBadges(item)}</div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-card-border bg-surface-muted/35 p-3">
                        <div className="premium-label">{tt('items.table.baseUom', 'Base UoM')}</div>
                        <div className="mt-1 text-sm font-medium">{uomLabel(item)}</div>
                      </div>
                      <div className="rounded-xl border border-card-border bg-surface-muted/35 p-3">
                        <div className="premium-label">{tt('items.table.unitPrice', 'Default sell price')}</div>
                        <div className="mt-1 text-sm font-medium">
                          {item.canSell ? formatMoney(item.unitPrice ?? 0, baseCurrencyCode) : tt('common.dash', '-')}
                        </div>
                      </div>
                      <div className="rounded-xl border border-card-border bg-surface-muted/35 p-3">
                        <div className="premium-label">{tt('items.table.onHand', 'On hand')}</div>
                        <div className="mt-1 text-sm font-medium">{formatQty(item.onHandQty)}</div>
                      </div>
                      <div className="rounded-xl border border-card-border bg-surface-muted/35 p-3">
                        <div className="premium-label">{tt('items.fields.minStock', 'Minimum stock')}</div>
                        <div className="mt-1 text-sm font-medium">{formatStockThreshold(item.minStock)}</div>
                      </div>
                    </div>

                    <div className="mt-4">{itemReadiness(item)}</div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/stock-levels">
                          <ExternalLink className="h-4 w-4" />
                          {tt('items.actions.stockLookup', 'View stock')}
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/movements">
                          <ExternalLink className="h-4 w-4" />
                          {tt('items.actions.movement', 'Movement')}
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEditItem(item)} disabled={!can.updateItem(role)}>
                        <Pencil className="h-4 w-4" />
                        {tt('items.actions.minStock', 'Edit minimum')}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(item.id)} disabled={!can.deleteItem(role)}>
                        <Trash2 className="h-4 w-4" />
                        {tt('common.delete', 'Delete')}
                      </Button>
                    </div>
                  </article>
                )
              }}
            />
          ) : (
            <PremiumDataTable
              rows={filteredItems}
              columns={itemTableColumns}
              getRowId={(item) => item.id}
              sort={itemSort}
              onSortChange={setItemSort}
              columnVisibility={itemColumnVisibility}
              ariaLabel={tt('items.registerTitle', 'Item register')}
              emptyState={
                <PremiumEmptyState
                  icon={<Package />}
                  title={tt('items.emptyTitle', 'No items match this view')}
                  description={
                    items.length === 0
                      ? tt('items.emptyBody', 'Start with a resale item, raw material, or assembled product so the rest of the workflow has a clean master-data base.')
                      : tt('items.emptyFiltered', 'Clear the filters or search term to see more items.')
                  }
                />
              }
              pagination={{
                page: itemPage,
                pageSize: itemPageSize,
                onPageChange: setItemPage,
                onPageSizeChange: (nextPageSize) => {
                  setItemPageSize(nextPageSize)
                  setItemPage(1)
                },
                labels: paginationLabels,
              }}
            />
          )}
        </div>
      </section>

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

