import dns from "node:dns";
import net from "node:net";
import { run } from "./db";

dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BAD = ["sentry", "example.", "wixpress", ".png", ".jpg", ".webp", "domain.com"];
const UA = { "User-Agent": "Mozilla/5.0" };

function describeFetchError(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<object>();

  function visit(value: unknown, label: string) {
    if (value && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      const err = value as Error & { code?: unknown; cause?: unknown; errors?: unknown };
      const details = [
        err.name,
        err.message,
        typeof err.code === "string" ? `code ${err.code}` : "",
      ].filter(Boolean);
      messages.push(`${label}: ${details.join(" ") || String(value)}`);
      if (err.cause !== undefined) visit(err.cause, "cause");
      if (Array.isArray(err.errors)) {
        err.errors.forEach((nested, index) => visit(nested, `errors[${index}]`));
      }
    } else {
      messages.push(`${label}: ${String(value)}`);
    }
  }

  visit(error, "fetch");
  return messages.join("; ");
}

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
  let r: Response;
  try {
    r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY!,
        "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({ textQuery: `${niche} in ${city}`, pageSize: Math.min(limit, 20) }),
    });
  } catch (error: unknown) {
    throw new Error(`Google Places request failed: ${describeFetchError(error)}`);
  }
  const j = await r.json();
  if (j.error) {
    const message = typeof j.error.message === "string" ? j.error.message : JSON.stringify(j.error);
    const status = typeof j.error.status === "string" ? `, ${j.error.status}` : "";
    const details = Array.isArray(j.error.details) ? ` Details: ${JSON.stringify(j.error.details)}` : "";
    throw new Error(`Google Places API error (HTTP ${r.status}${status}): ${message}${details}`);
  }
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
