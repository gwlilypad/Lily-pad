import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import lilypadLogo from "@/assets/lilypad-logo-full.png";

const NAVY  = "#0E1F40";
const GREEN = "#8DD63F";

type Role = "driver" | "host" | "both";
type Step = "welcome" | "form" | "thanks";

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

  const [step, setStep]         = useState<Step>(user ? "thanks" : "welcome");
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

  const roles: { id: Role; label: string }[] = [
    { id: "driver", label: "Driver" },
    { id: "host",   label: "Host"   },
    { id: "both",   label: "Both"   },
  ];

  return (
    <div style={{
      minHeight: "100dvh",
      background: NAVY,
      display: "flex",
      flexDirection: "column",
      fontFamily: '"DM Sans", sans-serif',
      overflowY: "auto",
    }}>

      {/* ── WELCOME ── */}
      {step === "welcome" && (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 32px",
          gap: 0,
          textAlign: "center",
        }}>
          <img
            src={lilypadLogo}
            alt="Lily Pad"
            style={{ width: 160, height: "auto", marginBottom: 36 }}
          />

          <p style={{
            fontSize: 13,
            fontWeight: 700,
            color: GREEN,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            margin: "0 0 10px",
          }}>
            Coming to Houston
          </p>

          <h1 style={{
            fontSize: 30,
            fontWeight: 800,
            color: "#fff",
            margin: "0 0 12px",
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
          }}>
            Park smarter.<br />Earn more.
          </h1>

          <p style={{
            fontSize: 15,
            color: "rgba(255,255,255,0.50)",
            margin: "0 0 48px",
            lineHeight: 1.6,
            maxWidth: 280,
          }}>
            Join the early access list and be first to find or list parking in your neighborhood.
          </p>

          <button
            onClick={() => setStep("form")}
            style={{
              width: "100%",
              maxWidth: 360,
              padding: "17px 20px",
              borderRadius: 50,
              border: "none",
              background: GREEN,
              color: NAVY,
              fontSize: 16,
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: '"DM Sans", sans-serif',
              letterSpacing: "-0.01em",
              boxShadow: `0 4px 20px ${GREEN}44`,
            }}
          >
            Sign up for Lily Pad
          </button>

          <p style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.25)",
            marginTop: 16,
          }}>
            Free to join · No credit card needed
          </p>
        </div>
      )}

      {/* ── FORM ── */}
      {step === "form" && (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "48px 28px 48px",
          maxWidth: 440,
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
          gap: 22,
        }}>
          {/* Logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
            <img src={lilypadLogo} alt="Lily Pad" style={{ width: 110, height: "auto" }} />
          </div>

          {/* Heading */}
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: "0 0 6px", letterSpacing: "-0.03em" }}>
              Join Early Access
            </h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", margin: 0, lineHeight: 1.5 }}>
              Create your account to secure your spot.
            </p>
          </div>

          {/* Role pills — small checkbox-style */}
          <div>
            <p style={{
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(255,255,255,0.40)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              margin: "0 0 9px",
            }}>
              I want to
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {roles.map(r => {
                const on = role === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRole(r.id)}
                    style={{
                      padding: "7px 15px",
                      borderRadius: 50,
                      border: `1.5px solid ${on ? GREEN : "rgba(255,255,255,0.15)"}`,
                      background: on ? `${GREEN}1A` : "transparent",
                      color: on ? GREEN : "rgba(255,255,255,0.55)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: '"DM Sans", sans-serif',
                      letterSpacing: "0.01em",
                      transition: "all 0.15s",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {on && (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <circle cx="6" cy="6" r="6" fill={GREEN}/>
                        <polyline points="3,6.2 5.2,8.4 9,4" stroke={NAVY} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <input
              type="text"
              placeholder="Full name"
              value={name}
              onChange={e => setName(e.target.value)}
              onFocus={() => setNameFocus(true)}
              onBlur={() => setNameFocus(false)}
              style={{ ...inputStyle, borderColor: nameFocus ? GREEN : "rgba(255,255,255,0.13)" }}
              autoComplete="name"
            />
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onFocus={() => setEmailFocus(true)}
              onBlur={() => setEmailFocus(false)}
              style={{ ...inputStyle, borderColor: emailFocus ? GREEN : "rgba(255,255,255,0.13)" }}
              autoComplete="email"
            />
            <input
              type="password"
              placeholder="Password (min 6 characters)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onFocus={() => setPwFocus(true)}
              onBlur={() => setPwFocus(false)}
              style={{ ...inputStyle, borderColor: pwFocus ? GREEN : "rgba(255,255,255,0.13)" }}
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: "11px 14px" }}>
              <p style={{ fontSize: 13, color: "#ef4444", margin: 0, fontWeight: 600 }}>{error}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: "100%",
              padding: "16px",
              borderRadius: 50,
              border: "none",
              background: loading ? "rgba(255,255,255,0.10)" : GREEN,
              color: loading ? "rgba(255,255,255,0.35)" : NAVY,
              fontSize: 16,
              fontWeight: 800,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: '"DM Sans", sans-serif',
              letterSpacing: "-0.01em",
              transition: "all 0.18s",
              boxShadow: loading ? "none" : `0 4px 18px ${GREEN}33`,
            }}
          >
            {loading ? "Creating account…" : "Request Early Access"}
          </button>

          <button
            onClick={() => setStep("welcome")}
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.30)", fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans", sans-serif', padding: 0, alignSelf: "center" }}
          >
            ← Back
          </button>

          <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.25)", textAlign: "center", margin: 0, lineHeight: 1.6 }}>
            By signing up you agree to our terms of service and privacy policy.
          </p>
        </div>
      )}

      {/* ── THANKS ── */}
      {step === "thanks" && (
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 32px",
          textAlign: "center",
          gap: 20,
        }}>
          <img src={lilypadLogo} alt="Lily Pad" style={{ width: 120, height: "auto", marginBottom: 8 }} />

          <div style={{ width: 64, height: 64, borderRadius: "50%", background: `${GREEN}1A`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>

          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: "#fff", margin: "0 0 10px", letterSpacing: "-0.03em", lineHeight: 1.2 }}>
              You're on the list!
            </h1>
            <p style={{ fontSize: 14.5, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.65, maxWidth: 300 }}>
              We'll reach out as soon as your Lily Pad account is ready.
            </p>
          </div>

          <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 16, padding: "16px 20px", width: "100%", maxWidth: 340, boxSizing: "border-box" }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "0 0 6px" }}>What's next</p>
            <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.60)", margin: 0, lineHeight: 1.6 }}>
              Our team reviews every application. You'll get an email when your account is activated.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
