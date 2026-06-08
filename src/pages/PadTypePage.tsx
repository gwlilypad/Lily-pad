import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import OnboardingModal from "@/components/OnboardingModal";

export default function PadTypePage() {
  const navigate = useNavigate();
  const { goTo } = useApp();
  const { user } = useAuth();
  return (
    <div className="page active">
      <OnboardingModal />
      <div className="s-header" style={{ padding: "44px 28px 28px" }}>
        <p className="s-step">Get started</p>
        <h1 className="s-title">What type of pad do you have?</h1>
      </div>
      <div className="s-divider" />
      <div style={{ flex: 1, background: "#0E1F40", display: "flex", flexDirection: "column", alignItems: "center", padding: "20px 28px 36px" }}>
        <div style={{ width: "100%", padding: "6px 0 20px" }}>
          <button className="back-btn" onClick={() => navigate(-1)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontFamily: "'DM Sans', sans-serif" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>Back</span>
          </button>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%", gap: 22, paddingBottom: 20 }}>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <button onClick={() => goTo(user ? "addpad" : "signup")} style={{ width: "80%", padding: "12px", background: "#fff", color: "#0E1F40", fontSize: 12, fontWeight: 800, border: "none", borderRadius: 50, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.01em" }}>Personal</button>
            <p style={{ fontSize: 12, fontWeight: 300, color: "rgba(255,255,255,0.45)", textAlign: "center", lineHeight: 1.5, padding: "0 16px" }}>Driveway, garage, or private home parking spot</p>
          </div>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <button onClick={() => goTo("bizsignup")} style={{ width: "80%", padding: "12px", background: "#fff", color: "#0E1F40", fontSize: 12, fontWeight: 800, border: "none", borderRadius: 50, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.01em" }}>Business</button>
            <p style={{ fontSize: 12, fontWeight: 300, color: "rgba(255,255,255,0.45)", textAlign: "center", lineHeight: 1.5, padding: "0 16px" }}>Church, parking lot, commercial property, or 4+ spots</p>
          </div>
          <p style={{ fontSize: 11, fontWeight: 300, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "0 20px", lineHeight: 1.6, marginTop: 4 }}>Not sure? Choose Personal for your own home, Business if you manage a lot or multiple spots.</p>
        </div>
      </div>
    </div>
  );
}
