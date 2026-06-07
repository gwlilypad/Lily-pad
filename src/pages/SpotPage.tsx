import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";

export default function SpotPage() {
  const { goTo } = useApp();
  const navigate = useNavigate();
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const openDays = new Set([1, 2, 3, 4, 5]);

  return (
    <div className="page active" style={{ display: "flex", flexDirection: "column" }}>
      {/* Hero */}
      <div className="spot-hero">
        <div className="spot-hero-overlay" />
        <button className="spot-hero-back" onClick={() => navigate(-1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
        </button>
        <div className="spot-hero-price" style={{ zIndex: 2 }}>$3/hr</div>
        <div style={{ position: "absolute", bottom: 14, right: 14, zIndex: 2 }}>
          <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: 100, padding: "4px 10px", fontSize: 10, fontWeight: 600, color: "#0E1F40", letterSpacing: "0.1em" }}>OPEN NOW</div>
        </div>
      </div>

      {/* Body */}
      <div className="spot-detail-body">
        <p className="spot-title">Private driveway on Maple Ave</p>
        <p className="spot-sub">142 Maple Ave · 0.2 mi away</p>

        <div className="spot-info-row">
          <div className="spot-info-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
          </div>
          <span className="spot-info-txt">Driveway · Concrete · Up to 4 vehicles</span>
        </div>
        <div className="spot-info-row">
          <div className="spot-info-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
          </div>
          <span className="spot-info-txt">7:00 AM – 7:00 PM daily</span>
        </div>
        <div className="spot-info-row">
          <div className="spot-info-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          </div>
          <span className="spot-info-txt">Instant booking available</span>
        </div>

        <div className="spot-days">
          {DAYS.map((d, i) => (
            <div key={d} className={`spot-day${openDays.has(i) ? " on" : ""}`}>{d}</div>
          ))}
        </div>

        <p style={{ fontSize: 12, fontWeight: 300, color: "rgba(14,31,64,0.5)", lineHeight: 1.6, marginTop: 10 }}>
          Clean, wide driveway with room for a full-size SUV. Enter from the Maple Ave side. Look for the white fence on the right.
        </p>

        {/* Host */}
        <div className="spot-host">
          <div className="spot-host-av">AJ</div>
          <div>
            <div className="spot-host-name">Alex Johnson</div>
            <div className="spot-host-sub">Pad Renter · Member since 2024</div>
          </div>
        </div>
      </div>

      {/* Book bar */}
      <div className="book-bar">
        <div className="book-price">
          <div className="book-price-main">$3 / hr</div>
          <div className="book-price-sub">$18 daily max</div>
        </div>
        <button className="book-btn" onClick={() => goTo("booking")}>Book this pad</button>
      </div>
    </div>
  );
}
