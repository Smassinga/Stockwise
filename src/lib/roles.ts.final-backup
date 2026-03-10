// src/lib/roles.ts
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