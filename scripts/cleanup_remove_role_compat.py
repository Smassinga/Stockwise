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
marker = '''export function isFinanceDraftEditable(
'''
if permissions.count(marker) != 1:
    raise SystemExit('permissions insertion marker is not unique')
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
permissions = permissions.replace(marker, role_helpers + marker, 1)
permissions_path.write_text(permissions, encoding='utf-8')

replacements = 0
for source_path in Path('src').rglob('*'):
    if not source_path.is_file() or source_path.suffix not in {'.ts', '.tsx'} or source_path == roles_path:
        continue
    source = source_path.read_text(encoding='utf-8')
    updated = source.replace("'./lib/roles'", "'./lib/permissions'")
    updated = updated.replace('"./lib/roles"', '"./lib/permissions"')
    updated = updated.replace("'../lib/roles'", "'../lib/permissions'")
    updated = updated.replace('"../lib/roles"', '"../lib/permissions"')
    updated = updated.replace("'../../lib/roles'", "'../../lib/permissions'")
    updated = updated.replace('"../../lib/roles"', '"../../lib/permissions"')
    if updated != source:
        replacements += source.count('/roles')
        source_path.write_text(updated, encoding='utf-8')

if replacements != 8:
    raise SystemExit(f'expected 8 live role-import replacements, found {replacements}')

remaining = []
for source_path in Path('src').rglob('*'):
    if not source_path.is_file() or source_path.suffix not in {'.ts', '.tsx'} or source_path == roles_path:
        continue
    source = source_path.read_text(encoding='utf-8')
    if '/roles' in source:
        remaining.append(str(source_path))
if remaining:
    raise SystemExit(f'legacy role imports remain: {remaining}')

roles_path.unlink()

doc_path = Path('docs/DATA_MODEL.md')
doc = doc_path.read_text(encoding='utf-8')
old = '- company role definitions are exposed in the app under Users > Role definitions and must stay aligned with the checks in `src/lib/roles.ts` and `src/lib/permissions.ts`'
new = '- company role definitions are exposed in the app under Users > Role definitions and must stay aligned with the canonical checks in `src/lib/permissions.ts`'
if doc.count(old) != 1:
    raise SystemExit('DATA_MODEL role reference marker is not unique')
doc_path.write_text(doc.replace(old, new, 1), encoding='utf-8')

print(f'migrated {replacements} legacy role imports to canonical permissions.ts')
