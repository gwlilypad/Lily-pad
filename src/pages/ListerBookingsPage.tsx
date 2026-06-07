import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

interface ListerBooking {
  id: string;
  spot_id: string;
  spot_address: string;
  driver_name: string;
  driver_email: string | null;
  start_ts: string | null;
  end_ts: string | null;
  price_per_hr: number;
  total_price: number;
  pad_type: string;
  status: string;
  created_at: string;
}

function fmtDt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtTm(ts: string | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function ListerBookingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [bookings, setBookings] = useState<ListerBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"new" | "current" | "past">("new");

  const fetchBookings = useCallback(() => {
    if (!user?.id) return;
    fetch(`/api/bookings/lister/${user.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setBookings(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  async function handleApprove(id: string) {
    setActingOn(id);
    try {
      await fetch(`/api/bookings/${id}/approve`, { method: "PATCH" });
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status: "approved" } : b));
    } catch { /* non-blocking */ }
    setActingOn(null);
  }

  async function handleDeny(id: string) {
    setActingOn(id);
    try {
      await fetch(`/api/bookings/${id}/deny`, { method: "PATCH" });
      setBookings(prev => prev.map(b => b.id === id ? { ...b, status: "denied" } : b));
    } catch { /* non-blocking */ }
    setActingOn(null);
  }

  const now = Date.now();
  const newReqs = bookings.filter(b => b.status === "pending");
  const current = bookings.filter(b => b.status === "approved" && (!b.end_ts || new Date(b.end_ts).getTime() > now));
  const past    = bookings.filter(b =>
    (b.status === "approved" && b.end_ts && new Date(b.end_ts).getTime() <= now) ||
    b.status === "denied"
  ).sort((a, b2) => new Date(b2.created_at).getTime() - new Date(a.created_at).getTime());

  const tabItems = tab === "new" ? newReqs : tab === "current" ? current : past;

  const tabDefs: { key: "new" | "current" | "past"; label: string; count: number; dot: string }[] = [
    { key: "new",     label: "New",     count: newReqs.length, dot: "#f59e0b" },
    { key: "current", label: "Current", count: current.length,  dot: GREEN },
    { key: "past",    label: "Past",    count: past.length,     dot: "rgba(255,255,255,0.35)" },
  ];

  return (
    <div className="page active" style={{ background: NAVY, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: "52px 20px 18px", background: NAVY, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => navigate("/paddashboard")}
            style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", padding: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Bookings</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>
              {loading ? "Loading…" : `${bookings.length} total · ${newReqs.length} pending`}
            </div>
          </div>
          {newReqs.length > 0 && (
            <div style={{ background: "#f59e0b", borderRadius: 100, padding: "4px 10px", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
              {newReqs.length} new
            </div>
          )}
        </div>

        {/* Tab toggle in header */}
        <div style={{ display: "flex", gap: 4, background: "#142A52", borderRadius: 100, padding: 4, marginTop: 14 }}>
          {tabDefs.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setExpandedId(null); }}
                style={{
                  flex: 1, padding: "9px 6px", borderRadius: 100, border: "none",
                  background: active ? "rgba(255,255,255,0.13)" : "transparent",
                  color: active ? "#fff" : "rgba(255,255,255,0.48)",
                  fontWeight: 800, fontSize: 12, cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  transition: "all 0.15s",
                }}
              >
                {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.dot, flexShrink: 0 }} />}
                {t.label}
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 100,
                  background: active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)",
                  color: active ? "#fff" : "rgba(255,255,255,0.40)",
                }}>{t.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 40px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ width: 28, height: 28, border: "3px solid rgba(141,214,63,0.3)", borderTopColor: GREEN, borderRadius: "50%", animation: "lp-spin 0.8s linear infinite", margin: "0 auto" }} />
            <style>{`@keyframes lp-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : tabItems.length === 0 ? (
          <div style={{ background: "#142A52", borderRadius: 16, padding: "36px 20px", textAlign: "center", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>
              {tab === "new" ? "🎉" : tab === "current" ? "📅" : "📋"}
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "0 0 4px" }}>
              {tab === "new" ? "No new requests" : tab === "current" ? "No active bookings" : "No past bookings"}
            </p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.38)", margin: 0 }}>
              {tab === "new" ? "New booking requests will appear here." : tab === "current" ? "Approved upcoming bookings show here." : "Your completed bookings will show here."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tabItems.map(bk => {
              const isPending  = bk.status === "pending";
              const isApproved = bk.status === "approved";
              const acting     = actingOn === bk.id;
              const isOpen     = expandedId === bk.id;

              const dotColor    = isPending ? "#f59e0b" : isApproved ? GREEN : "rgba(255,255,255,0.30)";
              const badgeColor  = isPending ? "#f59e0b" : isApproved ? GREEN : "rgba(255,255,255,0.40)";
              const badgeBg     = isPending ? "rgba(251,191,36,0.14)" : isApproved ? "rgba(141,214,63,0.14)" : "rgba(255,255,255,0.07)";
              const badgeBorder = isPending ? "rgba(251,191,36,0.30)" : isApproved ? "rgba(141,214,63,0.28)" : "rgba(255,255,255,0.12)";
              const pillBorder  = isOpen
                ? (isPending ? "rgba(251,191,36,0.55)" : isApproved ? "rgba(141,214,63,0.42)" : "rgba(255,255,255,0.18)")
                : isPending ? "rgba(251,191,36,0.28)" : "rgba(255,255,255,0.08)";

              return (
                <div key={bk.id} style={{ background: "#142A52", borderRadius: 16, border: `1.5px solid ${pillBorder}`, overflow: "hidden", boxShadow: isPending ? "0 2px 16px rgba(251,191,36,0.10)" : "none" }}>
                  {/* Pill header */}
                  <button
                    onClick={() => setExpandedId(isOpen ? null : bk.id)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", textAlign: "left" }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor, flexShrink: 0, boxShadow: isPending ? "0 0 0 3px rgba(251,191,36,0.22)" : "none" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bk.driver_name}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", padding: "2px 7px", borderRadius: 100, color: badgeColor, background: badgeBg, border: `1px solid ${badgeBorder}`, flexShrink: 0 }}>
                          {isPending ? "Pending" : isApproved ? "Active" : "Denied"}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.40)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fmtDt(bk.start_ts)} · {fmtTm(bk.start_ts)} → {fmtTm(bk.end_ts)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: GREEN }}>${Number(bk.total_price).toFixed(0)}</span>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2.5" strokeLinecap="round" style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.18s" }}>
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </div>
                  </button>

                  {/* Expanded */}
                  {isOpen && (
                    <div style={{ padding: "0 16px 16px", borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 14 }}>

                      {/* Driver card — name only */}
                      <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "11px 14px", marginBottom: 12, border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(141,214,63,0.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        </div>
                        <div>
                          <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 2 }}>Driver</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{bk.driver_name}</div>
                        </div>
                      </div>

                      {/* Detail chips */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: isPending ? 14 : 0 }}>
                        {[
                          { label: "Date",    val: fmtDt(bk.start_ts) },
                          { label: "Time",    val: `${fmtTm(bk.start_ts)} → ${fmtTm(bk.end_ts)}` },
                          { label: "Total",   val: `$${Number(bk.total_price).toFixed(2)}` },
                          { label: "Rate",    val: `$${Number(bk.price_per_hr).toFixed(0)}/hr` },
                          { label: "Spot",    val: bk.spot_address },
                        ].map(chip => (
                          <div key={chip.label} style={{ display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.06)", borderRadius: 9, padding: "7px 11px", border: "1px solid rgba(255,255,255,0.08)" }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.32)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>{chip.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{chip.val}</span>
                          </div>
                        ))}
                      </div>

                      {/* Approve / Deny */}
                      {isPending && (
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            disabled={acting}
                            onClick={() => handleApprove(bk.id)}
                            style={{ flex: 1, padding: "12px 0", borderRadius: 100, background: acting ? "rgba(141,214,63,0.25)" : GREEN, border: "none", color: NAVY, fontSize: 14, fontWeight: 800, cursor: acting ? "wait" : "pointer", fontFamily: "'DM Sans',sans-serif", opacity: acting ? 0.6 : 1 }}>
                            {acting ? "…" : "✓ Approve"}
                          </button>
                          <button
                            disabled={acting}
                            onClick={() => handleDeny(bk.id)}
                            style={{ flex: 1, padding: "12px 0", borderRadius: 100, background: "transparent", border: "1.5px solid rgba(239,68,68,0.45)", color: "#ef4444", fontSize: 14, fontWeight: 800, cursor: acting ? "wait" : "pointer", fontFamily: "'DM Sans',sans-serif", opacity: acting ? 0.6 : 1 }}>
                            {acting ? "…" : "Deny"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
