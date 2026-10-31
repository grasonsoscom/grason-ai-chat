// Bearer-token authentication for /api/v1. Middleware lets /api/v1 through;
// every route handler calls authenticateApiToken() so Prisma never runs on Edge.
import { db } from "../db";
import { ApiError, forbidden } from "./http";
import { checkRateLimit } from "./rate-limit";
import { hasScope, parseScopes } from "./scopes";
import { hashApiToken, isTokenActive } from "./tokens";

export type ApiAuth = {
  tokenId: number;
  tokenName: string;
  scopes: string[];
  user: { id: number; name: string; email: string; role: string };
};

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();
  const headerKey = req.headers.get("x-api-key");
  return headerKey?.trim() || null;
}

export async function authenticateApiToken(req: Request, requiredScope?: string): Promise<ApiAuth> {
  const raw = bearerToken(req);
  if (!raw) throw new ApiError(401, { message: "Unauthenticated." });

  const token = await db.apiToken.findUnique({
    where: { tokenHash: hashApiToken(raw) },
    include: { user: { include: { role: true } } },
  });
  if (!token || !isTokenActive(token) || token.user.status !== "active") {
    throw new ApiError(401, { message: "Unauthenticated." });
  }

  const scopes = parseScopes(token.scopes);
  if (!hasScope(scopes, requiredScope)) {
    throw forbidden(
      `Forbidden. Token ini tidak punya scope ${requiredScope}.`,
      requiredScope,
    );
  }

  const limit = checkRateLimit(`token:${token.id}`);
  if (!limit.allowed) {
    throw new ApiError(
      429,
      { message: "Too Many Attempts." },
      { "Retry-After": String(limit.retryAfter) },
    );
  }

  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000) {
    await db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }

  return {
    tokenId: token.id,
    tokenName: token.name,
    scopes,
    user: {
      id: token.user.id,
      name: token.user.name,
      email: token.user.email,
      role: token.user.role.name,
    },
  };
}
