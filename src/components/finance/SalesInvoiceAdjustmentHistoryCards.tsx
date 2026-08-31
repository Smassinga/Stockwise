import { Download, Printer } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { SalesCreditNoteRow, SalesDebitNoteRow } from '../../lib/mzFinance'

type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string

type SalesInvoiceAdjustmentHistoryCardsProps = {
  creditNotes: SalesCreditNoteRow[]
  debitNotes: SalesDebitNoteRow[]
  isActive: boolean
  canCreateCredit: boolean
  canCreateDebit: boolean
  creditBlockedMessage: string
  debitBlockedMessage: string
  translate: Translate
  formatDate: (value?: string | null) => string
  formatMoney: (amount: number, currencyCode: string) => string
  creditReasonLabel: (note: SalesCreditNoteRow) => string
  debitReasonLabel: (note: SalesDebitNoteRow) => string
  onOpenCredit: () => void
  onOpenDebit: () => void
  onPrintCredit: (note: SalesCreditNoteRow) => void
  onDownloadCredit: (note: SalesCreditNoteRow) => void
  onPrintDebit: (note: SalesDebitNoteRow) => void
  onDownloadDebit: (note: SalesDebitNoteRow) => void
}

export default function SalesInvoiceAdjustmentHistoryCards({
  creditNotes,
  debitNotes,
  isActive,
  canCreateCredit,
  canCreateDebit,
  creditBlockedMessage,
  debitBlockedMessage,
  translate,
  formatDate,
  formatMoney,
  creditReasonLabel,
  debitReasonLabel,
  onOpenCredit,
  onOpenDebit,
  onPrintCredit,
  onDownloadCredit,
  onPrintDebit,
  onDownloadDebit,
}: SalesInvoiceAdjustmentHistoryCardsProps) {
  const headers = (
    <TableRow>
      <TableHead>{translate('financeDocs.fields.internalReference', 'Internal reference')}</TableHead>
      <TableHead>{translate('financeDocs.fields.invoiceDate', 'Date')}</TableHead>
      <TableHead>{translate('financeDocs.fields.workflow', 'Workflow')}</TableHead>
      <TableHead>{translate('orders.notes', 'Notes')}</TableHead>
      <TableHead className="text-right">{translate('financeDocs.fields.total', 'Total')}</TableHead>
      <TableHead className="text-right">{translate('orders.actions', 'Actions')}</TableHead>
    </TableRow>
  )

  return (
    <>
      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>{translate('financeDocs.mz.creditNotes', 'Credit notes')}</CardTitle>
          <CardDescription className="hidden sm:block">
            {translate('financeDocs.mz.creditNotesHelp', 'Use credit notes for downward adjustments. Choose a full remaining reversal or a partial line-by-line credit without editing the issued invoice itself.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isActive ? (
            canCreateCredit ? (
              <Button className="w-full sm:w-auto" onClick={onOpenCredit}>
                {translate('financeDocs.mz.issueCreditNote', 'Issue credit note')}
              </Button>
            ) : (
              <div className="border-l-2 border-status-info-border bg-status-info-muted px-4 py-3 text-sm text-status-info-foreground">
                {creditBlockedMessage}
              </div>
            )
          ) : (
            <div className="rounded-xl border border-status-warning-border bg-status-warning-muted p-3 text-sm text-status-warning-foreground">
              {translate('financeDocs.mz.creditNotesIssueOnly', 'Credit notes can only be created from issued invoices.')}
            </div>
          )}

          {creditNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{translate('financeDocs.mz.creditNotesEmpty', 'No credit notes have been issued against this invoice yet.')}</p>
          ) : (
            <Table>
              <TableHeader>{headers}</TableHeader>
              <TableBody>
                {creditNotes.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell className="font-medium">{note.internal_reference}</TableCell>
                    <TableCell>{formatDate(note.credit_note_date)}</TableCell>
                    <TableCell>
                      <Badge variant={note.document_workflow_status === 'issued' ? 'default' : 'secondary'}>
                        {note.document_workflow_status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {note.correction_reason_code ? <Badge variant="outline">{creditReasonLabel(note)}</Badge> : null}
                        {note.correction_reason_text ? <div className="text-sm text-muted-foreground">{note.correction_reason_text}</div> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(note.total_amount, note.currency_code)}</TableCell>
                    <TableCell className="text-right">
                      {note.document_workflow_status === 'issued' ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => onPrintCredit(note)}>
                            <Printer className="mr-2 h-4 w-4" />
                            {translate('financeDocs.mz.printInvoice', 'Print')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onDownloadCredit(note)}>
                            <Download className="mr-2 h-4 w-4" />
                            {translate('financeDocs.mz.downloadPdf', 'Download PDF')}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>{translate('financeDocs.mz.debitNotes', 'Debit notes')}</CardTitle>
          <CardDescription className="hidden sm:block">
            {translate('financeDocs.mz.debitNotesHelp', 'Use debit notes for upward adjustments, underbilling corrections, and additional value that must remain linked to the issued invoice chain.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isActive ? (
            canCreateDebit ? (
              <Button className="w-full sm:w-auto" onClick={onOpenDebit}>
                {translate('financeDocs.mz.issueDebitNote', 'Issue debit note')}
              </Button>
            ) : (
              <div className="border-l-2 border-status-info-border bg-status-info-muted px-4 py-3 text-sm text-status-info-foreground">
                {debitBlockedMessage}
              </div>
            )
          ) : (
            <div className="rounded-xl border border-status-warning-border bg-status-warning-muted p-3 text-sm text-status-warning-foreground">
              {translate('financeDocs.mz.debitNotesIssueOnly', 'Debit notes can only be created from issued invoices.')}
            </div>
          )}

          {debitNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{translate('financeDocs.mz.debitNotesEmpty', 'No debit notes have been issued against this invoice yet.')}</p>
          ) : (
            <Table>
              <TableHeader>{headers}</TableHeader>
              <TableBody>
                {debitNotes.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell className="font-medium">{note.internal_reference}</TableCell>
                    <TableCell>{formatDate(note.debit_note_date)}</TableCell>
                    <TableCell>
                      <Badge variant={note.document_workflow_status === 'issued' ? 'default' : 'secondary'}>
                        {note.document_workflow_status.toUpperCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {note.correction_reason_code ? <Badge variant="outline">{debitReasonLabel(note)}</Badge> : null}
                        {note.correction_reason_text ? <div className="text-sm text-muted-foreground">{note.correction_reason_text}</div> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatMoney(note.total_amount, note.currency_code)}</TableCell>
                    <TableCell className="text-right">
                      {note.document_workflow_status === 'issued' ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => onPrintDebit(note)}>
                            <Printer className="mr-2 h-4 w-4" />
                            {translate('financeDocs.mz.printInvoice', 'Print')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onDownloadDebit(note)}>
                            <Download className="mr-2 h-4 w-4" />
                            {translate('financeDocs.mz.downloadPdf', 'Download PDF')}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
