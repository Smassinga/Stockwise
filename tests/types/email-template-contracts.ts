import type {
  CompanyAccessExpiryEmailInput,
  DailyDigestEmailInput,
  MemberInviteEmailInput,
  ReportReadyEmailInput,
} from '../../supabase/functions/_shared/emailTemplates.ts'

const brand = { companyName: 'QA Company' }

const invite: MemberInviteEmailInput = { templateKey: 'member_invite', brand, role: 'MANAGER', actionUrl: 'https://stockwiseapp.com/accept' }
// @ts-expect-error invitations cannot accept operational metrics
invite.metrics = { operationalSales: 100 }

const digest: DailyDigestEmailInput = { templateKey: 'daily_digest', brand, period: 'today', actionUrl: 'https://stockwiseapp.com/dashboard', metrics: { operationalSales: 100, knownCogs: 50, grossProfit: 50, grossMargin: 50, transactions: 1, openOrders: 0, lowStockItems: 0, outOfStockItems: 0, missingCostEvidence: 0, topProductsServices: [], currencyCode: 'MZN' } }
// @ts-expect-error digests cannot accept invitation roles
digest.role = 'MANAGER'

const report: ReportReadyEmailInput = { templateKey: 'report_ready', brand, reportName: 'Performance', period: 'July', actionUrl: 'https://stockwiseapp.com/reports' }
// @ts-expect-error reports cannot accept reminder balances
report.outstandingAmount = 100

const expiry: CompanyAccessExpiryEmailInput = { templateKey: 'company_access_expiry', brand, accessEndsAt: '2026-08-15', supportEmail: 'support@example.invalid' }
// @ts-expect-error access messages cannot accept document references
expiry.documentReference = 'QA-SO-1'
