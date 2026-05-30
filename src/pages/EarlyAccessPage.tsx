import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import lilypadLogo from "@/assets/lilypad-logo-full.png";

const NAVY  = "#0E1F40";
const GREEN = "#8DD63F";

type Role = "driver" | "host" | "both";
type Step = "welcome" | "form" | "thanks";

export default function EarlyAccessPage() {
  const { user } = useAuth();

  const [step, setStep]       = useState<Step>(user ? "thanks" : "welcome");
  const [roles, setRoles]     = useState<Set<Role>>(new Set());
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  function toggleRole(r: Role) {
    setRoles(prev => {
      const next = new Set(prev);
      next.has(r) ? next.delete(r) : next.add(r);
      return next;
    });
  }

  function roleString() {
    if (roles.size === 0) return "driver";
    const arr = Array.from(roles);
    if (arr.includes("both") || (arr.includes("driver") && arr.includes("host"))) return "both";
    return arr[0];
  }

  async function handleSubmit() {
    setError("");
    if (!name.trim())           { setError("Please enter your name.");                    return; }
    if (!email.trim())          { setError("Please enter your email.");                   return; }
    if (password.length < 6)    { setError("Password must be at least 6 characters.");   return; }
    setLoading(true);
    try {
      const res = await fetch("/api/early-access/signup", {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({
          name    : name.trim(),
          email   : email.trim().toLowerCase(),
          password,
          role    : roleString(),
        }),
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

  const roleOptions: { id: Role; label: string }[] = [
    { id: "driver", label: "Driver"  },
    { id: "host",   label: "Host"    },
    { id: "both",   label: "Both"    },
  ];

  return (
    <div style={{
      minHeight  : "100dvh",
      background : NAVY,
      display    : "flex",
      flexDirection: "column",
      fontFamily : '"DM Sans", sans-serif',
      overflowY  : "auto",
    }}>

      {/* ── WELCOME ─────────────────────────────────────────────────── */}
      {step === "welcome" && (
        <div style={{
          flex           : 1,
          display        : "flex",
          flexDirection  : "column",
          alignItems     : "center",
          justifyContent : "center",
          padding        : "48px 32px",
          textAlign      : "center",
          gap            : 0,
        }}>
          <img
            src={lilypadLogo}
            alt="Lily Pad"
            style={{ width: 220, height: "auto", marginBottom: 36 }}
          />

          <h1 style={{
            fontSize     : 26,
            fontWeight   : 800,
            color        : "#fff",
            margin       : "0 0 44px",
            letterSpacing: "-0.025em",
            lineHeight   : 1.25,
            maxWidth     : 300,
          }}>
            Lily Pad. Your neighbor<br />saved you a spot.
          </h1>

          <button
            onClick={() => setStep("form")}
            style={{
              width        : "100%",
              maxWidth     : 340,
              padding      : "17px 20px",
              borderRadius : 50,
              border       : "none",
              background   : GREEN,
              color        : NAVY,
              fontSize     : 16,
              fontWeight   : 800,
              cursor       : "pointer",
              fontFamily   : '"DM Sans", sans-serif',
              letterSpacing: "-0.01em",
              boxShadow    : `0 4px 22px ${GREEN}44`,
            }}
          >
            Sign up for Lily Pad
          </button>

          <p style={{
            fontSize : 12,
            color    : "rgba(255,255,255,0.22)",
            marginTop: 14,
          }}>
            Free to join · No credit card needed
          </p>
        </div>
      )}

      {/* ── FORM ─────────────────────────────────────────────────────── */}
      {step === "form" && (
        <div style={{
          flex         : 1,
          display      : "flex",
          flexDirection: "column",
          padding      : "44px 28px 52px",
          maxWidth     : 440,
          width        : "100%",
          margin       : "0 auto",
          boxSizing    : "border-box",
          gap          : 24,
        }}>
          {/* Logo */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <img src={lilypadLogo} alt="Lily Pad" style={{ width: 110, height: "auto" }} />
          </div>

          {/* Heading */}
          <div>
            <h1 style={{
              fontSize     : 24,
              fontWeight   : 800,
              color        : "#fff",
              margin       : "0 0 5px",
              letterSpacing: "-0.03em",
            }}>
              Join Early Access
            </h1>
            <p style={{
              fontSize : 14,
              color    : "rgba(255,255,255,0.40)",
              margin   : 0,
              lineHeight: 1.5,
            }}>
              Create your account to secure your spot.
            </p>
          </div>

          {/* Role pills — multi-select, all three toggleable */}
          <div>
            <p style={{
              fontSize     : 11,
              fontWeight   : 700,
              color        : "rgba(255,255,255,0.35)",
              letterSpacing: "0.11em",
              textTransform: "uppercase",
              margin       : "0 0 10px",
            }}>
              I want to
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              {roleOptions.map(r => {
                const on = roles.has(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => toggleRole(r.id)}
                    style={{
                      padding      : "8px 18px",
                      borderRadius : 100,
                      border       : `1.5px solid ${on ? GREEN : "rgba(255,255,255,0.18)"}`,
                      background   : on ? GREEN : "rgba(255,255,255,0.05)",
                      color        : on ? NAVY : "rgba(255,255,255,0.55)",
                      fontSize     : 13,
                      fontWeight   : on ? 700 : 500,
                      cursor       : "pointer",
                      fontFamily   : '"DM Sans", sans-serif',
                      letterSpacing: on ? "-0.01em" : "0",
                      transition   : "all 0.16s cubic-bezier(.4,0,.2,1)",
                      boxShadow    : on ? `0 2px 12px ${GREEN}33` : "none",
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pill inputs — same white pill style as main site */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="pill-wrap" style={{ background: "#fff" }}>
              <input
                className="pill-input"
                type="text"
                placeholder="Full name"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && document.getElementById("ea-email")?.focus()}
                autoComplete="name"
                style={{ color: NAVY }}
              />
            </div>

            <div className="pill-wrap" style={{ background: "#fff" }}>
              <input
                id="ea-email"
                className="pill-input"
                type="email"
                placeholder="Email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && document.getElementById("ea-pw")?.focus()}
                autoComplete="email"
                style={{ color: NAVY }}
              />
            </div>

            <div className="pill-wrap" style={{ background: "#fff" }}>
              <input
                id="ea-pw"
                className="pill-input"
                type="password"
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
                autoComplete="new-password"
                style={{ color: NAVY }}
              />
            </div>
          </div>

          {error && (
            <div style={{
              background  : "rgba(239,68,68,0.10)",
              border      : "1px solid rgba(239,68,68,0.25)",
              borderRadius: 12,
              padding     : "11px 14px",
            }}>
              <p style={{ fontSize: 13, color: "#ef4444", margin: 0, fontWeight: 600 }}>{error}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width        : "100%",
              padding      : "16px",
              borderRadius : 50,
              border       : "none",
              background   : loading ? "rgba(255,255,255,0.10)" : GREEN,
              color        : loading ? "rgba(255,255,255,0.35)" : NAVY,
              fontSize     : 16,
              fontWeight   : 800,
              cursor       : loading ? "not-allowed" : "pointer",
              fontFamily   : '"DM Sans", sans-serif',
              letterSpacing: "-0.01em",
              transition   : "all 0.18s",
              boxShadow    : loading ? "none" : `0 4px 18px ${GREEN}33`,
            }}
          >
            {loading ? "Creating account…" : "Request Early Access"}
          </button>

          <button
            onClick={() => setStep("welcome")}
            style={{
              background: "none",
              border    : "none",
              color     : "rgba(255,255,255,0.28)",
              fontSize  : 13,
              cursor    : "pointer",
              fontFamily: '"DM Sans", sans-serif',
              padding   : 0,
              alignSelf : "center",
            }}
          >
            ← Back
          </button>

          <p style={{
            fontSize  : 11.5,
            color     : "rgba(255,255,255,0.22)",
            textAlign : "center",
            margin    : 0,
            lineHeight: 1.6,
          }}>
            By signing up you agree to our terms of service and privacy policy.
          </p>
        </div>
      )}

      {/* ── THANKS ───────────────────────────────────────────────────── */}
      {step === "thanks" && (
        <div style={{
          flex           : 1,
          display        : "flex",
          flexDirection  : "column",
          alignItems     : "center",
          justifyContent : "center",
          padding        : "48px 32px",
          textAlign      : "center",
          gap            : 20,
        }}>
          <img
            src={lilypadLogo}
            alt="Lily Pad"
            style={{ width: 120, height: "auto", marginBottom: 8 }}
          />

          <div style={{
            width          : 60,
            height         : 60,
            borderRadius   : "50%",
            background     : `${GREEN}1A`,
            display        : "flex",
            alignItems     : "center",
            justifyContent : "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>

          <div>
            <h1 style={{
              fontSize     : 26,
              fontWeight   : 800,
              color        : "#fff",
              margin       : "0 0 10px",
              letterSpacing: "-0.03em",
              lineHeight   : 1.2,
            }}>
              You're on the list!
            </h1>
            <p style={{
              fontSize  : 14.5,
              color     : "rgba(255,255,255,0.50)",
              margin    : 0,
              lineHeight: 1.65,
              maxWidth  : 300,
            }}>
              We'll reach out as soon as your Lily Pad account is ready.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
