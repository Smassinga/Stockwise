// src/lib/permissions.ts
export type CompanyRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'

// Lower number = more privileged
export const RoleRank: Record<CompanyRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  MANAGER: 2,
  OPERATOR: 3,
  VIEWER: 4,
}

export function hasMinRole(role: CompanyRole | null | undefined, min: CompanyRole): boolean {
  if (!role) return false
  return RoleRank[role] <= RoleRank[min]
}

export function hasRole(role: CompanyRole | null | undefined, allowed: CompanyRole[]): boolean {
  if (!role) return false
  return allowed.includes(role)
}

// App capabilities (mirrors your DB/RLS)
export const can = {
  createItem:     (r: CompanyRole | null | undefined) => hasMinRole(r, 'OPERATOR'),
  updateItem:     (r: CompanyRole | null | undefined) => hasMinRole(r, 'OPERATOR'),
  deleteItem:     (r: CompanyRole | null | undefined) => hasMinRole(r, 'MANAGER'),

  createMovement: (r: CompanyRole | null | undefined) => hasMinRole(r, 'OPERATOR'),
  deleteMovement: (r: CompanyRole | null | undefined) => hasMinRole(r, 'MANAGER'),

  createMaster:   (r: CompanyRole | null | undefined) => hasMinRole(r, 'OPERATOR'),
  updateMaster:   (r: CompanyRole | null | undefined) => hasMinRole(r, 'OPERATOR'),
  deleteMaster:   (r: CompanyRole | null | undefined) => hasMinRole(r, 'MANAGER'),

  exportReports:  (r: CompanyRole | null | undefined) => hasMinRole(r, 'VIEWER'),

  manageUsers:      (r: CompanyRole | null | undefined) => hasMinRole(r, 'MANAGER'),
  manageWarehouses: (r: CompanyRole | null | undefined) => hasMinRole(r, 'MANAGER'),
}
