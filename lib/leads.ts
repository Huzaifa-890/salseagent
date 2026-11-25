import { run, getSetting, setSetting } from "./db";
import { buildAudit, scoreLead, type AuditResult } from "./audit";

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BAD = ["sentry", "example.", "wixpress", ".png", ".jpg", ".webp", "domain.com"];
const UA = { "User-Agent": "AI-Sales-Agent/1.0", Accept: "application/json" };
const MAX_LEADS = 20;
const MAX_CSV_ROWS = 500;
const INSERT_LEAD_SQL = `INSERT OR IGNORE INTO leads(
  place_id,name,niche,city,website,phone,email,rating,reviews,status
)
SELECT ?,?,?,?,?,?,?,?,?,?
WHERE NOT EXISTS (SELECT 1 FROM leads WHERE email=? OR website=?)`;

// What kind of lead the scraper should look for:
// - any: no filtering, take whatever comes back first.
// - no_website: businesses with no site listed at all (the easiest "you need a website" pitch).
// - has_website: businesses that do have a site, regardless of quality.
// - needs_improvement: businesses with a site that our quick audit finds real problems with
//   (slow, no HTTPS, not mobile-friendly, etc.) - these get audited inline while scraping.
export type LeadType = "any" | "no_website" | "has_website" | "needs_improvement";
export const LEAD_TYPES: LeadType[] = ["any", "no_website", "has_website", "needs_improvement"];

// "High quality" is a best-effort filter, not a guarantee - no scraper can promise a lead
// converts. It keeps only businesses that are actually reachable (valid email + phone) and
// score at least QUALITY_MIN_SCORE on the same deterministic signals used everywhere else
// (missing/broken site, review count, phone on file), so what gets through is the strongest,
// most contactable subset rather than every match for the niche/city.
const QUALITY_MIN_SCORE = 7;

type LeadRecord = {
  placeId: string | null;
  name: string;
  niche: string;
  city: string;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  rating?: number | null;
  reviews?: number | null;
  _audit?: AuditResult;
};

type JsonRequestOptions = { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string };

export function formatErrorDetails(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<object>();
  function visit(value: unknown, label = "") {
    if (value && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      const err = value as Error & { code?: unknown; cause?: unknown; errors?: unknown };
      const details = [err.name || "Error", err.message, typeof err.code === "string" ? `code ${err.code}` : ""].filter(Boolean);
      messages.push(`${label}${details.join(" ") || String(value)}`);
      if (err.cause !== undefined) visit(err.cause, "cause: ");
      if (Array.isArray(err.errors)) err.errors.forEach((nested, index) => visit(nested, `errors[${index}]: `));
    } else messages.push(`${label}${String(value)}`);
  }
  visit(error);
  return messages.join("; ");
}

async function fetchJson(source: string, url: string, options: JsonRequestOptions = {}, timeoutMs = 8000, attempts = 2): Promise<any> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers: { ...UA, ...options.headers }, signal: AbortSignal.timeout(timeoutMs) });
      const text = await response.text();
      let data: any;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        const error = new Error(`${source} returned invalid JSON (HTTP ${response.status}): ${text.slice(0, 250)}`);
        (error as Error & { retryable?: boolean }).retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      if (data.error) {
        const message = typeof data.error.message === "string" ? data.error.message : JSON.stringify(data.error);
        const error = new Error(`${source} API error (HTTP ${response.status}): ${message}`);
        (error as Error & { retryable?: boolean }).retryable = false;
        throw error;
      }
      if (!response.ok) {
        const message = typeof data.remark === "string" ? data.remark : text.slice(0, 250) || response.statusText;
        const error = new Error(`${source} returned HTTP ${response.status}: ${message}`);
        (error as Error & { retryable?: boolean }).retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      if (source === "Overpass" && typeof data.remark === "string") {
        const error = new Error(`Overpass returned an error: ${data.remark}`);
        (error as Error & { retryable?: boolean }).retryable = true;
        throw error;
      }
      return data;
    } catch (error) {
      const retryable = (error as Error & { retryable?: boolean })?.retryable !== false;
      if (!retryable || attempt === attempts) throw new Error(`${source} request failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${formatErrorDetails(error)}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`${source} request failed.`);
}

async function getEmail(site?: string | null) {
  if (!site) return null;
  for (const path of ["", "/contact", "/contact-us"]) {
    try {
      const response = await fetch(site.replace(/\/$/, "") + path, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": UA["User-Agent"] } });
      const match = ((await response.text()).match(EMAIL) || []).find((email) => !BAD.some((bad) => email.toLowerCase().includes(bad)));
      if (match) return match.toLowerCase();
    } catch {}
  }
  return null;
}

function normalizeWebsite(site?: string | null) {
  const value = site?.trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function insertLeads(leads: LeadRecord[]) {
  if (!leads.length) return 0;
  let added = 0;
  for (const lead of leads) {
    const candidateEmail = lead.email?.trim().toLowerCase() || null;
    const email = candidateEmail && VALID_EMAIL.test(candidateEmail) ? candidateEmail : null;
    const website = normalizeWebsite(lead.website);
    const audit = lead._audit;
    const status = audit ? "audited" : email ? "new" : "no_email";
    const result = await run(INSERT_LEAD_SQL, [
      lead.placeId, lead.name, lead.niche, lead.city, website, lead.phone?.trim() || null,
      email, lead.rating ?? null, lead.reviews ?? null, status, email, website,
    ]);
    const rowsAffected = Number(result.rowsAffected);
    added += rowsAffected;
    // The lead was already audited while scraping (needs_improvement mode) - save the
    // result now instead of making the "Audit pending" step repeat the same work.
    if (rowsAffected > 0 && audit && lead.placeId) {
      const score = scoreLead({ website, reviews: lead.reviews, phone: lead.phone }, audit.problems);
      await run("UPDATE leads SET audit_json=?, lead_score=?, problems=? WHERE place_id=?",
        [JSON.stringify(audit), score, audit.problems.map((p) => p.issue).join("; "), lead.placeId]);
    }
  }
  return added;
}

type ScrapeCandidate = {
  placeId: string; name: string; website: string | null; phone: string | null;
  rawEmail?: string | null; rating?: number | null; reviews?: number | null;
};

// Filters a raw candidate pool down to the requested lead type and, when `highQuality` is
// set, down further to businesses that are actually reachable (a resolved email - required,
// since the whole outreach pipeline runs on email) and score well (phone/reviews are scoring
// bonuses, not a hard requirement - most free OSM listings don't carry a phone tag at all).
// Live auditing/email-lookup (bounded in count and time) only happens when it's actually
// needed: for "needs_improvement", or for any type once quality scoring requires it.
async function selectByLeadType(
  candidates: ScrapeCandidate[], leadType: LeadType, limit: number, highQuality: boolean
): Promise<(ScrapeCandidate & { _audit?: AuditResult; resolvedEmail?: string | null })[]> {
  let pool = candidates;
  if (leadType === "no_website") pool = pool.filter((c) => !c.website);
  else if (leadType === "has_website" || leadType === "needs_improvement") pool = pool.filter((c) => !!c.website);

  const mustAudit = leadType === "needs_improvement" || highQuality;
  if (!mustAudit) return pool.slice(0, limit);

  const withoutSite = pool.filter((c) => !c.website);
  const withSite = pool.filter((c) => !!c.website);
  const auditBudget = Math.min(withSite.length, Math.max(limit * 3, 8));
  const deadline = Date.now() + 35000; // stay well inside the route's 60s budget
  const chosen: (ScrapeCandidate & { _audit?: AuditResult; resolvedEmail?: string | null })[] = [];

  // No website - there's nothing to crawl for a contact email, so only tag-provided emails count.
  for (const candidate of withoutSite) {
    if (chosen.length >= limit) break;
    if (highQuality && !candidate.rawEmail) continue;
    const audit = await buildAudit(candidate.name, null);
    const score = scoreLead({ website: null, reviews: candidate.reviews, phone: candidate.phone }, audit.problems);
    if (!highQuality || score >= QUALITY_MIN_SCORE) chosen.push({ ...candidate, _audit: audit, resolvedEmail: candidate.rawEmail || null });
  }

  for (const candidate of withSite.slice(0, auditBudget)) {
    if (chosen.length >= limit || Date.now() > deadline) break;
    try {
      const audit = await buildAudit(candidate.name, candidate.website);
      if (leadType === "needs_improvement" && audit.problems.length === 0) continue; // site already looks fine
      if (highQuality) {
        const score = scoreLead({ website: candidate.website, reviews: candidate.reviews, phone: candidate.phone }, audit.problems);
        if (score < QUALITY_MIN_SCORE) continue;
        const email = candidate.rawEmail || await getEmail(candidate.website);
        if (!email) continue; // not actually contactable - doesn't count as a quality lead
        chosen.push({ ...candidate, _audit: audit, resolvedEmail: email });
      } else {
        chosen.push({ ...candidate, _audit: audit });
      }
    } catch {}
  }
  return chosen.slice(0, limit);
}

// Business category -> OSM tag filters. Niches not listed here fall back to a name search.
const CATEGORY_TAGS: Record<string, string[]> = {
  dentist: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
  dentists: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
  doctor: ['["amenity"="doctors"]', '["healthcare"="doctor"]'],
  doctors: ['["amenity"="doctors"]', '["healthcare"="doctor"]'],
  restaurant: ['["amenity"="restaurant"]'],
  cafe: ['["amenity"="cafe"]'],
  hotel: ['["tourism"="hotel"]'],
  plumber: ['["craft"="plumber"]'],
  electrician: ['["craft"="electrician"]'],
  lawyer: ['["office"="lawyer"]'],
  hairdresser: ['["shop"="hairdresser"]'],
  mechanic: ['["shop"="car_repair"]'],
  accountant: ['["office"="accountant"]'],
  gym: ['["leisure"="fitness_centre"]'],
  vet: ['["amenity"="veterinary"]'],
  bakery: ['["shop"="bakery"]'],

  // Trades
  painter: ['["craft"="painter"]'],
  roofer: ['["craft"="roofer"]'],
  carpenter: ['["craft"="carpenter"]'],
  locksmith: ['["shop"="locksmith"]', '["craft"="locksmith"]'],
  builder: ['["craft"="builder"]'],
  landscaper: ['["craft"="gardener"]', '["shop"="garden_centre"]'],
  gardener: ['["craft"="gardener"]'],
  pool: ['["craft"="pool_service"]'],

  // Health & wellness
  physio: ['["healthcare"="physiotherapist"]'],
  physiotherapist: ['["healthcare"="physiotherapist"]'],
  chiropractor: ['["healthcare"="chiropractor"]'],
  optometrist: ['["healthcare"="optometrist"]', '["shop"="optician"]'],
  pharmacy: ['["amenity"="pharmacy"]'],
  chemist: ['["amenity"="pharmacy"]'],
  massage: ['["shop"="massage"]'],
  spa: ['["leisure"="spa"]'],

  // Beauty & personal care
  beautician: ['["shop"="beauty"]'],
  "beauty salon": ['["shop"="beauty"]'],
  nails: ['["shop"="beauty"]'],
  "nail salon": ['["shop"="beauty"]'],
  tattoo: ['["shop"="tattoo"]'],
  barber: ['["shop"="hairdresser"]'],

  // Retail
  florist: ['["shop"="florist"]'],
  jeweller: ['["shop"="jewelry"]'],
  jewelry: ['["shop"="jewelry"]'],
  bookstore: ['["shop"="books"]'],
  "clothing store": ['["shop"="clothes"]'],
  boutique: ['["shop"="clothes"]'],
  butcher: ['["shop"="butcher"]'],
  supermarket: ['["shop"="supermarket"]'],
  bicycle: ['["shop"="bicycle"]'],
  "bike shop": ['["shop"="bicycle"]'],
  hardware: ['["shop"="hardware"]'],
  furniture: ['["shop"="furniture"]'],
  "pet shop": ['["shop"="pet"]'],
  "pet grooming": ['["shop"="pet_grooming"]'],

  // Automotive
  "car wash": ['["amenity"="car_wash"]'],
  "tyre shop": ['["shop"="tyres"]'],
  tyres: ['["shop"="tyres"]'],

  // Professional services
  "real estate agent": ['["office"="estate_agent"]'],
  "real estate": ['["office"="estate_agent"]'],
  realtor: ['["office"="estate_agent"]'],
  insurance: ['["office"="insurance"]'],
  architect: ['["office"="architect"]'],
  "financial advisor": ['["office"="financial_advisor"]'],
  "travel agency": ['["shop"="travel_agency"]'],

  // Everyday services
  laundry: ['["shop"="laundry"]'],
  "dry cleaner": ['["shop"="dry_cleaning"]'],
  "driving school": ['["amenity"="driving_school"]'],
  childcare: ['["amenity"="childcare"]'],
  daycare: ['["amenity"="childcare"]'],
  photographer: ['["craft"="photographer"]', '["shop"="photo"]'],
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, '\\"');
}

// The public Overpass API has a few interchangeable free mirrors; the main one
// occasionally reports "at capacity". Try each in turn before giving up.
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function queryOverpass(query: string) {
  let lastError: unknown;
  for (const url of OVERPASS_MIRRORS) {
    try {
      // One attempt per mirror - cycling mirrors IS the retry strategy, no need to double up.
      // Public Overpass mirrors can take well over 8s to execute a query under load, so give
      // each one a generous window before moving on to the next.
      return await fetchJson("Overpass", url, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: query }).toString(),
      }, 15000, 1);
    } catch (err) { lastError = err; }
  }
  throw lastError;
}

async function findOsmLeads(niche: string, city: string, limit: number, leadType: LeadType, highQuality: boolean): Promise<LeadRecord[]> {
  const search = new URLSearchParams({ q: `${city}, Australia`, format: "jsonv2", limit: "1" });
  const places = await fetchJson("Nominatim", `https://nominatim.openstreetmap.org/search?${search}`, {}, 6000, 1);
  const place = Array.isArray(places) ? places[0] : undefined;
  if (!place) throw new Error(`Nominatim could not find "${city}". Check the city name and try again.`);

  const lat = Number(place.lat), lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Nominatim returned no usable coordinates for "${city}".`);

  const normalizedNiche = niche.trim().toLowerCase();
  const filters = CATEGORY_TAGS[normalizedNiche] || [`["name"~"${escapeRegex(niche.trim())}",i]`];
  const selectors = filters.map((filter) => `nwr(around:10000,${lat},${lon})${filter};`).join("");
  // Filtering by website presence/quality happens after the raw fetch, so pull a bigger
  // candidate pool than `limit` whenever a specific lead type or quality filter was requested.
  const rawPoolSize = leadType === "any" && !highQuality ? limit * 3 : limit * 6;
  const query = `[out:json][timeout:15];(${selectors});out center tags ${Math.min(rawPoolSize, 60)};`;
  const result = await queryOverpass(query);

  const elements = Array.isArray(result.elements) ? result.elements : [];
  const raw = elements
    .map((element: any) => {
      const tags = element.tags || {};
      const website = normalizeWebsite(tags.website || tags["contact:website"]);
      return {
        placeId: `osm:${element.type}:${element.id}`, name: tags.name || "", website,
        phone: tags.phone || tags["contact:phone"] || null, rawEmail: tags.email || tags["contact:email"] || null,
      };
    })
    .filter((lead) => lead.name);

  const selected = await selectByLeadType(raw, leadType, limit, highQuality);
  return Promise.all(selected.map(async (lead) => ({
    placeId: lead.placeId, name: lead.name, niche, city, website: lead.website, phone: lead.phone,
    email: lead.resolvedEmail !== undefined ? lead.resolvedEmail : (lead.rawEmail || await getEmail(lead.website)),
    _audit: lead._audit,
  })));
}

async function findGoogleLeads(niche: string, city: string, limit: number, leadType: LeadType, highQuality: boolean): Promise<LeadRecord[]> {
  const pageSize = leadType === "any" && !highQuality ? limit : Math.min(limit * 4, 20);
  const result = await fetchJson("Google Places", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY!.trim(),
      "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({ textQuery: `${niche} in ${city}`, pageSize }),
  });
  const raw = (result.places || [])
    .map((place: any) => ({
      placeId: place.id, name: place.displayName?.text || "", website: normalizeWebsite(place.websiteUri),
      phone: place.nationalPhoneNumber || null, rating: place.rating ?? null, reviews: place.userRatingCount ?? null,
    }))
    .filter((lead: any) => lead.name);

  const selected = await selectByLeadType(raw, leadType, limit, highQuality);
  return Promise.all(selected.map(async (lead) => ({
    placeId: lead.placeId, name: lead.name, niche, city, website: lead.website, phone: lead.phone,
    rating: lead.rating, reviews: lead.reviews,
    email: lead.resolvedEmail !== undefined ? lead.resolvedEmail : await getEmail(lead.website),
    _audit: lead._audit,
  })));
}

// Free-first lead sourcing: OpenStreetMap (Nominatim + Overpass) needs no API key and has no
// usage cost. Google Places only runs as a fallback, and only if a key is configured and OSM
// came back empty for this niche/city. `highQuality` is best-effort, not a guarantee - it keeps
// only leads with a resolved email + phone that score at least QUALITY_MIN_SCORE.
export async function findLeads(niche: string, city: string, limit = 10, leadType: LeadType = "any", highQuality = false) {
  if (!niche?.trim() || !city?.trim()) throw new Error("Enter both a niche and a city to find leads.");
  const boundedLimit = Math.max(1, Math.min(MAX_LEADS, Math.trunc(limit) || 10));
  const googleEnabled = Boolean(process.env.GOOGLE_PLACES_KEY?.trim());

  let added = 0;
  let osmError: unknown;
  try {
    added = await insertLeads(await findOsmLeads(niche.trim(), city.trim(), boundedLimit, leadType, highQuality));
  } catch (err) {
    osmError = err;
  }
  if (added > 0) return added;
  if (!googleEnabled) {
    if (osmError) throw osmError;
    return added;
  }
  // OSM came back empty or errored out (its free public mirrors are occasionally slow/down) -
  // fall back to the paid Google Places API if a key is configured, instead of surfacing the OSM error.
  try {
    return await insertLeads(await findGoogleLeads(niche.trim(), city.trim(), boundedLimit, leadType, highQuality));
  } catch (googleError) {
    throw osmError || googleError;
  }
}

// Self-driving lead sourcing: cycles through the configured niches x cities list so the
// agent keeps finding new leads on its own (via the UI "Run autopilot" button or the daily
// cron) without anyone typing a niche/city in each time. Leads-per-run, lead type and quality
// default to whatever's saved in Autopilot settings, so the daily cron picks them up automatically too.
export async function autoFindLeads(limitPerPair?: number, leadType?: LeadType, highQuality?: boolean) {
  const niches = (await getSetting("autopilot_niches", process.env.AUTOPILOT_NICHES || "")).split(",").map((s) => s.trim()).filter(Boolean);
  const cities = (await getSetting("autopilot_cities", process.env.AUTOPILOT_CITIES || "")).split(",").map((s) => s.trim()).filter(Boolean);
  if (!niches.length || !cities.length) return { niche: null, city: null, added: 0, note: "No autopilot niches/cities configured" };
  const pairs = niches.flatMap((n) => cities.map((c) => [n, c]));
  const idx = Number(await getSetting("autopilot_idx", "0")) % pairs.length;
  const [niche, city] = pairs[idx];
  await setSetting("autopilot_idx", String((idx + 1) % pairs.length));
  const limit = limitPerPair ?? (Number(await getSetting("autopilot_limit", "10")) || 10);
  const type = leadType ?? ((await getSetting("autopilot_lead_type", "any")) as LeadType);
  const quality = highQuality ?? (await getSetting("autopilot_quality", "0")) === "1";
  const added = await findLeads(niche, city, limit, type, quality);
  return { niche, city, added };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      if (field.trim()) throw new Error("Invalid CSV: a quote appeared inside an unquoted field.");
      field = ""; quoted = true;
    } else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("Invalid CSV: a quoted field was not closed.");
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

// Manual fallback for leads you collected by hand (e.g. browsing Google Maps yourself) -
// matches the plan's "search Google Maps by hand, collect publicly listed emails" step.
export async function importLeadsCsv(csv: unknown) {
  if (typeof csv !== "string" || !csv.trim()) throw new Error("Paste or upload a CSV before importing.");
  if (csv.length > 1_000_000) throw new Error("CSV is too large; maximum size is 1 MB.");

  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error("CSV must include a header row and at least one lead.");
  if (rows.length - 1 > MAX_CSV_ROWS) throw new Error(`Import up to ${MAX_CSV_ROWS} CSV rows at a time.`);

  const headers = rows[0].map((header, index) => (index === 0 ? header.replace(/^﻿/, "") : header).trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw new Error("CSV contains duplicate column names.");
  const required = ["name", "website", "email", "phone", "city", "niche"];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(", ")}.`);

  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const leads: LeadRecord[] = rows.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${cells.length} cells; expected ${headers.length}.`);
    const value = (name: string) => cells[column[name]]?.trim() || null;
    const name = value("name");
    if (!name) throw new Error(`CSV row ${index + 2} is missing a name.`);
    return { placeId: null, name, website: value("website"), email: value("email"), phone: value("phone"), city: value("city") || "", niche: value("niche") || "" };
  });
  return insertLeads(leads);
}
