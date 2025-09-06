// src/lib/roles.ts
export type CompanyRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER';

export const RoleRank: Record<CompanyRole, number> = {
  OWNER: 40,
  ADMIN: 30,
  MANAGER: 20,
  OPERATOR: 10,
  VIEWER: 0,
};

// Sorted low→high helps when you want ordered UI lists, etc.
export const AllRoles: CompanyRole[] = ['VIEWER', 'OPERATOR', 'MANAGER', 'ADMIN', 'OWNER'];

// Utility: build a list of roles at/above a minimum
export function rolesAtOrAbove(min: CompanyRole): CompanyRole[] {
  return AllRoles.filter(r => RoleRank[r] >= RoleRank[min]);
}

/** True if the current role meets/exceeds the minimum role */
export function hasMinRole(current: CompanyRole | null | undefined, min: CompanyRole) {
  const cur = current ?? 'VIEWER';
  return RoleRank[cur] >= RoleRank[min];
}

/** Flexible checker:
 *  - hasRole(current, 'MANAGER')  -> rank comparison
 *  - hasRole(current, ['OWNER','ADMIN','MANAGER']) -> membership in list
 */
export function hasRole(
  current: CompanyRole | null | undefined,
  guard: CompanyRole | readonly CompanyRole[]
): boolean;
export function hasRole(
  current: CompanyRole | null | undefined,
  guard: CompanyRole | readonly CompanyRole[]
): boolean {
  const cur = current ?? 'VIEWER';
  return Array.isArray(guard)
    ? (guard as readonly CompanyRole[]).includes(cur)
    : RoleRank[cur] >= RoleRank[guard as CompanyRole];
}

// -------- Policy “minimums” (keep your original semantics) --------
export const CanManageUsersMin: CompanyRole  = 'MANAGER';  // MANAGER+
export const CanCreateMasterMin: CompanyRole = 'OPERATOR'; // OPERATOR+
export const CanDeleteMasterMin: CompanyRole = 'MANAGER';  // MANAGER+
export const CanCreateItemMin: CompanyRole   = 'OPERATOR';
export const CanDeleteItemMin: CompanyRole   = 'MANAGER';

// -------- Array forms (for <RequireOrgRole allowed={...}> etc.) --------
export const CanManageUsers: CompanyRole[]  = rolesAtOrAbove(CanManageUsersMin);
export const CanCreateMaster: CompanyRole[] = rolesAtOrAbove(CanCreateMasterMin);
export const CanDeleteMaster: CompanyRole[] = rolesAtOrAbove(CanDeleteMasterMin);
export const CanCreateItem: CompanyRole[]   = rolesAtOrAbove(CanCreateItemMin);
export const CanDeleteItem: CompanyRole[]   = rolesAtOrAbove(CanDeleteItemMin);

// Convenience helpers sometimes imported in UI
export function isManagerPlus(r: CompanyRole | null | undefined) {
  return hasMinRole(r, 'MANAGER');
}
export function isOperatorPlus(r: CompanyRole | null | undefined) {
  return hasMinRole(r, 'OPERATOR');
}
