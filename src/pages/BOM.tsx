import { useEffect, useMemo, useState, Fragment } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { buildConvGraph, convertQty, type ConvRow } from '../lib/uom'

type Item = { id: string; name: string; sku?: string | null; base_uom_id?: string | null }
type Uom  = { id: string; code: string; name: string; family?: string }
type Warehouse = { id: string; name: string }
type Bin = { id: string; code: string; name: string; warehouse_id: string }

type Bom = { id: string; product_id: string; name: string; version: string; is_active: boolean }
type ComponentRow = { id: string; component_item_id: string; qty_per: number; scrap_pct: number | null; created_at: string | null }

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''))

async function resolveActiveCompanyId(): Promise<string> {
  // Prefer server-side setting; fallback to earliest active membership
  const g = await supabase.rpc('get_active_company')
  if (!g.error && g.data) return String(g.data)
  const { data } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  if (!data?.company_id) throw new Error('No active company membership found')
  return String(data.company_id)
}

type OutputSplit = { id: string; warehouseId: string; binId: string; qty: string }
type ComponentSourceRow = { id: string; warehouseId: string; binId: string; sharePct: string }

type ComponentSourcesPayload = Array<{
  component_item_id: string
  sources: Array<{ warehouse_id: string; bin_id: string; share_pct: number }>
}>
type OutputSplitsPayload = Array<{ warehouse_id: string; bin_id: string; qty: number }>

export default function BOMPage() {
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyId] = useState<string>('')

  // Masters
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [convGraph, setConvGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)

  // BOMs
  const [boms, setBoms] = useState<Bom[]>([])
  const [selectedBomId, setSelectedBomId] = useState<string>('')  
  const selectedBom = useMemo(() => boms.find(b => b.id === selectedBomId) || null, [selectedBomId, boms])

  // Editable
  const [editName, setEditName] = useState<string>('')  
  const [editVersion, setEditVersion] = useState<string>('')

  // Components
  const [components, setComponents] = useState<ComponentRow[]>([])

  // Warehouses/Bins
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [binsFrom, setBinsFrom] = useState<Bin[]>([])
  const [binsTo, setBinsTo] = useState<Bin[]>([])
  const [warehouseFromId, setWarehouseFromId] = useState<string>('')  // UUID
  const [warehouseToId, setWarehouseToId] = useState<string>('')      // UUID
  const [binFromId, setBinFromId] = useState<string>('')              // TEXT
  const [binToId, setBinToId] = useState<string>('')                  // TEXT

  const [binCache, setBinCache] = useState<Record<string, Bin[]>>({})

  const [advanced, setAdvanced] = useState(false)
  const [splits, setSplits] = useState<OutputSplit[]>([])

  const [useComponentSources, setUseComponentSources] = useState(false)
  const [sourcesByComponent, setSourcesByComponent] = useState<Record<string, ComponentSourceRow[]>>({})

  // Create BOM
  const [newBomProductId, setNewBomProductId] = useState<string>('')  // UUID
  const [newBomName, setNewBomName] = useState<string>('')

  // Add component
  const [compItemId, setCompItemId] = useState<string>('')            // UUID
  const [compQtyPer, setCompQtyPer] = useState<string>('1')
  const [compScrap, setCompScrap] = useState<string>('0')
  const [compUomId, setCompUomId] = useState<string>('') // entry UoM (convert to base before insert)

  // Build
  const [buildQty, setBuildQty] = useState<string>('1')
  const [savingBOM, setSavingBOM] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [building, setBuilding] = useState(false)

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const uomById  = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])

  // Initial load
  useEffect(() => {
    (async () => {
      try {
        setLoading(true)
        const cid = await resolveActiveCompanyId()
        setCompanyId(cid)

        // Items for this company (ensures names, no UUIDs shown)
        const it = await supabase
          .from('items')
          .select('id,name,sku,base_uom_id')
          .eq('company_id', cid)
          .order('name', { ascending: true })
        if (it.error) throw it.error
        setItems((it.data || []) as Item[])

        const [uRes, cRes] = await Promise.all([
          supabase.from('uoms').select('id,code,name,family').order('code', { ascending: true }),
          supabase.from('uom_conversions').select('from_uom_id,to_uom_id,factor')
        ])
        if (uRes.error) throw uRes.error
        setUoms(((uRes.data || []) as any[]).map((u: any) => ({
          id: String(u.id),
          code: String(u.code || '').toUpperCase(),
          name: String(u.name || ''),
          family: u.family || 'unspecified',
        })))
        setConvGraph(buildConvGraph((cRes.data || []) as ConvRow[]))

        const bm = await supabase
          .from('boms')
          .select('id,product_id,name,version,is_active')
          .eq('company_id', cid)
          .order('created_at', { ascending: true })
        if (bm.error) throw bm.error
        const list = ((bm.data || []) as any[]).map(b => ({ ...b, version: String(b.version ?? 'v1') })) as Bom[]
        setBoms(list)

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

  // Bins per warehouse
  useEffect(() => {
    (async () => {
      if (!warehouseFromId) { setBinsFrom([]); return }
      const { data, error } = await supabase
        .from('bins_v')
        .select('id,code,name,warehouse_id')
        .eq('warehouse_id', warehouseFromId)
        .order('code', { ascending: true })
      if (error) { console.error(error); toast.error(error.message); return }
      setBinsFrom((data || []) as Bin[])
    })()
  }, [warehouseFromId])

  useEffect(() => {
    (async () => {
      if (!warehouseToId) { setBinsTo([]); return }
      const { data, error } = await supabase
        .from('bins_v')
        .select('id,code,name,warehouse_id')
        .eq('warehouse_id', warehouseToId)
        .order('code', { ascending: true })
      if (error) { console.error(error); toast.error(error.message); return }
      setBinsTo((data || []) as Bin[])
    })()
  }, [warehouseToId])

  // Components for selected BOM
  useEffect(() => {
    (async () => {
      if (!selectedBomId) { setComponents([]); setSourcesByComponent({}); return }
      const { data, error } = await supabase
        .from('bom_components')
        .select('id,component_item_id,qty_per,scrap_pct,created_at')
        .eq('bom_id', selectedBomId)
        .order('created_at', { ascending: true })
      if (error) { console.error(error); toast.error(error.message); return }
      setComponents((data || []) as ComponentRow[])
      setSourcesByComponent({})
    })()
  }, [selectedBomId])

  // Sync editable fields
  useEffect(() => {
    if (selectedBom) {
      setEditName(selectedBom.name || '')
      setEditVersion(String(selectedBom.version || 'v1'))
    } else {
      setEditName('')
      setEditVersion('')
    }
  }, [selectedBomId]) // eslint-disable-line

  // Default entry UoM to component base
  useEffect(() => {
    if (!compItemId) { setCompUomId(''); return }
    const base = itemById.get(compItemId)?.base_uom_id || ''
    setCompUomId(base || '')
  }, [compItemId]) // eslint-disable-line

  const familyLabel = (fam?: string) => {
    const key = String(fam || 'unspecified').toLowerCase()
    const map: Record<string, string> = {
      mass: 'Mass', volume: 'Volume', length: 'Length', area: 'Area',
      count: 'Count', time: 'Time', other: 'Other', unspecified: 'Unspecified',
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

  async function ensureBinsFor(warehouseId: string) {
    if (!warehouseId) return
    if (binCache[warehouseId]) return
    const { data, error } = await supabase
      .from('bins_v').select('id,code,name,warehouse_id')
      .eq('warehouse_id', warehouseId)
      .order('code', { ascending: true })
    if (error) { console.error(error); toast.error(error.message); return }
    setBinCache(prev => ({ ...prev, [warehouseId]: (data || []) as Bin[] }))
  }

  // Create BOM
  async function createBomForProduct() {
    if (!companyId) return
    if (!newBomProductId) return toast.error('Select a finished product')
    const nameTrim = (newBomName || '').trim()
    if (!nameTrim) return toast.error('Name is required (e.g., Cake v1)')

    try {
      const ins = await supabase
        .from('boms')
        .insert([{ company_id: companyId, product_id: newBomProductId, name: nameTrim }])
        .select('id,product_id,name,version,is_active')
        .single()
      if (ins.error) throw ins.error
      const inserted = { ...ins.data, version: String((ins.data as any).version ?? 'v1') } as Bom
      setBoms(prev => [...prev, inserted])
      setSelectedBomId(inserted.id)
      setNewBomProductId(''); setNewBomName('')
      toast.success('BOM created')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to create BOM')
    }
  }

  // Save BOM metadata
  async function saveBomMeta() {
    if (!selectedBom) return
    try {
      setSavingBOM(true)
      const { error, data } = await supabase
        .from('boms')
        .update({ name: editName.trim(), version: editVersion.trim() })
        .eq('id', selectedBom.id)
        .select('id,product_id,name,version,is_active')
        .single()
      if (error) throw error
      setBoms(prev => prev.map(b => b.id === selectedBom.id ? { ...b, name: data!.name, version: String(data!.version) } : b))
      toast.success('BOM updated')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update BOM')
    } finally {
      setSavingBOM(false)
    }
  }

  // Duplicate as new version
  async function duplicateAsNewVersion() {
    if (!selectedBom) return
    try {
      setDuplicating(true)
      const baseVers = String(editVersion || selectedBom.version || 'v1')
      const m = /^v?(\d+)$/i.exec(baseVers)
      let nextNum = m ? Number(m[1]) + 1 : 2

      let newBom: Bom | null = null
      for (let tries = 0; tries < 20; tries++) {
        const next = `v${nextNum}`
        const ins = await supabase
          .from('boms')
          .insert([{ company_id: companyId, product_id: selectedBom.product_id, name: editName || selectedBom.name, version: next }])
          .select('id,product_id,name,version,is_active')
          .single()
        if (!ins.error && ins.data) { newBom = ins.data as Bom; break }
        if (ins.error?.message?.toLowerCase().includes('duplicate') || ins.error?.code === '23505') {
          nextNum++; continue
        } else if (ins.error) { throw ins.error }
      }
      if (!newBom) throw new Error('Could not find a free version after several attempts')

      const { data: comps, error: cErr } = await supabase
        .from('bom_components')
        .select('component_item_id,qty_per,scrap_pct')
        .eq('bom_id', selectedBom.id)
      if (cErr) throw cErr

      if ((comps || []).length) {
        const payload = (comps || []).map(c => ({ bom_id: newBom!.id, component_item_id: c.component_item_id, qty_per: c.qty_per, scrap_pct: c.scrap_pct }))
        const insC = await supabase.from('bom_components').insert(payload)
        if (insC.error) throw insC.error
      }

      const normalized = { ...newBom!, version: String((newBom as any).version) } as Bom
      setBoms(prev => [...prev, normalized])
      setSelectedBomId(normalized.id)
      toast.success(`Duplicated as ${normalized.version}`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to duplicate BOM')
    } finally {
      setDuplicating(false)
    }
  }

  // Conversion helpers
  function idsOrCodesEqual(aId?: string | null, bId?: string | null) {
    if (!aId || !bId) return false
    if (aId === bId) return true
    const ac = (uomById.get(String(aId))?.code || '').toUpperCase()
    const bc = (uomById.get(String(bId))?.code || '').toUpperCase()
    return !!(ac && bc && ac === bc)
  }
  function canConvert(fromId?: string | null, toId?: string | null) {
    if (!fromId || !toId) return false
    if (idsOrCodesEqual(fromId, toId)) return true
    if (!convGraph) return false
    const visited = new Set<string>([fromId])
    const q: string[] = [fromId]
    while (q.length) {
      const id = q.shift()!
      const edges = convGraph.get(id) || []
      for (const e of edges) {
        if (idsOrCodesEqual(e.to, toId) || e.to === toId) return true
        if (!visited.has(e.to)) { visited.add(e.to); q.push(e.to) }
      }
    }
    return false
  }
  function safeConvert(qty: number, fromId: string, toId: string): number | null {
    if (idsOrCodesEqual(fromId, toId)) return qty
    if (!convGraph) return null
    try { return Number(convertQty(qty, fromId, toId, convGraph)) } catch { return null }
  }

  // Add component (convert to base UoM before saving)
  async function addComponentLine() {
    if (!selectedBomId) return toast.error('Pick a BOM first')
    if (!compItemId) return toast.error('Select a component item')

    const qtyEntered = num(compQtyPer, 0)
    if (!(qtyEntered > 0)) return toast.error('Qty must be > 0')

    const scrap = Number(compScrap)
    if (!Number.isFinite(scrap) || scrap < 0 || scrap > 1) return toast.error('Scrap must be between 0 and 1')

    const baseUom = itemById.get(compItemId)?.base_uom_id || ''
    const uomEntered = compUomId || baseUom

    let qtyBase = qtyEntered
    if (!idsOrCodesEqual(uomEntered, baseUom)) {
      if (!canConvert(uomEntered, baseUom)) return toast.error('Selected UoM cannot convert to the item’s base UoM')
      const conv = safeConvert(qtyEntered, uomEntered, baseUom)
      if (conv == null) return toast.error('No conversion path')
      qtyBase = conv
    }

    const ins = await supabase
      .from('bom_components')
      .insert([{ bom_id: selectedBomId, component_item_id: compItemId, qty_per: qtyBase, scrap_pct: scrap }])
      .select('id,component_item_id,qty_per,scrap_pct,created_at')
      .single()
    if (ins.error) return toast.error(ins.error.message)

    setComponents(prev => [...prev, ins.data as ComponentRow])
    setCompItemId(''); setCompQtyPer('1'); setCompScrap('0'); setCompUomId('')
    toast.success('Component added')
  }

  async function deleteComponent(id: string) {
    const del = await supabase.from('bom_components').delete().eq('id', id)
    if (del.error) return toast.error(del.error.message)
    setComponents(prev => prev.filter(c => c.id !== id))
    setSourcesByComponent(prev => {
      const comp = components.find(x => x.id === id)
      if (!comp) return prev
      const next = { ...prev }
      delete next[comp.component_item_id]
      return next
    })
    toast.success('Component removed')
  }

  // Per-component sources editor helpers
  function addSourceRow(componentItemId: string) {
    setSourcesByComponent(prev => {
      const rows = prev[componentItemId] || []
      return {
        ...prev,
        [componentItemId]: [...rows, { id: crypto.randomUUID(), warehouseId: warehouseFromId || '', binId: '', sharePct: '' }]
      }
    })
  }
  function updateSourceRow(componentItemId: string, rowId: string, patch: Partial<ComponentSourceRow>) {
    setSourcesByComponent(prev => {
      const rows = prev[componentItemId] || []
      return {
        ...prev,
        [componentItemId]: rows.map(r => (r.id === rowId ? { ...r, ...patch } : r))
      }
    })
  }
  function removeSourceRow(componentItemId: string, rowId: string) {
    setSourcesByComponent(prev => {
      const rows = prev[componentItemId] || []
      return { ...prev, [componentItemId]: rows.filter(r => r.id !== rowId) }
    })
  }

  function buildComponentSourcesPayload(): ComponentSourcesPayload {
    const payload = components.map(c => {
      const rows = (sourcesByComponent[c.component_item_id] || []).map(r => ({
        warehouse_id: r.warehouseId,
        bin_id: r.binId,
        share_pct: Number(r.sharePct || 0),
      })).filter(x => isUuid(x.warehouse_id) && !!x.bin_id && Number.isFinite(x.share_pct) && x.share_pct >= 0)

      const total = rows.reduce((s, x) => s + x.share_pct, 0)
      const normalized = total > 0 ? rows.map(x => ({ ...x, share_pct: x.share_pct / total })) : []
      return { component_item_id: c.component_item_id, sources: normalized }
    }).filter(e => e.sources.length > 0)

    return payload
  }

  function buildOutputSplitsPayload(qty: number): OutputSplitsPayload | null {
    if (advanced && splits.length) {
      const out = splits
        .map(s => ({ warehouse_id: s.warehouseId, bin_id: s.binId, qty: num(s.qty, 0) }))
        .filter(s => s.qty > 0 && isUuid(s.warehouse_id) && !!s.bin_id)
      return out.length ? out : null
    }
    if (isUuid(warehouseToId) && !!binToId) {
      return [{ warehouse_id: warehouseToId, bin_id: binToId, qty }]
    }
    return null
  }

  // Build
  async function runBuild() {
    if (!selectedBomId) return toast.error('Pick a BOM first')
    const qty = num(buildQty, 0)
    if (!(qty > 0)) return toast.error('Quantity must be > 0')

    try {
      setBuilding(true)

      if (useComponentSources) {
        const componentPayload = buildComponentSourcesPayload()
        if (!componentPayload.length) { setBuilding(false); return toast.error('Add at least one valid source row (warehouse UUID + bin).') }

        const outSplits = buildOutputSplitsPayload(qty)
        if (!outSplits) { setBuilding(false); return toast.error('Select a valid destination bin (TEXT id) or add output splits.') }

        const { error } = await supabase.rpc('build_from_bom_sources', {
          p_bom_id: selectedBomId,
          p_qty: qty,
          p_component_sources: componentPayload,
          p_output_splits: outSplits,
        })
        if (error) {
          console.error('[build_from_bom_sources] error', error, { componentPayload, outSplits })
          if (error.code === '42883' || /does not exist/i.test(error.message || '')) {
            toast.error('Backend RPC build_from_bom_sources is not defined on the DB.')
          } else {
            toast.error(error.message || 'Build failed')
          }
        } else {
          setBuildQty('')
          setSplits([])
          toast.success('Build created with per-component sources')
        }
        setBuilding(false)
        return
      }

      // Legacy single-source path
      if (!isUuid(warehouseFromId) || !binFromId) {
        setBuilding(false); return toast.error('Select a valid source warehouse (UUID) and bin (TEXT).')
      }

      const runs: Array<{ qty: number; wTo: string; bTo: string }> =
        advanced && splits.length
          ? splits.map(s => ({ qty: num(s.qty, 0), wTo: s.warehouseId, bTo: s.binId }))
                  .filter(s => s.qty > 0 && isUuid(s.wTo) && !!s.bTo)
          : (isUuid(warehouseToId) && !!binToId)
              ? [{ qty, wTo: warehouseToId, bTo: binToId }]
              : []

      if (!runs.length) { setBuilding(false); return toast.error('Add at least one valid destination split') }

      for (const r of runs) {
        const { error } = await supabase.rpc('build_from_bom', {
          p_bom_id: selectedBomId,
          p_qty: r.qty,
          p_warehouse_from: warehouseFromId,
          p_bin_from: binFromId,
          p_warehouse_to: r.wTo,
          p_bin_to: r.bTo,
        })
        if (error) throw error
      }

      setBuildQty('')
      if (!advanced) setBinToId('')
      setSplits([])
      toast.success(advanced ? 'Build(s) created' : 'Build created')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Build failed')
    } finally {
      setBuilding(false)
    }
  }

  const addPreview = useMemo(() => {
    if (!compItemId) return null
    const entered = num(compQtyPer, 0)
    const baseId = itemById.get(compItemId)?.base_uom_id || ''
    const enteredId = compUomId || baseId
    if (!entered || !baseId || !enteredId) return { entered, base: entered, invalid: false, baseId, enteredId }
    if (idsOrCodesEqual(enteredId, baseId)) return { entered, base: entered, invalid: false, baseId, enteredId }
    const conv = safeConvert(entered, enteredId, baseId)
    return { entered, base: conv ?? entered, invalid: conv == null, baseId, enteredId }
  }, [compItemId, compQtyPer, compUomId, items, convGraph]) // eslint-disable-line

  if (loading) return <div className="p-6">Loading…</div>

  const uomLabel = (id?: string | null) => {
    if (!id) return ''
    const u = uomById.get(String(id))
    return u ? `${u.code} — ${u.name}` : String(id)
  }

  const updateSplit = (id: string, patch: Partial<OutputSplit>) =>
    setSplits(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
  const removeSplit = (id: string) => setSplits(prev => prev.filter(s => s.id !== id))

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
            <div className="text-[11px] text-muted-foreground mt-1">
              Tip: pick the SKU you actually stock as the finished good.
            </div>
          </div>
          <div>
            <Label>Name</Label>
            <Input value={newBomName} onChange={e => setNewBomName(e.target.value)} placeholder="e.g., Cake v1" />
            <div className="text-[11px] text-muted-foreground mt-1">
              Include a version in the name (e.g. “v1”) so it’s easy to find.
            </div>
          </div>
          <div className="md:col-span-1 flex items-end">
            <Button onClick={createBomForProduct} disabled={!newBomProductId || !newBomName.trim()}>
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pick + Edit existing BOM */}
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
                  return (
                    <SelectItem key={b.id} value={b.id}>
                      {pname} — {b.name}{b.is_active ? '' : ' (inactive)'}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {selectedBom && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <Label>Version</Label>
                <Input value={editVersion} onChange={e => setEditVersion(e.target.value)} />
              </div>
              <div className="col-span-2 flex gap-2">
                <Button onClick={saveBomMeta} disabled={savingBOM}>
                  {savingBOM ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="secondary" onClick={duplicateAsNewVersion} disabled={duplicating}>
                  {duplicating ? 'Duplicating…' : 'Duplicate as new version'}
                </Button>
              </div>
              <div className="col-span-2 text-[11px] text-muted-foreground">
                Save to update this version, or duplicate to create the next version (components are copied for you).
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
                  <th className="py-2 pr-2">Qty per (base UoM)</th>
                  <th className="py-2 pr-2">Base UoM</th>
                  <th className="py-2 pr-2">Scrap (0..1)</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {components.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-muted-foreground">No components yet.</td></tr>
                )}
                {components.map(c => {
                  const it = itemById.get(c.component_item_id)
                  const sources = sourcesByComponent[c.component_item_id] || []
                  return (
                    <Fragment key={c.id}>
                      <tr className="border-b align-top">
                        <td className="py-2 pr-2">{it?.name ?? c.component_item_id}</td>
                        <td className="py-2 pr-2">{c.qty_per}</td>
                        <td className="py-2 pr-2">{uomLabel(it?.base_uom_id)}</td>
                        <td className="py-2 pr-2">{c.scrap_pct ?? 0}</td>
                        <td className="py-2 pr-2 space-x-2">
                          <Button variant="destructive" onClick={() => deleteComponent(c.id)}>Delete</Button>
                          <Button variant="secondary" onClick={() => addSourceRow(c.component_item_id)} disabled={!useComponentSources}>
                            Add source
                          </Button>
                        </td>
                      </tr>

                      {useComponentSources && (
                        <tr className="border-b">
                          <td colSpan={5} className="py-3">
                            <div className="space-y-2">
                              {sources.length === 0 && (
                                <div className="text-[11px] text-muted-foreground">No sources yet for this component.</div>
                              )}
                              {sources.map(row => {
                                const bins = row.warehouseId ? (binCache[row.warehouseId] || []) : []
                                return (
                                  <div key={row.id} className="grid md:grid-cols-4 gap-2">
                                    <div>
                                      <Label>Warehouse (source)</Label>
                                      <Select
                                        value={row.warehouseId}
                                        onValueChange={async (v) => {
                                          updateSourceRow(c.component_item_id, row.id, { warehouseId: v, binId: '' })
                                          await ensureBinsFor(v)
                                        }}>
                                        <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                                        <SelectContent>
                                          {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div>
                                      <Label>Bin (source)</Label>
                                      <Select
                                        value={row.binId}
                                        onValueChange={(v) => updateSourceRow(c.component_item_id, row.id, { binId: v })}
                                        disabled={!row.warehouseId}
                                      >
                                        <SelectTrigger><SelectValue placeholder={row.warehouseId ? 'Select bin' : 'Pick warehouse first'} /></SelectTrigger>
                                        <SelectContent className="max-h-64 overflow-auto">
                                          {bins.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div>
                                      <Label>Share %</Label>
                                      <Input
                                        type="number"
                                        min="0" max="100" step="0.01"
                                        value={row.sharePct}
                                        onChange={e => updateSourceRow(c.component_item_id, row.id, { sharePct: e.target.value })}
                                        placeholder="e.g., 60"
                                      />
                                    </div>
                                    <div className="flex items-end">
                                      <Button variant="destructive" onClick={() => removeSourceRow(c.component_item_id, row.id)}>Remove</Button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>

            {/* Add component row */}
            <div className="grid md:grid-cols-6 gap-3">
              <div className="md:col-span-2">
                <Label>Component Item</Label>
                <Select value={compItemId} onValueChange={(v) => { setCompItemId(v); setCompQtyPer('1') }}>
                  <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Qty</Label>
                <Input type="number" min="0.0001" step="0.0001" value={compQtyPer} onChange={e => setCompQtyPer(e.target.value)} placeholder="1" />
              </div>

              <div>
                <Label>Qty UoM</Label>
                <Select
                  value={compUomId}
                  onValueChange={(uomId) => {
                    const base = itemById.get(compItemId)?.base_uom_id || ''
                    if (!base) { setCompUomId(uomId); return }
                    if (idsOrCodesEqual(uomId, base)) { setCompUomId(uomId); return }
                    if (!canConvert(uomId, base)) {
                      toast.error('Selected UoM cannot convert to the item’s base UoM')
                      setCompUomId(base)
                      return
                    }
                    setCompUomId(uomId)
                  }}
                  disabled={!compItemId}
                >
                  <SelectTrigger><SelectValue placeholder={compItemId ? 'Select UoM' : 'Pick item first'} /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {groupedUoms.families.map(fam => (
                      <Fragment key={fam}>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground sticky top-0 bg-popover">
                          {familyLabel(fam)}
                        </div>
                        {(groupedUoms.groups.get(fam) || []).map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                        ))}
                        <div className="h-1" />
                      </Fragment>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Scrap (0..1)</Label>
                <Input type="number" min="0" max="1" step="0.01" value={compScrap} onChange={e => setCompScrap(e.target.value)} placeholder="0" />
              </div>

              <div className="md:col-span-2 flex items-end">
                <Button onClick={addComponentLine} disabled={!compItemId}>Add Component</Button>
              </div>

              {/* Preview conversion */}
              {compItemId && addPreview && (
                <div className={`md:col-span-6 text-xs ${addPreview.invalid ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {`Entered: ${addPreview.entered} ${(uomById.get(addPreview.enteredId)?.code || '').toUpperCase()} → Base: ${addPreview.base} ${(uomById.get(addPreview.baseId)?.code || '').toUpperCase()}`}
                  {addPreview.invalid ? ' (no conversion path)' : ''}
                </div>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Hint: quantities above are per **one** finished good (base UoM).
            </div>

            {/* Toggle per-component sources */}
            <div className="mt-3 flex items-center gap-2">
              <input id="pcs" type="checkbox" className="h-4 w-4" checked={useComponentSources} onChange={(e) => setUseComponentSources(e.target.checked)} />
              <Label htmlFor="pcs">Use per-component source bins during build</Label>
            </div>
            {useComponentSources && (
              <div className="text-[11px] text-muted-foreground mt-1">
                Add source rows under each component. Shares are normalized automatically.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Build */}
      {!!selectedBom && (
        <Card>
          <CardHeader><CardTitle>Build from BOM</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              {!useComponentSources && (
                <>
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
                </>
              )}

              {!advanced && (
                <>
                  <div>
                    <Label>Warehouse TO</Label>
                    <Select value={warehouseToId} onValueChange={(v) => { setWarehouseToId(v); setBinToId(''); }}>
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
                </>
              )}
            </div>

            {/* Advanced split outputs */}
            <div className="flex items-center gap-2">
              <input id="adv" type="checkbox" className="h-4 w-4" checked={advanced} onChange={e => setAdvanced(e.target.checked)} />
              <Label htmlFor="adv">Split output to multiple destination bins</Label>
            </div>
            {advanced && (
              <div className="space-y-2">
                <div className="text-[11px] text-muted-foreground">
                  We’ll run multiple builds (or the advanced RPC) depending on the mode. Each row applies independently.
                </div>
                <div className="space-y-2">
                  {splits.map((s) => {
                    const destBins = s.warehouseId ? (binCache[s.warehouseId] || []) : []
                    return (
                      <div key={s.id} className="grid md:grid-cols-4 gap-2">
                        <div>
                          <Label>Warehouse TO</Label>
                          <Select
                            value={s.warehouseId}
                            onValueChange={async (v) => {
                              updateSplit(s.id, { warehouseId: v, binId: '' })
                              await ensureBinsFor(v)
                            }}
                          >
                            <SelectTrigger><SelectValue placeholder="Warehouse" /></SelectTrigger>
                            <SelectContent>
                              {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Bin TO</Label>
                          <Select
                            value={s.binId}
                            onValueChange={(v) => updateSplit(s.id, { binId: v })}
                            disabled={!s.warehouseId}
                          >
                            <SelectTrigger><SelectValue placeholder={s.warehouseId ? 'Bin' : 'Pick warehouse first'} /></SelectTrigger>
                            <SelectContent className="max-h-64 overflow-auto">
                              {destBins.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Qty</Label>
                          <Input type="number" min="0.0001" step="0.0001" value={s.qty} onChange={e => updateSplit(s.id, { qty: e.target.value })} placeholder="0" />
                        </div>
                        <div className="flex items-end">
                          <Button variant="destructive" onClick={() => removeSplit(s.id)}>Remove</Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const nextWh = warehouseToId || (warehouses[0]?.id || '')
                    if (nextWh) await ensureBinsFor(nextWh)
                    setSplits(prev => [...prev, { id: crypto.randomUUID(), warehouseId: nextWh, binId: '', qty: '' }])
                  }}
                >
                  Add split
                </Button>
              </div>
            )}

            <div className="md:flex md:items-end md:gap-3">
              <div className="md:w-48">
                <Label>Quantity to Build</Label>
                <Input type="number" min="0.0001" step="0.0001" value={buildQty} onChange={e => setBuildQty(e.target.value)} placeholder="1" />
              </div>
              <Button onClick={runBuild} disabled={building}>
                {building ? 'Building…' : 'Build'}
              </Button>
            </div>

            <div className="text-[11px] text-muted-foreground">
              After building, the quantity field clears so you know it executed.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
