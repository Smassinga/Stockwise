import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, FileCheck2, FileClock, Landmark, ReceiptText } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { PremiumDataTable, type PremiumDataTableColumn } from '../components/premium/PremiumDataTable'
import { PremiumEmptyState, PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumMetricCard } from '../components/premium/PremiumMetricCard'
import { PremiumMobileCardList } from '../components/premium/PremiumMobileCardList'
import { PremiumRegisterHeader } from '../components/premium/PremiumRegisterHeader'
import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'
import { PremiumTableToolbar } from '../components/premium/PremiumTableToolbar'
import { useOrg } from '../hooks/useOrg'
import { useVendorBills } from '../hooks/useFinanceDocuments'
import { type VendorBillStateRow } from '../lib/financeDocuments'
import { getBaseCurrencyCode } from '../lib/currency'
import {
  approvalPresentation,
  settlementPresentation,
  vendorBillResolutionPresentation,
  vendorBillWorkflowPresentation,
} from '../lib/commercialWorkflowPresentation'
import { useI18n, withI18nFallback } from '../lib/i18n'

const ALL_FILTER = 'all'

export default function VendorBillsPage() {
  const { companyId, companyName } = useOrg()
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { rows, loading, error, missingView } = useVendorBills(companyId)
  const [baseCode, setBaseCode] = useState('MZN')
  const [search, setSearch] = useState('')
  const [workflowFilter, setWorkflowFilter] = useState(ALL_FILTER)
  const [approvalFilter, setApprovalFilter] = useState(ALL_FILTER)

  useEffect(() => {
    if (!companyId) {
      setBaseCode('MZN')
      return
    }
    let active = true
    void getBaseCurrencyCode(companyId)
      .then((code) => {
        if (active && code) setBaseCode(code)
      })
      .catch(() => {
        if (active) setBaseCode('MZN')
      })
    return () => {
      active = false
    }
  }, [companyId])

  const formatDocumentMoney = (amount: number, code: string) =>
    new Intl.NumberFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
      style: 'currency',
      currency: code || baseCode || 'MZN',
    }).format(amount || 0)

  const formatBaseMoney = (amount: number) =>
    new Intl.NumberFormat(lang === 'pt' ? 'pt-MZ' : 'en-MZ', {
      style: 'currency',
      currency: baseCode || 'MZN',
    }).format(amount || 0)

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return [...rows]
      .sort((left, right) =>
        `${right.bill_date} ${right.primary_reference}`.localeCompare(`${left.bill_date} ${left.primary_reference}`),
      )
      .filter((row) => {
        if (workflowFilter !== ALL_FILTER && row.document_workflow_status !== workflowFilter) return false
        if (approvalFilter !== ALL_FILTER && row.approval_status !== approvalFilter) return false
        if (!needle) return true
        return [
          row.internal_reference,
          row.supplier_invoice_reference,
          row.counterparty_name,
          row.order_no,
          row.document_workflow_status,
          row.resolution_status,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      })
  }, [approvalFilter, rows, search, workflowFilter])

  const metrics = useMemo(() => ({
    drafts: rows.filter((row) => row.document_workflow_status === 'draft').length,
    awaitingApproval: rows.filter((row) => row.approval_status === 'pending_approval').length,
    posted: rows.filter((row) => row.document_workflow_status === 'posted').length,
    outstanding: rows.reduce((sum, row) => sum + Number(row.outstanding_base || 0), 0),
  }), [rows])

  const columns = useMemo<PremiumDataTableColumn<VendorBillStateRow>[]>(() => [
    {
      id: 'reference',
      header: tt('financeDocs.fields.supplierInvoiceReference', 'Supplier invoice reference'),
      minWidth: 220,
      sortValue: (row) => row.primary_reference,
      cell: (row) => (
        <div>
          <div className="font-semibold">{row.primary_reference}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {tt('financeDocs.fields.internalReferenceValue', 'Internal {reference}', { reference: row.internal_reference })}
          </div>
          {row.duplicate_supplier_reference_exists ? (
            <PremiumStatusBadge tone="warning" icon={<AlertTriangle />} className="mt-2">
              {tt('financeDocs.vendorBills.duplicateWarning', 'Duplicate supplier reference detected')}
            </PremiumStatusBadge>
          ) : null}
        </div>
      ),
    },
    {
      id: 'supplier',
      header: tt('financeDocs.fields.supplier', 'Supplier'),
      minWidth: 170,
      sortValue: (row) => row.counterparty_name || '',
      cell: (row) => (
        <div>
          <div>{row.counterparty_name || tt('common.none', 'None')}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.order_no
              ? tt('financeDocs.fields.linkedOrderValue', 'Order {orderNo}', { orderNo: row.order_no })
              : tt('financeDocs.fields.noLinkedOrder', 'No linked order')}
          </div>
        </div>
      ),
    },
    {
      id: 'dates',
      header: tt('commercial.register.dates', 'Dates'),
      minWidth: 155,
      sortValue: (row) => row.supplier_invoice_date || row.bill_date,
      cell: (row) => (
        <div className="text-sm">
          <div>{row.supplier_invoice_date || row.bill_date}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {tt('financeDocs.fields.dueDate', 'Due date')}: {row.due_date}
          </div>
        </div>
      ),
    },
    {
      id: 'state',
      header: tt('commercial.register.lifecycle', 'Lifecycle'),
      minWidth: 230,
      cell: (row) => {
        const workflow = vendorBillWorkflowPresentation(row.document_workflow_status)
        const approval = approvalPresentation(row.approval_status)
        const settlement = settlementPresentation(row.settlement_status)
        const resolution = vendorBillResolutionPresentation(row.resolution_status)
        return (
          <div className="space-y-2">
            <PremiumStatusBadge tone={workflow.tone}>{tt(workflow.labelKey, workflow.fallback)}</PremiumStatusBadge>
            <div className="flex flex-wrap gap-1.5">
              <PremiumStatusBadge tone={approval.tone}>{tt(approval.labelKey, approval.fallback)}</PremiumStatusBadge>
              <PremiumStatusBadge tone={settlement.tone}>{tt(settlement.labelKey, settlement.fallback)}</PremiumStatusBadge>
            </div>
            <div className="text-xs text-muted-foreground">
              {tt(resolution.labelKey, resolution.fallback)}
            </div>
          </div>
        )
      },
    },
    {
      id: 'amount',
      header: tt('commercial.register.amounts', 'Amounts'),
      align: 'right',
      minWidth: 180,
      sortValue: (row) => row.current_legal_total_base,
      cell: (row) => (
        <div className="space-y-1 font-mono tabular-nums">
          <div>{formatDocumentMoney(row.total_amount, row.currency_code)}</div>
          <div className="text-xs text-muted-foreground">
            {tt('financeDocs.currentLegalAmount', 'Current legal')}: {formatBaseMoney(row.current_legal_total_base)}
          </div>
          <div className="text-xs font-semibold">
            {tt('settlements.outstandingAmount', 'Outstanding')}: {formatBaseMoney(row.outstanding_base)}
          </div>
        </div>
      ),
    },
    {
      id: 'action',
      header: tt('commercial.register.nextAction', 'Next action'),
      align: 'right',
      minWidth: 150,
      enableHiding: false,
      cell: (row) => (
        <Button asChild size="sm" variant={row.document_workflow_status === 'draft' ? 'default' : 'outline'}>
          <Link to={`/vendor-bills/${row.id}`}>
            {row.document_workflow_status === 'draft'
              ? row.approval_status === 'approved'
                ? tt('commercial.actions.reviewPost', 'Review posting readiness')
                : tt('commercial.actions.continueDraft', 'Continue draft')
              : tt('commercial.actions.reviewDocument', 'Review document')}
          </Link>
        </Button>
      ),
    },
  ], [baseCode, lang, t])

  const emptyState = (
    <PremiumEmptyState
      icon={<ReceiptText />}
      title={search || workflowFilter !== ALL_FILTER || approvalFilter !== ALL_FILTER
        ? tt('commercial.register.filteredEmpty', 'No documents match these filters.')
        : tt('financeDocs.vendorBills.emptyTitle', 'No vendor bills yet.')}
      description={tt(
        'financeDocs.vendorBills.emptyBody',
        'Create and approve a Purchase Order, create its Vendor Bill, complete the supplier reference, then approve and post it.',
      )}
      action={
        <Button asChild variant="outline">
          <Link to="/orders?tab=purchase&view=register">{tt('financeDocs.vendorBills.ordersLink', 'View purchase orders')}</Link>
        </Button>
      }
    />
  )

  return (
    <div className="space-y-6">
      <PremiumRegisterHeader
        eyebrow={tt('financeDocs.eyebrow', 'Finance documents')}
        title={tt('financeDocs.vendorBills.title', 'Vendor Bills')}
        description={tt(
          'financeDocs.vendorBills.subtitle',
          'Purchase Orders remain operational. Posted Vendor Bills are the AP financial document and active payment anchor.',
        )}
        badges={
          <>
            <PremiumStatusBadge tone="info">{companyName || tt('orders.activeCompanyUnavailable', 'Active company unavailable')}</PremiumStatusBadge>
            <PremiumStatusBadge tone="neutral">{baseCode}</PremiumStatusBadge>
          </>
        }
        actions={
          <>
            <Button asChild>
              <Link to="/orders?tab=purchase&view=register">{tt('financeDocs.vendorBills.ordersLink', 'View purchase orders')}</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/settlements">{tt('financeDocs.vendorBills.settlementsLink', 'Settlement workspace')}</Link>
            </Button>
          </>
        }
        metrics={
          <>
            <PremiumMetricCard label={tt('commercial.metrics.drafts', 'Drafts')} value={metrics.drafts} icon={<FileClock />} />
            <PremiumMetricCard label={tt('commercial.metrics.awaitingApproval', 'Awaiting approval')} value={metrics.awaitingApproval} tone="warning" icon={<FileClock />} />
            <PremiumMetricCard label={tt('commercial.metrics.postedBills', 'Posted bills')} value={metrics.posted} tone="positive" icon={<FileCheck2 />} />
            <PremiumMetricCard label={tt('settlements.outstandingAmount', 'Outstanding')} value={formatBaseMoney(metrics.outstanding)} icon={<Landmark />} />
          </>
        }
      />

      {missingView ? (
        <PremiumStatePanel
          kind="error"
          icon={<AlertTriangle />}
          title={tt('financeDocs.stateViewFailureTitle', 'Finance document state is unavailable')}
          description={tt('financeDocs.stateViewFailureBody', 'StockWise could not load the governed finance-document read model. Retry after the deployment is verified.')}
        />
      ) : error ? (
        <PremiumStatePanel
          kind="error"
          icon={<AlertTriangle />}
          title={tt('financeDocs.vendorBills.loadFailed', 'Failed to load vendor bills')}
          description={tt('commercial.register.retainedNoData', 'No financial amounts are shown because the canonical read failed.')}
        />
      ) : (
        <>
          <PremiumTableToolbar
            searchValue={search}
            onSearchChange={setSearch}
            searchLabel={tt('common.search', 'Search')}
            searchPlaceholder={tt('financeDocs.vendorBills.searchPlaceholder', 'Search supplier invoice, internal reference, supplier, or order')}
            filters={
              <>
                <Select value={workflowFilter} onValueChange={setWorkflowFilter}>
                  <SelectTrigger aria-label={tt('financeDocs.fields.workflow', 'Workflow')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER}>{tt('commercial.filters.allWorkflow', 'All workflow states')}</SelectItem>
                    <SelectItem value="draft">{tt('financeDocs.workflow.draft', 'Draft')}</SelectItem>
                    <SelectItem value="posted">{tt('financeDocs.workflow.posted', 'Posted')}</SelectItem>
                    <SelectItem value="voided">{tt('financeDocs.workflow.voided', 'Voided')}</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={approvalFilter} onValueChange={setApprovalFilter}>
                  <SelectTrigger aria-label={tt('financeDocs.fields.approval', 'Approval')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FILTER}>{tt('commercial.filters.allApproval', 'All approval states')}</SelectItem>
                    <SelectItem value="draft">{tt('financeDocs.approval.draft', 'Draft preparation')}</SelectItem>
                    <SelectItem value="pending_approval">{tt('financeDocs.approval.pendingApproval', 'Pending approval')}</SelectItem>
                    <SelectItem value="approved">{tt('financeDocs.approval.approved', 'Approved')}</SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
            summary={tt('commercial.register.results', '{count} documents shown', { count: filteredRows.length })}
          />

          <div className="hidden md:block">
            <PremiumDataTable
              rows={filteredRows}
              columns={columns}
              getRowId={(row) => row.id}
              loading={loading}
              emptyState={emptyState}
              ariaLabel={tt('financeDocs.vendorBills.listTitle', 'AP register')}
            />
          </div>
          <div className="md:hidden">
            <PremiumMobileCardList
              rows={filteredRows}
              getRowId={(row) => row.id}
              loading={loading}
              emptyState={emptyState}
              renderCard={(row) => {
                const workflow = vendorBillWorkflowPresentation(row.document_workflow_status)
                const settlement = settlementPresentation(row.settlement_status)
                return (
                  <article className="rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold">{row.primary_reference}</h2>
                        <p className="mt-1 truncate text-sm text-muted-foreground">{row.counterparty_name || tt('common.none', 'None')}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{row.internal_reference}</p>
                      </div>
                      <PremiumStatusBadge tone={workflow.tone}>{tt(workflow.labelKey, workflow.fallback)}</PremiumStatusBadge>
                    </div>
                    {row.duplicate_supplier_reference_exists ? (
                      <PremiumStatusBadge tone="warning" icon={<AlertTriangle />} className="mt-3">
                        {tt('financeDocs.vendorBills.duplicateWarning', 'Duplicate supplier reference detected')}
                      </PremiumStatusBadge>
                    ) : null}
                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div><div className="premium-label">{tt('financeDocs.fields.total', 'Total')}</div><div className="mt-1 font-mono">{formatDocumentMoney(row.total_amount, row.currency_code)}</div></div>
                      <div className="text-right"><div className="premium-label">{tt('settlements.outstandingAmount', 'Outstanding')}</div><div className="mt-1 font-mono">{formatBaseMoney(row.outstanding_base)}</div></div>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <PremiumStatusBadge tone={settlement.tone}>{tt(settlement.labelKey, settlement.fallback)}</PremiumStatusBadge>
                      <Button asChild size="sm">
                        <Link to={`/vendor-bills/${row.id}`}>{tt('commercial.actions.reviewDocument', 'Review document')}</Link>
                      </Button>
                    </div>
                  </article>
                )
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
