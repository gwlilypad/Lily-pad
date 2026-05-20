import { useApp } from "@/context/AppContext";

export default function ListingSuccessPage() {
  const { goTo } = useApp();

  return (
    <div style={{
      minHeight: "100dvh", background: "#0E1F40",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "32px 24px",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div style={{
        width: "100%", maxWidth: 390,
        display: "flex", flexDirection: "column",
        alignItems: "center", textAlign: "center",
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          background: "rgba(141,214,63,0.15)",
          border: "2px solid rgba(141,214,63,0.40)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 28,
        }}>
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>

        <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: -0.6, marginBottom: 14 }}>
          Your pad has been submitted!
        </div>

        <div style={{
          fontSize: 15, color: "rgba(255,255,255,0.60)",
          lineHeight: 1.6, marginBottom: 40,
          fontWeight: 400,
        }}>
          Lily Pad staff will review your listing and notify you by email once it's live.
        </div>

        <div style={{
          width: "100%", background: "rgba(141,214,63,0.08)",
          border: "1px solid rgba(141,214,63,0.22)",
          borderRadius: 18, padding: "18px 20px",
          marginBottom: 32, textAlign: "left",
        }}>
          {[
            { icon: "📋", text: "Your listing is under review" },
            { icon: "📧", text: "You'll get an email when approved" },
            { icon: "🚗", text: "Drivers can book once you're live" },
          ].map((item, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "8px 0",
              borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.06)" : "none",
            }}>
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>{item.text}</span>
            </div>
          ))}
        </div>

        <button
          onClick={() => goTo("paddashboard")}
          style={{
            width: "100%", padding: "16px 0", borderRadius: 100,
            background: "#8DD63F", border: "none", cursor: "pointer",
            fontSize: 16, fontWeight: 700, color: "#0E1F40",
            fontFamily: "'DM Sans', sans-serif", letterSpacing: -0.2,
            boxShadow: "0 4px 20px rgba(141,214,63,0.35)",
            marginBottom: 14,
          }}
        >
          View my dashboard
        </button>

        <button
          onClick={() => goTo("home")}
          style={{
            background: "transparent", border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 100, padding: "14px 0", width: "100%",
            color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: 600,
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
