import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

const lightInput: React.CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: 14,
  border: "1.5px solid rgba(14,31,64,0.12)",
  background: "#f5f7fa",
  fontSize: 15,
  color: NAVY,
  fontFamily: '"DM Sans", sans-serif',
  fontWeight: 400,
  outline: "none",
  boxSizing: "border-box",
};

export default function SignInPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError("");
    const { error: err } = await signIn(email.trim(), password);
    setLoading(false);
    if (err) {
      setError(err.includes("Invalid") ? "Incorrect email or password." : err);
    } else {
      // Full page reload so Supabase reads the session from localStorage cleanly
      const redirect = searchParams.get("redirect");
      window.location.replace(redirect || "/find");
    }
  }

  return (
    <div style={{
      minHeight: "100dvh",
      background: NAVY,
      display: "flex",
      flexDirection: "column",
      fontFamily: '"DM Sans", sans-serif',
    }}>
      {/* ── Navy top section ── */}
      <div style={{
        flex: "0 0 auto",
        padding: "56px 28px 36px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        maxWidth: 480,
        width: "100%",
        margin: "0 auto",
        boxSizing: "border-box",
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.14em", textTransform: "uppercase", margin: "0 0 10px" }}>
          Lily Pad
        </p>
        <h1 style={{ color: "#fff", fontSize: 30, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.03em", lineHeight: 1.15 }}>
          Welcome back.
        </h1>
        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
          Sign in to your Lily Pad account.
        </p>
      </div>

      {/* ── White card bottom ── */}
      <div style={{
        flex: 1,
        background: "#fff",
        borderRadius: "28px 28px 0 0",
        padding: "32px 28px 48px",
        maxWidth: 480,
        width: "100%",
        margin: "0 auto",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              style={lightInput}
            />
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                style={{ ...lightInput, paddingRight: 48 }}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "rgba(14,31,64,0.35)", padding: 4 }}
              >
                {showPass
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>
          </div>

          {error && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "11px 14px", fontSize: 13, color: "#dc2626", fontWeight: 500 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              alignSelf: "center",
              padding: "12px 44px",
              borderRadius: 100,
              background: GREEN,
              border: "none",
              color: NAVY,
              fontSize: 14,
              fontWeight: 800,
              cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.7 : 1,
              fontFamily: '"DM Sans", sans-serif',
              letterSpacing: -0.1,
            }}
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <div style={{ textAlign: "center" }}>
            <Link to="/forgot" style={{ fontSize: 13, color: "rgba(14,31,64,0.45)", textDecoration: "none", fontWeight: 500 }}>
              Forgot password?
            </Link>
          </div>
        </form>

        <div style={{ marginTop: "auto", paddingTop: 28, textAlign: "center" }}>
          <Link to="/" style={{ fontSize: 13, color: "rgba(14,31,64,0.28)", textDecoration: "none", fontWeight: 500 }}>
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
