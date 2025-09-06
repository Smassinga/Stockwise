// src/pages/StockMovements.tsx
import { useEffect, useMemo, useState } from 'react'
import { db, supabase } from '../lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import toast from 'react-hot-toast'
import { buildConvGraph, convertQty, type ConvRow } from '../lib/uom'
import { useI18n } from '../lib/i18n'

type Warehouse = { id: string; name: string; code?: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }
type Item = { id: string; name: string; sku: string; baseUomId: string }
type Uom = { id: string; code: string; name: string; family?: string }

type DBStockLevelRow = {
  id: string
  item_id: string
  warehouse_id: string
  bin_id: string | null
  qty: number | null
  allocated_qty?: number | null
  avg_cost?: number | null
  updated_at?: string | null
}

type StockLevel = {
  id: string
  itemId: string
  warehouseId: string
  binId: string | null
  onHandQty: number
  allocatedQty: number
  avgCost: number
  updatedAt?: string | null
}

type MovementType = 'receive' | 'issue' | 'transfer' | 'adjust'
type RefType = 'SO' | 'PO' | 'ADJUST' | 'TRANSFER' | 'WRITE_OFF' | 'INTERNAL_USE' | ''

const nowISO = () => new Date().toISOString()
const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const fmtAcct = (v: number) => { const n = Math.abs(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); return v<0?`(${n})`:n }

const DEFAULT_REF_BY_MOVE: Record<MovementType, RefType> = {
  receive: 'ADJUST',
  issue: 'ADJUST',
  transfer: 'TRANSFER',
  adjust: 'ADJUST',
}

export default function StockMovements() {
  const { t } = useI18n()

  // Tiny helper: if a key is missing and the lib echoes the key, show a human fallback.
  const tt = (key: string, fallback: string) => {
    const val = t(key as any)
    return val === key ? fallback : val
  }

  // master data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [convGraph, setConvGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)

  // movement selections
  const [movementType, setMovementType] = useState<MovementType>('transfer')
  const [warehouseFromId, setWarehouseFromId] = useState<string>('')
  const [warehouseToId, setWarehouseToId] = useState<string>('')

  // bins & stock per warehouse
  const [binsFrom, setBinsFrom] = useState<Bin[]>([])
  const [binsTo, setBinsTo] = useState<Bin[]>([])
  const [stockFrom, setStockFrom] = useState<StockLevel[]>([])
  const [stockTo, setStockTo] = useState<StockLevel[]>([])

  // movement form
  const [fromBin, setFromBin] = useState<string>('')
  const [toBin, setToBin] = useState<string>('')
  const [itemId, setItemId] = useState<string>('')
  const [movementUomId, setMovementUomId] = useState<string>('')
  const [qtyEntered, setQtyEntered] = useState<string>('')
  const [unitCost, setUnitCost] = useState<string>('')
  const [notes, setNotes] = useState<string>('')

  // reference tagging (for COGS / audit)
  const [refType, setRefType] = useState<RefType>(DEFAULT_REF_BY_MOVE[movementType])
  const [refId, setRefId] = useState<string>('')
  const [refLineId, setRefLineId] = useState<string>('')

  // maps
  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const currentItem = useMemo(() => items.find(i => i.id === itemId) || null, [itemId, items])

  // load master & conversions (entity/tenant scoping is handled by RLS + warehouse filters)
  useEffect(() => {
    (async () => {
      try {
        const [whRes, itRes] = await Promise.all([
          db.warehouses.list({ orderBy: { name: 'asc' } }),
          supabase.from('items_view').select('id,name,sku,baseUomId').order('name', { ascending: true }),
        ])
        setWarehouses(whRes || [])
        if (itRes.error) throw itRes.error
        setItems((itRes.data || []) as Item[])

        if (whRes && whRes.length) {
          setWarehouseFromId(whRes[0].id)
          setWarehouseToId(whRes[0].id)
        }

        const uRes = await supabase.from('uoms').select('id,code,name,family').order('code', { ascending: true })
        if (uRes.error) throw uRes.error
        setUoms((uRes.data || []).map((u: any) => ({ ...u, code: String(u.code || '').toUpperCase() })))

        const { data: convRows, error: convErr } = await supabase.from('uom_conversions').select('from_uom_id,to_uom_id,factor')
        if (convErr) {
          console.warn('uom_conversions select failed:', convErr)
          toast.error(t('movements.uomLoadFailed'))
          setConvGraph(null)
        } else {
          setConvGraph(buildConvGraph((convRows || []) as ConvRow[]))
        }
      } catch (e: any) {
        console.error(e)
        toast.error(t('movements.loadFailed'))
      }
    })()
  }, [t])

  // helpers
  const mapSL = (r: DBStockLevelRow): StockLevel => ({
    id: r.id,
    itemId: r.item_id,
    warehouseId: r.warehouse_id,
    binId: r.bin_id ?? null,
    onHandQty: num(r.qty, 0),
    allocatedQty: num(r.allocated_qty, 0),
    avgCost: num(r.avg_cost, 0),
    updatedAt: r.updated_at ?? null,
  })

  const loadWH = async (whId: string, which: 'from' | 'to') => {
    if (!whId) {
      which === 'from' ? (setBinsFrom([]), setStockFrom([])) : (setBinsTo([]), setStockTo([]))
      return
    }
    const bb = await db.bins.list({ where: { warehouseId: whId }, orderBy: { code: 'asc' } })
    const { data: slRows, error: slErr } = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('warehouse_id', whId)
    if (slErr) throw slErr
    if (which === 'from') { setBinsFrom(bb || []); setStockFrom((slRows || []).map(mapSL)) }
    else { setBinsTo(bb || []); setStockTo((slRows || []).map(mapSL)) }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadWH(warehouseFromId, 'from')
        setFromBin('')
        if (movementType === 'issue') { setItemId(''); setQtyEntered(''); setMovementUomId('') }
      } catch (e: any) { console.error(e); toast.error(t('movements.loadFailedSourceWh')) }
    })()
  }, [warehouseFromId, movementType, t])

  useEffect(() => {
    (async () => {
      try {
        await loadWH(warehouseToId, 'to')
        setToBin('')
        if (movementType !== 'issue') { setItemId(''); setQtyEntered(''); setMovementUomId(''); setUnitCost('') }
      } catch (e: any) { console.error(e); toast.error(t('movements.loadFailedDestWh')) }
    })()
  }, [warehouseToId, movementType, t])

  // UoM helpers
  const uomIdFromIdOrCode = (v?: string | null): string => {
    if (!v) return ''
    if (uomById.has(v)) return v
    const needle = String(v).toUpperCase()
    for (const u of uoms) if ((u.code || '').toUpperCase() === needle) return u.id
    return ''
  }

  async function ensureUomPresent(idOrCode?: string | null) {
    if (!idOrCode) return
    if (uomById.has(idOrCode)) return
    const byCode = String(idOrCode).toUpperCase()
    const existsByCode = uoms.some(u => (u.code || '').toUpperCase() === byCode)
    if (existsByCode) return

    let fetched: Uom | null = null
    let res = await supabase.from('uoms').select('id,code,name,family').eq('id', idOrCode).limit(1)
    if (!res.error && res.data?.length) fetched = { ...res.data[0], code: String(res.data[0].code || '').toUpperCase() }
    else {
      res = await supabase.from('uoms').select('id,code,name,family').eq('code', byCode).limit(1)
      if (!res.error && res.data?.length) fetched = { ...res.data[0], code: String(res.data[0].code || '').toUpperCase() }
    }
    if (fetched) setUoms(prev => (prev.some(u => u.id === fetched!.id) ? prev : [...prev, fetched!]))
  }

  useEffect(() => {
    const raw = currentItem?.baseUomId
    ensureUomPresent(raw)
    setMovementUomId(uomIdFromIdOrCode(raw || ''))
    setQtyEntered('')
  }, [itemId])

  const codeOf = (id?: string) => (id ? (uomById.get(id)?.code || '').toUpperCase() : '')
  const idsOrCodesEqual = (aId?: string, bId?: string) => {
    if (!aId || !bId) return false
    if (aId === bId) return true
    const ac = codeOf(aId), bc = codeOf(bId)
    return !!(ac && bc && ac === bc)
  }

  const canConvert = useMemo(() => {
    return (fromId: string, toId: string) => {
      if (!fromId || !toId) return false
      if (idsOrCodesEqual(fromId, toId)) return true
      if (!convGraph) return false
      const visited = new Set<string>([fromId]); const q: string[] = [fromId]
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
  }, [convGraph, uomById])

  function safeConvert(qty: number, fromUomId: string, toUomId: string): number | null {
    if (idsOrCodesEqual(fromUomId, toUomId)) return qty
    if (!convGraph) return null
    try { return Number(convertQty(qty, fromUomId, toUomId, convGraph)) } catch { return null }
  }

  const fromBinItems = useMemo(() => {
    if (!fromBin) return []
    const rows = stockFrom.filter(s => (s.binId || null) === fromBin && num(s.onHandQty) > 0)
    const ids = Array.from(new Set(rows.map(r => r.itemId)))
    const list = ids.map(id => items.find(it => it.id === id)).filter(Boolean) as Item[]
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [fromBin, stockFrom, items])

  const onHandIn = (levels: StockLevel[], bin: string | null, itId: string) => {
    const row = levels.find(s => (s.binId || null) === (bin || null) && s.itemId === itId)
    return { qty: num(row?.onHandQty, 0), avgCost: num(row?.avgCost, 0) }
  }

  const itemBaseUomId = useMemo(() => uomIdFromIdOrCode(currentItem?.baseUomId || ''), [currentItem, uoms])

  const preview = useMemo(() => {
    const q = num(qtyEntered, 0)
    if (!q || !currentItem) return null
    const enteredUom = movementUomId || itemBaseUomId
    const base = safeConvert(q, enteredUom, itemBaseUomId)
    if (base == null) return { entered: q, base: q, uomEntered: enteredUom, baseUom: itemBaseUomId, invalid: true }
    return { entered: q, base, uomEntered: enteredUom, baseUom: itemBaseUomId, invalid: false }
  }, [qtyEntered, movementUomId, currentItem, itemBaseUomId])

  async function upsertStockLevel(whId: string, bin: string | null, itId: string, deltaQtyBase: number, opts?: { unitCost?: number }) {
    let q = supabase.from('stock_levels').select('id,qty,avg_cost').eq('warehouse_id', whId).eq('item_id', itId).limit(1)
    q = bin ? q.eq('bin_id', bin) : q.is('bin_id', null)
    const { data: found, error: selErr } = await q
    if (selErr) throw selErr

    const unitCost = num(opts?.unitCost, 0)

    if (!found?.length) {
      if (deltaQtyBase < 0) throw new Error(t('orders.insufficientStock'))
      const { error: insErr } = await supabase.from('stock_levels').insert({
        warehouse_id: whId, bin_id: bin, item_id: itId, qty: deltaQtyBase, allocated_qty: 0, avg_cost: unitCost, updated_at: nowISO(),
      })
      if (insErr) throw insErr
      return
    }

    const row = found[0] as { id: string; qty: number | null; avg_cost: number | null }
    const oldQty = num(row.qty, 0), oldAvg = num(row.avg_cost, 0)
    const newQty = oldQty + deltaQtyBase
    if (newQty < 0) throw new Error(t('orders.insufficientStock'))

    let newAvg = oldAvg
    if (deltaQtyBase > 0) newAvg = newQty > 0 ? ((oldQty * oldAvg) + (deltaQtyBase * unitCost)) / newQty : unitCost

    const { error: updErr } = await supabase
      .from('stock_levels')
      .update({ qty: newQty, avg_cost: newAvg, updated_at: nowISO() })
      .eq('id', row.id)
    if (updErr) throw updErr
  }

  // validate reference coherence
  function normalizeRefForSubmit(mt: MovementType, rt: RefType): RefType {
    if (mt === 'transfer') return 'TRANSFER'
    if (mt === 'receive' && rt === 'SO') return 'ADJUST'
    if (mt === 'issue' && rt === 'PO') return 'ADJUST'
    return rt || DEFAULT_REF_BY_MOVE[mt]
  }

  async function submitReceive() {
    if (!warehouseToId) return toast.error(t('orders.selectDestWh'))
    if (!toBin) return toast.error(t('orders.selectDestBin'))
    if (!currentItem) return toast.error(t('movements.selectItemRequired'))
    const qty = num(qtyEntered); if (qty <= 0) return toast.error(t('movements.qtyGtZero'))
    const uomId = movementUomId || itemBaseUomId
    const unitCostNum = num(unitCost, NaN); if (!Number.isFinite(unitCostNum) || unitCostNum < 0) return toast.error(t('movements.unitCostGteZero'))
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(t('movements.noConversionToBase'))

    await upsertStockLevel(warehouseToId, toBin, currentItem.id, qtyBase, { unitCost: unitCostNum })

    const rt = normalizeRefForSubmit('receive', refType)
    await supabase.from('stock_movements').insert({
      type: 'receive',
      item_id: currentItem.id,
      uom_id: uomId,
      qty,
      qty_base: qtyBase,
      unit_cost: unitCostNum,
      total_value: unitCostNum * qtyBase,
      warehouse_to_id: warehouseToId,
      bin_to_id: toBin,
      notes,
      created_by: 'system',
      ref_type: rt || 'ADJUST',
      ref_id: rt === 'PO' ? (refId || null) : null,
      ref_line_id: rt === 'PO' ? (refLineId || null) : null,
    })

    const { data: fresh } = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('warehouse_id', warehouseToId)
    setStockTo((fresh || []).map(mapSL))
    setQtyEntered(''); setUnitCost(''); setRefId(''); setRefLineId('')
    toast.success(t('movements.received'))
  }

  async function submitIssue() {
    if (!warehouseFromId) return toast.error(t('orders.selectSourceWh'))
    if (!fromBin) return toast.error(t('orders.selectSourceBin'))
    if (!currentItem) return toast.error(t('movements.selectItemRequired'))
    const qty = num(qtyEntered); if (qty <= 0) return toast.error(t('movements.qtyGtZero'))

    const uomId = movementUomId || itemBaseUomId
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(t('movements.noConversionToBase'))

    const { qty: onHand, avgCost } = onHandIn(stockFrom, fromBin, currentItem.id)
    if (onHand < qtyBase) return toast.error(t('orders.insufficientStock'))

    await upsertStockLevel(warehouseFromId, fromBin, currentItem.id, -qtyBase)

    const rt = normalizeRefForSubmit('issue', refType)
    await supabase.from('stock_movements').insert({
      type: 'issue',
      item_id: currentItem.id,
      uom_id: uomId,
      qty,
      qty_base: qtyBase,
      unit_cost: avgCost,
      total_value: avgCost * qtyBase,
      warehouse_from_id: warehouseFromId,
      bin_from_id: fromBin,
      notes,
      created_by: 'system',
      ref_type: rt || 'ADJUST',
      // Only SO-tagged issues count toward COGS on the dashboard
      ref_id: rt === 'SO' ? (refId || null) : null,
      ref_line_id: rt === 'SO' ? (refLineId || null) : null,
    })

    const { data: fresh } = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('warehouse_id', warehouseFromId)
    setStockFrom((fresh || []).map(mapSL))
    setQtyEntered(''); setRefId(''); setRefLineId('')
    toast.success(t('movements.issued'))
  }

  async function submitTransfer() {
    if (!warehouseFromId || !warehouseToId) return toast.error(t('movements.pickBothWh'))
    if (!fromBin || !toBin) return toast.error(t('movements.pickBothBins'))
    if (warehouseFromId === warehouseToId && fromBin === toBin) return toast.error(t('movements.sameSourceDest'))
    if (!currentItem) return toast.error(t('movements.selectItemRequired'))

    const qty = num(qtyEntered); if (qty <= 0) return toast.error(t('movements.qtyGtZero'))
    const uomId = movementUomId || itemBaseUomId
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(t('movements.noConversionToBase'))

    const { qty: onHand, avgCost } = onHandIn(stockFrom, fromBin, currentItem.id)
    if (onHand < qtyBase) return toast.error(t('orders.insufficientStock'))

    await upsertStockLevel(warehouseFromId, fromBin, currentItem.id, -qtyBase)
    await upsertStockLevel(warehouseToId, toBin, currentItem.id, qtyBase, { unitCost: avgCost })

    await supabase.from('stock_movements').insert({
      type: 'transfer',
      item_id: currentItem.id,
      uom_id: uomId,
      qty,
      qty_base: qtyBase,
      unit_cost: avgCost,
      total_value: avgCost * qtyBase,
      warehouse_from_id: warehouseFromId,
      warehouse_to_id: warehouseToId,
      bin_from_id: fromBin,
      bin_to_id: toBin,
      notes: `${t('movements.note.transferPrefix')}: ${warehouseFromId}/${fromBin} -> ${warehouseToId}/${toBin}${notes ? ` | ${notes}` : ''}`,
      created_by: 'system',
      ref_type: 'TRANSFER',
      ref_id: null,
      ref_line_id: null,
    })

    const [freshFrom, freshTo] = await Promise.all([
      supabase.from('stock_levels').select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at').eq('warehouse_id', warehouseFromId),
      supabase.from('stock_levels').select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at').eq('warehouse_id', warehouseToId),
    ])
    setStockFrom((freshFrom.data || []).map(mapSL))
    setStockTo((freshTo.data || []).map(mapSL))
    setQtyEntered('')
    toast.success(t('movements.transferCompleted'))
  }

  async function submitAdjust() {
    if (!warehouseToId) return toast.error(t('movements.selectWhToAdjust'))
    if (!toBin) return toast.error(t('movements.selectBinToAdjust'))
    if (!currentItem) return toast.error(t('movements.selectItemRequired'))

    const targetQtyEntered = num(qtyEntered)
    if (targetQtyEntered < 0) return toast.error(t('movements.onHandCannotBeNegative'))

    const uomId = movementUomId || itemBaseUomId
    const targetBase = safeConvert(targetQtyEntered, uomId, itemBaseUomId)
    if (targetBase == null) return toast.error(t('movements.noConversionToBase'))

    const { qty: currentBase, avgCost: currentAvg } = onHandIn(stockTo, toBin, currentItem.id)
    const delta = targetBase - currentBase
    if (delta === 0) return toast(t('movements.noChange'))

    let useUnitCost = currentAvg
    if (delta > 0) {
      const unitCostNum = num(unitCost, NaN)
      if (!Number.isFinite(unitCostNum) || unitCostNum < 0) return toast.error(t('movements.unitCostRequiredForIncrease'))
      useUnitCost = unitCostNum
    }

    await upsertStockLevel(warehouseToId, toBin, currentItem.id, delta, { unitCost: useUnitCost })

    const adjNote = t('movements.note.adjust', {
      target: targetQtyEntered,
      uom: (uomById.get(uomId)?.code || uomId).toString().toUpperCase(),
      current: currentBase
    })

    await supabase.from('stock_movements').insert({
      type: 'adjust',
      item_id: currentItem.id,
      uom_id: uomId,
      qty: targetQtyEntered,
      qty_base: targetBase,
      unit_cost: useUnitCost,
      total_value: Math.abs(delta) * useUnitCost,
      warehouse_to_id: warehouseToId,
      bin_to_id: toBin,
      notes: `${adjNote}${notes ? ` | ${notes}` : ''}`,
      created_by: 'system',
      ref_type: 'ADJUST',
      ref_id: null,
      ref_line_id: null,
    })

    const { data: fresh } = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('warehouse_id', warehouseToId)
    setStockTo((fresh || []).map(mapSL))
    setQtyEntered(''); setUnitCost('')
    toast.success(t('movements.adjusted'))
  }

  async function submit() {
    try {
      if (movementType === 'receive') return await submitReceive()
      if (movementType === 'issue') return await submitIssue()
      if (movementType === 'transfer') return await submitTransfer()
      if (movementType === 'adjust') return await submitAdjust()
    } catch (e: any) {
      console.error(e)
      toast.error(t('movements.failed'))
    }
  }

  function onChangeItem(v: string) { setItemId(v); setQtyEntered('') }
  function onChangeUom(uomId: string) {
    const baseId = itemBaseUomId
    if (!currentItem || !baseId) { setMovementUomId(''); return }
    if (idsOrCodesEqual(uomId, baseId)) { setMovementUomId(uomId); return }
    if (!canConvert(uomId, baseId)) { toast.error(t('movements.selectedUomNotConvertible')); setMovementUomId(baseId); return }
    setMovementUomId(uomId)
  }

  // keep ref type sensible when movement type changes
  useEffect(() => {
    setRefType(DEFAULT_REF_BY_MOVE[movementType])
    setRefId(''); setRefLineId('')
  }, [movementType])

  const selectedUomValue = currentItem ? (movementUomId || itemBaseUomId || '') : ''
  const uomsList = useMemo(() => uoms, [uoms])
  const showFromWH = movementType === 'issue' || movementType === 'transfer'
  const showToWH   = movementType !== 'issue'

  // Bin contents table (unchanged but localized)
  const itemsInSelectedBin = useMemo(() => {
    const selectedBin = fromBin || toBin
    if (!selectedBin) return []
    const levels = binsFrom.some(b => b.id === selectedBin) ? stockFrom : stockTo
    const rows = levels.filter(s => (s.binId || null) === selectedBin && num(s.onHandQty) > 0)
    const byItem = new Map<string, { item: Item; onHandQty: number; avgCost: number }>()
    for (const s of rows) {
      const it = items.find(x => x.id === s.itemId); if (!it) continue
      const qty = num(s.onHandQty, 0), avg = num(s.avgCost, 0)
      const prev = byItem.get(s.itemId)
      if (prev) {
        const totalQty = prev.onHandQty + qty
        const mergedAvg = totalQty > 0 ? ((prev.onHandQty * prev.avgCost) + (qty * avg)) / totalQty : prev.avgCost
        byItem.set(s.itemId, { item: it, onHandQty: totalQty, avgCost: mergedAvg })
      } else {
        byItem.set(s.itemId, { item: it, onHandQty: qty, avgCost: avg })
      }
    }
    return Array.from(byItem.values()).sort((a,b)=>a.item.name.localeCompare(b.item.name))
  }, [fromBin, toBin, stockFrom, stockTo, items, binsFrom])

  return (
    <div className="space-y-6">
      {/* Movement type + warehouses */}
      <div className="grid grid-cols-12 gap-3 items-end">
        <div className={`col-span-12 ${showFromWH && showToWH ? 'md:col-span-3' : 'md:col-span-4'}`}>
          <Label>{t('movements.movementType')}</Label>
          <Select value={movementType} onValueChange={(v: MovementType) => {
            setMovementType(v)
            setFromBin(''); setToBin(''); setItemId(''); setQtyEntered(''); setUnitCost(''); setNotes('')
            setMovementUomId('')
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="receive">{t('movement.receive')}</SelectItem>
              <SelectItem value="issue">{t('movement.issue')}</SelectItem>
              <SelectItem value="transfer">{t('movement.transfer')}</SelectItem>
              <SelectItem value="adjust">{t('movement.adjust')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showFromWH && (
          <div className="col-span-12 md:col-span-4">
            <Label>{t('orders.fromWarehouse')}</Label>
            <Select value={warehouseFromId} onValueChange={setWarehouseFromId}>
              <SelectTrigger><SelectValue placeholder={t('orders.selectSourceWh')} /></SelectTrigger>
              <SelectContent>
                {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {showToWH && (
          <div className="col-span-12 md:col-span-4">
            <Label>{t('orders.toWarehouse')}</Label>
            <Select value={warehouseToId} onValueChange={setWarehouseToId}>
              <SelectTrigger><SelectValue placeholder={t('orders.selectDestWh')} /></SelectTrigger>
              <SelectContent>
                {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Bins */}
        <Card className="col-span-12 md:col-span-4">
          <CardHeader><CardTitle>{t('movements.title.bins')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-auto">
            {showFromWH && (
              <>
                <div className="text-xs text-muted-foreground mb-1">
                  {t('movements.bins.from', { name: warehouses.find(w=>w.id===warehouseFromId)?.name || '' })}
                </div>
                {(binsFrom || []).length === 0 && <div className="text-sm text-muted-foreground">{t('movements.noBins')}</div>}
                <div className="space-y-1">
                  {binsFrom.map(b => (
                    <Button key={b.id} variant={fromBin===b.id?'default':'outline'} className="w-full justify-start" onClick={() => setFromBin(b.id)}>
                      {b.code} — {b.name}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {showToWH && (
              <>
                <div className="text-xs text-muted-foreground mt-2">
                  {t('movements.bins.to', { name: warehouses.find(w=>w.id===warehouseToId)?.name || '' })}
                </div>
                {(binsTo || []).length === 0 && <div className="text-sm text-muted-foreground">{t('movements.noBins')}</div>}
                <div className="space-y-1">
                  {binsTo.map(b => (
                    <Button key={b.id} variant={toBin===b.id?'default':'outline'} className="w-full justify-start" onClick={() => setToBin(b.id)}>
                      {b.code} — {b.name}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Bin contents */}
        <Card className="col-span-12 md:col-span-8">
          <CardHeader><CardTitle>{t('movements.title.binContents')}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {!(fromBin || toBin) ? (
              <div className="text-sm text-muted-foreground">{t('movements.pickBinToSee')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">{t('table.item')}</th>
                    <th className="py-2 pr-2">{t('table.sku')}</th>
                    <th className="py-2 pr-2">{t('movements.onHandBase')}</th>
                    <th className="py-2 pr-2">{t('movements.avgCost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsInSelectedBin.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-muted-foreground">{t('movements.emptyBin')}</td></tr>
                  )}
                  {itemsInSelectedBin.map(row => (
                    <tr key={row.item.id} className="border-b">
                      <td className="py-2 pr-2">{row.item.name}</td>
                      <td className="py-2 pr-2">{row.item.sku}</td>
                      <td className="py-2 pr-2">{fmtAcct(row.onHandQty)}</td>
                      <td className="py-2 pr-2">{fmtAcct(num(row.avgCost, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Movement form */}
      <Card>
        <CardHeader><CardTitle>
          {movementType === 'receive' && t('movements.card.receive')}
          {movementType === 'issue' && t('movements.card.issue')}
          {movementType === 'transfer' && t('movements.card.transfer')}
          {movementType === 'adjust' && t('movements.card.adjust')}
        </CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid md:grid-cols-6 gap-3">
            {movementType !== 'receive' && movementType !== 'adjust' && (
              <div>
                <Label>{t('orders.fromBin')}</Label>
                <Select value={fromBin} onValueChange={(v) => { setFromBin(v); setItemId(''); setQtyEntered(''); }}>
                  <SelectTrigger><SelectValue placeholder={t('orders.selectBin')} /></SelectTrigger>
                  <SelectContent>
                    {binsFrom.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {movementType !== 'issue' && (
              <div>
                <Label>{t('orders.toBin')}</Label>
                <Select value={toBin} onValueChange={setToBin}>
                  <SelectTrigger><SelectValue placeholder={t('orders.selectBin')} /></SelectTrigger>
                  <SelectContent>
                    {binsTo.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>{t('orders.item')}</Label>
              <Select
                value={itemId}
                onValueChange={onChangeItem}
                disabled={(movementType === 'issue' && !fromBin) || (movementType !== 'issue' && !toBin)}
              >
                <SelectTrigger><SelectValue placeholder={
                  movementType === 'issue'
                    ? (fromBin ? t('movements.selectItem') : t('movements.pickFromBinFirst'))
                    : (toBin ? t('movements.selectItem') : t('movements.pickToBinFirst'))
                } /></SelectTrigger>
                <SelectContent>
                  {(movementType === 'issue' || (movementType === 'transfer' && fromBin))
                    ? fromBinItems.map(it => (<SelectItem key={it.id} value={it.id}>{it.name} ({it.sku})</SelectItem>))
                    : items.map(it => (<SelectItem key={it.id} value={it.id}>{it.name} ({it.sku})</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{movementType === 'adjust' ? t('movements.newOnHand') : t('movements.quantity')}</Label>
              <Input type="number" min="0" step="0.0001" value={qtyEntered} onChange={e => setQtyEntered(e.target.value)} placeholder="0" />
              {!!currentItem && preview && (
                <div className={`text-xs mt-1 ${preview.invalid ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {(movementType === 'adjust' ? t('movements.preview.target') : t('movements.preview.entered'))}
                  {' '}{fmtAcct(preview.entered)} {(uomById.get(preview.uomEntered)?.code || '').toUpperCase()}
                  {' '}→ {fmtAcct(preview.base)} {(uomById.get(preview.baseUom)?.code || 'BASE').toUpperCase()}
                  {preview.invalid && t('movements.preview.noPath')}
                </div>
              )}
            </div>

            <div>
              <Label>{t('movements.movementUom')}</Label>
              <Select value={selectedUomValue} onValueChange={onChangeUom} disabled={!currentItem}>
                <SelectTrigger><SelectValue placeholder={currentItem ? t('movements.selectUom') : t('movements.pickItemFirst')} /></SelectTrigger>
                <SelectContent>
                  {uomsList.map(u => {
                    const convertible = currentItem ? canConvert(u.id, itemBaseUomId) : false
                    return <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}{currentItem && !convertible ? t('movements.notConvertibleSuffix') : ''}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>

            {(movementType === 'receive' || movementType === 'adjust') && (
              <div>
                <Label>
                  {t('movements.unitCost')}
                  {movementType === 'adjust' ? ` ${t('movements.unitCost.requiredIfIncreasing')}` : ''}
                </Label>
                <Input type="number" min="0" step="0.0001" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0.00" />
              </div>
            )}
          </div>

          {/* Reference (SO/PO/Adjust/etc.) */}
          <div className="grid md:grid-cols-6 gap-3">
            <div>
              <Label>{t('movements.refType')}</Label>
              <Select value={refType} onValueChange={(v: RefType) => setRefType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {movementType === 'issue' && <SelectItem value="SO">{t('movements.refType.SO')}</SelectItem>}
                  {movementType === 'receive' && <SelectItem value="PO">{t('movements.refType.PO')}</SelectItem>}
                  <SelectItem value="ADJUST">ADJUST</SelectItem>
                  <SelectItem value="TRANSFER">TRANSFER</SelectItem>
                  <SelectItem value="WRITE_OFF">WRITE_OFF</SelectItem>
                  <SelectItem value="INTERNAL_USE">INTERNAL_USE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('movements.refId')}</Label>
              <Input value={refId} onChange={e => setRefId(e.target.value)} placeholder={t('movements.refId.placeholder')} />
            </div>
            <div>
              <Label>{t('movements.refLineId')}</Label>
              <Input value={refLineId} onChange={e => setRefLineId(e.target.value)} placeholder={t('movements.refLineId.placeholder')} />
            </div>
          </div>

          <div>
            <Label>{t('orders.notes')}</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('movements.notes.placeholder')} />
          </div>

          <div className="flex justify-end">
            <Button onClick={submit}>
              {movementType === 'receive' && t('movements.btn.receive')}
              {movementType === 'issue' && t('movements.btn.issue')}
              {/* FIX: if key is missing, show plain 'Transfer' instead of 'movements.btn.transfer' */}
              {movementType === 'transfer' && tt('movements.btn.transfer', 'Transfer')}
              {movementType === 'adjust' && t('movements.btn.adjust')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
