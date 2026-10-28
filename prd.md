# PRD: Centris CRM (crm.centris.ai)

Dokumen ini disusun dari screenshot antarmuka yang dilampirkan. Ini adalah rekonstruksi dari tampilan yang terlihat, bukan spesifikasi resmi. Bagian yang belum terlihat ditandai **[TBD]**.

## 1. Ringkasan

Centris CRM adalah platform CRM berbahasa Indonesia untuk bisnis yang menjual lewat chat (terutama WhatsApp). Platform ini menggabungkan inbox pesan, manajemen pelanggan, funnel otomatis, AI Agent (customer service otomatis), broadcast, katalog produk, dan integrasi ke platform pihak ketiga. Contoh tenant yang terlihat: produk **Vivagoat** (susu kambing bubuk dengan madu dan rempah).

## 2. Tujuan Produk

- Membalas pelanggan secara cepat, dengan AI sebagai agen pertama dan staf manusia sebagai eskalasi.
- Mengarahkan calon pembeli melalui tahapan funnel (Lead → Product Inquiry → dst.) secara otomatis.
- Menjangkau banyak pelanggan sekaligus lewat broadcast dan audience.
- Mengelola beberapa nomor WhatsApp Business dan tim staf dalam satu dashboard.

## 3. Pengguna

- **Owner / Admin**: mengatur AI, produk, integrasi, staf, dan kuota koin.
- **Staf CS**: membalas pesan, menangani eskalasi, dan memantau chat.
- **Marketing**: membuat audience dan broadcast.

## 4. Modul dan Kebutuhan Fungsional

### 4.1 Dashboard
- Navigasi sisi kiri dengan ikon untuk setiap modul.
- Header global menampilkan saldo **Koin**, tombol **Isi Ulang**, **Upgrade Sekarang**, notifikasi (dengan badge 99+), avatar pengguna, dan pemilihan bahasa (ID).
- Banner pengumuman di bagian atas (contoh: update fitur AI dan peningkatan conversion rate).

### 4.2 Pesan (Inbox)
- Dua tampilan: **Daftar** dan **Kanban**.
- Filter tab: **Semua**, **Staf**, **Eskalasi**.
- Pencarian berdasarkan nama atau nomor telepon, serta filter lanjutan.
- Daftar percakapan menampilkan nama/nomor, waktu pesan terakhir, status centang (terkirim/dibaca), indikator belum dibaca, dan ikon sumber (WhatsApp).
- Panel kanan menampilkan detail percakapan saat pelanggan dipilih.

### 4.3 Pelanggan (Customer)
- Ikon menu terpisah dari Pesan. **[TBD]**: detail halaman belum terlihat di screenshot.

### 4.4 Kalender
- Ikon menu tersedia di sidebar. **[TBD]**: detail belum terlihat.

### 4.5 WhatsApp Business
- Dua tab: **WhatsApp Business** (ditandai RESMI) dan **WhatsApp Hub**.
- Info harga pengiriman pesan (PDF) dan tarif per volume yang berlaku sejak 1 Januari 2026, mengikuti zona waktu akun.
- Kartu per nomor perangkat, menampilkan nomor, badge **Cloud API** dan **COEX**, status koneksi (contoh: "Terhubung pada 6 days ago"), dan staf yang ditugaskan.
- Aksi per perangkat: **Staf Penugasan**, **Log Peristiwa**, **Atur Template Pesan**, **Status**, **Metode Pembayaran**, pengaturan, riwayat, dan hapus.
- Tombol **Tambah Perangkat** untuk menghubungkan nomor baru.

### 4.6 Produk
- Daftar produk dan halaman **Edit Product** dengan tab **Umum**, **Variasi**, dan **Pengaturan Prompt AI**.
- Field: Nama (wajib), Deskripsi (teks bebas), dan Product Images (JPEG/PNG, maksimal 2 MB per file, drag & drop atau pilih file, bisa lebih dari satu gambar).
- Gambar produk dipakai AI untuk menjawab pertanyaan pelanggan, misalnya tentang BPOM, sertifikasi halal, dan aturan penyajian.
- Tombol **Save**.

### 4.7 Funnels (Alur Kerja Pelanggan)
- Tab **Funnels** dan **Labels**.
- Alur dibangun secara bertingkat (Tingkat 1, Tingkat 2, dst.). Setiap tingkat berisi satu atau lebih tahapan.
- Setiap tahapan memiliki nama, deskripsi, nomor urut, penanda **AI** (jika dijalankan AI), dan aksi edit serta hapus.
- Contoh tahapan: **Lead** ("First time customer has a conversation and ha...") dan **Product Inquiry** ("The customer asks about products, product...").
- Tombol **Tambah Tahapan** dan penyisipan tingkat baru di antara tingkat.
- Tombol drag-handle untuk mengatur urutan.

### 4.8 Broadcast
- Tombol **Buat Broadcast Single** dan **Buat Broadcast Series**.
- Tabel berisi: Action, Nama Broadcast, Device, Status, Type, Created By, Date Updated.
- Saat ini kosong ("No data to display").

### 4.9 Audience
- Tombol **Tambah Audiens**, **Impor**, dan **Unduh contoh** (template CSV/Excel).
- Tabel berisi: Nama, Tipe, Total Pelanggan.
- Saat ini kosong.

### 4.10 Staff
- Tab **Staff**, **Grup**, dan **Manajemen Peran**.
- Tabel staf: Name, Phone, Email, Role (contoh: Admin), Member Group, Status (active), Date Created, Date Updated.
- Aksi per baris: edit, hapus, dan kalender.
- Tombol **Tambah Staff**.

### 4.11 AI Agent Settings
Halaman detail per agen, misalnya "Cs Vivagoat 2", dengan tab:
- **Perilaku AI**
  - **Informasi**: Nama agen, Deskripsi (instruksi perilaku, contoh: "gunakan bahasa yg santai, jangan terlihat baku/kaku, dan jangan pernah mengaku kalau kamu adalah ai"), dan **Pembelajaran Dasar AI** (contoh: Customer Service).
  - **Kepribadian AI**
  - **Produk**
  - **Pengaturan AI**
  - **Pengaturan Eskalasi**
- **Penugasan**: menugaskan agen ke nomor atau staf. **[TBD]**
- **Funnels**: menghubungkan agen ke funnel.
- **Auto-Followup**: follow-up otomatis berbasis waktu.
- **Integrasi**: integrasi khusus agen.
- Tombol **Simpan Perubahan** dan tombol melayang **AI Response Test** untuk menguji balasan AI sebelum dipakai.
- Sisa koin ditampilkan di header.

### 4.12 Integrasi
- **Outgoing Webhooks**: mengirim dan menerima pesan dari sistem eksternal (ada tombol Settings).
- **Messaging Platform**: Messenger, TikTok, Instagram, dan Telegram, semuanya berstatus **COMING SOON**.
- **Order Management Platform**:
  - **Scalev** (LP builder/order, sudah bisa diatur lewat Settings)
  - **AdForm** (form order dan landing page untuk e-commerce, belum aktif, tombol Upgrade)
  - **Berdu** (website/landing page tanpa coding, COMING SOON)
  - **Order Online** (order otomatis, COMING SOON)

## 5. Monetisasi

- Saldo **Koin** dipakai untuk fitur berbayar (contoh tampilan: 89.103 koin).
- Tombol **Isi Ulang** (top-up) dan **Upgrade Sekarang** (paket).
- **[TBD]**: aturan konsumsi koin per aksi (pesan AI, broadcast, dll.).

## 6. Persyaratan Non-Fungsional

- Antarmuka berbahasa Indonesia, format tanggal dan mata uang lokal (IDR).
- Responsif untuk desktop. **[TBD]**: kebutuhan mobile.
- Data pelanggan dan nomor telepon harus dijaga kerahasiaannya. Tidak boleh ditampilkan di log atau dokumen yang dibagikan.
- Waktu tampil sesuai zona waktu akun (contoh: Asia/Jakarta, UTC+07:00).

## 7. Pertanyaan Terbuka

1. Apa batas kuota koin per paket, dan berapa biaya per balasan AI?
2. Apakah satu akun bisa punya banyak agen AI dan banyak nomor WhatsApp?
3. Bagaimana alur eskalasi dari AI ke staf (kriteria, SLA, notifikasi)?
4. Apa perbedaan Auto-Followup dengan Funnel?
5. Kapan channel Messenger, Instagram, TikTok, dan Telegram rilis?
6. Apakah audience bisa dibuat dari filter tag atau label?

## 8. Metrik Keberhasilan (usulan)

- Persentase percakapan yang dibalas AI tanpa eskalasi.
- Waktu respons pertama.
- Conversion rate dari tahap Lead ke tahap akhir funnel.
- Tingkat keberhasilan broadcast (terkirim/dibaca).
