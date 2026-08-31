import {
  listFinanceActorDirectory,
  listFinanceSettlementAuditEvents,
  type FinanceActorDirectory,
  type FinanceSettlementAuditEvent,
} from './financeAudit'

export type FinanceAuditDocumentKind = 'sales_invoice' | 'vendor_bill'

export type FinanceAuditContext = {
  actorDirectory: FinanceActorDirectory
  settlementEvents: FinanceSettlementAuditEvent[]
}

export async function loadFinanceAuditContext(input: {
  companyId: string
  actorIds: string[]
  documentKind: FinanceAuditDocumentKind
  documentId: string
  includeSettlementEvents: boolean
}): Promise<FinanceAuditContext> {
  const [actorDirectory, settlementEvents] = await Promise.all([
    listFinanceActorDirectory(input.companyId, input.actorIds),
    input.includeSettlementEvents
      ? listFinanceSettlementAuditEvents(input.companyId, input.documentKind, input.documentId)
      : Promise.resolve([] as FinanceSettlementAuditEvent[]),
  ])

  return {
    actorDirectory,
    settlementEvents,
  }
}
