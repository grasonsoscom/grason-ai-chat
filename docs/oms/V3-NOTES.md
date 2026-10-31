# Catatan cs-ai.v3

Kontrak aktif: `cs-ai.v3.yaml` (`OMS_BASE_URL=…/api/v3`). Keputusan OMS 0007.

v3 = semua endpoint dan respons v2, ditambah:

- `POST /orders/{id}/batal` `{ alasan }` — dipakai `cancelOrder()` (src/lib/oms/client.ts).
- `PATCH /orders/{id}/alamat` `{ alamat, penerima? }` — dipakai `correctOrderAddress()`.

Keduanya hanya untuk order berstatus `baru` atau `terverifikasi`; selain itu OMS membalas 409.
Ongkir dan nilai COD **tidak** dihitung ulang saat alamat diubah.

Aturan di CRM (src/lib/oms/order-changes.ts):

- Pembeli wajib mengonfirmasi di chat: "Balas BATAL" untuk batal, "Balas YA" untuk alamat baru.
- Alamat baru wajib lengkap (jalan + RT/RW, kecamatan, kota, provinsi, kode pos) dan di kota
  yang sama. Beda kota, status `di_gudang`/`dikirim`, atau galat OMS → eskalasi ke staf.
- Staf bisa membatalkan atau mengubah alamat dari panel order di menu Pesan.
