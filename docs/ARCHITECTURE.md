# Architecture Planning — ProjectBengkel V1

Status: Draft for review. Requirement source: `PRD_FINAL.md`. This document describes design boundaries; it does not authorize implementation or resolve business OPEN decisions.

## Goals and boundaries

- Local-First: application and PostgreSQL run on a designated host; core workflows work without internet.
- LAN-Ready: browser clients on the private LAN use the host application and the same database. Clients never connect directly to PostgreSQL.
- Production V1 runs natively on Windows with PostgreSQL and the application; Admin starts the application manually when needed, and it does not auto-start. Docker is not required. Network bind, firewall, LAN addressing and HTTPS still need technical planning. One modular backend. Candidate stack remains Next.js/React/TypeScript, PostgreSQL, Prisma, Zod and session-based local auth, subject to repository/host verification and review. No second backend, microservices, queue or cloud dependency is planned.
- Out of scope: internet/remote access, multi-device offline synchronization, native mobile apps, payment gateway and other PRD exclusions.

## Request and domain flow

`Browser → Web/API → Service Layer → Repository/Prisma → PostgreSQL`

1. Browser performs UX validation and submits a request; this is never the authority for business rules.
2. API authenticates the session, authorizes the role/action, validates the complete input and returns only permitted fields.
3. Application service runs the use case and domain invariants. Transaction, status, idempotency and permission decisions live server-side.
4. Repository/ORM persists domain records. Only the Stock Service/use cases that invoke it may create stock movements; there is no direct balance-writing path from UI/API or unrelated modules.
5. PostgreSQL is the persistent source of truth. Stock on hand is derived from the ledger (a cached projection is possible only if transactionally maintained and reconciled; decision required before using one).

## Logical modules

- Web/API and response projection (role-safe DTOs)
- Authentication/session and authorization policy
- Sparepart master
- Service and SLS operations
- Purchase and costing
- Stock Service and immutable movement ledger
- Stock Opname workflow and adjustment
- Expense
- Dashboard and reports/exports/print
- Audit Log
- Excel migration staging/import
- Backup/restore and operational health/logging

The canceled Expense view is an Admin-only filtered view; canceled items stay out of ordinary history and reports. Initial Excel import creates sparepart master data only.

Keep business calculations in domain/services, not route handlers or UI. Reuse the same calculation/query definitions for dashboard and reports.

## Authentication and authorization

- Local username/password; hash passwords. Use secure session handling and environment-based secrets. Exact session mechanism remains an implementation choice.
- Every API and server route authenticates and authorizes independently. ADMIN/USER policy is enforced in services as well as route boundaries where appropriate.
- USER standard permissions are uniform. Server response projections must omit sensitive buy/sell master prices, HPP/Average Cost, Inventory Value, movement history, audit, dashboard and reports. This applies to list/detail/print/export and errors; UI hiding is not security.
- USER can access permitted transaction history across users. A USER purchase print view must omit buy price.
- Disabled accounts are denied immediately, including already-established sessions. Password reset and restore invalidation behavior needs a technical decision.
- Generic user-facing errors; diagnostic detail only in server logs. Do not expose database errors, secrets, stack traces or backup files.

## Transaction integrity, concurrency and idempotency

- One database transaction includes a business state transition, its movements, costing snapshots/projections and required audit record where feasible. Any failure rolls back the complete operation.
- For stock-sensitive operations, serialize/lock the affected stock/cost state or use an equivalent concurrency-safe conditional update. Recheck availability inside the transaction; never trust a prior UI read.
- Inventory stock must not become negative. Service/SLS reject insufficient stock; stock-sensitive edits check current stock and accept added usage only if enough remains. Purchase receipts add received quantity and do not use a negative-balance covering workflow; cancellation is rejected if its stock was used by another transaction. A negative SO difference is valid and distinct from negative inventory; if stock changed since SO began, USER must recount before Admin approval.
- Service/SLS provide preview-before-save. Preview is non-persistent and creates neither a Completed transaction nor a stock movement; final save remains server-validated and atomic. This does not introduce Draft status.
- Sparepart master rejects names equal after case-insensitive comparison and trimming leading/trailing spaces. A similar-name warning lets Admin explicitly continue; the similarity algorithm remains technical OPEN. On Service/SLS lines, selling price defaults from master and USER may see/edit the transaction price; below latest buy price is allowed with a warning, not rejected, and the buy price is not shown.
- Purchase Draft and confirmation each require at least one item; the same sparepart may occur only once per Purchase.
- Admin edits to Completed Service/SLS are allowed once per transaction and require a reason, Before→After summary, and audit; all creator-entered fields may be edited except transaction number and old stock note. Recalculate HPP and related values. Completed Purchase may be edited once total, including supplier-only edits; one edit may add/remove/change items, update Average Cost and keep old HPP unchanged. Reject the edit if a subsequent transaction/stock event depends on it. Supplier-only change needs no reason, while any other edit requires a reason and Before→After summary. Supplier is free text. Reject cancellation if purchase stock was used by another transaction.
- Internal IDs use BIGINT auto-increment; sparepart inventory quantities use integer pcs; monetary values are integer Rupiah. Round each calculation step before using its result in the next. Business document numbers use the locked SRV/PUR/OPN/SLS/EXP formats and remain unchanged when transaction date/time is edited.
- Save transaction time using the computer's time standard; display and report using the configurable workshop timezone. Transaction date/time is one datetime value; CreatedAt/UpdatedAt remain conceptually distinct. Cost/stock ledger ordering follows Confirm/commit time; transaction business date is used for reports. Exact timestamp storage and day boundaries remain technical details.
- A canceled Service/SLS/Purchase is terminal: it cannot be edited or reactivated. Corrections after cancellation use the applicable new workflow. Cancellation retains the original immutable movement and appends a reversal; Expense CANCELED is also not reactivated.
- Latest Buy Price is the last purchase price successfully received through Purchase and updates atomically on Confirm to Completed. Purchase item buy price must be a whole-Rupiah amount greater than zero. If an allowed edit changes the latest valid Purchase, update Latest Buy Price; if an allowed cancellation cancels the latest Purchase, fall back to the previous still-valid Completed Purchase. Later Purchases do not rewrite earlier item prices; an allowed one-time edit is explicit and audited. Latest Buy Price is separate from Average Cost/HPP.
- Dashboard classifies a part as `Stok Menipis` when current stock <= minimum stock. Shorter ranges are more detailed; longer ranges more compact; there is no comparison period. Exact range cutoffs and aggregation rounding are technical details.
- Admin enters opening quantity and cost per unit greater than Rp0 for each sparepart manually. On save, stock applies immediately at that time, Average Cost starts from the entered unit cost, and Stock Service writes an immutable movement atomically; no second approval is required. Excel stock remains reference-only and must never initialize opening stock automatically.
- Every retryable mutation uses a key unique to the actor and operation. Repeating the same key with the same data returns the original result; reusing it with different data is rejected as a conflict. Keep idempotency records permanently; requests never create duplicate movements.
- Movement rows are append-only through business flows. Edit/cancel creates delta/reversal rows; never rewrite prior movement. Cross-row invariant checks should verify business status, source reference and movement uniqueness.
- Admin edits to Completed Service/SLS are limited to one per transaction; Purchase edit is also limited to one and denied after a dependent later stock event. These operations require the applicable audit and immutable delta movements. Service/SLS minimum detail and duplicate-part behavior and Purchase item add/remove/change behavior are locked. Remaining costing mechanics must preserve old HPP.

## Stock and costing boundary

All stock-changing commands call Stock Service inside their enclosing database transaction. The service validates status and idempotency, appends movements, updates any approved balance projection, and returns a consistent result. No generic CRUD endpoint exposes on-hand quantity writes. Movement history is Admin-only; stock-on-hand visibility remains allowed to USER.

Service/SLS snapshot Average Cost at transaction commit; Purchase receipt recalculates weighted average; SO adjustment snapshots Average Cost at approval. Round each calculation step before continuing. Cost/stock ledger ordering follows Confirm/commit time, while reports use transaction business date. Historical transaction HPP is immutable under later cost recalculations. No negative inventory or negative-stock costing workflow is allowed. A negative SO difference is valid; if stock changed since SO began, USER recounts before approval. Purchase edit recalculation must update Average Cost without changing old transaction HPP.

## Auditability

Record actor, timestamp, action, object, and Before→After for relevant changes, plus failed login, denied access, SO workflow, master/price changes, backup/restore outcomes. Normal successful login/logout are excluded. Audit rows cannot be edited; Admin deletion is permitted by PRD and is recorded in a separate technical log that cannot be deleted through the Audit menu.

## Backup and restore

- Admin only; manual and weekly scheduled backups, timestamped, PostgreSQL and Excel formats, same host, 30-day retention, no mandatory encryption, no download button.
- Failed backup raises Admin-visible warning and is audited.
- Restore requires strong confirmation, pre-restore protection, validation, all-or-nothing rollback to pre-restore state on failure, audit record and Admin login again. External PostgreSQL files must be from a compatible version and inspected before restore; exact versions/check procedure remain technical details.
- Scheduler/runtime behavior and atomic restore implementation are technical details. Operations run locally without internet.

## Deployment and operations

Windows host runs the web process and PostgreSQL natively. Admin starts the app manually when needed; it does not auto-start. Bind application to the selected LAN interface/private network; do not expose database port to clients. Bind/firewall configuration, TLS/HTTPS support on LAN, address discovery, restart behavior and backup location must be planned before deployment implementation. Docker is not required for production V1.

No client access if host is unavailable. Document host setup, credentials/secrets, migrations, LAN access, backup/restore, restart and troubleshooting. Local app operation must not require external auth, telemetry or internet services.

## Technical risks and gates

- Purchase cancellation is refused after downstream use; technical lineage checks and Average Cost reconciliation must preserve old HPP and immutable movements.
- If stock changes after SO begins, USER must recount before Admin approval; implement a reliable change check and recount gate.
- Backup on the same unencrypted host is an accepted V1 risk; document its recovery limits.
- Admin deletion of audit records weakens tamper evidence.
- LAN HTTP/TLS, session invalidation, and host/firewall differences affect security and deployment.

Before coding: review this design, resolve technical details that gate the first selected implementation tasks, and approve task breakdown. Preserve every locked business decision in `PRD_FINAL.md`; technical OPEN details do not authorize a different business result. Follow the task-specific gates in `TASKS.md` before implementing affected inventory, Purchase edit/cancel, Service/SLS edit, SO approval, or Excel import paths.
