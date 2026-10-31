import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { verifyOmsSignature } from "@/lib/oms/signature";

const SECRET = "whsec_test_secret";
const RAW = JSON.stringify({ event_id: "e1", jenis: "order.status_changed" });

function sign(timestamp: number, raw = RAW, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex")}`;
}

describe("verifyOmsSignature", () => {
  it("accepts a valid signature", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyOmsSignature(RAW, sign(ts), String(ts), SECRET)).toBe(true);
  });

  it("rejects a wrong secret", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyOmsSignature(RAW, sign(ts, RAW, "wrong"), String(ts), SECRET)).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    const ts = Math.floor(Date.now() / 1000) - 301;
    expect(verifyOmsSignature(RAW, sign(ts), String(ts), SECRET)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyOmsSignature(`${RAW} `, sign(ts), String(ts), SECRET)).toBe(false);
  });

  it("rejects a malformed or missing signature", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyOmsSignature(RAW, "deadbeef", String(ts), SECRET)).toBe(false);
    expect(verifyOmsSignature(RAW, null, String(ts), SECRET)).toBe(false);
  });

  it("rejects when the secret is empty", () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyOmsSignature(RAW, sign(ts), String(ts), "")).toBe(false);
  });
});
