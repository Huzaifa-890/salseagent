import nodemailer from "nodemailer";
import { q, run, getSetting } from "./db";
import { askJson } from "./llm";
import { reportMd } from "./audit";
const e = process.env;
const NOW = () => Date.now() / 1000;
const DAY = 86400;

const BASE = `You write cold emails for ${e.FROM_NAME} at ${e.COMPANY}, selling websites to Australian small businesses on a limited budget. Rules: plain text, no hype, no fake claims, no fake urgency, no signature, no unsubscribe line. Always end with a soft CTA to book a 15-min call: ${e.BOOKING_LINK}. Return JSON {"subject":"","body":""}.`;
const FIRST = BASE + " Under 120 words. Open with the hook, mention 2 concrete findings, say a free full audit report is attached.";
const FOLLOWUP1 = BASE + " This is a short, polite follow-up (under 60 words) to an unanswered first email. Add one new, genuinely useful tip related to their website problems. Low pressure.";
const FOLLOWUP2 = BASE + " This is a second follow-up (under 70 words) to two unanswered emails. Offer a small concrete example - describe a quick mockup/before-after idea for their homepage - to make the value tangible. Low pressure.";
const FOLLOWUP3 = BASE + " This is the final, polite closing email (under 50 words) after no reply to three emails. Say you'll stop following up, leave the door open if their situation changes later, no guilt-tripping.";
const FOLLOWUP_PROMPTS = [FOLLOWUP1, FOLLOWUP2, FOLLOWUP3];
const FOLLOWUP_DUE_DAYS = [3, 8, 15]; // days since the first email, per the plan

export async function sendMail(to: string, subject: string, body: string, report?: string, inReplyTo?: string) {
  const tx = nodemailer.createTransport({ host: e.SMTP_HOST, port: Number(e.SMTP_PORT || 587), auth: { user: e.SMTP_USER, pass: e.SMTP_PASS } });
  await tx.sendMail({
    from: `${e.FROM_NAME} <${e.SMTP_USER}>`, to, subject, inReplyTo, references: inReplyTo,
    text: `${body}\n\n--\n${e.FROM_NAME}\n${e.COMPANY}\n${e.BUSINESS_ADDRESS}\nIf you'd rather not hear from me, just reply "unsubscribe".`,
    attachments: report ? [{ filename: "Free_Audit_Report.md", content: report }] : [],
  });
}

export async function recordSend(leadId: number, kind: string) {
  await run("INSERT INTO sends(lead_id,kind,sent_at) VALUES(?,?,?)", [leadId, kind, NOW()]);
  if (!(await getSetting("campaign_start"))) await run("INSERT INTO settings(key,value) VALUES('campaign_start',?) ON CONFLICT(key) DO NOTHING", [String(NOW())]);
}

async function dailyCap() {
  const start = Number(await getSetting("campaign_start", "0"));
  const days = start ? (NOW() - start) / DAY : 0;
  const ramp = days < 7 ? Number(e.RAMP_WEEK1 || 15) : days < 14 ? Number(e.RAMP_WEEK2 || 25) : Number(e.RAMP_STEADY || 40);
  const hardCap = Number(e.DAILY_LIMIT || 0);
  return hardCap > 0 ? Math.min(ramp, hardCap) : ramp;
}

// Central safety gate every outbound send passes through: unsubscribe list, manual pause,
// bounce-triggered auto-pause, the week-by-week volume ramp, and a cooldown between batches.
export async function guard(email: string) {
  if ((await q("SELECT 1 FROM suppress WHERE email=?", [email])).length) throw new Error("Unsubscribed - do not contact");
  if ((await getSetting("manual_pause")) === "1") throw new Error("Sending is manually paused");
  const pausedUntil = Number(await getSetting("paused_until", "0"));
  if (pausedUntil && NOW() < pausedUntil) throw new Error("Paused for safety until " + new Date(pausedUntil * 1000).toLocaleString());
  const cap = await dailyCap();
  const [{ n }] = await q("SELECT COUNT(*) n FROM sends WHERE sent_at>?", [NOW() - DAY]);
  if (Number(n) >= cap) throw new Error(`Daily limit reached (${cap}/day at the current ramp stage)`);
  const batchSize = Number(e.BATCH_SIZE || 5), cooldown = Number(e.BATCH_COOLDOWN_MIN || 15) * 60;
  const [{ m }] = await q("SELECT COUNT(*) m FROM sends WHERE sent_at>?", [NOW() - cooldown]);
  if (Number(m) >= batchSize) throw new Error(`Batch cooldown - wait ${e.BATCH_COOLDOWN_MIN || 15} min before the next batch`);
}

async function draft(l: any, prompt: string) {
  const a = JSON.parse(l.audit_json);
  return askJson(prompt, JSON.stringify({ business: l.name, hook: a.hook, problems: a.problems, best_service: a.best_service }));
}

export async function draftLead(l: any) {
  const d = await draft(l, FIRST);
  await q("UPDATE leads SET draft_subject=?, draft_body=?, status='drafted' WHERE id=?", [d.subject, d.body, l.id]);
}

export async function sendDraft(id: number, subject?: string, body?: string) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l?.email) throw new Error("No email");
  await guard(l.email);
  const s = subject || l.draft_subject, b = body || l.draft_body;
  await sendMail(l.email, s, b, reportMd(l.name, JSON.parse(l.audit_json)));
  await recordSend(id, "first");
  await q("UPDATE leads SET status='contacted', last_contacted=?, first_contacted=?, draft_subject=?, draft_body=? WHERE id=?",
    [NOW(), NOW(), s, b, id]);
}

// Finds contacted leads whose next follow-up is due (day 3-4 / 8-10 / 15 since the first
// email) and drafts it for your approval. Set FOLLOWUP_AUTOSEND=1 once you trust the
// quality to send these straight away instead.
export async function followups() {
  const rows = await q("SELECT * FROM leads WHERE status='contacted' AND followups<? LIMIT 5", [FOLLOWUP_DUE_DAYS.length]);
  let n = 0;
  for (const l of rows) {
    const stage = Number(l.followups) || 0; // about to send follow-up #(stage+1)
    const anchor = Number(l.first_contacted || l.last_contacted || 0);
    if (!anchor || NOW() - anchor < FOLLOWUP_DUE_DAYS[stage] * DAY) continue;
    try {
      const d = await draft(l, FOLLOWUP_PROMPTS[stage]);
      if (e.FOLLOWUP_AUTOSEND === "1") {
        await guard(l.email);
        await sendMail(l.email, "Re: " + l.draft_subject, d.body);
        await recordSend(l.id, `followup${stage + 1}`);
        await q("UPDATE leads SET last_contacted=?, followups=? WHERE id=?", [NOW(), stage + 1, l.id]);
      } else {
        await q("UPDATE leads SET draft_subject=?, draft_body=?, status='followup_ready', next_action=? WHERE id=?",
          ["Re: " + l.draft_subject, d.body, `Follow-up ${stage + 1} ready for review`, l.id]);
      }
      n++;
    } catch {}
  }
  return n;
}

// Sends a follow-up draft sitting in 'followup_ready', once you've reviewed and approved it.
export async function sendFollowup(id: number, subject?: string, body?: string) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l?.email) throw new Error("No email");
  await guard(l.email);
  const stage = Number(l.followups) || 0;
  const s = subject || l.draft_subject, b = body || l.draft_body;
  await sendMail(l.email, s, b);
  await recordSend(id, `followup${stage + 1}`);
  await q("UPDATE leads SET status='contacted', last_contacted=?, followups=?, next_action=NULL WHERE id=?", [NOW(), stage + 1, id]);
}
