import { Badge } from '../ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import {
  financeAgingBucketLabelKey,
  financeDuePositionLabelKey,
  financeExceptionGroupLabelKey,
  financeExceptionLabelKey,
  financeReviewStateLabelKey,
  type FinanceReconciliationExceptionRow,
  type FinanceReconciliationRow,
  type FinanceReviewState,
} from '../../lib/financeReconciliation'
import { financeReviewToneClass } from '../../lib/financeReconciliationContext'

type TranslateParams = Record<string, string | number>
type Translate = (key: string, fallback: string, params?: TranslateParams) => string

type FinanceReconciliationReviewCardProps = {
  row: FinanceReconciliationRow | null
  exceptions: FinanceReconciliationExceptionRow[]
  translate: Translate
  formatBaseMoney: (amount: number) => string
  description: string
  agingHelp: string
  needsReviewHelp: string
  resolvedReviewHelp: string
  emptyHelp: string
  className?: string
}

export default function FinanceReconciliationReviewCard({
  row,
  exceptions,
  translate,
  formatBaseMoney,
  description,
  agingHelp,
  needsReviewHelp,
  resolvedReviewHelp,
  emptyHelp,
  className,
}: FinanceReconciliationReviewCardProps) {
  if (!row && exceptions.length === 0) return null

  const duePositionLabel = (position?: FinanceReconciliationRow['due_position'] | null) => {
    switch (position) {
      case 'resolved':
        return translate(financeDuePositionLabelKey(position), 'Resolved')
      case 'undated':
        return translate(financeDuePositionLabelKey(position), 'No due date')
      case 'current':
        return translate(financeDuePositionLabelKey(position), 'Current')
      case 'due_soon':
        return translate(financeDuePositionLabelKey(position), 'Due soon')
      case 'due_today':
        return translate(financeDuePositionLabelKey(position), 'Due today')
      case 'overdue':
        return translate(financeDuePositionLabelKey(position), 'Overdue')
      default:
        return translate('common.dash', '-')
    }
  }

  const agingLabel = (bucket?: FinanceReconciliationRow['aging_bucket'] | null) => {
    switch (bucket) {
      case 'resolved':
        return translate(financeAgingBucketLabelKey(bucket), 'Resolved')
      case 'undated':
        return translate(financeAgingBucketLabelKey(bucket), 'No due date')
      case 'current':
        return translate(financeAgingBucketLabelKey(bucket), 'Current')
      case '1_30':
        return translate(financeAgingBucketLabelKey(bucket), '1-30 days overdue')
      case '31_60':
        return translate(financeAgingBucketLabelKey(bucket), '31-60 days overdue')
      case '61_90':
        return translate(financeAgingBucketLabelKey(bucket), '61-90 days overdue')
      case '91_plus':
        return translate(financeAgingBucketLabelKey(bucket), '91+ days overdue')
      default:
        return translate('common.dash', '-')
    }
  }

  const reviewLabel = (state?: FinanceReviewState | null) => {
    switch (state) {
      case 'exception':
        return translate(financeReviewStateLabelKey(state), 'Exception')
      case 'overdue':
        return translate(financeReviewStateLabelKey(state), 'Overdue')
      case 'attention':
        return translate(financeReviewStateLabelKey(state), 'Attention')
      case 'open':
        return translate(financeReviewStateLabelKey(state), 'Open')
      case 'resolved':
        return translate(financeReviewStateLabelKey(state), 'Resolved')
      default:
        return translate('common.dash', '-')
    }
  }

  const exceptionLabel = (code?: string | null) =>
    translate(financeExceptionLabelKey(code), 'Finance review exception')

  const exceptionGroupLabel = (group?: FinanceReconciliationExceptionRow['exception_group'] | null) => {
    switch (group) {
      case 'bridge':
        return translate(financeExceptionGroupLabelKey(group), 'Bridge')
      case 'chain':
        return translate(financeExceptionGroupLabelKey(group), 'Chain')
      case 'issue_readiness':
        return translate(financeExceptionGroupLabelKey(group), 'Issue readiness')
      default:
        return translate('common.dash', '-')
    }
  }

  return (
    <Card className={['border-border/80 shadow-sm', className].filter(Boolean).join(' ')}>
      <CardHeader>
        <CardTitle>{translate('financeDocs.reconciliation.detailTitle', 'Reconciliation review')}</CardTitle>
        <CardDescription className="hidden sm:block">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {row ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{duePositionLabel(row.due_position)}</Badge>
              <Badge variant="outline">{agingLabel(row.aging_bucket)}</Badge>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${financeReviewToneClass(row.review_state)}`}>
                {reviewLabel(row.review_state)}
              </span>
              {row.exception_count > 0 ? (
                <Badge variant="outline">
                  {translate('financeDocs.reconciliation.exceptionCount', '{count} exceptions', { count: row.exception_count })}
                </Badge>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <Card className="border-border/70 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {translate('settlements.dueState', 'Due state')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-medium">{duePositionLabel(row.due_position)}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.days_past_due > 0
                      ? translate('financeDocs.reconciliation.daysPastDue', '{count} days past due', { count: row.days_past_due })
                      : row.days_until_due != null
                        ? translate('financeDocs.reconciliation.daysUntilDue', '{count} days until due', { count: row.days_until_due })
                        : translate('common.dash', '-')}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {translate('settlements.aging', 'Aging')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-medium">{agingLabel(row.aging_bucket)}</div>
                  <div className="text-xs text-muted-foreground">{agingHelp}</div>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {translate('financeDocs.reconciliation.reviewState', 'Review state')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-medium">{reviewLabel(row.review_state)}</div>
                  <div className="text-xs text-muted-foreground">{row.needs_review ? needsReviewHelp : resolvedReviewHelp}</div>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {translate('financeDocs.reconciliation.currentLegal', 'Current legal')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-mono tabular-nums">{formatBaseMoney(Number(row.current_legal_total_base || 0))}</div>
                  <div className="text-xs text-muted-foreground">
                    {translate('financeDocs.reconciliation.currentLegalHelp', 'Original minus credits plus debits')}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-none">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {translate('settlements.outstandingAmount', 'Outstanding')}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="font-mono tabular-nums font-semibold">{formatBaseMoney(Number(row.outstanding_base || 0))}</div>
                  <div className="text-xs text-muted-foreground">
                    {translate('settlements.outstandingHelp', 'Current legal minus settled')}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">{emptyHelp}</div>
        )}

        {exceptions.length > 0 ? (
          <div className="space-y-3">
            {exceptions.map((exception) => (
              <div key={`${exception.anchor_id}:${exception.exception_code}`} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${exception.severity === 'critical' ? 'border-status-danger-border bg-status-danger-muted text-status-danger-foreground' : 'border-status-warning-border bg-status-warning-muted text-status-warning-foreground'}`}>
                    {exception.severity === 'critical'
                      ? translate('financeDocs.reconciliation.severityCritical', 'Critical')
                      : translate('financeDocs.reconciliation.severityWarning', 'Warning')}
                  </span>
                  <Badge variant="outline">{exceptionGroupLabel(exception.exception_group)}</Badge>
                </div>
                <div className="mt-2 font-medium">{exceptionLabel(exception.exception_code)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {translate('financeDocs.reconciliation.exceptionAmounts', 'Current legal {currentLegal} / Outstanding {outstanding}', {
                    currentLegal: formatBaseMoney(Number(exception.current_legal_total_base || 0)),
                    outstanding: formatBaseMoney(Number(exception.outstanding_base || 0)),
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
