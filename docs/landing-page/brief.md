# StockWise Landing Page Brief

## Goal

The public Landing Page should help an owner or manager decide whether StockWise can connect the operating records their team already handles. It should lead to a 7-day trial or a commercial activation conversation without generic SaaS claims or fabricated proof.

## Positioning

StockWise connects the operating relationship between:

`Purchase / Receive -> Stock -> Produce or Sell -> Document -> Settlement -> Review`

The exact path depends on the workflow. The message is connected operational visibility: what happened, which record followed, and what management needs to review next.

Primary message:

> Know what you have, what sold, and what needs attention.

Portuguese:

> Saiba o que tem, o que vendeu e o que precisa de atenção.

## Audience

- Owners and managers moving away from disconnected spreadsheets, notebooks, documents, and payment notes.
- Retail, resale, Point of Sale, warehouse, distribution, production, and supported Growth Batch operations.
- Teams that need controlled user access and traceable stock movement.

The operating model matters more than a decorative industry label.

## Conversion Truth

- Primary CTA: `Start 7-day trial` / `Começar teste de 7 dias`.
- Secondary action: explain how records connect.
- Login remains available.
- Commercial contact uses the maintained public StockWise email route.
- Paid activation is manual. The page must not imply instant paid checkout.
- Pricing comes from `src/lib/pricingPlans.ts`; MZN appears naturally in actual prices.

## Market And Institutional Context

Mozambique remains discreet market and institutional context. Beira belongs in the WiseCore/footer context. MZN, NUIT, and IVA are not product-positioning claims. NUIT and IVA may appear only where a real document workflow requires them; the Landing has no standalone fiscal-marketing section.

## Evidence Rules

- The desk image at `/landing/stockwise-records-desk.png` is an approved illustration of operating records, not a customer screenshot or live product evidence.
- No suitable current product screenshot is maintained in the repository as of UX-10C. Do not replace that gap with coded pseudo-dashboards, fake charts, companies, quantities, revenue, testimonials, certifications, or adoption claims.
- Product truth comes from supported workflow relationships, canonical pricing, controlled access, traceable movement, and maintained EN/PT support.

## Content Rule

Copy must explain an outcome, describe real operating friction, guide a purchase decision, explain implementation, provide genuine evidence, or lead to an appropriate action. Avoid generic claims such as powerful, seamless, all-in-one, next-generation, or everything you need.

## Scope

The Landing is public presentation only. It must not change authentication, onboarding, Dashboard, Profile, subscriptions, payment activation, finance, inventory, Production Runs, Growth Batches, Supabase, authorization, RLS, RPCs, migrations, or business logic.
