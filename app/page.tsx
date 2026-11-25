"use client";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Bot, Users, Settings, Moon, Sun, Compass, Mail, MessageSquareText,
  FileText, Trophy, XCircle, CheckCircle2, AlertTriangle, Info, X, Menu, Search, Inbox,
  Eye, EyeOff, Workflow, Rows3, Table2, Columns3, type LucideIcon,
} from "lucide-react";
const post = (b: any) => fetch("/api/agent", { method: "POST", body: JSON.stringify(b) }).then((r) => r.json());

const EMAIL_STATUSES = ["drafted", "followup_ready", "proposal_followup_ready", "agreement_ready"];
const EMAIL_SEND_ACTION: Record<string, string> = {
  drafted: "send", followup_ready: "send_followup", proposal_followup_ready: "send_proposal_followup", agreement_ready: "send_agreement",
};
const STATUS_META: Record<string, { label: string; tone: string }> = {
  new: { label: "New", tone: "" },
  no_email: { label: "No email", tone: "danger" },
  audited: { label: "Audited", tone: "info" },
  drafted: { label: "Draft ready", tone: "warn" },
  contacted: { label: "Contacted", tone: "" },
  followup_ready: { label: "Follow-up ready", tone: "warn" },
  interested: { label: "Interested", tone: "success" },
  proposal_draft: { label: "Proposal draft", tone: "accent" },
  proposal_sent: { label: "Proposal sent", tone: "accent" },
  proposal_followup_ready: { label: "Proposal follow-up ready", tone: "warn" },
  agreement_ready: { label: "Agreement ready", tone: "warn" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "danger" },
  not_interested: { label: "Not interested", tone: "" },
  unsubscribed: { label: "Unsubscribed", tone: "danger" },
  bounced: { label: "Bounced", tone: "danger" },
  skipped: { label: "Skipped", tone: "" },
};
const NAV: { key: string; label: string; icon: LucideIcon; adminOnly?: boolean }[] = [
  { key: "dashboard", label: "Overview", icon: LayoutDashboard },
  { key: "pipeline", label: "Pipeline", icon: Workflow },
  { key: "leads", label: "Leads", icon: Rows3 },
  { key: "autopilot", label: "Autopilot", icon: Bot },
  { key: "team", label: "Team", icon: Users, adminOnly: true },
  { key: "account", label: "Account", icon: Settings },
];
const LEAD_TYPE_OPTIONS = [
  { value: "any", label: "Any lead" },
  { value: "no_website", label: "No website only" },
  { value: "has_website", label: "Has a website" },
  { value: "needs_improvement", label: "Has a website — needs improvement" },
];
const NICHE_SUGGESTIONS = [
  "plumber", "electrician", "dentist", "doctor", "cafe", "restaurant", "hotel", "lawyer",
  "hairdresser", "barber", "mechanic", "accountant", "gym", "vet", "bakery", "painter",
  "roofer", "carpenter", "locksmith", "builder", "landscaper", "physio", "chiropractor",
  "optometrist", "pharmacy", "massage", "spa", "beautician", "nail salon", "tattoo",
  "florist", "jeweller", "bookstore", "clothing store", "butcher", "supermarket", "bicycle",
  "hardware", "furniture", "pet grooming", "car wash", "tyres", "real estate agent",
  "insurance", "architect", "financial advisor", "travel agency", "laundry", "dry cleaner",
  "driving school", "childcare", "photographer",
];
function websiteCategory(l: any): "no_website" | "needs_improvement" | "clean" | "not_checked" {
  if (!l.website) return "no_website";
  if (l.problems) return "needs_improvement";
  if (l.lead_score !== null && l.lead_score !== undefined) return "clean";
  return "not_checked";
}
const WEBSITE_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "no_website", label: "No website" },
  { key: "needs_improvement", label: "Needs improvement" },
  { key: "clean", label: "Website OK" },
  { key: "not_checked", label: "Not checked yet" },
];
const STAT_DEFS: { key: string; label: string; icon: LucideIcon; suffix?: (s: any) => string }[] = [
  { key: "found", label: "Leads found", icon: Compass },
  { key: "firstEmailsSent", label: "Emails sent", icon: Mail },
  { key: "replied", label: "Replied", icon: MessageSquareText, suffix: (s) => ` (${s.replyRate ?? 0}%)` },
  { key: "proposalsSent", label: "Proposals sent", icon: FileText },
  { key: "won", label: "Won", icon: Trophy },
  { key: "lost", label: "Lost", icon: XCircle },
];
// Fixed status colors (not themed) - same hex in light/dark, always paired with a text label.
const WEBSITE_CHART_COLORS: Record<string, string> = {
  no_website: "#d03b3b", needs_improvement: "#fab219", clean: "#0ca30c", not_checked: "var(--text-muted)",
};

function BarChart({ data }: { data: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="hint">No data yet.</p>;
  return (
    <div className="bar-chart">
      {data.map((d) => (
        <div className="bar-row" key={d.label} title={`${d.label}: ${d.value}`}>
          <div className="bar-label">{d.label}</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(3, (d.value / max) * 100)}%`, background: d.color || "var(--primary)" }} />
          </div>
          <div className="bar-value">{d.value}</div>
        </div>
      ))}
    </div>
  );
}

// How far each status implies a lead has progressed through the pipeline. "lost" is pinned to
// stage 3 because the UI only offers "Lost" from proposal_sent - every lost lead got that far.
const FUNNEL_RANK: Record<string, number> = {
  new: 0, no_email: 0, audited: 0, drafted: 0, skipped: 0,
  contacted: 1, followup_ready: 1, bounced: 1, unsubscribed: 1, not_interested: 1,
  interested: 2, proposal_draft: 2,
  proposal_sent: 3, proposal_followup_ready: 3, agreement_ready: 3, lost: 3,
  won: 4,
};
const FUNNEL_STAGES = ["Found", "Contacted", "Interested", "Proposal sent", "Won"];

function FunnelChart({ leads }: { leads: any[] }) {
  const data = FUNNEL_STAGES.map((label, i) => ({
    label, value: leads.filter((l) => (FUNNEL_RANK[l.status] ?? 0) >= i).length,
  }));
  const top = Math.max(1, data[0]?.value || 0);
  if (!leads.length) return <p className="hint">No data yet.</p>;
  return (
    <div className="funnel">
      {data.map((d, i) => {
        const pct = Math.round((d.value / top) * 100);
        return (
          <div className="funnel-row" key={d.label} title={`${d.label}: ${d.value} (${pct}%)`}>
            <div className="funnel-label">{d.label}</div>
            <div className="funnel-track">
              <div className="funnel-fill" style={{ width: `${Math.max(4, pct)}%`, background: `var(--funnel-${i + 1})` }} />
            </div>
            <div className="funnel-value">{d.value} <span className="hint">({pct}%)</span></div>
          </div>
        );
      })}
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme") as "light" | "dark" | null;
    setTheme(current || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  }
  return <button className="ghost" onClick={toggle} title="Toggle theme">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>;
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || { label: status, tone: "" };
  return <span className={`badge ${m.tone}`}>{m.label}</span>;
}

function ScorePill({ score }: { score: number | null }) {
  if (score === null || score === undefined) return <span className="hint">-</span>;
  const cls = score >= 7 ? "hi" : score >= 4 ? "mid" : "lo";
  return <span className={`score-pill ${cls}`}>{score}</span>;
}

function ToastStack({ toasts, dismiss }: { toasts: { id: number; type: string; text: string }[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span>{t.type === "success" ? <CheckCircle2 size={16} /> : t.type === "error" ? <AlertTriangle size={16} /> : <Info size={16} />}</span>
          <span>{t.text}</span>
          <button className="close" onClick={() => dismiss(t.id)}><X size={13} /></button>
        </div>
      ))}
    </div>
  );
}

function ConfirmModal({ confirm, onCancel }: { confirm: { title: string; body: string; onConfirm: () => void } | null; onCancel: () => void }) {
  if (!confirm) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>{confirm.title}</h3>
        <p className="hint">{confirm.body}</p>
        <div className="modal-actions">
          <button className="alt" onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={() => { confirm.onConfirm(); onCancel(); }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

function PasswordField({ label, value, onChange, minLength }: { label: string; value: string; onChange: (v: string) => void; minLength?: number }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="password-field">
        <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} minLength={minLength} required />
        <button type="button" className="toggle-visibility" tabIndex={-1} onClick={() => setShow((s) => !s)} title={show ? "Hide" : "Show"}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function AccountPanel({ me, onToast }: { me: { email: string; role: string } | null; onToast: (type: string, text: string) => void }) {
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setMsg("Error: new passwords don't match"); return onToast("error", "New passwords don't match"); }
    setBusy(true); setMsg("");
    const r = await fetch("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    const d = await r.json();
    setBusy(false);
    if (r.ok) {
      setMsg("Password updated."); setCurrent(""); setNext(""); setConfirm("");
      onToast("success", "Password updated");
    } else {
      setMsg("Error: " + d.error);
      onToast("error", d.error);
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 420 }}>
      <h3>Account</h3>
      <p className="hint">{me?.email} · <span className="badge">{me?.role}</span></p>
      <form onSubmit={submit}>
        <PasswordField label="Current password" value={current} onChange={setCurrent} />
        <PasswordField label="New password" value={next} onChange={setNext} minLength={8} />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} />
        {msg && <p className={msg.startsWith("Error") ? "error-text" : "hint"}>{msg}</p>}
        <button type="submit" disabled={busy} style={{ marginTop: 6 }}>
          {busy && <span className="spinner" />}{busy ? "Updating..." : "Update password"}
        </button>
      </form>
    </div>
  );
}

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [settings, setSettings] = useState<any>({});
  const [me, setMe] = useState<{ email: string; role: string } | null>(null);
  const [team, setTeam] = useState<any[]>([]);
  const [niche, setNiche] = useState(""), [city, setCity] = useState(""), [msg, setMsg] = useState("");
  const [howMany, setHowMany] = useState(10), [leadType, setLeadType] = useState("any");
  const [highQuality, setHighQuality] = useState(false);
  const [edits, setEdits] = useState<Record<number, any>>({});
  const [tab, setTab] = useState("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [websiteFilter, setWebsiteFilter] = useState("all");
  const [leadsView, setLeadsView] = useState<"list" | "board">("list");
  const [toasts, setToasts] = useState<{ id: number; type: string; text: string }[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; body: string; onConfirm: () => void } | null>(null);

  function toast(type: string, text: string) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }
  function dismissToast(id: number) { setToasts((t) => t.filter((x) => x.id !== id)); }

  const load = async () => {
    const d = await (await fetch("/api/agent")).json();
    setLeads(d.leads || []); setStats(d.stats || {}); setSettings(d.settings || {});
  };
  const loadTeam = async () => {
    const r = await fetch("/api/users");
    if (r.ok) setTeam((await r.json()).users || []);
  };
  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
    fetch("/api/auth").then((r) => r.json()).then((d) => { setMe(d.user || null); if (d.user?.role === "admin") loadTeam(); });
  }, []);
  const isAdmin = me?.role === "admin";

  async function go(label: string, body: any, loop = false) {
    setBusy(true); setMsg(label + "...");
    try {
      let r: any;
      do {
        r = await post(body);
        if (r.error) { setMsg("Error: " + r.error); toast("error", r.error); return; }
        await load();
      } while (loop && r.done > 0);
      setMsg(label + " done " + JSON.stringify(r));
      toast("success", label + " complete");
    } finally {
      setBusy(false);
    }
  }
  const ed = (id: number, k: string, v: string) => setEdits({ ...edits, [id]: { ...edits[id], [k]: v } });
  const get = (id: number, k: string, fallback: any) => (edits[id]?.[k] !== undefined ? edits[id][k] : fallback);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/login";
  }
  async function addTeamMember() {
    const email = get(-2, "email", ""), password = get(-2, "password", "");
    if (!email || !password) return toast("error", "Email and password are required");
    const r = await fetch("/api/users", {
      method: "POST",
      body: JSON.stringify({ email, password, role: get(-2, "role", "staff") }),
    });
    const d = await r.json();
    if (r.ok) { setMsg("Team member added"); toast("success", "Team member added"); setEdits({ ...edits, [-2]: {} }); loadTeam(); }
    else { setMsg("Error: " + d.error); toast("error", d.error); }
  }
  function confirmRemoveTeamMember(u: any) {
    setConfirm({
      title: "Remove team member?",
      body: `This immediately revokes dashboard access for ${u.email}.`,
      onConfirm: async () => {
        const r = await fetch("/api/users", { method: "DELETE", body: JSON.stringify({ id: u.id }) });
        const d = await r.json();
        if (r.ok) { toast("success", "Removed " + u.email); loadTeam(); }
        else toast("error", d.error);
      },
    });
  }

  const paused = settings.manual_pause === "1" || (Number(settings.paused_until) > Date.now() / 1000);

  function go_to(key: string) { setTab(key); setDrawerOpen(false); }

  const matchesSearch = (l: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (l.name || "").toLowerCase().includes(q) || (l.email || "").toLowerCase().includes(q) || (l.city || "").toLowerCase().includes(q);
  };
  const visibleLeads = leads.filter((l) => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (websiteFilter !== "all" && websiteCategory(l) !== websiteFilter) return false;
    return matchesSearch(l);
  });
  // Board view groups by status itself, so it only applies the website + search filters.
  const boardLeads = leads.filter((l) => (websiteFilter === "all" || websiteCategory(l) === websiteFilter) && matchesSearch(l));
  const statusChips = ["all", ...Array.from(new Set(leads.map((l) => l.status))).filter(Boolean)];
  const boardColumns = Object.keys(STATUS_META).filter((s) => boardLeads.some((l) => l.status === s));

  const statusChartData = statusChips.filter((s) => s !== "all")
    .map((s) => ({ label: STATUS_META[s]?.label || s, value: leads.filter((l) => l.status === s).length }))
    .sort((a, b) => b.value - a.value);
  const websiteChartData = WEBSITE_FILTERS.filter((f) => f.key !== "all")
    .map((f) => ({ label: f.label, value: leads.filter((l) => websiteCategory(l) === f.key).length, color: WEBSITE_CHART_COLORS[f.key] }));

  function renderActions(l: any) {
    return (
      <>
        {EMAIL_STATUSES.includes(l.status) && (
          <details className="action-card"><summary>Review &amp; send</summary>
            <input defaultValue={l.draft_subject} onChange={(e) => ed(l.id, "subject", e.target.value)} />
            <textarea rows={9} defaultValue={l.draft_body} onChange={(e) => ed(l.id, "body", e.target.value)} />
            <div className="row">
              <button disabled={!isAdmin || busy} title={isAdmin ? "" : "Only an admin can send"}
                onClick={() => go("Sending", { action: EMAIL_SEND_ACTION[l.status], id: l.id, subject: get(l.id, "subject", l.draft_subject), body: get(l.id, "body", l.draft_body) })}>
                {busy && <span className="spinner" />}Send
              </button>
              <button className="alt" disabled={busy} onClick={() => go("Skipping", { action: "skip", id: l.id })}>Skip</button>
            </div></details>
        )}

        {l.status === "interested" && (
          <details className="action-card"><summary>Collect needs &amp; draft proposal</summary>
            <input placeholder="Pages (e.g. Home, About, Contact)" onChange={(e) => ed(l.id, "pages", e.target.value)} />
            <input placeholder="Features (e.g. booking form, gallery)" onChange={(e) => ed(l.id, "features", e.target.value)} />
            <input placeholder="Budget range" onChange={(e) => ed(l.id, "budget", e.target.value)} />
            <input placeholder="Timeline" onChange={(e) => ed(l.id, "timeline", e.target.value)} />
            <button disabled={busy} onClick={() => go("Drafting proposal", { action: "draft_proposal", id: l.id, ...edits[l.id] })}>
              {busy && <span className="spinner" />}Draft proposal
            </button>
          </details>
        )}

        {l.status === "proposal_draft" && (
          <div className="action-card">
            <input defaultValue={l.proposal_price} onChange={(e) => ed(l.id, "price", e.target.value)} placeholder="Price" />
            <textarea rows={9} defaultValue={l.proposal_text} onChange={(e) => ed(l.id, "text", e.target.value)} />
            <button disabled={!isAdmin || busy} title={isAdmin ? "" : "Only an admin can send"}
              onClick={() => go("Sending proposal", { action: "send_proposal", id: l.id, text: get(l.id, "text", l.proposal_text), price: get(l.id, "price", l.proposal_price) })}>
              {busy && <span className="spinner" />}Send proposal
            </button>
          </div>
        )}

        {l.status === "proposal_sent" && (
          <div className="row">
            <button disabled={busy} onClick={() => go("Marking won", { action: "won", id: l.id })}>Won</button>
            <button className="alt" disabled={busy} onClick={() => setConfirm({
              title: "Mark as lost?",
              body: `${l.name} will be moved to the Lost status.`,
              onConfirm: () => go("Marking lost", { action: "lost", id: l.id }),
            })}>Lost</button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${drawerOpen ? "open" : ""}`}>
        <div className="brand"><h1>IT Reliable</h1><span className="sub">Sales Agent</span></div>
        <nav>
          {NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => (
            <button key={n.key} className={`nav-item ${tab === n.key ? "active" : ""}`} onClick={() => go_to(n.key)}>
              <n.icon size={16} />{n.label}{n.key === "leads" && leads.length > 0 && ` (${leads.length})`}
            </button>
          ))}
        </nav>
        {!loading && leads.length > 0 && (
          <div className="sidebar-stats">
            <div className="sidebar-stat"><span className="n">{leads.length}</span><span className="l">Leads</span></div>
            <div className="sidebar-stat"><span className="n">{stats.won ?? 0}</span><span className="l">Won</span></div>
            <div className="sidebar-stat"><span className="n">{Math.max(0, leads.length - (stats.won ?? 0) - (stats.lost ?? 0))}</span><span className="l">Pending</span></div>
          </div>
        )}
        <div className="sidebar-footer">
          {me && <p className="hint">{me.email}<br /><span className="badge">{me.role}</span>{paused && <span className="badge danger" style={{ marginLeft: 6 }}>PAUSED</span>}</p>}
          <button className="alt" style={{ width: "100%" }} onClick={logout}>Logout</button>
        </div>
      </aside>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      <div className="main-col">
        <div className="topbar">
          <button className="hamburger" onClick={() => setDrawerOpen(true)}><Menu size={18} /></button>
          <div style={{ flex: 1 }} />
          {paused && <span className="badge danger">PAUSED</span>}
          <ThemeToggle />
        </div>

        <div className="wrap">
          {(tab === "dashboard" || tab === "pipeline" || tab === "leads") && loading && (
            <>
              <div className="stat-grid">
                {STAT_DEFS.map((s) => <div className="stat-card skeleton skeleton-stat" key={s.key} />)}
              </div>
              <div className="panel skeleton" style={{ height: 120 }} />
              <div className="card" style={{ padding: 16 }}>
                {[1, 2, 3, 4].map((i) => <div className="skeleton skeleton-row" key={i} />)}
              </div>
            </>
          )}

          {tab === "dashboard" && !loading && (<>
                <div className="stat-grid">
                  {STAT_DEFS.map((s) => (
                    <div className="stat-card" key={s.key}>
                      <div className="icon"><s.icon size={18} /></div>
                      <div className="meta">
                        <div className="n">{stats[s.key] ?? 0}</div>
                        <div className="l">{s.label}{s.suffix ? s.suffix(stats) : ""}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="panel">
                  <h3>Pipeline funnel</h3>
                  <FunnelChart leads={leads} />
                  <p className="hint" style={{ marginTop: 10 }}>Based on each lead's current status - "Lost" leads are counted through Proposal sent, since that's the only stage the app lets you mark a lead Lost from.</p>
                </div>

                <div className="chart-grid">
                  <div className="panel">
                    <h3>Leads by status</h3>
                    <BarChart data={statusChartData} />
                  </div>
                  <div className="panel">
                    <h3>Website quality breakdown</h3>
                    <BarChart data={websiteChartData} />
                  </div>
                </div>
              </>)}

          {tab === "pipeline" && !loading && (
                <div className="panel">
                  <h3>Find leads</h3>
                  <div className="row">
                    <input list="niche-suggestions" placeholder="Niche (e.g. plumber)" value={niche} onChange={(e) => setNiche(e.target.value)} />
                    <datalist id="niche-suggestions">
                      {NICHE_SUGGESTIONS.map((n) => <option key={n} value={n} />)}
                    </datalist>
                    <input placeholder="City (e.g. Sydney)" value={city} onChange={(e) => setCity(e.target.value)} />
                    <input type="number" min={1} max={20} placeholder="How many" value={howMany}
                      onChange={(e) => setHowMany(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                      style={{ maxWidth: 100 }} title="How many leads to fetch" />
                    <select value={leadType} onChange={(e) => setLeadType(e.target.value)} style={{ maxWidth: 260 }} title="What kind of lead to look for">
                      {LEAD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={highQuality} onChange={(e) => setHighQuality(e.target.checked)} />
                      High quality only
                    </label>
                    <button disabled={busy} onClick={() => go("Finding leads", { action: "find", niche, city, limit: howMany, leadType, highQuality })}>
                      {busy && <span className="spinner" />}Find (manual)
                    </button>
                    <button disabled={busy} onClick={() => go("Running autopilot", { action: "autopilot" })}>
                      {busy && <span className="spinner" />}Run autopilot now
                    </button>
                  </div>
                  <p className="hint">"Needs improvement" audits each candidate site on the fly and only keeps the ones with real issues. "High quality only" additionally requires a resolved email (so it can actually be contacted) and a strong score - phone/reviews boost the score when present but aren't required. No filter can guarantee a sale, but this narrows it to the most contactable, promising matches. Both can take a little longer than a plain search.</p>

                  <h3 style={{ marginTop: 18 }}>Process pending leads</h3>
                  <div className="row">
                    <button className="alt" disabled={busy} onClick={() => go("Auditing", { action: "audit" }, true)}>Audit pending</button>
                    <button className="alt" disabled={busy} onClick={() => go("Drafting", { action: "draft" }, true)}>Draft pending</button>
                    <button className="alt" disabled={busy} onClick={() => go("Checking replies", { action: "replies" })}>Check replies</button>
                    {paused
                      ? <button disabled={busy} onClick={() => go("Resuming", { action: "resume" })}>Resume sending</button>
                      : <button className="alt" disabled={busy} onClick={() => go("Pausing", { action: "pause" })}>Pause sending</button>}
                    <a href="/api/export"><button className="alt" type="button">Export CRM CSV</button></a>
                  </div>
                  <details className="action-card">
                    <summary>Import leads from CSV</summary>
                    <p className="hint">For leads you collected by hand (e.g. browsing Google Maps). Columns required: name, website, email, phone, city, niche.</p>
                    <textarea rows={6} placeholder="name,website,email,phone,city,niche" onChange={(e) => ed(-3, "csv", e.target.value)} />
                    <button disabled={busy} onClick={() => go("Importing CSV", { action: "import", csv: get(-3, "csv", "") })}>Import</button>
                  </details>
                  <p className="msg">{busy && <span className="spinner" style={{ marginRight: 6 }} />}{msg}</p>
                </div>
              )}

          {tab === "leads" && !loading && (<>
              <div className="toolbar">
                <div className="search-input">
                  <span className="icn"><Search size={14} /></span>
                  <input placeholder="Search by name, email or city…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="view-toggle">
                  <button className={leadsView === "list" ? "active" : ""} onClick={() => setLeadsView("list")}><Table2 size={14} />List</button>
                  <button className={leadsView === "board" ? "active" : ""} onClick={() => setLeadsView("board")}><Columns3 size={14} />Board</button>
                </div>
              </div>
              <div className="toolbar">
                <span className="hint" style={{ minWidth: 68 }}>Website:</span>
                <div className="chip-group">
                  {WEBSITE_FILTERS.map((f) => (
                    <button key={f.key} className={`chip ${websiteFilter === f.key ? "active" : ""}`} onClick={() => setWebsiteFilter(f.key)}>
                      {f.label}
                      {f.key !== "all" && ` (${leads.filter((x) => websiteCategory(x) === f.key).length})`}
                    </button>
                  ))}
                </div>
              </div>
              {leadsView === "list" && (
                <div className="toolbar">
                  <span className="hint" style={{ minWidth: 68 }}>Status:</span>
                  <div className="chip-group">
                    {statusChips.map((s) => (
                      <button key={s} className={`chip ${statusFilter === s ? "active" : ""}`} onClick={() => setStatusFilter(s)}>
                        {s === "all" ? "All" : (STATUS_META[s]?.label || s)}
                        {s !== "all" && ` (${leads.filter((x) => x.status === s).length})`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {leadsView === "board" ? (
                boardColumns.length === 0 ? (
                  <div className="card">
                    <div className="empty-state">
                      <div className="icon"><Inbox size={32} /></div>
                      <p>{leads.length === 0
                        ? <>No leads yet — try <b>Find (manual)</b> or <b>Run autopilot now</b> on the Pipeline tab to get started.</>
                        : "No leads match your search or filter."}</p>
                    </div>
                  </div>
                ) : (
                  <div className="board">
                    {boardColumns.map((s) => {
                      const colLeads = boardLeads.filter((l) => l.status === s);
                      return (
                        <div className="board-col" key={s}>
                          <div className="board-col-head"><StatusBadge status={s} /><span className="hint">{colLeads.length}</span></div>
                          <div className="board-col-body">
                            {colLeads.map((l) => (
                              <div className="board-card" key={l.id}>
                                <div className="board-card-name">{l.name}</div>
                                <div className="lc-meta">{l.city} {l.rating ? "★" + l.rating : ""}</div>
                                <div className="lc-row"><span className="hint">Email</span><span>{l.email || "-"}</span></div>
                                <div className="lc-row"><span className="hint">Score</span><ScorePill score={l.lead_score} /></div>
                                {renderActions(l)}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : visibleLeads.length === 0 ? (
                <div className="card">
                  <div className="empty-state">
                    <div className="icon"><Inbox size={32} /></div>
                    <p>{leads.length === 0
                      ? <>No leads yet — try <b>Find (manual)</b> or <b>Run autopilot now</b> on the Pipeline tab to get started.</>
                      : "No leads match your search or filter."}</p>
                  </div>
                </div>
              ) : (<>
                <div className="table-wrap card">
                  <table><thead><tr><th>Business</th><th>Email</th><th>Score</th><th>Status</th><th>Next action</th><th></th></tr></thead><tbody>
                    {visibleLeads.map((l) => (<tr key={l.id}>
                      <td>{l.name}<br /><small className="hint">{l.city} {l.rating ? "★" + l.rating : ""}</small></td>
                      <td>{l.email || "-"}</td>
                      <td><ScorePill score={l.lead_score} /></td>
                      <td><StatusBadge status={l.status} /></td>
                      <td><small className="hint">{l.next_action || ""}</small></td>
                      <td>{renderActions(l)}</td>
                    </tr>))}
                  </tbody></table>
                </div>

                <div className="lead-cards">
                  {visibleLeads.map((l) => (
                    <div className="lead-card" key={l.id}>
                      <div className="lc-top">
                        <div>
                          <div className="lc-name">{l.name}</div>
                          <div className="lc-meta">{l.city} {l.rating ? "★" + l.rating : ""}</div>
                        </div>
                        <ScorePill score={l.lead_score} />
                      </div>
                      <div className="lc-row"><span className="hint">Email</span><span>{l.email || "-"}</span></div>
                      <div className="lc-row"><span className="hint">Status</span><StatusBadge status={l.status} /></div>
                      {l.next_action && <div className="lc-row"><span className="hint">Next</span><span>{l.next_action}</span></div>}
                      <div style={{ marginTop: 8 }}>{renderActions(l)}</div>
                    </div>
                  ))}
                </div>
              </>)}
          </>)}

          {tab === "autopilot" && (
            <div className="panel" style={{ maxWidth: 480 }}>
              <h3>Autopilot settings</h3>
              <div className="field">
                <label>Niches (comma-separated)</label>
                <input defaultValue={settings.autopilot_niches} onChange={(e) => ed(-1, "niches", e.target.value)} />
              </div>
              <div className="field">
                <label>Cities (comma-separated)</label>
                <input defaultValue={settings.autopilot_cities} onChange={(e) => ed(-1, "cities", e.target.value)} />
              </div>
              <div className="field">
                <label>Leads per run</label>
                <input type="number" min={1} max={20} defaultValue={settings.autopilot_limit || 10} onChange={(e) => ed(-1, "limit", e.target.value)} />
              </div>
              <div className="field">
                <label>Lead type</label>
                <select defaultValue={settings.autopilot_lead_type || "any"} onChange={(e) => ed(-1, "leadType", e.target.value)}>
                  {LEAD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0", fontSize: 13.5, fontWeight: 600 }}>
                <input type="checkbox" style={{ width: "auto", margin: 0 }} defaultChecked={settings.autopilot_quality === "1"} onChange={(e) => ed(-1, "highQuality", e.target.checked ? "1" : "")} />
                High quality only (needs a resolved email + strong score)
              </label>
              <button disabled={busy} onClick={() => {
                go("Saving settings", {
                  action: "save_settings",
                  niches: get(-1, "niches", settings.autopilot_niches),
                  cities: get(-1, "cities", settings.autopilot_cities),
                  limit: get(-1, "limit", settings.autopilot_limit || 10),
                  leadType: get(-1, "leadType", settings.autopilot_lead_type || "any"),
                  highQuality: get(-1, "highQuality", settings.autopilot_quality === "1" ? "1" : "") === "1",
                });
                toast("success", "Autopilot settings saved");
              }}>
                {busy && <span className="spinner" />}Save
              </button>
              <p className="hint">The agent cycles through every niche x city pair on its own via "Run autopilot now" (Dashboard) and the daily cron - no need to type a niche/city each time.</p>
              <p className="msg">{msg}</p>
            </div>
          )}

          {tab === "team" && isAdmin && (
            <div className="panel">
              <h3>Team</h3>
              {team.length === 0 ? (
                <p className="hint">No team members yet — add one below.</p>
              ) : (
                <table><thead><tr><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
                  {team.map((u) => (<tr key={u.id}>
                    <td>{u.email}</td>
                    <td><span className="badge">{u.role}</span></td>
                    <td>{u.email !== me?.email && <button className="alt" onClick={() => confirmRemoveTeamMember(u)}>Remove</button>}</td>
                  </tr>))}
                </tbody></table>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <input placeholder="Email" onChange={(e) => ed(-2, "email", e.target.value)} />
                <input placeholder="Password" type="password" onChange={(e) => ed(-2, "password", e.target.value)} />
                <select defaultValue="staff" onChange={(e) => ed(-2, "role", e.target.value)}>
                  <option value="staff">Staff (can't send)</option>
                  <option value="admin">Admin (full access)</option>
                </select>
                <button onClick={addTeamMember}>Add team member</button>
              </div>
              <p className="hint">Staff can research, audit, draft and prepare proposals, but only an Admin can click Send on an email, follow-up, proposal or agreement.</p>
              <p className="msg">{msg}</p>
            </div>
          )}

          {tab === "account" && <AccountPanel me={me} onToast={toast} />}
        </div>
      </div>

      <ToastStack toasts={toasts} dismiss={dismissToast} />
      <ConfirmModal confirm={confirm} onCancel={() => setConfirm(null)} />
    </div>
  );
}
