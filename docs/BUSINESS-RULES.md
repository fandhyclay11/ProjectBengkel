# Business Rules — ProjectBengkel V1

Only `PRD_FINAL.md` defines product requirements. This is a categorized restatement for implementation planning, not a source of new business decisions. Any unsettled detail is marked OPEN in `DECISIONS.md`.

## Actors and permissions

| Capability | ADMIN | USER |
|---|---|---|
| Login, change own password, logout | Yes | Yes |
| Create Service/SLS | Yes | Yes |
| Edit/cancel Completed Service/SLS | Yes; at most one Admin edit per transaction, reason + Before→After + audit required; all creator-entered fields editable except transaction number and old stock note | No |
| Purchase drafts and all purchase operations | Yes | No |
| Expense create/edit/cancel | Yes | No |
| Create/revise SO | Yes | Yes |
| Finalize/approve/reject SO | Yes | No |
| Manage sparepart master/status | Yes | No |
| View current stock and permitted part list | Yes | Yes; no master prices |
| Dashboard, Reports, movement history, Audit Log, backup/restore | Yes | No |
| Cross-user permitted transaction history / allowed print | Yes | Yes, sensitive columns excluded |

Every permission is checked server-side for every read and write, including direct API, detail, print, and export. USER responses must not include buy/sell master price, HPP/Average Cost, Inventory Value, Stock Movement History, Audit Log, Dashboard, or Reports. Purchase print available to USER omits buy price. All USER have the same standard permissions.

## Service

- ADMIN/USER create Service through preview-before-save. Preview is not persisted and creates neither a Completed transaction nor stock movement; final save creates the Completed service atomically after server validation. This is not a Draft workflow. Service must contain at least one job/service detail but may have no spareparts. A sparepart may appear only once in a Service.
- Save transaction time using the computer's time standard and display/report using the configurable workshop timezone; future datetime is prohibited. Number format is `SRV-YYYYMMDD-0001` and remains unchanged when date/time changes.
- Reject transaction if stock is insufficient. On creation store Average Cost at transaction time; retain transaction total HPP and item detail snapshots. Sparepart issue does not recalculate Average Cost.
- Discount lowers reported revenue and feeds profit calculation.
- USER cannot edit/cancel Completed. ADMIN may edit Completed Service at most once; a reason, Before→After summary, and audit are required. Any field entered by the creator may be edited except transaction number and old stock note. For valid edits, recalculate HPP and related transaction values from the resulting transaction data. Check current stock; accept added usage only when enough stock remains, otherwise reject. Stock adjustments use new movements and original movements remain immutable.
- Sparepart selling price on each transaction line defaults from master selling price and may be edited. USER may see and edit the transaction price. If below latest buy price, show a warning but allow save; this comparison alone must not reject the transaction, and the warning must not reveal buy price.
- Cancellation of Completed Service preserves a terminal CANCELED record and original immutable movements, appends reversal, and restores stock at saved transaction HPP. CANCELED cannot be edited or reactivated; correction follows a new applicable workflow. Canceled values are excluded from Dashboard and P&L.

## SLS

- ADMIN/USER create SLS through preview-before-save. Preview is not persisted and creates neither a Completed transaction nor stock movement; final save is server-validated and atomic. This is not a Draft workflow. Insufficient stock blocks final save. Save transaction time using the computer's time standard and display/report using the configurable workshop timezone; future datetime is prohibited; number format is `SLS-YYYYMMDD-0001` and stays stable after date/time edit.
- Snapshot Average Cost on transaction; does not change Average Cost. Discount lowers revenue.
- USER cannot edit/cancel Completed. ADMIN may edit Completed SLS at most once; a reason, Before→After summary, and audit are required. Any field entered by the creator may be edited except transaction number and old stock note. For valid edits, recalculate HPP and related transaction values from the resulting transaction data. Check current stock; accept added usage only when enough stock remains, otherwise reject. Stock adjustments use new movements and original movements remain immutable.
- SLS must contain at least one item. A sparepart may appear only once in one SLS. USER may see and edit the transaction selling price; a below-Latest-Buy warning may be shown without exposing buy price.
- Sparepart selling price on each SLS line defaults from master selling price and may be edited. Below latest buy price is allowed with a warning and is not a rejection condition.
- Cancel retains record/original immutable movement and appends reversal; stock return uses stored HPP. CANCELED cannot be edited or reactivated; correction follows a new applicable workflow. CANCELED is excluded from Dashboard/P&L.

## Purchase

- ADMIN only. Draft has no stock/HPP effect, must contain at least one item, and can be confirmed to Completed or deleted while still Draft. A sparepart may appear at most once in one Purchase. Confirm must also contain at least one item and is atomic; only a Completed Purchase can be canceled. Receipt uses actual per-item buy prices and recalculates weighted Average Cost.
- Purchase item buy price must be a whole-Rupiah amount greater than zero. Confirm to Completed updates each affected master Latest Buy Price to the received purchase price. If an allowed edit changes the latest valid Purchase, update Latest Buy Price; if an allowed cancellation cancels that Purchase, use the prior still-valid Completed Purchase price. “Latest” follows Confirm/commit order. A later Purchase/master-price change does not rewrite earlier item prices; an explicitly allowed one-time edit changes that Purchase with required Before→After audit. Latest Buy Price is distinct from Average Cost/HPP.
- Inventory stock must remain nonnegative; Purchase receipt does not use a negative-balance covering workflow.
- Save transaction time using the computer's time standard and display/report using the configurable workshop timezone; future datetime is prohibited; number format is `PUR-YYYYMMDD-0001` and remains stable after date/time edits. USER can print allowed document but buy price must be removed.
- ADMIN can edit a Completed Purchase at most once total, including supplier-only edit. For item edit/cancel, any negative stock movement for an affected sparepart after Confirm means the Purchase is considered used; reject the operation even if later receipts restored the balance. Supplier-only change has no stock effect and remains allowed once even after later stock use. Supplier-only change does not require a reason; any other completed Purchase edit requires a reason. A Before→After summary is required for every edit. In one edit Admin may add, remove, or change items; update Average Cost and keep old transaction HPP unchanged. Prior movements stay immutable and stock correction is a new movement. Supplier is free text on Purchase; no separate supplier master exists.
- Each Purchase item buy price must be an integer Rupiah amount greater than Rp0; zero and negative prices are rejected.
- Accepted item edits post only the quantity and purchase-value delta through Stock Service. Current valuation is current stock × current Average Cost; apply the Purchase line value delta and quantity delta, then round Average Cost before using it in the next calculation. A cost-only edit records a zero-quantity correction movement with its valuation delta. Cancel retains terminal CANCELED record and appends a reversal movement for its effective items; recalculate Average Cost. CANCELED cannot be edited or reactivated; correction follows a new applicable workflow. CANCELED is excluded from Dashboard/P&L.

## Stock Opname (SO)

- Create captures System Stock at creation. USER may create and revise/recheck. Only ADMIN may Finalize, Approve, Reject.
- After Finalize, USER may still revise/recheck Physical Stock until Admin Approve/Reject. The latest revision is the official result; separate historical records for each revision are not required. Reject returns to Revision/Recheck. Approved is final: no edit/revision/cancel; later error requires a new SO.
- Positive/negative discrepancy maps to ADJUSTMENT_IN/ADJUSTMENT_OUT. Negative discrepancy is valid and distinct from negative inventory. No stock effect until approval. If stock changed since SO began, USER must recount before Admin approves. Approval applies adjustment at Average Cost; resulting System Stock equals the latest approved Physical Stock and must not be negative. Audit finalize/approve/reject with actor; movement records only applied adjustment.

## Sparepart and stock movement

- ADMIN maintains master; USER can see permitted list/current stock only.
- Reject a duplicate sparepart name after ignoring case and leading/trailing spaces. A similar-name warning is advisory; Admin may explicitly continue. Similarity detection is technical OPEN and must not be guessed. Selling price below latest buy price is allowed with a warning, not rejected for that reason.
- System-generated unique code, never reused even after deletion. A deleted part becomes inactive and is removed from the active list; historical transaction keeps code/name snapshot.
- All stock changes must go through Stock Service and immutable stock movement ledger. No direct stock writes/CRUD. Movement records time/type/quantity/source/cost needed for reconciliation; exact fields OPEN.
- Sparepart inventory quantity and stock movement quantity use integer pcs. Inventory balance must remain nonnegative; signed negative SO differences remain valid.
- Completed edit produces movement delta; cancellation produces reversal; old movements are never edited/deleted. Confirm and approval plus movement must be atomic and idempotent.
- USER cannot see movement history; Admin may filter it by part.

## Costing, finance and Dashboard

- V1 method is Average Cost. Round each calculation step before using its result in the next step; monetary amounts are whole Rupiah. Latest Buy Price is separate from Average Cost/HPP.
- Latest Buy Price is the most recent purchase price successfully received through Purchase and updates when Purchase is confirmed to Completed. An allowed edit to the latest valid Purchase updates the price; an allowed cancellation of that Purchase falls back to the prior still-valid Completed Purchase price. A later Purchase does not rewrite earlier item prices; an explicitly allowed one-time edit updates its own item with Before→After audit. Latest Buy Price is not Average Cost/HPP. Purchase buy price must be greater than Rp0.
- Purchase receipt updates weighted Average Cost. Service/SLS uses and stores cost at transaction time; SO uses cost at approval. Later cost changes do not silently change old HPP.
- Gross Profit = Service Revenue + SLS Revenue − HPP. Net Profit = Gross Profit − Expense. Purchase is not revenue. Service without parts contributes revenue; discount already reduces revenue.
- Inventory Value = current stock × Average Cost for Admin; it is not a Dashboard KPI.
- Dashboard Admin only: Service/SLS revenues, Gross/Net Profit, Service/SLS/Purchase Completed counts, unconfirmed Purchase Draft count, low/minus stock monitoring. A part is `Stok Menipis` when current stock <= minimum stock. No separate Total Expense, Total HPP, Inventory Value, canceled count, or SO-in-progress KPI. Charts: Service+SLS revenue and gross profit; no Expense chart. Period defaults/current month and date presets; long ranges are grouped more compactly than short ranges, with no comparison period. Exact range breakpoints and aggregation rounding remain technical details.
- Exclude every CANCELED transaction from Dashboard and P&L; canceled Expense is not a cost.

## Expense

- Admin only. No Draft: preview then save Completed. Quantity must be positive (decimal allowed) and unit price is integer Rupiah. Calculate and round each line before adding; each rounded line value must be greater than Rp0. Optional general note/external receipt number. No category, payment method, recipient/vendor fields.
- Save transaction time using the computer's time standard and display/report using the configurable workshop timezone; future datetime is prohibited. Number format is `EXP-YYYYMMDD-0001` and remains unchanged after date/time edits. Edit shows Before→After and audit; reason not required. Edit of note alone need not be audited.
- Cancel preserves CANCELED record, never reactivatable; removes its expense effect and it is hidden from Expense History/business reports. Audit cancel. Admin can view it in a separate “Dibatalkan” view.

## Cancellation, editing and audit

- Completed transactions are not deleted to correct them. Service/SLS/Purchase cancellation preserves record and original immutable ledger history and adds reversal. A CANCELED Service/SLS/Purchase cannot be edited or reactivated; corrections use a new applicable workflow. Expense cancellation removes it from business cost/report and hides from business history; Expense CANCELED cannot be reactivated.
- Admin completed edits follow PRD-specific limits; don't infer unlimited edits. Stock-affecting edits append correction movement.
- Audit captures actor/time/action/object and Before→After for material changes; failed logins, permission denials, sensitive transaction operations, SO workflow, master/price change, backup/restore outcomes. Successful login/logout not logged. Audit entries cannot be edited; Admin may delete them. Deletion is recorded in a separate technical log that cannot be deleted through the Audit menu.

## Users and credentials

- Local username/password; password hashed; self-service password change. Admin resets USER password; user must change on next login. No email reset.
- Deactivated user cannot login/access; retain historical user identity. Admin cannot deactivate self or another Admin. No inactivity timeout; logout provided. Session invalidation mechanics are OPEN.
- USER receives generic errors; diagnostic details only server side. HTTPS when available/supported.

## Reports, prints and Excel migration

- Admin-only Reports include Service, SLS, Purchase, Expense, stock/master, movement, SO and P&L, with stated date filters/minimum columns; Print/PDF/Excel all enforce role and field filtering. USER has no Reports but can print allowed Service/SLS/Purchase documents without sensitive fields.
- Excel migration is Admin-only and strictly Preview→Validation→Import; any error aborts the whole import and an outcome report records success/errors/warnings/details. Stage awal hanya memasukkan master sparepart dari `.xlsx`; batas file/baris menunggu pemeriksaan contoh bengkel. Exact part-name match uses case-insensitive comparison after trimming leading/trailing spaces; similar names warn/request confirmation; new parts are listed for Admin confirmation; ambiguous mapping is never guessed.
- Excel stock and historical Service/SLS/Purchase transactions are reference-only. Historical rows must not be automatically created as active application transactions. Admin enters opening quantity and cost per unit greater than Rp0 for each sparepart; when saved, it takes effect immediately at the input time, initializes Average Cost from that unit cost, and creates an immutable Stock Movement atomically without a second approval. Excel stock never initializes opening stock.
- Ignore Excel codes and formula values; Excel buy/sell prices are reference only and do not update master prices. Service multi-part history remains a reference grouping and does not authorize creation of active Service records. Import is limited to sparepart master; detailed columns and file/row limits remain to be specified after reviewing a sample file.

## Backup and restore

- Admin only; backup is manual or weekly scheduled, timestamped, stored on the same server, retained for 30 days, not required to be encrypted, and has no download button.
- Restore requires strong confirmation, pre-restore protection, all-or-nothing recovery on failure, an audit record, and Admin login again afterward. External PostgreSQL files must be from a compatible version and checked before restore; exact accepted versions/check steps remain technical details.

## Dates, numbers and reporting periods

Service/SLS/Purchase/Expense/Stock Opname transaction date/time is one datetime value; save time using the computer's time standard and display/report using the workshop timezone. Future transaction date/time is prohibited and business number remains stable after date/time edits. Cost/stock ledger order follows Confirm/commit time; reports use transaction business date. Technical timestamp storage and day-boundary details remain OPEN. Monetary values and sparepart stock quantities are integer Rupiah and integer pcs respectively; Expense quantity may be decimal. Round each calculation step before continuing to the next.
