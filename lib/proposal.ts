import { q, run, getSetting } from "./db";
import { sendMail, recordSend } from "./outreach";
const e = process.env;
const NOW = () => Date.now() / 1000;
const DAY = 86400;

async function proposalGuard(email: string) {
  if ((await q("SELECT 1 FROM suppress WHERE email=?", [email])).length) throw new Error("Unsubscribed - do not contact");
  if ((await getSetting("manual_pause")) === "1") throw new Error("Sending is manually paused");
}

function splitList(v?: string) {
  return (v || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Deterministic pricing: base price for a small site, + a bit per extra page/feature,
// nudged under a stated budget, clamped into a band that fits an AU small-business budget.
function priceProposal(pages: string[], features: string[], budget?: string) {
  const base = 600;
  const extraPages = Math.max(0, pages.length - 3) * 80;
  const featuresCost = features.length * 150;
  let price = base + extraPages + featuresCost;
  const budgetNum = Number((budget || "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(budgetNum) && budgetNum > 0) price = Math.min(price, Math.round(budgetNum * 0.9));
  return Math.max(500, Math.min(3000, Math.round(price / 10) * 10));
}

// Call once a lead has replied with interest and you've gathered what they need.
export async function draftProposal(id: number, needs: { pages?: string; features?: string; budget?: string; timeline?: string }) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l) throw new Error("Lead not found");

  const pages = splitList(needs.pages).length ? splitList(needs.pages) : ["Home", "About", "Services", "Contact"];
  const features = splitList(needs.features);
  const price = priceProposal(pages, features, needs.budget);
  const timeline = needs.timeline?.trim() || (pages.length <= 3 ? "1-2 weeks" : pages.length <= 6 ? "2-3 weeks" : "3-4 weeks");
  const included = ["Mobile-friendly, fast-loading design", "Basic on-page SEO setup", "Contact form", "One round of revisions", "Hosting setup guidance"];
  const scope = [...pages.map((p) => `${p} page`), ...features];

  const booking = e.BOOKING_LINK?.trim();
  const body = [
    `Hi,`,
    `Here's a proposal for ${l.name}:`,
    `Scope: ${scope.join(", ")}.`,
    `Price: AUD $${price}. Timeline: ${timeline}.`,
    `Included: ${included.join(", ")}.`,
    `Happy to adjust scope or answer questions - a short call works too${booking ? `:\n${booking}` : "."}`,
  ].join("\n\n");

  const proposalJson = { scope, price: `AUD $${price}`, timeline, included, body };
  await q("UPDATE leads SET proposal_json=?, proposal_text=?, proposal_price=?, status='proposal_draft', next_action='Review and send proposal' WHERE id=?",
    [JSON.stringify(proposalJson), body, proposalJson.price, id]);
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

// Mirrors followups() for email: drafts a proposal follow-up for approval at day 2 and day 5,
// or sends it straight away if FOLLOWUP_AUTOSEND=1.
export async function proposalFollowups() {
  const rows = await q("SELECT * FROM leads WHERE status='proposal_sent' AND proposal_followups<? LIMIT 5", [PROPOSAL_FOLLOWUP_DUE_DAYS.length]);
  let n = 0;
  for (const l of rows) {
    const stage = Number(l.proposal_followups) || 0;
    if (!l.proposal_sent_at || NOW() - Number(l.proposal_sent_at) < PROPOSAL_FOLLOWUP_DUE_DAYS[stage] * DAY) continue;
    try {
      const booking = e.BOOKING_LINK?.trim();
      const subject = `Re: Proposal: ${e.COMPANY} for ${l.name}`;
      const body = `Hi,\n\nJust checking in on the proposal I sent over - happy to answer any questions or adjust the scope.${booking ? `\n\nA short call works too:\n${booking}` : ""}`;
      if (process.env.FOLLOWUP_AUTOSEND === "1") {
        await proposalGuard(l.email);
        await sendMail(l.email, subject, body);
        await recordSend(l.id, "proposal_followup");
        await q("UPDATE leads SET proposal_followups=? WHERE id=?", [stage + 1, l.id]);
      } else {
        await q("UPDATE leads SET draft_subject=?, draft_body=?, status='proposal_followup_ready', next_action=? WHERE id=?",
          [subject, body, `Proposal follow-up ${stage + 1} ready for review`, l.id]);
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

// Deal won: drafts the agreement + deposit email for approval. Sending the actual invoice
// (Stripe link, PDF, etc.) is up to you - this just confirms the deal and next step by email.
export async function markWon(id: number) {
  const [l] = await q("SELECT * FROM leads WHERE id=?", [id]);
  if (!l) throw new Error("Lead not found");
  const subject = `Agreement - ${e.COMPANY} x ${l.name}`;
  const body = [
    `Hi,`,
    `Great news - confirming we're locked in at ${l.proposal_price || "the agreed price"}.`,
    `I'll send over a simple agreement and a deposit invoice; work starts as soon as the deposit lands.`,
    `Let me know if you have any questions in the meantime.`,
  ].join("\n\n");
  await q("UPDATE leads SET status='agreement_ready', draft_subject=?, draft_body=?, next_action='Send agreement + deposit invoice' WHERE id=?",
    [subject, body, id]);
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
