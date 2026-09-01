import { Download } from 'lucide-react'
import { FinanceSummaryBand } from '../../components/finance/FinanceSummaryBand'
import { PremiumStatePanel } from '../../components/premium/PremiumEmptyState'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import type { SettlementKind } from '../../lib/orderFinance'
import { dueTone, isFinanceDocumentRow, statusTone, type CustomerReceiptCustomer, type CustomerUnappliedCredit, type FinanceWorkspaceSide, type SettlementRow } from './settlementModel'

type Translate = (key: string, fallback: string, vars?: Record<string, string | number>) => string
type DueFilter = 'all' | 'overdue' | 'due_soon' | 'current'
type ExposureTab = 'receive' | 'pay'
type BridgeTotals = {
  originalBase: number
  creditedBase: number
  debitedBase: number
  currentLegalBase: number
  settledBase: number
  outstandingBase: number
}

type SettlementExposureWorkspaceProps = {
  tt: Translate
  lang: string
  loading: boolean
  stateViewsUnavailable: boolean
  workspaceSide: FinanceWorkspaceSide
  rows: { receive: SettlementRow[]; pay: SettlementRow[] }
  receiveTotal: number
  payTotal: number
  overdueCount: number
  requestedExposureCustomer: CustomerReceiptCustomer | null
  requestedExposureOutstanding: number
  requestedExposureInvoiceOutstanding: number
  requestedExposureUnapplied: CustomerUnappliedCredit | null
  tab: ExposureTab
  search: string
  partyFilter: string
  statusFilter: string
  currencyFilter: string
  dueFilter: DueFilter
  fromDate: string
  toDate: string
  partyOptions: string[]
  currencyOptions: string[]
  currentRows: SettlementRow[]
  filteredRows: SettlementRow[]
  filteredBridgeTotals: BridgeTotals
  canManageSettlement: boolean
  money: (amount: number) => string
  settlementActionLabel: (kind: SettlementKind) => string
  viewAnchorLabel: (kind: SettlementKind) => string
  setSearch: (value: string) => void
  setPartyFilter: (value: string) => void
  setStatusFilter: (value: string) => void
  setCurrencyFilter: (value: string) => void
  setDueFilter: (value: DueFilter) => void
  setFromDate: (value: string) => void
  setToDate: (value: string) => void
  onWorkspaceSideChange: (side: FinanceWorkspaceSide) => void
  onExportExposure: () => void
  onOpenSettlement: (row: SettlementRow, tab: 'settle' | 'history') => void
  onViewOrder: (row: SettlementRow) => void
}

export function SettlementExposureWorkspace({
  tt,
  lang,
  loading,
  stateViewsUnavailable,
  workspaceSide,
  rows,
  receiveTotal,
  payTotal,
  overdueCount,
  requestedExposureCustomer,
  requestedExposureOutstanding,
  requestedExposureInvoiceOutstanding,
  requestedExposureUnapplied,
  tab,
  search,
  partyFilter,
  statusFilter,
  currencyFilter,
  dueFilter,
  fromDate,
  toDate,
  partyOptions,
  currencyOptions,
  currentRows,
  filteredRows,
  filteredBridgeTotals,
  canManageSettlement,
  money,
  settlementActionLabel,
  viewAnchorLabel,
  setSearch,
  setPartyFilter,
  setStatusFilter,
  setCurrencyFilter,
  setDueFilter,
  setFromDate,
  setToDate,
  onWorkspaceSideChange,
  onExportExposure,
  onOpenSettlement,
  onViewOrder,
}: SettlementExposureWorkspaceProps) {
  const updateWorkspaceQuery = ({ side }: { side: FinanceWorkspaceSide }) => onWorkspaceSideChange(side)
  const setExportRequest = (_request: { kind: 'exposure' }) => onExportExposure()
  const openSettlement = onOpenSettlement
  const viewOrder = onViewOrder

  return (
        <TabsContent value="exposure" className="mt-0 space-y-6">
      <FinanceSummaryBand
        label={tt('financeUx.exposureSummary', 'Exposure summary')}
        items={[
          {
            label: tt('settlements.pendingReceive', 'Pending to receive'),
            value: loading ? tt('common.loading', 'Loading...') : stateViewsUnavailable ? tt('common.unavailable', 'Unavailable') : money(receiveTotal),
            detail: stateViewsUnavailable ? tt('settlements.stateViewsUnavailable', 'Settlement evidence is unavailable. Refresh the page or contact support if the problem continues.') : tt('settlements.pendingReceiveHelp', '{count} receivable anchors are open across sales orders awaiting issue and issued sales invoices.', { count: rows.receive.length }),
          },
          {
            label: tt('settlements.pendingPay', 'Pending to pay'),
            value: loading ? tt('common.loading', 'Loading...') : stateViewsUnavailable ? tt('common.unavailable', 'Unavailable') : money(payTotal),
            detail: stateViewsUnavailable ? tt('settlements.stateViewsUnavailable', 'Settlement evidence is unavailable. Refresh the page or contact support if the problem continues.') : tt('settlements.pendingPayHelp', '{count} payable anchors are open across purchase orders awaiting booking and posted vendor bills.', { count: rows.pay.length }),
          },
          {
            label: tt('settlements.overdue', 'Overdue balances'),
            value: loading ? tt('common.loading', 'Loading...') : stateViewsUnavailable ? tt('common.unavailable', 'Unavailable') : overdueCount,
            detail: stateViewsUnavailable ? tt('settlements.stateViewsUnavailable', 'Settlement evidence is unavailable. Refresh the page or contact support if the problem continues.') : tt('settlements.overdueHelp', 'Overdue rows are ranked using the due date of the active settlement anchor, whether that anchor is still an order or already a finance document.'),
            tone: overdueCount > 0 && !loading && !stateViewsUnavailable ? 'warning' : 'neutral',
          },
        ]}
      />

      {requestedExposureCustomer ? (
        <section
          className="border-l-2 border-status-info-border bg-status-info-muted px-4 py-4"
          aria-labelledby="alert-receivables-context-title"
          data-testid="alert-receivables-context"
        >
          <h3 id="alert-receivables-context-title" className="font-semibold">
            {tt('customerReceipts.exposureForCustomer', 'Receivables for {customer}', { customer: requestedExposureCustomer.name })}
          </h3>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{tt('customerReceipts.totalOpenReceivables', 'Total open receivables')}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(requestedExposureOutstanding)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{tt('customerReceipts.allocatableInvoiceOutstanding', 'Allocatable issued-invoice outstanding')}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(requestedExposureInvoiceOutstanding)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{tt('customerReceipts.unappliedCreditContext', 'Unapplied credit (separate)')}</dt>
              <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(Number(requestedExposureUnapplied?.unapplied_credit_base || 0))}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted-foreground">
            {tt('customerReceipts.exposureAnchorHelp', 'The table below includes Sales Order and Sales Invoice anchors. Only issued Sales Invoices can receive allocations; unapplied credit is not silently netted.')}
          </p>
        </section>
      ) : null}

      <Card className="border-border/80 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle>{tt('settlements.filters', 'Filters')}</CardTitle>
          <CardDescription className="hidden sm:block">{tt('settlements.filtersHelp', 'Filter by counterparty, anchor type, workflow, anchor date, or due state without leaving the active company context.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(value) => updateWorkspaceQuery({ side: value === 'receive' ? 'ar' : 'ap' })}>
            <TabsList className="h-auto w-full justify-start gap-1 rounded-xl bg-muted/70 p-1 md:w-auto">
              <TabsTrigger value="receive" className="min-w-[180px] rounded-lg">{tt('settlements.pendingReceive', 'Pending to receive')}</TabsTrigger>
              <TabsTrigger value="pay" className="min-w-[180px] rounded-lg">{tt('settlements.pendingPay', 'Pending to pay')}</TabsTrigger>
            </TabsList>
            <TabsContent value={tab} className="mt-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <div className="xl:col-span-2">
                  <Label>{tt('common.search', 'Search')}</Label>
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tt('settlements.searchPlaceholder', 'Reference, counterparty, anchor type, or workflow status')} />
                </div>
                <div>
                  <Label>{tt('settlements.counterparty', 'Counterparty')}</Label>
                  <Select value={partyFilter} onValueChange={setPartyFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                      {partyOptions.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('settlements.workflowStatus', 'Order workflow')}</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                      {Array.from(new Map(currentRows.map(row => [row.workflowStatus, row.workflowLabel])).entries()).sort((left, right) => left[1].localeCompare(right[1])).map(([option, label]) => (
                        <SelectItem key={option} value={option}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('orders.currency', 'Currency')}</Label>
                  <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                      {currencyOptions.map(option => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('settlements.dueState', 'Due state')}</Label>
                  <Select value={dueFilter} onValueChange={(value) => setDueFilter(value as typeof dueFilter)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                      <SelectItem value="overdue">{tt('settlements.overdue', 'Overdue')}</SelectItem>
                      <SelectItem value="due_soon">{tt('settlements.dueSoon', 'Due soon')}</SelectItem>
                      <SelectItem value="current">{tt('settlements.current', 'Current')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div>
                  <Label>{tt('filters.from', 'From')}</Label>
                  <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                </div>
                <div>
                  <Label>{tt('filters.to', 'To')}</Label>
                  <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full sm:w-auto"
                    variant="outline"
                    onClick={() => {
                      setSearch('')
                      setPartyFilter('ALL')
                      setStatusFilter('ALL')
                      setCurrencyFilter('ALL')
                      setDueFilter('all')
                      setFromDate('')
                      setToDate('')
                    }}
                  >
                    {tt('common.clear', 'Clear')}
                  </Button>
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full sm:w-auto"
                    variant="outline"
                    onClick={() => setExportRequest({ kind: 'exposure' })}
                    disabled={loading || stateViewsUnavailable}
                  >
                    <Download className="h-4 w-4" />
                    {workspaceSide === 'ar'
                      ? tt('financeUx.exportArExposure', 'Export current AR exposure')
                      : tt('financeUx.exportApExposure', 'Export current AP exposure')}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>{tab === 'receive' ? tt('settlements.pendingReceive', 'Pending to receive') : tt('settlements.pendingPay', 'Pending to pay')}</CardTitle>
          <CardDescription className="hidden sm:block">
            {tab === 'receive'
              ? tt('settlements.receiveHelp', 'Receivables appear here from approved sales orders before issue and from issued sales invoices after issue. Once issued, the invoice becomes the canonical settlement anchor.')
              : tt('settlements.payHelp', 'Payables appear here from approved purchase orders before booking and from posted vendor bills after booking. Once posted, the vendor bill becomes the canonical settlement anchor.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
          ) : stateViewsUnavailable ? (
            <PremiumStatePanel
              variant="error"
              title={tt('financeUx.exposureUnavailable', 'Settlement exposure unavailable')}
              description={tt('settlements.stateViewsUnavailable', 'Settlement evidence is unavailable. Refresh the page or contact support if the problem continues.')}
            />
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tt('settlements.empty', 'No settlement anchors match the current filters.')}</p>
          ) : (
            <>
              <div className="rounded-2xl border border-border/70 bg-muted/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-primary/75">
                      {tt('settlements.reconciliationTitle', 'Settlement bridge')}
                    </div>
                    <p className="mt-1 hidden max-w-3xl text-sm text-muted-foreground sm:block">
                      {tt('settlements.reconciliationHelp', 'Current legal equals original minus credits plus debits. Outstanding equals current legal minus actual cash and bank settlement.')}
                    </p>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tt('settlements.filteredAnchorsCount', '{count} active anchors in the current view', { count: filteredRows.length })}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-5">
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.originalBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.originalAmountHelp', 'Issued or posted starting amount before adjustments and settlements')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.adjustmentsAmount', 'Adjustments')}</div>
                    <div className="mt-2 space-y-1 text-sm">
                      <div className="flex items-center justify-between gap-3 text-status-danger-foreground">
                        <span>{tt('settlements.creditedAmount', 'Credited')}</span>
                        <span className="font-mono font-semibold tabular-nums">{money(filteredBridgeTotals.creditedBase)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-status-info-foreground">
                        <span>{tt('settlements.debitedAmount', 'Debited')}</span>
                        <span className="font-mono font-semibold tabular-nums">{money(filteredBridgeTotals.debitedBase)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.52)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.currentLegalAmount', 'Current legal')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.currentLegalBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.currentLegalHelp', 'Original minus credits plus debits')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.settledBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.settledAmountHelp', 'Actual cash and bank settlement only')}</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.52)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</div>
                    <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(filteredBridgeTotals.outstandingBase)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.outstandingHelp', 'Current legal minus settled')}</div>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/95 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.48)]">
                <table className="w-full min-w-[1480px] text-sm">
                  <thead className="bg-muted/30">
                    <tr className="border-b border-border/60 text-left">
                      <th className="px-4 py-3">{tt('table.ref', 'Reference')}</th>
                      <th className="px-4 py-3">{tt('settlements.counterparty', 'Counterparty')}</th>
                      <th className="px-4 py-3">{tt('table.date', 'Date')}</th>
                      <th className="px-4 py-3">{tt('orders.dueDate', 'Due Date')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.originalAmount', 'Original')}</th>
                      <th className="px-4 py-3">{tt('settlements.adjustmentsAmount', 'Adjustments')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.currentLegalAmount', 'Current legal')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.settledAmount', 'Settled')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.outstandingAmount', 'Outstanding')}</th>
                      <th className="px-4 py-3">{tt('settlements.balanceStatus', 'Balance status')}</th>
                      <th className="px-4 py-3 text-right">{tt('settlements.aging', 'Aging')}</th>
                      <th className="px-4 py-3 text-right">{tt('orders.actions', 'Actions')}</th>
                    </tr>
                  </thead>
              <tbody>
                {filteredRows.map(row => (
                  <tr key={`${row.kind}:${row.id}`} className="border-b border-border/50 align-top transition-colors duration-200 hover:bg-muted/20">
                    <td className="px-4 py-4 [&>div:last-child]:hidden">
                      <div className="font-medium">{row.reference}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{`${row.sourceLabel} / ${row.workflowLabel || row.kind}`}</div>
                      <div className="mt-2 inline-flex rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        {isFinanceDocumentRow(row)
                          ? tt('settlements.financeAnchor', 'Finance anchor')
                          : tt('settlements.orderStageAnchor', 'Order-stage anchor')}
                      </div>
                      <div className="text-xs text-muted-foreground">{`${row.sourceLabel} · ${row.workflowLabel || row.kind}`}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-foreground">{row.counterparty}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">{row.documentDate || tt('common.dash', '-')}</td>
                    <td className={`px-4 py-4 whitespace-nowrap ${dueTone(row)}`}>
                      {row.dueDate || tt('common.dash', '-')}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-mono tabular-nums">{row.originalAmount.toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {row.currency}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{money(row.originalBase)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="min-w-[180px] rounded-2xl border border-border/60 bg-muted/20 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted-foreground">{tt('settlements.creditedAmount', 'Credited')}</span>
                          <span className="font-mono tabular-nums text-status-danger-foreground">{money(row.creditedBase)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted-foreground">{tt('settlements.debitedAmount', 'Debited')}</span>
                          <span className="font-mono tabular-nums text-status-info-foreground">{money(row.debitedBase)}</span>
                        </div>
                        <div className="mt-2 text-[11px] text-muted-foreground">
                          {isFinanceDocumentRow(row)
                            ? tt('settlements.adjustmentNote', 'Legal adjustments from linked notes stay separate from settlement.')
                            : tt('settlements.noAdjustments', 'No document adjustments are active on order-stage anchors.')}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-mono text-base font-semibold tabular-nums">{money(row.currentLegalBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.creditedBase > 0.005 || row.debitedBase > 0.005
                          ? tt('settlements.currentLegalHelp', 'Original minus credits plus debits')
                          : tt('settlements.currentLegalMatchesOriginal', 'Matches the original legal amount')}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-mono text-base tabular-nums">{money(row.settledBase)}</div>
                      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                        <div>{tt('settlements.cashShort', 'Cash')}: <span className="font-mono tabular-nums">{money(row.cashBase)}</span></div>
                        <div>{tt('settlements.bankShort', 'Bank')}: <span className="font-mono tabular-nums">{money(row.bankBase)}</span></div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-mono text-base font-semibold tabular-nums">{money(row.outstandingBase)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{tt('settlements.outstandingHelp', 'Current legal minus settled')}</div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(row)}`}>
                        {row.balanceLabel}
                      </span>
                    </td>
                    <td className={`px-4 py-4 text-right font-mono tabular-nums ${row.agingDays > 0 ? 'text-status-danger-foreground' : 'text-muted-foreground'}`}>
                      {row.agingDays > 0 ? `${row.agingDays}d` : tt('common.dash', '-')}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {canManageSettlement ? (
                          <Button size="sm" onClick={() => openSettlement(row, 'settle')}>
                            {settlementActionLabel(row.kind)}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="outline" className="transition-colors duration-200 hover:bg-muted" onClick={() => viewOrder(row)}>
                          {viewAnchorLabel(row.kind)}
                        </Button>
                        <Button size="sm" variant="outline" className="transition-colors duration-200 hover:bg-muted" onClick={() => openSettlement(row, 'history')}>
                          {tt('settlements.viewHistory', 'History')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>


  )
}
