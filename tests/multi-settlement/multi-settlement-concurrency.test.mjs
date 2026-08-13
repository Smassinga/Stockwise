import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const container = 'supabase_db_Stockwise'
const psqlArgs = [
  'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-At',
]

function runPsql(sql) {
  return spawnSync('docker', psqlArgs, { input: sql, encoding: 'utf8' })
}

function runPsqlConcurrent(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', psqlArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(sql)
  })
}

function authenticatedAllocation(receiptId, invoiceId, requestKey) {
  return `
\\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','b1111111-1111-4111-8111-111111111111',false);
select set_config('request.jwt.claims','{"sub":"b1111111-1111-4111-8111-111111111111","role":"authenticated"}',false);
select pg_sleep(0.2);
select public.allocate_customer_receipt(
  '${receiptId}'::uuid,'${invoiceId}'::uuid,5000,'${requestKey}'
);
`
}

function oneSuccessOneExpectedFailure(results, expectedError) {
  const successes = results.filter((result) => result.status === 0)
  const failures = results.filter((result) => result.status !== 0)
  assert.equal(successes.length, 1, results.map((result) => `${result.status}: ${result.stderr}`).join('\n'))
  assert.equal(failures.length, 1, results.map((result) => `${result.status}: ${result.stderr}`).join('\n'))
  assert.match(failures[0].stderr, new RegExp(expectedError, 'i'))
}

test('concurrent allocations cannot over-allocate a receipt or an invoice', async (context) => {
  const available = spawnSync('docker', ['inspect', container], { encoding: 'utf8' })
  if (available.error?.code === 'ENOENT' || available.status !== 0) {
    context.skip('The local Supabase database container is unavailable.')
    return
  }

  const setup = await readFile(new URL('./multi-settlement-concurrency-setup.sql', import.meta.url), 'utf8')
  const cleanup = await readFile(new URL('./multi-settlement-concurrency-cleanup.sql', import.meta.url), 'utf8')
  runPsql(cleanup)
  const setupResult = runPsql(setup)
  assert.equal(setupResult.status, 0, `${setupResult.stdout}\n${setupResult.stderr}`)

  try {
    const receiptOne = runPsql(`select id from public.customer_receipts where external_reference='CONC-R1';`).stdout.trim()
    const receiptTwoA = runPsql(`select id from public.customer_receipts where external_reference='CONC-R2-A';`).stdout.trim()
    const receiptTwoB = runPsql(`select id from public.customer_receipts where external_reference='CONC-R2-B';`).stdout.trim()
    for (const id of [receiptOne, receiptTwoA, receiptTwoB]) assert.match(id, /^[0-9a-f-]{36}$/i)

    const receiptRace = await Promise.all([
      runPsqlConcurrent(authenticatedAllocation(
        receiptOne,
        'b5555555-5555-4555-8555-555555555551',
        'concurrency-receipt-race-a',
      )),
      runPsqlConcurrent(authenticatedAllocation(
        receiptOne,
        'b5555555-5555-4555-8555-555555555552',
        'concurrency-receipt-race-b',
      )),
    ])
    oneSuccessOneExpectedFailure(receiptRace, 'receipt_allocation_exceeds_unallocated')

    const receiptState = runPsql(`
      select allocated_base::text||'|'||unallocated_base::text
      from public.v_customer_receipt_state where id='${receiptOne}'::uuid;
    `)
    assert.equal(receiptState.status, 0, receiptState.stderr)
    assert.equal(receiptState.stdout.trim(), '5000.00|0.00')
    assert.equal(runPsql(`
      select count(*) from public.v_customer_receipt_allocations
      where customer_receipt_id='${receiptOne}'::uuid and active_amount_base=5000;
    `).stdout.trim(), '1')
    process.stdout.write('PASS concurrent allocations cannot over-allocate one receipt\n')

    const invoiceRace = await Promise.all([
      runPsqlConcurrent(authenticatedAllocation(
        receiptTwoA,
        'b5555555-5555-4555-8555-555555555553',
        'concurrency-invoice-race-a',
      )),
      runPsqlConcurrent(authenticatedAllocation(
        receiptTwoB,
        'b5555555-5555-4555-8555-555555555553',
        'concurrency-invoice-race-b',
      )),
    ])
    oneSuccessOneExpectedFailure(
      invoiceRace,
      'receipt_invoice_already_resolved|receipt_allocation_exceeds_outstanding',
    )

    assert.equal(runPsql(`
      select outstanding_base::text from public.v_sales_invoice_state
      where id='b5555555-5555-4555-8555-555555555553';
    `).stdout.trim(), '0.00')
    assert.equal(runPsql(`
      select count(*) from public.v_customer_receipt_allocations
      where sales_invoice_id='b5555555-5555-4555-8555-555555555553'
        and active_amount_base=5000;
    `).stdout.trim(), '1')
    assert.equal(runPsql(`
      select count(*) from public.bank_transactions
      where bank_id='b4444444-4444-4444-8444-444444444441' and ref_type='CR';
    `).stdout.trim(), '3', 'later allocations must not create financial transactions')
    process.stdout.write('PASS concurrent receipts cannot over-allocate one invoice\n')
  } finally {
    const cleanupResult = runPsql(cleanup)
    assert.equal(cleanupResult.status, 0, `${cleanupResult.stdout}\n${cleanupResult.stderr}`)
  }

  assert.equal(runPsql(`
    select count(*) from public.companies where id='b2222222-2222-4222-8222-222222222221';
  `).stdout.trim(), '0')
})
