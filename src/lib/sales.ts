// src/lib/sales.ts
import { supabase } from './db'
import toast from 'react-hot-toast'

/** Ensures a single "Walk-in (Cash)" customer exists for the company and returns its id */
export async function getCashCustomerId(companyId: string): Promise<string> {
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

export type CreateCashSOParams = {
  companyId: string
  orderDate?: Date
  status?: 'draft' | 'confirmed' | string
  source?: string
  // Add other columns your table requires here (currency_code, order_number, etc.)
}

/** Creates a minimal Sales Order for a cash sale and returns the new SO id */
export async function createCashSalesOrder(params: CreateCashSOParams): Promise<string> {
  const {
    companyId,
    orderDate = new Date(),
    status = 'confirmed',
    source = 'cash',
  } = params

  const customerId = await getCashCustomerId(companyId)

  const payload: Record<string, any> = {
    company_id: companyId,
    customer_id: customerId,            // critical fix for NOT NULL
    order_date: orderDate.toISOString(),
    status,
    source,
  }

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
  companyId: string
  salesOrderId: string
  itemId: string
  qty: number
  uomId: string
  unitPrice: number
  warehouseId?: string
  // Add tax fields/discounts here if applicable
}

/** Creates one Sales Order Line */
export async function createSalesOrderLine(params: CreateSOLineParams): Promise<void> {
  const {
    companyId,
    salesOrderId,
    itemId,
    qty,
    uomId,
    unitPrice,
    warehouseId,
  } = params

  const linePayload: Record<string, any> = {
    company_id: companyId,
    sales_order_id: salesOrderId,
    item_id: itemId,
    qty,
    uom_id: uomId,
    unit_price: unitPrice,
  }

  if (warehouseId) linePayload.warehouse_id = warehouseId

  const { error } = await supabase.from('sales_order_lines').insert(linePayload)
  if (error) {
    console.error('Insert sales_order_lines failed:', error, 'payload:', linePayload)
    toast.error('Could not add Sales Order line.')
    throw error
  }
}

/** Convenience orchestrator for cash-sale SO + 1 line (you can loop this for multiple lines) */
export async function finalizeCashSaleSO(args: {
  companyId: string
  itemId: string
  qty: number
  uomId: string
  unitPrice: number
  fulfilWarehouseId?: string
  orderDate?: Date
  status?: 'draft' | 'confirmed' | string
}) {
  const {
    companyId,
    itemId,
    qty,
    uomId,
    unitPrice,
    fulfilWarehouseId,
    orderDate,
    status = 'confirmed',
  } = args

  const soId = await createCashSalesOrder({ companyId, orderDate, status, source: 'cash' })

  await createSalesOrderLine({
    companyId,
    salesOrderId: soId,
    itemId,
    qty,
    uomId,
    unitPrice,
    warehouseId: fulfilWarehouseId,
  })

  toast.success('Cash sale Sales Order created.')
  return soId
}
