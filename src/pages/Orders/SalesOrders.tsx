// src/pages/Orders/SalesOrders.tsx
import { useEffect, useMemo, useState } from 'react'
import { db, supabase } from '../../lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../../components/ui/sheet'
import toast from 'react-hot-toast'
import MobileAddLineButton from '../../components/MobileAddLineButton'
import { formatMoneyBase, getBaseCurrencyCode } from '../../lib/currency'
import { buildConvGraph, convertQty, type ConvRow } from '../../lib/uom'
import { useI18n } from '../../lib/i18n'

type AppSettings = {
  sales?: {
    allowLineShip?: boolean
    autoCompleteWhenShipped?: boolean
    defaultFulfilWarehouseId?: string
  }
} & Record<string, any>

type Item = { id: string; name: string; sku: string; baseUomId: string }
type Uom = { id: string; code: string; name: string }
type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }
type Customer = {
  id: string
  code?: string
  name: string
  email?: string | null
  phone?: string | null
  tax_id?: string | null
  billing_address?: string | null
  shipping_address?: string | null
  payment_terms?: string | null
}
type Warehouse = { id: string; code?: string; name: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }

type SO = {
  id: string
  customer?: string
  customer_id?: string
  status: string
  currency_code?: string
  fx_to_base?: number
  expected_ship_date?: string | null
  notes?: string | null
  total_amount?: number | null
  payment_terms?: string | null
  bill_to_name?: string | null
  bill_to_email?: string | null
  bill_to_phone?: string | null
  bill_to_tax_id?: string | null
  bill_to_billing_address?: string | null
  bill_to_shipping_address?: string | null
}

type SOL = {
  id?: string
  so_id: string
  item_id: string
  uom_id: string
  line_no?: number
  qty: number
  unit_price: number
  discount_pct?: number | null
  line_total: number
  is_shipped?: boolean
  shipped_at?: string | null
  shipped_qty?: number
}

const nowISO = () => new Date().toISOString()
const n = (v: string | number | null | undefined, d = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : d
const fmtAcct = (v: number) => {
  const neg = v < 0
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return neg ? `(${s})` : s
}
const ts = (row: any) =>
  row?.createdAt ?? row?.created_at ?? row?.createdat ?? row?.updatedAt ?? row?.updated_at ?? row?.updatedat ?? 0

export default function SalesOrders() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) => {
    const s = t(key, vars)
    return s === key ? fallback : s
  }

  // masters
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [baseCode, setBaseCode] = useState<string>('MZN')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [app, setApp] = useState<AppSettings | null>(null)

  // conversions
  const [convGraph, setConvGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)
  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // lists
  const [sos, setSOs] = useState<SO[]>([])
  const [solines, setSOLines] = useState<SOL[]>([])

  // create form
  const [soOpen, setSoOpen] = useState(false)
  const [soCustomerId, setSoCustomerId] = useState('')
  const [soCurrency, setSoCurrency] = useState('MZN')
  const [soFx, setSoFx] = useState('1')
  const [soDate, setSoDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [soTaxPct, setSoTaxPct] = useState<string>('0')
  const [soLinesForm, setSoLinesForm] = useState<
    Array<{ itemId: string; uomId: string; qty: string; unitPrice: string; discountPct: string }>
  >([{ itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }])

  // view+ship
  const [soViewOpen, setSoViewOpen] = useState(false)
  const [selectedSO, setSelectedSO] = useState<SO | null>(null)
  const [shipWhId, setShipWhId] = useState<string>('')
  const [shipBinId, setShipBinId] = useState<string>('')

  // live bin previews
  const [soBinsPreview, setSoBinsPreview] = useState<
    Record<string, Array<{ binId: string | null; code: string; qty: number }>>
  >({})
  const [soBinOnHand, setSoBinOnHand] = useState<Record<string, number>>({})

  // helpers
  const codeOf = (id?: string) => (id ? (uomById.get(id)?.code || '').toUpperCase() : '')
  const uomIdFromIdOrCode = (v?: string | null): string => {
    if (!v) return ''
    if (uomById.has(v)) return v
    const needle = String(v).toUpperCase()
    for (const u of uoms) {
      if ((u.code || '').toUpperCase() === needle) return u.id
    }
    return ''
  }
  const idsOrCodesEqual = (aId?: string, bId?: string) => {
    if (!aId || !bId) return false
    if (aId === bId) return true
    const ac = codeOf(aId), bc = codeOf(bId)
    return !!(ac && bc && ac === bc)
  }
  const safeConvert = (qty: number, fromIdOrCode: string, toIdOrCode: string): number | null => {
    const from = uomIdFromIdOrCode(fromIdOrCode)
    const to = uomIdFromIdOrCode(toIdOrCode)
    if (!from || !to) return null
    if (idsOrCodesEqual(from, to)) return qty
    if (!convGraph) return null
    try { return Number(convertQty(qty, from, to, convGraph)) } catch { return null }
  }

  const soNo = (s: any) => s?.orderNo ?? s?.order_no ?? s?.id
  const fxSO = (s: SO) => n((s as any).fx_to_base ?? (s as any).fxToBase, 1)
  const curSO = (s: SO) => (s as any).currency_code ?? (s as any).currencyCode
  const soCustomerLabel = (s: SO) =>
    s.customer ?? (s.customer_id ? (customers.find(c => c.id === s.customer_id)?.name ?? s.customer_id) : tt('none', '(none)'))
  const binsForWH = (whId: string) => bins.filter(b => b.warehouseId === whId)

  // load masters, conversions, settings, lists, defaults
  useEffect(() => {
    ;(async () => {
      try {
        const [it, uu, cs, appRes] = await Promise.all([
          db.items.list({ orderBy: { name: 'asc' } }),
          supabase.from('uoms').select('id,code,name').order('code', { ascending: true }),
          supabase.from('company_currencies_view').select('code,name,symbol,decimals').order('code', { ascending: true }),
          supabase.from('app_settings').select('data').eq('id', 'app').maybeSingle(),
        ])
        setApp((appRes.data as any)?.data ?? {})

        setItems((it || []).map((x: any) => ({ ...x, baseUomId: x.baseUomId ?? x.base_uom_id ?? '' })))
        if (uu.error) throw uu.error
        setUoms(((uu.data || []) as any[]).map(u => ({ ...u, code: String(u.code || '').toUpperCase() })))

        setCurrencies((cs.data || []) as Currency[])

        setBaseCode(await getBaseCurrencyCode())

        const { data: convRows, error: convErr } = await supabase
          .from('uom_conversions')
          .select('from_uom_id,to_uom_id,factor')
        setConvGraph(convErr ? null : buildConvGraph((convRows || []) as ConvRow[]))

        const custs = await supabase
          .from('customers')
          .select('id,code,name,email,phone,tax_id,billing_address,shipping_address,payment_terms')
          .order('name', { ascending: true })
        if (custs.error) throw custs.error
        setCustomers((custs.data || []) as Customer[])

        const [so, sol] = await Promise.all([
          db.salesOrders.list(),
          db.salesOrderLines.list()
        ])
        const withFlags = (sol || []).map((l: any) => ({
          ...l,
          is_shipped: l.is_shipped ?? false,
          shipped_at: l.shipped_at ?? null,
          shipped_qty: Number.isFinite(Number(l.shipped_qty)) ? Number(l.shipped_qty) : 0,
        })) as SOL[]
        setSOs((so || []).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
        setSOLines(withFlags)

        const [whRes, binRes] = await Promise.all([
          db.warehouses.list({ orderBy: { name: 'asc' } }),
          db.bins.list({ orderBy: { code: 'asc' } }),
        ])
        setWarehouses(whRes || [])
        setBins(binRes || [])

        if (whRes && whRes.length) {
          const fromSettings = (appRes.data as any)?.data?.sales?.defaultFulfilWarehouseId
          const preferred = whRes.find(w => w.id === fromSettings) ?? whRes[0]
          setShipWhId(preferred.id)
          const firstBin = (binRes || []).find(b => b.warehouseId === preferred.id)?.id || ''
          setShipBinId(firstBin)
        }
      } catch (err: any) {
        console.error(err)
        toast.error(err?.message || tt('orders.loadFailed', 'Failed to load sales orders'))
      }
    })()
  }, [])

  useEffect(() => {
    setSoCurrency((prev) => prev && prev !== 'MZN' ? prev : baseCode)
  }, [baseCode])

  useEffect(() => {
    if (currencies.length === 0) return
    const exists = currencies.some(c => c.code === soCurrency)
    if (!exists) setSoCurrency(currencies[0].code)
  }, [currencies])

  // live "top bins" preview across the selected warehouse
  useEffect(() => {
    async function run() {
      if (!soViewOpen || !selectedSO || !shipWhId) { setSoBinsPreview({}); return }
      const lines = solines.filter(l => l.so_id === selectedSO.id && !(l.is_shipped || 0) && (n(l.qty) - n(l.shipped_qty)) > 0)
      const itemIds = Array.from(new Set(lines.map(l => l.item_id)))
      if (itemIds.length === 0) { setSoBinsPreview({}); return }
      try {
        const { data, error } = await supabase
          .from('stock_levels')
          .select('item_id,bin_id,qty')
          .eq('warehouse_id', shipWhId)
          .in('item_id', itemIds)
        if (error) throw error
        const byItem: Record<string, Array<{ binId: string | null; code: string; qty: number }>> = {}
        for (const r of (data || []) as Array<{ item_id: string; bin_id: string | null; qty: number | null }>) {
          const qty = n(r.qty, 0)
          const binId = r.bin_id
          const code = binId ? (bins.find(b => b.id === binId)?.code || 'bin') : tt('orders.noBin', '(no bin)')
          if (!byItem[r.item_id]) byItem[r.item_id] = []
          byItem[r.item_id].push({ binId, code, qty })
        }
        Object.keys(byItem).forEach(k => byItem[k].sort((a, b) => b.qty - a.qty))
        setSoBinsPreview(byItem)
      } catch (e) {
        console.warn('SO bin preview failed:', e)
        setSoBinsPreview({})
      }
    }
    run()
  }, [soViewOpen, selectedSO, shipWhId, bins, solines])

  // on-hand for the selected bin
  useEffect(() => {
    async function run() {
      if (!soViewOpen || !selectedSO || !shipWhId || !shipBinId) { setSoBinOnHand({}); return }
      const lines = solines.filter(l => l.so_id === selectedSO.id && !(l.is_shipped || 0) && (n(l.qty) - n(l.shipped_qty)) > 0)
      const itemIds = Array.from(new Set(lines.map(l => l.item_id)))
      if (itemIds.length === 0) { setSoBinOnHand({}); return }
      try {
        const { data, error } = await supabase
          .from('stock_levels')
          .select('item_id,qty')
          .eq('warehouse_id', shipWhId)
          .eq('bin_id', shipBinId)
          .in('item_id', itemIds)
        if (error) throw error
        const map: Record<string, number> = {}
        for (const r of (data || []) as Array<{ item_id: string; qty: number | null }>) {
          map[r.item_id] = n(r.qty, 0)
        }
        setSoBinOnHand(map)
      } catch (e) {
        console.warn('SO bin on-hand fetch failed:', e)
        setSoBinOnHand({})
      }
    }
    run()
  }, [soViewOpen, selectedSO, shipWhId, shipBinId, solines])

  // stock helpers
  const num = (v: any, d=0) => (Number.isFinite(Number(v)) ? Number(v) : d)
  async function upsertStockLevel(whId: string, binId: string | null, itemId: string, deltaQtyBase: number) {
    let q = supabase
      .from('stock_levels')
      .select('id,qty,avg_cost')
      .eq('warehouse_id', whId)
      .eq('item_id', itemId)
      .limit(1)
    q = binId ? q.eq('bin_id', binId) : q.is('bin_id', null)
    const { data: found, error: selErr } = await q
    if (selErr) throw selErr

    if (!found || found.length === 0) {
      if (deltaQtyBase > 0) {
        await supabase.from('stock_levels').insert({
          warehouse_id: whId,
          bin_id: binId,
          item_id: itemId,
          qty: deltaQtyBase,
          allocated_qty: 0,
          avg_cost: 0,
          updated_at: nowISO(),
        } as any)
      } else {
        throw new Error(tt('orders.insufficientStock', 'Insufficient stock at source bin'))
      }
      return
    }

    const row = found[0] as { id: string; qty: number | null }
    const oldQty = num(row.qty, 0)
    const newQty = oldQty + deltaQtyBase
    if (newQty < 0) throw new Error(tt('orders.insufficientStock', 'Insufficient stock at source bin'))

    const { error: updErr } = await supabase
      .from('stock_levels')
      .update({ qty: newQty, updated_at: nowISO() })
      .eq('id', row.id)
    if (updErr) throw updErr
  }

  async function avgCostAt(whId: string, binId: string | null, itemId: string) {
    let q = supabase
      .from('stock_levels')
      .select('qty,avg_cost')
      .eq('warehouse_id', whId)
      .eq('item_id', itemId)
      .limit(1)
    q = binId ? q.eq('bin_id', binId) : q.is('bin_id', null)
    const { data } = await q
    const row: any = data && data[0]
    return { onHand: n(row?.qty, 0), avgCost: n(row?.avg_cost, 0) }
  }

  // actions
  async function tryUpdateStatus(id: string, candidates: string[]) {
    for (const status of candidates) {
      const { error } = await supabase.from('sales_orders').update({ status }).eq('id', id)
      if (!error) return status
      if (!String(error?.message || '').toLowerCase().includes('invalid input value for enum')) throw error
    }
    return null
  }

  const calcFormSubtotal = (rows: Array<{ qty: string; unitPrice: string; discountPct: string }>) =>
    rows.reduce((s, r) => s + n(r.qty) * n(r.unitPrice) * (1 - n(r.discountPct, 0) / 100), 0)

  async function createSO() {
    try {
      if (!soCustomerId) return toast.error(tt('orders.customerRequired', 'Customer is required'))
      const cleanLines = soLinesForm
        .map(l => ({ ...l, qty: n(l.qty), unitPrice: n(l.unitPrice), discountPct: n(l.discountPct) }))
        .filter(l => l.itemId && l.uomId && l.qty > 0 && l.unitPrice >= 0 && l.discountPct >= 0 && l.discountPct <= 100)
      if (!cleanLines.length) return toast.error(tt('orders.addOneLine', 'Add at least one valid line'))

      const allowed = currencies.map(c => c.code)
      const chosenCurrency = allowed.length === 0
        ? baseCode
        : (allowed.includes(soCurrency) ? soCurrency : allowed[0])

      const fx = n(soFx, 1)
      const cust = customers.find(c => c.id === soCustomerId)
      const headerSubtotal = calcFormSubtotal(soLinesForm)

      const inserted: any = await supabase
        .from('sales_orders')
        .insert({
          customer_id: soCustomerId,
          status: 'draft',
          currency_code: chosenCurrency,
          fx_to_base: fx,
          expected_ship_date: soDate || null,
          notes: null,
          payment_terms: cust?.payment_terms ?? null,
          bill_to_name: cust?.name ?? null,
          bill_to_email: cust?.email ?? null,
          bill_to_phone: cust?.phone ?? null,
          bill_to_tax_id: cust?.tax_id ?? null,
          bill_to_billing_address: cust?.billing_address ?? null,
          bill_to_shipping_address: cust?.shipping_address ?? null,
          total_amount: headerSubtotal,
        })
        .select('id')
        .single()
      if (inserted.error) throw inserted.error
      const soId = inserted.data.id

      for (let i = 0; i < cleanLines.length; i++) {
        const l = cleanLines[i]; const lineNo = i + 1
        const lineTotal = l.qty * l.unitPrice * (1 - l.discountPct / 100)
        await db.salesOrderLines.create({
          so_id: soId,
          item_id: l.itemId,
          uom_id: l.uomId,
          line_no: lineNo,
          qty: l.qty,
          unit_price: l.unitPrice,
          discount_pct: l.discountPct,
          line_total: lineTotal,
          is_shipped: false,
          shipped_at: null,
          shipped_qty: 0,
        } as any)
      }

      toast.success(tt('orders.soCreated', 'Sales Order created'))
      setSoCustomerId('')
      setSoCurrency(baseCode)
      setSoFx('1')
      setSoTaxPct('0')
      setSoLinesForm([{ itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }])
      setSoOpen(false)

      const [so, sol] = await Promise.all([ db.salesOrders.list(), db.salesOrderLines.list() ])
      const withFlags = (sol || []).map((l: any) => ({
        ...l,
        is_shipped: l.is_shipped ?? false,
        shipped_at: l.shipped_at ?? null,
        shipped_qty: Number.isFinite(Number(l.shipped_qty)) ? Number(l.shipped_qty) : 0,
      })) as SOL[]
      setSOs((so || []).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
      setSOLines(withFlags)
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soCreateFailed', 'Failed to create SO'))
    }
  }

  async function confirmSO(soId: string) {
    try {
      const lines = solines.filter(l => l.so_id === soId)
      const subtotal = lines.reduce((s, l) => s + n(l.line_total), 0)

      const updated = await tryUpdateStatus(soId, ['confirmed', 'approved', 'open'])
      await supabase.from('sales_orders').update({ total_amount: subtotal }).eq('id', soId)

      setSOs(prev => prev.map(s => (s.id === soId ? { ...s, status: updated || s.status, total_amount: subtotal } : s)))
      toast.success(tt('orders.soConfirmed', 'SO confirmed'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soConfirmFailed', 'Failed to confirm SO'))
    }
  }

  async function cancelSO(soId: string) {
    try {
      const updated = await tryUpdateStatus(soId, ['cancelled', 'canceled'])
      if (updated) setSOs(prev => prev.map(s => (s.id === soId ? { ...s, status: updated } : s)))
      toast.success(tt('orders.soCancelled', 'SO cancelled'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soCancelFailed', 'Failed to cancel SO'))
    }
  }

  async function setSOFinalStatus(soId: string) {
    const allowComplete = !!app?.sales?.autoCompleteWhenShipped
    const candidates = allowComplete
      ? ['completed', 'shipped', 'fulfilled', 'delivered', 'closed']
      : ['shipped', 'fulfilled', 'delivered', 'closed']
    return await tryUpdateStatus(soId, candidates)
  }

  // Ship a line: ship the outstanding (qty - shipped_qty)
  async function doShipLineSO(so: SO, line: SOL) {
    try {
      if (!shipWhId) return toast.error(tt('orders.selectSourceWh', 'Select source warehouse'))
      if (!shipBinId) return toast.error(tt('orders.selectSourceBin', 'Select source bin'))

      const total = n(line.qty)
      const already = n(line.shipped_qty)
      const outstanding = Math.max(total - already, 0)
      if (outstanding <= 0) {
        toast.success(tt('orders.lineAlreadyShipped', 'Line already shipped'))
        return
      }

      const it = itemById.get(line.item_id)
      if (!it) throw new Error(`Item not found for line ${line.item_id}`)
      const baseUom = it.baseUomId

      const qtyBaseOutstanding = safeConvert(outstanding, line.uom_id, baseUom)
      if (qtyBaseOutstanding == null) {
        const fromCode = uomById.get(uomIdFromIdOrCode(line.uom_id))?.code || line.uom_id
        throw new Error(tt('orders.noConversion', 'No conversion from {from} to base for {sku}')
          .replace('{from}', String(fromCode)).replace('{sku}', String(it.sku)))
      }

      const { onHand, avgCost } = await avgCostAt(shipWhId, shipBinId, it.id)
      if (onHand < qtyBaseOutstanding) throw new Error(tt('orders.insufficientStockBin', 'Insufficient stock in bin for item {sku}')
        .replace('{sku}', String(it?.sku || '')))

      // Deduct stock
      await upsertStockLevel(shipWhId, shipBinId, it.id, -qtyBaseOutstanding)

      // Movement record
      await supabase.from('stock_movements').insert({
        type: 'issue',
        item_id: it.id,
        uom_id: uomIdFromIdOrCode(line.uom_id) || line.uom_id,
        qty: outstanding,
        qty_base: qtyBaseOutstanding,
        unit_cost: avgCost,
        total_value: avgCost * qtyBaseOutstanding,
        warehouse_from_id: shipWhId,
        bin_from_id: shipBinId,
        notes: `SO ${soNo(so)}`,
        created_by: 'system',
        ref_type: 'SO',
        ref_id: (so as any).id,
        ref_line_id: line.id ?? null,
      } as any)

      // Mark shipped_qty and possibly is_shipped
      const newShipped = already + outstanding
      const fully = newShipped >= total - 1e-9

      if (line.id) {
        const { error: updErr } = await supabase
          .from('sales_order_lines')
          .update({
            shipped_qty: newShipped,
            is_shipped: fully,
            shipped_at: fully ? nowISO() : (line.shipped_at ?? null),
          })
          .eq('id', line.id)
        if (updErr) throw updErr
      }

      setSOLines(prev => prev.map(l => l.id === line.id
        ? { ...l, shipped_qty: newShipped, is_shipped: fully, shipped_at: fully ? nowISO() : l.shipped_at }
        : l))

      // If all lines fully shipped, close order
      const remaining = solines.filter(l =>
        l.so_id === so.id &&
        (n(l.qty) - n(l.shipped_qty)) > 0 &&
        l.id !== line.id
      ).length

      if (remaining === 0) {
        const final = await setSOFinalStatus(so.id)
        if (final) setSOs(prev => prev.map(s => (s.id === so.id ? { ...s, status: final } : s)))
        setSoViewOpen(false)
        setSelectedSO(null)
      }

      toast.success(tt('orders.lineShipped', 'Line shipped'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.shipLineFailed', 'Failed to ship line'))
    }
  }

  async function doShipSO(so: SO) {
    try {
      if (!shipWhId) return toast.error(tt('orders.selectSourceWh', 'Select source warehouse'))
      if (!shipBinId) return toast.error(tt('orders.selectSourceBin', 'Select source bin'))

      const lines = solines.filter(l => l.so_id === so.id && (n(l.qty) - n(l.shipped_qty)) > 0)
      if (!lines.length) return toast.error(tt('orders.noLinesToShip', 'No lines to ship'))

      for (const l of lines) {
        // eslint-disable-next-line no-await-in-loop
        await doShipLineSO(so, l)
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.shipSoFailed', 'Failed to ship SO'))
    }
  }

  // computed
  const soOutstanding = useMemo(
    () => sos.filter(s => ['draft', 'confirmed'].includes(String(s.status).toLowerCase())),
    [sos]
  )
  const soSubtotal = soLinesForm.reduce((s, r) => s + n(r.qty) * n(r.unitPrice) * (1 - n(r.discountPct,0)/100), 0)
  const soTax = soSubtotal * (n(soTaxPct, 0) / 100)
  

  function soHeaderSubtotal(so: SO): number {
    const header = n((so as any).total_amount, NaN)
    if (Number.isFinite(header)) return header
    return solines.filter(l => l.so_id === so.id).reduce((s, l) => s + n(l.line_total), 0)
  }

  function printSO(so: SO) {
    const currency = curSO(so) || '—'
    const fx = fxSO(so) || 1
    const lines = solines.filter(l => l.so_id === so.id)
    const rows = lines.map(l => {
      const it = itemById.get(l.item_id)
      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
      const disc = n(l.discount_pct, 0)
      const lineTotal = n(l.qty) * n(l.unit_price) * (1 - disc/100)
      const shippedBadge = (n(l.shipped_qty) >= n(l.qty)) || l.is_shipped
        ? ' <span style="color:#16a34a;font-weight:600">(shipped)</span>' : ''
      return `<tr><td>${it?.name || l.item_id}${shippedBadge}</td><td>${it?.sku || ''}</td><td class="right">${fmtAcct(n(l.qty))}</td><td>${uomCode}</td><td class="right">${fmtAcct(n(l.unit_price))}</td><td class="right">${fmtAcct(disc)}</td><td class="right">${fmtAcct(lineTotal)}</td></tr>`
    }).join('')

    const subtotal = soHeaderSubtotal(so)
    const number = soNo(so)
    const html = `
      <h1>Sales Order ${number}</h1>
      <div class="meta">Status: <b>${so.status}</b> · Currency: <b>${currency}</b> · FX→${baseCode}: <b>${fmtAcct(fx)}</b></div>
      <table><thead><tr><th>Item</th><th>SKU</th><th class="right">Qty</th><th>UoM</th><th class="right">Unit Price</th><th class="right">Disc %</th><th class="right">Line Total (${currency})</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="totals"><div><span>Subtotal (${currency})</span><span>${fmtAcct(subtotal)}</span></div><div class="muted"><span>FX to ${baseCode}</span><span>${fmtAcct(fx)}</span></div><div><span>Total (${baseCode})</span><span>${fmtAcct(subtotal * fx)}</span></div></div>
    `
    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<html><head><title>SO ${number}</title><meta charset="utf-8"/><style>
      body{font-family:ui-sans-serif; padding:24px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left}
      .right{text-align:right}.meta{font-size:12px;color:#444;margin:8px 0 16px}
      .totals{margin-top:12px;width:320px;margin-left:auto;display:flex;flex-direction:column;gap:4px}
    </style></head><body>${html}</body></html>`)
    w.document.close(); w.focus(); w.print()
  }

  return (
    <>
      {/* Outstanding + Create SO */}
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{tt('orders.outstandingSOs', 'Outstanding Sales Orders')}</CardTitle>

            <Sheet open={soOpen} onOpenChange={setSoOpen}>
              <SheetTrigger asChild>
                <Button size="sm">{tt('orders.newSO', 'New SO')}</Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:w=[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
                <SheetHeader>
                  <SheetTitle>{tt('orders.newSO', 'New Sales Order')}</SheetTitle>
                  <SheetDescription className="sr-only">{tt('orders.createSO', 'Create a sales order')}</SheetDescription>
                </SheetHeader>

                {/* Header */}
                <div className="mt-4 grid md:grid-cols-4 gap-3">
                  <div>
                    <Label>{tt('orders.customer', 'Customer')}</Label>
                    <Select value={soCustomerId} onValueChange={setSoCustomerId}>
                      <SelectTrigger><SelectValue placeholder={tt('orders.selectCustomer', 'Select customer')} /></SelectTrigger>
                      <SelectContent className="max-h-64 overflow-auto">
                        {customers.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {(c.code ? c.code + ' — ' : '') + c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{tt('orders.currency', 'Currency')}</Label>
                    <Select value={soCurrency} onValueChange={setSoCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(currencies.length ? currencies : [{ code: baseCode, name: baseCode }]).map(c =>
                          <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{tt('orders.fxToBase', 'FX to Base ({code})', { code: baseCode })}</Label>
                    <Input type="number" min="0" step="0.000001" value={soFx} onChange={e => setSoFx(e.target.value)} />
                  </div>
                  <div>
                    <Label>{tt('orders.expectedShip', 'Expected Ship')}</Label>
                    <Input type="date" value={soDate} onChange={e => setSoDate(e.target.value)} />
                  </div>
                </div>

                {/* Lines */}
                <div className="mt-6">
                  <Label>{tt('orders.lines', 'Lines')}</Label>
                  <div className="mt-2 border rounded-lg overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="py-2 px-3">{tt('table.item', 'Item')}</th>
                          <th className="py-2 px-3 w-24">{tt('orders.uom', 'UoM')}</th>
                          <th className="py-2 px-3 w-28">{tt('orders.qty', 'Qty')}</th>
                          <th className="py-2 px-3 w-40">{tt('orders.unitPrice', 'Unit Price')}</th>
                          <th className="py-2 px-3 w-28">{tt('orders.discountPct', 'Disc %')}</th>
                          <th className="py-2 px-3 w-36 text-right">{tt('orders.lineTotal', 'Line Total')}</th>
                          <th className="py-2 px-3 w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {soLinesForm.map((ln, idx) => {
                          const lineTotal = n(ln.qty) * n(ln.unitPrice) * (1 - n(ln.discountPct,0)/100)
                          return (
                            <tr key={idx} className="border-t">
                              <td className="py-2 px-3">
                                <Select
                                  value={ln.itemId}
                                  onValueChange={(v) =>
                                    setSoLinesForm(prev =>
                                      prev.map((x, i) => i === idx ? { ...x, itemId: v, uomId: (itemById.get(v)?.baseUomId || x.uomId) } : x)
                                    )
                                  }
                                >
                                  <SelectTrigger><SelectValue placeholder={tt('orders.item', 'Item')} /></SelectTrigger>
                                  <SelectContent className="max-h-64 overflow-auto">
                                    {items.map(it => <SelectItem key={it.id} value={it.id}>{it.name} ({it.sku})</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="py-2 px-3">
                                <Select value={ln.uomId} onValueChange={(v) => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, uomId: v } : x))}>
                                  <SelectTrigger><SelectValue placeholder={tt('orders.uom', 'UoM')} /></SelectTrigger>
                                  <SelectContent className="max-h-64 overflow-auto">
                                    {uoms.map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="py-2 px-3">
                                <Input inputMode="decimal" type="number" min="0" step="0.0001" value={ln.qty} onChange={e => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))} />
                              </td>
                              <td className="py-2 px-3">
                                <Input inputMode="decimal" type="number" min="0" step="0.0001" value={ln.unitPrice} onChange={e => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} />
                              </td>
                              <td className="py-2 px-3">
                                <Input type="number" min="0" max="100" step="0.01" value={ln.discountPct} onChange={e => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, discountPct: e.target.value } : x))} />
                              </td>
                              <td className="py-2 px-3 text-right">{fmtAcct(lineTotal)}</td>
                              <td className="py-2 px-3 text-right">
                                <Button size="icon" variant="ghost" onClick={() => setSoLinesForm(prev => prev.filter((_, i) => i !== idx))}>✕</Button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="p-2">
                      <MobileAddLineButton
                        onAdd={() => setSoLinesForm(prev => [...prev, { itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }])}
                        label={tt('orders.addLine', 'Add Line')}
                      />
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t mt-4">
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div className="flex items-center gap-3">
                        <Label className="whitespace-nowrap">{tt('orders.taxPct', 'Tax %')}</Label>
                        <Input className="w-28" type="number" min="0" step="0.01" value={soTaxPct} onChange={e => setSoTaxPct(e.target.value)} />
                      </div>
                      <div className="flex flex-col items-end text-sm">
                        <div className="w-full max-w-sm grid grid-cols-2 gap-1">
                          <div className="text-muted-foreground">{tt('orders.subtotal', 'Subtotal')} ({soCurrency})</div>
                          <div className="text-right">{fmtAcct(soSubtotal)}</div>
                          <div className="text-muted-foreground">{tt('orders.tax', 'Tax')}</div>
                          <div className="text-right">{fmtAcct(soTax)}</div>
                          <div className="font-medium">{tt('orders.total', 'Total')}</div>
                          <div className="text-right font-medium">{fmtAcct(soSubtotal + soTax)}</div>
                        </div>
                        <div className="mt-3">
                          <Button onClick={createSO}>{tt('orders.createSO', 'Create SO')}</Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.so', 'SO')}</th>
              <th className="py-2 pr-2">{tt('orders.customer', 'Customer')}</th>
              <th className="py-2 pr-2">{tt('orders.status', 'Status')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
              <th className="py-2 pr-2">{tt('orders.actions', 'Actions')}</th>
            </tr></thead>
            <tbody>
              {soOutstanding.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.nothingPending', 'Nothing pending.')}</td></tr>}
              {soOutstanding.map(so => {
                const header = n((so as any).total_amount, NaN)
                const sumLines = solines.filter(l => l.so_id === so.id).reduce((s, l) => s + n(l.line_total), 0)
                const orderSubtotal = Number.isFinite(header) ? header : sumLines
                const totalBase = orderSubtotal * fxSO(so)
                return (
                  <tr key={so.id} className="border-b">
                    <td className="py-2 pr-2">{soNo(so)}</td>
                    <td className="py-2 pr-2">{soCustomerLabel(so)}</td>
                    <td className="py-2 pr-2 capitalize">{so.status}</td>
                    <td className="py-2 pr-2">{formatMoneyBase(totalBase, baseCode)}</td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setSelectedSO(so); setSoViewOpen(true) }}>{tt('orders.view', 'View')}</Button>
                        <Button size="sm" variant="outline" onClick={() => printSO(so)}>{tt('orders.print', 'Print')}</Button>
                        {String(so.status).toLowerCase() === 'draft' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => confirmSO(so.id)}>{tt('orders.confirm', 'Confirm')}</Button>
                            <Button size="sm" variant="destructive" onClick={() => cancelSO(so.id)}>{tt('orders.cancel', 'Cancel')}</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Recent */}
      <Card>
        <CardHeader><CardTitle>{tt('orders.recentSOs', 'Recent Sales Orders')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.so', 'SO')}</th>
              <th className="py-2 pr-2">{tt('orders.customer', 'Customer')}</th>
              <th className="py-2 pr-2">{tt('orders.status', 'Status')}</th>
              <th className="py-2 pr-2">{tt('orders.currency', 'Currency')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
            </tr></thead>
            <tbody>
              {sos.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.noSOsYet', 'No SOs yet.')}</td></tr>}
              {sos.map(so => {
                const header = n((so as any).total_amount, NaN)
                const sumLines = solines.filter(l => l.so_id === so.id).reduce((s, l) => s + n(l.line_total), 0)
                const orderSubtotal = Number.isFinite(header) ? header : sumLines
                const totalBase = orderSubtotal * fxSO(so)
                return (
                  <tr key={so.id} className="border-b">
                    <td className="py-2 pr-2">{soNo(so)}</td>
                    <td className="py-2 pr-2">{soCustomerLabel(so)}</td>
                    <td className="py-2 pr-2 capitalize">{so.status}</td>
                    <td className="py-2 pr-2">{curSO(so)}</td>
                    <td className="py-2 pr-2">{formatMoneyBase(totalBase, baseCode)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* SO View / Ship */}
      <Sheet open={soViewOpen} onOpenChange={(o) => { if (!o) { setSelectedSO(null) } setSoViewOpen(o) }}>
        <SheetContent side="right" className="w-full sm:w=[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
          <SheetHeader>
            <SheetTitle>{tt('orders.soDetails', 'SO Details')}</SheetTitle>
            <SheetDescription className="sr-only">{tt('orders.soDetailsDesc', 'Review, select source bin, and ship')}</SheetDescription>
          </SheetHeader>

          {!selectedSO ? (
            <div className="p-4 text-sm text-muted-foreground">{tt('orders.noSOSelected', 'No SO selected.')}</div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div><Label>{tt('orders.so', 'SO')}</Label><div>{soNo(selectedSO)}</div></div>
                <div><Label>{tt('orders.customer', 'Customer')}</Label><div>{soCustomerLabel(selectedSO)}</div></div>
                <div><Label>{tt('orders.status', 'Status')}</Label><div className="capitalize">{selectedSO.status}</div></div>
                <div><Label>{tt('orders.currency', 'Currency')}</Label><div>{curSO(selectedSO)}</div></div>
                <div><Label>{tt('orders.fxToBaseShort', 'FX to Base')}</Label><div>{fmtAcct(fxSO(selectedSO))}</div></div>
                <div><Label>{tt('orders.expectedShip', 'Expected Ship')}</Label><div>{(selectedSO as any).expected_ship_date || tt('none', '(none)')}</div></div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <Label>{tt('orders.fromWarehouse', 'From Warehouse')}</Label>
                  <Select value={shipWhId} onValueChange={(v) => {
                    setShipWhId(v)
                    const first = binsForWH(v)[0]?.id || ''
                    setShipBinId(first)
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('orders.fromBin', 'From Bin')}</Label>
                  <Select value={shipBinId} onValueChange={setShipBinId}>
                    <SelectTrigger><SelectValue placeholder={tt('orders.selectBin', 'Select bin')} /></SelectTrigger>
                    <SelectContent>
                      {binsForWH(shipWhId).map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-end gap-2">
                  <Button variant="outline" onClick={() => printSO(selectedSO)}>{tt('orders.print', 'Print')}</Button>
                  {String(selectedSO.status).toLowerCase() === 'confirmed' && (
                    <Button onClick={() => doShipSO(selectedSO)}>
                      {tt('orders.shipAll', 'Ship All Outstanding')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="py-2 px-3">{tt('table.item', 'Item')}</th>
                      <th className="py-2 px-3">{tt('table.sku', 'SKU')}</th>
                      <th className="py-2 px-3">{tt('orders.qtyUom', 'Qty (UoM)')}</th>
                      <th className="py-2 px-3">{tt('orders.discountPct', 'Disc %')}</th>
                      <th className="py-2 px-3">{tt('table.qtyBase', 'Qty (base)')}</th>
                      <th className="py-2 px-3">{tt('orders.onHandBin', 'On-hand (bin)')}</th>
                      <th className="py-2 px-3">{tt('orders.binHint', 'Bin Hint')}</th>
                      <th className="py-2 px-3 text-right">{tt('orders.action', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solines.filter(l => l.so_id === selectedSO.id && (n(l.qty) - n(l.shipped_qty)) > 0).map(l => {
                      const it = itemById.get(l.item_id)
                      const baseU = it?.baseUomId || ''
                      const outstanding = Math.max(n(l.qty) - n(l.shipped_qty), 0)
                      const qtyBase = it ? safeConvert(outstanding, l.uom_id, baseU) : null
                      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
                      const baseUomCode =
                        it?.baseUomId ? (uomById.get(uomIdFromIdOrCode(it.baseUomId))?.code || 'BASE') : 'BASE'

                      const disc = n(l.discount_pct, 0)
                      const onHandBin = soBinOnHand[l.item_id] ?? 0
                      const enough = qtyBase != null && onHandBin >= qtyBase

                      const tops = (soBinsPreview[l.item_id] || []).slice(0, 3)
                      const hint = tops.length
                        ? tops.map(t => `${t.code}: ${fmtAcct(t.qty)} ${baseUomCode}`).join(', ')
                        : tt('orders.noStockInWh', 'No stock in selected warehouse')

                      return (
                        <tr key={String(l.id) || `${l.so_id}-${l.item_id}-${l.line_no}`} className="border-t">
                          <td className="py-2 px-3">{it?.name || l.item_id}</td>
                          <td className="py-2 px-3">{it?.sku || '—'}</td>
                          <td className="py-2 px-3">{fmtAcct(n(l.qty))} {uomCode}</td>
                          <td className="py-2 px-3">{fmtAcct(disc)}</td>
                          <td className="py-2 px-3">{qtyBase == null ? '—' : `${fmtAcct(qtyBase)} ${baseUomCode}`}</td>
                          <td className={`py-2 px-3 font-medium ${enough ? 'text-green-600' : 'text-red-600'}`}>
                            {fmtAcct(onHandBin)} {baseUomCode}
                          </td>
                          <td className="py-2 px-3">{hint}</td>
                          <td className="py-2 px-3 text-right">
                            <Button size="sm" disabled={!enough || String(selectedSO.status).toLowerCase() !== 'confirmed'} onClick={() => doShipLineSO(selectedSO, l)}>
                              {tt('orders.ship', 'Ship Outstanding')}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                    {solines.filter(l => l.so_id === selectedSO.id && (n(l.qty) - n(l.shipped_qty)) > 0).length === 0 && (
                      <tr><td colSpan={8} className="py-3 text-muted-foreground">{tt('orders.allLinesShipped', 'All lines shipped.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
