import { useNavigate, useLocation } from "react-router-dom";

interface TabBarProps {
  active?: "find" | "account" | "driveraccount";
  goTo?: (page: string) => void;
  mode?: "driver" | "host";
}

export default function TabBar({ mode = "host" }: TabBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  if (mode === "driver") {
    return (
      <div className="tab-bar">
        <button className={`tab${path === "/driveraccount" ? " active-tab" : ""}`} onClick={() => navigate("/driveraccount")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
          <span className="tab-lbl">Account</span>
        </button>
      </div>
    );
  }

  return (
    <div className="tab-bar">
      <button className={`tab${path === "/find" ? " active-tab" : ""}`} onClick={() => navigate("/find")}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
        <span className="tab-lbl">Find</span>
      </button>
      <button className={`tab${path === "/account" ? " active-tab" : ""}`} onClick={() => navigate("/account")}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
        <span className="tab-lbl">Account</span>
      </button>
    </div>
  );
}
