import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/db'
import {
  SALES_INVOICE_STATE_VIEW,
  VENDOR_BILL_STATE_VIEW,
  isMissingFinanceViewError,
  type SalesInvoiceStateRow,
  type VendorBillStateRow,
} from '../lib/financeDocuments'

type StateHookResult<T extends { id: string }> = {
  rows: T[]
  byId: Map<string, T>
  loading: boolean
  error: Error | null
  missingView: boolean
  refresh: () => void
}

function useCompanyFinanceState<T extends { id: string }>(
  viewName: string,
  companyId?: string | null,
): StateHookResult<T> {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [missingView, setMissingView] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true

    ;(async () => {
      if (!companyId) {
        setRows([])
        setError(null)
        setMissingView(false)
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)
        setMissingView(false)

        const { data, error: loadError } = await supabase
          .from(viewName)
          .select('*')
          .eq('company_id', companyId)

        if (loadError) {
          if (isMissingFinanceViewError(loadError, viewName)) {
            console.warn(`[FinanceDocuments] ${viewName} is not available yet.`, loadError)
            if (active) {
              setRows([])
              setMissingView(true)
              setError(null)
            }
            return
          }
          throw loadError
        }

        if (active) {
          setRows((data || []) as T[])
          setMissingView(false)
        }
      } catch (caught: any) {
        if (!active) return
        setRows([])
        setMissingView(false)
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
    missingView,
    refresh: () => setRefreshKey((value) => value + 1),
  }
}

export function useSalesInvoices(companyId?: string | null) {
  return useCompanyFinanceState<SalesInvoiceStateRow>(SALES_INVOICE_STATE_VIEW, companyId)
}

export function useVendorBills(companyId?: string | null) {
  return useCompanyFinanceState<VendorBillStateRow>(VENDOR_BILL_STATE_VIEW, companyId)
}
