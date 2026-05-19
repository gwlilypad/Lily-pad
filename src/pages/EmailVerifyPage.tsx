import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";

const NAVY  = "#0E1F40";
const GREEN = "#8DD63F";


export default function EmailVerifyPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "confirmed" | "recovery" | "error">("loading");
  const [newPassword, setNewPassword]     = useState("");
  const [confirmPw,   setConfirmPw]       = useState("");
  const [pwError,     setPwError]         = useState("");
  const [pwDone,      setPwDone]          = useState(false);
  const [pwLoading,   setPwLoading]       = useState(false);
  const [focusPw,     setFocusPw]         = useState(false);
  const [focusCpw,    setFocusCpw]        = useState(false);

  useEffect(() => {
    const hash   = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const type         = params.get("type");
    const accessToken  = params.get("access_token");
    const refreshToken = params.get("refresh_token") ?? "";

    if (!accessToken) {
      setStatus("error");
      return;
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) { setStatus("error"); return; }
        if (type === "recovery") {
          setStatus("recovery");
        } else {
          setStatus("confirmed");
          setTimeout(() => navigate("/find"), 3000);
        }
      })
      .catch(() => setStatus("error"));
  }, [navigate]);

  async function handlePasswordReset() {
    setPwError("");
    if (newPassword.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmPw) { setPwError("Passwords don't match."); return; }
    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPwLoading(false);
    if (error) { setPwError(error.message); return; }
    setPwDone(true);
    setTimeout(() => navigate("/find"), 2500);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "13px 14px", borderRadius: 12,
    background: "rgba(255,255,255,0.06)", color: "#fff",
    fontSize: 15, fontFamily: '"DM Sans", sans-serif',
    outline: "none", border: "1.5px solid rgba(255,255,255,0.12)",
    boxSizing: "border-box", transition: "border-color 0.15s",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: NAVY,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: '"DM Sans", sans-serif',
      padding: 24,
    }}>
      {/* ── LOADING ── */}
      {status === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
          <div style={{
            width: 40, height: 40,
            border: `3px solid rgba(141,214,63,0.25)`,
            borderTopColor: GREEN,
            borderRadius: "50%",
            animation: "lp-spin 0.8s linear infinite",
          }}/>
          <style>{`@keyframes lp-spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, margin: 0 }}>Verifying your email…</p>
        </div>
      )}

      {/* ── EMAIL CONFIRMED ── */}
      {status === "confirmed" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, maxWidth: 340, width: "100%", textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "rgba(141,214,63,0.15)",
            border: `2px solid rgba(141,214,63,0.40)`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <div>
            <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>Email confirmed!</p>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", margin: "8px 0 0", lineHeight: 1.5 }}>
              Welcome to Lily Pad. Taking you to the app…
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === 0 ? GREEN : "rgba(255,255,255,0.20)" }}/>
            ))}
          </div>
        </div>
      )}

      {/* ── PASSWORD RESET ── */}
      {status === "recovery" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 360, width: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: 4 }}>
            <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "16px 0 0", letterSpacing: "-0.02em" }}>
              {pwDone ? "Password updated!" : "Set a new password"}
            </p>
            <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.55)", margin: "6px 0 0", lineHeight: 1.5 }}>
              {pwDone ? "You're all set. Signing you in…" : "Choose a strong password for your account."}
            </p>
          </div>

          {!pwDone && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setPwError(""); }}
                onFocus={() => setFocusPw(true)}
                onBlur={() => setFocusPw(false)}
                style={{ ...inputStyle, borderColor: focusPw ? GREEN : pwError ? "#ef4444" : "rgba(255,255,255,0.12)" }}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPw}
                onChange={e => { setConfirmPw(e.target.value); setPwError(""); }}
                onFocus={() => setFocusCpw(true)}
                onBlur={() => setFocusCpw(false)}
                onKeyDown={e => { if (e.key === "Enter") handlePasswordReset(); }}
                style={{ ...inputStyle, borderColor: focusCpw ? GREEN : pwError ? "#ef4444" : "rgba(255,255,255,0.12)" }}
              />
              {pwError && (
                <p style={{ color: "#ef4444", fontSize: 12.5, fontWeight: 600, margin: 0 }}>{pwError}</p>
              )}
              <button
                onClick={handlePasswordReset}
                disabled={pwLoading}
                style={{
                  width: "100%", padding: "14px",
                  borderRadius: 100, border: "none",
                  background: GREEN, color: NAVY,
                  fontWeight: 800, fontSize: 15,
                  fontFamily: '"DM Sans", sans-serif',
                  cursor: pwLoading ? "not-allowed" : "pointer",
                  opacity: pwLoading ? 0.7 : 1,
                  letterSpacing: "0.01em",
                }}
              >
                {pwLoading ? "Updating…" : "Update password"}
              </button>
            </div>
          )}

          {pwDone && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "rgba(141,214,63,0.15)",
                border: `2px solid rgba(141,214,63,0.40)`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: i === 0 ? GREEN : "rgba(255,255,255,0.20)" }}/>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ERROR ── */}
      {status === "error" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, maxWidth: 340, width: "100%", textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "rgba(239,68,68,0.12)",
            border: "2px solid rgba(239,68,68,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </div>
          <div>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>Link expired or invalid</p>
            <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.55)", margin: "8px 0 0", lineHeight: 1.5 }}>
              This verification link has expired or has already been used. Request a new one from the sign-in page.
            </p>
          </div>
          <button
            onClick={() => navigate("/signin")}
            style={{
              padding: "13px 28px", borderRadius: 100, border: "none",
              background: GREEN, color: NAVY,
              fontWeight: 800, fontSize: 14,
              fontFamily: '"DM Sans", sans-serif', cursor: "pointer",
            }}
          >
            Back to sign in
          </button>
        </div>
      )}
    </div>
  );
}
