import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import type { BookingRec } from "@/context/AppContext";

type DerivedStatus = "pending" | "upcoming" | "active" | "completed" | "cancelled" | "denied";

function deriveStatus(b: BookingRec, now: number): DerivedStatus {
  if (b.status === "cancelled") return "cancelled";
  if (b.status === "denied")    return "denied";
  if (b.status === "pending")   return "pending";
  if (b.endTs <= now)           return "completed";
  if (b.startTs <= now && now < b.endTs) return "active";
  return "upcoming";
}

const STATUS_STYLES: Record<DerivedStatus, { bg: string; border: string; color: string; label: string }> = {
  pending:   { bg:"rgba(251,191,36,0.13)", border:"rgba(251,191,36,0.35)", color:"#f59e0b",               label:"Awaiting approval" },
  upcoming:  { bg:"rgba(141,214,63,0.12)", border:"rgba(141,214,63,0.30)", color:"#8DD63F",               label:"Upcoming"   },
  active:    { bg:"rgba(52,199,89,0.14)",  border:"rgba(52,199,89,0.30)",  color:"#34c759",               label:"Active now" },
  completed: { bg:"rgba(255,255,255,0.07)",border:"rgba(255,255,255,0.10)",color:"rgba(255,255,255,0.45)",label:"Completed"  },
  cancelled: { bg:"rgba(255,80,80,0.10)",  border:"rgba(255,80,80,0.20)",  color:"#ff6060",               label:"Cancelled"  },
  denied:    { bg:"rgba(255,80,80,0.10)",  border:"rgba(255,80,80,0.20)",  color:"#ff6060",               label:"Not approved" },
};

const GREEN = "#8DD63F";
const NAVY  = "#0E1F40";

function fmtDate(ts: number) { return new Date(ts).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" }); }
function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" }); }
function fmtDur(ms: number) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}
function toLocalInput(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function BookingsPage() {
  const { goTo, setState } = useApp();
  const { user } = useAuth();

  const [filter, setFilter]       = useState<"upcoming"|"past">("upcoming");
  const [apiBookings, setApiBookings]   = useState<BookingRec[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expandedId, setExpandedId]   = useState<string|null>(null);

  // Adjust-time state (inline in pill)
  const [adjustingId, setAdjustingId] = useState<string|null>(null);
  const [adjStart, setAdjStart]   = useState("");
  const [adjEnd, setAdjEnd]       = useState("");
  const [adjSaving, setAdjSaving] = useState(false);
  const [adjError, setAdjError]   = useState("");

  // Cancel confirm state (inline in pill)
  const [cancelConfirmId, setCancelConfirmId] = useState<string|null>(null);
  const [cancellingId, setCancellingId]       = useState<string|null>(null);

  useEffect(() => {
    if (!user?.id) { setLoading(false); return; }
    fetch(`/api/bookings/${user.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped: BookingRec[] = data.map((b: Record<string, unknown>) => {
            const idStr = String(b.id || "");
            const numId = idStr ? (parseInt(idStr.replace(/-/g, "").slice(0, 8), 16) || Math.round(Math.random() * 1e8)) : Math.round(Math.random() * 1e8);
            const rawStatus = String(b.status || "confirmed");
            const mappedStatus: BookingRec["status"] =
              rawStatus === "cancelled" ? "cancelled" :
              rawStatus === "denied"    ? "denied"    :
              rawStatus === "pending"   ? "pending"   :
              rawStatus === "approved"  ? "active"    : "active";
            return {
              id:         numId,
              uuid:       idStr,
              spotId:     String(b.spot_id    || ""),
              addr:       String(b.addr       || b.address || "Unknown address"),
              city:       String(b.city       || "Houston, TX"),
              padType:    String(b.pad_type   || "Driveway"),
              startTs:    b.start_ts ? new Date(String(b.start_ts)).getTime() : Date.now(),
              endTs:      b.end_ts   ? new Date(String(b.end_ts)).getTime()   : Date.now() + 3600000,
              pricePerHr: Number(b.price_per_hr) || 0,
              hostName:   String(b.host_name  || "Host"),
              hostPhone:  String(b.host_phone || ""),
              status:     mappedStatus,
            };
          });
          setApiBookings(mapped);
        } else {
          setApiBookings([]);
        }
        setLoading(false);
      })
      .catch(() => { setApiBookings([]); setLoading(false); });
  }, [user?.id]);

  const now = Date.now();
  const sorted = [...apiBookings].sort((a, b) => b.startTs - a.startTs);

  const filtered = sorted.filter(b => {
    const s = deriveStatus(b, now);
    if (filter === "upcoming") return s === "upcoming" || s === "active" || s === "pending";
    return s === "completed" || s === "cancelled" || s === "denied";
  });

  function toggleExpand(uuid: string) {
    if (expandedId === uuid) {
      setExpandedId(null);
      setAdjustingId(null);
      setCancelConfirmId(null);
    } else {
      setExpandedId(uuid);
      setAdjustingId(null);
      setCancelConfirmId(null);
    }
  }

  function startAdjust(b: BookingRec) {
    setAdjStart(toLocalInput(b.startTs));
    setAdjEnd(toLocalInput(b.endTs));
    setAdjError("");
    setAdjustingId(b.uuid!);
  }

  async function doReschedule(b: BookingRec) {
    if (!adjStart || !adjEnd) return;
    const newStart = new Date(adjStart).getTime();
    const newEnd   = new Date(adjEnd).getTime();
    if (newEnd <= newStart) { setAdjError("End time must be after start time."); return; }
    setAdjSaving(true); setAdjError("");
    try {
      if (b.uuid) {
        const r = await fetch(`/api/bookings/${b.uuid}/reschedule`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ start_ts: new Date(newStart).toISOString(), end_ts: new Date(newEnd).toISOString() }),
        });
        if (!r.ok) { const d = await r.json(); setAdjError(d.error || "Failed to update time."); return; }
      }
      setApiBookings(prev => prev.map(x => x.uuid === b.uuid ? { ...x, startTs: newStart, endTs: newEnd } : x));
      setState(s => ({ ...s, bookings: s.bookings.map(x => x.id === b.id ? { ...x, startTs: newStart, endTs: newEnd } : x) }));
      setAdjustingId(null);
    } catch { setAdjError("Network error. Please try again."); }
    finally { setAdjSaving(false); }
  }

  async function doCancel(b: BookingRec) {
    setCancellingId(b.uuid!);
    try {
      if (b.uuid) await fetch(`/api/bookings/${b.uuid}/cancel`, { method: "PATCH" });
    } catch { /* non-blocking */ }
    setApiBookings(prev => prev.map(x => x.uuid === b.uuid ? { ...x, status: "cancelled" as const } : x));
    setState(s => ({ ...s, bookings: s.bookings.map(x => x.id === b.id ? { ...x, status: "cancelled" as const } : x) }));
    setCancellingId(null);
    setCancelConfirmId(null);
    setExpandedId(null);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", borderRadius: 10,
    border: "1.5px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)",
    color: "#fff", fontFamily: "'DM Sans',sans-serif", fontSize: 13,
    boxSizing: "border-box", outline: "none",
    colorScheme: "dark",
  };

  return (
    <div className="page active" style={{ background: NAVY, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',sans-serif", minHeight: "100dvh" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: "52px 20px 0", background: NAVY }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <button onClick={() => goTo("find")} style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.10)",border:"1px solid rgba(255,255,255,0.12)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
          <div>
            <div style={{ fontSize:20, fontWeight:800, color:"#fff", letterSpacing:-0.5 }}>My Bookings</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.38)", marginTop:2 }}>Your reserved spots</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          {(["upcoming","past"] as const).map(f => {
            const labels = { upcoming:"Upcoming", past:"Past" };
            const on = filter === f;
            return (
              <button key={f} onClick={() => { setFilter(f); setExpandedId(null); setAdjustingId(null); setCancelConfirmId(null); }}
                style={{ flex:1, padding:"11px 0", border:"none", background:"transparent", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:on?700:500, color:on?"#fff":"rgba(255,255,255,0.35)", borderBottom:`2px solid ${on?GREEN:"transparent"}`, transition:"all 0.18s" }}>
                {labels[f]}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 32px", display:"flex", flexDirection:"column", gap:10 }}>
        {loading ? (
          <div style={{ textAlign:"center", padding:"60px 0" }}>
            <div style={{ width:28,height:28,border:"3px solid rgba(141,214,63,0.3)",borderTopColor:GREEN,borderRadius:"50%",animation:"lp-spin 0.8s linear infinite",margin:"0 auto" }} />
            <style>{`@keyframes lp-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 0", color:"rgba(255,255,255,0.25)", fontSize:14 }}>
            {filter === "upcoming" ? "No upcoming bookings." : "No past bookings."}
          </div>
        ) : filtered.map(b => {
          const ds = deriveStatus(b, now);
          const st = STATUS_STYLES[ds];
          const dur = fmtDur(b.endTs - b.startTs);
          const total = (b.pricePerHr * (b.endTs - b.startTs) / 3600000);
          const totalLabel = `$${(Math.round(total * 100) / 100).toFixed(2)}`;
          const isExpanded = expandedId === b.uuid;
          const isAdjusting = adjustingId === b.uuid;
          const isCancelConfirm = cancelConfirmId === b.uuid;
          const canModify = ds === "upcoming" || ds === "active" || ds === "pending";

          return (
            <div key={b.uuid || b.id}
              style={{ background:"rgba(255,255,255,0.05)", borderRadius:18, border:`1.5px solid ${isExpanded ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.07)"}`, overflow:"hidden", transition:"border-color 0.18s" }}>

              {/* ── Pill header (always visible, click to toggle) ── */}
              <button onClick={() => toggleExpand(b.uuid!)} style={{ width:"100%", padding:"14px 16px", background:"none", border:"none", cursor:"pointer", display:"flex", alignItems:"center", gap:10, textAlign:"left" }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:"#fff", letterSpacing:-0.2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{b.addr}</div>
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.38)", marginTop:2 }}>{fmtDate(b.startTs)} · {fmtTime(b.startTs)}–{fmtTime(b.endTs)}</div>
                </div>
                <div style={{ background:st.bg, border:`1px solid ${st.border}`, borderRadius:20, padding:"3px 9px", fontSize:10, fontWeight:800, color:st.color, letterSpacing:0.4, textTransform:"uppercase", flexShrink:0 }}>
                  {st.label}
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink:0, transform:isExpanded?"rotate(180deg)":"rotate(0deg)", transition:"transform 0.2s" }}>
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </button>

              {/* ── Expanded content ── */}
              {isExpanded && (
                <div style={{ borderTop:"1px solid rgba(255,255,255,0.07)", padding:"14px 16px 16px" }}>

                  {/* Detail chips */}
                  <div style={{ display:"flex", gap:7, marginBottom:12, flexWrap:"wrap" }}>
                    {[
                      { icon:<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>, val:fmtDate(b.startTs) },
                      { icon:<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>, val:`${fmtTime(b.startTs)} · ${dur}` },
                      { icon:<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>, val:totalLabel },
                    ].map((item, i) => (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.05)", borderRadius:8, padding:"5px 10px" }}>
                        <span style={{ color:"rgba(255,255,255,0.30)", flexShrink:0 }}>{item.icon}</span>
                        <span style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.60)", whiteSpace:"nowrap" }}>{item.val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Pad type + host */}
                  <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", marginBottom:12 }}>
                    {b.city} · {b.padType}{b.hostName && b.hostName !== "Host" ? ` · ${b.hostName}` : ""}
                  </div>

                  {/* Status messages */}
                  {ds === "pending" && (
                    <div style={{ marginBottom:12, padding:"10px 12px", background:"rgba(251,191,36,0.07)", borderRadius:10, border:"1px solid rgba(251,191,36,0.18)", fontSize:12, color:"rgba(255,255,255,0.55)", lineHeight:1.5 }}>
                      Waiting for the host to approve. You'll get an email when they respond.
                    </div>
                  )}
                  {ds === "denied" && (
                    <div style={{ marginBottom:12, padding:"10px 12px", background:"rgba(255,80,80,0.06)", borderRadius:10, border:"1px solid rgba(255,80,80,0.14)", fontSize:12, color:"rgba(255,180,180,0.80)", lineHeight:1.5 }}>
                      The host was unable to accept this request. Search the map to find another spot nearby.
                    </div>
                  )}

                  {/* ── Adjust Time form (inline) ── */}
                  {canModify && isAdjusting && (
                    <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:12, padding:"12px", marginBottom:12, display:"flex", flexDirection:"column", gap:8 }}>
                      <div style={{ fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.45)", letterSpacing:"0.06em", textTransform:"uppercase" }}>Adjust time</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        <label style={{ fontSize:11, color:"rgba(255,255,255,0.40)", fontWeight:600 }}>Start</label>
                        <input type="datetime-local" value={adjStart} onChange={e => setAdjStart(e.target.value)} style={inputStyle} />
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                        <label style={{ fontSize:11, color:"rgba(255,255,255,0.40)", fontWeight:600 }}>End</label>
                        <input type="datetime-local" value={adjEnd} onChange={e => setAdjEnd(e.target.value)} style={inputStyle} />
                      </div>
                      {adjError && <p style={{ fontSize:11, color:"#f87171", margin:0 }}>{adjError}</p>}
                      <div style={{ display:"flex", gap:8, marginTop:2 }}>
                        <button onClick={() => doReschedule(b)} disabled={adjSaving}
                          style={{ flex:1, padding:"10px 0", borderRadius:10, background:adjSaving?"rgba(141,214,63,0.35)":GREEN, border:"none", color:NAVY, fontWeight:800, fontSize:13, cursor:adjSaving?"not-allowed":"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                          {adjSaving ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => { setAdjustingId(null); setAdjError(""); }}
                          style={{ flex:1, padding:"10px 0", borderRadius:10, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Cancel confirm (inline) ── */}
                  {isCancelConfirm && (
                    <div style={{ background:"rgba(255,80,80,0.06)", borderRadius:12, padding:"12px", marginBottom:12, border:"1px solid rgba(255,80,80,0.18)" }}>
                      <div style={{ fontSize:13, fontWeight:700, color:"#fff", marginBottom:4 }}>
                        {ds === "pending" ? "Cancel this request?" : "Cancel this booking?"}
                      </div>
                      <div style={{ fontSize:11, color:"rgba(255,255,255,0.45)", marginBottom:12 }}>
                        {b.addr} · {fmtDate(b.startTs)}
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={() => doCancel(b)} disabled={cancellingId === b.uuid}
                          style={{ flex:1, padding:"10px 0", borderRadius:10, background:"#ef4444", border:"none", color:"#fff", fontWeight:800, fontSize:13, cursor:cancellingId===b.uuid?"wait":"pointer", fontFamily:"'DM Sans',sans-serif", opacity:cancellingId===b.uuid?0.7:1 }}>
                          {cancellingId === b.uuid ? "Cancelling…" : ds === "pending" ? "Yes, cancel" : "Yes, cancel"}
                        </button>
                        <button onClick={() => setCancelConfirmId(null)}
                          style={{ flex:1, padding:"10px 0", borderRadius:10, background:"rgba(255,255,255,0.07)", border:"1px solid rgba(255,255,255,0.12)", color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                          Keep it
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Action buttons ── */}
                  {canModify && !isAdjusting && !isCancelConfirm && (
                    <div style={{ display:"flex", gap:8 }}>
                      {(ds === "upcoming" || ds === "active") && (
                        <button onClick={() => startAdjust(b)}
                          style={{ flex:1, padding:"10px 0", borderRadius:12, background:"rgba(141,214,63,0.10)", border:`1px solid rgba(141,214,63,0.25)`, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, color:GREEN }}>
                          Adjust Time
                        </button>
                      )}
                      <button onClick={() => setCancelConfirmId(b.uuid!)}
                        style={{ flex:1, padding:"10px 0", borderRadius:12, background:"rgba(255,80,80,0.08)", border:"1px solid rgba(255,80,80,0.18)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, color:"rgba(255,128,128,0.9)" }}>
                        {ds === "pending" ? "Cancel request" : "Cancel"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Find a spot CTA */}
        {!loading && (
          <button onClick={() => goTo("find")} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"15px 0", borderRadius:100, background:GREEN, border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:15, fontWeight:700, color:NAVY, marginTop:4 }}>
            Find a spot
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}
