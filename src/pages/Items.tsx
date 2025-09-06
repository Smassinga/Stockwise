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

type Uom = { id: string; code: string; name: string; family: 'mass' | 'volume' | 'length' | 'count' | string }
type Item = {
  id: string
  sku: string
  name: string
  baseUomId: string
  unitPrice: number | null
  minStock: number | null
  createdAt: string | null
  updatedAt: string | null
}

function sortByName<T extends { name?: string }>(arr: T[]) {
  return [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

const Items: React.FC = () => {
  const { myRole } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'

  const [loading, setLoading] = useState(true)
  const [uoms, setUoms] = useState<Uom[]>([])
  const [items, setItems] = useState<Item[]>([])

  // form
  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [baseUomId, setBaseUomId] = useState('')
  const [unitPrice, setUnitPrice] = useState<string>('')
  const [minStock, setMinStock] = useState<string>('')

  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)

        // ---- UOMs: try uom then uoms; if first returns 0 rows, try the other
        const normalize = (rows: any[]): Uom[] =>
          (rows ?? []).map((r: any) => ({
            id: String(r.id),
            code: String(r.code ?? ''),
            name: String(r.name ?? ''),
            family: 'other',
          }))

        const fetchFrom = async (table: 'uom' | 'uoms') => {
          const res: any = await supabase.from(table).select('id, code, name').order('code', { ascending: true })
          if (res.error) return { rows: [] as any[], ok: false, err: res.error }
          return { rows: (res.data ?? []) as any[], ok: true, err: null }
        }

        let rows: any[] = []
        // 1st attempt: uom
        const a = await fetchFrom('uom')
        if (a.ok && a.rows.length > 0) {
          rows = a.rows
        } else {
          // 2nd attempt: uoms (fallback if uom empty or errored)
          const b = await fetchFrom('uoms')
          if (b.ok && b.rows.length > 0) {
            rows = b.rows
          } else if (a.ok && b.ok) {
            // both ok but empty
            rows = []
          } else {
            // surface some context if both failed
            const err = a.err || b.err
            if (err) console.error('UoM load error:', err)
          }
        }

        // union/dedupe in case both exist and have data
        if (rows.length === 0) {
          // try merging both if neither individually returned rows
          const a2 = a.ok ? a.rows : []
          const b2 = (await fetchFrom('uoms')).rows
          const map = new Map<string, any>()
          for (const r of [...a2, ...b2]) map.set(String(r.id), r)
          rows = Array.from(map.values())
        }

        setUoms(normalize(rows))

        // ---- Items via camelCase view
        const res = await supabase
          .from('items_view')
          .select('id,sku,name,baseUomId,unitPrice,minStock,createdAt,updatedAt')
          .order('name', { ascending: true })
        if (res.error) throw res.error
        setItems(sortByName(res.data || []))
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
      .select('id,sku,name,baseUomId,unitPrice,minStock,createdAt,updatedAt')
      .order('name', { ascending: true })
    if (res.error) return toast.error(res.error.message)
    setItems(sortByName(res.data || []))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!can.createItem(role)) return toast.error('Only OPERATOR+ can create items')
    if (!name.trim() || !sku.trim() || !baseUomId) return toast.error('Name, SKU and Base UoM are required')

    const priceNum = unitPrice ? Number(unitPrice) : 0
    const minStockNum = minStock ? Number(minStock) : 0
    if (Number.isNaN(priceNum) || priceNum < 0) return toast.error('Unit Price must be a non-negative number')
    if (Number.isNaN(minStockNum) || minStockNum < 0) return toast.error('Min Stock must be a non-negative number')

    try {
      const dup = await supabase.from('items').select('id').eq('sku', sku.trim()).limit(1)
      if (dup.error) throw dup.error
      if (dup.data && dup.data.length) return toast.error('SKU must be unique')

      const payload: any = {
        name: name.trim(),
        sku: sku.trim(),
        base_uom_id: baseUomId,
        unit_price: priceNum,
        min_stock: minStockNum,
      }
      const ins = await supabase.from('items').insert(payload).select('id').single()
      if (ins.error) throw ins.error

      toast.success('Item created')
      setName(''); setSku(''); setBaseUomId(''); setUnitPrice(''); setMinStock('')
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
                <SelectContent>
                  {uoms.length === 0
                    ? <SelectItem value="__none__" disabled>No UoMs available</SelectItem>
                    : uoms.map(u => (
                        <SelectItem key={u.id} value={u.id}>{uomLabel(u)}</SelectItem>
                      ))
                  }
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="unitPrice">Unit Price</Label>
              <Input id="unitPrice" type="number" step="0.0001" min="0"
                     value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0.00" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="minStock">Min Stock</Label>
              <Input id="minStock" type="number" step="1" min="0"
                     value={minStock} onChange={(e) => setMinStock(e.target.value)} placeholder="0" />
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
                <th className="py-2 pr-2">Unit Price</th>
                <th className="py-2 pr-2">Min Stock</th>
                <th className="py-2 pr-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-muted-foreground">No items yet.</td></tr>
              )}
              {items.map(it => {
                const u = uomById.get(it.baseUomId)
                return (
                  <tr key={it.id} className="border-b">
                    <td className="py-2 pr-2">{it.name}</td>
                    <td className="py-2 pr-2">{it.sku}</td>
                    <td className="py-2 pr-2">{u ? `${u.code} — ${u.name}` : it.baseUomId}</td>
                    <td className="py-2 pr-2">{typeof it.unitPrice === 'number' ? it.unitPrice.toFixed(2) : '-'}</td>
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
