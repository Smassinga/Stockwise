import type { Dispatch, SetStateAction } from 'react'
import { ReceiptText, Undo2 } from 'lucide-react'
import { FinanceSummaryBand } from '../../components/finance/FinanceSummaryBand'
import { PremiumStatePanel } from '../../components/premium/PremiumEmptyState'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { TabsContent } from '../../components/ui/tabs'
import type {
  CustomerReceivableExposure,
  CustomerReceiptAllocationState,
  CustomerReceiptCustomer,
  CustomerReceiptState,
  CustomerUnappliedCredit,
} from './settlementModel'

type Translate = (key: string, fallback: string, vars?: Record<string, string | number>) => string

type SettlementReceiptsWorkspaceProps = {
  tt: Translate
  canManageSettlement: boolean
  receiptCustomerFilter: string
  visibleCustomerReceipts: CustomerReceiptState[]
  money: (amount: number) => string
  receiptsLoading: boolean
  receiptCustomers: CustomerReceiptCustomer[]
  updateReceiptCustomerQuery: (value: string) => void
  receiptsError: string | null
  receiptContextCustomer: CustomerReceiptCustomer | null
  receiptContextOutstanding: number
  receiptContextAllocatableOutstanding: number
  receiptContextUnapplied: CustomerUnappliedCredit | null
  receiptContextExposures: CustomerReceivableExposure[]
  navigate: (to: string) => void
  setRefreshKey: Dispatch<SetStateAction<number>>
  openCustomerReceiptDialog: (customerId?: string) => void
  openCustomerReceiptDetail: (receipt: CustomerReceiptState) => void
  activeCustomerReceipt: CustomerReceiptState | null
  receiptCustomerById: Map<string, CustomerReceiptCustomer>
  closeCustomerReceiptDetail: () => void
  activeCustomerReceiptAllocations: CustomerReceiptAllocationState[]
  receiptExposureById: Map<string, CustomerReceivableExposure>
  setReversalAllocation: Dispatch<SetStateAction<CustomerReceiptAllocationState | null>>
  setReversalReason: Dispatch<SetStateAction<string>>
  laterAllocationInvoiceId: string
  setLaterAllocationInvoiceId: Dispatch<SetStateAction<string>>
  laterAllocationExposures: CustomerReceivableExposure[]
  laterAllocationAmount: string
  setLaterAllocationAmount: Dispatch<SetStateAction<string>>
  receiptSaving: boolean
  submitLaterAllocation: () => void | Promise<void>
}

export function SettlementReceiptsWorkspace({
  tt,
  canManageSettlement,
  receiptCustomerFilter,
  visibleCustomerReceipts,
  money,
  receiptsLoading,
  receiptCustomers,
  updateReceiptCustomerQuery,
  receiptsError,
  receiptContextCustomer,
  receiptContextOutstanding,
  receiptContextAllocatableOutstanding,
  receiptContextUnapplied,
  receiptContextExposures,
  navigate,
  setRefreshKey,
  openCustomerReceiptDialog,
  openCustomerReceiptDetail,
  activeCustomerReceipt,
  receiptCustomerById,
  closeCustomerReceiptDetail,
  activeCustomerReceiptAllocations,
  receiptExposureById,
  setReversalAllocation,
  setReversalReason,
  laterAllocationInvoiceId,
  setLaterAllocationInvoiceId,
  laterAllocationExposures,
  laterAllocationAmount,
  setLaterAllocationAmount,
  receiptSaving,
  submitLaterAllocation,
}: SettlementReceiptsWorkspaceProps) {
  return (
        <TabsContent value="receipts" className="mt-0 space-y-6">
          <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                {tt('customerReceipts.title', 'Customer receipts')}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {tt('customerReceipts.scope', 'One real payment remains one receipt and one cash or bank transaction. Allocations connect that receipt to issued invoices.')}
              </p>
            </div>
            {canManageSettlement ? (
              <Button onClick={() => openCustomerReceiptDialog(receiptCustomerFilter === 'ALL' ? '' : receiptCustomerFilter)}>
                <ReceiptText className="h-4 w-4" />
                {tt('customerReceipts.receivePayment', 'Receive payment')}
              </Button>
            ) : null}
          </div>

          <FinanceSummaryBand
            label={tt('customerReceipts.summary', 'Receipt summary')}
            items={[
              {
                label: tt('customerReceipts.received', 'Received'),
                value: receiptsLoading ? tt('common.loading', 'Loading...') : money(visibleCustomerReceipts.reduce((sum, receipt) => sum + Number(receipt.amount_received_base), 0)),
                detail: tt('customerReceipts.receivedHelp', 'Actual cash and bank receipts in the current customer scope.'),
              },
              {
                label: tt('customerReceipts.allocated', 'Allocated'),
                value: receiptsLoading ? tt('common.loading', 'Loading...') : money(visibleCustomerReceipts.reduce((sum, receipt) => sum + Number(receipt.allocated_base), 0)),
                detail: tt('customerReceipts.allocatedHelp', 'Only posted allocations reduce invoice outstanding.'),
              },
              {
                label: tt('customerReceipts.unallocated', 'Unallocated'),
                value: receiptsLoading ? tt('common.loading', 'Loading...') : money(visibleCustomerReceipts.reduce((sum, receipt) => sum + Number(receipt.unallocated_base), 0)),
                detail: tt('customerReceipts.unallocatedHelp', 'Received customer credit that remains available for later allocation.'),
                tone: visibleCustomerReceipts.some((receipt) => Number(receipt.unallocated_base) > 0.005) ? 'info' : 'neutral',
              },
            ]}
          />

          <div className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="w-full sm:max-w-sm">
              <Label>{tt('customerReceipts.customer', 'Customer')}</Label>
              <Select value={receiptCustomerFilter} onValueChange={updateReceiptCustomerQuery}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                  {receiptCustomers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.code ? `${customer.code} — ` : ''}{customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-sm text-muted-foreground">
              {tt('customerReceipts.recordCount', '{count} receipts', { count: visibleCustomerReceipts.length })}
            </span>
          </div>

          {!receiptsLoading && !receiptsError && receiptContextCustomer ? (
            <section
              className="space-y-5 border-b border-border pb-6"
              aria-labelledby="customer-receivables-context-title"
              data-testid="customer-receivables-context"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="customer-receivables-context-title" className="text-xl font-semibold tracking-tight">
                    {receiptContextCustomer.name}
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    {receiptContextCustomer.code ? <span>{receiptContextCustomer.code}</span> : null}
                    {receiptContextCustomer.email ? <span className="break-all">{receiptContextCustomer.email}</span> : null}
                    {receiptContextCustomer.phone ? <span>{receiptContextCustomer.phone}</span> : null}
                    {!receiptContextCustomer.code && !receiptContextCustomer.email && !receiptContextCustomer.phone
                      ? <span>{tt('customerReceipts.noContact', 'No customer contact details are recorded.')}</span>
                      : null}
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3 sm:text-right">
                  <div>
                    <dt className="text-xs text-muted-foreground">{tt('customerReceipts.totalOpenReceivables', 'Total open receivables')}</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(receiptContextOutstanding)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{tt('customerReceipts.allocatableInvoiceOutstanding', 'Allocatable issued-invoice outstanding')}</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{money(receiptContextAllocatableOutstanding)}</dd>
                  </div>
                  <div data-testid="customer-unapplied-credit">
                    <dt className="text-xs text-muted-foreground">{tt('customerReceipts.unappliedCreditContext', 'Unapplied credit (separate)')}</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                      {money(Number(receiptContextUnapplied?.unapplied_credit_base || 0))}
                    </dd>
                  </div>
                </dl>
              </div>

              <p className="text-sm text-muted-foreground">
                {tt('customerReceipts.creditNotNetted', 'Unapplied credit is shown as receipt context and is never netted against outstanding until an allocation is posted.')}
              </p>

              <div data-testid="customer-receivables-open-documents">
                <h4 className="font-semibold">{tt('customerReceipts.openDocuments', 'Open receivables')}</h4>
                {receiptContextExposures.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {tt('customerReceipts.noOpenDocuments', 'This customer has no open receivable anchors in the current company scope.')}
                  </p>
                ) : (
                  <div className="mt-3 divide-y divide-border border-y border-border">
                    {receiptContextExposures.map((exposure) => (
                      <article key={exposure.anchor_id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(9rem,0.6fr))_minmax(12rem,0.8fr)_auto] lg:items-center">
                        <div>
                          <p className="font-medium">{exposure.document_reference}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tt('table.date', 'Date')}: {exposure.document_date || tt('common.dash', '-')}
                            {' · '}{tt('orders.dueDate', 'Due date')}: {exposure.due_date || tt('common.dash', '-')}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{tt('settlements.originalAmount', 'Original')}</p>
                          <p className="mt-1 font-mono tabular-nums">{money(Number(exposure.original_amount_base))}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{tt('settlements.outstandingAmount', 'Outstanding')}</p>
                          <p className="mt-1 font-mono font-semibold tabular-nums">{money(Number(exposure.outstanding_amount_base))}</p>
                        </div>
                        <div className="text-sm">
                          {Number(exposure.days_past_due) > 0 ? (
                            <p className="font-medium text-status-danger-foreground">
                              {tt('customerReceipts.daysPastDue', '{count} days past due', { count: Number(exposure.days_past_due) })}
                            </p>
                          ) : (
                            <p className="text-muted-foreground">{tt('customerReceipts.notOverdue', 'Not overdue')}</p>
                          )}
                          {exposure.collections_suppressed ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {tt('customerReceipts.collectionsSuppressed', 'Collections suppressed')}: {exposure.collection_suppression_reason || exposure.collection_status}
                            </p>
                          ) : exposure.current_promise_id ? (
                            <p className="mt-1 text-xs text-muted-foreground">{tt('customerReceipts.promiseOpen', 'Promise to pay recorded')}</p>
                          ) : exposure.dispute_category ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {tt('customerReceipts.disputeOpen', 'Dispute')}: {exposure.dispute_category}
                            </p>
                          ) : null}
                        </div>
                        <Button size="sm" variant="outline" onClick={() => navigate(
                          exposure.anchor_kind === 'sales_invoice'
                            ? `/sales-invoices/${exposure.anchor_id}`
                            : `/orders?tab=sales&orderId=${encodeURIComponent(exposure.anchor_id)}`,
                        )}>
                          {tt('financeDocs.viewDocument', 'View')}
                        </Button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          {receiptsLoading ? (
            <PremiumStatePanel kind="loading" title={tt('customerReceipts.loading', 'Loading customer receipts')} />
          ) : receiptsError ? (
            <PremiumStatePanel
              kind="error"
              title={tt('customerReceipts.unavailable', 'Customer receipts unavailable')}
              description={receiptsError}
              action={<Button variant="outline" onClick={() => setRefreshKey((key) => key + 1)}>{tt('common.retry', 'Retry')}</Button>}
            />
          ) : visibleCustomerReceipts.length === 0 ? (
            <PremiumStatePanel
              kind="empty"
              title={tt('customerReceipts.empty', 'No customer receipts in this scope')}
              description={tt('customerReceipts.emptyHelp', 'Record a payment when money has actually been received from a known customer.')}
              action={canManageSettlement ? (
                <Button onClick={() => openCustomerReceiptDialog(receiptCustomerFilter === 'ALL' ? '' : receiptCustomerFilter)}>
                  {tt('customerReceipts.receivePayment', 'Receive payment')}
                </Button>
              ) : undefined}
            />
          ) : (
            <div className="overflow-hidden border-y border-border">
              <div className="divide-y divide-border md:hidden">
                {visibleCustomerReceipts.map((receipt) => (
                  <button
                    key={receipt.id}
                    type="button"
                    className="block w-full px-1 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => openCustomerReceiptDetail(receipt)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{receipt.receipt_reference}</p>
                        <p className="mt-1 break-words text-sm text-muted-foreground">{receiptCustomerById.get(receipt.customer_id)?.name || tt('common.none', 'None')}</p>
                      </div>
                      <span className="font-mono font-semibold tabular-nums">{money(Number(receipt.amount_received_base))}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>{receipt.received_on}</span>
                      <span>{receipt.payment_channel === 'bank' ? tt('customerReceipts.bank', 'Bank') : tt('customerReceipts.cash', 'Cash')}</span>
                      <span>{tt('customerReceipts.unallocated', 'Unallocated')}: {money(Number(receipt.unallocated_base))}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/35 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">{tt('customerReceipts.reference', 'Receipt')}</th>
                      <th className="px-4 py-3">{tt('customerReceipts.customer', 'Customer')}</th>
                      <th className="px-4 py-3">{tt('table.date', 'Date')}</th>
                      <th className="px-4 py-3">{tt('customerReceipts.method', 'Method')}</th>
                      <th className="px-4 py-3 text-right">{tt('customerReceipts.received', 'Received')}</th>
                      <th className="px-4 py-3 text-right">{tt('customerReceipts.allocated', 'Allocated')}</th>
                      <th className="px-4 py-3 text-right">{tt('customerReceipts.unallocated', 'Unallocated')}</th>
                      <th className="px-4 py-3 text-right"><span className="sr-only">{tt('common.actions', 'Actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleCustomerReceipts.map((receipt) => (
                      <tr key={receipt.id}>
                        <td className="px-4 py-4 font-medium">{receipt.receipt_reference}</td>
                        <td className="px-4 py-4">{receiptCustomerById.get(receipt.customer_id)?.name || tt('common.none', 'None')}</td>
                        <td className="px-4 py-4">{receipt.received_on}</td>
                        <td className="px-4 py-4">{receipt.payment_channel === 'bank' ? tt('customerReceipts.bank', 'Bank') : tt('customerReceipts.cash', 'Cash')}</td>
                        <td className="px-4 py-4 text-right font-mono tabular-nums">{money(Number(receipt.amount_received_base))}</td>
                        <td className="px-4 py-4 text-right font-mono tabular-nums">{money(Number(receipt.allocated_base))}</td>
                        <td className="px-4 py-4 text-right font-mono font-semibold tabular-nums">{money(Number(receipt.unallocated_base))}</td>
                        <td className="px-4 py-4 text-right">
                          <Button size="sm" variant="outline" onClick={() => openCustomerReceiptDetail(receipt)}>
                            {tt('common.view', 'View')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeCustomerReceipt ? (
            <section className="border-t border-border pt-6" aria-labelledby="customer-receipt-detail-title">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 id="customer-receipt-detail-title" className="text-xl font-semibold tracking-tight">
                    {activeCustomerReceipt.receipt_reference}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {receiptCustomerById.get(activeCustomerReceipt.customer_id)?.name || tt('common.none', 'None')}
                  </p>
                </div>
                <Button variant="ghost" onClick={closeCustomerReceiptDetail}>{tt('common.close', 'Close')}</Button>
              </div>
              <dl className="mt-5 grid gap-x-6 gap-y-4 border-y border-border py-5 sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.received', 'Received')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(Number(activeCustomerReceipt.amount_received_base))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.allocated', 'Allocated')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(Number(activeCustomerReceipt.allocated_base))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.unallocated', 'Unallocated')}</dt><dd className="mt-1 font-mono font-semibold tabular-nums">{money(Number(activeCustomerReceipt.unallocated_base))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.transaction', 'Financial transaction')}</dt><dd className="mt-1 break-all font-mono text-xs">{activeCustomerReceipt.financial_transaction_id}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('table.date', 'Date')}</dt><dd className="mt-1">{activeCustomerReceipt.received_on}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.method', 'Method')}</dt><dd className="mt-1">{activeCustomerReceipt.payment_channel === 'bank' ? tt('customerReceipts.bank', 'Bank') : tt('customerReceipts.cash', 'Cash')}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.externalReference', 'External reference')}</dt><dd className="mt-1 break-words">{activeCustomerReceipt.external_reference || tt('common.dash', '-')}</dd></div>
                <div><dt className="text-xs text-muted-foreground">{tt('customerReceipts.note', 'Note')}</dt><dd className="mt-1 break-words">{activeCustomerReceipt.note || tt('common.dash', '-')}</dd></div>
              </dl>

              <div className="mt-6">
                <h4 className="font-semibold">{tt('customerReceipts.allocations', 'Invoice allocations')}</h4>
                {activeCustomerReceiptAllocations.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">{tt('customerReceipts.noAllocations', 'No invoice allocations have been posted.')}</p>
                ) : (
                  <div className="mt-3 divide-y divide-border border-y border-border">
                    {activeCustomerReceiptAllocations.map((allocation) => {
                      const exposure = receiptExposureById.get(allocation.sales_invoice_id)
                      return (
                        <div key={allocation.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-medium">{exposure?.document_reference || allocation.sales_invoice_id}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{allocation.created_at}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <span className={`font-mono font-semibold tabular-nums ${allocation.is_reversed ? 'text-muted-foreground line-through' : ''}`}>
                              {money(Number(allocation.amount_base))}
                            </span>
                            {allocation.is_reversed ? (
                              <span className="text-xs text-muted-foreground">{tt('customerReceipts.reversed', 'Reversed')}</span>
                            ) : canManageSettlement ? (
                              <Button size="sm" variant="outline" onClick={() => { setReversalAllocation(allocation); setReversalReason('') }}>
                                <Undo2 className="h-4 w-4" />
                                {tt('customerReceipts.reverseAllocation', 'Reverse allocation')}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {canManageSettlement && Number(activeCustomerReceipt.unallocated_base) > 0.005 ? (
                <div className="mt-6 border-l-2 border-status-info-border bg-status-info-muted px-4 py-4">
                  <h4 className="font-semibold">{tt('customerReceipts.allocateCredit', 'Allocate existing receipt credit')}</h4>
                  <p className="mt-1 text-sm text-muted-foreground">{tt('customerReceipts.allocateCreditHelp', 'This allocation changes invoice outstanding without creating another cash or bank transaction.')}</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)_auto] md:items-end">
                    <div>
                      <Label>{tt('customerReceipts.invoice', 'Invoice')}</Label>
                      <Select value={laterAllocationInvoiceId} onValueChange={setLaterAllocationInvoiceId}>
                        <SelectTrigger><SelectValue placeholder={tt('customerReceipts.selectInvoice', 'Select an invoice')} /></SelectTrigger>
                        <SelectContent>
                          {laterAllocationExposures.map((exposure) => (
                            <SelectItem key={exposure.anchor_id} value={exposure.anchor_id}>
                              {exposure.document_reference} — {money(Number(exposure.outstanding_amount_base))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="later-allocation-amount">{tt('customerReceipts.allocationAmount', 'Allocation amount')}</Label>
                      <Input id="later-allocation-amount" type="number" min="0.01" step="0.01" value={laterAllocationAmount} onChange={(event) => setLaterAllocationAmount(event.target.value)} />
                    </div>
                    <Button disabled={receiptSaving || !laterAllocationInvoiceId} onClick={submitLaterAllocation}>
                      {receiptSaving ? tt('common.saving', 'Saving...') : tt('customerReceipts.allocate', 'Allocate')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </TabsContent>


  )
}
