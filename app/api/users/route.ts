import { NextResponse } from "next/server";
import { q, run } from "@/lib/db";
import { hashPassword } from "@/lib/password";

function forbidden(req: Request) {
  return req.headers.get("x-user-role") !== "admin" ? NextResponse.json({ error: "Admin only" }, { status: 403 }) : null;
}

export async function GET(req: Request) {
  const deny = forbidden(req);
  if (deny) return deny;
  const users = await q("SELECT id,email,role,created_at FROM users ORDER BY id");
  return Response.json({ users });
}

export async function POST(req: Request) {
  const deny = forbidden(req);
  if (deny) return deny;
  const { email, password, role } = await req.json();
  const cleanEmail = String(email || "").toLowerCase().trim();
  const cleanRole = role === "admin" ? "admin" : "staff";
  if (!cleanEmail || !password || String(password).length < 8)
    return NextResponse.json({ error: "Email and a password of at least 8 characters are required" }, { status: 400 });
  try {
    await run("INSERT INTO users(email,password_hash,role,created_at) VALUES(?,?,?,?)",
      [cleanEmail, hashPassword(password), cleanRole, Date.now() / 1000]);
  } catch {
    return NextResponse.json({ error: "That email is already registered" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const deny = forbidden(req);
  if (deny) return deny;
  const { id } = await req.json();
  const [target] = await q("SELECT * FROM users WHERE id=?", [id]);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role === "admin") {
    const [{ n }] = await q("SELECT COUNT(*) n FROM users WHERE role='admin'");
    if (Number(n) <= 1) return NextResponse.json({ error: "Can't remove the last admin" }, { status: 400 });
  }
  await run("DELETE FROM users WHERE id=?", [id]);
  return NextResponse.json({ ok: true });
}
