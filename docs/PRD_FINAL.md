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
- **Mata uang:** Rupiah; nominal uang merupakan bilangan bulat tanpa pecahan. Quantity stok sparepart adalah integer pcs; quantity Expense boleh desimal. Hasil perhitungan dibulatkan pada setiap langkah sebelum dipakai pada langkah berikutnya.

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
- Pembuatan Service memakai langkah preview sebelum save. Preview menampilkan hasil kalkulasi/validasi tetapi tidak menyimpan transaksi Completed, tidak membuat Draft, dan tidak membuat stock movement. Final save memvalidasi ulang di server dan menyimpan Service Completed beserta movement secara atomik.
- Tanggal transaksi boleh hari ini atau lampau, tidak boleh tanggal mendatang. Nomor otomatis. Mengedit tanggal tidak mengubah nomor awal.
- Pengeluaran stok diblokir bila stok tidak cukup.
- Saat final save Service berhasil, HPP memakai Average Cost pada saat commit dan disimpan pada transaksi. Service menyimpan HPP total transaksi; detail sparepart tetap menyimpan kuantitas, harga jual transaksi, dan snapshot HPP yang diperlukan untuk histori/reversal. Preview tidak mengunci atau menyimpan HPP.
- Diskon mengurangi pendapatan yang dilaporkan dan digunakan dalam perhitungan laba.
- Harga jual sparepart pada detail Service default dari harga jual master dan dapat diedit untuk transaksi. Harga di bawah harga beli terakhir diperbolehkan tetapi menghasilkan warning; kondisi ini saja tidak boleh menolak save.
- USER boleh melihat dan mengubah harga jual transaksi. Warning harga di bawah Latest Buy Price boleh terlihat oleh USER, tetapi nilai harga beli tidak boleh ditampilkan atau dikirimkan.
- Service wajib memiliki minimal satu rincian pekerjaan/jasa. Service tanpa sparepart tetap diperbolehkan. Sparepart yang sama tidak boleh muncul lebih dari sekali dalam satu Service.
- USER tidak boleh mengedit Service Completed atau membatalkannya. ADMIN boleh mengedit Completed maksimal satu kali per transaksi; setiap edit wajib mencatat alasan, menampilkan ringkasan Before → After, dan diaudit. Semua isian yang dimasukkan saat membuat transaksi boleh diedit, kecuali nomor transaksi dan catatan stok lama.
- Cancel mempertahankan transaksi `CANCELED`, movement awal, dan membuat reversal movement. Stok kembali berdasarkan HPP yang tersimpan pada transaksi. Pada edit Completed, periksa stok saat ini; terima tambahan pemakaian hanya jika stok cukup, selain itu tolak.
- USER boleh mencetak dokumen Service yang memang dapat diaksesnya.

### 4.2 SLS (penjualan sparepart)

- ADMIN dan USER dapat membuat SLS dengan preview sebelum save. Preview tidak menyimpan transaksi Completed, tidak membuat Draft, dan tidak membuat stock movement. Final save memvalidasi ulang di server dan menyimpan SLS Completed beserta movement secara atomik.
- Stok dikurangi dan transaksi diblokir bila stok tidak cukup.
- Harga jual sparepart pada detail SLS default dari harga jual master dan dapat diedit untuk transaksi. Harga di bawah harga beli terakhir diperbolehkan tetapi menghasilkan warning; kondisi ini saja tidak boleh menolak save.
- USER boleh melihat dan mengubah harga jual transaksi. Warning harga di bawah Latest Buy Price boleh terlihat oleh USER, tetapi nilai harga beli tidak boleh ditampilkan atau dikirimkan.
- SLS wajib memiliki minimal satu barang. Sparepart yang sama tidak boleh muncul lebih dari sekali dalam satu SLS.
- Saat final save SLS berhasil, HPP menggunakan Average Cost pada saat commit, dicatat pada transaksi, dan tidak mengubah Average Cost. Preview tidak mengunci atau menyimpan HPP. Diskon mengurangi pendapatan.
- Tanggal boleh hari ini/lampau dan tidak boleh mendatang. Nomor otomatis tetap ketika tanggal diedit.
- USER tidak boleh mengedit SLS Completed atau cancel; ADMIN boleh mengedit Completed maksimal satu kali per transaksi. Setiap edit wajib mencatat alasan, ringkasan Before → After, dan Audit Log. Semua isian yang dimasukkan saat membuat transaksi boleh diedit, kecuali nomor transaksi dan catatan stok lama.
- Cancel menyimpan transaksi berstatus `CANCELED`, mempertahankan movement asli, membuat reversal, dan mengembalikan stok berdasarkan HPP yang tersimpan. Pada edit Completed, periksa stok saat ini; terima tambahan pemakaian hanya jika stok cukup, selain itu tolak.
- USER boleh mencetak dokumen SLS yang memang dapat diaksesnya.

### 4.3 Purchase

- Purchase memiliki Draft → Confirm/Completed. Hanya ADMIN dapat membuat, mengelola, mengedit, atau menghapus Draft.
- Draft wajib memiliki minimal satu item. Confirm wajib memiliki minimal satu item. Sparepart yang sama tidak boleh muncul lebih dari sekali di dalam satu Purchase.
- Harga beli setiap item Purchase harus berupa Rupiah bulat yang lebih dari Rp0; harga Rp0 dan harga negatif ditolak.
- Confirm bersifat atomic/all-or-nothing. Draft tidak memengaruhi stok atau HPP.
- Purchase Completed menambah stok dan menghitung ulang Average Cost dari posisi stok/nilai yang berlaku serta harga beli aktual per item. Stok inventori tidak boleh negatif; Purchase tidak dapat menggunakan receipt untuk menutup saldo negatif. Service/SLS ditolak jika stok tidak cukup, dan edit transaksi juga tidak boleh menghasilkan stok negatif. Selisih Stock Opname yang negatif tetap valid dan berbeda dari saldo stok negatif.
- Tanggal boleh hari ini/lampau dan tidak boleh mendatang. Nomor otomatis tetap jika tanggal diubah.
- ADMIN boleh mengedit Purchase Completed satu kali; USER tidak boleh mengeditnya. Perubahan supplier saja tidak memerlukan alasan; setiap perubahan Completed Purchase lainnya wajib mencatat alasan. Semua edit menampilkan ringkasan Before → After dan diaudit. Edit jumlah/harga menghitung ulang costing, tetapi movement lama immutable dan koreksi stok dicatat dengan movement baru.
- Batas satu kali mencakup semua edit, termasuk perubahan supplier saja. Dalam satu edit, Admin boleh menambah, menghapus, atau mengubah item. Untuk perubahan item atau pembatalan, setiap pengeluaran stok pada sparepart terkait yang terjadi setelah Purchase dikonfirmasi berarti Purchase dianggap sudah digunakan; perubahan item dan pembatalan ditolak walaupun stok kemudian masuk lagi. Perubahan supplier saja tetap boleh dilakukan sekali karena tidak mengubah stok. Movement lama immutable; koreksi kuantitas stok dilakukan dengan movement delta baru. Average Cost diperbarui; HPP transaksi lama tidak berubah. Purchase yang sudah diedit tetap dapat dibatalkan sesuai alur pembatalan jika belum digunakan menurut aturan ini.
- Nama supplier ditulis langsung pada Purchase sebagai teks; V1 tidak memakai master supplier tersendiri.
- Cancel mempertahankan transaksi `CANCELED`, membuat reversal movement, dan menghitung ulang Average Cost. Pembatalan ditolak jika ada pengeluaran stok pada sparepart terkait setelah Purchase dikonfirmasi, walaupun stok kemudian masuk lagi.
- USER boleh mencetak dokumen Purchase yang boleh diaksesnya, tanpa melihat harga beli.

### 4.4 Operational Expense

- ADMIN saja dapat membuat, mengedit Completed, dan membatalkan Expense. Tidak ada Draft: preview, lalu simpan langsung sebagai Completed.
- Transaksi memiliki satu atau beberapa item: deskripsi, quantity positif (boleh desimal), harga satuan Rupiah bulat, total setiap baris `quantity × harga` dibulatkan sebelum dijumlahkan. Setiap nilai baris setelah pembulatan harus lebih dari Rp0; catatan umum opsional.
- Tidak ada kategori/master kategori biaya, metode pembayaran, atau nama penerima/vendor pada V1. Nomor bukti eksternal opsional. Expense tidak memengaruhi stok dan masuk ke biaya operasional/laba rugi.
- Tanggal hari ini/lampau, bukan mendatang. Format nomor awal `EXP-YYYYMMDD-0001`.
- Edit menampilkan Before → After dan diaudit. Alasan edit/cancel tidak wajib. Nomor Expense tetap sama ketika tanggal transaksi diedit.
- Cancel berstatus `CANCELED`, tidak dapat diaktifkan kembali, tidak dihitung sebagai biaya dan tidak ditampilkan di Expense History atau laporan bisnis. Aktivitas cancel tetap diaudit. Admin dapat melihatnya melalui tampilan khusus “Dibatalkan”.

### 4.5 Stock Opname (SO)

- Saat SO dibuat, System Stock diambil otomatis pada saat pembuatan. Jika stok berubah sebelum Admin menyetujui, USER harus menghitung ulang SO sebelum persetujuan.
- USER dapat membuat SO dan melakukan Revision/Recheck. Hanya ADMIN dapat Finalize, Approve, atau Reject.
- Setelah Finalize, Physical Stock dan revisi **masih boleh diubah**. Setelah Approved, SO final dan tidak boleh diedit, direvisi, atau dibatalkan. Kesalahan sesudahnya ditangani dengan SO baru.
- Reject mengembalikan SO ke Revision/Recheck.
- Selisih positif menghasilkan `ADJUSTMENT_IN`; selisih negatif menghasilkan `ADJUSTMENT_OUT`. Adjustment baru diterapkan saat approval.
- Finalize/Approve/Reject serta pelaku approval/rejection diaudit. Movement mencatat adjustment yang benar-benar diterapkan. Cost adjustment menggunakan Average Cost saat approval.
- Movement SO hanya dibuat saat approval berhasil, dalam transaksi yang sama dengan perubahan status dan adjustment. Jika approval gagal atau diulang, tidak boleh ada adjustment parsial atau movement duplikat.
- Jika stok berubah setelah SO dimulai dan sebelum Admin menyetujui, USER harus menghitung ulang SO sebelum persetujuan.

### 4.6 Sparepart dan identitas historis

- Kode sparepart otomatis dan unik (misalnya `SP001`) serta tidak pernah digunakan kembali meskipun sparepart dihapus.
- Nama sparepart dianggap sama setelah mengabaikan perbedaan huruf besar-kecil dan spasi di awal/akhir; nama yang sama ditolak. Nama yang mirip menghasilkan warning; ADMIN dapat memilih untuk melanjutkan secara eksplisit. Metode teknis mendeteksi kemiripan belum ditentukan dan tidak boleh ditebak.
- Pada Service/SLS, harga jual detail memakai harga jual master sebagai nilai awal dan dapat diedit. Harga di bawah harga beli terakhir diperbolehkan dengan warning dan tidak boleh ditolak hanya karena perbandingan tersebut. Warning tidak boleh menyertakan nilai harga beli yang dilarang untuk USER.
- ADMIN mengelola master. USER tidak dapat menambah, mengedit, atau mengubah status aktif.
- Sparepart yang pernah dipakai boleh dihapus dari daftar aktif. Histori transaksi tetap menyimpan snapshot nama dan kode sehingga histori tidak rusak. Penghapusan tidak menghapus catatan historis.
- Perubahan harga/nama/kode master tidak mengubah nilai historis detail transaksi. Service/SLS menyimpan harga jual transaksi yang benar-benar dipakai serta HPP saat transaksi Completed; Purchase menyimpan harga beli aktual. USER boleh melihat/mengubah harga jual transaksi, tetapi tidak boleh menerima harga jual master, harga beli, atau HPP melalui API, print, export, atau warning.
- User yang dinonaktifkan tidak dapat login/akses. User dinonaktifkan, bukan dihapus; nama dan transaksi historisnya tetap ada.

### 4.7 HPP dan Average Cost

- Metode V1 adalah Average Cost; harga beli terakhir merupakan data master terpisah, bukan HPP rata-rata.
- Opening stock dimasukkan Admin per sparepart dengan quantity dan biaya modal per barang yang harus lebih dari Rp0. Biaya per barang menjadi Average Cost awal untuk sparepart tersebut. Stok berlaku langsung saat Admin menyimpan.
- Purchase Completed menghitung weighted average dari nilai inventory dan quantity yang berlaku dengan mempertimbangkan pembelian. Purchase Draft tidak memengaruhi HPP. Master Buy Price/latest buy price adalah harga pembelian terakhir yang berhasil diterima melalui Purchase dan diperbarui saat Purchase dikonfirmasi menjadi Completed. Perubahan master atau Purchase lain tidak mengubah harga item Purchase yang sudah tercatat. Satu kali edit Purchase Completed yang secara eksplisit diizinkan memperbarui item pada Purchase tersebut dan wajib menyimpan Before→After; edit ini memperbarui Average Cost tetapi HPP transaksi lain yang sudah tercatat tidak berubah. Latest buy price tetap terpisah dari Average Cost/HPP. Harga beli harus lebih dari Rp0. Jika Purchase Completed yang terbaru diedit dan editnya diizinkan, Latest Buy Price mengikuti harga item yang telah diedit. Jika Purchase Completed terbaru dibatalkan dan pembatalannya diizinkan, Latest Buy Price kembali ke harga dari Purchase Completed sebelumnya yang masih berlaku. Urutan “terbaru” mengikuti waktu Confirm/commit.
- Service/SLS menggunakan Average Cost saat transaksi terjadi dan menyimpan HPP agar transaksi historis tidak berubah diam-diam. Pengeluaran Service/SLS tidak mengubah Average Cost.
- SO adjustment memakai Average Cost pada waktu approval. Inventory Value tersedia untuk Admin sebagai stok × Average Cost; tidak ditampilkan sebagai KPI Dashboard.
- Rekalkulasi saat Purchase diedit/dibatalkan harus menjaga ledger immutable serta HPP transaksi lama. Stok negatif bukan workflow V1. Opening stock dimasukkan Admin manual per sparepart dengan quantity dan biaya modal per barang lebih dari Rp0; saat disimpan, stok langsung berlaku pada waktu input, biaya per barang menjadi Average Cost awal, dan movement immutable dicatat atomik tanpa persetujuan kedua. Excel bukan sumber opening stock.
- Nilai perhitungan dibulatkan pada setiap langkah sebelum dipakai pada langkah berikutnya; hasil Average Cost/HPP dan HPP transaksi berupa Rupiah utuh. Urutan costing mengikuti waktu Confirm/commit; tanggal bisnis hanya untuk laporan. Stok negatif dan workflow costing untuk saldo negatif bukan alur V1.

### 4.8 Stock movement ledger

- `stock_movements` adalah source of truth pergerakan stok dan immutable. Movement lama tidak diedit atau dihapus oleh alur bisnis.
- Perubahan transaksi Completed yang berdampak pada stok menghasilkan movement baru untuk delta/koreksi. Contoh: Purchase +10 dikoreksi menjadi +15 berarti movement +10 tetap dan movement koreksi +5 dibuat.
- Opening stock yang dimasukkan Admin langsung menambah stok melalui Stock Service dalam satu transaksi atomik; catat sebagai movement immutable dengan waktu saat Admin menyimpan. Tidak ada persetujuan kedua.
- Cancel mempertahankan movement asli dan membuat reversal movement.
- Final save Service/SLS, Confirm Purchase, dan approval adjustment harus atomik. Saldo stok tidak boleh diubah langsung oleh modul lain di luar layanan stok/domain yang ditetapkan saat Planning.
- Movement sekurangnya terkait waktu, tipe, quantity, objek/transaksi sumber, dan cost yang dibutuhkan untuk rekonsiliasi. Field persisnya OPEN.
- Setiap reversal/correction harus dapat ditelusuri ke transaksi dan movement asal tanpa mengubah baris ledger asal. Retry atas confirm, edit, cancel, reversal, atau approval yang sama tidak boleh menggandakan movement.
- Saldo current stock harus dapat direkonsiliasi dari ledger. Urutan costing/stock ledger mengikuti waktu Confirm/commit; tanggal bisnis digunakan untuk laporan. Cara menyimpan/proyeksi saldo dan batas hari laporan tetap mengikuti detail teknis Planning; saldo tidak boleh berubah tanpa movement.
- USER tidak dapat melihat Stock Movement History. Laporan movement hanya Admin dan dapat difilter menurut sparepart.

### 4.9 Dashboard dan keuangan

- Dashboard hanya untuk ADMIN; USER tidak memiliki Dashboard.
- KPI: Pendapatan Service, Pendapatan SLS, Laba Kotor, Laba Bersih, jumlah Service, jumlah SLS, Purchase Completed, jumlah Purchase Draft belum Confirm, sparepart stok menipis, dan stok minus.
- Tidak ada KPI terpisah untuk Total Expense, Total HPP, Inventory Value, jumlah CANCELED, atau SO dalam proses.
- Grafik: Pendapatan Service dan SLS bersama; grafik Laba Kotor; tanpa grafik Expense. Rentang pendek lebih rinci dan rentang panjang lebih ringkas; tidak ada perbandingan dengan periode lain. Semua mengikuti filter periode.
- Klasifikasi **Stok Menipis** terkunci: current stock `<=` minimum stock. Threshold ini bukan OPEN DECISION.
- Monitoring mencakup sparepart stok menipis/minus yang dapat dibuka ke detail dan aktivitas/transaksi terbaru. Periode default bulan berjalan dengan Hari Ini/Minggu Ini/Bulan Ini/Custom dan rentang Dari–Sampai. Dashboard diperbarui sesudah transaksi tersimpan. Klik KPI pendapatan membuka laporan terkait.
- **Laba Kotor = Pendapatan Service + Pendapatan SLS − HPP.** **Laba Bersih = Laba Kotor − Expense.** Purchase bukan pendapatan. Service tanpa sparepart tetap termasuk pendapatan. Diskon sudah mengurangi pendapatan.
- Semua transaksi `CANCELED` dikeluarkan dari seluruh KPI/grafik Dashboard dan P&L. Expense `CANCELED` tidak dihitung.
- `Stok minus` berarti current stock < 0. `Stok Menipis` berarti current stock <= minimum stock, termasuk saat minimum stock adalah 0.

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
- Alasan wajib untuk edit Completed Service/SLS dan untuk edit Completed Purchase selain perubahan supplier saja harus dicatat bersama ringkasan Before → After. Supplier-only Purchase edit tetap diaudit dan menampilkan perubahan, meskipun alasan tidak wajib. Password, hash password, token/session secret, dan rahasia konfigurasi tidak boleh masuk Audit Log.
- Login berhasil dan Logout normal tidak dicatat. Aksi alasan tidak wajib secara umum; perubahan note Expense saja tidak wajib dicatat. Approval/reject SO mencatat Admin pelaku.
- Cancel tidak memerlukan alasan pada baseline saat ini; alasan wajib hanya pada edit Completed Service/SLS dan edit Completed Purchase selain supplier-only. Transaksi CANCELED tetap tidak boleh dihapus untuk menghindari jejak histori.
- Audit Log hanya dapat dilihat Admin. Baris Audit Log tidak boleh diedit, tetapi Admin boleh menghapusnya. Aksi penghapusan dicatat dalam catatan teknis terpisah yang tidak dapat dihapus melalui menu Audit.
- Perubahan stok akibat edit/cancel tidak wajib memiliki catatan tambahan di Audit Log; jejak koreksi tetap tercatat pada immutable stock ledger dan aksi bisnisnya diaudit.

### 4.12 Backup dan restore

- ADMIN saja dapat melakukan backup/restore. V1 menyediakan backup manual dan otomatis terjadwal. Format mencakup PostgreSQL dan Excel. Tidak ada tombol Download Backup.
- Backup otomatis mingguan, retensi 30 hari, nama berbasis timestamp, disimpan pada server yang sama dan tidak wajib dienkripsi. Ini risiko V1 yang diterima dan harus didokumentasikan.
- Backup gagal dicatat di Audit Log dan memberi indikator/peringatan kepada Admin.
- Restore dapat menggunakan backup sistem atau file PostgreSQL eksternal dari versi yang kompatibel; file eksternal diperiksa sebelum pemulihan. Perlu konfirmasi kuat dan peringatan bahwa data akan ditimpa. Restore dicatat di Audit Log dan harus atomic: bila gagal, database kembali seperti sebelum restore. Admin login kembali setelah restore.
- Restore yang berhasil harus tetap meninggalkan jejak audit yang dapat ditelusuri setelah data diganti; detail bagaimana audit restore bertahan dari penggantian database adalah OPEN. Kegagalan restore juga dicatat tanpa mengorbankan pemulihan database sebelumnya.
- Daftar versi PostgreSQL yang diterima dan langkah pemeriksaan file eksternal dirinci secara teknis di Planning; aturan bahwa versi harus kompatibel dan file harus diperiksa sebelum restore tetap terkunci.

### 4.13 Migrasi Excel

- Hanya Admin. V1 hanya mengimpor data master sparepart dari file `.xlsx`; batas ukuran dan jumlah baris ditetapkan setelah contoh file bengkel diperiksa. Wajib melalui **Preview → Validation → Import**. Jika ada error, seluruh import batal. Simpan laporan hasil termasuk berhasil, error, warning, dan detail.
- Nama sparepart yang sama setelah mengabaikan huruf besar-kecil dan spasi awal/akhir dipetakan otomatis. Nama mirip memberi warning dan meminta konfirmasi. Sparepart baru ditampilkan dalam daftar untuk konfirmasi Admin.
- Abaikan kode sparepart Excel; sistem membuat kode otomatis. Harga beli/jual Excel hanya referensi dan tidak mengubah master. Formula Excel diabaikan; gunakan hanya data yang dapat divalidasi.
- Jika mapping ambigu, Admin harus menentukan mapping; sistem tidak menebak.
- Stok Excel hanya referensi; opening stock dimasukkan manual. Transaksi historis Excel hanya referensi, bukan transaksi aktif hasil impor. Import Excel tahap awal hanya membuat master sparepart.
- Historical Service/SLS/Purchase dan stock Excel adalah reference-only: jangan membuat transaksi aktif dari baris historis dan jangan menggunakan jumlah stok Excel sebagai opening stock. Admin memasukkan quantity dan biaya modal awal lebih dari Rp0 secara manual untuk setiap sparepart.
- Setelah import, verifikasi jumlah transaksi/detail dan total penting sebagai rekonsiliasi terhadap data sumber/referensi, bukan sebagai bukti bahwa transaksi historis dibuat aktif. Excel bukan blueprint database atau sumber kebenaran stok awal.

## 5. Tanggal, nomor, status, dan pembatalan

- Simpan waktu transaksi memakai standar waktu komputer; tampilkan waktu dan hitung laporan memakai zona waktu bengkel yang dapat diatur. Tanggal/waktu transaksi tidak boleh mendatang.
- Service/SLS/Purchase: tanggal hari ini/lampau, bukan future; nomor otomatis dan tetap nomor awal ketika tanggal diedit.
- Expense: format `EXP-YYYYMMDD-0001`; nomor tetap sama ketika tanggal transaksi diedit.
- Status mengikuti lifecycle entity, bukan satu status generik yang membuka kombinasi tidak valid: Service dan SLS dibuat langsung `COMPLETED` dan dapat dibatalkan; Expense dibuat langsung `COMPLETED` dan dapat dibatalkan; hanya Purchase memiliki `DRAFT`, yang dikonfirmasi menjadi `COMPLETED` atau dapat dihapus selama masih Draft. Purchase Completed dapat diedit satu kali atau dibatalkan. Completed Service/SLS/Purchase yang dibatalkan menjadi `CANCELED`; transaksi CANCELED tidak dapat diedit atau diaktifkan kembali. Koreksi setelah cancellation harus mengikuti workflow baru yang berlaku, bukan reaktivasi. Expense `CANCELED` juga tidak dapat diaktifkan kembali. SO menggunakan lifecycle revisi/recheck, finalized-but-revisable, approved-final, dan rejected-to-revision. Persisted constraints dan pemeriksaan transisi wajib menjaga batas ini.
- Status `CANCELED` tetap disimpan untuk Service/SLS/Purchase; movement asli tetap, reversal ditambahkan. CANCELED dikeluarkan dari Dashboard dan P&L. Expense CANCELED tidak tampil pada Expense History/laporan bisnis dan tidak berbiaya, tetapi Admin dapat melihatnya pada tampilan khusus “Dibatalkan” dan jejak audit tetap ada.
- Preview Service/SLS bukan status transaksi dan bukan Draft. Preview Expense juga tidak menciptakan Draft; penyimpanan langsung membuat Completed. Purchase Draft saja merupakan Draft workflow.
- System harus mempertahankan nama user serta snapshot sparepart historis ketika akun dinonaktifkan atau master sparepart dihapus.

## 6. Kebutuhan UI dan validasi

- Responsif desktop-first untuk desktop, tablet, dan HP; navigasi sesuai ukuran layar.
- Tabel menyediakan pencarian, filter, pagination, dan sorting bila relevan.
- Form memiliki validasi sisi server (validasi client untuk UX saja), pesan yang jelas, status badge konsisten, dialog konfirmasi untuk aksi destruktif, serta loading/empty/error/success state.
- Validasi final selalu diulang pada server saat save/confirm, meski preview telah lolos. Request yang gagal tidak boleh meninggalkan transaksi, movement, costing, atau audit separuh jalan.
- Warning harga transaksi di bawah latest buy price tidak berarti rejection. USER dapat melihat dan mengubah harga jual transaksi; warning boleh ditampilkan tanpa menunjukkan harga beli.
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
- Production V1 berjalan native pada Windows; aplikasi dan PostgreSQL berjalan langsung pada Windows. Admin menjalankan aplikasi sendiri saat akan dipakai; aplikasi tidak otomatis berjalan. Docker tidak diwajibkan. Network bind, firewall, LAN addressing, dan HTTPS tetap perlu ditentukan.

### Database dan domain

- PostgreSQL lokal pada host adalah persistent source of truth; perangkat LAN mengakses database yang sama melalui aplikasi host dan tidak membuat database utama kedua.
- Internal ID menggunakan BIGINT auto-increment. Quantity inventori sparepart adalah integer pcs; nilai uang adalah integer Rupiah. Hasil Average Cost/HPP dibulatkan ke Rupiah utuh dan HPP transaksi tidak menyimpan pecahan Rupiah. Presisi/rentang hitung antara tetap menjadi detail teknis sepanjang hasil terkunci tersebut terjaga.
- Gunakan foreign key, enum/status terkontrol, timestamp created/updated, dan created_by/updated_by yang relevan. Persisted status constraints wajib menegakkan lifecycle per entity.
- Transaksi final tidak dihapus sebagai cara koreksi. Migration database harus berversi dan aman dijalankan.
- Struktur domain disarankan memisahkan UI, route/API (auth, authorization, validasi), services/use cases, domain rules, repository/ORM, database, Audit Log, dan Backup Service. Struktur folder konkret diputuskan saat Planning.
- Entity awal yang perlu dimodelkan: users, spare_parts, service header/details, SLS header/details, purchases/items, expenses/items, stock_movements, stock opname/items/adjustments, audit_logs. Ini kandidat domain, bukan schema final. Hindari mengaktifkan kembali model role Management/Operator atau aturan kategori Expense lama.

### Concurrency, atomicity, dan idempotency

- Simpan final save Service/SLS, Purchase Confirm, edit/cancel transaksi berdampak stok, SO approval+adjustment, movement, costing snapshot, dan status terkait dalam transaksi database atomik. Preview tidak menulis transaksi/movement. Jika penyimpanan gagal, tidak boleh ada efek sebagian.
- Hindari pola read-modify-write saldo tanpa transaction/locking yang sesuai. Dua request bersamaan pada sparepart yang sama tidak boleh menghasilkan saldo/movement yang tidak konsisten.
- Confirm/idempotency harus mencegah double-click atau retry menghasilkan transaksi/movement duplikat, termasuk final save, edit, cancel/reversal, Purchase confirm, SO approval, import, dan restore. Gunakan kunci unik untuk actor dan operasi: pengiriman ulang dengan kunci dan data yang sama mengembalikan hasil awal; kunci sama dengan data berbeda ditolak sebagai konflik. Simpan catatan idempotency secara permanen.
- Semua validasi kuantitas, nominal (bukan NaN/Infinity), foreign key, status workflow, stok cukup, dan permission ditegakkan server-side.

### Local-First dan LAN behavior

- Operasi inti—login, transaksi, inventory, purchase, expense, SO, laporan, dan backup lokal—tetap dapat dipakai saat internet mati.
- Host menjalankan aplikasi dan database lokal; aplikasi dapat menerima koneksi LAN pada interface yang sesuai. HP/komputer lain mengakses alamat LAN host dan menggunakan database yang sama.
- Perubahan dari perangkat LAN terlihat pada perangkat lain setelah request selesai. Jika host mati, perangkat lain tidak dapat mengakses aplikasi.
- Batasi akses LAN ke private network bila dapat dilakukan; jangan expose port database ke LAN bila tidak diperlukan. Target production V1 adalah Windows native; Admin menjalankan aplikasi sendiri saat akan dipakai dan aplikasi tidak berjalan otomatis. Firewall, HTTPS dalam LAN, bind interface, dan provisioning jaringan tetap perlu dirinci.

### Security dan konfigurasi

- Simpan session/token dengan mekanisme aman; rahasia konfigurasi lewat environment variables.
- Authorization server-side; endpoint sensitif memeriksa role/permission. Backup file dibatasi aksesnya.
- Terapkan kebijakan error generik untuk USER seperti keputusan bisnis di atas dan detail diagnostik hanya di server log.

## 8. Testing dan verifikasi penerimaan

Strategi prioritas: unit test untuk formula/validasi/domain rules; integration test untuk transaksi database, ledger, costing, dan approval; E2E untuk alur utama; regression test pada inventory/keuangan; LAN test dari perangkat kedua; serta backup→restore→verifikasi.

Kriteria penerimaan V1:

1. Seluruh fungsi operasional V1 berjalan tanpa internet pada host lokal.
2. Perangkat kedua pada private LAN dapat membuka aplikasi dan berbagi satu database.
3. Stok inventori tidak pernah negatif; Service/SLS menolak pengeluaran yang tidak cukup dan Purchase tidak menggunakan workflow receipt untuk menutup saldo negatif. Selisih negatif Stock Opname tetap valid.
4. Purchase Completed menambah stok tepat satu kali; Service/SLS mengurangi tepat satu kali; retry/double submit tidak menciptakan movement duplikat.
5. SO menyimpan snapshot stok saat dibuat, mendukung revision setelah Finalize, tidak mengubah stok sebelum approval, dan membuat adjustment yang sesuai pada approval. Revisi terakhir menjadi hasil resmi; record history terpisah tidak diwajibkan. Jika stok berubah sebelum approval, USER harus menghitung ulang SO.
6. Edit stok berdampak menghasilkan movement koreksi baru; cancel menghasilkan reversal; movement lama tidak berubah.
7. Dashboard, Reports, dan KPI menggunakan definisi angka yang sama dan mengecualikan CANCELED sesuai keputusan final.
8. API dan UI menegakkan permission: USER dapat melihat/mengubah harga jual transaksi, tetapi tidak mendapat harga jual master, harga beli, HPP atau biaya rata-rata.
9. Migrasi Excel melakukan preview, validasi penuh, rollback semua jika ada error, dan menyediakan hasil verifikasi.
10. Backup dapat dibuat dan restore dapat diverifikasi; kegagalan restore meninggalkan database seperti semula.
11. Alur UI menyediakan validasi dan state loading/error/empty/success yang dapat dipahami.
12. Service/SLS preview tidak meninggalkan transaksi Completed, Draft, stock movement, atau efek costing; final save mengulang validasi server-side dan commit atomik.
13. Admin edit Completed Service/SLS maksimal satu kali per transaksi, menolak alasan kosong, dan menyimpan Before → After serta audit; semua isian pembuat transaksi dapat diedit kecuali nomor transaksi dan catatan stok lama.
14. Purchase Draft/Confirm menolak item kosong dan duplicate sparepart dalam satu Purchase; Admin edit Completed tepat satu kali dengan pengecualian alasan untuk supplier-only dan ringkasan Before → After. Edit boleh menambah, menghapus, atau mengubah item; Average Cost diperbarui dan HPP lama tetap.
15. Sparepart menolak nama yang sama setelah huruf besar-kecil dan spasi tepi dinormalisasi; nama mirip menampilkan warning dan membutuhkan pilihan eksplisit Admin untuk melanjutkan.
16. Harga jual transaksi default dari master tetapi dapat diedit Admin maupun USER; harga di bawah latest buy price menampilkan warning dan tetap dapat disimpan tanpa membocorkan nominal buy price ke USER.
17. Dashboard memberi label Stok Menipis ketika current stock <= minimum stock; stok inventori negatif dilarang.
18. Cancel/reversal, edit setelah transaksi downstream, operasi bersamaan, retry, dan kegagalan restore tidak menghasilkan ledger/status/keuangan yang parsial atau tidak dapat direkonsiliasi; Purchase cancellation ditolak jika stoknya sudah dipakai transaksi lain.

Detail matriks kasus uji dan data fixture disusun pada Planning. Kriteria ini bukan hasil pengujian; implementasi belum dimulai.

## 9. Deployment, backup/restore, dan handover

- Target production V1 adalah Windows native; aplikasi dan PostgreSQL berjalan langsung pada host Windows. Admin menjalankan aplikasi sendiri saat akan dipakai; aplikasi tidak berjalan otomatis. Docker tidak diwajibkan. Detail bind, firewall, LAN addressing, dan HTTPS tetap OPEN untuk Planning.
- Database hanya diakses melalui aplikasi host; layanan harus dapat dimulai ulang dan dokumentasi konfigurasi LAN disediakan.
- Prosedur backup/restore, jadwal mingguan/retensi, verifikasi hasil restore, persyaratan akses Admin, serta skenario pemulihan harus terdokumentasi.
- Restore perlu perlindungan pre-restore dan rollback atomik sesuai keputusan bisnis. Daftar versi PostgreSQL yang kompatibel dan langkah pemeriksaan file tetap menjadi rincian teknis OPEN.
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

## 11. Keputusan terkunci dan rincian OPEN

Daftar ini membedakan keputusan yang telah dipilih Admin dari rincian yang masih perlu diselesaikan. Keputusan terkunci tidak boleh dibuka kembali oleh planning atau implementasi. PRD ini tetap satu-satunya sumber requirement V1.

### Keputusan discovery yang sekarang LOCKED

- **O-01:** Admin menjalankan aplikasi sendiri saat akan dipakai; aplikasi tidak berjalan otomatis. Target tetap Windows native.
- **O-02:** Bulatkan hasil pada setiap langkah hitung sebelum dipakai pada langkah berikutnya.
- **O-04:** Edit Purchase Completed satu kali boleh menambah, menghapus, atau mengubah item; Average Cost diperbarui dan HPP transaksi lama tetap.
- **O-04a:** Nama supplier ditulis langsung pada Purchase; tidak ada master supplier.
- **O-05:** Semua isian pembuat transaksi Service/SLS boleh diedit Admin satu kali, kecuali nomor transaksi dan catatan stok lama; alasan, Before→After dan audit tetap wajib.
- **O-07:** Waktu disimpan memakai standar waktu komputer; tampilan dan laporan menggunakan zona waktu bengkel.
- **O-09:** Sparepart yang dihapus tidak lagi aktif dan catatan lama tetap tersedia.
- **O-10:** Penghapusan Audit Log meninggalkan jejak teknis terpisah yang tidak dapat dihapus melalui menu Audit.
- **O-11:** Admin dapat melihat Expense CANCELED melalui tampilan khusus “Dibatalkan”; transaksi tetap tersembunyi dari riwayat dan laporan biasa.
- **O-12:** Restore eksternal menerima file dari versi PostgreSQL yang kompatibel dan memeriksanya sebelum restore.
- **O-13:** Excel memakai `.xlsx`; batas ukuran dan jumlah baris ditetapkan setelah contoh file bengkel diperiksa.
- **O-15:** Grafik makin ringkas untuk rentang makin panjang dan tidak membandingkan dengan periode lain. Stok Menipis tetap `current stock <= minimum stock`.
- **O-16:** Edit Service/SLS memeriksa stok terkini; tambahan pemakaian diterima hanya jika stok cukup.
- **O-17:** Untuk edit item atau pembatalan, setiap pengeluaran stok pada sparepart terkait setelah Purchase dikonfirmasi membuat Purchase dianggap sudah digunakan; operasi ditolak walaupun stok kemudian masuk lagi. Supplier-only edit tetap boleh dilakukan sekali karena tidak mengubah stok.
- **O-19:** USER boleh melihat dan mengubah harga jual transaksi. Warning boleh terlihat tanpa menunjukkan harga beli.
- **O-22:** Jika stok berubah sejak SO dimulai sebelum persetujuan, USER harus menghitung ulang sebelum Admin menyetujui.
- **O-23:** Import Excel tahap awal hanya memasukkan master sparepart. Riwayat transaksi dan stok Excel tetap hanya referensi.
- **O-25:** Perbandingan nama mengabaikan huruf besar-kecil dan spasi awal/akhir; nama sama ditolak dan kemiripan tetap memberi warning dengan pilihan lanjut Admin.
- **O-27a:** Service wajib memiliki setidaknya satu rincian pekerjaan/jasa; sparepart tidak wajib.
- **O-27b:** SLS wajib memiliki setidaknya satu barang.
- **O-28:** Setiap baris Expense harus lebih dari Rp0; setiap baris dibulatkan sebelum dijumlahkan.
- **O-29:** Sparepart yang sama tidak boleh muncul berulang di satu Service atau SLS.
- **O-30:** Biaya modal awal per barang harus lebih dari Rp0.

Keputusan terkunci sebelumnya tetap berlaku: O-03 stok tidak boleh negatif; O-06 nomor Expense tidak berubah saat tanggal berubah; O-08 revisi SO dapat dilakukan setelah Finalize sampai Admin menyetujui/menolak; O-21 urutan costing mengikuti Confirm/commit dan tanggal bisnis hanya untuk laporan; O-24 aturan Latest Buy Price; O-26 idempotency.

### Rincian yang masih OPEN

- **O-01 (teknis):** pengaturan alamat jaringan, firewall, dan HTTPS untuk akses LAN.
- **O-02 (teknis):** representasi angka sementara/rentang hitung yang tetap menerapkan pembulatan pada setiap langkah.
- **O-04 (teknis):** cara merekonsiliasi Average Cost dan movement saat item Purchase ditambah, dihapus, atau diubah; HPP transaksi lama tetap.
- **O-07 (teknis):** cara penyimpanan waktu dan batas hari laporan yang menerapkan standar waktu komputer serta zona waktu bengkel.
- **O-09 (teknis):** relasi database dan cara mengarsipkan item nonaktif sambil mempertahankan histori.
- **O-10 (teknis):** lokasi, perlindungan, dan masa simpan catatan teknis penghapusan Audit Log.
- **O-12 (teknis):** daftar versi PostgreSQL yang diterima dan langkah pemeriksaan/restore yang tepat.
- **O-13 (teknis/workflow):** batas ukuran/baris setelah contoh file diperiksa, kolom master sparepart yang dipetakan, dan rincian hasil preview.
- **O-14 (teknis):** penyimpanan sesi, CSRF, invalidasi saat user dinonaktifkan/reset/restore, dan cara membuat Admin pertama; tidak ada batas waktu tidak aktif.
- **O-15 (teknis):** batas rentang pendek/panjang dan pembulatan angka agregat grafik; perbandingan periode tidak digunakan.
- **O-16 (teknis):** cara mengukur dan menerapkan delta stok edit secara aman pada waktu edit.
- **O-19 (teknis):** bentuk data harga jual yang dikirim ke USER tanpa membocorkan harga jual master, harga beli, atau HPP; izin melihat/mengubah harga transaksi dan kemungkinan warning untuk USER sudah LOCKED.
- **O-20:** waktu alokasi nomor Service/SLS dan pencegahan nomor ganda pada penyimpanan bersamaan; preview tetap tidak membuat transaksi, Draft, atau movement.
- **O-22 (teknis):** cara mendeteksi perubahan stok sejak SO dimulai dan memaksa hitung ulang sebelum persetujuan; perilaku hitung ulang sudah LOCKED.
- **O-23 (teknis/workflow):** kolom master sparepart yang didukung, pemetaan, dan verifikasi import tanpa memasukkan transaksi historis atau stok.
- **O-25 (teknis):** cara mendeteksi nama mirip; jangan mengubah aturan exact match yang sudah LOCKED.
- **O-26 (teknis):** bentuk penyimpanan kunci idempotency dan hasil permintaan; aturan perilaku retry dan penyimpanan permanen sudah LOCKED.

Rincian OPEN di atas tidak boleh digunakan untuk memilih hasil bisnis yang berbeda dari aturan LOCKED. Negative stock/Average Cost untuk saldo negatif bukan alur V1. Keputusan numbering, sesi, import, waktu, dan detail teknis lain harus diselesaikan sebelum implementasi modul terkait.

Risiko V1 yang sudah diterima tetap berlaku: backup di server sama dan tidak wajib dienkripsi; tidak ada inactivity timeout; Admin dapat menghapus Audit Log, dengan jejak teknis terpisah sesuai O-10.
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
- Draft workflow Service, SLS, atau Expense; Service/SLS memakai preview sebelum final save tanpa Draft, sedangkan Expense langsung Completed setelah preview. Draft hanya dimiliki Purchase.
- Costing sebagai keputusan terbuka atau latest-buy-cost sebagai HPP; V1 memakai Average Cost sesuai bagian 4.7.
- Stok inventori tidak boleh negatif; transaksi Service/SLS ditolak jika stok tidak cukup. Selisih negatif Stock Opname tetap valid dan tidak berarti saldo stok negatif.
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
