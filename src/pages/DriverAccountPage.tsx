import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import TabBar from "@/components/TabBar";

export default function DriverAccountPage() {
  const { goTo, state, setState } = useApp();
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const firstName = profile?.first_name || state.drAns?.[0] || "Jordan";
  const lastName  = profile?.last_name  || state.drAns?.[1] || "S.";
  const email     = profile?.email      || state.drAns?.[2] || "jordan@email.com";
  const phone     = profile?.phone      || state.drAns?.[3] || "(555) 000-0000";
  const vehicle   = state.drAns?.[4] || "2022 Honda Civic";
  const name      = `${firstName} ${lastName}`.trim();
  const initials  = ((firstName[0] || "J") + (lastName[0] || "S")).toUpperCase();

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  return (
    <div className="page active" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ background: "#0E1F40", padding: "44px 24px 20px", flexShrink: 0 }}>
        <button onClick={() => { setState(s => ({ ...s, openAcctOnFind: true })); navigate(-1); }} style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div className="profile-avatar"><span className="avatar-initials">{initials}</span></div>
        <p className="profile-name">{name}</p>
        <p className="profile-badge">Driver</p>
      </div>
      <div className="s-divider" />
      <div className="s-body" style={{ background: "#F4F7FA" }}>
        <span className="section-header">Your info</span>
        <div className="info-card">
          <div className="info-row"><span className="info-lbl">Name</span><span className="info-val">{name}</span><span className="info-edit">Edit</span></div>
          <div className="info-row"><span className="info-lbl">Email</span><span className="info-val">{email}</span><span className="info-edit">Edit</span></div>
          <div className="info-row"><span className="info-lbl">Phone</span><span className="info-val">{phone}</span><span className="info-edit">Edit</span></div>
          <div className="info-row"><span className="info-lbl">Vehicle</span><span className="info-val">{vehicle}</span><span className="info-edit">Edit</span></div>
        </div>

        <div className="thumb-nav-card" style={{ marginTop: 8 }}>
          <div className="thumb-nav-row" onClick={handleSignOut}><span className="thumb-nav-lbl" style={{ color: "rgba(229,57,53,0.8)" }}>Sign out</span><span className="thumb-nav-arrow">›</span></div>
        </div>
      </div>
      <TabBar active="driveraccount" goTo={goTo} mode="driver" />
    </div>
  );
}
