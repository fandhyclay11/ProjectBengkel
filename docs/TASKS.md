# Implementation Task Plan — ProjectBengkel V1

Planning only. No implementation has started. Tasks are small, sequenced, and gated by review. Acceptance criteria below are future implementation requirements; they are not claims of completion. Tests described here are required for implementation acceptance per PRD; they have not been run.

## Phase 0 — Planning and decisions

### P0.1 Review planning baseline
Dependencies: none.
Scope: review six planning documents against PRD_FINAL and this work-rules prompt.
Acceptance: source hierarchy correct; no old business rule reactivated; all OPEN items and risks visible; user approves planning before code.
Tests/checks: document consistency review.

### P0.2 Close implementation-blocking decisions
Dependencies: P0.1.
Scope: resolve decisions needed for first selected implementation module; preserve remaining decisions as gated tasks; reconcile PRD clauses that conflict with explicit user-locked discovery decisions before implementation.
Acceptance: each closed decision recorded with rationale/impact; no business choice inferred; canonical PRD and locked decisions are aligned; chosen stack/host/ID/numeric/date/session and relevant domain semantics reviewed before dependent implementation. Dependent implementation remains gated only by the unresolved OPEN decisions listed in `DECISIONS.md`.
Tests/checks: decision traceability and contradiction review.

## Phase 1 — Foundation

### F1.1 Verify repo and target runtime/stack
Dependencies: P0.1; remaining LAN deployment details.
Acceptance: production V1 target is native Windows with PostgreSQL and app running directly; Admin starts the app manually when needed and it does not auto-start; Docker is not required. Verify repository/runtime assumptions; bind/firewall, LAN addressing and HTTPS remain technical details to record before deployment.
Tests: environment/build smoke checks only when implementation task requests them.

### F1.2 Establish application skeleton and modular boundaries
Dependencies: F1.1.
Acceptance: one backend; Browser/API→service/domain→repository→PostgreSQL boundary; server rules not implemented in UI; no extra cloud/service dependency.
Tests: structural/unit checks appropriate to task.

### F1.3 Database setup and migration baseline
Dependencies: P0.2 decisions for IDs, numeric/date types; F1.1.
Acceptance: local PostgreSQL connection; versioned migration works from empty DB; FK/status/unique constraints match approved model; secrets not in source; migration concurrency controlled.
Tests: fresh database migration and persistence integration.

### F1.4 Authentication, sessions and authorization primitives
Dependencies: F1.2, F1.3; session/bootstrap decisions.
Acceptance: hashed password, secure local session, Admin/User roles only, disabled users rejected, reset forces change, generic errors, route/service permission checks and logout; no default secret.
Tests: auth integration/E2E; direct endpoint authorization matrix; disabled/reset session cases.

### F1.5 Audit and protected logging foundation
Dependencies: F1.3, F1.4.
Acceptance: required actor/time/action/object/before-after captured; passwords/secrets excluded; USER cannot query; Admin may delete Audit rows and the deletion is recorded in a separate technical log that the Audit menu cannot delete.
Tests: audit integration, access-denial coverage, and verification that the separate technical deletion trace is not removable through the Audit menu.

### F1.6 Backup foundation and first restore protocol
Dependencies: F1.3, F1.4, host/backup decisions.
Acceptance: Admin-only manual backup, scheduled weekly/30-day same-host retention; failure warning/audit; external PostgreSQL file is version-compatible and inspected before restore; pre-restore protection and failed restore returns DB to prior state; no download endpoint.
Tests: backup→restore→verification and forced failure rollback; do not claim verified without execution.

## Phase 2 — Inventory and purchasing

### I2.1 Sparepart master and safe historical identity
Dependencies: F1.3, F1.4, F1.5; sparepart deletion/snapshot and name-normalization decisions.
Acceptance: Admin CRUD/status; USER safe list/current stock; generated unique never-reused code; deleted parts leave active list while historical name/code remain; no USER master-price leakage; reject names equal after case-insensitive and trim comparison; similar-name warning allows explicit Admin continuation. Do not select a fuzzy similarity algorithm without technical review.
Tests: normalized duplicate rejection (case/leading/trailing spaces), similar-name warning/continue path, code non-reuse, FK/history preservation, API role/projection tests.

### I2.2 Stock domain and immutable ledger
Dependencies: I2.1, F1.3, F1.5; integer-pcs quantity; opening unit cost greater than Rp0. Apply the locked idempotency rule from PRD_FINAL.
Acceptance: one Stock Service entry for all stock effects; on-hand stock never becomes negative; no direct on-hand write endpoint; append-only movement; atomic stock + source operation; Admin manually enters opening quantity and cost per unit greater than Rp0 for each sparepart; saving applies stock immediately at input time, initializes Average Cost from the unit cost, and records an immutable movement without second approval (never automatic from Excel); Admin movement query only. A signed negative Stock Opname difference remains valid; if stock changes since SO began, USER recounts before Admin approval. Historical HPP remains unchanged by later costing recalculation.
Tests: nonnegative stock invariants, opening unit cost <=Rp0 rejected, signed negative SO difference, concurrent mutation, rollback, idempotent replay, reconciliation.

### I2.3 Purchase Draft and confirmation
Dependencies: I2.2; approved money/HPP rounding.
Acceptance: Admin-only draft; supplier is free text and no supplier master is used. Draft must contain at least one item and has no stock/cost effect; the same sparepart cannot appear more than once in one Purchase; buy price must be integer Rupiah greater than Rp0; confirm must contain at least one item and atomically receives actual item quantities/prices without allowing resulting inventory below zero, rounds each calculation step before continuing, and updates Latest Buy Price from the successfully received Purchase prices. Latest Buy Price is distinct from Average Cost/HPP; later Purchases do not rewrite prior Purchase item lines. Retry creates no duplicate movements; historical HPP is not silently changed.
Tests: empty Draft/confirm rejected, duplicate part rejected, zero/negative buy price rejected, weighted-average rounding fixtures, stock remains nonnegative, concurrent confirms, same-request retry returns original result, changed-data key reuse is rejected, rollback, role tests.

### I2.4 Purchase completed edit/cancel
Dependencies: I2.3; technical costing/reconciliation design must preserve the locked result; no unresolved business choice blocks the selected edit/cancel rules.
Acceptance: Admin may edit a Completed Purchase at most once; reject edit if a subsequent transaction/stock event depends on it; supplier-only change needs no reason; any other change requires a reason and Before→After summary. One edit may add/remove/change items, updates Average Cost and preserves old transaction HPP. A Purchase line change is explicit and audited; later Purchases do not rewrite earlier item prices. Supplier is free text. Prior movement remains immutable; correction/reversal movements reconcile. Reject cancellation if Purchase stock was used by another transaction; otherwise cancellation produces terminal CANCELED. CANCELED cannot be edited/reactivated and correction uses a new applicable workflow. If an allowed edit changes the latest valid Purchase, update Latest Buy Price; if an allowed cancellation cancels it, use the previous still-valid Completed Purchase price. Latest Buy Price follows Confirm/commit order and remains distinct from Average Cost/HPP.
Tests: supplier-only edit without reason, other edit requires reason, Before→After summary, second edit rejected, edit denied after dependent stock event, add/remove/change items once, cancellation rejected after downstream use, reversal/reconciliation, old HPP unchanged.

### I2.5 Stock card / Admin movement view
Dependencies: I2.2, I2.3.
Acceptance: per-part movement filter, useful time/type/quantity fields; USER denied including direct API.
Tests: movement totals reconcile to current stock; permission tests.

## Phase 3 — Operations and expenses

### O3.1 Service create and stock issue
Dependencies: I2.2, I2.1; no unresolved O-19/O-27a/O-29 business gate. Apply the locked USER price and detail rules.
Acceptance: Admin/User preview then final-save; preview creates no Completed transaction or movement and introduces no Draft; final save is server-validated and atomic; Service requires one job/service detail but may have no spareparts; reject repeated sparepart lines; multi-part stock deduction; insufficient stock blocks; round each calculation step; stable `SRV-YYYYMMDD-0001` after datetime edits; line selling price defaults from master and Admin/User may edit; below Latest Buy Price warns and remains allowed without revealing buy price. Completed Service is editable by Admin once only, with reason, Before→After and audit; edit excludes transaction number and old stock note and checks current stock.
Tests: preview no-persistence/no-movement, Service without spareparts, empty jobs rejected, repeated part rejected, edit-count once, insufficient/concurrent stock, step-rounding/snapshot, USER price and warning access without buy-price leakage, retry/idempotency, role/DTO tests.

### O3.2 SLS create and stock issue
Dependencies: I2.2, I2.1; discount/price formula details; selected item/duplicate/USER-price rules are locked.
Acceptance: Admin/User preview then final-save; preview creates no Completed transaction or movement and introduces no Draft; final save is server-validated and atomic; SLS requires at least one item and rejects repeated sparepart lines; stock checked/issued without negative inventory; round each calculation step; stable `SLS-YYYYMMDD-0001` after datetime edits; line selling price defaults from master and Admin/User may edit; below Latest Buy Price warns and remains allowed without revealing buy price. Completed SLS is editable by Admin once only with reason, Before→After and audit; edit excludes transaction number and old stock note and checks current stock.
Tests: preview no-persistence/no-movement, empty SLS rejected, repeated part rejected, edit-count once, stock/cost/discount, USER price and warning access without buy-price leakage, concurrent requests, retry, API projection tests.

### O3.3 Admin edit/cancel Service and SLS
Dependencies: O3.1, O3.2, F1.5; field scope and current-stock rule are locked.
Acceptance: USER blocked; Admin may edit each Completed Service/SLS once only; reason, Before→After summary and audit are required; a second edit is rejected. Any creator-entered field except transaction number and old stock note may change. Recalculate HPP and related transaction values for valid edits. Check current stock; accept added usage only when enough remains. Stock delta uses new movement and cannot result in negative inventory; cancellation produces terminal CANCELED that cannot be edited/reactivated, retains source and old movement, and correction uses a new applicable workflow; stored HPP used for reversal.
Tests: reason required, Before→After present, first edit accepted/second rejected, insufficient-stock edit rejected without negative balance, canceled exclusion, repeated cancel/edit invalid states, ledger and audit reconciliation.

### O3.4 Expense lifecycle
Dependencies: F1.3, F1.4, F1.5; apply locked per-line Expense amount/rounding rule and Admin canceled view.
Acceptance: Admin preview then Completed; quantity remains positive and may be decimal; unit price and money use integer Rupiah; round each line before summing and reject any rounded line amount <= Rp0. Expense number `EXP-YYYYMMDD-0001` remains unchanged after datetime edit. Edit audited Before→After; cancellation omitted from history/business reports and P&L but available to Admin in a separate “Dibatalkan” view; no stock effects.
Tests: decimal quantity/integer money boundaries, per-line rounding and <=Rp0 rejection, edit/cancel, stable number after date edit, permission and separate Admin canceled view/report exclusion.

## Phase 4 — Stock Opname

### S4.1 SO creation, captured stock and revision
Dependencies: I2.2, I2.1, F1.5; transaction datetime/timezone decisions (DECISIONS O-07).
Acceptance: create captures system stock; User can create and recheck; after Finalize User can continue revising/rechecking until Admin Approve/Reject; latest revision is official and no separate revision-history records are required; reject returns to revision. Number `OPN-YYYYMMDD-0001` remains stable after datetime edits.
Tests: snapshot consistency under concurrent movements, revision states, denied roles.

### S4.2 SO finalize, approve and adjustment
Dependencies: S4.1, I2.2; implement the locked recount-before-approval behavior when stock has changed since SO began.
Acceptance: Admin-only transitions; no effect before approval; detect stock changes since SO began and require USER to recount before Admin can approve; approval atomically applies the latest rechecked physical count at Average Cost, resulting stock equals approved physical count and is nonnegative; approved immutable; post-approval error via new SO; actor/movements audited.
Tests: positive/negative/zero difference, concurrency, approval idempotency, rollback, post-approval immutability.

## Phase 5 — Excel migration

### M5.1 Excel staging, preview and validation
Dependencies: I2.1; sample review for file/row limit and supported master columns.
Acceptance: Admin uploads `.xlsx` for sparepart master only; formula values ignored; auto-map names after case/edge-space normalization; similar/new/ambiguous mapping presented for explicit action; Excel stock and historical Service/SLS/Purchase rows are reference-only; no automatic opening stock and no conversion of historical transactions into active application records.
Tests: malformed/oversize/ambiguous files, formula values, safe staging, permission.

### M5.2 Atomic import and verification report
Dependencies: M5.1; import scope is locked to sparepart master, while limits and exact supported columns depend on sample-file review.
Acceptance: Preview→Validation→Import for sparepart master only; any error rolls back the entire import batch; detailed success/error/warning outcome; regenerated part codes. Historical Excel Service/SLS/Purchase transactions remain reference-only and are never created as active application transactions; Excel stock remains reference-only and never creates opening stock. Where source historical counts/totals are available, verify them as reference reconciliation only.
Tests: full rollback after mid-import failure, duplicate/retry, validation of permitted sparepart master data, reference-only comparison of source historical counts/totals, and confirmation that no active historical transactions or opening stock are created.

## Phase 6 — Reports and Dashboard

### R6.1 Shared financial/report query rules
Dependencies: O3.1–O3.4, I2.3, S4.2; implement report display/grouping using workshop timezone and round each calculation step. Costing order follows Confirm/commit time; report filters use transaction business date.
Acceptance: common date/filter/financial definitions; correct canceled exclusion; reports expose required columns to Admin only.
Tests: fixture-level formula reconciliation across Reports and Dashboard, date boundaries, canceled rows.

### R6.2 Admin reports, print/PDF/Excel
Dependencies: R6.1 and relevant modules complete.
Acceptance: all PRD V1 report families/filters/minimum fields; headers include shop identity, period and creation time; USER direct requests denied; transaction print role-safe.
Tests: role/data leakage checks across UI/API/PDF/Excel; totals match source query.

### R6.3 Admin dashboard
Dependencies: R6.1, R6.2 query definitions; chart ranges must be detailed when short and compact when long, with no comparison period.
Acceptance: exact KPI/chart/monitoring scope from PRD; classify `Stok Menipis` when current stock <= minimum stock; date presets/custom ranges; update after commit; KPI navigation; no excluded KPI/chart.
Tests: dashboard/report reconciliation, low-stock boundary (equal and below minimum), date/period aggregation, role tests.

## Phase 7 — LAN deployment, hardening and handover

### D7.1 Host deployment package and LAN access
Dependencies: F1.1, F1.3–F1.6; LAN bind/firewall, LAN addressing and HTTPS technical details.
Acceptance: production V1 app and PostgreSQL run natively on Windows; Admin starts the app manually when needed; Docker is not required. Private LAN clients use same database through host; DB port not exposed; internet unavailable does not block workflows; document selected firewall/address/TLS behavior.
Tests: second-device LAN workflow, host restart, internet-disconnected workflows.

### D7.2 Security, backup/restore and migration hardening
Dependencies: all modules, D7.1.
Acceptance: reviewed permission matrix; secrets/log redaction; backup schedule/retention; restore external compatibility as approved; recovery and migration handover documented.
Tests: security regression, backup→restore→verification, restore failure recovery.

### D7.3 Full acceptance and handover
Dependencies: all previous phases.
Acceptance: all PRD V1 acceptance criteria met; unit/integration/E2E, ledger/finance regression, LAN and restore checks pass; setup/use/backup/troubleshooting documentation delivered.
Tests: acceptance suite and recorded results. This is future work, not performed in planning.

## Critical dependency graph

```text
Planning decisions → stack/DB/auth/audit/backup foundation
DB + Auth → Sparepart master → Stock Service/ledger → Purchase → Service/SLS
Stock Service + Audit → Stock Opname
Service/SLS/Purchase/Expense/SO → shared finance/report query → Reports → Dashboard
Core modules → Excel import (per selected import scope)
All modules + host decisions → LAN deployment/security/restore → handover
```

## Cross-cutting acceptance requirements

- Unit tests for calculations, validation and state rules; integration tests for database transactions, costing, ledger and approval; E2E for primary flows.
- Regression for inventory/finance; direct API authorization and sensitive-field checks; concurrency, idempotency, rollback and audit checks.
- LAN test from second device and backup→restore→verification before V1 acceptance.
- No tests have been run as part of this planning task.
