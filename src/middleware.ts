import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Webhooks and cron authenticate themselves (shared secret / Meta signature).
const PUBLIC = [
  "/login",
  "/api/auth/google",
  "/api/webhooks/incoming",
  "/api/webhooks/whatsapp",
  "/api/webhooks/oms",
  // OMS admin alerts, signed like the OMS webhooks.
  "/api/webhooks/oms-alert",
  "/api/cron",
  // Token-authenticated REST API; each route calls authenticateApiToken().
  "/api/v1",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (isPublic) return NextResponse.next();
  const uid = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!uid) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
