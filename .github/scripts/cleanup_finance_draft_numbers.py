from pathlib import Path

files = [
    Path('src/pages/SalesInvoiceDetail.tsx'),
    Path('src/pages/VendorBillDetail.tsx'),
]

helper_block = """function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseDraftNumber(value: string) {
  const normalized = String(value || '').replace(',', '.').trim()
  if (!normalized) return 0
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatDraftNumber(value: number, digits = 2) {
  if (value <= 0) return ''
  const fixed = value.toFixed(digits)
  return fixed.replace(/\\.00$/, '').replace(/(\\.\\d*?)0+$/, '$1')
}

"""

shared_import = """import {
  formatFinanceDraftNumber as formatDraftNumber,
  parseFinanceDraftNumber as parseDraftNumber,
  roundFinanceAmount as roundMoney,
} from '../lib/financeDraftNumbers'
"""

for path in files:
    text = path.read_text(encoding='utf-8')
    if text.count(helper_block) != 1:
        raise SystemExit(f'Expected exactly one duplicated finance draft helper block in {path}')
    text = text.replace(helper_block, '')

    anchor = "import { formatMoneyBase"
    idx = text.find(anchor)
    if idx < 0:
        raise SystemExit(f'Could not find currency import anchor in {path}')
    line_end = text.find('\n', idx)
    if line_end < 0:
        raise SystemExit(f'Could not find currency import line end in {path}')
    insert_at = line_end + 1
    if shared_import not in text:
        text = text[:insert_at] + shared_import + text[insert_at:]

    path.write_text(text, encoding='utf-8')
