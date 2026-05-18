import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";

interface Question {
  label: string;
  text: string;
  sub?: string;
  type: "text" | "choice" | "address-confirm";
  placeholder?: string;
  hint?: string;
  choices?: string[];
}

const PY_QUESTIONS: Question[] = [
  { label: "Bank / method", text: "How do you want to get paid?", type: "choice", choices: ["Direct deposit (ACH)", "Venmo", "PayPal", "Check by mail"] },
  { label: "Account name", text: "Account holder name?", type: "text", placeholder: "Full legal name", hint: "Must match your bank account" },
  { label: "Routing number", text: "Routing number?", type: "text", placeholder: "9-digit routing number", hint: "Found at the bottom of your check" },
  { label: "Account number", text: "Account number?", type: "text", placeholder: "Your account number", hint: "This is kept encrypted and secure" },
  { label: "Home address", text: "Confirm your address.", type: "address-confirm", sub: "For tax purposes (1099 if over $600/yr)" },
];

export default function PaymentPage() {
  const { goTo, state } = useApp();
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const [method, setMethod] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const q = PY_QUESTIONS[cur];
  const progress = 66 + Math.round((Math.min(cur, PY_QUESTIONS.length) / PY_QUESTIONS.length) * 17);

  useEffect(() => {
    if (q?.type === "text") {
      setInputVal(ans[cur] || "");
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [cur]);

  function advance(val?: string) {
    const v = val !== undefined ? val : inputVal.trim();
    if (!v) return;
    const newAns = { ...ans, [cur]: v };
    setAns(newAns);
    const next = cur + 1;
    if (next >= PY_QUESTIONS.length) {
      setDone(true);
    } else {
      setCur(next);
    }
  }

  const padAddress = state.apAns?.[0] || "your pad address";

  return (
    <div className="page active">
      <SharedHeader step="Step 5 of 6" title="Set up payments." progress={progress} label={`Profile ${progress}% complete`} />
      <div className="s-divider" />
      <div className="s-body">
        <NavBar onBack={() => cur > 0 ? setCur(cur - 1) : goTo("availability")} onHome={() => goTo("home")} dots={PY_QUESTIONS.map((_, i) => i)} currentDot={cur} onDotClick={i => ans[i] !== undefined && setCur(i)} />
        <div className="form-center-wrap">
          {!done ? (
            <div className="q-center">
              {q.sub && <p style={{ fontSize: 11, color: "rgba(14,31,64,0.35)", marginBottom: 8 }}>{q.sub}</p>}
              <p className="q-step-lbl">{`${cur + 1} of ${PY_QUESTIONS.length}`}</p>
              <p className="q-text">
                {q.type === "address-confirm"
                  ? `Is ${padAddress} also your home address?`
                  : q.text}
              </p>

              {q.type === "text" && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap">
                    <input ref={inputRef} className="pill-input" placeholder={q.placeholder} value={inputVal} onChange={e => setInputVal(e.target.value)} onKeyDown={e => e.key === "Enter" && advance()} />
                  </div>
                  {q.hint && <p className="hint">{q.hint}</p>}
                  {inputVal.trim() && <div className="cta-area" style={{ marginTop: 16 }}><button className="cta-btn" onClick={() => advance()}>Continue</button></div>}
                </div>
              )}

              {(q.type === "choice" || q.type === "address-confirm") && (
                <div className="choice-list">
                  {q.type === "choice" && q.choices?.map(ch => (
                    <button key={ch} className={`choice-btn${ans[cur] === ch ? " selected" : ""}`} onClick={() => { setMethod(ch); advance(ch); }}>{ch}</button>
                  ))}
                  {q.type === "address-confirm" && (
                    <>
                      <button className="choice-btn" onClick={() => advance(padAddress)}>Yes, same address</button>
                      <button className="choice-btn" onClick={() => { advance(""); setCur(cur); setInputVal(""); }}>No, use a different address</button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <div className="success-icon" style={{ margin: "0 auto 12px" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                </div>
                <p style={{ fontSize: 18, fontWeight: 300, color: "#0E1F40" }}>Payment setup complete!</p>
                <p style={{ fontSize: 12, fontWeight: 300, color: "rgba(14,31,64,0.4)", marginTop: 4 }}>Your earnings will be deposited automatically.</p>
              </div>
              <div className="answer-stack">
                {PY_QUESTIONS.map((qq, i) => (
                  <div key={i} className="answer-card" onClick={() => !locked && setCur(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">{(qq.label.toLowerCase().includes("number") && ans[i]) ? "••••" + ans[i].slice(-4) : (ans[i] || "—")}</span>
                    </div>
                    {!locked && <span className="answer-card-edit">Edit</span>}
                  </div>
                ))}
              </div>
              <div className="cta-area">
                <p className="cta-nudge">You're all set — let's find a spot.</p>
                <button className="cta-btn" onClick={() => { setLocked(true); goTo("find"); }}>Find a spot</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
