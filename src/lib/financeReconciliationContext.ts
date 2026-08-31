import { supabase } from './supabase'
import {
  FINANCE_RECONCILIATION_EXCEPTIONS_VIEW,
  FINANCE_RECONCILIATION_VIEW,
  type FinanceReconciliationExceptionRow,
  type FinanceReconciliationRow,
  type FinanceReviewState,
} from './financeReconciliation'

export type FinanceReconciliationContext = {
  row: FinanceReconciliationRow | null
  exceptions: FinanceReconciliationExceptionRow[]
  rowError: unknown | null
  exceptionsError: unknown | null
}

export async function loadFinanceReconciliationContext(
  companyId: string,
  anchorId: string,
): Promise<FinanceReconciliationContext> {
  const [reviewRes, exceptionRes] = await Promise.all([
    supabase
      .from(FINANCE_RECONCILIATION_VIEW)
      .select('*')
      .eq('company_id', companyId)
      .eq('anchor_id', anchorId)
      .maybeSingle(),
    supabase
      .from(FINANCE_RECONCILIATION_EXCEPTIONS_VIEW)
      .select('*')
      .eq('company_id', companyId)
      .eq('anchor_id', anchorId)
      .order('severity', { ascending: false })
      .order('document_date', { ascending: true }),
  ])

  return {
    row: reviewRes.error
      ? null
      : ((reviewRes.data || null) as FinanceReconciliationRow | null),
    exceptions: exceptionRes.error
      ? []
      : ((exceptionRes.data || []) as FinanceReconciliationExceptionRow[]),
    rowError: reviewRes.error ?? null,
    exceptionsError: exceptionRes.error ?? null,
  }
}

export function financeReviewToneClass(status?: FinanceReviewState | null) {
  switch (status) {
    case 'exception':
      return 'border-status-danger-border bg-status-danger-muted text-status-danger-foreground'
    case 'overdue':
      return 'border-status-warning-border bg-status-warning-muted text-status-warning-foreground'
    case 'attention':
      return 'border-status-info-border bg-status-info-muted text-status-info-foreground'
    case 'resolved':
      return 'border-status-success-border bg-status-success-muted text-status-success-foreground'
    default:
      return 'border-border/70 bg-muted/30 text-muted-foreground'
  }
}
