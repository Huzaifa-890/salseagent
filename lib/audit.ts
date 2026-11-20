import { run } from "./db";

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
  const problems: Array<{ issue: string; impact: string; fix: string }> = [];
  if (!l.website) {
    problems.push({
      issue: "No business website was found.",
      impact: "Potential customers may not have a central place to learn about the business or contact it.",
      fix: "Discuss whether a simple, mobile-friendly website would support the business's goals.",
    });
  } else if (tech.error) {
    problems.push({
      issue: "The website could not be inspected automatically.",
      impact: "Its technical health and customer journey could not be verified.",
      fix: "Confirm the site is reachable, then repeat the audit.",
    });
  } else {
    if (!tech.https) problems.push({
      issue: "The checked page did not resolve to HTTPS.",
      impact: "Browsers may label the connection as insecure, which can reduce visitor confidence.",
      fix: "Configure and maintain a valid TLS certificate and redirect HTTP traffic to HTTPS.",
    });
    if (!tech.title) problems.push({
      issue: "No page title was detected.",
      impact: "Search engines and browser tabs may show limited context for the page.",
      fix: "Add a concise, descriptive title for the page.",
    });
    if (!tech.meta_description) problems.push({
      issue: "No meta description was detected.",
      impact: "Search results may lack a deliberate summary of the page.",
      fix: "Write a short description that accurately explains the page.",
    });
    if (tech.h1_count === 0) problems.push({
      issue: "No H1 heading was detected.",
      impact: "Visitors and assistive tools may have less clarity about the page's main topic.",
      fix: "Add one clear main heading that describes the page.",
    });
    if (!tech.mobile_viewport) problems.push({
      issue: "No mobile viewport declaration was detected.",
      impact: "The page may not adapt as expected to smaller screens.",
      fix: "Add and test a responsive viewport configuration.",
    });
    if (!tech.has_form) problems.push({
      issue: "No contact form was detected.",
      impact: "Visitors may have fewer direct ways to make an enquiry from the page.",
      fix: "Consider adding a clear, accessible contact path that suits the business.",
    });
    if (tech.imgs_no_alt > 0) problems.push({
      issue: `${tech.imgs_no_alt} image(s) without detected alt text were found.`,
      impact: "Those images may be less accessible to people using screen readers.",
      fix: "Add concise alternative text where an image conveys useful information.",
    });
  }

  const websiteIssues = problems.some((problem) =>
    /website|HTTPS|title|H1|mobile/i.test(problem.issue),
  );
  const best_service = websiteIssues ? "website" : problems.length ? "marketing" : "automation";
  const summary = problems.length
    ? `Automated checks found ${problems.length} item(s) to review for ${l.name}. These checks are a starting point and should be verified manually.`
    : `Automated checks found no clear technical issues for ${l.name}. Review the site manually for business and conversion opportunities.`;
  const hook = problems.length
    ? `I noticed an item worth checking on your website: ${problems[0].issue.toLowerCase()}`
    : `I had a look at your website and wanted to share a few practical ideas for ${l.name}.`;
  const a = { summary, problems, best_service, hook, tech };
  await run("UPDATE leads SET audit_json=?, status='audited' WHERE id=?", [JSON.stringify(a), l.id]);
}

export function reportMd(name: string, a: any) {
  return `# Quick Audit: ${name}\n\n${a.summary}\n\n## Key findings\n` +
    a.problems.map((p: any, i: number) => `\n### ${i + 1}. ${p.issue}\n- **Impact:** ${p.impact}\n- **Fix:** ${p.fix}\n`).join("");
}
