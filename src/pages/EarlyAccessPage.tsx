import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { PadSVG } from "@/components/PadSVG";

const NAVY  = "#0E1F40";
const GREEN = "#8DD63F";

type Role = "driver" | "host" | "both";
type Step = "role" | "details" | "thanks";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: 14,
  border: "1.5px solid rgba(255,255,255,0.13)",
  background: "rgba(255,255,255,0.06)",
  fontSize: 16,
  color: "#fff",
  fontFamily: '"DM Sans", sans-serif',
  fontWeight: 400,
  outline: "none",
  boxSizing: "border-box",
};

export default function EarlyAccessPage() {
  const { user } = useAuth();

  const [step, setStep]         = useState<Step>(user ? "thanks" : "role");
  const [role, setRole]         = useState<Role | null>(null);
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [nameFocus, setNameFocus]   = useState(false);
  const [emailFocus, setEmailFocus] = useState(false);
  const [pwFocus, setPwFocus]       = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  async function handleSubmit() {
    if (!name.trim() || !email.trim() || password.length < 6) {
      setError(password.length < 6 ? "Password must be at least 6 characters." : "Please fill in all fields.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/early-access/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim().toLowerCase(), password, role: role || "driver" }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong. Please try again."); return; }
      setStep("thanks");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const roleCards: { id: Role; label: string; icon: React.ReactNode; desc: string }[] = [
    {
      id: "driver",
      label: "Driver",
      desc: "I need parking",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M5 17H3a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h1l2-4h12l2 4h1a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/>
          <circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>
        </svg>
      ),
    },
    {
      id: "host",
      label: "Host",
      desc: "I have parking to list",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      ),
    },
    {
      id: "both",
      label: "Both",
      desc: "I want to park & list",
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 12h8M12 8v8"/>
        </svg>
      ),
    },
  ];

  return (
    <div style={{ minHeight: "100dvh", background: NAVY, display: "flex", flexDirection: "column", fontFamily: '"DM Sans", sans-serif', overflowY: "auto" }}>
      {/* Header */}
      <div style={{ padding: "48px 24px 24px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <PadSVG size={32} />
        <div>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", margin: 0 }}>lily pad</p>
          <p style={{ color: "#fff", fontSize: 18, fontWeight: 800, margin: 0, letterSpacing: "-0.01em" }}>Early Access</p>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 24px 48px", maxWidth: 440, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

        {/* ── STEP: THANKS ── */}
        {step === "thanks" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 20, paddingTop: 32 }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: `${GREEN}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <p style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: "0 0 10px", letterSpacing: "-0.03em", lineHeight: 1.2 }}>
                You're on the list! 🎉
              </p>
              <p style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.6 }}>
                Thanks for signing up with Lily Pad! We will reach out to you soon when your account is active.
              </p>
            </div>
            <div style={{ marginTop: 12, background: "rgba(255,255,255,0.06)", borderRadius: 16, padding: "16px 20px", width: "100%", boxSizing: "border-box" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 6px" }}>What happens next</p>
              <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.70)", margin: 0, lineHeight: 1.6 }}>
                Our team reviews every application. You'll get an email as soon as your Lily Pad account is activated.
              </p>
            </div>
          </div>
        )}

        {/* ── STEP: ROLE ── */}
        {step === "role" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 8 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 6px" }}>Step 1 of 2</p>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.03em", lineHeight: 1.2 }}>
                How will you use Lily Pad?
              </h1>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", margin: "8px 0 0", lineHeight: 1.5 }}>
                Choose your role to help us set up your account. You can change this later.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {roleCards.map(rc => {
                const selected = role === rc.id;
                return (
                  <button
                    key={rc.id}
                    onClick={() => setRole(rc.id)}
                    style={{
                      background: selected ? `${GREEN}18` : "rgba(255,255,255,0.05)",
                      border: `2px solid ${selected ? GREEN : "rgba(255,255,255,0.10)"}`,
                      borderRadius: 18,
                      padding: "18px 20px",
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.18s",
                      color: selected ? GREEN : "rgba(255,255,255,0.80)",
                      width: "100%",
                    }}
                  >
                    <div style={{ width: 50, height: 50, borderRadius: 14, background: selected ? `${GREEN}22` : "rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {rc.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: "0 0 2px", letterSpacing: "-0.01em" }}>{rc.label}</p>
                      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: 0 }}>{rc.desc}</p>
                    </div>
                    {selected && (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" style={{ flexShrink: 0 }}>
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => { if (role) setStep("details"); }}
              disabled={!role}
              style={{
                marginTop: 8,
                width: "100%",
                padding: "16px",
                borderRadius: 16,
                border: "none",
                background: role ? GREEN : "rgba(255,255,255,0.10)",
                color: role ? NAVY : "rgba(255,255,255,0.35)",
                fontSize: 16,
                fontWeight: 800,
                cursor: role ? "pointer" : "not-allowed",
                fontFamily: '"DM Sans", sans-serif',
                letterSpacing: "-0.01em",
                transition: "all 0.18s",
              }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* ── STEP: DETAILS ── */}
        {step === "details" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20, paddingTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                onClick={() => setStep("role")}
                style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 2px" }}>Step 2 of 2</p>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>Create your account</h1>
              </div>
            </div>

            {role && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `${GREEN}18`, border: `1px solid ${GREEN}44`, borderRadius: 100, padding: "6px 14px", alignSelf: "flex-start" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: GREEN, textTransform: "capitalize" }}>
                  {role === "both" ? "Driver + Host" : role}
                </span>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Full name</label>
                <input
                  type="text"
                  placeholder="Jane Smith"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onFocus={() => setNameFocus(true)}
                  onBlur={() => setNameFocus(false)}
                  style={{ ...inputStyle, borderColor: nameFocus ? GREEN : "rgba(255,255,255,0.13)" }}
                  autoComplete="name"
                />
              </div>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Email</label>
                <input
                  type="email"
                  placeholder="you@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onFocus={() => setEmailFocus(true)}
                  onBlur={() => setEmailFocus(false)}
                  style={{ ...inputStyle, borderColor: emailFocus ? GREEN : "rgba(255,255,255,0.13)" }}
                  autoComplete="email"
                />
              </div>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>Password</label>
                <input
                  type="password"
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setPwFocus(true)}
                  onBlur={() => setPwFocus(false)}
                  style={{ ...inputStyle, borderColor: pwFocus ? GREEN : "rgba(255,255,255,0.13)" }}
                  autoComplete="new-password"
                />
              </div>
            </div>

            {error && (
              <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.30)", borderRadius: 12, padding: "12px 14px" }}>
                <p style={{ fontSize: 13, color: "#ef4444", margin: 0, fontWeight: 600 }}>{error}</p>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                width: "100%",
                padding: "16px",
                borderRadius: 16,
                border: "none",
                background: loading ? "rgba(255,255,255,0.10)" : GREEN,
                color: loading ? "rgba(255,255,255,0.35)" : NAVY,
                fontSize: 16,
                fontWeight: 800,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: '"DM Sans", sans-serif',
                letterSpacing: "-0.01em",
                transition: "all 0.18s",
              }}
            >
              {loading ? "Creating account…" : "Join Early Access"}
            </button>

            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", textAlign: "center", margin: 0, lineHeight: 1.6 }}>
              By signing up you agree to our terms of service and privacy policy.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
