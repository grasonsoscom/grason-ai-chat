import { afterEach, describe, expect, it } from "vitest";
import { alertRecipients, cleanRecipients, shouldAlert } from "@/lib/alerts";

afterEach(() => {
  delete process.env.ALERT_WHATSAPP;
});

describe("admin alerts", () => {
  it("reads recipients and ignores junk", () => {
    process.env.ALERT_WHATSAPP = "+62 812-0000-0001, 6281200000002,, abc";
    expect(alertRecipients()).toEqual(["6281200000001", "6281200000002"]);
  });

  it("cleans a sender's own recipient list (TikTok Studio)", () => {
    expect(cleanRecipients(["0812-0000-0001", "+62 812 0000 0002", "81200000003", "6281200000001", "021555123", "abc", null])).toEqual([
      "6281200000001",
      "6281200000002",
      "6281200000003",
    ]);
    expect(cleanRecipients("6281200000001")).toEqual([]);
    expect(cleanRecipients(Array.from({ length: 15 }, (_, i) => `08120000${String(i).padStart(4, "0")}`))).toHaveLength(10);
  });

  it("is off without recipients", () => {
    expect(alertRecipients()).toEqual([]);
  });

  it("throttles the same key", () => {
    const t = 1_000_000;
    expect(shouldAlert("k", 60_000, t)).toBe(true);
    expect(shouldAlert("k", 60_000, t + 30_000)).toBe(false);
    expect(shouldAlert("other", 60_000, t + 30_000)).toBe(true);
    expect(shouldAlert("k", 60_000, t + 61_000)).toBe(true);
    expect(shouldAlert("k", 0, t + 61_001)).toBe(true);
  });
});
