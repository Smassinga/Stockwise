// src/pages/BOM.tsx
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

type Item = { id: string; name: string; sku?: string | null; base_uom_id?: string | null }
type Warehouse = { id: string; name: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }
type Bom = { id: string; product_id: string; name: string | null; version: number; is_active: boolean }
type ComponentRow = { id: string; component_item_id: string; qty_per: number; scrap_pct: number | null; sort_order: number | null }

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

async function getCurrentCompanyId(): Promise<string> {
  const { data, error } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  if (!data?.length) throw new Error('No active company membership found')
  return data[0].company_id as string
}

export default function BOMPage() {
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string>('')

  const [items, setItems] = useState<Item[]>([])
  const [boms, setBoms] = useState<Bom[]>([])
  const [selectedBomId, setSelectedBomId] = useState<string>('')

  const [components, setComponents] = useState<ComponentRow[]>([])

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [binsFrom, setBinsFrom] = useState<Bin[]>([])
  const [binsTo, setBinsTo] = useState<Bin[]>([])
  const [warehouseFromId, setWarehouseFromId] = useState<string>('')
  const [warehouseToId, setWarehouseToId] = useState<string>('')
  const [binFromId, setBinFromId] = useState<string>('')
  const [binToId, setBinToId] = useState<string>('')

  // create BOM controls
  const [newBomProductId, setNewBomProductId] = useState<string>('')
  const [newBomName, setNewBomName] = useState<string>('')

  // add component controls
  const [compItemId, setCompItemId] = useState<string>('')
  const [compQtyPer, setCompQtyPer] = useState<string>('1')
  const [compScrap, setCompScrap] = useState<string>('0')

  // build controls
  const [buildQty, setBuildQty] = useState<string>('1')

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const selectedBom = useMemo(() => boms.find(b => b.id === selectedBomId) || null, [selectedBomId, boms])

  // initial load
  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        const cid = await getCurrentCompanyId()
        setCompanyId(cid)

        // Items
        const it = await supabase
          .from('items')
          .select('id,name,sku,base_uom_id')
          .eq('company_id', cid)
          .order('name', { ascending: true })
        if (it.error) throw it.error
        setItems((it.data || []) as Item[])

        // BOMs
        const bm = await supabase
          .from('boms')
          .select('id,product_id,name,version,is_active')
          .eq('company_id', cid)
          .order('created_at', { ascending: true })
        if (bm.error) throw bm.error
        setBoms((bm.data || []) as Bom[])

        // Warehouses
        const wh = await supabase
          .from('warehouses')
          .select('id,name')
          .eq('company_id', cid)
          .order('name', { ascending: true })
        if (wh.error) throw wh.error
        setWarehouses((wh.data || []) as Warehouse[])
        if (wh.data?.length) {
          setWarehouseFromId(wh.data[0].id as string)
          setWarehouseToId(wh.data[0].id as string)
        }
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load BOM')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // load bins per warehouse
  useEffect(() => {
    ;(async () => {
      if (!warehouseFromId) { setBinsFrom([]); return }
      const { data, error } = await supabase
        .from('bins')
        .select('id,code,name,warehouseId')
        .eq('warehouseId', warehouseFromId)
        .order('code', { ascending: true })
      if (!error) setBinsFrom((data || []) as Bin[])
    })()
  }, [warehouseFromId])

  useEffect(() => {
    ;(async () => {
      if (!warehouseToId) { setBinsTo([]); return }
      const { data, error } = await supabase
        .from('bins')
        .select('id,code,name,warehouseId')
        .eq('warehouseId', warehouseToId)
        .order('code', { ascending: true })
      if (!error) setBinsTo((data || []) as Bin[])
    })()
  }, [warehouseToId])

  // load components when picking a BOM
  useEffect(() => {
    ;(async () => {
      if (!selectedBomId) { setComponents([]); return }
      const { data, error } = await supabase
        .from('bom_components')
        .select('id,component_item_id,qty_per,scrap_pct,sort_order')
        .eq('bom_id', selectedBomId)
        .order('sort_order', { ascending: true })
      if (error) { console.error(error); toast.error(error.message); return }
      setComponents((data || []) as ComponentRow[])
    })()
  }, [selectedBomId])

  // create a new BOM for a product
  async function createBomForProduct() {
    if (!companyId) return
    if (!newBomProductId) return toast.error('Select a finished product')
    try {
      const ins = await supabase
        .from('boms')
        .insert([{ company_id: companyId, product_id: newBomProductId, name: newBomName || null }])
        .select('id,product_id,name,version,is_active')
        .single()
      if (ins.error) throw ins.error
      setBoms(prev => [...prev, ins.data as Bom])
      setSelectedBomId(ins.data.id as string)
      setNewBomProductId(''); setNewBomName('')
      toast.success('BOM created')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to create BOM')
    }
  }

  // add a component line to current BOM
  async function addComponentLine() {
    if (!selectedBomId) return toast.error('Pick a BOM first')
    if (!compItemId) return toast.error('Select a component item')
    const qty_per = num(compQtyPer, 0)
    if (!(qty_per > 0)) return toast.error('Qty per must be > 0')
    const scrap = Number(compScrap)
    if (!Number.isFinite(scrap) || scrap < 0 || scrap > 1) return toast.error('Scrap must be between 0 and 1')

    const sort_order = (components[components.length - 1]?.sort_order ?? 0) + 1
    const ins = await supabase
      .from('bom_components')
      .insert([{ bom_id: selectedBomId, component_item_id: compItemId, qty_per, scrap_pct: scrap, sort_order }])
      .select('id,component_item_id,qty_per,scrap_pct,sort_order')
      .single()
    if (ins.error) return toast.error(ins.error.message)
    setComponents(prev => [...prev, ins.data as ComponentRow])
    setCompItemId(''); setCompQtyPer('1'); setCompScrap('0')
    toast.success('Component added')
  }

  // remove a component
  async function deleteComponent(id: string) {
    const del = await supabase.from('bom_components').delete().eq('id', id)
    if (del.error) return toast.error(del.error.message)
    setComponents(prev => prev.filter(c => c.id !== id))
    toast.success('Component removed')
  }

  // run a build
  async function runBuild() {
    if (!selectedBomId) return toast.error('Pick a BOM first')
    const qty = num(buildQty, 0)
    if (!(qty > 0)) return toast.error('Quantity must be > 0')
    if (!warehouseFromId || !warehouseToId) return toast.error('Select source and destination warehouses')
    if (!binFromId || !binToId) return toast.error('Select source and destination bins')

    const { data, error } = await supabase.rpc('build_from_bom', {
      p_bom_id: selectedBomId,
      p_qty: qty,
      p_warehouse_from: warehouseFromId,
      p_bin_from: binFromId,
      p_warehouse_to: warehouseToId,
      p_bin_to: binToId,
    })
    if (error) { console.error(error); return toast.error(error.message) }
    toast.success(`Build created: ${data}`)
  }

  if (loading) return <div className="p-6">Loading…</div>

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Bill of Materials</h1>

      {/* Create a BOM */}
      <Card>
        <CardHeader><CardTitle>Create BOM</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Label>Finished Product</Label>
            <Select value={newBomProductId} onValueChange={setNewBomProductId}>
              <SelectTrigger><SelectValue placeholder="Select finished product" /></SelectTrigger>
              <SelectContent className="max-h-64 overflow-auto">
                {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Name (optional)</Label>
            <Input value={newBomName} onChange={e => setNewBomName(e.target.value)} placeholder="e.g., Cake v1" />
          </div>
          <div className="md:col-span-1 flex items-end">
            <Button onClick={createBomForProduct} disabled={!newBomProductId}>Create</Button>
          </div>
        </CardContent>
      </Card>

      {/* Pick existing BOM */}
      <Card>
        <CardHeader><CardTitle>Existing BOMs</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>BOM</Label>
            <Select value={selectedBomId} onValueChange={setSelectedBomId}>
              <SelectTrigger><SelectValue placeholder="Select a BOM" /></SelectTrigger>
              <SelectContent className="max-h-64 overflow-auto">
                {boms.map(b => {
                  const pname = itemById.get(b.product_id)?.name ?? b.product_id
                  return <SelectItem key={b.id} value={b.id}>{pname} — v{b.version}{b.is_active ? '' : ' (inactive)'}</SelectItem>
                })}
              </SelectContent>
            </Select>
          </div>
          {selectedBom && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Product</Label>
                <Input value={itemById.get(selectedBom.product_id)?.name || selectedBom.product_id} readOnly />
              </div>
              <div>
                <Label>Version</Label>
                <Input value={selectedBom.version} readOnly />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Components */}
      {!!selectedBom && (
        <Card>
          <CardHeader><CardTitle>Components</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">Component</th>
                  <th className="py-2 pr-2">Qty per</th>
                  <th className="py-2 pr-2">Scrap (0..1)</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {components.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-muted-foreground">No components yet.</td></tr>
                )}
                {components.map(c => (
                  <tr key={c.id} className="border-b">
                    <td className="py-2 pr-2">{itemById.get(c.component_item_id)?.name ?? c.component_item_id}</td>
                    <td className="py-2 pr-2">{c.qty_per}</td>
                    <td className="py-2 pr-2">{c.scrap_pct ?? 0}</td>
                    <td className="py-2 pr-2">
                      <Button variant="destructive" onClick={() => deleteComponent(c.id)}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Add component row (controlled, no DOM querying) */}
            <div className="grid md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <Label>Component Item</Label>
                <Select value={compItemId} onValueChange={setCompItemId}>
                  <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Qty per</Label>
                <Input type="number" min="0.0001" step="0.0001" value={compQtyPer} onChange={e => setCompQtyPer(e.target.value)} placeholder="1" />
              </div>
              <div>
                <Label>Scrap (0..1)</Label>
                <Input type="number" min="0" max="1" step="0.01" value={compScrap} onChange={e => setCompScrap(e.target.value)} placeholder="0" />
              </div>
              <div className="md:col-span-4 flex justify-end">
                <Button onClick={addComponentLine} disabled={!compItemId}>Add Component</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Build */}
      {!!selectedBom && (
        <Card>
          <CardHeader><CardTitle>Build from BOM</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-3">
            <div>
              <Label>Warehouse FROM</Label>
              <Select value={warehouseFromId} onValueChange={(v) => { setWarehouseFromId(v); setBinFromId('') }}>
                <SelectTrigger><SelectValue placeholder="Select source warehouse" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bin FROM</Label>
              <Select value={binFromId} onValueChange={setBinFromId}>
                <SelectTrigger><SelectValue placeholder="Select source bin" /></SelectTrigger>
                <SelectContent className="max-h-64 overflow-auto">
                  {binsFrom.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Warehouse TO</Label>
              <Select value={warehouseToId} onValueChange={(v) => { setWarehouseToId(v); setBinToId('') }}>
                <SelectTrigger><SelectValue placeholder="Select destination warehouse" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Bin TO</Label>
              <Select value={binToId} onValueChange={setBinToId}>
                <SelectTrigger><SelectValue placeholder="Select destination bin" /></SelectTrigger>
                <SelectContent className="max-h-64 overflow-auto">
                  {binsTo.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2 flex items-end gap-3">
              <div className="w-48">
                <Label>Quantity to Build</Label>
                <Input type="number" min="0.0001" step="0.0001" value={buildQty} onChange={e => setBuildQty(e.target.value)} placeholder="1" />
              </div>
              <Button onClick={runBuild}>Build</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
