import nodemailer from "nodemailer";
import { q } from "./db";
import { reportMd } from "./audit";
const e = process.env;
const NOW = () => Date.now() / 1000;

export async function sendMail(to: string, subject: string, body: string, report?: string, inReplyTo?: string) {
  const port = Number(e.SMTP_PORT || 587);
  const tx = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
  });
  await tx.sendMail({
    from: `${e.FROM_NAME} <${e.SMTP_USER}>`, to, subject, inReplyTo, references: inReplyTo,
    text: `${body}\n\n--\n${e.FROM_NAME}\n${e.COMPANY}\n${e.BUSINESS_ADDRESS}\nIf you'd rather not hear from me, just reply "unsubscribe".`,
    attachments: report ? [{ filename: "Free_Audit_Report.md", content: report }] : [],
  });
}

async function draft(l: any, followup = false) {
  const a = JSON.parse(l.audit_json);
  const problems = Array.isArray(a.problems) ? a.problems : [];
  const booking = e.BOOKING_LINK?.trim();
  if (followup) {
    return {
      subject: `Re: ${l.draft_subject || `Ideas for ${l.name}`}`,
      body: `Hi,\n\nJust following up on my note about ${l.name}. ${problems[0]?.fix || "I would be happy to share a practical next step based on the website review."}\n\nWould a short call be useful?${booking ? `\n${booking}` : ""}`,
    };
  }
  const findings = problems.slice(0, 2).map((problem: any) => problem.issue).filter(Boolean);
  const fixes = problems.slice(0, 2).map((problem: any) => problem.fix).filter(Boolean);
  const summary = findings.length ? findings.join("; ") : "no clear technical issues in the checks I ran";
  const nextStep = fixes.length ? ` A practical next step could be to ${fixes[0].replace(/[.]$/, "").toLowerCase()}.` : "";
  return {
    subject: `A practical idea for ${l.name}`,
    body: `Hi,\n\n${a.hook || `I had a look at ${l.name}'s website.`}\n\nIn a quick automated check, I noted: ${summary}.${nextStep}\n\nWould a short call to discuss this be useful?${booking ? `\n${booking}` : ""}`,
  };
}

export async function draftLead(l: any) {
  const d = await draft(l);
  await q("UPDATE leads SET draft_subject=?, draft_body=?, status='drafted' WHERE id=?", [d.subject, d.body, l.id]);
}

async function guard(email: string) {
  if ((await q("SELECT 1 FROM suppress WHERE email=?", [email])).length) throw new Error("Unsubscribed");
  const [{ n }] = await q("SELECT COUNT(*) n FROM leads WHERE last_contacted>?", [NOW() - 86400]);
  if (Number(n) >= Number(e.DAILY_LIMIT || 10)) throw new Error("Daily limit reached");
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
