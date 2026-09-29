# Database Planning — ProjectBengkel V1

Status: Planning baseline updated to record implementation. Prisma models/migrations for SparePart, idempotency, StockMovement and Purchase are applied locally through `202609300003_purchase`; Service, SLS, Expense and Stock Opname remain conceptual until their tasks. `PRD_FINAL.md` remains the sole requirement source.

## Modeling principles

- PostgreSQL on host is the persistent source of truth. Use versioned, forward migrations and relational constraints. Never use floating point for money.
- Primary keys use BIGINT auto-increment. Business codes and human-readable transaction numbers are distinct from internal IDs.
- Monetary values use integer Rupiah without floating point. Sparepart inventory quantities use integer pcs. Round each calculation step before using its result in the next step; Average Cost/HPP and transaction HPP remain whole Rupiah.
- Transaction date/time is one datetime value; save using the computer's time standard and display/report using the workshop timezone. CreatedAt/UpdatedAt are conceptually distinct. Exact timestamp storage and day-boundary handling remain technical details.
- Completed/canceled transactions are retained; correction is modeled by status/history and ledger movement, not destructive update of history.
- Every stock effect is represented in immutable `stock_movements`; no direct stock mutation path.

## Conceptual entities and relationships

| Entity | Key and relationships | Main lifecycle/data |
|---|---|---|
| User | PK; actor FK from transactions/audit | username unique, password hash, ADMIN/USER, active flag, force-password-change; historical actor name/reference retained when deactivated |
| SparePart | PK; referenced by detail and movement rows | code from non-cycling sequence; unique name after case-insensitive comparison and trimming leading/trailing spaces; name, active state, minimum stock, master selling price and sensitive Latest Buy Price/Average Cost; nonnegative current-stock projection is initialized to zero and must be changed only by Stock Service together with a ledger movement; `deleted_at` removes it from active lists while retaining its row and code |
| Service | BIGINT PK; unique `SRV-YYYYMMDD-0001` business number; created_by/updated_by User FK | transaction datetime, status constrained to `COMPLETED`/`CANCELED` only (no Draft workflow); service/work/vehicle/discount and total HPP snapshot; business number remains stable after date/time edit; Admin completed edit once |
| ServiceJobDetail | PK; FK Service | job/service description and transaction amount fields based on the PRD form; each Service has at least one such detail |
| ServiceItem | PK; FK Service and SparePart (retention strategy technical detail) | quantity, part code/name snapshot, transaction selling price (defaults from master, editable by Admin/User), price/discount allocations as needed, HPP snapshot; optional spareparts, with one sparepart at most once per Service |
| SLS | BIGINT PK; unique `SLS-YYYYMMDD-0001` business number; User FK | transaction datetime, status constrained to `COMPLETED`/`CANCELED` only (no Draft workflow); discount/totals, transaction HPP snapshot; number stable after date/time edit; Admin completed edit once |
| SLSItem | PK; FK SLS and SparePart | quantity, part code/name snapshot, transaction selling price (defaults from master, editable by Admin/User), sale amount and HPP snapshot; each SLS requires at least one item and one sparepart may appear only once |
| Purchase | BIGINT PK; unique `PUR-YYYYMMDD-0001` business number; Admin FK | transaction datetime, supplier free-text value (no supplier master); entity-specific lifecycle: `DRAFT` can be confirmed to `COMPLETED` or deleted while draft; `COMPLETED` may be edited once total (including supplier-only) or canceled; `CANCELED` terminal; edit count/version marker; Draft and confirm require at least one item; edit rejected after a dependent subsequent transaction/stock event; cancellation rejected if its stock has been used by another transaction; draft does not change stock/cost |
| PurchaseItem | PK; FK Purchase and SparePart | quantity, actual buy price/amount (> Rp0), part code/name snapshot; one allowed Purchase edit may update its item data and must retain Before→After audit; unique `(purchase_id, spare_part_id)` |
| Expense | BIGINT PK; unique `EXP-YYYYMMDD-0001` business number; Admin FK | transaction datetime, status constrained to `COMPLETED`/`CANCELED` only (no Draft workflow); optional external receipt number/note, totals; no category/vendor/payment method; number stable after date/time edit; canceled omitted from business history/reports |
| ExpenseItem | PK; FK Expense | description, positive decimal quantity, integer Rupiah unit price, computed line total rounded before summing; each rounded line total must be greater than Rp0 |
| StockMovement | PK; FK SparePart; source transaction/type references | append-only time, signed quantity/type, source, unit cost where applicable, valuation delta, and reversal/correction reference; zero quantity is allowed only for a cost correction with a recorded value delta |
| StockOpname | BIGINT PK; unique `OPN-YYYYMMDD-0001` business number; creator/reviewer/approver User FKs | transaction datetime; status constrained to the SO lifecycle only (revision/recheck, finalized-but-revisable, approved-final, rejected-to-revision); created-at system stock snapshot; number stable after date/time edit; finalize/reject/approval actors and times |
| StockOpnameItem | BIGINT PK; FK SO and SparePart | integer pcs system-stock snapshot, latest editable physical count and signed difference; after Finalize, latest recheck value is official; no separate history/version row is required for each recheck; approval/cost adjustment state |
| AuditLog | PK; actor User FK nullable for unauthenticated event where needed | timestamp/action/object/before-after/context; no edit; Admin may delete |
| AuditDeletionTrace | PK; technical-only record of AuditLog deletion | deletion actor/time/target; not deletable through the Audit menu; exact storage/retention remains technical design |
| ImportBatch / ImportRow | PK; Admin FK; row FK batch | staging for `.xlsx` sparepart master import, preview mapping, validation errors/warnings, import outcome; file/row limit follows sample review |
| IdempotencyRecord | PK; User FK; unique actor + operation + request key | SHA-256 request fingerprint and JSON outcome; retain records permanently; same key/data returns the original outcome and changed data conflicts |

Relationship rules: transaction header has one-to-many line items; each movement belongs to one sparepart and one originating business effect; SO items refer to part and snapshot; audit actor remains historically identifiable. I2.1 uses soft deletion (`deleted_at`) and never hard-deletes or reuses the code. When transaction detail tables are added, use restrictive SparePart FKs and copy code/name snapshots; do not cascade-delete transactions or movements.

## Primary/foreign keys and constraints

- All entities have stable PKs; FK references use `RESTRICT` for historical transaction, movement, audit and user attribution unless a reviewed retention policy says otherwise. Avoid cascade deleting business history.
- Unique: username; generated sparepart code (including deleted codes); transaction number per document family; idempotency key within its actor/operation scope; source movement uniqueness sufficient to guard duplicate posting. Idempotency records are retained permanently.
- Sparepart name uniqueness is enforced by a PostgreSQL unique expression index on `lower(btrim(name))`. Similar-name detection is advisory and allows explicit Admin continuation; I2.1 uses normalized Levenshtein similarity >=0.82 for names at least four characters long, while exact duplicates always fail. Transaction selling price may be below latest buy price; no constraint may reject it solely for that comparison.
- Check: monetary columns are integer Rupiah; Purchase item and opening-stock unit costs are greater than Rp0; sparepart inventory quantities are integer pcs; Expense quantity is positive and may be decimal; each rounded Expense line total must be greater than Rp0 before summing; movement quantity is a nonzero signed integer pcs value; valid status transitions; future datetime rejected using the computer time standard/workshop timezone rule. Round each calculation step before using the result in the next. Current inventory must remain nonnegative; enforce through the approved transactional stock mechanism, including SO approval.
- Purchase Draft and confirmation each require at least one item; enforce at command boundary/transactional validation because a row-level CHECK cannot enforce header-to-detail count. Unique `(purchase_id, spare_part_id)` prevents duplicate parts per Purchase.
- Service must contain at least one job/service detail; spareparts are optional. SLS must contain at least one item. Enforce each minimum at command/transaction boundary because a row-level CHECK cannot count child rows. Reject a repeated sparepart in one Service or SLS and enforce uniqueness on `(service_id, spare_part_id)` and `(sls_id, spare_part_id)` where those part lines are stored. Purchase duplicate-part prohibition also remains enforced.
- Service/SLS preview is transient and creates no Completed transaction or movement. Do not add Draft status or a saved draft entity for it. Final save persists validated transaction and movements atomically.
- Completed Service/SLS edit audit requires reason and Before→After summary; one edit only; any creator-entered field except transaction number and old stock note may be edited. Valid edits recalculate HPP and related transaction values and check current stock before accepting increased usage. Completed Purchase edit is once-only; one edit may add/remove/change items and updates Average Cost while old transaction HPP stays unchanged; capture the explicit item edit in Before→After audit rather than silently rewriting history. Supplier-only change needs no reason; any other edit requires reason and Before→After summary. Supplier is a text field on Purchase. Persist enough audit/change data to support this; exact reason field shape remains schema design.
- Persisted status constraints and transition validation must enforce each entity's own lifecycle; do not use a generic transaction status that permits invalid combinations. Purchase alone has the `DRAFT` workflow among Service/SLS/Purchase/Expense: `DRAFT` can be confirmed to `COMPLETED` or deleted while still draft; only `COMPLETED` can be canceled, and `CANCELED` is terminal. Service/SLS are created directly as `COMPLETED`; only Admin-approved edit/cancel operations can change a completed transaction, and cancellation is terminal. Expense is created directly as `COMPLETED`; Admin cancellation is terminal. Stock Opname uses only its own revision/recheck, finalized-but-revisable, approved-final and rejected-to-revision lifecycle, with Approved terminal. Enforce entity-specific database constraints/enums and server transition validation.
- CANCELED Service/SLS/Purchase cannot be edited or reactivated; corrections after cancellation use a new applicable workflow. Preserve original movement rows and append reversal rows. Expense CANCELED cannot be reactivated.
- Completed Service and SLS each permit at most one Admin edit; persist an edit count/transition guard and reject subsequent edits. Completed Purchase permits at most one edit total, including supplier-only. For Purchase item edit/cancel, any negative stock movement for an affected part after Confirm rejects the operation even if later receipts restored the balance. Supplier-only edit has no stock effect and may still be used once. Other Purchase edits require reason and all edits require Before→After.
- Role domain is only ADMIN/USER. Exact persisted names for SO lifecycle states are implementation detail, but must not make invalid transitions/status combinations representable.
- Avoid a nullable generic source FK without integrity strategy; movement provenance must resolve to an existing source record or preserved source snapshot.
- Audit before/after representation must exclude secrets/password hashes and protect sensitive values from USER projections.

## Stock ledger and balance

Opening stock: Admin manually enters quantity and cost per unit greater than Rp0 for each sparepart. On save, it applies immediately at input time, initializes that part's Average Cost from the unit cost, and writes an immutable opening movement through Stock Service in the same transaction; no second approval is required. Excel stock is reference-only and never initializes opening stock. This mechanism is implemented by `recordOpeningStock` through Stock Service; the stock card remains Admin-only.

Movement types cover receipt, Service/SLS issue, stock-opname adjustment in/out, correction/delta, and reversal. Each row records sparepart, signed integer-pcs quantity, event datetime, source, actor, unit cost where applicable, and the rounded inventory valuation delta. Purchase movements also retain actual source Purchase value delta separately, so item edit/cancel can reconcile purchase value and rounded inventory projection without conflating them. A zero-quantity correction is permitted only to record a Purchase cost-only correction. Purchase edit posts per-part quantity and purchase-value deltas; cancellation reverses the recorded Purchase quantity and inventory valuation effects. A negative SO difference is valid; approved physical inventory and resulting stock must not be negative. If stock changed since SO began, require USER to recount before Admin approval; the approved count is then applied.

Current stock is the signed sum of movement quantities for a part (or transactionally maintained projection proven equivalent) and must never be negative. Service/SLS transaction checks availability within a lock/serializable boundary. Purchase receipt adds received quantity and does not cover a negative balance; negative inventory is not a normal V1 workflow. Cancel appends reversal and preserves original movement. Corrections append deltas. For item edit/cancel, any negative stock movement for an affected part after Purchase Confirm blocks the operation, even if later receipts restored the balance; supplier-only edit is exempt. Movement rows are not updated/deleted by ordinary business workflows. Admin-only movement queries are implemented at `/api/admin/stock/movements`.

## HPP / Average Cost

- Purchase Completed receipt recalculates weighted Average Cost using applicable quantity/value and actual receipt prices.
- Current I2.2 implementation uses integer arithmetic and rounds each intermediate Average Cost calculation half-up to whole Rupiah before continuing. This is a technical implementation choice for the locked per-step rounding rule; it does not permit negative stock or change stored historical HPP.
- Purchase item buy price is a whole-Rupiah amount greater than zero. On successful Purchase Confirm to Completed, update SparePart Latest Buy Price from the received item price. If an allowed edit changes the latest still-valid Purchase, update Latest Buy Price to its edited item price; if an allowed cancellation cancels that Purchase, fall back to the prior still-valid Completed Purchase. “Latest” follows Confirm/commit order. This is distinct from Average Cost/HPP; do not rewrite historical PurchaseItem prices.
- Draft has no cost/stock impact. Purchase cancel and one-time completed edit recalculate current Average Cost without modifying old movements or historical transaction HPP. The selected correction method applies the Purchase line's value delta to current valuation (`current stock × current Average Cost`), applies its quantity delta to current stock, then rounds the resulting Average Cost at that calculation step. If resulting stock is zero, Average Cost is null and Inventory Value is zero.
- Service/SLS save cost at transaction time. Service has transaction HPP total and item details retained; SLS item snapshots.
- SO adjustment uses Average Cost at approval.
- Inventory Value for Admin is stock × Average Cost; not a Dashboard KPI.
- Negative inventory and negative-stock costing are not V1 workflows. Round each calculation step before continuing; Average Cost/HPP remain whole Rupiah. Cost/stock ledger order follows Confirm/commit time; business date is used for reports. I2.4 uses per-part quantity and Purchase value deltas against current inventory valuation; cost-only item edits use a zero-quantity correction movement. Cancellation reverses the currently effective Purchase deltas. Historical HPP must not change silently.

## Historical snapshots

Persist part code/name snapshots on transaction items and the necessary price/cost snapshots so later master edits do not change old documents. Preserve user identity/name for historical transactions on deactivation. Purchase actual cost remains sensitive to USER. Exact snapshot set per report/print and FK/deletion model is reviewed schema work.

## Audit and data retention

Audit required events per PRD: failed login, denied permission, sensitive transaction create/edit/cancel, SO finalize/approve/reject, master and price changes, backup/restore success/failure. Store actor/time/action/object and before-after where applicable; note-only Expense edits may be excluded. Admin may delete audit rows but cannot edit them; record deletion in a separate technical log that cannot be deleted through the Audit menu. Canceled Service/SLS/Purchase remain; canceled Expense remains available to Admin through a separate “Dibatalkan” view, but not ordinary history/reports.

## Index plan (candidate, confirm with query design)

- Unique indexes for username, part code, normalized sparepart name (case-insensitive, trim leading/trailing spaces), each document number, idempotency scope/key, and repeated-part prevention on Service/SLS/Purchase details.
- Movement: `(spare_part_id, occurred_at, id)` and source type/source ID; indexes for ledger replay/reconciliation.
- Transaction headers: `(status, transaction_datetime)`, `(created_by, transaction_datetime)` where required; unique numbers.
- Detail FKs for all header/part relations; transaction datetime indexes for report ranges.
- SO `(status, created_at)` and item `(stock_opname_id, spare_part_id)`; audit `(created_at, actor_id, object_type, object_id)`.
- Import batch/row state and result lookup indexes.
- USER-safe stock listing/search indexes only after chosen query fields; do not index speculative fields.

## Migrations and recovery

- Use reviewed, checked-in, versioned migrations; no hand-edited production schema or automatic destructive sync. Every migration must work from a fresh DB and a representative prior version, preserve data, and have a rollback/recovery plan appropriate to its operations.
- Separate schema changes from large data backfills where needed; take/verify backup before risky migration. Keep migration execution on host and prevent concurrent app instances from racing migrations.
- Seed only required initial ADMIN/bootstrap mechanism after deciding secure provisioning. No default credentials in source.
- Restore has pre-restore protection and atomic recovery semantics. Accept external PostgreSQL files only from compatible versions and inspect before restoring; exact accepted versions and validation procedure remain technical details.

## OPEN schema gates

Remaining design detail only: intermediate numeric representation while rounding each calculation step; timestamp storage/day boundaries; transaction-detail FK/snapshot shape over soft-deleted spareparts; separate technical audit deletion log; exact compatible PostgreSQL versions and restore checks; Excel sample-dependent size/row limits and supported master fields; session/bootstrap details; exact Dashboard short/long period thresholds; technical stock recheck before SO approval. Purchase edit/cancel uses the delta valuation method documented in `DECISIONS.md`; O-17/A is locked and must not be changed.
