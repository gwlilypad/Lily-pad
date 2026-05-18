import { useApp } from "@/context/AppContext";

const QR_PATTERN = [
  1,1,1,1,1,1,1,0,1,1,0,1,1,0,1,1,
  1,0,0,0,0,0,1,0,0,1,0,0,0,0,1,0,
  1,0,1,1,1,0,1,0,1,0,1,1,1,0,0,1,
  1,0,1,1,1,0,1,0,0,1,0,1,0,1,1,0,
  1,0,1,1,1,0,1,0,1,1,0,0,1,0,0,1,
  1,0,0,0,0,0,1,0,0,1,1,0,0,0,1,0,
  1,1,1,1,1,1,1,0,1,0,1,0,1,0,1,1,
  0,0,0,0,0,0,0,0,0,1,0,1,1,0,0,0,
];

export default function ConfirmPage() {
  const { goTo } = useApp();

  return (
    <div className="page active" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#0E1F40", padding: "44px 20px 20px", flexShrink: 0, textAlign: "center" }}>
        <div className="conf-icon" style={{ margin: "0 auto 14px" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h1 style={{ color: "#fff", fontSize: 24, fontWeight: 200 }}>You're all set!</h1>
        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, fontWeight: 300, marginTop: 4 }}>Booking confirmed · Apr 15, 2026</p>
      </div>
      <div className="s-divider" />
      <div className="s-body">
        {/* QR Code */}
        <div className="qr-wrap">
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", color: "rgba(14,31,64,0.3)", textTransform: "uppercase", marginBottom: 12 }}>Show this to the host</p>
          <div className="qr-grid">
            {QR_PATTERN.map((cell, i) => (
              <div key={i} className="qr-cell" style={{ background: cell ? "#0E1F40" : "transparent" }} />
            ))}
          </div>
          <p className="qr-hint">LP-2026-04-15-0042</p>
        </div>

        {/* Booking details */}
        <div className="conf-card">
          <div className="conf-row"><span className="conf-lbl">Spot</span><span className="conf-val">142 Maple Ave</span></div>
          <div className="conf-row"><span className="conf-lbl">Date</span><span className="conf-val">Tuesday, Apr 15</span></div>
          <div className="conf-row"><span className="conf-lbl">Time</span><span className="conf-val">9:00 AM – 5:00 PM</span></div>
          <div className="conf-row"><span className="conf-lbl">Duration</span><span className="conf-val">8 hours</span></div>
          <div className="conf-row"><span className="conf-lbl">Total</span><span className="conf-val" style={{ fontWeight: 600 }}>$27.60</span></div>
        </div>

        {/* Host info */}
        <div style={{ background: "#fff", borderRadius: 14, border: "0.5px solid rgba(14,31,64,0.08)", padding: "11px 13px", display: "flex", alignItems: "center", gap: 10, marginBottom: 12, width: "100%" }}>
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "#0E1F40", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13 }}>AJ</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#0E1F40" }}>Alex Johnson</div>
            <div style={{ fontSize: 11, fontWeight: 300, color: "rgba(14,31,64,0.4)" }}>Your host · (555) 234-5678</div>
          </div>
        </div>

        <button className="dir-btn" onClick={() => alert("Opening maps...")}>Get directions</button>
        <button style={{ width: "100%", padding: "12px 0", background: "transparent", color: "rgba(14,31,64,0.5)", fontSize: 13, fontWeight: 400, border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginTop: 8 }} onClick={() => goTo("find")}>
          Back to search
        </button>
      </div>
    </div>
  );
}
