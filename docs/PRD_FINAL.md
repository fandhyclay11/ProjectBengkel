# PRD_FINAL — Sistem Manajemen Operasional Bengkel

**Versi:** V1 requirement baseline  
**Status:** Final untuk Codex Planning  
**Produk:** ProjectBengkel  
**Tanggal:** 27 September 2026

> **Dokumen ini adalah satu-satunya PRD aktif dan sumber kebenaran requirement V1.** Keputusan bisnis pada bagian 2–6 berlaku di atas catatan atau aturan bisnis pada dokumen lama, lampiran, percakapan, dan contoh implementasi. Baseline teknis serta workflow pada bagian 7–15 menjadi acuan Codex Planning; perubahan stack atau arsitektur harus dijelaskan dalam ADR dan disetujui sebelum implementasi. Hal berstatus **OPEN** wajib diselesaikan atau dicatat sebagai keputusan yang menunggu review pada fase planning. Jangan mengisi kekosongan dengan asumsi bisnis.

Dokumen ini menggabungkan keputusan bisnis terbaru dari `MASTER_RECAP_FINAL.md` dan detail teknis yang tetap relevan dari `PRD_Detail_Sistem_Management_Operasional_Bengkel.docx`. Recap dan PRD lama adalah bahan sumber, bukan PRD aktif paralel. Aturan lama yang bertentangan sengaja tidak diberlakukan kembali.

## 1. Tujuan dan konteks produk

ProjectBengkel adalah aplikasi web untuk mengelola operasional bengkel, inventory, service, penjualan sparepart, purchase, biaya operasional, stock opname, laporan, audit, serta backup/restore. Aplikasi menggantikan pencatatan manual terpisah dan menyediakan satu sumber data yang konsisten.

Prinsip produk:

- **Local-First:** operasi V1 berjalan pada komputer host lokal dan tidak bergantung pada koneksi internet.
- **LAN-Ready:** perangkat lain di jaringan lokal, termasuk HP/tablet, dapat menggunakan aplikasi dan database yang sama melalui host.
- **Data-consistent:** saldo stok bersumber dari ledger movement; angka Dashboard dan Reports memakai definisi yang sama.
- **Traceable:** transaksi, status, pelaku, costing saat transaksi, dan koreksi historis tetap dapat ditelusuri sesuai aturan di dokumen ini.
- **Responsive:** antarmuka desktop-first, tetap dapat dipakai pada tablet dan HP.
- **Mata uang:** Rupiah; nominal uang merupakan bilangan bulat tanpa pecahan. Presisi quantity tertentu masih OPEN.

## 2. Ruang lingkup V1

### Termasuk

- Login lokal, role `ADMIN` dan `USER`, pengelolaan user dan permission.
- Master sparepart dan stok kini.
- Service bengkel, SLS (penjualan sparepart), Purchase, Operational Expense.
- Stock movement immutable ledger dan Stock Opname dengan revision, review, approval, adjustment.
- Dashboard Admin, Reports, print/PDF/Excel.
- Audit Log dan kontrol akses server-side.
- Backup manual/terjadwal, restore, dan migrasi data Excel melalui alur terkontrol.
- Akses browser dari komputer host dan perangkat pada LAN.

### Di luar V1

CRM pelanggan, booking, loyalty, marketplace, payment gateway, aplikasi native Android/iOS, akses jarak jauh melalui cloud/internet, sinkronisasi offline-online multi-device yang kompleks, serta AI assistant sebagai fitur inti. Fitur masa depan dapat dipertimbangkan tanpa mengubah baseline ini.

## 3. Aktor dan permission

- **ADMIN:** akses Dashboard dan Reports; mengelola user, backup/restore, seluruh transaksi, master sparepart dan keputusan yang secara khusus diberikan kepada Admin.
- **USER:** semua USER memiliki permission standar yang sama; tidak ada permission custom per user.
- Setiap API/route memeriksa autentikasi dan authorization di server. Menyembunyikan menu di UI saja tidak cukup.
- USER dapat melihat histori transaksi lintas user. Ini tidak memberikan akses pada kolom sensitif: USER tidak boleh melihat harga beli, harga jual master, Average Cost/HPP, Inventory Value, Stock Movement History, Audit Log, Dashboard, atau menu Reports. Terapkan pembatasan juga pada API, detail, print, dan export.
- USER boleh melihat daftar sparepart dan stok kini, tetapi tidak dapat menambah/mengedit master atau mengubah status aktif.
- Hak spesifik Purchase Draft dan Expense hanya Admin, meskipun catatan permission umum lama menyebut USER boleh membuat keduanya.

## 4. Requirement fungsional dan aturan bisnis final

### 4.1 Service

- ADMIN dan USER dapat membuat Service; satu transaksi dapat berisi jasa/pekerjaan dan beberapa sparepart. Service tanpa sparepart tetap menghasilkan pendapatan jasa.
- Tanggal transaksi boleh hari ini atau lampau, tidak boleh tanggal mendatang. Nomor otomatis. Mengedit tanggal tidak mengubah nomor awal.
- Pengeluaran stok diblokir bila stok tidak cukup.
- HPP memakai Average Cost saat transaksi dibuat dan disimpan pada transaksi. Service menyimpan HPP total transaksi; detail sparepart tetap disimpan.
- Diskon mengurangi pendapatan yang dilaporkan dan digunakan dalam perhitungan laba.
- USER tidak boleh mengedit Service Completed atau membatalkannya. ADMIN boleh mengedit Completed; perubahan menampilkan Before → After dan diaudit. Batas jumlah edit Service masih OPEN.
- Cancel mempertahankan transaksi `CANCELED`, movement awal, dan membuat reversal movement. Stok kembali berdasarkan HPP yang tersimpan pada transaksi.
- USER boleh mencetak dokumen Service yang memang dapat diaksesnya.

### 4.2 SLS (penjualan sparepart)

- ADMIN dan USER dapat membuat SLS. Stok dikurangi dan transaksi diblokir bila stok tidak cukup.
- HPP menggunakan Average Cost saat transaksi dibuat, dicatat pada transaksi, dan tidak mengubah Average Cost. Diskon mengurangi pendapatan.
- Tanggal boleh hari ini/lampau dan tidak boleh mendatang. Nomor otomatis tetap ketika tanggal diedit.
- USER tidak boleh mengedit SLS Completed atau cancel; ADMIN boleh mengedit Completed dengan Before → After dan Audit Log. Batas jumlah edit masih OPEN.
- Cancel menyimpan transaksi berstatus `CANCELED`, mempertahankan movement asli, membuat reversal, dan mengembalikan stok berdasarkan HPP yang tersimpan.
- USER boleh mencetak dokumen SLS yang memang dapat diaksesnya.

### 4.3 Purchase

- Purchase memiliki Draft → Confirm/Completed. Hanya ADMIN dapat membuat, mengelola, mengedit, atau menghapus Draft.
- Confirm bersifat atomic/all-or-nothing. Draft tidak memengaruhi stok atau HPP.
- Purchase Completed menambah stok dan menghitung ulang Average Cost dari posisi stok/nilai yang berlaku serta harga beli aktual per item. Purchase boleh masuk ketika stok negatif; penerimaan terlebih dahulu menutup stok minus, kemudian menambah saldo positif jika ada sisa.
- Tanggal boleh hari ini/lampau dan tidak boleh mendatang. Nomor otomatis tetap jika tanggal diubah.
- ADMIN boleh mengedit Purchase Completed satu kali; USER tidak boleh mengeditnya. Edit jumlah/harga menghitung ulang costing, tetapi movement lama immutable dan koreksi stok dicatat dengan movement baru.
- Cancel mempertahankan transaksi `CANCELED`, membuat reversal movement, dan menghitung ulang Average Cost.
- USER boleh mencetak dokumen Purchase yang boleh diaksesnya, tanpa melihat harga beli.

### 4.4 Operational Expense

- ADMIN saja dapat membuat, mengedit Completed, dan membatalkan Expense. Tidak ada Draft: preview, lalu simpan langsung sebagai Completed.
- Transaksi memiliki satu atau beberapa item: deskripsi, quantity positif (boleh desimal), harga satuan Rupiah bulat, total item otomatis `quantity × harga`, total transaksi otomatis dijumlahkan. Nilai Rp0 tidak diizinkan; catatan umum opsional.
- Tidak ada kategori/master kategori biaya, metode pembayaran, atau nama penerima/vendor pada V1. Nomor bukti eksternal opsional. Expense tidak memengaruhi stok dan masuk ke biaya operasional/laba rugi.
- Tanggal hari ini/lampau, bukan mendatang. Format nomor awal `EXP-YYYYMMDD-0001`.
- Edit menampilkan Before → After dan diaudit. Alasan edit/cancel tidak wajib. Edit tanggal dapat memengaruhi nomor menurut keputusan lama, sedangkan keputusan final terbaru belum secara eksplisit mengatur nomor Expense: statusnya **OPEN**, jangan disamakan otomatis dengan Service/SLS/Purchase.
- Cancel berstatus `CANCELED`, tidak dapat diaktifkan kembali, tidak dihitung sebagai biaya dan tidak ditampilkan di Expense History atau laporan bisnis. Aktivitas cancel tetap diaudit; kebutuhan akses administratif terhadap record yang dibatalkan dirinci pada Planning.

### 4.5 Stock Opname (SO)

- Saat SO dibuat, System Stock diambil otomatis pada saat pembuatan.
- USER dapat membuat SO dan melakukan Revision/Recheck. Hanya ADMIN dapat Finalize, Approve, atau Reject.
- Setelah Finalize, Physical Stock dan revisi **masih boleh diubah**. Setelah Approved, SO final dan tidak boleh diedit, direvisi, atau dibatalkan. Kesalahan sesudahnya ditangani dengan SO baru.
- Reject mengembalikan SO ke Revision/Recheck.
- Selisih positif menghasilkan `ADJUSTMENT_IN`; selisih negatif menghasilkan `ADJUSTMENT_OUT`. Adjustment baru diterapkan saat approval.
- Finalize/Approve/Reject serta pelaku approval/rejection diaudit. Movement mencatat adjustment yang benar-benar diterapkan. Cost adjustment menggunakan Average Cost saat approval.

### 4.6 Sparepart dan identitas historis

- Kode sparepart otomatis dan unik (misalnya `SP001`) serta tidak pernah digunakan kembali meskipun sparepart dihapus.
- ADMIN mengelola master. USER tidak dapat menambah, mengedit, atau mengubah status aktif.
- Sparepart yang pernah dipakai boleh dihapus. Histori transaksi tetap menyimpan snapshot nama dan kode sehingga histori tidak rusak. Bentuk penghapusan, FK, dan snapshot setiap detail transaksi harus dirancang saat Planning.
- User yang dinonaktifkan tidak dapat login/akses. User dinonaktifkan, bukan dihapus; nama dan transaksi historisnya tetap ada.

### 4.7 HPP dan Average Cost

- Metode V1 adalah Average Cost; harga beli terakhir merupakan data master terpisah, bukan HPP rata-rata.
- Purchase Completed menghitung weighted average dari nilai inventory dan quantity yang berlaku dengan mempertimbangkan pembelian. Purchase Draft tidak memengaruhi HPP.
- Service/SLS menggunakan Average Cost saat transaksi terjadi dan menyimpan HPP agar transaksi historis tidak berubah diam-diam. Pengeluaran Service/SLS tidak mengubah Average Cost.
- SO adjustment memakai Average Cost pada waktu approval. Inventory Value tersedia untuk Admin sebagai stok × Average Cost; tidak ditampilkan sebagai KPI Dashboard.
- Rekalkulasi saat Purchase diedit/dibatalkan dan kasus saldo negatif akibat data awal/adjustment harus menjaga ledger immutable serta HPP transaksi lama.
- Formula pembulatan weighted average, presisi HPP internal, serta mekanika saldo negatif masih perlu ditetapkan pada Planning tanpa mengubah keputusan bisnis di atas.

### 4.8 Stock movement ledger

- `stock_movements` adalah source of truth pergerakan stok dan immutable. Movement lama tidak diedit atau dihapus oleh alur bisnis.
- Perubahan transaksi Completed yang berdampak pada stok menghasilkan movement baru untuk delta/koreksi. Contoh: Purchase +10 dikoreksi menjadi +15 berarti movement +10 tetap dan movement koreksi +5 dibuat.
- Cancel mempertahankan movement asli dan membuat reversal movement.
- Confirm Purchase, confirm transaksi stok, dan approval adjustment harus atomik. Saldo stok tidak boleh diubah langsung oleh modul lain di luar layanan stok/domain yang ditetapkan saat Planning.
- Movement sekurangnya terkait waktu, tipe, quantity, objek/transaksi sumber, dan cost yang dibutuhkan untuk rekonsiliasi. Field persisnya OPEN.
- USER tidak dapat melihat Stock Movement History. Laporan movement hanya Admin dan dapat difilter menurut sparepart.

### 4.9 Dashboard dan keuangan

- Dashboard hanya untuk ADMIN; USER tidak memiliki Dashboard.
- KPI: Pendapatan Service, Pendapatan SLS, Laba Kotor, Laba Bersih, jumlah Service, jumlah SLS, Purchase Completed, jumlah Purchase Draft belum Confirm, sparepart stok menipis, dan stok minus.
- Tidak ada KPI terpisah untuk Total Expense, Total HPP, Inventory Value, jumlah CANCELED, atau SO dalam proses.
- Grafik: Pendapatan Service dan SLS bersama; grafik Laba Kotor; tanpa grafik Expense. Default per hari, periode panjang dapat diringkas per bulan. Semua mengikuti filter periode.
- Monitoring mencakup sparepart stok menipis/minus yang dapat dibuka ke detail dan aktivitas/transaksi terbaru. Periode default bulan berjalan dengan Hari Ini/Minggu Ini/Bulan Ini/Custom dan rentang Dari–Sampai. Dashboard diperbarui sesudah transaksi tersimpan. Klik KPI pendapatan membuka laporan terkait.
- **Laba Kotor = Pendapatan Service + Pendapatan SLS − HPP.** **Laba Bersih = Laba Kotor − Expense.** Purchase bukan pendapatan. Service tanpa sparepart tetap termasuk pendapatan. Diskon sudah mengurangi pendapatan.
- Semua transaksi `CANCELED` dikeluarkan dari seluruh KPI/grafik Dashboard dan P&L. Expense `CANCELED` tidak dihitung.

### 4.10 Reports dan dokumen cetak

- Menu Reports hanya ADMIN. V1 mencakup Service, SLS, Purchase, Operational Expense, stok/master sparepart, Stock Movement, hasil Stock Opname, dan Laba/Rugi.
- Laporan transaksi menggunakan rentang tanggal Dari–Sampai. Filter tambahan: Service berdasarkan nomor, Stock Movement berdasarkan sparepart. Tidak wajib filter kendaraan, sparepart SLS, supplier Purchase, atau nomor Expense.
- Isi minimum: Service—nomor/tanggal/kendaraan/pekerjaan; SLS—sparepart dan quantity; Purchase—sparepart dan harga beli aktual; Expense—nomor/tanggal/item/nominal; stok—harga jual master/harga beli terakhir/stok kini/stok minimum; Movement—waktu/jenis/quantity; SO—nomor OPN/tanggal/System Stock sebelum opname/Physical Stock terakhir/selisih/adjustment diterapkan; P&L—Pendapatan Service, Pendapatan SLS, HPP, Expense.
- Semua laporan menyediakan Print, PDF, dan Excel. Header memuat identitas bengkel, periode, dan waktu pembuatan laporan.
- USER tidak membuka Reports, tetapi boleh mencetak dokumen Service/SLS/Purchase yang boleh diaksesnya. Kolom sensitif harus dikecualikan untuk USER dari tampilan, API, print, dan ekspor.

### 4.11 User, login, dan Audit Log

- Login username/password lokal. Password di-hash; tersedia ubah password. ADMIN dapat reset password USER dan USER wajib mengganti password pada login berikutnya. Tidak ada reset password via email.
- Admin tidak dapat menonaktifkan Admin lain atau dirinya sendiri. Tidak ada inactivity timeout. Sediakan Logout. USER nonaktif langsung ditolak.
- Error yang diterima USER aman/generik; detail teknis hanya pada server log. Gunakan HTTPS ketika tersedia/didukung.
- Audit Log mencatat aksi sensitif dengan pelaku, waktu, jenis aksi, objek, dan Before → After untuk perubahan penting. Catat login gagal, create/edit/cancel transaksi penting, Finalize/Approve/Reject SO, perubahan master dan harga, akses yang ditolak karena permission, serta backup/restore gagal/sukses sesuai konteks.
- Login berhasil dan Logout normal tidak dicatat. Aksi alasan tidak wajib secara umum; perubahan note Expense saja tidak wajib dicatat. Approval/reject SO mencatat Admin pelaku.
- Audit Log hanya dapat dilihat Admin. Baris Audit Log tidak boleh diedit, tetapi Admin boleh menghapusnya. Ini keputusan final dengan risiko integritas yang harus ditangani di Planning; aksi penghapusan perlu tetap dapat diaudit jika dapat dilakukan tanpa membatalkan hak Admin tersebut.
- Perubahan stok akibat edit/cancel tidak wajib memiliki catatan tambahan di Audit Log; jejak koreksi tetap tercatat pada immutable stock ledger dan aksi bisnisnya diaudit.

### 4.12 Backup dan restore

- ADMIN saja dapat melakukan backup/restore. V1 menyediakan backup manual dan otomatis terjadwal. Format mencakup PostgreSQL dan Excel. Tidak ada tombol Download Backup.
- Backup otomatis mingguan, retensi 30 hari, nama berbasis timestamp, disimpan pada server yang sama dan tidak wajib dienkripsi. Ini risiko V1 yang diterima dan harus didokumentasikan.
- Backup gagal dicatat di Audit Log dan memberi indikator/peringatan kepada Admin.
- Restore dapat menggunakan backup sistem atau PostgreSQL eksternal; perlu konfirmasi kuat dan peringatan bahwa data akan ditimpa. Restore dicatat di Audit Log dan harus atomic: bila gagal, database kembali seperti sebelum restore. Admin login kembali setelah restore.
- Validasi dump eksternal, kompatibilitas versi, lokasi/operasional jadwal dan mekanisme atomic restore dirinci di Planning.

### 4.13 Migrasi Excel

- Hanya Admin. Wajib melalui **Preview → Validation → Import**. Jika ada error, seluruh import batal. Simpan laporan hasil termasuk berhasil, error, warning, dan detail.
- Nama sparepart yang persis cocok dipetakan otomatis. Nama mirip memberi warning dan meminta konfirmasi. Sparepart baru ditampilkan dalam daftar untuk konfirmasi Admin.
- Abaikan kode sparepart Excel; sistem membuat kode otomatis. Harga beli/jual Excel hanya referensi dan tidak mengubah master. Formula Excel diabaikan; gunakan hanya data yang dapat divalidasi.
- Jika mapping ambigu, Admin harus menentukan mapping; sistem tidak menebak.
- Stok Excel hanya referensi; opening stock dimasukkan manual. Transaksi historis Excel hanya referensi, bukan transaksi aktif hasil impor. Beberapa sparepart dari satu Service tetap menjadi detail dalam satu Service.
- Setelah import, verifikasi jumlah transaksi/detail dan total penting. Excel bukan blueprint database atau sumber kebenaran stok awal.

## 5. Tanggal, nomor, status, dan pembatalan

- Service/SLS/Purchase: tanggal hari ini/lampau, bukan future; nomor otomatis dan tetap nomor awal ketika tanggal diedit.
- Expense: format awal `EXP-YYYYMMDD-0001`; dampak edit tanggal terhadap nomor **OPEN**.
- Status `CANCELED` tetap disimpan untuk Service/SLS/Purchase; movement asli tetap, reversal ditambahkan. CANCELED dikeluarkan dari Dashboard dan P&L. Expense CANCELED tidak tampil pada Expense History/laporan bisnis dan tidak berbiaya, tetapi jejak audit tetap ada.
- System harus mempertahankan nama user serta snapshot sparepart historis ketika akun dinonaktifkan atau master sparepart dihapus.

## 6. Kebutuhan UI dan validasi

- Responsif desktop-first untuk desktop, tablet, dan HP; navigasi sesuai ukuran layar.
- Tabel menyediakan pencarian, filter, pagination, dan sorting bila relevan.
- Form memiliki validasi sisi server (validasi client untuk UX saja), pesan yang jelas, status badge konsisten, dialog konfirmasi untuk aksi destruktif, serta loading/empty/error/success state.
- Tampilan Rupiah dan tanggal mengikuti locale Indonesia.
- Audit stok mendukung input hitungan fisik dengan cepat.
- Kesalahan teknis tidak membocorkan stack trace/database error kepada USER; detail tersedia pada server log.

## 7. Technical baseline untuk Codex Planning

Baseline berikut dipindahkan dari PRD teknis lama dan masih relevan. Ini panduan planning, bukan keputusan bisnis baru atau izin langsung untuk coding.

### Arsitektur dan stack awal

- Alur konseptual: **Browser → Web App/API → Service Layer → Repository/ORM → PostgreSQL**.
- Semua perubahan stok melewati domain/service stok. UI/API tidak mengubah saldo secara langsung.
- Kandidat stack: Next.js + React + TypeScript; Tailwind CSS + component library ringan; Node/Next server API modular (satu backend saja); PostgreSQL; Prisma; Zod; session-based local auth; Recharts atau setara; Vitest dan Playwright.
- Kandidat stack harus diverifikasi terhadap lingkungan target pada Planning. Alternatif atau perubahan harus punya ADR dengan alasan, dampak, dan implikasi operasional sebelum implementasi.
- Docker Compose boleh dipertimbangkan sebagai packaging lokal; keputusan deployment final OPEN.

### Database dan domain

- PostgreSQL lokal pada host adalah persistent source of truth; perangkat LAN mengakses database yang sama melalui aplikasi host dan tidak membuat database utama kedua.
- Gunakan PK konsisten (UUID atau pilihan lain yang diputuskan Planning), foreign key, enum/status terkontrol, timestamp created/updated, dan created_by/updated_by yang relevan.
- Gunakan numeric/decimal untuk uang dan tipe quantity sesuai presisi yang diputuskan; jangan gunakan floating point untuk uang.
- Transaksi final tidak dihapus sebagai cara koreksi. Migration database harus berversi dan aman dijalankan.
- Struktur domain disarankan memisahkan UI, route/API (auth, authorization, validasi), services/use cases, domain rules, repository/ORM, database, Audit Log, dan Backup Service. Struktur folder konkret diputuskan saat Planning.
- Entity awal yang perlu dimodelkan: users, spare_parts, service header/details, SLS header/details, purchases/items, expenses/items, stock_movements, stock opname/items/adjustments, audit_logs. Ini kandidat domain, bukan schema final. Hindari mengaktifkan kembali model role Management/Operator atau aturan kategori Expense lama.

### Concurrency, atomicity, dan idempotency

- Simpan konfirmasi Service/SLS, Purchase Confirm, SO approval+adjustment, dan movement terkait dalam transaksi database atomik.
- Hindari pola read-modify-write saldo tanpa transaction/locking yang sesuai. Dua request bersamaan pada sparepart yang sama tidak boleh menghasilkan saldo/movement yang tidak konsisten.
- Confirm/idempotency harus mencegah double-click atau retry menghasilkan movement duplikat. Rancang kunci/idempotency dan respons retry pada Planning.
- Semua validasi kuantitas, nominal (bukan NaN/Infinity), foreign key, status workflow, stok cukup, dan permission ditegakkan server-side.

### Local-First dan LAN behavior

- Operasi inti—login, transaksi, inventory, purchase, expense, SO, laporan, dan backup lokal—tetap dapat dipakai saat internet mati.
- Host menjalankan aplikasi dan database lokal; aplikasi dapat menerima koneksi LAN pada interface yang sesuai. HP/komputer lain mengakses alamat LAN host dan menggunakan database yang sama.
- Perubahan dari perangkat LAN terlihat pada perangkat lain setelah request selesai. Jika host mati, perangkat lain tidak dapat mengakses aplikasi.
- Batasi akses LAN ke private network bila dapat dilakukan; jangan expose port database ke LAN bila tidak diperlukan. Spesifikasi OS/host, firewall, HTTPS dalam LAN, dan provisioning jaringan perlu dirinci.

### Security dan konfigurasi

- Simpan session/token dengan mekanisme aman; rahasia konfigurasi lewat environment variables.
- Authorization server-side; endpoint sensitif memeriksa role/permission. Backup file dibatasi aksesnya.
- Terapkan kebijakan error generik untuk USER seperti keputusan bisnis di atas dan detail diagnostik hanya di server log.

## 8. Testing dan verifikasi penerimaan

Strategi prioritas: unit test untuk formula/validasi/domain rules; integration test untuk transaksi database, ledger, costing, dan approval; E2E untuk alur utama; regression test pada inventory/keuangan; LAN test dari perangkat kedua; serta backup→restore→verifikasi.

Kriteria penerimaan V1:

1. Seluruh fungsi operasional V1 berjalan tanpa internet pada host lokal.
2. Perangkat kedua pada private LAN dapat membuka aplikasi dan berbagi satu database.
3. Service/SLS menolak pengeluaran stok yang tidak cukup; Purchase dapat menerima stok ketika saldo negatif.
4. Purchase Completed menambah stok tepat satu kali; Service/SLS mengurangi tepat satu kali; retry/double submit tidak menciptakan movement duplikat.
5. SO menyimpan snapshot stok saat dibuat, mendukung revision setelah Finalize, tidak mengubah stok sebelum approval, dan membuat adjustment yang sesuai pada approval.
6. Edit stok berdampak menghasilkan movement koreksi baru; cancel menghasilkan reversal; movement lama tidak berubah.
7. Dashboard, Reports, dan KPI menggunakan definisi angka yang sama dan mengecualikan CANCELED sesuai keputusan final.
8. API dan UI menegakkan permission, termasuk penyembunyian harga/HPP untuk USER.
9. Migrasi Excel melakukan preview, validasi penuh, rollback semua jika ada error, dan menyediakan hasil verifikasi.
10. Backup dapat dibuat dan restore dapat diverifikasi; kegagalan restore meninggalkan database seperti semula.
11. Alur UI menyediakan validasi dan state loading/error/empty/success yang dapat dipahami.

Detail matriks kasus uji dan data fixture disusun pada Planning. Kriteria ini bukan hasil pengujian; implementasi belum dimulai.

## 9. Deployment, backup/restore, dan handover

- Target deployment V1 adalah host lokal; Docker Compose merupakan opsi yang harus dipilih atau ditolak pada Planning berdasarkan OS/operasional bengkel.
- Database hanya diakses melalui aplikasi host; layanan harus dapat dimulai ulang dan dokumentasi konfigurasi LAN disediakan.
- Prosedur backup/restore, jadwal mingguan/retensi, verifikasi hasil restore, persyaratan akses Admin, serta skenario pemulihan harus terdokumentasi.
- Restore perlu perlindungan pre-restore dan rollback atomik sesuai keputusan bisnis. Detail mekanisme PostgreSQL eksternal OPEN.
- Handover mencakup cara menjalankan aplikasi, konfigurasi, migrasi database, backup/restore, akses LAN, dan troubleshooting dasar.

## 10. Workflow Codex dan batas Planning

Pekerjaan saat ini adalah **Codex Planning, belum coding aplikasi**. Gunakan alur:

1. Baca `PRD_FINAL.md` ini sebagai satu-satunya PRD aktif.
2. Periksa repo dan lingkungan yang benar; jangan mengasumsikan folder atau aset project yang tidak tersedia.
3. Susun dan review `ARCHITECTURE.md`, `DATABASE.md`, `BUSINESS-RULES.md`, `API.md`, `TASKS.md`, dan `DECISIONS.md`/ADR. Dokumen planning menurunkan kebutuhan ini, tidak menggantikannya atau diam-diam mengubah business rule.
4. Tuntaskan atau tandai OPEN decisions di bagian 11. Catat keputusan teknologi yang berbeda melalui ADR.
5. Sebelum implementasi, review integritas stok/costing, permission/API, migration, backup/restore, LAN deployment, dan task breakdown.
6. Mulai coding hanya setelah planning dan review disetujui secara terpisah.
7. Saat nanti implementasi, kerjakan satu fase/modul per task, baca konteks yang relevan, update dokumentasi dan test terkait, dan jangan mengubah business rule tanpa keputusan tertulis.

## 11. OPEN decisions dan risiko yang wajib dibawa ke Planning

Keputusan yang telah dikunci tetap final. Item berikut adalah detail desain atau celah yang harus diperjelas sebelum implementasi terkait; jangan mengubahnya menjadi aturan bisnis baru tanpa review:

1. **Local deployment:** spesifikasi OS/host, cara service dijalankan, Docker atau native, bind interface, firewall, dan HTTPS LAN.
2. **Database detail:** jenis ID, presisi quantity inventory, rounding weighted average/HPP, dan representasi uang internal.
3. **Saldo negatif:** rekonsiliasi cost/value untuk saldo negatif akibat data awal atau adjustment tanpa mengubah HPP historis atau movement lama.
4. **Purchase edit satu kali:** arti tepat satu kali, item tambah/hapus, delta ledger, rekalkulasi jika ada transaksi sesudahnya.
5. **Admin edit Service/SLS:** batas frekuensi dan cakupan field yang boleh diubah belum dikunci seperti Purchase.
6. **Expense numbering:** apakah nomor berubah saat tanggal Completed diedit.
7. **Tanggal dan laporan:** zona waktu, batas hari, periodisasi histori setelah tanggal transaksi diedit.
8. **SO pasca-Finalize:** cara mencatat versi revisi, transaksi/movement baru setelah snapshot, dan nilai physical yang dipakai pada approval.
9. **Delete sparepart:** hard/soft delete, relasi FK, snapshot historis, dan retensi ledger.
10. **Audit Log dapat dihapus Admin:** kontrol akses dan jejak aksi penghapusan tanpa menghapus hak Admin yang sudah dikunci.
11. **CANCELED Expense:** kebutuhan akses administratif atas record yang tidak tampil di Expense History/laporan bisnis.
12. **Restore eksternal:** format PostgreSQL yang didukung, kompatibilitas, validasi, pre-restore backup, atomic rollback, dan prosedur verifikasi.
13. **Excel import:** template/ukuran file, aturan exact match/nama mirip, staging, laporan preview, dan batas validasi; jangan menebak mapping.
14. **Session teknis:** implementasi session aman tanpa inactivity timeout, termasuk invalidasi setelah user dinonaktifkan/reset password/restore.
15. **Dashboard details:** threshold stok menipis/minimum, pembulatan agregasi, dan definisi perbandingan bila periode comparison dibutuhkan; jangan menambah KPI yang sudah dikecualikan.

Risiko yang sudah diterima pada V1 dan harus tetap terlihat: backup di server yang sama dan tanpa enkripsi wajib; tidak ada inactivity timeout; Admin dapat menghapus Audit Log. Planning boleh mendokumentasikan mitigasi teknis yang tidak membatalkan keputusan tersebut.

## 12. Definition of Done (untuk pekerjaan implementasi berikutnya)

Suatu task implementasi kelak dianggap selesai bila requirement task dan acceptance criteria-nya terpenuhi; test unit/integration/E2E yang relevan tersedia dan lulus; lint/typecheck/build berhasil; migration berjalan dari database kosong; tidak ada console error yang diketahui pada flow utama; aturan bisnis terdokumentasi; Audit Log tersedia untuk perubahan penting; UI memiliki loading/error/empty state; confirm tidak menggandakan stock movement; backup/restore diuji untuk fitur terkait; dan dokumentasi developer diperbarui.

Kriteria ini adalah Definition of Done masa implementasi, bukan pernyataan bahwa aplikasi atau test telah selesai saat ini.

## 13. Phase plan indikatif

Urutan ini adalah kerangka planning, bukan task plan yang telah disetujui:

0. Discovery final dan penyelesaian OPEN decisions.
1. Foundation: app shell, auth, database, migration, logging, backup dasar.
2. Inventory: master sparepart, stock ledger, Purchase, stock card.
3. Operations: Service/SLS dan Expense.
4. Stock Opname, approval, adjustment, Audit Log.
5. Reports.
6. Dashboard/KPI.
7. LAN deployment, security hardening, backup/restore verification, E2E, handover.

Urutan/ketergantungan dapat diubah pada Planning dengan alasan yang dicatat.

## 14. Keputusan lama yang sengaja tidak diaktifkan kembali

Untuk mencegah pembacaan keliru terhadap PRD draft lama, hal-hal berikut **bukan** aturan V1:

- Role `Management`/`Operator`; V1 hanya `ADMIN` dan `USER`.
- Service Draft atau Expense Draft; Service mengikuti workflow final pada bagian 4, Expense langsung Completed setelah preview.
- Costing sebagai keputusan terbuka atau latest-buy-cost sebagai HPP; V1 memakai Average Cost sesuai bagian 4.7.
- Pengeluaran Service/SLS boleh membuat stok negatif; transaksi diblokir jika stok tidak cukup.
- Movement historis diedit atau dihapus; ledger lama immutable, koreksi/reversal sebagai movement baru.
- USER hanya melihat transaksi miliknya, boleh mengubah master sparepart, membuat Purchase Draft, membuat Expense, atau melihat kolom harga/HPP sensitif.
- Purchase, Service, atau SLS berstatus CANCELED dihapus; data tetap ada dengan aturan visibilitas/perhitungan yang ditetapkan di sini.
- SO tidak boleh direvisi setelah Finalize; revisi diperbolehkan sampai Approved.
- Backup off-site/enkripsi sebagai syarat V1; keputusan final menerima server sama/tanpa enkripsi wajib, dengan risiko tercatat.
- Import parsial saat ada error, stok awal otomatis dari Excel, atau transaksi historis Excel masuk sebagai transaksi aktif.
- Audit Log immutable terhadap penghapusan; keputusan final mengizinkan Admin menghapusnya, namun tidak mengizinkan edit.

## 15. Sumber teknis yang dipindahkan dari PRD draft

Detail yang tetap dipertahankan dalam baseline ini meliputi arsitektur Browser/API/Service/Repository/PostgreSQL, Local-First dan LAN-Ready, satu database pusat di host, PostgreSQL/Prisma/TypeScript sebagai kandidat stack, validasi server-side, numeric untuk uang, transaksi/locking/idempotency, pemisahan layer, responsive UI states, test unit/integration/E2E, uji LAN dan backup/restore, opsi deployment lokal, workflow bertahap, Definition of Done, serta phase plan indikatif.

Endpoint contoh, nama tabel/field final, struktur folder lama, formula keuangan lama, role lama, dan task breakdown detail draft tidak diperlakukan sebagai kontrak. Codex Planning harus menurunkan ulang desain yang sesuai requirement aktif di atas.
