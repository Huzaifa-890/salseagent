import { q, getSetting } from "@/lib/db";
import { autoFindLeads } from "@/lib/leads";
import { auditLead } from "@/lib/audit";
import { draftLead, followups } from "@/lib/outreach";
import { checkReplies } from "@/lib/inbox";
import { proposalFollowups } from "@/lib/proposal";
export const maxDuration = 60;

// Runs once a day (see vercel.json). Sources new leads on its own, audits and drafts them,
// and prepares/sends follow-ups and proposal follow-ups - everything except the actual send
// of a NEW outreach email or proposal still waits for your approval in the dashboard, unless
// FOLLOWUP_AUTOSEND=1. Skips lead sourcing/audit/draft entirely while sending is paused.
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("Unauthorized", { status: 401 });

  const paused = (await getSetting("manual_pause")) === "1" ||
    Number(await getSetting("paused_until", "0")) > Date.now() / 1000;

  let sourced: any = null, audited = 0, drafted = 0;
  if (!paused) {
    sourced = await autoFindLeads().catch((e) => ({ error: String(e.message || e) }));
    const toAudit = await q("SELECT * FROM leads WHERE status='new' LIMIT 5");
    await Promise.all(toAudit.map((l) => auditLead(l).catch(() => {})));
    audited = toAudit.length;
    const toDraft = await q("SELECT * FROM leads WHERE status='audited' LIMIT 5");
    await Promise.all(toDraft.map((l) => draftLead(l).catch(() => {})));
    drafted = toDraft.length;
  }

  const replies = await checkReplies().catch((e) => [String(e)]);
  const followupsSent = await followups().catch(() => 0);
  const proposalFollowupsSent = await proposalFollowups().catch(() => 0);

  return Response.json({ paused, sourced, audited, drafted, replies, followupsSent, proposalFollowupsSent });
}
