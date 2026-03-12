import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

type Supplier = { id: string; code?: string | null; name: string }
type Item = { id: string; sku?: string | null; name: string }
type PurchaseOrder = { id: string; order_no?: string | null; supplier_id?: string | null; currency_code?: string | null; created_at?: string | null }
type PurchaseOrderLine = { po_id: string; item_id: string; qty?: number | null; unit_price?: number | null }

type CostLine = { id: string; label: string; amount: string }
type ItemLine = { id: string; itemId: string; qty: string; unitCost: string }

const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const uid = () => Math.random().toString(36).slice(2, 10)

export default function LandedCostPage() {
  const { companyId } = useOrg()
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) => {
    const value = t(key, vars)
    return value === key ? fallback : value
  }

  const [loading, setLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])

  const [supplierId, setSupplierId] = useState('')
  const [purchaseOrderId, setPurchaseOrderId] = useState('')
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [allocationMethod, setAllocationMethod] = useState<'quantity' | 'value' | 'equal'>('quantity')

  const [itemLines, setItemLines] = useState<ItemLine[]>([{ id: uid(), itemId: '', qty: '', unitCost: '' }])
  const [freightCost, setFreightCost] = useState('')
  const [customsCost, setCustomsCost] = useState('')
  const [handlingCost, setHandlingCost] = useState('')
  const [packagingCost, setPackagingCost] = useState('')
  const [extraCosts, setExtraCosts] = useState<CostLine[]>([])

  useEffect(() => {
    if (!companyId) {
      setLoading(false)
      return
    }

    let cancelled = false

    ;(async () => {
      try {
        setLoading(true)
        const [supplierRes, itemRes, poRes] = await Promise.all([
          supabase.from('suppliers').select('id,code,name').eq('company_id', companyId).order('name', { ascending: true }),
          supabase.from('items').select('id,sku,name').eq('company_id', companyId).order('name', { ascending: true }),
          supabase
            .from('purchase_orders')
            .select('id,order_no,supplier_id,currency_code,created_at')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(100),
        ])

        if (supplierRes.error) throw supplierRes.error
        if (itemRes.error) throw itemRes.error
        if (poRes.error) throw poRes.error

        if (!cancelled) {
          setSuppliers((supplierRes.data || []) as Supplier[])
          setItems((itemRes.data || []) as Item[])
          setPurchaseOrders((poRes.data || []) as PurchaseOrder[])
        }
      } catch (error: any) {
        console.error(error)
        if (!cancelled) toast.error(error?.message || tt('landedCost.loadFailed', 'Failed to load landed cost inputs'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [companyId])

  useEffect(() => {
    if (!purchaseOrderId || !companyId) return

    let cancelled = false

    ;(async () => {
      try {
        const selectedOrder = purchaseOrders.find(order => order.id === purchaseOrderId)
        if (selectedOrder?.supplier_id) setSupplierId(selectedOrder.supplier_id)
        if (selectedOrder?.currency_code) setCurrencyCode(selectedOrder.currency_code)

        const { data, error } = await supabase
          .from('purchase_order_lines')
          .select('po_id,item_id,qty,unit_price')
          .eq('company_id', companyId)
          .eq('po_id', purchaseOrderId)

        if (error) throw error
        if (!cancelled && data?.length) {
          setItemLines(data.map((line: PurchaseOrderLine) => ({
            id: uid(),
            itemId: line.item_id,
            qty: String(n(line.qty)),
            unitCost: String(n(line.unit_price)),
          })))
        }
      } catch (error: any) {
        console.error(error)
        if (!cancelled) toast.error(error?.message || tt('landedCost.prefillFailed', 'Failed to load the purchase order lines'))
      }
    })()

    return () => { cancelled = true }
  }, [companyId, purchaseOrderId, purchaseOrders])

  const visiblePurchaseOrders = useMemo(
    () => purchaseOrders.filter(order => !supplierId || order.supplier_id === supplierId),
    [purchaseOrders, supplierId],
  )

  const commonCosts = useMemo(() => ([
    { label: tt('landedCost.freight', 'Freight / transport'), amount: n(freightCost) },
    { label: tt('landedCost.customs', 'Customs / duty'), amount: n(customsCost) },
    { label: tt('landedCost.handling', 'Handling / clearing'), amount: n(handlingCost) },
    { label: tt('landedCost.packaging', 'Packaging / delivery'), amount: n(packagingCost) },
    ...extraCosts
      .map(row => ({ label: row.label.trim() || tt('landedCost.otherCost', 'Other cost'), amount: n(row.amount) }))
      .filter(row => row.amount !== 0),
  ]), [customsCost, extraCosts, freightCost, handlingCost, packagingCost, tt])

  const totals = useMemo(() => {
    const rows = itemLines
      .map(line => {
        const qty = n(line.qty)
        const unitCost = n(line.unitCost)
        return {
          ...line,
          qty,
          unitCost,
          baseAmount: qty * unitCost,
        }
      })
      .filter(line => line.itemId && line.qty > 0)

    const baseItemCost = rows.reduce((sum, line) => sum + line.baseAmount, 0)
    const totalQty = rows.reduce((sum, line) => sum + line.qty, 0)
    const landedExtras = commonCosts.reduce((sum, row) => sum + row.amount, 0)
    const totalLandedCost = baseItemCost + landedExtras
    const landedUnitCost = totalQty > 0 ? totalLandedCost / totalQty : 0

    const preview = rows.map((line, index) => {
      const quantityShare = totalQty > 0 ? line.qty / totalQty : 0
      const valueShare = baseItemCost > 0 ? line.baseAmount / baseItemCost : 0
      const equalShare = rows.length > 0 ? 1 / rows.length : 0
      const share = allocationMethod === 'quantity'
        ? quantityShare
        : allocationMethod === 'value'
          ? valueShare
          : equalShare
      const allocatedExtra = landedExtras * share
      const finalTotal = line.baseAmount + allocatedExtra
      const finalUnitCost = line.qty > 0 ? finalTotal / line.qty : 0
      return {
        id: line.id || `${index}`,
        itemId: line.itemId,
        qty: line.qty,
        baseAmount: line.baseAmount,
        allocatedExtra,
        finalTotal,
        finalUnitCost,
      }
    })

    return { rows, baseItemCost, totalQty, landedExtras, totalLandedCost, landedUnitCost, preview }
  }, [allocationMethod, commonCosts, itemLines])

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('landedCost.eyebrow', 'Bulk costing')}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('landedCost.title', 'Landed Cost')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {tt('landedCost.subtitle', 'Use this page to calculate true unit cost for bulk buys, imports, and freight-heavy purchases. Assembly and build logic stays separate.')}
            </p>
          </div>
        </div>

        <Button asChild variant="outline">
          <Link to="/bom">{tt('landedCost.goToAssembly', 'Go to Assembly')}</Link>
        </Button>
      </div>

      {loading && (
        <div className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('landedCost.source', 'Source details')}</CardTitle>
              <CardDescription>{tt('landedCost.sourceHelp', 'Pick a supplier or purchase order to prefill the lines, then choose how extra costs should be allocated.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>{tt('orders.supplier', 'Supplier')}</Label>
                <Select value={supplierId || 'NONE'} onValueChange={(value) => setSupplierId(value === 'NONE' ? '' : value)}>
                  <SelectTrigger><SelectValue placeholder={tt('orders.selectSupplier', 'Select supplier')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{tt('common.none', 'None')}</SelectItem>
                    {suppliers.map(supplier => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {(supplier.code ? `${supplier.code} - ` : '') + supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tt('orders.po', 'PO')}</Label>
                <Select value={purchaseOrderId || 'NONE'} onValueChange={(value) => setPurchaseOrderId(value === 'NONE' ? '' : value)}>
                  <SelectTrigger><SelectValue placeholder={tt('landedCost.selectPO', 'Optional purchase order')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{tt('common.none', 'None')}</SelectItem>
                    {visiblePurchaseOrders.map(order => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.order_no || order.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tt('orders.currency', 'Currency')}</Label>
                <Input value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} />
              </div>
              <div>
                <Label>{tt('landedCost.allocationMethod', 'Allocation method')}</Label>
                <Select value={allocationMethod} onValueChange={(value) => setAllocationMethod(value as typeof allocationMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quantity">{tt('landedCost.byQuantity', 'By quantity')}</SelectItem>
                    <SelectItem value="value">{tt('landedCost.byValue', 'By item value')}</SelectItem>
                    <SelectItem value="equal">{tt('landedCost.equalSplit', 'Equal distribution')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('landedCost.items', 'Purchased items')}</CardTitle>
              <CardDescription>{tt('landedCost.itemsHelp', 'Enter the bulk quantity and base unit cost for each line. If you picked a PO, these lines are prefilled from it.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-3">{tt('table.item', 'Item')}</th>
                      <th className="py-2 pr-3 text-right">{tt('orders.qty', 'Qty')}</th>
                      <th className="py-2 pr-3 text-right">{tt('landedCost.baseUnitCost', 'Base unit cost')}</th>
                      <th className="py-2 pr-3 text-right">{tt('orders.subtotal', 'Subtotal')}</th>
                      <th className="py-2 text-right">{tt('orders.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemLines.map(line => {
                      const item = itemById.get(line.itemId)
                      const qty = n(line.qty)
                      const unitCost = n(line.unitCost)
                      return (
                        <tr key={line.id} className="border-b">
                          <td className="py-2 pr-3">
                            <Select value={line.itemId} onValueChange={(value) => setItemLines(prev => prev.map(row => row.id === line.id ? { ...row, itemId: value } : row))}>
                              <SelectTrigger><SelectValue placeholder={tt('movements.selectItem', 'Select item')} /></SelectTrigger>
                              <SelectContent>
                                {items.map(option => (
                                  <SelectItem key={option.id} value={option.id}>
                                    {(option.sku ? `${option.sku} - ` : '') + option.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {item && <div className="mt-1 text-xs text-muted-foreground">{item.name}</div>}
                          </td>
                          <td className="py-2 pr-3"><Input className="text-right" inputMode="decimal" value={line.qty} onChange={(event) => setItemLines(prev => prev.map(row => row.id === line.id ? { ...row, qty: event.target.value } : row))} /></td>
                          <td className="py-2 pr-3"><Input className="text-right" inputMode="decimal" value={line.unitCost} onChange={(event) => setItemLines(prev => prev.map(row => row.id === line.id ? { ...row, unitCost: event.target.value } : row))} /></td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{(qty * unitCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</td>
                          <td className="py-2 text-right">
                            <Button variant="ghost" size="sm" onClick={() => setItemLines(prev => prev.length === 1 ? prev : prev.filter(row => row.id !== line.id))}>
                              {tt('common.remove', 'Remove')}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <Button variant="outline" onClick={() => setItemLines(prev => [...prev, { id: uid(), itemId: '', qty: '', unitCost: '' }])}>
                {tt('landedCost.addItemLine', 'Add item line')}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('landedCost.extraCosts', 'Additional landed costs')}</CardTitle>
              <CardDescription>{tt('landedCost.extraCostsHelp', 'Capture freight, customs, clearing, packaging, or any other landed charges that need to be absorbed into unit cost.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>{tt('landedCost.freight', 'Freight / transport')}</Label>
                  <Input inputMode="decimal" value={freightCost} onChange={(event) => setFreightCost(event.target.value)} />
                </div>
                <div>
                  <Label>{tt('landedCost.customs', 'Customs / duty')}</Label>
                  <Input inputMode="decimal" value={customsCost} onChange={(event) => setCustomsCost(event.target.value)} />
                </div>
                <div>
                  <Label>{tt('landedCost.handling', 'Handling / clearing')}</Label>
                  <Input inputMode="decimal" value={handlingCost} onChange={(event) => setHandlingCost(event.target.value)} />
                </div>
                <div>
                  <Label>{tt('landedCost.packaging', 'Packaging / delivery')}</Label>
                  <Input inputMode="decimal" value={packagingCost} onChange={(event) => setPackagingCost(event.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                {extraCosts.map(cost => (
                  <div key={cost.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_auto]">
                    <Input value={cost.label} onChange={(event) => setExtraCosts(prev => prev.map(row => row.id === cost.id ? { ...row, label: event.target.value } : row))} placeholder={tt('landedCost.otherCostLabel', 'Other cost label')} />
                    <Input inputMode="decimal" value={cost.amount} onChange={(event) => setExtraCosts(prev => prev.map(row => row.id === cost.id ? { ...row, amount: event.target.value } : row))} placeholder="0.00" />
                    <Button variant="ghost" onClick={() => setExtraCosts(prev => prev.filter(row => row.id !== cost.id))}>{tt('common.remove', 'Remove')}</Button>
                  </div>
                ))}
                <Button variant="outline" onClick={() => setExtraCosts(prev => [...prev, { id: uid(), label: '', amount: '' }])}>
                  {tt('landedCost.addCostRow', 'Add another cost')}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('landedCost.summary', 'Cost summary')}</CardTitle>
              <CardDescription>{tt('landedCost.summaryHelp', 'Preview the blended landed value before you receive or reprice stock.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.baseItemCost', 'Base item cost')}</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">{totals.baseItemCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.landedExtras', 'Landed extras')}</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">{totals.landedExtras.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.totalLandedCost', 'Total landed cost')}</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">{totals.totalLandedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</div>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.unitLandedCost', 'Landed cost per unit')}</div>
                  <div className="mt-2 text-2xl font-semibold tracking-tight">{totals.landedUnitCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</div>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm font-medium">{tt('landedCost.preview', 'Allocation preview')}</div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 pr-3">{tt('table.item', 'Item')}</th>
                        <th className="py-2 pr-3 text-right">{tt('orders.qty', 'Qty')}</th>
                        <th className="py-2 pr-3 text-right">{tt('landedCost.allocatedExtra', 'Allocated extra')}</th>
                        <th className="py-2 pr-3 text-right">{tt('landedCost.finalUnitCost', 'Final unit cost')}</th>
                        <th className="py-2 text-right">{tt('landedCost.totalLandedCost', 'Total landed cost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totals.preview.map(row => (
                        <tr key={row.id} className="border-b">
                          <td className="py-2 pr-3">{itemById.get(row.itemId)?.name || tt('common.none', 'None')}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{row.qty}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{row.allocatedExtra.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{row.finalUnitCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</td>
                          <td className="py-2 text-right font-mono tabular-nums">{row.finalTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyCode}</td>
                        </tr>
                      ))}
                      {totals.preview.length === 0 && (
                        <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('landedCost.previewEmpty', 'Add at least one valid item line to see the cost allocation preview.')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                {tt('landedCost.note', 'This page is intentionally separate from Assembly. Use it to calculate landed unit cost before receiving or repricing stock, not to define build recipes.')}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
