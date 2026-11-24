import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { q, run, getSetting, setSetting } from "./db";
import { askJson } from "./llm";
import { sendMail } from "./outreach";
const e = process.env;
const NOW = () => Date.now() / 1000;
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BOUNCE_SENDER = /mailer-daemon|postmaster|mail delivery subsystem/i;
const BOUNCE_SUBJECT = /undeliver|delivery status notification|delivery failed|returned mail|failure notice/i;

async function handleBounce(m: any) {
  const body = (m.text || "") + " " + (m.html || "");
  const candidates = (body.match(EMAIL) || []).map((x: string) => x.toLowerCase());
  const [lead] = await q(
    `SELECT * FROM leads WHERE email IN (${candidates.map(() => "?").join(",") || "''"}) LIMIT 1`, candidates);
  if (!lead) return null;
  await q("UPDATE leads SET bounced=1, status='bounced' WHERE id=?", [lead.id]);
  await run("INSERT INTO bounces(email,at) VALUES(?,?)", [lead.email, NOW()]);

  const window = NOW() - 14 * 86400;
  const [{ sent }] = await q("SELECT COUNT(*) sent FROM sends WHERE sent_at>?", [window]);
  const [{ bounced }] = await q("SELECT COUNT(*) bounced FROM bounces WHERE at>?", [window]);
  const threshold = Number(e.BOUNCE_PAUSE_THRESHOLD || 0.03);
  if (Number(sent) >= 20 && Number(bounced) / Number(sent) > threshold) {
    await setSetting("paused_until", String(NOW() + 48 * 3600));
  }
  return lead.name;
}

export async function checkReplies() {
  const c = new ImapFlow({ host: e.IMAP_HOST!, port: 993, secure: true, auth: { user: e.SMTP_USER!, pass: e.SMTP_PASS! }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  const log: string[] = [];
  try {
    const uids = (await c.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids.slice(0, 10)) {
      const msg: any = await c.fetchOne(String(uid), { source: true }, { uid: true });
      const m = await simpleParser(msg.source);
      const from = m.from?.value[0]?.address?.toLowerCase();
      const subject = m.subject || "";
      if ((from && BOUNCE_SENDER.test(from)) || BOUNCE_SUBJECT.test(subject)) {
        const name = await handleBounce(m);
        if (name) log.push(`${name}: bounced`);
        continue;
      }
      const [l] = from ? await q("SELECT * FROM leads WHERE email=?", [from]) : [];
      if (!l) continue;
      const text = (m.text || "").slice(0, 1500);
      const r = await askJson(
        `Classify this reply to a cold sales email. JSON: {"intent":"interested|question|not_interested|unsubscribe|out_of_office","reply":"short helpful reply in the same language, only if interested/question, else empty"}. Treat "stop", "unsubscribe", "remove me" etc as unsubscribe. If they want to talk, invite them to book: ${e.BOOKING_LINK}`, text);
      if (r.intent === "unsubscribe") {
        await q("INSERT OR IGNORE INTO suppress VALUES(?)", [from]);
        await q("UPDATE leads SET status='unsubscribed' WHERE id=?", [l.id]);
      } else if (r.intent === "not_interested") await q("UPDATE leads SET status='not_interested' WHERE id=?", [l.id]);
      else if (r.intent === "interested" || r.intent === "question") {
        await q("UPDATE leads SET status='interested', next_action='Collect needs and draft a proposal' WHERE id=?", [l.id]);
        if (r.reply) {
          if (r.intent === "interested" && e.AUTO_REPLY_INTERESTED === "1")
            await sendMail(from!, "Re: " + (m.subject || ""), r.reply, undefined, m.messageId);
          await sendMail(e.OWNER_EMAIL!, `[LEAD ${r.intent.toUpperCase()}] ${l.name}`, `${l.name} (${from}) wrote:\n\n${text}\n\nSuggested reply:\n${r.reply}`);
        }
      }
      log.push(`${l.name}: ${r.intent}`);
    }
  } finally { lock.release(); await c.logout(); }
  return log;
}
