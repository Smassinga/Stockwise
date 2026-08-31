from pathlib import Path

page_path = Path('src/pages/GrowthBatches.tsx')
module_path = Path('src/lib/growthBatchCopy.ts')
text = page_path.read_text(encoding='utf-8')

start_marker = "const harvestBlockerCodes = ["
end_marker = "const statusTone: Record<BatchStatus, PremiumTone> = {"
import_anchor = "} from '../lib/growthBatchTypes'\n\n"

if text.count(start_marker) != 1:
    raise SystemExit(f'expected one copy-block start marker, found {text.count(start_marker)}')
if text.count(end_marker) != 1:
    raise SystemExit(f'expected one copy-block end marker, found {text.count(end_marker)}')
if text.count(import_anchor) != 1:
    raise SystemExit(f'expected one growthBatchTypes import anchor, found {text.count(import_anchor)}')
if module_path.exists():
    raise SystemExit('src/lib/growthBatchCopy.ts already exists')

start = text.index(start_marker)
end = text.index(end_marker, start)
block = text[start:end]

required_tokens = [
    'const harvestBlockerCodes = [',
    'type GrowthBatchHarvestBlockerCode =',
    'const transferBlockerCodes = [',
    'type GrowthBatchTransferBlockerCode =',
    'const completionBlockerCodes = [',
    'type GrowthBatchCompletionBlockerCode =',
    'type GrowthBatchHarvestCopy = {',
    'type GrowthBatchTransferCopy = {',
    'type GrowthBatchCompletionCopy = {',
    'const growthBatchTransferCopy: Record<Locale, GrowthBatchTransferCopy> = {',
    'const growthBatchHarvestCopy: Record<Locale, GrowthBatchHarvestCopy> = {',
    'const growthBatchCompletionCopy: Record<Locale, GrowthBatchCompletionCopy> = {',
]
for token in required_tokens:
    if block.count(token) != 1:
        raise SystemExit(f'copy block expected exactly one {token!r}, found {block.count(token)}')

for forbidden in ['supabase.', '.rpc(', '.from(', 'function ', 'async ']:
    if forbidden in block:
        raise SystemExit(f'copy block unexpectedly contains runtime behavior marker {forbidden!r}')

exports = {
    'const harvestBlockerCodes = [': 'export const harvestBlockerCodes = [',
    'type GrowthBatchHarvestBlockerCode =': 'export type GrowthBatchHarvestBlockerCode =',
    'const transferBlockerCodes = [': 'export const transferBlockerCodes = [',
    'type GrowthBatchTransferBlockerCode =': 'export type GrowthBatchTransferBlockerCode =',
    'const completionBlockerCodes = [': 'export const completionBlockerCodes = [',
    'type GrowthBatchCompletionBlockerCode =': 'export type GrowthBatchCompletionBlockerCode =',
    'type GrowthBatchHarvestCopy = {': 'export type GrowthBatchHarvestCopy = {',
    'type GrowthBatchTransferCopy = {': 'export type GrowthBatchTransferCopy = {',
    'type GrowthBatchCompletionCopy = {': 'export type GrowthBatchCompletionCopy = {',
    'const growthBatchTransferCopy: Record<Locale, GrowthBatchTransferCopy> = {': 'export const growthBatchTransferCopy: Record<Locale, GrowthBatchTransferCopy> = {',
    'const growthBatchHarvestCopy: Record<Locale, GrowthBatchHarvestCopy> = {': 'export const growthBatchHarvestCopy: Record<Locale, GrowthBatchHarvestCopy> = {',
    'const growthBatchCompletionCopy: Record<Locale, GrowthBatchCompletionCopy> = {': 'export const growthBatchCompletionCopy: Record<Locale, GrowthBatchCompletionCopy> = {',
}
exported_block = block
for old, new in exports.items():
    exported_block = exported_block.replace(old, new, 1)

module = (
    "import type { Locale } from './i18n'\n"
    "import type { TransferReasonCode } from './growthBatchTypes'\n\n"
    + exported_block.rstrip()
    + '\n'
)

copy_import = """import {
  harvestBlockerCodes,
  transferBlockerCodes,
  completionBlockerCodes,
  growthBatchTransferCopy,
  growthBatchHarvestCopy,
  growthBatchCompletionCopy,
  type GrowthBatchHarvestBlockerCode,
  type GrowthBatchTransferBlockerCode,
  type GrowthBatchCompletionBlockerCode,
  type GrowthBatchHarvestCopy,
  type GrowthBatchTransferCopy,
  type GrowthBatchCompletionCopy,
} from '../lib/growthBatchCopy'

"""

updated = text[:start] + text[end:]
updated = updated.replace(import_anchor, import_anchor + copy_import, 1)

for token in required_tokens:
    if token in updated:
        raise SystemExit(f'page still contains extracted token {token!r}')
for name in [
    'harvestBlockerCodes', 'transferBlockerCodes', 'completionBlockerCodes',
    'growthBatchTransferCopy', 'growthBatchHarvestCopy', 'growthBatchCompletionCopy',
    'GrowthBatchHarvestBlockerCode', 'GrowthBatchTransferBlockerCode', 'GrowthBatchCompletionBlockerCode',
    'GrowthBatchHarvestCopy', 'GrowthBatchTransferCopy', 'GrowthBatchCompletionCopy',
]:
    if name not in updated:
        raise SystemExit(f'page lost expected imported usage {name}')

module_path.write_text(module, encoding='utf-8')
page_path.write_text(updated, encoding='utf-8')

print(f'extracted {block.count(chr(10)) + 1} static copy lines into {module_path}')
