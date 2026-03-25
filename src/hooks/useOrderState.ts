import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/db'
import {
  PURCHASE_ORDER_STATE_VIEW,
  SALES_ORDER_STATE_VIEW,
  type PurchaseOrderStateRow,
  type SalesOrderStateRow,
} from '../lib/orderState'

type StateHookResult<T extends { id: string }> = {
  rows: T[]
  byId: Map<string, T>
  loading: boolean
  error: Error | null
  refresh: () => void
}

function isMissingStateViewError(error: any, viewName: string) {
  const code = String(error?.code || '')
  const message = String(error?.message || '').toLowerCase()
  const details = String(error?.details || '').toLowerCase()
  const hint = String(error?.hint || '').toLowerCase()
  const name = viewName.toLowerCase()

  return code === 'PGRST205'
    || ((message.includes(name) || details.includes(name) || hint.includes(name))
      && (
        message.includes('could not find')
        || message.includes('does not exist')
        || details.includes('does not exist')
        || hint.includes('schema cache')
      ))
}

function useCompanyOrderState<T extends { id: string }>(
  viewName: string,
  companyId?: string | null,
): StateHookResult<T> {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true

    ;(async () => {
      if (!companyId) {
        setRows([])
        setError(null)
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const { data, error: loadError } = await supabase
          .from(viewName)
          .select('*')
          .eq('company_id', companyId)

        if (loadError) {
          if (isMissingStateViewError(loadError, viewName)) {
            console.warn(`[OrderState] ${viewName} is not available yet; falling back to legacy page logic.`, loadError)
            if (active) {
              setRows([])
              setError(null)
            }
            return
          }
          throw loadError
        }
        if (active) setRows((data || []) as T[])
      } catch (caught: any) {
        if (!active) return
        setRows([])
        setError(caught instanceof Error ? caught : new Error(String(caught?.message || caught)))
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [companyId, refreshKey, viewName])

  return {
    rows,
    byId: useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]),
    loading,
    error,
    refresh: () => setRefreshKey((value) => value + 1),
  }
}

export function useSalesOrderState(companyId?: string | null) {
  return useCompanyOrderState<SalesOrderStateRow>(SALES_ORDER_STATE_VIEW, companyId)
}

export function usePurchaseOrderState(companyId?: string | null) {
  return useCompanyOrderState<PurchaseOrderStateRow>(PURCHASE_ORDER_STATE_VIEW, companyId)
}
