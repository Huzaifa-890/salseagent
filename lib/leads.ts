import { run, getSetting, setSetting } from "./db";

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
  const statements = leads.map((lead) => {
    const candidateEmail = lead.email?.trim().toLowerCase() || null;
    const email = candidateEmail && VALID_EMAIL.test(candidateEmail) ? candidateEmail : null;
    const website = normalizeWebsite(lead.website);
    return {
      sql: INSERT_LEAD_SQL,
      args: [lead.placeId, lead.name, lead.niche, lead.city, website, lead.phone?.trim() || null,
        email, lead.rating ?? null, lead.reviews ?? null, email ? "new" : "no_email", email, website],
    };
  });
  let added = 0;
  for (const s of statements) added += Number((await run(s.sql, s.args)).rowsAffected);
  return added;
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
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, '\\"');
}

// The public Overpass API has a few interchangeable free mirrors; the main one
// occasionally reports "at capacity". Try each in turn before giving up.
const OVERPASS_MIRRORS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

async function queryOverpass(query: string) {
  let lastError: unknown;
  for (const url of OVERPASS_MIRRORS) {
    try {
      // One attempt per mirror - cycling mirrors IS the retry strategy, no need to double up.
      return await fetchJson("Overpass", url, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ data: query }).toString(),
      }, 8000, 1);
    } catch (err) { lastError = err; }
  }
  throw lastError;
}

async function findOsmLeads(niche: string, city: string, limit: number): Promise<LeadRecord[]> {
  const search = new URLSearchParams({ q: `${city}, Australia`, format: "jsonv2", limit: "1" });
  const places = await fetchJson("Nominatim", `https://nominatim.openstreetmap.org/search?${search}`);
  const place = Array.isArray(places) ? places[0] : undefined;
  if (!place) throw new Error(`Nominatim could not find "${city}". Check the city name and try again.`);

  const lat = Number(place.lat), lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Nominatim returned no usable coordinates for "${city}".`);

  const normalizedNiche = niche.trim().toLowerCase();
  const filters = CATEGORY_TAGS[normalizedNiche] || [`["name"~"${escapeRegex(niche.trim())}",i]`];
  const selectors = filters.map((filter) => `nwr(around:10000,${lat},${lon})${filter};`).join("");
  const query = `[out:json][timeout:15];(${selectors});out center tags ${Math.min(limit * 3, 60)};`;
  const result = await queryOverpass(query);

  const elements = Array.isArray(result.elements) ? result.elements : [];
  const leads = await Promise.all(elements.slice(0, limit).map(async (element: any) => {
    const tags = element.tags || {};
    const website = normalizeWebsite(tags.website || tags["contact:website"]);
    return {
      placeId: `osm:${element.type}:${element.id}`,
      name: tags.name || "",
      niche, city, website,
      phone: tags.phone || tags["contact:phone"] || null,
      email: tags.email || tags["contact:email"] || await getEmail(website),
    };
  }));
  return leads.filter((lead) => lead.name);
}

async function findGoogleLeads(niche: string, city: string, limit: number): Promise<LeadRecord[]> {
  const result = await fetchJson("Google Places", "https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY!.trim(),
      "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({ textQuery: `${niche} in ${city}`, pageSize: limit }),
  });
  const leads = await Promise.all((result.places || []).map(async (place: any) => {
    const website = normalizeWebsite(place.websiteUri);
    return {
      placeId: place.id, name: place.displayName?.text || "", niche, city, website,
      phone: place.nationalPhoneNumber || null, rating: place.rating ?? null, reviews: place.userRatingCount ?? null,
      email: await getEmail(website),
    };
  }));
  return leads.filter((lead) => lead.name);
}

// Free-first lead sourcing: OpenStreetMap (Nominatim + Overpass) needs no API key and has no
// usage cost. Google Places only runs as a fallback, and only if a key is configured and OSM
// came back empty for this niche/city.
export async function findLeads(niche: string, city: string, limit = 10) {
  if (!niche?.trim() || !city?.trim()) throw new Error("Enter both a niche and a city to find leads.");
  const boundedLimit = Math.max(1, Math.min(MAX_LEADS, Math.trunc(limit) || 10));
  const googleEnabled = Boolean(process.env.GOOGLE_PLACES_KEY?.trim());
  const osmLeads = await findOsmLeads(niche.trim(), city.trim(), boundedLimit);
  const added = await insertLeads(osmLeads);
  if (added > 0 || !googleEnabled) return added;
  return insertLeads(await findGoogleLeads(niche.trim(), city.trim(), boundedLimit));
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
