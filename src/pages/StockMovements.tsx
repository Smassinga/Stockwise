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
import { getBaseCurrencyCode } from '../lib/currency'
import { finalizeCashSaleSO } from '../lib/sales' // creates SO with shipped status by default

type Warehouse = { id: string; name: string; code?: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }
type Item = { id: string; name: string; sku: string; baseUomId: string }
type Uom = { id: string; code: string; name: string; family?: string }
type Currency = { code: string; name: string }
type Customer = { id: string; code?: string; name: string }

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
  const tt = (key: string, fallback: string) => {
    const v = t(key as any)
    return v === key ? fallback : v
  }

  // master data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [baseCode, setBaseCode] = useState<string>('MZN')
  const [customers, setCustomers] = useState<Customer[]>([])
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
  const [unitCost, setUnitCost] = useState<string>('') // used in receive / adjust increase
  const [notes, setNotes] = useState<string>('')

  // reference tagging
  const [refType, setRefType] = useState<RefType>(DEFAULT_REF_BY_MOVE[movementType])
  const [refId, setRefId] = useState<string>('')       // optional external ref id to link
  const [refLineId, setRefLineId] = useState<string>('')

  // cash-sale (Issue + SO)
  const [saleCustomerId, setSaleCustomerId] = useState<string>('') // optional (defaults to CASH in lib if omitted)
  const [saleCurrency, setSaleCurrency] = useState<string>('')     // defaults to base
  const [saleFx, setSaleFx] = useState<string>('1')
  const [saleUnitPrice, setSaleUnitPrice] = useState<string>('')

  // maps
  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const currentItem = useMemo(() => items.find(i => i.id === itemId) || null, [itemId, items])

  // load masters
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

        const [uRes, cRes, base] = await Promise.all([
          supabase.from('uoms').select('id,code,name,family').order('code', { ascending: true }),
          supabase.from('currencies').select('code,name').order('code', { ascending: true }),
          getBaseCurrencyCode().catch(() => 'MZN'),
        ])
        if (uRes.error) throw uRes.error
        setUoms((uRes.data || []).map((u: any) => ({ ...u, code: String(u.code || '').toUpperCase() })))
        setCurrencies(((cRes.data || []) as Currency[]) || [])
        setBaseCode(base || 'MZN')
        setSaleCurrency(base || 'MZN')

        const { data: convRows, error: convErr } = await supabase
          .from('uom_conversions').select('from_uom_id,to_uom_id,factor')
        setConvGraph(convErr ? null : buildConvGraph((convRows || []) as ConvRow[]))

        const custs = await supabase.from('customers').select('id,code,name').order('name', { ascending: true })
        if (!custs.error) setCustomers((custs.data || []) as Customer[])
      } catch (e: any) {
        console.error(e)
        toast.error(tt('movements.loadFailed', 'Failed to load stock movements'))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      } catch (e: any) { console.error(e); toast.error(tt('movements.loadFailedSourceWh', 'Failed to load source warehouse')) }
    })()
  }, [warehouseFromId, movementType]) // eslint-disable-line

  useEffect(() => {
    (async () => {
      try {
        await loadWH(warehouseToId, 'to')
        setToBin('')
        if (movementType !== 'issue') { setItemId(''); setQtyEntered(''); setMovementUomId(''); setUnitCost('') }
      } catch (e: any) { console.error(e); toast.error(tt('movements.loadFailedDestWh', 'Failed to load destination warehouse')) }
    })()
  }, [warehouseToId, movementType]) // eslint-disable-line

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
  }, [itemId]) // eslint-disable-line

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
        const edges = (convGraph.get(id) || [])
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
      if (deltaQtyBase < 0) throw new Error(tt('orders.insufficientStock', 'Insufficient stock'))
      const { error: insErr } = await supabase.from('stock_levels').insert({
        warehouse_id: whId, bin_id: bin, item_id: itId, qty: deltaQtyBase, allocated_qty: 0, avg_cost: unitCost, updated_at: nowISO(),
      })
      if (insErr) throw insErr
      return
    }

    const row = found[0] as { id: string; qty: number | null; avg_cost: number | null }
    const oldQty = num(row.qty, 0), oldAvg = num(row.avg_cost, 0)
    const newQty = oldQty + deltaQtyBase
    if (newQty < 0) throw new Error(tt('orders.insufficientStock', 'Insufficient stock'))

    let newAvg = oldAvg
    if (deltaQtyBase > 0) newAvg = newQty > 0 ? ((oldQty * oldAvg) + (deltaQtyBase * unitCost)) / newQty : unitCost

    const { error: updErr } = await supabase
      .from('stock_levels')
      .update({ qty: newQty, avg_cost: newAvg, updated_at: nowISO() })
      .eq('id', row.id)
    if (updErr) throw updErr
  }

  function normalizeRefForSubmit(mt: MovementType, rt: RefType): RefType {
    if (mt === 'transfer') return 'TRANSFER'
    if (mt === 'receive' && rt === 'SO') return 'ADJUST'
    if (mt === 'issue' && rt === 'PO') return 'ADJUST'
    return rt || DEFAULT_REF_BY_MOVE[mt]
  }

  // SUBMIT handlers
  async function submitReceive() {
    if (!warehouseToId) return toast.error(tt('orders.selectDestWh', 'Select destination warehouse'))
    if (!toBin) return toast.error(tt('orders.selectBin', 'Select bin'))
    if (!currentItem) return toast.error(tt('movements.selectItemRequired', 'Select an item'))
    const qty = num(qtyEntered); if (qty <= 0) return toast.error(tt('movements.qtyGtZero', 'Quantity must be > 0'))
    const uomId = movementUomId || itemBaseUomId
    const unitCostNum = num(unitCost, NaN); if (!Number.isFinite(unitCostNum) || unitCostNum < 0) return toast.error(tt('movements.unitCostGteZero', 'Unit cost must be ≥ 0'))
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(tt('movements.noConversionToBase', 'No conversion to base UoM'))

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
    setQtyEntered(''); setUnitCost(''); setRefId(''); setRefLineId(''); setNotes('')
    toast.success(tt('movements.received', 'Received'))
  }

  async function submitIssue() {
    if (!warehouseFromId) return toast.error(tt('orders.selectSourceWh', 'Select source warehouse'))
    if (!fromBin) return toast.error(tt('orders.selectSourceBin', 'Select source bin'))
    if (!currentItem) return toast.error(tt('movements.selectItemRequired', 'Select an item'))
    const qty = num(qtyEntered); if (qty <= 0) return toast.error(tt('movements.qtyGtZero', 'Quantity must be > 0'))

    const uomId = movementUomId || itemBaseUomId
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(tt('movements.noConversionToBase', 'No conversion to base UoM'))

    const { qty: onHand, avgCost } = onHandIn(stockFrom, fromBin, currentItem.id)
    if (onHand < qtyBase) return toast.error(tt('orders.insufficientStock', 'Insufficient stock'))

    let soRefIdLocal: string | null = null
    let soRefLineIdLocal: string | null = null
    const rt = normalizeRefForSubmit('issue', refType)

    // Cash Sale path (Issue + SO) — defaults to CASH if no customer selected
    if (rt === 'SO') {
      const unitSellPrice = num(saleUnitPrice, NaN)
      if (!Number.isFinite(unitSellPrice) || unitSellPrice < 0) return toast.error(tt('movements.enterSellPrice', 'Enter a valid sell price'))
      const cur = saleCurrency || baseCode
      const fx = num(saleFx, NaN); if (!Number.isFinite(fx) || fx <= 0) return toast.error(tt('movements.enterFx', 'Enter a valid FX to base'))

      try {
        const created = await finalizeCashSaleSO({
          itemId: currentItem.id,
          qty,
          uomId,
          unitPrice: unitSellPrice,
          customerId: saleCustomerId || undefined,
          currencyCode: cur,
          fxToBase: fx,
          status: 'shipped', // valid so_status; avoids needing to ship again
        })
        soRefIdLocal = created.soId
        soRefLineIdLocal = created.soLineId
      } catch (e: any) {
        console.error(e)
        return toast.error(tt('movements.failedCreateSO', 'Failed to create the Sales Order'))
      }
    }

    // 1) Record movement (COGS)
    const ins = await supabase.from('stock_movements').insert({
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
      ref_id: rt === 'SO' ? (soRefIdLocal || refId || null) : null,
      ref_line_id: rt === 'SO' ? (soRefLineIdLocal || refLineId || null) : null,
    }).select('id').single()

    if (ins.error) {
      console.error(ins.error)
      return toast.error(tt('movements.failed', 'Action failed'))
    }

    // 2) Deduct stock
    await upsertStockLevel(warehouseFromId, fromBin, currentItem.id, -qtyBase)

    // refresh view
    const { data: fresh } = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('warehouse_id', warehouseFromId)
    setStockFrom((fresh || []).map(mapSL))

    setQtyEntered('')
    setRefId(''); setRefLineId(''); setNotes('')
    if (rt === 'SO') { setSaleUnitPrice(''); setSaleCustomerId('') }
    toast.success(tt('movements.issued', 'Issued'))
  }

  async function submitTransfer() {
    if (!warehouseFromId || !warehouseToId) return toast.error(tt('movements.pickBothWh', 'Pick both warehouses'))
    if (!fromBin || !toBin) return toast.error(tt('movements.pickBothBins', 'Pick both bins'))
    if (warehouseFromId === warehouseToId && fromBin === toBin) return toast.error(tt('movements.sameSourceDest', 'Source and destination are the same'))
    if (!currentItem) return toast.error(tt('movements.selectItemRequired', 'Select an item'))

    const qty = num(qtyEntered); if (qty <= 0) return toast.error(tt('movements.qtyGtZero', 'Quantity must be > 0'))
    const uomId = movementUomId || itemBaseUomId
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(tt('movements.noConversionToBase', 'No conversion to base UoM'))

    const { qty: onHand, avgCost } = onHandIn(stockFrom, fromBin, currentItem.id)
    if (onHand < qtyBase) return toast.error(tt('orders.insufficientStock', 'Insufficient stock'))

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
      notes: `${tt('movements.note.transferPrefix', 'Transfer')}: ${warehouseFromId}/${fromBin} -> ${warehouseToId}/${toBin}${notes ? ` | ${notes}` : ''}`,
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
    toast.success(tt('movements.transferCompleted', 'Transfer completed'))
  }

  async function submitAdjust() {
    if (!warehouseToId) return toast.error(tt('movements.selectWhToAdjust', 'Select a warehouse to adjust'))
    if (!toBin) return toast.error(tt('movements.selectBinToAdjust', 'Select a bin to adjust'))
    if (!currentItem) return toast.error(tt('movements.selectItemRequired', 'Select an item'))

    const targetQtyEntered = num(qtyEntered)
    if (targetQtyEntered < 0) return toast.error(tt('movements.onHandCannotBeNegative', 'On-hand cannot be negative'))

    const uomId = movementUomId || itemBaseUomId
    const targetBase = safeConvert(targetQtyEntered, uomId, itemBaseUomId)
    if (targetBase == null) return toast.error(tt('movements.noConversionToBase', 'No conversion to base UoM'))

    const { qty: currentBase, avgCost: currentAvg } = onHandIn(stockTo, toBin, currentItem.id)
    const delta = targetBase - currentBase
    if (delta === 0) return toast(tt('movements.noChange', 'No change'))

    let useUnitCost = currentAvg
    if (delta > 0) {
      const unitCostNum = num(unitCost, NaN)
      if (!Number.isFinite(unitCostNum) || unitCostNum < 0) return toast.error(tt('movements.unitCostRequiredForIncrease', 'Unit cost required when increasing on-hand'))
      useUnitCost = unitCostNum
    }

    await upsertStockLevel(warehouseToId, toBin, currentItem.id, delta, { unitCost: useUnitCost })

    const adjNote = `${tt('movements.note.adjust', 'Adjust to')} ${targetQtyEntered} ${(uomById.get(uomId)?.code || uomId).toString().toUpperCase()} (${tt('movements.current', 'current')}: ${currentBase})`

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
    toast.success(tt('movements.adjusted', 'Adjusted'))
  }

  async function submit() {
    try {
      if (movementType === 'receive') return await submitReceive()
      if (movementType === 'issue') return await submitIssue()
      if (movementType === 'transfer') return await submitTransfer()
      if (movementType === 'adjust') return await submitAdjust()
    } catch (e: any) {
      console.error(e)
      toast.error(tt('movements.failed', 'Action failed'))
    }
  }

  function onChangeItem(v: string) { setItemId(v); setQtyEntered('') }
  function onChangeUom(uomId: string) {
    const baseId = itemBaseUomId
    if (!currentItem || !baseId) { setMovementUomId(''); return }
    if (idsOrCodesEqual(uomId, baseId)) { setMovementUomId(uomId); return }
    if (!canConvert(uomId, baseId)) { toast.error(tt('movements.selectedUomNotConvertible', 'Selected UoM cannot convert to base')); setMovementUomId(baseId); return }
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

  // Show the sale fields for Issue+SO
  const showSaleBlock = movementType === 'issue' && String(refType || '').toUpperCase().startsWith('SO')

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

  // UI
  return (
    <div className="space-y-6">
      {/* Movement type + warehouses */}
      <div className="grid grid-cols-12 gap-3 items-end">
        <div className={`col-span-12 ${showFromWH && showToWH ? 'md:col-span-3' : 'md:col-span-4'}`}>
          <Label>{tt('movements.movementType', 'Movement Type')}</Label>
          <Select value={movementType} onValueChange={(v: MovementType) => {
            setMovementType(v)
            setFromBin(''); setToBin(''); setItemId(''); setQtyEntered(''); setUnitCost(''); setNotes('')
            setMovementUomId('')
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="receive">{tt('movement.receive', 'receive')}</SelectItem>
              <SelectItem value="issue">{tt('movement.issue', 'issue')}</SelectItem>
              <SelectItem value="transfer">{tt('movement.transfer', 'transfer')}</SelectItem>
              <SelectItem value="adjust">{tt('movement.adjust', 'adjust')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {showFromWH && (
          <div className="col-span-12 md:col-span-4">
            <Label>{tt('orders.fromWarehouse', 'From Warehouse')}</Label>
            <Select value={warehouseFromId} onValueChange={setWarehouseFromId}>
              <SelectTrigger><SelectValue placeholder={tt('orders.selectSourceWh', 'Select source warehouse')} /></SelectTrigger>
              <SelectContent>
                {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {showToWH && (
          <div className="col-span-12 md:col-span-4">
            <Label>{tt('orders.toWarehouse', 'To Warehouse')}</Label>
            <Select value={warehouseToId} onValueChange={setWarehouseToId}>
              <SelectTrigger><SelectValue placeholder={tt('orders.selectDestWh', 'Select destination warehouse')} /></SelectTrigger>
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
          <CardHeader><CardTitle>{tt('movements.title.bins', 'Bins')}</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-auto">
            {showFromWH && (
              <>
                <div className="text-xs text-muted-foreground mb-1">
                  {tt('movements.bins.from', 'From')}{' '}{warehouses.find(w=>w.id===warehouseFromId)?.name || ''}
                </div>
                {(binsFrom || []).length === 0 && <div className="text-sm text-muted-foreground">{tt('movements.noBins', 'No bins')}</div>}
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
                  {tt('movements.bins.to', 'To')}{' '}{warehouses.find(w=>w.id===warehouseToId)?.name || ''}
                </div>
                {(binsTo || []).length === 0 && <div className="text-sm text-muted-foreground">{tt('movements.noBins', 'No bins')}</div>}
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
          <CardHeader><CardTitle>{tt('movements.title.binContents', 'Bin Contents')}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {!(fromBin || toBin) ? (
              <div className="text-sm text-muted-foreground">{tt('movements.pickBinToSee', 'Pick a bin to see contents')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">{tt('table.item', 'Item')}</th>
                    <th className="py-2 pr-2">{tt('table.sku', 'SKU')}</th>
                    <th className="py-2 pr-2">{tt('movements.onHandBase', 'On Hand (base)')}</th>
                    <th className="py-2 pr-2">{tt('movements.avgCost', 'Avg Cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsInSelectedBin.length === 0 && (
                    <tr><td colSpan={4} className="py-4 text-muted-foreground">{tt('movements.emptyBin', 'Empty bin')}</td></tr>
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
          {movementType === 'receive' && tt('movements.card.receive', 'Receive into Bin')}
          {movementType === 'issue' && tt('movements.card.issue', 'Issue from Bin')}
          {movementType === 'transfer' && tt('movements.card.transfer', 'Transfer between Bins')}
          {movementType === 'adjust' && tt('movements.card.adjust', 'Adjust On-hand')}
        </CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid md:grid-cols-6 gap-3">
            {movementType !== 'receive' && movementType !== 'adjust' && (
              <div>
                <Label>{tt('orders.fromBin', 'From Bin')}</Label>
                <Select value={fromBin} onValueChange={(v) => { setFromBin(v); setItemId(''); setQtyEntered(''); }}>
                  <SelectTrigger><SelectValue placeholder={tt('orders.selectBin', 'Select bin')} /></SelectTrigger>
                  <SelectContent>
                    {binsFrom.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {movementType !== 'issue' && (
              <div>
                <Label>{tt('orders.toBin', 'To Bin')}</Label>
                <Select value={toBin} onValueChange={setToBin}>
                  <SelectTrigger><SelectValue placeholder={tt('orders.selectBin', 'Select bin')} /></SelectTrigger>
                  <SelectContent>
                    {binsTo.map(b => <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>{tt('orders.item', 'Item')}</Label>
              <Select
                value={itemId}
                onValueChange={onChangeItem}
                disabled={(movementType === 'issue' && !fromBin) || (movementType !== 'issue' && !toBin)}
              >
                <SelectTrigger><SelectValue placeholder={
                  movementType === 'issue'
                    ? (fromBin ? tt('movements.selectItem', 'Select item') : tt('movements.pickFromBinFirst', 'Pick a source bin first'))
                    : (toBin ? tt('movements.selectItem', 'Select item') : tt('movements.pickToBinFirst', 'Pick a destination bin first'))
                } /></SelectTrigger>
                <SelectContent>
                  {(movementType === 'issue' || (movementType === 'transfer' && fromBin))
                    ? fromBinItems.map(it => (<SelectItem key={it.id} value={it.id}>{it.name} ({it.sku})</SelectItem>))
                    : items.map(it => (<SelectItem key={it.id} value={it.id}>{it.name} ({it.sku})</SelectItem>))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>{movementType === 'adjust' ? tt('movements.newOnHand', 'New On-hand') : tt('movements.quantity', 'Quantity')}</Label>
              <Input type="number" min="0" step="0.0001" value={qtyEntered} onChange={e => setQtyEntered(e.target.value)} placeholder="0" />
              {!!currentItem && preview && (
                <div className={`text-xs mt-1 ${preview.invalid ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {(movementType === 'adjust' ? tt('movements.preview.target', 'Target') : tt('movements.preview.entered', 'Entered'))}
                  {' '}{fmtAcct(preview.entered)} {(uomById.get(preview.uomEntered)?.code || '').toUpperCase()}
                  {' '}→ {fmtAcct(preview.base)} {(uomById.get(preview.baseUom)?.code || 'BASE').toUpperCase()}
                  {preview.invalid && tt('movements.preview.noPath', ' (no conversion path)')}
                </div>
              )}
            </div>

            <div>
              <Label>{tt('movements.movementUom', 'Movement UoM')}</Label>
              <Select value={selectedUomValue} onValueChange={onChangeUom} disabled={!currentItem}>
                <SelectTrigger><SelectValue placeholder={currentItem ? tt('movements.selectUom', 'Select UoM') : tt('movements.pickItemFirst', 'Pick item first')} /></SelectTrigger>
                <SelectContent>
                  {uomsList.map(u => {
                    const convertible = currentItem ? canConvert(u.id, itemBaseUomId) : false
                    return <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}{currentItem && !convertible ? tt('movements.notConvertibleSuffix', ' (no path)') : ''}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            </div>

            {(movementType === 'receive' || movementType === 'adjust') && (
              <div>
                <Label>
                  {tt('movements.unitCost', 'Unit Cost')}
                  {movementType === 'adjust' ? ` ${tt('movements.unitCost.requiredIfIncreasing', '(required if increasing)')}` : ''}
                </Label>
                <Input type="number" min="0" step="0.0001" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="0.00" />
              </div>
            )}
          </div>

          {/* Reference (SO/PO/Adjust/etc.) */}
          <div className="grid md:grid-cols-6 gap-3">
            <div>
              <Label>{tt('movements.refType', 'Ref Type')}</Label>
              <Select value={refType} onValueChange={(v: RefType) => setRefType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {movementType === 'issue' && <SelectItem value="SO">{tt('movements.refType.SO', 'SO (Sale)')}</SelectItem>}
                  {movementType === 'receive' && <SelectItem value="PO">{tt('movements.refType.PO', 'PO (Purchase)')}</SelectItem>}
                  <SelectItem value="ADJUST">ADJUST</SelectItem>
                  <SelectItem value="TRANSFER">TRANSFER</SelectItem>
                  <SelectItem value="WRITE_OFF">WRITE_OFF</SelectItem>
                  <SelectItem value="INTERNAL_USE">INTERNAL_USE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{tt('movements.refId', 'Ref Id')}</Label>
              <Input value={refId} onChange={e => setRefId(e.target.value)} placeholder={tt('movements.refId.placeholder', 'Existing Ref (optional)')} />
            </div>
            <div>
              <Label>{tt('movements.refLineId', 'Ref Line Id')}</Label>
              <Input value={refLineId} onChange={e => setRefLineId(e.target.value)} placeholder={tt('movements.refLineId.placeholder', 'Ref line (optional)')} />
            </div>

            {/* CASH SALE FIELDS (Issue + SO) */}
            {showSaleBlock && (
              <>
                <div>
                  <Label>{tt('orders.customer', 'Customer')} {tt('common.optional', '(optional: defaults to CASH)')}</Label>
                  <Select value={saleCustomerId} onValueChange={setSaleCustomerId}>
                    <SelectTrigger><SelectValue placeholder={tt('orders.selectCustomer', 'Select customer')} /></SelectTrigger>
                    <SelectContent className="max-h-64 overflow-auto">
                      {customers.map(c => <SelectItem key={c.id} value={c.id}>{(c.code ? c.code + ' — ' : '') + c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('orders.currency', 'Currency')}</Label>
                  <Select value={saleCurrency || baseCode} onValueChange={setSaleCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64 overflow-auto">
                      {currencies.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('orders.fxToBaseShort', 'FX to Base')}</Label>
                  <Input type="number" min="0" step="0.000001" value={saleFx} onChange={e => setSaleFx(e.target.value)} />
                </div>
                <div>
                  <Label>{tt('movements.sellUnitPrice', 'Unit Sell Price')}</Label>
                  <Input type="number" min="0" step="0.0001" value={saleUnitPrice} onChange={e => setSaleUnitPrice(e.target.value)} placeholder="0.00" />
                </div>
              </>
            )}
          </div>

          <div>
            <Label>{tt('orders.notes', 'Notes')}</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder={tt('movements.notes.placeholder', 'Optional notes')} />
          </div>

          <div className="flex justify-end">
            <Button onClick={submit}>
              {movementType === 'receive'  && tt('movements.btn.receive',  'Receive')}
              {movementType === 'issue'    && tt('movements.btn.issue',    'Issue')}
              {movementType === 'transfer' && tt('movements.btn.transfer', 'Transfer')}
              {movementType === 'adjust'   && tt('movements.btn.adjust',   'Adjust')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
