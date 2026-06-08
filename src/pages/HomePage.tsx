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

const SPLIT = 57;
const CONNECT_THRESHOLD = 0.72;

export default function HomePage() {
  const { goTo, setState } = useApp();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSuccess, setModalSuccess] = useState(false);
  const [authPrompt, setAuthPrompt] = useState(false);
  const [typeVal, setTypeVal] = useState<"driver" | "host">("driver");
  const [refCode, setRefCode] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);

  const [logoX, setLogoX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartClientX = useRef(0);
  const dragStarted = useRef(false);
  const triggered = useRef(false);

  function maxDrag() {
    const w = containerRef.current?.offsetWidth ?? window.innerWidth;
    return w * 0.40;
  }

  useEffect(() => {
    return () => { triggered.current = false; };
  }, []);

  function triggerConnect() {
    if (triggered.current) return;
    triggered.current = true;
    setLogoX(maxDrag());
    setDragging(false);
    setConnecting(true);
    setTimeout(() => {
      setAdminOpen(true);
      setTimeout(() => { goTo("admin"); }, 520);
    }, 280);
  }

  function onLogoDown(e: React.PointerEvent) {
    if (connecting) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartClientX.current = e.clientX;
    dragStarted.current = true;
    triggered.current = false;
    setDragging(true);
  }

  function onLogoMove(e: React.PointerEvent) {
    if (!dragStarted.current || connecting) return;
    const dx = Math.max(0, e.clientX - dragStartClientX.current);
    const mx = maxDrag();
    const clamped = Math.min(dx, mx);
    setLogoX(clamped);
    if (clamped >= mx * CONNECT_THRESHOLD) { dragStarted.current = false; triggerConnect(); }
  }

  function onLogoUp() {
    if (!dragStarted.current) return;
    dragStarted.current = false;
    setDragging(false);
    const mx = maxDrag();
    if (logoX >= mx * CONNECT_THRESHOLD) { triggerConnect(); }
    else { setLogoX(0); triggered.current = false; }
  }

  function onLogoCancel() {
    dragStarted.current = false;
    setDragging(false);
    if (!connecting) { setLogoX(0); triggered.current = false; }
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

  const mx = maxDrag();
  const progress = mx > 0 ? Math.min(logoX / mx, 1) : 0;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", userSelect: "none", fontFamily: '"DM Sans", sans-serif' }}
    >

      {/* ── NAVY SECTION ── */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: `${SPLIT}%`,
        background: "#0E1F40",
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: 0, boxSizing: "border-box", zIndex: 5,
      }}>

        {/* ── LOGO (draggable right → admin) — pinned to top ── */}
        <div
          onPointerDown={onLogoDown}
          onPointerMove={onLogoMove}
          onPointerUp={onLogoUp}
          onPointerCancel={onLogoCancel}
          onContextMenu={e => e.preventDefault()}
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 12px)",
            flex: "0 0 auto",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            width: "100%",
            transform: `translateX(${logoX}px)`,
            transition: dragging
              ? "none"
              : connecting
                ? "transform 0.28s cubic-bezier(0.34,1.48,0.64,1), filter 0.2s ease"
                : "transform 0.42s cubic-bezier(0.22,1,0.36,1), filter 0.2s ease",
            filter: connecting
              ? "drop-shadow(0 0 16px rgba(141,214,63,0.95))"
              : progress > 0.25
                ? `drop-shadow(0 0 ${4 + progress * 12}px rgba(141,214,63,${0.25 + progress * 0.6}))`
                : "none",
            cursor: connecting ? "default" : dragging ? "grabbing" : "grab",
            touchAction: "none",
            WebkitUserSelect: "none",
          }}
        >
          <img src={lilypadLogo} alt="Lily Pad" style={{ width: "100%", height: "auto", display: "block", pointerEvents: "none" }} />
        </div>

        {/* Centre content: headline + button — anchored fixed distance above FOR DRIVERS */}
        <div style={{
          position: "absolute",
          bottom: 95,
          left: 24, right: 24,
          display: "flex", flexDirection: "column",
          alignItems: "center",
        }}>
          <h1 style={{
            textAlign: "center", margin: "0 0 16px",
            fontSize: 20, fontWeight: 800, color: "#fff",
            lineHeight: 1.2, letterSpacing: "-0.03em", width: "100%",
          }}>
            Your neighbor saved<br />you a spot.
          </h1>

          <button
            onClick={handleFindAPad}
            style={{
              width: "80%", background: "#8DD63F", color: "#0E1F40",
              border: "none", borderRadius: 50, padding: "12px",
              fontSize: 12, fontWeight: 800, cursor: "pointer",
              letterSpacing: "-0.01em",
              boxShadow: "0 4px 20px rgba(141,214,63,0.28)",
            }}
          >
            Start Parking
          </button>
        </div>

        {/* FOR DRIVERS — same distance from dividing line as FOR HOSTS is on the other side */}
        <p style={{
          position: "absolute", bottom: 70, left: 0, right: 0,
          margin: 0, fontSize: 10, fontWeight: 700,
          letterSpacing: "0.22em", color: "rgba(255,255,255,0.30)",
          textTransform: "uppercase", textAlign: "center",
        }}>
          For Drivers
        </p>
      </div>

      {/* ── LIGHT SECTION ── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: `${100 - SPLIT}%`,
        background: "#F0F2F7",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "flex-start",
        padding: "70px 24px calc(env(safe-area-inset-bottom) + 24px)",
        boxSizing: "border-box", zIndex: 5,
      }}>

        {/* FOR HOSTS — top of white section, near the line */}
        <p style={{
          margin: "0 0 10px", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.22em", color: "rgba(14,31,64,0.33)",
          textTransform: "uppercase", textAlign: "center",
        }}>
          For Hosts
        </p>

        <h2 style={{
          margin: "0 0 12px", fontSize: 19, fontWeight: 800,
          color: "#0E1F40", letterSpacing: "-0.03em",
          textAlign: "center", lineHeight: 1.18,
        }}>
          List your driveway.
        </h2>

        <button
          onClick={handleListMyPad}
          style={{
            width: "80%", background: "transparent",
            border: "2.5px solid #0E1F40", borderRadius: 50,
            padding: "11px", fontSize: 11, fontWeight: 800,
            color: "#0E1F40", cursor: "pointer",
            letterSpacing: "-0.01em", marginBottom: 10,
          }}
        >
          Start Earning
        </button>

        <p style={{
          margin: "0 0 5px", fontSize: 11, fontWeight: 600,
          color: "rgba(14,31,64,0.36)", textAlign: "center",
          letterSpacing: "0.10em", textTransform: "uppercase",
        }}>
          FAQ
        </p>

        <div
          onClick={() => setModalOpen(true)}
          style={{
            fontSize: 12, color: "rgba(14,31,64,0.42)", cursor: "pointer",
            textDecoration: "underline", textDecorationColor: "rgba(14,31,64,0.22)",
            textAlign: "center",
          }}
        >
          Have a referral code?
        </div>
      </div>

      {/* Connect flash */}
      {connecting && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 190, pointerEvents: "none",
          background: "rgba(141,214,63,0.10)",
          opacity: adminOpen ? 0 : 1, transition: "opacity 0.3s ease",
        }} />
      )}

      <AdminSlide open={adminOpen} />

      {/* ── AUTH PROMPT MODAL ── */}
      <div className={`modal-overlay${authPrompt ? " show" : ""}`} onClick={() => setAuthPrompt(false)}>
        <div className="modal-sheet" onClick={e => e.stopPropagation()}>
          <div className="modal-handle" />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(141,214,63,0.13)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0E1F40", letterSpacing: "-0.02em" }}>Start Parking</p>
              <p style={{ margin: 0, fontSize: 12, color: "rgba(14,31,64,0.45)", marginTop: 2 }}>Sign in or create a free account to continue.</p>
            </div>
          </div>
          <button
            onClick={() => { setAuthPrompt(false); navigate("/signin"); }}
            style={{ width: "100%", background: "#0E1F40", color: "#fff", border: "none", borderRadius: 50, padding: "15px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 10, fontFamily: '"DM Sans", sans-serif' }}
          >
            Sign in
          </button>
          <button
            onClick={() => { setAuthPrompt(false); goTo("signup"); }}
            style={{ width: "100%", background: "transparent", color: "#0E1F40", border: "2px solid #0E1F40", borderRadius: 50, padding: "13px", fontSize: 15, fontWeight: 700, cursor: "pointer", marginBottom: 6, fontFamily: '"DM Sans", sans-serif' }}
          >
            Create account
          </button>
          <p style={{ textAlign: "center", fontSize: 12, color: "rgba(14,31,64,0.35)", margin: "8px 0 0", cursor: "pointer" }} onClick={() => setAuthPrompt(false)}>Maybe later</p>
        </div>
      </div>

      {/* ── REFERRAL MODAL ── */}
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
