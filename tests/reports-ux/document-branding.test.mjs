import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(path, 'utf8')

test('printed operational documents share the 18mm company-logo standard', async () => {
  const [branding, reports, salesOrders, purchaseOrders] = await Promise.all([
    read('src/lib/documentBranding.ts'),
    read('src/pages/Reports.tsx'),
    read('src/pages/Orders/SalesOrders.tsx'),
    read('src/pages/Orders/PurchaseOrders.tsx'),
  ])

  assert.match(branding, /DOCUMENT_LOGO_PRINT_SIZE_PX = 68/)
  assert.match(branding, /REPORT_PDF_LOGO_SIZE_MM = 18/)
  assert.match(reports, /width: REPORT_PDF_LOGO_SIZE_MM/)
  assert.match(reports, /height: REPORT_PDF_LOGO_SIZE_MM/)
  assert.match(reports, /width:\$\{DOCUMENT_LOGO_PRINT_SIZE_PX\}px;height:\$\{DOCUMENT_LOGO_PRINT_SIZE_PX\}px;object-fit:contain/)
  assert.match(reports, /<meta charset="utf-8"\/>/)

  for (const source of [salesOrders, purchaseOrders]) {
    assert.match(source, /height: \$\{DOCUMENT_LOGO_PRINT_SIZE_PX\}px; width: \$\{DOCUMENT_LOGO_PRINT_SIZE_PX\}px;/)
    assert.match(source, /object-fit: contain;/)
  }
})

test('PDF generators aspect-fit logos instead of stretching them', async () => {
  const [branding, reports, financeExport, financeDocumentOutput] = await Promise.all([
    read('src/lib/documentBranding.ts'),
    read('src/pages/Reports.tsx'),
    read('src/lib/financeExport.ts'),
    read('src/lib/financeDocumentOutput.ts'),
  ])

  assert.match(branding, /scale = Math\.min\(frame\.width \/ safeWidth, frame\.height \/ safeHeight\)/)
  for (const source of [reports, financeExport, financeDocumentOutput]) {
    assert.match(source, /getImageProperties/)
    assert.match(source, /fitDocumentLogo/)
    assert.match(source, /placement\.width/)
    assert.match(source, /placement\.height/)
  }
})
