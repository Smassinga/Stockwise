from pathlib import Path

page_path = Path('src/pages/GrowthBatches.tsx')
component_path = Path('src/pages/growthBatches/GrowthBatchTransferSection.tsx')
page = page_path.read_text(encoding='utf-8')

start_marker = '''                  <TabsContent value="materials">\n                    <DetailSection\n                      title={transferCopy.history.title}'''
end_marker = '''                  <TabsContent value="lifecycle">\n                    <DetailSection\n                      title={harvestCopy.history.title}'''

if page.count(start_marker) != 1:
    raise SystemExit(f'Expected exactly one transfer section start, found {page.count(start_marker)}')
if page.count(end_marker) != 1:
    raise SystemExit(f'Expected exactly one harvest section boundary, found {page.count(end_marker)}')

start = page.index(start_marker)
end = page.index(end_marker, start)
block = page[start:end]

required = [
    'transferCopy.history.title',
    'transfer.reversal_eligible',
    'openTransferDialog',
    'openTransferReversalDialog',
    'transferUnavailableReason()',
    'transferSourceLocationLabel()',
    "transferHistoryLocationLabel(transfer, 'source')",
    "transferHistoryLocationLabel(transfer, 'destination')",
    'transferReasonLabel(transfer.transfer_reason)',
]
for token in required:
    if token not in block:
        raise SystemExit(f'Missing guarded transfer token: {token}')

for forbidden in ['supabase', '.rpc(', '.from(', 'PostingRequestKey', 'stablePostingFingerprint', 'getPostingRequestKeyForFingerprint', 'clearPostingRequestKey']:
    if forbidden in block:
        raise SystemExit(f'Behavior marker unexpectedly present in transfer presentation block: {forbidden}')

component = '''import { AlertTriangle, ArrowRightLeft, RotateCcw } from 'lucide-react'\n\nimport type { GrowthBatchTransferRow } from '../../lib/growthBatchTypes'\nimport type { GrowthBatchTransferCopy } from '../../lib/growthBatchCopy'\nimport { Badge } from '../../components/ui/badge'\nimport { Button } from '../../components/ui/button'\nimport { TabsContent } from '../../components/ui/tabs'\nimport { PremiumEmptyState } from '../../components/premium/PremiumEmptyState'\nimport { PremiumStatusBadge } from '../../components/premium/PremiumStatusBadge'\nimport { compactDate, qty, qtyWithUom } from './growthBatchPageSupport'\nimport { DetailSection, SummaryItem } from './GrowthBatchDetailPrimitives'\n\ntype TransferBatchView = {\n  status: string\n  current_primary_qty?: unknown\n  opening_primary_qty: unknown\n  primary_uom_code?: string | null\n  latest_total_weight?: unknown\n  weight_uom_code?: string | null\n}\n\ntype Props = {\n  batch: TransferBatchView\n  transfers: GrowthBatchTransferRow[]\n  hasHistoryError: boolean\n  canOperate: boolean\n  canManage: boolean\n  saving: boolean\n  transferCopy: GrowthBatchTransferCopy\n  translate: (key: string, fallback: string) => string\n  getTransferUnavailableReason: () => string | null\n  getSourceLocationLabel: () => string\n  getHistoryLocationLabel: (transfer: GrowthBatchTransferRow, side: 'source' | 'destination') => string\n  getTransferReasonLabel: (reason: GrowthBatchTransferRow['transfer_reason']) => string\n  onOpenTransfer: () => void\n  onOpenTransferReversal: (transfer: GrowthBatchTransferRow) => void\n}\n\nexport default function GrowthBatchTransferSection({\n  batch,\n  transfers,\n  hasHistoryError,\n  canOperate,\n  canManage,\n  saving,\n  transferCopy,\n  translate,\n  getTransferUnavailableReason,\n  getSourceLocationLabel,\n  getHistoryLocationLabel,\n  getTransferReasonLabel,\n  onOpenTransfer,\n  onOpenTransferReversal,\n}: Props) {\n  const unavailableReason = getTransferUnavailableReason()\n\n  return (\n    <TabsContent value="materials">\n      <DetailSection\n        title={transferCopy.history.title}\n        description={transferCopy.history.description}\n        action={batch.status === 'active' && canOperate ? (\n          <Button size="sm" className="w-full sm:w-auto" onClick={onOpenTransfer} disabled={saving || Boolean(unavailableReason)} title={unavailableReason || undefined}>\n            <ArrowRightLeft className="mr-2 h-4 w-4" />\n            {transferCopy.actions.transferBatch}\n          </Button>\n        ) : null}\n      >\n        <div className="mb-4 grid gap-3 sm:grid-cols-3">\n          <SummaryItem label={transferCopy.labels.currentLocation} value={getSourceLocationLabel()} />\n          <SummaryItem label={transferCopy.labels.currentQuantity} value={`${qty(batch.current_primary_qty ?? batch.opening_primary_qty)} ${batch.primary_uom_code || ''}`.trim()} />\n          <SummaryItem label={transferCopy.labels.latestWeight} value={batch.latest_total_weight == null ? transferCopy.fallback.notRecorded : qtyWithUom(batch.latest_total_weight, batch.weight_uom_code)} />\n        </div>\n        {hasHistoryError ? (\n          <PremiumEmptyState icon={<AlertTriangle />} title={translate('productionUx.growth.evidenceUnavailable', 'Evidence unavailable')} description={translate('productionUx.growth.historyNotEmpty', 'This read failed and has not been treated as an empty history.')} compact />\n        ) : transfers.length === 0 ? (\n          <PremiumEmptyState icon={<ArrowRightLeft />} title={transferCopy.history.emptyTitle} description={transferCopy.history.emptyDescription} compact />\n        ) : (\n          <div className="space-y-3">\n            {transfers.map((transfer) => {\n              const canReverseTransfer = canManage && transfer.reversal_eligible\n              return (\n                <div key={transfer.id} className="rounded-xl border border-card-border bg-card p-4">\n                  <div className="flex flex-wrap items-start justify-between gap-3">\n                    <div className="min-w-0">\n                      <div className="flex flex-wrap items-center gap-2">\n                        <PremiumStatusBadge tone="info">{transferCopy.history.transferBadge}</PremiumStatusBadge>\n                        {transfer.reversed ? <Badge variant="outline">{transferCopy.history.reversedBadge}</Badge> : null}\n                        {!transfer.reversed && !transfer.reversal_eligible ? <Badge variant="secondary">{transferCopy.history.lockedBadge}</Badge> : null}\n                      </div>\n                      <div className="mt-2 font-medium break-words">\n                        {getHistoryLocationLabel(transfer, 'source')} {' -> '} {getHistoryLocationLabel(transfer, 'destination')}\n                      </div>\n                      <div className="text-sm text-muted-foreground">{transfer.event_reference} {transferCopy.history.by} {transfer.actor_display_name || transferCopy.fallback.teamMember}</div>\n                    </div>\n                    <div className="text-right text-sm font-semibold">\n                      <div>{qtyWithUom(transfer.current_primary_qty, transfer.primary_uom_code)}</div>\n                      <div className="text-xs font-normal text-muted-foreground">{transferCopy.history.sequencePrefix} {transfer.event_sequence} / {compactDate(transfer.event_effective_date)}</div>\n                    </div>\n                  </div>\n                  <div className="mt-3 grid gap-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">\n                    <SummaryItem label={transferCopy.labels.fullQuantityMoved} value={qtyWithUom(transfer.current_primary_qty, transfer.primary_uom_code)} />\n                    <SummaryItem label={transferCopy.labels.weightSnapshot} value={transfer.current_total_weight == null ? transferCopy.fallback.notRecorded : qtyWithUom(transfer.current_total_weight, transfer.weight_uom_code)} />\n                    <SummaryItem label={transferCopy.labels.purpose} value={getTransferReasonLabel(transfer.transfer_reason)} />\n                    <SummaryItem label={transferCopy.labels.costEffect} value={transferCopy.fallback.unchanged} />\n                  </div>\n                  {transfer.notes ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{transfer.notes}</p> : null}\n                  {transfer.reversed ? (\n                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">\n                      {transferCopy.history.reversedBy} {transfer.reversal_event_reference || transferCopy.fallback.reversalEvent} {transferCopy.history.onDate} {compactDate(transfer.reversal_effective_date)}. {transfer.reversal_reason || transferCopy.fallback.reasonRecorded}\n                    </p>\n                  ) : canReverseTransfer ? (\n                    <div className="mt-3">\n                      <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => onOpenTransferReversal(transfer)} disabled={saving}>\n                        <RotateCcw className="mr-2 h-4 w-4" />\n                        {transferCopy.actions.reverseTransfer}\n                      </Button>\n                    </div>\n                  ) : (\n                    <p className="mt-3 rounded-lg border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">\n                      {transferCopy.history.lockedReason}\n                    </p>\n                  )}\n                </div>\n              )\n            })}\n          </div>\n        )}\n      </DetailSection>\n    </TabsContent>\n  )\n}\n'''

component_path.write_text(component, encoding='utf-8')

replacement = '''                  <GrowthBatchTransferSection\n                    batch={detailBatch}\n                    transfers={transfers}\n                    hasHistoryError={Boolean(detailErrors.transfers)}\n                    canOperate={canOperate}\n                    canManage={canManage}\n                    saving={saving}\n                    transferCopy={transferCopy}\n                    translate={tt}\n                    getTransferUnavailableReason={transferUnavailableReason}\n                    getSourceLocationLabel={transferSourceLocationLabel}\n                    getHistoryLocationLabel={transferHistoryLocationLabel}\n                    getTransferReasonLabel={transferReasonLabel}\n                    onOpenTransfer={openTransferDialog}\n                    onOpenTransferReversal={openTransferReversalDialog}\n                  />\n\n'''

# Replace the bounded JSX before adding imports so the original character offsets remain valid.
page = page[:start] + replacement + page[end:]

import_marker = "import GrowthBatchCompletionSection from './growthBatches/GrowthBatchCompletionSection'\n"
if page.count(import_marker) != 1:
    raise SystemExit('Expected one GrowthBatchCompletionSection import marker')
page = page.replace(import_marker, import_marker + "import GrowthBatchTransferSection from './growthBatches/GrowthBatchTransferSection'\n", 1)

page_path.write_text(page, encoding='utf-8')

final_page = page_path.read_text(encoding='utf-8')
if start_marker in final_page:
    raise SystemExit('Transfer presentation block still present in page')
if final_page.count('<GrowthBatchTransferSection') != 1:
    raise SystemExit('Expected exactly one GrowthBatchTransferSection usage')

final_component = component_path.read_text(encoding='utf-8')
for forbidden in ['supabase', '.rpc(', '.from(', 'PostingRequestKey', 'stablePostingFingerprint', 'getPostingRequestKeyForFingerprint', 'clearPostingRequestKey']:
    if forbidden in final_component:
        raise SystemExit(f'Forbidden behavior marker in extracted component: {forbidden}')

print('Growth Batch transfer presentation extracted successfully')
