# Rencana Implementasi: Platform Pembayaran Sekolah Multi-Tenant (SPP, Daftar Ulang, Jemputan & Tagihan Manual)

Satu sistem terpusat berbasis cloud untuk mengelola pembayaran pendidikan lintas sekolah—mempertemukan **Super Admin** (pemilik platform), **Bagian Keuangan Sekolah**, dan **Wali Murid** dalam alur penagihan yang fleksibel serta pembayaran via **Kasir Tunai**, **Virtual Account (VA)**, dan **QRIS**.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Berikut ringkasan keputusan produk yang telah Anda konfirmasi pada tahap diskusi awal beserta catatan implementasi yang perlu disepakati sebelum pembangunan dimulai:

- **Peran Pengguna (Dikonfirmasi)**: Sistem memiliki tiga portal terintegrasi dalam satu aplikasi: **Super Admin**, **Bagian Keuangan Sekolah**, dan **Wali Murid**.
- **Metode Pembayaran (Dikonfirmasi)**: Mendukung **Kasir Tunai** (pencatatan langsung di loket sekolah), **Virtual Account (VA)**, dan **QRIS**.
  - *Catatan Integrasi Pembayaran*: Karena belum ada kredensial merchant Payment Gateway live (seperti Midtrans/Xendit) yang terhubung, aliran **VA dan QRIS akan dibangun dengan antarmuka checkout penuh** (pembuatan nomor VA unik, kode QRIS dinamis sesuai nominal, batas waktu bayar, serta fitur **Simulasi Pelunasan Instan** agar alur bayar dari sisi Wali Murid hingga rekonsiliasi otomatis di Bag. Keuangan dapat diuji nyata end-to-end). Jika kelak dihubungkan ke gateway resmi, arsitektur webhook siap disambungkan.
- **Fleksibilitas Layanan & Tarif per Sekolah (Dikonfirmasi)**: Setiap sekolah bebas mengaktifkan atau menonaktifkan modul **SPP Bulanan**, **Daftar Ulang**, dan **Jemputan**, serta bebas mengisi nominal tarif maupun membuat **Tagihan Manual** (contoh: Seragam, Study Tour, Buku, Ujian, Ekskul).
- **Akses & Autentikasi**: Login menggunakan Google Sign-In (standar Firebase Auth). Penentuan peran dilakukan melalui tabel keanggotaan sekolah/admin yang terverifikasi di database. Untuk memudahkan Anda mencoba seluruh sudut pandang saat peninjauan awal, Super Admin juga dapat menautkan akun Google ke sekolah atau mengelola akses staf keuangan dan wali murid secara langsung.

---

## 1. Overview & Core Concept

- **What It Does**: Platform SaaS keuangan sekolah (*multi-tenant*) di mana banyak sekolah beroperasi di atas satu sistem terpadu namun data keuangan setiap sekolah terisolasi secara ketat. Sekolah dapat menyesuaikan jenis tagihan sesuai kebutuhannya sendiri, menerbitkan tagihan massal maupun manual, menerima pembayaran tunai di kasir maupun non-tunai (VA/QRIS), serta menerbitkan kuitansi digital resmi.
- **Target Audience / Persona**:
  1. **Super Admin (Pemilik Aplikasi)**: Mengelola pendaftaran dan status aktif sekolah mitra, memantau volume transaksi agregat lintas sekolah, serta menyetujui/mengatur Admin Bagian Keuangan tiap sekolah.
  2. **Bagian Keuangan Sekolah (Bendahara / Staf TU)**: Mengatur modul aktif sekolah, menetapkan master tarif fleksibel, mengelola data siswa & wali murid, membuat tagihan rutin maupun manual, melayani pembayaran di Kasir Tunai, dan memantau rekonsiliasi VA/QRIS.
  3. **Wali Murid**: Memeriksa rincian tagihan anak (SPP bulanan, daftar ulang, jemputan, tagihan manual), membayar melalui Virtual Account atau QRIS, serta mengunduh/mencetak kuitansi lunas.
- **Key Value**: Menghilangkan kerumitan sistem terpisah per sekolah sekaligus mengakomodasi kebijakan biaya yang unik di tiap institusi—dari sekolah yang hanya menarik SPP bulanan hingga sekolah dengan layanan lengkap plus tagihan insidental manual.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Alur Super Admin (Pemilik Sistem)**
   - Masuk ke **Dasbor Eksekutif Platform** → Melihat ringkasan total sekolah aktif, total siswa terdaftar, serta total nilai transaksi bulan berjalan.
   - Membuka menu **Manajemen Sekolah** → Menambah sekolah baru (nama, jenjang, alamat, kode sekolah, admin penanggung jawab) atau mengubah status aktif/nonaktif dan modul default yang tersedia.
   - Membuka menu **Monitor Transaksi Lintas Sekolah** → Memfilter arus kas berdasarkan sekolah, kanal pembayaran (Tunai / VA / QRIS), dan periode.

2. **Alur Bagian Keuangan Sekolah**
   - **Pengaturan Modul & Tarif Fleksibel**: Mengaktifkan/menonaktifkan modul (*SPP Bulanan*, *Daftar Ulang*, *Jemputan*). Mengisi nominal tarif secara bebas (misal SPP Kelas 1–3 vs 4–6, Daftar Ulang Tahunan, atau Zona Jemputan A/B/C), ditambah kemampuan mengisi nominal khusus per siswa.
   - **Manajemen Siswa & Penautan Wali**: Menambah data siswa (NIS, Nama, Kelas, Email Wali Murid, status ikut jemputan & zona).
   - **Penerbitan Tagihan (Rutin & Manual)**:
     - *Generate Massal*: Terbitkan tagihan SPP bulan tertentu atau Daftar Ulang untuk satu kelas/seluruh siswa aktif dalam satu klik.
     - *Tagihan Manual*: Membuat tagihan kustom dengan judul bebas (misal "Seragam Batik" atau "Kegiatan Tengah Semester"), nominal bebas diisi oleh Bag. Keuangan, dan tenggat waktu fleksibel.
   - **Kasir Tunai**: Mencari nama/NIS siswa → Centang satu atau beberapa tagihan yang dibayar → Terima tunai & catat keterangan → Status tagihan langsung berubah **Lunas** dan kuitansi resmi siap dicetak.
   - **Laporan & Ekspor**: Ringkasan pemasukan terpisah per kategori (*SPP*, *Daftar Ulang*, *Jemputan*, *Manual*) dan metode (*Tunai*, *VA*, *QRIS*), lengkap dengan ekspor CSV.

3. **Alur Wali Murid**
   - Masuk menggunakan akun Google yang telah ditautkan ke data siswa oleh sekolah (atau menautkan melalui kode/NIS siswa yang diverifikasi).
   - Melihat **Ringkasan Tagihan Anak** yang dikelompokkan rapi antara *Tagihan Menunggu* dan *Riwayat Lunas*.
   - Memilih satu atau beberapa tagihan → Klik **Bayar Tagihan** → Memilih kanal:
     - **Virtual Account (VA)**: Memilih bank (misal BCA, Mandiri, BRI, BNI), melihat nomor VA unik, nominal tepat, dan panduan bayar (+ tombol simulasi konfirmasi bayar untuk pengujian).
     - **QRIS**: Menampilkan kode QRIS dinamis dengan nominal tagihan dan hitung mundur kedaluwarsa (+ tombol simulasi scan berhasil).
   - Setelah lunas, tagihan otomatis berpindah ke riwayat dan wali murid dapat membuka/mencetak **Kuitansi Pembayaran Resmi**.

### Visual Identity & Theme

- **Aesthetic Direction**: **Precision Educational Fintech** — bersih, editorial, terstruktur, dirancang layaknya perangkat lunak keuangan institusional modern. Menghindari dekorasi berlebihan, gradien mencolok, atau elemen bermain-main yang mengurangi kesan aman pada transaksi uang.
- **Color Palette & Mood (Aturan 60-30-10)**:
  - **60% Kanvas Netral**: Latar utama `#F8FAFC` (*Cool Alabaster*) dengan permukaan kerja `#FFFFFF` (*Pure White*) dan garis tepi tipis `#E2E8F0` (*1px hairline border*).
  - **30% Permukaan Struktural**: Sidebar navigasi `#0F172A` (*Deep Slate Navy*) dengan teks `#F8FAFC` untuk jangkar hierarki yang tegas, dipadukan teks isi `#1E293B` dan metadata sekunder `#64748B`.
  - **10% Aksen & Status Semantik**: Teal Institusional (`#0F766E` / `#0D9488`) khusus untuk aksi utama (*Bayar*, *Terbitkan Tagihan*, *Catat Kasir*) dan tab aktif. Status finansial selalu berpasangan warna + teks eksplisit: Hijau (`#16A34A` · *Lunas*), Amber (`#D97706` · *Menunggu*), dan Merah (`#DC2626` · *Jatuh Tempo*).
- **Typography & Hierarchy**:
  - **Display & Navigasi**: `Plus Jakarta Sans` (SemiBold 600 / Bold 700, `text-wrap: balance` pada judul).
  - **Isi & Tabel**: `DM Sans` atau `Plus Jakarta Sans` (Regular 400 / Medium 500, ukuran `13px–15px` untuk keterbacaan tabel keuangan yang padat).
  - **Angka Finansial & Kode Transaksi**: `JetBrains Mono` dengan `font-variant-numeric: tabular-nums` wajib di seluruh nominal Rupiah (`Rp`), nomor NIS, nomor VA, dan stempel waktu agar kolom angka sejajar presisi vertikal.
- **Component Styling & Layout**:
  - Tata letak Workspace Sidebar (`240px–260px`) + Top Header Bar 3-zona (*Breadcrumb konteks* di kiri, *Identitas pengguna & aksi utama* di kanan).
  - *Single-Elevation Depth*: Tidak menumpuk kartu di dalam kartu; pemisahan area menggunakan ruang kosong yang lega dan garis pemisah tipis.
  - *Zero-Pill Metadata*: Kategori layanan (*SPP*, *Daftar Ulang*, *Jemputan*, *Manual*) dan tanggal jatuh tempo ditampilkan sebagai teks tipografis bersih dengan pemisah `·`, bukan tumpukan kapsul/pill warna-warni.
  - Kelengkapan 4 kondisi pada setiap tabel/daftar: *Populated*, *Empty State* dengan tombol aksi pertama, *Skeleton Loading* presisi, serta *Live Search & Segmented Filter*.
- **Interactive Feedback & Motion**:
  - Transisi halus (`150ms–200ms`, `cubic-bezier(0.16, 1, 0.3, 1)`) pada perpindahan tab, drawer rincian transaksi, dan modal checkout VA/QRIS.
  - Notifikasi konfirmasi (*toast*) setelah penerbitan tagihan, pencatatan kasir tunai, atau pelunasan VA/QRIS.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Arsitektur Multi-Tenant Satu Database dengan Isolasi `schoolId`**
  - *Chosen Approach*: Seluruh sekolah menggunakan satu koleksi terpadu yang ditandai `schoolId` dan dilindungi aturan keamanan berbasis peran (*RBAC*).
  - *Why*: Memudahkan Super Admin memantau platform dalam satu tampilan, meminimalkan biaya pemeliharaan, dan memungkinkan satu wali murid memiliki anak di sekolah berbeda dalam satu akun.
  - *Alternatives Considered*: Memisahkan proyek/database per sekolah—ditolak karena tidak efisien untuk ratusan sekolah dan menyulitkan manajemen terpusat.

- **Decision 2: Modul Layanan Toggleable + Tagihan Manual Fleksibel**
  - *Chosen Approach*: Setiap profil sekolah menyimpan objek konfigurasi `enabledModules` (`spp`, `daftarUlang`, `jemputan`) dan daftar `feeTemplates` fleksibel, sedangkan koleksi tagihan (`invoices`) mendukung tipe `manual` dengan judul dan nominal bebas dari Bag. Keuangan.
  - *Why*: Menjawab langsung kebutuhan nyata bahwa Sekolah A, B, dan C memiliki kombinasi layanan dan besaran tarif yang sangat bervariasi, termasuk biaya insidental yang tidak terduga.
  - *Alternatives Considered*: Skema tarif statis yang dikunci per paket—terlalu kaku untuk kebutuhan sekolah di Indonesia.

- **Decision 3: Penyimpanan Data Persisten Menggunakan Cloud Firestore & Firebase Auth**
  - *Chosen Approach*: Menggunakan Firebase Authentication (Google Sign-In) + Cloud Firestore dengan skema `firebase-blueprint.json` dan aturan keamanan tervalidasi.
  - *Why*: Sinkronisasi real-time antar peran (saat wali murid melunasi VA/QRIS atau kasir menerima tunai, laporan sekolah langsung terbarui tanpa muat ulang), aman lintas perangkat, dan terintegrasi langsung dengan lingkungan deployment.
  - *Alternatives Considered*: Penyimpanan lokal browser (`localStorage`)—tidak dapat menghubungkan transaksi antara Wali Murid, Bag. Keuangan, dan Super Admin secara nyata.

- **Decision 4: Checkout VA & QRIS dengan Simulator Pelunasan Terintegrasi**
  - *Chosen Approach*: Menyediakan modal pembayaran lengkap (pemilihan bank VA, generate nomor VA deterministik/unik, rendering QRIS SVG dinamis sesuai nominal, serta status `pending_payment` → `paid`) disertai tombol simulasi pembayaran sukses.
  - *Why*: Memungkinkan pengujian menyeluruh alur digital dari ujung ke ujung tanpa harus memiliki akun merchant bank live terlebih dahulu, sambil menjaga struktur data transaksi tetap siap dihubungkan ke webhook Payment Gateway resmi.
  - *Alternatives Considered*: Hanya formulir unggah bukti transfer statis—kurang sesuai dengan permintaan alur VA dan QRIS yang interaktif.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                        CLOUD PERSISTENCE & AUTH LAYER                        │
│  Firebase Auth (Google Sign-In)  ◄───►  Cloud Firestore (Multi-Tenant DB)    │
│  [Role Lookup & Session State]          [Schools · Students · Invoices · Tx] │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Real-time Listeners & Security Rules
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     UNIFIED APPLICATION SHELL & ROUTER                       │
│   Role Gate & Onboarding (Deteksi Super Admin / Bag. Keuangan / Wali Murid)  │
└───────────┬──────────────────────────┬───────────────────────────┬───────────┘
            │                          │                           │
            ▼                          ▼                           ▼
┌───────────────────────┐  ┌────────────────────────┐  ┌───────────────────────┐
│  PORTAL SUPER ADMIN   │  │ PORTAL KEUANGAN SEKOLAH│  │  PORTAL WALI MURID    │
├───────────────────────┤  ├────────────────────────┤  ├───────────────────────┤
│ • Ringkasan Platform  │  │ • Toggle Modul Layanan │  │ • Daftar Tagihan Anak │
│ • Kelola Sekolah Mitra│  │ • Master Tarif Fleksibel│ │ • Checkout VA & QRIS  │
│ • Kelola Admin Sekolah│  │ • Data Siswa & Wali    │  │ • Riwayat Pembayaran  │
│ • Audit Transaksi     │  │ • Tagihan Massal/Manual│  │ • Cetak Kuitansi PDF  │
│                       │  │ • Loket Kasir Tunai    │  │                       │
│                       │  │ • Rekap & Ekspor CSV   │  │                       │
└───────────────────────┘  └────────────────────────┘  └───────────────────────┘
```

### Data Model & State

1. **Users (`users`)**: Profil pengguna terautentikasi (`uid`, `email`, `displayName`, `role`: `'super_admin' | 'school_finance' | 'parent'`, `schoolId` opsional untuk staf keuangan).
2. **Schools (`schools`)**: Data sekolah mitra (`id`, `name`, `code`, `level`, `status`: `'active' | 'inactive'`, `enabledModules`: `{ spp: boolean, daftarUlang: boolean, jemputan: boolean }`, `adminEmails`: daftar email staf keuangan yang berwenang).
3. **Fee Templates (`feeTemplates`)**: Master tarif fleksibel milik sekolah (`schoolId`, `category`: `'spp' | 'daftar_ulang' | 'jemputan'`, `name`, `amount`, `targetGrade` atau `pickupZone`, `billingCycle`). Nominal selalu dapat diedit oleh Bag. Keuangan.
4. **Students (`students`)**: Data siswa per sekolah (`schoolId`, `nis`, `name`, `grade`, `parentEmail`, `parentName`, `parentPhone`, `useShuttle`, `shuttleZone`, `customSppAmount` opsional, `status`).
5. **Invoices / Tagihan (`invoices`)**: Tagihan per siswa (`schoolId`, `studentId`, `studentName`, `category`: `'spp' | 'daftar_ulang' | 'jemputan' | 'manual'`, `title`, `period`, `amount`, `dueDate`, `status`: `'unpaid' | 'pending_payment' | 'paid'`, `paymentMethod`, `paidAt`, `receiptNumber`).
6. **Transactions (`transactions`)**: Catatan pembayaran sah untuk audit & kuitansi (`schoolId`, `invoiceIds`, `studentId`, `totalAmount`, `method`: `'cash' | 'va' | 'qris'`, `channelDetail` misal bank VA / QRIS ref, `status`: `'pending' | 'settled'`, `cashierUid` atau `payerUid`, `createdAt`, `settledAt`).

### Interactive Component & State Mapping

- **Konfigurasi Modul Sekolah**: Mengubah toggle `SPP`, `Daftar Ulang`, atau `Jemputan` di halaman Pengaturan Sekolah langsung memperbarui dokumen sekolah di Firestore dan menyaring menu tarif serta opsi pembuatan tagihan agar hanya menampilkan modul yang aktif di sekolah tersebut (ditambah opsi `Manual` yang selalu tersedia).
- **Generator Tagihan & Tagihan Manual**: Validasi nominal (`> 0`), judul wajib diisi untuk tagihan manual, dan pencegahan duplikasi tagihan SPP pada periode bulan yang sama untuk siswa yang sama.
- **Loket Kasir Tunai**: Mendukung pemilihan multi-tagihan untuk satu siswa, menghitung total otomatis dengan angka tabular, memvalidasi status belum lunas agar tidak terbayar ganda, lalu melakukan penulisan atomik (*batch write*) ke `invoices` dan `transactions`.
- **Modal Pembayaran VA & QRIS**: Membuat sesi transaksi berstatus `pending` dengan nomor VA atau payload QRIS yang dirender secara visual; konfirmasi pelunasan memperbarui transaksi menjadi `settled` dan seluruh tagihan terkait menjadi `paid` secara atomik, memicu tampilan kuitansi lunas seketika.
- **Keamanan & Isolasi Multi-Tenant**: Aturan Firestore memastikan Bag. Keuangan Sekolah hanya dapat membaca dan memodifikasi data dengan `schoolId` miliknya; Wali Murid hanya dapat membaca data siswa/tagihan yang ditautkan ke email terverifikasinya (`parentEmail`) serta melakukan inisiasi/penyelesaian pembayaran tagihan miliknya; Super Admin memiliki akses pengawasan lintas sekolah.
