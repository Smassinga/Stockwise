import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const settlements = readFileSync(new URL('../../src/pages/Settlements.tsx', import.meta.url), 'utf8')
const serviceJobs = readFileSync(new URL('../../src/pages/ServiceJobs.tsx', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/20260917192000_link_service_job_receipt_shares.sql', import.meta.url), 'utf8')

test('order-stage settlement exposure only admits approved orders', () => {
  const approvedFilters = settlements.match(/order\.workflow_status === 'approved'/g) || []
  assert.equal(approvedFilters.length, 2, 'Sales and purchase order-stage settlement rows must both require approved workflow state')
})

test('service receipt shares keep collection, cost, and payout as linked evidence', () => {
  assert.match(migration, /CREATE TABLE public\.service_job_receipt_shares/)
  assert.match(migration, /CREATE OR REPLACE VIEW public\.v_service_job_receipt_candidates/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_service_job_receipt_share/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.pay_service_job_receipt_share/)
  assert.match(migration, /public\.add_service_job_direct_cost/)
  assert.match(migration, /public\.post_cash_adjustment/)
  assert.match(migration, /public\.post_bank_ledger_transaction/)
  assert.match(migration, /service_job_receipt_shares_direct_cost_unique/)
})

test('Service Jobs exposes optional collection-share linking and later payout', () => {
  assert.match(serviceJobs, /record_service_job_receipt_share/)
  assert.match(serviceJobs, /pay_service_job_receipt_share/)
  assert.match(serviceJobs, /Collection revenue share/)
  assert.match(serviceJobs, /Link existing direct cost/)
  assert.match(serviceJobs, /Record cost only/)
})
