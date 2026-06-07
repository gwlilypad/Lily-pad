import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";

export default function CustomerServicePage() {
  const { setState } = useApp();
  const navigate = useNavigate();

  function goBack() {
    setState(s => ({ ...s, openAcctOnFind: true }));
    navigate(-1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0E1F40", fontFamily: '"DM Sans", sans-serif', overflow: "hidden" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: "52px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={goBack} style={{
            background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Customer Service</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>We're here to help</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px 40px", display: "flex", flexDirection: "column", gap: 12 }}>

        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.50)", margin: 0, lineHeight: 1.6 }}>
          Have a question or issue? Reach out and we'll get back to you as soon as possible.
        </p>

        {/* Email */}
        <a href="mailto:support@lilypadparking.com" style={{ textDecoration: "none" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16, padding: "16px 16px", cursor: "pointer",
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(141,214,63,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#8DD63F" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: -0.1 }}>Email us</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", marginTop: 2 }}>support@lilypadparking.com</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6"/></svg>
          </div>
        </a>

        {/* Phone */}
        <a href="tel:+17137777777" style={{ textDecoration: "none" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 14,
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16, padding: "16px 16px", cursor: "pointer",
          }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(141,214,63,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#8DD63F" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: -0.1 }}>Call us</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", marginTop: 2 }}>(713) 777-7777 · Mon–Fri 9am–6pm</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" strokeLinecap="round"><path d="m9 18 6-6-6-6"/></svg>
          </div>
        </a>

        {/* Response time note */}
        <div style={{ background: "rgba(141,214,63,0.06)", border: "1px solid rgba(141,214,63,0.15)", borderRadius: 12, padding: "12px 14px", marginTop: 4 }}>
          <p style={{ margin: 0, fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 1.55 }}>
            <span style={{ color: "#8DD63F", fontWeight: 700 }}>Typical response time:</span> within a few hours during business hours.
          </p>
        </div>

      </div>
    </div>
  );
}
