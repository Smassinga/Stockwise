import { Download, FileWarning, ReceiptText } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { PremiumStatePanel } from '../../components/premium/PremiumEmptyState'
import type { FinanceActivityRow } from '../../lib/financeActivity'
import type { FinanceWorkspaceSide } from './settlementModel'

type Translate = (key: string, fallback: string, vars?: Record<string, string | number>) => string
type ActivityMethod = 'all' | 'cash' | 'bank'

type SettlementActivityWorkspaceProps = {
  tt: Translate
  workspaceSide: FinanceWorkspaceSide
  activityLoading: boolean
  activityError: string | null
  filteredActivityRows: FinanceActivityRow[]
  activityTotal: number
  activityFrom: string
  activityTo: string
  activitySearch: string
  activityMethod: ActivityMethod
  money: (amount: number) => string
  activityAnchorKindLabel: (anchorKind: FinanceActivityRow['anchorKind']) => string
  onWorkspaceSideChange: (side: FinanceWorkspaceSide) => void
  onActivitySearchChange: (value: string) => void
  onActivityFromChange: (value: string) => void
  onActivityToChange: (value: string) => void
  onActivityMethodChange: (value: ActivityMethod) => void
  onExportActivity: () => void
  onExportAdvice: (row: FinanceActivityRow) => void
  onViewAnchor: (row: FinanceActivityRow) => void
}

export function SettlementActivityWorkspace({
  tt,
  workspaceSide,
  activityLoading,
  activityError,
  filteredActivityRows,
  activityTotal,
  activityFrom,
  activityTo,
  activitySearch,
  activityMethod,
  money,
  activityAnchorKindLabel,
  onWorkspaceSideChange,
  onActivitySearchChange,
  onActivityFromChange,
  onActivityToChange,
  onActivityMethodChange,
  onExportActivity,
  onExportAdvice,
  onViewAnchor,
}: SettlementActivityWorkspaceProps) {
  return (
    <TabsContent value="activity" className="mt-0 space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tt('financeUx.activityRecords', 'Settlement records')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">
              {activityLoading ? tt('common.loading', 'Loading...') : activityError ? tt('common.unavailable', 'Unavailable') : filteredActivityRows.length}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {activityError
                ? tt('financeUx.activityUnavailableHelp', 'No zero or empty result has been inferred. Refresh the page or try a narrower date range.')
                : tt('financeUx.activityRecordsHelp', 'Posted receipts and payments remain available after exposure is resolved.')}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {workspaceSide === 'ar' ? tt('financeUx.received', 'Received') : tt('financeUx.paid', 'Paid')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">
              {activityLoading ? tt('common.loading', 'Loading...') : activityError ? tt('common.unavailable', 'Unavailable') : money(activityTotal)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {activityError
                ? tt('financeUx.activityUnavailableHelp', 'No zero or empty result has been inferred. Refresh the page or try a narrower date range.')
                : tt('financeUx.activityTotalHelp', 'Company-base value across the current filtered activity.')}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {tt('financeUx.defaultActivityRange', 'Default activity range')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold tracking-tight">{activityFrom} — {activityTo}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {tt('financeUx.defaultActivityRangeHelp', 'Activity starts with the last 30 days and can be narrowed explicitly.')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>{tt('financeUx.activityFilters', 'Activity filters')}</CardTitle>
          <CardDescription>
            {tt('financeUx.activityFiltersHelp', 'Filter posted evidence by ledger side, date, method, counterparty, or active anchor.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={workspaceSide} onValueChange={(value) => onWorkspaceSideChange(value as FinanceWorkspaceSide)}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1 sm:w-auto">
              <TabsTrigger value="ar" className="rounded-lg sm:min-w-[180px]">{tt('financeUx.receivables', 'Accounts receivable')}</TabsTrigger>
              <TabsTrigger value="ap" className="rounded-lg sm:min-w-[180px]">{tt('financeUx.payables', 'Accounts payable')}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="xl:col-span-2">
              <Label>{tt('common.search', 'Search')}</Label>
              <Input
                value={activitySearch}
                onChange={(event) => onActivitySearchChange(event.target.value)}
                placeholder={tt('financeUx.activitySearch', 'Counterparty, anchor, memo, bank, or operational reference')}
              />
            </div>
            <div>
              <Label>{tt('filters.from', 'From')}</Label>
              <Input type="date" value={activityFrom} onChange={(event) => onActivityFromChange(event.target.value)} />
            </div>
            <div>
              <Label>{tt('filters.to', 'To')}</Label>
              <Input type="date" value={activityTo} onChange={(event) => onActivityToChange(event.target.value)} />
            </div>
            <div>
              <Label>{tt('financeUx.method', 'Method')}</Label>
              <Select value={activityMethod} onValueChange={(value) => onActivityMethodChange(value as ActivityMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{tt('common.all', 'All')}</SelectItem>
                  <SelectItem value="cash">{tt('financeUx.cashBook', 'Cash Book')}</SelectItem>
                  <SelectItem value="bank">{tt('financeUx.bank', 'Bank')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onExportActivity} disabled={activityLoading || Boolean(activityError)}>
              <Download className="h-4 w-4" />
              {tt('financeUx.exportActivity', 'Export current settlement activity')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>{tt('financeUx.activityRegister', 'Settlement Activity')}</CardTitle>
          <CardDescription>
            {tt('financeUx.activityRegisterHelp', 'Review which cash or bank transaction produced each posted receipt or payment, including resolved documents.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activityError ? (
            <PremiumStatePanel
              kind="error"
              icon={<FileWarning />}
              title={tt('financeUx.activityUnavailable', 'Settlement activity evidence is unavailable.')}
              description={tt('financeUx.activityUnavailableHelp', 'No zero or empty result has been inferred. Refresh the page or try a narrower date range.')}
            />
          ) : activityLoading ? (
            <PremiumStatePanel
              kind="neutral"
              icon={<ReceiptText />}
              title={tt('financeUx.activityLoading', 'Loading settlement activity...')}
            />
          ) : filteredActivityRows.length === 0 ? (
            <PremiumStatePanel
              kind="empty"
              icon={<ReceiptText />}
              title={tt('financeUx.activityEmpty', 'No settlement activity matches the current filters.')}
              description={tt('financeUx.activityEmptyHelp', 'This is a successful empty result for the selected date range and ledger side.')}
            />
          ) : (
            <>
              <div className="space-y-3 lg:hidden">
                {filteredActivityRows.map((row) => (
                  <article key={`${row.channel}:${row.id}`} className="rounded-[calc(var(--radius)+0.15rem)] border border-card-border bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{row.counterpartyName || tt('financeUx.unresolvedCounterparty', 'Unresolved counterparty')}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{row.anchorReference || tt('financeUx.unresolvedReference', 'Unresolved reference')}</p>
                      </div>
                      <Badge variant="outline">{row.ledgerSide}</Badge>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="premium-label">{tt('table.date', 'Date')}</dt>
                        <dd className="mt-1">{row.happenedAt}</dd>
                      </div>
                      <div>
                        <dt className="premium-label">{tt('financeUx.method', 'Method')}</dt>
                        <dd className="mt-1">{row.channel === 'bank' ? row.bankName || tt('financeUx.bank', 'Bank') : tt('financeUx.cashBook', 'Cash Book')}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="premium-label">{tt('financeUx.amountBase', 'Amount in company base currency')}</dt>
                        <dd className="mt-1 font-mono text-base font-semibold tabular-nums">{money(row.amountBase)}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                      {row.anchorKind ? (
                        <Button variant="outline" size="sm" onClick={() => onViewAnchor(row)}>
                          {tt('financeUx.viewAnchor', 'View anchor')}
                        </Button>
                      ) : null}
                      <Button size="sm" onClick={() => onExportAdvice(row)} disabled={row.unresolvedReference || !row.counterpartyName}>
                        {row.ledgerSide === 'AP'
                          ? tt('financeUx.remittanceAdvice', 'Remittance Advice')
                          : tt('financeUx.receiptAdvice', 'Receipt Allocation Advice')}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto rounded-2xl border border-border/70 lg:block">
                <table className="w-full min-w-[1180px] text-sm" aria-label={tt('financeUx.activityRegister', 'Settlement Activity')}>
                  <thead className="bg-muted/30 text-left">
                    <tr>
                      <th className="px-4 py-3">{tt('table.date', 'Date')}</th>
                      <th className="px-4 py-3">{tt('financeUx.method', 'Method')}</th>
                      <th className="px-4 py-3">{tt('settlements.counterparty', 'Counterparty')}</th>
                      <th className="px-4 py-3">{tt('financeUx.activeAnchor', 'Active financial anchor')}</th>
                      <th className="px-4 py-3">{tt('financeUx.operationalReference', 'Operational reference')}</th>
                      <th className="px-4 py-3">{tt('cash.memo', 'Memo')}</th>
                      <th className="px-4 py-3 text-right">{tt('financeUx.amountBase', 'Amount in company base currency')}</th>
                      <th className="px-4 py-3">{tt('financeUx.reconciliation', 'Reconciliation')}</th>
                      <th className="px-4 py-3 text-right">{tt('orders.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActivityRows.map((row) => (
                      <tr key={`${row.channel}:${row.id}`} className="border-t border-border/60 align-top">
                        <td className="px-4 py-3 whitespace-nowrap">{row.happenedAt}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.channel === 'bank' ? row.bankName || tt('financeUx.bank', 'Bank') : tt('financeUx.cashBook', 'Cash Book')}</div>
                          {row.channel === 'bank' && row.maskedAccountNumber ? <div className="mt-1 text-xs text-muted-foreground">{row.maskedAccountNumber}</div> : null}
                        </td>
                        <td className="px-4 py-3">{row.counterpartyName || tt('financeUx.unresolvedCounterparty', 'Unresolved counterparty')}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.anchorReference || tt('financeUx.unresolvedReference', 'Unresolved reference')}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{activityAnchorKindLabel(row.anchorKind)}</div>
                        </td>
                        <td className="px-4 py-3">{row.operationalReference || '—'}</td>
                        <td className="max-w-[260px] px-4 py-3 text-muted-foreground">{row.memo || '—'}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">{money(row.amountBase)}</td>
                        <td className="px-4 py-3">
                          {row.reconciled == null
                            ? tt('financeUx.cashTrace', 'Cash trace')
                            : row.reconciled
                              ? tt('financeUx.reconciled', 'Reconciled')
                              : tt('financeUx.unreconciled', 'Unreconciled')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {row.anchorKind ? (
                              <Button variant="outline" size="sm" onClick={() => onViewAnchor(row)}>
                                {tt('financeUx.viewAnchor', 'View anchor')}
                              </Button>
                            ) : null}
                            <Button size="sm" onClick={() => onExportAdvice(row)} disabled={row.unresolvedReference || !row.counterpartyName}>
                              {row.ledgerSide === 'AP'
                                ? tt('financeUx.remittanceShort', 'Remittance')
                                : tt('financeUx.receiptAdviceShort', 'Receipt advice')}
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
