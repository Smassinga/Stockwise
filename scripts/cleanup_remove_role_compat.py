import re
from pathlib import Path

BASE_ROLES = '''// src/lib/roles.ts
// Compatibility shim so legacy imports keep working.
// We rely on the canonical definitions in permissions.ts.

export type { CompanyRole } from './permissions';
export { hasRole, hasMinRole } from './permissions';

// Re-export additional functions needed by Users.tsx
import { hasMinRole as _hasMinRole, type CompanyRole } from './permissions';

// Role bound checks for user management flows
export function canAssignRole(actor: CompanyRole | null | undefined, target: CompanyRole): boolean {
  const a = actor ?? 'VIEWER';
  // Owner can assign anything
  if (a === 'OWNER') return true;
  if (a === 'ADMIN') return ['VIEWER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(target);
  if (a === 'MANAGER') return ['VIEWER', 'OPERATOR', 'MANAGER'].includes(target);
  return false;
}

export function canInviteRole(actor: CompanyRole | null | undefined, target: CompanyRole): boolean {
  // same logic as assignment
  return canAssignRole(actor, target);
}

// MANAGER+ can manage users, per your policy model
export const CanManageUsers: readonly ('MANAGER' | 'ADMIN' | 'OWNER')[] = [
  'MANAGER',
  'ADMIN',
  'OWNER',
];
'''

EXPECTED_IMPORTERS = {
    'src/App.tsx',
    'src/components/layout/AppLayout.tsx',
    'src/hooks/useOrg.tsx',
    'src/pages/BankDetail.tsx',
    'src/pages/Banks.tsx',
    'src/pages/GrowthBatches.tsx',
    'src/pages/ProductionRuns.tsx',
    'src/pages/Users.tsx',
}

ROLE_IMPORT_RE = re.compile(
    r"^(?P<prefix>\s*import\b[^\n]*\bfrom\s+)(?P<quote>['\"])(?P<module>(?:\.\.?/)+lib/roles)(?P=quote)(?P<suffix>\s*;?\s*)$",
    re.MULTILINE,
)
ROLE_DYNAMIC_IMPORT_RE = re.compile(
    r"(?P<prefix>\bimport\(\s*)(?P<quote>['\"])(?P<module>(?:\.\.?/)+lib/roles)(?P=quote)(?P<suffix>\s*\))"
)


def normalize_text(value: str) -> str:
    return value.replace('\r\n', '\n').rstrip('\n')


roles_path = Path('src/lib/roles.ts')
if not roles_path.exists():
    raise SystemExit('legacy roles.ts is already absent')
if normalize_text(roles_path.read_text(encoding='utf-8')) != normalize_text(BASE_ROLES):
    raise SystemExit('roles.ts changed from the reviewed compatibility shim; refusing mechanical migration')

permissions_path = Path('src/lib/permissions.ts')
permissions = permissions_path.read_text(encoding='utf-8')
if 'export function canAssignRole' in permissions or 'CanManageUsers' in permissions:
    raise SystemExit('canonical permissions already contains migrated role helpers')
marker = 'export function isFinanceDraftEditable(\n'
if permissions.count(marker) != 1:
    raise SystemExit('permissions insertion marker is not unique')

source_matches: dict[Path, list[re.Match[str]]] = {}
dynamic_matches: dict[Path, list[re.Match[str]]] = {}
for source_path in Path('src').rglob('*'):
    if not source_path.is_file() or source_path.suffix not in {'.ts', '.tsx'} or source_path == roles_path:
        continue
    source = source_path.read_text(encoding='utf-8')
    imports = list(ROLE_IMPORT_RE.finditer(source))
    dynamic_imports = list(ROLE_DYNAMIC_IMPORT_RE.finditer(source))
    if imports:
        source_matches[source_path] = imports
    if dynamic_imports:
        dynamic_matches[source_path] = dynamic_imports

actual_importers = {path.as_posix() for path in source_matches}
if actual_importers != EXPECTED_IMPORTERS:
    missing = sorted(EXPECTED_IMPORTERS - actual_importers)
    unexpected = sorted(actual_importers - EXPECTED_IMPORTERS)
    raise SystemExit(f'legacy role importer set changed; missing={missing}, unexpected={unexpected}')

top_level_counts = {path.as_posix(): len(matches) for path, matches in source_matches.items()}
if any(count != 1 for count in top_level_counts.values()):
    raise SystemExit(f'each reviewed importer must contain exactly one top-level legacy role import; counts={top_level_counts}')

dynamic_counts = {path.as_posix(): len(matches) for path, matches in dynamic_matches.items()}
if dynamic_counts != {'src/pages/Users.tsx': 4}:
    raise SystemExit(f'legacy dynamic role import set changed; counts={dynamic_counts}')

doc_path = Path('docs/DATA_MODEL.md')
doc = doc_path.read_text(encoding='utf-8')
old_doc = '- company role definitions are exposed in the app under Users > Role definitions and must stay aligned with the checks in `src/lib/roles.ts` and `src/lib/permissions.ts`'
new_doc = '- company role definitions are exposed in the app under Users > Role definitions and must stay aligned with the canonical checks in `src/lib/permissions.ts`'
if doc.count(old_doc) != 1:
    raise SystemExit('DATA_MODEL role reference marker is not unique')

role_helpers = '''// User-management role bounds. Keep these aligned with the canonical CompanyRole ranking above.
export function canAssignRole(actor: CompanyRole | null | undefined, target: CompanyRole): boolean {
  const a = actor ?? 'VIEWER'
  if (a === 'OWNER') return true
  if (a === 'ADMIN') return ['VIEWER', 'OPERATOR', 'MANAGER', 'ADMIN'].includes(target)
  if (a === 'MANAGER') return ['VIEWER', 'OPERATOR', 'MANAGER'].includes(target)
  return false
}

export function canInviteRole(actor: CompanyRole | null | undefined, target: CompanyRole): boolean {
  return canAssignRole(actor, target)
}

export const CanManageUsers: readonly ('MANAGER' | 'ADMIN' | 'OWNER')[] = [
  'MANAGER',
  'ADMIN',
  'OWNER',
]

'''
permissions_path.write_text(permissions.replace(marker, role_helpers + marker, 1), encoding='utf-8')

for source_path in set(source_matches) | set(dynamic_matches):
    source = source_path.read_text(encoding='utf-8')
    updated, top_level_count = ROLE_IMPORT_RE.subn(
        lambda match: f"{match.group('prefix')}{match.group('quote')}{match.group('module')[:-len('/roles')]}/permissions{match.group('quote')}{match.group('suffix')}",
        source,
    )
    updated, dynamic_count = ROLE_DYNAMIC_IMPORT_RE.subn(
        lambda match: f"{match.group('prefix')}{match.group('quote')}{match.group('module')[:-len('/roles')]}/permissions{match.group('quote')}{match.group('suffix')}",
        updated,
    )
    expected_top_level = len(source_matches.get(source_path, []))
    expected_dynamic = len(dynamic_matches.get(source_path, []))
    if top_level_count != expected_top_level or dynamic_count != expected_dynamic:
        raise SystemExit(
            f'{source_path}: role import replacement mismatch; '
            f'top_level={top_level_count}/{expected_top_level}, dynamic={dynamic_count}/{expected_dynamic}'
        )
    source_path.write_text(updated, encoding='utf-8')

remaining = []
for source_path in Path('src').rglob('*'):
    if not source_path.is_file() or source_path.suffix not in {'.ts', '.tsx'} or source_path == roles_path:
        continue
    source = source_path.read_text(encoding='utf-8')
    if ROLE_IMPORT_RE.search(source) or ROLE_DYNAMIC_IMPORT_RE.search(source):
        remaining.append(source_path.as_posix())
if remaining:
    raise SystemExit(f'legacy executable role imports remain: {remaining}')

roles_path.unlink()
doc_path.write_text(doc.replace(old_doc, new_doc, 1), encoding='utf-8')

print('migrated 8 top-level and 4 dynamic legacy role references to canonical permissions.ts')
