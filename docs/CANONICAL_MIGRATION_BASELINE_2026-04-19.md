# Canonical Migration Baseline Reset (2026-04-19)

## What was wrong

The old tracked migration chain was structurally incomplete.

- The earliest tracked migration, `20251003100429_20251003_fix_set_active_company_and_views.sql`, created `public.user_profiles` with `active_company_id uuid references public.companies(id)`.
- But no tracked earlier migration created `public.companies`.
- The same legacy chain also assumed other core tables already existed, including company-membership and customer structures.

That meant fresh replay on a shadow database was impossible. The failure was not a Docker issue and not a transient environment issue. The source-controlled history itself was invalid.

## Why the old chain was not preserved

The repository had no trustworthy canonical bootstrap migration for the core `public` schema. Preserving the legacy file-by-file chain would have kept a broken replay assumption alive and forced future work to depend on remote-only history that was never actually tracked.

At the time of repair, the linked project held disposable test/demo data only. There was no requirement to preserve those records.

## What was discarded

- The old pre-baseline migration chain under `supabase/migrations`
- Test-era assumptions that the remote database already had untracked base tables
- Remote-only global-role assumptions for `ai_reader`
- Linked-project test data during `npx supabase db reset --linked --no-seed`

The previous migration files were not deleted from the repo entirely. They were archived under:

- `docs/archive/supabase-migrations-legacy/2026-04-19_pre_canonical_baseline/`

## What was rebuilt

The new canonical migration history is:

1. `20260419142000_canonical_extensions_prelude.sql`
   - creates the `extensions` schema if needed
   - ensures `citext` and `pgcrypto` exist for replay

2. `20260419143000_canonical_schema_baseline.sql`
   - canonical replay-safe baseline for the app-owned `public` schema
   - derived from the linked project schema, then cleaned to remove Supabase-managed `storage` DDL and forbidden session-authorization statements

3. `20260419144000_storage_bucket_and_policy_baseline.sql`
   - seeds the app buckets `brand-logos` and `bank-statements`
   - recreates the app-owned storage policies without trying to recreate the Supabase-managed `storage` schema internals

4. `supabase/roles.sql`
   - creates the custom global role `ai_reader`
   - ensures shadow-database replay has the same global role needed by the canonical schema grants

## New canonical rule

The canonical source of truth is now the new baseline plus forward migrations from this point onward.

Do not try to revive the archived legacy chain as if it were still replay-safe.

If future schema work is needed:

- add a forward migration on top of the canonical baseline
- add custom global roles to `supabase/roles.sql`
- keep Supabase-managed `storage` internals out of app migrations
- keep only app-owned storage buckets and policies in tracked migrations

## Validation outcome

The following now succeeds:

- `npx supabase db reset --linked --yes --no-seed`
- `npx supabase db pull`

## Important note about `db pull` artifacts

`npx supabase db pull` may still generate a synthetic `*_remote_schema.sql` file as a pull artifact after successful replay validation.

That file is not the canonical migration history for this repo and should not be treated as a real forward schema change unless it contains an intentional, reviewed schema delta.

During this reset, those synthetic pull-artifact files were reverted from remote migration history and removed from the repo after validation.

## Manual follow-up

- If a real non-disposable environment is ever reset from this new baseline, recreate any required auth users manually afterward.
- If new custom roles are introduced, add them to `supabase/roles.sql` before relying on them in grants.
- If storage bucket behavior changes, add a forward migration; do not move back to recreating `storage` internals inside app migrations.
