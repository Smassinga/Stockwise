// src/lib/db.ts
import { supabase } from './supabase'

type OrderBy = { [col: string]: 'asc' | 'desc' }
type ListOpts = { where?: Record<string, any>; orderBy?: OrderBy; limit?: number }

// --- Extra types for movements ---
type MovementsListOpts = ListOpts & {
  fromDate?: string;   // 'YYYY-MM-DD' inclusive start (00:00:00Z)
  toDate?: string;     // 'YYYY-MM-DD' inclusive end   (23:59:59Z)
}

type MovementRow = {
  id: string
  type: string
  item_id: string
  qty: number | null
  qty_base: number | null
  unit_cost: number | null
  total_value: number | null
  warehouse_id: string | null
  warehouse_from_id: string | null
  warehouse_to_id: string | null
  bin_from_id: string | null
  bin_to_id: string | null
  created_at: string | null
  // any other columns are preserved by spreading
}

function applyQuery(table: string, opts?: ListOpts) {
  let q = supabase.from(table).select('*')

  if (opts?.where) {
    for (const [k, v] of Object.entries(opts.where)) {
      if (v === null) q = q.is(k, null)
      else q = q.eq(k, v)
    }
  }

  if (opts?.orderBy) {
    for (const [k, dir] of Object.entries(opts.orderBy)) {
      q = q.order(k, { ascending: dir === 'asc' })
    }
  }

  if (opts?.limit) q = q.limit(opts.limit)
  return q
}

function coll(table: string) {
  return {
    async list(opts?: ListOpts) {
      const q = applyQuery(table, opts)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    async get(id: string) {
      // Array mode: avoids 406 and preserves previous behavior by throwing if not found
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('id', id)
        .limit(1)

      if (error) throw error
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null
      if (!row) {
        const e: any = new Error(`${table}(${id}) not found`)
        e.code = 'NOT_FOUND'
        throw e
      }
      return row
    },
    async create(payload: any) {
      // Insert and return first row without .single()
      const { data, error } = await supabase
        .from(table)
        .insert(payload)
        .select()
        .limit(1)

      if (error) throw error
      return Array.isArray(data) && data.length > 0 ? data[0] : payload
    },
    async update(id: string, payload: any) {
      const { data, error } = await supabase
        .from(table)
        .update(payload)
        .eq('id', id)
        .select()
        .limit(1)

      if (error) throw error
      return Array.isArray(data) && data.length > 0 ? data[0] : payload
    },
    async remove(id: string) {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
      return true
    },
  }
}

// --- specialized movements with better list() ---
const baseMovements = coll('stock_movements')

function mapOrderCol(col: string) {
  if (col === 'createdAt') return 'created_at'
  if (col === 'warehouseFromId') return 'warehouse_from_id'
  if (col === 'warehouseToId') return 'warehouse_to_id'
  if (col === 'warehouseId') return 'warehouse_id'
  if (col === 'binFromId') return 'bin_from_id'
  if (col === 'binToId') return 'bin_to_id'
  if (col === 'totalValue') return 'total_value'
  return col
}

export const db = {
  users: coll('users'),
  uom: coll('uom'),
  items: coll('items'),
  warehouses: coll('warehouses'),
  bins: coll('bins'),
  stockLevels: coll('stock_levels'),

  // --- override movements here ---
  movements: {
    ...baseMovements,

    // list with date range, ordering, and snake_case ➜ camelCase mapping
    async list(opts?: MovementsListOpts) {
      let q = supabase.from('stock_movements').select('*')

      if (opts?.where) {
        for (const [k, v] of Object.entries(opts.where)) {
          if (v === null) q = q.is(k, null)
          else q = q.eq(k, v)
        }
      }

      if (opts?.fromDate) q = q.gte('created_at', `${opts.fromDate}T00:00:00Z`)
      if (opts?.toDate)   q = q.lte('created_at', `${opts.toDate}T23:59:59.999Z`)

      if (opts?.orderBy) {
        for (const [k, dir] of Object.entries(opts.orderBy)) {
          q = q.order(mapOrderCol(k), { ascending: dir === 'asc' })
        }
      }

      if (opts?.limit) q = q.limit(opts.limit)

      const { data, error } = await q
      if (error) throw error

      return (data ?? []).map((r: MovementRow) => ({
        // camelCase expected by reports engine:
        id: r.id,
        type: r.type,
        itemId: r.item_id,
        qty: r.qty ?? undefined,
        qtyBase: r.qty_base ?? r.qty ?? undefined,
        unitCost: r.unit_cost ?? undefined,
        totalValue: r.total_value ?? undefined,
        warehouseId: r.warehouse_id ?? undefined,
        warehouseFromId: r.warehouse_from_id ?? undefined,
        warehouseToId: r.warehouse_to_id ?? undefined,
        binFromId: r.bin_from_id ?? undefined,
        binToId: r.bin_to_id ?? undefined,
        created_at: r.created_at ?? undefined, // keep snake for compatibility
        createdAt: r.created_at ?? undefined,  // convenience camel
      }))
    },
  },

  alerts: coll('alerts'),
  lowStockAlerts: coll('low_stock_alerts'),

  // Currencies & FX
  currencies: coll('currencies'),
  settings: coll('settings'),
  fxRates: coll('fx_rates'),

  // Orders
  purchaseOrders: coll('purchase_orders'),
  purchaseOrderLines: coll('purchase_order_lines'),
  salesOrders: coll('sales_orders'),
  salesOrderLines: coll('sales_order_lines'),

  // NEW master data
  customers: coll('customers'),
  suppliers: coll('suppliers'),
}

export { supabase } from './supabase'
