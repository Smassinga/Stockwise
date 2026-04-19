# StockWise

StockWise is an operational inventory and finance system for small and mid-sized businesses. The current product direction is:

- stock, warehouse, bin, and assembly control
- sales, purchasing, settlements, bank, and cash workflows
- Mozambique finance-document issuance and reconciliation readiness
- mobile-friendly store-counter workflows, including Point of Sale
- manual subscription activation through the platform control plane

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables in `.env`.

Required frontend/runtime values:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

3. Start the app:

```bash
npm run dev
```

4. Validate code changes before closing work:

```bash
npm run lint:js
npm run build
npm run test:finance-regression
```

## Canonical Supabase Workflow

The repo now uses a canonical baseline plus forward migrations.

Current active canonical chain:

- `20260419142000_canonical_extensions_prelude.sql`
- `20260419143000_canonical_schema_baseline.sql`
- `20260419144000_storage_bucket_and_policy_baseline.sql`

Workflow rules:

1. If the linked remote schema may have changed, run:

```bash
npx supabase db pull
```

2. Treat any generated `*_remote_schema.sql` file as a pull artifact, not as an accepted migration by default.

3. Before committing migration work, run:

```bash
npm run check:migrations
```

4. Add only forward migrations on top of the canonical chain.

5. Keep custom global roles in `supabase/roles.sql`.

6. Do not re-baseline Supabase-managed `storage` internals casually. Keep only app-owned storage buckets and policies in tracked migrations.

## Documentation

Start with:

- [Documentation Index](docs/README.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Data Model](docs/DATA_MODEL.md)
- [Canonical Migration Baseline Reset](docs/CANONICAL_MIGRATION_BASELINE_2026-04-19.md)
- [Finance Roadmap](docs/finance-roadmap/README.md)

## Current Product Notes

- paid plan activation remains manual
- payment gateway automation is intentionally deferred
- Point of Sale defaults to the walk-in / cash customer unless a named customer is chosen
- opening-data import focuses on master data and current stock, not historical document migration
