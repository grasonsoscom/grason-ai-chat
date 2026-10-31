# OMS CS AI v2 — catatan implementasi

Kontrak aktif ada di `cs-ai.v2.yaml`; endpoint ada di **`/api/v2`**. OMS tetap
melayani `/api/v1` untuk klien lama, termasuk tanpa rincian COD.

## Perbedaan dari v1

- `POST /orders` **wajib** membawa `total` yang dihitung CS AI.
- Rincian COD yang dikirim:
  - `subsidi_ongkir` (maksimal `ongkir`)
  - `biaya_cod` (0 untuk transfer)
  - `subsidi_admin_cod` (maksimal `biaya_cod`)
  - `segmen` (`nc` | `ro` | `reseller`, opsional)
- OMS memvalidasi:

  ```text
  total = subtotal − diskon + ongkir − subsidi_ongkir + biaya_cod − subsidi_admin_cod
  ```

  dengan `subtotal` dari harga aktif OMS (`GET /prices`). `nilai_cod = total`
  untuk COD.
- Jika tidak cocok, OMS membalas `422` dengan kode `total_tidak_cocok` dan detail
  `total_dikirim`, `total_oms`, `subtotal_oms`, dan daftar `items`.
- Rincian yang tidak masuk akal (subsidi ongkir > ongkir, subsidi admin > biaya COD,
  biaya COD pada transfer, diskon > subtotal) dibalas `422 rincian_tidak_valid`.
- Lead dan order membawa `segmen` opsional. `LeadBaru.segmen` dan `OrderBaru.segmen`
  boleh dikirim saat membuat data.
- Respons `Order` v2 menyertakan `subsidi_ongkir`, `biaya_cod`,
  `subsidi_admin_cod`, dan `segmen`.

## Implementasi di grason-ai-chat

- `src/lib/promo-quote.ts`: aturan murni subsidi/COD + `orderQuote` untuk cart.
  Modul ini aman dipakai client maupun server.
- `src/lib/promo.ts`: `customerSegment` (staff-set atau otomatis RO setelah 7 hari).
- `createOmsCheckout` di `src/app/(app)/pesan/actions.ts`:
  - mengambil harga dari `GET /prices`,
  - menghitung subtotal dari SKU/qty,
  - menghitung `quote` dengan segmen, provinsi (Jawa/luar), metode bayar,
  - mengirim `total` dan rincian ke `POST /orders`.
- `OMS_BASE_URL` harus berakhir di `/api/v2` untuk memakai kontrak ini.

## Rumus promo (sumber: promo.ts)

- Biaya COD: 3% dari (subtotal + ongkir), dibulatkan ke rupiah.
- Subsidi ongkir:
  - NC Jawa: maksimal 25.000; NC luar Jawa: 25.000 jika ongkir ≥ 50.000, selain itu 50%.
  - RO Jawa: maksimal 30.000; RO luar Jawa: maksimal 50.000.
  - Reseller: tidak ada.
- Subsidi admin COD: 5.000, hanya jika subtotal + ongkir mencapai minimum
  (NC/RO 120.000; reseller 200.000).
- Biaya COD/subsidi hanya untuk COD; transfer tidak memakai rincian tersebut.
