"use client";
import { useEffect, useState } from "react";
const post = (b: any) => fetch("/api/agent", { method: "POST", body: JSON.stringify(b) }).then((r) => r.json());

export default function Home() {
  const [leads, setLeads] = useState<any[]>([]);
  const [niche, setNiche] = useState(""), [city, setCity] = useState(""), [msg, setMsg] = useState("");
  const [edits, setEdits] = useState<Record<number, any>>({});
  const load = async () => setLeads(await (await fetch("/api/agent")).json());
  useEffect(() => { load(); }, []);

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
  const stats = leads.reduce((a: any, l) => ((a[l.status] = (a[l.status] || 0) + 1), a), {});

  return (<>
    <h1>AI Sales Agent</h1>
    <div className="row">
      <input placeholder="Niche (e.g. dentist)" value={niche} onChange={(e) => setNiche(e.target.value)} />
      <input placeholder="City (e.g. Dubai)" value={city} onChange={(e) => setCity(e.target.value)} />
      <button onClick={() => go("Finding leads", { action: "find", niche, city })}>1. Find</button>
      <button onClick={() => go("Auditing", { action: "audit" }, true)}>2. Audit</button>
      <button onClick={() => go("Drafting", { action: "draft" }, true)}>3. Draft</button>
      <button className="alt" onClick={() => go("Checking replies", { action: "replies" })}>Check replies</button>
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
