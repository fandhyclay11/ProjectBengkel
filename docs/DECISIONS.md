# Decisions and OPEN Items — ProjectBengkel V1

This log separates locked requirements from unresolved details. `PRD_FINAL.md` remains the sole V1 source of truth and includes the latest user-selected O-01 through O-30 decisions. A technical recommendation is not approved until reviewed. Do not treat an OPEN item as permission to choose a business outcome. `MASTER_PROMPT_OpenCode_Bengkel.md` governs agent work procedure only and does not add business requirements.

## Final decisions (PRD_FINAL and explicit user review clarifications)

| ID | Decision | Planning consequence |
|---|---|---|
| D-01 | `PRD_FINAL.md` is the sole V1 product requirement source; this prompt is work procedure, not PRD. | No legacy/draft rule can override it. |
| D-02 | Local-First host plus LAN clients share one host PostgreSQL; browser→API→service/domain→repository/ORM→PostgreSQL. Core operation does not require internet. | No direct client DB access or cloud dependency. |
| D-03 | V1 roles only ADMIN/USER; USER permissions are standard and checked server-side. | Deny direct API access as well as UI affordances. |
| D-04 | USER must not receive buy/sell master price, HPP/Average Cost, Inventory Value, movement history, audit, Dashboard or Reports. USER may see/edit transaction selling price and may see a warning without buy price. | Filter server output, detail, print and exports; allow transaction-price fields specifically. |
| D-05 | Inventory stock must never be negative. Service/SLS shortage is rejected; Purchase does not use negative-balance receipt/covering. Negative Stock Opname difference remains valid and is not negative inventory; if stock changes since SO begins, USER must recount before Admin approval. | Enforce nonnegative resulting stock atomically; retain signed negative SO adjustments and recount gate. |
| D-06 | Average Cost is V1 costing; transaction HPP snapshots prevent silent historical changes. | Keep current costing separate from historical snapshots. |
| D-07 | Movement ledger is immutable; every stock change passes through Stock Service. Corrections and cancellation use new delta/reversal movement. | No direct balance CRUD or mutation/deletion of posted ledger rows. |
| D-08 | Stock-changing confirmation and SO approval are atomic; retries/double submissions cannot duplicate movement. | Transaction, concurrency and idempotency are acceptance requirements. |
| D-09 | SO captures stock at creation; USER may revise/recheck after Finalize until Admin Approve/Reject; latest revision is official and separate revision-history records are not required; approved is final. If stock changes before approval, USER must recount before Admin approval. | Detect stock changes and require recount before approval. |
| D-10 | Completed Service/SLS each may be edited by Admin at most once; Purchase Draft can be confirmed or deleted while Draft, and Completed Purchase may be edited at most once/canceled by Admin; Expense Admin-only and has no Draft. | Enforce each entity lifecycle and its locked edit scope. |
| D-11 | CANCELED Service/SLS/Purchase persist with original immutable movement and reversal; cannot be edited or reactivated; correction uses a new applicable workflow; canceled excluded from Dashboard/P&L. Canceled Expense cannot be reactivated and is excluded from expense history/business reports and costs. | Enforce terminal cancellation transitions; do not expose reactivation. |
| D-12 | Monetary values use integer Rupiah; sparepart inventory quantities use integer pcs; Expense quantity may be decimal; every calculation step is rounded before its result is used by the next step. | Implement the step-by-step rounding rule consistently. |
| D-13 | Generated part code unique and never reused; deletion removes the part from the active list while historical name/code snapshots remain. | Preserve history while preventing deleted part from appearing active. |
| D-14 | Audit events per PRD; logs cannot be edited but Admin may delete; deletion is recorded in a separate technical log that cannot be deleted through the Audit menu. | Implement the separate technical trace. |
| D-15 | Backup Admin only, manual/weekly scheduled, 30-day retention, timestamped, same server, no mandatory encryption, no download button. | Same-host unencrypted exposure is accepted V1 risk. |
| D-16 | Restore requires strong confirmation, pre-restore protection and atomic recovery on failure; external PostgreSQL file must be compatible and checked before restore; audit and Admin login again. | Exact accepted versions and check procedure remain technical details. |
| D-17 | Excel migration is Admin-only Preview→Validation→Import; any error aborts whole import; V1 imports only sparepart master from `.xlsx`; no guessed ambiguous mapping. Historical Service/SLS/Purchase transactions and Excel stock are reference-only and never create active transactions or opening stock. | File/row limit follows sample review; implement master-only import. |
| D-18 | Business numbers are `SRV-YYYYMMDD-0001`, `PUR-YYYYMMDD-0001`, `OPN-YYYYMMDD-0001`, `SLS-YYYYMMDD-0001`, and `EXP-YYYYMMDD-0001`; numbers remain stable after transaction date/time edits. | Keep internal IDs, business codes, and human-readable transaction numbers distinct. |
| D-19 | Dashboard/P&L formulas and scope as PRD; no extra KPI/chart. `Stok Menipis` means current stock <= minimum stock. Short ranges are more detailed, long ranges more compact, and no comparison period is shown. | Shared report/query definitions; canceled excluded; exact range cutoffs/rounding are technical details. |
| D-20 | Planning only; no application coding until separate user instruction after review. | This task creates planning documents only. |
| D-21 | Admin completed Service/SLS edits require a reason, Before→After summary and audit; each allows at most one edit; all creator-entered fields may change except transaction number and old stock note; check current stock before accepting increased use. | New immutable delta movement; never make inventory negative. |
| D-22 | Service/SLS have preview-before-save. Preview creates neither a Completed transaction nor a movement; final save is server-validated and atomic. | Preview is transient and does not create a Draft workflow. |
| D-23 | Duplicate sparepart name after ignoring case and leading/trailing spaces is rejected; similar name warns and Admin may explicitly continue. | Similarity algorithm is technical OPEN; do not invent fuzzy matching. |
| D-24 | Service/SLS transaction selling price defaults from master and Admin/USER may see and edit it; below latest buy price is allowed with a warning that does not show buy price. | Never reject a transaction solely for this comparison or expose sensitive master prices/HPP to USER. |
| D-25 | Purchase Draft and confirm each require at least one item; a sparepart may occur only once per Purchase. | Admin-only Draft workflow remains; database/service validation must enforce these requirements. |
| D-26 | Completed Purchase edit is allowed at most once; one edit may add/remove/change items, updates Average Cost and leaves old HPP unchanged. Supplier-only change needs no reason; any other edit requires a reason and Before→After summary. Supplier is free text. For item edit/cancel, any later stock decrease for an affected sparepart after Confirm counts as use and rejects the operation; later replenishment does not undo that use. Supplier-only edit remains available once because it has no stock effect. | Preserve immutable old movement; record quantity/value delta and enforce the selected use gate. |
| D-27 | Latest Buy Price is the latest purchase price successfully received through Purchase; Purchase Confirm to Completed updates it. Later Purchases/master changes do not rewrite earlier Purchase item prices; the explicitly allowed one-time edit updates its Purchase item with Before→After audit. Latest Buy Price is distinct from Average Cost/HPP. | Post-completion edit/cancel and positive-price rules are locked in D-38; cancellation after downstream use is refused under O-17. |
| D-28 | O-01: V1 production deployment is native Windows; Admin starts the app manually when needed; it does not auto-start; Docker is not required. | LAN bind, firewall, addressing and HTTPS remain technical details. |
| D-29 | O-02: internal IDs are BIGINT auto-increment; inventory quantity is integer pcs; monetary values are integer Rupiah; round each calculation step before continuing. | Technical numeric representation must preserve step rounding. |
| D-30 | O-03: negative inventory stock is prohibited; Service/SLS shortage and edits cannot result in negative stock; negative SO difference remains allowed; no negative-stock HPP reconciliation workflow is needed for V1. | Purchase receipt cannot cover negative stock; PRD and planning now state the same invariant. |
| D-31 | O-04: Completed Purchase gets at most one edit total; one edit may add/remove/change items, updates Average Cost and leaves old HPP unchanged; item edits are explicit and captured Before→After. Supplier-only edit needs no reason; other edits need reason + Before→After; supplier is free text. Prior movement is immutable and stock delta is a new movement. Under selected O-17/A, any subsequent stock decrease for an affected part after Confirm blocks item edit/cancel. | Technical reconciliation must preserve these outcomes. |
| D-32 | O-05: each Completed Service/SLS may be edited by Admin at most once, with reason + Before→After; all creator-entered fields except transaction number and old stock note are editable; new movement for stock adjustment, no old movement changes, no negative resulting inventory. O-16 current-stock check applies. | No business field-scope OPEN remains. |
| D-33 | O-06: Expense business number remains unchanged when transaction date is edited. | None for this decision. |
| D-34 | O-07: save time using computer time standard and display/report using workshop timezone; transaction date/time is one datetime value; future datetime is prohibited; CreatedAt/UpdatedAt are conceptually distinct. | Timestamp storage/day-boundary implementation details remain. |
| D-35 | O-08: after Finalize, USER may revise/recheck until Admin Approve/Reject; latest revision is official; no separate revision-history records are required; after approval SO is immutable and correction uses a new SO. If stock changes before approval, USER must recount first. | Implement stock-change detection and recount gate. |
| D-36 | O-21: stock/cost ledger order follows Purchase Confirm and transaction commit/processing time; transaction business date is used for reports. | Timezone day boundaries/report aggregation remain under O-07; do not recost historical transaction HPP silently. |
| D-37 | O-30: Admin enters opening quantity and cost per unit greater than Rp0 for each sparepart. On save, stock applies immediately at input time; the cost per unit initializes Average Cost; Stock Service records an immutable movement atomically; no second approval is required. Excel stock never initializes opening stock. | No business decision remains for opening-cost positivity. |
| D-38 | O-24: Purchase item buy price must be integer Rupiah greater than Rp0. Latest Buy Price follows the most recent still-valid Completed Purchase by Confirm/commit time; an allowed edit updates it and an allowed cancellation falls back to the prior still-valid Completed Purchase. | None for the selected price/Latest Buy Price behavior; O-17 cancellation refusal applies if stock was used downstream. |
| D-39 | O-26: retryable mutation key is unique per actor and operation; same key and same data returns the original result; same key with different data is rejected; idempotency records are kept permanently. | Internal key/result representation remains technical implementation detail. |

## O-numbered decisions

`PRD_FINAL.md` is the source of truth. These O numbers are preserved for traceability.

### LOCKED by the latest user choices

| O-ID | Locked choice |
|---|---|
| O-01 | Admin starts the Windows app manually when needed; no auto-start. |
| O-02 | Round every calculation step before continuing to the next step. |
| O-04 | One completed Purchase edit can add/remove/change items; update Average Cost and keep old HPP unchanged. |
| O-04a | Supplier is free text on Purchase; no supplier master. |
| O-05 | Admin can edit all creator-entered Service/SLS fields once except transaction number and old stock note; reason + Before→After + audit required. |
| O-07 | Save time using the computer time standard; display and report using workshop timezone. |
| O-09 | Deleted sparepart leaves the active list; historical records remain. |
| O-10 | Audit deletion is recorded in a separate technical log that cannot be deleted through the Audit menu. |
| O-11 | Admin can view canceled Expense in a separate “Dibatalkan” view; ordinary history/reports exclude it. |
| O-12 | External restore accepts compatible PostgreSQL versions and checks the file before restore. |
| O-13 | Excel import uses `.xlsx`; size/row limits follow review of a workshop sample. |
| O-15 | Short chart ranges are detailed, long ranges compact, and there is no comparison period. |
| O-16 | Service/SLS edit checks current stock; accept added usage only if available stock is sufficient. |
| O-17 | For item edit/cancel, any later stock decrease for an affected sparepart after Confirm means the Purchase is considered used; reject even if later receipts restored the balance. Supplier-only edit remains allowed once because it does not affect stock. |
| O-19 | USER may see/edit transaction selling price; warning may show without buy price. |
| O-22 | If stock changes after SO starts, USER recounts before Admin approval. |
| O-23 | Initial Excel import is limited to sparepart master; Excel history/stock remain reference-only. |
| O-25 | Exact name comparison ignores letter case and leading/trailing spaces; similar-name warning/explicit Admin continuation stays in force. |
| O-27a | Service needs at least one job/service detail; spareparts remain optional. |
| O-27b | SLS needs at least one item. |
| O-28 | Every Expense line must be greater than Rp0 after rounding; round each line before summing. |
| O-29 | Repeated sparepart in one Service/SLS is rejected. |
| O-30 | Opening cost per unit must be greater than Rp0. |

## Technical implementation choices made in I2.1–I2.4

These are technical selections within already approved behavior; they do not change any locked business rule.

- **O-09 (partial):** Spareparts are removed from active lists by setting `deleted_at` and inactive status; master rows and generated codes are retained. Transaction detail tables still need restrictive foreign keys and code/name snapshots when those modules are implemented.
- **O-25:** Exact duplicate detection trims outer spaces and compares case-insensitively. Similar-name warning uses normalized Levenshtein similarity of at least `0.82` for names at least four characters long. Exact duplicates are always rejected; Admin may explicitly continue after a similar-name warning.
- **O-26:** Mutating API calls use `Idempotency-Key`; a permanent row keyed by actor, operation and request key stores a SHA-256 fingerprint of canonical request data and the JSON outcome in the same transaction. Repeating identical input returns that outcome; changed input conflicts.
- **O-02 (I2.2 costing):** Average Cost calculation uses integer arithmetic and half-up rounding at every calculation step, within PostgreSQL BIGINT bounds. This is an implementation choice for the locked whole-Rupiah/per-step-rounding behavior. It does not permit negative stock or recalculate historical HPP.
- **I2.3 Purchase Confirm:** Confirm order is serialized by locking the Purchase and affected spareparts in stable ID order. Receipt movements, stock projection, Average Cost, Latest Buy Price, Completed status, audit and idempotency outcome commit together. This keeps the existing Purchase/Draft/price rules unchanged.
- **O-17/A:** For any item edit or cancel, a negative stock movement for an affected sparepart after Purchase Confirm blocks the operation, even if later receipts make the current balance sufficient. Supplier-only edit has no stock effect and remains available once.
- **I2.4 Purchase edit/cancel:** Reconcile an accepted item edit by posting only the per-part quantity delta and actual Purchase value delta through Stock Service. Calculate resulting Average Cost from current stock valuation plus that Purchase value delta, divided by resulting stock, rounded half-up at the calculation step. Keep rounded inventory valuation change (`valuationDelta`) separate from actual source Purchase value (`purchaseValueDelta`). If quantity is unchanged, record a zero-quantity cost correction. Cancel reverses the sum of the Purchase's recorded inventory valuation effects and quantity while recording the reverse of its effective source Purchase value; this avoids hiding rounding differences or leaving valuation from the canceled Purchase behind. Keep all earlier movements and historical transaction HPP snapshots unchanged. Apply all affected part changes, Purchase status/items, Latest Buy Price, audit and idempotency atomically.
- **D-20 process gate:** The earlier planning-only gate was fulfilled and superseded by the user's explicit Phase 2 implementation authorization on 2026-09-30. It does not change any business decision.

## OPEN details (must preserve the locked choices above)

| O-ID / topic | What remains OPEN | Gate / affected work |
|---|---|---|
| O-01 deployment | LAN bind, firewall, address discovery and HTTPS details | Before deployment |
| O-02 calculation | Remaining numeric range/overflow handling in later calculations; I2.2 Average Cost now uses integer half-up rounding within BIGINT bounds | Before affected later numeric modules |
| O-04 Purchase edit | Technical Average Cost and ledger reconciliation for add/remove/change while old HPP stays unchanged | Before Purchase edit |
| O-07 time | Exact timestamp storage and report day-boundary handling | Before date-based reports |
| O-09 deletion | Restrictive FK and exact snapshot fields for future transaction detail tables referencing soft-deleted spareparts | Before those transaction detail schemas |
| O-10 audit trace | Location, protection and retention for separate technical deletion log | Before audit-delete feature |
| O-12 restore | Exact accepted PostgreSQL versions and preflight/restore procedure | Before external restore |
| O-13 Excel | File/row limits after sample review, supported master columns and preview details | Before Excel import |
| O-14 sessions | Session/CSRF/cookie mechanics, invalidation after disable/reset/restore, first Admin provisioning | Before authentication implementation |
| O-15 charts | Exact short/long period cutoffs and aggregation rounding | Before dashboard implementation |
| O-16 Service/SLS edit | Safe technical stock lock/recheck and delta movement procedure | Before completed edit implementation |
| O-19 user price | API response/projection design that permits transaction price but never exposes master prices, buy price or HPP | Before price endpoints |
| O-20 numbering | Number allocation timing and duplicate prevention under concurrent saves; preview remains non-persistent | Before numbering implementation |
| O-22 SO approval | Technical stock-change detection and mandatory recheck flow | Before approval implementation |
| O-23 Excel scope | Exact master fields/mapping and validation report detail; no historical transactions or stock import | Before Excel import |

Other locked rules remain D-01 through D-39 above, including no negative stock, Average Cost, immutable ledger, historical HPP, integer Rupiah, integer-pcs inventory, BIGINT IDs, cancellation terminality, and idempotency behavior. Do not reopen them.
## Risks already accepted or surfaced

- Same-server, unencrypted backup can be lost with host or exposed with host access; accepted V1 baseline, not silently changed.
- Admin can delete audit history; weakens tamper-evident record.
- No inactivity timeout; session invalidation/security behavior still needs design.
- Purchase cancellation is rejected after downstream use; technical lineage detection and Average Cost reconciliation must preserve immutable history and old HPP.
- LAN without supported HTTPS may expose credentials/session on local network; exact mitigation depends on host/network decision.
- A mutable stock projection can drift from immutable ledger unless transactionally updated and periodically reconciled.
- Restore may invalidate sessions or make app/database versions incompatible; external format support needs explicit validation.
- If SO stock changes after it begins, USER must recount before Admin approval; technical change detection remains to be designed.
- Similar-name detection remains technical OPEN under O-25; Excel size/row limits and supported master fields remain OPEN after the O-13/O-23 choices locked `.xlsx` and sparepart-master-only import.
- **Consistency review:** Planning is being synchronized to the user's 23 final choices in the attached instruction. Selected O-IDs are LOCKED; only listed implementation and technical details remain OPEN. No implementation has started.

## Change log

- 2026-09-27: Initial planning set drafted from `PRD_FINAL.md` and `MASTER_PROMPT_OpenCode_Bengkel.md`. No business OPEN item was closed by this document set.
- 2026-09-27: Synchronized locked cancellation and Latest Buy Price requirements with the corrected PRD; retained PRD OPEN decisions and marked implementation gates without selecting business outcomes.
- 2026-09-28: Aligned PRD and planning with locked decisions O-01 through O-08; retained only unresolved sub-details and unrelated OPEN decisions. No implementation started.
- 2026-09-28: Recorded selected O-21 costing chronology, O-24 positive-price/Latest Buy Price behavior, and O-26 retry handling. O-30 initially recorded manual opening stock with immediate effect and immutable movement; the Rp0 question was later closed by the final user choice recorded below.
- 2026-09-28: Recorded the user's final choices for O-01, O-02, O-04, O-04a, O-05, O-07, O-09, O-10, O-11, O-12, O-13, O-15, O-16, O-17, O-19, O-22, O-23, O-25, O-27a, O-27b, O-28, O-29 and O-30. Updated PRD and impacted planning documents; no application implementation started.
- 2026-09-30: Recorded I2.1–I2.3 technical implementation selections for sparepart soft deletion, similar-name detection, idempotency storage, integer Average Cost rounding, and Purchase confirmation locking. These preserve the locked behavior; the scheduled backup task remains pending operational verification.
