import { Download } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import type { FinanceReconciliationExceptionRow, FinanceReconciliationRow, FinanceReviewState } from '../../lib/financeReconciliation'
import { exceptionSeverityTone, n, reviewTone, type FinanceWorkspaceSide } from './settlementModel'

type Translate = (key: string, fallback: string, vars?: Record<string, string | number>) => string
type ReviewDueFilter = 'all' | 'overdue' | 'due_soon' | 'current' | 'resolved' | 'undated'
type ReviewStateFilter = 'all' | FinanceReviewState
type ReviewTotals = {
  original: number
  netAdjustments: number
  currentLegal: number
  settled: number
  outstanding: number
  overSettled: number
  exceptionCount: number
  overdueCount: number
  reviewCount: number
}
type ReviewStateCounts = {
  exception: number
  overdue: number
  attention: number
  open: number
  resolved: number
}

type SettlementReconciliationWorkspaceProps = {
  tt: Translate
  loading: boolean
  reconciliationViewsUnavailable: boolean
  workspaceSide: FinanceWorkspaceSide
  reviewSide: FinanceReconciliationRow['ledger_side']
  filteredReviewRows: FinanceReconciliationRow[]
  filteredReviewExceptions: FinanceReconciliationExceptionRow[]
  reviewTotals: ReviewTotals
  reviewStateCounts: ReviewStateCounts
  reviewSearch: string
  reviewPartyFilter: string
  reviewCurrencyFilter: string
  reviewDueFilter: ReviewDueFilter
  reviewStateFilter: ReviewStateFilter
  reviewFromDate: string
  reviewToDate: string
  reviewPartyOptions: string[]
  reviewCurrencyOptions: string[]
  money: (amount: number) => string
  duePositionLabel: (position?: FinanceReconciliationRow['due_position'] | null) => string
  agingBucketLabel: (bucket?: FinanceReconciliationRow['aging_bucket'] | null) => string
  reviewStateLabel: (state?: FinanceReviewState | null) => string
  exceptionLabel: (code?: string | null) => string
  exceptionGroupLabel: (group?: FinanceReconciliationExceptionRow['exception_group'] | null) => string
  resolutionContextLabel: (row: FinanceReconciliationRow) => string
  setReviewSearch: (value: string) => void
  setReviewPartyFilter: (value: string) => void
  setReviewCurrencyFilter: (value: string) => void
  setReviewDueFilter: (value: ReviewDueFilter) => void
  setReviewStateFilter: (value: ReviewStateFilter) => void
  setReviewFromDate: (value: string) => void
  setReviewToDate: (value: string) => void
  onWorkspaceSideChange: (side: FinanceWorkspaceSide) => void
  onExportReconciliation: () => void
  onViewAnchor: (anchorKind: FinanceReconciliationRow['anchor_kind'], anchorId: string) => void
}

export function SettlementReconciliationWorkspace({
  tt,
  loading,
  reconciliationViewsUnavailable,
  workspaceSide,
  reviewSide,
  filteredReviewRows,
  filteredReviewExceptions,
  reviewTotals,
  reviewStateCounts,
  reviewSearch,
  reviewPartyFilter,
  reviewCurrencyFilter,
  reviewDueFilter,
  reviewStateFilter,
  reviewFromDate,
  reviewToDate,
  reviewPartyOptions,
  reviewCurrencyOptions,
  money,
  duePositionLabel,
  agingBucketLabel,
  reviewStateLabel,
  exceptionLabel,
  exceptionGroupLabel,
  resolutionContextLabel,
  setReviewSearch,
  setReviewPartyFilter,
  setReviewCurrencyFilter,
  setReviewDueFilter,
  setReviewStateFilter,
  setReviewFromDate,
  setReviewToDate,
  onWorkspaceSideChange,
  onExportReconciliation,
  onViewAnchor,
}: SettlementReconciliationWorkspaceProps) {
  const updateWorkspaceQuery = ({ side }: { side: FinanceWorkspaceSide }) => onWorkspaceSideChange(side)
  const setExportRequest = (_request: { kind: 'reconciliation' }) => onExportReconciliation()
  const viewReconciliationAnchor = onViewAnchor

  return (
        <TabsContent value="reconciliation" className="mt-0 space-y-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <Card className="border-border/80 shadow-sm xl:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('financeDocs.reconciliation.reviewTitle', 'Review register')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{filteredReviewRows.length}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {tt('financeDocs.reconciliation.reviewHelp', 'Review the active AR/AP anchors using current legal value, settlement, due position, and exception signals from the DB-backed reconciliation model.')}
                </p>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{money(reviewTotals.currentLegal)}</div>
                <p className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.currentLegalHelp', 'Original minus credits plus debits across the filtered review set.')}</p>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{money(reviewTotals.outstanding)}</div>
                <p className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.outstandingHelp', 'Outstanding is based on current legal value after adjustments and actual settlement only.')}</p>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('financeDocs.reconciliation.overdueCount', 'Overdue')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{reviewTotals.overdueCount}</div>
                <p className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.overdueHelp', 'Overdue state is bucketed from the legal outstanding balance, not the gross original document value.')}</p>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{tt('financeDocs.reconciliation.exceptionQueue', 'Exception queue')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tracking-tight">{filteredReviewExceptions.length}</div>
                <p className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.exceptionHelp', 'Critical and warning exceptions surface broken bridges, anchor-chain defects, and issue/post blockers that need controller review.')}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle>{tt('financeDocs.reconciliation.filters', 'Review filters')}</CardTitle>
              <CardDescription className="hidden sm:block">{tt('financeDocs.reconciliation.filtersHelp', 'Switch between AR and AP, then filter by counterparty, due position, review state, currency, or document date without leaving the active company.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={reviewSide} onValueChange={(value) => updateWorkspaceQuery({ side: value === 'AR' ? 'ar' : 'ap' })}>
                <TabsList className="h-auto w-full justify-start gap-1 rounded-xl bg-muted/70 p-1 md:w-auto">
                  <TabsTrigger value="AR" className="min-w-[180px] rounded-lg">{tt('financeDocs.reconciliation.arTitle', 'Accounts receivable')}</TabsTrigger>
                  <TabsTrigger value="AP" className="min-w-[180px] rounded-lg">{tt('financeDocs.reconciliation.apTitle', 'Accounts payable')}</TabsTrigger>
                </TabsList>
                <TabsContent value={reviewSide} className="mt-4 space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                    <div className="xl:col-span-2">
                      <Label>{tt('common.search', 'Search')}</Label>
                      <Input value={reviewSearch} onChange={(event) => setReviewSearch(event.target.value)} placeholder={tt('financeDocs.reconciliation.searchPlaceholder', 'Reference, counterparty, due state, review state, or exception')} />
                    </div>
                    <div>
                      <Label>{tt('settlements.counterparty', 'Counterparty')}</Label>
                      <Select value={reviewPartyFilter} onValueChange={setReviewPartyFilter}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                          {reviewPartyOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('orders.currency', 'Currency')}</Label>
                      <Select value={reviewCurrencyFilter} onValueChange={setReviewCurrencyFilter}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                          {reviewCurrencyOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('settlements.dueState', 'Due state')}</Label>
                      <Select value={reviewDueFilter} onValueChange={(value) => setReviewDueFilter(value as typeof reviewDueFilter)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                          <SelectItem value="overdue">{tt('financeDocs.reconciliation.due.overdue', 'Overdue')}</SelectItem>
                          <SelectItem value="due_soon">{tt('financeDocs.reconciliation.due.dueSoon', 'Due soon')}</SelectItem>
                          <SelectItem value="current">{tt('financeDocs.reconciliation.due.current', 'Current')}</SelectItem>
                          <SelectItem value="resolved">{tt('financeDocs.reconciliation.due.resolved', 'Resolved')}</SelectItem>
                          <SelectItem value="undated">{tt('financeDocs.reconciliation.due.undated', 'No due date')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('financeDocs.reconciliation.reviewState', 'Review state')}</Label>
                      <Select value={reviewStateFilter} onValueChange={(value) => setReviewStateFilter(value as typeof reviewStateFilter)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                          <SelectItem value="exception">{reviewStateLabel('exception')}</SelectItem>
                          <SelectItem value="overdue">{reviewStateLabel('overdue')}</SelectItem>
                          <SelectItem value="attention">{reviewStateLabel('attention')}</SelectItem>
                          <SelectItem value="open">{reviewStateLabel('open')}</SelectItem>
                          <SelectItem value="resolved">{reviewStateLabel('resolved')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <Label>{tt('filters.from', 'From')}</Label>
                      <Input type="date" value={reviewFromDate} onChange={(event) => setReviewFromDate(event.target.value)} />
                    </div>
                    <div>
                      <Label>{tt('filters.to', 'To')}</Label>
                      <Input type="date" value={reviewToDate} onChange={(event) => setReviewToDate(event.target.value)} />
                    </div>
                    <div className="xl:col-span-2 flex flex-wrap items-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setReviewSearch('')
                          setReviewPartyFilter('ALL')
                          setReviewCurrencyFilter('ALL')
                          setReviewDueFilter('all')
                          setReviewStateFilter('all')
                          setReviewFromDate('')
                          setReviewToDate('')
                        }}
                      >
                        {tt('common.clear', 'Clear')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setExportRequest({ kind: 'reconciliation' })}
                        disabled={loading || reconciliationViewsUnavailable}
                      >
                        <Download className="h-4 w-4" />
                        {workspaceSide === 'ar'
                          ? tt('financeUx.exportArReconciliation', 'Export current AR reconciliation')
                          : tt('financeUx.exportApReconciliation', 'Export current AP reconciliation')}
                      </Button>
                      <div className="flex flex-wrap gap-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone('exception')}`}>{reviewStateLabel('exception')}: {reviewStateCounts.exception}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone('overdue')}`}>{reviewStateLabel('overdue')}: {reviewStateCounts.overdue}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone('attention')}`}>{reviewStateLabel('attention')}: {reviewStateCounts.attention}</span>
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone('resolved')}`}>{reviewStateLabel('resolved')}: {reviewStateCounts.resolved}</span>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {reconciliationViewsUnavailable ? (
            <Card className="border-status-warning-border bg-status-warning-muted text-status-warning-foreground shadow-none">
              <CardContent className="pt-6 text-sm">
                {tt('financeDocs.reconciliation.viewsUnavailable', 'Reconciliation evidence is unavailable. No zero or all-clear result has been inferred. Refresh the page or contact support if the problem continues.')}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-border/80 shadow-sm">
                <CardHeader>
                  <CardTitle>{tt('financeDocs.reconciliation.exceptionQueue', 'Exception queue')}</CardTitle>
                  <CardDescription className="hidden sm:block">{tt('financeDocs.reconciliation.exceptionQueueHelp', 'Flag records that need controller attention because the bridge, anchor chain, or issue/post readiness is inconsistent with finance expectations.')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
                  ) : filteredReviewExceptions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tt('financeDocs.reconciliation.exceptionQueueEmpty', 'No reconciliation exceptions match the current review filters.')}</p>
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {filteredReviewExceptions.map((row) => (
                        <button
                          key={`${row.anchor_id}:${row.exception_code}`}
                          type="button"
                          onClick={() => viewReconciliationAnchor(row.anchor_kind, row.anchor_id)}
                          className="rounded-xl border border-border/70 bg-background p-4 text-left hover:border-primary/30"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-semibold tracking-tight">{row.anchor_reference}</div>
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${exceptionSeverityTone(row.severity)}`}>
                              {row.severity === 'critical' ? tt('financeDocs.reconciliation.severityCritical', 'Critical') : tt('financeDocs.reconciliation.severityWarning', 'Warning')}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {row.counterparty_name || tt('common.none', 'None')}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <span className="inline-flex rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-muted-foreground">
                              {exceptionGroupLabel(row.exception_group)}
                            </span>
                            <span className="inline-flex rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-muted-foreground">
                              {row.ledger_side}
                            </span>
                          </div>
                          <div className="mt-3 text-sm font-medium">{exceptionLabel(row.exception_code)}</div>
                          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                            <div>{tt('table.date', 'Date')}: {row.document_date || tt('common.dash', '-')}</div>
                            <div>{tt('orders.dueDate', 'Due Date')}: {row.due_date || tt('common.dash', '-')}</div>
                            <div>{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}: <span className="font-mono tabular-nums">{money(n(row.current_legal_total_base))}</span></div>
                            <div>{tt('settlements.outstandingAmount', 'Outstanding')}: <span className="font-mono tabular-nums">{money(n(row.outstanding_base))}</span></div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-sm">
                <CardHeader>
                  <CardTitle>{tt('financeDocs.reconciliation.registerTitle', 'Reconciliation register')}</CardTitle>
                  <CardDescription className="hidden sm:block">{tt('financeDocs.reconciliation.registerHelp', 'Scan every active finance anchor with original value, net adjustments, current legal amount, settlement, outstanding balance, due logic, and controller review state in one register.')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-muted/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]">
                    <div className="grid gap-3 xl:grid-cols-6">
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.original)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.adjustmentsAmount', 'Adjustments')}</div>
                        <div className={`mt-2 font-mono text-lg font-semibold tabular-nums ${reviewTotals.netAdjustments < 0 ? 'text-status-danger-foreground' : reviewTotals.netAdjustments > 0 ? 'text-status-info-foreground' : ''}`}>{money(reviewTotals.netAdjustments)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.52)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.currentLegal)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.settledAmount', 'Settled')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.settled)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/95 p-4 shadow-[0_18px_48px_-32px_rgba(0,0,0,0.52)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</div>
                        <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{money(reviewTotals.outstanding)}</div>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_16px_40px_-30px_rgba(0,0,0,0.45)]">
                        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('financeDocs.reconciliation.needsReview', 'Needs review')}</div>
                        <div className="mt-2 text-lg font-semibold tracking-tight">{reviewTotals.reviewCount}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{tt('financeDocs.reconciliation.overSettled', 'Over-settled total')}: <span className="font-mono tabular-nums">{money(reviewTotals.overSettled)}</span></div>
                      </div>
                    </div>
                  </div>

                  {loading ? (
                    <p className="text-sm text-muted-foreground">{tt('loading', 'Loading')}</p>
                  ) : filteredReviewRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{tt('financeDocs.reconciliation.registerEmpty', 'No reconciliation rows match the current review filters.')}</p>
                  ) : (
                    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/95 shadow-[0_24px_70px_-48px_rgba(0,0,0,0.48)]">
                      <table className="w-full min-w-[1640px] text-sm">
                        <thead className="bg-muted/30">
                          <tr className="border-b border-border/60 text-left">
                            <th className="px-4 py-3">{tt('table.ref', 'Reference')}</th>
                            <th className="px-4 py-3">{tt('settlements.counterparty', 'Counterparty')}</th>
                            <th className="px-4 py-3">{tt('table.date', 'Date')}</th>
                            <th className="px-4 py-3">{tt('orders.dueDate', 'Due Date')}</th>
                            <th className="px-4 py-3 text-right">{tt('settlements.originalAmount', 'Original')}</th>
                            <th className="px-4 py-3 text-right">{tt('financeDocs.reconciliation.netAdjustment', 'Net adjustments')}</th>
                            <th className="px-4 py-3 text-right">{tt('financeDocs.reconciliation.currentLegal', 'Current legal')}</th>
                            <th className="px-4 py-3 text-right">{tt('settlements.settledAmount', 'Settled')}</th>
                            <th className="px-4 py-3 text-right">{tt('settlements.outstandingAmount', 'Outstanding')}</th>
                            <th className="px-4 py-3">{tt('settlements.dueState', 'Due state')}</th>
                            <th className="px-4 py-3">{tt('settlements.aging', 'Aging')}</th>
                            <th className="px-4 py-3">{tt('financeDocs.reconciliation.resolutionContext', 'Resolution context')}</th>
                            <th className="px-4 py-3">{tt('financeDocs.reconciliation.reviewState', 'Review state')}</th>
                            <th className="px-4 py-3 text-right">{tt('orders.actions', 'Actions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredReviewRows.map((row) => (
                            <tr key={`${row.ledger_side}:${row.anchor_id}`} className="border-b border-border/50 align-top transition-colors duration-200 hover:bg-muted/20">
                              <td className="px-4 py-4">
                                <div className="font-medium">{row.anchor_reference}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {row.operational_reference
                                    ? tt('financeDocs.reconciliation.anchorBridge', 'Operational {operational} -> Finance {anchor}', {
                                      operational: row.operational_reference,
                                      anchor: row.anchor_reference,
                                    })
                                    : tt('financeDocs.reconciliation.anchorOnly', 'Finance anchor only')}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-medium">{row.counterparty_name || tt('common.none', 'None')}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{row.ledger_side}</div>
                              </td>
                              <td className="px-4 py-4 whitespace-nowrap">{row.document_date || tt('common.dash', '-')}</td>
                              <td className="px-4 py-4 whitespace-nowrap">{row.due_date || tt('common.dash', '-')}</td>
                              <td className="px-4 py-4 text-right font-mono tabular-nums">{money(n(row.original_total_base))}</td>
                              <td className={`px-4 py-4 text-right font-mono tabular-nums ${n(row.net_adjustment_base) < 0 ? 'text-status-danger-foreground' : n(row.net_adjustment_base) > 0 ? 'text-status-info-foreground' : ''}`}>{money(n(row.net_adjustment_base))}</td>
                              <td className="px-4 py-4 text-right font-mono tabular-nums font-semibold">{money(n(row.current_legal_total_base))}</td>
                              <td className="px-4 py-4 text-right font-mono tabular-nums">{money(n(row.settled_base))}</td>
                              <td className="px-4 py-4 text-right">
                                <div className="font-mono tabular-nums font-semibold">{money(n(row.outstanding_base))}</div>
                                {n(row.over_settled_base) > 0.005 ? (
                                  <div className="mt-1 text-xs text-status-danger-foreground">
                                    {tt('financeDocs.reconciliation.overSettledShort', 'Over-settled')}: <span className="font-mono tabular-nums">{money(n(row.over_settled_base))}</span>
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-medium">{duePositionLabel(row.due_position)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {row.days_past_due > 0
                                    ? tt('financeDocs.reconciliation.daysPastDue', '{count} days past due', { count: row.days_past_due })
                                    : row.days_until_due != null
                                      ? tt('financeDocs.reconciliation.daysUntilDue', '{count} days until due', { count: row.days_until_due })
                                      : tt('common.dash', '-')}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-medium">{agingBucketLabel(row.aging_bucket)}</div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="font-medium">{resolutionContextLabel(row)}</div>
                                <div className="mt-1 text-xs text-muted-foreground">{reviewStateLabel(row.review_state)}</div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="flex flex-wrap gap-2">
                                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${reviewTone(row.review_state)}`}>
                                    {reviewStateLabel(row.review_state)}
                                  </span>
                                  {row.exception_count > 0 ? (
                                    <span className="inline-flex rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                      {tt('financeDocs.reconciliation.exceptionCount', '{count} exceptions', { count: row.exception_count })}
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <Button size="sm" variant="outline" onClick={() => viewReconciliationAnchor(row.anchor_kind, row.anchor_id)}>
                                  {tt('financeDocs.viewDocument', 'View')}
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

  )
}
