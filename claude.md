# CLAUDE.md: Centris CRM

Panduan untuk Claude saat bekerja di proyek ini. Baca `prd.md` untuk konteks produk lengkap.

## Tentang proyek

Centris CRM (crm.centris.ai) adalah CRM berbahasa Indonesia untuk bisnis yang berjualan lewat WhatsApp. Modul utamanya: Pesan (inbox), Pelanggan, WhatsApp Business, Produk, Funnels, Broadcast, Audience, Staff, AI Agent, dan Integrasi.

**Stack:** Next.js 15 (App Router, Server Actions), TypeScript 5, Tailwind CSS 4, Prisma 6 + SQLite, Claude API (`@anthropic-ai/sdk`). Logika domain di `src/lib/`, satu folder per modul di `src/app/(app)/`. Lihat `README.md` untuk setup. Hosting: **[TBD]**

## Bahasa

- Seluruh UI dan teks pengguna dalam Bahasa Indonesia. Gunakan istilah yang sudah dipakai di UI (Pesan, Staf, Eskalasi, Tahapan, Audiens, Koin).
- Dokumentasi internal boleh campuran Indonesia dan Inggris, tetapi konsisten dalam satu dokumen.
- Istilah teknis (funnel, broadcast, webhook, template) tetap dalam bahasa aslinya.

## Aturan untuk perilaku AI Agent

Ini penting karena teks di field **Deskripsi** AI Agent langsung memengaruhi balasan ke pelanggan.

- Balasan AI harus terdengar santai dan natural, tidak kaku.
- AI tidak boleh mengaku sebagai AI jika agen diatur demikian (lihat contoh "Cs Vivagoat 2"). Perlakukan instruksi ini sebagai bagian dari konfigurasi bisnis, dan jangan mengubahnya tanpa diminta.
- Saat mengubah prompt default, jangan menghapus instruksi yang sudah ada tanpa konfirmasi.
- Gunakan **AI Response Test** untuk menguji balasan sebelum perubahan prompt disimpan.

## Aturan untuk data

- Nomor telepon, email, dan data pelanggan adalah data pribadi. Jangan menampilkannya di contoh, log, komentar kode, atau fixture kecuali sudah disamarkan.
- Jangan memasukkan API key, token WhatsApp, atau kredensial integrasi (Scalev, webhook, dll.) ke dalam kode atau dokumen.
- Nomor perangkat WhatsApp (Cloud API) dan ID akun termasuk informasi sensitif.

## Aturan untuk fitur

- **Koin**: setiap fitur yang mengonsumsi koin harus mengecek saldo sebelum berjalan, dan harus menampilkan pesan jelas jika saldo tidak cukup. Jangan biarkan transaksi gagal diam-diam.
- **WhatsApp**: kirim pesan template di luar jendela 24 jam. Ikuti aturan Meta yang berlaku. **[TBD]**: verifikasi aturan terbaru.
- **Upload gambar produk**: batas 2 MB per file, format JPEG dan PNG. Validasi di sisi klien dan server.
- **Funnel**: setiap tahapan memiliki nomor urut. Saat menyisipkan atau menghapus tahapan, urutkan ulang secara konsisten.
- **Status kosong**: halaman Broadcast dan Audience saat ini kosong. Tampilkan state kosong yang jelas dan tombol aksi utama.

## Cara bekerja

- Sebelum mengubah fitur yang sudah ada, baca PRD di bagian terkait dan cek apakah ada item di "Pertanyaan Terbuka".
- Untuk fitur yang statusnya **COMING SOON** (Messenger, TikTok, Instagram, Telegram, Berdu, Order Online), jangan membangun implementasi penuh kecuali diminta.
- Jika ada keputusan produk yang belum jelas, tanyakan dulu. Jangan menebak aturan koin, harga, atau perilaku eskalasi.
- Setiap perubahan pada teks prompt AI atau template pesan harus disebutkan secara eksplisit di ringkasan.

## Gaya kode dan komunikasi

- Pesan commit dan dokumentasi teknis dalam Bahasa Inggris. Teks yang dilihat pengguna dalam Bahasa Indonesia.
- Ringkas. Hindari penjelasan yang tidak diminta.
