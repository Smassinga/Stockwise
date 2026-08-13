# Platform-admin assisted customer provisioning

Status: implementation candidate, pending the coordinated local migration replay and rollback-only QA gate.

This record defines the Package B authority contract. It supplements `platform-admin-runbook.md`; it does not turn platform administration into company ownership or membership.

## Provisioning architecture

`platform_admin_provision_customer_company(...)` is the only customer-shell creation primitive used by Platform Control. It requires the canonical platform-admin check, a client-generated idempotency key, a minimum company name, and validated optional owner/company contact fields.

The atomic result is deliberately incomplete from the customer's perspective:

- `companies.owner_user_id` is null;
- no `company_members` row is created for the platform administrator;
- required company settings and default payment terms exist;
- subscription state is `disabled` on `trial_7d`;
- `trial_started_at` and `trial_expires_at` are null;
- provisioning actor, timestamp, request identity, intended owner email, and lifecycle evidence are durable.

The ordinary `create_company_and_bootstrap(...)` self-service path remains separate and continues to create an OWNER membership for the authenticated creator.

Platform-administrator authority is bound to the active catalogue row's exact Auth `user_id`. The stored email is audit context only; changing or recycling that address cannot transfer platform authority.
An active platform-admin row therefore requires a non-null Auth user ID, and the bootstrap command stops if the requested email does not yet resolve to an authenticated user.

## Narrow setup capability

Opening a customer workspace creates one exact-company context for the platform administrator, expiring after at most two hours. It is closed explicitly when returning to Platform Control and deleted atomically when owner handover completes.

The context is not recognized by `current_company_id`, `current_user_company_ids`, `has_company_role`, `actor_role_for`, or `company_access_is_enabled`. It therefore cannot satisfy normal finance, order, POS, production, or other operational role checks.

The frontend route allowlist is limited to:

- company settings/profile and communication identity;
- warehouses and bins;
- items;
- customers;
- suppliers;
- Opening Import;
- users and non-OWNER invitations;
- currencies, FX rates, and payment terms.

The database mirrors that boundary with exact-company additive RLS policies on the corresponding setup tables. Company profile, settings, base-currency, non-OWNER invitations, and Opening Import use dedicated assisted-workspace functions where existing reusable screens otherwise depend on membership or `current_company_id`.

Opening Import is additionally gated by `platform_admin_post_opening_stock_import(...)`. That wrapper sets a transaction-local `stockwise.assisted_setup_operation=opening_stock_import` capability. `stockwise_require_operator_company(...)` recognizes the platform context only while that exact capability is present; the normal RPC remains membership/access controlled.

Setup writes retain domain validation: bins must remain attached to a warehouse in the same company; item creation reuses `create_item_with_profile(...)`; assisted item edits use a minimum-stock-only RPC; opening quantities and values reject PostgreSQL non-finite numerics; company settings and base currency use their governed RPCs; and the active base currency cannot be removed from the company catalogue.

## Invitation and owner handover

OWNER handover uses `platform_admin_invite_assisted_owner(...)` and the existing token/email invitation experience. The governed contract is:

- only the exact intended email can accept;
- prior unaccepted OWNER invites are expired before a new one is created;
- invitation discovery may link a pending membership to the same authenticated identity but cannot activate it or mark the invite accepted;
- wrong-email token acceptance is rejected;
- explicit acceptance activates the OWNER membership and sets `companies.owner_user_id` atomically;
- the owner-change trigger rejects direct assisted-company owner assignment outside that finalizer;
- an active platform-administrator identity (maintained admin email or the current Auth email bound to that admin) is rejected as an intended owner or assisted invitee, so temporary setup authority cannot become persistent tenant authority;
- the same platform-administrator check runs again during invitation acceptance, closing email-change/time-of-check gaps between invite creation and activation;
- all platform workspace contexts for the company close during handover;
- a handed-over tenant cannot reopen through the provisioning workspace path.

Non-OWNER setup invitations use `platform_admin_invite_assisted_member(...)`. OWNER is excluded from that function.

## One-time trial

Provisioning never starts the customer trial. `platform_admin_start_assisted_trial(...)` requires the intended owner to be the active canonical OWNER and the access state still to be `disabled`.

The first successful call stores one exact window:

- start: transaction time;
- expiry: start plus 7 days;
- purge schedule: expiry plus the existing 14-day lifecycle interval.

The company subscription trigger prevents generic access transitions from starting or resetting an assisted trial. Once started, the original trial timestamps remain immutable evidence even if later paid, suspended, expired, or disabled transitions use a generic update shape. Existing paid access is never replaced with a trial.

## Audit evidence

The existing company control-action log records:

- `assisted_company_provisioned`;
- `assisted_workspace_opened`;
- `assisted_owner_invited`;
- `assisted_member_invited`;
- `assisted_owner_activated`;
- `assisted_trial_started`.

Each event records actor, company, timestamp, reason, and safe context. The two internal lifecycle tables use FORCE RLS, no direct authenticated table grants, and explicit least-privilege service-role grants for Edge Function reads/writes.

## QA gate

Permanent regression coverage is in:

- `tests/assisted-provisioning/assisted-provisioning.test.mjs` for migration/frontend authority contracts;
- `tests/assisted-provisioning/assisted-provisioning.sql` for rollback-only local behavior and security.

The SQL matrix covers ownerless provisioning, idempotency, normal-user denial, no fake membership, platform-admin invitee rejection at provisioning/OWNER/member boundaries, narrow setup writes, absence of normal stock/role authority, direct owner-assignment denial, wrong-email rejection, exact owner activation, context closure, exact one-time 7-day trial, Opening Import through the dedicated wrapper, and self-service onboarding preservation.

At the time this record was written, the revised migration had not yet received the coordinated clean local replay requested for Packages A/B/C. No hosted migration, Edge Function deployment, customer-company mutation, commit, push, or deployment is claimed. Replace this paragraph with exact replay/browser/Edge evidence only after those gates actually run.
