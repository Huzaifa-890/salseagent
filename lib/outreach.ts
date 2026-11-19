import nodemailer from "nodemailer";
import { q } from "./db";
import { askJson } from "./llm";
import { reportMd } from "./audit";
const e = process.env;
const NOW = () => Date.now() / 1000;
const BASE = `You write cold emails for ${e.FROM_NAME} at ${e.COMPANY}. Rules: plain text, no hype, no fake claims, no fake urgency, no signature, no unsubscribe line. Always end with a soft CTA to book a 15-min call: ${e.BOOKING_LINK}. Return JSON {"subject":"","body":""}.`;
const FIRST = BASE + " Under 120 words. Open with the hook, mention 2 concrete findings, say a free full audit report is attached.";
const FOLLOW = BASE + " This is a polite follow-up under 60 words to an earlier email; add one new useful point.";

export async function sendMail(to: string, subject: string, body: string, report?: string, inReplyTo?: string) {
  const tx = nodemailer.createTransport({ host: e.SMTP_HOST, port: Number(e.SMTP_PORT || 587), auth: { user: e.SMTP_USER, pass: e.SMTP_PASS } });
  await tx.sendMail({
    from: `${e.FROM_NAME} <${e.SMTP_USER}>`, to, subject, inReplyTo, references: inReplyTo,
    text: `${body}\n\n--\n${e.FROM_NAME}\n${e.COMPANY}\n${e.BUSINESS_ADDRESS}\nIf you'd rather not hear from me, just reply "unsubscribe".`,
    attachments: report ? [{ filename: "Free_Audit_Report.md", content: report }] : [],
  });
}

async function draft(l: any, followup = false) {
  const a = JSON.parse(l.audit_json);
  return askJson(followup ? FOLLOW : FIRST, JSON.stringify({ business: l.name, hook: a.hook, problems: a.problems.slice(0, 3), best_service: a.best_service }));
}

export async function draftLead(l: any) {
  const d = await draft(l);
  await q("UPDATE leads SET draft_subject=?, draft_body=?, status='drafted' WHERE id=?", [d.subject, d.body, l.id]);
}

async function guard(email: string) {
  if ((await q("SELECT 1 FROM suppress WHERE email=?", [email])).length) throw new Error("Unsubscribed");
  const [{ n }] = await q("SELECT COUNT(*) n FROM leads WHERE last_contacted>?", [NOW() - 86400]);
  if (Number(n) >= Number(e.DAILY_LIMIT || 20)) throw new Error("Daily limit reached");
}

export async function sendDraft(id: number, subject?: string, body?: string) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l?.email) throw new Error("No email");
  await guard(l.email);
  const s = subject || l.draft_subject, b = body || l.draft_body;
  await sendMail(l.email, s, b, reportMd(l.name, JSON.parse(l.audit_json)));
  await q("UPDATE leads SET status='contacted', last_contacted=?, draft_subject=?, draft_body=? WHERE id=?", [NOW(), s, b, id]);
}

export async function followups() {
  const rows = await q("SELECT * FROM leads WHERE status='contacted' AND last_contacted<? AND followups<? LIMIT 3",
    [NOW() - Number(e.FOLLOWUP_DAYS || 3) * 86400, Number(e.MAX_FOLLOWUPS || 2)]);
  let n = 0;
  for (const l of rows) {
    try {
      await guard(l.email);
      const d = await draft(l, true);
      await sendMail(l.email, "Re: " + l.draft_subject, d.body);
      await q("UPDATE leads SET last_contacted=?, followups=followups+1 WHERE id=?", [NOW(), l.id]);
      n++;
    } catch {}
  }
  return n;
}
