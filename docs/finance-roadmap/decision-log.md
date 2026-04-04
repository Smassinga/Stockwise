# Finance Roadmap Decision Log

Record durable implementation decisions here so future sessions do not re-argue settled architecture.

| Date | Decision | Why It Was Made | Follow-up |
|---|---|---|---|
| 2026-04-01 | Settlement truth moves from `SO` to `SI` and from `PO` to `VB` once the finance document exists. | Orders are operational/commercial documents; issued/post finance documents are the legal/financial truth. | Preserve this in all new settlement, reminder, and reporting work. |
| 2026-04-01 | Pre-existing order-linked receipts/payments must be re-associated to the finance document when the finance document is created. | Prevent duplicate exposure and keep one active settlement anchor. | Keep validating this in future regression coverage. |
| 2026-04-03 | Sales invoice corrections support partial and cumulative credit notes. | Full-only reversal is too primitive for real AR operations. | Keep invoice state and outstanding logic cumulative. |
| 2026-04-03 | Sales invoice corrections also support debit notes and mixed credit/debit adjustment chains. | AR needs upward legal corrections, not only downward reversals. | Treat `current legal amount` as original minus credits plus debits. |
| 2026-04-03 | The lower-left invoice output card now carries `Motivo de isenção do IVA` instead of the old fiscal summary card. | VAT exemption reason is the more relevant commercial/compliance field for Mozambique output. | Keep this field explicit on issue and output flows. |
| 2026-04-04 | AP uses the same maturity model as AR where justified: vendor bills as anchors, supplier credit notes to reduce liability, supplier debit notes to increase liability. | AP was materially underbuilt compared with AR and needed coherent parity. | Keep AP parity focused on finance coherence, not blind symmetry. |
| 2026-04-04 | Supplier invoice reference and Stockwise internal reference are separate concepts. | Supplier reference originates externally; the internal key is Stockwise audit/system identity. | New UX must keep this distinction explicit and avoid ambiguous prefixes. |
| 2026-04-04 | Legacy `COD-*` internal references remain for audit continuity, but new internal AP references use clear prefixes such as `VB`, `VCN`, and `VDN`. | `COD` is a legacy company-derived prefix, not a finance document-type code. | Avoid introducing unexplained prefixes on new finance screens. |
| 2026-04-04 | Due reminders must be redesigned to follow the active finance anchor once an invoice exists. | Sales-order reminders contradict the settlement-anchor model after invoice issuance. | Track this in Phase 3 until implemented. |
| 2026-04-04 | Document language behavior remains a tracked gap. | The app supports `pt`/`en` selection and stores document language, but output helpers still render Portuguese-first. | Resolve source-of-truth and implement bilingual output in a future roadmap item. |
| 2026-04-04 | Finance-document output language is snapshot-first, with app/document language as fallback only when no snapshot exists. | Issued/post output must remain stable, while unsnapshotted documents still need to follow the currently selected language. | Keep HTML, PDF, print, and share output on the same bilingual helper and do not reintroduce Portuguese-only labels. |
| 2026-04-04 | Engineering roadmap tracking stays repo-first for now. | Current Settings and Mozambique Compliance screens are tenant-facing operational/compliance surfaces, not the right place for engineering execution status. | If in-app visibility is ever needed, add a restricted internal/admin route rather than cluttering tenant-facing UI. |

## Implementation Notes

- When a phase item is completed, add a new dated row instead of rewriting older decisions.
- If a prior decision is superseded, add a new row that explicitly replaces it and reference the older decision in the description.
- Keep this log focused on architecture and behavior decisions, not generic activity summaries.

