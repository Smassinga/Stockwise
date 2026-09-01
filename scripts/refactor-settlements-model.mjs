import fs from 'node:fs'
import path from 'node:path'

const pagePath = path.resolve('src/pages/Settlements.tsx')
const modelPath = path.resolve('src/features/settlements/settlementModel.ts')
const source = fs.readFileSync(pagePath, 'utf8')

const blockStartMarker = 'type CashTx = {'
const pageStartMarker = 'export default function SettlementsPage()'
const blockStart = source.indexOf(blockStartMarker)
const pageStart = source.indexOf(pageStartMarker)

if (blockStart < 0 || pageStart < 0 || pageStart <= blockStart) {
  throw new Error('Settlements model extraction markers were not found in the expected order.')
}

const originalBlock = source.slice(blockStart, pageStart).trimEnd()
const exportedBlock = originalBlock.replace(/^(type|const|function)\s/gm, 'export $1 ')

const modelHeader = `import type { FinanceActivityRow } from '../../lib/financeActivity'\nimport type { FinanceDocumentSettlementStatus } from '../../lib/financeDocuments'\nimport type { FinanceReconciliationExceptionRow, FinanceReviewState } from '../../lib/financeReconciliation'\nimport type { SettlementKind } from '../../lib/orderFinance'\nimport type { OrderSettlementStatus } from '../../lib/orderState'\n\n`

const pageImport = `import {\n  activityStartISO,\n  dueTone,\n  emptyRows,\n  exceptionSeverityTone,\n  isCancelled,\n  isFinanceDocumentRow,\n  isMissingStateViewError,\n  n,\n  normalizeMoneyValue,\n  reviewTone,\n  statusTone,\n  todayISO,\n  validWorkspaceSides,\n  validWorkspaceViews,\n  type BankAccount,\n  type BankTx,\n  type CashTx,\n  type CustomerReceivableExposure,\n  type CustomerReceiptAllocationState,\n  type CustomerReceiptCustomer,\n  type CustomerReceiptState,\n  type CustomerUnappliedCredit,\n  type FinanceExportRequest,\n  type FinanceWorkspaceSide,\n  type FinanceWorkspaceView,\n  type SettlementBalanceStatus,\n  type SettlementRow,\n} from '../features/settlements/settlementModel'\n\n`

let nextSource = source.slice(0, blockStart) + pageImport + source.slice(pageStart)
nextSource = nextSource
  .replace('  type FinanceDocumentSettlementStatus,\n', '')
  .replace('  type OrderSettlementStatus,\n', '')

if (nextSource === source) throw new Error('Settlements page was not changed by extraction.')
if (nextSource.includes(blockStartMarker)) throw new Error('Settlements model block remains in the page after extraction.')
if (!nextSource.includes("from '../features/settlements/settlementModel'")) throw new Error('Settlements model import was not added.')

fs.mkdirSync(path.dirname(modelPath), { recursive: true })
fs.writeFileSync(modelPath, modelHeader + exportedBlock + '\n', 'utf8')
fs.writeFileSync(pagePath, nextSource, 'utf8')

console.log('Extracted Settlements model and pure helpers to src/features/settlements/settlementModel.ts')
