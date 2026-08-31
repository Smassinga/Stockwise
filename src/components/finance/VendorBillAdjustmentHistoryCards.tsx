import type { ComponentProps } from 'react'
import { Download, Printer, Share2 } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import type { VendorCreditNoteRow, VendorDebitNoteRow } from '../../lib/mzFinance'

type Translate = (key: string, fallback: string, params?: Record<string, string | number>) => string
type BadgeVariant = ComponentProps<typeof Badge>['variant']

type VendorBillAdjustmentHistoryCardsProps = {
  creditNotes: VendorCreditNoteRow[]
  debitNotes: VendorDebitNoteRow[]
  isActive: boolean
  canCreateCredit: boolean
  canCreateDebit: boolean
  creditBlockedMessage: string
  debitBlockedMessage: string
  translate: Translate
  formatDocumentMoney: (amount: number, currencyCode: string) => string
  formatBaseMoney: (amount: number) => string
  workflowVariant: (status: VendorCreditNoteRow['document_workflow_status'] | VendorDebitNoteRow['document_workflow_status']) => BadgeVariant
  creditReasonLabel: (note: VendorCreditNoteRow) => string
  debitReasonLabel: (note: VendorDebitNoteRow) => string
  onOpenCredit: () => void
  onOpenDebit: () => void
  onPrintCredit: (note: VendorCreditNoteRow) => void
  onDownloadCredit: (note: VendorCreditNoteRow) => void
  onShareCredit: (note: VendorCreditNoteRow) => void
  onPrintDebit: (note: VendorDebitNoteRow) => void
  onDownloadDebit: (note: VendorDebitNoteRow) => void
  onShareDebit: (note: VendorDebitNoteRow) => void
}

export default function VendorBillAdjustmentHistoryCards({
  creditNotes,
  debitNotes,
  isActive,
  canCreateCredit,
  canCreateDebit,
  creditBlockedMessage,
  debitBlockedMessage,
  translate,
  formatDocumentMoney,
  formatBaseMoney,
  workflowVariant,
  creditReasonLabel,
  debitReasonLabel,
  onOpenCredit,
  onOpenDebit,
  onPrintCredit,
  onDownloadCredit,
  onShareCredit,
  onPrintDebit,
  onDownloadDebit,
  onShareDebit,
}: VendorBillAdjustmentHistoryCardsProps) {
  const headers = (
    <TableRow>
      <TableHead>{translate('financeDocs.fields.reference', 'Reference')}</TableHead>
      <TableHead>{translate('financeDocs.fields.date', 'Date')}</TableHead>
      <TableHead>{translate('financeDocs.fields.status', 'Status')}</TableHead>
      <TableHead className="text-right">{translate('financeDocs.fields.total', 'Total')}</TableHead>
      <TableHead className="text-right">{translate('orders.actions', 'Actions')}</TableHead>
    </TableRow>
  )

  return (
    <>
      <Card className="border-border/80 shadow-sm">
        <CardHeader>
          <CardTitle>{translate('financeDocs.vendorBills.creditNotesTitle', 'Supplier credit notes')}</CardTitle>
          <CardDescription className="hidden sm:block">
            {translate('financeDocs.vendorBills.creditNotesHelp', 'Use supplier credit notes for reductions, returns, allowances, and other downward AP corrections linked back to the posted vendor bill.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isActive ? (
            canCreateCredit ? (
              <Button className="w-full sm:w-auto" onClick={onOpenCredit}>
                {translate('financeDocs.vendorBills.issueCreditNote', 'Issue supplier credit note')}
              </Button>
            ) : (
              <div className="border-l-2 border-status-info-border bg-status-info-muted px-4 py-3 text-sm text-status-info-foreground">
                {creditBlockedMessage}
              </div>
            )
          ) : (
            <div className="rounded-xl border border-status-warning-border bg-status-warning-muted p-3 text-sm text-status-warning-foreground">
              {translate('financeDocs.vendorBills.creditNotesPostedOnly', 'Supplier credit notes can only be created from posted vendor bills.')}
            </div>
          )}

          {creditNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{translate('financeDocs.vendorBills.creditNotesEmpty', 'No supplier credit notes have been posted against this vendor bill yet.')}</p>
          ) : (
            <Table>
              <TableHeader>{headers}</TableHeader>
              <TableBody>
                {creditNotes.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell>
                      <div className="font-medium">{note.supplier_document_reference || note.internal_reference}</div>
                      <div className="text-xs text-muted-foreground">
                        {translate('financeDocs.vendorBills.internalKeyValue', 'StockWise key {reference}', { reference: note.internal_reference })}
                      </div>
                      {note.adjustment_reason_code ? <div className="mt-2"><Badge variant="outline">{creditReasonLabel(note)}</Badge></div> : null}
                      {note.adjustment_reason_text ? <div className="mt-1 text-xs text-muted-foreground">{note.adjustment_reason_text}</div> : null}
                    </TableCell>
                    <TableCell>{note.note_date}</TableCell>
                    <TableCell><Badge variant={workflowVariant(note.document_workflow_status)}>{note.document_workflow_status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono tabular-nums">{formatDocumentMoney(note.total_amount, note.currency_code)}</div>
                      <div className="text-xs text-muted-foreground">{formatBaseMoney(note.total_amount_base)}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => onPrintCredit(note)}><Printer className="mr-2 h-4 w-4" />{translate('financeDocs.mz.printInvoice', 'Print')}</Button>
                        <Button size="sm" variant="outline" onClick={() => onDownloadCredit(note)}><Download className="mr-2 h-4 w-4" />{translate('financeDocs.mz.downloadPdf', 'Download PDF')}</Button>
                        <Button size="sm" variant="outline" onClick={() => onShareCredit(note)}><Share2 className="mr-2 h-4 w-4" />{translate('financeDocs.mz.shareInvoice', 'Share')}</Button>
                      </div>
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
          <CardTitle>{translate('financeDocs.vendorBills.debitNotesTitle', 'Supplier debit notes')}</CardTitle>
          <CardDescription className="hidden sm:block">
            {translate('financeDocs.vendorBills.debitNotesHelp', 'Use supplier debit notes for additional charges, omitted supplier value, and other upward AP corrections linked back to the posted vendor bill.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isActive ? (
            canCreateDebit ? (
              <Button className="w-full sm:w-auto" onClick={onOpenDebit}>
                {translate('financeDocs.vendorBills.issueDebitNote', 'Issue supplier debit note')}
              </Button>
            ) : (
              <div className="border-l-2 border-status-info-border bg-status-info-muted px-4 py-3 text-sm text-status-info-foreground">
                {debitBlockedMessage}
              </div>
            )
          ) : (
            <div className="rounded-xl border border-status-warning-border bg-status-warning-muted p-3 text-sm text-status-warning-foreground">
              {translate('financeDocs.vendorBills.debitNotesPostedOnly', 'Supplier debit notes can only be created from posted vendor bills.')}
            </div>
          )}

          {debitNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{translate('financeDocs.vendorBills.debitNotesEmpty', 'No supplier debit notes have been posted against this vendor bill yet.')}</p>
          ) : (
            <Table>
              <TableHeader>{headers}</TableHeader>
              <TableBody>
                {debitNotes.map((note) => (
                  <TableRow key={note.id}>
                    <TableCell>
                      <div className="font-medium">{note.supplier_document_reference || note.internal_reference}</div>
                      <div className="text-xs text-muted-foreground">
                        {translate('financeDocs.vendorBills.internalKeyValue', 'StockWise key {reference}', { reference: note.internal_reference })}
                      </div>
                      {note.adjustment_reason_code ? <div className="mt-2"><Badge variant="outline">{debitReasonLabel(note)}</Badge></div> : null}
                      {note.adjustment_reason_text ? <div className="mt-1 text-xs text-muted-foreground">{note.adjustment_reason_text}</div> : null}
                    </TableCell>
                    <TableCell>{note.note_date}</TableCell>
                    <TableCell><Badge variant={workflowVariant(note.document_workflow_status)}>{note.document_workflow_status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono tabular-nums">{formatDocumentMoney(note.total_amount, note.currency_code)}</div>
                      <div className="text-xs text-muted-foreground">{formatBaseMoney(note.total_amount_base)}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => onPrintDebit(note)}><Printer className="mr-2 h-4 w-4" />{translate('financeDocs.mz.printInvoice', 'Print')}</Button>
                        <Button size="sm" variant="outline" onClick={() => onDownloadDebit(note)}><Download className="mr-2 h-4 w-4" />{translate('financeDocs.mz.downloadPdf', 'Download PDF')}</Button>
                        <Button size="sm" variant="outline" onClick={() => onShareDebit(note)}><Share2 className="mr-2 h-4 w-4" />{translate('financeDocs.mz.shareInvoice', 'Share')}</Button>
                      </div>
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
