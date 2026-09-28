# API Planning — ProjectBengkel V1

Status: conceptual API contract; no endpoint implementation or final URL/DTO commitment. All requirements derive from `PRD_FINAL.md`. Prefer a single modular web/API backend; endpoint naming can be finalized during implementation planning.

## API principles

- Browser → API → application service/domain → repository/Prisma → PostgreSQL.
- Server authenticates, authorizes, validates and filters every request. UI visibility is not authorization.
- API uses explicit role-safe response DTOs; never serialize ORM entities wholesale. USER sensitive fields must not be fetched/returned where avoidable.
- State transitions are commands, not arbitrary status/stock CRUD. No endpoint sets on-hand stock directly.
- Stock side effects, source transaction status, cost snapshot, idempotency record and required audit are one atomic DB operation.
- Use stable business errors and generic user messages. Detailed errors go to protected server logs only.

## Module grouping (illustrative routes)

| Module | Example command/query grouping | Access |
|---|---|---|
| Auth | session/login, logout, password change; Admin reset user password | public login; session-required thereafter; Admin reset |
| Users | list/create/update/deactivate; reset credential | Admin; self change via Auth |
| Spareparts | list/current stock, detail; Admin create/edit/activate/deactivate/delete | permitted list for USER with safe projection; mutations Admin |
| Services | list/detail/preview/final-save; Admin edit/cancel completed | authenticated; create Admin/User; edit/cancel Admin only |
| SLS | list/detail/preview/final-save; Admin edit/cancel | authenticated; create Admin/User; edit/cancel Admin only |
| Purchases | Admin draft CRUD, confirm, completed edit once/cancel; permitted print | Admin commands; print role-filtered |
| Expenses | preview/create Completed, edit, cancel; separate query for canceled records | Admin only; canceled Expense omitted from ordinary history/reports |
| Stock Opname | create, revise/recheck, finalize, approve, reject, result query | create/revise authenticated; final/reject/approve Admin |
| Movements | Admin query/filter by part | Admin only |
| Dashboard | KPI, charts, monitoring, recent activity | Admin only |
| Reports | filtered data, print/PDF/Excel per report family | Admin only; transaction print is separate role-filtered path |
| Audit | query, delete audit row | Admin only; deletion also recorded in separate technical log unavailable to Audit menu deletion |
| Backup/restore | manual backup, schedule/status, restore/validate | Admin only; no backup download endpoint |
| Excel migration | upload/stage, preview, validate, resolve mapping, import, outcome | Admin only |

These groups are logical; route paths, response formats and pagination details are technical planning decisions.

Service/SLS preview is non-persistent: it creates no Completed transaction, Draft, or stock movement. Final save revalidates on the server and atomically creates the Completed transaction and associated movement(s).

## Authentication/session

- Local username/password login; password hashes never returned. Failed login is audited; successful login/logout is not.
- Authenticated session required on every protected route. Logout invalidates session. Disabled user must be rejected immediately; reset-password and restore invalidation behavior OPEN.
- Use secure cookie/session settings appropriate to host and LAN transport. No email reset, no inactivity timeout. HTTPS when available/supported.
- Bootstrap first Admin/provisioning and CSRF/session token details are technical OPEN decisions before implementation.

## Authorization matrix and sensitive data

Enforce role at route and use-case boundary. Default deny. USER has standard shared policy and may read permitted cross-user Service/SLS/Purchase history, see/edit transaction selling prices, but receives no master sell/buy prices, transaction buy prices, HPP/Average Cost, Inventory Value, movement history, audit rows, Dashboard or Reports. USER print endpoints must use dedicated projections. Exports and PDFs use identical authorization. Reject direct USER calls with safe forbidden response; do not leak whether sensitive records exist.

Admin-only operations include user/master management, Purchase Draft/management, Expense, SO finalize/approve/reject, movement/audit/report/dashboard, backup/restore and Excel migration. USER may create Service/SLS/SO and revise/recheck SO. Admin has a separate view for canceled Expense; ordinary history and reports exclude it.

## Validation and state transitions

- Validate on server: types, required fields, transaction datetime not future (stored by computer time standard and displayed/reported by workshop timezone), integer Rupiah values, Purchase/opening unit costs greater than Rp0, positive integer-pcs sparepart quantities, positive decimal Expense quantities, each Expense line after rounding greater than Rp0, line/transaction totals, discount constraints, foreign keys, allowed statuses, nonnegative resulting inventory, workflow permissions and part active/deleted policy. Round each calculation step before continuing.
- Service/SLS Completed edits are Admin-only and allowed at most once per transaction; require a reason and Before→After summary in the audit result. All creator-entered fields may be edited except transaction number and old stock note. Check current stock before accepting added usage. Purchase Completed edit is Admin-only and allowed at most once total, including supplier-only edits; reject it if a subsequent transaction/stock event depends on it. One edit may add/remove/change items, updates Average Cost, and keeps old HPP unchanged. Supplier is free text; supplier-only change needs no reason, while any other edit requires a reason and a Before→After summary. Reject Purchase cancellation if its stock was already used by another transaction.
- Recalculate HPP and related transaction values server-side after an accepted Service/SLS edit; never accept client-submitted recalculated totals or HPP as authoritative. Transaction date/time is one datetime under a configurable workshop timezone, and generated business numbers stay unchanged after date/time edits.
- Sparepart master validation rejects a duplicate name after ignoring case and leading/trailing spaces. Similar-name warning and explicit Admin continuation are required; similarity matching is technical OPEN. Service/SLS line selling price defaults from master but may be edited by USER; below latest buy price is allowed with a warning, and do not reveal buy price.
- Purchase Draft and confirm commands require at least one item; reject duplicate sparepart IDs within one Purchase.
- Inventory stock must never become negative. Service/SLS issue and stock-sensitive edits must be rejected when their effect would make stock negative. A negative SO difference is valid and is not itself negative inventory; if stock changed since SO began, require USER recount before Admin approval. Purchase does not cover an existing negative balance.
- Opening stock is an Admin-only stock operation: Admin supplies quantity and cost per unit greater than Rp0 per sparepart; the save applies immediately using input time, initializes Average Cost from that unit cost, and atomically creates an immutable movement. No second approval is required.
- Service requires at least one job/service detail and may have no spareparts; SLS requires at least one item. Reject a repeated sparepart within one Service/SLS. Transaction selling price defaults from master and can be seen/changed by USER; a below-Latest-Buy warning may be shown without revealing buy price.
- Expense validation enforces positive quantity, integer Rupiah unit price, rounds each line before summing, and requires each rounded line amount > Rp0.
- Dashboard marks `Stok Menipis` when current stock <= minimum stock; charts are more detailed for shorter ranges, more compact for longer ranges, and do not compare with another period. Exact period breakpoints and aggregation rounding are technical details.
- UI validation is usability only. Never accept client-supplied computed HPP, stock balance, source identity, role, actor, or final totals as trusted values; recalculate/revalidate server-side.
- Explicit transition commands: Purchase confirm/cancel/edit; Service/SLS complete/edit/cancel; SO revise/finalize/approve/reject; Expense create/edit/cancel. There is no reactivation command or status patch. Reject edits or transitions from CANCELED Service/SLS/Purchase/Expense; post-cancellation correction starts a new applicable workflow.
- Business numbers use `SRV-YYYYMMDD-0001`, `PUR-YYYYMMDD-0001`, `OPN-YYYYMMDD-0001`, `SLS-YYYYMMDD-0001`, and `EXP-YYYYMMDD-0001`; number remains stable when transaction date/time is edited.
- After SO Finalize, USER may revise/recheck physical stock until Admin Approve/Reject; only the latest recheck is official and no separate revision history is required. No edit/revise/cancel transition is allowed after approval.
- Apply the locked rule to round each calculation step before continuing. Any remaining discount allocation/formula details must not change locked rounding or field-scope decisions.

## Transaction boundaries and idempotency

Each mutation involving stock atomically persists header/items/status, ledger movements/reversals/corrections, applicable cost snapshots/current costing, idempotency outcome and audit event. Purchase Confirm atomically updates Latest Buy Price from received item prices as well as stock/cost; an allowed edit to the latest valid Purchase updates that price, and an allowed cancellation falls back to the prior still-valid Completed Purchase. A Purchase line changes only through its permitted explicit audited edit; later Purchases do not rewrite its item price. SO approval plus adjustment is atomic. Expense mutation and its audit are atomic, with no stock movement. Excel import is all-or-nothing after preview/validation; any import error rolls back entire batch.

Excel migration endpoints import sparepart master only. Historical Service/SLS/Purchase rows and stock figures are reference material only: they must not become active transactions or initialize stock automatically. Detailed supported master fields and file limits remain subject to sample review.

No USER response, warning, error, print or export may reveal the numeric Latest Buy Price or master buy/sell prices or HPP. USER may see and edit transaction selling price; a below-buy-price warning may be shown without the buy price.

All retryable mutations use an idempotency key unique to the actor and operation, including create/edit/cancel/confirm/approve/import/restore. Same key and same request data returns the original outcome; same key with different data is rejected as a conflict. Keep idempotency records permanently. Lock/serialize stock/cost rows and recheck invariants in transaction. Never implement stock movement as a later asynchronous side effect.

## Error handling

Return stable categories: unauthenticated, forbidden, validation failure, not found, state conflict/insufficient stock, idempotency conflict, and internal failure. Keep messages user-safe and localized where suitable; no SQL, stack traces, credentials, HPP or other protected values in USER errors. Log technical context server-side with secrets/passwords redacted. Do not expose internal errors in export filenames or validation reports.

## Print/export/report safety

Use a shared query/filter/calculation layer for dashboard and report consistency. Enforce Admin before loading restricted report data. USER print views use explicit allowlisted fields; never reuse Admin PDF/export payloads with UI hiding. Report date range and filter validation is server-side. Generated artifacts are streamed only to authorized session and must not become public predictable URLs. Backup is not downloadable.

## API-related OPEN decisions

URL/version convention; session/CSRF/cookie strategy; internal encoding of idempotency keys and results; pagination/limits; report export generation/temporary-file lifecycle; exact compatible PostgreSQL versions and restore validation; permission-safe bootstrap flow; request size and `.xlsx` staging limits after sample review; supported sparepart-master import columns; exact error code/localization contract; safe technical checks for stock changes during Service/SLS edits, Purchase downstream use, SO recount, and audit deletion trace. Resolve technical choices without altering locked PRD behavior. Excel import must only create sparepart master records.
