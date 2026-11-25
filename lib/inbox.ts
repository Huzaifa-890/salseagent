import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { q, run, getSetting, setSetting } from "./db";
import { sendMail } from "./outreach";
const e = process.env;
const NOW = () => Date.now() / 1000;
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BOUNCE_SENDER = /mailer-daemon|postmaster|mail delivery subsystem/i;
const BOUNCE_SUBJECT = /undeliver|delivery status notification|delivery failed|returned mail|failure notice/i;

const UNSUBSCRIBE_RE = /unsubscribe|remove me|opt.?out|stop emailing|no further emails|take me off/i;
const JUST_STOP_RE = /^\s*stop\.?\s*$/i;
const OUT_OF_OFFICE_RE = /out of office|automatic reply|automatic response|auto-?reply|currently away|on leave/i;
const NOT_INTERESTED_RE = /not interested|no thanks|not right now|not at this time|already have (a )?website|we'?re all set|no longer need/i;
const POSITIVE_RE = /\b(yes|yeah|yep|sure|interested|sounds good|let'?s do it|tell me more|please do|go ahead|book|call me|quote|price|pricing)\b/i;

type ReplyClassification = { intent: "interested" | "question" | "not_interested" | "unsubscribe" | "out_of_office"; reply: string };

// Rule-based reply classification - no AI call. Defaults to a positive read when ambiguous,
// since the worst case there is a lead sitting in "contacted" a bit longer, not a lost one.
function classifyReply(text: string): ReplyClassification {
  const booking = e.BOOKING_LINK?.trim();
  if (UNSUBSCRIBE_RE.test(text) || JUST_STOP_RE.test(text)) return { intent: "unsubscribe", reply: "" };
  if (OUT_OF_OFFICE_RE.test(text)) return { intent: "out_of_office", reply: "" };
  if (NOT_INTERESTED_RE.test(text)) return { intent: "not_interested", reply: "" };

  const isQuestion = text.includes("?");
  const isPositive = POSITIVE_RE.test(text);
  const intent = isPositive || !isQuestion ? "interested" : "question";
  const reply = booking
    ? `Thanks for getting back to me! Happy to chat - here's a link to book a quick call: ${booking}`
    : `Thanks for getting back to me! I'll follow up shortly to organise a time to chat.`;
  return { intent, reply };
}

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
      const r = classifyReply(text);
      if (r.intent === "unsubscribe") {
        await q("INSERT OR IGNORE INTO suppress VALUES(?)", [from]);
        await q("UPDATE leads SET status='unsubscribed' WHERE id=?", [l.id]);
      } else if (r.intent === "not_interested") await q("UPDATE leads SET status='not_interested' WHERE id=?", [l.id]);
      else if (r.intent === "interested" || r.intent === "question") {
        await q("UPDATE leads SET status='interested', next_action='Collect needs and draft a proposal' WHERE id=?", [l.id]);
        if (r.intent === "interested" && e.AUTO_REPLY_INTERESTED === "1")
          await sendMail(from!, "Re: " + (m.subject || ""), r.reply, undefined, m.messageId);
        await sendMail(e.OWNER_EMAIL!, `[LEAD ${r.intent.toUpperCase()}] ${l.name}`, `${l.name} (${from}) wrote:\n\n${text}\n\nSuggested reply:\n${r.reply}`);
      }
      log.push(`${l.name}: ${r.intent}`);
    }
  } finally { lock.release(); await c.logout(); }
  return log;
}
