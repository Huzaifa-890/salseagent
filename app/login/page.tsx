"use client";
import { useEffect, useState } from "react";

export default function Login() {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth").then((r) => r.json()).then((d) => { setNeedsSetup(!!d.needsSetup); setLoading(false); });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (needsSetup && password !== confirm) return setError("Passwords don't match");
    setBusy(true);
    const r = await fetch(needsSetup ? "/api/auth/setup" : "/api/auth", {
      method: "POST", body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    setBusy(false);
    if (r.ok) window.location.href = "/";
    else setError(d.error || "Something went wrong");
  }

  if (loading) return <div className="login-shell" />;

  return (
    <div className="login-shell">
      <form className="card login-card" onSubmit={submit}>
        <h1>IT Reliable</h1>
        <p className="hint">
          {needsSetup ? "First time here - create your admin account." : "Sales Agent dashboard - sign in to continue."}
        </p>
        <div className="field">
          <label>Email</label>
          <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={needsSetup ? 8 : undefined} />
        </div>
        {needsSetup && (
          <div className="field">
            <label>Confirm password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
        )}
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={busy || !email || !password} style={{ width: "100%", marginTop: 8 }}>
          {busy ? "Please wait..." : needsSetup ? "Create admin account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
