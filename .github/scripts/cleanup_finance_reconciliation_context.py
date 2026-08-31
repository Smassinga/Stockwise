from pathlib import Path

files = [
    Path('src/pages/SalesInvoiceDetail.tsx'),
    Path('src/pages/VendorBillDetail.tsx'),
]

review_tone = """function reviewTone(status?: FinanceReviewState | null) {
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

"""

context_import = """import {
  financeReviewToneClass,
  loadFinanceReconciliationContext,
} from '../lib/financeReconciliationContext'
"""

for path in files:
    text = path.read_text(encoding='utf-8')
    anchor = "} from '../lib/financeReconciliation'\n"
    if text.count(anchor) != 1:
        raise SystemExit(f'Expected one financeReconciliation import anchor in {path}')
    if context_import not in text:
        text = text.replace(anchor, anchor + context_import)
    if text.count(review_tone) != 1:
        raise SystemExit(f'Expected one duplicated reviewTone helper in {path}')
    text = text.replace(review_tone, '')
    text = text.replace('reviewTone(', 'financeReviewToneClass(')
    text = text.replace('  FINANCE_RECONCILIATION_EXCEPTIONS_VIEW,\n', '')
    text = text.replace('  FINANCE_RECONCILIATION_VIEW,\n', '')
    path.write_text(text, encoding='utf-8')

sales = files[0]
sales_text = sales.read_text(encoding='utf-8')
sales_old = """      try {
        const [reviewRes, exceptionRes] = await Promise.all([
          supabase
            .from(FINANCE_RECONCILIATION_VIEW)
            .select('*')
            .eq('company_id', companyId)
            .eq('anchor_id', invoiceId)
            .maybeSingle(),
          supabase
            .from(FINANCE_RECONCILIATION_EXCEPTIONS_VIEW)
            .select('*')
            .eq('company_id', companyId)
            .eq('anchor_id', invoiceId)
            .order('severity', { ascending: false })
            .order('document_date', { ascending: true }),
        ])

        if (!reviewRes.error) {
          nextReconciliationRow = (reviewRes.data || null) as FinanceReconciliationRow | null
        } else {
          reportRuntimeError('loadReconciliationRow', reviewRes.error)
        }

        if (!exceptionRes.error) {
          nextReconciliationExceptions = (exceptionRes.data || []) as FinanceReconciliationExceptionRow[]
        } else {
          reportRuntimeError('loadReconciliationExceptions', exceptionRes.error)
        }
      } catch (error) {
        reportRuntimeError('loadReconciliationContext', error, {
          documentWorkflowStatus: nextInvoice?.document_workflow_status,
        })
      }
"""
sales_new = """      try {
        const reconciliationContext = await loadFinanceReconciliationContext(companyId, invoiceId)
        nextReconciliationRow = reconciliationContext.row
        nextReconciliationExceptions = reconciliationContext.exceptions
        if (reconciliationContext.rowError) {
          reportRuntimeError('loadReconciliationRow', reconciliationContext.rowError)
        }
        if (reconciliationContext.exceptionsError) {
          reportRuntimeError('loadReconciliationExceptions', reconciliationContext.exceptionsError)
        }
      } catch (error) {
        reportRuntimeError('loadReconciliationContext', error, {
          documentWorkflowStatus: nextInvoice?.document_workflow_status,
        })
      }
"""
if sales_text.count(sales_old) != 1:
    raise SystemExit('Expected one SalesInvoice reconciliation query block')
sales.write_text(sales_text.replace(sales_old, sales_new), encoding='utf-8')

vendor = files[1]
vendor_text = vendor.read_text(encoding='utf-8')
vendor_old = """      try {
        const [reviewRes, exceptionRes] = await Promise.all([
          supabase
            .from(FINANCE_RECONCILIATION_VIEW)
            .select('*')
            .eq('company_id', companyId)
            .eq('anchor_id', billId)
            .maybeSingle(),
          supabase
            .from(FINANCE_RECONCILIATION_EXCEPTIONS_VIEW)
            .select('*')
            .eq('company_id', companyId)
            .eq('anchor_id', billId)
            .order('severity', { ascending: false })
            .order('document_date', { ascending: true }),
        ])

        if (!reviewRes.error) {
          nextReconciliationRow = (reviewRes.data || null) as FinanceReconciliationRow | null
        } else {
          console.warn('[finance-reconciliation] VendorBillDetail review fallback', reviewRes.error)
        }

        if (!exceptionRes.error) {
          nextReconciliationExceptions = (exceptionRes.data || []) as FinanceReconciliationExceptionRow[]
        } else {
          console.warn('[finance-reconciliation] VendorBillDetail exceptions fallback', exceptionRes.error)
        }
      } catch (reconciliationError) {
        console.warn('[finance-reconciliation] VendorBillDetail context fallback', reconciliationError)
      }
"""
vendor_new = """      try {
        const reconciliationContext = await loadFinanceReconciliationContext(companyId, billId)
        nextReconciliationRow = reconciliationContext.row
        nextReconciliationExceptions = reconciliationContext.exceptions
        if (reconciliationContext.rowError) {
          console.warn('[finance-reconciliation] VendorBillDetail review fallback', reconciliationContext.rowError)
        }
        if (reconciliationContext.exceptionsError) {
          console.warn('[finance-reconciliation] VendorBillDetail exceptions fallback', reconciliationContext.exceptionsError)
        }
      } catch (reconciliationError) {
        console.warn('[finance-reconciliation] VendorBillDetail context fallback', reconciliationError)
      }
"""
if vendor_text.count(vendor_old) != 1:
    raise SystemExit('Expected one VendorBill reconciliation query block')
vendor.write_text(vendor_text.replace(vendor_old, vendor_new), encoding='utf-8')
