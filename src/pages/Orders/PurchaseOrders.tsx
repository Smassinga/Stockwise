// src/pages/Orders/PurchaseOrders.tsx
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

type Item = { id: string; name: string; sku: string; baseUomId: string }
type Uom = { id: string; code: string; name: string }
type Currency = { code: string; name: string }
type Supplier = { id: string; code?: string; name: string; email?: string|null; phone?: string|null; tax_id?: string|null; payment_terms?: string|null }
type Warehouse = { id: string; code?: string; name: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }

type PO = {
  id: string; status: string; currency_code?: string; fx_to_base?: number; expected_date?: string|null; notes?: string|null;
  supplier?: string; supplier_id?: string; payment_terms?: string|null; supplier_name?: string|null; supplier_email?: string|null; supplier_phone?: string|null; supplier_tax_id?: string|null
}
type POL = { id?: string; po_id: string; item_id: string; uom_id: string; line_no?: number; qty: number; unit_price: number; discount_pct?: number|null; line_total: number }

const nowISO = () => new Date().toISOString()
const n = (v: string | number | null | undefined, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d
const fmtAcct = (v: number) => { const neg = v < 0; const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return neg ? `(${s})` : s }
const ts = (row: any) => row?.createdAt ?? row?.created_at ?? row?.createdat ?? row?.updatedAt ?? row?.updated_at ?? row?.updatedat ?? 0

export default function PurchaseOrders() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) => {
    const s = t(key, vars); return s === key ? fallback : s
  }

  // masters
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [baseCode, setBaseCode] = useState<string>('MZN')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])

  // conversions
  const [convGraph, setConvGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)
  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // lists
  const [pos, setPOs] = useState<PO[]>([])
  const [polines, setPOLines] = useState<POL[]>([])

  // create form
  const [poOpen, setPoOpen] = useState(false)
  const [poSupplierId, setPoSupplierId] = useState('')
  const [poCurrency, setPoCurrency] = useState('MZN')
  const [poFx, setPoFx] = useState('1')
  const [poDate, setPoDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [poTaxPct, setPoTaxPct] = useState<string>('0')
  const [poLinesForm, setPoLinesForm] = useState<Array<{ itemId: string; uomId: string; qty: string; unitPrice: string; discountPct: string }>>([
    { itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }
  ])

  // view+receive
  const [poViewOpen, setPoViewOpen] = useState(false)
  const [selectedPO, setSelectedPO] = useState<PO | null>(null)
  const [receiveWhId, setReceiveWhId] = useState<string>('')
  const [receiveBinId, setReceiveBinId] = useState<string>('')

  // helpers
  const codeOf = (id?: string) => (id ? (uomById.get(id)?.code || '').toUpperCase() : '')
  const uomIdFromIdOrCode = (v?: string | null): string => {
    if (!v) return ''
    if (uomById.has(v)) return v
    const needle = String(v).toUpperCase()
    for (const u of uoms) if ((u.code || '').toUpperCase() === needle) return u.id
    return ''
  }
  const safeConvert = (qty: number, fromIdOrCode: string, toIdOrCode: string): number | null => {
    const from = uomIdFromIdOrCode(fromIdOrCode), to = uomIdFromIdOrCode(toIdOrCode)
    if (!from || !to) return null
    if (from === to || codeOf(from) === codeOf(to)) return qty
    if (!convGraph) return null
    try { return Number(convertQty(qty, from, to, convGraph)) } catch { return null }
  }

  const poNo = (p: any) => p?.orderNo ?? p?.order_no ?? p?.id
  const fxPO = (p: PO) => n((p as any).fx_to_base ?? (p as any).fxToBase, 1)
  const curPO = (p: PO) => (p as any).currency_code ?? (p as any).currencyCode
  const poSupplierLabel = (p: PO) =>
    p.supplier ?? (p.supplier_id ? (suppliers.find(s => s.id === p.supplier_id)?.name ?? p.supplier_id) : tt('none', '(none)'))
  const binsForWH = (whId: string) => bins.filter(b => b.warehouseId === whId)

  // load
  useEffect(() => {
    (async () => {
      try {
        const [it, uu, cs] = await Promise.all([
          db.items.list({ orderBy: { name: 'asc' } }),
          supabase.from('uoms').select('id,code,name').order('code', { ascending: true }),
          supabase.from('currencies').select('code,name').order('code', { ascending: true }),
        ])

        setItems((it || []).map((x: any) => ({ ...x, baseUomId: x.baseUomId ?? x.base_uom_id ?? '' })))
        if (uu.error) throw uu.error
        setUoms(((uu.data || []) as any[]).map(u => ({ ...u, code: String(u.code || '').toUpperCase() })))
        setCurrencies((cs.data || []) as Currency[])
        setBaseCode(await getBaseCurrencyCode())

        const { data: convRows, error: convErr } = await supabase.from('uom_conversions').select('from_uom_id,to_uom_id,factor')
        setConvGraph(convErr ? null : buildConvGraph((convRows || []) as ConvRow[]))

        const supps = await supabase
          .from('suppliers')
          .select('id,code,name,email,phone,tax_id,payment_terms')
          .order('name', { ascending: true })
        if (supps.error) throw supps.error
        setSuppliers((supps.data || []) as Supplier[])

        const [po, pol] = await Promise.all([ db.purchaseOrders.list(), db.purchaseOrderLines.list() ])
        setPOs((po || []).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
        setPOLines(pol || [])

        const [whRes, binRes] = await Promise.all([
          db.warehouses.list({ orderBy: { name: 'asc' } }),
          db.bins.list({ orderBy: { code: 'asc' } })
        ])
        setWarehouses(whRes || [])
        setBins(binRes || [])

        if (whRes && whRes.length) {
          const preferred = whRes[0]
          setReceiveWhId(preferred.id)
          const firstBin = (binRes || []).find(b => b.warehouseId === preferred.id)?.id || ''
          setReceiveBinId(firstBin)
        }
      } catch (err: any) {
        console.error(err)
        toast.error(err?.message || tt('orders.loadFailed', 'Failed to load purchase orders'))
      }
    })()
  }, [])

  // stock helpers
  const num = (v: any, d=0) => (Number.isFinite(Number(v)) ? Number(v) : d)
  async function upsertStockLevel(
    whId: string, binId: string | null, itemId: string, deltaQtyBase: number, unitCostForReceipts?: number
  ) {
    let q = supabase.from('stock_levels').select('id,qty,avg_cost').eq('warehouse_id', whId).eq('item_id', itemId).limit(1)
    q = binId ? q.eq('bin_id', binId) : q.is('bin_id', null)
    const { data: found, error: selErr } = await q
    if (selErr) throw selErr

    const unitCost = num(unitCostForReceipts, 0)
    if (!found || found.length === 0) {
      if (deltaQtyBase < 0) throw new Error(tt('orders.insufficientStock', 'Insufficient stock at source bin'))
      const { error: insErr } = await supabase.from('stock_levels').insert({
        warehouse_id: whId, bin_id: binId, item_id: itemId, qty: deltaQtyBase, allocated_qty: 0, avg_cost: unitCost, updated_at: nowISO(),
      } as any)
      if (insErr) throw insErr
      return
    }
    const row = found[0] as { id: string; qty: number | null; avg_cost: number | null }
    const oldQty = num(row.qty, 0), oldAvg = num(row.avg_cost, 0)
    const newQty = oldQty + deltaQtyBase
    if (newQty < 0) throw new Error(tt('orders.insufficientStock', 'Insufficient stock at source bin'))
    const newAvg = deltaQtyBase > 0 ? (newQty > 0 ? ((oldQty * oldAvg) + (deltaQtyBase * unitCost)) / newQty : unitCost) : oldAvg
    const { error: updErr } = await supabase.from('stock_levels').update({ qty: newQty, avg_cost: newAvg, updated_at: nowISO() }).eq('id', row.id)
    if (updErr) throw updErr
  }

  // actions
  async function tryUpdateStatus(id: string, candidates: string[]) {
    for (const status of candidates) {
      const { error } = await supabase.from('purchase_orders').update({ status }).eq('id', id)
      if (!error) return status
      if (!String(error?.message || '').toLowerCase().includes('invalid input value for enum')) throw error
    }
    return null
  }

  async function createPO() {
    try {
      if (!poSupplierId) return toast.error(tt('orders.supplierRequired', 'Supplier is required'))
      const cleanLines = poLinesForm
        .map(l => ({ ...l, qty: n(l.qty), unitPrice: n(l.unitPrice), discountPct: n(l.discountPct) }))
        .filter(l => l.itemId && l.uomId && l.qty > 0 && l.unitPrice >= 0 && l.discountPct >= 0 && l.discountPct <= 100)
      if (!cleanLines.length) return toast.error(tt('orders.addOneLine', 'Add at least one valid line'))

      const fx = n(poFx, 1)
      const supp = suppliers.find(s => s.id === poSupplierId)

      const inserted: any = await db.purchaseOrders.create({
        supplier_id: poSupplierId, status: 'draft', currency_code: poCurrency, fx_to_base: fx,
        expected_date: poDate || null, notes: null,
        payment_terms: supp?.payment_terms ?? null, supplier_name: supp?.name ?? null,
        supplier_email: supp?.email ?? null, supplier_phone: supp?.phone ?? null, supplier_tax_id: supp?.tax_id ?? null,
      } as any)
      const poId: string = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id
      if (!poId) throw new Error('PO insert did not return an id')

      for (let i = 0; i < cleanLines.length; i++) {
        const l = cleanLines[i]; const lineNo = i + 1
        const lineTotal = l.qty * l.unitPrice * (1 - l.discountPct / 100)
        await db.purchaseOrderLines.create({
          po_id: poId, item_id: l.itemId, uom_id: l.uomId, line_no: lineNo,
          qty: l.qty, unit_price: l.unitPrice, discount_pct: l.discountPct, line_total: lineTotal
        } as any)
      }

      toast.success(tt('orders.poCreated', 'Purchase Order created'))
      setPoSupplierId(''); setPoCurrency(baseCode); setPoFx('1'); setPoTaxPct('0')
      setPoLinesForm([{ itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }])
      setPoOpen(false)

      const [po, pol] = await Promise.all([ db.purchaseOrders.list(), db.purchaseOrderLines.list() ])
      setPOs((po || []).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
      setPOLines(pol || [])
    } catch (err: any) { console.error(err); toast.error(err?.message || tt('orders.poCreateFailed', 'Failed to create PO')) }
  }

  async function approvePO(poId: string) {
    try {
      const updated = await tryUpdateStatus(poId, ['approved', 'open', 'authorised', 'authorized'])
      if (updated) setPOs(prev => prev.map(p => (p.id === poId ? { ...p, status: updated } : p)))
      toast.success(tt('orders.poApproved', 'PO approved'))
    } catch (err: any) { console.error(err); toast.error(err?.message || tt('orders.poApproveFailed', 'Failed to approve PO')) }
  }

  async function cancelPO(poId: string) {
    try {
      const updated = await tryUpdateStatus(poId, ['cancelled', 'canceled'])
      if (updated) setPOs(prev => prev.map(p => (p.id === poId ? { ...p, status: updated } : p)))
      toast.success(tt('orders.poCancelled', 'PO cancelled'))
    } catch (err: any) { console.error(err); toast.error(err?.message || tt('orders.poCancelFailed', 'Failed to cancel PO')) }
  }

  async function doReceivePO(po: PO) {
    try {
      if (!receiveWhId) return toast.error(tt('orders.selectDestWh', 'Select destination warehouse'))
      if (!receiveBinId) return toast.error(tt('orders.selectDestBin', 'Select destination bin'))
      const lines = polines.filter(l => l.po_id === po.id)
      if (!lines.length) return toast.error(tt('orders.noLinesToReceive', 'No lines to receive'))

      const fxToBase = n(po.fx_to_base ?? (po as any).fxToBase, 1)

      for (const l of lines) {
        const it = itemById.get(l.item_id); if (!it) throw new Error(`Item not found for line ${l.item_id}`)
        const baseUom = it.baseUomId
        const qtyBase = safeConvert(n(l.qty), l.uom_id, baseUom)
        if (qtyBase == null) {
          const fromCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
          throw new Error(tt('orders.noConversion', 'No conversion from {from} to base for {sku}').replace('{from}', String(fromCode)).replace('{sku}', String(it.sku)))
        }
        const disc = n(l.discount_pct, 0)
        const totalBase = n(l.unit_price) * n(l.qty) * (1 - disc/100) * fxToBase
        const unitCostBase = qtyBase > 0 ? totalBase / qtyBase : 0

        await upsertStockLevel(receiveWhId, receiveBinId, it.id, qtyBase, unitCostBase)

        await supabase.from('stock_movements').insert({
          type: 'receive', item_id: it.id, uom_id: uomIdFromIdOrCode(l.uom_id) || l.uom_id, qty: n(l.qty), qty_base: qtyBase,
          unit_cost: unitCostBase, total_value: totalBase, warehouse_to_id: receiveWhId, bin_to_id: receiveBinId,
          notes: `PO ${poNo(po)}`, created_by: 'system', ref_type: 'PO', ref_id: (po as any).id, ref_line_id: l.id ?? null,
        } as any)
      }

      const { error: updErr } = await supabase.from('purchase_orders').update({ status: 'received' }).eq('id', po.id)
      if (updErr) console.warn('final status fallback failed:', updErr)

      const [freshPO, freshPOL] = await Promise.all([ db.purchaseOrders.list(), db.purchaseOrderLines.list() ])
      setPOs((freshPO || []).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
      setPOLines(freshPOL || [])

      toast.success(tt('orders.poReceived', 'PO received'))
      setPoViewOpen(false); setSelectedPO(null)
    } catch (err: any) { console.error(err); toast.error(err?.message || tt('orders.receiveFailed', 'Failed to receive PO')) }
  }

  const poOutstanding = useMemo(
    () => pos.filter(p => ['draft', 'approved'].includes(String(p.status).toLowerCase())),
    [pos]
  )
  const poSubtotal = poLinesForm.reduce((s, r) => s + n(r.qty) * n(r.unitPrice) * (1 - n(r.discountPct,0)/100), 0)
  const poTax = poSubtotal * (n(poTaxPct, 0) / 100)

  function printPO(po: PO) {
    const currency = curPO(po) || '—'
    const fx = fxPO(po) || 1
    const lines = polines.filter(l => l.po_id === po.id)
    const rows = lines.map(l => {
      const it = itemById.get(l.item_id)
      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
      const disc = n(l.discount_pct, 0)
      const lineTotal = n(l.qty) * n(l.unit_price) * (1 - disc/100)
      return `<tr><td>${it?.name || l.item_id}</td><td>${it?.sku || ''}</td><td class="right">${fmtAcct(n(l.qty))}</td><td>${uomCode}</td><td class="right">${fmtAcct(n(l.unit_price))}</td><td class="right">${fmtAcct(disc)}</td><td class="right">${fmtAcct(lineTotal)}</td></tr>`
    }).join('')
    const subtotal = lines.reduce((s, l) => s + n(l.qty) * n(l.unit_price) * (1 - n(l.discount_pct,0)/100), 0)
    const number = poNo(po)
    const html = `
      <h1>Purchase Order ${number}</h1>
      <div class="meta">Status: <b>${po.status}</b> · Currency: <b>${currency}</b> · FX→${baseCode}: <b>${fmtAcct(fx)}</b></div>
      <table><thead><tr><th>Item</th><th>SKU</th><th class="right">Qty</th><th>UoM</th><th class="right">Unit Price</th><th class="right">Disc %</th><th class="right">Line Total (${currency})</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="totals"><div><span>Subtotal (${currency})</span><span>${fmtAcct(subtotal)}</span></div><div class="muted"><span>FX to ${baseCode}</span><span>${fmtAcct(fx)}</span></div><div><span>Total (${baseCode})</span><span>${fmtAcct(subtotal * fx)}</span></div></div>
    `
    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<html><head><title>PO ${number}</title><meta charset="utf-8"/><style>body{font-family:ui-sans-serif; padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #ddd;padding:8px 6px;text-align:left}.right{text-align:right}.meta{font-size:12px;color:#444;margin:8px 0 16px}.totals{margin-top:12px;width:320px;margin-left:auto;display:flex;flex-direction:column;gap:4px}</style></head><body>${html}</body></html>`)
    w.document.close(); w.focus(); w.print()
  }

  return (
    <>
      {/* Outstanding + Create PO */}
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{tt('orders.outstandingPOs', 'Outstanding Purchase Orders')}</CardTitle>

            <Sheet open={poOpen} onOpenChange={setPoOpen}>
              <SheetTrigger asChild>
                <Button size="sm">{tt('orders.newPO', 'New PO')}</Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:w=[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
                <SheetHeader>
                  <SheetTitle>{tt('orders.newPO', 'New Purchase Order')}</SheetTitle>
                  <SheetDescription className="sr-only">{tt('orders.createPO', 'Create a purchase order')}</SheetDescription>
                </SheetHeader>

                {/* Header */}
                <div className="mt-4 grid md:grid-cols-4 gap-3">
                  <div>
                    <Label>{tt('orders.supplier', 'Supplier')}</Label>
                    <Select value={poSupplierId} onValueChange={setPoSupplierId}>
                      <SelectTrigger><SelectValue placeholder={tt('orders.selectSupplier', 'Select supplier')} /></SelectTrigger>
                      <SelectContent className="max-h-64 overflow-auto">
                        {suppliers.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{(s.code ? s.code + ' — ' : '') + s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{tt('orders.currency', 'Currency')}</Label>
                    <Select value={poCurrency} onValueChange={setPoCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{currencies.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{tt('orders.fxToBase', 'FX to Base ({code})', { code: baseCode })}</Label>
                    <Input type="number" min="0" step="0.000001" value={poFx} onChange={e => setPoFx(e.target.value)} />
                  </div>
                  <div>
                    <Label>{tt('orders.expectedDate', 'Expected Date')}</Label>
                    <Input type="date" value={poDate} onChange={e => setPoDate(e.target.value)} />
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
                        {poLinesForm.map((ln, idx) => {
                          const lineTotal = n(ln.qty) * n(ln.unitPrice) * (1 - n(ln.discountPct,0)/100)
                          return (
                            <tr key={idx} className="border-t">
                              <td className="py-2 px-3">
                                <Select
                                  value={ln.itemId}
                                  onValueChange={(v) =>
                                    setPoLinesForm(prev =>
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
                                <Select value={ln.uomId} onValueChange={(v) => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, uomId: v } : x))}>
                                  <SelectTrigger><SelectValue placeholder={tt('orders.uom', 'UoM')} /></SelectTrigger>
                                  <SelectContent className="max-h-64 overflow-auto">
                                    {uoms.map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </td>
                              <td className="py-2 px-3">
                                <Input inputMode="decimal" type="number" min="0" step="0.0001" value={ln.qty} onChange={e => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))} />
                              </td>
                              <td className="py-2 px-3">
                                <Input inputMode="decimal" type="number" min="0" step="0.0001" value={ln.unitPrice} onChange={e => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} />
                              </td>
                              <td className="py-2 px-3">
                                <Input type="number" min="0" max="100" step="0.01" value={ln.discountPct} onChange={e => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, discountPct: e.target.value } : x))} />
                              </td>
                              <td className="py-2 px-3 text-right">{fmtAcct(lineTotal)}</td>
                              <td className="py-2 px-3 text-right">
                                <Button size="icon" variant="ghost" onClick={() => setPoLinesForm(prev => prev.filter((_, i) => i !== idx))}>✕</Button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="p-2">
                      <MobileAddLineButton
                        onAdd={() => setPoLinesForm(prev => [...prev, { itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }])}
                        label={tt('orders.addLine', 'Add Line')}
                      />
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t mt-4">
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                      <div className="flex items-center gap-3">
                        <Label className="whitespace-nowrap">{tt('orders.taxPct', 'Tax %')}</Label>
                        <Input className="w-28" type="number" min="0" step="0.01" value={poTaxPct} onChange={e => setPoTaxPct(e.target.value)} />
                      </div>
                      <div className="flex flex-col items-end text-sm">
                        <div className="w-full max-w-sm grid grid-cols-2 gap-1">
                          <div className="text-muted-foreground">{tt('orders.subtotal', 'Subtotal')} ({poCurrency})</div>
                          <div className="text-right">{fmtAcct(poSubtotal)}</div>
                          <div className="text-muted-foreground">{tt('orders.tax', 'Tax')}</div>
                          <div className="text-right">{fmtAcct(poTax)}</div>
                          <div className="font-medium">{tt('orders.total', 'Total')}</div>
                          <div className="text-right font-medium">{fmtAcct(poSubtotal + poTax)}</div>
                        </div>
                        <div className="mt-3">
                          <Button onClick={createPO}>{tt('orders.createPO', 'Create PO')}</Button>
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
              <th className="py-2 pr-2">{tt('orders.po', 'PO')}</th>
              <th className="py-2 pr-2">{tt('orders.supplier', 'Supplier')}</th>
              <th className="py-2 pr-2">{tt('orders.status', 'Status')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
              <th className="py-2 pr-2">{tt('orders.actions', 'Actions')}</th>
            </tr></thead>
            <tbody>
              {poOutstanding.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.nothingPending', 'Nothing pending.')}</td></tr>}
              {poOutstanding.map(po => {
                const totalBase = polines.filter(l => l.po_id === po.id).reduce((s, l) => s + n(l.line_total), 0) * fxPO(po)
                return (
                  <tr key={po.id} className="border-b">
                    <td className="py-2 pr-2">{poNo(po)}</td>
                    <td className="py-2 pr-2">{poSupplierLabel(po)}</td>
                    <td className="py-2 pr-2 capitalize">{po.status}</td>
                    <td className="py-2 pr-2">{formatMoneyBase(totalBase, baseCode)}</td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setSelectedPO(po); setPoViewOpen(true) }}>{tt('orders.view', 'View')}</Button>
                        <Button size="sm" variant="outline" onClick={() => printPO(po)}>{tt('orders.print', 'Print')}</Button>
                        {String(po.status).toLowerCase() === 'draft' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => approvePO(po.id)}>{tt('orders.approve', 'Approve')}</Button>
                            <Button size="sm" variant="destructive" onClick={() => cancelPO(po.id)}>{tt('orders.cancel', 'Cancel')}</Button>
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
        <CardHeader><CardTitle>{tt('orders.recentPOs', 'Recent Purchase Orders')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.po', 'PO')}</th>
              <th className="py-2 pr-2">{tt('orders.supplier', 'Supplier')}</th>
              <th className="py-2 pr-2">{tt('orders.status', 'Status')}</th>
              <th className="py-2 pr-2">{tt('orders.currency', 'Currency')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
            </tr></thead>
            <tbody>
              {pos.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.noPOsYet', 'No POs yet.')}</td></tr>}
              {pos.map(po => {
                const totalBase = polines.filter(l => l.po_id === po.id).reduce((s, l) => s + n(l.line_total), 0) * fxPO(po)
                return (
                  <tr key={po.id} className="border-b">
                    <td className="py-2 pr-2">{poNo(po)}</td>
                    <td className="py-2 pr-2">{poSupplierLabel(po)}</td>
                    <td className="py-2 pr-2 capitalize">{po.status}</td>
                    <td className="py-2 pr-2">{curPO(po)}</td>
                    <td className="py-2 pr-2">{formatMoneyBase(totalBase, baseCode)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* View/Receive Sheet */}
      <Sheet open={poViewOpen} onOpenChange={(o) => { if (!o) { setSelectedPO(null) } setPoViewOpen(o) }}>
        <SheetContent side="right" className="w-full sm:w=[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
          <SheetHeader>
            <SheetTitle>{tt('orders.poDetails', 'PO Details')}</SheetTitle>
            <SheetDescription className="sr-only">{tt('orders.poDetailsDesc', 'Review, select destination bin, and receive')}</SheetDescription>
          </SheetHeader>

          {!selectedPO ? (
            <div className="p-4 text-sm text-muted-foreground">{tt('orders.noPOSelected', 'No PO selected.')}</div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div><Label>{tt('orders.po', 'PO')}</Label><div>{poNo(selectedPO)}</div></div>
                <div><Label>{tt('orders.supplier', 'Supplier')}</Label><div>{poSupplierLabel(selectedPO)}</div></div>
                <div><Label>{tt('orders.status', 'Status')}</Label><div className="capitalize">{selectedPO.status}</div></div>
                <div><Label>{tt('orders.currency', 'Currency')}</Label><div>{curPO(selectedPO)}</div></div>
                <div><Label>{tt('orders.fxToBaseShort', 'FX to Base')}</Label><div>{fmtAcct(fxPO(selectedPO))}</div></div>
                <div><Label>{tt('orders.expectedDate', 'Expected Date')}</Label><div>{(selectedPO as any).expected_date || tt('none', '(none)')}</div></div>
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <Label>{tt('orders.toWarehouse', 'To Warehouse')}</Label>
                  <Select value={receiveWhId} onValueChange={(v) => {
                    setReceiveWhId(v)
                    const first = binsForWH(v)[0]?.id || ''
                    setReceiveBinId(first)
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('orders.toBin', 'To Bin')}</Label>
                  <Select value={receiveBinId} onValueChange={setReceiveBinId}>
                    <SelectTrigger><SelectValue placeholder={tt('orders.selectBin', 'Select bin')} /></SelectTrigger>
                    <SelectContent>
                      {binsForWH(receiveWhId).map(b => (<SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-end gap-2">
                  <Button variant="outline" onClick={() => printPO(selectedPO)}>{tt('orders.print', 'Print')}</Button>
                  {String(selectedPO.status).toLowerCase() === 'approved' && (
                    <Button onClick={() => doReceivePO(selectedPO)}>{tt('orders.receiveAll', 'Receive All')}</Button>
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
                      <th className="py-2 px-3 text-right">{tt('orders.lineValueBase', 'Line Value (base)')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {polines.filter(l => l.po_id === selectedPO.id).map(l => {
                      const it = itemById.get(l.item_id)
                      const baseU = it?.baseUomId || ''
                      const qtyBase = it ? safeConvert(n(l.qty), l.uom_id, baseU) : null
                      const disc = n(l.discount_pct, 0)
                      const lineValueBase = n(l.unit_price) * n(l.qty) * (1 - disc/100) * fxPO(selectedPO)
                      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
                      return (
                        <tr key={String(l.id) || `${l.po_id}-${l.item_id}-${l.line_no}`} className="border-t">
                          <td className="py-2 px-3">{it?.name || l.item_id}</td>
                          <td className="py-2 px-3">{it?.sku || '—'}</td>
                          <td className="py-2 px-3">{fmtAcct(n(l.qty))} {uomCode}</td>
                          <td className="py-2 px-3">{fmtAcct(disc)}</td>
                          <td className="py-2 px-3">{qtyBase == null ? '—' : fmtAcct(qtyBase)}</td>
                          <td className="py-2 px-3 text-right">{formatMoneyBase(lineValueBase, baseCode)}</td>
                        </tr>
                      )
                    })}
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
