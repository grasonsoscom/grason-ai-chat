// Personal API tokens. The plaintext is shown once; only a SHA-256 hash is stored.
import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "gro";

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateApiToken() {
  const prefix = randomBytes(4).toString("hex"); // 8 chars, safe to display
  const secret = randomBytes(24).toString("base64url");
  const token = `${TOKEN_PREFIX}_${prefix}_${secret}`;
  return { token, prefix, tokenHash: hashApiToken(token) };
}

export function parseApiToken(token: string): { prefix: string; secret: string } | null {
  const match = new RegExp(`^${TOKEN_PREFIX}_([a-f0-9]{8})_([A-Za-z0-9_-]{20,})$`).exec(token);
  return match ? { prefix: match[1], secret: match[2] } : null;
}

export function isTokenActive(
  token: { revokedAt: Date | null; expiresAt: Date | null },
  now = new Date(),
): boolean {
  if (token.revokedAt) return false;
  if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function tokenDisplay(prefix: string): string {
  return `${TOKEN_PREFIX}_${prefix}_…`;
}
