// Sample import file with fictitious contacts.
const CSV = "nama,telepon,email\nContoh Pelanggan 1,+6280000009001,contoh1@example.test\nContoh Pelanggan 2,+6280000009002,\n";

export function GET() {
  return new Response("﻿" + CSV, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="contoh-audiens.csv"' },
  });
}
