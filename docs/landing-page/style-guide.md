# StockWise Landing Page Style Guide

## Visual Mood

The landing page is a premium business SaaS website. It should feel serious enough for business records, stock control, and finance review, while remaining clear and approachable for small and medium businesses.

Design attributes:

- light-first credibility with true white and pale blue-gray surfaces
- navy/slate text for trust and readability
- restrained blue and teal accents
- controlled dark sections for product showcase and operational contrast
- precise 8px to 12px radii for most surfaces
- thin borders and measured shadows
- compact enterprise typography
- no flashy neon, bokeh blobs, generic 3D, or decorative AI-looking cards

## Layout Rules

- The first viewport must show the StockWise brand, clear headline, CTA, login path, and product signal.
- A hint of the next section should be visible on normal desktop viewports.
- Sections should vary rhythm: hero, trust strip, problem block, capabilities register, dark product showcase, process, use cases, compliance, pricing, FAQ, final CTA.
- Cards are used for repeated capabilities, pricing, FAQ, and product notes. Avoid nested cards and decorative section wrappers.
- Product visuals must be realistic and must not fabricate impossible product features.
- Keep only one dashboard-style product preview on the page. If another section needs a visual, use a distinct problem-to-solution or operating-control treatment instead of repeating the same preview.
- The retained product preview must support public light mode and dark mode.
- The everyday-challenges section uses the local `/landing/stockwise-records-desk.png` illustrative asset in a framed image card. It should feel like a realistic business-records composition: spreadsheet rows, count sheets, invoices, receipts, payment notes, and calculator context.
- Do not restore the coded collage as the primary visual; it was replaced because it looked too artificial. Do not use external image URLs.

## Typography

- Use the existing Inter stack.
- Hero headline should be confident and direct, not oversized beyond the content.
- Section headings should be smaller than the hero and fit comfortably on mobile.
- Labels may use uppercase only where they act as compact operational labels.
- Letter spacing should stay neutral or modest; avoid exaggerated tracking.

## Interaction

- Navigation links should point to real landing sections.
- Mobile nav must be usable without hover.
- CTA buttons must have visible focus states.
- Product menu hover is acceptable on desktop only if mobile has a direct expanded alternative.
- Motion must respect reduced motion and stay subtle: section reveal, upward fade-in, card stagger, hover lift, and fast transitions are acceptable.
- Do not add heavy 3D, physics effects, shader backgrounds, or extra animation dependencies.
- Do not use constant distracting object motion. The page should feel fluid while users scroll, not like an animation demo.

## Public Theme And Language

Public light mode is the primary design target. Dark mode must remain readable and deliberate when the user toggles the public theme.

The public language toggle must keep English and Portuguese copy professional and UTF-8 clean.

## Dependency Position

No new dependencies are planned. The landing page should use the existing React, Tailwind, shadcn-style primitives, lucide icons, and framer-motion dependency already present in the app.
