import { q } from "@/lib/db";

const COLUMNS = [
  "name", "website", "email", "phone", "city", "niche", "problems", "lead_score", "status",
  "first_contacted", "last_contacted", "next_action", "notes",
] as const;
const HEADER = ["Business name", "Website", "Email", "Phone", "City", "Industry", "Website problems found",
  "Lead score", "Status", "Date of first email", "Date of last follow-up", "Next action", "Notes"];

function csvCell(v: any) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function asDate(v: any) {
  return v ? new Date(Number(v) * 1000).toISOString().slice(0, 10) : "";
}

// CRM export matching the plan's Google Sheet columns, for anyone who wants this mirrored
// into Sheets instead of (or alongside) this dashboard.
export async function GET() {
  const rows = await q(`SELECT ${COLUMNS.join(",")} FROM leads ORDER BY id DESC`);
  const lines = [HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(COLUMNS.map((c) => csvCell(c === "first_contacted" || c === "last_contacted" ? asDate(r[c]) : r[c])).join(","));
  }
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=leads_crm.csv" },
  });
}
