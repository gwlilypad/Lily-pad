import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import TabBar from "@/components/TabBar";

export default function DriverAccountPage() {
  const { goTo, state } = useApp();
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
        <button onClick={() => goTo("find")} style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", marginBottom: 16 }}>
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

        <span className="section-header">Bookings</span>
        <div className="thumb-nav-card">
          <div className="thumb-nav-row" onClick={() => goTo("find")}><span className="thumb-nav-lbl">Find a spot</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row" onClick={() => goTo("bookings")}><span className="thumb-nav-lbl">Upcoming bookings</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row" onClick={() => goTo("bookings")}><span className="thumb-nav-lbl">Past bookings</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row"><span className="thumb-nav-lbl">Favorites</span><span className="thumb-nav-arrow">›</span></div>
        </div>

        <span className="section-header">Referrals</span>
        <div className="referral-card">
          <div className="ref-header">
            <div className="ref-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </div>
            <span className="ref-title">Invite friends</span>
          </div>
          <p className="ref-sub">Share your code. When friends book their first pad, you both save.</p>
          <div className="ref-code-row">
            <span className="ref-code">DRIVE10</span>
            <button className="ref-copy-btn" onClick={() => navigator.clipboard.writeText("DRIVE10").catch(() => {})}>Copy</button>
          </div>
          <p className="ref-earn">0 referrals so far · $0 saved</p>
        </div>

        <span className="section-header">Settings</span>
        <div className="thumb-nav-card">
          <div className="thumb-nav-row"><span className="thumb-nav-lbl">Notifications</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row"><span className="thumb-nav-lbl">Payment methods</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row"><span className="thumb-nav-lbl">Privacy & terms</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row" onClick={handleSignOut}><span className="thumb-nav-lbl" style={{ color: "rgba(229,57,53,0.8)" }}>Sign out</span><span className="thumb-nav-arrow">›</span></div>
        </div>
      </div>
      <TabBar active="driveraccount" goTo={goTo} mode="driver" />
    </div>
  );
}
