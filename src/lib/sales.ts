// src/lib/sales.ts
import { supabase } from './db'
import toast from 'react-hot-toast'

/** Find a default “CASH” customer or create one, or use app_settings override */
async function findOrCreateCashCustomerId(): Promise<string> {
  // 1) app_settings override (optional)
  const app = await supabase.from('app_settings').select('data').eq('id','app').maybeSingle()
  const preset = (app.data?.data as any)?.sales?.defaultCashCustomerId as string | undefined
  if (preset) return preset

  // 2) look for an existing CASH customer
  const existing = await supabase
    .from('customers')
    .select('id')
    .or('code.ilike.CASH%,name.ilike.Cash%')
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (existing.data?.id) return existing.data.id

  // 3) create one
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
    status = 'shipped',        // <- valid enum value; shows as revenue on dashboard
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
    // NOTE: intentionally no 'source' or 'company_id'
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
      so_id: soId,            // <- correct column name
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
  status?: string        // defaults to 'shipped'
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
