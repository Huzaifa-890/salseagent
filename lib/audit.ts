import { run } from "./db";

type Problem = { issue: string; impact: string; fix: string };
export type AuditResult = { summary: string; problems: Problem[]; best_service: string; hook: string; tech: any };

export async function buildAudit(name: string, website?: string | null): Promise<AuditResult> {
  const tech: any = { url: website };
  if (!website) tech.note = "No website at all";
  else try {
    const t = Date.now();
    const r = await fetch(website, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } });
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

  const problems: Problem[] = [];
  if (!website) {
    problems.push({
      issue: "No business website was found.",
      impact: "Customers searching online have no central place to learn about the business or get in touch.",
      fix: "Build a simple, fast, mobile-friendly website covering the core pages.",
    });
  } else if (tech.error) {
    problems.push({
      issue: "The website didn't respond when we checked it just now.",
      impact: "If visitors hit the same issue, they likely give up and go to a competitor - worth confirming the site loads reliably.",
      fix: "Happy to take a closer look and share some practical options either way.",
    });
  } else {
    if (!tech.https) problems.push({ issue: "The site is not served over HTTPS.", impact: "Browsers flag it as \"Not secure\", which erodes trust before they even read the page.", fix: "Install a TLS certificate and force HTTPS." });
    if (!tech.title) problems.push({ issue: "No page title was found.", impact: "Google and the browser tab show little to no context for the page.", fix: "Add a clear, specific page title." });
    if (!tech.meta_description) problems.push({ issue: "No meta description was found.", impact: "Google writes its own (often unhelpful) summary in search results instead.", fix: "Write a one-line description that sells the business in the search result." });
    if (tech.h1_count === 0) problems.push({ issue: "No main heading (H1) on the page.", impact: "Visitors and search engines can't quickly tell what the page is about.", fix: "Add one clear heading stating what the business does." });
    if (!tech.mobile_viewport) problems.push({ issue: "The site isn't set up for mobile screens.", impact: "Most local searches happen on a phone - a broken mobile layout loses those visitors immediately.", fix: "Add responsive, mobile-first styling." });
    if (!tech.has_form) problems.push({ issue: "No contact form on the site.", impact: "Visitors who don't want to call have no easy way to reach out.", fix: "Add a short contact form." });
    if (tech.load_seconds > 3) problems.push({ issue: `The homepage took about ${tech.load_seconds.toFixed(1)}s to load.`, impact: "Slow sites lose a large share of visitors before the page even finishes loading.", fix: "Compress images and cut unused scripts to get load time under 2-3 seconds." });
    if (!tech.analytics) problems.push({ issue: "No analytics tracking detected.", impact: "There's no way to see how many visitors the site gets or where they come from.", fix: "Add a free analytics tool so traffic and enquiries can be tracked." });
    if (tech.imgs_no_alt > 0) problems.push({ issue: `${tech.imgs_no_alt} image(s) are missing alt text.`, impact: "Those images are invisible to screen readers and to Google Images.", fix: "Add short, descriptive alt text to each image." });
  }

  const websiteIssues = problems.some((p) => /website|HTTPS|title|H1|mobile|load/i.test(p.issue));
  const best_service = websiteIssues ? "website" : problems.length ? "marketing" : "automation";
  const summary = problems.length
    ? `A quick automated check of ${name} found ${problems.length} item${problems.length === 1 ? "" : "s"} worth fixing.`
    : `A quick automated check found no obvious technical issues for ${name} - worth a manual look for business/conversion opportunities.`;
  const hook = !website
    ? `I noticed ${name} doesn't have a website listed online.`
    : problems.length
    ? `I had a quick look at your website and noticed ${problems[0].issue.toLowerCase().replace(/\.$/, "")}.`
    : `I had a look at your website and wanted to share a couple of practical ideas.`;

  return { summary, problems, best_service, hook, tech };
}

export async function auditLead(l: any) {
  const a = await buildAudit(l.name, l.website);
  const score = scoreLead(l, a.problems);
  await run("UPDATE leads SET audit_json=?, lead_score=?, problems=?, status='audited' WHERE id=?",
    [JSON.stringify(a), score, a.problems.map((p) => p.issue).join("; "), l.id]);
}

// Deterministic 1-10 score: no LLM call, just weighted signals already on hand.
// need: missing site / number of problems found. budget proxy: review count. reachability: a phone number too.
export function scoreLead(l: any, problems: Problem[]) {
  let score = 5;
  if (!l.website) score += 1;
  score += Math.min(3, problems.length);
  if (Number(l.reviews) >= 10) score += 1;
  if (l.phone) score += 1;
  return Math.max(1, Math.min(10, Math.round(score)));
}

export function reportMd(name: string, a: any) {
  return `# Quick Audit: ${name}\n\n${a.summary}\n\n## Key findings\n` +
    a.problems.map((p: any, i: number) => `\n### ${i + 1}. ${p.issue}\n- **Impact:** ${p.impact}\n- **Fix:** ${p.fix}\n`).join("");
}
