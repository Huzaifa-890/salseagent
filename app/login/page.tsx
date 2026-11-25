"use client";
import { useEffect, useState } from "react";
import { Eye, EyeOff, AlertTriangle } from "lucide-react";

function PasswordField({ label, value, onChange, minLength, autoFocus }: { label: string; value: string; onChange: (v: string) => void; minLength?: number; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="password-field">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={minLength}
          autoFocus={autoFocus}
        />
        <button type="button" className="toggle-visibility" onClick={() => setShow((s) => !s)} tabIndex={-1} title={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

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
        <div className="login-logo">IR</div>
        <h1>IT Reliable</h1>
        <p className="hint">
          {needsSetup
            ? "First time here — create your admin account to get started."
            : "Sales Agent dashboard — sign in to continue."}
        </p>
        <div className="field">
          <label>Email</label>
          <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
        </div>
        <PasswordField
          label="Password"
          value={password}
          onChange={setPassword}
          minLength={needsSetup ? 8 : undefined}
        />
        {needsSetup && (
          <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} />
        )}
        {error && <p className="error-text"><AlertTriangle size={14} /> {error}</p>}
        <button type="submit" disabled={busy || !email || !password} style={{ width: "100%", marginTop: 10 }}>
          {busy && <span className="spinner" />}
          {busy ? "Please wait..." : needsSetup ? "Create admin account" : "Sign in"}
        </button>
        {needsSetup && <p className="hint" style={{ marginTop: 14, marginBottom: 0 }}>Use at least 8 characters. You can add teammates from the dashboard afterwards.</p>}
      </form>
    </div>
  );
}
