// src/lib/enums.ts
export const MEMBER_STATUS = ['invited', 'active', 'disabled'] as const;
export type MemberStatus = (typeof MEMBER_STATUS)[number];

export const MEMBER_ROLE = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'] as const;
export type MemberRole = (typeof MEMBER_ROLE)[number];