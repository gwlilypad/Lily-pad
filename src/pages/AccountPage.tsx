import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import TabBar from "@/components/TabBar";

export default function AccountPage() {
  const { goTo, state, setState } = useApp();
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const firstName = profile?.first_name || state.suAns?.[0] || "Alex";
  const lastName  = profile?.last_name  || state.suAns?.[1] || "J.";
  const email     = profile?.email      || state.suAns?.[2] || "alex@email.com";
  const phone     = profile?.phone      || state.suAns?.[3] || "(555) 000-0000";
  const address   = state.apAns?.[0] || "123 Main St";
  const name      = `${firstName} ${lastName}`.trim();
  const initials  = ((firstName[0] || "A") + (lastName[0] || "J")).toUpperCase();

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
        <p className="profile-badge">Pad Renter</p>
      </div>
      <div className="s-divider" />
      <div className="s-body" style={{ background: "#F4F7FA" }}>
        <span className="section-header">Your info</span>
        <div className="info-card">
          <div className="info-row"><span className="info-lbl">Name</span><span className="info-val">{name}</span><span className="info-edit">Edit</span></div>
          <div className="info-row"><span className="info-lbl">Email</span><span className="info-val">{email}</span><span className="info-edit">Edit</span></div>
          <div className="info-row"><span className="info-lbl">Phone</span><span className="info-val">{phone}</span><span className="info-edit">Edit</span></div>
          <div className="info-row"><span className="info-lbl">Address</span><span className="info-val">{address}</span><span className="info-edit">Edit</span></div>
        </div>

        <span className="section-header">Your pad</span>
        <div className="thumb-nav-card">
          <div className="thumb-nav-row" onClick={() => goTo("addpad")}><span className="thumb-nav-lbl">My lily pad</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row" onClick={() => goTo("availability")}><span className="thumb-nav-lbl">Availability & pricing</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row"><span className="thumb-nav-lbl">Bookings</span><span className="thumb-nav-arrow">›</span></div>
          <div className="thumb-nav-row"><span className="thumb-nav-lbl">Earnings</span><span className="thumb-nav-arrow">›</span></div>
        </div>

        <div className="thumb-nav-card" style={{ marginTop: 16 }}>
          <div className="thumb-nav-row" onClick={handleSignOut}><span className="thumb-nav-lbl" style={{ color: "rgba(229,57,53,0.8)" }}>Sign out</span><span className="thumb-nav-arrow">›</span></div>
        </div>
      </div>
      <TabBar active="account" goTo={goTo} mode="host" />
    </div>
  );
}
