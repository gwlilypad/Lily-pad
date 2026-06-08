import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import OnboardingModal from "@/components/OnboardingModal";
import { useAuth } from "@/context/AuthContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";
import PasswordRequirements, { validatePassword } from "@/components/PasswordRequirements";

const SU_QUESTIONS = [
  { label: "Legal first name", text: "What's your legal first name?", type: "text", placeholder: "e.g. Alex", hint: "As it appears on your ID" },
  { label: "Legal last name", text: "And your legal last name?", type: "text", placeholder: "e.g. Johnson", hint: "As it appears on your ID" },
  { label: "Email", text: "What's your email?", type: "email", placeholder: "you@email.com", hint: "We'll send booking notifications here" },
  { label: "Phone", text: "And your phone number?", type: "tel", placeholder: "(555) 000-0000", hint: "Drivers may need to reach you" },
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

const PW_IDX = 4;

export default function SignupPage() {
  const { goTo, setState: setAppState } = useApp();
  const navigate = useNavigate();
  const { signUp, verifyOtp, user } = useAuth();
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [locked, setLocked] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [signupError, setSignupError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [otpDigits, setOtpDigits] = useState(["","","","","",""]);
  const [otpError, setOtpError]   = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = SU_QUESTIONS[cur];
  const progress = Math.round((cur / SU_QUESTIONS.length) * 100);

  // If already signed in, skip account creation and go straight to adding a pad
  useEffect(() => {
    if (user) goTo("addpad");
  }, [user]);

  useEffect(() => {
    if (editIdx !== null) {
      setInputVal(q.type === "password" ? "" : (ans[editIdx] || ""));
    } else {
      setInputVal(ans[cur] || "");
    }
    setFieldError("");
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [cur, editIdx]);

  const isPasswordStep = (editIdx !== null ? editIdx : cur) === PW_IDX;
  const pwValidation = validatePassword({
    password: isPasswordStep ? inputVal : "",
    email: ans[2], firstName: ans[0], lastName: ans[1],
  });
  const canAdvance = inputVal.trim().length > 0 && !fieldError && (!isPasswordStep || pwValidation.allValid);

  function advance() {
    const v = inputVal.trim();
    if (!v) return;
    if (isPasswordStep && !pwValidation.allValid) return;
    const idx = editIdx !== null ? editIdx : cur;
    const q = SU_QUESTIONS[idx];
    const err = validateField(q.label, q.type, v);
    if (err) { setFieldError(err); return; }
    const newAns = { ...ans, [idx]: v };
    setAns(newAns);
    if (editIdx !== null) {
      setEditIdx(null);
      setCur(Object.keys(newAns).length >= SU_QUESTIONS.length ? SU_QUESTIONS.length : cur);
      if (Object.keys(newAns).length >= SU_QUESTIONS.length) {
        setShowConfirm(true);
        setLocked(false);
      }
      return;
    }
    const next = cur + 1;
    if (next >= SU_QUESTIONS.length) {
      setShowConfirm(true);
      setLocked(false);
      setAppState(prev => ({
        ...prev,
        suAns: newAns,
        hasBothAccounts: true,
        drAns: {
          ...prev.drAns,
          0: newAns[0] || "", 1: newAns[1] || "",
          2: newAns[2] || "", 3: newAns[3] || "",
          4: prev.drAns?.[4] || "",
          5: newAns[4] || "",
        },
      }));
    } else {
      setCur(next);
      setInputVal(newAns[next] || "");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") advance();
  }

  function goEdit(idx: number) {
    if (locked) return;
    setShowConfirm(false);
    setEditIdx(idx);
    setCur(idx);
  }

  const displayCur = editIdx !== null ? editIdx : cur;
  const displayQ = SU_QUESTIONS[displayCur];

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
            goTo("addpad");
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
    <div className="page active">
      <OnboardingModal />
      <SharedHeader
        step="Step 1 of 6"
        title="Create your account."
        progress={progress}
        label={`Profile ${progress}% complete`}
      />
      <div className="s-divider" />
      <div className="s-body">
        <NavBar
          onBack={() => navigate(-1)}
          onHome={() => goTo("home")}
          dots={SU_QUESTIONS.map((_, i) => i)}
          currentDot={displayCur}
          onDotClick={(idx) => { if (!locked) goEdit(idx); }}
        />
        <div className="form-center-wrap">
          {!showConfirm ? (
            <div className="q-center">
              <p className="q-step-lbl">{displayCur === 4 ? "One last thing" : `${displayCur + 1} of 5`}</p>
              <p className="q-text">{displayQ.text}</p>
              <div style={{ width: "100%" }}>
                <div className="pill-wrap">
                  <input
                    ref={inputRef}
                    className="pill-input"
                    type={displayQ.type}
                    placeholder={displayQ.placeholder}
                    value={inputVal}
                    onChange={e => { setInputVal(e.target.value); setFieldError(""); }}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                {displayQ.hint && !fieldError && <p className="hint">{displayQ.hint}</p>}
                {fieldError && <p style={{ fontSize: 12.5, color: "#ef4444", fontWeight: 600, margin: "6px 0 0", lineHeight: 1.4 }}>{fieldError}</p>}
                {displayQ.type === "password" && (
                  <PasswordRequirements
                    password={inputVal}
                    email={ans[2]}
                    firstName={ans[0]}
                    lastName={ans[1]}
                  />
                )}
              </div>
              {inputVal.trim() && (
                <div className="cta-area">
                  <button
                    className="cta-btn"
                    onClick={advance}
                    disabled={!canAdvance}
                    style={!canAdvance ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                  >{editIdx !== null ? "Save" : "Continue"}</button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ width: "100%", textAlign: "center", padding: "10px 0 4px" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(141,214,63,0.1)", border: "0.5px solid rgba(141,214,63,0.3)", borderRadius: 100, padding: "8px 16px", marginBottom: 4 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#0E1F40" }}>Account created!</span>
                </div>
                <p style={{ fontSize: 11, fontWeight: 300, color: "rgba(14,31,64,0.35)", marginTop: 4 }}>One more thing before we set up your pad.</p>
              </div>
              <div className="answer-stack" style={{ marginTop: 12 }}>
                {SU_QUESTIONS.map((qq, i) => (
                  <div key={i} className="answer-card" onClick={() => !locked && goEdit(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">{qq.type === "password" ? "••••••••" : (ans[i] || "")}</span>
                    </div>
                    {!locked && <span className="answer-card-edit">Edit</span>}
                  </div>
                ))}
              </div>
              <div className="cta-area">
                <p className="cta-nudge">Let's set up your lily pad.</p>
                {signupError && (
                  <p style={{ fontSize: 12.5, color: "#ef4444", fontWeight: 600, textAlign: "center", margin: "0 0 10px", lineHeight: 1.4 }}>{signupError}</p>
                )}
                <button className="cta-btn" onClick={async () => {
                  setLocked(true);
                  setSignupError("");
                  const result = await signUp(ans[2] || "", ans[4] || "", `${ans[0] || ""} ${ans[1] || ""}`.trim(), "host");
                  if (result.error) { setSignupError(result.error); setLocked(false); return; }
                  if (result.confirmEmail) { setCheckEmail(true); return; }
                  goTo("addpad");
                }}>Continue</button>
              </div>
            </>
          )}
          {!showConfirm && Object.keys(ans).length > 0 && (
            <div className="answer-stack" style={{ marginTop: 10 }}>
              {Object.entries(ans).map(([idx, val]) => {
                const i = parseInt(idx);
                const qq = SU_QUESTIONS[i];
                if (!qq) return null;
                return (
                  <div key={i} className="answer-card" onClick={() => !locked && goEdit(i)}>
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
    </div>
  );
}
