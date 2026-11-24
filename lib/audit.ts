import { run } from "./db";
import { askJson } from "./llm";
const SERVICES = "Website design/development; Digital marketing (SEO, Google/Meta Ads, social media); AI automation (chatbots, lead follow-up, workflow automation)";
const SYSTEM = `You are a senior digital agency strategist selling to Australian small businesses on a limited budget. Our services: ${SERVICES}.
Given a business's data and technical website checks, produce an honest, specific audit. Only claim problems supported by the data. Return JSON:
{"summary":"2 sentences","problems":[{"issue":"","impact":"business impact","fix":"what we would do"}],"best_service":"website|marketing|automation","hook":"one sentence opener referencing something specific about THEIR business","lead_score":1-10}
Give 3-5 problems.
lead_score (1-10) estimates how good this lead is to pursue: weigh (a) need - how broken/outdated/missing their web presence is, (b) likely budget - google rating/review count and business type as a proxy for how established and able to pay they are, (c) reachability - do we have a real, direct-looking email (not a generic noreply) and clear contact path. 1 = barely worth contacting, 10 = urgent need + likely budget + easy to reach.`;

export async function auditLead(l: any) {
  const tech: any = { url: l.website };
  if (!l.website) tech.note = "No website at all";
  else try {
    const t = Date.now();
    const r = await fetch(l.website, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } });
    const h = await r.text(), lc = h.toLowerCase();
    Object.assign(tech, {
      load_seconds: (Date.now() - t) / 1000, https: r.url.startsWith("https"), size_kb: Math.round(h.length / 1024),
      title: /<title>([^<]*)/i.exec(h)?.[1]?.trim() || null,
      meta_description: /name=["']description/i.test(h), h1_count: (h.match(/<h1/gi) || []).length,
      mobile_viewport: /name=["']viewport/i.test(h), has_form: /<form/i.test(h),
      has_whatsapp: /wa\.me|whatsapp/.test(lc), analytics: /gtag\(|googletagmanager|google-analytics/.test(lc),
      fb_pixel: /fbq\(/.test(lc), chatbot: /tawk\.to|intercom|drift|crisp\.chat|tidio|livechat/.test(lc),
      imgs_no_alt: (h.match(/<img(?![^>]*alt=)/gi) || []).length,
    });
  } catch (e: any) { tech.error = String(e.message).slice(0, 100); }
  const a = await askJson(SYSTEM, JSON.stringify({ name: l.name, niche: l.niche, city: l.city, google_rating: l.rating, google_reviews: l.reviews, has_email: !!l.email, site: tech }));
  a.tech = tech;
  const score = Math.max(1, Math.min(10, Math.round(Number(a.lead_score) || 5)));
  const problems = (a.problems || []).map((p: any) => p.issue).join("; ");
  await run("UPDATE leads SET audit_json=?, lead_score=?, problems=?, status='audited' WHERE id=?", [JSON.stringify(a), score, problems, l.id]);
}

export function reportMd(name: string, a: any) {
  return `# Quick Audit: ${name}\n\n${a.summary}\n\n## Key findings\n` +
    a.problems.map((p: any, i: number) => `\n### ${i + 1}. ${p.issue}\n- **Impact:** ${p.impact}\n- **Fix:** ${p.fix}\n`).join("");
}
