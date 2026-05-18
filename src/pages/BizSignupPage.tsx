import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";
import PasswordRequirements, { validatePassword } from "@/components/PasswordRequirements";

type QType = "text" | "email" | "tel" | "password" | "number" | "choice" | "choice-other" | "photos";

interface Question {
  label: string;
  text: string;
  type: QType;
  placeholder?: string;
  hint?: string;
  choices?: string[];
}

const BIZ_QUESTIONS: Question[] = [
  { label: "Business / lot name", text: "What's the name of your business or lot?", type: "text", placeholder: "e.g. St. Mary's Church", hint: "This is what drivers will see on the map" },
  { label: "Type of lot", text: "What type of lot do you have?", type: "choice-other", choices: ["Small business", "Church", "School", "Apartment / HOA", "Office building", "Restaurant / Retail", "Event venue", "Other (please specify)"] },
  { label: "Your relationship", text: "What's your relationship to this lot?", type: "choice-other", choices: ["Owner", "Property Manager / Authorized Agent", "Other (please specify)"] },
  { label: "Address", text: "What's the address?", type: "text", placeholder: "123 Main St, City, State", hint: "Include city and state" },
  { label: "Approx. spaces", text: "About how many spaces does the lot have?", type: "number", placeholder: "e.g. 25" },
  { label: "Contact first name", text: "What's your first name?", type: "text", placeholder: "e.g. Alex", hint: "We'll use this to verify the listing" },
  { label: "Contact last name", text: "And your last name?", type: "text", placeholder: "e.g. Johnson" },
  { label: "Email", text: "What's your email?", type: "email", placeholder: "you@business.com", hint: "We'll reach out here to complete your listing" },
  { label: "Phone", text: "And your phone number?", type: "tel", placeholder: "(555) 000-0000" },
  { label: "Password", text: "Create a password.", type: "password", placeholder: "Create a strong password" },
  { label: "Lot photos", text: "Add a few photos of your lot.", type: "photos", hint: "Wide shots, entrance, and any signage. You can skip and add these later." },
];

const BIZ_PW_IDX = 9;

export default function BizSignupPage() {
  const { goTo, setState: setAppState } = useApp();
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [inputVal, setInputVal] = useState("");
  const [otherVal, setOtherVal] = useState("");
  const [photoCount, setPhotoCount] = useState(0);
  const [locked, setLocked] = useState(false);
  const [done, setDone] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeIdx = editIdx !== null ? editIdx : cur;
  const q = BIZ_QUESTIONS[activeIdx];
  const progress = done ? 100 : Math.round((cur / BIZ_QUESTIONS.length) * 100);

  useEffect(() => {
    const v = ans[activeIdx] || "";
    setInputVal(q?.type === "password" ? "" : v);
    setOtherVal(v.startsWith("Other: ") ? v.slice(7) : "");
    if (q?.type === "text" || q?.type === "email" || q?.type === "tel" || q?.type === "password" || q?.type === "number") {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [cur, editIdx]);

  const isPwStep = activeIdx === BIZ_PW_IDX;
  const pwValidation = validatePassword({
    password: isPwStep ? inputVal : "",
    email: ans[7], firstName: ans[5], lastName: ans[6],
  });

  const isOtherSelected = q?.type === "choice-other" && (inputVal === "Other (please specify)" || (ans[activeIdx] || "").startsWith("Other: "));
  const canAdvanceText = inputVal.trim().length > 0 && (!isPwStep || pwValidation.allValid) && (!isOtherSelected || otherVal.trim().length > 0);

  function goEdit(i: number) {
    if (locked) return;
    setEditIdx(i);
    setDone(false);
  }

  function commitAndNext(v: string) {
    const idx = editIdx !== null ? editIdx : cur;
    const newAns = { ...ans, [idx]: v };
    setAns(newAns);
    if (editIdx !== null) {
      setEditIdx(null);
      setDone(true);
      setAppState(prev => ({
        ...prev,
        bizAns: newAns,
        bizPhotoCount: photoCount,
        accountType: "padRenter",
        hasBothAccounts: true,
        suAns: { ...prev.suAns, 0: newAns[5] || "", 1: newAns[6] || "", 2: newAns[7] || "", 3: newAns[8] || "" },
        drAns: {
          ...prev.drAns,
          0: newAns[5] || "", 1: newAns[6] || "",
          2: newAns[7] || "", 3: newAns[8] || "",
          4: prev.drAns?.[4] || "",
          5: newAns[9] || "",
        },
      }));
      return;
    }
    const next = cur + 1;
    if (next >= BIZ_QUESTIONS.length) {
      setDone(true);
      setAppState(prev => ({
        ...prev,
        bizAns: newAns,
        bizPhotoCount: photoCount,
        accountType: "padRenter",
        hasBothAccounts: true,
        suAns: { ...prev.suAns, 0: newAns[5] || "", 1: newAns[6] || "", 2: newAns[7] || "", 3: newAns[8] || "" },
        drAns: {
          ...prev.drAns,
          0: newAns[5] || "", 1: newAns[6] || "",
          2: newAns[7] || "", 3: newAns[8] || "",
          4: prev.drAns?.[4] || "",
          5: newAns[9] || "",
        },
      }));
    } else {
      setCur(next);
    }
  }

  function advance(val?: string) {
    if (q?.type === "photos") {
      commitAndNext(photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"} uploaded` : "Skipped — will upload later");
      return;
    }
    if (q?.type === "choice-other") {
      const choice = val ?? inputVal;
      if (!choice) return;
      if (choice === "Other (please specify)") {
        if (!otherVal.trim()) { setInputVal(choice); return; }
        commitAndNext(`Other: ${otherVal.trim()}`);
      } else {
        commitAndNext(choice);
      }
      return;
    }
    if (q?.type === "choice") {
      if (val) { commitAndNext(val); return; }
    }
    const v = (val !== undefined ? val : inputVal).trim();
    if (!v) return;
    if (isPwStep && !pwValidation.allValid) return;
    commitAndNext(v);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") advance();
  }

  function onChoiceClick(ch: string) {
    if (q?.type === "choice-other") {
      if (ch === "Other (please specify)") {
        setInputVal(ch);
      } else {
        advance(ch);
      }
    } else {
      advance(ch);
    }
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const n = e.target.files?.length ?? 0;
    setPhotoCount(prev => prev + n);
  }

  return (
    <div className="page active">
      <SharedHeader
        step="Business listing"
        title="List your lot."
        progress={progress}
        label={`Listing ${progress}% complete`}
      />
      <div className="s-divider" />
      <div className="s-body">
        <NavBar
          onBack={() => {
            if (editIdx !== null) { setEditIdx(null); setDone(true); return; }
            if (cur > 0) setCur(cur - 1);
            else goTo("padtype");
          }}
          onHome={() => goTo("home")}
          dots={BIZ_QUESTIONS.map((_, i) => i)}
          currentDot={activeIdx}
          onDotClick={(i) => { if (ans[i] !== undefined && !locked) { if (done) goEdit(i); else setCur(i); } }}
        />
        <div className="form-center-wrap">
          {!done ? (
            <div className="q-center">
              {cur === 0 && (
                <div style={{
                  width: "100%", marginBottom: 14, padding: "12px 16px",
                  borderRadius: 14, background: "rgba(141,214,63,0.12)",
                  border: "1px solid rgba(141,214,63,0.3)",
                  textAlign: "center",
                }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: "#0E1F40", lineHeight: 1.45, margin: 0 }}>
                    Have a multi-space lot? Let's get you listed and ready to earn.
                  </p>
                </div>
              )}
              <p className="q-step-lbl">{editIdx !== null ? "Editing" : `${cur + 1} of ${BIZ_QUESTIONS.length}`}</p>
              <p className="q-text">{q.text}</p>

              {(q.type === "text" || q.type === "email" || q.type === "tel" || q.type === "number") && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap">
                    <input
                      ref={inputRef}
                      className="pill-input"
                      type={q.type === "number" ? "number" : q.type}
                      placeholder={q.placeholder}
                      value={inputVal}
                      onChange={e => setInputVal(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                  </div>
                  {q.hint && <p className="hint">{q.hint}</p>}
                  {inputVal.trim() && (
                    <div className="cta-area" style={{ marginTop: 16 }}>
                      <button className="cta-btn" onClick={() => advance()}>{editIdx !== null ? "Save" : "Continue"}</button>
                    </div>
                  )}
                </div>
              )}

              {q.type === "password" && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap">
                    <input
                      ref={inputRef}
                      className="pill-input"
                      type="password"
                      placeholder={q.placeholder}
                      value={inputVal}
                      onChange={e => setInputVal(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                  </div>
                  <PasswordRequirements
                    password={inputVal}
                    email={ans[7]}
                    firstName={ans[5]}
                    lastName={ans[6]}
                  />
                  {inputVal.trim() && (
                    <div className="cta-area" style={{ marginTop: 16 }}>
                      <button
                        className="cta-btn"
                        onClick={() => advance()}
                        disabled={!canAdvanceText}
                        style={!canAdvanceText ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                      >{editIdx !== null ? "Save" : "Continue"}</button>
                    </div>
                  )}
                </div>
              )}

              {q.type === "choice" && (
                <div className="choice-list">
                  {q.choices?.map(ch => (
                    <button
                      key={ch}
                      className={`choice-btn${ans[cur] === ch ? " selected" : ""}`}
                      onClick={() => onChoiceClick(ch)}
                    >{ch}</button>
                  ))}
                </div>
              )}

              {q.type === "choice-other" && (
                <div style={{ width: "100%" }}>
                  <div className="choice-list">
                    {q.choices?.map(ch => (
                      <button
                        key={ch}
                        className={`choice-btn${inputVal === ch ? " selected" : ""}`}
                        onClick={() => onChoiceClick(ch)}
                      >{ch}</button>
                    ))}
                  </div>
                  {isOtherSelected && (
                    <div style={{ marginTop: 14 }}>
                      <div className="pill-wrap">
                        <input
                          className="pill-input"
                          placeholder="Please specify your role"
                          value={otherVal}
                          onChange={e => setOtherVal(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && otherVal.trim() && advance()}
                          autoFocus
                        />
                      </div>
                      {otherVal.trim() && (
                        <div className="cta-area" style={{ marginTop: 16 }}>
                          <button className="cta-btn" onClick={() => advance()}>{editIdx !== null ? "Save" : "Continue"}</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {q.type === "photos" && (
                <div style={{ width: "100%" }}>
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{
                      width: "100%", padding: "28px 18px", borderRadius: 18,
                      border: "1.5px dashed rgba(14,31,64,0.2)",
                      background: "rgba(14,31,64,0.03)",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{
                      width: 44, height: 44, borderRadius: "50%",
                      background: "rgba(141,214,63,0.18)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#0E1F40", margin: 0 }}>
                      {photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"} added` : "Tap to add photos"}
                    </p>
                    <p style={{ fontSize: 11, fontWeight: 400, color: "rgba(14,31,64,0.5)", margin: 0, textAlign: "center" }}>
                      JPG or PNG · You can add more later
                    </p>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={onPickFiles}
                  />
                  {q.hint && <p className="hint">{q.hint}</p>}
                  <div className="cta-area" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    {photoCount > 0 && (
                      <button className="cta-btn" onClick={() => advance()}>{editIdx !== null ? "Save" : "Continue"}</button>
                    )}
                    <button
                      style={{
                        background: "none", border: "none", color: "rgba(14,31,64,0.45)",
                        fontSize: 14, fontWeight: 500, cursor: "pointer", padding: "8px 0",
                      }}
                      onClick={() => advance()}
                    >
                      {editIdx !== null ? "Save without photos" : "Skip for now"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{ width: "100%", textAlign: "center", padding: "10px 0 4px" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(141,214,63,0.1)", border: "0.5px solid rgba(141,214,63,0.3)", borderRadius: 100, padding: "8px 16px", marginBottom: 4 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#0E1F40" }}>Application submitted!</span>
                </div>
              </div>

              <div className="answer-stack" style={{ marginTop: 12 }}>
                {BIZ_QUESTIONS.map((qq, i) => (
                  <div key={i} className="answer-card" onClick={() => goEdit(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">
                        {qq.type === "password" ? "••••••••" : (ans[i] || "—")}
                      </span>
                    </div>
                    {!locked && <span className="answer-card-edit">Edit</span>}
                  </div>
                ))}
              </div>

              <div style={{
                width: "100%", marginTop: 16, padding: "14px 16px",
                borderRadius: 14, background: "rgba(14,31,64,0.05)",
                border: "1px solid rgba(14,31,64,0.08)",
                textAlign: "center",
              }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#0E1F40", margin: 0, marginBottom: 4 }}>
                  We'll be in touch soon.
                </p>
                <p style={{ fontSize: 12, fontWeight: 400, color: "rgba(14,31,64,0.6)", margin: 0, lineHeight: 1.5 }}>
                  Our team will contact you to verify your lot, finish uploading photos, and assign spot numbers before going live.
                </p>
              </div>

              <div className="cta-area">
                <p className="cta-nudge">In the meantime, take a look around.</p>
                <button
                  className="cta-btn"
                  onClick={() => { setLocked(true); goTo("find"); }}
                >Continue to map</button>
              </div>
            </>
          )}

          {!done && editIdx === null && Object.keys(ans).length > 0 && (
            <div className="answer-stack" style={{ marginTop: 10 }}>
              {Object.entries(ans).map(([idx, val]) => {
                const i = parseInt(idx);
                if (i >= cur) return null;
                const qq = BIZ_QUESTIONS[i];
                if (!qq) return null;
                return (
                  <div key={i} className="answer-card" onClick={() => !locked && setCur(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">
                        {qq.type === "password" ? "••••••••" : val}
                      </span>
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
