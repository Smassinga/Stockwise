// src/pages/Items.tsx
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'
import { useI18n, withI18nFallback } from '../lib/i18n'

import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
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
import { useIsMobile } from '../hooks/use-mobile'

type Uom = {
  id: string
  code: string
  name: string
  family: string
}

type Item = {
  id: string
  sku: string
  name: string
  baseUomId: string
  minStock: number | null
  createdAt: string | null
  updatedAt: string | null
}

function sortByName<T extends { name?: string }>(arr: T[]) {
  return [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

function formatStockThreshold(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
}

const Items: React.FC = () => {
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { myRole, companyId } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'
  const isMobile = useIsMobile()

  const [loading, setLoading] = useState(true)
  const [uoms, setUoms] = useState<Uom[]>([])
  const [items, setItems] = useState<Item[]>([])

  // form
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [baseUomId, setBaseUomId] = useState('')
  const [minStock, setMinStock] = useState<string>('')
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editMinStock, setEditMinStock] = useState('0')
  const [savingEdit, setSavingEdit] = useState(false)

  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const editingItem = useMemo(
    () => items.find((item) => item.id === editingItemId) ?? null,
    [editingItemId, items],
  )

  // ------- Family helpers -------
  const familyLabel = (fam?: string) => {
    const key = String(fam || 'unspecified').toLowerCase()
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
    return map[key] || (fam ? fam : tt('items.family.unspecified', 'Unspecified'))
  }

  const groupedUoms = useMemo(() => {
    const groups = new Map<string, Uom[]>()
    for (const u of uoms) {
      const fam = (u.family && u.family.trim()) ? u.family : 'unspecified'
      if (!groups.has(fam)) groups.set(fam, [])
      groups.get(fam)!.push(u)
    }
    for (const arr of groups.values()) arr.sort((a, b) => (a.code || '').localeCompare(b.code || ''))
    const families = Array.from(groups.keys()).sort((a, b) => familyLabel(a).localeCompare(familyLabel(b)))
    return { groups, families }
  }, [uoms])

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        // ---- UOMs
        const normalize = (rows: any[]): Uom[] =>
          (rows ?? []).map((r: any) => ({
            id: String(r.id),
            code: String(r.code ?? '').toUpperCase(),
            name: String(r.name ?? ''),
            family: String(r.family ?? '').trim() || 'unspecified',
          }))

        const safeSelect = async (table: 'uoms' | 'uom', fields: string) => {
          const res: any = await supabase.from(table).select(fields).order('code', { ascending: true })
          return res
        }

        let uomRows: any[] = []

        // Prefer 'uoms' with family; fallback variants preserved
        let res = await safeSelect('uoms', 'id, code, name, family')
        if (res?.data?.length) {
          uomRows = res.data
        } else if (res?.error && res.error.status === 400) {
          const resNoFam = await safeSelect('uoms', 'id, code, name')
          if (resNoFam?.data?.length) {
            uomRows = resNoFam.data.map((r: any) => ({ ...r, family: 'unspecified' }))
          }
        }

        if (!uomRows.length) {
          res = await safeSelect('uom', 'id, code, name, family')
          if (res?.data?.length) {
            uomRows = res.data
          } else if (res?.error && res.error.status === 400) {
            const resNoFam = await safeSelect('uom', 'id, code, name')
            if (resNoFam?.data?.length) {
              uomRows = resNoFam.data.map((r: any) => ({ ...r, family: 'unspecified' }))
            }
          }
        }

        setUoms(normalize(uomRows || []))

        // ---- Items via view (already scoped by RLS and/or view)
        const itemsRes = await supabase
          .from('items_view')
          .select('id,sku,name,baseUomId,minStock,createdAt,updatedAt')
          .order('name', { ascending: true })
        if (itemsRes.error) throw itemsRes.error
        setItems(sortByName(itemsRes.data || []))
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || tt('items.toast.loadFailed', 'Failed to load items'))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function reloadItems() {
    const res = await supabase
      .from('items_view')
      .select('id,sku,name,baseUomId,minStock,createdAt,updatedAt')
      .order('name', { ascending: true })
    if (res.error) return toast.error(res.error.message)
    setItems(sortByName(res.data || []))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!can.createItem(role)) return toast.error(tt('items.toast.createPermission', 'Only Operator and above can create items'))
    if (!companyId) return toast.error(tt('items.toast.noCompany', 'No active company'))
    if (!name.trim() || !sku.trim() || !baseUomId) return toast.error(tt('items.toast.required', 'Name, SKU, and base unit are required'))

    const minStockNum = minStock ? Number(minStock) : 0
    if (Number.isNaN(minStockNum) || minStockNum < 0) return toast.error(tt('items.toast.minStockInvalid', 'Minimum stock must be zero or greater'))

    try {
      // Case-insensitive duplicate check scoped to THIS company
      const dup = await supabase
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .ilike('sku', sku.trim())
      if (dup.error) throw dup.error
      if ((dup.count ?? 0) > 0) return toast.error(tt('items.toast.skuUnique', 'SKU must be unique in this company'))

      const payload: any = {
        company_id: companyId,          // explicit scope
        name: name.trim(),
        sku: sku.trim(),
        base_uom_id: baseUomId,
        min_stock: minStockNum,
      }

      const ins = await supabase.from('items').insert(payload).select('id').single()

      // If the pre-check raced another insert, catch the unique violation here too
      if (ins.error) {
        const msg = String(ins.error.message || '')
        const code = String((ins.error as any).code || '')
        if (code === '23505' || /duplicate key|unique/i.test(msg)) {
          return toast.error(tt('items.toast.skuUnique', 'SKU must be unique in this company'))
        }
        throw ins.error
      }

      toast.success(tt('items.toast.created', 'Item created'))
      setName(''); setSku(''); setBaseUomId(''); setMinStock('')
      await reloadItems()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('items.toast.createFailed', 'Failed to create item'))
    }
  }

  async function handleDelete(itemId: string) {
    if (!can.deleteItem(role)) return toast.error(tt('items.toast.deletePermission', 'Only Manager and above can delete items'))
    try {
      const del = await supabase.from('items').delete().eq('id', itemId)
      if (del.error) throw del.error
      toast.success(tt('items.toast.deleted', 'Item deleted'))
      await reloadItems()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('items.toast.deleteFailed', 'Failed to delete item'))
    }
  }

  function openEditItem(item: Item) {
    setEditingItemId(item.id)
    setEditMinStock(typeof item.minStock === 'number' ? String(item.minStock) : '0')
  }

  function closeEditItem(force = false) {
    if (savingEdit && !force) return
    setEditingItemId(null)
    setEditMinStock('0')
  }

  async function handleSaveMinStock(e: React.FormEvent) {
    e.preventDefault()
    if (!editingItem) return
    if (!can.updateItem(role)) return toast.error(tt('items.toast.updatePermission', 'Only Operator and above can update minimum stock'))
    if (!companyId) return toast.error(tt('items.toast.noCompany', 'No active company'))

    const rawValue = editMinStock.trim()
    if (!rawValue) return toast.error(tt('items.toast.minStockRequired', 'Minimum stock is required'))

    const nextMinStock = Number(rawValue)
    if (!Number.isFinite(nextMinStock) || nextMinStock < 0) {
      return toast.error(tt('items.toast.minStockInvalid', 'Minimum stock must be zero or greater'))
    }

    const previousItems = items
    setSavingEdit(true)
    setItems((current) =>
      current.map((item) =>
        item.id === editingItem.id ? { ...item, minStock: nextMinStock } : item,
      ),
    )

    try {
      const update = await supabase
        .from('items')
        .update({ min_stock: nextMinStock })
        .eq('id', editingItem.id)
        .eq('company_id', companyId)

      if (update.error) throw update.error

      toast.success(tt('items.toast.updated', 'Minimum stock updated'))
      closeEditItem(true)
      await reloadItems()
    } catch (e: any) {
      setItems(previousItems)
      console.error(e)
      toast.error(e?.message || tt('items.toast.updateFailed', 'Failed to update minimum stock'))
    } finally {
      setSavingEdit(false)
    }
  }

  if (loading) return <div className="p-6">{tt('loading', 'Loading...')}</div>

  const uomLabel = (u: Uom) => `${u.code} - ${u.name}`
  const itemsCountLabel = tt(
    items.length === 1 ? 'items.summary.items.one' : 'items.summary.items.other',
    items.length === 1 ? '1 item tracked' : '{count} items tracked',
    { count: items.length },
  )
  const uomsCountLabel = tt(
    uoms.length === 1 ? 'items.summary.uoms.one' : 'items.summary.uoms.other',
    uoms.length === 1 ? '1 unit available' : '{count} units available',
    { count: uoms.length },
  )
  const baseSetupReady = uoms.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('items.eyebrow', 'Inventory foundation')}
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('items.title')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {tt(
                'items.subtitle',
                'Define the products your business buys, stores, sells, and counts. Each item starts with a base unit of measure and minimum stock rule that drives stock movements, orders, and replenishment visibility.'
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1.5">{itemsCountLabel}</span>
          <span className="rounded-full border border-border/70 bg-muted/20 px-3 py-1.5">{uomsCountLabel}</span>
        </div>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl">{tt('items.create.title', 'New item')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt(
              'items.create.help',
              'Create the stock master record once, then use it in purchasing, sales orders, stock movements, and valuation.'
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!baseSetupReady && (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/15 p-4">
              <div className="text-sm font-medium">{tt('items.unitsRequired.title', 'Set up units before creating items')}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {tt(
                  'items.unitsRequired.body',
                  'Every stock item needs a base unit of measure. Create or review your units first so stock quantities, costing, and reorder rules stay consistent.'
                )}
              </p>
              <Button asChild variant="outline" className="mt-3">
                <Link to="/uom">{tt('items.unitsRequired.cta', 'Manage units')}</Link>
              </Button>
            </div>
          )}

          <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">{t('items.fields.name')} *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('items.placeholder.name')}
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sku">{t('items.fields.sku')} *</Label>
              <Input
                id="sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder={t('items.placeholder.sku')}
                className="min-h-[44px]"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>{t('items.fields.baseUom')} *</Label>
              <Select value={baseUomId} onValueChange={setBaseUomId}>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder={t('items.placeholder.selectUnit')} />
                </SelectTrigger>
                <SelectContent className="max-h-72 overflow-auto">
                  {groupedUoms.families.length === 0 && (
                    <SelectItem value="__none__" disabled>{tt('common.none', 'None')}</SelectItem>
                  )}
                  {groupedUoms.families.map(fam => {
                    const list = groupedUoms.groups.get(fam) || []
                    return (
                      <div key={fam}>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground sticky top-0 bg-popover">
                          {familyLabel(fam)}
                        </div>
                        {list.map(u => (
                          <SelectItem key={u.id} value={u.id}>
                            {uomLabel(u)}
                          </SelectItem>
                        ))}
                        <div className="h-1" />
                      </div>
                    )
                  })}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground">
                {tt(
                  'items.fields.baseUom.help',
                  'This is the stock unit used for movements, on-hand quantity, valuation, and reorder thresholds.'
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minStock">{t('items.fields.minStock')}</Label>
              <Input
                id="minStock"
                type="number"
                step="1"
                min="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="0"
                className="min-h-[44px]"
              />
              <div className="text-xs text-muted-foreground">
                {tt(
                  'items.fields.minStock.help',
                  'Use the minimum stock level to highlight replenishment risk on dashboards and stock views.'
                )}
              </div>
            </div>

            <div className="flex items-end md:col-span-2">
              <Button
                type="submit"
                disabled={!can.createItem(role) || !baseSetupReady}
                className="w-full sm:w-auto min-h-[44px]"
              >
                {t('items.actions.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg sm:text-xl">{tt('items.list.title', 'Tracked items')}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {tt(
              'items.list.help',
              'Items listed here become available to warehouse operations, pricing, purchasing, and sales workflows.'
            )}
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {/* Mobile view - stacked cards */}
          {isMobile ? (
            <div className="space-y-4">
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-center">
                  <div className="text-sm font-medium">{tt('items.empty.title', 'No items yet')}</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tt(
                      'items.empty.body',
                      'Create your first stock item to start receiving inventory, issuing stock, and valuing on-hand quantity.'
                    )}
                  </p>
                </div>
              ) : (
                items.map(it => {
                  const u = uomById.get(it.baseUomId)
                  return (
                    <div key={it.id} className="border rounded-lg p-4 space-y-3">
                      <div>
                        <h3 className="font-medium">{it.name}</h3>
                        <p className="text-sm text-muted-foreground">{it.sku}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-muted-foreground">{t('items.table.baseUom')}</p>
                          <p>{u ? uomLabel(u) : it.baseUomId}</p>
                          <p className="text-xs text-muted-foreground">{u ? familyLabel(u.family) : tt('items.family.unspecified', 'Unspecified')}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">{t('items.fields.minStock')}</p>
                          <p>{formatStockThreshold(it.minStock)}</p>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                          variant="outline"
                          disabled={!can.updateItem(role)}
                          onClick={() =>
                            can.updateItem(role)
                              ? openEditItem(it)
                              : toast.error(tt('items.toast.updatePermission', 'Only Operator and above can update minimum stock'))
                          }
                          className="min-h-[44px]"
                        >
                          {tt('items.actions.edit', 'Edit minimum stock')}
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!can.deleteItem(role)}
                          onClick={() =>
                            can.deleteItem(role)
                              ? handleDelete(it.id)
                              : toast.error(tt('items.toast.deletePermission', 'Only Manager and above can delete items'))
                          }
                          className="min-h-[44px]"
                        >
                          {t('common.remove')}
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ) : (
            // Desktop view - table
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">{t('items.fields.name')}</th>
                  <th className="py-2 pr-2">{t('items.fields.sku')}</th>
                  <th className="py-2 pr-2">{t('items.table.baseUom')}</th>
                  <th className="py-2 pr-2">{tt('items.table.family', 'Unit family')}</th>
                  <th className="py-2 pr-2">{t('items.fields.minStock')}</th>
                  <th className="py-2 pr-2">{t('items.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center">
                      <div className="text-sm font-medium">{tt('items.empty.title', 'No items yet')}</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {tt(
                          'items.empty.body',
                          'Create your first stock item to start receiving inventory, issuing stock, and valuing on-hand quantity.'
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {items.map(it => {
                  const u = uomById.get(it.baseUomId)
                  return (
                    <tr key={it.id} className="border-b">
                      <td className="py-2 pr-2">{it.name}</td>
                      <td className="py-2 pr-2">{it.sku}</td>
                      <td className="py-2 pr-2">{u ? uomLabel(u) : it.baseUomId}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{u ? familyLabel(u.family) : tt('items.family.unspecified', 'Unspecified')}</td>
                      <td className="py-2 pr-2">{formatStockThreshold(it.minStock)}</td>
                      <td className="py-2 pr-2">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            disabled={!can.updateItem(role)}
                            onClick={() =>
                              can.updateItem(role)
                                ? openEditItem(it)
                                : toast.error(tt('items.toast.updatePermission', 'Only Operator and above can update minimum stock'))
                            }
                          >
                            {tt('items.actions.edit', 'Edit minimum stock')}
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={!can.deleteItem(role)}
                            onClick={() =>
                              can.deleteItem(role)
                                ? handleDelete(it.id)
                                : toast.error(tt('items.toast.deletePermission', 'Only Manager and above can delete items'))
                            }
                          >
                            {t('common.remove')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => { if (!open) closeEditItem() }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tt('items.edit.title', 'Update minimum stock')}</DialogTitle>
            <DialogDescription>
              {tt(
                'items.edit.help',
                'Only the minimum stock threshold can be edited after item creation. Core item fields stay read-only to preserve stock history and audit consistency.',
              )}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <form id="edit-min-stock-form" onSubmit={handleSaveMinStock} className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/15 p-4 text-sm text-muted-foreground">
                {tt(
                  'items.edit.auditNotice',
                  'Item name, code, and measurement fields are locked after creation. Update the reorder threshold here when your replenishment policy changes.',
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('items.fields.name')}</Label>
                  <Input value={editingItem?.name || ''} readOnly className="bg-muted/20" />
                </div>
                <div className="space-y-2">
                  <Label>{t('items.fields.sku')}</Label>
                  <Input value={editingItem?.sku || ''} readOnly className="bg-muted/20" />
                </div>
                <div className="space-y-2">
                  <Label>{t('items.table.baseUom')}</Label>
                  <Input
                    value={
                      editingItem
                        ? (uomById.get(editingItem.baseUomId)
                            ? uomLabel(uomById.get(editingItem.baseUomId)!)
                            : editingItem.baseUomId)
                        : ''
                    }
                    readOnly
                    className="bg-muted/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{tt('items.table.family', 'Unit family')}</Label>
                  <Input
                    value={
                      editingItem
                        ? familyLabel(uomById.get(editingItem.baseUomId)?.family)
                        : ''
                    }
                    readOnly
                    className="bg-muted/20"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="editMinStock">{t('items.fields.minStock')}</Label>
                <Input
                  id="editMinStock"
                  type="number"
                  step="0.0001"
                  min="0"
                  inputMode="decimal"
                  value={editMinStock}
                  onChange={(event) => setEditMinStock(event.target.value)}
                  placeholder="0"
                  className="min-h-[44px]"
                />
                <p className="text-xs text-muted-foreground">
                  {tt(
                    'items.edit.minStockHelp',
                    'Use this threshold to drive replenishment visibility without changing the original item master data.',
                  )}
                </p>
              </div>
            </form>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditItem} disabled={savingEdit}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="edit-min-stock-form" disabled={savingEdit || !can.updateItem(role)}>
              {savingEdit ? tt('common.saving', 'Saving...') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default Items
