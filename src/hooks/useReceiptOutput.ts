import { useCallback } from 'react'
import toast from 'react-hot-toast'
import { useI18n } from '../lib/i18n'
import type { PaymentReceipt } from '../lib/operatorSale'
import {
  printReceipt,
  saveReceiptPdf,
  type ReceiptPaper,
  type ReceiptPrintResult,
} from '../lib/receiptOutput'
import { Sentry } from '../lib/sentry'

type ReceiptOperation = 'operator_completion' | 'print_last_receipt' | 'receipt_history'

const outputCopy = {
  en: {
    popupBlocked: 'Allow pop-ups to print the receipt.',
    printFailed: 'The receipt could not be prepared for printing.',
    pdfFailed: 'The receipt PDF could not be generated.',
  },
  pt: {
    popupBlocked: 'Permita janelas pop-up para imprimir o recibo.',
    printFailed: 'Não foi possível preparar o recibo para impressão.',
    pdfFailed: 'Não foi possível gerar o PDF do recibo.',
  },
} as const

function reportOutputFailure(
  error: unknown,
  receipt: PaymentReceipt,
  operation: ReceiptOperation,
  format: ReceiptPaper | 'pdf',
) {
  Sentry.captureException(error instanceof Error ? error : new Error('Receipt output failed'), {
    tags: { operation, receipt_format: format },
    extra: {
      route: window.location.pathname,
      receipt_reference: receipt.receipt_reference,
    },
  })
}

export function useReceiptOutput() {
  const { lang } = useI18n()
  const copy = outputCopy[lang]

  const requestPrint = useCallback((
    receipt: PaymentReceipt,
    paper: ReceiptPaper,
    operation: ReceiptOperation,
  ): ReceiptPrintResult => {
    let asynchronousFailureReported = false
    const reportPrintFailure = (error: unknown) => {
      if (asynchronousFailureReported) return
      asynchronousFailureReported = true
      toast.error(copy.printFailed)
      reportOutputFailure(error, receipt, operation, paper)
    }
    const result = printReceipt(receipt, lang, paper, {
      onPrintWindowFailure: reportPrintFailure,
    })

    if (!result.ok && result.reason === 'popup_blocked') {
      toast.error(copy.popupBlocked)
    } else if (!result.ok && !asynchronousFailureReported) {
      reportPrintFailure(new Error('Receipt print window failed'))
    }
    return result
  }, [copy.popupBlocked, copy.printFailed, lang])

  const requestPdf = useCallback(async (
    receipt: PaymentReceipt,
    operation: ReceiptOperation,
  ): Promise<boolean> => {
    try {
      await saveReceiptPdf(receipt, lang)
      return true
    } catch (error) {
      toast.error(copy.pdfFailed)
      reportOutputFailure(error, receipt, operation, 'pdf')
      return false
    }
  }, [copy.pdfFailed, lang])

  return { requestPrint, requestPdf }
}
