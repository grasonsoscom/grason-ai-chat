// Data-shape rules from section 4 of docs/oms/INTEGRASI-OMS-GRASON.md.

/** OMS stores Indonesian WA numbers as 628…; accepts 08…, +62… and 62…. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) throw new Error("Nomor WA kosong.");
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

/** OMS money is an integer rupiah amount (no decimals). */
export function isRupiah(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function assertRupiah(value: number, label: string): number {
  if (!isRupiah(value)) throw new Error(`${label} harus berupa angka rupiah bulat (tanpa desimal).`);
  return value;
}

/** OMS accepts ISO-8601 UTC; Date#toISOString always ends with Z. */
export function isoUtc(value: Date | string = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Waktu tidak valid.");
  return date.toISOString();
}

/** Stable per conversation; used as the OMS lead external_id. */
export function leadExternalId(conversationId: number): string {
  return `conv_${conversationId}`;
}

/** Stable once persisted; retries must reuse the stored value, never regenerate it. */
export function checkoutExternalId(conversationId: number, id = crypto.randomUUID()): string {
  return `chk_${conversationId}_${id}`;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
