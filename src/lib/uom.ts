export type ConvRow = { from_uom_id: string; to_uom_id: string; factor: number }
export type ConvEdge = { to: string; factor: number }

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
