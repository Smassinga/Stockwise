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

## Supabase Workflow

### Current rule

The active migration history is the canonical baseline plus forward migrations from this point onward.

Current release state: hosted production and `main` have 30 active migrations through `20260620132656_add_growth_batch_stock_input_posting.sql`. Growth Batches G3 is live after the approved database-first rollout and controlled production smoke.

The latest Growth Batches G3 rollout applied:

- `20260620132646_add_growth_batch_stock_inputs.sql`
- `20260620132656_add_growth_batch_stock_input_posting.sql`

G3 validation passed before rollout: local replay reports 30 active migrations, Growth Batches regression `5/5`, complete finance regression `31/31`, independent inspection, authenticated local visual QA at `1440`, `1200`, `820`, and `390` in light and dark mode, static checks, build, and GitHub Validation run `27930016751`. The hosted rollout ran in the authorised 2026-06-22 session with `npx supabase db push --linked` exit `0`; production smoke passed through the maintained UI.

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
