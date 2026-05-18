import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import type { BookingRec } from "@/context/AppContext";

type DerivedStatus = "upcoming" | "active" | "completed" | "cancelled";

function deriveStatus(b: BookingRec, now: number): DerivedStatus {
  if (b.status === "cancelled") return "cancelled";
  if (b.endTs <= now) return "completed";
  if (b.startTs <= now && now < b.endTs) return "active";
  return "upcoming";
}

const STATUS_STYLES: Record<DerivedStatus, { bg: string; border: string; color: string; label: string }> = {
  upcoming:  { bg:"rgba(141,214,63,0.12)", border:"rgba(141,214,63,0.30)", color:"#8DD63F",               label:"Upcoming"   },
  active:    { bg:"rgba(52,199,89,0.14)",  border:"rgba(52,199,89,0.30)",  color:"#34c759",               label:"Active now" },
  completed: { bg:"rgba(255,255,255,0.07)",border:"rgba(255,255,255,0.10)",color:"rgba(255,255,255,0.45)",label:"Completed"  },
  cancelled: { bg:"rgba(255,80,80,0.10)",  border:"rgba(255,80,80,0.20)",  color:"#ff6060",               label:"Cancelled"  },
};

function fmtDate(ts: number) { return new Date(ts).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" }); }
function fmtTime(ts: number) { return new Date(ts).toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" }); }
function fmtDur(ms: number) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60}h`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function BookingsPage() {
  const { goTo, setState, state } = useApp();
  const { user } = useAuth();
  const [filter, setFilter] = useState<"all"|"upcoming"|"completed">("all");
  const [contactFor, setContactFor] = useState<BookingRec | null>(null);
  const [extendFor, setExtendFor] = useState<BookingRec | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<BookingRec | null>(null);
  const [apiBookings, setApiBookings] = useState<BookingRec[] | null>(null);
  const [loadingBookings, setLoadingBookings] = useState(true);

  useEffect(() => {
    if (!user?.id) { setLoadingBookings(false); return; }
    fetch(`/api/bookings/${user.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const mapped: BookingRec[] = data.map((b: Record<string, unknown>) => ({
            id:         Number(b.id)           || Math.random(),
            spotId:     Number(b.spot_id)      || 0,
            addr:       String(b.address       || b.addr  || "Unknown address"),
            city:       String(b.city          || "Houston"),
            padType:    String(b.pad_type      || b.padType || "Driveway"),
            startTs:    b.start_ts ? Number(b.start_ts) * 1000 : Number(b.start_time) || Date.now(),
            endTs:      b.end_ts   ? Number(b.end_ts)   * 1000 : Number(b.end_time)   || Date.now() + 3600000,
            pricePerHr: Number(b.price_per_hr  || b.pricePerHr || 4),
            hostName:   String(b.host_name     || b.hostName   || "Host"),
            hostPhone:  String(b.host_phone    || b.hostPhone  || "(555) 000-0000"),
            status:     (b.status as "active" | "cancelled") || "active",
          }));
          setApiBookings(mapped);
        } else {
          setApiBookings([]);
        }
        setLoadingBookings(false);
      })
      .catch(() => { setApiBookings(null); setLoadingBookings(false); });
  }, [user?.id]);

  function backToFind() {
    setState(s => ({ ...s, openAcctOnFind: true }));
    goTo("find");
  }

  const bookings = apiBookings ?? state.bookings;
  const now = Date.now();
  const sorted = [...bookings].sort((a, b) => b.startTs - a.startTs);
  const filtered = sorted.filter(b => {
    const s = deriveStatus(b, now);
    if (filter === "all") return true;
    if (filter === "upcoming") return s === "upcoming" || s === "active";
    return s === "completed" || s === "cancelled";
  });

  function extendCollides(b: BookingRec, addMs: number) {
    const newEnd = b.endTs + addMs;
    return bookings.some(x =>
      x.id !== b.id && x.spotId === b.spotId && x.status === "active" &&
      Math.max(x.startTs, b.startTs) < Math.min(x.endTs, newEnd)
    );
  }
  function applyExtend(b: BookingRec, addMs: number) {
    if (extendCollides(b, addMs)) { alert("That extension overlaps another booking."); return; }
    setState(s => ({ ...s, bookings: s.bookings.map(x => x.id === b.id ? { ...x, endTs: x.endTs + addMs } : x) }));
    setExtendFor(null);
  }
  function doCancel(b: BookingRec) {
    setState(s => ({ ...s, bookings: s.bookings.map(x => x.id === b.id ? { ...x, status: "cancelled" as const } : x) }));
    setConfirmCancel(null);
  }

  return (
    <div className="page active" style={{ background:"#0E1F40", display:"flex", flexDirection:"column", fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ flexShrink:0, padding:"52px 20px 0", background:"#0E1F40" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:20 }}>
          <button onClick={backToFind} style={{ width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.10)",border:"1px solid rgba(255,255,255,0.12)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
          <div>
            <div style={{ fontSize:20, fontWeight:800, color:"#fff", letterSpacing:-0.5 }}>My Bookings</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.38)", marginTop:2 }}>Your reserved spots</div>
          </div>
        </div>
        <div style={{ display:"flex", borderBottom:"1px solid rgba(255,255,255,0.08)", gap:0, marginBottom:0 }}>
          {(["all","upcoming","completed"] as const).map(f => {
            const labels = { all:"All", upcoming:"Upcoming", completed:"History" };
            const on = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)} style={{ flex:1,padding:"11px 0",border:"none",background:"transparent",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:on?700:500,color:on?"#fff":"rgba(255,255,255,0.35)",borderBottom:`2px solid ${on?"#8DD63F":"transparent"}`,transition:"all 0.18s" }}>
                {labels[f]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"20px 16px 32px", display:"flex", flexDirection:"column", gap:12 }}>
        {loadingBookings ? (
          <div style={{ textAlign:"center", padding:"60px 0" }}>
            <div style={{ width:28,height:28,border:"3px solid rgba(141,214,63,0.3)",borderTopColor:"#8DD63F",borderRadius:"50%",animation:"lp-spin 0.8s linear infinite",margin:"0 auto" }} />
            <style>{`@keyframes lp-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:"60px 0", color:"rgba(255,255,255,0.25)", fontSize:14 }}>
            No bookings here yet.
          </div>
        ) : filtered.map(b => {
          const ds = deriveStatus(b, now);
          const st = STATUS_STYLES[ds];
          const dur = fmtDur(b.endTs - b.startTs);
          const total = (b.pricePerHr * (b.endTs - b.startTs) / 3600000);
          const totalLabel = `$${(Math.round(total * 100) / 100).toFixed(2)}`;
          const canModify = ds === "upcoming" || ds === "active";
          return (
            <div key={b.id} style={{ background:"rgba(255,255,255,0.05)", borderRadius:18, border:"1px solid rgba(255,255,255,0.08)", padding:"16px", overflow:"hidden" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:700, color:"#fff", letterSpacing:-0.3, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{b.addr}</div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.38)", marginTop:2 }}>{b.city} · {b.padType} · {b.hostName}</div>
                </div>
                <div style={{ background:st.bg, border:`1px solid ${st.border}`, borderRadius:20, padding:"4px 10px", fontSize:10, fontWeight:800, color:st.color, letterSpacing:0.4, textTransform:"uppercase", flexShrink:0, marginLeft:10 }}>
                  {st.label}
                </div>
              </div>
              <div style={{ display:"flex", gap:8, marginBottom:canModify?14:0 }}>
                {[
                  { icon:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>, val:fmtDate(b.startTs) },
                  { icon:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>, val:`${fmtTime(b.startTs)} · ${dur}` },
                  { icon:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>, val:totalLabel },
                ].map((item,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.05)", borderRadius:8, padding:"6px 10px", flex:1 }}>
                    <span style={{ color:"rgba(255,255,255,0.28)", flexShrink:0 }}>{item.icon}</span>
                    <span style={{ fontSize:11, fontWeight:600, color:"rgba(255,255,255,0.65)", whiteSpace:"nowrap" }}>{item.val}</span>
                  </div>
                ))}
              </div>
              {canModify && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button onClick={() => setExtendFor(b)} style={{ flex:"1 1 30%", padding:"10px 0", borderRadius:12, background:"rgba(141,214,63,0.12)", border:"1px solid rgba(141,214,63,0.25)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, color:"#8DD63F" }}>Extend</button>
                  <button onClick={() => setContactFor(b)} style={{ flex:"1 1 30%", padding:"10px 0", borderRadius:12, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, color:"#fff" }}>Contact</button>
                  <button onClick={() => setConfirmCancel(b)} style={{ flex:"1 1 30%", padding:"10px 0", borderRadius:12, background:"rgba(255,80,80,0.08)", border:"1px solid rgba(255,80,80,0.18)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:700, color:"rgba(255,128,128,0.9)" }}>Cancel</button>
                </div>
              )}
            </div>
          );
        })}
        <button onClick={() => goTo("find")} style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:8, padding:"15px 0", borderRadius:100, background:"#8DD63F", border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:15, fontWeight:700, color:"#fff", marginTop:8 }}>
          Find a spot
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </div>

      {contactFor && (
        <div onClick={() => setContactFor(null)} style={{ position:"absolute",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"flex-end",zIndex:50 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%",background:"#152849",borderTopLeftRadius:24,borderTopRightRadius:24,padding:"22px 20px calc(env(safe-area-inset-bottom) + 22px)",color:"#fff" }}>
            <div style={{ width:36,height:4,background:"rgba(255,255,255,0.18)",borderRadius:2,margin:"0 auto 16px" }} />
            <div style={{ fontSize:18,fontWeight:800,marginBottom:4 }}>Contact your host</div>
            <div style={{ fontSize:13,color:"rgba(255,255,255,0.55)",marginBottom:18 }}>{contactFor.hostName} · {contactFor.addr}</div>
            <a href={`tel:${contactFor.hostPhone.replace(/[^0-9+]/g,"")}`} style={{ display:"flex",alignItems:"center",gap:12,padding:"14px 16px",borderRadius:14,background:"rgba(141,214,63,0.14)",border:"1px solid rgba(141,214,63,0.30)",textDecoration:"none",color:"#fff",marginBottom:10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <div style={{ flex:1 }}><div style={{ fontSize:13,fontWeight:700 }}>Call host</div><div style={{ fontSize:12,color:"rgba(255,255,255,0.55)" }}>{contactFor.hostPhone}</div></div>
            </a>
            <button onClick={() => setContactFor(null)} style={{ width:"100%",marginTop:14,padding:"12px 0",borderRadius:100,background:"transparent",border:"1px solid rgba(255,255,255,0.18)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer" }}>Close</button>
          </div>
        </div>
      )}
      {extendFor && (
        <div onClick={() => setExtendFor(null)} style={{ position:"absolute",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"flex-end",zIndex:50 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%",background:"#152849",borderTopLeftRadius:24,borderTopRightRadius:24,padding:"22px 20px calc(env(safe-area-inset-bottom) + 22px)",color:"#fff" }}>
            <div style={{ width:36,height:4,background:"rgba(255,255,255,0.18)",borderRadius:2,margin:"0 auto 16px" }} />
            <div style={{ fontSize:18,fontWeight:800,marginBottom:4 }}>Extend booking</div>
            <div style={{ fontSize:13,color:"rgba(255,255,255,0.55)",marginBottom:18 }}>Currently ends {fmtTime(extendFor.endTs)} on {fmtDate(extendFor.endTs)}</div>
            <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
              {[{label:"+30 minutes",ms:30*60*1000},{label:"+1 hour",ms:60*60*1000},{label:"+2 hours",ms:2*60*60*1000},{label:"+4 hours",ms:4*60*60*1000}].map(opt => (
                <button key={opt.label} onClick={() => applyExtend(extendFor,opt.ms)} style={{ width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px",borderRadius:14,background:"rgba(141,214,63,0.10)",border:"1px solid rgba(141,214,63,0.22)",color:"#fff",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:700 }}>
                  <span>{opt.label}</span>
                  <span style={{ fontSize:12,color:"rgba(255,255,255,0.55)",fontWeight:600 }}>+${(Math.round(extendFor.pricePerHr*(opt.ms/3600000)*100)/100).toFixed(2)}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setExtendFor(null)} style={{ width:"100%",marginTop:14,padding:"12px 0",borderRadius:100,background:"transparent",border:"1px solid rgba(255,255,255,0.18)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer" }}>Close</button>
          </div>
        </div>
      )}
      {confirmCancel && (
        <div onClick={() => setConfirmCancel(null)} style={{ position:"absolute",inset:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"flex-end",zIndex:50 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%",background:"#152849",borderTopLeftRadius:24,borderTopRightRadius:24,padding:"22px 20px calc(env(safe-area-inset-bottom) + 22px)",color:"#fff" }}>
            <div style={{ width:36,height:4,background:"rgba(255,255,255,0.18)",borderRadius:2,margin:"0 auto 16px" }} />
            <div style={{ fontSize:18,fontWeight:800,marginBottom:6 }}>Cancel this booking?</div>
            <div style={{ fontSize:13,color:"rgba(255,255,255,0.55)",marginBottom:18 }}>{confirmCancel.addr} · {fmtDate(confirmCancel.startTs)} {fmtTime(confirmCancel.startTs)}</div>
            <button onClick={() => doCancel(confirmCancel)} style={{ width:"100%",padding:"14px 0",borderRadius:100,background:"#ef4444",border:"none",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:700,cursor:"pointer",marginBottom:10 }}>Cancel booking</button>
            <button onClick={() => setConfirmCancel(null)} style={{ width:"100%",padding:"12px 0",borderRadius:100,background:"transparent",border:"1px solid rgba(255,255,255,0.18)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer" }}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}
