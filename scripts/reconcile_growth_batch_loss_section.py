from pathlib import Path

page_path = Path('src/pages/GrowthBatches.tsx')
page = page_path.read_text(encoding='utf-8')

start_marker = '''                  <TabsContent value="lifecycle">\n                    <DetailSection\n                      title={tt('productionUx.growth.lossHistory', 'Mortality and shrinkage')}'''
end_marker = '''                  <TabsContent value="measurements">\n                    <DetailSection'''

if page.count(start_marker) != 1:
    raise SystemExit(f'Expected exactly one loss section start, found {page.count(start_marker)}')
if page.count(end_marker) != 1:
    raise SystemExit(f'Expected exactly one measurements boundary, found {page.count(end_marker)}')

start = page.index(start_marker)
end = page.index(end_marker, start)
block = page[start:end]

required = [
    "productionUx.growth.lossHistory",
    'loss.reversal_status',
    'openLossDialog',
    'openLossReversalDialog',
    'detailErrors.losses',
    'uomById.get(',
]
for token in required:
    if token not in block:
        raise SystemExit(f'Missing guarded loss token: {token}')

for forbidden in ['supabase', '.rpc(', '.from(', 'PostingRequestKey', 'stablePostingFingerprint', 'getPostingRequestKeyForFingerprint', 'clearPostingRequestKey']:
    if forbidden in block:
        raise SystemExit(f'Behavior marker unexpectedly present in loss presentation block: {forbidden}')

replacement = '''                  <GrowthBatchLossSection\n                    batch={detailBatch}\n                    losses={losses}\n                    hasHistoryError={Boolean(detailErrors.losses)}\n                    canOperate={canOperate}\n                    canManage={canManage}\n                    saving={saving}\n                    translate={tt}\n                    domainLabel={domainLabel}\n                    resolveUomCode={(uomId) => (uomId ? uomById.get(uomId)?.code : undefined)}\n                    onOpenLoss={openLossDialog}\n                    onOpenLossReversal={openLossReversalDialog}\n                  />\n\n'''

page = page[:start] + replacement + page[end:]

import_marker = "import GrowthBatchTransferSection from './growthBatches/GrowthBatchTransferSection'\n"
if page.count(import_marker) != 1:
    raise SystemExit('Expected one GrowthBatchTransferSection import marker')
page = page.replace(import_marker, import_marker + "import GrowthBatchLossSection from './growthBatches/GrowthBatchLossSection'\n", 1)

page_path.write_text(page, encoding='utf-8')

final_page = page_path.read_text(encoding='utf-8')
if start_marker in final_page:
    raise SystemExit('Loss presentation block still present in page')
if final_page.count('<GrowthBatchLossSection') != 1:
    raise SystemExit('Expected exactly one GrowthBatchLossSection usage')
if final_page.count("import GrowthBatchLossSection from './growthBatches/GrowthBatchLossSection'") != 1:
    raise SystemExit('Expected exactly one GrowthBatchLossSection import')

component = Path('src/pages/growthBatches/GrowthBatchLossSection.tsx').read_text(encoding='utf-8')
for forbidden in ['supabase', '.rpc(', '.from(', 'PostingRequestKey', 'stablePostingFingerprint', 'getPostingRequestKeyForFingerprint', 'clearPostingRequestKey']:
    if forbidden in component:
        raise SystemExit(f'Forbidden behavior marker in loss component: {forbidden}')

print('Growth Batch loss presentation reconciled successfully')
