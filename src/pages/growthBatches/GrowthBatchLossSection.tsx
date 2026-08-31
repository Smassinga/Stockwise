import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { TabsContent } from '../../components/ui/tabs'
import { PremiumEmptyState } from '../../components/premium/PremiumEmptyState'
import { PremiumStatusBadge } from '../../components/premium/PremiumStatusBadge'
import type {
  GrowthBatchCurrentState,
  GrowthBatchLossRow,
  GrowthBatchRegisterRow,
} from '../../lib/growthBatchTypes'
import { compactDate, num, qty, qtyWithUom } from './growthBatchPageSupport'
import { DetailSection, SummaryItem } from './GrowthBatchDetailPrimitives'

type GrowthBatchLossSectionProps = {
  batch: GrowthBatchCurrentState | GrowthBatchRegisterRow
  losses: GrowthBatchLossRow[]
  hasHistoryError: boolean
  canOperate: boolean
  canManage: boolean
  saving: boolean
  translate: (key: string, fallback: string) => string
  domainLabel: (value: string) => string
  resolveUomCode: (uomId: string | null | undefined) => string | undefined
  onOpenLoss: () => void
  onOpenLossReversal: (loss: GrowthBatchLossRow) => void
}

export default function GrowthBatchLossSection({
  batch,
  losses,
  hasHistoryError,
  canOperate,
  canManage,
  saving,
  translate,
  domainLabel,
  resolveUomCode,
  onOpenLoss,
  onOpenLossReversal,
}: GrowthBatchLossSectionProps) {
  return (
    <TabsContent value="lifecycle">
      <DetailSection
        title={translate('productionUx.growth.lossHistory', 'Mortality and shrinkage')}
        description={translate(
          'productionUx.growth.lossHistoryHelp',
          'Loss events reduce the current batch quantity and/or latest total weight. They do not create stock movements, finance rows, or cost write-offs.',
        )}
        action={batch.status === 'active' && canOperate && num(batch.current_primary_qty ?? batch.opening_primary_qty) > 0 ? (
          <Button size="sm" onClick={onOpenLoss} disabled={saving}>
            <AlertTriangle className="mr-2 h-4 w-4" />
            {translate('productionUx.growth.actions.loss', 'Record loss')}
          </Button>
        ) : null}
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <SummaryItem
            label={translate('productionUx.growth.currentQuantity', 'Current quantity')}
            value={`${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim()}
          />
          <SummaryItem
            label={translate('productionUx.growth.latestWeight', 'Latest total weight')}
            value={batch.latest_total_weight == null
              ? translate('productionUx.common.notRecorded', 'Not recorded')
              : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)}
          />
          <SummaryItem
            label={translate('productionUx.growth.unreversedLosses', 'Unreversed losses')}
            value={batch.unreversed_loss_event_count ?? 0}
          />
        </div>

        {hasHistoryError ? (
          <PremiumEmptyState
            icon={<AlertTriangle />}
            title={translate('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')}
            description={translate('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')}
            compact
          />
        ) : losses.length === 0 ? (
          <PremiumEmptyState
            icon={<AlertTriangle />}
            title={translate('productionUx.growth.noLosses', 'No mortality or shrinkage yet')}
            description={translate('productionUx.growth.noLossesHelp', 'Record loss only for active batches when quantity or weight has actually reduced.')}
            compact
          />
        ) : (
          <div className="space-y-3">
            {losses.map((loss) => {
              const canReverseLoss = canManage && loss.reversal_status !== 'reversed'
              return (
                <div key={loss.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <PremiumStatusBadge tone="warning">{domainLabel(loss.loss_type)}</PremiumStatusBadge>
                        {loss.reversal_status === 'reversed' ? (
                          <Badge variant="outline">{translate('productionUx.status.reversed', 'Reversed')}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-2 font-medium">{domainLabel(loss.reason_code)}</div>
                      <div className="text-sm text-muted-foreground">
                        {loss.event_reference} {translate('productionUx.common.by', 'by')} {loss.actor_display_name || translate('productionUx.common.teamMember', 'Team member')}
                      </div>
                    </div>
                    <div className="text-right text-sm font-semibold">
                      {loss.quantity_lost != null ? (
                        <div>-{qtyWithUom(loss.quantity_lost, loss.quantity_uom_code || resolveUomCode(loss.quantity_uom_id))}</div>
                      ) : null}
                      {loss.weight_lost != null ? (
                        <div>-{qtyWithUom(loss.weight_lost, loss.weight_uom_code || resolveUomCode(loss.weight_uom_id))}</div>
                      ) : null}
                      <div className="text-xs font-normal text-muted-foreground">
                        {translate('productionUx.growth.sequenceShort', 'Seq')} {loss.event_sequence} / {compactDate(loss.event_effective_date)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2">
                    <SummaryItem
                      label={translate('productionUx.growth.quantity', 'Quantity')}
                      value={`${qty(loss.quantity_before)} -> ${qty(loss.quantity_after)} ${loss.quantity_uom_code || batch.primary_uom_code || ''}`.trim()}
                    />
                    <SummaryItem
                      label={translate('productionUx.growth.weight', 'Weight')}
                      value={loss.total_weight_before == null && loss.total_weight_after == null
                        ? translate('productionUx.common.notAffected', 'Not affected')
                        : `${qty(loss.total_weight_before)} -> ${qty(loss.total_weight_after)} ${loss.weight_uom_code || batch.weight_uom_code || ''}`.trim()}
                    />
                  </div>

                  {loss.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{loss.notes}</p> : null}

                  {loss.reversal_status === 'reversed' ? (
                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {translate('productionUx.growth.lossReversalEvidence', 'Reversed by {reference} on {date}. {reason}')
                        .replace('{reference}', loss.reversal_event_reference || translate('productionUx.growth.reversalEvent', 'reversal event'))
                        .replace('{date}', compactDate(loss.reversal_effective_date))
                        .replace('{reason}', loss.reversal_reason || translate('productionUx.growth.reasonRecorded', 'Reason recorded.'))}
                    </p>
                  ) : canReverseLoss ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenLossReversal(loss)}
                        disabled={saving}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        {translate('productionUx.growth.reverseLoss', 'Reverse loss event')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </DetailSection>
    </TabsContent>
  )
}
