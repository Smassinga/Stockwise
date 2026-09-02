import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const banksSource = await readFile(new URL('../../src/pages/Banks.tsx', import.meta.url), 'utf8')
const migrationSource = await readFile(new URL('../../supabase/migrations/20260902122112_add_bank_account_kind_for_mobile_wallets.sql', import.meta.url), 'utf8')

test('mobile wallets reuse the maintained bank account ledger with an explicit account kind', () => {
  assert.match(migrationSource, /account_kind text not null default 'bank'/)
  assert.match(migrationSource, /mobile_wallet/)
  assert.match(banksSource, /account_kind: AccountKind/)
  assert.match(banksSource, /M-Pesa, e-Mola, and mKesh/)
  assert.match(banksSource, /\.from\('bank_accounts'\)/)
  assert.doesNotMatch(banksSource, /\.from\('mobile_wallets'\)/)
})
