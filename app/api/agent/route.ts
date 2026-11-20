import { q } from "@/lib/db";
import { findLeads, formatErrorDetails, importLeadsCsv } from "@/lib/leads";
import { auditLead } from "@/lib/audit";
import { draftLead, sendDraft } from "@/lib/outreach";
import { checkReplies } from "@/lib/inbox";
export const maxDuration = 60;
const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "aol.com", "protonmail.com", "proton.me", "mail.ru", "yandex.com",
  "example.com", "example.org", "example.net", "invalid",
];

async function nextBusinessLead(status: string) {
  const placeholders = PERSONAL_EMAIL_DOMAINS.map(() => "?").join(",");
  const [lead] = await q(
    `SELECT * FROM leads WHERE status=? AND name IS NOT NULL AND name<>''
      AND email LIKE '%_@_%._%' AND website LIKE 'http%'
      AND lower(substr(email,instr(email,'@')+1)) NOT IN (${placeholders})
      ORDER BY id LIMIT 1`,
    [status, ...PERSONAL_EMAIL_DOMAINS],
  );
  return lead;
}

export async function GET() {
  try {
    return Response.json(await q("SELECT id,name,city,email,website,rating,status,draft_subject,draft_body FROM leads ORDER BY id DESC LIMIT 200"));
  } catch (error: unknown) {
    return Response.json({ error: formatErrorDetails(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { action, ...p } = await req.json();
    if (action === "find") return Response.json({ added: await findLeads(p.niche, p.city, p.limit || 10) });
    if (action === "import") return Response.json({ added: await importLeadsCsv(p.csv) });
    if (action === "audit" || action === "draft") {
      const rows = await q("SELECT * FROM leads WHERE status=? LIMIT 3", [action === "audit" ? "new" : "audited"]);
      await Promise.all(rows.map((l) => action === "audit" ? auditLead(l) : draftLead(l)));
      return Response.json({ done: rows.length });
    }
    if (action === "process") {
      const newLead = await nextBusinessLead("new");
      if (newLead) {
        await auditLead(newLead);
        return Response.json({ done: 1, stage: "audit", name: newLead.name });
      }
      const auditedLead = await nextBusinessLead("audited");
      if (auditedLead) {
        await draftLead(auditedLead);
        return Response.json({ done: 1, stage: "draft", name: auditedLead.name });
      }
      return Response.json({ done: 0, message: "All eligible leads are drafted and waiting for your review. No email was sent." });
    }
    if (action === "send") { await sendDraft(p.id, p.subject, p.body); return Response.json({ done: 1 }); }
    if (action === "skip") { await q("UPDATE leads SET status='skipped' WHERE id=?", [p.id]); return Response.json({ done: 0 }); }
    if (action === "replies") return Response.json({ replies: await checkReplies(), done: 0 });
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (error: unknown) {
    return Response.json({ error: formatErrorDetails(error) }, { status: 500 });
  }
}
