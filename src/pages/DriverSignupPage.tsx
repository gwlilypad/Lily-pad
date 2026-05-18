import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";
import PasswordRequirements, { validatePassword } from "@/components/PasswordRequirements";

const DR_QUESTIONS = [
  { label: "First name", text: "What's your first name?", type: "text", placeholder: "e.g. Jordan", hint: "" },
  { label: "Last name", text: "And your last name?", type: "text", placeholder: "e.g. Smith", hint: "" },
  { label: "Email", text: "What's your email?", type: "email", placeholder: "you@email.com", hint: "We'll send booking receipts here" },
  { label: "Phone", text: "Your phone number?", type: "tel", placeholder: "(555) 000-0000", hint: "" },
  { label: "Vehicle", text: "What do you drive?", type: "text", placeholder: "e.g. 2022 Honda Civic", hint: "Helps hosts verify the right car" },
  { label: "Password", text: "Create a password.", type: "password", placeholder: "Create a strong password", hint: "" },
];

const DR_PW_IDX = 5;

export default function DriverSignupPage() {
  const { goTo, setState: setAppState } = useApp();
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = DR_QUESTIONS[cur];
  const progress = Math.round((cur / DR_QUESTIONS.length) * 100);

  useEffect(() => {
    setInputVal(ans[cur] || "");
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [cur]);

  const isPwStep = cur === DR_PW_IDX;
  const pwValidation = validatePassword({
    password: isPwStep ? inputVal : "",
    email: ans[2], firstName: ans[0], lastName: ans[1],
  });
  const canAdvance = inputVal.trim().length > 0 && (!isPwStep || pwValidation.allValid);

  function advance() {
    const v = inputVal.trim();
    if (!v) return;
    if (isPwStep && !pwValidation.allValid) return;
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
                  <input ref={inputRef} className="pill-input" type={q.type} placeholder={q.placeholder} value={inputVal} onChange={e => setInputVal(e.target.value)} onKeyDown={e => e.key === "Enter" && advance()} />
                </div>
                {q.hint && <p className="hint">{q.hint}</p>}
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
                <button className="cta-btn" style={{ background: "#8DD63F", color: "#0E1F40", boxShadow: "0 2px 12px rgba(141,214,63,0.3)" }} onClick={() => { setLocked(true); goTo("find"); }}>Find a spot</button>
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
