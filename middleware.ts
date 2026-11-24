import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "./lib/auth";

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-insecure-secret-change-me";
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/cron") || pathname === "/login" || pathname === "/api/auth" || pathname === "/api/auth/setup") return NextResponse.next();

  if (process.env.VERCEL && !process.env.SESSION_SECRET && !process.env.ADMIN_PASSWORD) {
    return new NextResponse("Set SESSION_SECRET", { status: 500 });
  }

  const session = await verifySessionToken(req.cookies.get("session")?.value, secret());
  if (session) {
    const headers = new Headers(req.headers);
    headers.set("x-user-id", String(session.uid));
    headers.set("x-user-role", session.role);
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith("/api")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
