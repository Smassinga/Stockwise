import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { VendorBillLineRow } from '../../lib/financeDocuments'

type VendorBillLinesCardProps = {
  lines: VendorBillLineRow[]
  title: string
  description: string
  emptyLabel: string
  dashLabel: string
  headers: {
    description: string
    qty: string
    unitCost: string
    tax: string
    total: string
  }
  formatMoney: (amount: number) => string
}

export default function VendorBillLinesCard({
  lines,
  title,
  description,
  emptyLabel,
  dashLabel,
  headers,
  formatMoney,
}: VendorBillLinesCardProps) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="hidden sm:block">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{headers.description}</TableHead>
                <TableHead className="text-right">{headers.qty}</TableHead>
                <TableHead className="text-right">{headers.unitCost}</TableHead>
                <TableHead className="text-right">{headers.tax}</TableHead>
                <TableHead className="text-right">{headers.total}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div>{line.description || dashLabel}</div>
                    {line.tax_label_snapshot ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {line.tax_label_snapshot} ({Number(line.tax_rate || 0).toLocaleString()}%)
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{line.qty}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(line.unit_cost)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(line.tax_amount)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(line.line_total + line.tax_amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
