import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";
import PasswordRequirements, { validatePassword } from "@/components/PasswordRequirements";

const DR_QUESTIONS = [
  { label: "Legal first name", text: "What's your legal first name?", type: "text", placeholder: "e.g. Jordan", hint: "As it appears on your ID" },
  { label: "Legal last name", text: "And your legal last name?", type: "text", placeholder: "e.g. Smith", hint: "As it appears on your ID" },
  { label: "Email", text: "What's your email?", type: "email", placeholder: "you@email.com", hint: "We'll send booking receipts here" },
  { label: "Phone", text: "Your phone number?", type: "tel", placeholder: "(555) 000-0000", hint: "" },
  { label: "Vehicle", text: "What do you drive?", type: "text", placeholder: "e.g. 2022 Honda Civic", hint: "Helps hosts verify the right car" },
  { label: "Password", text: "Create a password.", type: "password", placeholder: "Create a strong password", hint: "" },
];

function validateField(label: string, type: string, value: string): string {
  const v = value.trim();
  if (type === "text" && label.toLowerCase().includes("name")) {
    if (v.replace(/[^a-zA-Z]/g, "").length < 2) return "Please enter your legal name (at least 2 letters).";
  }
  if (type === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return "Please enter a valid email address.";
  }
  if (type === "tel") {
    if (v.replace(/\D/g, "").length < 10) return "Please enter your full 10-digit phone number.";
  }
  return "";
}

const DR_PW_IDX = 5;

export default function DriverSignupPage() {
  const { goTo, setState: setAppState } = useApp();
  const { signUp, verifyOtp } = useAuth();
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [otpDigits, setOtpDigits] = useState(["","","","","",""]);
  const [otpError, setOtpError]   = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = DR_QUESTIONS[cur];
  const progress = Math.round((cur / DR_QUESTIONS.length) * 100);

  useEffect(() => {
    setInputVal(ans[cur] || "");
    setFieldError("");
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [cur]);

  const isPwStep = cur === DR_PW_IDX;
  const pwValidation = validatePassword({
    password: isPwStep ? inputVal : "",
    email: ans[2], firstName: ans[0], lastName: ans[1],
  });
  const canAdvance = inputVal.trim().length > 0 && !fieldError && (!isPwStep || pwValidation.allValid);

  function advance() {
    const v = inputVal.trim();
    if (!v) return;
    if (isPwStep && !pwValidation.allValid) return;
    const err = validateField(q.label, q.type, v);
    if (err) { setFieldError(err); return; }
    const newAns = { ...ans, [cur]: v };
    setAns(newAns);
    const next = cur + 1;
    if (next >= DR_QUESTIONS.length) {
      setDone(true);
      setAppState(prev => ({ ...prev, drAns: newAns }));
    } else {
      setCur(next);
      setInputVal(newAns[next] || "");
    }
  }

  if (checkEmail) {
    const otpCode = otpDigits.join("");
    const otpComplete = otpCode.length === 6;
    return (
      <div className="page active" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: "40px 28px", textAlign: "center" }}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", background: "rgba(141,214,63,0.12)", border: "2px solid rgba(141,214,63,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
        </div>
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, color: "#0E1F40", margin: 0, letterSpacing: "-0.02em" }}>Enter your code</p>
          <p style={{ fontSize: 14, color: "rgba(14,31,64,0.55)", margin: "10px 0 0", lineHeight: 1.55 }}>
            We emailed a 6-digit code to<br/>
            <strong style={{ color: "#0E1F40" }}>{ans[2]}</strong>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {[0,1,2,3,4,5].map(i => (
            <input
              key={i}
              ref={el => { otpRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={otpDigits[i]}
              onChange={e => {
                const digit = e.target.value.replace(/\D/g, "").slice(-1);
                const next = [...otpDigits]; next[i] = digit; setOtpDigits(next); setOtpError("");
                if (digit && i < 5) otpRefs.current[i + 1]?.focus();
              }}
              onKeyDown={e => {
                if (e.key === "Backspace" && !otpDigits[i] && i > 0) otpRefs.current[i - 1]?.focus();
              }}
              onPaste={i === 0 ? (e) => {
                e.preventDefault();
                const txt = e.clipboardData.getData("text").replace(/\D/g,"").slice(0,6);
                const next = [...otpDigits];
                txt.split("").forEach((d,j) => { next[j] = d; });
                setOtpDigits(next); setOtpError("");
                otpRefs.current[Math.min(txt.length, 5)]?.focus();
              } : undefined}
              style={{
                width: 42, height: 52, textAlign: "center", fontSize: 22, fontWeight: 700,
                color: "#0E1F40", borderRadius: 10, outline: "none",
                border: `2px solid ${otpDigits[i] ? "#0E1F40" : "rgba(14,31,64,0.15)"}`,
                background: otpDigits[i] ? "#F4F7FA" : "#fff",
                fontFamily: "'DM Sans', sans-serif", transition: "border-color 0.15s",
              }}
            />
          ))}
        </div>
        {otpError && <p style={{ fontSize: 12.5, color: "#ef4444", margin: 0, fontWeight: 600 }}>{otpError}</p>}
        <button
          disabled={!otpComplete || otpLoading}
          onClick={async () => {
            setOtpLoading(true); setOtpError("");
            const result = await verifyOtp(ans[2] || "", otpCode);
            setOtpLoading(false);
            if (result.error) {
              setOtpError(result.error.toLowerCase().includes("expired") ? "Code expired. Request a new one." : "Invalid code. Try again.");
              return;
            }
            goTo("find");
          }}
          style={{ width: "100%", padding: "14px 0", border: "none", borderRadius: 100, fontSize: 15, fontWeight: 800, fontFamily: "'DM Sans', sans-serif", transition: "background 0.15s", background: !otpComplete || otpLoading ? "rgba(14,31,64,0.12)" : "#8DD63F", color: !otpComplete || otpLoading ? "rgba(14,31,64,0.30)" : "#0E1F40", cursor: !otpComplete || otpLoading ? "default" : "pointer" }}
        >
          {otpLoading ? "Verifying…" : "Verify account"}
        </button>
        <p style={{ fontSize: 11.5, color: "rgba(14,31,64,0.35)", margin: 0 }}>Didn't get it? Check your spam folder.</p>
      </div>
    );
  }

  return (
    <div className="page active" style={{ display: "flex", flexDirection: "column", position: "relative" }}>
      <SharedHeader step="Driver sign up" title="Find a spot." progress={progress} label={`${progress}% complete`} />
      <div className="s-divider" />
      <div className="s-body" style={{ paddingBottom: inputVal.trim() && !done ? 80 : 18 }}>
        <NavBar onBack={() => cur > 0 ? setCur(cur - 1) : goTo("home")} onHome={() => goTo("home")} dots={DR_QUESTIONS.map((_, i) => i)} currentDot={cur} onDotClick={i => ans[i] !== undefined && setCur(i)} />
        <div className="form-center-wrap">
          {!done ? (
            <div className="q-center">
              <p className="q-step-lbl">{`${cur + 1} of ${DR_QUESTIONS.length}`}</p>
              {cur === 0 && (
                <p style={{
                  fontSize: 12, fontWeight: 400, color: "rgba(82,168,67,0.85)",
                  letterSpacing: "0.04em", marginBottom: 6, fontStyle: "italic",
                }}>this will be quick ✦</p>
              )}
              <p className="q-text">{q.text}</p>
              <div style={{ width: "100%" }}>
                <div className="pill-wrap">
                  <input ref={inputRef} className="pill-input" type={q.type} placeholder={q.placeholder} value={inputVal} onChange={e => { setInputVal(e.target.value); setFieldError(""); }} onKeyDown={e => e.key === "Enter" && advance()} />
                </div>
                {q.hint && !fieldError && <p className="hint">{q.hint}</p>}
                {fieldError && <p style={{ fontSize: 12.5, color: "#ef4444", fontWeight: 600, margin: "6px 0 0", lineHeight: 1.4 }}>{fieldError}</p>}
                {q.type === "password" && (
                  <PasswordRequirements
                    password={inputVal}
                    email={ans[2]}
                    firstName={ans[0]}
                    lastName={ans[1]}
                  />
                )}
              </div>
            </div>
          ) : (
            <>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(141,214,63,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                </div>
                <p style={{ fontSize: 20, fontWeight: 300, color: "#0E1F40" }}>Welcome, {ans[0]}!</p>
                <p style={{ fontSize: 12, fontWeight: 300, color: "rgba(14,31,64,0.4)", marginTop: 4 }}>Your account is ready. Start finding spots.</p>
              </div>
              <div className="answer-stack">
                {DR_QUESTIONS.map((qq, i) => (
                  <div key={i} className="answer-card" onClick={() => !locked && setCur(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">{qq.type === "password" ? "••••••••" : (ans[i] || "")}</span>
                    </div>
                    {!locked && <span className="answer-card-edit">Edit</span>}
                  </div>
                ))}
              </div>
              <div className="cta-area">
                <p className="cta-nudge">Ready to park?</p>
                {signupError && (
                  <p style={{ fontSize: 12.5, color: "#ef4444", fontWeight: 600, textAlign: "center", margin: "0 0 10px", lineHeight: 1.4 }}>{signupError}</p>
                )}
                <button className="cta-btn" style={{ background: "#8DD63F", color: "#0E1F40", boxShadow: "0 2px 12px rgba(141,214,63,0.3)" }} onClick={async () => {
                  setLocked(true);
                  setSignupError("");
                  const result = await signUp(ans[2] || "", ans[5] || "", `${ans[0] || ""} ${ans[1] || ""}`.trim(), "driver");
                  if (result.error) { setSignupError(result.error); setLocked(false); return; }
                  if (result.confirmEmail) { setCheckEmail(true); return; }
                  goTo("find");
                }}>Find a spot</button>
              </div>
            </>
          )}
          {!done && Object.keys(ans).length > 0 && (
            <div className="answer-stack" style={{ marginTop: 10 }}>
              {Object.entries(ans).map(([idx, val]) => {
                const i = parseInt(idx);
                if (i >= cur) return null;
                const qq = DR_QUESTIONS[i];
                return (
                  <div key={i} className="answer-card" onClick={() => !locked && setCur(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">{qq.type === "password" ? "••••••••" : val}</span>
                    </div>
                    {!locked && <span className="answer-card-edit">Edit</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sticky Continue button — always visible at the bottom */}
      {!done && inputVal.trim() && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          padding: "12px 24px 20px",
          background: "linear-gradient(to top, #F0F2F7 70%, rgba(240,242,247,0))",
          pointerEvents: "none",
        }}>
          <button
            className="cta-btn"
            style={{ pointerEvents: "auto", ...(canAdvance ? {} : { opacity: 0.4, cursor: "not-allowed" }) }}
            onClick={advance}
            disabled={!canAdvance}
          >Continue</button>
        </div>
      )}
    </div>
  );
}
