# PRD — Sistem Management Operasional Bengkel

**Detailed PRD — Local-First, LAN-Ready**


| Item | Keterangan |
| --- | --- |
| Produk | Sistem Management Operasional Bengkel |
| Arsitektur | Local-First, LAN-Ready |
| Target utama | Single user / owner-managed workshop |
| Platform | Web App responsive; berjalan lokal |
| Dokumen | Functional + Technical Product Requirements |
| Status | Draft untuk discovery & implementation |


## 1. Executive Summary

Produk ini adalah aplikasi web untuk management operasional bengkel. Aplikasi menggantikan pencatatan manual yang saat ini dilakukan melalui Excel dengan sistem terintegrasi untuk aktivitas bengkel, inventory, pembelian, biaya operasional, laporan, KPI, dan audit stok.

Arsitektur awal bersifat Local-First: fungsi operasional utama tidak bergantung pada internet. Aplikasi berjalan pada komputer utama dengan database lokal. Arsitektur harus LAN-Ready sehingga HP/tablet/komputer lain dapat mengakses aplikasi melalui jaringan lokal ketika dibutuhkan.


## 2. Product Goals

- Mengurangi pencatatan manual dan duplikasi input.

- Menjadikan inventory sebagai sumber data stok yang konsisten.

- Memastikan pemakaian/pembelian selalu tercermin dalam stock movement.

- Menyediakan audit stok fisik dengan proses review sebelum adjustment.

- Menyediakan laporan operasional dan keuangan.

- Menyediakan KPI dan perbandingan antarperiode.

- Tetap dapat digunakan ketika internet tidak tersedia.

- Mudah dibackup dan direstore.

- Memiliki fondasi yang dapat dikembangkan menjadi multi-user/cloud di masa depan tanpa rewrite besar.


## 3. Scope


### 3.1 In Scope V1

- Authentication lokal.

- Dashboard.

- Master sparepart.

- Stock movement.

- Aktivitas/service bengkel.

- Pembelian sparepart.

- Biaya operasional.

- Audit stok/stock opname.

- Laporan.

- KPI dan comparison.

- User/role dasar.

- Backup/restore.

- LAN access readiness.

- Import data Excel sebagai proses awal/migrasi.


### 3.2 Out of Scope V1

- CRM pelanggan.

- Booking pelanggan.

- Loyalty.

- Marketplace.

- Payment gateway.

- Native Android/iOS.

- Cloud remote access dari internet.

- AI assistant sebagai fitur inti.

- Sinkronisasi offline-online multi-device yang kompleks.


## 4. Target User & Roles


| Role | Hak akses utama |
| --- | --- |
| Admin | Konfigurasi sistem, user, master data, backup/restore, seluruh transaksi. |
| Management | Dashboard, laporan, KPI, inventory, audit, review/approval adjustment. |
| Operator | Input aktivitas, pembelian, biaya, dan audit sesuai permission. |


## 5. Architecture Decision


### 5.1 Local-First

Komputer utama menjalankan aplikasi dan database lokal. Internet bukan dependency untuk operasi inti.


### 5.2 LAN-Ready

Aplikasi harus dapat bind pada interface LAN dan menerima koneksi dari perangkat dalam jaringan lokal. Perangkat lain tidak menyimpan database utama.


### 5.3 Recommended Technical Stack


| Layer | Teknologi yang disarankan | Catatan |
| --- | --- | --- |
| Frontend | Next.js + React + TypeScript | Responsive web app. |
| UI | Tailwind CSS + component library ringan | Konsisten dan cepat dikembangkan. |
| Backend | Next.js server/API atau Node.js TypeScript modular | Pilih satu pendekatan; hindari dua backend terpisah. |
| Database | PostgreSQL | Database utama lokal; kuat untuk transaksi. |
| ORM | Prisma | Schema, migration, typed query. |
| Validation | Zod | Validasi request/form. |
| Auth | Session-based local auth | Tidak perlu OAuth/cloud pada V1. |
| Charts | Recharts atau library setara | Untuk dashboard/KPI. |
| Testing | Vitest + Playwright | Unit/integration + E2E. |
| Packaging | Docker Compose opsional | Memudahkan deployment lokal. |

Catatan: stack di atas adalah baseline untuk mengurangi keputusan ulang saat coding. Jika OpenCode memilih alternatif, perubahan harus dicatat dalam ADR sebelum implementasi.


## 6. High-Level Architecture

Alur utama: Browser → Web App/API → Service Layer → Prisma → PostgreSQL. Semua perubahan stok melewati Stock Service agar tidak ada modul yang mengubah stok secara langsung.


| Komponen | Tanggung jawab |
| --- | --- |
| UI Layer | Form, tabel, filter, dashboard, responsif. |
| API/Route Layer | Authentication, request/response, authorization, validation. |
| Service Layer | Business rules dan transaction orchestration. |
| Domain/Rules | Perhitungan stok, audit, KPI, finance. |
| Repository/ORM | Akses PostgreSQL melalui Prisma. |
| Database | Persistent source of truth. |
| Audit Log | Jejak perubahan penting. |
| Backup Service | Backup/restore database. |


## 7. Project Structure

Struktur awal yang disarankan:

src/

app/

(auth)/

dashboard/

workshop/

inventory/

purchases/

expenses/

audits/

reports/

kpi/

settings/

api/

components/

features/

workshop/

inventory/

purchases/

expenses/

audits/

reports/

kpi/

server/

services/

repositories/

domain/

validators/

auth/

lib/

types/

config/

prisma/

schema.prisma

migrations/

tests/

unit/

integration/

e2e/

docs/

PRD.md

ARCHITECTURE.md

DATABASE.md

BUSINESS-RULES.md

API.md

ADR/


## 8. Core Data Model

Nama tabel berikut adalah baseline. Finalisasi dilakukan pada Phase 0.


| Entity | Tujuan | Relasi penting |
| --- | --- | --- |
| users | Akun pengguna | role |
| roles | Hak akses | permissions |
| spare_parts | Master sparepart | stock movements |
| workshop_activities | Header aktivitas service | activity items |
| workshop_activity_items | Sparepart yang dipakai | spare_parts |
| purchases | Header pembelian | purchase items |
| purchase_items | Detail pembelian | spare_parts |
| operational_expenses | Biaya operasional | expense category |
| stock_movements | Ledger stok | spare_parts + reference |
| stock_audits | Sesi stock opname | audit items |
| stock_audit_items | Hasil fisik per item | spare_parts |
| stock_adjustments | Penyesuaian yang disetujui | audit item + movement |
| audit_logs | Jejak perubahan | user |

Prinsip penting: stock_movements adalah ledger. Jangan menyebarkan logika +/- stok ke banyak controller.


## 9. Database Rules

- Gunakan primary key UUID atau ID yang konsisten.

- Semua tabel transaksi memiliki created_at dan updated_at.

- Data penting memiliki created_by/updated_by bila relevan.

- Gunakan foreign key untuk menjaga integritas.

- Gunakan decimal/numeric untuk uang; jangan gunakan floating point.

- Gunakan integer/decimal yang sesuai untuk quantity.

- Harga dan total disimpan dengan precision yang disepakati.

- Gunakan status enum/string terkontrol untuk workflow.

- Hindari hard delete pada transaksi final.

- Migration harus versioned dan dapat dijalankan ulang secara aman.


## 10. Inventory Domain


### 10.1 Stock Movement Types

- PURCHASE_IN — barang masuk dari pembelian.

- SERVICE_OUT — sparepart keluar karena aktivitas service.

- ADJUSTMENT_IN — hasil audit/koreksi menambah stok.

- ADJUSTMENT_OUT — hasil audit/koreksi mengurangi stok.

- CORRECTION — koreksi administratif yang disetujui.


### 10.2 Stock Calculation

Konsep dasar:

Stok Saat Ini = Stok Awal + seluruh movement masuk − seluruh movement keluar

Implementasi dapat memakai cached current_stock pada spare_parts untuk performa, tetapi sumber audit tetap stock_movements.


### 10.3 Negative Stock

Default: transaksi yang membuat stok menjadi negatif ditolak. Jika client mengizinkan negative stock, aturan harus dibuat eksplisit.


## 11. Workshop Activity

- Create draft activity.

- Tambahkan item sparepart dan qty.

- Masukkan jasa.

- Sistem menghitung subtotal, total, modal, dan margin sesuai rule.

- Confirm activity dalam satu database transaction.

- Saat confirm, buat SERVICE_OUT movement untuk setiap item.

- Setelah confirmed, edit langsung dibatasi; gunakan void/reversal bila dibutuhkan.

Contoh formula baseline:

- Sparepart Sales = Σ(qty × selling_price).

- Sparepart Cost = Σ(qty × cost_price).

- Service Revenue = nilai jasa.

- Total Revenue = Sparepart Sales + Service Revenue − Discount (jika ada).

- Gross Margin baseline = Total Revenue − Sparepart Cost. Definisi final harus disepakati client.


## 12. Purchase Module

- Draft purchase.

- Tambah purchase items.

- Confirm purchase.

- Saat confirm, buat PURCHASE_IN movement.

- Catat cost price berdasarkan aturan harga pembelian.

- Tidak boleh mengubah stok hanya karena form masih draft.


## 13. Operational Expense

- Draft/confirmed status opsional.

- Kategori biaya.

- Nominal decimal.

- Tanggal transaksi.

- Keterangan.

- Attachment/bukti opsional.

- Masuk ke laporan biaya setelah confirmed.


## 14. Stock Audit / Stock Opname

Ini adalah fitur kontrol inventory yang wajib.


| Tahap | Perilaku |
| --- | --- |
| Create Audit | Buat sesi audit dan daftar item. |
| System Snapshot | Simpan snapshot stok sistem saat audit dimulai atau saat item dimuat, sesuai keputusan bisnis. |
| Physical Count | Operator mengisi jumlah fisik. |
| Difference | Sistem menghitung physical - system. |
| Review | Management melihat seluruh selisih. |
| Approval | Selisih dapat disetujui untuk adjustment. |
| Adjustment | Sistem membuat adjustment stock movement. |
| Close | Audit ditutup dan tidak dapat diubah tanpa hak khusus. |

Audit dapat dikerjakan bertahap. Progress harus disimpan.

KPI audit:

- Items checked / total items.

- Items matched.

- Items with difference.

- Accuracy % = items matched / items checked × 100%.

- Total quantity variance.

- Total monetary variance berdasarkan cost price, bila disetujui.


## 15. Reports


| Report | Isi minimum |
| --- | --- |
| Aktivitas Bengkel | Tanggal, pekerjaan, item, qty, jasa, total. |
| Stock Card | Opening, in, out, adjustment, closing. |
| Current Stock | Item, stok, minimum, status. |
| Purchase | Pembelian per periode. |
| Expense | Biaya per periode/kategori. |
| Revenue | Jasa, sparepart, total. |
| Profit | Revenue, cost, expense, estimated profit. |
| Stock Audit | System, physical, variance, status, approval. |

Semua report harus memakai service/query layer yang sama dengan dashboard agar angka konsisten.


## 16. KPI & Analytics

KPI tidak menjadi sumber data baru. KPI dihitung dari transaksi yang sudah ada.


| KPI | Formula/Definisi awal |
| --- | --- |
| Jumlah Service | Count aktivitas confirmed. |
| Revenue | Total revenue confirmed. |
| Service Revenue | Σ service revenue. |
| Sparepart Revenue | Σ sparepart sales. |
| Sparepart Cost | Σ cost pada sparepart terjual/terpakai. |
| Operating Expense | Σ confirmed expenses. |
| Estimated Profit | Revenue − sparepart cost − operating expense, sesuai definisi client. |
| Inventory Value | Σ current stock × cost basis. |
| Stock Accuracy | Matched audited items / checked items × 100%. |
| Stock Variance | Σ physical − system. |

Comparison harus menampilkan periode A, periode B, delta nominal, dan delta percentage.


## 17. Frontend Requirements

- Responsive desktop-first tetapi dapat digunakan pada HP/tablet.

- Sidebar navigation pada desktop; navigasi yang nyaman pada layar kecil.

- Tabel memiliki search, filter, pagination, sorting bila relevan.

- Form memiliki validation dan pesan error yang jelas.

- Status transaksi menggunakan badge yang konsisten.

- Destructive action wajib confirmation dialog.

- Audit stok memiliki mode input cepat untuk pemeriksaan fisik.

- Dashboard tidak boleh menampilkan angka yang berbeda dari laporan.

- Loading, empty state, error state, dan success state harus tersedia.

- Format rupiah dan tanggal mengikuti locale Indonesia.


## 18. API / Backend Contract

Gunakan API/service contract yang konsisten. Contoh endpoint baseline:


| Method | Endpoint | Tujuan |
| --- | --- | --- |
| POST | /api/auth/login | Login lokal. |
| POST | /api/auth/logout | Logout. |
| GET | /api/spare-parts | Daftar sparepart. |
| POST | /api/spare-parts | Tambah sparepart. |
| PATCH | /api/spare-parts/:id | Update master. |
| GET | /api/stock/movements | Riwayat movement. |
| GET | /api/activities | Daftar aktivitas. |
| POST | /api/activities | Buat draft aktivitas. |
| POST | /api/activities/:id/confirm | Konfirmasi aktivitas + stock out. |
| POST | /api/purchases | Buat pembelian. |
| POST | /api/purchases/:id/confirm | Konfirmasi pembelian + stock in. |
| POST | /api/expenses | Buat biaya. |
| GET | /api/audits | Daftar audit. |
| POST | /api/audits | Buat audit. |
| POST | /api/audits/:id/items/:itemId/count | Simpan hitungan fisik. |
| POST | /api/audits/:id/submit | Kirim audit untuk review. |
| POST | /api/audits/:id/approve | Approve adjustment. |
| POST | /api/audits/:id/close | Tutup audit. |
| GET | /api/reports/... | Report queries. |
| GET | /api/kpi/... | KPI queries. |
| POST | /api/backup | Buat backup. |

Endpoint final boleh berubah mengikuti framework, tetapi kontrak dan business rule harus tetap terdokumentasi.


## 19. Transaction & Concurrency Rules

- Confirm activity dan stock movement harus berada dalam database transaction.

- Confirm purchase dan stock movement harus atomik.

- Audit approval dan adjustment movement harus atomik.

- Jangan melakukan read-modify-write stok tanpa transaction/locking yang sesuai.

- Jika dua request mencoba mengubah item stok yang sama, sistem harus menjaga konsistensi.

- Idempotency harus dipertimbangkan pada endpoint confirm agar double-click tidak membuat movement ganda.


## 20. Validation & Error Handling

- Semua input divalidasi di server; client-side validation hanya untuk UX.

- Quantity harus valid dan sesuai aturan satuan.

- Nominal tidak boleh NaN/Infinity.

- Foreign key harus valid.

- Transaksi final tidak boleh diubah sembarangan.

- Error teknis tidak boleh menampilkan stack trace kepada user.

- User mendapatkan pesan yang dapat dipahami.

- Server log menyimpan detail teknis yang diperlukan untuk debugging.


## 21. Security

- Password disimpan dengan password hashing yang aman; jangan plaintext.

- Session/token harus disimpan dengan mekanisme aman.

- Authorization dicek di server, bukan hanya disembunyikan di UI.

- API harus memeriksa role/permission.

- Backup file harus dibatasi aksesnya.

- LAN access sebaiknya dibatasi ke private network.

- Jangan expose database port ke LAN jika tidak diperlukan.

- Sensitive configuration menggunakan environment variables.


## 22. Offline & LAN Behavior


### 22.1 Saat Internet Mati

- Login lokal tetap tersedia.

- Aktivitas bengkel tetap tersedia.

- Inventory tetap tersedia.

- Pembelian tetap tersedia.

- Biaya tetap tersedia.

- Audit stok tetap tersedia.

- Laporan dan KPI lokal tetap tersedia.

- Backup lokal tetap tersedia.


### 22.2 Saat Diakses dari HP via LAN

- HP membuka alamat LAN host komputer.

- HP menggunakan database yang sama.

- Tidak membuat database kedua.

- Perubahan dari HP terlihat di komputer setelah request selesai.

- Jika komputer host mati, perangkat lain tidak dapat mengakses aplikasi.


## 23. Backup & Restore Strategy

- Manual backup wajib tersedia.

- Backup otomatis terjadwal dapat menjadi enhancement.

- Backup disimpan di lokasi berbeda dari database aktif bila memungkinkan.

- Restore harus diuji sebelum production handover.

- Sistem harus menyediakan backup sebelum operasi restore.

- Dokumentasi restore harus disertakan dalam handover.


## 24. Excel Migration

Excel client menjadi sumber data awal. Import harus diperlakukan sebagai proses migrasi, bukan sekadar upload file.

1. Identifikasi sheet dan kolom sumber.

1. Mapping kolom Excel ke field database.

1. Normalisasi nama dan satuan sparepart.

1. Validasi angka dan tanggal.

1. Deteksi duplikasi.

1. Preview hasil mapping.

1. Import ke staging/temporary area bila diperlukan.

1. Validasi hasil.

1. Commit import.

1. Buat laporan error/row yang tidak masuk.


## 25. Audit Trail

- Login/logout dapat dicatat.

- Create/update/void transaksi penting dicatat.

- Stock adjustment wajib dicatat.

- Approval audit wajib dicatat.

- Log minimal: actor, action, entity, entity_id, timestamp, before/after atau metadata relevan.


## 26. Testing Strategy


| Level | Target |
| --- | --- |
| Unit | Formula, validators, stock rules, KPI calculation. |
| Integration | Database transaction, service + movement, audit approval. |
| E2E | Login → activity → stock → report; purchase → stock; audit → adjustment. |
| Regression | Pastikan perubahan modul tidak merusak inventory/finance. |
| LAN Test | Akses dari device kedua melalui private network. |
| Backup Test | Backup → restore → verify data. |

Test untuk stock movement dan audit harus memiliki prioritas tinggi karena berdampak langsung pada integritas data.


## 27. Acceptance Criteria

1. Aplikasi dapat berjalan tanpa internet untuk seluruh fungsi operasional V1.

1. Satu database menjadi sumber kebenaran.

1. Pembelian confirmed menambah stok tepat satu kali.

1. Aktivitas confirmed mengurangi stok tepat satu kali.

1. Double submit tidak membuat duplicate stock movement.

1. Audit dapat menyimpan count bertahap.

1. Selisih audit dihitung otomatis.

1. Audit tidak mengubah stok sebelum approval adjustment.

1. Approval membuat adjustment movement sesuai selisih.

1. Stock card dapat menelusuri perubahan stok.

1. Dashboard, report, dan KPI menghasilkan angka yang konsisten.

1. Comparison dapat membandingkan minimal dua periode.

1. Backup dapat dibuat.

1. Restore dapat dilakukan dan diverifikasi.

1. Device kedua pada LAN dapat membuka aplikasi.

1. Hak akses membatasi aksi yang tidak diizinkan.


## 28. Development Workflow untuk OpenCode

PRD ini sebaiknya tidak diberikan sebagai satu perintah 'buat semuanya'. Gunakan workflow bertahap:

1. Baca PRD dan buat implementation plan.

1. Buat ARCHITECTURE.md dan DATABASE.md.

1. Buat ADR untuk keputusan teknologi yang berbeda dari PRD.

1. Implement Phase 1 foundation.

1. Jalankan tests.

1. Implement satu modul per task.

1. Setiap task hanya membaca file/context yang relevan.

1. Setelah modul selesai, update docs dan tests.

1. Jangan mengubah business rule tanpa mencatat perubahan.

1. Sebelum merge/final, jalankan full test, build, migration check, dan smoke test.

Tujuannya bukan hanya mengurangi token, tetapi mencegah OpenCode membuat perubahan besar yang tidak terkontrol.


## 29. Suggested Task Breakdown


| ID | Task |
| --- | --- |
| T01 | Repository setup, lint, formatter, env, base UI. |
| T02 | PostgreSQL + Prisma + migrations. |
| T03 | Auth + roles + permissions. |
| T04 | Sparepart master. |
| T05 | Stock movement service. |
| T06 | Purchase module. |
| T07 | Workshop activity module. |
| T08 | Operational expense module. |
| T09 | Stock audit module. |
| T10 | Reports. |
| T11 | Dashboard. |
| T12 | KPI comparison. |
| T13 | Audit trail. |
| T14 | Backup/restore. |
| T15 | LAN deployment. |
| T16 | Excel migration tooling. |
| T17 | E2E, security, performance, handover. |


## 30. Definition of Done

- Requirement task selesai sesuai acceptance criteria.

- Unit/integration/E2E test relevan tersedia.

- Lint/typecheck/build berhasil.

- Migration dapat dijalankan dari database kosong.

- Tidak ada console error yang diketahui pada flow utama.

- Business rule terdokumentasi.

- Audit trail tersedia untuk perubahan penting.

- UI memiliki loading/error/empty state.

- Tidak ada duplicate stock movement pada confirm.

- Backup/restore diuji untuk fitur terkait.

- Dokumentasi developer diperbarui.


## 31. Phase Plan


| Phase | Deliverable |
| --- | --- |
| 0 — Discovery | Final business rules, formula, mapping Excel, report/KPI definitions. |
| 1 — Foundation | App shell, auth, DB, Prisma, migrations, logging, backup dasar. |
| 2 — Inventory | Master sparepart, stock ledger, purchase, stock card. |
| 3 — Operations | Workshop activities + expenses. |
| 4 — Stock Audit | Stock opname, variance, approval, adjustment, audit trail. |
| 5 — Reports | Operational, inventory, finance reports. |
| 6 — KPI | Comparison, charts, KPI definitions. |
| 7 — LAN & Hardening | LAN access, backup/restore test, security, E2E, deployment. |


## 32. Open Decisions Sebelum Coding Final

- Definisi tepat 'keuntungan': apakah pembelian sparepart langsung dianggap cost atau memakai cost of goods sold berdasarkan pemakaian?

- Metode cost inventory: average cost, last purchase cost, atau metode lain.

- Apakah kendaraan cukup berupa teks pada aktivitas atau perlu master kendaraan.

- Apakah supplier perlu master data.

- Apakah diskon diperlukan.

- Apakah pajak diperlukan.

- Apakah pembayaran/cashflow perlu dicatat atau hanya pendapatan.

- Siapa yang boleh approve adjustment.

- Apakah audit menggunakan snapshot stok saat sesi dibuat atau stok sistem saat item diperiksa.

- Apakah barcode diperlukan.

- Format laporan yang wajib dicetak/export.

- Spesifikasi komputer host dan sistem operasi.

- Apakah aplikasi akan dijalankan langsung atau melalui Docker.


## 33. Future Extensions

- Remote cloud access.

- Cloud backup.

- Multi-user penuh.

- Barcode scanning.

- PWA install.

- AI Assistant untuk query dan analisis.

- Forecast kebutuhan sparepart.

- Notifikasi stok minimum.

- Integrasi printer/label.


## 34. Final Product Principle

LOCAL-FIRST  •  LAN-READY  •  DATA-CONSISTENT  •  AUDITABLE  •  MANAGEMENT-FOCUSED

Aplikasi harus memprioritaskan integritas data operasional. Inventory, audit stok, laporan, dan KPI harus berasal dari sumber data yang konsisten. Fitur baru tidak boleh mengorbankan kemudahan operasional atau membuat user harus melakukan pencatatan yang sama berulang kali.
