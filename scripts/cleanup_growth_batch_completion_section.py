from pathlib import Path
import re

page_path = Path('src/pages/GrowthBatches.tsx')
primitives_path = Path('src/pages/growthBatches/GrowthBatchDetailPrimitives.tsx')
completion_component_path = Path('src/pages/growthBatches/GrowthBatchCompletionSection.tsx')
text = page_path.read_text(encoding='utf-8')

if not completion_component_path.exists():
    raise SystemExit('GrowthBatchCompletionSection.tsx must exist before page extraction')
if primitives_path.exists():
    raise SystemExit('GrowthBatchDetailPrimitives.tsx already exists')

primitive_start_marker = 'function Field({'
primitive_end_marker = 'export default function GrowthBatches() {'
if text.count(primitive_start_marker) != 1:
    raise SystemExit(f'expected one primitive start marker, found {text.count(primitive_start_marker)}')
if text.count(primitive_end_marker) != 1:
    raise SystemExit(f'expected one GrowthBatches component marker, found {text.count(primitive_end_marker)}')
primitive_start = text.index(primitive_start_marker)
primitive_end = text.index(primitive_end_marker, primitive_start)
primitive_block = text[primitive_start:primitive_end]
for token in ['function Field({', 'function SummaryItem(', 'function DetailSection({']:
    if primitive_block.count(token) != 1:
        raise SystemExit(f'expected one primitive {token!r}, found {primitive_block.count(token)}')
for forbidden in ['supabase.', '.rpc(', 'await ', 'toast.', 'useState(', 'useEffect(']:
    if forbidden in primitive_block:
        raise SystemExit(f'primitive block unexpectedly contains behavior marker {forbidden!r}')

exported_primitives = re.sub(r'(?m)^function (Field|SummaryItem|DetailSection)\b', r'export function \1', primitive_block)
primitives_module = """import type { ReactNode } from 'react'
import { Label } from '../../components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'

""" + exported_primitives.rstrip() + '\n'
primitives_path.write_text(primitives_module, encoding='utf-8')

updated = text[:primitive_start] + text[primitive_end:]
updated = updated.replace(', type ReactNode', '', 1)

# If Label was only used by Field, drop its page import now.
if not re.search(r'\bLabel\b', updated.replace("import { Label } from '../components/ui/label'", '')):
    updated = updated.replace("import { Label } from '../components/ui/label'\n", '', 1)

completion_start_marker = """                  <TabsContent value=\"lifecycle\">
                    <DetailSection
                      title={completionCopy.history.title}"""
completion_end_marker = """

                  <TabsContent value=\"lifecycle\">
                    <DetailSection
                      title={tt('productionUx.growth.lossHistory', 'Mortality and shrinkage')}"""

if updated.count(completion_start_marker) != 1:
    raise SystemExit(f'expected one completion section start marker, found {updated.count(completion_start_marker)}')
start = updated.index(completion_start_marker)
end = updated.find(completion_end_marker, start)
if end < 0:
    raise SystemExit('completion section end boundary not found')
completion_block = updated[start:end]
required_completion_tokens = [
    'completionCopy.history.title',
    'completionUnavailableReason()',
    'openCompletionDialog',
    'detailErrors.completion',
    'completions.map((completion)',
    'openCompletionReversalDialog(completion)',
    'completion.reversal_eligible',
]
for token in required_completion_tokens:
    if token not in completion_block:
        raise SystemExit(f'completion section guard missing {token!r}')
for forbidden in ['supabase.', '.rpc(', 'await ', 'stablePostingFingerprint', 'getPostingRequestKeyForFingerprint']:
    if forbidden in completion_block:
        raise SystemExit(f'completion presentation block unexpectedly contains posting marker {forbidden!r}')

replacement = """                  <GrowthBatchCompletionSection
                    batch={detailBatch}
                    completions={completions}
                    hasHistoryError={Boolean(detailErrors.completion)}
                    canManage={canManage}
                    saving={saving}
                    selectedCurrency={selectedCurrency}
                    completionCopy={completionCopy}
                    fullyHarvestedLabel={harvestCopy.labels.fullyHarvested}
                    translate={tt}
                    completionStatusLabel={completionStatusLabel}
                    getCompletionUnavailableReason={completionUnavailableReason}
                    onOpenCompletion={openCompletionDialog}
                    onOpenCompletionReversal={openCompletionReversalDialog}
                  />"""
updated = updated[:start] + replacement + updated[end:]

support_anchor = "} from './growthBatches/growthBatchPageSupport'\n\n"
if updated.count(support_anchor) != 1:
    raise SystemExit(f'expected one Growth Batch support import anchor, found {updated.count(support_anchor)}')
new_imports = """import { DetailSection, Field, SummaryItem } from './growthBatches/GrowthBatchDetailPrimitives'
import GrowthBatchCompletionSection from './growthBatches/GrowthBatchCompletionSection'

"""
updated = updated.replace(support_anchor, support_anchor + new_imports, 1)

for token in ['function Field({', 'function SummaryItem(', 'function DetailSection({']:
    if token in updated:
        raise SystemExit(f'page still contains extracted primitive {token!r}')
if 'completions.map((completion)' in updated:
    raise SystemExit('page still contains extracted completion history mapping')
if updated.count('<GrowthBatchCompletionSection') != 1:
    raise SystemExit('page must render exactly one GrowthBatchCompletionSection')

page_path.write_text(updated, encoding='utf-8')
print(f'extracted {primitive_block.count(chr(10)) + 1} primitive lines and {completion_block.count(chr(10)) + 1} completion-section lines')
