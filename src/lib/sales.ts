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
  binId: string
  cogsUnitCost: number  // avg cost at time of sale (per base qty)
}

/**
 * Creates SO (revenue) and records a single COGS stock "issue" via RPC.
 */
export async function finalizeCashSaleSOWithCOGS(args: CashSaleWithCogsArgs) {
  const {
    itemId, qty, qtyBase, uomId, unitPrice,
    customerId, currencyCode = 'MZN', fxToBase = 1, status = 'shipped',
    binId, cogsUnitCost,
  } = args

  // 1) Create the SO + line (revenue)
  const created = await finalizeCashSaleSO({
    itemId, qty, uomId, unitPrice,
    customerId, currencyCode, fxToBase, status,
  })

  // 2) Record COGS as a single “issue” from the selected bin
  const { error } = await supabase.rpc('apply_stock_delta', {
    p_item_id: itemId,
    p_action: 'issue',
    p_bin_id: binId,
    p_qty_base: qtyBase,
    p_unit_cost: cogsUnitCost ?? 0,
  })
  if (error) {
    console.error('apply_stock_delta failed:', error)
    toast.error('Failed to record COGS movement.')
    throw error
  }

  return created
}
