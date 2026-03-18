# AGENTS.md

## Stockwise operating rules

- Never claim a live database migration was applied unless `npx supabase db push` succeeded in this session.
- Never claim FIFO is a live costing policy unless backend posting, valuation, and COGS are consistent end to end.
- For inventory items, only `min_stock` may be edited after item creation unless explicitly requested and justified.
- Before any Supabase DB change, run:
  - `npx supabase db pull` if remote state may have changed
  - inspect pending files under `supabase/migrations`
- Before any Edge Function deployment, verify required secrets are present.
- After code changes, run:
  - `npm run lint:js`
  - `npm run build`
- Use Portuguese strings in UTF-8. Fix mojibake when found.
- For production-impacting actions, report exactly:
  - what changed in code
  - what changed live
  - what failed
  - what remains manual
