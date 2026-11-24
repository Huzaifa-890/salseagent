import { createClient } from "@libsql/client";
export const db = createClient({
  url: process.env.DATABASE_URL || "file:local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

const LEAD_COLUMNS: Record<string, string> = {
  lead_score: "INTEGER",
  problems: "TEXT",
  first_contacted: "REAL",
  next_action: "TEXT",
  notes: "TEXT",
  proposal_json: "TEXT",
  proposal_text: "TEXT",
  proposal_price: "TEXT",
  proposal_status: "TEXT",
  proposal_sent_at: "REAL",
  proposal_followups: "INTEGER DEFAULT 0",
  bounced: "INTEGER DEFAULT 0",
};

let ready: Promise<unknown> | null = null;
function init() {
  ready ||= (async () => {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS leads(
        id INTEGER PRIMARY KEY, place_id TEXT UNIQUE, name TEXT, niche TEXT, city TEXT,
        website TEXT, phone TEXT, email TEXT, rating REAL, reviews INTEGER,
        audit_json TEXT, status TEXT DEFAULT 'new', draft_subject TEXT, draft_body TEXT,
        last_contacted REAL, followups INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS suppress(email TEXT PRIMARY KEY)`,
      `CREATE TABLE IF NOT EXISTS sends(id INTEGER PRIMARY KEY, lead_id INTEGER, kind TEXT, sent_at REAL)`,
      `CREATE TABLE IF NOT EXISTS bounces(email TEXT, at REAL)`,
      `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT)`,
      `CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, role TEXT DEFAULT 'admin', created_at REAL)`,
    ]);
    // Migrate older local.db files that predate these columns.
    for (const [col, type] of Object.entries(LEAD_COLUMNS)) {
      try { await db.execute(`ALTER TABLE leads ADD COLUMN ${col} ${type}`); } catch {}
    }
  })();
  return ready;
}
export async function run(sql: string, args: any[] = []) {
  await init();
  return db.execute({ sql, args });
}
export async function q(sql: string, args: any[] = []): Promise<any[]> {
  return (await run(sql, args)).rows.map((r) => ({ ...r }));
}
export async function getSetting(key: string, fallback = ""): Promise<string> {
  const [r] = await q("SELECT value FROM settings WHERE key=?", [key]);
  return r ? String(r.value) : fallback;
}
export async function setSetting(key: string, value: string) {
  await run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]);
}
