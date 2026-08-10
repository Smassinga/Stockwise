export type OperatorSalePayloadLine = {
  itemId: string
  qty: number
  unitPrice?: number | null
}

export function toOperatorSaleRpcLines(lines: OperatorSalePayloadLine[]) {
  return lines.map((line) => ({
    item_id: line.itemId,
    qty: line.qty,
    unit_price: line.unitPrice ?? null,
  }))
}
