import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import lilypadLogo from "@/assets/lilypad-logo-full.png";
import { validatePassword } from "@/components/PasswordRequirements";

const NAVY  = "#0E1F40";
const GREEN = "#8DD63F";

type Step = "welcome" | "form" | "thanks";

interface EAQuestion {
  id   : string;
  text : string;
  type : "role" | "text" | "tel" | "email" | "password";
  placeholder?: string;
  hint?: string;
}

const EA_QUESTIONS: EAQuestion[] = [
  { id: "role",     text: "I'm signing up as a…",   type: "role"                                         },
  { id: "name",     text: "What's your name?",       type: "text",     placeholder: "Full name"           },
  { id: "phone",    text: "Your phone number?",      type: "tel",      placeholder: "(555) 000-0000"      },
  { id: "email",    text: "What's your email?",      type: "email",    placeholder: "you@email.com"       },
  { id: "password", text: "Create a password.",      type: "password", placeholder: "Create a strong password" },
];

/* ─── Role option ─────────────────────────────────────────────────────────── */
const ROLE_OPTIONS = [
  { id: "driver", label: "Driver" },
  { id: "host",   label: "Host"   },
];

export default function EarlyAccessPage() {
  const { user } = useAuth();

  const [step,     setStep]     = useState<Step>(user ? "thanks" : "welcome");
  const [cur,      setCur]      = useState(0);
  const [ans,      setAns]      = useState<Record<string, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [roles,    setRoles]    = useState<Set<string>>(new Set());
  const [animKey,  setAnimKey]  = useState(0);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  const q = EA_QUESTIONS[cur];
  const isPasswordStep = q.type === "password";
  const pwValidation = validatePassword({
    password  : isPasswordStep ? inputVal : "",
    email     : ans["email"],
    firstName : (ans["name"] || "").split(" ")[0],
    lastName  : (ans["name"] || "").split(" ").slice(1).join(" "),
  });

  /* focus input when question changes */
  useEffect(() => {
    if (step !== "form") return;
    if (q.type === "role") return;
    setInputVal(ans[q.id] ?? "");
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [cur, step]);

  /* ── advance ──────────────────────────────────────────────────────────── */
  function advance() {
    let value = "";

    if (q.type === "role") {
      if (roles.size === 0) { setError("Please select at least one."); return; }
      const arr = Array.from(roles);
      value = arr.length === 2 ? "both" : arr[0];
    } else {
      value = inputVal.trim();
      if (!value) { setError("This field is required."); return; }
      if (q.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setError("Please enter a valid email address."); return;
      }
      if (q.type === "password" && !pwValidation.allValid) {
        setError("Password doesn't meet the requirements below."); return;
      }
      if (q.type === "tel") {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 10) { setError("Please enter a valid phone number."); return; }
      }
    }

    setError("");
    const newAns = { ...ans, [q.id]: value };
    setAns(newAns);

    const next = cur + 1;
    if (next >= EA_QUESTIONS.length) {
      submit(newAns);
    } else {
      setInputVal(newAns[EA_QUESTIONS[next].id] ?? "");
      setCur(next);
      setAnimKey(k => k + 1);
    }
  }

  /* ── submit ───────────────────────────────────────────────────────────── */
  async function submit(finalAns: Record<string, string>) {
    setLoading(true);
    try {
      const res = await fetch("/api/early-access/signup", {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({
          name    : finalAns["name"]     || "",
          email   : finalAns["email"]    || "",
          password: finalAns["password"] || "",
          phone   : finalAns["phone"]    || "",
          role    : finalAns["role"]     || "driver",
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong. Try again."); return; }
      setStep("thanks");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  /* ── go back to edit a previous answer ──────────────────────────────── */
  function goEdit(idx: number) {
    setError("");
    setCur(idx);
    setAnimKey(k => k + 1);
    const prev = EA_QUESTIONS[idx];
    setInputVal(prev.type === "password" ? "" : (ans[prev.id] ?? ""));
  }

  /* ── formatted display value for answer cards ─────────────────────────  */
  function displayVal(q: EAQuestion) {
    if (q.type === "password") return "••••••••";
    const v = ans[q.id] ?? "";
    if (q.id === "role") return v.charAt(0).toUpperCase() + v.slice(1);
    return v;
  }

  const canAdvance =
    q.type === "role"     ? roles.size > 0 :
    isPasswordStep        ? pwValidation.allValid :
                            inputVal.trim().length > 0;

  /* ════════════════════════════════════════════════════════════════════════
     WELCOME
  ═══════════════════════════════════════════════════════════════════════════ */
  if (step === "welcome") {
    return (
      <div style={outerStyle}>
        <style>{animCSS}</style>

        {/* top half — logo centered */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "24px 0 0", overflow: "hidden",
        }}>
          <img
            src={lilypadLogo}
            alt="Lily Pad"
            style={{ width: "160%", maxWidth: 700, height: "auto", transform: "translateY(4%)" }}
          />
        </div>

        {/* bottom half — tagline + CTA */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "0 32px 52px", textAlign: "center", gap: 0,
        }}>
          <h1 style={{
            fontSize: 26, fontWeight: 800, color: "#fff",
            margin: "0 0 36px", letterSpacing: "-0.025em", lineHeight: 1.25, maxWidth: 300,
          }}>
            Lily Pad. Your neighbor<br />saved you a spot.
          </h1>
          <button onClick={() => setStep("form")} style={greenBtnStyle}>
            Sign up for Lily Pad
          </button>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.22)", marginTop: 14 }}>
            Free to join · No credit card needed
          </p>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════════════
     THANKS
  ═══════════════════════════════════════════════════════════════════════════ */
  if (step === "thanks") {
    return (
      <div style={outerStyle}>
        <style>{animCSS}</style>
        <div style={centeredColStyle}>
          <img src={lilypadLogo} alt="Lily Pad" style={{ width: 175, height: "auto", marginBottom: 16 }} />
          <div style={{
            width: 60, height: 60, borderRadius: "50%",
            background: `${GREEN}1A`, display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div style={{ marginTop: 8 }}>
            <h1 style={{
              fontSize: 26, fontWeight: 800, color: "#fff",
              margin: "0 0 10px", letterSpacing: "-0.03em", lineHeight: 1.2,
            }}>
              You're on the list!
            </h1>
            <p style={{
              fontSize: 14.5, color: "rgba(255,255,255,0.50)",
              margin: 0, lineHeight: 1.65, maxWidth: 300,
            }}>
              We'll reach out as soon as your Lily Pad account is ready.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════════════
     FORM — one question at a time
  ═══════════════════════════════════════════════════════════════════════════ */
  const answeredBefore = EA_QUESTIONS.slice(0, cur).filter(qq => ans[qq.id]);

  return (
    <div style={outerStyle}>
      <style>{animCSS}</style>

      {/* logo — same large centered style as welcome, plus back button overlay */}
      <div style={{ position: "relative", flexShrink: 0, overflow: "hidden", height: 160 }}>
        <img
          src={lilypadLogo}
          alt="Lily Pad"
          style={{
            width: "160%", maxWidth: 700, height: "auto",
            position: "absolute", left: "50%", top: "50%",
            transform: "translate(-50%, -40%)",
          }}
        />
        {/* back button — top-left */}
        <button
          onClick={() => {
            if (cur === 0) { setStep("welcome"); }
            else { setCur(c => c - 1); setAnimKey(k => k + 1); setError(""); setInputVal(ans[EA_QUESTIONS[cur - 1].id] ?? ""); }
          }}
          style={{
            position: "absolute", top: 18, left: 18,
            background: "rgba(255,255,255,0.10)", border: "none",
            borderRadius: 50, width: 36, height: 36,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: "#fff", fontSize: 16,
          }}
        >
          ←
        </button>
      </div>

      {/* centered question zone */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "0 28px 12px", width: "100%", boxSizing: "border-box",
      }}>

        {/* animated question card */}
        <div
          key={animKey}
          style={{
            width: "100%", maxWidth: 400,
            display: "flex", flexDirection: "column", alignItems: "center",
            textAlign: "center", animation: "ea-slide-in 0.28s cubic-bezier(.22,.68,0,1.2) both",
          }}
        >
          {/* step label */}
          <p style={{
            fontSize: 10, fontWeight: 400, letterSpacing: "0.18em",
            color: "rgba(255,255,255,0.30)", textTransform: "uppercase", margin: "0 0 14px",
          }}>
            {cur + 1} of {EA_QUESTIONS.length}
          </p>

          {/* question text */}
          <p style={{
            fontSize: 24, fontWeight: 200, color: "#fff",
            lineHeight: 1.3, margin: "0 0 28px", letterSpacing: "-0.01em",
          }}>
            {q.text}
          </p>

          {/* ROLE pill chooser */}
          {q.type === "role" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 10 }}>
              {ROLE_OPTIONS.map(r => {
                const on = roles.has(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setError("");
                      setRoles(prev => {
                        const n = new Set(prev);
                        n.has(r.id) ? n.delete(r.id) : n.add(r.id);
                        return n;
                      });
                    }}
                    style={{
                      padding: "10px 28px", borderRadius: 100,
                      border: `1.5px solid ${on ? GREEN : "rgba(255,255,255,0.20)"}`,
                      background: on ? GREEN : "rgba(255,255,255,0.06)",
                      color: on ? NAVY : "rgba(255,255,255,0.60)",
                      fontSize: 15, fontWeight: on ? 700 : 400,
                      cursor: "pointer", fontFamily: '"DM Sans", sans-serif',
                      transition: "all 0.16s cubic-bezier(.4,0,.2,1)",
                      boxShadow: on ? `0 2px 14px ${GREEN}33` : "none",
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            <p style={{
              fontSize: 11.5, color: "rgba(255,255,255,0.32)",
              margin: 0, fontStyle: "italic",
            }}>
              You can select both!
            </p>
            </div>
          )}

          {/* TEXT / TEL / EMAIL / PASSWORD pill input */}
          {q.type !== "role" && (
            <div style={{ width: "100%" }}>
              <div className="pill-wrap">
                <input
                  ref={inputRef}
                  className="pill-input"
                  type={q.type}
                  placeholder={q.placeholder}
                  value={inputVal}
                  onChange={e => { setInputVal(e.target.value); setError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") advance(); }}
                  autoComplete={
                    q.type === "email"    ? "email"        :
                    q.type === "password" ? "new-password" :
                    q.type === "tel"      ? "tel"          : "name"
                  }
                  inputMode={q.type === "tel" ? "tel" : undefined}
                />
              </div>
              {q.hint && (
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.30)", marginTop: 8 }}>
                  {q.hint}
                </p>
              )}
              {/* password requirements — dark-adapted */}
              {isPasswordStep && inputVal.length > 0 && (
                <div style={{
                  width: "100%", marginTop: 14, padding: "12px 14px",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  textAlign: "left",
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.28)",
                    letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10,
                  }}>
                    Password must include
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {([
                      { key: "length",      label: "At least 8 characters"  },
                      { key: "capital",     label: "1 capital letter (A–Z)" },
                      { key: "number",      label: "1 number (0–9)"          },
                      { key: "notIdentity", label: "Not your name or email"  },
                    ] as const).map(r => {
                      const ok = pwValidation[r.key];
                      return (
                        <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                            background: ok ? GREEN : "rgba(255,255,255,0.10)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            transition: "background 0.18s",
                          }}>
                            {ok ? (
                              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                            ) : (
                              <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(255,255,255,0.35)" }} />
                            )}
                          </div>
                          <span style={{
                            fontSize: 12.5,
                            fontWeight: ok ? 600 : 400,
                            color: ok ? "#fff" : "rgba(255,255,255,0.45)",
                            transition: "color 0.18s",
                          }}>
                            {r.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* error */}
          {error && (
            <p style={{
              fontSize: 12.5, color: "#ff7070", fontWeight: 600,
              margin: "10px 0 0", textAlign: "center",
            }}>
              {error}
            </p>
          )}

          {/* continue CTA — appears once input has value */}
          {canAdvance && (
            <div style={{
              width: "100%", paddingTop: 18,
              animation: "ea-fade-in 0.18s ease both",
            }}>
              <button
                onClick={advance}
                disabled={loading}
                style={{
                  width: "100%", padding: "15px 0",
                  background: loading ? "rgba(255,255,255,0.12)" : "#fff",
                  color: loading ? "rgba(255,255,255,0.30)" : NAVY,
                  fontSize: 15, fontWeight: 700,
                  border: "none", borderRadius: 100, cursor: loading ? "not-allowed" : "pointer",
                  fontFamily: '"DM Sans", sans-serif', transition: "background 0.15s",
                }}
              >
                {loading
                  ? "Creating account…"
                  : cur === EA_QUESTIONS.length - 1
                    ? "Request Early Access"
                    : "Continue"}
              </button>
            </div>
          )}
        </div>

        {/* previously answered — stack below as answer cards */}
        {answeredBefore.length > 0 && (
          <div style={{
            width: "100%", maxWidth: 400, marginTop: 28,
            display: "flex", flexDirection: "column", gap: 6,
          }}>
            {answeredBefore.map((qq, i) => (
              <div
                key={qq.id}
                onClick={() => goEdit(i)}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "0.5px solid rgba(255,255,255,0.10)",
                  borderRadius: 12, padding: "10px 14px",
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 600, letterSpacing: "0.14em",
                    color: "rgba(255,255,255,0.30)", textTransform: "uppercase",
                  }}>
                    {qq.id}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 400, color: "#fff" }}>
                    {displayVal(qq)}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", flexShrink: 0 }}>Edit</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared styles ──────────────────────────────────────────────────────── */
const outerStyle: React.CSSProperties = {
  minHeight: "100dvh", background: NAVY,
  display: "flex", flexDirection: "column",
  fontFamily: '"DM Sans", sans-serif', overflowY: "auto",
};

const centeredColStyle: React.CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center",
  padding: "48px 32px", textAlign: "center", gap: 0,
};

const greenBtnStyle: React.CSSProperties = {
  width: "100%", maxWidth: 340,
  padding: "17px 20px", borderRadius: 50,
  border: "none", background: GREEN, color: NAVY,
  fontSize: 16, fontWeight: 800, cursor: "pointer",
  fontFamily: '"DM Sans", sans-serif', letterSpacing: "-0.01em",
  boxShadow: `0 4px 22px ${GREEN}44`,
};

/* ── Keyframe CSS injected into <head> ──────────────────────────────────── */
const animCSS = `
@keyframes ea-slide-in {
  from { opacity: 0; transform: translateY(22px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes ea-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0);   }
}
`;
