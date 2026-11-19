import { q } from "@/lib/db";
import { findLeads } from "@/lib/leads";
import { auditLead } from "@/lib/audit";
import { draftLead, sendDraft } from "@/lib/outreach";
import { checkReplies } from "@/lib/inbox";
export const maxDuration = 60;

export async function GET() {
  return Response.json(await q("SELECT id,name,city,email,website,rating,status,draft_subject,draft_body FROM leads ORDER BY id DESC LIMIT 200"));
}

export async function POST(req: Request) {
  const { action, ...p } = await req.json();
  try {
    if (action === "find") return Response.json({ added: await findLeads(p.niche, p.city, p.limit || 10) });
    if (action === "audit" || action === "draft") {
      const rows = await q("SELECT * FROM leads WHERE status=? LIMIT 3", [action === "audit" ? "new" : "audited"]);
      await Promise.all(rows.map((l) => (action === "audit" ? auditLead(l) : draftLead(l)).catch(() => {})));
      return Response.json({ done: rows.length });
    }
    if (action === "send") { await sendDraft(p.id, p.subject, p.body); return Response.json({ done: 1 }); }
    if (action === "skip") { await q("UPDATE leads SET status='skipped' WHERE id=?", [p.id]); return Response.json({ done: 0 }); }
    if (action === "replies") return Response.json({ replies: await checkReplies(), done: 0 });
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
