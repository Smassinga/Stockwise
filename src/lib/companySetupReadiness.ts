import { can, financeCan, hasMinRole, type CompanyRole } from './permissions'
import type { CommercialTaxConfiguration } from './commercialTax'
import type { CompanyFiscalSettingsRow, FinanceDocumentFiscalSeriesRow } from './mzFinance'

export type SetupReadiness =
  | 'ready'
  | 'needs_action'
  | 'in_progress'
  | 'optional'
  | 'not_applicable'
  | 'unavailable'

export type SetupAuthority =
  | 'can_manage'
  | 'can_review'
  | 'read_only'
  | 'ask_owner_admin'
  | 'ask_manager'
  | 'platform_managed'

export type SetupAreaGroup = 'core' | 'extension'

export type SetupAreaKey =
  | 'company_identity'
  | 'fiscal_identity'
  | 'sales_tax'
  | 'purchase_tax'
  | 'pos_mode'
  | 'fiscal_documents'
  | 'currency'
  | 'uom'
  | 'locations'
  | 'items'
  | 'opening_data'
  | 'customers'
  | 'suppliers'
  | 'team'
  | 'banks'
  | 'document_branding'
  | 'notifications'
  | 'due_reminders'

export type SetupArea = {
  key: SetupAreaKey
  group: SetupAreaGroup
  readiness: SetupReadiness
  authority: SetupAuthority
  summaryKey: string
  consequenceKey: string
  route: string | null
  evidence: Record<string, string | number | boolean | null>
  blockingCapabilities: string[]
}

export type SetupResource<T> =
  | { status: 'available'; data: T }
  | { status: 'unavailable' }

export type CompanySetupProfile = {
  name: string | null
  legalName: string | null
  tradeName: string | null
  taxId: string | null
  addressLine1: string | null
  city: string | null
  countryCode: string | null
  preferredLanguage: string | null
  logoPath: string | null
}

export type CompanySetupSettings = {
  baseCurrencyCode: string | null
  documentBrandName: string | null
  documentBrandLogoUrl: string | null
  dailyDigestEnabled: boolean
  dueRemindersEnabled: boolean
}

export type CompanySetupCounts = {
  allowedCurrencies: number
  uoms: number
  activeWarehouses: number
  activeBins: number
  items: number
  inventoryItems: number
  serviceItems: number
  sellableItems: number
  customers: number
  suppliers: number
  openingImports: number
  activeMembers: number
  pendingInvitations: number
  disabledMembers: number
  bankAccounts: number
}

export type CompanySetupSnapshot = {
  profile: SetupResource<CompanySetupProfile>
  settings: SetupResource<CompanySetupSettings>
  commercialTax: SetupResource<CommercialTaxConfiguration>
  fiscalSettings: SetupResource<CompanyFiscalSettingsRow | null>
  fiscalSeries: SetupResource<FinanceDocumentFiscalSeriesRow[]>
  counts: { [Key in keyof CompanySetupCounts]: SetupResource<number> }
}

const unavailableArea = (
  key: SetupAreaKey,
  group: SetupAreaGroup,
  consequenceKey: string,
  route: string | null,
  authority: SetupAuthority,
): SetupArea => ({
  key,
  group,
  readiness: 'unavailable',
  authority,
  summaryKey: 'setup.status.unavailableSummary',
  consequenceKey,
  route,
  evidence: {},
  blockingCapabilities: [],
})

function settingsAuthority(role: CompanyRole | null): SetupAuthority {
  return hasMinRole(role, 'MANAGER') ? 'can_manage' : 'ask_manager'
}

function ownerAdminAuthority(role: CompanyRole | null): SetupAuthority {
  return hasMinRole(role, 'ADMIN') ? 'can_manage' : 'ask_owner_admin'
}

function masterDataAuthority(role: CompanyRole | null): SetupAuthority {
  return can.createMaster(role) ? 'can_manage' : 'ask_manager'
}

function countValue(resource: SetupResource<number>) {
  return resource.status === 'available' ? resource.data : null
}

export function deriveCompanySetupAreas(
  snapshot: CompanySetupSnapshot,
  role: CompanyRole | null,
): SetupArea[] {
  const areas: SetupArea[] = []
  const profileAuthority = settingsAuthority(role)
  const taxAuthority = ownerAdminAuthority(role)

  if (snapshot.profile.status === 'unavailable') {
    areas.push(
      unavailableArea('company_identity', 'core', 'setup.areas.company_identity.consequence', '/settings?section=company-profile', profileAuthority),
      unavailableArea('fiscal_identity', 'core', 'setup.areas.fiscal_identity.consequence', '/settings?section=company-profile', profileAuthority),
    )
  } else {
    const profile = snapshot.profile.data
    const identityReady = Boolean((profile.tradeName || profile.legalName || profile.name) && profile.countryCode)
    const fiscalReady = Boolean(profile.legalName && profile.taxId && profile.addressLine1 && profile.countryCode)
    areas.push({
      key: 'company_identity',
      group: 'core',
      readiness: identityReady ? 'ready' : profile.name ? 'in_progress' : 'needs_action',
      authority: profileAuthority,
      summaryKey: identityReady ? 'setup.areas.company_identity.ready' : 'setup.areas.company_identity.incomplete',
      consequenceKey: 'setup.areas.company_identity.consequence',
      route: '/settings?section=company-profile',
      evidence: { hasWorkspaceName: Boolean(profile.name), hasCountry: Boolean(profile.countryCode) },
      blockingCapabilities: identityReady ? [] : ['company_documents'],
    })
    areas.push({
      key: 'fiscal_identity',
      group: 'core',
      readiness: fiscalReady ? 'ready' : 'needs_action',
      authority: profileAuthority,
      summaryKey: fiscalReady ? 'setup.areas.fiscal_identity.ready' : 'setup.areas.fiscal_identity.incomplete',
      consequenceKey: 'setup.areas.fiscal_identity.consequence',
      route: '/settings?section=company-profile',
      evidence: {
        hasLegalName: Boolean(profile.legalName),
        hasTaxId: Boolean(profile.taxId),
        hasAddress: Boolean(profile.addressLine1),
        hasCountry: Boolean(profile.countryCode),
      },
      blockingCapabilities: fiscalReady ? [] : ['fiscal_invoice_issue'],
    })
  }

  if (snapshot.commercialTax.status === 'unavailable') {
    areas.push(
      unavailableArea('sales_tax', 'core', 'setup.areas.sales_tax.consequence', '/settings?section=commercial-tax', taxAuthority),
      unavailableArea('purchase_tax', 'core', 'setup.areas.purchase_tax.consequence', '/settings?section=commercial-tax', taxAuthority),
      unavailableArea('pos_mode', 'core', 'setup.areas.pos_mode.consequence', '/settings?section=commercial-tax', taxAuthority),
    )
  } else {
    const tax = snapshot.commercialTax.data
    const effectiveOptionIds = new Set(tax.activeOptions.map((option) => option.id))
    const salesReady = Boolean(tax.salesDefault && effectiveOptionIds.has(tax.salesDefault.id))
    const purchaseReady = Boolean(tax.purchaseDefault && effectiveOptionIds.has(tax.purchaseDefault.id))
    const posMode = tax.settings?.pos_sales_tax_mode ?? null
    const posReady = posMode === 'non_fiscal' || (posMode === 'configured' && salesReady)
    areas.push({
      key: 'sales_tax', group: 'core', readiness: salesReady ? 'ready' : 'needs_action', authority: taxAuthority,
      summaryKey: salesReady ? 'setup.areas.sales_tax.ready' : 'setup.areas.sales_tax.missing',
      consequenceKey: 'setup.areas.sales_tax.consequence', route: '/settings?section=commercial-tax',
      evidence: { optionCode: tax.salesDefault?.code ?? null }, blockingCapabilities: salesReady ? [] : ['sales_orders'],
    })
    areas.push({
      key: 'purchase_tax', group: 'core', readiness: purchaseReady ? 'ready' : 'needs_action', authority: taxAuthority,
      summaryKey: purchaseReady ? 'setup.areas.purchase_tax.ready' : 'setup.areas.purchase_tax.missing',
      consequenceKey: 'setup.areas.purchase_tax.consequence', route: '/settings?section=commercial-tax',
      evidence: { optionCode: tax.purchaseDefault?.code ?? null }, blockingCapabilities: purchaseReady ? [] : ['purchase_orders'],
    })
    areas.push({
      key: 'pos_mode', group: 'core', readiness: posReady ? 'ready' : 'needs_action', authority: taxAuthority,
      summaryKey: posMode === 'non_fiscal'
        ? 'setup.areas.pos_mode.nonFiscal'
        : posReady
          ? 'setup.areas.pos_mode.configured'
          : 'setup.areas.pos_mode.unconfigured',
      consequenceKey: 'setup.areas.pos_mode.consequence', route: '/settings?section=commercial-tax',
      evidence: { mode: posMode }, blockingCapabilities: posReady ? [] : ['point_of_sale'],
    })
  }

  if (snapshot.fiscalSettings.status === 'unavailable' || snapshot.fiscalSeries.status === 'unavailable') {
    areas.push(unavailableArea('fiscal_documents', 'core', 'setup.areas.fiscal_documents.consequence', '/compliance/mz', 'can_review'))
  } else {
    const fiscalSettings = snapshot.fiscalSettings.data
    const activeTypes = new Set(snapshot.fiscalSeries.data.filter((row) => row.is_active).map((row) => row.document_type))
    const hasAllSeries = ['sales_invoice', 'sales_credit_note', 'sales_debit_note'].every((type) => activeTypes.has(type as FinanceDocumentFiscalSeriesRow['document_type']))
    const ready = Boolean(fiscalSettings && hasAllSeries)
    areas.push({
      key: 'fiscal_documents', group: 'core', readiness: ready ? 'ready' : fiscalSettings ? 'in_progress' : 'needs_action',
      authority: 'can_review', summaryKey: ready ? 'setup.areas.fiscal_documents.ready' : fiscalSettings ? 'setup.areas.fiscal_documents.seriesMissing' : 'setup.areas.fiscal_documents.missing',
      consequenceKey: 'setup.areas.fiscal_documents.consequence', route: '/compliance/mz',
      evidence: { hasSettings: Boolean(fiscalSettings), activeSeries: activeTypes.size }, blockingCapabilities: ready ? [] : ['fiscal_invoice_issue'],
    })
  }

  if (snapshot.settings.status === 'unavailable' || snapshot.counts.allowedCurrencies.status === 'unavailable') {
    areas.push(unavailableArea('currency', 'core', 'setup.areas.currency.consequence', '/currency', profileAuthority))
  } else {
    const base = snapshot.settings.data.baseCurrencyCode
    const allowed = snapshot.counts.allowedCurrencies.data
    areas.push({
      key: 'currency', group: 'core', readiness: base && allowed > 0 ? 'ready' : 'needs_action', authority: profileAuthority,
      summaryKey: base && allowed > 0 ? 'setup.areas.currency.ready' : 'setup.areas.currency.missing',
      consequenceKey: 'setup.areas.currency.consequence', route: '/currency', evidence: { baseCurrency: base, allowedCurrencies: allowed },
      blockingCapabilities: base && allowed > 0 ? [] : ['commercial_documents'],
    })
  }

  if (snapshot.counts.uoms.status === 'unavailable') {
    areas.push(unavailableArea('uom', 'core', 'setup.areas.uom.consequence', '/uom', 'can_review'))
  } else {
    const count = snapshot.counts.uoms.data
    areas.push({ key: 'uom', group: 'core', readiness: count > 0 ? 'ready' : 'needs_action', authority: count > 0 ? 'can_review' : 'platform_managed', summaryKey: count > 0 ? 'setup.areas.uom.ready' : 'setup.areas.uom.missing', consequenceKey: 'setup.areas.uom.consequence', route: '/uom', evidence: { count }, blockingCapabilities: count > 0 ? [] : ['item_catalog'] })
  }

  const itemCount = countValue(snapshot.counts.items)
  const inventoryCount = countValue(snapshot.counts.inventoryItems)
  const serviceCount = countValue(snapshot.counts.serviceItems)
  const warehouseCount = countValue(snapshot.counts.activeWarehouses)
  const binCount = countValue(snapshot.counts.activeBins)
  const inventoryRequired = inventoryCount !== null && inventoryCount > 0

  if (itemCount === null || inventoryCount === null || serviceCount === null) {
    areas.push(unavailableArea('items', 'core', 'setup.areas.items.consequence', '/items', masterDataAuthority(role)))
  } else {
    areas.push({
      key: 'items', group: 'core', readiness: itemCount > 0 ? 'ready' : 'needs_action', authority: masterDataAuthority(role),
      summaryKey: itemCount === 0 ? 'setup.areas.items.missing' : inventoryCount === 0 && serviceCount === itemCount ? 'setup.areas.items.serviceOnly' : 'setup.areas.items.ready',
      consequenceKey: 'setup.areas.items.consequence', route: '/items', evidence: { itemCount, inventoryCount, serviceCount },
      blockingCapabilities: itemCount > 0 ? [] : ['sales', 'purchasing', 'inventory'],
    })
  }

  if (warehouseCount === null || binCount === null || inventoryCount === null) {
    areas.push(unavailableArea('locations', 'core', 'setup.areas.locations.consequence', '/warehouses', can.manageWarehouses(role) ? 'can_manage' : 'ask_manager'))
  } else {
    const readiness: SetupReadiness = !inventoryRequired ? 'not_applicable' : warehouseCount === 0 ? 'needs_action' : binCount === 0 ? 'in_progress' : 'ready'
    areas.push({
      key: 'locations', group: 'core', readiness, authority: can.manageWarehouses(role) ? 'can_manage' : 'ask_manager',
      summaryKey: !inventoryRequired ? 'setup.areas.locations.optional' : warehouseCount === 0 ? 'setup.areas.locations.missingWarehouse' : binCount === 0 ? 'setup.areas.locations.missingBin' : 'setup.areas.locations.ready',
      consequenceKey: 'setup.areas.locations.consequence', route: '/warehouses', evidence: { warehouseCount, binCount, inventoryRequired },
      blockingCapabilities: readiness === 'ready' || readiness === 'not_applicable' ? [] : ['stock_movements'],
    })
  }

  const extensionDefinitions: Array<{
    key: SetupAreaKey
    resource: SetupResource<number>
    route: string
    authority: SetupAuthority
    readyKey: string
    optionalKey: string
    consequenceKey: string
  }> = [
    { key: 'customers', resource: snapshot.counts.customers, route: '/customers', authority: masterDataAuthority(role), readyKey: 'setup.areas.customers.ready', optionalKey: 'setup.areas.customers.optional', consequenceKey: 'setup.areas.customers.consequence' },
    { key: 'suppliers', resource: snapshot.counts.suppliers, route: '/suppliers', authority: masterDataAuthority(role), readyKey: 'setup.areas.suppliers.ready', optionalKey: 'setup.areas.suppliers.optional', consequenceKey: 'setup.areas.suppliers.consequence' },
    { key: 'banks', resource: snapshot.counts.bankAccounts, route: '/banks', authority: ownerAdminAuthority(role), readyKey: 'setup.areas.banks.ready', optionalKey: 'setup.areas.banks.optional', consequenceKey: 'setup.areas.banks.consequence' },
  ]

  for (const definition of extensionDefinitions) {
    if (definition.resource.status === 'unavailable') {
      areas.push(unavailableArea(definition.key, 'extension', definition.consequenceKey, definition.route, definition.authority))
    } else {
      const count = definition.resource.data
      areas.push({ key: definition.key, group: 'extension', readiness: count > 0 ? 'ready' : 'optional', authority: definition.authority, summaryKey: count > 0 ? definition.readyKey : definition.optionalKey, consequenceKey: definition.consequenceKey, route: definition.route, evidence: { count }, blockingCapabilities: [] })
    }
  }

  if (snapshot.counts.openingImports.status === 'unavailable') {
    areas.push(unavailableArea('opening_data', 'core', 'setup.areas.opening_data.consequence', '/setup/import?dataset=opening_stock', masterDataAuthority(role)))
  } else {
    const count = snapshot.counts.openingImports.data
    areas.push({ key: 'opening_data', group: 'core', readiness: count > 0 ? 'ready' : 'optional', authority: masterDataAuthority(role), summaryKey: count > 0 ? 'setup.areas.opening_data.ready' : 'setup.areas.opening_data.optional', consequenceKey: 'setup.areas.opening_data.consequence', route: '/setup/import?dataset=opening_stock', evidence: { count }, blockingCapabilities: [] })
  }

  const memberResources = [snapshot.counts.activeMembers, snapshot.counts.pendingInvitations, snapshot.counts.disabledMembers]
  if (memberResources.some((resource) => resource.status === 'unavailable')) {
    areas.push(unavailableArea('team', 'extension', 'setup.areas.team.consequence', hasMinRole(role, 'MANAGER') ? '/users' : null, hasMinRole(role, 'MANAGER') ? 'can_manage' : 'ask_manager'))
  } else {
    const active = snapshot.counts.activeMembers.data
    const pending = snapshot.counts.pendingInvitations.data
    areas.push({ key: 'team', group: 'extension', readiness: pending > 0 ? 'in_progress' : active > 1 ? 'ready' : 'optional', authority: hasMinRole(role, 'MANAGER') ? 'can_manage' : 'ask_manager', summaryKey: pending > 0 ? 'setup.areas.team.pending' : active > 1 ? 'setup.areas.team.ready' : 'setup.areas.team.optional', consequenceKey: 'setup.areas.team.consequence', route: hasMinRole(role, 'MANAGER') ? '/users' : null, evidence: { active, pending, disabled: snapshot.counts.disabledMembers.data }, blockingCapabilities: [] })
  }

  if (snapshot.settings.status === 'unavailable') {
    areas.push(
      unavailableArea('document_branding', 'extension', 'setup.areas.document_branding.consequence', '/settings?section=documents', profileAuthority),
      unavailableArea('notifications', 'extension', 'setup.areas.notifications.consequence', '/settings?section=notifications', profileAuthority),
      unavailableArea('due_reminders', 'extension', 'setup.areas.due_reminders.consequence', '/settings?section=due-reminders', financeCan.reminderSettings(role) ? 'can_manage' : 'ask_owner_admin'),
    )
  } else {
    const settings = snapshot.settings.data
    const hasBranding = Boolean(settings.documentBrandName || settings.documentBrandLogoUrl)
    areas.push({ key: 'document_branding', group: 'extension', readiness: hasBranding ? 'ready' : 'optional', authority: profileAuthority, summaryKey: hasBranding ? 'setup.areas.document_branding.ready' : 'setup.areas.document_branding.optional', consequenceKey: 'setup.areas.document_branding.consequence', route: '/settings?section=documents', evidence: { hasBranding }, blockingCapabilities: [] })
    areas.push({ key: 'notifications', group: 'extension', readiness: settings.dailyDigestEnabled ? 'ready' : 'optional', authority: profileAuthority, summaryKey: settings.dailyDigestEnabled ? 'setup.areas.notifications.ready' : 'setup.areas.notifications.optional', consequenceKey: 'setup.areas.notifications.consequence', route: '/settings?section=notifications', evidence: { enabled: settings.dailyDigestEnabled }, blockingCapabilities: [] })
    areas.push({ key: 'due_reminders', group: 'extension', readiness: settings.dueRemindersEnabled ? 'ready' : 'optional', authority: financeCan.reminderSettings(role) ? 'can_manage' : 'ask_owner_admin', summaryKey: settings.dueRemindersEnabled ? 'setup.areas.due_reminders.ready' : 'setup.areas.due_reminders.optional', consequenceKey: 'setup.areas.due_reminders.consequence', route: '/settings?section=due-reminders', evidence: { enabled: settings.dueRemindersEnabled }, blockingCapabilities: [] })
  }

  return areas
}

export function selectNextSetupArea(areas: SetupArea[]) {
  return areas.find((area) => area.group === 'core' && area.readiness === 'needs_action')
    || areas.find((area) => area.group === 'core' && area.readiness === 'in_progress')
    || areas.find((area) => area.group === 'core' && area.readiness === 'unavailable')
    || null
}
