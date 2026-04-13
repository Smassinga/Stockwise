import { useEffect, useMemo, useState, Fragment } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { buildConvGraph, convertQty, type ConvRow } from '../lib/uom'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'
import { deriveItemProfileWarnings, profileFromRole, type ItemPrimaryRole } from '../lib/itemProfiles'

type Item = {
  id: string
  name: string
  sku?: string | null
  base_uom_id?: string | null
  primary_role?: ItemPrimaryRole | null
  track_inventory?: boolean | null
  can_buy?: boolean | null
  can_sell?: boolean | null
  is_assembled?: boolean | null
  has_active_bom?: boolean | null
  used_as_component?: boolean | null
  on_hand_qty?: number | null
  available_qty?: number | null
}
type Uom  = { id: string; code: string; name: string; family?: string }
type Warehouse = { id: string; name: string }
type Bin = { id: string; code: string; name: string; warehouse_id: string }

type Bom = { id: string; product_id: string; name: string; version: string; is_active: boolean }
type ComponentRow = { id: string; component_item_id: string; qty_per: number; scrap_pct: number | null; created_at: string | null }
type StockLevel = {
  item_id: string
  warehouse_id: string | null
  bin_id: string | null
  qty: number | null
  allocated_qty: number | null
}

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''))

type OutputSplit = { id: string; warehouseId: string; binId: string; qty: string }
type ComponentSourceRow = { id: string; warehouseId: string; binId: string; sharePct: string }

type ComponentSourcesPayload = Array<{
  component_item_id: string
  sources: Array<{ warehouse_id: string; bin_id: string; share_pct: number }>
}>
type OutputSplitsPayload = Array<{ warehouse_id: string; bin_id: string; qty: number }>

export default function BOMPage() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { companyId, myRole } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'
  const [loading, setLoading] = useState(true)

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
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([])
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
  const [profileFieldsSupported, setProfileFieldsSupported] = useState(false)

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])
  const uomById  = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const canManageBom = can.createMaster(role)
  const canBuildAssembly = can.createMovement(role)

  // Initial load
  useEffect(() => {
    if (!companyId) {
      setItems([])
      setBoms([])
      setComponents([])
      setWarehouses([])
      setLoading(false)
      return
    }

    (async () => {
      try {
        setLoading(true)

        const itemViewRes = await supabase
          .from('items_view')
          .select('id,name,sku,baseUomId,primaryRole,trackInventory,canBuy,canSell,isAssembled,onHandQty,availableQty,hasActiveBom,usedAsComponent')
          .order('name', { ascending: true })

        if (!itemViewRes.error) {
          setProfileFieldsSupported(true)
          setItems(((itemViewRes.data || []) as any[]).map((row) => ({
            id: String(row.id),
            name: String(row.name || ''),
            sku: row.sku || null,
            base_uom_id: row.baseUomId || null,
            primary_role: row.primaryRole || 'general',
            track_inventory: Boolean(row.trackInventory),
            can_buy: Boolean(row.canBuy),
            can_sell: Boolean(row.canSell),
            is_assembled: Boolean(row.isAssembled),
            has_active_bom: Boolean(row.hasActiveBom),
            used_as_component: Boolean(row.usedAsComponent),
            on_hand_qty: Number(row.onHandQty || 0),
            available_qty: Number(row.availableQty || 0),
          })))
        } else {
          const it = await supabase
            .from('items')
            .select('id,name,sku,base_uom_id')
            .eq('company_id', companyId)
            .order('name', { ascending: true })
          if (it.error) throw it.error
          setProfileFieldsSupported(false)
          setItems(((it.data || []) as any[]).map((row) => ({
            id: String(row.id),
            name: String(row.name || ''),
            sku: row.sku || null,
            base_uom_id: row.base_uom_id || null,
            ...profileFromRole('general'),
          })))
        }

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
          .eq('company_id', companyId)
          .order('created_at', { ascending: true })
        if (bm.error) throw bm.error
        const list = ((bm.data || []) as any[]).map(b => ({ ...b, version: String(b.version ?? 'v1') })) as Bom[]
        setBoms(list)

        const wh = await supabase
          .from('warehouses')
          .select('id,name')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (wh.error) throw wh.error
        setWarehouses((wh.data || []) as Warehouse[])
        if (wh.data?.length) {
          setWarehouseFromId(wh.data[0].id as string)
          setWarehouseToId(wh.data[0].id as string)
        }
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || tt('bom.toast.loadFailed', 'Failed to load the Assembly workspace'))
      } finally {
        setLoading(false)
      }
    })()
  }, [companyId])

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

  useEffect(() => {
    (async () => {
      if (!companyId || !warehouseFromId) {
        setStockLevels([])
        return
      }
      const { data, error } = await supabase
        .from('stock_levels')
        .select('item_id,warehouse_id,bin_id,qty,allocated_qty')
        .eq('company_id', companyId)
        .eq('warehouse_id', warehouseFromId)
      if (error) {
        console.error(error)
        toast.error(error.message)
        return
      }
      setStockLevels((data || []) as StockLevel[])
    })()
  }, [companyId, warehouseFromId])

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
  }, [uoms, t])

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
    if (!newBomProductId) return toast.error(tt('bom.toast.selectProduct', 'Select a finished product'))
    const nameTrim = (newBomName || '').trim()
    if (!nameTrim) return toast.error(tt('bom.toast.nameRequired', 'Recipe name is required (for example, Cake v1)'))

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
      toast.success(tt('bom.toast.bomCreated', 'Recipe created'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('bom.toast.bomCreateFailed', 'Failed to create recipe'))
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
      toast.success(tt('bom.toast.bomUpdated', 'Recipe updated'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('bom.toast.bomUpdateFailed', 'Failed to update recipe'))
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
      toast.success(tt('bom.toast.bomDuplicated', 'Duplicated as {version}', { version: normalized.version }))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('bom.toast.bomDuplicateFailed', 'Failed to duplicate recipe'))
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
    if (!selectedBomId) return toast.error(tt('bom.toast.pickBom', 'Select a recipe first'))
    if (!compItemId) return toast.error(tt('bom.toast.componentRequired', 'Select a component item'))

    const qtyEntered = num(compQtyPer, 0)
    if (!(qtyEntered > 0)) return toast.error(tt('bom.toast.quantityPositive', 'Quantity must be greater than zero'))

    const scrap = Number(compScrap)
    if (!Number.isFinite(scrap) || scrap < 0 || scrap > 1) {
      return toast.error(tt('bom.toast.scrapRange', 'Scrap must stay between 0 and 1'))
    }

    const baseUom = itemById.get(compItemId)?.base_uom_id || ''
    const uomEntered = compUomId || baseUom

    let qtyBase = qtyEntered
    if (!idsOrCodesEqual(uomEntered, baseUom)) {
      if (!canConvert(uomEntered, baseUom)) return toast.error(tt('bom.recipe.invalidUom', 'The selected unit cannot convert to the item base unit.'))
      const conv = safeConvert(qtyEntered, uomEntered, baseUom)
      if (conv == null) return toast.error(tt('bom.toast.conversionMissing', 'No conversion path was found for this component unit.'))
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
    toast.success(tt('bom.toast.componentAdded', 'Component added'))
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
    toast.success(tt('bom.toast.componentRemoved', 'Component removed'))
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

  const componentSourcePayload = useComponentSources ? buildComponentSourcesPayload() : []
  const hasIncompleteComponentSourceRouting = useComponentSources
    && components.length > 0
    && componentSourcePayload.length !== components.length
  const hasInvalidAdvancedSplit = advanced
    && splits.length > 0
    && splits.some((split) => !(num(split.qty, 0) > 0 && isUuid(split.warehouseId) && !!split.binId))

  // Build
  async function runBuild() {
    if (!selectedBomId) return toast.error(tt('bom.toast.pickBom', 'Select a recipe first'))
    const qty = num(buildQty, 0)
    if (!(qty > 0)) return toast.error(tt('bom.toast.quantityPositive', 'Quantity must be greater than zero'))
    if (!components.length) return toast.error(tt('bom.toast.componentsRequired', 'Add recipe components before posting a build'))
    if (totalShortages > 0) return toast.error(tt('bom.plan.blockedShortage', 'The current plan is short on at least one component.'))

    try {
      setBuilding(true)

      if (useComponentSources) {
        if (hasIncompleteComponentSourceRouting || !componentSourcePayload.length) {
          setBuilding(false)
          return toast.error(tt('bom.toast.buildMissingSources', 'Add valid source routing for every component before posting this build.'))
        }

        const outSplits = buildOutputSplitsPayload(qty)
        if (!outSplits || hasInvalidAdvancedSplit) {
          setBuilding(false)
          return toast.error(tt('bom.toast.invalidDestination', 'Select a valid destination bin or complete every destination split.'))
        }

        const { error } = await supabase.rpc('build_from_bom_sources', {
          p_bom_id: selectedBomId,
          p_qty: qty,
          p_component_sources: componentSourcePayload,
          p_output_splits: outSplits,
        })
        if (error) {
          console.error('[build_from_bom_sources] error', error, { componentSourcePayload, outSplits })
          if (error.code === '42883' || /does not exist/i.test(error.message || '')) {
            toast.error(tt('bom.toast.buildRpcMissing', 'The Assembly source-routing RPC is not available in the current database.'))
          } else {
            toast.error(error.message || tt('bom.toast.buildFailed', 'Build failed'))
          }
        } else {
          setBuildQty('')
          setSplits([])
          toast.success(tt('bom.toast.buildCreated', 'Build posted'))
        }
        setBuilding(false)
        return
      }

      // Legacy single-source path
      if (!isUuid(warehouseFromId) || !binFromId) {
        setBuilding(false)
        return toast.error(tt('bom.toast.invalidSource', 'Select a valid source warehouse and bin before posting the build.'))
      }

      const runs: Array<{ qty: number; wTo: string; bTo: string }> =
        advanced && splits.length
          ? splits.map(s => ({ qty: num(s.qty, 0), wTo: s.warehouseId, bTo: s.binId }))
                  .filter(s => s.qty > 0 && isUuid(s.wTo) && !!s.bTo)
          : (isUuid(warehouseToId) && !!binToId)
              ? [{ qty, wTo: warehouseToId, bTo: binToId }]
              : []

      if (!runs.length || hasInvalidAdvancedSplit) {
        setBuilding(false)
        return toast.error(tt('bom.toast.invalidDestination', 'Select a valid destination bin or complete every destination split.'))
      }

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
      toast.success(advanced ? tt('bom.toast.buildCreatedAdvanced', 'Builds posted') : tt('bom.toast.buildCreated', 'Build posted'))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('bom.toast.buildFailed', 'Build failed'))
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

  const selectedProduct = useMemo(
    () => (selectedBom ? itemById.get(selectedBom.product_id) || null : null),
    [selectedBom, itemById],
  )

  const selectedProductWarnings = useMemo(() => {
    if (!selectedProduct) return []
    return deriveItemProfileWarnings({
      primaryRole: selectedProduct.primary_role || 'general',
      trackInventory: Boolean(selectedProduct.track_inventory ?? true),
      canBuy: Boolean(selectedProduct.can_buy ?? true),
      canSell: Boolean(selectedProduct.can_sell ?? true),
      isAssembled: Boolean(selectedProduct.is_assembled ?? false),
      hasActiveBom: Boolean(selectedProduct.has_active_bom ?? selectedBom),
      usedAsComponent: Boolean(selectedProduct.used_as_component),
      minStock: 0,
    })
  }, [selectedProduct, selectedBom])

  const plannedQty = num(buildQty, 0)

  const stockByItem = useMemo(() => {
    const map = new Map<string, { warehouseQty: number; warehouseAvailable: number; binQty: Record<string, number>; binAvailable: Record<string, number> }>()
    for (const row of stockLevels) {
      const itemId = String(row.item_id || '')
      if (!itemId) continue
      if (!map.has(itemId)) {
        map.set(itemId, { warehouseQty: 0, warehouseAvailable: 0, binQty: {}, binAvailable: {} })
      }
      const bucket = map.get(itemId)!
      const qty = num(row.qty, 0)
      const available = Math.max(qty - num(row.allocated_qty, 0), 0)
      bucket.warehouseQty += qty
      bucket.warehouseAvailable += available
      const binId = String(row.bin_id || '')
      if (binId) {
        bucket.binQty[binId] = (bucket.binQty[binId] || 0) + qty
        bucket.binAvailable[binId] = (bucket.binAvailable[binId] || 0) + available
      }
    }
    return map
  }, [stockLevels])

  const componentPlanning = useMemo(() => {
    return components.map((component) => {
      const item = itemById.get(component.component_item_id) || null
      const usagePerUnit = num(component.qty_per, 0) * (1 + num(component.scrap_pct, 0))
      const stockBucket = stockByItem.get(component.component_item_id)
      const available = binFromId
        ? num(stockBucket?.binAvailable?.[binFromId], 0)
        : num(stockBucket?.warehouseAvailable, 0)
      const availableOnHand = binFromId
        ? num(stockBucket?.binQty?.[binFromId], 0)
        : num(stockBucket?.warehouseQty, 0)
      const required = plannedQty > 0 ? usagePerUnit * plannedQty : 0
      const shortage = Math.max(required - available, 0)
      const maxBuildable = usagePerUnit > 0 ? available / usagePerUnit : null
      const warnings = item
        ? deriveItemProfileWarnings({
            primaryRole: item.primary_role || 'general',
            trackInventory: Boolean(item.track_inventory ?? true),
            canBuy: Boolean(item.can_buy ?? true),
            canSell: Boolean(item.can_sell ?? true),
            isAssembled: Boolean(item.is_assembled ?? false),
            hasActiveBom: Boolean(item.has_active_bom),
            usedAsComponent: true,
            minStock: 0,
          })
        : []

      return {
        ...component,
        item,
        usagePerUnit,
        available,
        availableOnHand,
        required,
        shortage,
        maxBuildable,
        warnings,
      }
    })
  }, [components, itemById, stockByItem, binFromId, plannedQty])

  const limitingComponent = useMemo(() => {
    return componentPlanning
      .filter((row) => row.maxBuildable != null)
      .sort((left, right) => num(left.maxBuildable, Infinity) - num(right.maxBuildable, Infinity))[0] || null
  }, [componentPlanning])

  const totalShortages = useMemo(
    () => componentPlanning.filter((row) => row.shortage > 0).length,
    [componentPlanning],
  )

  const maxBuildableNow = limitingComponent?.maxBuildable != null
    ? Math.max(Math.floor(num(limitingComponent.maxBuildable, 0) * 100) / 100, 0)
    : 0

  const buildBlockers = useMemo(() => {
    const blockers: string[] = []
    if (!selectedBomId) blockers.push(tt('bom.toast.pickBom', 'Select a recipe first'))
    if (!components.length) blockers.push(tt('bom.toast.componentsRequired', 'Add recipe components before posting a build'))
    if (plannedQty <= 0) blockers.push(tt('bom.plan.needQuantity', 'Enter a build quantity to run the stock check.'))
    if (totalShortages > 0) blockers.push(tt('bom.plan.blockedShortage', 'The current plan is short on at least one component.'))
    if (useComponentSources) {
      if (hasIncompleteComponentSourceRouting || !componentSourcePayload.length) {
        blockers.push(tt('bom.toast.buildMissingSources', 'Add valid source routing for every component before posting this build.'))
      }
    } else if (!isUuid(warehouseFromId) || !binFromId) {
      blockers.push(tt('bom.toast.invalidSource', 'Select a valid source warehouse and bin before posting the build.'))
    }

    if (advanced) {
      if (!splits.length || hasInvalidAdvancedSplit) {
        blockers.push(tt('bom.toast.invalidDestination', 'Select a valid destination bin or complete every destination split.'))
      }
    } else if (!isUuid(warehouseToId) || !binToId) {
      blockers.push(tt('bom.toast.invalidDestination', 'Select a valid destination bin or complete every destination split.'))
    }
    return blockers
  }, [
    advanced,
    binFromId,
    binToId,
    componentSourcePayload.length,
    components.length,
    hasIncompleteComponentSourceRouting,
    hasInvalidAdvancedSplit,
    plannedQty,
    selectedBomId,
    splits.length,
    t,
    totalShortages,
    useComponentSources,
    warehouseFromId,
    warehouseToId,
  ])

  const buildIsReady = canBuildAssembly && buildBlockers.length === 0

  const buildDestinationLabel = useMemo(() => {
    if (advanced && splits.length) return tt('bom.destination.multiple', 'Multiple destination bins')
    const warehouse = warehouses.find((row) => row.id === warehouseToId)
    const bin = binsTo.find((row) => row.id === binToId)
    if (!warehouse) return tt('bom.destination.missing', 'Choose a destination')
    if (!bin) return warehouse.name
    return `${warehouse.name} - ${bin.code}`
  }, [advanced, splits, warehouses, warehouseToId, binsTo, binToId, t])

  if (loading) return <div className="p-6">{t('loading')}</div>

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
      <div className="overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card via-card to-muted/25 shadow-sm">
        <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr,0.8fr] lg:p-8">
          <div className="space-y-3">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.24em]">
              {tt('bom.eyebrow', 'Production clarity')}
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight">{t('bom.title')}</h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {tt(
                  'bom.subtitlePhase3b',
                  'Use Assembly to plan what you are building, check component sufficiency, and then post the build with clear source and destination decisions.',
                )}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="border-border/60 bg-background/80 shadow-sm">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{tt('bom.summary.recipes', 'Active recipes')}</div>
                <div className="mt-2 text-3xl font-semibold">{boms.length}</div>
                <div className="mt-2 text-sm text-muted-foreground">{tt('bom.summary.recipesHelp', 'BOM versions available for finished products.')}</div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-background/80 shadow-sm">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{tt('bom.summary.components', 'Components')}</div>
                <div className="mt-2 text-3xl font-semibold">{components.length}</div>
                <div className="mt-2 text-sm text-muted-foreground">{tt('bom.summary.componentsHelp', 'Lines currently defined for the selected assembly recipe.')}</div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-background/80 shadow-sm">
              <CardContent className="p-5">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{tt('bom.summary.maxBuildable', 'Buildable now')}</div>
                <div className="mt-2 text-3xl font-semibold">{selectedBom ? maxBuildableNow.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
                <div className="mt-2 text-sm text-muted-foreground">{tt('bom.summary.maxBuildableHelp', 'Estimated from the current source stock before you post the build.')}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">{t('bom.helperTitle')}</div>
            <div className="text-sm text-muted-foreground">{t('bom.helperBody')}</div>
          </div>
          <Button asChild variant="outline">
            <Link to="/landed-cost">{t('landedCost.title')}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle>{tt('bom.targetTitle', 'What are you building?')}</CardTitle>
          <CardDescription>
            {tt(
              'bom.targetHelp',
              'Choose the assembly recipe first. The planning, stock sufficiency, and build action all follow the selected finished product.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr,1fr]">
          <div className="space-y-2">
            <Label>{tt('bom.targetSelect', 'Assembly recipe')}</Label>
            <Select value={selectedBomId} onValueChange={setSelectedBomId}>
              <SelectTrigger aria-label={tt('bom.targetSelect', 'Assembly recipe')}><SelectValue placeholder={tt('bom.targetPlaceholder', 'Select a recipe to plan or build')} /></SelectTrigger>
              <SelectContent className="max-h-64 overflow-auto">
                {boms.map((bom) => {
                  const productName = itemById.get(bom.product_id)?.name ?? bom.product_id
                  return (
                    <SelectItem key={bom.id} value={bom.id}>
                      {productName} — {bom.name}{bom.is_active ? '' : ` (${tt('common.inactive', 'inactive')})`}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          {selectedBom ? (
            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-lg font-semibold">{selectedProduct?.name ?? selectedBom.name}</div>
                <Badge>{selectedBom.version}</Badge>
                {selectedProduct?.is_assembled || selectedProduct?.has_active_bom ? (
                  <Badge variant="outline">{tt('bom.targetAssembled', 'Assembly-ready item')}</Badge>
                ) : (
                  <Badge variant="secondary">{tt('bom.targetNeedsProfile', 'Review item profile')}</Badge>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.targetStockedAs', 'Stocked as')}</div>
                  <div className="mt-1 text-sm">{selectedProduct?.sku || tt('bom.targetNoSku', 'No SKU')}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.targetCurrentAvailability', 'Current availability')}</div>
                  <div className="mt-1 text-sm">
                    {profileFieldsSupported
                      ? `${num(selectedProduct?.available_qty, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${uomById.get(selectedProduct?.base_uom_id || '')?.code || ''}`.trim()
                      : tt('bom.targetAvailabilityPending', 'Available after item-profile migration')}
                  </div>
                </div>
              </div>
              {selectedProductWarnings.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedProductWarnings.map((warning) => (
                    <Badge key={warning} variant="secondary" className="max-w-full whitespace-normal">
                      {warning === 'bom_without_assembled_flag'
                        ? tt('bom.warning.profileMismatch', 'This product has a BOM but is not classified as assembled on the item master.')
                        : warning === 'assembled_without_bom'
                          ? tt('bom.warning.missingRecipe', 'This product is marked as assembled but still needs an active recipe.')
                          : tt('bom.warning.reviewProfile', 'Review the item profile before relying on this build path.')}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6 text-sm text-muted-foreground">
              {tt('bom.targetEmpty', 'Select an assembly recipe to see component sufficiency, destination planning, and the build action.')}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recipe creation */}
      <Card>
        <CardHeader>
          <CardTitle>{tt('bom.recipeCreateTitle', 'Create an assembly recipe')}</CardTitle>
          <CardDescription>
            {tt('bom.recipeCreateHelp', 'Use this when a finished product does not yet have a BOM. Recipe setup is separate from posting the build itself.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Label>{t('orders.item')}</Label>
            <Select value={newBomProductId} onValueChange={setNewBomProductId}>
              <SelectTrigger><SelectValue placeholder={tt('bom.recipeCreatePlaceholder', 'Select the finished product')} /></SelectTrigger>
              <SelectContent className="max-h-64 overflow-auto">
                {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="text-[11px] text-muted-foreground mt-1">
              {tt('bom.recipeCreateHint', 'Pick the exact item you will stock as the finished output.')}
            </div>
          </div>
          <div>
            <Label>{t('items.fields.name')}</Label>
            <Input value={newBomName} onChange={e => setNewBomName(e.target.value)} placeholder={tt('bom.recipeCreateNamePlaceholder', 'e.g. Sweet Bread v1')} />
            <div className="text-[11px] text-muted-foreground mt-1">
              {tt('bom.recipeCreateVersionHint', 'Include a version in the recipe name so later revisions stay traceable.')}
            </div>
          </div>
          <div className="md:col-span-1 flex items-end">
            <Button onClick={createBomForProduct} disabled={!canManageBom || !newBomProductId || !newBomName.trim()}>
              {tt('bom.recipeCreateAction', 'Create recipe')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Pick + Edit existing BOM */}
      <Card>
        <CardHeader>
          <CardTitle>{tt('bom.recipeManageTitle', 'Maintain recipe versions')}</CardTitle>
          <CardDescription>
            {tt('bom.recipeManageHelp', 'Choose the recipe version that should drive the current build. Update names or duplicate to create a controlled next revision.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>{tt('bom.recipeSelect', 'Recipe')}</Label>
            <Select value={selectedBomId} onValueChange={setSelectedBomId}>
              <SelectTrigger><SelectValue placeholder={tt('bom.recipeSelectPlaceholder', 'Select a recipe')} /></SelectTrigger>
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
                <Label>{t('items.fields.name')}</Label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              <div>
                <Label>{tt('bom.recipeVersion', 'Version')}</Label>
                <Input value={editVersion} onChange={e => setEditVersion(e.target.value)} />
              </div>
              <div className="col-span-2 flex gap-2">
                <Button onClick={saveBomMeta} disabled={!canManageBom || savingBOM}>
                  {savingBOM ? t('actions.saving') : t('actions.save')}
                </Button>
                <Button variant="secondary" onClick={duplicateAsNewVersion} disabled={!canManageBom || duplicating}>
                  {duplicating ? 'Duplicating…' : 'Duplicate as new version'}
                </Button>
              </div>
              <div className="col-span-2 text-[11px] text-muted-foreground">
                {tt('bom.recipeManageHint', 'Save to refine this version, or duplicate it to create the next controlled revision with the same components.')}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Components */}
      {!!selectedBom && (
        <Card>
          <CardHeader>
            <CardTitle>{tt('bom.recipeComponentsTitle', 'Recipe components')}</CardTitle>
            <CardDescription>
              {tt('bom.recipeComponentsHelp', 'Define what the build consumes for one finished unit. These lines power the sufficiency check and the stock movements posted during build execution.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">{t('table.item')}</th>
                  <th className="py-2 pr-2">{tt('bom.recipe.qtyPer', 'Qty per unit')}</th>
                  <th className="py-2 pr-2">{t('items.table.baseUom')}</th>
                  <th className="py-2 pr-2">{tt('bom.recipe.scrap', 'Scrap (0..1)')}</th>
                  <th className="py-2 pr-2"></th>
                </tr>
              </thead>
              <tbody>
                {components.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-muted-foreground">{t('common.none')}</td></tr>
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
                          <Button variant="destructive" onClick={() => deleteComponent(c.id)} disabled={!canManageBom}>{t('common.remove')}</Button>
                          <Button variant="secondary" onClick={() => addSourceRow(c.component_item_id)} disabled={!useComponentSources || !canManageBom}>
                            {tt('bom.recipe.addSource', 'Add source')}
                          </Button>
                        </td>
                      </tr>

                      {useComponentSources && (
                        <tr className="border-b">
                          <td colSpan={5} className="py-3">
                            <div className="space-y-2">
                              {sources.length === 0 && (
                                <div className="text-[11px] text-muted-foreground">{tt('bom.recipe.sourcesEmpty', 'No source routing has been configured for this component yet.')}</div>
                              )}
                              {sources.map(row => {
                                const bins = row.warehouseId ? (binCache[row.warehouseId] || []) : []
                                return (
                                  <div key={row.id} className="grid md:grid-cols-4 gap-2">
                                    <div>
                                      <Label>{t('orders.fromWarehouse')}</Label>
                                      <Select
                                        value={row.warehouseId}
                                        onValueChange={async (v) => {
                                          updateSourceRow(c.component_item_id, row.id, { warehouseId: v, binId: '' })
                                          await ensureBinsFor(v)
                                        }}>
                                        <SelectTrigger><SelectValue placeholder={t('orders.selectSourceWh')} /></SelectTrigger>
                                        <SelectContent>
                                          {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div>
                                      <Label>{t('orders.fromBin')}</Label>
                                      <Select
                                        value={row.binId}
                                        onValueChange={(v) => updateSourceRow(c.component_item_id, row.id, { binId: v })}
                                        disabled={!row.warehouseId}
                                      >
                                        <SelectTrigger><SelectValue placeholder={row.warehouseId ? t('orders.selectSourceBin') : t('movements.pickFromBinFirst')} /></SelectTrigger>
                                        <SelectContent className="max-h-64 overflow-auto">
                                          {bins.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div>
                                      <Label>{tt('bom.recipe.sharePct', 'Share %')}</Label>
                                      <Input
                                        type="number"
                                        min="0" max="100" step="0.01"
                                        value={row.sharePct}
                                        onChange={e => updateSourceRow(c.component_item_id, row.id, { sharePct: e.target.value })}
                                        placeholder={tt('bom.recipe.sharePlaceholder', 'e.g. 60')}
                                      />
                                    </div>
                                    <div className="flex items-end">
                                      <Button variant="destructive" onClick={() => removeSourceRow(c.component_item_id, row.id)} disabled={!canManageBom}>{t('common.remove')}</Button>
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
                <Label>{t('table.item')}</Label>
                <Select value={compItemId} onValueChange={(v) => { setCompItemId(v); setCompQtyPer('1') }}>
                  <SelectTrigger><SelectValue placeholder={t('movements.selectItem')} /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>{t('orders.qty')}</Label>
                <Input type="number" min="0.0001" step="0.0001" value={compQtyPer} onChange={e => setCompQtyPer(e.target.value)} placeholder="1" />
              </div>

              <div>
                <Label>{t('orders.uom')}</Label>
                <Select
                  value={compUomId}
                  onValueChange={(uomId) => {
                    const base = itemById.get(compItemId)?.base_uom_id || ''
                    if (!base) { setCompUomId(uomId); return }
                    if (idsOrCodesEqual(uomId, base)) { setCompUomId(uomId); return }
                    if (!canConvert(uomId, base)) {
                      toast.error(tt('bom.recipe.invalidUom', 'The selected unit cannot convert to the item base unit.'))
                      setCompUomId(base)
                      return
                    }
                    setCompUomId(uomId)
                  }}
                  disabled={!compItemId}
                >
                  <SelectTrigger><SelectValue placeholder={compItemId ? t('movements.selectUom') : t('movements.pickItemFirst')} /></SelectTrigger>
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
                <Label>{tt('bom.recipe.scrap', 'Scrap (0..1)')}</Label>
                <Input type="number" min="0" max="1" step="0.01" value={compScrap} onChange={e => setCompScrap(e.target.value)} placeholder="0" />
              </div>

              <div className="md:col-span-2 flex items-end">
                <Button onClick={addComponentLine} disabled={!canManageBom || !compItemId}>{t('bom.addComponent')}</Button>
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
              {tt('bom.recipe.qtyHint', 'Quantities above are defined for one finished unit in the finished item base unit.')}
            </div>

            {/* Toggle per-component sources */}
            <div className="mt-3 flex items-center gap-2">
              <input id="pcs" type="checkbox" className="h-4 w-4" checked={useComponentSources} onChange={(e) => setUseComponentSources(e.target.checked)} />
              <Label htmlFor="pcs">{tt('bom.recipe.useSources', 'Use per-component source bins during build')}</Label>
            </div>
            {useComponentSources && (
              <div className="text-[11px] text-muted-foreground mt-1">
                {tt('bom.recipe.useSourcesHelp', 'Add source rows under each component. Shares are normalized automatically before the build RPC runs.')}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!!selectedBom && (
        <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
          <Card className="border-border/70 bg-card shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle>{tt('bom.planTitle', 'Plan this build')}</CardTitle>
              <CardDescription>
                {tt('bom.planHelp', 'Set the quantity, pick the source stock, and decide where the finished output will land before you post the build.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assembly-build-qty">{t('orders.qty')}</Label>
                  <Input id="assembly-build-qty" type="number" min="0.0001" step="0.0001" value={buildQty} onChange={e => setBuildQty(e.target.value)} placeholder="1" />
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.plan.timeTitle', 'Time estimate')}</div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    {tt('bom.plan.timeHelp', 'Phase 3C will add per-unit time, setup time, and work-hour planning. For now, Assembly focuses on stock sufficiency and execution readiness.')}
                  </div>
                </div>
              </div>

              {!useComponentSources && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t('orders.fromWarehouse')}</Label>
                    <Select value={warehouseFromId} onValueChange={(value) => { setWarehouseFromId(value); setBinFromId('') }}>
                      <SelectTrigger aria-label={t('orders.fromWarehouse')}><SelectValue placeholder={t('orders.selectSourceWh')} /></SelectTrigger>
                      <SelectContent>
                        {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('orders.fromBin')}</Label>
                    <Select value={binFromId} onValueChange={setBinFromId}>
                      <SelectTrigger aria-label={t('orders.fromBin')}><SelectValue placeholder={t('orders.selectSourceBin')} /></SelectTrigger>
                      <SelectContent className="max-h-64 overflow-auto">
                        {binsFrom.map((bin) => <SelectItem key={bin.id} value={bin.id}>{bin.code} — {bin.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {!advanced && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t('orders.toWarehouse')}</Label>
                    <Select value={warehouseToId} onValueChange={(value) => { setWarehouseToId(value); setBinToId('') }}>
                      <SelectTrigger aria-label={t('orders.toWarehouse')}><SelectValue placeholder={t('orders.selectDestWh')} /></SelectTrigger>
                      <SelectContent>
                        {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('orders.toBin')}</Label>
                    <Select value={binToId} onValueChange={setBinToId}>
                      <SelectTrigger aria-label={t('orders.toBin')}><SelectValue placeholder={t('orders.selectDestBin')} /></SelectTrigger>
                      <SelectContent className="max-h-64 overflow-auto">
                        {binsTo.map((bin) => <SelectItem key={bin.id} value={bin.id}>{bin.code} — {bin.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{tt('bom.plan.advancedTitle', 'Advanced output routing')}</div>
                    <div className="text-sm text-muted-foreground">{tt('bom.plan.advancedHelp', 'Use this only when the finished output must be split across multiple destination bins or components need explicit source routing.')}</div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input id="adv-clarity" type="checkbox" className="h-4 w-4" checked={advanced} onChange={e => setAdvanced(e.target.checked)} />
                    <span>{tt('bom.plan.advancedToggle', 'Split output across bins')}</span>
                  </label>
                </div>
                {advanced && (
                  <div className="mt-4 space-y-2">
                    {splits.map((split) => {
                      const destBins = split.warehouseId ? (binCache[split.warehouseId] || []) : []
                      return (
                        <div key={split.id} className="grid gap-3 md:grid-cols-4">
                          <div className="space-y-2">
                            <Label>{t('orders.toWarehouse')}</Label>
                            <Select
                              value={split.warehouseId}
                              onValueChange={async (value) => {
                                updateSplit(split.id, { warehouseId: value, binId: '' })
                                await ensureBinsFor(value)
                              }}
                            >
                              <SelectTrigger><SelectValue placeholder={t('orders.toWarehouse')} /></SelectTrigger>
                              <SelectContent>
                                {warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>{t('orders.toBin')}</Label>
                            <Select value={split.binId} onValueChange={(value) => updateSplit(split.id, { binId: value })} disabled={!split.warehouseId}>
                              <SelectTrigger><SelectValue placeholder={split.warehouseId ? t('orders.toBin') : t('movements.pickToBinFirst')} /></SelectTrigger>
                              <SelectContent className="max-h-64 overflow-auto">
                                {destBins.map((bin) => <SelectItem key={bin.id} value={bin.id}>{bin.code} — {bin.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>{t('orders.qty')}</Label>
                            <Input type="number" min="0.0001" step="0.0001" value={split.qty} onChange={e => updateSplit(split.id, { qty: e.target.value })} placeholder="0" />
                          </div>
                          <div className="flex items-end">
                            <Button variant="destructive" onClick={() => removeSplit(split.id)}>{t('common.remove')}</Button>
                          </div>
                        </div>
                      )
                    })}
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        const nextWh = warehouseToId || (warehouses[0]?.id || '')
                        if (nextWh) await ensureBinsFor(nextWh)
                        setSplits(prev => [...prev, { id: crypto.randomUUID(), warehouseId: nextWh, binId: '', qty: '' }])
                      }}
                    >
                      {tt('bom.plan.addSplit', 'Add destination split')}
                    </Button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
                <div className="text-sm font-medium">{tt('bom.plan.summaryTitle', 'Build summary')}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.plan.summaryTarget', 'Target output')}</div>
                    <div className="mt-1 text-sm">{selectedProduct?.name ?? selectedBom.name}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.plan.summaryDestination', 'Destination')}</div>
                    <div className="mt-1 text-sm">{buildDestinationLabel}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.plan.summaryLimit', 'Limiting factor')}</div>
                    <div className="mt-1 text-sm">
                      {limitingComponent?.item?.name
                        ? `${limitingComponent.item.name} (${maxBuildableNow.toLocaleString(undefined, { maximumFractionDigits: 2 })})`
                        : tt('bom.plan.summaryLimitNone', 'Add components and select a source to estimate this.')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.plan.summaryShortages', 'Shortages')}</div>
                    <div className="mt-1 text-sm">
                      {totalShortages > 0
                        ? tt('bom.plan.summaryShortagesCount', '{count} component(s) short', { count: totalShortages })
                        : tt('bom.plan.summaryShortagesNone', 'No shortages detected for the current plan')}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {!canBuildAssembly ? <Badge variant="secondary">{tt('bom.permission.build', 'View only. Operator or above is required to post builds.')}</Badge> : null}
                  {plannedQty <= 0 ? <Badge variant="secondary">{tt('bom.plan.needQuantity', 'Enter a build quantity to run the stock check.')}</Badge> : null}
                  {totalShortages > 0 ? <Badge variant="destructive">{tt('bom.plan.blockedShortage', 'The current plan is short on at least one component.')}</Badge> : null}
                  {buildIsReady ? <Badge>{tt('bom.plan.ready', 'The current stock plan is ready to build.')}</Badge> : null}
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
                <div className="text-sm font-medium">{tt('bom.plan.readinessTitle', 'Build readiness')}</div>
                {buildBlockers.length ? (
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {buildBlockers.map((reason) => (
                      <li key={reason} className="flex gap-2">
                        <span className="mt-1 inline-block h-2 w-2 rounded-full bg-destructive/80" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {tt(
                      'bom.plan.readinessHelp',
                      'Source stock, destination routing, and component sufficiency are all aligned for the current build plan.',
                    )}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={runBuild} disabled={building || !buildIsReady}>
                  {building ? tt('bom.building', 'Building...') : t('bom.build')}
                </Button>
                <div className="flex items-center text-sm text-muted-foreground">
                  {tt('bom.plan.postHelp', 'After a successful build, the quantity input clears so the operator can see the action posted.')}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle>{tt('bom.sufficiencyTitle', 'Components and stock sufficiency')}</CardTitle>
              <CardDescription>
                {tt('bom.sufficiencyHelp', 'Review what will be consumed, what is available in the chosen source, and which component limits the planned output.')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {componentPlanning.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/80 bg-muted/10 p-6 text-sm text-muted-foreground">
                  {tt('bom.sufficiencyEmpty', 'Add recipe components below before you try to plan or post a build.')}
                </div>
              ) : (
                <div className="space-y-3">
                  {componentPlanning.map((row) => (
                    <div key={row.id} className="rounded-2xl border border-border/70 bg-background/80 p-4 transition-colors hover:bg-muted/15">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{row.item?.name ?? row.component_item_id}</div>
                          <div className="text-sm text-muted-foreground">
                            {tt('bom.sufficiency.perUnit', 'Per unit')}: {row.usagePerUnit.toLocaleString(undefined, { maximumFractionDigits: 4 })} {uomLabel(row.item?.base_uom_id)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {row.shortage > 0 ? (
                            <Badge variant="destructive">
                              {tt('bom.sufficiency.shortage', 'Short by {qty}', { qty: row.shortage.toLocaleString(undefined, { maximumFractionDigits: 2 }) })}
                            </Badge>
                          ) : (
                            <Badge>{tt('bom.sufficiency.enough', 'Sufficient for current plan')}</Badge>
                          )}
                          {row.warnings.length > 0 ? <Badge variant="secondary">{tt('bom.sufficiency.profileWarning', 'Review item profile')}</Badge> : null}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-4">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.sufficiency.required', 'Required')}</div>
                          <div className="mt-1 text-sm">{row.required.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.sufficiency.available', 'Available')}</div>
                          <div className="mt-1 text-sm">{row.available.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.sufficiency.onHand', 'On hand')}</div>
                          <div className="mt-1 text-sm">{row.availableOnHand.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{tt('bom.sufficiency.maxBuildable', 'Buildable')}</div>
                          <div className="mt-1 text-sm">
                            {row.maxBuildable != null ? row.maxBuildable.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
