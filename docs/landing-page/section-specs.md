# StockWise Landing Page Section Specs

## 1. Navigation

- Brand lockup links to `/`.
- Desktop links: Product, How it works, Pricing, FAQ.
- Actions: language toggle, theme toggle, Sign in, Start 7-day trial.
- Mobile menu exposes the same links and actions without requiring hover.

## 2. Hero

Headline:

> StockWise

Subtitle:

> Control stock, purchases, sales, payments, production activity, and growth batches in one serious workspace built for real Mozambican operations.

Primary CTA: `Start 7-day trial`.

Secondary CTA: `View pricing`.

Hero visual: use the local `/landing/stockwise-records-desk.png` image as a full-bleed business-records background with the StockWise value proposition over it. Keep the hero brand-led and avoid a split text/mockup composition.

## 2.1 Operation Fit

Show who the product is for before listing modules:

- buying and reselling;
- production and transformation;
- active Growth Batches;
- counter sales and cash control.

Growth Batches may mention active batches, measurements, direct costs, stock inputs, and event-specific reversals. Do not claim unverified Growth Batch lifecycle, costing, valuation, or finance-posting behavior as live.

## 3. Trust/Value Strip

Signals:

- Stock control
- POS-ready
- Finance documents
- User roles
- Growth Batches
- Mozambique-ready records

## 4. Problem Section

Show practical operating problems:

- stock managed in Excel or manual books
- sales not linked to stock movement
- documents scattered across people and files
- weak visibility over receivables and payables
- owners cannot see what needs attention first

Visual treatment:

- Use the local illustrative desk/documents asset at `/landing/stockwise-records-desk.png` beside the problem statement.
- The asset shows Excel-like stock sheets, inventory count sheets, invoice copies, receipts, payment notes, calculator context, and paper/manual records.
- The previous coded document collage was replaced because it looked too artificial and did not make the daily paperwork problem immediately clear.
- The section should transition textually or visually to: `StockWise connects these records into one organised workspace.`
- Keep this visual lightweight with the existing stack. Do not add external image URLs, random copyrighted images, heavy 3D, or animation dependencies.

## 5. Product Capabilities

Capabilities:

- Items and stock levels
- POS and sales
- Purchases and vendor bills
- Growth batches and inputs
- Invoices, credit notes, and debit notes
- Settlements, cash, and bank
- Reports and dashboards
- Users and roles
- Import/export

## 6. Dashboard/Product Showcase

Use only one realistic product preview on the page. The retained preview lives in the dark showcase section, remains illustrative, and must support both public light and dark modes.

The later showcase must not repeat the same dashboard preview. It should reinforce the problem-to-solution story with a distinct operating-control visual: records are captured, connected, and reviewed across items, movements, documents, settlements, and reports.

Avoid fake metrics that look like financial claims.

## 6.1 Page Animation

Use page-level animation to make the ShadCN/Tailwind landing page feel more fluid and premium:

- section reveal on scroll
- subtle upward fade-in for text blocks and cards
- gentle stagger for repeated capability, workflow, pricing, and FAQ cards
- fast business-like hover lift on cards and buttons
- full `prefers-reduced-motion` support

Avoid constant distracting object motion, bouncing UI, shader backgrounds, GSAP, Unicorn Studio, heavy 3D, and cinematic effects unless explicitly approved.

## 7. How StockWise Works

Steps:

1. Create company workspace.
2. Add/import items and opening stock.
3. Record sales, purchases, POS, and movements.
4. Control production and active batches.
5. Issue documents and track settlements.

## 8. Use Cases

- Bakery or small producer
- Butchery or food retail
- Agro, nursery, or biological growth
- Warehouse/distributor

Use cases should read like business contexts, not generic module lists. Public copy should mention only live, verified workflows; do not market unverified lifecycle, costing, valuation, or finance-posting behavior as product capabilities.

## 9. Mozambique-Ready Records

Mention NUIT, VAT/IVA, MZN, currency support, invoices, credit notes, debit notes, settlements, and exportable fiscal document data.

Required caution:

> Official submissions should be validated by your accountant or fiscal advisor.

## 10. Pricing/Trial

- Show public prices from the existing pricing source; the price values retain their currency code.
- Provide a visible pricing-period selector above the cards: Monthly, 6 months, Annual. Monthly is the default.
- Use approved six-month and annual values from the pricing source. If a six-month value is missing, show monthly x 6 without claiming a discount.
- Make the 7-day trial clear.
- State that paid activation is handled manually.
- Avoid instant-checkout language and avoid extra marketing copy that explains the currency already shown in the price values.

## 11. FAQ

Questions:

- Is the trial automatic?
- What happens after the trial?
- Can I import items and opening stock?
- Can I track active Growth Batches?
- Does it work on mobile?
- Does it replace my accountant?
- Does it support Mozambique records?
- Can I invite users?
- Does StockWise include a Point of Sale workspace?

## 12. Team And Proof

Show WiseCore Technologies, Lda., Beira, Mozambique, and the founder roles currently supported by supplied assets:

- Samuel Massinga, Founder and CEO;
- Alda Jofrice, Co-Founder and Executive Manager;
- Galileu Gonçalves, Co-founder and Chief Operating Officer.

Use the cropped WiseCore logo assets from `/brand/wisecore-logo-light.png` and `/brand/wisecore-logo-dark.png` so the logo is visible in both public themes.

Use company support/contact routes rather than exposing personal contact details on the landing page.

## 13. Final CTA

Short, confident prompt to start the trial or contact StockWise.

## 14. Footer

Include StockWise, WiseCore Technologies, Lda., support email, and only real routes/anchors.
