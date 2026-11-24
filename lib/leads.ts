import { run, getSetting, setSetting } from "./db";
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BAD = ["sentry", "example.", "wixpress", ".png", ".jpg", ".webp", "domain.com"];
const UA = { "User-Agent": "Mozilla/5.0" };

async function getEmail(site?: string) {
  if (!site) return null;
  for (const p of ["", "/contact", "/contact-us"]) {
    try {
      const r = await fetch(site.replace(/\/$/, "") + p, { signal: AbortSignal.timeout(8000), headers: UA });
      const m = ((await r.text()).match(EMAIL) || []).find((e) => !BAD.some((b) => e.toLowerCase().includes(b)));
      if (m) return m.toLowerCase();
    } catch {}
  }
  return null;
}

export async function findLeads(niche: string, city: string, limit = 10) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY!,
      "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({ textQuery: `${niche} in ${city}`, pageSize: Math.min(limit, 20) }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  const added = await Promise.all((j.places || []).map(async (p: any) => {
    const email = await getEmail(p.websiteUri);
    const res = await run(
      `INSERT OR IGNORE INTO leads(place_id,name,niche,city,website,phone,email,rating,reviews,status) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [p.id, p.displayName.text, niche, city, p.websiteUri ?? null, p.nationalPhoneNumber ?? null,
       email, p.rating ?? null, p.userRatingCount ?? null, email ? "new" : "no_email"]);
    return res.rowsAffected;
  }));
  return added.reduce((a: number, b: number) => a + b, 0);
}

// Self-driving lead sourcing: cycles through the configured niches x cities list so the
// agent keeps finding new leads on its own (via the UI "Run autopilot" button or the daily
// cron) without anyone typing a niche/city in each time.
export async function autoFindLeads(limitPerPair = 10) {
  const niches = (await getSetting("autopilot_niches", process.env.AUTOPILOT_NICHES || "")).split(",").map((s) => s.trim()).filter(Boolean);
  const cities = (await getSetting("autopilot_cities", process.env.AUTOPILOT_CITIES || "")).split(",").map((s) => s.trim()).filter(Boolean);
  if (!niches.length || !cities.length) return { niche: null, city: null, added: 0, note: "No autopilot niches/cities configured" };
  const pairs = niches.flatMap((n) => cities.map((c) => [n, c]));
  const idx = Number(await getSetting("autopilot_idx", "0")) % pairs.length;
  const [niche, city] = pairs[idx];
  await setSetting("autopilot_idx", String((idx + 1) % pairs.length));
  const added = await findLeads(niche, city, limitPerPair);
  return { niche, city, added };
}
