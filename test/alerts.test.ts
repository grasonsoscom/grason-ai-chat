import { afterEach, describe, expect, it } from "vitest";
import { alertRecipients, shouldAlert } from "@/lib/alerts";

afterEach(() => {
  delete process.env.ALERT_WHATSAPP;
});

describe("admin alerts", () => {
  it("reads recipients and ignores junk", () => {
    process.env.ALERT_WHATSAPP = "+62 812-0000-0001, 6281200000002,, abc";
    expect(alertRecipients()).toEqual(["6281200000001", "6281200000002"]);
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
