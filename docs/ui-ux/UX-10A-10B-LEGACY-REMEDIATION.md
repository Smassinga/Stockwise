# UX-10A / UX-10B Legacy Remediation Inventory

Checked: 2026-08-08.

This is a debt inventory, not a style guide. The canonical rules are in [StockWise Premium UI Direction](../premium-ui-direction.md). Remediation belongs in later surface-specific packages so visual changes can be reviewed with their real workflow, responsive states, localization, and business authority.

## Current bounded baseline

- Direct Tailwind semantic-colour utilities: 593 occurrences across 34 maintained source paths after shared premium primitives were migrated. `scripts/ui-foundations-baseline.json` is the maximum per-path debt ceiling; CI fails if a path increases or a new path introduces one.
- `animate-spin`: 12 occurrences across 11 paths. These are not automatically defects because local active operations may use spinners. Each later surface package must distinguish active operation feedback from structural page loading.
- Skeleton/loading references: 75 occurrences across 16 paths. Shared summary, table, list, and detail skeleton structures now exist, but surface-specific fit and layout-shift behaviour still need visual review.
- Gradient references: 30 occurrences across 9 paths. Some belong to existing public/auth or data-visualization treatments. They require a functional justification when each surface is revisited; the count is not an instruction to remove all gradients mechanically.
- Broad effect references (arbitrary shadows, glow/orb language, large blur, backdrop blur, glass, or shimmer terms): 157 occurrences across 50 paths. This deliberately over-counts and is an audit queue, not a CI failure list.
- Reduced-motion references: 37 occurrences across 12 paths. Shared skeleton pulse is motion-safe, but complete route-level motion coverage still requires manual and browser review.

## Priority remediation groups

### HIGH — semantic state migration

Migrate direct status-colour utilities during the corresponding surface packages, beginning with finance/legal document details, Settlements, Platform Control, commercial orders, Payment Activation, Growth Batches, and reporting. Preserve intentional brand primary and named chart/data-series tokens. Do not exchange one hardcoded palette for another.

### HIGH — TypeScript merge gate

`npx tsc --noEmit --pretty false` exposes pre-existing repository errors outside this foundations package. The current Vite build does not typecheck. Correct the existing baseline and then add a full typecheck CI step; do not add blanket exclusions, `skip` patterns, or a false-success wrapper.

### MEDIUM — browser accessibility coverage

Before making axe or an equivalent browser engine merge-blocking, establish reliable local authentication/fixtures and a small set of reference surfaces. Fail on critical and serious violations only when reproducible. Continue manual keyboard, focus restoration, screen-reader, contrast, reduced-motion, touch, EN/PT, and mobile checks because automation cannot replace them.

### MEDIUM — structural loading adoption

Replace structural full-page spinners with the closest shared skeleton variant when the final layout is known. Retain local operation progress for save, issue, import, delete, create, send, confirm, and other active mutations. Verify reserved dimensions at phone, tablet, and desktop widths and do not delay real content.

### MEDIUM — effect and card review

Review cards, pills, gradients, shadows, glow, orbs, glass, and animation in the owning surface package. Remove treatments that do not communicate grouping, state, interaction, hierarchy, or real product evidence. Landing exceptions must remain truthful, reduced-motion safe, pointer-safe, and subordinate to content.

### LOW — typography comparison

Run a separate controlled comparison of the current Inter stack and IBM Plex Sans. Assess Portuguese, numbers, tables, forms, mobile rendering, loading performance, and both themes. Do not change the global font as incidental cleanup.

## Tooling boundary recorded by UX-10A / UX-10B

The repository previously had no axe, axe-core, jest-axe, Playwright axe integration, Lighthouse gate, or PR template. This package adds static `eslint-plugin-jsx-a11y` checks, the semantic-colour debt ceiling, and a concise PR checklist. It does not claim WCAG conformance and does not make Lighthouse or legacy global debt merge-blocking.
