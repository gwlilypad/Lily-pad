import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";

type InputType = "text" | "choice" | "number" | "price" | "textarea";

interface Question {
  label: string;
  text: string;
  type: InputType;
  placeholder?: string;
  hint?: string;
  choices?: string[];
  optional?: boolean;
}

// Personal pad setup. The business-logo step lives in the business
// signup flow (BizSignupPage), not here.
const AP_QUESTIONS: Question[] = [
  { label: "Address", text: "What's the address?", type: "text", placeholder: "123 Main St, City, State", hint: "Include city and state" },
  { label: "Spot type", text: "What kind of spot is it?", type: "choice", choices: ["Driveway", "Garage", "Street (permitted)", "Alley"] },
  { label: "Surface", text: "What's the surface?", type: "choice", choices: ["Concrete", "Asphalt", "Gravel", "Grass"] },
  { label: "Number of pads", text: "How many pads?", type: "number" },
  { label: "Price per hour", text: "What's your price per hour?", type: "price", hint: "You can change this anytime." },
  { label: "Description", text: "Add a short description.", type: "textarea", placeholder: "Easy access driveway right off the main street, great for downtown commuters.", hint: "Tell renters what makes your spot great. (optional)", optional: true },
];

export default function AddPadPage() {
  const { goTo, state, setState: setAppState } = useApp();
  const { user } = useAuth();
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [addrCity, setAddrCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip] = useState("");
  const [numVal, setNumVal] = useState(1);
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const [foundMsg, setFoundMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);

  const q = AP_QUESTIONS[cur];
  const progress = Math.round((Math.min(cur, AP_QUESTIONS.length) / AP_QUESTIONS.length) * 100) + 16;

  useEffect(() => {
    setInputVal(ans[cur] || "");
    setNumVal(ans[cur] ? parseInt(ans[cur]) || 1 : 1);
    if (q?.type === "text" || q?.type === "price") setTimeout(() => inputRef.current?.focus(), 100);
  }, [cur]);

  useEffect(() => {
    if (cur === 0 && ans[0]) {
      setTimeout(() => setFoundMsg("We found you!"), 800);
      setTimeout(() => setFoundMsg(""), 3000);
    }
  }, [ans[0]]);

  function buildFullAddress() {
    const parts = [inputVal.trim(), addrCity.trim(), [addrState.trim(), addrZip.trim()].filter(Boolean).join(" ")].filter(Boolean);
    return parts.join(", ");
  }

  function advance(val?: string) {
    const v = val !== undefined ? val : inputVal.trim();
    if (!v && q?.type !== "number" && !q?.optional) return;
    const finalV = q?.type === "number" ? String(numVal) : v;
    const newAns = { ...ans, [cur]: finalV };
    setAns(newAns);
    const next = cur + 1;
    if (next >= AP_QUESTIONS.length) {
      setDone(true);
      setAppState(prev => ({ ...prev, apAns: newAns, apNumPads: numVal, apLogoUrl: "" }));
    } else {
      setCur(next);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") advance();
  }

  return (
    <div className="page active">
      <SharedHeader
        step="Step 2 of 6"
        title="Add your lily pad."
        progress={progress}
        label={`Profile ${progress}% complete`}
        foundMsg={foundMsg}
      />
      <div className="s-divider" />
      <div className="s-body">
        <NavBar
          onBack={() => cur > 0 ? setCur(cur - 1) : goTo(state.addingExtraPad ? "paddashboard" : (user ? "padtype" : "signup"))}
          onHome={() => goTo("home")}
          dots={AP_QUESTIONS.map((_, i) => i)}
          currentDot={cur}
          onDotClick={(i) => { if (ans[i] !== undefined) setCur(i); }}
        />
        <div className="form-center-wrap">
          {!done ? (
            <div className="q-center">
              <p className="q-step-lbl">{`${cur + 1} of ${AP_QUESTIONS.length}`}</p>
              <p className="q-text">{q.text}</p>

              {q.type === "text" && cur === 0 && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap">
                    <input
                      ref={inputRef}
                      className="pill-input"
                      placeholder="Street address"
                      value={inputVal}
                      onChange={e => setInputVal(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") cityRef.current?.focus(); }}
                    />
                  </div>
                  <div className="pill-wrap" style={{ marginTop: 10 }}>
                    <input
                      ref={cityRef}
                      className="pill-input"
                      placeholder="City"
                      value={addrCity}
                      onChange={e => setAddrCity(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <div className="pill-wrap" style={{ flex: 1 }}>
                      <input
                        className="pill-input"
                        placeholder="State"
                        value={addrState}
                        onChange={e => setAddrState(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        style={{ textTransform: "uppercase" }}
                        maxLength={2}
                      />
                    </div>
                    <div className="pill-wrap" style={{ flex: 1 }}>
                      <input
                        className="pill-input"
                        placeholder="ZIP"
                        value={addrZip}
                        onChange={e => setAddrZip(e.target.value.replace(/\D/g, ""))}
                        onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        inputMode="numeric"
                        maxLength={5}
                      />
                    </div>
                  </div>
                  {inputVal.trim() && addrCity.trim() && addrState.trim() && (
                    <div className="cta-area" style={{ marginTop: 16 }}>
                      <button className="cta-btn" onClick={() => advance(buildFullAddress())}>Continue</button>
                    </div>
                  )}
                </div>
              )}

              {q.type === "text" && cur !== 0 && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap">
                    <input
                      ref={inputRef}
                      className="pill-input"
                      placeholder={q.placeholder}
                      value={inputVal}
                      onChange={e => setInputVal(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                  </div>
                  {q.hint && <p className="hint">{q.hint}</p>}
                  {inputVal.trim() && (
                    <div className="cta-area" style={{ marginTop: 16 }}>
                      <button className="cta-btn" onClick={() => advance()}>Continue</button>
                    </div>
                  )}
                </div>
              )}

              {q.type === "price" && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap" style={{ display: "flex", alignItems: "center", padding: "0 18px", gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: "#8DD63F", lineHeight: 1 }}>$</span>
                    <input
                      ref={inputRef}
                      className="pill-input"
                      style={{ padding: "16px 0", fontSize: 18, fontWeight: 700 }}
                      type="text"
                      inputMode="decimal"
                      placeholder=""
                      value={inputVal}
                      onChange={e => {
                        const cleaned = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                        setInputVal(cleaned);
                      }}
                      onKeyDown={handleKeyDown}
                    />
                    <span style={{ fontSize: 13, color: "rgba(14,31,64,0.45)", fontWeight: 600, whiteSpace: "nowrap" }}>/ hr</span>
                  </div>
                  {q.hint && <p className="hint">{q.hint}</p>}
                  {inputVal.trim() && Number(inputVal) > 0 && (
                    <div className="cta-area" style={{ marginTop: 16 }}>
                      <button className="cta-btn" onClick={() => advance()}>Continue</button>
                    </div>
                  )}
                </div>
              )}

              {q.type === "textarea" && (
                <div style={{ width: "100%" }}>
                  <textarea
                    className="pill-input"
                    style={{
                      width: "100%", minHeight: 110, padding: "14px 18px",
                      borderRadius: 18, border: "1.5px solid rgba(14,31,64,0.12)",
                      background: "#fff", fontSize: 15, color: "#0E1F40",
                      fontFamily: "'DM Sans',sans-serif", fontWeight: 500,
                      outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box",
                    }}
                    placeholder={q.placeholder}
                    value={inputVal}
                    onChange={e => setInputVal(e.target.value)}
                  />
                  {q.hint && <p className="hint">{q.hint}</p>}
                  <div className="cta-area" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    {inputVal.trim() && (
                      <button className="cta-btn" onClick={() => advance()}>Continue</button>
                    )}
                    {q.optional && (
                      <button
                        style={{ background: "none", border: "none", color: "rgba(14,31,64,0.45)", fontSize: 14, fontWeight: 500, cursor: "pointer", padding: "8px 0" }}
                        onClick={() => advance("")}
                      >
                        Skip
                      </button>
                    )}
                  </div>
                </div>
              )}

              {q.type === "choice" && (
                <div className="choice-list">
                  {q.choices?.map(ch => (
                    <button
                      key={ch}
                      className={`choice-btn${ans[cur] === ch ? " selected" : ""}`}
                      onClick={() => advance(ch)}
                    >{ch}</button>
                  ))}
                </div>
              )}

              {q.type === "number" && (
                <div className="num-wrap">
                  <p className="num-note">One pad = one parking spot. Multiple pads can share the same driveway.</p>
                  <div className="num-row">
                    <button className="num-btn" onClick={() => setNumVal(Math.max(1, numVal - 1))}>−</button>
                    <span className="num-val">{numVal}</span>
                    <button className="num-btn" onClick={() => setNumVal(Math.min(10, numVal + 1))}>+</button>
                  </div>
                  <button className="num-confirm" onClick={() => advance(String(numVal))}>Confirm</button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="answer-stack" style={{ marginTop: 4 }}>
                {AP_QUESTIONS.map((qq, i) => (
                  <div key={i} className="answer-card" onClick={() => !locked && setCur(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">{ans[i] || "—"}</span>
                    </div>
                    {!locked && <span className="answer-card-edit">Edit</span>}
                  </div>
                ))}
              </div>
              <div className="cta-area">
                <p className="cta-nudge">Next — photos and highlights.</p>
                <button className="cta-btn" onClick={() => {
                  setLocked(true);
                  // Spot is saved to Supabase at the END of the photo step,
                  // once we have a photo_url to include in the INSERT.
                  // Clear any previous spot ID so PhotoPage knows to create a new one.
                  setAppState(s => ({ ...s, apSpotId: "" }));
                  goTo("photointro");
                }}>Continue</button>
              </div>
            </>
          )}
          {!done && Object.keys(ans).length > 0 && (
            <div className="answer-stack" style={{ marginTop: 10 }}>
              {Object.entries(ans).map(([idx, val]) => {
                const i = parseInt(idx);
                if (i >= cur) return null;
                const qq = AP_QUESTIONS[i];
                return (
                  <div key={i} className="answer-card" onClick={() => !locked && setCur(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">{val}</span>
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
