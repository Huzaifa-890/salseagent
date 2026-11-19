import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/cron")) return NextResponse.next();
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return process.env.VERCEL ? new NextResponse("Set ADMIN_PASSWORD", { status: 500 }) : NextResponse.next();
  const b64 = (req.headers.get("authorization") || "").split(" ")[1];
  if (b64 && atob(b64).split(":").slice(1).join(":") === pw) return NextResponse.next();
  return new NextResponse("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="agent"' } });
}
