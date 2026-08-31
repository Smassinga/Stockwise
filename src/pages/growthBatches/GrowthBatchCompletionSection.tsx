import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { TabsContent } from '../../components/ui/tabs'
import { PremiumEmptyState } from '../../components/premium/PremiumEmptyState'
import { PremiumStatusBadge } from '../../components/premium/PremiumStatusBadge'
import type { GrowthBatchCompletionCopy } from '../../lib/growthBatchCopy'
import type {
  GrowthBatchCompletionRow,
  GrowthBatchCurrentState,
  GrowthBatchRegisterRow,
} from '../../lib/growthBatchTypes'
import {
  compactDate,
  compactDateTime,
  money,
  qty,
  qtyWithUom,
} from './growthBatchPageSupport'
import { DetailSection, SummaryItem } from './GrowthBatchDetailPrimitives'

type GrowthBatchCompletionSectionProps = {
  batch: GrowthBatchCurrentState | GrowthBatchRegisterRow
  completions: GrowthBatchCompletionRow[]
  hasHistoryError: boolean
  canManage: boolean
  saving: boolean
  selectedCurrency: string | null
  completionCopy: GrowthBatchCompletionCopy
  fullyHarvestedLabel: string
  translate: (key: string, fallback: string) => string
  completionStatusLabel: (status: string) => string
  getCompletionUnavailableReason: () => string | null
  onOpenCompletion: () => void
  onOpenCompletionReversal: (completion: GrowthBatchCompletionRow) => void
}

export default function GrowthBatchCompletionSection({
  batch,
  completions,
  hasHistoryError,
  canManage,
  saving,
  selectedCurrency,
  completionCopy,
  fullyHarvestedLabel,
  translate,
  completionStatusLabel,
  getCompletionUnavailableReason,
  onOpenCompletion,
  onOpenCompletionReversal,
}: GrowthBatchCompletionSectionProps) {
  return (
    <TabsContent value="lifecycle">
      <DetailSection
        title={completionCopy.history.title}
        description={completionCopy.history.description}
        action={batch.status === 'active' && canManage ? (
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={onOpenCompletion}
            disabled={saving || Boolean(getCompletionUnavailableReason())}
            title={getCompletionUnavailableReason() || undefined}
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            {completionCopy.actions.completeBatch}
          </Button>
        ) : null}
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryItem label={completionCopy.labels.currentStatus} value={completionStatusLabel(batch.status)} />
          <SummaryItem
            label={completionCopy.labels.currentQuantity}
            value={`${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim()}
          />
          <SummaryItem
            label={completionCopy.labels.currentWeight}
            value={batch.latest_total_weight == null
              ? completionCopy.fallback.notRecorded
              : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)}
          />
          <SummaryItem label={completionCopy.labels.remainingCost} value={money(batch.remaining_cost, selectedCurrency)} />
          <SummaryItem label={completionCopy.labels.accumulatedCost} value={money(batch.accumulated_total_cost, selectedCurrency)} />
          <SummaryItem label={completionCopy.labels.harvestedCost} value={money(batch.harvested_cost, selectedCurrency)} />
          <SummaryItem label={completionCopy.labels.stockLedger} value={completionCopy.fallback.notAffected} />
          <SummaryItem label={completionCopy.labels.finance} value={completionCopy.fallback.notAffected} />
        </div>

        {batch.fully_harvested_awaiting_completion ? (
          <div className="mb-4 rounded-xl border border-status-success-border bg-status-success-muted p-4 text-sm">
            <div className="font-medium text-status-success-foreground">{fullyHarvestedLabel}</div>
            <div className="mt-1 text-muted-foreground">{completionCopy.dialog.lifecycleNote}</div>
          </div>
        ) : null}

        {batch.status === 'completed' ? (
          <div className="mb-4 rounded-xl border border-card-border bg-muted/20 p-4 text-sm">
            <div className="font-medium">{completionCopy.history.completionBadge}</div>
            <div className="mt-1 text-muted-foreground">
              {completionCopy.labels.completedAt}: {batch.completed_at ? compactDateTime(batch.completed_at) : completionCopy.fallback.notRecorded}
            </div>
          </div>
        ) : null}

        {hasHistoryError ? (
          <PremiumEmptyState
            icon={<AlertTriangle />}
            title={translate('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')}
            description={translate('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')}
            compact
          />
        ) : completions.length === 0 ? (
          <PremiumEmptyState
            icon={<CheckCircle2 />}
            title={completionCopy.history.emptyTitle}
            description={completionCopy.history.emptyDescription}
            compact
          />
        ) : (
          <div className="space-y-3">
            {completions.map((completion) => {
              const canReverseCompletion = canManage && completion.reversal_eligible
              return (
                <div key={completion.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <PremiumStatusBadge tone="neutral">{completionCopy.history.completionBadge}</PremiumStatusBadge>
                        {completion.reversed ? <Badge variant="outline">{completionCopy.history.reversedBadge}</Badge> : null}
                        {!completion.reversed && !completion.reversal_eligible ? (
                          <Badge variant="secondary">{completionCopy.history.lockedBadge}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 font-medium break-words">
                        {completion.event_reference} {completionCopy.history.by} {completion.actor_display_name || completionCopy.fallback.teamMember}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {completionCopy.history.sequencePrefix} {completion.event_sequence} / {compactDate(completion.event_effective_date)}
                      </div>
                    </div>
                    <div className="min-w-0 text-left text-sm font-semibold sm:text-right">
                      <div>{completionStatusLabel(completion.status_before)} {' -> '} {completionStatusLabel(completion.status_after)}</div>
                      <div className="text-xs font-normal text-muted-foreground">
                        {completion.completed_at ? compactDateTime(completion.completed_at) : completionCopy.fallback.notRecorded}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryItem label={completionCopy.labels.currentQuantity} value={qtyWithUom(completion.current_primary_qty, completion.primary_uom_code)} />
                    <SummaryItem
                      label={completionCopy.labels.currentWeight}
                      value={completion.current_total_weight == null
                        ? completionCopy.fallback.notRecorded
                        : qtyWithUom(completion.current_total_weight, completion.weight_uom_code)}
                    />
                    <SummaryItem label={completionCopy.labels.accumulatedCost} value={money(completion.accumulated_total_cost, selectedCurrency)} />
                    <SummaryItem label={completionCopy.labels.harvestedCost} value={money(completion.harvested_cost, selectedCurrency)} />
                    <SummaryItem label={completionCopy.labels.remainingCost} value={money(completion.remaining_cost, selectedCurrency)} />
                    <SummaryItem label={completionCopy.labels.stockLedger} value={completionCopy.fallback.notAffected} />
                    <SummaryItem label={completionCopy.labels.finance} value={completionCopy.fallback.notAffected} />
                    <SummaryItem label={completionCopy.labels.sellingPrice} value={completionCopy.fallback.unchanged} />
                  </div>

                  <div className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm">
                    <SummaryItem label={completionCopy.labels.reason} value={completion.completion_reason || completionCopy.fallback.notRecorded} />
                    {completion.notes ? <p className="mt-2 leading-6 text-muted-foreground">{completion.notes}</p> : null}
                  </div>

                  {completion.reversed ? (
                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {completionCopy.history.reversedBy} {completion.reversal_event_reference || completionCopy.history.reversalBadge} {completionCopy.history.onDate} {compactDate(completion.reversal_effective_date)}. {completion.reversal_reason || completionCopy.fallback.notRecorded}
                    </p>
                  ) : canReverseCompletion ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full sm:w-auto"
                        onClick={() => onOpenCompletionReversal(completion)}
                        disabled={saving}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        {completionCopy.actions.reverseCompletion}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {completionCopy.history.lockedReason}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </DetailSection>
    </TabsContent>
  )
}
