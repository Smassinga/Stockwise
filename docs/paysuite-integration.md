# PaySuite subscription checkout

StockWise creates a hosted PaySuite payment request for a catalogue plan. PaySuite offers M-Pesa, e-Mola, and card in its checkout. The browser never receives the merchant API token. The existing assisted proof workflow remains available.

## Launch order

1. Review the migration against the StockWise project and apply `20260926205342_paysuite_subscription_checkout.sql`. Check migration history first. Do not apply it to the Ekapacita project.
2. In PaySuite, create a token named `StockWise Subscriptions Production`. Select **payment:read** and **payment:write** only. Uncheck both contact permissions and all payout, refund, dispute, and transaction permissions. Choose a finite expiration and schedule rotation. PaySuite's payment write permission also covers cancellation and refunds, so treat the token as a powerful secret.
3. Save the token as `PAYSUITE_API_TOKEN` in the **StockWise** Supabase project's Edge Function secrets. Do not put it in `VITE_` variables, the repository, or chat. Save the PaySuite webhook signing secret as `PAYSUITE_WEBHOOK_SECRET`. Confirm the StockWise functions have `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` (or the configured aliases). Set `PUBLIC_SITE_URL=https://stockwiseapp.com` if the production hostname differs from the default.
4. Deploy `paysuite-checkout` with JWT verification enabled and `paysuite-webhook` with JWT verification disabled. The latter authenticates the raw request body with PaySuite's `X-Signature` HMAC-SHA256 secret. A payment request sets its own `webhook_url` to `https://ogzhwoqqumkuqhbvuzzp.supabase.co/functions/v1/paysuite-webhook`; an account-level webhook URL is optional.
5. Run a controlled, real, low-value subscription checkout. Confirm PaySuite's payment request and transaction status, the StockWise payment row, a single access audit event, and the resulting paid-until date. Repeat the signed webhook and status poll to verify they do not extend access twice. Test an unpaid/failed checkout. PaySuite documentation is inconsistent about sandbox availability, so do not assume one exists.
6. Set `VITE_PAYSUITE_CHECKOUT_ENABLED=true` in the StockWise frontend build environment and deploy that build only after the preceding checks. The checkout card is hidden by default.

## Operations

- The API creates a unique StockWise reference and snapshots the catalogue price in MZN. Only an active company owner/admin can create an intent. Payment status comes from a server-side PaySuite GET, not the redirect URL or browser data.
- A successful provider verification applies the subscription and audit record in one database transaction. Repeated webhooks and polls return the existing result. Restricted companies or a paid plan change enter `requires_review` after payment and need manual handling.
- A timed-out creation can leave an uncertain provider payment. The row enters `requires_review`; investigate its reference in PaySuite before issuing another checkout. Do not automatically retry the POST. Monitor failed webhook deliveries and reconcile pending rows with the provider before the delivery history expires.
- If the merchant token is exposed, replace it in PaySuite, update the StockWise Edge Function secret, and revoke the old token. The new value must never be committed or pasted into a public channel.
- The live finance regression suite requires an isolated nonproduction Supabase target and is deliberately blocked against production. Run it there before release.
