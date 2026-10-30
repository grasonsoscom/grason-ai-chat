import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { GOOGLE_STATE_COOKIE, exchangeCode, type GoogleProfile } from "@/lib/google";
import { SESSION_COOKIE, signSession } from "@/lib/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = await cookies();
  const saved = store.get(GOOGLE_STATE_COOKIE)?.value;
  store.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/auth/google" });
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url));

  let flow: { state: string; nonce: string };
  try {
    flow = JSON.parse(saved ?? "");
  } catch {
    return go("/login?error=google-expired");
  }
  const back = "/login";
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return go(`${back}?error=google-cancelled`);
  if (url.searchParams.get("state") !== flow.state) return go(`${back}?error=google-expired`);

  let profile: GoogleProfile;
  try {
    profile = await exchangeCode(req.url, code, flow.nonce);
  } catch {
    return go(`${back}?error=google-failed`);
  }

  // Google has verified the email, so an existing staff account with it is linked.
  let user = await db.user.findUnique({ where: { googleId: profile.sub } })
    ?? await db.user.findUnique({ where: { email: profile.email } });
  if (user && !user.googleId) user = await db.user.update({ where: { id: user.id }, data: { googleId: profile.sub } });

  if (!user) return go("/login?error=google-unregistered");

  if (user.status !== "active") return go(`${back}?error=inactive`);
  store.set(SESSION_COOKIE, await signSession(user.id), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400,
  });
  return go("/pesan");
}
