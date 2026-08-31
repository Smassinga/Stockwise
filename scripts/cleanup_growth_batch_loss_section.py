from pathlib import Path

page_path = Path('src/pages/GrowthBatches.tsx')
component_path = Path('src/pages/growthBatches/GrowthBatchLossSection.tsx')
text = page_path.read_text(encoding='utf-8')

if not component_path.exists():
    raise SystemExit('GrowthBatchLossSection.tsx must exist before extraction')

start_marker = """                  <TabsContent value=\"lifecycle\">
                    <DetailSection
                      title={tt('productionUx.growth.lossHistory', 'Mortality and shrinkage')}"""
end_marker = """

                  <TabsContent value=\"measurements\">
                    <DetailSection
                      title={tt('productionUx.growth.measurementHistory', 'Measurement history')}"""

if text.count(start_marker) != 1:
    raise SystemExit(f'expected one loss-section start marker, found {text.count(start_marker)}')
start = text.index(start_marker)
end = text.find(end_marker, start)
if end < 0:
    raise SystemExit('loss-section end boundary not found')
block = text[start:end]

required = [
    "detailErrors.losses",
    "losses.map((loss)",
    "openLossDialog",
    "openLossReversalDialog(loss)",
    "loss.reversal_status !== 'reversed'",
    "uomById.get(loss.quantity_uom_id || '')?.code",
    "domainLabel(loss.reason_code)",
]
for token in required:
    if token not in block:
        raise SystemExit(f'loss-section guard missing {token!r}')

for forbidden in [
    'supabase.', '.rpc(', 'await ', 'stablePostingFingerprint',
    'getPostingRequestKeyForFingerprint', 'clearPostingRequestKey',
    'preview_growth_batch_loss', 'record_growth_batch_loss',
]:
    if forbidden in block:
        raise SystemExit(f'loss presentation block unexpectedly contains mutation marker {forbidden!r}')

replacement = """                  <GrowthBatchLossSection
                    batch={detailBatch}
                    losses={losses}
                    hasHistoryError={Boolean(detailErrors.losses)}
                    canOperate={canOperate}
                    canManage={canManage}
                    saving={saving}
                    translate={tt}
                    domainLabel={domainLabel}
                    resolveUomCode={(uomId) => (uomId ? uomById.get(uomId)?.code : undefined)}
                    onOpenLoss={openLossDialog}
                    onOpenLossReversal={openLossReversalDialog}
                  />"""

updated = text[:start] + replacement + text[end:]

import_anchor = "import GrowthBatchCompletionSection from './growthBatches/GrowthBatchCompletionSection'\n"
if updated.count(import_anchor) != 1:
    raise SystemExit(f'expected one completion-section import anchor, found {updated.count(import_anchor)}')
updated = updated.replace(
    import_anchor,
    import_anchor + "import GrowthBatchLossSection from './growthBatches/GrowthBatchLossSection'\n",
    1,
)

if 'losses.map((loss)' in updated:
    raise SystemExit('page still contains extracted loss-history mapping')
if updated.count('<GrowthBatchLossSection') != 1:
    raise SystemExit('page must render exactly one GrowthBatchLossSection')
for token in ['preview_growth_batch_loss', 'record_growth_batch_loss', 'reverse_growth_batch_loss']:
    if token not in updated:
        raise SystemExit(f'page unexpectedly lost mutation implementation marker {token!r}')

page_path.write_text(updated, encoding='utf-8')
print(f'extracted {block.count(chr(10)) + 1} loss-history presentation lines')
