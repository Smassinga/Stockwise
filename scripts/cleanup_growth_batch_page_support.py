from pathlib import Path
import re

page_path = Path('src/pages/GrowthBatches.tsx')
module_path = Path('src/pages/growthBatches/growthBatchPageSupport.ts')
text = page_path.read_text(encoding='utf-8')

start_marker = "const batchFamilies: BatchFamily[] ="
end_marker = "function Field({"

if text.count(start_marker) != 1:
    raise SystemExit(f'expected one support-block start marker, found {text.count(start_marker)}')
if text.count(end_marker) != 1:
    raise SystemExit(f'expected one support-block end marker, found {text.count(end_marker)}')
if module_path.exists():
    raise SystemExit(f'{module_path} already exists')

start = text.index(start_marker)
end = text.index(end_marker, start)
block = text[start:end]

required_tokens = [
    'const batchFamilies: BatchFamily[] =',
    'const statusTone: Record<BatchStatus, PremiumTone> =',
    "const eventTone: Record<GrowthBatchEventRow['event_type'], PremiumTone> =",
    'const basisFamily: Record<QuantityBasis, string | null> =',
    'function eventSummaryLabel(',
    'function isGrowthBatchTransferBlockerCode(',
    'function isGrowthBatchHarvestBlockerCode(',
    'function isGrowthBatchCompletionBlockerCode(',
    'function emptyDraftForm(): DraftForm',
    'function emptyStockInputLine(): StockInputLineForm',
    'function emptyCompletionReversalForm(): CompletionReversalForm',
    'function friendlyError(',
]
for token in required_tokens:
    if block.count(token) != 1:
        raise SystemExit(f'expected exactly one {token!r}, found {block.count(token)}')

for forbidden in [
    'supabase.',
    '.rpc(',
    '.from(',
    'stablePostingFingerprint',
    'getPostingRequestKeyForFingerprint',
    'clearPostingRequestKey',
    'toast.',
    'setState(',
    'useState(',
    'useEffect(',
    'useCallback(',
]:
    if forbidden in block:
        raise SystemExit(f'support block unexpectedly contains behavior marker {forbidden!r}')

# Export each top-level support declaration without changing its body.
exported_block = re.sub(r'(?m)^const ([A-Za-z_][A-Za-z0-9_]*)', r'export const \1', block)
exported_block = re.sub(r'(?m)^function ([A-Za-z_][A-Za-z0-9_]*)', r'export function \1', exported_block)

declaration_names = re.findall(r'(?m)^(?:const|function) ([A-Za-z_][A-Za-z0-9_]*)', block)
if len(declaration_names) < 25:
    raise SystemExit(f'expected a substantial support block; only found {len(declaration_names)} declarations')

module_imports = """import type { Locale } from '../../lib/i18n'
import type { PremiumTone } from '../../components/premium/PremiumStatusBadge'
import {
  harvestBlockerCodes,
  transferBlockerCodes,
  completionBlockerCodes,
  type GrowthBatchHarvestBlockerCode,
  type GrowthBatchTransferBlockerCode,
  type GrowthBatchCompletionBlockerCode,
  type GrowthBatchHarvestCopy,
  type GrowthBatchTransferCopy,
  type GrowthBatchCompletionCopy,
} from '../../lib/growthBatchCopy'
import type {
  BatchFamily,
  QuantityBasis,
  BatchStatus,
  MeasurementType,
  DirectCostCategory,
  LossReasonCode,
  TransferReasonCode,
  GrowthBatchEventRow,
  DraftForm,
  MeasurementForm,
  DirectCostForm,
  StockInputLineForm,
  StockInputForm,
  LossForm,
  ReversalForm,
  LossReversalForm,
  TransferForm,
  TransferReversalForm,
  HarvestForm,
  HarvestReversalForm,
  CompletionForm,
  CompletionReversalForm,
} from '../../lib/growthBatchTypes'

"""
module_path.parent.mkdir(parents=True, exist_ok=True)
module_path.write_text(module_imports + exported_block.rstrip() + '\n', encoding='utf-8')

updated = text[:start] + text[end:]

# The support module now owns Locale/PremiumTone and blocker registries/types.
updated = updated.replace(
    "import { useI18n, withI18nFallback, type Locale } from '../lib/i18n'",
    "import { useI18n, withI18nFallback } from '../lib/i18n'",
    1,
)
updated = updated.replace(
    "import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'",
    "import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'",
    1,
)

copy_import_pattern = re.compile(
    r"import \{\n"
    r"  harvestBlockerCodes,\n"
    r"  transferBlockerCodes,\n"
    r"  completionBlockerCodes,\n"
    r"  growthBatchTransferCopy,\n"
    r"  growthBatchHarvestCopy,\n"
    r"  growthBatchCompletionCopy,\n"
    r"  type GrowthBatchHarvestBlockerCode,\n"
    r"  type GrowthBatchTransferBlockerCode,\n"
    r"  type GrowthBatchCompletionBlockerCode,\n"
    r"  type GrowthBatchHarvestCopy,\n"
    r"  type GrowthBatchTransferCopy,\n"
    r"  type GrowthBatchCompletionCopy,\n"
    r"\} from '../lib/growthBatchCopy'\n"
)
copy_match = copy_import_pattern.search(updated)
if not copy_match:
    raise SystemExit('expected current growthBatchCopy import block was not found')
copy_import = """import {
  growthBatchTransferCopy,
  growthBatchHarvestCopy,
  growthBatchCompletionCopy,
  type GrowthBatchHarvestCopy,
  type GrowthBatchTransferCopy,
  type GrowthBatchCompletionCopy,
} from '../lib/growthBatchCopy'
"""
updated = updated[:copy_match.start()] + copy_import + updated[copy_match.end():]

# Keep only Growth Batch type imports still referenced by the page after extraction.
types_pattern = re.compile(r"import type \{\n(?P<body>.*?)\n\} from '../lib/growthBatchTypes'\n", re.S)
types_match = types_pattern.search(updated)
if not types_match:
    raise SystemExit('growthBatchTypes import block not found')
imported_types = [line.strip().rstrip(',') for line in types_match.group('body').splitlines() if line.strip()]
without_types_import = updated[:types_match.start()] + updated[types_match.end():]
kept_types = [name for name in imported_types if re.search(rf'\b{re.escape(name)}\b', without_types_import)]
if not kept_types:
    raise SystemExit('unexpectedly removed every growthBatchTypes import')
rebuilt_types = "import type {\n" + ''.join(f'  {name},\n' for name in kept_types) + "} from '../lib/growthBatchTypes'\n"
updated = updated[:types_match.start()] + rebuilt_types + updated[types_match.end():]

# Import only support declarations actually referenced by the remaining page.
referenced = [name for name in declaration_names if re.search(rf'\b{re.escape(name)}\b', updated)]
if len(referenced) < 15:
    raise SystemExit(f'expected many page support references; only found {len(referenced)}')
support_import = "import {\n" + ''.join(f'  {name},\n' for name in referenced) + "} from './growthBatches/growthBatchPageSupport'\n\n"
anchor = copy_import + '\n'
if updated.count(anchor) != 1:
    raise SystemExit(f'expected one support import anchor, found {updated.count(anchor)}')
updated = updated.replace(anchor, anchor + support_import, 1)

# The page must no longer define any extracted declaration.
for name in declaration_names:
    if re.search(rf'(?m)^(?:const|function) {re.escape(name)}\b', updated):
        raise SystemExit(f'page still defines extracted support declaration {name}')

page_path.write_text(updated, encoding='utf-8')
print(f'extracted {len(declaration_names)} page-support declarations; page imports {len(referenced)} of them')
