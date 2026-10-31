// Duplicate-order protection for checkouts. OMS is idempotent on external_id,
// so the CRM only has to reuse the same external_id for the same order:
// - staff: one id per opened checkout form (double click / resubmit reuse it)
// - AI: one id per cart + recipient + address per day (repeat "ya", retries)
import { createHash } from "node:crypto";
import type { OrderBaru } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function norm(value: string | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Same items (any order), payment method, recipient and address => same fingerprint. */
export function orderFingerprint(payload: Pick<OrderBaru, "metode_bayar" | "penerima" | "alamat" | "items">) {
  const items = [...payload.items]
    .map((item) => `${item.sku.trim().toUpperCase()}x${item.qty}`)
    .sort()
    .join(",");
  const a = payload.alamat;
  const key = [
    payload.metode_bayar,
    items,
    payload.penerima.no_wa.replace(/\D/g, ""),
    norm(a.alamat),
    norm(a.kelurahan),
    norm(a.kecamatan),
    norm(a.kota),
    norm(a.provinsi),
    (a.kode_pos ?? "").trim(),
  ].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Calendar day in WIB (UTC+7), e.g. 20261031. */
export function wibDay(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
}

/** AI orders: identical order on the same WIB day maps to the same OMS order. */
export function aiCheckoutExternalId(conversationId: number, fingerprint: string, now = new Date()) {
  return `chk_${conversationId}_ai_${fingerprint}_${wibDay(now)}`;
}

/** Staff orders: the nonce is generated once per opened checkout form. */
export function staffCheckoutExternalId(conversationId: number, nonce: string) {
  if (!UUID.test(nonce)) throw new Error("Form order kedaluwarsa. Tutup lalu buka lagi form Buat Order.");
  return `chk_${conversationId}_${nonce.toLowerCase()}`;
}

/** Fingerprint of a stored checkout payload; null when the JSON is unreadable. */
export function storedFingerprint(rawPayload: string): string | null {
  try {
    return orderFingerprint(JSON.parse(rawPayload) as OrderBaru);
  } catch {
    return null;
  }
}
