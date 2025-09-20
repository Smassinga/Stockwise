// src/lib/sales.ts
import { supabase } from './db'
import toast from 'react-hot-toast'

/** Find a default “CASH” customer or create one, or use app_settings override */
async function findOrCreateCashCustomerId(): Promise<string> {
  const app = await supabase.from('app_settings').select('data').eq('id','app').maybeSingle()
  const preset = (app.data?.data as any)?.sales?.defaultCashCustomerId as string | undefined
  if (preset) return preset

  const existing = await supabase
    .from('customers')
    .select('id')
    .or('code.ilike.CASH%,name.ilike.Cash%')
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (existing.data?.id) return existing.data.id

  const created = await supabase
    .from('customers')
    .insert({ code: 'CASH', name: 'Cash Customer' })
    .select('id')
    .single()
  if (created.error) {
    console.error('create CASH customer failed:', created.error)
    toast.error('Could not create a Cash customer.')
    throw created.error
  }
  return created.data.id as string
}

export type CreateSOParams = {
  customerId?: string
  orderDate?: Date
  /** Must be one of so_status enum: draft|submitted|confirmed|allocated|shipped|closed|cancelled */
  status?: string
  currencyCode?: string
  fxToBase?: number
  totalAmount?: number
}

/** Create a minimal SO and return its id */
export async function createSalesOrder(params: CreateSOParams): Promise<string> {
  const {
    customerId,
    orderDate = new Date(),
    status = 'shipped',
    currencyCode = 'MZN',
    fxToBase = 1,
    totalAmount = 0,
  } = params

  const custId = customerId || await findOrCreateCashCustomerId()

  const payload: Record<string, any> = {
    customer_id: custId,
    order_date: orderDate.toISOString(),
    status,
    currency_code: currencyCode,
    fx_to_base: fxToBase,
    total_amount: totalAmount,
  }

  const { data, error } = await supabase
    .from('sales_orders')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    console.error('Insert sales_orders failed:', error, 'payload:', payload)
    toast.error('Could not create Sales Order.')
    throw error
  }
  return data!.id as string
}

export type CreateSOLineParams = {
  soId: string
  itemId: string
  qty: number
  uomId: string
  unitPrice: number
  discountPct?: number
}

/** Create one SO line */
export async function createSalesOrderLine(params: CreateSOLineParams): Promise<string> {
  const { soId, itemId, qty, uomId, unitPrice, discountPct = 0 } = params
  const lineTotal = qty * unitPrice * (1 - discountPct / 100)

  const { data, error } = await supabase
    .from('sales_order_lines')
    .insert({
      so_id: soId,
      item_id: itemId,
      uom_id: uomId,
      line_no: 1,
      qty,
      unit_price: unitPrice,
      discount_pct: discountPct,
      line_total: lineTotal,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Insert sales_order_lines failed:', error)
    toast.error('Could not add Sales Order line.')
    throw error
  }
  return data!.id as string
}

/** One-shot cash sale helper: SO (status shipped) + 1 line */
export async function finalizeCashSaleSO(args: {
  itemId: string
  qty: number
  uomId: string
  unitPrice: number
  customerId?: string
  currencyCode?: string
  fxToBase?: number
  status?: string
}) {
  const {
    itemId, qty, uomId, unitPrice,
    customerId,
    currencyCode = 'MZN',
    fxToBase = 1,
    status = 'shipped',
  } = args

  const soId = await createSalesOrder({
    customerId,
    status,
    currencyCode,
    fxToBase,
    totalAmount: qty * unitPrice,
  })

  const soLineId = await createSalesOrderLine({
    soId, itemId, qty, uomId, unitPrice,
  })

  toast.success('Cash sale Sales Order created.')
  return { soId, soLineId }
}

/* ----------------------- SO + COGS wrapper ----------------------- */

export type CashSaleWithCogsArgs = {
  itemId: string
  qty: number           // entered qty (for pricing)
  qtyBase: number       // converted to base (for stock)
  uomId: string
  unitPrice: number
  customerId?: string
  currencyCode?: string
  fxToBase?: number
  status?: string       // defaults to 'shipped'
  binId: string         // source bin for the issue
  cogsUnitCost?: number // optional; will fallback to current avg_cost
}

/**
 * Creates SO (revenue) and records a single COGS stock "issue" by inserting
 * into stock_movements (DB triggers update stock_levels + COGS).
 * NOTE: We derive the warehouseId from the chosen bin.
 */
export async function finalizeCashSaleSOWithCOGS(args: CashSaleWithCogsArgs) {
  const {
    itemId, qty, qtyBase, uomId, unitPrice,
    customerId, currencyCode = 'MZN', fxToBase = 1, status = 'shipped',
    binId, cogsUnitCost,
  } = args

  // 1) Create SO + one line (revenue)
  const { soId, soLineId } = await finalizeCashSaleSO({
    itemId, qty, uomId, unitPrice,
    customerId, currencyCode, fxToBase, status,
  })

  // 2) Derive warehouse from the bin (column is "warehouseId" in your schema)
  const bin = await supabase.from('bins').select('warehouseId').eq('id', binId).maybeSingle()
  if (bin.error || !bin.data?.warehouseId) {
    console.error('Could not resolve warehouse from bin:', bin.error || bin.data)
    toast.error('Could not resolve bin’s warehouse for COGS.')
    throw bin.error || new Error('Missing warehouseId on bin')
  }
  const warehouseId = bin.data.warehouseId as string

  // 3) Use provided unit cost or fall back to current avg_cost snapshot
  let unitCost = Number(cogsUnitCost ?? 0)
  if (!Number.isFinite(unitCost) || unitCost <= 0) {
    const costSnap = await supabase
      .from('stock_levels')
      .select('avg_cost')
      .eq('warehouse_id', warehouseId)
      .eq('bin_id', binId)
      .eq('item_id', itemId)
      .maybeSingle()
    if (!costSnap.error && costSnap.data?.avg_cost != null) {
      unitCost = Number(costSnap.data.avg_cost) || 0
    }
  }

  // 4) Record the COGS as an ISSUE. Triggers will update stock_levels.
  const ins = await supabase
    .from('stock_movements')
    .insert({
      type: 'issue',
      item_id: itemId,
      uom_id: uomId,
      qty,                          // for audit
      qty_base: qtyBase,            // used by triggers
      unit_cost: unitCost,
      total_value: unitCost * qtyBase,
      warehouse_from_id: warehouseId,
      bin_from_id: binId,
      notes: 'Cash sale (auto)',
      created_by: 'so_ship',        // dashboards count this for COGS
      ref_type: 'SO',
      ref_id: soId,                 // text/uuid accepted by Supabase based on your schema
      ref_line_id: soLineId,
    })
    .select('id')
    .single()

  if (ins.error) {
    console.error('Insert stock_movements (COGS) failed:', ins.error)
    toast.error('Recorded the sale, but failed to record COGS movement.')
    throw ins.error
  }

  toast.success('COGS movement recorded.')
  return { soId, soLineId, movementId: ins.data.id as string }
}
