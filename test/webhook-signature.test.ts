import { describe, expect, it } from "vitest";
import {
  generateWebhookSecret,
  signWebhook,
  verifyWebhookSignature,
} from "@/lib/webhooks/signature";

const SECRET = "whsec_test_secret";
const RAW = JSON.stringify({ event: "contact.created", event_id: "e1" });

describe("outbound webhook signatures", () => {
  it("generates a whsec_ secret", () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith("whsec_")).toBe(true);
    expect(secret.length).toBeGreaterThan(20);
  });

  it("signs and verifies a delivery", () => {
    const now = 1_800_000_000;
    const header = signWebhook(SECRET, now, RAW);
    expect(header.startsWith(`t=${now},v1=`)).toBe(true);
    expect(verifyWebhookSignature(RAW, header, SECRET, 300, now)).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    const now = 1_800_000_000;
    const header = signWebhook(SECRET, now, RAW);
    expect(verifyWebhookSignature(RAW, header, SECRET, 300, now + 301)).toBe(false);
  });

  it("rejects a tampered body or wrong secret", () => {
    const now = 1_800_000_000;
    const header = signWebhook(SECRET, now, RAW);
    expect(verifyWebhookSignature(`${RAW} `, header, SECRET, 300, now)).toBe(false);
    expect(verifyWebhookSignature(RAW, signWebhook("wrong", now, RAW), SECRET, 300, now)).toBe(false);
  });

  it("rejects malformed headers and empty secrets", () => {
    const now = 1_800_000_000;
    expect(verifyWebhookSignature(RAW, "deadbeef", SECRET, 300, now)).toBe(false);
    expect(verifyWebhookSignature(RAW, null, SECRET, 300, now)).toBe(false);
    expect(verifyWebhookSignature(RAW, signWebhook(SECRET, now, RAW), "", 300, now)).toBe(false);
  });
});
