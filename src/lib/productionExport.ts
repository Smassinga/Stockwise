import type {
  FinanceExportCompany,
  FinanceExportLanguage,
  FinanceExportModel,
  FinanceExportSection,
} from './financeExport'
import { sanitizeFinanceFilename } from './financeExport'

type ProductionCopy = {
  recipeTitle: string
  runTitle: string
  batchTitle: string
  summary: string
  costSummary: string
  components: string
  inputs: string
  extraCosts: string
  outputs: string
  measurements: string
  directCosts: string
  materials: string
  losses: string
  transfers: string
  harvests: string
  completion: string
  history: string
  label: Record<string, string>
  recipeDisclaimer: string
  runDisclaimer: string
  batchDisclaimer: string
}

const copyByLanguage: Record<'en' | 'pt', ProductionCopy> = {
  en: {
    recipeTitle: 'Recipe Specification',
    runTitle: 'Production Run Cost Sheet',
    batchTitle: 'Growth Batch Activity & Cost Report',
    summary: 'Summary',
    costSummary: 'Cost summary',
    components: 'Components',
    inputs: 'Inputs',
    extraCosts: 'Additional direct-cost snapshots',
    outputs: 'Outputs',
    measurements: 'Measurements',
    directCosts: 'Direct memo costs',
    materials: 'Stock inputs',
    losses: 'Losses',
    transfers: 'Location transfers',
    harvests: 'Harvests',
    completion: 'Completion',
    history: 'Event timeline',
    label: {
      field: 'Field',
      value: 'Value',
      item: 'Item',
      sku: 'SKU',
      quantity: 'Quantity',
      entryUom: 'Entry UOM',
      baseUom: 'Base UOM',
      scrap: 'Scrap',
      availability: 'Available',
      unitCost: 'Unit cost',
      totalCost: 'Total cost',
      source: 'Source',
      destination: 'Destination',
      date: 'Date',
      type: 'Type',
      reference: 'Reference',
      status: 'Status',
      sequence: 'Sequence',
      actor: 'Actor',
      effect: 'Effect',
      notes: 'Notes',
      recipe: 'Recipe',
      version: 'Version',
      finishedItem: 'Finished item',
      active: 'Active',
      yes: 'Yes',
      no: 'No',
      planningTime: 'Planning time',
      stockCapacity: 'Stock capacity',
      estimatedMaterialCost: 'Current estimated material cost',
      costEvidence: 'Cost evidence',
      runDate: 'Run date',
      recipeSnapshot: 'Recipe snapshot',
      plannedOutput: 'Planned output',
      actualOutput: 'Actual output',
      materialCost: 'Material cost',
      extraCost: 'Additional direct cost',
      totalProductionCost: 'Total production cost',
      outputUnitCost: 'Output unit cost',
      name: 'Name',
      family: 'Family',
    },
    recipeDisclaimer: 'Estimated material cost uses current weighted-average stock cost. It is not a frozen Production Run cost or an accounting posting.',
    runDisclaimer: 'Additional direct costs are Production Run cost snapshots. They do not create cash, bank, AP, settlement or journal postings.',
    batchDisclaimer: 'This is an operational group-level Growth Batch report. It is not an individual animal or plant register, COGS calculation, fair-value valuation, or financial statement.',
  },
  pt: {
    recipeTitle: 'Especificação da Receita',
    runTitle: 'Folha de Custos da Execução de Produção',
    batchTitle: 'Relatório de Actividade e Custos do Lote de Crescimento',
    summary: 'Resumo',
    costSummary: 'Resumo de custos',
    components: 'Componentes',
    inputs: 'Insumos',
    extraCosts: 'Registos de custos directos adicionais',
    outputs: 'Produção',
    measurements: 'Medições',
    directCosts: 'Custos directos informativos',
    materials: 'Insumos de stock',
    losses: 'Perdas',
    transfers: 'Transferências de localização',
    harvests: 'Colheitas',
    completion: 'Conclusão',
    history: 'Linha cronológica de eventos',
    label: {
      field: 'Campo',
      value: 'Valor',
      item: 'Item',
      sku: 'SKU',
      quantity: 'Quantidade',
      entryUom: 'Unidade de entrada',
      baseUom: 'Unidade base',
      scrap: 'Desperdício',
      availability: 'Disponível',
      unitCost: 'Custo unitário',
      totalCost: 'Custo total',
      source: 'Origem',
      destination: 'Destino',
      date: 'Data',
      type: 'Tipo',
      reference: 'Referência',
      status: 'Estado',
      sequence: 'Sequência',
      actor: 'Responsável',
      effect: 'Efeito',
      notes: 'Notas',
      recipe: 'Receita',
      version: 'Versão',
      finishedItem: 'Item acabado',
      active: 'Activa',
      yes: 'Sim',
      no: 'Não',
      planningTime: 'Tempo de planeamento',
      stockCapacity: 'Capacidade de stock',
      estimatedMaterialCost: 'Custo actual estimado dos materiais',
      costEvidence: 'Evidência de custo',
      runDate: 'Data da execução',
      recipeSnapshot: 'Registo da receita',
      plannedOutput: 'Produção planeada',
      actualOutput: 'Produção real',
      materialCost: 'Custo dos materiais',
      extraCost: 'Custo directo adicional',
      totalProductionCost: 'Custo total de produção',
      outputUnitCost: 'Custo unitário da produção',
      name: 'Nome',
      family: 'Família',
    },
    recipeDisclaimer: 'O custo actual estimado dos materiais usa o custo médio ponderado actual do stock. Não é um custo registado numa Execução de Produção nem um lançamento contabilístico.',
    runDisclaimer: 'Os custos directos adicionais são registos de custo da Execução de Produção. Não criam lançamentos de caixa, banco, contas a pagar, liquidação ou diário.',
    batchDisclaimer: 'Este é um relatório operacional de um Lote de Crescimento ao nível do grupo. Não é um registo individual de animais ou plantas, cálculo de COGS, valorização ao justo valor ou demonstração financeira.',
  },
}

const display = (value: unknown, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

const sectionFromPairs = (
  title: string,
  copy: ProductionCopy,
  pairs: Array<[string, unknown]>,
): FinanceExportSection => ({
  title,
  columns: [
    { key: 'field', label: copy.label.field, width: 28 },
    { key: 'value', label: copy.label.value, width: 44 },
  ],
  rows: pairs.map(([field, value]) => ({ field, value: display(value) })),
})

const currencySectionFromPairs = (
  title: string,
  copy: ProductionCopy,
  pairs: Array<[string, number]>,
): FinanceExportSection => ({
  title,
  columns: [
    { key: 'field', label: copy.label.field, width: 32 },
    { key: 'value', label: copy.label.value, type: 'currency', width: 22 },
  ],
  rows: pairs.map(([field, value]) => ({ field, value })),
})

const exportLanguage = (language: FinanceExportLanguage) => language === 'pt' ? 'pt' : 'en'
const versionLabel = (version: string | null | undefined) => {
  const value = String(version || '').trim()
  if (!value) return ''
  return /^v/i.test(value) ? value : `v${value}`
}

export type RecipeExportInput = {
  company: FinanceExportCompany
  language: FinanceExportLanguage
  baseCurrency: string
  name: string
  version: string | null
  active: boolean
  finishedItem: string
  planningTime: string
  stockCapacity: string
  estimatedMaterialCost: number | null
  estimatedCostState: string
  components: Array<{
    item: string
    sku?: string | null
    quantity: number
    entryUom?: string | null
    baseUom?: string | null
    scrapPct: number
    availability?: number | null
    unitCost?: number | null
    sourceStatus?: string | null
  }>
}

export function buildRecipeExportModel(input: RecipeExportInput): FinanceExportModel {
  const language = exportLanguage(input.language)
  const copy = copyByLanguage[language]
  const generatedAt = new Date().toISOString()
  return {
    filename: sanitizeFinanceFilename(`StockWise_Recipe_${input.name}_${generatedAt.slice(0, 10)}`),
    orientation: 'landscape',
    context: {
      title: copy.recipeTitle,
      subtitle: `${input.finishedItem} · ${input.name}${input.version ? ` ${versionLabel(input.version)}` : ''}`,
      language: input.language,
      generatedAt,
      company: input.company,
      baseCurrency: input.baseCurrency,
      disclaimer: copy.recipeDisclaimer,
    },
    summary: [
      { label: copy.label.recipe, value: input.name },
      { label: copy.label.version, value: input.version || '—' },
      { label: copy.label.finishedItem, value: input.finishedItem },
      { label: copy.label.active, value: input.active ? copy.label.yes : copy.label.no },
      { label: copy.label.planningTime, value: input.planningTime },
      { label: copy.label.stockCapacity, value: input.stockCapacity },
      { label: copy.label.estimatedMaterialCost, value: input.estimatedMaterialCost, type: 'currency' },
      { label: copy.label.costEvidence, value: input.estimatedCostState },
    ],
    sections: [{
      title: copy.components,
      columns: [
        { key: 'item', label: copy.label.item, width: 28 },
        { key: 'sku', label: copy.label.sku, width: 14 },
        { key: 'quantity', label: copy.label.quantity, type: 'number', width: 13 },
        { key: 'entryUom', label: copy.label.entryUom, width: 15 },
        { key: 'baseUom', label: copy.label.baseUom, width: 15 },
        { key: 'scrapPct', label: copy.label.scrap, type: 'number', width: 12 },
        { key: 'availability', label: copy.label.availability, type: 'number', width: 14 },
        { key: 'unitCost', label: copy.label.unitCost, type: 'currency', width: 15 },
        { key: 'sourceStatus', label: copy.label.source, width: 18 },
      ],
      rows: input.components.map((component) => ({ ...component })),
    }],
  }
}

export type ProductionRunExportInput = {
  company: FinanceExportCompany
  language: FinanceExportLanguage
  baseCurrency: string
  reference: string
  status: string
  runDate: string
  recipe: string
  version?: string | null
  finishedItem: string
  plannedOutput: number
  actualOutput: number | null
  materialCost: number
  extraCost: number
  totalCost: number
  outputUnitCost: number
  destination: string
  inputs: Array<Record<string, string | number | null>>
  extraCosts: Array<Record<string, string | number | null>>
  outputs: Array<Record<string, string | number | null>>
}

export function buildProductionRunExportModel(input: ProductionRunExportInput): FinanceExportModel {
  const language = exportLanguage(input.language)
  const copy = copyByLanguage[language]
  const generatedAt = new Date().toISOString()
  const costLabel = input.status === 'draft'
    ? (language === 'pt' ? 'Estimativa da pré-visualização' : 'Preview estimate')
    : (language === 'pt' ? 'Custo registado na produção' : 'Frozen posted cost')
  return {
    filename: sanitizeFinanceFilename(`StockWise_Production_Run_${input.reference}_${generatedAt.slice(0, 10)}`),
    orientation: 'landscape',
    context: {
      title: copy.runTitle,
      subtitle: `${input.reference} · ${input.finishedItem}`,
      language: input.language,
      generatedAt,
      company: input.company,
      baseCurrency: input.baseCurrency,
      disclaimer: copy.runDisclaimer,
      filters: [costLabel],
    },
    summary: [
      { label: copy.label.reference, value: input.reference },
      { label: copy.label.status, value: input.status },
      { label: copy.label.runDate, value: input.runDate },
      { label: copy.label.recipeSnapshot, value: `${input.recipe}${input.version ? ` ${versionLabel(input.version)}` : ''}` },
      { label: copy.label.finishedItem, value: input.finishedItem },
      { label: copy.label.plannedOutput, value: input.plannedOutput, type: 'number' },
      { label: copy.label.actualOutput, value: input.actualOutput, type: 'number' },
      { label: copy.label.materialCost, value: input.materialCost, type: 'currency' },
      { label: copy.label.extraCost, value: input.extraCost, type: 'currency' },
      { label: copy.label.totalProductionCost, value: input.totalCost, type: 'currency' },
      { label: copy.label.outputUnitCost, value: input.outputUnitCost, type: 'currency' },
      { label: copy.label.destination, value: input.destination },
    ],
    sections: [
      {
        title: copy.inputs,
        columns: [
          { key: 'item', label: copy.label.item, width: 28 },
          { key: 'quantity', label: copy.label.quantity, type: 'number', width: 14 },
          { key: 'source', label: copy.label.source, width: 28 },
          { key: 'unitCost', label: copy.label.unitCost, type: 'currency', width: 16 },
          { key: 'totalCost', label: copy.label.totalCost, type: 'currency', width: 16 },
          { key: 'reference', label: copy.label.reference, width: 20 },
        ],
        rows: input.inputs,
      },
      {
        title: copy.extraCosts,
        columns: [
          { key: 'type', label: copy.label.type, width: 18 },
          { key: 'notes', label: copy.label.notes, width: 42 },
          { key: 'totalCost', label: copy.label.totalCost, type: 'currency', width: 18 },
        ],
        rows: input.extraCosts,
      },
      {
        title: copy.outputs,
        columns: [
          { key: 'item', label: copy.label.item, width: 28 },
          { key: 'quantity', label: copy.label.quantity, type: 'number', width: 14 },
          { key: 'destination', label: copy.label.destination, width: 28 },
          { key: 'unitCost', label: copy.label.unitCost, type: 'currency', width: 16 },
          { key: 'totalCost', label: copy.label.totalCost, type: 'currency', width: 16 },
          { key: 'reference', label: copy.label.reference, width: 20 },
        ],
        rows: input.outputs,
      },
    ],
  }
}

export type GrowthBatchExportInput = {
  company: FinanceExportCompany
  language: FinanceExportLanguage
  baseCurrency: string
  selectedSections: string[]
  reference: string
  name: string
  family: string
  status: string
  startDate: string
  expectedEnd?: string | null
  summary: Array<[string, unknown]>
  costSummary: Array<[string, number]>
  measurements: Array<Record<string, string | number | null>>
  directCosts: Array<Record<string, string | number | null>>
  materials: Array<Record<string, string | number | null>>
  losses: Array<Record<string, string | number | null>>
  transfers: Array<Record<string, string | number | null>>
  harvests: Array<Record<string, string | number | null>>
  completions: Array<Record<string, string | number | null>>
  history: Array<Record<string, string | number | null>>
}

export function buildGrowthBatchExportModel(input: GrowthBatchExportInput): FinanceExportModel {
  const language = exportLanguage(input.language)
  const copy = copyByLanguage[language]
  const generatedAt = new Date().toISOString()
  const selected = new Set(input.selectedSections)
  const sections: FinanceExportSection[] = [
    sectionFromPairs(copy.summary, copy, input.summary),
    currencySectionFromPairs(copy.costSummary, copy, input.costSummary),
  ]
  const eventColumns = [
    { key: 'sequence', label: copy.label.sequence, type: 'number' as const, width: 10 },
    { key: 'reference', label: copy.label.reference, width: 22 },
    { key: 'date', label: copy.label.date, type: 'date' as const, width: 14 },
    { key: 'type', label: copy.label.type, width: 18 },
    { key: 'effect', label: copy.label.effect, width: 32 },
    { key: 'actor', label: copy.label.actor, width: 20 },
    { key: 'notes', label: copy.label.notes, width: 32 },
  ]
  const add = (id: string, title: string, rows: Array<Record<string, string | number | null>>) => {
    if (selected.has(id) && rows.length) sections.push({ title, columns: eventColumns, rows })
  }
  add('materials', copy.materials, input.materials)
  add('costs', copy.directCosts, input.directCosts)
  add('lifecycle-losses', copy.losses, input.losses)
  add('lifecycle-transfers', copy.transfers, input.transfers)
  add('lifecycle-harvests', copy.harvests, input.harvests)
  add('lifecycle-completion', copy.completion, input.completions)
  add('measurements', copy.measurements, input.measurements)
  add('history', copy.history, input.history)

  return {
    filename: sanitizeFinanceFilename(`StockWise_Growth_Batch_${input.reference}_${generatedAt.slice(0, 10)}`),
    orientation: 'landscape',
    context: {
      title: copy.batchTitle,
      subtitle: `${input.reference} · ${input.name}`,
      language: input.language,
      generatedAt,
      company: input.company,
      baseCurrency: input.baseCurrency,
      period: { from: input.startDate, to: input.expectedEnd || null },
      disclaimer: copy.batchDisclaimer,
    },
    summary: [
      { label: copy.label.reference, value: input.reference },
      { label: copy.label.name, value: input.name },
      { label: copy.label.family, value: input.family },
      { label: copy.label.status, value: input.status },
    ],
    sections,
  }
}
