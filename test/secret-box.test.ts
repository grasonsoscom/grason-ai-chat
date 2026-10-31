import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../src/lib/secret-box";

describe("secret-box", () => {
  const original = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-for-unit-tests";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = original;
  });

  it("round-trips a secret", () => {
    const sealed = encryptSecret("sk-live-1234567890");
    expect(sealed).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(sealed).not.toContain("sk-live");
    expect(decryptSecret(sealed)).toBe("sk-live-1234567890");
  });

  it("uses a fresh IV on every encryption", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered or malformed ciphertext", () => {
    const sealed = encryptSecret("sk-live");
    const parts = sealed.split(":");
    parts[3] = `${parts[3].slice(0, -2)}AA`;
    expect(decryptSecret(parts.join(":"))).toBeNull();
    expect(decryptSecret("not-a-secret")).toBeNull();
  });

  it("cannot decrypt with a different AUTH_SECRET", () => {
    const sealed = encryptSecret("sk-live");
    process.env.AUTH_SECRET = "another-secret";
    expect(decryptSecret(sealed)).toBeNull();
  });

  it("fails closed when AUTH_SECRET is missing", () => {
    delete process.env.AUTH_SECRET;
    expect(() => encryptSecret("sk-live")).toThrow(/AUTH_SECRET/);
  });
});
