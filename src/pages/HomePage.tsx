import { useState } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";

const CarSVG = () => (
  <svg width="135" height="66" viewBox="0 0 90 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="carBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f5f6f8"/><stop offset="100%" stopColor="#d2d8e2"/></linearGradient>
      <linearGradient id="carRoof" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#eceef2"/><stop offset="100%" stopColor="#c8cdd8"/></linearGradient>
    </defs>
    <ellipse cx="45" cy="42" rx="36" ry="3.5" fill="rgba(14,31,64,0.28)"/>
    <path d="M8 28 Q8 20 14 20 L22 20 L28 10 Q30 7 34 7 L58 7 Q62 7 64 10 L70 20 L76 20 Q82 20 82 28 L82 32 Q82 36 78 36 L12 36 Q8 36 8 32 Z" fill="url(#carBody)"/>
    <path d="M28 20 L34 9 Q36 7 38 7 L56 7 Q58 7 60 9 L66 20 Z" fill="url(#carRoof)"/>
    <path d="M60 20 L56 9 Q55 7.5 53 7.5 L50 7.5 L64 20 Z" fill="#b0c8dc" opacity="0.6"/>
    <path d="M34 9 Q36 7 38 7 L50 7.5 L64 20 L34 20 Z" fill="#b8d0e4" opacity="0.75"/>
    <path d="M28 20 L32 9 Q33 7.5 34 9 L34 20 Z" fill="#a8bcd0" opacity="0.55"/>
    <path d="M28 20 L32 8 Q30 6 29 8 L26 20 Z" fill="#b0c4d4" opacity="0.5"/>
    <path d="M38 9 Q44 7.5 52 8" stroke="white" strokeWidth="1" fill="none" opacity="0.5" strokeLinecap="round"/>
    <line x1="50" y1="20" x2="50" y2="35" stroke="rgba(0,0,0,0.09)" strokeWidth="0.8"/>
    <rect x="54" y="27" width="8" height="2" rx="1" fill="rgba(0,0,0,0.12)"/>
    <rect x="36" y="27" width="8" height="2" rx="1" fill="rgba(0,0,0,0.12)"/>
    <rect x="14" y="33" width="62" height="3" rx="1.5" fill="#b8bec8"/>
    <path d="M78 28 Q84 28 84 32 L84 34 Q84 36 82 36 L78 36 Z" fill="#c8cdd8"/>
    <rect x="79" y="22" width="5" height="6" rx="2" fill="#e8eef8" opacity="0.9"/>
    <path d="M12 28 Q6 28 6 32 L6 34 Q6 36 8 36 L12 36 Z" fill="#c0c6d2"/>
    <rect x="6" y="22" width="5" height="6" rx="2" fill="#e87070" opacity="0.75"/>
    <circle cx="67" cy="36" r="8" fill="#22262e"/><circle cx="67" cy="36" r="5.5" fill="#383d4a"/><circle cx="67" cy="36" r="2.5" fill="#606472"/><circle cx="67" cy="36" r="1.2" fill="#888ea0"/>
    <circle cx="23" cy="36" r="8" fill="#22262e"/><circle cx="23" cy="36" r="5.5" fill="#383d4a"/><circle cx="23" cy="36" r="2.5" fill="#606472"/><circle cx="23" cy="36" r="1.2" fill="#888ea0"/>
    <path d="M10 30 Q10 20 14 20 L22 20 Q20 22 18 30 Z" fill="url(#carBody)"/>
    <path d="M72 20 L76 20 Q82 20 82 28 L82 30 Q78 22 74 20 Z" fill="url(#carBody)"/>
  </svg>
);

const SPLIT = 61;

export default function HomePage() {
  const { goTo, setState } = useApp();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSuccess, setModalSuccess] = useState(false);
  const [typeVal, setTypeVal] = useState<"driver" | "host">("driver");
  const [refCode, setRefCode] = useState("");

  function applyCode() {
    if (!refCode.trim()) return;
    setModalSuccess(true);
    setState(s => ({ ...s, accountType: typeVal === "driver" ? "renter" : "padRenter" }));
  }
  function closeModal() { setModalOpen(false); setModalSuccess(false); setRefCode(""); }

  function handleFindAPad() {
    setState(s => ({ ...s, accountType: "renter" }));
    if (user || loading) { goTo("find"); } else { navigate("/signin"); }
  }

  function handleListMyPad() {
    setState(s => ({ ...s, accountType: "padRenter" }));
    goTo("padtype");
  }

  function handleSignIn() {
    if (user) { goTo("find"); } else { navigate("/signin"); }
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>

      {/* ── NAVY SECTION ── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: `${SPLIT}%`,
        background: "#0E1F40", display: "flex", flexDirection: "column",
        alignItems: "center", padding: "48px 20px 0", boxSizing: "border-box", zIndex: 5,
      }}>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 24, flexShrink: 0 }}>
          <div style={{ filter: "drop-shadow(0 6px 20px rgba(0,0,0,0.35))" }}>
            <CarSVG />
          </div>
        </div>

        <p style={{ textAlign: "center", margin: "18px 0 6px", fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: "#8DD63F", textTransform: "uppercase", flexShrink: 0 }}>For Drivers</p>
        <h1 style={{ textAlign: "center", margin: "0 0 20px", fontSize: 32, fontWeight: 800, color: "#fff", lineHeight: 1.15, letterSpacing: "-0.03em", flexShrink: 0 }}>
          Find parking<br />near you.
        </h1>

        <button
          onClick={handleFindAPad}
          style={{ width: "100%", background: "#8DD63F", color: "#0E1F40", border: "none", borderRadius: 50, padding: "16px", fontSize: 16, fontWeight: 800, cursor: "pointer", letterSpacing: "-0.01em", flexShrink: 0, boxShadow: "0 4px 18px rgba(141,214,63,0.30)" }}
        >
          Find a pad
        </button>
      </div>

      {/* ── WHITE SECTION ── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: `${100 - SPLIT}%`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end",
        padding: "0 20px 28px", zIndex: 5, boxSizing: "border-box", gap: 12,
      }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(14,31,64,0.38)", textTransform: "uppercase", textAlign: "center" }}>For Pad Renters</p>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#0E1F40", textAlign: "center", letterSpacing: "-0.01em" }}>Rent your pad. Earn money.</p>
        <button
          onClick={handleListMyPad}
          style={{ width: "100%", background: "transparent", border: "2px solid #0E1F40", borderRadius: 50, padding: "14px", fontSize: 15, fontWeight: 700, color: "#0E1F40", cursor: "pointer", letterSpacing: "-0.01em" }}
        >
          List my lily pad
        </button>
        <button
          onClick={handleSignIn}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "rgba(14,31,64,0.45)", fontFamily: "inherit", textDecoration: "underline", textDecorationColor: "rgba(14,31,64,0.2)", padding: "4px 0" }}
        >
          Sign in
        </button>
        <div onClick={() => setModalOpen(true)} style={{ fontSize: 12, color: "rgba(14,31,64,0.38)", cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(14,31,64,0.2)" }}>
          Have a referral code?
        </div>
      </div>

      {/* Referral modal */}
      <div className={`modal-overlay${modalOpen ? " show" : ""}`} onClick={closeModal}>
        <div className="modal-sheet" onClick={e => e.stopPropagation()}>
          <div className="modal-handle" />
          {!modalSuccess ? (
            <div>
              <p className="modal-title">Enter referral code</p>
              <p className="modal-sub">Choose your account type then enter the code you received.</p>
              <div className="modal-type-row">
                <button className={`modal-type-btn${typeVal === "driver" ? " active" : ""}`} onClick={() => setTypeVal("driver")}>Driver</button>
                <button className={`modal-type-btn${typeVal === "host" ? " active" : ""}`} onClick={() => setTypeVal("host")}>Host</button>
              </div>
              <div className="modal-input-wrap">
                <input className="modal-input" placeholder="Enter code" maxLength={10} value={refCode} onChange={e => setRefCode(e.target.value)} />
              </div>
              <button className="modal-apply-btn" onClick={applyCode}>Apply code</button>
              <p className="modal-dismiss" onClick={closeModal}>Dismiss</p>
            </div>
          ) : (
            <div className="modal-success" style={{ display: "flex" }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(141,214,63,0.15)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <p style={{ textAlign: "center", fontWeight: 700, fontSize: 18, color: "#0E1F40", margin: "0 0 8px" }}>Code applied!</p>
              <p style={{ textAlign: "center", fontSize: 13, color: "rgba(14,31,64,0.5)", margin: 0 }}>Your referral benefit has been added to your account.</p>
              <button className="modal-apply-btn" style={{ marginTop: 18 }} onClick={closeModal}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
