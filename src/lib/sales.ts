// src/lib/sales.ts
import { supabase } from './db'
import toast from 'react-hot-toast'

/**
 * Resolve a "Cash" customer id.
 * If companyId is provided, try your ensure_cash_customer RPC first.
 * Otherwise, fall back to finding an existing CASH/WALK-IN style customer.
 */
export async function getCashCustomerId(companyId?: string): Promise<string> {
  // Prefer the RPC if company scoping is available
  if (companyId) {
    const { data, error } = await supabase.rpc('ensure_cash_customer', { p_company_id: companyId })
    if (error) {
      console.error('ensure_cash_customer RPC failed:', error)
      toast.error('Could not ensure a cash customer for this company.')
      throw error
    }
    if (!data) {
      const err = new Error('ensure_cash_customer returned null/undefined')
      console.error(err)
      toast.error('No cash customer available.')
      throw err
    }
    return data as string
  }

  // Fallback: look up by codes/names (no warehouses/company lookup)
  // 1) app settings override
  const app = await supabase.from('app_settings').select('data').eq('id', 'app').maybeSingle()
  const fromSettings = (app.data as any)?.data?.sales?.cashCustomerId as string | undefined
  if (fromSettings) {
    const check = await supabase.from('customers').select('id').eq('id', fromSettings).maybeSingle()
    if (!check.error && check.data?.id) return check.data.id as string
  }

  // 2) common codes
  const byCode = await supabase
    .from('customers')
    .select('id,code,name')
    .in('code', ['CASH', 'CASH SALE', 'WALKIN', 'WALK-IN'])
    .order('code', { ascending: true })
    .limit(1)
  if (!byCode.error && byCode.data?.[0]?.id) return byCode.data[0].id as string

  // 3) name begins with "cash"
  const byName = await supabase.from('customers').select('id').ilike('name', 'cash%').limit(1)
  if (!byName.error && byName.data?.[0]?.id) return byName.data[0].id as string

  toast.error('No default cash customer found. Create one named/code "CASH".')
  throw new Error('No default cash customer found')
}

export type CreateCashSOParams = {
  companyId?: string
  orderDate?: Date
  status?: 'draft' | 'confirmed' | 'completed' | string
  source?: string
  currencyCode?: string
  fxToBase?: number
  totalAmount?: number
  notes?: string | null
}

/**
 * Creates a minimal Sales Order and returns its id.
 * Fields align to your live schema and the dashboard (currency_code, fx_to_base, total_amount).
 */
export async function createCashSalesOrder(params: CreateCashSOParams): Promise<string> {
  const {
    companyId,
    orderDate = new Date(),
    status = 'completed', // important: dashboard counts completed/shipped-like
    source = 'cash',
    currencyCode,
    fxToBase = 1,
    totalAmount = 0,
    notes = 'Cash sale via Stock Movements',
  } = params

  const customerId = await getCashCustomerId(companyId)

  const payload: Record<string, any> = {
    customer_id: customerId,            // NOT NULL on your table
    order_date: orderDate.toISOString(),
    status,
    source,
    currency_code: currencyCode || null,
    fx_to_base: fxToBase,
    total_amount: totalAmount,
    notes,
  }

  if (companyId) payload.company_id = companyId

  const { data, error } = await supabase
    .from('sales_orders')
    .insert(payload)
    .select('id')
    .single()

  if (error) {
    console.error('Insert sales_orders failed:', error, 'payload:', payload)
    toast.error('Could not create Sales Order for cash sale.')
    throw error
  }
  return data!.id as string
}

export type CreateSOLineParams = {
  companyId?: string
  salesOrderId: string
  itemId: string
  qty: number
  uomId: string
  unitPrice: number
  discountPct?: number | null
  warehouseId?: string
}

/** Creates one Sales Order Line — uses `so_id` to match your current schema. */
export async function createSalesOrderLine(params: CreateSOLineParams): Promise<string> {
  const {
    companyId,
    salesOrderId,
    itemId,
    qty,
    uomId,
    unitPrice,
    discountPct = 0,
    warehouseId,
  } = params

  const lineTotal = qty * unitPrice * (1 - (Number(discountPct || 0) / 100))
  const linePayload: Record<string, any> = {
    so_id: salesOrderId,  // <-- matches Dashboard/SalesOrders usage
    item_id: itemId,
    uom_id: uomId,
    qty,
    unit_price: unitPrice,
    discount_pct: discountPct,
    line_total: lineTotal,
  }
  if (companyId) linePayload.company_id = companyId
  if (warehouseId) linePayload.warehouse_id = warehouseId

  const { data, error } = await supabase
    .from('sales_order_lines')
    .insert(linePayload)
    .select('id')
    .single()

  if (error) {
    console.error('Insert sales_order_lines failed:', error, 'payload:', linePayload)
    toast.error('Could not add Sales Order line.')
    throw error
  }
  return data!.id as string
}

/**
 * Convenience orchestrator for cash-sale SO + single line.
 * Returns { soId, soLineId } so you can tag stock_movements (ref_id/ref_line_id).
 */
export async function finalizeCashSaleSO(args: {
  companyId?: string
  itemId: string
  qty: number
  uomId: string
  unitPrice: number
  currencyCode?: string
  fxToBase?: number
  fulfilWarehouseId?: string
  orderDate?: Date
  status?: 'draft' | 'confirmed' | 'completed' | string
}) {
  const {
    companyId,
    itemId,
    qty,
    uomId,
    unitPrice,
    currencyCode,
    fxToBase = 1,
    fulfilWarehouseId,
    orderDate,
    status = 'completed', // <- key for revenue on Dashboard
  } = args

  const lineTotal = qty * unitPrice

  const soId = await createCashSalesOrder({
    companyId,
    orderDate,
    status,
    source: 'cash',
    currencyCode,
    fxToBase,
    totalAmount: lineTotal,
  })

  const soLineId = await createSalesOrderLine({
    companyId,
    salesOrderId: soId,
    itemId,
    qty,
    uomId,
    unitPrice,
    discountPct: 0,
    warehouseId: fulfilWarehouseId,
  })

  toast.success('Cash sale Sales Order created.')
  return { soId, soLineId }
}
