import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";

const NAVY  = "#0E1F40";
const GREEN = "#8DD63F";

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmt12(h: number) {
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}
function fmtShort(h: number) {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function groupDatePills(sorted: string[]): { label: string; keys: string[] }[] {
  if (!sorted.length) return [];
  const groups: string[][] = [];
  let cur: string[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + "T12:00:00");
    const curr = new Date(sorted[i] + "T12:00:00");
    if (Math.round((curr.getTime() - prev.getTime()) / 86400000) === 1) cur.push(sorted[i]);
    else { groups.push(cur); cur = [sorted[i]]; }
  }
  groups.push(cur);
  return groups.map(g => {
    const fmtD = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const label = g.length === 1 ? fmtD(g[0]) : `${fmtD(g[0])}–${new Date(g[g.length-1]+"T12:00:00").getDate()}`;
    return { label, keys: g };
  });
}

function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!on)}
      role="switch" aria-checked={on}
      style={{
        width: 50, height: 28, borderRadius: 14, flexShrink: 0,
        background: on ? GREEN : "rgba(14,31,64,0.18)",
        position: "relative", cursor: "pointer",
        transition: "background 0.22s cubic-bezier(0.34,1.56,0.64,1)",
        boxShadow: on ? "0 2px 8px rgba(141,214,63,0.40)" : "none",
      }}
    >
      <div style={{
        position: "absolute", top: 3, left: on ? 23 : 3,
        width: 22, height: 22, borderRadius: "50%", background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
        transition: "left 0.22s cubic-bezier(0.34,1.56,0.64,1)",
      }} />
    </div>
  );
}

export default function AvailabilityPage() {
  const { goTo, state, setState } = useApp();
  const navigate = useNavigate();

  const [padActive, setPadActive] = useState(true);
  const [resetTomorrow, setResetTomorrow] = useState(false);

  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());
  const [blockHours, setBlockHours] = useState<"All day" | "Certain hours">("All day");
  const [blockFrom, setBlockFrom] = useState(9);
  const [blockTo, setBlockTo] = useState(17);
  const [calOpen, setCalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const today    = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  function dateKey(day: number) {
    return `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }
  function isPast(day: number) { return dateKey(day) < todayStr; }
  function toggleBlocked(day: number) {
    if (isPast(day)) return;
    const k = dateKey(day);
    setBlockedDates(prev => { const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s; });
  }
  function removeGroup(keys: string[]) {
    setBlockedDates(prev => { const s = new Set(prev); keys.forEach(k => s.delete(k)); return s; });
  }

  const sortedBlocked = [...blockedDates].sort();
  const pills = groupDatePills(sortedBlocked);
  const blockedCount = blockedDates.size;
  const availableDays = 365 - blockedCount;
  const blockHoursLabel = blockHours === "Certain hours" ? ` · ${fmtShort(blockFrom)}–${fmtShort(blockTo)}` : "";

  const selectStyle: React.CSSProperties = {
    width: "100%", padding: "11px 14px", borderRadius: 10,
    border: "1.5px solid rgba(14,31,64,0.13)",
    background: "#fff", fontSize: 14, fontWeight: 600,
    color: NAVY, fontFamily: "'DM Sans', sans-serif",
    cursor: "pointer", appearance: "none", WebkitAppearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%230E1F40' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "calc(100% - 14px) center",
    paddingRight: 36,
  };

  const sectionLbl = (text: string) => (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.40)", letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 10 }}>
      {text}
    </div>
  );

  // Tomorrow label for auto-reset option
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowLabel = tomorrow.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  async function submitListing() {
    if (!state.apAns[0]) {
      setSubmitError("Your listing address is missing. Please go back and add it.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Please sign in before submitting your listing.");
      const availability = {
        active: padActive,
        blockedDates: sortedBlocked,
        blockHours,
        blockFrom,
        blockTo,
        resetTomorrow,
      };
      const res = await fetch("/api/spots", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          host_user_id: data.session?.user.id,
          address: state.apAns[0],
          pad_type: state.apAns[1] || "Driveway",
          surface: state.apAns[2] || "Concrete",
          num_pads: Number(state.apAns[3] || state.apNumPads || 1),
          price_per_hr: Number(state.apAns[4] || 0),
          description: state.apAns[5] || "",
          photo_url: state.apPhotoUrls[0] || state.apPhotoUrl || "",
          photo_urls: state.apPhotoUrls,
          lat: state.apLat,
          lng: state.apLng,
          availability,
          status: "pending",
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error || "We couldn't save your listing. Please try again.");
      if (!payload?.id) throw new Error("The listing was not saved. Please try again.");
      setState(s => ({ ...s, apSpotId: String(payload.id), apAvailability: availability, addingExtraPad: false }));
      goTo("listingsuccess");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "We couldn't save your listing. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page active">
      <SharedHeader step="Step 4 of 6" title="When is your spot open?" progress={50} label="Profile 50% complete" />
      <div className="s-divider" />

      {/* ── White tab body ── */}
      <div className="s-body" style={{ alignItems: "stretch", padding: "14px 16px 24px", gap: 0 }}>

        <NavBar onBack={() => navigate(-1)} onHome={() => goTo("home")} dots={[0,1,2,3,4,5]} currentDot={3} />

        <div style={{ height: 16 }} />

        {/* ── Toggle card ── */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", borderRadius: 14,
          background: "#fff",
          border: `1.5px solid ${padActive ? "rgba(141,214,63,0.35)" : "rgba(14,31,64,0.10)"}`,
          boxShadow: padActive ? "0 2px 12px rgba(141,214,63,0.12)" : "0 1px 6px rgba(14,31,64,0.05)",
          marginBottom: 20,
          transition: "border-color 0.25s, box-shadow 0.25s",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            {/* Status dot */}
            <div style={{
              width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
              background: padActive ? GREEN : "rgba(14,31,64,0.20)",
              boxShadow: padActive ? "0 0 7px rgba(141,214,63,0.70)" : "none",
              transition: "background 0.25s, box-shadow 0.25s",
            }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, letterSpacing: -0.2 }}>
                {padActive ? "Pad is open" : "Pad is closed"}
              </div>
              <div style={{ fontSize: 12, color: "rgba(14,31,64,0.45)", marginTop: 2 }}>
                {padActive ? "Accepting bookings" : "Not accepting new bookings"}
              </div>
            </div>
          </div>
          <ToggleSwitch on={padActive} onChange={v => { setPadActive(v); if (v) setResetTomorrow(false); }} />
        </div>

        {/* ════════════════════════════════
            PAD OFF — warning + options
            ════════════════════════════════ */}
        {!padActive && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>

            {/* Warning */}
            <div style={{
              display: "flex", gap: 12, padding: "13px 15px", borderRadius: 12,
              background: "rgba(255,185,0,0.08)", border: "1.5px solid rgba(255,185,0,0.28)",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="rgba(255,185,0,0.20)" stroke="#c08000" strokeWidth="1.5" strokeLinejoin="round"/>
                <line x1="12" y1="9" x2="12" y2="13" stroke="#c08000" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="12" cy="17" r="0.9" fill="#c08000"/>
              </svg>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#7a5000", marginBottom: 3 }}>
                  Active bookings will complete normally
                </div>
                <div style={{ fontSize: 12, color: "rgba(122,80,0,0.80)", lineHeight: 1.5 }}>
                  Any booking already in progress finishes as usual. After it ends, your pad will close and won't accept new bookings.
                </div>
              </div>
            </div>

            {/* When to reopen */}
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.40)", letterSpacing: 0.7, textTransform: "uppercase", margin: "4px 2px 6px" }}>
              When should it reopen?
            </div>

            {/* Option A — reset at 9am tomorrow */}
            <button
              onClick={() => setResetTomorrow(v => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 13,
                padding: "13px 15px", borderRadius: 13,
                background: resetTomorrow ? "rgba(141,214,63,0.08)" : "#fff",
                border: `1.5px solid ${resetTomorrow ? GREEN : "rgba(14,31,64,0.11)"}`,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                textAlign: "left", width: "100%",
                transition: "border-color 0.18s, background 0.18s",
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                background: resetTomorrow ? GREEN : "rgba(14,31,64,0.07)",
                border: `2px solid ${resetTomorrow ? GREEN : "rgba(14,31,64,0.14)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.18s",
              }}>
                {resetTomorrow && (
                  <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
                    <path d="M1 4L4 7L10 1" stroke={NAVY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, letterSpacing: -0.2 }}>
                  Reset to ON at 9 am tomorrow
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(14,31,64,0.45)", marginTop: 2 }}>
                  {tomorrowLabel} · Reopens automatically
                </div>
              </div>
              {resetTomorrow && (
                <div style={{ flexShrink: 0, background: GREEN, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: NAVY }}>
                  Set
                </div>
              )}
            </button>

            {/* Option B — stay off indefinitely (passive) */}
            <div style={{
              display: "flex", alignItems: "center", gap: 13,
              padding: "13px 15px", borderRadius: 13,
              background: !resetTomorrow ? "rgba(14,31,64,0.04)" : "#fff",
              border: `1.5px solid ${!resetTomorrow ? "rgba(14,31,64,0.16)" : "rgba(14,31,64,0.08)"}`,
              transition: "all 0.18s",
            }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                background: !resetTomorrow ? NAVY : "rgba(14,31,64,0.07)",
                border: `2px solid ${!resetTomorrow ? NAVY : "rgba(14,31,64,0.14)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.18s",
              }}>
                {!resetTomorrow && (
                  <svg width="11" height="8" viewBox="0 0 11 8" fill="none">
                    <path d="M1 4L4 7L10 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, letterSpacing: -0.2 }}>
                  Stay off indefinitely
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(14,31,64,0.45)", marginTop: 2 }}>
                  You'll turn it back on manually
                </div>
              </div>
              {!resetTomorrow && (
                <div style={{ flexShrink: 0, background: NAVY, borderRadius: 20, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#fff" }}>
                  Set
                </div>
              )}
            </div>

          </div>
        )}

        {/* ════════════════════════════════
            PAD ON — blocked dates tab
            ════════════════════════════════ */}
        {padActive && (
          <>
            {/* White inner card — the "tab" for the calendar */}
            <div style={{
              background: "#fff",
              borderRadius: 16,
              border: "1.5px solid rgba(14,31,64,0.09)",
              boxShadow: "0 2px 12px rgba(14,31,64,0.06)",
              overflow: "hidden",
              marginBottom: 14,
            }}>
              {/* Tab header — tap to open/close calendar */}
              <div
                onClick={() => setCalOpen(o => !o)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "14px 16px",
                  borderBottom: calOpen ? "1px solid rgba(14,31,64,0.08)" : "none",
                  cursor: "pointer",
                  background: calOpen ? "rgba(14,31,64,0.02)" : "#fff",
                  transition: "background 0.15s",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, letterSpacing: -0.2 }}>
                    {blockedCount === 0 ? "Block off dates" : `${blockedCount} date${blockedCount !== 1 ? "s" : ""} blocked`}
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(14,31,64,0.42)", marginTop: 2 }}>
                    {blockedCount === 0 ? "Need your spot back on certain days?" : "Tap to edit your blocked dates"}
                  </div>
                </div>
                <div style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: "rgba(14,31,64,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  transition: "transform 0.2s",
                  transform: calOpen ? "rotate(45deg)" : "none",
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </div>
              </div>

              {/* Calendar */}
              {calOpen && (
                <div style={{ padding: "14px 14px 10px" }}>
                  {/* Month nav */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <button onClick={() => setCalMonth(new Date(year, month-1, 1))}
                      style={{ background: "rgba(14,31,64,0.06)", border: "none", cursor: "pointer", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: NAVY }}>
                      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M7 1L1 7l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                    </button>
                    <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{MONTH_NAMES[month]} {year}</span>
                    <button onClick={() => setCalMonth(new Date(year, month+1, 1))}
                      style={{ background: "rgba(14,31,64,0.06)", border: "none", cursor: "pointer", width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: NAVY }}>
                      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                    </button>
                  </div>

                  {/* Day labels */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
                    {DOW.map(d => (
                      <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.30)", padding: "3px 0", letterSpacing: 0.5 }}>{d}</div>
                    ))}
                  </div>

                  {/* Days */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 3 }}>
                    {Array.from({ length: firstDow }, (_,i) => <div key={`e${i}`} />)}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const k = dateKey(day);
                      const past = isPast(day);
                      const blocked = blockedDates.has(k);
                      const isTdy = k === todayStr;
                      return (
                        <div
                          key={day}
                          onClick={() => !past && toggleBlocked(day)}
                          style={{
                            height: 36, borderRadius: 9,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: past ? "default" : "pointer",
                            background: blocked ? NAVY : isTdy ? "rgba(141,214,63,0.18)" : "transparent",
                            border: isTdy && !blocked ? `1.5px solid ${GREEN}` : "none",
                            opacity: past ? 0.25 : 1,
                            transition: "background 0.14s",
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: blocked ? 700 : 500, color: blocked ? "#fff" : isTdy ? NAVY : "rgba(14,31,64,0.75)" }}>
                            {day}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: 10, fontSize: 11, color: "rgba(14,31,64,0.35)", textAlign: "center" }}>
                    Tap a date to block it · tap again to unblock
                  </div>
                </div>
              )}

              {/* Blocked date pills */}
              {pills.length > 0 && (
                <div style={{ padding: "10px 14px 12px", borderTop: calOpen ? "1px solid rgba(14,31,64,0.07)" : "none" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {pills.map(p => (
                      <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 20, background: "rgba(220,60,60,0.08)", border: "1px solid rgba(220,60,60,0.20)" }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#b83232" }}>{p.label}</span>
                        <span onClick={() => removeGroup(p.keys)} style={{ fontSize: 11, color: "rgba(184,50,50,0.55)", cursor: "pointer", lineHeight: 1 }}>✕</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Block hours — only when dates are blocked */}
            {blockedCount > 0 && (
              <div style={{ background: "#fff", borderRadius: 14, border: "1.5px solid rgba(14,31,64,0.09)", padding: "14px 16px", marginBottom: 14, boxShadow: "0 1px 6px rgba(14,31,64,0.05)" }}>
                {sectionLbl("Block hours")}
                <div style={{ display: "flex", background: "rgba(14,31,64,0.06)", borderRadius: 10, padding: 3, gap: 2 }}>
                  {(["All day", "Certain hours"] as const).map(opt => (
                    <button key={opt} onClick={() => setBlockHours(opt)} style={{
                      flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                      background: blockHours === opt ? "#fff" : "transparent",
                      boxShadow: blockHours === opt ? "0 1px 4px rgba(14,31,64,0.10)" : "none",
                      fontFamily: "'DM Sans',sans-serif", fontSize: 13,
                      fontWeight: blockHours === opt ? 700 : 500,
                      color: blockHours === opt ? NAVY : "rgba(14,31,64,0.42)",
                      cursor: "pointer", transition: "all 0.15s",
                    }}>{opt}</button>
                  ))}
                </div>
                {blockHours === "Certain hours" && (
                  <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
                    {[{ label: "From", val: blockFrom, set: setBlockFrom }, { label: "To", val: blockTo, set: setBlockTo }].map(({ label, val, set }) => (
                      <div key={label} style={{ flex: 1 }}>
                        <div style={{ fontSize: 10, color: "rgba(14,31,64,0.38)", fontWeight: 700, marginBottom: 6, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</div>
                        <select value={val} onChange={e => set(Number(e.target.value))} style={selectStyle}>
                          {Array.from({length: 24}, (_,h) => h).filter(h => label === "To" ? h > blockFrom : true).map(h => (
                            <option key={h} value={h}>{fmt12(h)}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Stats */}
            <div style={{ background: "#fff", borderRadius: 14, border: "1.5px solid rgba(141,214,63,0.25)", padding: "13px 16px", marginBottom: 24, boxShadow: "0 1px 6px rgba(141,214,63,0.10)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "rgba(14,31,64,0.52)", fontWeight: 500 }}>Available</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{availableDays} days/yr</span>
              </div>
              <div style={{ height: 1, background: "rgba(14,31,64,0.07)", marginBottom: 8 }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "rgba(14,31,64,0.52)", fontWeight: 500 }}>Blocked</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>
                  {blockedCount} {blockedCount === 1 ? "day" : "days"}{blockHoursLabel}
                </span>
              </div>
            </div>
          </>
        )}

        {/* CTA */}
        <button
          onClick={submitListing}
          disabled={submitting}
          style={{
            width: "100%", padding: "16px 0", borderRadius: 100,
            background: GREEN, border: "none", cursor: "pointer",
            fontSize: 16, fontWeight: 700, color: "#fff",
            fontFamily: "'DM Sans',sans-serif", letterSpacing: -0.2,
            boxShadow: "0 4px 16px rgba(141,214,63,0.30)", opacity: submitting ? 0.65 : 1,
            marginTop: "auto",
          }}
        >
          {submitting ? "Submitting…" : "Submit listing →"}
        </button>
        {submitError && <p role="alert" style={{ color: "#c53030", fontSize: 12.5, fontWeight: 600, textAlign: "center", margin: "10px 4px 0", lineHeight: 1.4 }}>{submitError}</p>}

      </div>
    </div>
  );
}
