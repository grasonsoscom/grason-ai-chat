import { describe, expect, it } from "vitest";
import { generateApiToken, hashApiToken, isTokenActive, parseApiToken } from "@/lib/api/tokens";

describe("api tokens", () => {
  it("generates a gro_ token with an 8-character prefix", () => {
    const generated = generateApiToken();
    expect(generated.token.startsWith("gro_")).toBe(true);
    expect(generated.prefix).toMatch(/^[a-f0-9]{8}$/);
    expect(generated.token).toContain(`gro_${generated.prefix}_`);
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.tokenHash).not.toBe(generated.token);
  });

  it("parses the token and hashes it deterministically", () => {
    const generated = generateApiToken();
    const parsed = parseApiToken(generated.token);
    expect(parsed?.prefix).toBe(generated.prefix);
    expect(hashApiToken(generated.token)).toBe(generated.tokenHash);
    expect(hashApiToken(generated.token)).toBe(hashApiToken(generated.token));
  });

  it("rejects malformed tokens", () => {
    expect(parseApiToken("not-a-token")).toBeNull();
    expect(parseApiToken("gro_short_secret")).toBeNull();
    expect(parseApiToken("")).toBeNull();
  });

  it("checks revocation and expiry", () => {
    const now = new Date("2026-10-30T00:00:00Z");
    expect(isTokenActive({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(isTokenActive({ revokedAt: now, expiresAt: null }, now)).toBe(false);
    expect(isTokenActive({ revokedAt: null, expiresAt: new Date("2026-10-29T00:00:00Z") }, now)).toBe(false);
    expect(isTokenActive({ revokedAt: null, expiresAt: new Date("2026-10-31T00:00:00Z") }, now)).toBe(true);
  });
});
