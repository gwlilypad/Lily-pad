import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";

const GREEN = "#8DD63F";
const NAVY = "#0E1F40";

type Step = "email" | "otp" | "password" | "done";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [passwordFocus, setPasswordFocus] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em) { setError("Enter your email address."); return; }
    setError(""); setLoading(true);
    try {
      const { error: otpErr } = await supabase.auth.signInWithOtp({ email: em, options: { shouldCreateUser: false } });
      if (otpErr) { setError(otpErr.message || "Failed to send code. Check your email address."); return; }
      setStep("otp");
    } catch { setError("Network error. Try again."); }
    finally { setLoading(false); }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otp.trim()) { setError("Enter the code from your email."); return; }
    setError(""); setLoading(true);
    try {
      const { data, error: vErr } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: otp.trim(), type: "email" });
      if (vErr) { setError(vErr.message || "Invalid or expired code."); return; }
      setAccessToken(data?.session?.access_token ?? null);
      setStep("password");
    } catch { setError("Network error. Try again."); }
    finally { setLoading(false); }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.trim().length < 8) { setError("Password must be at least 8 characters."); return; }
    if (!accessToken) { setError("Session expired. Please go back and request a new code."); return; }
    setError(""); setLoading(true);
    try {
      const r = await fetch("/api/auth/update-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, password }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Failed to update password."); return; }
      setStep("done");
    } catch { setError("Network error. Try again."); }
    finally { setLoading(false); }
  }

  const inputBase: React.CSSProperties = {
    width: "100%", padding: "15px 16px", borderRadius: 14,
    border: "1.5px solid rgba(255,255,255,0.10)", background: "#08152F",
    fontSize: 15, color: "#fff", fontFamily: '"DM Sans", sans-serif',
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div style={{
      minHeight: "100dvh", background: NAVY,
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "24px 20px",
      fontFamily: '"DM Sans", sans-serif',
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 36 }}>
          <h1 style={{ color: "#fff", fontSize: 24, fontWeight: 800, margin: "16px 0 6px", letterSpacing: -0.5, textAlign: "center" }}>
            {step === "done" ? "Password updated" : step === "password" ? "Create new password" : step === "otp" ? "Enter your code" : "Reset password"}
          </h1>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: 0, textAlign: "center", lineHeight: 1.6 }}>
            {step === "done"
              ? "Your password has been changed. You can now sign in."
              : step === "password"
              ? ""
              : step === "otp"
              ? <>Code sent to <strong style={{ color: "rgba(255,255,255,0.75)" }}>{email}</strong></>
              : "We'll send a verification code to your email."}
          </p>
        </div>

        {step === "done" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
            <div style={{ background: "rgba(141,214,63,0.12)", border: `1px solid rgba(141,214,63,0.32)`, borderRadius: 14, padding: "16px 18px", width: "100%", textAlign: "center" }}>
              <p style={{ color: GREEN, fontWeight: 700, fontSize: 14, margin: 0 }}>All set!</p>
              <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>Your new password is ready. Sign in to continue.</p>
            </div>
            <Link to="/signin" style={{ width: "100%", display: "block", padding: "16px 0", borderRadius: 100, background: GREEN, border: "none", color: NAVY, fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans", sans-serif', textAlign: "center", textDecoration: "none" }}>
              Sign in →
            </Link>
          </div>
        ) : step === "password" ? (
          <form onSubmit={handleSetPassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 16px" }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Account email</p>
              <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", margin: "4px 0 0" }}>{email.trim().toLowerCase()}</p>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>New password</label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onFocus={() => setPasswordFocus(true)}
                onBlur={() => setPasswordFocus(false)}
                placeholder="Min. 8 characters"
                autoFocus
                autoComplete="new-password"
                style={{ ...inputBase, borderColor: error ? "#ef4444" : passwordFocus ? GREEN : "rgba(255,255,255,0.10)" }}
              />
            </div>
            {error && (
              <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#f87171" }}>{error}</div>
            )}
            <button type="submit" disabled={loading} style={{ width: "100%", padding: "16px 0", borderRadius: 100, background: loading ? "rgba(141,214,63,0.50)" : GREEN, border: "none", color: NAVY, fontSize: 15, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: '"DM Sans", sans-serif' }}>
              {loading ? "Updating…" : "Set new password"}
            </button>
          </form>
        ) : step === "otp" ? (
          <form onSubmit={handleVerifyOtp} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Verification code</label>
              <input
                type="text"
                inputMode="numeric"
                value={otp}
                onChange={e => { setOtp(e.target.value.replace(/\D/g, "")); setError(""); }}
                placeholder="Enter code"
                autoFocus
                style={{ ...inputBase, fontSize: 24, fontWeight: 700, textAlign: "center", letterSpacing: "0.22em", borderColor: error ? "#ef4444" : "rgba(255,255,255,0.10)" }}
              />
            </div>
            {error && (
              <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#f87171" }}>{error}</div>
            )}
            <button type="submit" disabled={loading} style={{ width: "100%", padding: "16px 0", borderRadius: 100, background: loading ? "rgba(141,214,63,0.50)" : GREEN, border: "none", color: NAVY, fontSize: 15, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: '"DM Sans", sans-serif' }}>
              {loading ? "Verifying…" : "Verify code"}
            </button>
            <button type="button" onClick={() => { setStep("email"); setOtp(""); setError(""); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.40)", fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans", sans-serif', textAlign: "center" }}>
              ← Change email
            </button>
          </form>
        ) : (
          <form onSubmit={handleSendCode} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 8 }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                placeholder="you@example.com"
                autoComplete="email"
                required
                autoFocus
                style={inputBase}
              />
            </div>
            {error && (
              <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "#f87171" }}>{error}</div>
            )}
            <button type="submit" disabled={loading} style={{ width: "100%", padding: "16px 0", borderRadius: 100, background: loading ? "rgba(141,214,63,0.50)" : GREEN, border: "none", color: NAVY, fontSize: 15, fontWeight: 800, cursor: loading ? "not-allowed" : "pointer", fontFamily: '"DM Sans", sans-serif' }}>
              {loading ? "Sending…" : "Send code"}
            </button>
          </form>
        )}

        <div style={{ marginTop: 24, textAlign: "center" }}>
          <Link to="/signin" style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", textDecoration: "none" }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
