// src/pages/StockMovements.tsx — company-scoped drop-in (v2.1)
// Notes:
// • Replaces db.warehouses.list and db.bins.list with explicit Supabase queries scoped by company_id and warehouseId.
// • Adds .eq('company_id', companyId) to *all* stock_levels reads.
// • Keeps UI/UX identical; only the data sources and filters are hardened.
// • Fix: In transfer mode, selecting From/To bin no longer clears the other; Item is enabled after selecting From Bin.

import { useEffect, useMemo, useState, Fragment } from 'react'
import { supabase } from '../lib/supabase' // ← use the same client as Warehouses/StockLevels
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import toast from 'react-hot-toast'
import { buildConvGraph, convertQty, type ConvRow } from '../lib/uom'
import { useI18n } from '../lib/i18n'
import { getBaseCurrencyCode } from '../lib/currency'
import { finalizeCashSaleSOWithCOGS } from '../lib/sales'
import { useOrg } from '../hooks/useOrg'

// ---- Local type shim so we can pass notes even if lib/sales isn’t updated yet.
type CashSaleWithCogsArgsWithNotes =
  Parameters<typeof finalizeCashSaleSOWithCOGS>[0] & { notes?: string }

// Master data types
type Warehouse = { id: string; name: string; code?: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }
type Item = { id: string; name: string; sku: string | null; baseUomId: string | null }
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

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const fmtAcct = (v: number) => {
  const n = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `(${n})` : n
}

const DEFAULT_REF_BY_MOVE: Record<MovementType, RefType> = {
  receive: 'ADJUST',
  issue: 'ADJUST',
  transfer: 'TRANSFER',
  adjust: 'ADJUST',
}

export default function StockMovements() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => (t(key as any) === key ? fallback : t(key as any))
  const { companyId } = useOrg()

  // Master data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [baseCode, setBaseCode] = useState<string>('MZN')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [convGraph, setConvGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)

  // Movement selections
  const [movementType, setMovementType] = useState<MovementType>('transfer')
  const [warehouseFromId, setWarehouseFromId] = useState<string>('')
  const [warehouseToId, setWarehouseToId] = useState<string>('')

  // Bins & stock per warehouse
  const [binsFrom, setBinsFrom] = useState<Bin[]>([])
  const [binsTo, setBinsTo] = useState<Bin[]>([])
  const [stockFrom, setStockFrom] = useState<StockLevel[]>([])
  const [stockTo, setStockTo] = useState<StockLevel[]>([])

  // Movement form
  const [fromBin, setFromBin] = useState<string>('')
  const [toBin, setToBin] = useState<string>('')
  const [itemId, setItemId] = useState<string>('')
  const [movementUomId, setMovementUomId] = useState<string>('') // selected UoM for entry
  const [qtyEntered, setQtyEntered] = useState<string>('')
  const [unitCost, setUnitCost] = useState<string>('') // used in receive / adjust increase
  const [notes, setNotes] = useState<string>('')

  // Reference tagging
  const [refType, setRefType] = useState<RefType>(DEFAULT_REF_BY_MOVE[movementType])
  const [refId, setRefId] = useState<string>('')
  const [refLineId, setRefLineId] = useState<string>('')

  // Cash-sale (Issue + SO)
  const [saleCustomerId, setSaleCustomerId] = useState<string>('') // optional (defaults to CASH)
  const [saleCurrency, setSaleCurrency] = useState<string>('')
  const [saleFx, setSaleFx] = useState<string>('1')
  const [saleUnitPrice, setSaleUnitPrice] = useState<string>('')

  // Maps
  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const currentItem = useMemo(() => items.find(i => i.id === itemId) || null, [itemId, items])

  // Load masters (scoped to company)
  useEffect(() => {
    (async () => {
      try {
        // Reset if no company yet
        if (!companyId) {
          setWarehouses([]); setItems([]); setCustomers([])
          setBinsFrom([]); setBinsTo([]); setStockFrom([]); setStockTo([])
          setWarehouseFromId(''); setWarehouseToId(''); setFromBin(''); setToBin('')
          return
        }

        // Warehouses (company-scoped)
        const [whRes, itResRaw] = await Promise.all([
          supabase
            .from('warehouses')
            .select('id,name,code')
            .eq('company_id', companyId)
            .order('name', { ascending: true }),
          supabase
            .from('items')
            .select('id,name,sku,base_uom_id')
            .eq('company_id', companyId)
            .order('name', { ascending: true }),
        ])

        if (whRes.error) throw whRes.error
        setWarehouses(((whRes.data || []) as any[]).map(w => ({ id: w.id, name: w.name, code: w.code })) as Warehouse[])

        if (itResRaw.error) throw itResRaw.error
        setItems(((itResRaw.data || []) as any[]).map(x => ({ id: x.id, name: x.name, sku: x.sku ?? null, baseUomId: x.base_uom_id ?? null })))

        // Default both selectors to first warehouse (if any) to preserve prior UX
        const first = (whRes.data || [])[0]
        setWarehouseFromId(first?.id || '')
        setWarehouseToId(first?.id || '')

        // Global masters (not company-scoped)
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

        // Customers: scope to company
        const custs = await supabase
          .from('customers')
          .select('id,code,name')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (!custs.error) setCustomers((custs.data || []) as Customer[])
      } catch (e: any) {
        console.error(e)
        toast.error(tt('movements.loadFailed', 'Failed to load stock movements'))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // Helpers
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

  // Scoped loader for one side (from/to)
  const loadWH = async (whId: string, which: 'from' | 'to') => {
    if (!companyId || !whId) {
      which === 'from' ? (setBinsFrom([]), setStockFrom([])) : (setBinsTo([]), setStockTo([]))
      return
    }

    // Bins: camelCase columns, constrained by the selected warehouse id
    const bbRaw = await supabase
      .from('bins')
      .select('id,code,name,warehouseId')
      .eq('warehouseId', whId)
      .order('code', { ascending: true })
    if (bbRaw.error) throw bbRaw.error
    const bins = (bbRaw.data || []) as Bin[]

    // Stock levels: double filter (company + warehouse) for belt-and-suspenders
    const slRaw = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('company_id', companyId)
      .eq('warehouse_id', whId)

    if (slRaw.error) throw slRaw.error

    if (which === 'from') { setBinsFrom(bins); setStockFrom((slRaw.data || []).map(mapSL)) }
    else { setBinsTo(bins); setStockTo((slRaw.data || []).map(mapSL)) }
  }

  useEffect(() => {
    (async () => {
      try {
        await loadWH(warehouseFromId, 'from')
        setFromBin('')
        if (movementType === 'issue') { setItemId(''); setQtyEntered(''); setMovementUomId('') }
      } catch (e: any) { console.error(e); toast.error(tt('movements.loadFailedSourceWh', 'Failed to load source warehouse')) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseFromId, movementType, companyId])

  useEffect(() => {
    (async () => {
      try {
        await loadWH(warehouseToId, 'to')
        setToBin('')
        if (movementType !== 'issue') { setItemId(''); setQtyEntered(''); setMovementUomId(''); setUnitCost('') }
      } catch (e: any) { console.error(e); toast.error(tt('movements.loadFailedDestWh', 'Failed to load destination warehouse')) }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseToId, movementType, companyId])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const ensureItemObject = (id: string): Item => {
    const it = items.find(x => x.id === id)
    if (it) return it
    return { id, name: '(Unknown Item)', sku: null, baseUomId: null }
  }

  // Flatten bin contents
  type BinItemRow = { item: Item; onHandQty: number; avgCost: number }

  const itemsInSelectedBin: BinItemRow[] = useMemo(() => {
    if (fromBin) {
      const rows = stockFrom.filter(s => (s.binId || null) === fromBin && num(s.onHandQty) > 0)
      const byItem = new Map<string, BinItemRow>()
      for (const s of rows) {
        const it = ensureItemObject(s.itemId)
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
      return Array.from(byItem.values()).sort((a, b) => a.item.name.localeCompare(b.item.name))
    } else if (toBin) {
      const rows = stockTo.filter(s => (s.binId || null) === toBin && num(s.onHandQty) > 0)
      const byItem = new Map<string, BinItemRow>()
      for (const s of rows) {
        const it = ensureItemObject(s.itemId)
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
      return Array.from(byItem.values()).sort((a, b) => a.item.name.localeCompare(b.item.name))
    }
    return []
  }, [fromBin, toBin, stockFrom, stockTo, items])

  // Fetch on-hand for a specific bin+item
  const onHandIn = (levels: StockLevel[], bin: string | null, itId: string) => {
    const row = levels.find(s => (s.binId || null) === (bin || null) && s.itemId === itId)
    return { qty: num(row?.onHandQty, 0), avgCost: num(row?.avgCost, 0) }
  }

  // Item base UoM id (normalized to an id)
  const itemBaseUomId = useMemo(() => uomIdFromIdOrCode(currentItem?.baseUomId || ''), [currentItem, uoms])

  // Live quantity preview (entered → base)
  const preview = useMemo(() => {
    const q = num(qtyEntered, 0)
    if (!q || !currentItem) return null
    const enteredUom = movementUomId || itemBaseUomId
    const base = safeConvert(q, enteredUom, itemBaseUomId)
    if (base == null) return { entered: q, base: q, uomEntered: enteredUom, baseUom: itemBaseUomId, invalid: true }
    return { entered: q, base, uomEntered: enteredUom, baseUom: itemBaseUomId, invalid: false }
  }, [qtyEntered, movementUomId, currentItem, itemBaseUomId])

  function normalizeRefForSubmit(mt: MovementType, rt: RefType): RefType {
    if (mt === 'transfer') return 'TRANSFER'
    if (mt === 'receive' && rt === 'SO') return 'ADJUST'
    if (mt === 'issue' && rt === 'PO') return 'ADJUST'
    return rt || DEFAULT_REF_BY_MOVE[mt]
  }

  // ---------------------- CASH helpers ----------------------
  async function getOrCreateCashCustomerId(): Promise<string> {
    if (!companyId) throw new Error('No company selected')
    const q = await supabase
      .from('customers')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', 'CASH')
      .maybeSingle()
    if (!q.error && q.data?.id) return q.data.id
    const up = await supabase
      .from('customers')
      .upsert({ company_id: companyId, code: 'CASH', name: 'Cash Customer' }, { onConflict: 'company_id,code' })
      .select('id')
      .single()
    if (!up.error && up.data?.id) return up.data.id
    const msg = String(up.error?.message || '')
    if ((up as any)?.error?.code === '23505' || /duplicate key|unique constraint/i.test(msg)) {
      const q2 = await supabase.from('customers').select('id').eq('company_id', companyId).eq('code', 'CASH').maybeSingle()
      if (!q2.error && q2.data?.id) return q2.data.id
    }
    throw up.error || new Error('Failed to upsert CASH customer')
  }

  async function getOrCreateCashPurchasesSupplierId(): Promise<string> {
    if (!companyId) throw new Error('No company selected')
    const CODE = 'CASH-PURCHASES'
    const q = await supabase
      .from('suppliers')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', CODE as any)
      .maybeSingle()
    if (!q.error && q.data?.id) return q.data.id

    const up = await supabase
      .from('suppliers')
      .upsert({ company_id: companyId, code: CODE as any, name: 'Cash Purchases' }, { onConflict: 'company_id,code' })
      .select('id')
      .single()
    if (!up.error && up.data?.id) return up.data.id

    const msg = String(up.error?.message || '')
    if ((up as any)?.error?.code === '23505' || /duplicate key|unique constraint/i.test(msg)) {
      const q2 = await supabase.from('suppliers').select('id').eq('company_id', companyId).eq('code', CODE as any).maybeSingle()
      if (!q2.error && q2.data?.id) return q2.data.id
    }
    throw up.error || new Error('Failed to upsert CASH-PURCHASES supplier')
  }

  async function createClosedPOForReceipt(params: {
    companyId: string
    supplierId: string
    itemId: string
    uomId: string
    qtyEntered: number
    qtyBase: number
    unitCost: number
    currencyCode: string
    notes?: string
  }): Promise<{ poId: string; poLineId: string; poNumber?: string }> {
    const { companyId, supplierId, itemId, uomId, qtyEntered, qtyBase, unitCost, currencyCode, notes } = params
    const lineTotalBase = unitCost * qtyBase

    const poIns = await supabase
      .from('purchase_orders')
      .insert({
        company_id: companyId,
        supplier_id: supplierId,
        status: 'closed',
        currency_code: currencyCode,
        fx_to_base: 1,
        subtotal: lineTotalBase,
        tax_total: 0,
        total: lineTotalBase,
        notes: notes || null,
        received_at: new Date().toISOString(),
      } as any)
      .select('id,order_no')
      .single()

    if (poIns.error || !poIns.data?.id) throw poIns.error || new Error('Failed to create PO')
    const poId = poIns.data.id as string
    const poNumber = (poIns.data as any)?.order_no || undefined

    const polIns = await supabase
      .from('purchase_order_lines')
      .insert({
        po_id: poId,
        line_no: 1,
        item_id: itemId,
        uom_id: uomId,
        qty: qtyEntered,
        unit_price: unitCost,
        line_total: lineTotalBase,
        notes: notes || null,
      } as any)
      .select('id')
      .single()

    if (polIns.error || !polIns.data?.id) throw polIns.error || new Error('Failed to create PO line')
    return { poId, poLineId: polIns.data.id as string, poNumber }
  }

  // ---------------------- Submit handlers ----------------------

  async function submitReceive() {
    if (!companyId) return toast.error(tt('org.noCompany', 'Join or create a company first'))
    if (!warehouseToId) return toast.error(tt('orders.selectDestWh', 'Select destination warehouse'))
    if (!toBin) return toast.error(tt('orders.selectBin', 'Select bin'))
    if (!currentItem) return toast.error(tt('movements.selectItemRequired', 'Select an item'))
    const qty = num(qtyEntered); if (qty <= 0) return toast.error(tt('movements.qtyGtZero', 'Quantity must be > 0'))
    const uomId = movementUomId || itemBaseUomId
    const unitCostNum = num(unitCost, NaN); if (!Number.isFinite(unitCostNum) || unitCostNum < 0) return toast.error(tt('movements.unitCostGteZero', 'Unit cost must be ≥ 0'))
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(tt('movements.noConversionToBase', 'No conversion to base UoM'))

    // If the user chose Ref Type PO and didn’t provide an existing ref, create a closed PO under CASH-PURCHASES
    let effectiveRefId: string | null = null
    let effectiveRefLineId: string | null = null
    let poNoteSuffix = ''

    const rtRaw = normalizeRefForSubmit('receive', refType)
    if (rtRaw === 'PO' && !refId) {
      try {
        const supId = await getOrCreateCashPurchasesSupplierId()
        const { poId, poLineId, poNumber } = await createClosedPOForReceipt({
          companyId,
          supplierId: supId,
          itemId: currentItem.id,
          uomId,
          qtyEntered: qty,
          qtyBase,
          unitCost: unitCostNum,
          currencyCode: baseCode, // PO currency
          notes,
        })
        effectiveRefId = poId
        effectiveRefLineId = poLineId
        if (poNumber) poNoteSuffix = `PO ${poNumber}`
      } catch (e: any) {
        console.error(e)
        toast.error(tt('movements.failed', 'Action failed'))
        return
      }
    }

    const finalRefType = rtRaw
    const ins = await supabase.from('stock_movements').insert({
      company_id: companyId,
      type: 'receive',
      item_id: currentItem.id,
      uom_id: uomId,
      qty,
      qty_base: qtyBase,
      unit_cost: unitCostNum,
      total_value: unitCostNum * qtyBase,
      warehouse_to_id: warehouseToId,
      bin_to_id: toBin,
      notes: [notes, poNoteSuffix].filter(Boolean).join(' ').trim() || null,
      created_by: (finalRefType === 'SO' ? 'so_ship' : 'system'),
      ref_type: finalRefType || 'ADJUST',
      ref_id: finalRefType === 'PO' ? (effectiveRefId || refId || null) : null,
      ref_line_id: finalRefType === 'PO' ? (effectiveRefLineId || refLineId || null) : null,
    }).select('id').single()

    if (ins.error) { console.error(ins.error); return toast.error(tt('movements.failed', 'Action failed')) }

    const { data: fresh } = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('company_id', companyId)
      .eq('warehouse_id', warehouseToId)
    setStockTo((fresh || []).map(mapSL))
    setQtyEntered(''); setUnitCost(''); setRefId(''); setRefLineId(''); setNotes('')
    toast.success(tt('movements.received', 'Received'))
  }

  async function submitIssue() {
    if (!companyId) return toast.error(tt('org.noCompany', 'Join or create a company first'))
    if (!warehouseFromId) return toast.error(tt('orders.selectSourceWh', 'Select source warehouse'))
    if (!fromBin) return toast.error(tt('orders.selectSourceBin', 'Select source bin'))
    if (!currentItem) return toast.error(tt('movements.selectItemRequired', 'Select an item'))
    const qty = num(qtyEntered); if (qty <= 0) return toast.error(tt('movements.qtyGtZero', 'Quantity must be > 0'))

    const uomId = movementUomId || itemBaseUomId
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(tt('movements.noConversionToBase', 'No conversion to base UoM'))

    const { qty: onHand, avgCost } = onHandIn(stockFrom, fromBin, currentItem.id)
    if (onHand < qtyBase) return toast.error(tt('orders.insufficientStock', 'Insufficient stock'))

    const rt = normalizeRefForSubmit('issue', refType)

    // SO path: create SO (revenue) + COGS via RPC
    if (rt === 'SO') {
      const unitSellPrice = num(saleUnitPrice, NaN)
      if (!Number.isFinite(unitSellPrice) || unitSellPrice < 0) return toast.error(tt('movements.enterSellPrice', 'Enter a valid sell price'))
      const cur = saleCurrency || baseCode
      const fx = num(saleFx, NaN); if (!Number.isFinite(fx) || fx <= 0) return toast.error(tt('movements.enterFx', 'Enter a valid FX to base'))

      try {
        const effectiveCustomerId = saleCustomerId || await getOrCreateCashCustomerId()

        await finalizeCashSaleSOWithCOGS({
          itemId: currentItem.id,
          qty,                 // pricing qty (may be non-base)
          qtyBase,             // stock qty (base)
          uomId,
          unitPrice: unitSellPrice,
          customerId: effectiveCustomerId,
          currencyCode: cur,
          fxToBase: fx,
          status: 'shipped',
          binId: fromBin,
          cogsUnitCost: avgCost,
          notes: notes?.trim() || undefined,
        } as CashSaleWithCogsArgsWithNotes)

        const { data: fresh } = await supabase
          .from('stock_levels')
          .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
          .eq('company_id', companyId)
          .eq('warehouse_id', warehouseFromId)
        setStockFrom((fresh || []).map(mapSL))

        setQtyEntered('')
        setRefId(''); setRefLineId(''); setNotes('')
        setSaleUnitPrice(''); setSaleCustomerId('')
        return toast.success(tt('movements.issued', 'Issued'))
      } catch (e: any) {
        console.error(e)
        const msg = String(e?.message || '')
        if (/duplicate key|unique constraint|23505/i.test(msg)) {
          toast.error(tt('customers.cashRace', 'CASH customer just got created by another request. Please try again.'))
        } else {
          toast.error(tt('movements.failedCreateSO', 'Failed to create the Sales Order'))
        }
        return
      }
    }

    // Non-SO issues
    const ins = await supabase.from('stock_movements').insert({
      company_id: companyId,
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
      ref_id: null,
      ref_line_id: null,
    }).select('id').single()

    if (ins.error) { console.error(ins.error); return toast.error(tt('movements.failed', 'Action failed')) }

    const { data: fresh } = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('company_id', companyId)
      .eq('warehouse_id', warehouseFromId)
    setStockFrom((fresh || []).map(mapSL))

    setQtyEntered('')
    setRefId(''); setRefLineId(''); setNotes('')
    toast.success(tt('movements.issued', 'Issued'))
  }

  async function submitTransfer() {
    if (!companyId) return toast.error(tt('org.noCompany', 'Join or create a company first'))
    if (!warehouseFromId || !warehouseToId) return toast.error(tt('movements.pickBothWh', 'Pick both warehouses'))
    if (!fromBin || !toBin) return toast.error(tt('movements.pickBothBins', 'Pick both bins'))
    if (warehouseFromId === warehouseToId && fromBin === toBin) return toast.error(tt('movements.sameSourceDest', 'Source and destination are the same'))
    if (!currentItem) return toast.error(tt('movements.selectItemRequired', 'Select an item'))

    const qty = num(qtyEntered); if (qty <= 0) return toast.error(tt('movements.qtyGtZero', 'Quantity must be > 0'))
    const uomId = movementUomId || itemBaseUomId
    const qtyBase = safeConvert(qty, uomId, itemBaseUomId); if (qtyBase == null) return toast.error(tt('movements.noConversionToBase', 'No conversion to base UoM'))

    const { qty: onHand, avgCost } = onHandIn(stockFrom, fromBin, currentItem.id)
    if (onHand < qtyBase) return toast.error(tt('orders.insufficientStock', 'Insufficient stock'))

    const ins = await supabase.from('stock_movements').insert({
      company_id: companyId,
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
    }).select('id').single()

    if (ins.error) { console.error(ins.error); return toast.error(tt('movements.failed', 'Action failed')) }

    const [freshFrom, freshTo] = await Promise.all([
      supabase.from('stock_levels').select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at').eq('company_id', companyId).eq('warehouse_id', warehouseFromId),
      supabase.from('stock_levels').select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at').eq('company_id', companyId).eq('warehouse_id', warehouseToId),
    ])
    setStockFrom((freshFrom.data || []).map(mapSL))
    setStockTo((freshTo.data || []).map(mapSL))
    setQtyEntered('')
    toast.success(tt('movements.transferCompleted', 'Transfer completed'))
  }

  async function submitAdjust() {
    if (!companyId) return toast.error(tt('org.noCompany', 'Join or create a company first'))
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

    const adjNote = `${tt('movements.note.adjust', 'Adjust to')} ${targetQtyEntered} ${(uomById.get(uomId)?.code || uomId).toString().toUpperCase()} (${tt('movements.current', 'current')}: ${currentBase})`

    if (delta > 0) {
      const unitCostNum = num(unitCost, NaN)
      if (!Number.isFinite(unitCostNum) || unitCostNum < 0) return toast.error(tt('movements.unitCostRequiredForIncrease', 'Unit cost required when increasing on-hand'))

      const ins = await supabase.from('stock_movements').insert({
        company_id: companyId,
        type: 'adjust',
        item_id: currentItem.id,
        uom_id: uomId,
        qty: targetQtyEntered,   // human-friendly target
        qty_base: delta,         // delta applied by trigger
        unit_cost: unitCostNum,
        total_value: delta * unitCostNum,
        warehouse_to_id: warehouseToId,
        bin_to_id: toBin,
        notes: `${adjNote}${notes ? ` | ${notes}` : ''}`,
        created_by: 'system',
        ref_type: 'ADJUST',
        ref_id: null,
        ref_line_id: null,
      }).select('id').single()
      if (ins.error) { console.error(ins.error); return toast.error(tt('movements.failed', 'Action failed')) }
    } else {
      const qtyBase = Math.abs(delta)
      const ins = await supabase.from('stock_movements').insert({
        company_id: companyId,
        type: 'issue',
        item_id: currentItem.id,
        uom_id: uomId,
        qty: Math.abs(targetQtyEntered - currentBase), // cosmetic
        qty_base: qtyBase,
        unit_cost: currentAvg,
        total_value: currentAvg * qtyBase,
        warehouse_from_id: warehouseToId,
        bin_from_id: toBin,
        notes: `${adjNote}${notes ? ` | ${notes}` : ''}`,
        created_by: 'system',
        ref_type: 'ADJUST',
        ref_id: null,
        ref_line_id: null,
      }).select('id').single()
      if (ins.error) { console.error(ins.error); return toast.error(tt('movements.failed', 'Action failed')) }
    }

    const { data: fresh } = await supabase
      .from('stock_levels')
      .select('id,item_id,warehouse_id,bin_id,qty,avg_cost,allocated_qty,updated_at')
      .eq('company_id', companyId)
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

  // ---------------------- Visual grouping helpers ----------------------------

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

  const baseFamily: string | undefined = useMemo(() => {
    if (!currentItem) return undefined
    const base = uomById.get(itemBaseUomId)
    return base?.family || undefined
  }, [currentItem, itemBaseUomId, uomById])

  const groupedUoms = useMemo(() => {
    const groups = new Map<string, Uom[]>()
    for (const u of uoms) {
      const fam = (u.family && u.family.trim()) ? u.family : 'unspecified'
      if (!groups.has(fam)) groups.set(fam, [])
      groups.get(fam)!.push(u)
    }
    for (const arr of groups.values()) arr.sort((a, b) => (a.code || '').localeCompare(b.code || ''))
    const families = Array.from(groups.keys())
    families.sort((a, b) => {
      if (baseFamily && a === baseFamily && b !== baseFamily) return -1
      if (baseFamily && b === baseFamily && a !== baseFamily) return 1
      return familyLabel(a).localeCompare(familyLabel(b))
    })
    return { groups, families }
  }, [uoms, baseFamily])

  const binContentGroups = useMemo(() => {
    const g: Array<{ key: string; label: string; totalQty: number; rows: BinItemRow[] }> = []
    const map = new Map<string, { key: string; label: string; totalQty: number; rows: BinItemRow[] }>()
    for (const row of itemsInSelectedBin) {
      const baseId = uomIdFromIdOrCode(row.item.baseUomId || '')
      const famKey = (uomById.get(baseId)?.family || 'unspecified') as string
      if (!map.has(famKey)) {
        map.set(famKey, { key: famKey, label: familyLabel(famKey), totalQty: 0, rows: [] })
      }
      const bucket = map.get(famKey)!
      bucket.rows.push(row)
      bucket.totalQty += num(row.onHandQty, 0)
    }
    for (const v of map.values()) {
      v.rows.sort((a, b) => a.item.name.localeCompare(b.item.name))
      g.push(v)
    }
    g.sort((a, b) => a.label.localeCompare(b.label))
    return g
  }, [itemsInSelectedBin, uomById, uoms])

  const showFromWH = movementType === 'issue' || movementType === 'transfer'
  const showToWH   = movementType !== 'issue'
  const showSaleBlock = movementType === 'issue' && String(refType || '').toUpperCase().startsWith('SO')

  // ------------------------------- UI ----------------------------------------
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
                  {tt('movements.bins.from', 'From')}{' '}{warehouses.find(w => w.id === warehouseFromId)?.name || ''}
                </div>
                {(binsFrom || []).length === 0 && <div className="text-sm text-muted-foreground">{tt('movements.noBins', 'No bins')}</div>}
                <div className="space-y-1">
                  {binsFrom.map(b => (
                    <Button
                      key={b.id}
                      variant={fromBin === b.id ? 'default' : 'outline'}
                      className="w-full justify-start"
                      onClick={() => {
                        setFromBin(b.id)
                        if (movementType !== 'transfer') setToBin('')
                        setItemId(''); setQtyEntered('')
                      }}
                    >
                      {b.code} — {b.name}
                    </Button>
                  ))}
                </div>
              </>
            )}
            {showToWH && (
              <>
                <div className="text-xs text-muted-foreground mt-2">
                  {tt('movements.bins.to', 'To')}{' '}{warehouses.find(w => w.id === warehouseToId)?.name || ''}
                </div>
                {(binsTo || []).length === 0 && <div className="text-sm text-muted-foreground">{tt('movements.noBins', 'No bins')}</div>}
                <div className="space-y-1">
                  {binsTo.map(b => (
                    <Button
                      key={b.id}
                      variant={toBin === b.id ? 'default' : 'outline'}
                      className="w-full justify-start"
                      onClick={() => {
                        setToBin(b.id)
                        if (movementType !== 'transfer') setFromBin('')
                      }}
                    >
                      {b.code} — {b.name}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Bin contents (grouped by item base UoM family) */}
        <Card className="col-span-12 md:col-span-8">
          <CardHeader><CardTitle>{tt('movements.title.binContents', 'Bin Contents')}</CardTitle></CardHeader>

          <CardContent className="overflow-x-auto">
            {!(fromBin || toBin) ? (
              <div className="text-sm text-muted-foreground">
                {tt('movements.pickBinToSee', 'Pick a bin to see contents')}
              </div>
            ) : (
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[48%]" />
                  <col className="w-[18%]" />
                  <col className="w-[17%]" />
                  <col className="w-[17%]" />
                </colgroup>

                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">{tt('table.item', 'Item')}</th>
                    <th className="py-2 pr-2">{tt('table.sku', 'SKU')}</th>
                    <th className="py-2 pr-2 text-right">{tt('movements.onHandBase', 'On Hand (base)')}</th>
                    <th className="py-2 pr-2 text-right">{tt('movements.avgCost', 'Avg Cost')}</th>
                  </tr>
                </thead>

                <tbody>
                  {binContentGroups.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-muted-foreground">
                        {tt('movements.emptyBin', 'Empty bin')}
                      </td>
                    </tr>
                  ) : (
                    binContentGroups.map(group => (
                      <Fragment key={group.key}>
                        <tr className="bg-muted/40">
                          <td colSpan={4} className="py-1 px-2 text-[11px] font-semibold uppercase">
                            {group.label} — {tt('movements.total', 'Total')}: {fmtAcct(group.totalQty)}
                          </td>
                        </tr>

                        {group.rows.map(row => (
                          <tr key={row.item.id} className="border-b">
                            <td className="py-2 pr-2 truncate">{row.item.name}</td>
                            <td className="py-2 pr-2">{row.item.sku ?? ''}</td>
                            <td className="py-2 pr-2 text-right">{fmtAcct(row.onHandQty)}</td>
                            <td className="py-2 pr-2 text-right">{fmtAcct(num(row.avgCost, 0))}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))
                  )}
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
                <Select
                  value={fromBin}
                  onValueChange={(v) => {
                    setFromBin(v)
                    if (movementType !== 'transfer') setToBin('')
                    setItemId(''); setQtyEntered('')
                  }}
                >
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
                <Select
                  value={toBin}
                  onValueChange={(v) => {
                    setToBin(v)
                    if (movementType !== 'transfer') setFromBin('')
                  }}
                >
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
                onValueChange={(v) => { setItemId(v); setQtyEntered('') }}
                // In transfer & issue, require FROM bin; in receive/adjust, require TO bin
                disabled={(movementType === 'issue' || movementType === 'transfer') ? !fromBin : !toBin}
              >
                <SelectTrigger><SelectValue placeholder={
                  (movementType === 'issue' || movementType === 'transfer')
                    ? (fromBin ? tt('movements.selectItem', 'Select item') : tt('movements.pickFromBinFirst', 'Pick a source bin first'))
                    : (toBin ? tt('movements.selectItem', 'Select item') : tt('movements.pickToBinFirst', 'Pick a destination bin first'))
                } /></SelectTrigger>
                <SelectContent>
                  {(movementType === 'issue' || (movementType === 'transfer' && fromBin))
                    ? stockFrom
                        .filter(s => (s.binId || null) === fromBin && num(s.onHandQty) > 0)
                        .map(s => ensureItemObject(s.itemId))
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(it => (<SelectItem key={it.id} value={it.id}>{it.name} ({it.sku ?? ''})</SelectItem>))
                    : items.map(it => (<SelectItem key={it.id} value={it.id}>{it.name} ({it.sku ?? ''})</SelectItem>))}
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
              <Select
                value={currentItem ? (movementUomId || itemBaseUomId || '') : ''}
                onValueChange={(v) => setMovementUomId(v)}
                disabled={!currentItem}
              >
                <SelectTrigger><SelectValue placeholder={currentItem ? tt('movements.selectUom', 'Select UoM') : tt('movements.pickItemFirst', 'Pick item first')} /></SelectTrigger>

                {/* Grouped by family */}
                <SelectContent className="max-h-64 overflow-auto">
                  {groupedUoms.families.map(fam => {
                    const list = groupedUoms.groups.get(fam) || []
                    return (
                      <div key={fam}>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground sticky top-0 bg-popover">
                          {familyLabel(fam)}
                        </div>
                        {list.map(u => {
                          const convertible = currentItem ? canConvert(u.id, itemBaseUomId) : false
                          return (
                            <SelectItem key={u.id} value={u.id}>
                              {u.code} — {u.name}{currentItem && !convertible ? tt('movements.notConvertibleSuffix', ' (no path)') : ''}
                            </SelectItem>
                          )
                        })}
                        <div className="h-1" />
                      </div>
                    )
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
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={tt('movements.notes.placeholder', 'Optional notes (e.g., Sold to John)')}
            />
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
