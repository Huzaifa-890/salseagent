"use client";
import { useEffect, useState } from "react";
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
const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "autopilot", label: "Autopilot", icon: "🤖" },
  { key: "team", label: "Team", icon: "👥", adminOnly: true },
  { key: "account", label: "Account", icon: "⚙️" },
];

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
  return <button className="ghost" onClick={toggle} title="Toggle theme">{theme === "dark" ? "☀️" : "🌙"}</button>;
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

function AccountPanel({ me }: { me: { email: string; role: string } | null }) {
  const [current, setCurrent] = useState(""), [next, setNext] = useState(""), [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setMsg("Error: new passwords don't match");
    setBusy(true); setMsg("");
    const r = await fetch("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    const d = await r.json();
    setBusy(false);
    if (r.ok) { setMsg("Password updated."); setCurrent(""); setNext(""); setConfirm(""); }
    else setMsg("Error: " + d.error);
  }

  return (
    <div className="panel" style={{ maxWidth: 420 }}>
      <h3>Account</h3>
      <p className="hint">{me?.email} · <span className="badge">{me?.role}</span></p>
      <form onSubmit={submit}>
        <div className="field">
          <label>Current password</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="field">
          <label>New password</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
        </div>
        <div className="field">
          <label>Confirm new password</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {msg && <p className={msg.startsWith("Error") ? "error-text" : "hint"}>{msg}</p>}
        <button type="submit" disabled={busy} style={{ marginTop: 6 }}>{busy ? "Updating..." : "Update password"}</button>
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
  const [edits, setEdits] = useState<Record<number, any>>({});
  const [tab, setTab] = useState("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = async () => {
    const d = await (await fetch("/api/agent")).json();
    setLeads(d.leads || []); setStats(d.stats || {}); setSettings(d.settings || {});
  };
  const loadTeam = async () => {
    const r = await fetch("/api/users");
    if (r.ok) setTeam((await r.json()).users || []);
  };
  useEffect(() => {
    load();
    fetch("/api/auth").then((r) => r.json()).then((d) => { setMe(d.user || null); if (d.user?.role === "admin") loadTeam(); });
  }, []);
  const isAdmin = me?.role === "admin";

  async function go(label: string, body: any, loop = false) {
    setMsg(label + "...");
    let r: any;
    do {
      r = await post(body);
      if (r.error) return setMsg("Error: " + r.error);
      await load();
    } while (loop && r.done > 0);
    setMsg(label + " done " + JSON.stringify(r));
  }
  const ed = (id: number, k: string, v: string) => setEdits({ ...edits, [id]: { ...edits[id], [k]: v } });
  const get = (id: number, k: string, fallback: any) => (edits[id]?.[k] !== undefined ? edits[id][k] : fallback);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    window.location.href = "/login";
  }
  async function addTeamMember() {
    const r = await fetch("/api/users", {
      method: "POST",
      body: JSON.stringify({ email: get(-2, "email", ""), password: get(-2, "password", ""), role: get(-2, "role", "staff") }),
    });
    const d = await r.json();
    setMsg(r.ok ? "Team member added" : "Error: " + d.error);
    if (r.ok) { setEdits({ ...edits, [-2]: {} }); loadTeam(); }
  }
  async function removeTeamMember(id: number) {
    const r = await fetch("/api/users", { method: "DELETE", body: JSON.stringify({ id }) });
    const d = await r.json();
    setMsg(r.ok ? "Removed" : "Error: " + d.error);
    if (r.ok) loadTeam();
  }

  const paused = settings.manual_pause === "1" || (Number(settings.paused_until) > Date.now() / 1000);

  function go_to(key: string) { setTab(key); setDrawerOpen(false); }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${drawerOpen ? "open" : ""}`}>
        <div className="brand"><h1>IT Reliable</h1><span className="sub">Sales Agent</span></div>
        <nav>
          {NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => (
            <button key={n.key} className={`nav-item ${tab === n.key ? "active" : ""}`} onClick={() => go_to(n.key)}>
              <span>{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {me && <p className="hint">{me.email}<br /><span className="badge">{me.role}</span>{paused && <span className="badge danger" style={{ marginLeft: 6 }}>PAUSED</span>}</p>}
          <button className="alt" style={{ width: "100%" }} onClick={logout}>Logout</button>
        </div>
      </aside>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      <div className="main-col">
        <div className="topbar">
          <button className="hamburger" onClick={() => setDrawerOpen(true)}>☰</button>
          <div style={{ flex: 1 }} />
          {paused && <span className="badge danger">PAUSED</span>}
          <ThemeToggle />
        </div>

        <div className="wrap">
          {tab === "dashboard" && (<>
            <div className="stat-grid">
              <div className="stat-card"><div className="n">{stats.found ?? 0}</div><div className="l">Leads found</div></div>
              <div className="stat-card"><div className="n">{stats.firstEmailsSent ?? 0}</div><div className="l">Emails sent</div></div>
              <div className="stat-card"><div className="n">{stats.replied ?? 0}</div><div className="l">Replied ({stats.replyRate ?? 0}%)</div></div>
              <div className="stat-card"><div className="n">{stats.proposalsSent ?? 0}</div><div className="l">Proposals sent</div></div>
              <div className="stat-card"><div className="n">{stats.won ?? 0}</div><div className="l">Won</div></div>
              <div className="stat-card"><div className="n">{stats.lost ?? 0}</div><div className="l">Lost</div></div>
            </div>

            <div className="panel">
              <h3>Pipeline controls</h3>
              <div className="row">
                <input placeholder="Niche (e.g. plumber)" value={niche} onChange={(e) => setNiche(e.target.value)} />
                <input placeholder="City (e.g. Sydney)" value={city} onChange={(e) => setCity(e.target.value)} />
                <button onClick={() => go("Finding leads", { action: "find", niche, city })}>Find (manual)</button>
                <button onClick={() => go("Running autopilot", { action: "autopilot" })}>Run autopilot now</button>
              </div>
              <div className="row">
                <button className="alt" onClick={() => go("Auditing", { action: "audit" }, true)}>Audit pending</button>
                <button className="alt" onClick={() => go("Drafting", { action: "draft" }, true)}>Draft pending</button>
                <button className="alt" onClick={() => go("Checking replies", { action: "replies" })}>Check replies</button>
                {paused
                  ? <button onClick={() => go("Resuming", { action: "resume" })}>Resume sending</button>
                  : <button className="alt" onClick={() => go("Pausing", { action: "pause" })}>Pause sending</button>}
                <a href="/api/export"><button className="alt" type="button">Export CRM CSV</button></a>
              </div>
              <p className="msg">{msg}</p>
            </div>

            <div className="card">
              <table><thead><tr><th>Business</th><th>Email</th><th>Score</th><th>Status</th><th>Next action</th><th></th></tr></thead><tbody>
                {leads.map((l) => (<tr key={l.id}>
                  <td>{l.name}<br /><small className="hint">{l.city} {l.rating ? "★" + l.rating : ""}</small></td>
                  <td>{l.email || "-"}</td>
                  <td><ScorePill score={l.lead_score} /></td>
                  <td><StatusBadge status={l.status} /></td>
                  <td><small className="hint">{l.next_action || ""}</small></td>
                  <td>

                    {EMAIL_STATUSES.includes(l.status) && (<details className="action-card"><summary>Review &amp; send</summary>
                      <input defaultValue={l.draft_subject} onChange={(e) => ed(l.id, "subject", e.target.value)} />
                      <textarea rows={9} defaultValue={l.draft_body} onChange={(e) => ed(l.id, "body", e.target.value)} />
                      <div className="row">
                        <button disabled={!isAdmin} title={isAdmin ? "" : "Only an admin can send"}
                          onClick={() => go("Sending", { action: EMAIL_SEND_ACTION[l.status], id: l.id, subject: get(l.id, "subject", l.draft_subject), body: get(l.id, "body", l.draft_body) })}>Send</button>
                        <button className="alt" onClick={() => go("Skipping", { action: "skip", id: l.id })}>Skip</button>
                      </div></details>)}

                    {l.status === "interested" && (<details className="action-card"><summary>Collect needs &amp; draft proposal</summary>
                      <input placeholder="Pages (e.g. Home, About, Contact)" onChange={(e) => ed(l.id, "pages", e.target.value)} />
                      <input placeholder="Features (e.g. booking form, gallery)" onChange={(e) => ed(l.id, "features", e.target.value)} />
                      <input placeholder="Budget range" onChange={(e) => ed(l.id, "budget", e.target.value)} />
                      <input placeholder="Timeline" onChange={(e) => ed(l.id, "timeline", e.target.value)} />
                      <button onClick={() => go("Drafting proposal", { action: "draft_proposal", id: l.id, ...edits[l.id] })}>Draft proposal</button>
                    </details>)}

                    {l.status === "proposal_draft" && (<div className="action-card">
                      <input defaultValue={l.proposal_price} onChange={(e) => ed(l.id, "price", e.target.value)} placeholder="Price" />
                      <textarea rows={9} defaultValue={l.proposal_text} onChange={(e) => ed(l.id, "text", e.target.value)} />
                      <button disabled={!isAdmin} title={isAdmin ? "" : "Only an admin can send"}
                        onClick={() => go("Sending proposal", { action: "send_proposal", id: l.id, text: get(l.id, "text", l.proposal_text), price: get(l.id, "price", l.proposal_price) })}>Send proposal</button>
                    </div>)}

                    {l.status === "proposal_sent" && (<div className="row">
                      <button onClick={() => go("Marking won", { action: "won", id: l.id })}>Won</button>
                      <button className="alt" onClick={() => go("Marking lost", { action: "lost", id: l.id })}>Lost</button>
                    </div>)}

                  </td>
                </tr>))}
              </tbody></table>
            </div>
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
              <button onClick={() => go("Saving settings", { action: "save_settings", niches: get(-1, "niches", settings.autopilot_niches), cities: get(-1, "cities", settings.autopilot_cities) })}>Save</button>
              <p className="hint">The agent cycles through every niche x city pair on its own via "Run autopilot now" (Dashboard) and the daily cron - no need to type a niche/city each time.</p>
              <p className="msg">{msg}</p>
            </div>
          )}

          {tab === "team" && isAdmin && (
            <div className="panel">
              <h3>Team</h3>
              <table><thead><tr><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
                {team.map((u) => (<tr key={u.id}>
                  <td>{u.email}</td>
                  <td><span className="badge">{u.role}</span></td>
                  <td>{u.email !== me?.email && <button className="alt" onClick={() => removeTeamMember(u.id)}>Remove</button>}</td>
                </tr>))}
              </tbody></table>
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

          {tab === "account" && <AccountPanel me={me} />}
        </div>
      </div>
    </div>
  );
}
