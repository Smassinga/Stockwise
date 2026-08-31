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
    r"(?P<prefix>\bfrom\s+|\bimport\(\s*)(?P<quote>['\"])(?P<module>(?:\.\.?/)+lib/roles)(?P=quote)"
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
for source_path in Path('src').rglob('*'):
    if not source_path.is_file() or source_path.suffix not in {'.ts', '.tsx'} or source_path == roles_path:
        continue
    source = source_path.read_text(encoding='utf-8')
    matches = list(ROLE_IMPORT_RE.finditer(source))
    if matches:
        source_matches[source_path] = matches

actual_importers = {path.as_posix() for path in source_matches}
if actual_importers != EXPECTED_IMPORTERS:
    missing = sorted(EXPECTED_IMPORTERS - actual_importers)
    unexpected = sorted(actual_importers - EXPECTED_IMPORTERS)
    raise SystemExit(f'legacy role importer set changed; missing={missing}, unexpected={unexpected}')

if any(len(matches) != 1 for matches in source_matches.values()):
    counts = {path.as_posix(): len(matches) for path, matches in source_matches.items()}
    raise SystemExit(f'each reviewed importer must contain exactly one legacy role import; counts={counts}')

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

for source_path in source_matches:
    source = source_path.read_text(encoding='utf-8')
    updated, count = ROLE_IMPORT_RE.subn(
        lambda match: f"{match.group('prefix')}{match.group('quote')}{match.group('module')[:-len('/roles')]}/permissions{match.group('quote')}",
        source,
    )
    if count != 1:
        raise SystemExit(f'{source_path}: expected one structural role import replacement, found {count}')
    source_path.write_text(updated, encoding='utf-8')

remaining = []
for source_path in Path('src').rglob('*'):
    if not source_path.is_file() or source_path.suffix not in {'.ts', '.tsx'} or source_path == roles_path:
        continue
    if ROLE_IMPORT_RE.search(source_path.read_text(encoding='utf-8')):
        remaining.append(source_path.as_posix())
if remaining:
    raise SystemExit(f'legacy role imports remain: {remaining}')

roles_path.unlink()
doc_path.write_text(doc.replace(old_doc, new_doc, 1), encoding='utf-8')

print(f'migrated {len(source_matches)} reviewed legacy role importers to canonical permissions.ts')
