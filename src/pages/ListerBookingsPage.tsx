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
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
const AVATAR_PALETTES = [
  { bg: "#E8F5DA", fg: "#4a7c1a" }, { bg: "#D6EAF8", fg: "#1a5276" },
  { bg: "#F9EBEA", fg: "#922b21" }, { bg: "#FDEBD0", fg: "#935116" },
  { bg: "#EAF0FB", fg: "#1a3a6b" }, { bg: "#F4ECF7", fg: "#6c3483" },
  { bg: "#E8F8F5", fg: "#117a65" },
];
function avatarPalette(name: string) {
  const code = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_PALETTES[code % AVATAR_PALETTES.length];
}

export default function ListerBookingsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [bookings, setBookings]   = useState<ListerBooking[]>([]);
  const [loading, setLoading]     = useState(true);
  const [actingOn, setActingOn]   = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab]             = useState<"new" | "current" | "past">("new");

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
      setExpandedId(null);
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

  const now       = Date.now();
  const newReqs   = bookings.filter(b => b.status === "pending");
  const current   = bookings.filter(b => b.status === "approved" && (!b.end_ts || new Date(b.end_ts).getTime() > now));
  const past      = bookings.filter(b =>
    (b.status === "approved" && b.end_ts && new Date(b.end_ts).getTime() <= now) || b.status === "denied"
  ).sort((a, b2) => new Date(b2.created_at).getTime() - new Date(a.created_at).getTime());

  const tabCounts = { new: newReqs.length, current: current.length, past: past.length };
  const tabItems  = tab === "new" ? newReqs : tab === "current" ? current : past;
  const tabDefs: { key: "new" | "current" | "past"; label: string }[] = [
    { key: "new", label: "New" }, { key: "current", label: "Current" }, { key: "past", label: "Past" },
  ];

  return (
    <div className="page active" style={{ background: NAVY, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',sans-serif" }}>
      <style>{`
        @keyframes lp-spin { to { transform: rotate(360deg) } }
        @keyframes lp-slide { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }
      `}</style>

      {/* ── DARK HEADER ── */}
      <div style={{ flexShrink: 0, padding: "50px 20px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
          <button
            onClick={() => navigate(-1)}
            style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, padding: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>My Reservations</div>
            {!loading && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 1 }}>
                {newReqs.length > 0 ? `${newReqs.length} pending approval` : "All caught up"}
              </div>
            )}
          </div>
          {newReqs.length > 0 && (
            <div style={{ background: "#f59e0b", borderRadius: 100, padding: "4px 10px", fontSize: 11, fontWeight: 800, color: "#fff" }}>
              {newReqs.length} new
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {tabDefs.map(t => {
            const active = tab === t.key;
            const count  = tabCounts[t.key];
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setExpandedId(null); }} style={{
                flex: 1, padding: "9px 4px", borderRadius: 100, border: "none",
                background: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
                color: active ? "#fff" : "rgba(255,255,255,0.42)",
                fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                boxShadow: active ? "inset 0 0 0 1.5px rgba(255,255,255,0.20)" : "none",
              }}>
                {t.label}
                {count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: "1px 6px", borderRadius: 100,
                    background: active ? (t.key === "new" ? "#f59e0b" : t.key === "current" ? GREEN : "rgba(255,255,255,0.28)") : "rgba(255,255,255,0.10)",
                    color: active ? (t.key === "current" ? NAVY : "#fff") : "rgba(255,255,255,0.45)",
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── WHITE SHEET ── */}
      <div style={{ flex: 1, overflowY: "auto", marginTop: 16, background: "#F4F6FA", borderRadius: "26px 26px 0 0", padding: "6px 0 40px" }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 6 }}>
          <div style={{ width: 34, height: 4, borderRadius: 2, background: "rgba(14,31,64,0.12)" }} />
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ width: 26, height: 26, border: "3px solid rgba(141,214,63,0.3)", borderTopColor: GREEN, borderRadius: "50%", animation: "lp-spin 0.8s linear infinite", margin: "0 auto" }} />
          </div>
        ) : tabItems.length === 0 ? (
          <div style={{ padding: "60px 24px", textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(14,31,64,0.07)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" opacity={0.30}>
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <p style={{ fontSize: 14.5, fontWeight: 700, color: NAVY, margin: "0 0 6px" }}>
              {tab === "new" ? "No new requests" : tab === "current" ? "No active bookings" : "No past bookings"}
            </p>
            <p style={{ fontSize: 12.5, color: "rgba(14,31,64,0.42)", margin: 0, lineHeight: 1.5 }}>
              {tab === "new" ? "New booking requests will appear here for you to accept or deny." : tab === "current" ? "Approved upcoming bookings will appear here." : "Your completed and denied bookings will appear here."}
            </p>
          </div>
        ) : (
          <div style={{ padding: "4px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {tabItems.map((bk, i) => {
              const isPending  = bk.status === "pending";
              const isApproved = bk.status === "approved";
              const isDenied   = bk.status === "denied";
              const acting     = actingOn === bk.id;
              const isOpen     = expandedId === bk.id;
              const pal        = avatarPalette(bk.driver_name);

              const dotColor  = isPending ? "#f59e0b" : isApproved ? GREEN : "rgba(14,31,64,0.25)";
              const cardBorder = isPending
                ? (isOpen ? "rgba(251,191,36,0.45)" : "rgba(251,191,36,0.25)")
                : isOpen ? "rgba(14,31,64,0.12)" : "rgba(14,31,64,0.07)";

              return (
                <div key={bk.id} style={{
                  background: "#fff",
                  borderRadius: 14,
                  border: `1.5px solid ${cardBorder}`,
                  overflow: "hidden",
                  boxShadow: isPending && isOpen ? "0 4px 18px rgba(251,191,36,0.10)" : "0 1px 5px rgba(14,31,64,0.06)",
                  animation: "lp-slide 0.18s ease both",
                  animationDelay: `${i * 0.03}s`,
                }}>

                  {/* ── COLLAPSED PILL HEADER ── */}
                  <button
                    onClick={() => setExpandedId(isOpen ? null : bk.id)}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 10,
                      padding: "12px 14px", background: "transparent", border: "none",
                      cursor: "pointer", fontFamily: "'DM Sans',sans-serif", textAlign: "left",
                    }}
                  >
                    {/* Status dot */}
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: dotColor,
                      boxShadow: isPending ? "0 0 0 3px rgba(251,191,36,0.18)" : "none",
                    }} />

                    {/* Avatar */}
                    <div style={{
                      width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                      background: pal.bg, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, fontWeight: 800, color: pal.fg,
                    }}>
                      {initials(bk.driver_name)}
                    </div>

                    {/* Name + date */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, letterSpacing: -0.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {bk.driver_name}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(14,31,64,0.40)", marginTop: 1 }}>
                        {fmtDate(bk.start_ts)}
                      </div>
                    </div>

                    {/* Price + chevron */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: isApproved ? "#3a6b0f" : isPending ? "#b45309" : "rgba(14,31,64,0.40)" }}>
                        ${Number(bk.total_price).toFixed(0)}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.28)" strokeWidth="2.5" strokeLinecap="round" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}>
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </div>
                  </button>

                  {/* ── EXPANDED PANEL ── */}
                  {isOpen && (
                    <div style={{ borderTop: "1px solid rgba(14,31,64,0.07)", animation: "lp-slide 0.16s ease" }}>

                      {/* CHECK IN / CHECK OUT */}
                      <div style={{ display: "flex", padding: "14px 16px", gap: 0 }}>
                        <div style={{ flex: 1, paddingRight: 12 }}>
                          <div style={{ fontSize: 9.5, fontWeight: 800, color: "rgba(14,31,64,0.38)", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>Check In</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{fmtDate(bk.start_ts)}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(14,31,64,0.55)", marginTop: 2 }}>{fmtTime(bk.start_ts)}</div>
                        </div>
                        <div style={{ width: 1, background: "rgba(14,31,64,0.08)", alignSelf: "stretch" }} />
                        <div style={{ flex: 1, paddingLeft: 12 }}>
                          <div style={{ fontSize: 9.5, fontWeight: 800, color: "rgba(14,31,64,0.38)", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>Check Out</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{fmtDate(bk.end_ts)}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(14,31,64,0.55)", marginTop: 2 }}>{fmtTime(bk.end_ts)}</div>
                        </div>
                      </div>

                      <div style={{ height: 1, background: "rgba(14,31,64,0.06)", margin: "0 16px" }} />

                      {/* YOUR PAD */}
                      <div style={{ padding: "12px 16px" }}>
                        <div style={{ fontSize: 9.5, fontWeight: 800, color: "rgba(14,31,64,0.38)", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 5 }}>Your Pad</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 1 }}>{bk.spot_address.split(",")[0]}</div>
                        {bk.spot_address.includes(",") && (
                          <div style={{ fontSize: 12, fontWeight: 500, color: "rgba(14,31,64,0.50)" }}>
                            {bk.spot_address.split(",").slice(1).join(",").trim()}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 4, marginTop: 5, alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.35)", letterSpacing: 0.4, textTransform: "uppercase", background: "rgba(14,31,64,0.05)", borderRadius: 6, padding: "2px 7px" }}>
                            {bk.pad_type || "Parking"}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: isApproved ? "#3a6b0f" : isPending ? "#b45309" : "rgba(14,31,64,0.35)", letterSpacing: 0.4, textTransform: "uppercase", background: isApproved ? "rgba(141,214,63,0.10)" : isPending ? "rgba(251,191,36,0.10)" : "rgba(14,31,64,0.05)", borderRadius: 6, padding: "2px 7px", border: isApproved ? "1px solid rgba(141,214,63,0.25)" : isPending ? "1px solid rgba(251,191,36,0.25)" : "none" }}>
                            {isPending ? "Pending" : isApproved ? "Confirmed" : "Denied"}
                          </span>
                        </div>
                      </div>

                      <div style={{ height: 1, background: "rgba(14,31,64,0.06)", margin: "0 16px" }} />

                      {/* GUEST */}
                      <div style={{ padding: "12px 16px" }}>
                        <div style={{ fontSize: 9.5, fontWeight: 800, color: "rgba(14,31,64,0.38)", textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 8 }}>Guest</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 38, height: 38, borderRadius: "50%", background: pal.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: pal.fg, flexShrink: 0 }}>
                            {initials(bk.driver_name)}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>{bk.driver_name}</div>
                            {bk.driver_email && (
                              <div style={{ fontSize: 11.5, color: "rgba(14,31,64,0.50)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {bk.driver_email}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* FINANCIALS */}
                      <div style={{ margin: "0 16px 14px", background: "rgba(14,31,64,0.03)", borderRadius: 10, border: "1px solid rgba(14,31,64,0.06)", padding: "10px 12px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <span style={{ fontSize: 11.5, color: "rgba(14,31,64,0.50)", fontWeight: 600 }}>Rate</span>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>${Number(bk.price_per_hr).toFixed(0)}/hr</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 11.5, color: "rgba(14,31,64,0.50)", fontWeight: 600 }}>Total earned</span>
                          <span style={{ fontSize: 13.5, fontWeight: 800, color: isApproved ? "#3a6b0f" : NAVY }}>${Number(bk.total_price).toFixed(2)}</span>
                        </div>
                      </div>

                      {/* ACCEPT / DENY */}
                      {isPending && (
                        <div style={{ display: "flex", gap: 8, padding: "0 16px 14px" }}>
                          <button disabled={acting} onClick={() => handleDeny(bk.id)} style={{
                            flex: 1, padding: "11px 0", borderRadius: 100,
                            background: "transparent", border: "1.5px solid rgba(239,68,68,0.28)",
                            color: "#dc2626", fontSize: 13, fontWeight: 700,
                            cursor: acting ? "wait" : "pointer", fontFamily: "'DM Sans',sans-serif", opacity: acting ? 0.5 : 1,
                          }}>
                            {acting ? "…" : "Deny"}
                          </button>
                          <button disabled={acting} onClick={() => handleApprove(bk.id)} style={{
                            flex: 2, padding: "11px 0", borderRadius: 100,
                            background: acting ? "rgba(141,214,63,0.5)" : GREEN,
                            border: "none", color: NAVY, fontSize: 13, fontWeight: 800,
                            cursor: acting ? "wait" : "pointer", fontFamily: "'DM Sans',sans-serif", opacity: acting ? 0.6 : 1,
                            boxShadow: "0 3px 10px rgba(141,214,63,0.28)",
                          }}>
                            {acting ? "…" : "✓ Accept"}
                          </button>
                        </div>
                      )}

                      {/* DENIED NOTE */}
                      {isDenied && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px 14px" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.28)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                          <span style={{ fontSize: 11.5, color: "rgba(14,31,64,0.38)", fontWeight: 600 }}>This request was denied</span>
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
