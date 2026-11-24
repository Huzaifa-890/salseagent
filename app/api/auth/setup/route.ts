import { NextResponse } from "next/server";
import { q, run } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { makeSessionToken } from "@/lib/auth";

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-insecure-secret-change-me";
}

// Creates the very first (admin) account. Only works while the users table is empty -
// after that, new accounts are created by an existing admin via /api/users.
export async function POST(req: Request) {
  const [{ n }] = await q("SELECT COUNT(*) n FROM users");
  if (Number(n) > 0) return NextResponse.json({ error: "Setup already completed - ask an admin to add your account" }, { status: 403 });

  const { email, password } = await req.json();
  const cleanEmail = String(email || "").toLowerCase().trim();
  if (!cleanEmail || !password || String(password).length < 8)
    return NextResponse.json({ error: "Email and a password of at least 8 characters are required" }, { status: 400 });

  const result = await run("INSERT INTO users(email,password_hash,role,created_at) VALUES(?,?,?,?)",
    [cleanEmail, hashPassword(password), "admin", Date.now() / 1000]);
  const uid = Number(result.lastInsertRowid);

  const res = NextResponse.json({ ok: true, user: { email: cleanEmail, role: "admin" } });
  res.cookies.set("session", await makeSessionToken(secret(), { uid, role: "admin" }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 30 * 24 * 3600, path: "/",
  });
  return res;
}
