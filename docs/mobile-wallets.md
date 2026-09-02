# Mobile Wallet Settlement Accounts

StockWise treats mobile money wallets as a settlement-account classification inside the existing bank-account ledger rather than as a separate finance subsystem.

## Current model

`bank_accounts.account_kind` accepts:

- `bank`
- `mobile_wallet`

Existing records default to `bank`.

Mobile wallets such as M-Pesa, e-Mola, and mKesh reuse the existing governed bank-account infrastructure:

- `bank_transactions`
- account book balances
- bank/manual settlement RPCs
- statement and reconciliation workspace
- company/role access controls
- reporting and audit references

This avoids a second ledger or duplicate settlement authority. The Banks workspace presents provider and wallet-number language for `mobile_wallet` accounts and hides bank-only SWIFT/NIB/tax-reference fields during wallet creation.

## Boundary

The first wallet package does not add provider API integrations, automatic mobile-money feeds, payout initiation, webhook reconciliation, or wallet-specific payment automation. It is a ledger and reconciliation classification over the maintained finance engine.
