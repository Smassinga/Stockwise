# UOM-INTEGRITY-1 — Canonical UOM integrity

Status: implemented, locally replayed, applied to the linked hosted project, and verified on 10 August 2026.

## Catalogue model and decision

`public.uoms` is one shared global catalogue. It has no `company_id`, so StockWise has no company-owned or “non-global” UOM row that can be deleted independently. Company scope applies only to conversion rows in `uom_conversions`.

The maintained `EA / Each` record (`6ae319cf-9b68-4224-abfb-cd762dd9caa9`) is canonical. The generated `EA-4DBCF6D0` and `EA-8CEB9D40` rows were proven unreferenced across the hosted project before this migration was designed. They are the only records eligible for guarded deletion. Referenced `LT / Litro` is not treated as equivalent to `L / Litre` because the current model does not prove that identity.

## Equivalence contract

- Maintained aliases resolve to their canonical catalogue code.
- Otherwise, equal normalized names within the same family are equivalent.
- Normalized codes remain unique.
- A canonical code/name conflict is rejected.
- Similar names are not merged without model evidence.
- Conversion factors and operational quantities do not define identity and are unchanged.

## Authoritative enforcement

Migration `20260810051808_enforce_canonical_uom_integrity.sql`:

- adds nullable actor/company provenance for future custom global records;
- checks every declared UOM foreign key before deleting the two explicit unreferenced candidates;
- adds deterministic semantic-equivalence uniqueness;
- recognizes generated item-specific code forms, including `EA-<8 hex>`;
- removes direct global-catalogue mutation grants from `anon` and `authenticated` while retaining read access;
- exposes `create_uom(code, name, family)` to authenticated operational roles through the existing active-company authority model;
- returns the existing canonical/equivalent record instead of creating a duplicate;
- records provenance when a legitimate distinct global unit is created.

The function is `SECURITY DEFINER` only because authenticated roles no longer write the global table directly. It uses a fixed `search_path`, checks `auth.uid()`, the active company, and the existing company-role helper. RLS remains enabled; the three broad direct-write policies were removed together with direct authenticated DML grants. No role hierarchy, UOM conversion, quantity, stock, order, production, or finance logic changes.

## Local proof

A clean local Supabase reset replayed all 60 migrations successfully. Permanent rollback-only coverage in `tests/uom-integrity/uom-integrity.sql` proves:

- canonical and case/spacing variant reuse;
- generated-code and conflicting-identity rejection;
- legitimate same-name units in different families where the model permits them;
- legitimate custom creation with provenance;
- denial of direct INSERT, UPDATE, DELETE, and TRUNCATE.

Concurrent sessions attempting the same semantic unit returned one shared ID: the first created it and the second reused it. A controlled migration-59 fixture with a foreign-key reference to a deletion candidate caused migration 60 to fail closed and retained both the candidate and reference. A subsequent clean reset replayed migration 60 successfully.

Local security and performance advisors reported no UOM-INTEGRITY-specific issue. Remaining advisor findings predate this package.

## Application contract

`UomSettings.tsx` calls `create_uom` instead of directly upserting `public.uoms`. The screen shows potential equivalents before save, reports when the canonical record was reused, and maps governed rejection codes to safe English and Portuguese messages. Frontend guidance is not treated as the integrity boundary.

## Hosted rollout evidence

The linked project was re-confirmed as `ogzhwoqqumkuqhbvuzzp`. Immediately before application, explicit read-only queries re-established 33 catalogue rows, both generated duplicate candidates, zero references to either candidate across all 37 declared UOM foreign-key columns, and 59 hosted migrations. The linked dry run contained only migration `20260810051808`.

`supabase db push --linked` then applied only `20260810051808_enforce_canonical_uom_integrity.sql`. Post-application verification established:

- 60 local and hosted migrations, followed by an empty linked dry run;
- 31 catalogue rows, one canonical `EA / Each`, and zero generated `Each` duplicates;
- the canonical `EA` record retained all 569 declared references across 63 hosted company records;
- `anon` and `authenticated` retain catalogue `SELECT` only, while governed creation is exposed through `create_uom`;
- `create_uom` retains a fixed `search_path` and explicit authenticated execution; `seed_default_uoms` is no longer executable by authenticated users;
- security and performance advisors reported no unexpected UOM table/index finding. The advisor warning that authenticated users can execute `create_uom` is intentional because the function performs the active-company and role checks before the privileged write;
- authenticated application QA in the existing hosted test company showed 31 unit codes and zero legacy generated codes. Saving `EA / Each` reused the canonical row in English and Portuguese, while `KG / Each` was rejected as a conflicting canonical identity. Neither action produced browser warnings/errors or changed the catalogue count.

No quantity, conversion, stock, document, production, service, finance, role hierarchy, or company-membership rule was changed. UOM RLS write policy changed only by removing the obsolete direct-write policies; no access boundary was weakened.
