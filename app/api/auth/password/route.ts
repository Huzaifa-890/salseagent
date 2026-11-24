import { NextResponse } from "next/server";
import { q, run } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/password";

export async function POST(req: Request) {
  const uid = Number(req.headers.get("x-user-id"));
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = await req.json();
  const [u] = await q("SELECT * FROM users WHERE id=?", [uid]);
  if (!u || !verifyPassword(currentPassword, u.password_hash))
    return NextResponse.json({ error: "Current password is wrong" }, { status: 401 });
  if (!newPassword || String(newPassword).length < 8)
    return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });

  await run("UPDATE users SET password_hash=? WHERE id=?", [hashPassword(newPassword), uid]);
  return NextResponse.json({ ok: true });
}
