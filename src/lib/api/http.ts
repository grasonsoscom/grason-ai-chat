// Shared HTTP helpers for the public REST API (/api/v1).
import { Prisma } from "@prisma/client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
    public headers: Record<string, string> = {},
  ) {
    super(String(body.message ?? body.error ?? "API error"));
    this.name = "ApiError";
  }
}

export async function handleApi(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) {
      return Response.json(e.body, { status: e.status, headers: e.headers });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return Response.json({ message: "Data dengan nilai yang sama sudah ada." }, { status: 422 });
      }
      if (e.code === "P2025") {
        return Response.json({ error: "Resource not found." }, { status: 404 });
      }
      if (e.code === "P2003") {
        return Response.json({ message: "Relasi data tidak valid." }, { status: 422 });
      }
    }
    console.error("[api] unhandled error:", (e as Error)?.message ?? e);
    return Response.json({ message: "Internal server error." }, { status: 500 });
  }
}

export function ok(data: unknown, meta?: unknown, links?: unknown) {
  return Response.json({
    data,
    ...(meta === undefined ? {} : { meta }),
    ...(links === undefined ? {} : { links }),
  });
}

export function created(data: unknown) {
  return Response.json({ data }, { status: 201 });
}

export function noContent() {
  return new Response(null, { status: 204 });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ApiError(422, { message: "Body harus JSON yang valid." });
  }
}

export function validationError(errors: Record<string, string[]>, message = "The given data was invalid.") {
  return new ApiError(422, { message, errors });
}

export function notFound(message = "Resource not found.") {
  return new ApiError(404, { error: message });
}

export function forbidden(message: string, requiredScope?: string) {
  return new ApiError(403, {
    error: message,
    ...(requiredScope ? { required_scope: requiredScope } : {}),
  });
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw validationError({ [field]: [`${field} wajib diisi.`] });
  }
  return value.trim();
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

export function requiredInteger(value: unknown, field: string, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw validationError({ [field]: [`${field} harus berupa bilangan bulat ${min}–${max}.`] });
  }
  return parsed;
}

export function optionalInteger(value: unknown, field: string, min = 1, max = Number.MAX_SAFE_INTEGER): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredInteger(value, field, min, max);
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw validationError({ [field]: [`${field} harus boolean.`] });
  return value;
}

export function pathId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return id;
}
