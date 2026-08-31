import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { SalesInvoiceDocumentLineRow } from '../../lib/mzFinance'

type SalesInvoiceLinesCardProps = {
  lines: SalesInvoiceDocumentLineRow[]
  title: string
  description: string
  emptyLabel: string
  descriptionDashLabel: string
  unitDashLabel: string
  headers: {
    description: string
    qty: string
    unit: string
    unitPrice: string
    total: string
    subtotal: string
    vat: string
  }
  formatMoney: (amount: number) => string
}

export default function SalesInvoiceLinesCard({
  lines,
  title,
  description,
  emptyLabel,
  descriptionDashLabel,
  unitDashLabel,
  headers,
  formatMoney,
}: SalesInvoiceLinesCardProps) {
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
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>{headers.description}</TableHead>
                <TableHead className="text-right">{headers.qty}</TableHead>
                <TableHead className="text-right">{headers.unit}</TableHead>
                <TableHead className="text-right">{headers.unitPrice}</TableHead>
                <TableHead className="text-right">{headers.total}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div className="font-medium">{line.display_description || line.description || descriptionDashLabel}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[
                        line.product_code_snapshot || null,
                        line.tax_label_snapshot
                          ? `${line.tax_label_snapshot} (${Number(line.tax_rate || 0).toLocaleString()}%)`
                          : null,
                        `${headers.subtotal}: ${formatMoney(line.line_total)}`,
                        `${headers.vat}: ${formatMoney(line.tax_amount)}`,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{line.qty}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {line.display_unit_of_measure || line.unit_of_measure_snapshot || unitDashLabel}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(line.unit_price)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(line.line_total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
