// src/lib/sales.ts
import { supabase } from './db'
import toast from 'react-hot-toast'

export async function getCashCustomerId(companyId?: string): Promise<string> {
  if (companyId) {
    const { data, error } = await supabase.rpc('ensure_cash_customer', { p_company_id: companyId })
    if (error) { console.error('ensure_cash_customer RPC failed:', error); toast.error('Could not ensure a cash customer.'); throw error }
    if (!data) { const err = new Error('ensure_cash_customer returned null'); console.error(err); toast.error('No cash customer available.'); throw err }
    return data as string
  }

  const app = await supabase.from('app_settings').select('data').eq('id', 'app').maybeSingle()
  const fromSettings = (app.data as any)?.data?.sales?.cashCustomerId as string | undefined
  if (fromSettings) {
    const check = await supabase.from('customers').select('id').eq('id', fromSettings).maybeSingle()
    if (!check.error && check.data?.id) return check.data.id as string
  }

  const byCode = await supabase.from('customers').select('id,code,name')
    .in('code', ['CASH', 'CASH SALE', 'WALKIN', 'WALK-IN'])
    .order('code', { ascending: true }).limit(1)
  if (!byCode.error && byCode.data?.[0]?.id) return byCode.data[0].id as string

  const byName = await supabase.from('customers').select('id').ilike('name', 'cash%').limit(1)
  if (!byName.error && byName.data?.[0]?.id) return byName.data[0].id as string

  toast.error('No default cash customer found. Create one named/code "CASH".')
  throw new Error('No default cash customer found')
}

export type CreateCashSOParams = {
  companyId?: string
  status?: 'draft' | 'confirmed' | 'shipped' | 'completed' | string
  currencyCode?: string
  fxToBase?: number
  totalAmount?: number
  notes?: string | null
}

/** Create SO with shipped-like status so it won’t appear in “Outstanding” and won’t need shipping again. */
export async function createCashSalesOrder(params: CreateCashSOParams): Promise<string> {
  const {
    companyId,
    status = 'shipped',                 // IMPORTANT: shipped-like so Dashboard counts revenue
    currencyCode,
    fxToBase = 1,
    totalAmount = 0,
    notes = 'Cash sale via Stock Movements',
  } = params

  const customer_id = await getCashCustomerId(companyId)

  const payload: Record<string, any> = {
    customer_id,
    status,
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

export async function createSalesOrderLine(params: CreateSOLineParams): Promise<string> {
  const {
    companyId, salesOrderId, itemId, qty, uomId, unitPrice, discountPct = 0, warehouseId,
  } = params
  const line_total = qty * unitPrice * (1 - (Number(discountPct || 0) / 100))
  const row: Record<string, any> = {
    so_id: salesOrderId,
    item_id: itemId,
    uom_id: uomId,
    qty,
    unit_price: unitPrice,
    discount_pct: discountPct,
    line_total,
    line_no: 1,
  }
  if (companyId) row.company_id = companyId
  if (warehouseId) row.warehouse_id = warehouseId

  const { data, error } = await supabase
    .from('sales_order_lines')
    .insert(row)
    .select('id')
    .single()

  if (error) {
    console.error('Insert sales_order_lines failed:', error, 'payload:', row)
    toast.error('Could not add Sales Order line.')
    throw error
  }
  return data!.id as string
}

/** SO + 1 line; returns ids so movement can reference them */
export async function finalizeCashSaleSO(args: {
  companyId?: string
  itemId: string
  qty: number
  uomId: string
  unitPrice: number
  currencyCode?: string
  fxToBase?: number
  fulfilWarehouseId?: string
  status?: 'draft' | 'confirmed' | 'shipped' | 'completed' | string
}) {
  const {
    companyId, itemId, qty, uomId, unitPrice,
    currencyCode, fxToBase = 1, fulfilWarehouseId,
    status = 'shipped',
  } = args

  const totalAmount = qty * unitPrice
  const soId = await createCashSalesOrder({
    companyId, status, currencyCode, fxToBase, totalAmount,
    notes: 'Cash sale via Stock Movements',
  })
  const soLineId = await createSalesOrderLine({
    companyId, salesOrderId: soId, itemId, qty, uomId, unitPrice, discountPct: 0, warehouseId: fulfilWarehouseId,
  })

  toast.success('Cash sale Sales Order created.')
  return { soId, soLineId }
}
