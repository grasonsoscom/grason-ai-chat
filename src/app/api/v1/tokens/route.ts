import { authenticateApiToken } from "@/lib/api/auth";
import { handleApi, created, ok, readJson, requiredString, validationError, ApiError } from "@/lib/api/http";
import { apiTokenJson } from "@/lib/api/serializers";
import { FULL_ACCESS, normalizeScopes } from "@/lib/api/scopes";
import { generateApiToken } from "@/lib/api/tokens";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  return handleApi(async () => {
    await authenticateApiToken(req, FULL_ACCESS);
    const tokens = await db.apiToken.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(tokens.map(apiTokenJson));
  });
}

export async function POST(req: Request) {
  return handleApi(async () => {
    const auth = await authenticateApiToken(req, FULL_ACCESS);
    const body = await readJson<Record<string, unknown>>(req);
    const name = requiredString(body.name, "name");
    const scopes = normalizeScopes(body.scopes);
    if (scopes.length === 0) throw validationError({ scopes: ["Pilih minimal satu scope."] });

    let expiresAt: Date | null = null;
    if (body.expires_at !== undefined && body.expires_at !== null && body.expires_at !== "") {
      if (typeof body.expires_at !== "string") throw validationError({ expires_at: ["Format tanggal tidak valid."] });
      expiresAt = new Date(body.expires_at);
      if (Number.isNaN(expiresAt.getTime())) throw validationError({ expires_at: ["Format tanggal tidak valid."] });
      if (expiresAt.getTime() <= Date.now()) throw new ApiError(422, { message: "Tanggal kedaluwarsa harus di masa depan." });
    }

    const generated = generateApiToken();
    const token = await db.apiToken.create({
      data: {
        name,
        prefix: generated.prefix,
        tokenHash: generated.tokenHash,
        scopes: scopes.join(","),
        userId: auth.user.id,
        expiresAt,
      },
    });

    return created({ ...apiTokenJson(token), token: generated.token });
  });
}
