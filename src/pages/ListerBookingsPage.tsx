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

function fmtDate(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function fmtTime(ts: string | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

/* Deterministic pastel from name */
const AVATAR_PALETTES = [
  { bg: "#E8F5DA", fg: "#4a7c1a" },
  { bg: "#D6EAF8", fg: "#1a5276" },
  { bg: "#F9EBEA", fg: "#922b21" },
  { bg: "#FDEBD0", fg: "#935116" },
  { bg: "#EAF0FB", fg: "#1a3a6b" },
  { bg: "#F4ECF7", fg: "#6c3483" },
  { bg: "#E8F8F5", fg: "#117a65" },
];
function avatarPalette(name: string) {
  const code = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTES[code % AVATAR_PALETTES.length];
}

export default function ListerBookingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [bookings, setBookings] = useState<ListerBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);
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
      if (tab === "new") setTab("current");
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
  const newReqs  = bookings.filter(b => b.status === "pending");
  const current  = bookings.filter(b => b.status === "approved" && (!b.end_ts || new Date(b.end_ts).getTime() > now));
  const past     = bookings.filter(b =>
    (b.status === "approved" && b.end_ts && new Date(b.end_ts).getTime() <= now) ||
    b.status === "denied"
  ).sort((a, b2) => new Date(b2.created_at).getTime() - new Date(a.created_at).getTime());

  const tabCounts = { new: newReqs.length, current: current.length, past: past.length };
  const tabItems  = tab === "new" ? newReqs : tab === "current" ? current : past;

  const tabDefs: { key: "new" | "current" | "past"; label: string }[] = [
    { key: "new",     label: "New" },
    { key: "current", label: "Current" },
    { key: "past",    label: "Past" },
  ];

  return (
    <div
      className="page active"
      style={{ background: NAVY, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',sans-serif" }}
    >
      <style>{`
        @keyframes lp-spin { to { transform: rotate(360deg) } }
        @keyframes lp-fadein { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }
      `}</style>

      {/* ── DARK HEADER ── */}
      <div style={{ flexShrink: 0, padding: "50px 20px 0" }}>

        {/* Back + title row */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
          <button
            onClick={() => navigate("/paddashboard")}
            style={{
              width: 38, height: 38, borderRadius: "50%",
              background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0, padding: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: -0.6 }}>Bookings</div>
            {!loading && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 1 }}>
                {newReqs.length > 0 ? `${newReqs.length} pending approval` : "All caught up"}
              </div>
            )}
          </div>

          {newReqs.length > 0 && (
            <div style={{
              background: "#f59e0b", borderRadius: 100, padding: "5px 11px",
              fontSize: 12, fontWeight: 800, color: "#fff",
            }}>
              {newReqs.length} new
            </div>
          )}
        </div>

        {/* Tab pills — dark style */}
        <div style={{ display: "flex", gap: 6 }}>
          {tabDefs.map(t => {
            const active = tab === t.key;
            const count  = tabCounts[t.key];
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  flex: 1, padding: "10px 4px", borderRadius: 100, border: "none",
                  background: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
                  color: active ? "#fff" : "rgba(255,255,255,0.42)",
                  fontWeight: 700, fontSize: 13, cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.15s",
                  boxShadow: active ? "inset 0 0 0 1.5px rgba(255,255,255,0.22)" : "none",
                }}
              >
                {t.label}
                {count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 100,
                    background: active
                      ? (t.key === "new" ? "#f59e0b" : t.key === "current" ? GREEN : "rgba(255,255,255,0.30)")
                      : "rgba(255,255,255,0.10)",
                    color: active ? (t.key === "current" ? NAVY : "#fff") : "rgba(255,255,255,0.50)",
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── WHITE CARD SHEET ── */}
      <div style={{
        flex: 1, overflowY: "auto", marginTop: 18,
        background: "#F4F6FA",
        borderRadius: "28px 28px 0 0",
        padding: "8px 0 40px",
      }}>

        {/* Pull handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 4 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(14,31,64,0.12)" }} />
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ width: 28, height: 28, border: `3px solid rgba(141,214,63,0.3)`, borderTopColor: GREEN, borderRadius: "50%", animation: "lp-spin 0.8s linear infinite", margin: "0 auto" }} />
          </div>
        ) : tabItems.length === 0 ? (
          /* Empty state */
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: "rgba(14,31,64,0.07)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" opacity={0.35}>
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p style={{ fontSize: 15, fontWeight: 700, color: NAVY, margin: "0 0 6px" }}>
              {tab === "new" ? "No new requests" : tab === "current" ? "No active bookings" : "No past bookings"}
            </p>
            <p style={{ fontSize: 13, color: "rgba(14,31,64,0.45)", margin: 0, lineHeight: 1.5 }}>
              {tab === "new"
                ? "New booking requests will appear here for you to accept or deny."
                : tab === "current"
                  ? "Approved upcoming bookings will show here."
                  : "Your completed and denied bookings will appear here."}
            </p>
          </div>
        ) : (
          /* Booking cards */
          <div style={{ padding: "8px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {tabItems.map((bk, i) => {
              const isPending  = bk.status === "pending";
              const isApproved = bk.status === "approved";
              const isDenied   = bk.status === "denied";
              const acting     = actingOn === bk.id;
              const pal        = avatarPalette(bk.driver_name);

              return (
                <div
                  key={bk.id}
                  style={{
                    background: "#fff",
                    borderRadius: 20,
                    padding: "18px 18px 16px",
                    boxShadow: isPending
                      ? "0 4px 20px rgba(251,191,36,0.14), 0 1px 4px rgba(0,0,0,0.06)"
                      : "0 2px 12px rgba(14,31,64,0.07), 0 1px 3px rgba(0,0,0,0.04)",
                    border: isPending ? "1.5px solid rgba(251,191,36,0.35)" : "1px solid rgba(14,31,64,0.06)",
                    animation: "lp-fadein 0.22s ease both",
                    animationDelay: `${i * 0.04}s`,
                  }}
                >
                  {/* Top row — avatar + name + status */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
                      background: pal.bg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 18, fontWeight: 800, color: pal.fg,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      border: `2px solid ${pal.bg}`,
                    }}>
                      {initials(bk.driver_name)}
                    </div>

                    {/* Name + sub */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: NAVY, letterSpacing: -0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {bk.driver_name}
                      </div>
                      <div style={{ fontSize: 11.5, color: "rgba(14,31,64,0.45)", marginTop: 2 }}>
                        {isPending ? "Requesting to book" : isApproved ? "Booking confirmed" : "Request denied"}
                      </div>
                    </div>

                    {/* Status badge */}
                    <div style={{
                      padding: "4px 10px", borderRadius: 100, flexShrink: 0,
                      fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
                      background: isPending
                        ? "rgba(251,191,36,0.13)"
                        : isApproved
                          ? "rgba(141,214,63,0.15)"
                          : "rgba(14,31,64,0.07)",
                      color: isPending ? "#b45309" : isApproved ? "#3a6b0f" : "rgba(14,31,64,0.40)",
                      border: isPending
                        ? "1px solid rgba(251,191,36,0.35)"
                        : isApproved
                          ? "1px solid rgba(141,214,63,0.35)"
                          : "1px solid rgba(14,31,64,0.10)",
                    }}>
                      {isPending ? "Pending" : isApproved ? "Active" : "Denied"}
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: "rgba(14,31,64,0.06)", marginBottom: 14 }} />

                  {/* Booking info grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                    {[
                      { icon: "📅", label: "Date",  val: fmtDate(bk.start_ts) },
                      { icon: "⏱",  label: "Time",  val: `${fmtTime(bk.start_ts)} – ${fmtTime(bk.end_ts)}` },
                      { icon: "💵", label: "Total", val: `$${Number(bk.total_price).toFixed(2)}` },
                      { icon: "🅿️", label: "Spot",  val: bk.spot_address.split(",")[0] },
                    ].map(row => (
                      <div key={row.label} style={{
                        background: "rgba(14,31,64,0.04)",
                        borderRadius: 12, padding: "9px 12px",
                        border: "1px solid rgba(14,31,64,0.05)",
                      }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>
                          {row.label}
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.val}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Accept / Deny — pending only */}
                  {isPending && (
                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        disabled={acting}
                        onClick={() => handleDeny(bk.id)}
                        style={{
                          flex: 1, padding: "12px 0", borderRadius: 100,
                          background: "rgba(239,68,68,0.07)",
                          border: "1.5px solid rgba(239,68,68,0.25)",
                          color: "#dc2626", fontSize: 13.5, fontWeight: 800,
                          cursor: acting ? "wait" : "pointer",
                          fontFamily: "'DM Sans',sans-serif",
                          opacity: acting ? 0.5 : 1,
                          transition: "all 0.15s",
                        }}
                      >
                        {acting ? "…" : "Deny"}
                      </button>
                      <button
                        disabled={acting}
                        onClick={() => handleApprove(bk.id)}
                        style={{
                          flex: 2, padding: "12px 0", borderRadius: 100,
                          background: acting ? "rgba(141,214,63,0.55)" : GREEN,
                          border: "none",
                          color: NAVY, fontSize: 13.5, fontWeight: 800,
                          cursor: acting ? "wait" : "pointer",
                          fontFamily: "'DM Sans',sans-serif",
                          opacity: acting ? 0.6 : 1,
                          boxShadow: "0 4px 12px rgba(141,214,63,0.30)",
                          transition: "all 0.15s",
                        }}
                      >
                        {acting ? "…" : "✓ Accept"}
                      </button>
                    </div>
                  )}

                  {/* Approved — rate line */}
                  {isApproved && (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "rgba(141,214,63,0.08)", borderRadius: 12, border: "1px solid rgba(141,214,63,0.22)" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(14,31,64,0.55)" }}>Rate per hour</span>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#3a6b0f" }}>${Number(bk.price_per_hr).toFixed(0)}/hr</span>
                    </div>
                  )}

                  {/* Denied — subtle note */}
                  {isDenied && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "rgba(14,31,64,0.04)", borderRadius: 12 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.35)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <span style={{ fontSize: 12, color: "rgba(14,31,64,0.45)", fontWeight: 600 }}>Request was denied</span>
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
