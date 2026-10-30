import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { GOOGLE_STATE_COOKIE, authorizeUrl, isGoogleConfigured } from "@/lib/google";

/** Starts Google sign-in. Only emails an admin added in Staff can get in. */
export async function GET(req: Request) {
  if (!isGoogleConfigured()) return NextResponse.redirect(new URL("/login?error=google-config", req.url));
  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  (await cookies()).set(GOOGLE_STATE_COOKIE, JSON.stringify({ state, nonce }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth/google", maxAge: 10 * 60,
  });
  return NextResponse.redirect(authorizeUrl(req.url, state, nonce));
}
