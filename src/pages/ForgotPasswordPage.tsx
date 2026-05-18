import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { PadSVG } from "@/components/PadSVG";

export default function ForgotPasswordPage() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    const { error: err } = await forgotPassword(email.trim());
    setLoading(false);
    if (err) setError(err);
    else setSent(true);
  }

  return (
    <div style={{
      minHeight: "100dvh", background: "#0E1F40",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px 20px",
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 36 }}>
          <PadSVG size={52} />
          {sent ? (
            <>
              <h1 style={{ color: "#fff", fontSize: 24, fontWeight: 800, margin: "16px 0 6px", letterSpacing: -0.5, textAlign: "center" }}>
                Check your inbox.
              </h1>
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: 0, textAlign: "center", lineHeight: 1.6 }}>
                We sent a reset link to <strong style={{ color: "rgba(255,255,255,0.7)" }}>{email}</strong>. Check your email and follow the link to set a new password.
              </p>
            </>
          ) : (
            <>
              <h1 style={{ color: "#fff", fontSize: 24, fontWeight: 800, margin: "16px 0 6px", letterSpacing: -0.5 }}>
                Reset password.
              </h1>
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: 0, textAlign: "center" }}>
                We'll send a reset link to your email.
              </p>
            </>
          )}
        </div>

        {!sent && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                style={{
                  width: "100%", padding: "15px 16px", borderRadius: 14,
                  border: "1.5px solid rgba(255,255,255,0.10)", background: "#08152F",
                  fontSize: 15, color: "#fff", fontFamily: '"DM Sans", sans-serif',
                  outline: "none", boxSizing: "border-box" as const,
                }}
              />
            </div>

            {error && (
              <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#f87171" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", padding: "16px 0", borderRadius: 100, background: "#8DD63F", border: "none", color: "#fff", fontSize: 15, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, fontFamily: '"DM Sans", sans-serif' }}
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <div style={{ marginTop: sent ? 32 : 20, textAlign: "center" }}>
          <Link to="/signin" style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", textDecoration: "none" }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
