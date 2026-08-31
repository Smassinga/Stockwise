import { AlertTriangle, ArrowRightLeft, RotateCcw } from 'lucide-react'

import type { GrowthBatchTransferRow } from '../../lib/growthBatchTypes'
import type { GrowthBatchTransferCopy } from '../../lib/growthBatchCopy'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { TabsContent } from '../../components/ui/tabs'
import { PremiumEmptyState } from '../../components/premium/PremiumEmptyState'
import { PremiumStatusBadge } from '../../components/premium/PremiumStatusBadge'
import { compactDate, qty, qtyWithUom } from './growthBatchPageSupport'
import { DetailSection, SummaryItem } from './GrowthBatchDetailPrimitives'

type TransferBatchView = {
  status: string
  current_primary_qty?: unknown
  opening_primary_qty: unknown
  primary_uom_code?: string | null
  latest_total_weight?: unknown
  weight_uom_code?: string | null
}

type Props = {
  batch: TransferBatchView
  transfers: GrowthBatchTransferRow[]
  hasHistoryError: boolean
  canOperate: boolean
  canManage: boolean
  saving: boolean
  transferCopy: GrowthBatchTransferCopy
  translate: (key: string, fallback: string) => string
  getTransferUnavailableReason: () => string | null
  getSourceLocationLabel: () => string
  getHistoryLocationLabel: (transfer: GrowthBatchTransferRow, side: 'source' | 'destination') => string
  getTransferReasonLabel: (reason: GrowthBatchTransferRow['transfer_reason']) => string
  onOpenTransfer: () => void
  onOpenTransferReversal: (transfer: GrowthBatchTransferRow) => void
}

export default function GrowthBatchTransferSection({
  batch,
  transfers,
  hasHistoryError,
  canOperate,
  canManage,
  saving,
  transferCopy,
  translate,
  getTransferUnavailableReason,
  getSourceLocationLabel,
  getHistoryLocationLabel,
  getTransferReasonLabel,
  onOpenTransfer,
  onOpenTransferReversal,
}: Props) {
  const unavailableReason = getTransferUnavailableReason()

  return (
    <TabsContent value="materials">
      <DetailSection
        title={transferCopy.history.title}
        description={transferCopy.history.description}
        action={batch.status === 'active' && canOperate ? (
          <Button size="sm" className="w-full sm:w-auto" onClick={onOpenTransfer} disabled={saving || Boolean(unavailableReason)} title={unavailableReason || undefined}>
            <ArrowRightLeft className="mr-2 h-4 w-4" />
            {transferCopy.actions.transferBatch}
          </Button>
        ) : null}
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <SummaryItem label={transferCopy.labels.currentLocation} value={getSourceLocationLabel()} />
          <SummaryItem label={transferCopy.labels.currentQuantity} value={`${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim()} />
          <SummaryItem label={transferCopy.labels.latestWeight} value={batch.latest_total_weight == null ? transferCopy.fallback.notRecorded : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)} />
        </div>
        {hasHistoryError ? (
          <PremiumEmptyState icon={<AlertTriangle />} title={translate('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')} description={translate('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')} compact />
        ) : transfers.length === 0 ? (
          <PremiumEmptyState icon={<ArrowRightLeft />} title={transferCopy.history.emptyTitle} description={transferCopy.history.emptyDescription} compact />
        ) : (
          <div className="space-y-3">
            {transfers.map((transfer) => {
              const canReverseTransfer = canManage && transfer.reversal_eligible
              return (
                <div key={transfer.id} className="rounded-xl border border-card-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <PremiumStatusBadge tone="info">{transferCopy.history.transferBadge}</PremiumStatusBadge>
                        {transfer.reversed ? <Badge variant="outline">{transferCopy.history.reversedBadge}</Badge> : null}
                        {!transfer.reversed && !transfer.reversal_eligible ? <Badge variant="secondary">{transferCopy.history.lockedBadge}</Badge> : null}
                      </div>
                      <div className="mt-2 font-medium break-words">
                        {getHistoryLocationLabel(transfer, 'source')} {' -> '} {getHistoryLocationLabel(transfer, 'destination')}
                      </div>
                      <div className="text-sm text-muted-foreground">{transfer.event_reference} {transferCopy.history.by} {transfer.actor_display_name || transferCopy.fallback.teamMember}</div>
                    </div>
                    <div className="text-right text-sm font-semibold">
                      <div>{qtyWithUom(transfer.current_primary_qty, transfer.primary_uom_code)}</div>
                      <div className="text-xs font-normal text-muted-foreground">{transferCopy.history.sequencePrefix} {transfer.event_sequence} / {compactDate(transfer.event_effective_date)}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <SummaryItem label={transferCopy.labels.fullQuantityMoved} value={qtyWithUom(transfer.current_primary_qty, transfer.primary_uom_code)} />
                    <SummaryItem label={transferCopy.labels.weightSnapshot} value={transfer.current_total_weight == null ? transferCopy.fallback.notRecorded : qtyWithUom(transfer.current_total_weight, transfer.weight_uom_code)} />
                    <SummaryItem label={transferCopy.labels.purpose} value={getTransferReasonLabel(transfer.transfer_reason)} />
                    <SummaryItem label={transferCopy.labels.costEffect} value={transferCopy.fallback.unchanged} />
                  </div>
                  {transfer.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{transfer.notes}</p> : null}
                  {transfer.reversed ? (
                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {transferCopy.history.reversedBy} {transfer.reversal_event_reference || transferCopy.fallback.reversalEvent} {transferCopy.history.onDate} {compactDate(transfer.reversal_effective_date)}. {transfer.reversal_reason || transferCopy.fallback.reasonRecorded}
                    </p>
                  ) : canReverseTransfer ? (
                    <div className="mt-3">
                      <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenTransferReversal(transfer)} disabled={saving}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        {transferCopy.actions.reverseTransfer}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">
                      {transferCopy.history.lockedReason}
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
