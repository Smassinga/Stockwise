import type { PremiumTone } from '../components/premium/PremiumStatusBadge'
import type {
  FinanceDocumentApprovalStatus,
  FinanceDocumentSettlementStatus,
  SalesInvoiceResolutionStatus,
  SalesInvoiceWorkflowStatus,
  VendorBillResolutionStatus,
  VendorBillWorkflowStatus,
} from './financeDocuments'

export type CommercialStatusPresentation = {
  labelKey: string
  fallback: string
  tone: PremiumTone
}
export type CommercialLifecycleItem = CommercialStatusPresentation & {
  id: string
  eyebrowKey: string
  eyebrowFallback: string
  descriptionKey?: string
  descriptionFallback?: string
}

export type FxReadiness = 'base' | 'loading' | 'loaded' | 'manual' | 'unavailable' | 'invalid'

export type FxReadinessState = {
  status: FxReadiness
  rate: string
  sourceDate?: string | null
}

export function isValidFxRate(value: string | number | null | undefined) {
  const rate = Number(value)
  return Number.isFinite(rate) && rate > 0
}

export function fxCanCreate(
  currencyCode: string,
  baseCurrencyCode: string,
  state: FxReadinessState,
) {
  if (currencyCode === baseCurrencyCode) return true
  return (state.status === 'loaded' || state.status === 'manual') && isValidFxRate(state.rate)
}

export function salesInvoiceWorkflowPresentation(
  status: SalesInvoiceWorkflowStatus,
): CommercialStatusPresentation {
  switch (status) {
    case 'issued':
      return { labelKey: 'financeDocs.workflow.issued', fallback: 'Issued', tone: 'positive' }
    case 'voided':
      return { labelKey: 'financeDocs.workflow.voided', fallback: 'Voided', tone: 'critical' }
    case 'draft':
      return { labelKey: 'financeDocs.workflow.draft', fallback: 'Draft', tone: 'neutral' }
    default:
      return { labelKey: 'commercial.statusUnavailable', fallback: 'Status unavailable', tone: 'warning' }
  }
}

export function vendorBillWorkflowPresentation(
  status: VendorBillWorkflowStatus,
): CommercialStatusPresentation {
  switch (status) {
    case 'posted':
      return { labelKey: 'financeDocs.workflow.posted', fallback: 'Posted', tone: 'positive' }
    case 'voided':
      return { labelKey: 'financeDocs.workflow.voided', fallback: 'Voided', tone: 'critical' }
    case 'draft':
      return { labelKey: 'financeDocs.workflow.draft', fallback: 'Draft', tone: 'neutral' }
    default:
      return { labelKey: 'commercial.statusUnavailable', fallback: 'Status unavailable', tone: 'warning' }
  }
}

export function approvalPresentation(
  status: FinanceDocumentApprovalStatus,
): CommercialStatusPresentation {
  switch (status) {
    case 'approved':
      return { labelKey: 'financeDocs.approval.approved', fallback: 'Approved', tone: 'positive' }
    case 'pending_approval':
      return { labelKey: 'financeDocs.approval.pendingApproval', fallback: 'Pending approval', tone: 'warning' }
    case 'draft':
      return { labelKey: 'financeDocs.approval.draft', fallback: 'Draft preparation', tone: 'neutral' }
    default:
      return { labelKey: 'commercial.statusUnavailable', fallback: 'Status unavailable', tone: 'warning' }
  }
}

export function settlementPresentation(
  status: FinanceDocumentSettlementStatus,
): CommercialStatusPresentation {
  switch (status) {
    case 'settled':
      return { labelKey: 'settlements.status.settled', fallback: 'Settled', tone: 'positive' }
    case 'partially_settled':
      return { labelKey: 'settlements.status.partiallySettled', fallback: 'Partially settled', tone: 'warning' }
    case 'overdue':
      return { labelKey: 'settlements.status.overdue', fallback: 'Overdue', tone: 'critical' }
    case 'unsettled':
      return { labelKey: 'settlements.status.unsettled', fallback: 'Unsettled', tone: 'neutral' }
    default:
      return { labelKey: 'commercial.statusUnavailable', fallback: 'Status unavailable', tone: 'warning' }
  }
}

export function salesInvoiceResolutionPresentation(
  status: SalesInvoiceResolutionStatus,
): CommercialStatusPresentation {
  switch (status) {
    case 'draft':
      return { labelKey: 'financeDocs.resolution.draft', fallback: 'Draft', tone: 'neutral' }
    case 'voided':
      return { labelKey: 'financeDocs.resolution.voided', fallback: 'Voided', tone: 'critical' }
    case 'issued_open':
      return { labelKey: 'financeDocs.resolution.issuedOpen', fallback: 'Issued and open', tone: 'neutral' }
    case 'issued_overdue':
      return { labelKey: 'financeDocs.resolution.issuedOverdue', fallback: 'Issued and overdue', tone: 'critical' }
    case 'issued_partially_settled':
      return { labelKey: 'financeDocs.resolution.issuedPartiallySettled', fallback: 'Issued and partially settled', tone: 'warning' }
    case 'issued_settled':
      return { labelKey: 'financeDocs.resolution.issuedSettled', fallback: 'Issued and settled', tone: 'positive' }
    case 'issued_partially_credited':
      return { labelKey: 'financeDocs.resolution.issuedPartiallyCredited', fallback: 'Issued and partially credited', tone: 'warning' }
    case 'issued_fully_credited':
      return { labelKey: 'financeDocs.resolution.issuedFullyCredited', fallback: 'Issued and fully credited', tone: 'positive' }
    default:
      return { labelKey: 'commercial.statusUnavailable', fallback: 'Status unavailable', tone: 'warning' }
  }
}

export function vendorBillResolutionPresentation(
  status: VendorBillResolutionStatus,
): CommercialStatusPresentation {
  switch (status) {
    case 'draft':
      return { labelKey: 'financeDocs.resolution.draft', fallback: 'Draft', tone: 'neutral' }
    case 'voided':
      return { labelKey: 'financeDocs.resolution.voided', fallback: 'Voided', tone: 'critical' }
    case 'posted_open':
      return { labelKey: 'financeDocs.resolution.postedOpen', fallback: 'Posted and open', tone: 'neutral' }
    case 'posted_overdue':
      return { labelKey: 'financeDocs.resolution.postedOverdue', fallback: 'Posted and overdue', tone: 'critical' }
    case 'posted_partially_settled':
      return { labelKey: 'financeDocs.resolution.postedPartiallySettled', fallback: 'Posted and partially settled', tone: 'warning' }
    case 'posted_settled':
      return { labelKey: 'financeDocs.resolution.postedSettled', fallback: 'Posted and settled', tone: 'positive' }
    case 'posted_partially_credited':
      return { labelKey: 'financeDocs.resolution.postedPartiallyCredited', fallback: 'Posted and partially credited', tone: 'warning' }
    case 'posted_fully_credited':
      return { labelKey: 'financeDocs.resolution.postedFullyCredited', fallback: 'Posted and fully credited', tone: 'positive' }
    default:
      return { labelKey: 'commercial.statusUnavailable', fallback: 'Status unavailable', tone: 'warning' }
  }
}
