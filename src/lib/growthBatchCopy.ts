import type { Locale } from './i18n'
import type { TransferReasonCode } from './growthBatchTypes'

export const harvestBlockerCodes = [
  'growth_batch_not_active',
  'growth_batch_harvest_empty_batch',
  'growth_batch_harvest_date_before_start',
  'growth_batch_harvest_date_in_future',
  'growth_batch_harvest_date_before_latest_state_event',
  'growth_batch_harvest_quantity_required',
  'growth_batch_harvest_quantity_exceeds_current',
  'fractional_count_not_allowed',
  'growth_batch_harvest_weight_required',
  'growth_batch_harvest_weight_invalid',
  'growth_batch_harvest_weight_exceeds_current',
  'growth_batch_harvest_weight_without_current_weight',
  'growth_batch_harvest_full_weight_must_match_current',
  'growth_batch_harvest_output_quantity_required',
  'growth_batch_harvest_output_item_required',
  'growth_batch_harvest_output_item_invalid',
  'growth_batch_harvest_output_item_not_stock_tracked',
  'growth_batch_harvest_output_item_base_uom_required',
  'growth_batch_harvest_destination_required',
  'growth_batch_harvest_destination_invalid',
  'growth_batch_harvest_destination_inactive',
  'growth_batch_harvest_destination_bin_invalid',
  'growth_batch_harvest_source_fingerprint_required',
  'growth_batch_harvest_source_changed',
  'growth_batch_harvest_sequence_invalid',
  'growth_batch_harvest_reversal_dependency_exists',
  'growth_batch_harvest_current_state_mismatch',
  'growth_batch_harvest_reversal_insufficient_output_stock',
  'growth_batch_harvest_reversal_date_before_original',
  'growth_batch_harvest_already_reversed',
  'reversal_reason_required',
] as const

export type GrowthBatchHarvestBlockerCode = (typeof harvestBlockerCodes)[number]

export const transferBlockerCodes = [
  'growth_batch_transfer_reason_invalid',
  'growth_batch_transfer_notes_required',
  'growth_batch_not_active',
  'growth_batch_transfer_empty_batch',
  'growth_batch_transfer_source_required',
  'source_location_not_canonical',
  'growth_batch_transfer_quantity_required',
  'growth_batch_transfer_source_fingerprint_required',
  'growth_batch_transfer_source_changed',
  'growth_batch_transfer_destination_required',
  'destination_warehouse_required',
  'growth_batch_transfer_destination_inactive',
  'destination_warehouse_inactive',
  'destination_bin_inactive',
  'destination_warehouse_invalid',
  'destination_bin_invalid',
  'growth_batch_transfer_same_location',
  'growth_batch_transfer_stale_source',
  'growth_batch_transfer_not_latest',
  'growth_batch_transfer_reversal_dependency_exists',
  'growth_batch_transfer_current_location_changed',
  'growth_batch_transfer_current_location_mismatch',
  'growth_batch_transfer_not_found',
  'growth_batch_transfer_original_event_invalid',
  'growth_batch_transfer_sequence_invalid',
  'growth_batch_transfer_source_inactive',
  'growth_batch_transfer_original_source_inactive',
  'growth_batch_transfer_date_before_latest_location_event',
  'growth_batch_transfer_reversal_date_before_original',
  'growth_batch_transfer_date_before_start',
  'growth_batch_transfer_date_in_future',
  'growth_batch_transfer_already_reversed',
] as const

export type GrowthBatchTransferBlockerCode = (typeof transferBlockerCodes)[number]

export const completionBlockerCodes = [
  'growth_batch_completion_manager_required',
  'growth_batch_completion_status_invalid',
  'growth_batch_completion_quantity_remaining',
  'growth_batch_completion_weight_remaining',
  'growth_batch_completion_cost_remaining',
  'growth_batch_completion_date_before_start',
  'growth_batch_completion_date_in_future',
  'growth_batch_completion_chronology_invalid',
  'growth_batch_completion_source_fingerprint_required',
  'growth_batch_completion_stale_source',
  'growth_batch_completion_reason_required',
  'growth_batch_completion_state_changed',
  'growth_batch_completion_reversal_status_invalid',
  'growth_batch_completion_already_reversed',
  'growth_batch_completion_reversal_dependency_exists',
  'growth_batch_completion_current_state_mismatch',
  'growth_batch_completion_original_event_invalid',
  'growth_batch_completion_not_found',
  'growth_batch_completion_reversal_date_before_original',
  'request_key_required',
  'idempotency_key_payload_mismatch',
  'request_in_progress',
  'reversal_reason_required',
  'manager_role_required',
  'growth_batch_not_active',
] as const

export type GrowthBatchCompletionBlockerCode = (typeof completionBlockerCodes)[number]

export type GrowthBatchHarvestCopy = {
  actions: {
    recordHarvest: string
    reverseHarvest: string
    preview: string
    close: string
    harvestAll: string
  }
  aria: {
    outputItem: string
    destinationWarehouse: string
    destinationBin: string
  }
  labels: {
    tab: string
    currentQuantity: string
    currentWeight: string
    fullyHarvested: string
    awaitingCompletion: string
    harvestKind: string
    harvestedQuantity: string
    harvestedWeight: string
    outputItem: string
    outputBaseUom: string
    outputQuantity: string
    destinationWarehouse: string
    destinationBin: string
    effectiveDate: string
    notes: string
    before: string
    after: string
    allocatedCost: string
    outputUnitCost: string
    remainingCost: string
    stockReceipt: string
    finance: string
    sale: string
    cogs: string
    sellingPrice: string
    originalEvent: string
    reason: string
    sourceLocation: string
    destinationLocation: string
  }
  fallback: {
    notSet: string
    notRecorded: string
    notSelected: string
    teamMember: string
    reversed: string
    locked: string
    unchanged: string
    notAffected: string
    noBin: string
  }
  dialog: {
    title: string
    description: string
    allHint: string
    weightRequiredHint: string
    outputHint: string
    warehousePlaceholder: string
    binPlaceholder: string
    outputPlaceholder: string
    notesHint: string
    reversalTitle: string
    reversalDescription: string
  }
  history: {
    title: string
    description: string
    emptyTitle: string
    emptyDescription: string
    harvestBadge: string
    harvestReversalBadge: string
    partial: string
    full: string
    by: string
    sequencePrefix: string
    reversedBy: string
    onDate: string
    lockedReason: string
  }
  preview: {
    readyToast: string
    blockersToast: string
    stale: string
    ready: string
    blockers: string
    noSaleNoFinance: string
  }
  success: {
    harvested: string
    reversed: string
  }
  errors: {
    unavailableActive: string
    quantityRequired: string
    destinationSetupRequired: string
    outputSetupRequired: string
    selectBatch: string
    effectiveDateRequired: string
    dateBeforeStart: string
    dateFuture: string
    outputItemRequired: string
    outputQuantityRequired: string
    destinationRequired: string
    destinationInactive: string
    binInactive: string
    weightRequired: string
    previewRequired: string
    previewBlockers: string
    previewRefreshRequired: string
    reversalReasonRequired: string
    historyRefreshRequired: string
    managerRequired: string
    requestMismatch: string
    requestInProgress: string
    permissionDenied: string
    actionFailed: string
  }
  blockerLabels: Record<GrowthBatchHarvestBlockerCode, string>
}

export type GrowthBatchTransferCopy = {
  actions: {
    transferBatch: string
    reverseTransfer: string
    preview: string
    close: string
  }
  aria: {
    destinationWarehouse: string
    destinationBin: string
    transferPurpose: string
  }
  labels: {
    currentLocation: string
    currentQuantity: string
    latestWeight: string
    latestTotalWeight: string
    entireCurrentQuantity: string
    entireQuantity: string
    entireWeight: string
    fullQuantityMoved: string
    weightSnapshot: string
    destinationWarehouse: string
    destinationBin: string
    effectiveDate: string
    purpose: string
    locationNote: string
    notes: string
    stockLedger: string
    costs: string
    costEffect: string
    from: string
    to: string
    originalEvent: string
    reason: string
  }
  fallback: {
    notSet: string
    notRecorded: string
    notSelected: string
    teamMember: string
    reversalEvent: string
    reasonRecorded: string
    unchanged: string
    notAffected: string
  }
  dialog: {
    title: string
    description: string
    stockNote: string
    binHint: string
    warehousePlaceholder: string
    binPlaceholder: string
    noBin: string
    purposePlaceholder: string
    locationNoteHint: string
    notesRequiredHint: string
    notesOptionalHint: string
    reversalTitle: string
    reversalDescription: string
  }
  history: {
    title: string
    description: string
    emptyTitle: string
    emptyDescription: string
    transferBadge: string
    transferReversalBadge: string
    reversedBadge: string
    lockedBadge: string
    by: string
    sequencePrefix: string
    reversedBy: string
    onDate: string
    lockedReason: string
  }
  preview: {
    readyToast: string
    blockersToast: string
    stale: string
    ready: string
    blockers: string
  }
  success: {
    transferred: string
    reversed: string
  }
  errors: {
    unavailableActive: string
    sourceRequired: string
    quantityRequired: string
    destinationSetupRequired: string
    selectBatch: string
    effectiveDateRequired: string
    dateBeforeStart: string
    dateFuture: string
    destinationRequired: string
    destinationInactive: string
    binInactive: string
    purposeRequired: string
    purposeInvalid: string
    otherNotesRequired: string
    sameLocation: string
    previewRequired: string
    previewBlockers: string
    previewRefreshRequired: string
    reversalReasonRequired: string
    historyRefreshRequired: string
    managerRequired: string
    requestMismatch: string
    requestInProgress: string
    permissionDenied: string
    actionFailed: string
  }
  reasonLabels: Record<TransferReasonCode, string>
  blockerLabels: Record<GrowthBatchTransferBlockerCode, string>
}

export type GrowthBatchCompletionCopy = {
  page: {
    eyebrow: string
    description: string
    appendOnlyLedger: string
    noFifoOrCogs: string
  }
  actions: {
    completeBatch: string
    reverseCompletion: string
    preview: string
    close: string
  }
  labels: {
    tab: string
    currentStatus: string
    afterStatus: string
    currentQuantity: string
    currentWeight: string
    accumulatedCost: string
    harvestedCost: string
    remainingCost: string
    effectiveDate: string
    reason: string
    notes: string
    originalEvent: string
    stockLedger: string
    finance: string
    sale: string
    cogs: string
    sellingPrice: string
    completedAt: string
    lifecycle: string
  }
  statuses: {
    active: string
    completed: string
  }
  fallback: {
    notRecorded: string
    notSelected: string
    teamMember: string
    reversed: string
    locked: string
    notAffected: string
    unchanged: string
  }
  dialog: {
    title: string
    description: string
    lifecycleNote: string
    notesHint: string
    reversalTitle: string
    reversalDescription: string
  }
  history: {
    title: string
    description: string
    emptyTitle: string
    emptyDescription: string
    completionBadge: string
    reversalBadge: string
    reversedBadge: string
    lockedBadge: string
    by: string
    sequencePrefix: string
    reversedBy: string
    onDate: string
    lockedReason: string
  }
  preview: {
    readyToast: string
    blockersToast: string
    stale: string
    ready: string
    blockers: string
    lifecycleOnly: string
  }
  success: {
    completed: string
    reversed: string
  }
  errors: {
    selectBatch: string
    unavailableActive: string
    notReady: string
    effectiveDateRequired: string
    dateBeforeStart: string
    dateFuture: string
    reasonRequired: string
    previewRequired: string
    previewBlockers: string
    previewRefreshRequired: string
    managerRequired: string
    reversalReasonRequired: string
    historyRefreshRequired: string
    requestMismatch: string
    requestInProgress: string
    permissionDenied: string
    actionFailed: string
  }
  blockerLabels: Record<GrowthBatchCompletionBlockerCode, string>
}

export const growthBatchTransferCopy: Record<Locale, GrowthBatchTransferCopy> = {
  en: {
    actions: {
      transferBatch: 'Transfer batch',
      reverseTransfer: 'Reverse transfer',
      preview: 'Preview',
      close: 'Close',
    },
    aria: {
      destinationWarehouse: 'Destination warehouse',
      destinationBin: 'Destination bin',
      transferPurpose: 'Transfer purpose',
    },
    labels: {
      currentLocation: 'Current location',
      currentQuantity: 'Current quantity',
      latestWeight: 'Latest weight',
      latestTotalWeight: 'Latest total weight',
      entireCurrentQuantity: 'Entire current quantity',
      entireQuantity: 'Entire quantity',
      entireWeight: 'Entire weight',
      fullQuantityMoved: 'Full quantity moved',
      weightSnapshot: 'Weight snapshot',
      destinationWarehouse: 'Destination warehouse',
      destinationBin: 'Destination bin',
      effectiveDate: 'Effective date',
      purpose: 'Purpose',
      locationNote: 'Location note',
      notes: 'Notes',
      stockLedger: 'Stock ledger',
      costs: 'Costs',
      costEffect: 'Cost effect',
      from: 'From',
      to: 'To',
      originalEvent: 'Original event',
      reason: 'Reason',
    },
    fallback: {
      notSet: 'Not set',
      notRecorded: 'Not recorded',
      notSelected: 'Not selected',
      teamMember: 'Team member',
      reversalEvent: 'reversal event',
      reasonRecorded: 'Reason recorded.',
      unchanged: 'Unchanged',
      notAffected: 'Not affected',
    },
    dialog: {
      title: 'Transfer Growth Batch location',
      description: 'This moves the entire current batch to another operational location. Quantity, weight, stock ledger, costs, and finance rows remain unchanged.',
      stockNote: 'This is not a stock transfer. Previously consumed inventory remains in the Growth Batch history.',
      binHint: 'Optional. Bins are limited to the selected warehouse.',
      warehousePlaceholder: 'Select warehouse',
      binPlaceholder: 'No bin',
      noBin: 'No bin',
      purposePlaceholder: 'Select purpose',
      locationNoteHint: 'Optional detail for the destination location.',
      notesRequiredHint: 'Required for Other.',
      notesOptionalHint: 'Optional unless purpose is Other.',
      reversalTitle: 'Reverse location transfer',
      reversalDescription: 'This creates a separate transfer-reversal event and moves the current whole batch back to the original source location. Quantity, weight, and costs stay unchanged.',
    },
    history: {
      title: 'Location transfers',
      description: 'Transfers move the entire current active batch between operational locations. They do not split quantity, move stock, write off cost, or post finance rows.',
      emptyTitle: 'No location transfers yet',
      emptyDescription: 'Transfer only when the whole active batch moves to another valid company location.',
      transferBadge: 'Transfer',
      transferReversalBadge: 'Transfer reversal',
      reversedBadge: 'Reversed',
      lockedBadge: 'Locked',
      by: 'by',
      sequencePrefix: 'Seq',
      reversedBy: 'Reversed by',
      onDate: 'on',
      lockedReason: 'Only the latest unreversed transfer can be reversed, and the original source must remain active.',
    },
    preview: {
      readyToast: 'Transfer preview is ready',
      blockersToast: 'Preview found blockers. Review the destination before posting.',
      stale: 'Preview is stale',
      ready: 'Preview ready',
      blockers: 'Preview blockers',
    },
    success: {
      transferred: 'Growth Batch transferred',
      reversed: 'Growth Batch transfer reversed',
    },
    errors: {
      unavailableActive: 'Transfers are only available for active Growth Batches.',
      sourceRequired: 'This batch needs a current warehouse before it can be transferred.',
      quantityRequired: 'Only active batches with current quantity greater than zero can be transferred.',
      destinationSetupRequired: 'Create or activate a destination warehouse before transferring a Growth Batch.',
      selectBatch: 'Select a Growth Batch.',
      effectiveDateRequired: 'Select an effective date.',
      dateBeforeStart: 'Transfer date must be on or after the batch start date.',
      dateFuture: 'Transfer date cannot be in the future.',
      destinationRequired: 'Select a destination warehouse.',
      destinationInactive: 'Select an active destination warehouse.',
      binInactive: 'Select an active bin that belongs to the destination warehouse.',
      purposeRequired: 'Select a transfer purpose.',
      purposeInvalid: 'Select a valid transfer purpose.',
      otherNotesRequired: 'Add notes when the transfer purpose is Other.',
      sameLocation: 'Select a destination different from the current location.',
      previewRequired: 'Preview the current transfer before posting.',
      previewBlockers: 'Resolve preview blockers before posting the transfer.',
      previewRefreshRequired: 'Refresh and preview again before posting.',
      reversalReasonRequired: 'Enter a reversal reason.',
      historyRefreshRequired: 'Refresh the transfer history before reversing.',
      managerRequired: 'Only Manager, Admin, or Owner roles can reverse transfers.',
      requestMismatch: 'This retry key belongs to different transfer inputs. Change nothing and retry, or submit the updated transfer again.',
      requestInProgress: 'A matching transfer request is already in progress. Wait a moment and refresh.',
      permissionDenied: 'Your role cannot perform this transfer action.',
      actionFailed: 'The Growth Batch action failed.',
    },
    reasonLabels: {
      operational_move: 'Operational move',
      space_management: 'Space management',
      biosecurity: 'Biosecurity',
      environment: 'Environment',
      maintenance: 'Maintenance',
      consolidation: 'Consolidation',
      other: 'Other',
    },
    blockerLabels: {
      growth_batch_transfer_reason_invalid: 'Select a valid transfer purpose.',
      growth_batch_transfer_notes_required: 'Add notes when the transfer purpose is Other.',
      growth_batch_not_active: 'Transfers are only available for active Growth Batches.',
      growth_batch_transfer_empty_batch: 'Only active batches with current quantity greater than zero can be transferred.',
      growth_batch_transfer_source_required: 'This batch needs a current warehouse before it can be transferred.',
      source_location_not_canonical: 'This batch needs a current warehouse before it can be transferred.',
      growth_batch_transfer_quantity_required: 'Only active batches with current quantity greater than zero can be transferred.',
      growth_batch_transfer_source_fingerprint_required: 'Refresh and preview again before posting.',
      growth_batch_transfer_source_changed: 'The batch location changed after preview. Refresh and preview again.',
      growth_batch_transfer_destination_required: 'Select a destination warehouse.',
      destination_warehouse_required: 'Select a destination warehouse.',
      growth_batch_transfer_destination_inactive: 'Select an active destination location.',
      destination_warehouse_inactive: 'Select an active destination location.',
      destination_bin_inactive: 'Select an active destination location.',
      destination_warehouse_invalid: 'Select a valid destination location for this company.',
      destination_bin_invalid: 'Select a valid destination location for this company.',
      growth_batch_transfer_same_location: 'Select a destination different from the current location.',
      growth_batch_transfer_stale_source: 'The batch location changed after preview. Refresh and preview again.',
      growth_batch_transfer_not_latest: 'Only the latest unreversed location transfer can be reversed.',
      growth_batch_transfer_reversal_dependency_exists: 'Only the latest unreversed location transfer can be reversed.',
      growth_batch_transfer_current_location_changed: 'The batch is no longer at the destination recorded for this transfer.',
      growth_batch_transfer_current_location_mismatch: 'The batch is no longer at the destination recorded for this transfer.',
      growth_batch_transfer_not_found: 'Refresh the transfer history before reversing.',
      growth_batch_transfer_original_event_invalid: 'Refresh the transfer history before reversing.',
      growth_batch_transfer_sequence_invalid: 'The batch event sequence changed. Refresh and try again.',
      growth_batch_transfer_source_inactive: 'The original source location is inactive. Make a new transfer to an active location instead.',
      growth_batch_transfer_original_source_inactive: 'The original source location is inactive. Make a new transfer to an active location instead.',
      growth_batch_transfer_date_before_latest_location_event: 'Transfer dates must not be earlier than the latest location-changing event.',
      growth_batch_transfer_reversal_date_before_original: 'Reversal date must be on or after the original transfer date.',
      growth_batch_transfer_date_before_start: 'Transfer dates must be on or after the batch start date.',
      growth_batch_transfer_date_in_future: 'Transfer dates cannot be in the future.',
      growth_batch_transfer_already_reversed: 'This transfer has already been reversed.',
    },
  },
  pt: {
    actions: {
      transferBatch: 'Transferir lote',
      reverseTransfer: 'Reverter transferência',
      preview: 'Pré-visualizar',
      close: 'Fechar',
    },
    aria: {
      destinationWarehouse: 'Armazém de destino',
      destinationBin: 'Localização de destino',
      transferPurpose: 'Finalidade da transferência',
    },
    labels: {
      currentLocation: 'Localização actual',
      currentQuantity: 'Quantidade actual',
      latestWeight: 'Peso mais recente',
      latestTotalWeight: 'Peso total mais recente',
      entireCurrentQuantity: 'Quantidade actual completa',
      entireQuantity: 'Quantidade completa',
      entireWeight: 'Peso completo',
      fullQuantityMoved: 'Quantidade completa movida',
      weightSnapshot: 'Registo do peso',
      destinationWarehouse: 'Armazém de destino',
      destinationBin: 'Localização de destino',
      effectiveDate: 'Data efectiva',
      purpose: 'Finalidade',
      locationNote: 'Nota da localização',
      notes: 'Notas',
      stockLedger: 'Livro de stock',
      costs: 'Custos',
      costEffect: 'Efeito no custo',
      from: 'Origem',
      to: 'Destino',
      originalEvent: 'Evento original',
      reason: 'Motivo',
    },
    fallback: {
      notSet: 'Não definido',
      notRecorded: 'Não registado',
      notSelected: 'Não seleccionado',
      teamMember: 'Membro da equipa',
      reversalEvent: 'evento de reversão',
      reasonRecorded: 'Motivo registado.',
      unchanged: 'Inalterado',
      notAffected: 'Não afectado',
    },
    dialog: {
      title: 'Transferir localização do Lote de Crescimento',
      description: 'Esta operação move todo o lote actual para outra localização operacional. A quantidade, o peso, o livro de stock, os custos e as linhas financeiras permanecem inalterados.',
      stockNote: 'Esta operação não é uma transferência de stock. O inventário consumido anteriormente permanece no histórico do Lote de Crescimento.',
      binHint: 'Opcional. As localizações ficam limitadas ao armazém seleccionado.',
      warehousePlaceholder: 'Seleccione o armazém',
      binPlaceholder: 'Sem localização',
      noBin: 'Sem localização',
      purposePlaceholder: 'Seleccione a finalidade',
      locationNoteHint: 'Detalhe opcional para a localização de destino.',
      notesRequiredHint: 'Obrigatório para Outro.',
      notesOptionalHint: 'Opcional, excepto quando a finalidade é Outro.',
      reversalTitle: 'Reverter transferência de localização',
      reversalDescription: 'Esta operação cria um evento separado de reversão de transferência e move o lote actual completo de volta para a localização de origem inicial. A quantidade, o peso e os custos permanecem inalterados.',
    },
    history: {
      title: 'Transferências de localização',
      description: 'As transferências movem todo o lote activo actual entre localizações operacionais. Não dividem quantidade, não movimentam stock, não abatem custos e não criam linhas financeiras.',
      emptyTitle: 'Ainda não existem transferências de localização',
      emptyDescription: 'Transfira apenas quando todo o lote activo se move para outra localização válida da empresa.',
      transferBadge: 'Transferência',
      transferReversalBadge: 'Reversão de transferência',
      reversedBadge: 'Revertida',
      lockedBadge: 'Bloqueada',
      by: 'por',
      sequencePrefix: 'Seq.',
      reversedBy: 'Revertida por',
      onDate: 'em',
      lockedReason: 'Apenas a transferência não revertida mais recente pode ser revertida, e a origem inicial deve continuar activa.',
    },
    preview: {
      readyToast: 'A pré-visualização da transferência está pronta',
      blockersToast: 'A pré-visualização encontrou bloqueios. Reveja o destino antes de publicar.',
      stale: 'A pré-visualização está desactualizada',
      ready: 'Pré-visualização pronta',
      blockers: 'Bloqueios da pré-visualização',
    },
    success: {
      transferred: 'Lote de Crescimento transferido',
      reversed: 'Transferência do Lote de Crescimento revertida',
    },
    errors: {
      unavailableActive: 'As transferências só estão disponíveis para Lotes de Crescimento activos.',
      sourceRequired: 'Este lote precisa de um armazém actual antes de poder ser transferido.',
      quantityRequired: 'Apenas lotes activos com quantidade actual superior a zero podem ser transferidos.',
      destinationSetupRequired: 'Crie ou active um armazém de destino antes de transferir um Lote de Crescimento.',
      selectBatch: 'Seleccione um Lote de Crescimento.',
      effectiveDateRequired: 'Seleccione uma data efectiva.',
      dateBeforeStart: 'A data da transferência deve ser igual ou posterior à data de início do lote.',
      dateFuture: 'A data da transferência não pode estar no futuro.',
      destinationRequired: 'Seleccione um armazém de destino.',
      destinationInactive: 'Seleccione um armazém de destino activo.',
      binInactive: 'Seleccione uma localização activa que pertença ao armazém de destino.',
      purposeRequired: 'Seleccione a finalidade da transferência.',
      purposeInvalid: 'Seleccione uma finalidade de transferência válida.',
      otherNotesRequired: 'Adicione notas quando a finalidade da transferência é Outro.',
      sameLocation: 'Seleccione um destino diferente da localização actual.',
      previewRequired: 'Pré-visualize a transferência actual antes de publicar.',
      previewBlockers: 'Resolva os bloqueios da pré-visualização antes de publicar a transferência.',
      previewRefreshRequired: 'Actualize e pré-visualize novamente antes de publicar.',
      reversalReasonRequired: 'Introduza o motivo da reversão.',
      historyRefreshRequired: 'Actualize o histórico de transferências antes de reverter.',
      managerRequired: 'Apenas as funções Manager, Admin ou Owner podem reverter transferências.',
      requestMismatch: 'Esta chave de repetição pertence a dados de transferência diferentes. Não altere nada e tente novamente, ou submeta a transferência actualizada.',
      requestInProgress: 'Já existe um pedido de transferência correspondente em curso. Aguarde um momento e actualize.',
      permissionDenied: 'A sua função não pode executar esta acção de transferência.',
      actionFailed: 'A acção do Lote de Crescimento falhou.',
    },
    reasonLabels: {
      operational_move: 'Movimento operacional',
      space_management: 'Gestão de espaço',
      biosecurity: 'Biossegurança',
      environment: 'Ambiente',
      maintenance: 'Manutenção',
      consolidation: 'Consolidação',
      other: 'Outro',
    },
    blockerLabels: {
      growth_batch_transfer_reason_invalid: 'Seleccione uma finalidade de transferência válida.',
      growth_batch_transfer_notes_required: 'Adicione notas quando a finalidade da transferência é Outro.',
      growth_batch_not_active: 'As transferências só estão disponíveis para Lotes de Crescimento activos.',
      growth_batch_transfer_empty_batch: 'Apenas lotes activos com quantidade actual superior a zero podem ser transferidos.',
      growth_batch_transfer_source_required: 'Este lote precisa de um armazém actual antes de poder ser transferido.',
      source_location_not_canonical: 'Este lote precisa de um armazém actual antes de poder ser transferido.',
      growth_batch_transfer_quantity_required: 'Apenas lotes activos com quantidade actual superior a zero podem ser transferidos.',
      growth_batch_transfer_source_fingerprint_required: 'Actualize e pré-visualize novamente antes de publicar.',
      growth_batch_transfer_source_changed: 'A localização do lote mudou depois da pré-visualização. Actualize e pré-visualize novamente.',
      growth_batch_transfer_destination_required: 'Seleccione um armazém de destino.',
      destination_warehouse_required: 'Seleccione um armazém de destino.',
      growth_batch_transfer_destination_inactive: 'Seleccione uma localização de destino activa.',
      destination_warehouse_inactive: 'Seleccione uma localização de destino activa.',
      destination_bin_inactive: 'Seleccione uma localização de destino activa.',
      destination_warehouse_invalid: 'Seleccione uma localização de destino válida para esta empresa.',
      destination_bin_invalid: 'Seleccione uma localização de destino válida para esta empresa.',
      growth_batch_transfer_same_location: 'Seleccione um destino diferente da localização actual.',
      growth_batch_transfer_stale_source: 'A localização do lote mudou depois da pré-visualização. Actualize e pré-visualize novamente.',
      growth_batch_transfer_not_latest: 'Apenas a transferência de localização não revertida mais recente pode ser revertida.',
      growth_batch_transfer_reversal_dependency_exists: 'Apenas a transferência de localização não revertida mais recente pode ser revertida.',
      growth_batch_transfer_current_location_changed: 'O lote já não está no destino registado para esta transferência.',
      growth_batch_transfer_current_location_mismatch: 'O lote já não está no destino registado para esta transferência.',
      growth_batch_transfer_not_found: 'Actualize o histórico de transferências antes de reverter.',
      growth_batch_transfer_original_event_invalid: 'Actualize o histórico de transferências antes de reverter.',
      growth_batch_transfer_sequence_invalid: 'A sequência de eventos do lote mudou. Actualize e tente novamente.',
      growth_batch_transfer_source_inactive: 'A localização de origem inicial está inactiva. Faça uma nova transferência para uma localização activa.',
      growth_batch_transfer_original_source_inactive: 'A localização de origem inicial está inactiva. Faça uma nova transferência para uma localização activa.',
      growth_batch_transfer_date_before_latest_location_event: 'As datas de transferência não podem ser anteriores ao evento de localização mais recente.',
      growth_batch_transfer_reversal_date_before_original: 'A data de reversão deve ser igual ou posterior à data da transferência original.',
      growth_batch_transfer_date_before_start: 'As datas de transferência devem ser iguais ou posteriores à data de início do lote.',
      growth_batch_transfer_date_in_future: 'As datas de transferência não podem estar no futuro.',
      growth_batch_transfer_already_reversed: 'Esta transferência já foi revertida.',
    },
  },
}

export const growthBatchHarvestCopy: Record<Locale, GrowthBatchHarvestCopy> = {
  en: {
    actions: {
      recordHarvest: 'Record harvest',
      reverseHarvest: 'Reverse harvest',
      preview: 'Preview',
      close: 'Close',
      harvestAll: 'Harvest all remaining',
    },
    aria: {
      outputItem: 'Harvest output item',
      destinationWarehouse: 'Harvest destination warehouse',
      destinationBin: 'Harvest destination bin',
    },
    labels: {
      tab: 'Harvests',
      currentQuantity: 'Current quantity',
      currentWeight: 'Current weight',
      fullyHarvested: 'Fully harvested',
      awaitingCompletion: 'Awaiting completion',
      harvestKind: 'Harvest type',
      harvestedQuantity: 'Harvested batch quantity',
      harvestedWeight: 'Actual harvested weight',
      outputItem: 'Output stock item',
      outputBaseUom: 'Output base unit',
      outputQuantity: 'Output stock quantity',
      destinationWarehouse: 'Destination warehouse',
      destinationBin: 'Destination bin',
      effectiveDate: 'Effective date',
      notes: 'Notes',
      before: 'Before',
      after: 'After',
      allocatedCost: 'Allocated batch cost',
      outputUnitCost: 'Output unit cost',
      remainingCost: 'Remaining batch cost',
      stockReceipt: 'Stock receipt',
      finance: 'Finance',
      sale: 'Sale',
      cogs: 'COGS',
      sellingPrice: 'Selling price',
      originalEvent: 'Original event',
      reason: 'Reason',
      sourceLocation: 'Source location',
      destinationLocation: 'Output destination',
    },
    fallback: {
      notSet: 'Not set',
      notRecorded: 'Not recorded',
      notSelected: 'Not selected',
      teamMember: 'Team member',
      reversed: 'Reversed',
      locked: 'Locked',
      unchanged: 'Unchanged',
      notAffected: 'Not affected',
      noBin: 'No bin',
    },
    dialog: {
      title: 'Record depleting harvest',
      description: 'This reduces the Growth Batch quantity and receives one output item into stock at allocated batch cost. It does not sell, invoice, post COGS, or create finance rows.',
      allHint: 'Uses the entire current quantity and, when recorded, the entire current total weight.',
      weightRequiredHint: 'Required because this batch has a current total weight.',
      outputHint: 'The selected stock-tracked item receives one inventory receipt using its base unit.',
      warehousePlaceholder: 'Select warehouse',
      binPlaceholder: 'No bin',
      outputPlaceholder: 'Select output item',
      notesHint: 'Optional controlled harvest note.',
      reversalTitle: 'Reverse harvest',
      reversalDescription: 'This creates a separate harvest-reversal event, restores the batch quantity, weight, and cost allocation, and posts one compensating stock issue from the original output bucket.',
    },
    history: {
      title: 'Harvests',
      description: 'Depleting harvests reduce batch quantity, receive one output item into stock, and move cost from remaining to harvested allocation only.',
      emptyTitle: 'No harvests yet',
      emptyDescription: 'Record a harvest when biological quantity leaves the Growth Batch and one stock output is received.',
      harvestBadge: 'Harvest',
      harvestReversalBadge: 'Harvest reversal',
      partial: 'Partial',
      full: 'Full',
      by: 'by',
      sequencePrefix: 'Seq',
      reversedBy: 'Reversed by',
      onDate: 'on',
      lockedReason: 'Only the latest unreversed quantity, weight, or cost-affecting harvest can be reversed, and enough output stock must remain in the original bucket.',
    },
    preview: {
      readyToast: 'Harvest preview is ready',
      blockersToast: 'Preview found blockers. Review quantity, output, and destination before posting.',
      stale: 'Preview is stale',
      ready: 'Preview ready',
      blockers: 'Preview blockers',
      noSaleNoFinance: 'No sale, COGS, invoice, finance posting, or selling-price change is created.',
    },
    success: {
      harvested: 'Growth Batch harvest posted',
      reversed: 'Growth Batch harvest reversed',
    },
    errors: {
      unavailableActive: 'Harvests are only available for active Growth Batches.',
      quantityRequired: 'Only active batches with current quantity greater than zero can be harvested.',
      destinationSetupRequired: 'Create or activate a destination warehouse before recording a harvest.',
      outputSetupRequired: 'Create an active stock-tracked output item before recording a harvest.',
      selectBatch: 'Select a Growth Batch.',
      effectiveDateRequired: 'Select an effective date.',
      dateBeforeStart: 'Harvest date must be on or after the batch start date.',
      dateFuture: 'Harvest date cannot be in the future.',
      outputItemRequired: 'Select the output stock item.',
      outputQuantityRequired: 'Enter an output stock quantity greater than zero.',
      destinationRequired: 'Select a destination warehouse.',
      destinationInactive: 'Select an active destination warehouse.',
      binInactive: 'Select an active bin that belongs to the destination warehouse.',
      weightRequired: 'Enter the actual harvested weight for this batch.',
      previewRequired: 'Preview the current harvest before posting.',
      previewBlockers: 'Resolve preview blockers before posting the harvest.',
      previewRefreshRequired: 'Refresh and preview again before posting.',
      reversalReasonRequired: 'Enter a reversal reason.',
      historyRefreshRequired: 'Refresh the harvest history before reversing.',
      managerRequired: 'Only Manager, Admin, or Owner roles can reverse harvests.',
      requestMismatch: 'This retry key belongs to different harvest inputs. Change nothing and retry, or submit the updated harvest again.',
      requestInProgress: 'A matching harvest request is already in progress. Wait a moment and refresh.',
      permissionDenied: 'Your role cannot perform this harvest action.',
      actionFailed: 'The Growth Batch harvest action failed.',
    },
    blockerLabels: {
      growth_batch_not_active: 'Harvests are only available for active Growth Batches.',
      growth_batch_harvest_empty_batch: 'Only active batches with current quantity greater than zero can be harvested.',
      growth_batch_harvest_date_before_start: 'Harvest date must be on or after the batch start date.',
      growth_batch_harvest_date_in_future: 'Harvest date cannot be in the future.',
      growth_batch_harvest_date_before_latest_state_event: 'Harvest date cannot be earlier than the latest quantity, weight, cost, or location state event.',
      growth_batch_harvest_quantity_required: 'Enter a harvested batch quantity greater than zero.',
      growth_batch_harvest_quantity_exceeds_current: 'Harvested quantity cannot exceed the current batch quantity.',
      fractional_count_not_allowed: 'Count-basis harvests must use whole-number quantities.',
      growth_batch_harvest_weight_required: 'Enter the actual harvested weight for this batch.',
      growth_batch_harvest_weight_invalid: 'Harvested weight must be greater than zero.',
      growth_batch_harvest_weight_exceeds_current: 'Harvested weight cannot exceed the current total weight.',
      growth_batch_harvest_weight_without_current_weight: 'Do not enter harvested weight when the batch has no current total weight.',
      growth_batch_harvest_full_weight_must_match_current: 'A full harvest must use the entire current total weight.',
      growth_batch_harvest_output_quantity_required: 'Enter an output stock quantity greater than zero.',
      growth_batch_harvest_output_item_required: 'Select the output stock item.',
      growth_batch_harvest_output_item_invalid: 'Select a company-owned output stock item.',
      growth_batch_harvest_output_item_not_stock_tracked: 'The output item must be stock-tracked.',
      growth_batch_harvest_output_item_base_uom_required: 'The output item needs a base unit.',
      growth_batch_harvest_destination_required: 'Select a destination warehouse.',
      growth_batch_harvest_destination_invalid: 'Select a valid destination warehouse for this company.',
      growth_batch_harvest_destination_inactive: 'Select an active destination warehouse or bin.',
      growth_batch_harvest_destination_bin_invalid: 'Select a valid bin in the destination warehouse.',
      growth_batch_harvest_source_fingerprint_required: 'Refresh and preview again before posting.',
      growth_batch_harvest_source_changed: 'The batch quantity, weight, cost, status, or location changed after preview. Refresh and preview again.',
      growth_batch_harvest_sequence_invalid: 'The batch event sequence changed. Refresh and try again.',
      growth_batch_harvest_reversal_dependency_exists: 'A later quantity, weight, or cost-affecting event depends on this harvest. Reverse later dependent events first.',
      growth_batch_harvest_current_state_mismatch: 'The batch no longer matches this harvest state. Refresh the history before reversing.',
      growth_batch_harvest_reversal_insufficient_output_stock: 'The original output bucket does not have enough stock for reversal.',
      growth_batch_harvest_reversal_date_before_original: 'Reversal date must be on or after the original harvest date.',
      growth_batch_harvest_already_reversed: 'This harvest has already been reversed.',
      reversal_reason_required: 'Enter a reversal reason.',
    },
  },
  pt: {
    actions: {
      recordHarvest: 'Registar colheita',
      reverseHarvest: 'Reverter colheita',
      preview: 'Pré-visualizar',
      close: 'Fechar',
      harvestAll: 'Colher todo o restante',
    },
    aria: {
      outputItem: 'Item de saída da colheita',
      destinationWarehouse: 'Armazém de destino da colheita',
      destinationBin: 'Localização de destino da colheita',
    },
    labels: {
      tab: 'Colheitas',
      currentQuantity: 'Quantidade actual',
      currentWeight: 'Peso actual',
      fullyHarvested: 'Totalmente colhido',
      awaitingCompletion: 'A aguardar conclusão',
      harvestKind: 'Tipo de colheita',
      harvestedQuantity: 'Quantidade colhida do lote',
      harvestedWeight: 'Peso real colhido',
      outputItem: 'Item de stock produzido',
      outputBaseUom: 'Unidade base do item',
      outputQuantity: 'Quantidade de stock produzida',
      destinationWarehouse: 'Armazém de destino',
      destinationBin: 'Localização de destino',
      effectiveDate: 'Data efectiva',
      notes: 'Notas',
      before: 'Antes',
      after: 'Depois',
      allocatedCost: 'Custo do lote alocado',
      outputUnitCost: 'Custo unitário produzido',
      remainingCost: 'Custo restante do lote',
      stockReceipt: 'Recepção de stock',
      finance: 'Finanças',
      sale: 'Venda',
      cogs: 'CMV',
      sellingPrice: 'Preço de venda',
      originalEvent: 'Evento original',
      reason: 'Motivo',
      sourceLocation: 'Localização de origem',
      destinationLocation: 'Destino da produção',
    },
    fallback: {
      notSet: 'Não definido',
      notRecorded: 'Não registado',
      notSelected: 'Não seleccionado',
      teamMember: 'Membro da equipa',
      reversed: 'Revertida',
      locked: 'Bloqueada',
      unchanged: 'Inalterado',
      notAffected: 'Não afectado',
      noBin: 'Sem localização',
    },
    dialog: {
      title: 'Registar colheita depletiva',
      description: 'Esta operação reduz a quantidade do Lote de Crescimento e recebe um item produzido em stock ao custo alocado do lote. Não vende, não factura, não regista CMV e não cria linhas financeiras.',
      allHint: 'Usa toda a quantidade actual e, quando registado, todo o peso total actual.',
      weightRequiredHint: 'Obrigatório porque este lote tem peso total actual.',
      outputHint: 'O item rastreado em stock recebe uma recepção de inventário usando a sua unidade base.',
      warehousePlaceholder: 'Seleccione o armazém',
      binPlaceholder: 'Sem localização',
      outputPlaceholder: 'Seleccione o item produzido',
      notesHint: 'Nota controlada opcional da colheita.',
      reversalTitle: 'Reverter colheita',
      reversalDescription: 'Esta operação cria um evento separado de reversão da colheita, restaura a quantidade, o peso e a alocação de custo do lote, e publica uma saída compensatória do stock produzido original.',
    },
    history: {
      title: 'Colheitas',
      description: 'As colheitas depletivas reduzem a quantidade do lote, recebem um item produzido em stock e movem custo apenas de restante para colhido.',
      emptyTitle: 'Ainda não existem colheitas',
      emptyDescription: 'Registe uma colheita quando a quantidade biológica sai do Lote de Crescimento e uma produção de stock é recebida.',
      harvestBadge: 'Colheita',
      harvestReversalBadge: 'Reversão de colheita',
      partial: 'Parcial',
      full: 'Total',
      by: 'por',
      sequencePrefix: 'Seq.',
      reversedBy: 'Revertida por',
      onDate: 'em',
      lockedReason: 'Apenas a colheita não revertida mais recente que afecta quantidade, peso ou custo pode ser revertida, e deve existir stock suficiente no local de saída original.',
    },
    preview: {
      readyToast: 'A pré-visualização da colheita está pronta',
      blockersToast: 'A pré-visualização encontrou bloqueios. Reveja a quantidade, a produção e o destino antes de publicar.',
      stale: 'A pré-visualização está desactualizada',
      ready: 'Pré-visualização pronta',
      blockers: 'Bloqueios da pré-visualização',
      noSaleNoFinance: 'Não cria venda, CMV, factura, lançamento financeiro nem alteração do preço de venda.',
    },
    success: {
      harvested: 'Colheita do Lote de Crescimento publicada',
      reversed: 'Colheita do Lote de Crescimento revertida',
    },
    errors: {
      unavailableActive: 'As colheitas só estão disponíveis para Lotes de Crescimento activos.',
      quantityRequired: 'Apenas lotes activos com quantidade actual superior a zero podem ser colhidos.',
      destinationSetupRequired: 'Crie ou active um armazém de destino antes de registar uma colheita.',
      outputSetupRequired: 'Crie um item produzido activo e rastreado em stock antes de registar uma colheita.',
      selectBatch: 'Seleccione um Lote de Crescimento.',
      effectiveDateRequired: 'Seleccione uma data efectiva.',
      dateBeforeStart: 'A data da colheita deve ser igual ou posterior à data de início do lote.',
      dateFuture: 'A data da colheita não pode estar no futuro.',
      outputItemRequired: 'Seleccione o item de stock produzido.',
      outputQuantityRequired: 'Introduza uma quantidade de stock produzido superior a zero.',
      destinationRequired: 'Seleccione um armazém de destino.',
      destinationInactive: 'Seleccione um armazém de destino activo.',
      binInactive: 'Seleccione uma localização activa que pertença ao armazém de destino.',
      weightRequired: 'Introduza o peso real colhido para este lote.',
      previewRequired: 'Pré-visualize a colheita actual antes de publicar.',
      previewBlockers: 'Resolva os bloqueios da pré-visualização antes de publicar a colheita.',
      previewRefreshRequired: 'Actualize e pré-visualize novamente antes de publicar.',
      reversalReasonRequired: 'Introduza o motivo da reversão.',
      historyRefreshRequired: 'Actualize o histórico de colheitas antes de reverter.',
      managerRequired: 'Apenas as funções Manager, Admin ou Owner podem reverter colheitas.',
      requestMismatch: 'Esta chave de repetição pertence a dados de colheita diferentes. Não altere nada e tente novamente, ou submeta a colheita actualizada.',
      requestInProgress: 'Já existe um pedido de colheita correspondente em curso. Aguarde um momento e actualize.',
      permissionDenied: 'A sua função não pode executar esta acção de colheita.',
      actionFailed: 'A acção de colheita do Lote de Crescimento falhou.',
    },
    blockerLabels: {
      growth_batch_not_active: 'As colheitas só estão disponíveis para Lotes de Crescimento activos.',
      growth_batch_harvest_empty_batch: 'Apenas lotes activos com quantidade actual superior a zero podem ser colhidos.',
      growth_batch_harvest_date_before_start: 'A data da colheita deve ser igual ou posterior à data de início do lote.',
      growth_batch_harvest_date_in_future: 'A data da colheita não pode estar no futuro.',
      growth_batch_harvest_date_before_latest_state_event: 'A data da colheita não pode ser anterior ao evento de quantidade, peso, custo ou localização mais recente.',
      growth_batch_harvest_quantity_required: 'Introduza uma quantidade colhida superior a zero.',
      growth_batch_harvest_quantity_exceeds_current: 'A quantidade colhida não pode exceder a quantidade actual do lote.',
      fractional_count_not_allowed: 'Colheitas baseadas em contagem devem usar quantidades inteiras.',
      growth_batch_harvest_weight_required: 'Introduza o peso real colhido para este lote.',
      growth_batch_harvest_weight_invalid: 'O peso colhido deve ser superior a zero.',
      growth_batch_harvest_weight_exceeds_current: 'O peso colhido não pode exceder o peso total actual.',
      growth_batch_harvest_weight_without_current_weight: 'Não introduza peso colhido quando o lote não tem peso total actual.',
      growth_batch_harvest_full_weight_must_match_current: 'Uma colheita total deve usar todo o peso total actual.',
      growth_batch_harvest_output_quantity_required: 'Introduza uma quantidade de stock produzido superior a zero.',
      growth_batch_harvest_output_item_required: 'Seleccione o item de stock produzido.',
      growth_batch_harvest_output_item_invalid: 'Seleccione um item produzido pertencente à empresa.',
      growth_batch_harvest_output_item_not_stock_tracked: 'O item produzido deve ser rastreado em stock.',
      growth_batch_harvest_output_item_base_uom_required: 'O item produzido precisa de unidade base.',
      growth_batch_harvest_destination_required: 'Seleccione um armazém de destino.',
      growth_batch_harvest_destination_invalid: 'Seleccione um armazém de destino válido para esta empresa.',
      growth_batch_harvest_destination_inactive: 'Seleccione um armazém ou localização de destino activo.',
      growth_batch_harvest_destination_bin_invalid: 'Seleccione uma localização válida no armazém de destino.',
      growth_batch_harvest_source_fingerprint_required: 'Actualize e pré-visualize novamente antes de publicar.',
      growth_batch_harvest_source_changed: 'A quantidade, o peso, o custo, o estado ou a localização do lote mudaram depois da pré-visualização. Actualize e pré-visualize novamente.',
      growth_batch_harvest_sequence_invalid: 'A sequência de eventos do lote mudou. Actualize e tente novamente.',
      growth_batch_harvest_reversal_dependency_exists: 'Um evento posterior de quantidade, peso ou custo depende desta colheita. Reverta primeiro os eventos dependentes posteriores.',
      growth_batch_harvest_current_state_mismatch: 'O lote já não corresponde ao estado desta colheita. Actualize o histórico antes de reverter.',
      growth_batch_harvest_reversal_insufficient_output_stock: 'O local de produção original não tem stock suficiente para reversão.',
      growth_batch_harvest_reversal_date_before_original: 'A data de reversão deve ser igual ou posterior à data da colheita original.',
      growth_batch_harvest_already_reversed: 'Esta colheita já foi revertida.',
      reversal_reason_required: 'Introduza o motivo da reversão.',
    },
  },
}

export const growthBatchCompletionCopy: Record<Locale, GrowthBatchCompletionCopy> = {
  en: {
    page: {
      eyebrow: 'G1-G5.2 governed lifecycle',
      description: 'Manage live biological or agricultural batches at group level. G5.2 adds governed lifecycle completion after full harvest, event-specific completion reversal, append-only history, and finance isolation.',
      appendOnlyLedger: 'Append-only event ledger',
      noFifoOrCogs: 'No FIFO or COGS claim',
    },
    actions: {
      completeBatch: 'Complete batch',
      reverseCompletion: 'Reverse completion',
      preview: 'Preview',
      close: 'Close',
    },
    labels: {
      tab: 'Completion',
      currentStatus: 'Current status',
      afterStatus: 'After status',
      currentQuantity: 'Current quantity',
      currentWeight: 'Current weight',
      accumulatedCost: 'Accumulated cost',
      harvestedCost: 'Harvested cost',
      remainingCost: 'Remaining cost',
      effectiveDate: 'Effective date',
      reason: 'Reason',
      notes: 'Notes',
      originalEvent: 'Original event',
      stockLedger: 'Stock ledger',
      finance: 'Finance',
      sale: 'Sale',
      cogs: 'COGS',
      sellingPrice: 'Selling price',
      completedAt: 'Completed at',
      lifecycle: 'Lifecycle',
    },
    statuses: {
      active: 'Active',
      completed: 'Completed',
    },
    fallback: {
      notRecorded: 'Not recorded',
      notSelected: 'Not selected',
      teamMember: 'Team member',
      reversed: 'Reversed',
      locked: 'Locked',
      notAffected: 'Not affected',
      unchanged: 'Unchanged',
    },
    dialog: {
      title: 'Complete Growth Batch',
      description: 'Completion closes the batch lifecycle after quantity, weight, and remaining cost have reached zero. It does not create stock, finance, sale, COGS, or price rows.',
      lifecycleNote: 'Full harvest leaves the batch active at zero quantity until this controlled completion is posted.',
      notesHint: 'Optional controlled completion note.',
      reversalTitle: 'Reverse completion',
      reversalDescription: 'This creates a separate completion-reversal event and restores the batch to active status without changing quantity, weight, cost, stock, finance, or prices.',
    },
    history: {
      title: 'Completion history',
      description: 'Completion is a lifecycle-only closeout for fully harvested zero-cost batches. Reversal is event-specific and append-only.',
      emptyTitle: 'No completion yet',
      emptyDescription: 'Complete the batch only after it is fully harvested, has no weight remaining, and has no remaining cost.',
      completionBadge: 'Completion',
      reversalBadge: 'Completion reversal',
      reversedBadge: 'Reversed',
      lockedBadge: 'Locked',
      by: 'by',
      sequencePrefix: 'Seq',
      reversedBy: 'Reversed by',
      onDate: 'on',
      lockedReason: 'Only the latest unreversed completion can be reversed, and the batch state must still match the completion snapshot.',
    },
    preview: {
      readyToast: 'Completion preview is ready',
      blockersToast: 'Preview found blockers. Review quantity, weight, remaining cost, status, and date before completing.',
      stale: 'Preview is stale',
      ready: 'Preview ready',
      blockers: 'Preview blockers',
      lifecycleOnly: 'Lifecycle-only closeout: no stock ledger, finance posting, sale, COGS, or selling-price change is created.',
    },
    success: {
      completed: 'Growth Batch completed',
      reversed: 'Growth Batch completion reversed',
    },
    errors: {
      selectBatch: 'Select a Growth Batch.',
      unavailableActive: 'Completion is only available for active Growth Batches.',
      notReady: 'Completion requires zero current quantity, zero current weight, and zero remaining cost.',
      effectiveDateRequired: 'Select an effective date.',
      dateBeforeStart: 'Completion date must be on or after the batch start date.',
      dateFuture: 'Completion date cannot be in the future.',
      reasonRequired: 'Enter a completion reason.',
      previewRequired: 'Preview the current completion before posting.',
      previewBlockers: 'Resolve preview blockers before completing the batch.',
      previewRefreshRequired: 'Refresh and preview again before completing.',
      managerRequired: 'Only Manager, Admin, or Owner roles can complete or reverse completion.',
      reversalReasonRequired: 'Enter a reversal reason.',
      historyRefreshRequired: 'Refresh the completion history before reversing.',
      requestMismatch: 'This retry key belongs to different completion inputs. Change nothing and retry, or submit the updated completion.',
      requestInProgress: 'A matching completion request is already in progress. Wait a moment and refresh.',
      permissionDenied: 'Your role cannot perform this completion action.',
      actionFailed: 'The Growth Batch completion action failed.',
    },
    blockerLabels: {
      growth_batch_completion_manager_required: 'Only Manager, Admin, or Owner roles can complete or reverse completion.',
      growth_batch_completion_status_invalid: 'Completion requires an active batch; reversal requires a completed batch.',
      growth_batch_completion_quantity_remaining: 'Completion requires zero current quantity.',
      growth_batch_completion_weight_remaining: 'Completion requires zero current weight.',
      growth_batch_completion_cost_remaining: 'Completion requires zero remaining cost.',
      growth_batch_completion_date_before_start: 'Completion date must be on or after the batch start date.',
      growth_batch_completion_date_in_future: 'Completion date cannot be in the future.',
      growth_batch_completion_chronology_invalid: 'Completion date cannot be earlier than the latest state-affecting event.',
      growth_batch_completion_source_fingerprint_required: 'Refresh and preview again before completing.',
      growth_batch_completion_stale_source: 'The batch status, quantity, weight, cost, or sequence changed after preview. Refresh and preview again.',
      growth_batch_completion_reason_required: 'Enter a completion reason.',
      growth_batch_completion_state_changed: 'The batch state changed while completion was being posted. Refresh and try again.',
      growth_batch_completion_reversal_status_invalid: 'Completion reversal requires the batch to still be completed.',
      growth_batch_completion_already_reversed: 'This completion has already been reversed.',
      growth_batch_completion_reversal_dependency_exists: 'A later event depends on this completion. Reverse or resolve later dependent events first.',
      growth_batch_completion_current_state_mismatch: 'The batch no longer matches the completion snapshot. Refresh the history before reversing.',
      growth_batch_completion_original_event_invalid: 'Refresh the completion history before reversing.',
      growth_batch_completion_not_found: 'Refresh the completion history before reversing.',
      growth_batch_completion_reversal_date_before_original: 'Reversal date must be on or after the original completion date.',
      request_key_required: 'Refresh and try again with a valid retry key.',
      idempotency_key_payload_mismatch: 'This retry key belongs to different completion inputs. Change nothing and retry, or submit the updated completion.',
      request_in_progress: 'A matching completion request is already in progress. Wait a moment and refresh.',
      reversal_reason_required: 'Enter a reversal reason.',
      manager_role_required: 'Only Manager, Admin, or Owner roles can complete or reverse completion.',
      growth_batch_not_active: 'Completion is only available for active Growth Batches.',
    },
  },
  pt: {
    page: {
      eyebrow: 'Ciclo de vida governado G1-G5.2',
      description: 'Gerir lotes biológicos ou agrícolas ativos ao nível do grupo. A G5.2 acrescenta a conclusão governada do ciclo de vida após a colheita total, a reversão de conclusão específica do evento, histórico acrescentável e isolamento financeiro.',
      appendOnlyLedger: 'Livro de eventos acrescentável',
      noFifoOrCogs: 'Sem alegação de FIFO ou CMV',
    },
    actions: {
      completeBatch: 'Concluir lote',
      reverseCompletion: 'Reverter conclusão',
      preview: 'Pre-visualizar',
      close: 'Fechar',
    },
    labels: {
      tab: 'Conclusão',
      currentStatus: 'Estado actual',
      afterStatus: 'Estado depois',
      currentQuantity: 'Quantidade actual',
      currentWeight: 'Peso actual',
      accumulatedCost: 'Custo acumulado',
      harvestedCost: 'Custo colhido',
      remainingCost: 'Custo restante',
      effectiveDate: 'Data efectiva',
      reason: 'Motivo',
      notes: 'Notas',
      originalEvent: 'Evento original',
      stockLedger: 'Livro de stock',
      finance: 'Finanças',
      sale: 'Venda',
      cogs: 'CMV',
      sellingPrice: 'Preço de venda',
      completedAt: 'Concluído em',
      lifecycle: 'Ciclo de vida',
    },
    statuses: {
      active: 'Ativo',
      completed: 'Concluído',
    },
    fallback: {
      notRecorded: 'Não registado',
      notSelected: 'Não seleccionado',
      teamMember: 'Membro da equipa',
      reversed: 'Revertida',
      locked: 'Bloqueada',
      notAffected: 'Não afectado',
      unchanged: 'Inalterado',
    },
    dialog: {
      title: 'Concluir Lote de Crescimento',
      description: 'A conclusão fecha o ciclo de vida do lote depois de quantidade, peso e custo restante chegarem a zero. Não cria stock, finanças, venda, CMV nem alteração de preço.',
      lifecycleNote: 'A colheita total deixa o lote ativo com quantidade zero até esta conclusão controlada ser publicada.',
      notesHint: 'Nota controlada opcional da conclusão.',
      reversalTitle: 'Reverter conclusão',
      reversalDescription: 'Esta operação cria um evento separado de reversão da conclusão e restaura o lote para ativo sem alterar quantidade, peso, custo, stock, finanças ou preços.',
    },
    history: {
      title: 'Histórico de conclusão',
      description: 'A conclusão é um encerramento apenas do ciclo de vida para lotes totalmente colhidos e sem custo restante. A reversão é específica ao evento e acrescentada ao histórico.',
      emptyTitle: 'Ainda não existe conclusão',
      emptyDescription: 'Conclua o lote apenas depois de estar totalmente colhido, sem peso restante e sem custo restante.',
      completionBadge: 'Conclusão',
      reversalBadge: 'Reversão da conclusão',
      reversedBadge: 'Revertida',
      lockedBadge: 'Bloqueada',
      by: 'por',
      sequencePrefix: 'Seq.',
      reversedBy: 'Revertida por',
      onDate: 'em',
      lockedReason: 'Apenas a conclusão não revertida mais recente pode ser revertida, e o estado do lote deve continuar igual ao registo da conclusão.',
    },
    preview: {
      readyToast: 'A pré-visualização da conclusão está pronta',
      blockersToast: 'A pré-visualização encontrou bloqueios. Reveja quantidade, peso, custo restante, estado e data antes de concluir.',
      stale: 'A pré-visualização está desatualizada',
      ready: 'Pré-visualização pronta',
      blockers: 'Bloqueios da pré-visualização',
      lifecycleOnly: 'Encerramento apenas do ciclo de vida: não cria livro de stock, lançamento financeiro, venda, CMV nem altera o preço de venda.',
    },
    success: {
      completed: 'Lote de Crescimento concluído',
      reversed: 'Conclusão do Lote de Crescimento revertida',
    },
    errors: {
      selectBatch: 'Seleccione um Lote de Crescimento.',
      unavailableActive: 'A conclusão só está disponível para Lotes de Crescimento ativos.',
      notReady: 'A conclusão exige quantidade actual zero, peso actual zero e custo restante zero.',
      effectiveDateRequired: 'Seleccione uma data efectiva.',
      dateBeforeStart: 'A data da conclusão deve ser igual ou posterior à data de início do lote.',
      dateFuture: 'A data da conclusão não pode estar no futuro.',
      reasonRequired: 'Introduza o motivo da conclusão.',
      previewRequired: 'Pré-visualize a conclusão actual antes de publicar.',
      previewBlockers: 'Resolva os bloqueios da pré-visualização antes de concluir o lote.',
      previewRefreshRequired: 'Actualize e pré-visualize novamente antes de concluir.',
      managerRequired: 'Apenas as funções Manager, Admin ou Owner podem concluir ou reverter a conclusão.',
      reversalReasonRequired: 'Introduza o motivo da reversão.',
      historyRefreshRequired: 'Actualize o histórico de conclusão antes de reverter.',
      requestMismatch: 'Esta chave de repetição pertence a dados de conclusão diferentes. Não altere nada e tente novamente, ou submeta a conclusão atualizada.',
      requestInProgress: 'Já existe um pedido de conclusão correspondente em curso. Aguarde um momento e actualize.',
      permissionDenied: 'A sua função não pode executar esta ação de conclusão.',
      actionFailed: 'A ação de conclusão do Lote de Crescimento falhou.',
    },
    blockerLabels: {
      growth_batch_completion_manager_required: 'Apenas as funções Manager, Admin ou Owner podem concluir ou reverter a conclusão.',
      growth_batch_completion_status_invalid: 'A conclusão exige lote ativo; a reversão exige lote concluído.',
      growth_batch_completion_quantity_remaining: 'A conclusão exige quantidade actual zero.',
      growth_batch_completion_weight_remaining: 'A conclusão exige peso actual zero.',
      growth_batch_completion_cost_remaining: 'A conclusão exige custo restante zero.',
      growth_batch_completion_date_before_start: 'A data da conclusão deve ser igual ou posterior à data de início do lote.',
      growth_batch_completion_date_in_future: 'A data da conclusão não pode estar no futuro.',
      growth_batch_completion_chronology_invalid: 'A data da conclusão não pode ser anterior ao evento mais recente que afeta o estado.',
      growth_batch_completion_source_fingerprint_required: 'Actualize e pré-visualize novamente antes de concluir.',
      growth_batch_completion_stale_source: 'O estado, quantidade, peso, custo ou sequência do lote mudou depois da pré-visualização. Actualize e pré-visualize novamente.',
      growth_batch_completion_reason_required: 'Introduza o motivo da conclusão.',
      growth_batch_completion_state_changed: 'O estado do lote mudou enquanto a conclusão estava a ser publicada. Actualize e tente novamente.',
      growth_batch_completion_reversal_status_invalid: 'A reversão da conclusão exige que o lote continue concluído.',
      growth_batch_completion_already_reversed: 'Esta conclusão já foi revertida.',
      growth_batch_completion_reversal_dependency_exists: 'Um evento posterior depende desta conclusão. Reverta ou resolva primeiro os eventos dependentes posteriores.',
      growth_batch_completion_current_state_mismatch: 'O lote já não corresponde ao registo desta conclusão. Actualize o histórico antes de reverter.',
      growth_batch_completion_original_event_invalid: 'Actualize o histórico de conclusão antes de reverter.',
      growth_batch_completion_not_found: 'Actualize o histórico de conclusão antes de reverter.',
      growth_batch_completion_reversal_date_before_original: 'A data de reversão deve ser igual ou posterior à data da conclusão original.',
      request_key_required: 'Actualize e tente novamente com uma chave de repetição válida.',
      idempotency_key_payload_mismatch: 'Esta chave de repetição pertence a dados de conclusão diferentes. Não altere nada e tente novamente, ou submeta a conclusão atualizada.',
      request_in_progress: 'Já existe um pedido de conclusão correspondente em curso. Aguarde um momento e actualize.',
      reversal_reason_required: 'Introduza o motivo da reversão.',
      manager_role_required: 'Apenas as funções Manager, Admin ou Owner podem concluir ou reverter a conclusão.',
      growth_batch_not_active: 'A conclusão só está disponível para Lotes de Crescimento ativos.',
    },
  },
}
