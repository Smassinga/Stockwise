from pathlib import Path
import re

page_path = Path('src/pages/GrowthBatches.tsx')
types_path = Path('src/lib/growthBatchTypes.ts')
config_path = Path('src/lib/growthBatchConfig.ts')

text = page_path.read_text()
types_text = types_path.read_text()

start_marker = "const batchFamilies: BatchFamily[] = ['poultry', 'livestock', 'fish', 'crop', 'nursery', 'other']\n"
end_marker = "\nconst today = () => new Date().toISOString().slice(0, 10)"

if text.count(start_marker) != 1:
    raise SystemExit(f'GrowthBatches: expected one config start, found {text.count(start_marker)}')
if text.count(end_marker) != 1:
    raise SystemExit(f'GrowthBatches: expected one config end, found {text.count(end_marker)}')

start = text.index(start_marker)
end = text.index(end_marker, start)
region = text[start:end]

for guard in (
    'const harvestBlockerCodes = [',
    'const transferBlockerCodes = [',
    'const completionBlockerCodes = [',
    'const growthBatchTransferCopy:',
    'const growthBatchHarvestCopy:',
    'const growthBatchCompletionCopy:',
    'const basisFamily:',
):
    if guard not in region:
        raise SystemExit(f'GrowthBatches: missing static-config guard {guard}')

for forbidden in (
    r'^\s*function\s+',
    r'^\s*class\s+',
    r'^\s*let\s+',
    r'^\s*var\s+',
    r'\bsupabase\b',
    r'\buseState\b',
    r'\buseEffect\b',
    r'\buseMemo\b',
    r'\buseCallback\b',
    r'\btoast\b',
    r'\bwindow\b',
    r'\bdocument\b',
    r'\bcrypto\b',
):
    if re.search(forbidden, region, flags=re.MULTILINE):
        raise SystemExit(f'GrowthBatches: runtime dependency found in static config: {forbidden}')

const_names = re.findall(r'^const\s+([A-Za-z0-9_]+)', region, flags=re.MULTILINE)
type_names = re.findall(r'^type\s+([A-Za-z0-9_]+)\s*=', region, flags=re.MULTILINE)
declaration_names = const_names + type_names
if len(const_names) < 10 or len(type_names) < 3:
    raise SystemExit(f'GrowthBatches: unexpectedly small config declaration set ({len(const_names)} const, {len(type_names)} type)')
if len(declaration_names) != len(set(declaration_names)):
    raise SystemExit('GrowthBatches: duplicate config declaration names')

# Build only the type dependencies used by the extracted static region.
growth_type_names = re.findall(r'^export type\s+([A-Za-z0-9_]+)\s*=', types_text, flags=re.MULTILINE)
config_growth_types = [name for name in growth_type_names if re.search(rf'\b{re.escape(name)}\b', region)]

config_imports = []
if config_growth_types:
    config_imports.append("import type {\n" + "\n".join(f"  {name}," for name in config_growth_types) + "\n} from './growthBatchTypes'")
if re.search(r'\bLocale\b', region):
    config_imports.append("import type { Locale } from './i18n'")
if re.search(r'\bPremiumTone\b', region):
    config_imports.append("import type { PremiumTone } from '../components/premium/PremiumStatusBadge'")

exported_region = re.sub(r'^const\s+', 'export const ', region, flags=re.MULTILINE)
exported_region = re.sub(r'^type\s+', 'export type ', exported_region, flags=re.MULTILINE)
config_path.write_text(
    "// Static Growth Batches options, blocker-code sets, localized copy, and presentation maps.\n"
    "// This module contains no posting, stock, costing, lifecycle, Supabase, or React state behavior.\n\n"
    + ("\n".join(config_imports) + "\n\n" if config_imports else "")
    + exported_region.strip()
    + "\n"
)

# Remove the static block from the page, leaving the first runtime helper untouched.
remaining = text[:start] + text[end + 1:]

# Regenerate the existing growthBatchTypes import so types used only by config do not stay imported in the page.
page_growth_types = [name for name in growth_type_names if re.search(rf'\b{re.escape(name)}\b', remaining)]
type_import_pattern = re.compile(r"import type \{\n.*?\n\} from '../lib/growthBatchTypes'\n", flags=re.DOTALL)
match = type_import_pattern.search(remaining)
if not match:
    raise SystemExit('GrowthBatches: existing growthBatchTypes import block not found')
new_type_import = "import type {\n" + "\n".join(f"  {name}," for name in page_growth_types) + "\n} from '../lib/growthBatchTypes'\n"
remaining = remaining[:match.start()] + new_type_import + remaining[match.end():]

# Import only extracted config declarations still used by the page runtime/helpers.
page_config_names = [name for name in declaration_names if re.search(rf'\b{re.escape(name)}\b', remaining)]
if not page_config_names:
    raise SystemExit('GrowthBatches: no extracted config declarations are referenced by the remaining page')
config_import = "import {\n" + "\n".join(f"  {name}," for name in page_config_names) + "\n} from '../lib/growthBatchConfig'\n"
insert_after = new_type_import
if remaining.count(insert_after) != 1:
    raise SystemExit('GrowthBatches: regenerated type import insertion anchor mismatch')
remaining = remaining.replace(insert_after, insert_after + config_import, 1)

# Remove type-only imports that became unused by the page after the static block moved.
if not re.search(r'\bPremiumTone\b', remaining[remaining.find(config_import) + len(config_import):]):
    remaining = remaining.replace(
        "import { PremiumStatusBadge, type PremiumTone } from '../components/premium/PremiumStatusBadge'",
        "import { PremiumStatusBadge } from '../components/premium/PremiumStatusBadge'",
        1,
    )
if not re.search(r'\bLocale\b', remaining[remaining.find(config_import) + len(config_import):]):
    remaining = remaining.replace(
        "import { useI18n, withI18nFallback, type Locale } from '../lib/i18n'",
        "import { useI18n, withI18nFallback } from '../lib/i18n'",
        1,
    )

page_path.write_text(remaining)
print(
    f'Extracted {len(const_names)} static constants and {len(type_names)} config types; '
    f'page imports {len(page_config_names)} config declarations.'
)
