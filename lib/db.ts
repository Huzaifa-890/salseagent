import { createClient } from "@libsql/client";
export const db = createClient({
  url: process.env.DATABASE_URL || "file:local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});
let ready: Promise<unknown> | null = null;
function init() {
  ready ||= db.batch([
    `CREATE TABLE IF NOT EXISTS leads(
      id INTEGER PRIMARY KEY, place_id TEXT UNIQUE, name TEXT, niche TEXT, city TEXT,
      website TEXT, phone TEXT, email TEXT, rating REAL, reviews INTEGER,
      audit_json TEXT, status TEXT DEFAULT 'new', draft_subject TEXT, draft_body TEXT,
      last_contacted REAL, followups INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS suppress(email TEXT PRIMARY KEY)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_contacted ON leads(last_contacted)`,
  ]);
  return ready;
}
export async function run(sql: string, args: any[] = []) {
  await init();
  return db.execute({ sql, args });
}
export async function q(sql: string, args: any[] = []): Promise<any[]> {
  return (await run(sql, args)).rows.map((r) => ({ ...r }));
}
