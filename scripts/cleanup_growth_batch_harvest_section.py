from pathlib import Path

page_path = Path('src/pages/GrowthBatches.tsx')
page = page_path.read_text(encoding='utf-8')

start_marker = '''                  <TabsContent value="lifecycle">\n                    <DetailSection\n                      title={harvestCopy.history.title}'''
end_marker = '''                  <GrowthBatchCompletionSection\n'''

if page.count(start_marker) != 1:
    raise SystemExit(f'Expected exactly one harvest section start, found {page.count(start_marker)}')
if page.count(end_marker) != 1:
    raise SystemExit(f'Expected exactly one completion section boundary, found {page.count(end_marker)}')

start = page.index(start_marker)
end = page.index(end_marker, start)
block = page[start:end]

required = [
    'harvestCopy.history.title',
    'harvest.reversal_eligible',
    'openHarvestDialog',
    'openHarvestReversalDialog',
    'harvestUnavailableReason()',
    'harvestKindLabel(harvest.harvest_kind)',
    "harvestHistoryLocationLabel(harvest, 'source')",
    "harvestHistoryLocationLabel(harvest, 'destination')",
    'detailErrors.harvests',
    'fully_harvested_awaiting_completion',
]
for token in required:
    if token not in block:
        raise SystemExit(f'Missing guarded harvest token: {token}')

for forbidden in ['supabase', '.rpc(', '.from(', 'PostingRequestKey', 'stablePostingFingerprint', 'getPostingRequestKeyForFingerprint', 'clearPostingRequestKey']:
    if forbidden in block:
        raise SystemExit(f'Behavior marker unexpectedly present in harvest presentation block: {forbidden}')

replacement = '''                  <GrowthBatchHarvestSection\n                    batch={detailBatch}\n                    harvests={harvests}\n                    hasHistoryError={Boolean(detailErrors.harvests)}\n                    canOperate={canOperate}\n                    canManage={canManage}\n                    saving={saving}\n                    selectedCurrency={selectedCurrency}\n                    harvestCopy={harvestCopy}\n                    translate={tt}\n                    getHarvestUnavailableReason={harvestUnavailableReason}\n                    getHarvestKindLabel={harvestKindLabel}\n                    getHistoryLocationLabel={harvestHistoryLocationLabel}\n                    onOpenHarvest={openHarvestDialog}\n                    onOpenHarvestReversal={openHarvestReversalDialog}\n                  />\n\n'''

page = page[:start] + replacement + page[end:]

import_marker = "import GrowthBatchLossSection from './growthBatches/GrowthBatchLossSection'\n"
if page.count(import_marker) != 1:
    raise SystemExit('Expected one GrowthBatchLossSection import marker')
page = page.replace(import_marker, import_marker + "import GrowthBatchHarvestSection from './growthBatches/GrowthBatchHarvestSection'\n", 1)
page_path.write_text(page, encoding='utf-8')

final_page = page_path.read_text(encoding='utf-8')
if start_marker in final_page:
    raise SystemExit('Harvest presentation block still present in page')
if final_page.count('<GrowthBatchHarvestSection') != 1:
    raise SystemExit('Expected exactly one GrowthBatchHarvestSection usage')
if final_page.count("import GrowthBatchHarvestSection from './growthBatches/GrowthBatchHarvestSection'") != 1:
    raise SystemExit('Expected exactly one GrowthBatchHarvestSection import')

component = Path('src/pages/growthBatches/GrowthBatchHarvestSection.tsx').read_text(encoding='utf-8')
for forbidden in ['supabase', '.rpc(', '.from(', 'PostingRequestKey', 'stablePostingFingerprint', 'getPostingRequestKeyForFingerprint', 'clearPostingRequestKey']:
    if forbidden in component:
        raise SystemExit(f'Forbidden behavior marker in harvest component: {forbidden}')

print('Growth Batch harvest presentation extracted successfully')
