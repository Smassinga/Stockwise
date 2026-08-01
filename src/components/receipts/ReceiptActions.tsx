import { useEffect, useState } from 'react'
import { Download, Eye, Printer, ReceiptText } from 'lucide-react'
import toast from 'react-hot-toast'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { useI18n } from '../../lib/i18n'
import { useReceiptOutput } from '../../hooks/useReceiptOutput'
import { supabase } from '../../lib/supabase'
import type { PaymentReceipt } from '../../lib/operatorSale'
import { formatMoneyBase } from '../../lib/currency'

export function ReceiptActions({ salesOrderId, salesInvoiceId, settlementId, compact = false }: {
  salesOrderId?: string | null
  salesInvoiceId?: string | null
  settlementId?: string | null
  compact?: boolean
}) {
  const { lang } = useI18n()
  const { requestPrint, requestPdf } = useReceiptOutput()
  const [receipts, setReceipts] = useState<PaymentReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const copy = lang === 'pt' ? {
    title: 'Histórico de recibos', help: 'Cada pagamento mantém o seu próprio comprovativo.', empty: 'Ainda não existem recibos emitidos.',
    view: 'Ver recibo', print58: 'Imprimir 58 mm', print80: 'Imprimir 80 mm', pdf: 'Guardar PDF', received: 'Recebido', balance: 'Saldo remanescente',
  } : {
    title: 'Receipt history', help: 'Each payment keeps its own proof of payment.', empty: 'No receipts have been issued yet.',
    view: 'View receipt', print58: 'Print 58 mm', print80: 'Print 80 mm', pdf: 'Save PDF', received: 'Received', balance: 'Remaining balance',
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      let query = supabase.from('payment_receipts').select('*').order('issued_at', { ascending: false })
      if (settlementId) query = query.eq('settlement_id', settlementId)
      else if (salesInvoiceId) query = query.eq('sales_invoice_id', salesInvoiceId)
      else if (salesOrderId) query = query.eq('sales_order_id', salesOrderId)
      else { setReceipts([]); setLoading(false); return }
      const { data, error } = await query
      if (!cancelled) {
        if (error) toast.error(error.message)
        setReceipts((data || []).map((row) => ({ ...row, amount_received: Number(row.amount_received), remaining_balance: Number(row.remaining_balance) })) as PaymentReceipt[])
        setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [salesInvoiceId, salesOrderId, settlementId])

  const body = loading ? <div className="text-sm text-muted-foreground">…</div> : receipts.length ? (
    <div className="space-y-3">
      {receipts.map((receipt) => (
        <div key={receipt.id} className="rounded-xl border border-border/70 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><div className="font-semibold">{receipt.receipt_reference}</div><div className="text-xs text-muted-foreground">{new Date(receipt.payment_at).toLocaleString(lang === 'pt' ? 'pt-MZ' : 'en-MZ')}</div></div>
            <div className="text-right text-sm"><div>{copy.received}: {formatMoneyBase(receipt.amount_received, receipt.currency_code, lang === 'pt' ? 'pt-MZ' : 'en-MZ')}</div><div className="text-muted-foreground">{copy.balance}: {formatMoneyBase(receipt.remaining_balance, receipt.currency_code, lang === 'pt' ? 'pt-MZ' : 'en-MZ')}</div></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => requestPrint(receipt, 'a4', 'receipt_history')}><Eye className="mr-2 h-4 w-4" />{copy.view}</Button>
            <Button size="sm" variant="outline" onClick={() => requestPrint(receipt, '58mm', 'receipt_history')}><Printer className="mr-2 h-4 w-4" />{copy.print58}</Button>
            <Button size="sm" variant="outline" onClick={() => requestPrint(receipt, '80mm', 'receipt_history')}><Printer className="mr-2 h-4 w-4" />{copy.print80}</Button>
            <Button size="sm" variant="outline" onClick={() => { void requestPdf(receipt, 'receipt_history') }}><Download className="mr-2 h-4 w-4" />{copy.pdf}</Button>
          </div>
        </div>
      ))}
    </div>
  ) : <div className="text-sm text-muted-foreground">{copy.empty}</div>

  if (compact) return body
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ReceiptText className="h-5 w-5" />{copy.title}</CardTitle><CardDescription>{copy.help}</CardDescription></CardHeader><CardContent>{body}</CardContent></Card>
}
