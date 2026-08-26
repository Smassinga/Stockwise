-- Keep hosted and local replay truth aligned for company-owner lookups.
-- The hosted index may already exist; this migration is intentionally idempotent.
create index if not exists ix_companies_owner_user_id_fk
  on public.companies (owner_user_id);
