import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { q } from "./db";
import { askJson } from "./llm";
import { sendMail } from "./outreach";
const e = process.env;

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
      const [l] = from ? await q("SELECT * FROM leads WHERE email=?", [from]) : [];
      if (!l) continue;
      const text = (m.text || "").slice(0, 1500);
      const r = await askJson(
        `Classify this reply to a cold sales email. JSON: {"intent":"interested|question|not_interested|unsubscribe|out_of_office","reply":"short helpful reply in the same language, only if interested/question, else empty"}. If they want to talk, invite them to book: ${e.BOOKING_LINK}`, text);
      if (r.intent === "unsubscribe") {
        await q("INSERT OR IGNORE INTO suppress VALUES(?)", [from]);
        await q("UPDATE leads SET status='unsubscribed' WHERE id=?", [l.id]);
      } else if (r.intent === "not_interested") await q("UPDATE leads SET status='not_interested' WHERE id=?", [l.id]);
      else if (r.intent === "interested" || r.intent === "question") {
        await q("UPDATE leads SET status='interested' WHERE id=?", [l.id]);
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
