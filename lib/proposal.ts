import { q, run, getSetting } from "./db";
import { askJson } from "./llm";
import { sendMail, recordSend } from "./outreach";
const e = process.env;
const NOW = () => Date.now() / 1000;
const DAY = 86400;

const PROPOSAL_SYSTEM = `You write short, honest web project proposals for ${e.FROM_NAME} at ${e.COMPANY}, a small agency selling websites to Australian small businesses on a limited budget. Price a little under typical competitor rates for a small business site of this scope - realistic AUD figures, no padding. Return JSON:
{"scope":["bullet points of what's included"],"price":"AUD figure or range as a string","timeline":"e.g. 2-3 weeks","included":["revisions, hosting setup, etc"],"body":"a short plain-text proposal email (under 180 words) summarising scope, price and timeline, ending with an offer for a short call"}`;

async function proposalGuard(email: string) {
  if ((await q("SELECT 1 FROM suppress WHERE email=?", [email])).length) throw new Error("Unsubscribed - do not contact");
  if ((await getSetting("manual_pause")) === "1") throw new Error("Sending is manually paused");
}

// Call once a lead has replied with interest and you've gathered what they need.
export async function draftProposal(id: number, needs: { pages?: string; features?: string; budget?: string; timeline?: string }) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l) throw new Error("Lead not found");
  const a = JSON.parse(l.audit_json || "{}");
  const d = await askJson(PROPOSAL_SYSTEM, JSON.stringify({ business: l.name, problems: a.problems, needs }));
  await q("UPDATE leads SET proposal_json=?, proposal_text=?, proposal_price=?, status='proposal_draft', next_action='Review and send proposal' WHERE id=?",
    [JSON.stringify(d), d.body, d.price, id]);
}

export async function sendProposal(id: number, text?: string, price?: string) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l?.email) throw new Error("No email");
  await proposalGuard(l.email);
  const body = text || l.proposal_text;
  await sendMail(l.email, `Proposal: ${process.env.COMPANY} for ${l.name}`, body);
  await recordSend(id, "proposal");
  await q("UPDATE leads SET status='proposal_sent', proposal_text=?, proposal_price=?, proposal_sent_at=?, proposal_followups=0, next_action='Awaiting reply' WHERE id=?",
    [body, price || l.proposal_price, NOW(), id]);
}

const PROPOSAL_FOLLOWUP_DUE_DAYS = [2, 5];
const PROPOSAL_FOLLOWUP_SYSTEM = `You write a short (under 50 words), polite follow-up to a web project proposal that hasn't been answered yet, for ${e.FROM_NAME} at ${e.COMPANY}. Offer a short call. No pressure. Return JSON {"subject":"","body":""}.`;

// Mirrors followups() for email: drafts a proposal follow-up for approval at day 2 and day 5,
// or sends it straight away if FOLLOWUP_AUTOSEND=1.
export async function proposalFollowups() {
  const rows = await q("SELECT * FROM leads WHERE status='proposal_sent' AND proposal_followups<? LIMIT 5", [PROPOSAL_FOLLOWUP_DUE_DAYS.length]);
  let n = 0;
  for (const l of rows) {
    const stage = Number(l.proposal_followups) || 0;
    if (!l.proposal_sent_at || NOW() - Number(l.proposal_sent_at) < PROPOSAL_FOLLOWUP_DUE_DAYS[stage] * DAY) continue;
    try {
      const d = await askJson(PROPOSAL_FOLLOWUP_SYSTEM, JSON.stringify({ business: l.name }));
      if (process.env.FOLLOWUP_AUTOSEND === "1") {
        await proposalGuard(l.email);
        await sendMail(l.email, d.subject, d.body);
        await recordSend(l.id, "proposal_followup");
        await q("UPDATE leads SET proposal_followups=? WHERE id=?", [stage + 1, l.id]);
      } else {
        await q("UPDATE leads SET draft_subject=?, draft_body=?, status='proposal_followup_ready', next_action=? WHERE id=?",
          [d.subject, d.body, `Proposal follow-up ${stage + 1} ready for review`, l.id]);
      }
      n++;
    } catch {}
  }
  return n;
}

export async function sendProposalFollowup(id: number, subject?: string, body?: string) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l?.email) throw new Error("No email");
  await proposalGuard(l.email);
  const stage = Number(l.proposal_followups) || 0;
  await sendMail(l.email, subject || l.draft_subject, body || l.draft_body);
  await recordSend(id, "proposal_followup");
  await q("UPDATE leads SET status='proposal_sent', proposal_followups=?, next_action='Awaiting reply' WHERE id=?", [stage + 1, id]);
}

const AGREEMENT_SYSTEM = `Write a short plain-text email from ${e.FROM_NAME} at ${e.COMPANY} to a client who just accepted a web project proposal. Confirm what was agreed (scope/price/timeline), say a simple agreement and a deposit invoice are attached/to follow, and that work starts once the deposit is paid. Under 120 words. Return JSON {"subject":"","body":""}.`;

// Deal won: drafts the agreement + deposit email for approval. Sending the actual invoice
// (Stripe link, PDF, etc.) is up to you - this just confirms the deal and next step by email.
export async function markWon(id: number) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l) throw new Error("Lead not found");
  const d = await askJson(AGREEMENT_SYSTEM, JSON.stringify({ business: l.name, price: l.proposal_price }));
  await q("UPDATE leads SET status='agreement_ready', draft_subject=?, draft_body=?, next_action='Send agreement + deposit invoice' WHERE id=?",
    [d.subject, d.body, id]);
}

export async function sendAgreement(id: number, subject?: string, body?: string) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l?.email) throw new Error("No email");
  await proposalGuard(l.email);
  await sendMail(l.email, subject || l.draft_subject, body || l.draft_body);
  await recordSend(id, "agreement");
  await q("UPDATE leads SET status='won', next_action=NULL WHERE id=?", [id]);
}

export async function markLost(id: number) {
  await run("UPDATE leads SET status='lost', next_action=NULL WHERE id=?", [id]);
}
