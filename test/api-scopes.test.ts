import { describe, expect, it } from "vitest";
import { hasScope, normalizeScopes, parseScopes, SCOPE_KEYS } from "@/lib/api/scopes";

describe("api scopes", () => {
  it("parses comma-separated scopes", () => {
    expect(parseScopes(" contacts:read, messages:write ,,")).toEqual(["contacts:read", "messages:write"]);
  });

  it("requires the exact scope unless the token has full access", () => {
    expect(hasScope(["contacts:read"], "contacts:read")).toBe(true);
    expect(hasScope(["contacts:read"], "contacts:write")).toBe(false);
    expect(hasScope(["*"], "contacts:write")).toBe(true);
    expect(hasScope(["contacts:read"], "*")).toBe(false);
    expect(hasScope(["*"], "*")).toBe(true);
    expect(hasScope([], undefined)).toBe(true);
  });

  it("drops unknown scopes and deduplicates", () => {
    const scopes = normalizeScopes(["contacts:read", "nope", "*", "contacts:read"]);
    expect(scopes).toHaveLength(2);
    expect(scopes).toContain("contacts:read");
    expect(scopes).toContain("*");
  });

  it("exposes a stable scope catalogue", () => {
    expect(SCOPE_KEYS.has("contacts:read")).toBe(true);
    expect(SCOPE_KEYS.has("wallet:read")).toBe(true);
    expect(SCOPE_KEYS.has("made:up")).toBe(false);
  });
});
