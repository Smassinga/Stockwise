# UX-11E — Administration and Technical Cleanup

Status: implemented and validated as an uncommitted UX-11 worktree package. The Opening Import quantity-precision blocker was subsequently resolved and proven by `OPENING-QTY-1`; UX-11 is ready for consolidated review.

## Scope and authority boundary

UX-11E changes administration presentation, reusable state handling, Global Search orchestration, notification presentation, UOM governance visibility, Opening Import presentation and proven-dead frontend code. Existing company roles, invitations, membership authority, subscription controls, RLS, RPC authority, import mutation contracts, UOM conversion rules and schema remain unchanged.

Leny Doçuras was the only company used for authenticated QA. The active user was an `ADMIN`; no service-role or manufactured authentication state was used.

## Settings

Settings uses a direct page title, retains only guidance that explains authority or operational consequence, reserves its structure with the shared detail skeleton and uses an open summary band instead of three independent metric cards. Company, operations, communications and document controls remain grouped by their existing scope. Personal language/theme controls were not duplicated into company configuration.

Persistence QA changed the default Dashboard window from 30 to 60 days, saved it, reloaded and observed 60 days, then restored 30 days, saved and reloaded again. The final Leny value is 30 days.

## Users, roles and invitations

The register distinguishes categorical role from membership state. Role remains neutral identity; active, invited and disabled states use text plus semantic status treatments. Loading no longer presents false zero member totals. The redundant page-purpose subheader was removed and the summary is an open band.

Authenticated QA covered the current `ADMIN` session, five active memberships, two pending invitations and the invited `MANAGER` state. Existing consequential copy for disabling/removing access remains. No invitation was sent, role changed or member removed. A lower-authority authenticated session was not available and was not fabricated.

## UOM governance investigation

The `uoms` catalogue is global and has no company ownership column. Three `Each` records were found:

- canonical `EA`: `6ae319cf-9b68-4224-abfb-cd762dd9caa9`, seeded by maintained migrations, created 2026-04-19, referenced in Leny by six items, fourteen sales-order lines, five purchase-order lines and existing stock/operational evidence;
- generated `EA-4DBCF6D0`: `c09965f9-909f-4453-b26e-7dcebda1c1f5`, created 2026-04-23, with no accessible Leny item, sales-order-line, purchase-order-line or stock-movement reference found;
- generated `EA-8CEB9D40`: `f99c4bf9-0fa6-4feb-b732-8b69ca695f74`, created 2026-04-23, with no accessible Leny item, sales-order-line, purchase-order-line or stock-movement reference found.

The generated IDs do not appear in migrations or current source. Their creation origin is therefore an inference from the historical generated-code shape, not proven actor evidence. Neither record was deleted: the current UI has no governed unit-delete workflow and a global reference audit cannot be guaranteed from the company-scoped session.

Classification: **C — product allows semantic duplicate creation**. The administration page previously rejected only an exact code; it could accept the same name/family under another code. UX-11E adds a visible same-name/family warning and a frontend block, expands generated-code detection to the observed prefix form, excludes generated codes from new conversion choices and exposes them as historical governance evidence. This is not a database integrity guarantee.

Resolved follow-up: `UOM-INTEGRITY-1` completed the cross-company audit, retained canonical `EA / Each`, deleted only the two globally unreferenced generated duplicates through a guarded migration, and replaced direct authenticated catalogue writes with governed canonical reuse. See `docs/data-integrity/UOM-INTEGRITY-1.md` for the authority, reference and rollout evidence.

## Global Search

The previous implementation awaited seven independent company-scoped requests serially: items, customers, suppliers, purchase orders, sales orders, sales invoice state and vendor bill state. A pre-change authenticated `QA` search took about 5.5 seconds after the page was available.

UX-11E executes the same seven queries concurrently, preserves the same filters, limits, result grouping and destinations, cancels superseded batches and ignores stale responses. Missing optional finance views retain their previous non-fatal treatment. A partial category failure preserves successful categories with an explicit warning; a complete failure remains a retryable error.

Post-change CDP evidence recorded one request per domain and a 122 ms response-completion span for the seven-query batch. The full cold authenticated route still took about 14 seconds because company/session boot precedes Search; that is separate from the reportable search batch and remains broader application-startup debt.

## Notifications

Legacy generated bodies now trim storage-scale trailing zeros for presentation (`520.00000000` becomes `520`; `2099.6000000000` becomes `2099.6`) without changing stored values. Known obsolete `/cash/approvals` actions are no longer rendered as links; all remaining action URLs must be same-origin relative paths. Leny QA found no long raw decimals and no technical destination text in the rendered register. No notification type, event or backend delivery logic changed.

## Opening Import

The workflow retains its consequential prerequisite and format guidance, adds an explicit file-input label, uses the shared page header and does not show three zero summary cards before a file is selected. Validation issues use canonical warning tokens; a successful import uses success semantics and text.

Controlled fixture format:

```csv
sku,name,base_uom_code,min_stock,unit_price,primary_role
UX11E-QA-IMPORT-001,UX11E QA Opening Item A,EA,1.25,45.50,resale
UX11E-QA-IMPORT-002,UX11E QA Opening Item B,KG,0.5,120.00,raw_material
```

An invalid preview with a blank name and unknown UOM produced row/field-specific validation and no mutation. The valid two-row item-master fixture was committed through the normal Leny UI. The resulting item IDs are `fc5f7af8-86ae-4372-af5e-baca02f4004e` and `9c51682d-002c-4cfb-bc4d-53406e111645`; quantities, prices, roles and base UOMs matched the fixture. Item-master import intentionally created no stock level or stock movement. The QA items remain in Leny as recognisable fixtures.

### Resolved correctness blocker: opening-stock quantity precision

Source tracing confirmed that `OpeningImport.tsx` still constructs opening-stock payloads with `qty_base: round2(qtyBase)`. The database and POS-QTY-1 contract preserve operational quantities beyond two decimals. This is the same category of quantity-versus-money error: a valid `1.375 KG` opening quantity would be sent as `1.38 KG` even though monetary `total_value` may correctly remain rounded.

UX-11E did not change this business payload because import semantics were outside its presentation scope. `OPENING-QTY-1` then replaced the monetary helper at the posting boundary with the established `normalizeOperationalQuantity` contract, while retaining two-decimal monetary `total_value` rounding. Permanent coverage lives in `tests/opening-quantity/opening-quantity.test.mjs`.

Leny proof used item `UX11-OPENING-QTY-001` (`5d593929-856a-4f87-8065-6269751e0ff7`), existing `KG`, warehouse `WH001` and bin `QA-A2`. The preview showed `1.375`; the inspected governed payload sent `qty: 1.375` and `qty_base: 1.375`; `post_opening_stock_import` returned `total_qty_base: 1.375000`; stock level `2028367a-eb73-4f5b-b8a7-d19c8b5bd140` persisted `1.375`; and movement `f4e7ef59-9c10-44b6-81a2-5da58027d8e5` persisted `1.375`, `unit_cost: 50` and `total_value: 68.75`. No `1.38` value appeared in the verified chain.

## Technical cleanup

`src/pages/reports/**` was proven unreachable: the router imports the maintained `src/pages/Reports.tsx`, no route, dynamic import, test or active documentation references the legacy tree, and the folder duplicated superseded report implementations. Eleven dead files were deleted rather than repaired. This removed seven TypeScript errors without changing the maintained Reports route.

TypeScript moved from 24 errors across 12 paths to 12 errors across six paths. The remaining paths are outside UX-11E scope:

- `src/components/collections/CollectionsControlPanel.tsx`;
- `src/components/platform/PaymentActivationAdmin.tsx`;
- `src/lib/companySetupReadiness.ts`;
- `src/lib/financeExport.ts`;
- `src/lib/sentry.ts`;
- `src/pages/PlatformControl.tsx`.

All UX-11E changed files have zero TypeScript errors. Direct semantic-colour debt moved from 272 to 246; no touched path increased.

## Accessibility and responsive QA

Settings, Users, UOM, Search, Notifications and Opening Import were exercised at 360, 390, 430, 820 and 1440 CSS pixels. Each retained its heading and primary controls without whole-page horizontal overflow. Long emails and UOM IDs remain breakable; data tables stay within contained horizontal regions. Mobile register rows preserve role, state and actions. File selection is natively labelled. Keyboard-reachable native buttons, links, inputs, selects and dialogs remain the primary interaction model.

English and Portuguese were exercised on every scoped route. Theme switching was exercised and restored to English/light. Reduced-motion remains provided by the shared foundation; UX-11E adds no animation.

The repository has static `eslint-plugin-jsx-a11y` checks but no maintained authenticated browser/E2E harness suitable for a small axe addition. UX-11E therefore adds focused source-contract tests and manual authenticated QA rather than introducing a new browser stack. Automated checks remain evidence, not WCAG certification.

## Deferred items

- **RESOLVED:** `OPENING-QTY-1` corrected and proved opening-stock operational quantity precision; the UX-11 correctness blocker is closed.
- **RESOLVED:** `UOM-INTEGRITY-1` now enforces canonical UOM identity while preserving all historical references and conversion semantics.
- **MEDIUM:** cold authenticated application bootstrap still dominates Search route readiness even after the seven search-domain requests were made concurrent.
- **LOW:** lower-authority role presentation requires a normally authenticated Manager/Operator/Viewer fixture; current QA covered Admin plus pending Manager state only.
- **LOW:** authenticated axe coverage remains unavailable until a maintained browser/E2E harness exists.
