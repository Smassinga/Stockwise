# StockWise Development Guide

This guide records the current repository workflow after the canonical Supabase baseline reset.

## Core Commands

```bash
npm install
npm run dev
npm run lint:js
npm run build
npm run test:finance-regression
```

`npm run dev` is maintained on `http://localhost:3000` through `vite.config.ts`; Tauri `devUrl` is aligned to the same port. Local Supabase development uses `http://127.0.0.1:54321`.

`npm run test:finance-regression` is the canonical protected mutation gate. It runs test files serially because the finance, onboarding, and Growth Batch regression files share one local Supabase database and each performs broad temporary setup/cleanup. Keep real concurrency assertions inside the purpose-built tests; do not make operators remember a separate serial override for release validation.

## Supabase Workflow

### Current rule

The active migration history is the canonical baseline plus forward migrations from this point onward.

Current release state: hosted production and local replay have 39 active migrations through `20260709222842_governed_settlement_posting.sql`. The live settlement boundary normalizes exact two-decimal money values without epsilon, hard-blocks normalized zero outstanding, and submits bank CSV imports through one deterministic SHA-256, all-or-nothing `bank.ledger.import` request. Growth Batches G5.1 depleting harvest/event-specific harvest reversal and G5.2 completion/event-specific completion reversal remain live and production-smoke validated.

The latest Growth Batches G4.1 rollout applied:

- `20260627225400_add_growth_batch_losses.sql`
- `20260627225414_add_growth_batch_loss_posting.sql`

G4.1 validation passed before rollout: local replay reports 32 active migrations, Growth Batches regression `6/6`, complete finance regression `32/32`, independent inspection, authenticated visual QA at `1440`, `1200`, `820`, and `390` in light and dark mode, static checks, build, and GitHub Validation run `28319500331`. The hosted rollout ran in the authorised 2026-06-28 session with `npx supabase db push --linked` exit `0`; production mortality/shrinkage smoke passed through the maintained UI.

G4.1 adds OPERATOR+ mortality/shrinkage preview and recording, MANAGER+ event-specific loss reversal, immutable loss/reversal detail tables, loss read models, request-key idempotency, and `/growth-batches` UI coverage. It intentionally excludes transfers, harvest/split outputs, completion, stock output receipts, FIFO, COGS, fair value, automatic finance posting, dashboards, and per-animal/per-plant records. Production smoke used `Leny Doçuras` batch `LEN-GB000000003`, restored quantity `20 -> 18 -> 20 EA`, restored weight `40 -> 35 -> 40 KG`, kept stock movement and finance counts unchanged, kept Growth Batch costs at zero, kept negative stock and duplicate buckets at zero, and did not change `items.unit_price`.

G4.2 adds only governed full-batch operational location transfer and event-specific transfer reversal. It introduces `growth_batch_transfers`, `growth_batch_transfer_reversal_lines`, `growth_batch_transfer_history`, `preview_growth_batch_transfer`, `transfer_growth_batch`, and `reverse_growth_batch_transfer`, plus `/growth-batches` transfer UI and regression coverage. The package keeps transfers full-batch only: no partial split, child batch, harvest, completion, stock movement, stock-level change, cost write-off, finance posting, `items.unit_price` change, FIFO, COGS, fair value, profitability dashboard, or per-animal/per-plant identity. Local clean replay and targeted Growth Batch regression passed with 34 migrations before hosted rollout; production replay, mismatch, and concurrency mutation tests remain covered locally rather than in production.

G5.1 adds a live governed depleting harvest package. It introduces `growth_batch_harvests`, `growth_batch_harvest_reversal_lines`, `growth_batch_harvest_history`, `preview_growth_batch_harvest`, `post_growth_batch_harvest`, and `reverse_growth_batch_harvest`, plus `/growth-batches` Harvests UI and regression coverage. The package supports partial/full depleting harvest, one primary stock output receipt per harvest, proportional remaining-cost transfer into harvested cost, exact full-harvest remaining-cost transfer, and event-specific harvest reversal. It intentionally excludes non-depleting milk/egg yield, split/child batches, multi-output/co-product allocation, sales, invoices, COGS, FIFO, fair value, finance posting, automatic completion, whole-batch reversal, profitability dashboards, individual animal/plant records, and `items.unit_price` changes.

G5.2 adds a live governed completion package. It introduces `growth_batch_completions`, `growth_batch_completion_reversal_lines`, `growth_batch_completion_history`, `preview_growth_batch_completion`, `complete_growth_batch`, and `reverse_growth_batch_completion`, plus `/growth-batches` Completion UI and regression coverage. The package supports only lifecycle completion for active batches already at zero current quantity, zero current weight where weight exists, and zero remaining cost, plus event-specific completion reversal back to active. It intentionally creates no stock movements, no stock-level updates, no cost changes, no harvest output, no sale, no invoice, no COGS, no FIFO, no fair value, no finance posting, no whole-batch reversal, no split or child batch, no profitability dashboard, no individual animal/plant records, and no `items.unit_price` change. The 2026-07-09 UI smoke restored `LEN-GB000000003` from full harvest through `active -> completed -> active` and full-harvest reversal, retaining `20 EA`, `40 KG`, zero costs, no finance rows, no price change, and a zero QA output bucket.

Before changing the database:

1. run `npx supabase db pull` if the linked remote may have changed
2. inspect `supabase/migrations`
3. make only forward migrations
4. run `npm run check:migrations`
5. apply intentionally with `npx supabase db push`

### `db pull` artifacts

`npx supabase db pull` may generate a synthetic `*_remote_schema.sql` file after successful replay validation.

That file is:

- a review artifact
- not part of the canonical migration chain by default
- ignored by `.gitignore`

If a pull artifact is ever intentionally accepted, it must be reviewed as a real schema delta and force-added deliberately. Do not let it drift into commits casually.

### Storage and roles

- keep custom global roles in `supabase/roles.sql`
- do not recreate Supabase-managed `storage` internals in app migrations
- keep only app-owned buckets and policies in tracked migrations

## Repository Discipline

- use UTF-8 Portuguese strings and fix mojibake when found
- do not claim a live DB change unless `npx supabase db push` succeeded in the current session
- do not claim payment automation exists; activation remains manual
- do not use inventory cost as a selling-price default in Point of Sale flows

## Validation Expectations

After app changes:

```bash
npm run lint:js
npm run build
```

After finance, control-plane, or workflow changes:

```bash
npm run test:finance-regression
```

After database changes:

- verify `npx supabase db pull` replays cleanly
- verify `npm run check:migrations`
- verify `npx supabase db push` if the change is meant to go live
