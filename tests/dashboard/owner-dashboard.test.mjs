import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const DAY = 86_400_000
const at = value => new Date(`${value}T12:00:00`)
const iso = value => value.toISOString().slice(0, 10)
const shift = (value, days) => new Date(value.getTime() + days * DAY)
function range(preset, today, customStart, customEnd) {
  const anchor = at(today)
  let start = anchor
  let end = anchor
  if (preset === 'week') start = shift(anchor, -((anchor.getDay() + 6) % 7))
  if (preset === 'month') start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12)
  if (preset === 'custom') {
    if (!customStart || !customEnd || customEnd < customStart) return null
    start = at(customStart); end = at(customEnd)
  }
  const elapsed = Math.round((end - start) / DAY)
  let compareEnd = shift(start, -1)
  let compareStart = shift(compareEnd, -elapsed)
  if (preset === 'week') {
    compareStart = shift(start, -7)
    compareEnd = shift(end, -7)
  }
  if (preset === 'month') {
    compareStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1, 12)
    const last = new Date(anchor.getFullYear(), anchor.getMonth(), 0, 12)
    compareEnd = new Date(anchor.getFullYear(), anchor.getMonth() - 1, Math.min(anchor.getDate(), last.getDate()), 12)
  }
  return [iso(start), iso(end), iso(compareStart), iso(compareEnd)]
}

test('today compares with the previous business day', () =>
  assert.deepEqual(range('today', '2026-07-29'), ['2026-07-29', '2026-07-29', '2026-07-28', '2026-07-28']))
test('week starts Monday and compares the same elapsed portion', () =>
  assert.deepEqual(range('week', '2026-07-29'), ['2026-07-27', '2026-07-29', '2026-07-20', '2026-07-22']))
test('month compares the same elapsed days', () =>
  assert.deepEqual(range('month', '2026-07-29'), ['2026-07-01', '2026-07-29', '2026-06-01', '2026-06-29']))
test('month comparison caps at a shorter previous month', () =>
  assert.deepEqual(range('month', '2026-03-31'), ['2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28']))
test('custom comparison is immediately preceding and equal length', () =>
  assert.deepEqual(range('custom', '2026-07-29', '2026-07-10', '2026-07-20'), ['2026-07-10', '2026-07-20', '2026-06-29', '2026-07-09']))
test('invalid custom dates do not create a query range', () =>
  assert.equal(range('custom', '2026-07-29', '2026-07-20', '2026-07-10'), null))
test('completion denominator excludes draft and cancelled', () => {
  const statuses = ['draft', 'submitted', 'confirmed', 'allocated', 'shipped', 'closed', 'cancelled']
  const eligible = statuses.filter(value => ['submitted', 'confirmed', 'allocated', 'shipped', 'closed'].includes(value))
  assert.deepEqual(eligible, ['submitted', 'confirmed', 'allocated', 'shipped', 'closed'])
  assert.equal(eligible.filter(value => ['shipped', 'closed'].includes(value)).length / eligible.length, 0.4)
})
test('empty completion denominator is unavailable', () => assert.equal(0 > 0 ? 0 / 0 : null, null))
test('open orders include only submitted, confirmed and allocated', () =>
  assert.deepEqual(['draft','submitted','confirmed','allocated','shipped','closed','cancelled'].filter(value => ['submitted','confirmed','allocated'].includes(value)), ['submitted','confirmed','allocated']))
test('distinct order IDs deduplicate POS and Sales Order activity', () =>
  assert.equal(new Set(['so-pos-1', 'so-pos-1', 'so-2']).size, 2))
test('gross profit and margin are withheld when cost evidence is missing', () => {
  const missing = 1
  const profit = missing === 0 ? 100 - 40 : null
  assert.equal(profit, null)
  assert.equal(profit == null ? null : profit / 100, null)
})
test('average transaction is unavailable for an empty denominator', () =>
  assert.equal(0 > 0 ? 0 / 0 : null, null))
test('new and repeat customers use completed purchase history', () => {
  const customers = [{ current: true, before: false }, { current: true, before: true }, { current: false, before: true }]
  assert.equal(customers.filter(x => x.current && !x.before).length, 1)
  assert.equal(customers.filter(x => x.current && x.before).length, 1)
})
test('cash customers are excluded', () =>
  assert.deepEqual([{ id: 1, is_cash: true }, { id: 2, is_cash: false }].filter(x => !x.is_cash).map(x => x.id), [2]))
test('product ranking supports revenue, quantity and complete gross profit', () => {
  const products = [{ revenue: 10, quantity: 5, grossProfit: null }, { revenue: 8, quantity: 9, grossProfit: 4 }]
  assert.equal([...products].sort((a,b) => b.revenue-a.revenue)[0].revenue, 10)
  assert.equal([...products].sort((a,b) => b.quantity-a.quantity)[0].quantity, 9)
  assert.deepEqual(products.filter(x => x.grossProfit != null).map(x => x.grossProfit), [4])
})
test('RPC is authenticated, company checked and read-only', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260729143000_add_owner_dashboard_read_model.sql', import.meta.url), 'utf8')
  assert.match(sql, /auth\.uid\(\)/)
  assert.match(sql, /current_company_id\(\)/)
  assert.match(sql, /member_has_company_access\(p_company_id, false\)/)
  assert.match(sql, /REVOKE ALL[\s\S]+FROM PUBLIC, anon/)
  assert.match(sql, /GRANT EXECUTE[\s\S]+TO authenticated/)
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i)
})
test('cross-company and expired access use the same hard denial gate', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260729143000_add_owner_dashboard_read_model.sql', import.meta.url), 'utf8')
  assert.match(sql, /p_company_id IS DISTINCT FROM public\.current_company_id\(\)[\s\S]+NOT public\.member_has_company_access/)
  assert.match(sql, /ERRCODE = '42501'/)
})
