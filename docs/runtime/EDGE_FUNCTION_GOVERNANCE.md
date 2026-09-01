# Edge Function Runtime Governance

This document defines the cleanup and removal boundary for StockWise Supabase Edge Functions. The machine-readable source of truth is `docs/runtime/edge-function-inventory.json`; CI checks it against `supabase/config.toml` and the function directories.

## Rule

A missing frontend reference is not removal evidence.

Edge Functions may be invoked by authenticated application flows, schedulers, queues, signed HMAC callers, service integrations, platform-admin tooling, or controlled QA workflows. Before deleting or changing a function, identify its runtime classification and satisfy the inventory entry's `removalGate`.

## Current classifications

- `active_user_flow`: directly supports an authenticated product workflow.
- `active_platform_flow`: supports an authenticated platform-control workflow.
- `active_worker`: queue/scheduler worker; it may intentionally use `verify_jwt=false` with a separate service-secret boundary.
- `active_internal`: signed internal endpoint or adapter; no browser caller is required.
- `dormant_retained`: no active production caller is currently proven, but retention is intentional and deletion requires an explicit retirement package.
- `qa_only`: not a normal production feature; it must remain fail-closed unless an authorised QA window explicitly enables it.

## Authentication governance

`verify_jwt=false` is not by itself proof of public or anonymous business access. Every such function in the current inventory must declare a secondary authentication contract, and runtime-hardening tests verify source markers for that contract.

Changing `verify_jwt`, removing a secondary HMAC/shared-secret gate, adding a new function, removing a function, or changing a QA kill switch requires updating the inventory in the same reviewed package. CI fails when deployment configuration and the inventory diverge.

## Removal process

Before deleting an Edge Function:

1. identify all browser, service, scheduler, queue, HMAC, database, documentation, and test references;
2. confirm the function's inventory classification and satisfy its `removalGate` with concrete evidence;
3. identify any template, audit, queue, retry, idempotency, or security contract owned by the function;
4. remove or replace callers before deleting the endpoint;
5. update `supabase/config.toml`, the function directory, the runtime inventory, tests, and maintained documentation in one scoped package;
6. run exact-head Validation and any relevant isolated mutation/browser gates before merge.

Do not delete a service/cron/HMAC function solely because `supabase.functions.invoke(...)` is absent from the frontend.
