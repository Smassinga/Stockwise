import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { getBaseCurrencyCode } from '../lib/currency'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { buildLandedCostPreview, type LandedCostMethod, type LandedCostReceiptBucket } from '../lib/landedCost'
import { supabase } from '../lib/supabase'

type Supplier = { id: string; code?: string | null; name: string }
type Item = { id: string; sku?: string | null; name: string }
type Warehouse = { id: string; name: string; code?: string | null }
type Bin = { id: string; code: string; name: string; warehouseId: string }
type PurchaseOrder = {
  id: string
  order_no?: string | null
  supplier_id?: string | null
  currency_code?: string | null
  fx_to_base?: number | null
  created_at?: string | null
  status?: string | null
}
type ReceiptMovement = {
  item_id: string
  ref_line_id?: string | null
  qty_base?: number | null
  unit_cost?: number | null
  total_value?: number | null
  warehouse_to_id?: string | null
  bin_to_id?: string | null
}
type StockLevel = {
  id: string
  item_id: string
  warehouse_id: string
  bin_id?: string | null
  qty?: number | null
  avg_cost?: number | null
}
type LandedCostRun = {
  id: string
  created_at?: string | null
  allocation_method?: string | null
  total_extra_cost?: number | null
  total_applied_value?: number | null
  total_unapplied_value?: number | null
  currency_code?: string | null
  notes?: string | null
}
type CostLine = { id: string; label: string; amount: string }

const uid = () => Math.random().toString(36).slice(2, 10)
const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const round = (value: number, precision = 6) => {
  const factor = 10 ** precision
  return Math.round(n(value) * factor) / factor
}
const fmt = (value: number, digits = 2) =>
  n(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const isMissingSchema = (error: any) => {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)
    || msg.includes('relation')
    || msg.includes('function')
}
const isPermissionDenied = (error: any) => {
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  const status = Number(error?.status || error?.statusCode || 0)
  return code === '42501' || status === 403 || msg.includes('permission denied')
}

export default function LandedCostPage() {
  const { companyId } = useOrg()
  const { user } = useAuth()
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)

  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [schemaReady, setSchemaReady] = useState(true)
  const [detailVersion, setDetailVersion] = useState(0)
  const [detailLoading, setDetailLoading] = useState(false)
  const [loadedPurchaseOrderId, setLoadedPurchaseOrderId] = useState('')
  const [baseCurrencyCode, setBaseCurrencyCode] = useState('BASE')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [historyAccessDenied, setHistoryAccessDenied] = useState(false)
  const detailErrorToastRef = useRef('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [historyRuns, setHistoryRuns] = useState<LandedCostRun[]>([])
  const [receiptBuckets, setReceiptBuckets] = useState<LandedCostReceiptBucket[]>([])

  const [purchaseOrderId, setPurchaseOrderId] = useState('')
  const [allocationMethod, setAllocationMethod] = useState<LandedCostMethod>('quantity')
  const [freightCost, setFreightCost] = useState('')
  const [customsCost, setCustomsCost] = useState('')
  const [handlingCost, setHandlingCost] = useState('')
  const [packagingCost, setPackagingCost] = useState('')
  const [notes, setNotes] = useState('')
  const [extraCosts, setExtraCosts] = useState<CostLine[]>([])

  const supplierById = useMemo(() => new Map(suppliers.map(row => [row.id, row])), [suppliers])
  const itemById = useMemo(() => new Map(items.map(row => [row.id, row])), [items])
  const warehouseById = useMemo(() => new Map(warehouses.map(row => [row.id, row])), [warehouses])
  const binById = useMemo(() => new Map(bins.map(row => [row.id, row])), [bins])
  const selectedOrder = useMemo(
    () => purchaseOrders.find(row => row.id === purchaseOrderId) || null,
    [purchaseOrderId, purchaseOrders],
  )

  useEffect(() => {
    if (!companyId) {
      setLoading(false)
      setPurchaseOrders([])
      setReceiptBuckets([])
      setHistoryRuns([])
      setDetailLoading(false)
      setLoadedPurchaseOrderId('')
      setDetailError(null)
      setHistoryAccessDenied(false)
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        const [supplierRes, itemRes, warehouseRes, binRes, poRes] = await Promise.all([
          supabase.from('suppliers').select('id,code,name').eq('company_id', companyId).order('name', { ascending: true }),
          supabase.from('items').select('id,sku,name').eq('company_id', companyId).order('name', { ascending: true }),
          supabase.from('warehouses').select('id,name,code').eq('company_id', companyId).order('name', { ascending: true }),
          supabase.from('bins').select('id,code,name,warehouseId').order('code', { ascending: true }),
          supabase
            .from('purchase_orders')
            .select('id,order_no,supplier_id,currency_code,fx_to_base,created_at,status')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(150),
        ])

        if (supplierRes.error) throw supplierRes.error
        if (itemRes.error) throw itemRes.error
        if (warehouseRes.error) throw warehouseRes.error
        if (binRes.error) throw binRes.error
        if (poRes.error) throw poRes.error

        if (cancelled) return
        const warehouseIds = new Set(((warehouseRes.data || []) as Warehouse[]).map(row => row.id))
        setSuppliers((supplierRes.data || []) as Supplier[])
        setItems((itemRes.data || []) as Item[])
        setWarehouses((warehouseRes.data || []) as Warehouse[])
        setBins(((binRes.data || []) as Bin[]).filter(row => warehouseIds.has(row.warehouseId)))
        setPurchaseOrders((poRes.data || []) as PurchaseOrder[])
        getBaseCurrencyCode().then((code) => {
          if (!cancelled && code) setBaseCurrencyCode(code)
        }).catch(() => {})
      } catch (error: any) {
        console.error(error)
        if (!cancelled) toast.error(error?.message || tt('landedCost.loadFailed', 'Failed to load landed cost workspace'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [companyId])

  useEffect(() => {
    if (!purchaseOrderId || !companyId) {
      setReceiptBuckets([])
      setHistoryRuns([])
      setDetailLoading(false)
      setLoadedPurchaseOrderId('')
      setDetailError(null)
      setHistoryAccessDenied(false)
      return
    }

    let cancelled = false
    const activePurchaseOrderId = purchaseOrderId
    setReceiptBuckets([])
    setHistoryRuns([])
    setDetailLoading(true)
    setLoadedPurchaseOrderId('')
    ;(async () => {
      try {
        setDetailError(null)
        setHistoryAccessDenied(false)
        detailErrorToastRef.current = ''
        const receiptRes = await supabase
          .from('stock_movements')
          .select('item_id,ref_line_id,qty_base,unit_cost,total_value,warehouse_to_id,bin_to_id')
          .eq('company_id', companyId)
          .eq('type', 'receive')
          .eq('ref_type', 'PO')
          .eq('ref_id', activePurchaseOrderId)

        if (receiptRes.error) throw receiptRes.error

        const receipts = (receiptRes.data || []) as ReceiptMovement[]
        const itemIds = Array.from(new Set(receipts.map(row => row.item_id).filter(Boolean)))

        let levels: StockLevel[] = []
        if (itemIds.length) {
          const levelRes = await supabase
            .from('stock_levels')
            .select('id,item_id,warehouse_id,bin_id,qty,avg_cost')
            .eq('company_id', companyId)
            .in('item_id', itemIds)
          if (levelRes.error) throw levelRes.error
          levels = (levelRes.data || []) as StockLevel[]
        }

        let runs: LandedCostRun[] = []
        const runRes = await supabase
          .from('landed_cost_runs')
          .select('id,created_at,allocation_method,total_extra_cost,total_applied_value,total_unapplied_value,currency_code,notes')
          .eq('company_id', companyId)
          .eq('purchase_order_id', activePurchaseOrderId)
          .order('created_at', { ascending: false })
        if (runRes.error) {
          if (isMissingSchema(runRes.error)) {
            setSchemaReady(false)
          } else if (isPermissionDenied(runRes.error)) {
            setHistoryAccessDenied(true)
          } else {
            throw runRes.error
          }
        } else {
          setSchemaReady(true)
          setHistoryAccessDenied(false)
          runs = (runRes.data || []) as LandedCostRun[]
        }

        if (cancelled) return

        const levelByBucket = new Map(
          levels.map(level => [
            `${level.item_id}|${level.warehouse_id || ''}|${level.bin_id || ''}`,
            level,
          ]),
        )

        const bucketMap = new Map<string, LandedCostReceiptBucket>()
        for (const receipt of receipts) {
          const key = `${receipt.item_id}|${receipt.warehouse_to_id || ''}|${receipt.bin_to_id || ''}`
          const stock = levelByBucket.get(key)
          const item = itemById.get(receipt.item_id)
          const warehouse = receipt.warehouse_to_id ? warehouseById.get(receipt.warehouse_to_id) : null
          const bin = receipt.bin_to_id ? binById.get(receipt.bin_to_id) : null
          const existing = bucketMap.get(key)
          const receiptValueBase = receipt.total_value == null
            ? round(n(receipt.unit_cost) * n(receipt.qty_base))
            : n(receipt.total_value)

          if (existing) {
            existing.receivedQtyBase += n(receipt.qty_base)
            existing.receiptValueBase += receiptValueBase
            if (!existing.poLineId && receipt.ref_line_id) existing.poLineId = receipt.ref_line_id
            continue
          }

          bucketMap.set(key, {
            key,
            itemId: receipt.item_id,
            itemLabel: item ? `${item.name}${item.sku ? ` (${item.sku})` : ''}` : receipt.item_id,
            poLineId: receipt.ref_line_id || null,
            warehouseId: receipt.warehouse_to_id || null,
            warehouseLabel: warehouse ? warehouse.name : null,
            binId: receipt.bin_to_id || null,
            binLabel: bin ? `${bin.code} - ${bin.name}` : null,
            stockLevelId: stock?.id || null,
            receivedQtyBase: n(receipt.qty_base),
            receiptValueBase,
            onHandQtyBase: n(stock?.qty),
            previousAvgCost: n(stock?.avg_cost),
          })
        }

        setReceiptBuckets(Array.from(bucketMap.values()).sort((a, b) => a.itemLabel.localeCompare(b.itemLabel)))
        setHistoryRuns(runs)
        setLoadedPurchaseOrderId(activePurchaseOrderId)
      } catch (error: any) {
        console.error(error)
        if (!cancelled) {
          const message = error?.message || tt('landedCost.prefillFailed', 'Failed to load the purchase order receipts')
          setDetailError(message)
          setReceiptBuckets([])
          setHistoryRuns([])
          setLoadedPurchaseOrderId('')
          const errorKey = `${activePurchaseOrderId}:${String(error?.code || '')}:${message}`
          if (detailErrorToastRef.current !== errorKey) {
            toast.error(message)
            detailErrorToastRef.current = errorKey
          }
        }
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [companyId, purchaseOrderId, detailVersion, itemById, warehouseById, binById])

  const commonCosts = useMemo(() => ([
    { label: tt('landedCost.freight', 'Freight / transport'), amount: n(freightCost) },
    { label: tt('landedCost.customs', 'Customs / duty'), amount: n(customsCost) },
    { label: tt('landedCost.handling', 'Handling / clearing'), amount: n(handlingCost) },
    { label: tt('landedCost.packaging', 'Packaging / delivery'), amount: n(packagingCost) },
    ...extraCosts
      .map(row => ({ label: row.label.trim() || tt('landedCost.otherCost', 'Other cost'), amount: n(row.amount) }))
      .filter(row => row.amount !== 0),
  ]), [customsCost, extraCosts, freightCost, handlingCost, packagingCost])

  const extraCostTotal = useMemo(
    () => round(commonCosts.reduce((sum, row) => sum + row.amount, 0)),
    [commonCosts],
  )
  const fxToBase = n(selectedOrder?.fx_to_base, 1)
  const chargePayload = useMemo(
    () => commonCosts.filter(row => row.amount !== 0).map(row => ({
      label: row.label,
      amount: round(row.amount),
      amount_base: round(row.amount * fxToBase),
    })),
    [commonCosts, fxToBase],
  )

  const previewState = useMemo(
    () => buildLandedCostPreview({
      buckets: receiptBuckets,
      charges: chargePayload.map(row => ({ label: row.label, amount: row.amount_base })),
      method: allocationMethod,
    }),
    [allocationMethod, chargePayload, receiptBuckets],
  )
  const detailReady = Boolean(purchaseOrderId) && !detailLoading && loadedPurchaseOrderId === purchaseOrderId
  const valueAllocationUnavailable = detailReady
    && allocationMethod === 'value'
    && receiptBuckets.length > 0
    && previewState.totalReceiptValue <= 0

  async function applyLandedCost() {
    if (!companyId || !purchaseOrderId || !selectedOrder) return
    if (!schemaReady) return toast.error(tt('landedCost.migrationNeeded', 'Apply the landed cost migration before posting revaluation runs'))
    if (!detailReady) return toast.error(tt('landedCost.waitForReceipts', 'Wait for the selected purchase order receipts to load'))
    if (!chargePayload.length || extraCostTotal <= 0) return toast.error(tt('landedCost.enterCosts', 'Enter at least one landed cost'))
    if (!previewState.preview.length) return toast.error(tt('landedCost.noReceipts', 'Receive the purchase order before applying landed cost'))
    if (valueAllocationUnavailable) return toast.error(tt('landedCost.valueAllocationUnavailable', 'By item value requires receipt values. Choose quantity or equal distribution.'))

    try {
      setApplying(true)
      const { data, error } = await supabase.rpc('apply_landed_cost_run', {
        p_company_id: companyId,
        p_purchase_order_id: purchaseOrderId,
        p_supplier_id: selectedOrder.supplier_id || null,
        p_applied_by: user?.id || null,
        p_currency_code: (selectedOrder.currency_code || 'USD').toUpperCase(),
        p_fx_to_base: fxToBase,
        p_allocation_method: allocationMethod,
        p_total_extra_cost: extraCostTotal,
        p_notes: notes.trim() || null,
        p_charges: chargePayload,
        p_lines: previewState.preview.map(row => ({
          item_id: row.itemId,
          po_line_id: row.poLineId,
          warehouse_id: row.warehouseId,
          bin_id: row.binId,
          stock_level_id: row.stockLevelId,
        })),
      })

      if (error) throw error
      const run = Array.isArray(data) ? data[0] : data
      toast.success(
        `${tt('landedCost.applied', 'Landed cost applied')}: ${fmt(n(run?.total_applied_value))} ${baseCurrencyCode}`,
      )
      setFreightCost('')
      setCustomsCost('')
      setHandlingCost('')
      setPackagingCost('')
      setNotes('')
      setExtraCosts([])
      setDetailVersion(version => version + 1)
    } catch (error: any) {
      console.error(error)
      if (isMissingSchema(error)) {
        setSchemaReady(false)
        toast.error(tt('landedCost.migrationNeeded', 'Apply the landed cost migration before posting revaluation runs'))
      } else {
        toast.error(error?.message || tt('landedCost.applyFailed', 'Failed to apply landed cost'))
      }
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
            {tt('landedCost.eyebrow', 'Purchase valuation')}
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{tt('landedCost.title', 'Landed Cost')}</h1>
            <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
              {tt('landedCost.subtitle', 'Attach extra freight, customs, and handling to a received purchase order. The posted run revalues on-hand inventory through the same weighted-average stock logic used by PO receipts.')}
            </p>
          </div>
        </div>

        <div className="mobile-primary-actions">
          <Button asChild variant="outline">
            <Link to="/orders?tab=purchase">{tt('orders.title', 'Orders')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/bom">{tt('nav.bom', 'Assembly')}</Link>
          </Button>
        </div>
      </div>

      {!schemaReady && (
        <Card className="border-dashed border-amber-400/60 bg-amber-50/40 shadow-none dark:bg-amber-500/10">
          <CardContent className="p-4 text-sm text-muted-foreground">
            {tt('landedCost.migrationHint', 'Posting is disabled until the landed cost migration is applied. Preview remains available, but inventory revaluation will not post yet.')}
          </CardContent>
        </Card>
      )}

      {detailError && (
        <Card className="border-dashed border-rose-400/60 bg-rose-50/40 shadow-none dark:bg-rose-500/10">
          <CardContent className="p-4 text-sm text-muted-foreground">
            {detailError}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
        <div className="space-y-4">
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('landedCost.source', 'Purchase source')}</CardTitle>
              <CardDescription className="hidden sm:block">{tt('landedCost.sourceHelp', 'Pick a purchase order that already has received stock. Landed cost will be allocated across those receipt buckets and revalue the matching on-hand inventory.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>{tt('orders.po', 'PO')}</Label>
                <Select value={purchaseOrderId || 'NONE'} onValueChange={(value) => setPurchaseOrderId(value === 'NONE' ? '' : value)}>
                  <SelectTrigger><SelectValue placeholder={tt('landedCost.selectPO', 'Select purchase order')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">{tt('common.none', 'None')}</SelectItem>
                    {purchaseOrders.map(order => (
                      <SelectItem key={order.id} value={order.id}>
                        {order.order_no || order.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tt('landedCost.allocationMethod', 'Allocation method')}</Label>
                <Select value={allocationMethod} onValueChange={(value) => setAllocationMethod(value as LandedCostMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quantity">{tt('landedCost.byQuantity', 'By quantity')}</SelectItem>
                    <SelectItem value="value">{tt('landedCost.byValue', 'By item value')}</SelectItem>
                    <SelectItem value="equal">{tt('landedCost.equalSplit', 'Equal distribution')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {selectedOrder && (
                <>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('orders.supplier', 'Supplier')}</div>
                    <div className="mt-2 font-medium">{supplierById.get(selectedOrder.supplier_id || '')?.name || tt('common.none', 'None')}</div>
                  </div>
                  <div className="rounded-xl border bg-muted/30 p-3">
                    <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('orders.currency', 'Currency')}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 font-medium">
                      <span>{(selectedOrder.currency_code || 'USD').toUpperCase()}</span>
                      <Badge variant="outline">{tt('orders.fxToBaseShort', 'FX to Base')}: {fmt(fxToBase, 4)}</Badge>
                      {selectedOrder.status && <Badge variant="secondary" className="capitalize">{selectedOrder.status}</Badge>}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('landedCost.extraCosts', 'Additional landed costs')}</CardTitle>
              <CardDescription className="hidden sm:block">{tt('landedCost.extraCostsHelp', 'Enter the extra charges in the PO currency. Stock revaluation is posted in base value using the purchase order FX rate.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div><Label>{tt('landedCost.freight', 'Freight / transport')}</Label><Input inputMode="decimal" value={freightCost} onChange={(event) => setFreightCost(event.target.value)} /></div>
                <div><Label>{tt('landedCost.customs', 'Customs / duty')}</Label><Input inputMode="decimal" value={customsCost} onChange={(event) => setCustomsCost(event.target.value)} /></div>
                <div><Label>{tt('landedCost.handling', 'Handling / clearing')}</Label><Input inputMode="decimal" value={handlingCost} onChange={(event) => setHandlingCost(event.target.value)} /></div>
                <div><Label>{tt('landedCost.packaging', 'Packaging / delivery')}</Label><Input inputMode="decimal" value={packagingCost} onChange={(event) => setPackagingCost(event.target.value)} /></div>
              </div>

              <div className="space-y-2">
                {extraCosts.map(cost => (
                  <div key={cost.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_auto]">
                    <Input value={cost.label} onChange={(event) => setExtraCosts(prev => prev.map(row => row.id === cost.id ? { ...row, label: event.target.value } : row))} placeholder={tt('landedCost.otherCostLabel', 'Other cost label')} />
                    <Input inputMode="decimal" value={cost.amount} onChange={(event) => setExtraCosts(prev => prev.map(row => row.id === cost.id ? { ...row, amount: event.target.value } : row))} placeholder="0.00" />
                    <Button className="w-full md:w-auto" variant="ghost" onClick={() => setExtraCosts(prev => prev.filter(row => row.id !== cost.id))}>{tt('common.remove', 'Remove')}</Button>
                  </div>
                ))}
                <Button className="w-full sm:w-auto" variant="outline" onClick={() => setExtraCosts(prev => [...prev, { id: uid(), label: '', amount: '' }])}>
                  {tt('landedCost.addCostRow', 'Add another cost')}
                </Button>
              </div>

              <div>
                <Label>{tt('orders.notes', 'Notes')}</Label>
                <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={tt('landedCost.notesPlaceholder', 'Optional note for this landed cost run')} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('landedCost.summary', 'Revaluation summary')}</CardTitle>
              <CardDescription className="hidden sm:block">{tt('landedCost.summaryHelp', 'Before posting, review how much value will be applied to current stock and how much remains unapplied because the received units are no longer on hand.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-muted/30 p-4"><div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.totalEntered', 'Entered extra cost')}</div><div className="mt-2 text-2xl font-semibold tracking-tight">{fmt(extraCostTotal)} {(selectedOrder?.currency_code || 'USD').toUpperCase()}</div></div>
                <div className="rounded-xl border bg-muted/30 p-4"><div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.totalEnteredBase', 'Entered extra in base')}</div><div className="mt-2 text-2xl font-semibold tracking-tight">{fmt(extraCostTotal * fxToBase)} {baseCurrencyCode}</div></div>
                <div className="rounded-xl border bg-muted/30 p-4"><div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.appliedValue', 'Applied to inventory')}</div><div className="mt-2 text-2xl font-semibold tracking-tight">{fmt(previewState.totalAppliedValue)} {baseCurrencyCode}</div></div>
                <div className="rounded-xl border bg-muted/30 p-4"><div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.unappliedValue', 'Not applied to current stock')}</div><div className="mt-2 text-2xl font-semibold tracking-tight">{fmt(previewState.totalUnappliedValue)} {baseCurrencyCode}</div></div>
              </div>

              <div className="grid gap-3 rounded-xl border p-4 md:grid-cols-2">
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.currentAffectedValue', 'Current affected inventory value')}</div>
                  <div className="mt-2 text-lg font-semibold tracking-tight">{fmt(previewState.totalCurrentValue)} {baseCurrencyCode}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{tt('landedCost.newAffectedValue', 'New affected inventory value')}</div>
                  <div className="mt-2 text-lg font-semibold tracking-tight">{fmt(previewState.totalNewValue)} {baseCurrencyCode}</div>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{tt('landedCost.preview', 'Allocation preview')}</div>
                    <div className="text-xs text-muted-foreground">{tt('landedCost.previewNote', 'The current valuation model is weighted average per stock bucket. Revaluation updates the affected stock level average cost rather than isolated receipt layers.')}</div>
                  </div>
                  {selectedOrder && <Button asChild className="w-full sm:w-auto" variant="ghost" size="sm"><Link to={`/orders?tab=purchase&orderId=${selectedOrder.id}`}>{tt('landedCost.viewOrder', 'View order')}</Link></Button>}
                </div>

                <div className="mt-3 overflow-x-auto">
                  {valueAllocationUnavailable && (
                    <div className="mb-3 rounded-xl border border-amber-400/60 bg-amber-50/70 p-3 text-sm text-amber-900 dark:bg-amber-500/12 dark:text-amber-100">
                      {tt('landedCost.valueAllocationUnavailable', 'By item value requires receipt values. Choose quantity or equal distribution.')}
                    </div>
                  )}
                  <table className="w-full min-w-[880px] text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 pr-3">{tt('table.item', 'Item')}</th>
                        <th className="py-2 pr-3">{tt('orders.toWarehouse', 'Warehouse')}</th>
                        <th className="py-2 pr-3 text-right">{tt('landedCost.receivedQty', 'Received')}</th>
                        <th className="py-2 pr-3 text-right">{tt('landedCost.onHandQty', 'On hand')}</th>
                        <th className="py-2 pr-3 text-right">{tt('movements.avgCost', 'Avg Cost')}</th>
                        <th className="py-2 pr-3 text-right">{tt('landedCost.allocatedExtra', 'Allocated extra')}</th>
                        <th className="py-2 pr-3 text-right">{tt('landedCost.appliedValue', 'Applied')}</th>
                        <th className="py-2 text-right">{tt('landedCost.newAvgCost', 'New Avg Cost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewState.preview.map(row => (
                        <tr key={row.key} className="border-b align-top">
                          <td className="py-2 pr-3">
                            <div className="font-medium">{row.itemLabel}</div>
                            <div className="text-xs text-muted-foreground">{row.binLabel || tt('common.none', 'None')}</div>
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{row.warehouseLabel || tt('common.none', 'None')}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmt(row.receivedQtyBase, 3)}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmt(row.onHandQtyBase, 3)}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmt(row.previousAvgCost)}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmt(row.allocatedExtra)}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmt(row.appliedRevaluation)}</td>
                          <td className="py-2 text-right">
                            <div className="font-mono tabular-nums">{fmt(row.newAvgCost)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {row.unappliedValue > 0
                                ? `${tt('landedCost.unappliedShort', 'Unapplied')}: ${fmt(row.unappliedValue)}`
                                : tt('landedCost.fullyApplied', 'Fully applied')}
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!previewState.preview.length && (
                        <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">{loading || detailLoading ? tt('loading', 'Loading') : tt('landedCost.noReceipts', 'Receive the purchase order first to generate revaluable stock buckets.')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mobile-primary-actions mt-4 justify-end">
                  <Button variant="outline" onClick={() => setDetailVersion(version => version + 1)}>{tt('common.refresh', 'Refresh')}</Button>
                  <Button onClick={applyLandedCost} disabled={applying || !schemaReady || !detailReady || valueAllocationUnavailable || !previewState.preview.length || extraCostTotal <= 0}>
                    {applying ? tt('landedCost.applying', 'Applying...') : tt('landedCost.apply', 'Apply landed cost')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle>{tt('landedCost.history', 'Applied runs')}</CardTitle>
              <CardDescription className="hidden sm:block">{tt('landedCost.historyHelp', 'Every posted landed cost run keeps a PO-level audit trail with the applied and unapplied value split.')}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {historyAccessDenied && (
                <div className="mb-4 rounded-xl border border-dashed border-amber-400/60 bg-amber-50/40 p-3 text-sm text-muted-foreground dark:bg-amber-500/10">
                  {tt('landedCost.historyAccessDenied', 'Applied-run history is temporarily unavailable for this company account. Posting still uses company-scoped permissions once the landed cost access migration is in place.')}
                </div>
              )}
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-3">{tt('table.date', 'Date')}</th>
                    <th className="py-2 pr-3">{tt('landedCost.method', 'Method')}</th>
                    <th className="py-2 pr-3 text-right">{tt('landedCost.totalEntered', 'Entered extra')}</th>
                    <th className="py-2 pr-3 text-right">{tt('landedCost.appliedValue', 'Applied')}</th>
                    <th className="py-2 pr-3 text-right">{tt('landedCost.unappliedValue', 'Unapplied')}</th>
                    <th className="py-2">{tt('orders.notes', 'Notes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRuns.map(run => (
                    <tr key={run.id} className="border-b">
                      <td className="py-2 pr-3 whitespace-nowrap">{run.created_at ? new Date(run.created_at).toLocaleString(lang) : '-'}</td>
                      <td className="py-2 pr-3 capitalize">{run.allocation_method || '-'}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmt(n(run.total_extra_cost))} {(run.currency_code || selectedOrder?.currency_code || 'USD').toUpperCase()}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmt(n(run.total_applied_value))} {baseCurrencyCode}</td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmt(n(run.total_unapplied_value))} {baseCurrencyCode}</td>
                      <td className="py-2 text-muted-foreground">{run.notes || '-'}</td>
                    </tr>
                  ))}
                  {!historyRuns.length && (
                    <tr><td colSpan={6} className="py-4 text-muted-foreground">{tt('landedCost.historyEmpty', 'No landed cost runs have been applied to this purchase order yet.')}</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
