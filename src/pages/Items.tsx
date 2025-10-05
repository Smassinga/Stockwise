// src/pages/Items.tsx
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'

import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

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

const Items: React.FC = () => {
  const { myRole, companyId } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'

  const [loading, setLoading] = useState(true)
  const [uoms, setUoms] = useState<Uom[]>([])
  const [items, setItems] = useState<Item[]>([])

  // form
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [baseUomId, setBaseUomId] = useState('')
  const [minStock, setMinStock] = useState<string>('')

  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])

  // ------- Family helpers -------
  const familyLabel = (fam?: string) => {
    const key = String(fam || 'unspecified').toLowerCase()
    const map: Record<string, string> = {
      mass: 'Mass',
      volume: 'Volume',
      length: 'Length',
      area: 'Area',
      count: 'Count',
      time: 'Time',
      other: 'Other',
      unspecified: 'Unspecified',
    }
    return map[key] || (fam ? fam : 'Unspecified')
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
        toast.error(e?.message || 'Failed to load Items')
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
    if (!can.createItem(role)) return toast.error('Only OPERATOR+ can create items')
    if (!companyId) return toast.error('No active company')
    if (!name.trim() || !sku.trim() || !baseUomId) return toast.error('Name, SKU and Base UoM are required')

    const minStockNum = minStock ? Number(minStock) : 0
    if (Number.isNaN(minStockNum) || minStockNum < 0) return toast.error('Min Stock must be a non-negative number')

    try {
      // Duplicate check scoped to THIS company
      const dup = await supabase
        .from('items')
        .select('id')
        .eq('company_id', companyId)
        .eq('sku', sku.trim())
        .limit(1)
      if (dup.error) throw dup.error
      if (dup.data && dup.data.length) return toast.error('SKU must be unique in this company')

      const payload: any = {
        company_id: companyId,          // keep it explicitly scoped
        name: name.trim(),
        sku: sku.trim(),
        base_uom_id: baseUomId,
        min_stock: minStockNum,
      }
      const ins = await supabase.from('items').insert(payload).select('id').single()
      if (ins.error) throw ins.error

      toast.success('Item created')
      setName(''); setSku(''); setBaseUomId(''); setMinStock('')
      await reloadItems()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to create item')
    }
  }

  async function handleDelete(itemId: string) {
    if (!can.deleteItem(role)) return toast.error('Only MANAGER+ can delete items')
    try {
      const del = await supabase.from('items').delete().eq('id', itemId)
      if (del.error) throw del.error
      toast.success('Item deleted')
      await reloadItems()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to delete item')
    }
  }

  if (loading) return <div className="p-6">Loading…</div>

  const uomLabel = (u: Uom) => `${u.code} — ${u.name}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Items</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Create Item</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Maize 50kg bag" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sku">SKU *</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g., MZ-50KG" />
            </div>

            <div className="space-y-2">
              <Label>Base UoM *</Label>
              <Select value={baseUomId} onValueChange={setBaseUomId}>
                <SelectTrigger><SelectValue placeholder="Select a unit" /></SelectTrigger>
                <SelectContent className="max-h-72 overflow-auto">
                  {groupedUoms.families.length === 0 && (
                    <SelectItem value="__none__" disabled>No UoMs available</SelectItem>
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="minStock">Min Stock</Label>
              <Input
                id="minStock"
                type="number"
                step="1"
                min="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="flex items-end">
              <Button type="submit" disabled={!can.createItem(role)}>Create</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Items List</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">SKU</th>
                <th className="py-2 pr-2">Base UoM</th>
                <th className="py-2 pr-2">Min Stock</th>
                <th className="py-2 pr-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-muted-foreground">No items yet.</td></tr>
              )}
              {items.map(it => {
                const u = uomById.get(it.baseUomId)
                return (
                  <tr key={it.id} className="border-b">
                    <td className="py-2 pr-2">{it.name}</td>
                    <td className="py-2 pr-2">{it.sku}</td>
                    <td className="py-2 pr-2">{u ? `${u.code} — ${u.name}` : it.baseUomId}</td>
                    <td className="py-2 pr-2">{typeof it.minStock === 'number' ? it.minStock : '-'}</td>
                    <td className="py-2 pr-2">
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          disabled={!can.deleteItem(role)}
                          onClick={() =>
                            can.deleteItem(role)
                              ? handleDelete(it.id)
                              : toast.error('Only MANAGER+ can delete items')
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

export default Items
