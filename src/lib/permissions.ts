// src/lib/permissions.ts
export type CompanyRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'VIEWER'
export type FinanceApprovalStatus = 'draft' | 'pending_approval' | 'approved'

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

export function hasRole(role: CompanyRole | null | undefined, allowed: readonly CompanyRole[]): boolean {
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

export const financeCan = {
  createDraft: (r: CompanyRole | null | undefined) => hasMinRole(r, 'OPERATOR'),
  editDraft: (r: CompanyRole | null | undefined) => hasMinRole(r, 'OPERATOR'),
  submitForApproval: (r: CompanyRole | null | undefined) => hasMinRole(r, 'OPERATOR'),
  approve: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
  issueSalesInvoice: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
  postVendorBill: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
  voidDraft: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
  voidIssuedOrPosted: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
  issueSalesAdjustment: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
  postVendorAdjustment: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
  settlementSensitive: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
  reminderSettings: (r: CompanyRole | null | undefined) => hasMinRole(r, 'ADMIN'),
}

export function isFinanceDraftEditable(
  role: CompanyRole | null | undefined,
  approvalStatus: FinanceApprovalStatus | null | undefined,
) {
  return approvalStatus === 'draft' && financeCan.editDraft(role)
}

