import { AlertTriangle, RotateCcw, Sprout } from 'lucide-react'

import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { TabsContent } from '../../components/ui/tabs'
import { PremiumEmptyState } from '../../components/premium/PremiumEmptyState'
import { PremiumStatusBadge } from '../../components/premium/PremiumStatusBadge'
import type { GrowthBatchHarvestCopy } from '../../lib/growthBatchCopy'
import type {
  GrowthBatchCurrentState,
  GrowthBatchHarvestRow,
  GrowthBatchRegisterRow,
} from '../../lib/growthBatchTypes'
import { compactDate, money, num, qty, qtyWithUom } from './growthBatchPageSupport'
import { DetailSection, SummaryItem } from './GrowthBatchDetailPrimitives'

type GrowthBatchHarvestSectionProps = {
  batch: GrowthBatchCurrentState | GrowthBatchRegisterRow
  harvests: GrowthBatchHarvestRow[]
  hasHistoryError: boolean
  canOperate: boolean
  canManage: boolean
  saving: boolean
  selectedCurrency: string | null | undefined
  harvestCopy: GrowthBatchHarvestCopy
  translate: (key: string, fallback: string) => string
  getHarvestUnavailableReason: () => string | null
  getHarvestKindLabel: (kind: GrowthBatchHarvestRow['harvest_kind']) => string
  getHistoryLocationLabel: (harvest: GrowthBatchHarvestRow, side: 'source' | 'destination') => string
  onOpenHarvest: () => void
  onOpenHarvestReversal: (harvest: GrowthBatchHarvestRow) => void
}

export default function GrowthBatchHarvestSection({
  batch,
  harvests,
  hasHistoryError,
  canOperate,
  canManage,
  saving,
  selectedCurrency,
  harvestCopy,
  translate,
  getHarvestUnavailableReason,
  getHarvestKindLabel,
  getHistoryLocationLabel,
  onOpenHarvest,
  onOpenHarvestReversal,
}: GrowthBatchHarvestSectionProps) {
  const unavailableReason = getHarvestUnavailableReason()

  return (
    <TabsContent value="lifecycle">
      <DetailSection
        title={harvestCopy.history.title}
        description={harvestCopy.history.description}
        action={batch.status === 'active' && canOperate && num(batch.current_primary_qty ?? batch.opening_primary_qty) > 0 ? (
          <Button
            size="sm"
            className="w-full sm:w-auto"
            onClick={onOpenHarvest}
            disabled={saving || Boolean(unavailableReason)}
            title={unavailableReason || undefined}
          >
            <Sprout className="mr-2 h-4 w-4" />
            {harvestCopy.actions.recordHarvest}
          </Button>
        ) : null}
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryItem
            label={harvestCopy.labels.currentQuantity}
            value={`${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim()}
          />
          <SummaryItem
            label={harvestCopy.labels.currentWeight}
            value={batch.latest_total_weight == null
              ? harvestCopy.fallback.notRecorded
              : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)}
          />
          <SummaryItem
            label={harvestCopy.labels.remainingCost}
            value={money(batch.remaining_cost, selectedCurrency)}
          />
          <SummaryItem
            label={harvestCopy.labels.stockReceipt}
            value={harvestCopy.preview.noSaleNoFinance}
          />
        </div>

        {batch.fully_harvested_awaiting_completion ? (
          <div className="mb-4 rounded-xl border border-status-success-border bg-status-success-muted p-4 text-sm">
            <div className="font-medium text-status-success-foreground">{harvestCopy.labels.fullyHarvested}</div>
            <div className="mt-1 text-muted-foreground">{harvestCopy.labels.awaitingCompletion}</div>
          </div>
        ) : null}

        {hasHistoryError ? (
          <PremiumEmptyState
            icon={<AlertTriangle />}
            title={translate('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')}
            description={translate('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')}
            compact
          />
        ) : harvests.length === 0 ? (
          <PremiumEmptyState
            icon={<Sprout />}
            title={harvestCopy.history.emptyTitle}
            description={harvestCopy.history.emptyDescription}
            compact
          />
        ) : (
          <div className="space-y-3">
            {harvests.map((harvest) => {
              const canReverseHarvest = canManage && harvest.reversal_eligible

              return (
                <div key={harvest.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <PremiumStatusBadge tone="positive">{harvestCopy.history.harvestBadge}</PremiumStatusBadge>
                        <Badge variant="secondary">{getHarvestKindLabel(harvest.harvest_kind)}</Badge>
                        {harvest.reversed ? <Badge variant="outline">{harvestCopy.fallback.reversed}</Badge> : null}
                        {!harvest.reversed && !harvest.reversal_eligible ? <Badge variant="secondary">{harvestCopy.fallback.locked}</Badge> : null}
                      </div>
                      <div className="mt-2 font-medium break-words">{harvest.output_item_name}</div>
                      <div className="text-sm text-muted-foreground">
                        {[harvest.output_item_sku, harvest.event_reference, `${harvestCopy.history.sequencePrefix} ${harvest.event_sequence}`]
                          .filter(Boolean)
                          .join(' / ')}
                      </div>
                    </div>
                    <div className="min-w-0 text-left text-sm font-semibold sm:text-right">
                      <div>{qtyWithUom(harvest.harvested_primary_qty, harvest.primary_uom_code)}</div>
                      <div className="text-xs font-normal text-muted-foreground">{compactDate(harvest.event_effective_date)}</div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    <SummaryItem label={harvestCopy.labels.before} value={qtyWithUom(harvest.quantity_before, harvest.primary_uom_code)} />
                    <SummaryItem label={harvestCopy.labels.after} value={qtyWithUom(harvest.quantity_after, harvest.primary_uom_code)} />
                    <SummaryItem
                      label={harvestCopy.labels.harvestedWeight}
                      value={harvest.harvested_weight == null
                        ? harvestCopy.fallback.notRecorded
                        : qtyWithUom(harvest.harvested_weight, harvest.weight_uom_code)}
                    />
                    <SummaryItem label={harvestCopy.labels.outputQuantity} value={qtyWithUom(harvest.output_quantity, harvest.output_uom_code)} />
                    <SummaryItem label={harvestCopy.labels.destinationLocation} value={getHistoryLocationLabel(harvest, 'destination')} />
                    <SummaryItem label={harvestCopy.labels.allocatedCost} value={money(harvest.allocated_cost, selectedCurrency)} />
                    <SummaryItem label={harvestCopy.labels.outputUnitCost} value={money(harvest.output_unit_cost, selectedCurrency)} />
                    <SummaryItem label={harvestCopy.labels.remainingCost} value={money(harvest.remaining_cost_after, selectedCurrency)} />
                  </div>

                  <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2">
                    <SummaryItem label={harvestCopy.labels.sourceLocation} value={getHistoryLocationLabel(harvest, 'source')} />
                    <SummaryItem label={harvestCopy.labels.stockReceipt} value={harvestCopy.history.harvestBadge} />
                  </div>

                  {harvest.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{harvest.notes}</p> : null}

                  {harvest.reversed ? (
                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {harvestCopy.history.reversedBy} {harvest.reversal_event_reference || harvestCopy.history.harvestReversalBadge}{' '}
                      {harvestCopy.history.onDate} {compactDate(harvest.reversal_effective_date)}. {harvest.reversal_reason || harvestCopy.fallback.notRecorded}
                    </p>
                  ) : canReverseHarvest ? (
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full sm:w-auto"
                        onClick={() => onOpenHarvestReversal(harvest)}
                        disabled={saving}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        {harvestCopy.actions.reverseHarvest}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {harvestCopy.history.lockedReason}
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
