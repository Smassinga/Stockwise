from pathlib import Path
import re

page_path = Path('src/pages/GrowthBatches.tsx')
types_path = Path('src/lib/growthBatchTypes.ts')

text = page_path.read_text()
start_marker = "type BatchFamily = 'poultry' | 'livestock' | 'fish' | 'crop' | 'nursery' | 'other'\n"
end_marker = "\nconst batchFamilies: BatchFamily[] = ['poultry', 'livestock', 'fish', 'crop', 'nursery', 'other']"

if text.count(start_marker) != 1:
    raise SystemExit(f'GrowthBatches: expected one type-region start, found {text.count(start_marker)}')
if text.count(end_marker) != 1:
    raise SystemExit(f'GrowthBatches: expected one type-region end, found {text.count(end_marker)}')

start = text.index(start_marker)
end = text.index(end_marker, start)
region = text[start:end]

for guard in (
    'type GrowthBatchRegisterRow =',
    'type GrowthBatchCurrentState =',
    'type GrowthBatchHarvestRow =',
    'type StockInputPreview =',
    'type CompletionReversalForm =',
):
    if guard not in region:
        raise SystemExit(f'GrowthBatches: missing type-region guard {guard}')

if re.search(r'^\s*(const|let|function|class)\s+', region, flags=re.MULTILINE):
    raise SystemExit('GrowthBatches: runtime declaration found inside intended type-only region')

names = re.findall(r'^type\s+([A-Za-z0-9_]+)\s*=', region, flags=re.MULTILINE)
if len(names) < 30:
    raise SystemExit(f'GrowthBatches: unexpectedly small extracted type set ({len(names)})')
if len(names) != len(set(names)):
    raise SystemExit('GrowthBatches: duplicate type names found in extraction region')

exported_region = re.sub(r'^type\s+', 'export type ', region, flags=re.MULTILINE)
types_path.write_text(
    "// Growth-batch workspace data, form, and preview contracts.\n"
    "// Runtime posting, stock, costing, and lifecycle behavior remains in the workspace/domain layers.\n\n"
    + exported_region.strip()
    + "\n"
)

remaining_without_region = text[:start] + text[end:]
used_names = [name for name in names if re.search(rf'\b{re.escape(name)}\b', remaining_without_region)]
if not used_names:
    raise SystemExit('GrowthBatches: extracted types are not referenced by the remaining page')

import_lines = ["import type {"]
import_lines.extend(f"  {name}," for name in used_names)
import_lines.append("} from '../lib/growthBatchTypes'")
import_block = "\n".join(import_lines) + "\n\n"

page_text = text[:start] + import_block + text[end + 1:]
page_path.write_text(page_text)

print(f'Extracted {len(names)} types; GrowthBatches imports {len(used_names)} of them.')
