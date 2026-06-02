# StockWise Landing Page Section Specs

## 1. Navigation

- Brand lockup links to `/`.
- Desktop links: Product, How it works, Pricing, FAQ.
- Actions: language toggle, theme toggle, Sign in, Start 7-day trial.
- Mobile menu exposes the same links and actions without requiring hover.

## 2. Hero

Headline:

> Run stock, sales, and business records with more control.

Subtitle:

> StockWise helps shops, warehouses, and growing businesses replace scattered spreadsheets with a structured system for items, stock, POS, purchases, invoices, settlements, users, and reports.

Primary CTA: `Start 7-day trial`.

Secondary CTA: `View pricing`.

Hero visual: realistic product preview showing stock, documents, settlements, and dashboard metrics. The preview is illustrative but must not imply features outside the current product.

## 3. Trust/Value Strip

Signals:

- Stock control
- POS-ready
- Finance documents
- User roles
- Reports
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
- Invoices, credit notes, and debit notes
- Settlements, cash, and bank
- Reports and dashboards
- Users and roles
- Import/export

## 6. Dashboard/Product Showcase

Use only one realistic product preview on the page. The retained preview lives in the hero, remains illustrative, and must support both public light and dark modes.

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
4. Issue/track documents and settlements.
5. Review dashboard and reports.

## 8. Use Cases

- Retail shop
- Warehouse/distributor
- Service company with materials
- Owner/operator team

## 9. Mozambique-Ready Records

Mention NUIT, VAT/IVA, MZN, currency support, invoices, credit notes, debit notes, settlements, and exportable fiscal document data.

Required caution:

> Official submissions should be validated by your accountant or fiscal advisor.

## 10. Pricing/Trial

- Show public MZN prices from the existing pricing source.
- Make the 7-day trial clear.
- State that paid activation is handled manually.
- Avoid instant-checkout language.

## 11. FAQ

Questions:

- Is the trial automatic?
- What happens after the trial?
- Can I import items and opening stock?
- Does it work on mobile?
- Does it replace my accountant?
- Does it support Mozambique records?
- Can I invite users?
- Can I use POS?

## 12. Final CTA

Short, confident prompt to start the trial or contact StockWise.

## 13. Footer

Include StockWise, WiseCore Technologies, Lda., support email, and only real routes/anchors.
