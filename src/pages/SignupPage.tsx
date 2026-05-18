import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";
import PasswordRequirements, { validatePassword } from "@/components/PasswordRequirements";

const SU_QUESTIONS = [
  { label: "First name", text: "What's your first name?", type: "text", placeholder: "e.g. Alex", hint: "" },
  { label: "Last name", text: "And your last name?", type: "text", placeholder: "e.g. Johnson", hint: "" },
  { label: "Email", text: "What's your email?", type: "email", placeholder: "you@email.com", hint: "We'll send booking notifications here" },
  { label: "Phone", text: "And your phone number?", type: "tel", placeholder: "(555) 000-0000", hint: "Drivers may need to reach you" },
  { label: "Password", text: "Create a password.", type: "password", placeholder: "Create a strong password", hint: "" },
];

const PW_IDX = 4;

export default function SignupPage() {
  const { goTo, setState: setAppState } = useApp();
  const { signUp } = useAuth();
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [locked, setLocked] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = SU_QUESTIONS[cur];
  const progress = Math.round((cur / SU_QUESTIONS.length) * 100);

  useEffect(() => {
    if (editIdx !== null) {
      setInputVal(q.type === "password" ? "" : (ans[editIdx] || ""));
    } else {
      setInputVal(ans[cur] || "");
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [cur, editIdx]);

  const isPasswordStep = (editIdx !== null ? editIdx : cur) === PW_IDX;
  const pwValidation = validatePassword({
    password: isPasswordStep ? inputVal : "",
    email: ans[2], firstName: ans[0], lastName: ans[1],
  });
  const canAdvance = inputVal.trim().length > 0 && (!isPasswordStep || pwValidation.allValid);

  function advance() {
    const v = inputVal.trim();
    if (!v) return;
    if (isPasswordStep && !pwValidation.allValid) return;
    const idx = editIdx !== null ? editIdx : cur;
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
    setEditIdx(idx);
    setCur(idx);
    setInputVal(q.type === "password" ? "" : (ans[idx] || ""));
  }

  const displayCur = editIdx !== null ? editIdx : cur;
  const displayQ = SU_QUESTIONS[displayCur];

  if (checkEmail) {
    return (
      <div className="page active" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 28, padding: "40px 28px", textAlign: "center" }}>
        <div style={{ width: 68, height: 68, borderRadius: "50%", background: "rgba(141,214,63,0.12)", border: "2px solid rgba(141,214,63,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
        </div>
        <div>
          <p style={{ fontSize: 22, fontWeight: 700, color: "#0E1F40", margin: 0, letterSpacing: "-0.02em" }}>Check your inbox</p>
          <p style={{ fontSize: 14, color: "rgba(14,31,64,0.55)", margin: "10px 0 0", lineHeight: 1.55 }}>
            We sent a verification link to<br/>
            <strong style={{ color: "#0E1F40" }}>{ans[2]}</strong>
          </p>
          <p style={{ fontSize: 12.5, color: "rgba(14,31,64,0.4)", margin: "10px 0 0", lineHeight: 1.5 }}>
            Click the link in the email to confirm your account, then come back to set up your pad.
          </p>
        </div>
        <button
          onClick={() => goTo("signin")}
          style={{ background: "#8DD63F", color: "#0E1F40", border: "none", borderRadius: 100, padding: "13px 32px", fontSize: 14, fontWeight: 800, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}
        >
          OK, got it
        </button>
        <p style={{ fontSize: 11.5, color: "rgba(14,31,64,0.35)", margin: 0 }}>Didn't get it? Check your spam folder.</p>
      </div>
    );
  }

  return (
    <div className="page active">
      <SharedHeader
        step="Step 1 of 6"
        title="Create your account."
        progress={progress}
        label={`Profile ${progress}% complete`}
      />
      <div className="s-divider" />
      <div className="s-body">
        <NavBar
          onBack={() => goTo("padtype")}
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
                    onChange={e => setInputVal(e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                {displayQ.hint && <p className="hint">{displayQ.hint}</p>}
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
                <button className="cta-btn" onClick={async () => {
                  setLocked(true);
                  const result = await signUp(ans[2] || "", ans[4] || "", `${ans[0] || ""} ${ans[1] || ""}`.trim(), "host");
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
