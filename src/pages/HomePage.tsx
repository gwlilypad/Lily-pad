import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { PadSVG } from "@/components/PadSVG";
import lilypadLogo from "@/assets/lilypad-logo-full.png";

function AdminSlide({ open }: { open: boolean }) {
  return (
    <div style={{
      position: "absolute", left: "100%", top: 0, width: "100%", height: "100%",
      background: "#F4F7FA", display: "flex", flexDirection: "column", overflow: "hidden",
      transform: open ? "translateX(-100%)" : "translateX(0)",
      transition: "transform 0.42s cubic-bezier(0.32,0.72,0,1)",
      zIndex: 200,
    }}>
      <div style={{ background: "#0E1F40", padding: "48px 24px 28px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <PadSVG size={36} />
        <div>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", margin: 0 }}>lily pad</p>
          <p style={{ color: "#fff", fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>Admin</p>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 14, color: "rgba(14,31,64,0.3)", fontFamily: '"DM Sans", sans-serif' }}>Loading…</p>
      </div>
    </div>
  );
}

const CarSVG = () => (
  <svg width="97" height="47" viewBox="0 0 90 44" fill="none" xmlns="http://www.w3.org/2000/svg">
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
const PAD_SIZE = 64;
const PAD_HALF = PAD_SIZE / 2;
const CONNECT_THRESHOLD = 0.72;

export default function HomePage() {
  const { goTo, setState } = useApp();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSuccess, setModalSuccess] = useState(false);
  const [authPrompt, setAuthPrompt] = useState(false);
  const [typeVal, setTypeVal] = useState<"driver" | "host">("driver");
  const [refCode, setRefCode] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);

  const [padX, setPadX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartClientX = useRef(0);
  const dragStarted = useRef(false);
  const triggered = useRef(false);

  function maxDrag() {
    const w = containerRef.current?.offsetWidth ?? window.innerWidth;
    return w / 2 - PAD_HALF - 8;
  }

  useEffect(() => {
    return () => { triggered.current = false; };
  }, []);

  function triggerConnect() {
    if (triggered.current) return;
    triggered.current = true;
    const mx = maxDrag();
    setPadX(mx);
    setDragging(false);
    setConnecting(true);
    setTimeout(() => {
      setAdminOpen(true);
      setTimeout(() => {
        goTo("admin");
      }, 520);
    }, 280);
  }

  function openAdmin() {
    triggered.current = false;
    setAdminOpen(true);
    setTimeout(() => {
      goTo("admin");
    }, 620);
  }

  function onPadDown(e: React.PointerEvent) {
    if (connecting) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartClientX.current = e.clientX;
    dragStarted.current = true;
    triggered.current = false;
    setDragging(true);
  }

  function onPadMove(e: React.PointerEvent) {
    if (!dragStarted.current || connecting) return;
    const dx = Math.max(0, e.clientX - dragStartClientX.current);
    const mx = maxDrag();
    const clamped = Math.min(dx, mx);
    setPadX(clamped);
    if (clamped >= mx) {
      dragStarted.current = false;
      triggerConnect();
    }
  }

  function onPadUp() {
    if (!dragStarted.current) return;
    dragStarted.current = false;
    setDragging(false);
    const mx = maxDrag();
    if (padX >= mx * CONNECT_THRESHOLD) {
      triggerConnect();
    } else {
      setPadX(0);
      triggered.current = false;
    }
  }

  function onPadCancel() {
    dragStarted.current = false;
    setDragging(false);
    if (!connecting) { setPadX(0); triggered.current = false; }
  }

  function applyCode() {
    if (!refCode.trim()) return;
    setModalSuccess(true);
    setState(s => ({ ...s, accountType: typeVal === "driver" ? "renter" : "padRenter" }));
  }
  function closeModal() { setModalOpen(false); setModalSuccess(false); setRefCode(""); }

  function handleFindAPad() {
    setState(s => ({ ...s, accountType: "renter" }));
    if (user) { goTo("find"); } else { setAuthPrompt(true); }
  }

  function handleListMyPad() {
    setState(s => ({ ...s, accountType: "padRenter" }));
    goTo("padtype");
  }

  function handleSignIn() {
    if (user) { goTo("find"); } else { navigate("/signin"); }
  }

  const mx = maxDrag();
  const progress = mx > 0 ? Math.min(padX / mx, 1) : 0;
  const trackOpacity = dragging || padX > 0 ? 1 : 0;
  const dockGlow = progress > 0.5 ? progress : 0;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", userSelect: "none" }}
    >
      {/* ── NAVY SECTION ── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: `${SPLIT}%`,
        background: "#0E1F40", display: "flex", flexDirection: "column",
        alignItems: "center", padding: "48px 20px 0", boxSizing: "border-box", zIndex: 5,
      }}>
        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ marginLeft: -2, marginTop: -6 }}>
            <img src={lilypadLogo} alt="Lily Pad" style={{ width: 140, height: "auto", display: "block" }} />
          </div>
        </div>

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
          Find a Lily Pad
        </button>
      </div>

      {/* ── WHITE SECTION ── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: `${100 - SPLIT}%`,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end",
        padding: "0 20px 28px", zIndex: 5, boxSizing: "border-box", gap: 12,
      }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(14,31,64,0.38)", textTransform: "uppercase", textAlign: "center" }}>For Hosts</p>
        <p style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "#0E1F40", textAlign: "center", letterSpacing: "-0.01em" }}>List your Lily Pad. Earn Money.</p>
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

      {/* ── HORIZONTAL DRAG TRACK ── */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${SPLIT}%`,
          transform: "translate(0, -50%)",
          width: `calc(50% - ${PAD_HALF + 8}px)`,
          height: 2,
          zIndex: 8,
          opacity: trackOpacity,
          transition: dragging ? "none" : "opacity 0.4s ease",
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "100%",
          background: "rgba(141,214,63,0.18)",
          borderRadius: 2,
        }} />
        <div style={{
          position: "absolute", top: 0, left: 0, height: "100%",
          width: `${progress * 100}%`,
          background: `rgba(141,214,63,${0.4 + progress * 0.5})`,
          borderRadius: 2,
          transition: dragging ? "none" : "width 0.35s cubic-bezier(0.22,1,0.36,1)",
          boxShadow: progress > 0.3 ? `0 0 ${6 + progress * 8}px rgba(141,214,63,${0.3 + progress * 0.4})` : "none",
        }} />
        <div style={{
          position: "absolute", right: -14, top: "50%",
          transform: "translate(50%, -50%)",
          width: 28, height: 28, borderRadius: "50%",
          border: `2px solid rgba(141,214,63,${0.3 + dockGlow * 0.7})`,
          background: `rgba(141,214,63,${dockGlow * 0.25})`,
          boxShadow: dockGlow > 0 ? `0 0 ${8 + dockGlow * 16}px rgba(141,214,63,${dockGlow * 0.6})` : "none",
          transition: dragging ? "none" : "all 0.3s ease",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            stroke={`rgba(141,214,63,${0.3 + dockGlow * 0.7})`} strokeWidth="2.5" strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
      </div>

      {/* ── DRAGGABLE LILY PAD (divider) ── */}
      <div
        onPointerDown={onPadDown}
        onPointerMove={onPadMove}
        onPointerUp={onPadUp}
        onPointerCancel={onPadCancel}
        onContextMenu={e => e.preventDefault()}
        style={{
          position: "absolute",
          left: `calc(50% + ${padX}px)`,
          top: `${SPLIT}%`,
          transform: "translate(-50%, -50%)",
          width: PAD_SIZE, height: PAD_SIZE,
          zIndex: 10,
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          transition: dragging ? "none" : (connecting ? "left 0.28s cubic-bezier(0.34,1.48,0.64,1)" : "left 0.42s cubic-bezier(0.22,1,0.36,1)"),
          filter: connecting
            ? "drop-shadow(0 0 14px rgba(141,214,63,0.9))"
            : progress > 0.3
              ? `drop-shadow(0 0 ${4 + progress * 10}px rgba(141,214,63,${0.3 + progress * 0.5}))`
              : "none",
        }}
      >
        <PadSVG size={PAD_SIZE} />
      </div>

      {/* Connect flash overlay */}
      {connecting && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 190, pointerEvents: "none",
          background: "rgba(141,214,63,0.12)",
          opacity: adminOpen ? 0 : 1,
          transition: "opacity 0.3s ease",
        }} />
      )}

      {/* Admin slide panel */}
      <AdminSlide open={adminOpen} />

      {/* Auth prompt modal — shown when logged-out user taps Find a Lily Pad */}
      <div className={`modal-overlay${authPrompt ? " show" : ""}`} onClick={() => setAuthPrompt(false)}>
        <div className="modal-sheet" onClick={e => e.stopPropagation()}>
          <div className="modal-handle" />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(141,214,63,0.13)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0E1F40", letterSpacing: "-0.02em" }}>Find a Lily Pad</p>
              <p style={{ margin: 0, fontSize: 12, color: "rgba(14,31,64,0.45)", marginTop: 2 }}>Sign in or create a free account to continue.</p>
            </div>
          </div>
          <button
            onClick={() => { setAuthPrompt(false); navigate("/signin"); }}
            style={{ width: "100%", background: "#0E1F40", color: "#fff", border: "none", borderRadius: 50, padding: "15px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10 }}
          >
            Sign in
          </button>
          <button
            onClick={() => { setAuthPrompt(false); goTo("signup"); }}
            style={{ width: "100%", background: "transparent", color: "#0E1F40", border: "2px solid #0E1F40", borderRadius: 50, padding: "13px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 6 }}
          >
            Create account
          </button>
          <p style={{ textAlign: "center", fontSize: 12, color: "rgba(14,31,64,0.35)", margin: "8px 0 0", cursor: "pointer" }} onClick={() => setAuthPrompt(false)}>Maybe later</p>
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
