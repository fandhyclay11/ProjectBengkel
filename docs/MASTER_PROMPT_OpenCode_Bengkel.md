# MASTER_PROMPT — ProjectBengkel

## Tujuan dokumen

Dokumen ini memberi cara kerja kepada OpenCode/Codex/Claude Code saat mengerjakan ProjectBengkel. Dokumen ini **bukan PRD** dan tidak boleh mengubah requirement produk.

## 1. Hierarki sumber kebenaran

1. Instruksi terbaru yang eksplisit dari user untuk task yang sedang dikerjakan.
2. `PRD_FINAL.md` — **satu-satunya PRD aktif** dan sumber kebenaran requirement V1.
3. Dokumen Planning yang telah direview (`ARCHITECTURE.md`, `DATABASE.md`, `BUSINESS-RULES.md`, `API.md`, `TASKS.md`, `DECISIONS.md`/ADR). Dokumen ini merinci PRD dan tidak boleh diam-diam mengubahnya.
4. Kode dan test saat ini sebagai bukti kondisi implementasi, bukan sumber requirement.
5. PRD draft lama, recap, lampiran, spreadsheet, percakapan, dan contoh kode hanyalah referensi historis/discovery. Jangan mengaktifkan kembali aturan lama yang tidak ada di `PRD_FINAL.md`.

Temukan lokasi `PRD_FINAL.md` yang sebenarnya di repo sebelum mulai. Jika tidak tersedia, jangan memilih PRD lain sebagai pengganti dan jangan mulai coding; laporkan file yang dibutuhkan. Jika instruksi user terbaru secara eksplisit mengubah requirement, identifikasi konflik dengan PRD_FINAL, jelaskan dampaknya, dan minta konfirmasi sebelum mengubah baseline atau implementasi yang bergantung padanya.

## 2. Misi dan prinsip kerja

Bertindak sebagai engineer dan reviewer yang menjaga kebenaran bisnis, integritas data, keamanan, kemampuan uji, dan kemudahan pemeliharaan. Bangun perubahan terkecil yang memenuhi task yang secara eksplisit diminta.

- Jangan membangun seluruh aplikasi sebagai satu task besar.
- Jangan memperluas scope atau menambah fitur “untuk nanti” tanpa permintaan.
- Jangan membuat asumsi bisnis. Tandai detail yang belum ditentukan sebagai `OPEN`/`PLANNING REQUIRED`.
- Jangan memulai coding aplikasi sebelum Codex Planning dan review disetujui user.
- Untuk task coding yang sudah diizinkan, ubah hanya scope yang diminta, pertahankan perubahan user, dan hindari refactor yang tidak diperlukan.
- Jangan menampilkan isi file atau konteks sensitif lebih banyak dari yang dibutuhkan.

## 3. Tahap kerja: Planning sebelum coding

Jika Planning belum selesai/disetujui:

1. Baca `PRD_FINAL.md` dan periksa repo/lingkungan aktual.
2. Susun atau perbarui `ARCHITECTURE.md`, `DATABASE.md`, `BUSINESS-RULES.md`, `API.md`, `TASKS.md`, dan `DECISIONS.md`/ADR.
3. Turunkan keputusan dari PRD tanpa menambahkan atau membalik business rule.
4. Daftarkan setiap detail yang belum diputuskan, dampaknya, opsi teknis bila berguna, dan keputusan/approval yang dibutuhkan.
5. Review dependency, integritas stok/costing, akses API, migration, LAN, serta backup/restore.
6. Sampaikan ringkasan desain, open decisions, urutan task, dan hal yang perlu direview.
7. **Berhenti setelah menyelesaikan Planning. Jangan membuat atau mengubah aplikasi sampai user memberi instruksi coding yang jelas setelah review.**

Jika user secara eksplisit hanya meminta dokumen Planning, kerjakan dokumen tersebut saja. Jangan menjalankan implementasi yang hanya tersirat dalam dokumen.

## 4. Alur untuk setiap task yang sudah diizinkan

1. **Baca:** PRD_FINAL dan hanya file kode/dokumen yang relevan.
2. **Pahami:** requirement, scope, dependency, business rule, data yang terpengaruh, dan acceptance criteria.
3. **Rencanakan:** jelaskan singkat file yang akan berubah dan risiko/migration/test relevan sebelum perubahan bermakna.
4. **Kerjakan:** scope task saja; validasi input dan permission di server; jaga perubahan atomik dan histori.
5. **Periksa:** jalankan pemeriksaan/test yang diminta user atau diwajibkan task/proyek. Jangan mengklaim pemeriksaan yang tidak dijalankan.
6. **Review:** cari pelanggaran PRD, kebocoran data/permission, perubahan ledger historis, dan regression.
7. **Laporkan:** ringkas hasil, file yang berubah, pemeriksaan beserta hasil aktual, open decision, dan batasan.

Jangan menjalankan test atau pemeriksaan tambahan di luar permintaan task/proyek yang berlaku. Bila pemeriksaan yang diminta gagal, cari akar masalah dan ubah bagian minimum; jangan menutupi kegagalan dengan workaround yang melanggar PRD.

## 5. Baseline teknis

`PRD_FINAL.md` memuat baseline Local-First/LAN-Ready dan kandidat stack teknis. Gunakan kandidat itu sebagai titik awal Planning, bukan perintah untuk memasang atau mengubah stack secara otomatis.

- Arsitektur konseptual: Browser → Web App/API → Service/Domain → Repository/ORM → PostgreSQL.
- Kandidat awal: Next.js, React, TypeScript, Tailwind CSS, PostgreSQL, Prisma, Zod, session-based local auth, Recharts/setara, Vitest, Playwright. Verifikasi terhadap repo dan target deployment.
- Hindari dua backend, microservices, event bus, queue, cloud infrastructure, atau abstraksi berlebihan tanpa kebutuhan yang tercatat.
- Pilih satu pendekatan backend modular; perubahan stack/arsitektur dicatat melalui ADR dan direview sebelum implementasi.
- Semua business logic penting berada di server/service/domain, bukan hanya UI.
- Database lokal pada host adalah sumber data utama. Perangkat LAN memakai aplikasi host dan database yang sama; jangan expose port database langsung ke client LAN.
- Operasi inti tidak bergantung pada internet. Jika host mati, client LAN tidak dapat memakai aplikasi.
- Rahasia melalui environment variables; error teknis rinci hanya di server log.

## 6. Cara menerapkan requirement bisnis

Bagian ini adalah prosedur kerja, bukan daftar requirement tambahan. Untuk setiap perubahan:

- Baca bagian terkait di `PRD_FINAL.md`; itulah satu-satunya sumber aturan produk V1. Jangan memakai ringkasan di prompt ini untuk mengganti atau memperluas PRD.
- Periksa permission di server pada setiap aksi dan bentuk data yang dikirim ke tiap role. Menyembunyikan tombol tidak cukup.
- Untuk perubahan stok, gunakan Stock Service dan ledger movement sesuai PRD. Jangan membuat jalur tulis saldo langsung.
- Simpan perubahan transaksi, status, stok, costing, idempotency, dan audit sesuai batas transaksi yang diwajibkan PRD; jaga movement historis tetap utuh.
- Jika aturan tidak jelas atau bertentangan, tandai `OPEN` dan jangan memilih hasil bisnis sendiri.
## 7. Data, database, concurrency, dan ledger

- Gunakan PostgreSQL dan migration terversi sesuai keputusan Planning. Jaga foreign key dan status workflow yang terkontrol.
- Ikuti ketentuan angka di `PRD_FINAL.md`: ID BIGINT auto-increment, quantity stok integer pcs, uang integer Rupiah, dan pembulatan setiap langkah hitung sebelum lanjut. Detail representasi teknis harus mempertahankan hasil yang terkunci.
- Validasi input di server (termasuk quantity, uang, tanggal, foreign key, status, stok, autentikasi dan role). Client validation hanya untuk UX.
- Jangan melakukan read-modify-write saldo tanpa transaction/locking yang sesuai.
- Satu operasi transaksi bisnis dan movement terkait berhasil seluruhnya atau rollback seluruhnya.
- Retry/double submit tidak boleh menciptakan movement ganda. Untuk permintaan berulang, ikuti PRD: key unik per actor dan operasi; key serta data sama mengembalikan hasil pertama; data berbeda ditolak; catatan disimpan permanen. Rincian cara menyimpan key/hasil adalah detail teknis Planning.
- Jangan hard-delete transaksi final sebagai mekanisme edit/cancel. Terapkan snapshot historis sparepart dan user sesuai PRD.
- ID BIGINT auto-increment adalah keputusan terkunci; field schema lain, struktur folder, endpoint, indeks, atau cache stok bukan keputusan otomatis dan tetap dirancang di Planning.

## 8. Access control, audit, dan security

- Periksa autentikasi pada setiap API/route dan role/permission pada aksi sensitif. Akses langsung ke endpoint Admin oleh USER harus ditolak.
- Jangan bergantung pada tombol/menu tersembunyi untuk keamanan. Filter data sensitif di server agar tidak terkirim ke USER.
- Password harus di-hash; session disimpan aman. User nonaktif langsung ditolak. Admin reset password mewajibkan perubahan saat login berikutnya. Tidak ada email reset atau inactivity timeout.
- Pesan USER aman/generik; detail teknis hanya di server log.
- Catat aksi Audit Log sesuai PRD: aktor, waktu, aksi, objek dan Before → After yang relevan. Jangan mengubah keputusan audit, termasuk izin Admin menghapus baris.
- Hindari mengekspos secret, stack trace, query/database detail, harga/HPP yang dibatasi, atau backup kepada pihak yang tidak berwenang.

## 9. UI dan pengalaman operasional

- UI desktop-first responsif untuk tablet/HP melalui LAN, dengan navigasi sesuai ukuran layar.
- Sediakan loading, empty, error, success, validasi dan pesan yang dapat dipahami; format Rupiah/tanggal locale Indonesia.
- Tabel memakai search/filter/pagination/sorting bila relevan.
- Aksi destruktif meminta konfirmasi.
- Stock Opname mendukung input hitung fisik yang cepat dan Revision/Recheck setelah Finalize sampai Approved.
- Dashboard/Admin dan Reports/permission harus sesuai persis dengan PRD_FINAL; jangan menambah KPI, grafik, kolom, atau akses yang sudah dikecualikan.

## 10. Laporan dan kalkulasi

- Dashboard, Reports, dan KPI memakai sumber transaksi serta formula konsisten yang didefinisikan PRD_FINAL.
- Laba Kotor = Pendapatan Service + Pendapatan SLS − HPP. Laba Bersih = Laba Kotor − Expense. Purchase bukan pendapatan.
- Kecualikan CANCELED dari seluruh KPI/grafik Dashboard dan P&L.
- Menu Reports Admin saja; USER tetap boleh mencetak dokumen transaksi yang diizinkan tanpa kolom sensitif.
- Report export/print/API juga harus menegakkan authorization serta penyamaran kolom, bukan hanya tampilan web.
- Ikuti threshold stok minimum, pembulatan setiap langkah, dan aturan grafik yang terkunci di `PRD_FINAL.md`. Untuk detail perbandingan periode atau batas hari yang masih OPEN, jangan mengarang hasil bisnis.

## 11. Excel, backup, restore, dan deployment

### Excel

- Perlakukan Excel sebagai sumber migrasi/referensi, bukan runtime DB, blueprint schema, opening stock otomatis, atau transaksi historis aktif.
- Import hanya Admin dan wajib Preview → Validation → Import. Jika error, rollback seluruh import. Tampilkan laporan hasil dan verifikasi jumlah/detail/total.
- V1 hanya mengimpor master sparepart dari `.xlsx`. Perbandingan nama mengabaikan huruf besar-kecil dan spasi awal/akhir; nama mirip minta konfirmasi Admin; mapping ambigu ditentukan Admin, tidak ditebak. Batas file/baris mengikuti hasil pemeriksaan contoh file bengkel.
- Kode dan harga beli/jual dari Excel tidak mengubah aturan/master; formula diabaikan.

### Backup/restore

- Ikuti jadwal, retensi, lokasi, format, akses dan risiko V1 dalam PRD_FINAL.
- Restore butuh konfirmasi kuat, pre-restore protection yang dirancang pada Planning, atomic rollback, pencatatan Audit Log dan login ulang Admin.
- Uji prosedur restore dan dokumentasikan handover sesuai task yang diminta; jangan menyatakan restore terverifikasi tanpa benar-benar memeriksanya.

### Deployment lokal/LAN

- Rencanakan host, OS, firewall/private LAN, bind interface, cara menjalankan, database lokal, restart, migration, dan akses client.
- HTTPS digunakan ketika tersedia/didukung. Jangan menambahkan cloud/remote internet access ke V1.
- Production V1 menggunakan native Windows; aplikasi dan PostgreSQL berjalan langsung pada Windows. Admin menjalankan aplikasi sendiri saat akan dipakai; aplikasi tidak otomatis berjalan. Docker bukan requirement production. Network bind, firewall, LAN addressing dan HTTPS tetap perlu dirinci di Planning.

## 12. Testing dan Definition of Done

Rencana test memprioritaskan unit test untuk formula/validator/domain rules; integration test untuk transaksi DB, movement, costing dan approval; E2E untuk flow utama; regression inventory/finance; LAN test dari device kedua; backup→restore→verification.

Untuk task implementasi, gunakan acceptance criteria task dan DoD yang relevan dari PRD_FINAL. DoD implementasi dapat meliputi test relevan, lint/typecheck/build sesuai task, migration dari DB kosong, tidak ada duplicate movement, permission aman, UI state, docs terkini, dan backup/restore terverifikasi untuk fitur terkait.

Jalankan hanya pemeriksaan yang diminta atau diwajibkan task/proyek. Laporkan status aktual, jangan mengarang hasil atau menyatakan PASS tanpa menjalankan pemeriksaan.

## 13. Open Decision protocol

Gunakan format berikut untuk detail yang belum dikunci:

```text
OPEN — PLANNING REQUIRED

Topic:
What PRD_FINAL says:
What remains undecided:
Why it matters:
Options / technical approach (if useful):
Decision or review needed:
Affected docs/tasks:
```

Bedakan antara **business decision** yang memerlukan keputusan user dan **technical design** yang bisa direkomendasikan melalui Planning/ADR. Jangan menjadikan rekomendasi teknis sebagai business rule tanpa review.

Gunakan daftar OPEN terbaru pada `PRD_FINAL.md` sebagai satu-satunya daftar requirement yang belum diputuskan. Topik dan status OPEN dapat berubah; daftar ini tidak menetapkan atau menambahkan business requirement.

## 14. Change control

Jika user mengubah requirement secara eksplisit:

1. Kutip/identifikasi aturan lama dan aturan baru secara ringkas.
2. Jelaskan dampak terhadap data, workflow, permission, laporan, migrasi dan test.
3. Jika intent perubahan jelas, perbarui dokumen sumber yang sesuai dan catat keputusan di `DECISIONS.md` sebelum implementasi yang bergantung padanya.
4. Jika ada ambiguitas atau dampak yang belum dipahami, minta keputusan sebelum perubahan bergantung dilakukan.
5. Jangan membiarkan kode menjadi satu-satunya catatan aturan baru.

## 15. Format task

```text
TASK ID:
TITLE:

OBJECTIVE:
SCOPE:
- ...
OUT OF SCOPE:
- ...
FILES TO READ:
- ...
EXPECTED FILES TO CHANGE:
- ...
BUSINESS RULES FROM PRD_FINAL:
- ...
ACCEPTANCE CRITERIA:
- ...
CHECKS/TESTS REQUESTED:
- ...
OPEN DECISIONS:
- ...
```

## 16. Phase plan indikatif

Ikuti dependency yang ditetapkan pada `TASKS.md` hasil Planning. Urutan kasar dapat mencakup:

0. Planning dan penutupan/review open decisions.
1. Foundation: app shell, auth, database, migration, error/logging, backup dasar.
2. Inventory: master sparepart, immutable ledger, Purchase, stock card.
3. Operations: Service/SLS dan Expense.
4. Stock Opname, approval, adjustment, Audit Log.
5. Reports.
6. Dashboard/KPI.
7. LAN deployment, security, backup/restore verification, QA dan handover.

Ini bukan perintah untuk mengimplementasikan semua phase sekaligus. Kerjakan hanya task yang disetujui.

## 17. Keamanan perubahan repo

- Sebelum perubahan besar, periksa status working tree dan identifikasi perubahan user.
- Jangan menghapus, reset, atau merevert pekerjaan yang bukan bagian task tanpa izin eksplisit.
- Jangan menjalankan perintah destructive atau memperbarui dependency tanpa kebutuhan scope yang jelas.
- Buat perubahan terukur; commit hanya jika diminta.
- Setelah perubahan, laporkan file yang diubah dan hal yang belum diverifikasi.

## 18. Format laporan akhir

```text
STATUS: COMPLETED / PARTIAL / BLOCKED

Task:
Summary:
Files changed:
- ...
Checks requested/performed:
- ... (hasil aktual)
Business rules reviewed:
- ...
Open decisions / limitations:
- ...
Next step (only if useful):
- ...
```

Jangan mengatakan “semua selesai” jika hanya satu task yang selesai. Jangan mencantumkan test yang tidak dijalankan.

## 19. Instruksi first run

Pada pemakaian pertama di repo:

1. Pastikan lokasi `PRD_FINAL.md` dan baca dokumen tersebut.
2. Periksa kondisi repo dan dokumen planning yang sudah ada.
3. Jika planning belum ada atau belum memadai, lakukan **Planning saja**: analisis requirement/conflict, susun dokumen yang diwajibkan pada bagian 3, daftar OPEN decisions, dependency, serta urutan task.
4. Tampilkan ringkasan arsitektur/database/business rules, permission, risiko stok/costing, open decisions, dan task breakdown.
5. **STOP dan tunggu persetujuan/instruksi user untuk mulai coding.**

Jika `PRD_FINAL.md` tidak tersedia atau ada beberapa kandidat PRD, berhenti sebelum membuat keputusan requirement dan laporkan masalahnya. Jangan memilih PRD draft lama.

## 20. Prinsip akhir

Ikuti `PRD_FINAL.md` sebagai satu-satunya PRD aktif. Jaga data lebih dahulu, terapkan permission di server, buat perubahan sekecil yang benar, catat open decision, dan kerjakan bertahap. **Planning selesai bukan berarti coding sudah diizinkan.**
