# Implementation Task Plan — ProjectBengkel V1

Planning baseline is approved. Phase 1 implementation began on 2026-09-29 and Phase 2 implementation was explicitly authorized on 2026-09-30. F1.6's scheduled backup execution remains pending operational verification; Phase 2 work may proceed only where its listed dependencies do not require that execution. No later phase has started.

### Current Phase 1 progress (2026-09-30)

- F1.1 **Verified:** Native Windows, Node.js 24.19, PostgreSQL 18 service, local connection, and PostgreSQL 18 client utilities are available. LAN address/firewall/HTTPS details remain deployment work.
- F1.2 **Implemented and checked:** Next.js application skeleton, API routes, server-side services, Prisma/PostgreSQL boundary and manual startup are present. Typecheck, lint, production build and unauthenticated API smoke checks pass.
- F1.3 **Implemented and verified:** Foundation migration `202609290001_foundation` is applied to the local `projectbengkel` database. Prisma validation and migration status pass; schema is up to date. Database persistence and FK-backed account/session/audit operations are exercised by integration tests.
- F1.4 **PASS:** First Admin bootstrap and login succeeded. HTTP checks passed for Admin and USER access, server-side authorization, CSRF rejection/acceptance, generic invalid-login response, password reset/change and session revocation, and deactivated-user rejection. Sensitive password hashes were absent from API responses.
- F1.5 **PASS:** Admin audit access and sensitive-action entries were verified over HTTP; USER audit access was denied. Audit deletion produced a separate technical trace, and USER could not bypass permission checks through direct API calls. Temporary test accounts were removed.
- F1.6 **NOT PASS — pending operational verification:** Manual PostgreSQL backup was created and inspected. Restore into isolated test databases passed; a forced restore failure restored the test target to its prior state. The test confirmed the application role has no `CREATEDB`; the main database was not used as a restore target. Admin PowerShell reported successful registration of the weekly task, with next run 2026-10-04 02:00. `LastTaskResult` is `267011` (`0x41303`), meaning the task has not run yet. Verify its first scheduled backup run before marking F1.6 complete. Excel-managed file backup depends on Phase 5, when those files first become application-managed; it does not block this database-only foundation check, but remains required before V1 backup coverage is complete.

### Current blockers and risks

- Windows weekly Scheduled Task is registered but **pending operational verification**. Its next run is 2026-10-04 02:00; no execution result is available yet. Verify that run creates a valid backup and reports success.
- Excel-managed file backup is a Phase 5 dependency because the foundation currently has no application-managed Excel files. Include it before declaring whole-system backup complete; do not add Excel import/storage in Phase 1.
- `npm audit` reports four High findings through Prisma 7.10.0 (`deepmerge-ts` and `mysql2`); the available automatic fix downgrades Prisma to 6.19.3 as a major change. No downgrade or override was applied. Review remediation before release.

### Current Phase 2 progress (2026-09-30)

- I2.1 **Implemented; checks PASS:** Admin sparepart management and USER safe list/detail are available. Codes come from a non-cycling sequence; normalized exact names are rejected; similar names warn and require explicit Admin continuation; changes are audited and retry keys are stored atomically. Removal from the active list retains the master row, name and code. Database tests verify role-safe projections, duplicate/similar-name behavior, code non-reuse, audit, and idempotent replay. Transaction-detail FK/snapshot tests remain deferred until those tables are introduced in their dependent modules.
- I2.2 **Implemented; checks PASS:** Stock Service is the only implemented path for changing stock and writes the immutable movement, stock projection, Average Cost and idempotency/audit record atomically. Admin manual opening stock applies immediately at input time. Nonnegative balance, incoming weighted-average calculation, outgoing cost snapshot and rollback tests pass. Stock Opname adjustment paths will use this service when that phase is implemented.
- I2.3 **Implemented; checks PASS:** Admin Purchase Draft create/edit/delete and Confirm are available. Draft requires an item and has no stock/cost effect; duplicate spareparts are rejected. Confirm locks affected parts and atomically writes receipt movements, stock/Average Cost, Latest Buy Price, completed status, audit and idempotency result. Latest Buy Price and Purchase item snapshots are preserved separately. Integration tests verify rollback and retry without duplicate movements.
- I2.5 **Implemented; core checks PASS:** Admin-only Stock Card page and filtered Admin API expose movement time, type, quantity, source and part identity. The movement query reconciles with the stock projection in database integration tests; unauthenticated direct API access returned HTTP 401. USER-specific HTTP denial and successful Admin HTTP query remain to be added to the automated integration suite.
- I2.4 **Implemented; checks PASS:** Admin can edit a Completed Purchase once or cancel it; server-side O-17/A gate rejects item edits/cancel after any affected post-Confirm stock decrease, while supplier-only edit remains allowed once. Corrections use immutable quantity/value movements, keep source Purchase value separate from rounded inventory valuation, and preserve old HPP. Integration coverage includes quantity/price edits, cost-only zero-quantity correction, cancel restoring inventory valuation, Latest Buy Price update/fallback, one-edit limit, idempotency, and the stock-use gate. This task does not depend on the scheduled backup run.

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
Dependencies: F1.3, F1.4, host/backup decisions. Excel-managed file coverage depends on M5.1 creating application-managed Excel files; include that coverage before V1 backup acceptance, without blocking the database-only foundation while no such files exist.
Acceptance: Admin-only manual backup, scheduled weekly/30-day same-host retention; failure warning/audit; external PostgreSQL file is version-compatible and inspected before restore; pre-restore protection and failed restore returns DB to prior state; no download endpoint.
Tests: backup→restore→verification and forced failure rollback; do not claim verified without execution.

## Phase 2 — Inventory and purchasing

### I2.1 Sparepart master and safe historical identity
Dependencies: F1.3, F1.4, F1.5. No dependency on the pending Scheduled Task execution. Use the implemented soft-delete strategy to retain master identity; transaction detail snapshots/FKs are added with those transaction modules.
Acceptance: Admin CRUD/status; USER safe list/current stock; generated unique never-reused code; deleted parts leave active list while historical name/code remain; no USER master-price leakage; reject names equal after case-insensitive and trim comparison; similar-name warning allows explicit Admin continuation.
Implementation detail selected for this task: normalize case and trim outer spaces, then warn when Levenshtein similarity is at least 0.82 for names at least four characters long. This changes only the technical method used to identify a warning candidate; exact duplicates remain rejected.
Tests: normalized duplicate rejection (case/leading/trailing spaces), similar-name warning/continue path, code non-reuse after removal, retained master identity, API role/projection tests. Transaction-detail FK/snapshot verification is gated on those detail tables being introduced.

### I2.2 Stock domain and immutable ledger
Dependencies: I2.1, F1.3, F1.5; integer-pcs quantity; opening unit cost greater than Rp0. Apply the locked idempotency rule from PRD_FINAL.
Acceptance: one Stock Service entry for all stock effects; on-hand stock never becomes negative; no direct on-hand write endpoint; append-only movement; atomic stock + source operation; Admin manually enters opening quantity and cost per unit greater than Rp0 for each sparepart; saving applies stock immediately at input time, initializes Average Cost from the unit cost, and records an immutable movement without second approval (never automatic from Excel); Admin movement query only. A signed negative Stock Opname difference remains valid; if stock changes since SO began, USER recounts before Admin approval. Historical HPP remains unchanged by later costing recalculation.
Tests: nonnegative stock invariants, opening unit cost <=Rp0 rejected, signed negative SO difference, concurrent mutation, rollback, idempotent replay, reconciliation.
Implementation status: **Implemented.** Database migration `202609300002_stock_ledger` is applied. Weighted Average Cost uses integer arithmetic with half-up rounding at each calculation step; no negative-stock workflow is introduced. Automated integration coverage passes for opening, receipt, issue, immutability, nonnegative stock and projection/ledger consistency. SO and Service/SLS movement callers remain in their later dependent tasks.

### I2.3 Purchase Draft and confirmation
Dependencies: I2.2; approved money/HPP rounding.
Acceptance: Admin-only draft; supplier is free text and no supplier master is used. Draft must contain at least one item and has no stock/cost effect; the same sparepart cannot appear more than once in one Purchase; buy price must be integer Rupiah greater than Rp0; confirm must contain at least one item and atomically receives actual item quantities/prices without allowing resulting inventory below zero, rounds each calculation step before continuing, and updates Latest Buy Price from the successfully received Purchase prices. Latest Buy Price is distinct from Average Cost/HPP; later Purchases do not rewrite prior Purchase item lines. Retry creates no duplicate movements; historical HPP is not silently changed.
Tests: empty Draft/confirm rejected, duplicate part rejected, zero/negative buy price rejected, weighted-average rounding fixtures, stock remains nonnegative, concurrent confirms, same-request retry returns original result, changed-data key reuse is rejected, rollback, role tests.
Implementation status: **Implemented.** Migration `202609300003_purchase` is applied. Integration coverage verifies Draft has no stock/cost effect, Draft numbering follows workshop date and remains stable after date edits, empty Draft is rejected, Confirm applies purchase receipt/Average Cost/Latest Buy Price atomically, and replay creates no duplicate movement. Completed edit/cancel are intentionally separate I2.4 work.

### I2.4 Purchase completed edit/cancel
Dependencies: I2.3; O-17/A is locked. Use Stock Service quantity/value delta movements and preserve all locked costing/HPP behavior.
Acceptance: Admin may edit a Completed Purchase once total. Item edit or cancellation is rejected if any stock decrease for an affected part occurred after Confirm, even if stock was later replenished. A supplier-only edit has no stock effect and remains available once even after stock use. Supplier-only change needs no reason; any other edit requires a reason; every edit requires a Before→After summary. One edit may add/remove/change items, updates current Average Cost, and preserves historical transaction HPP. Prior movements stay immutable; changes are recorded as new correction/reversal movements. Canceled Purchase is terminal. If an allowed edit changes Latest Buy Price, recompute it from the latest valid Completed Purchase; cancellation falls back to the prior valid Purchase. Latest Buy Price remains distinct from Average Cost/HPP.
Tests: supplier-only edit without reason; other edit requires reason; Before→After audit; second edit rejected; item edit/cancel denied after post-Confirm stock decrease including later replenishment; supplier-only edit remains allowed after such use; add/remove/change item deltas; cancel reversal; zero-quantity value correction; stock cannot go negative; old HPP unchanged; Latest Buy Price refresh and fallback; rollback/idempotent retry.
Implementation status: **Implemented.** Migrations `202609300004_purchase_edit_valuation` and `202609300005_purchase_source_value` are applied. Focused integration coverage verifies edit/cancel costing and movement behavior. Both routes enforce Admin authorization and CSRF server-side via `requireAdmin`; production build confirms the routes are registered.

### I2.5 Stock card / Admin movement view
Dependencies: I2.2, I2.3.
Acceptance: per-part movement filter, useful time/type/quantity fields; USER denied including direct API.
Tests: movement totals reconcile to current stock; permission tests.
Implementation status: **Implemented.** Admin page `/stock-card` and Admin-only `GET /api/admin/stock/movements` are present. The page filters by sparepart and shows time/type/quantity/source. Automated direct-HTTP permission and reconciliation tests remain outstanding.

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
