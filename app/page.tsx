"use client";
import { useEffect, useState } from "react";

function errorMessage(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown) => {
    if (value && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      const err = value as Error & { code?: unknown; cause?: unknown; errors?: unknown };
      const details = [err.message || err.name, typeof err.code === "string" ? `code ${err.code}` : ""].filter(Boolean);
      if (details.length) messages.push(details.join(" "));
      if (err.cause !== undefined) visit(err.cause);
      if (Array.isArray(err.errors)) err.errors.forEach(visit);
    } else if (value !== undefined && value !== null) {
      messages.push(String(value));
    }
  };
  visit(error);
  return messages.join("; ") || "Unknown error";
}

async function responseJson(response: Response) {
  const text = await response.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(text || `Request failed with HTTP ${response.status}`);
  }
  if (!response.ok && !data.error) {
    throw new Error(data.message || `Request failed with HTTP ${response.status}`);
  }
  return data;
}

const post = async (body: any) =>
  responseJson(await fetch("/api/agent", { method: "POST", body: JSON.stringify(body) }));

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  const [niche, setNiche] = useState(""), [city, setCity] = useState(""), [msg, setMsg] = useState("");
  const [edits, setEdits] = useState<Record<number, any>>({});
  const [csv, setCsv] = useState("");
  const [automationRunning, setAutomationRunning] = useState(false);
  const load = async () => {
    const data = await responseJson(await fetch("/api/agent"));
    if (data.error) throw new Error(data.error);
    setLeads(data);
  };
  useEffect(() => { load().catch((error) => setMsg(`Error: ${errorMessage(error)}`)); }, []);

  async function go(label: string, body: any, loop = false) {
    setMsg(label + "...");
    try {
      let r: any;
      do {
        r = await post(body);
        if (r.error) return setMsg("Error: " + r.error);
        await load();
      } while (loop && r.done > 0);
      if (body.action === "import") setMsg(`${label} done: ${r.added} lead(s) added`);
      else if (r.message) setMsg(`${label}: ${r.message}`);
      else setMsg(label + " done " + JSON.stringify(r));
    } catch (error) {
      setMsg(`Error: ${errorMessage(error)}`);
    }
  }
  async function loadCsv(file?: File) {
    if (!file) return;
    try {
      setCsv(await file.text());
    } catch (error) {
      setMsg(`Error: ${errorMessage(error)}`);
    }
  }
  function startAutomation() {
    if (automationRunning) return;
    setAutomationRunning(true);
    setMsg("Finding reliable business leads...");
    void (async () => {
      try {
        const found = await post({ action: "find", niche, city, limit: 10 });
        if (found.error) throw new Error(found.error);
        await load();
        let drafts = 0;
        while (true) {
          const result = await post({ action: "process" });
          if (result.error) throw new Error(result.error);
          if (!result.done) {
            setMsg(`Done: ${found.added} new lead(s), ${drafts} draft(s) ready. ${result.message}`);
            break;
          }
          if (result.stage === "draft") drafts++;
          await load();
          setMsg(`${result.stage} — ${result.name}`);
        }
      } catch (error) {
        setMsg(`Error: ${errorMessage(error)}`);
      } finally {
        setAutomationRunning(false);
      }
    })();
  }
  const ed = (id: number, k: string, v: string) => setEdits({ ...edits, [id]: { ...edits[id], [k]: v } });
  const stats = leads.reduce((a: any, l) => ((a[l.status] = (a[l.status] || 0) + 1), a), {});

  return (<>
    <h1>AI Sales Agent</h1>
    <div className="row">
      <input placeholder="Niche (e.g. dentist)" value={niche} onChange={(e) => setNiche(e.target.value)} />
      <input placeholder="City (e.g. Dubai)" value={city} onChange={(e) => setCity(e.target.value)} />
      <button onClick={() => go("Finding leads", { action: "find", niche, city })}>1. Find</button>
      <button onClick={() => go("Auditing", { action: "audit" }, true)}>2. Audit</button>
      <button onClick={() => go("Drafting", { action: "draft" }, true)}>3. Draft</button>
      <button onClick={startAutomation} disabled={automationRunning}>
        {automationRunning ? "Running..." : "Find, audit & draft"}
      </button>
      <button className="alt" onClick={() => go("Checking replies", { action: "replies" })}>Check replies</button>
    </div>
    <h2>Import leads from CSV</h2>
    <textarea
      rows={6}
      placeholder={"name,website,email,phone,city,niche\nExample Dental,https://example.com,contact@example.com,+1 202 555 0143,Sydney,dentist"}
      value={csv}
      onChange={(e) => setCsv(e.target.value)}
    />
    <small>One click finds, audits, and drafts eligible business leads. Review each draft before sending; no first email is sent automatically.</small>
    <div className="row">
      <input type="file" accept=".csv,text/csv" onChange={(e) => loadCsv(e.target.files?.[0])} />
      <button onClick={() => go("Importing CSV", { action: "import", csv })}>Import CSV</button>
    </div>
    <p className="msg">{msg} {Object.entries(stats).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
    <table><thead><tr><th>Business</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>
      {leads.map((l) => (<tr key={l.id}>
        <td>{l.name}<br /><small>{l.city} {l.rating ? "★" + l.rating : ""}</small></td>
        <td>{l.email || "-"}</td>
        <td><span className="tag">{l.status}</span></td>
        <td>{l.status === "drafted" && (<details><summary>Review &amp; send</summary>
          <input defaultValue={l.draft_subject} onChange={(e) => ed(l.id, "subject", e.target.value)} />
          <textarea rows={9} defaultValue={l.draft_body} onChange={(e) => ed(l.id, "body", e.target.value)} />
          <div className="row">
            <button onClick={() => go("Sending", { action: "send", id: l.id, ...edits[l.id] })}>Send</button>
            <button className="alt" onClick={() => go("Skipping", { action: "skip", id: l.id })}>Skip</button>
          </div></details>)}</td>
      </tr>))}
    </tbody></table>
  </>);
}
