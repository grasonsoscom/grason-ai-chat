# Integrasi SaaS CS AI ↔ OMS GRASON

> **Update v3:** kontrak aktif sekarang `cs-ai.v3.yaml` (`/api/v3`) = v2 + pembatalan dan koreksi alamat. Lihat `V3-NOTES.md`.
>
> **Update v2:** kontrak aktif sekarang `cs-ai.v2.yaml` (`/api/v2`). Lihat `V2-NOTES.md`
> untuk `total`, subsidi COD, dan `segmen`. Panduan ini tetap berlaku untuk lead,
> verifikasi, dan webhook; v1 masih diterima OMS untuk klien lama.

Panduan ini untuk siapa pun (termasuk asisten AI) yang membangun integrasi SaaS CS AI GRASON
dengan OMS GRASON. Baca seluruhnya sebelum menulis kode integrasi.

Sumber kebenaran kontrak adalah file `cs-ai.v2.yaml` (OpenAPI 3.1) yang menyertai panduan ini.
Bila panduan ini dan file itu berbeda, ikuti `cs-ai.v2.yaml`, lalu laporkan perbedaannya ke
tim OMS.

## 1. Pembagian tanggung jawab

| SaaS CS AI memegang | OMS GRASON memegang |
| --- | --- |
| Percakapan WhatsApp (WABA), prompt, model, riwayat chat | Lead, order, status order, stok tersedia, harga jual |
| Keputusan kapan menyapa, menawarkan, follow-up, dan handover | Aturan bisnis: cek stok, pemecahan order per entitas, verifikasi COD, kirim ke gudang (WMS Ethix) |
| Menyimpan ID lead dan ID order dari OMS untuk tiap percakapan | Data pelanggan resmi dan riwayat RTS |

Aturan keras:

- **Hanya lewat API.** Jangan pernah membaca atau menulis database OMS secara langsung.
- **Jangan menghitung harga atau stok sendiri.** Selalu ambil dari `GET /prices` dan `GET /stock`.
- **Jangan menyimpan daftar SKU atau harga secara permanen di kode atau prompt.** Ambil dari API, boleh di-cache maksimal 5 menit.
- **OMS tidak memegang uang.** Pencairan COD diurus Finance dan Ethix di luar OMS. Nilai COD di order hanya angka yang harus ditagih kurir.

## 2. Status saat ini (Fase uji sambung)

- Kontrak v1 masih **draft**. Perubahan dibahas lewat tim OMS, bukan diubah sepihak.
- Semua data di OMS saat ini **data dummy**. Jangan kirim nomor WA atau alamat pelanggan asli.
- Endpoint arah **CS AI → OMS sudah siap diuji**: lead, order, verifikasi, cek order, stok, dan harga.
- Webhook **OMS → CS AI (`order.status_changed`) belum dikirim**. Sampai webhook aktif, cek status order dengan polling `GET /orders/{id}` (lihat bagian 7). Siapkan endpoint penerima webhook sekarang supaya tinggal diaktifkan.
- Base URL uji dan API key diberikan tim OMS lewat jalur pribadi.

## 3. Konfigurasi

Simpan di environment variable, jangan di repo:

```
OMS_BASE_URL=https://<alamat-dari-tim-oms>/api/v1
OMS_API_KEY=gok_<prefix>_<secret>
OMS_WEBHOOK_SECRET=<diberikan saat webhook diaktifkan>
```

Satu API key = satu lingkungan. Kunci staging dan production berbeda. Kunci hanya ditampilkan
sekali saat dibuat; bila hilang atau bocor, minta tim OMS mencabut dan membuat yang baru.

## 4. Aturan data

| Hal | Aturan |
| --- | --- |
| Autentikasi | Header `Authorization: Bearer gok_…` (atau `X-Api-Key: gok_…`) di setiap request |
| Format | JSON, nama field `snake_case` |
| Uang | Integer rupiah, tanpa desimal. `95000`, bukan `95000.00` atau `"95.000"` |
| Waktu | ISO-8601 UTC, misalnya `2026-10-30T02:15:00Z`. Konversi dari WIB (UTC+7) sebelum dikirim |
| Nomor WA | Boleh `08…`, `+62…`, atau `62…`. Respons OMS selalu `628…` |
| ID dari OMS | UUID. Simpan `id` lead dan `id` order dari respons OMS |
| `external_id` | ID di sistem CS AI (percakapan atau checkout). Harus stabil dan unik per jenis data |
| Idempotensi | Kirim ulang dengan `external_id` sama → OMS mengembalikan data yang sudah ada (HTTP 200), tidak membuat data baru |

Karena idempoten, aman mengulang request yang timeout atau gagal jaringan **dengan
`external_id` yang sama**. Jangan membuat `external_id` baru saat mengulang.

## 5. Alur percakapan → panggilan API

```
Percakapan baru masuk
  └─ POST /leads                         (simpan lead.id)
Balasan pertama terkirim
  └─ PATCH /leads/{id}  respon_pertama_at
Sebelum menawarkan produk
  ├─ GET /prices                         (harga + isi paket + entitas)
  └─ GET /stock?sku=...                  (stok tersedia)
Pembeli setuju membeli
  └─ POST /orders                        (simpan semua orders[].id dan nomor)
Sampaikan ke pembeli: nomor order, total, dan nilai COD PER ORDER
Pembeli mengonfirmasi alamat + nilai COD + bersedia bayar
  └─ POST /orders/{id}/verifikasi        (untuk SETIAP order di checkout)
Percakapan butuh manusia
  └─ PATCH /leads/{id}  handover
Percakapan selesai tanpa pembelian
  └─ PATCH /leads/{id}  status: gagal
Follow-up pengiriman
  └─ GET /orders/{id}  (polling sementara; nanti diganti webhook)
```

Status lead: `baru` → `direspon` → `follow_up` → `closing` atau `gagal`. Handover adalah flag
terpisah, bukan status.

Status `closing` **terisi otomatis** saat order dibuat dari lead itu. Jangan mengirim
`status: closing` lewat `PATCH` (ditolak dengan `closing_lewat_order`). Lead yang sudah closing
tidak bisa diubah statusnya lagi (`lead_sudah_closing`).

## 6. Endpoint

Semua path relatif terhadap `OMS_BASE_URL`.

### 6.1 `POST /leads`: buat lead

Panggil saat percakapan baru masuk. Atribusi iklan wajib dibawa bila ada; ini dasar ROAS.

```json
{
  "external_id": "conv_8f2a91",
  "no_wa": "081234567890",
  "nama": "Ibu Sari",
  "kanal": "click_to_whatsapp",
  "campaign_id": "120210000000000001",
  "adset_id": "120210000000000002",
  "ad_id": "120210000000000003",
  "sku_ditanya": "BSR-01",
  "masuk_at": "2026-10-30T02:15:00Z",
  "catatan": "Tanya untuk anak 5 tahun"
}
```

- Wajib: `external_id`, `no_wa`, `masuk_at`.
- `kanal`: `click_to_whatsapp`, `landing_page`, `organik`, atau `lainnya`.
- `campaign_id`, `adset_id`, `ad_id`: kirim persis seperti diterima dari Meta (string angka), jangan diubah. Bila tidak ada, kirim `null` atau hilangkan.
- Respons `201` (baru) atau `200` (sudah ada) berisi objek Lead dengan `id`. **Simpan `id` ini** dan pasangkan dengan percakapan.

### 6.2 `GET /leads/{id}`: ambil lead

Mengembalikan objek Lead terbaru.

### 6.3 `PATCH /leads/{id}`: update lead

Kirim hanya field yang berubah.

```json
{ "respon_pertama_at": "2026-10-30T02:15:40Z", "status": "direspon" }
```

```json
{ "handover": { "alasan": "Pembeli minta bicara dengan manusia", "terjadi_at": "2026-10-30T02:30:00Z" } }
```

- `respon_pertama_at` hanya tercatat sekali; kiriman berikutnya diabaikan.
- Setelah handover, lead masuk antrian CS Leader di OMS dan CS AI berhenti menangani percakapan itu. Handover tidak bisa dibatalkan lewat API.
- `409` bila perubahan bertentangan dengan status saat ini.

### 6.4 `POST /orders`: buat checkout

```json
{
  "external_id": "chk_8f2a91_1",
  "lead_id": "6b0f5c2e-0d1a-4c55-9a6e-2f1b7d9e4a10",
  "metode_bayar": "cod",
  "penerima": { "nama": "Sari Wulandari", "no_wa": "081234567890" },
  "alamat": {
    "alamat": "Jl. Melati No. 12, RT 03/RW 05, dekat masjid Al-Ikhlas",
    "kelurahan": "Sukajadi",
    "kecamatan": "Sukajadi",
    "kota": "Bandung",
    "provinsi": "Jawa Barat",
    "kode_pos": "40162"
  },
  "items": [
    { "sku": "BSR-01", "qty": 2 },
    { "sku": "VVG-01", "qty": 1 }
  ],
  "ongkir": 15000,
  "diskon": 0,
  "catatan": "Kirim sore"
}
```

- Wajib: `external_id`, `lead_id`, `metode_bayar` (`cod`/`transfer`), `penerima`, `alamat` (minimal `alamat`, `kota`, `provinsi`), dan `items` (1–20 item, qty 1–100).
- Item paket (misalnya `BSR-P2`) dikirim apa adanya; OMS yang mengurai ke gudang.
- `ongkir` dan `diskon` untuk seluruh checkout. Pembagiannya ke tiap order diatur OMS.

**Checkout campur entitas.** Produk terbagi dua entitas: Vivagoat = SSR; Bio Serea, Kapsul
Kutuk, Wight Up = FHI. Bila satu checkout berisi keduanya, OMS membuat **dua order** dalam satu
`order_group_id`. Masing-masing punya `nomor`, `total`, dan `nilai_cod` sendiri, dan akan datang
sebagai **dua paket terpisah** dengan dua tagihan COD.

Respons `201`/`200` (objek Checkout):

```json
{
  "order_group_id": "…",
  "external_id": "chk_8f2a91_1",
  "orders": [
    { "id": "…", "nomor": "GRS-20261030-0012", "entitas": "FHI", "status": "baru",
      "metode_bayar": "cod", "total": 197500, "nilai_cod": 197500,
      "perlu_verifikasi_manusia": false, "items": [ … ] },
    { "id": "…", "nomor": "GRS-20261030-0013", "entitas": "SSR", "status": "baru",
      "metode_bayar": "cod", "total": 49500, "nilai_cod": 49500,
      "perlu_verifikasi_manusia": false, "items": [ … ] }
  ]
}
```

(Angka di atas hanya ilustrasi. Selalu pakai angka dari respons OMS.)

Yang wajib dilakukan CS AI setelah respons ini:

1. Simpan setiap `orders[].id` dan `nomor`.
2. Sampaikan ke pembeli **setiap nomor order dan nilai COD-nya**. Bila ada dua order, jelaskan bahwa akan ada dua paket dan dua tagihan COD.
3. Bila ada order dengan `perlu_verifikasi_manusia: true`, lakukan handover untuk lead itu. Verifikasi dari CS AI akan ditolak.

### 6.5 `POST /orders/{id}/verifikasi`: verifikasi order

Panggil setelah pembeli mengonfirmasi alamat lengkap, nilai COD, dan kesediaan bayar. Order COD
baru dikirim ke gudang setelah langkah ini. **Satu panggilan per order**; checkout campur berarti
dua panggilan.

```json
{
  "dikonfirmasi_at": "2026-10-30T02:40:00Z",
  "nilai_cod_dikonfirmasi": 197500,
  "catatan": "Pembeli konfirmasi via chat"
}
```

- `nilai_cod_dikonfirmasi` harus sama persis dengan `nilai_cod` order itu. Isi `0` untuk transfer.
- Idempoten: memanggil ulang order yang sudah terverifikasi mengembalikan `200`.

### 6.6 `GET /orders/{id}`: status order

Mengembalikan objek Order, termasuk `status` dan `pengiriman` (kurir, resi, status kurir,
percobaan antar).

Status order: `baru` → `terverifikasi` → `di_gudang` → `dikirim` → `terkirim`. Jalur keluar:
`batal` (sebelum gudang mengemas) dan `rts` (gagal antar atau COD ditolak, paket kembali).
`terkirim` adalah status akhir sukses.

### 6.7 `GET /stock`: stok tersedia

`GET /stock?sku=BSR-01,BSR-P2`. Tanpa parameter = semua produk aktif. Untuk paket, stok sudah
dihitung dari komponennya. Jangan menawarkan qty melebihi `tersedia`.

### 6.8 `GET /prices`: harga aktif

Mengembalikan `sku`, `nama`, `tipe` (`satuan`/`paket`), `entitas`, `harga_jual`, dan `komponen`
(isi paket). SKU saat ini masih **placeholder** sampai ada SKU resmi gudang: `VVG-01`, `BSR-01`,
`KKT-01`, `WUP-01`, serta paket `-P2` dan `-P3` (misalnya `BSR-P2`). Karena itu SKU dan harga
wajib diambil dari endpoint ini, bukan ditulis tetap.

## 7. Menangani error

Semua error berbentuk:

```json
{ "error": { "kode": "stok_tidak_cukup", "pesan": "Stok tidak cukup", "detail": [ … ] } }
```

Pakai `error.kode` untuk logika program. `error.pesan` hanya untuk log atau manusia; jangan
ditampilkan mentah ke pembeli.

| HTTP | `error.kode` | Arti | Tindakan CS AI |
| --- | --- | --- | --- |
| 400 | `validasi_gagal` | Field salah atau kurang; `detail` berisi field dan pesannya | Perbaiki data (minta ulang ke pembeli bila perlu). Jangan diulang tanpa perubahan |
| 401 | `tidak_terautentikasi` | API key salah, hilang, atau dicabut | Hentikan pemanggilan, kirim alert ke tim |
| 403 | `tidak_diizinkan` | API key tidak punya izin untuk endpoint ini | Kirim alert ke tim OMS |
| 404 | `tidak_ditemukan`, `lead_tidak_ditemukan` | Lead atau order tidak ada | Cek ID yang tersimpan |
| 409 | `status_tidak_sesuai`, `status_berubah`, `lead_sudah_closing`, `closing_lewat_order` | Status sudah berubah atau perubahan tidak diizinkan, misalnya order sudah lewat verifikasi atau batal | Ambil data terbaru dengan GET, lanjutkan sesuai status |
| 422 | `stok_tidak_cukup` | `detail` berisi `sku`, `diminta`, `tersedia` | Tawarkan qty yang tersedia atau produk lain |
| 422 | `sku_tidak_dikenal` / `produk_nonaktif` | SKU salah atau tidak dijual | Ambil ulang `/prices`, tawarkan produk yang aktif |
| 422 | `perlu_verifikasi_manusia` | Pelanggan punya riwayat RTS | Handover ke CS manusia |
| 422 | `nilai_cod_tidak_cocok` | Nilai yang dikonfirmasi berbeda dari `nilai_cod` | Konfirmasi ulang ke pembeli dengan angka dari OMS |
| 429 | `terlalu_banyak_permintaan` | Terlalu banyak request (batas laju sedang disiapkan) | Tunggu, lalu ulangi dengan jeda bertambah |
| 5xx / timeout | | Gangguan di OMS atau jaringan | Ulangi dengan jeda bertambah (misalnya 2, 4, 8, 16 detik) dan `external_id` yang sama |

Bila OMS tidak bisa dihubungi saat pembeli sudah setuju membeli, jangan katakan order sudah
dibuat. Simpan permintaan di antrian, ulangi di belakang layar, dan beri tahu pembeli bahwa
pesanan sedang diproses.

## 8. Webhook `order.status_changed` (siapkan sekarang, aktif menyusul)

OMS akan mengirim `POST` ke URL milik CS AI setiap status order dari CS AI berubah. Tujuannya
follow-up otomatis: resi terbit, gagal antar (hubungi pembeli sebelum paket dikembalikan), COD
ditolak, dan lainnya.

Header:

- `X-Oms-Signature: sha256=<hex>`: HMAC-SHA256 dari `<X-Oms-Timestamp>.<body mentah>` dengan `OMS_WEBHOOK_SECRET`.
- `X-Oms-Timestamp`: detik sejak epoch (UTC).
- `Idempotency-Key`: sama dengan `event_id`.

Body:

```json
{
  "event_id": "2c1e…",
  "jenis": "order.status_changed",
  "terjadi_at": "2026-10-31T06:20:00Z",
  "data": {
    "order_id": "…", "nomor": "GRS-20261030-0012", "order_group_id": "…",
    "checkout_external_id": "chk_8f2a91_1",
    "lead_id": "…", "lead_external_id": "conv_8f2a91",
    "status_sebelum": "dikirim", "status": "dikirim",
    "alasan": "gagal_antar", "kurir": "JNE", "resi": "JNE0123456789",
    "percobaan_antar": 1
  }
}
```

Contoh nilai `alasan`: `resi_terbit`, `gagal_antar`, `cod_ditolak`, `dibatalkan_pembeli`.

Aturan penerima:

1. Verifikasi tanda tangan memakai **body mentah** (sebelum di-parse JSON). Tolak (`400`) bila tanda tangan salah atau timestamp lebih dari 5 menit dari waktu sekarang.
2. Balas `2xx` dalam 10 detik. Proses berat (kirim pesan WA) dikerjakan di antrian setelah membalas.
3. Event bisa datang lebih dari sekali. Abaikan `event_id` yang sudah pernah diproses.
4. Urutan tidak dijamin. Pakai `terjadi_at`, dan abaikan event yang lebih lama dari status yang sudah tersimpan.
5. Bila tidak dibalas `2xx`, OMS mengulang dengan jeda bertambah (30 detik, 1, 2, 4 menit, dan seterusnya), maksimal 8 kali.

Contoh verifikasi (Node.js):

```js
import crypto from 'node:crypto';

export function webhookSah(rawBody, headers, secret) {
  const ts = Number(headers['x-oms-timestamp']);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const harapan =
    'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const diterima = String(headers['x-oms-signature'] ?? '');
  const a = Buffer.from(harapan);
  const b = Buffer.from(diterima);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Sampai webhook aktif, polling `GET /orders/{id}` untuk order yang belum `terkirim`, `batal`,
atau `rts`, paling sering tiap 30 menit per order.

## 9. Saran implementasi

- Buat satu modul klien OMS (`omsClient`) yang menangani base URL, API key, timeout (10 detik), retry dengan jeda bertambah, dan pemetaan error ke `error.kode`. Bagian lain kode tidak memanggil HTTP OMS secara langsung.
- Simpan pemetaan di database CS AI: `percakapan ↔ lead.id OMS` dan `checkout ↔ order_group_id + orders[].id`.
- Pakai antrian keluar (outbox) untuk panggilan yang harus berhasil (buat lead, buat order, verifikasi), supaya tidak hilang saat OMS sedang gangguan.
- Log setiap panggilan ke OMS: endpoint, `external_id`, status HTTP, `error.kode`, dan durasi. Jangan mencatat API key.
- Tes dengan mock berdasarkan `cs-ai.v1.yaml`, lalu tes ke OMS staging.

## 10. Daftar uji sambung

Jalankan berurutan ke OMS uji, lalu cek hasilnya bersama tim OMS di dashboard.

- [ ] `GET /prices` dan `GET /stock` berhasil dengan API key
- [ ] API key salah → `401`
- [ ] Buat lead dengan atribusi iklan → `201`; kirim ulang dengan `external_id` sama → `200`, data sama
- [ ] Nomor WA `08…`, `+62…`, dan `62…` → tersimpan sebagai `628…`
- [ ] `PATCH` respon pertama dan status `direspon`
- [ ] Buat order satu entitas (misalnya `BSR-01` x2, COD) → satu order
- [ ] Buat order campur (`BSR-01` + `VVG-01`) → dua order dalam satu grup; pesan ke pembeli menyebut dua nomor dan dua nilai COD
- [ ] Order melebihi stok → `422 stok_tidak_cukup`, CS AI menawarkan qty yang tersedia
- [ ] Verifikasi dengan nilai COD benar → `terverifikasi`; dengan nilai salah → `422 nilai_cod_tidak_cocok`
- [ ] Verifikasi order pelanggan bertanda RTS → `422 perlu_verifikasi_manusia` → handover terjadi
- [ ] Handover lead → muncul di antrian CS Leader di OMS
- [ ] Simulasi OMS mati atau timeout → request diulang tanpa data ganda

## 11. Pertanyaan yang perlu dijawab tim CS AI

1. Apakah ID percakapan dan ID checkout di CS AI stabil dan unik, sehingga bisa dipakai sebagai `external_id`?
2. Apakah CS AI bisa menyimpan `lead.id` OMS dari respons `POST /leads`, atau perlu endpoint cari lead berdasarkan `external_id`?
3. Webhook: di mana URL penerimanya, bagaimana secret disimpan, dan apakah sanggup memverifikasi HMAC serta membalas `2xx` dalam 10 detik?
4. Untuk checkout campur SSR dan FHI, apakah percakapan bisa menyampaikan dua nomor order dan dua nilai COD ke pembeli?
5. Kapan tepatnya CS AI menganggap order terverifikasi?
6. Apakah ID iklan dari click-to-WhatsApp dan UTM landing page sudah diterima CS AI, dalam format apa, dan apakah sama persis dengan yang dipakai tim ADV AI untuk data spend?
7. Saat order ditolak karena stok atau perlu verifikasi manusia, apa yang dilakukan CS AI? Apakah otomatis handover?
8. Berapa perkiraan volume lead dan order per hari, untuk menentukan batas laju?

Batas tanggapan: **5 November 2026**. Kirim jawaban dan usulan perubahan kontrak ke tim OMS.
