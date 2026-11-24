// Session signing via Web Crypto so it works in both the Edge middleware runtime and
// Node.js route handlers without any extra dependency.
const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

const SESSION_DAYS = 30;

export type SessionPayload = { uid: number; role: string };

export async function makeSessionToken(secret: string, payload: SessionPayload) {
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const body = `${payload.uid}.${payload.role}.${exp}`;
  const key = await hmacKey(secret);
  const sig = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null, secret: string): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [uid, role, expStr, sig] = parts;
  if (!Number.isFinite(Number(expStr)) || Number(expStr) < Date.now()) return null;
  const body = `${uid}.${role}.${expStr}`;
  const key = await hmacKey(secret);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  if (expected !== sig) return null;
  return { uid: Number(uid), role };
}
