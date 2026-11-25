import { q, getSetting, setSetting } from "@/lib/db";
import { findLeads, autoFindLeads, importLeadsCsv, LEAD_TYPES, type LeadType } from "@/lib/leads";

function sanitizeLeadType(v: any): LeadType {
  return LEAD_TYPES.includes(v) ? v : "any";
}
import { auditLead } from "@/lib/audit";
import { draftLead, sendDraft, sendFollowup } from "@/lib/outreach";
import { checkReplies } from "@/lib/inbox";
import { draftProposal, sendProposal, sendProposalFollowup, markWon, markLost, sendAgreement } from "@/lib/proposal";
export const maxDuration = 60;

async function stats() {
  const [{ found }] = await q("SELECT COUNT(*) found FROM leads");
  const [{ firstSent }] = await q("SELECT COUNT(DISTINCT lead_id) firstSent FROM sends WHERE kind='first'");
  const [{ totalSends }] = await q("SELECT COUNT(*) totalSends FROM sends");
  const [{ replied }] = await q(
    `SELECT COUNT(*) replied FROM leads WHERE status NOT IN ('new','no_email','audited','drafted','contacted','followup_ready','bounced','skipped')`);
  const [{ proposalsSent }] = await q("SELECT COUNT(*) proposalsSent FROM leads WHERE proposal_sent_at IS NOT NULL");
  const [{ won }] = await q("SELECT COUNT(*) won FROM leads WHERE status='won'");
  const [{ lost }] = await q("SELECT COUNT(*) lost FROM leads WHERE status='lost'");
  return {
    found: Number(found), emailsSent: Number(totalSends), firstEmailsSent: Number(firstSent), replied: Number(replied),
    proposalsSent: Number(proposalsSent), won: Number(won), lost: Number(lost),
    replyRate: Number(firstSent) ? Math.round((Number(replied) / Number(firstSent)) * 100) : 0,
  };
}

async function settingsPayload() {
  return {
    autopilot_niches: await getSetting("autopilot_niches", process.env.AUTOPILOT_NICHES || ""),
    autopilot_cities: await getSetting("autopilot_cities", process.env.AUTOPILOT_CITIES || ""),
    autopilot_limit: await getSetting("autopilot_limit", "10"),
    autopilot_lead_type: await getSetting("autopilot_lead_type", "any"),
    autopilot_quality: await getSetting("autopilot_quality", "0"),
    manual_pause: await getSetting("manual_pause", "0"),
    paused_until: await getSetting("paused_until", "0"),
  };
}

export async function GET() {
  const leads = await q(
    `SELECT id,name,city,niche,email,website,phone,rating,status,lead_score,problems,draft_subject,draft_body,
      followups,proposal_followups,proposal_price,proposal_text,next_action,notes,first_contacted,last_contacted,
      proposal_sent_at,bounced
     FROM leads ORDER BY id DESC LIMIT 300`);
  return Response.json({ leads, stats: await stats(), settings: await settingsPayload() });
}

const ADMIN_ONLY_ACTIONS = new Set(["send", "send_followup", "send_proposal", "send_proposal_followup", "send_agreement"]);

export async function POST(req: Request) {
  const { action, ...p } = await req.json();
  if (ADMIN_ONLY_ACTIONS.has(action) && req.headers.get("x-user-role") !== "admin") {
    return Response.json({ error: "Only an admin can send this" }, { status: 403 });
  }
  try {
    if (action === "find") return Response.json({ added: await findLeads(p.niche, p.city, p.limit || 10, sanitizeLeadType(p.leadType), !!p.highQuality) });
    if (action === "import") return Response.json({ added: await importLeadsCsv(p.csv) });
    if (action === "autopilot") {
      const sourced = await autoFindLeads(p.limit, p.leadType ? sanitizeLeadType(p.leadType) : undefined, p.highQuality !== undefined ? !!p.highQuality : undefined);
      const toAudit = await q("SELECT * FROM leads WHERE status=? LIMIT 3", ["new"]);
      await Promise.all(toAudit.map((l) => auditLead(l).catch(() => {})));
      const toDraft = await q("SELECT * FROM leads WHERE status=? LIMIT 3", ["audited"]);
      await Promise.all(toDraft.map((l) => draftLead(l).catch(() => {})));
      return Response.json({ done: toAudit.length + toDraft.length, sourced });
    }
    if (action === "audit" || action === "draft") {
      const rows = await q("SELECT * FROM leads WHERE status=? LIMIT 3", [action === "audit" ? "new" : "audited"]);
      await Promise.all(rows.map((l) => (action === "audit" ? auditLead(l) : draftLead(l)).catch(() => {})));
      return Response.json({ done: rows.length });
    }
    if (action === "send") { await sendDraft(p.id, p.subject, p.body); return Response.json({ done: 1 }); }
    if (action === "send_followup") { await sendFollowup(p.id, p.subject, p.body); return Response.json({ done: 1 }); }
    if (action === "skip") { await q("UPDATE leads SET status='skipped' WHERE id=?", [p.id]); return Response.json({ done: 0 }); }
    if (action === "replies") return Response.json({ replies: await checkReplies(), done: 0 });
    if (action === "notes") { await q("UPDATE leads SET notes=? WHERE id=?", [p.notes, p.id]); return Response.json({ done: 1 }); }

    if (action === "draft_proposal") {
      await draftProposal(p.id, { pages: p.pages, features: p.features, budget: p.budget, timeline: p.timeline });
      return Response.json({ done: 1 });
    }
    if (action === "send_proposal") { await sendProposal(p.id, p.text, p.price); return Response.json({ done: 1 }); }
    if (action === "send_proposal_followup") { await sendProposalFollowup(p.id, p.subject, p.body); return Response.json({ done: 1 }); }
    if (action === "won") { await markWon(p.id); return Response.json({ done: 1 }); }
    if (action === "send_agreement") { await sendAgreement(p.id, p.subject, p.body); return Response.json({ done: 1 }); }
    if (action === "lost") { await markLost(p.id); return Response.json({ done: 1 }); }

    if (action === "pause") { await setSetting("manual_pause", "1"); return Response.json({ done: 1 }); }
    if (action === "resume") { await setSetting("manual_pause", "0"); await setSetting("paused_until", "0"); return Response.json({ done: 1 }); }
    if (action === "save_settings") {
      if (p.niches !== undefined) await setSetting("autopilot_niches", p.niches);
      if (p.cities !== undefined) await setSetting("autopilot_cities", p.cities);
      if (p.limit !== undefined) await setSetting("autopilot_limit", String(Math.max(1, Math.min(20, Number(p.limit) || 10))));
      if (p.leadType !== undefined) await setSetting("autopilot_lead_type", sanitizeLeadType(p.leadType));
      if (p.highQuality !== undefined) await setSetting("autopilot_quality", p.highQuality ? "1" : "0");
      return Response.json({ done: 1 });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
