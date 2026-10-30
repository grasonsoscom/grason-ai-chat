// Google sign-in (OAuth 2.0 authorization code flow + OpenID Connect ID token).
import { createRemoteJWKSet, jwtVerify } from "jose";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const GOOGLE_STATE_COOKIE = "centris_google_oauth";

export function isGoogleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** APP_URL wins so the redirect URI matches the one registered in Google Cloud exactly. */
export function redirectUri(reqUrl: string) {
  const base = (process.env.APP_URL || new URL(reqUrl).origin).replace(/\/+$/, "");
  return `${base}/api/auth/google/callback`;
}

export function authorizeUrl(reqUrl: string, state: string, nonce: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(reqUrl),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params}`;
}

export type GoogleProfile = { sub: string; email: string; name: string };

/** Exchanges the code and verifies the ID token (signature, issuer, audience, nonce, verified email). */
export async function exchangeCode(reqUrl: string, code: string, nonce: string): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(reqUrl),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string };
  if (!res.ok || !json.id_token) throw new Error("token exchange failed");
  const { payload } = await jwtVerify(json.id_token, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: process.env.GOOGLE_CLIENT_ID!,
  });
  if (payload.nonce !== nonce) throw new Error("nonce mismatch");
  if (payload.email_verified !== true || typeof payload.email !== "string" || !payload.sub) throw new Error("email not verified");
  const email = payload.email.toLowerCase();
  return { sub: payload.sub, email, name: typeof payload.name === "string" && payload.name ? payload.name : email.split("@")[0] };
}
