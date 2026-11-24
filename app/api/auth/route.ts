import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { makeSessionToken, verifySessionToken } from "@/lib/auth";

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-insecure-secret-change-me";
}

export async function GET(req: Request) {
  const [{ n }] = await q("SELECT COUNT(*) n FROM users");
  const needsSetup = Number(n) === 0;
  let user = null;
  if (!needsSetup) {
    const cookie = req.headers.get("cookie") || "";
    const token = /session=([^;]+)/.exec(cookie)?.[1];
    const session = await verifySessionToken(token, secret());
    if (session) {
      const [u] = await q("SELECT email,role FROM users WHERE id=?", [session.uid]);
      if (u) user = { email: u.email, role: u.role };
    }
  }
  return Response.json({ needsSetup, user });
}

export async function POST(req: Request) {
  const { email, password } = await req.json();
  const [u] = await q("SELECT * FROM users WHERE email=?", [String(email || "").toLowerCase().trim()]);
  if (!u || !verifyPassword(password, u.password_hash)) return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  const res = NextResponse.json({ ok: true, user: { email: u.email, role: u.role } });
  res.cookies.set("session", await makeSessionToken(secret(), { uid: Number(u.id), role: String(u.role) }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 24 * 3600, path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("session");
  return res;
}
