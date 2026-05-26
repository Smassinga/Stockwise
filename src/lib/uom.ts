export type ConvRow = { from_uom_id: string; to_uom_id: string; factor: number }
export type ConvEdge = { to: string; factor: number }

export const DEFAULT_UOM_FAMILY_ORDER = ['count', 'mass', 'length', 'area', 'volume', 'time', 'other', 'unspecified'] as const

const UOM_ALIASES: Record<string, string> = {
  EA: 'EA',
  EACH: 'EA',
  EACHES: 'EA',
  PCS: 'PCS',
  PIECE: 'PCS',
  PIECES: 'PCS',
  PAIR: 'PAIR',
  PAIRS: 'PAIR',
  SET: 'SET',
  SETS: 'SET',
  PACK: 'PACK',
  PACKS: 'PACK',
  BOX: 'BOX',
  BOXES: 'BOX',
  BAG: 'BAG',
  BAGS: 'BAG',
  CASE: 'CASE',
  CASES: 'CASE',
  CARTON: 'CARTON',
  CARTONS: 'CARTON',
  ROLL: 'ROLL',
  ROLLS: 'ROLL',
  SHEET: 'SHEET',
  SHEETS: 'SHEET',
  MG: 'MG',
  MILLIGRAM: 'MG',
  MILLIGRAMS: 'MG',
  G: 'G',
  GRAM: 'G',
  GRAMS: 'G',
  KG: 'KG',
  KILOGRAM: 'KG',
  KILOGRAMS: 'KG',
  T: 'T',
  TONNE: 'T',
  TONNES: 'T',
  METRICTON: 'T',
  METRICTONNE: 'T',
  MM: 'MM',
  MILLIMETRE: 'MM',
  MILLIMETER: 'MM',
  MILLIMETRES: 'MM',
  MILLIMETERS: 'MM',
  CM: 'CM',
  CENTIMETRE: 'CM',
  CENTIMETER: 'CM',
  CENTIMETRES: 'CM',
  CENTIMETERS: 'CM',
  M: 'M',
  METRE: 'M',
  METER: 'M',
  METRES: 'M',
  METERS: 'M',
  KM: 'KM',
  KILOMETRE: 'KM',
  KILOMETER: 'KM',
  KILOMETRES: 'KM',
  KILOMETERS: 'KM',
  CM2: 'CM2',
  SQUARECENTIMETRE: 'CM2',
  SQUARECENTIMETER: 'CM2',
  M2: 'M2',
  SQUAREMETRE: 'M2',
  SQUAREMETER: 'M2',
  ML: 'ML',
  MILLILITRE: 'ML',
  MILLILITER: 'ML',
  MILLILITRES: 'ML',
  MILLILITERS: 'ML',
  L: 'L',
  LITRE: 'L',
  LITER: 'L',
  LITRES: 'L',
  LITERS: 'L',
  M3: 'M3',
  CUBICMETRE: 'M3',
  CUBICMETER: 'M3',
  MIN: 'MIN',
  MINUTE: 'MIN',
  MINUTES: 'MIN',
  HOUR: 'HOUR',
  HOURS: 'HOUR',
  HR: 'HOUR',
  HRS: 'HOUR',
  DAY: 'DAY',
  DAYS: 'DAY',
  PALLET: 'PALLET',
  PALLETS: 'PALLET',
  CRATE: 'CRATE',
  CRATES: 'CRATE',
  BUNDLE: 'BUNDLE',
  BUNDLES: 'BUNDLE',
}

const GENERATED_UOM_CODE_RE = /^(?:UI-[A-Z0-9]+|[A-Z0-9]+-[A-Z0-9-]+-(EA|EACH|PCS|PAIR|SET|PACK|BOX|BAG|CASE|CARTON|ROLL|SHEET|MG|G|KG|T|MM|CM|M|KM|CM2|M2|ML|L|M3|MIN|HOUR|DAY|PALLET|CRATE|BUNDLE))$/

export function canonicalUomCode(value: string | null | undefined): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
  return UOM_ALIASES[normalized] || ''
}

export function normalizeUomCodeInput(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  return canonicalUomCode(raw) || raw.toUpperCase()
}

export function uomCodeLooksGenerated(value: string | null | undefined): boolean {
  return GENERATED_UOM_CODE_RE.test(String(value ?? '').trim().toUpperCase())
}

export function isReusableUomCode(value: string | null | undefined): boolean {
  const code = String(value ?? '').trim().toUpperCase()
  return Boolean(code) && !uomCodeLooksGenerated(code)
}

export function familySortIndex(family: string | null | undefined): number {
  const key = String(family || 'unspecified').trim().toLowerCase()
  const index = DEFAULT_UOM_FAMILY_ORDER.indexOf(key as typeof DEFAULT_UOM_FAMILY_ORDER[number])
  return index === -1 ? DEFAULT_UOM_FAMILY_ORDER.length : index
}

/**
 * FACTOR CONVENTION (very important):
 *   1 × (FROM UoM) × factor = (TO UoM)
 * Example:
 *   TON -> KG, factor = 1000  (1 TON × 1000 = 1000 KG)
 * We automatically add the inverted edge (KG -> TON, 1/1000) in memory.
 */
export function buildConvGraph(rows: ConvRow[]): Map<string, ConvEdge[]> {
  const g = new Map<string, ConvEdge[]>()

  const add = (from: string, to: string, factor: number) => {
    if (!from || !to || !Number.isFinite(factor) || factor <= 0) return
    if (!g.has(from)) g.set(from, [])
    g.get(from)!.push({ to, factor })
  }

  for (const r of rows || []) {
    const f = Number(r.factor)
    if (!Number.isFinite(f) || f <= 0) continue
    add(r.from_uom_id, r.to_uom_id, f)
    add(r.to_uom_id, r.from_uom_id, 1 / f)
  }

  return g
}

/**
 * Convert qty from one UoM to another via BFS over the conversion graph.
 * Throws Error if no path exists.
 */
export function convertQty(
  qty: number,
  fromUomId: string,
  toUomId: string,
  graph: Map<string, ConvEdge[]>
): number {
  if (!Number.isFinite(qty)) throw new Error('Invalid quantity')
  if (!fromUomId || !toUomId) throw new Error('Invalid UoM')
  if (fromUomId === toUomId) return qty

  const visited = new Set<string>([fromUomId])
  const queue: Array<{ id: string; acc: number }> = [{ id: fromUomId, acc: qty }]

  while (queue.length) {
    const { id, acc } = queue.shift()!
    const edges = graph.get(id) || []
    for (const e of edges) {
      if (visited.has(e.to)) continue
      const next = acc * e.factor
      if (e.to === toUomId) return next
      visited.add(e.to)
      queue.push({ id: e.to, acc: next })
    }
  }

  throw new Error('No conversion path between selected units')
}

/** Non-throwing helper */
export function tryConvertQty(
  qty: number,
  fromUomId: string,
  toUomId: string,
  graph: Map<string, ConvEdge[]> | null
): number | null {
  try {
    if (!graph) return null
    return convertQty(qty, fromUomId, toUomId, graph)
  } catch {
    return null
  }
}
