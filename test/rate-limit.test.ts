import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  resetRateLimits,
} from "@/lib/api/rate-limit";

describe("api rate limit", () => {
  beforeEach(() => resetRateLimits());

  it("allows 60 requests per window and blocks the next one", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      expect(checkRateLimit("token:1", now).allowed).toBe(true);
    }
    const blocked = checkRateLimit("token:1", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("resets after the window", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit("token:1", now);
    expect(checkRateLimit("token:1", now).allowed).toBe(false);
    expect(checkRateLimit("token:1", now + RATE_LIMIT_WINDOW_MS).allowed).toBe(true);
  });

  it("keeps buckets per token", () => {
    const now = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_MAX; i++) checkRateLimit("token:1", now);
    expect(checkRateLimit("token:1", now).allowed).toBe(false);
    expect(checkRateLimit("token:2", now).allowed).toBe(true);
  });
});
