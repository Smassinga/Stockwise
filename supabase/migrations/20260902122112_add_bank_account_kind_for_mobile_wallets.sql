alter table public.bank_accounts
  add column if not exists account_kind text not null default 'bank';

alter table public.bank_accounts
  drop constraint if exists bank_accounts_account_kind_check;

alter table public.bank_accounts
  add constraint bank_accounts_account_kind_check
  check (account_kind in ('bank', 'mobile_wallet'));

comment on column public.bank_accounts.account_kind is
  'Settlement account classification. bank uses conventional bank account details; mobile_wallet covers providers such as M-Pesa, e-Mola, and mKesh while reusing the governed bank ledger and reconciliation model.';
