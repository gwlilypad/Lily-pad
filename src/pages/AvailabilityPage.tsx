import { useState } from "react";
import { useApp } from "@/context/AppContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DOW_FULL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

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
    const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (diff === 1) cur.push(sorted[i]);
    else { groups.push(cur); cur = [sorted[i]]; }
  }
  groups.push(cur);
  return groups.map(g => {
    const fmtD = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const label = g.length === 1
      ? fmtD(g[0])
      : `${fmtD(g[0])}–${new Date(g[g.length - 1] + "T12:00:00").getDate()}`;
    return { label, keys: g };
  });
}

function scheduleLabel(days: Set<number>) {
  if (days.size === 0) return "No days";
  if (days.size === 7) return "Every day";
  if ([1,2,3,4,5].every(d => days.has(d)) && days.size === 5) return "Mon–Fri";
  if ([0,6].every(d => days.has(d)) && days.size === 2) return "Weekends";
  const order = [0,1,2,3,4,5,6].filter(d => days.has(d));
  if (order.length <= 3) return order.map(d => DOW_FULL[d]).join(", ");
  return `${DOW_FULL[order[0]]}–${DOW_FULL[order[order.length - 1]]}`;
}

function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!on)} style={{
      width: 52, height: 30, borderRadius: 15, flexShrink: 0,
      background: on ? "#8DD63F" : "rgba(14,31,64,0.15)",
      position: "relative", cursor: "pointer",
      transition: "background 0.22s cubic-bezier(0.34,1.56,0.64,1)",
      boxShadow: on ? "0 2px 8px rgba(141,214,63,0.35)" : "none",
    }}>
      <div style={{
        position: "absolute", top: 3, left: on ? 24 : 3,
        width: 24, height: 24, borderRadius: "50%", background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.20)",
        transition: "left 0.22s cubic-bezier(0.34,1.56,0.64,1)",
      }} />
    </div>
  );
}

function SegmentedControl({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", background: "rgba(14,31,64,0.06)", borderRadius: 12, padding: 3, gap: 2 }}>
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          flex: 1, padding: "9px 0", borderRadius: 10, border: "none",
          background: value === opt ? "#fff" : "transparent",
          boxShadow: value === opt ? "0 1px 4px rgba(14,31,64,0.10)" : "none",
          fontFamily: "'DM Sans',sans-serif",
          fontSize: 13, fontWeight: value === opt ? 700 : 500,
          color: value === opt ? "#0E1F40" : "rgba(14,31,64,0.42)",
          cursor: "pointer", transition: "all 0.18s",
          letterSpacing: value === opt ? -0.2 : 0,
        }}>{opt}</button>
      ))}
    </div>
  );
}

function HourPickers({ fromHour, toHour, setFrom, setTo, selectStyle }: {
  fromHour: number; toHour: number;
  setFrom: (h: number) => void; setTo: (h: number) => void;
  selectStyle: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color: "rgba(14,31,64,0.38)", fontWeight: 700, marginBottom: 6, letterSpacing: 0.8, textTransform: "uppercase" }}>From</div>
        <select value={fromHour} onChange={e => setFrom(Number(e.target.value))} style={selectStyle}>
          {HOURS.map(h => <option key={h} value={h}>{fmt12(h)}</option>)}
        </select>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color: "rgba(14,31,64,0.38)", fontWeight: 700, marginBottom: 6, letterSpacing: 0.8, textTransform: "uppercase" }}>To</div>
        <select value={toHour} onChange={e => setTo(Number(e.target.value))} style={selectStyle}>
          {HOURS.filter(h => h > fromHour).map(h => <option key={h} value={h}>{fmt12(h)}</option>)}
        </select>
      </div>
    </div>
  );
}

export default function AvailabilityPage() {
  const { goTo, state, setState } = useApp();

  const [alwaysOn, setAlwaysOn] = useState(true);

  // Custom schedule
  const [activeDays, setActiveDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  const [schedHours, setSchedHours] = useState<"All day" | "Set hours">("All day");
  const [fromHour, setFromHour] = useState(7);
  const [toHour, setToHour] = useState(18);

  // Block off dates
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());
  const [blockHours, setBlockHours] = useState<"All day" | "Certain hours">("All day");
  const [blockFrom, setBlockFrom] = useState(9);
  const [blockTo, setBlockTo] = useState(17);
  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  function dateKey(day: number) {
    return `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }
  function isPast(day: number) { return dateKey(day) < todayStr; }
  function toggleDay(i: number) {
    setActiveDays(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
  }
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

  const activeHours = schedHours === "All day" ? 24 : (toHour > fromHour ? toHour - fromHour : 0);
  const hoursPerWeek = activeDays.size * activeHours;
  const sched = scheduleLabel(activeDays);
  const schedDetail = activeDays.size === 0 ? "No days" :
    schedHours === "All day"
      ? `${sched}, all day`
      : `${sched}, ${fmtShort(fromHour)}–${fmtShort(toHour)}`;

  const blockHoursLabel = blockHours === "Certain hours" ? ` · ${fmtShort(blockFrom)}–${fmtShort(blockTo)}` : "";

  const selectStyle: React.CSSProperties = {
    width: "100%", padding: "12px 14px", borderRadius: 12,
    border: "1px solid rgba(14,31,64,0.12)",
    background: "#fff", fontSize: 15, fontWeight: 600,
    color: "#0E1F40", fontFamily: "'DM Sans', sans-serif",
    cursor: "pointer", appearance: "none", WebkitAppearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%230E1F40' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "calc(100% - 14px) center",
    paddingRight: 36,
  };

  const sectionLabel = (text: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.38)", marginBottom: 10, letterSpacing: 0.6, textTransform: "uppercase" }}>
      {text}
    </div>
  );

  return (
    <div className="page active">
      <SharedHeader step="Step 4 of 6" title="When is your spot open?" progress={50} label="Profile 50% complete" />
      <div className="s-divider" />
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        <div style={{ flexShrink: 0, padding: "14px 16px 0" }}>
          <NavBar onBack={() => goTo("photo")} onHome={() => goTo("home")} dots={[0,1,2,3,4,5]} currentDot={3} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px 32px", display: "flex", flexDirection: "column", gap: 0 }}>

          {/* ── Always Available toggle ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#0E1F40", letterSpacing: -0.3 }}>Always available</div>
              <div style={{ fontSize: 12.5, color: "rgba(14,31,64,0.42)", marginTop: 3 }}>Open every day by default</div>
            </div>
            <ToggleSwitch on={alwaysOn} onChange={setAlwaysOn} />
          </div>

          <div style={{ height: 1, background: "rgba(14,31,64,0.07)", marginBottom: 22 }} />

          {alwaysOn ? (
            /* ══ ALWAYS-ON MODE ══ */
            <>
              {sectionLabel("Block off dates you need your spot back")}

              {/* Tap to open calendar */}
              <div onClick={() => setCalOpen(o => !o)} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 16px", borderRadius: 14,
                border: "1px solid rgba(14,31,64,0.12)", background: "#fff",
                cursor: "pointer", marginBottom: 12,
              }}>
                <span style={{ fontSize: 14, color: "rgba(14,31,64,0.35)", fontWeight: 500 }}>
                  {blockedCount === 0 ? "Tap to add blocked dates" : `${blockedCount} date${blockedCount !== 1 ? "s" : ""} blocked`}
                </span>
                <span style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(14,31,64,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "rgba(14,31,64,0.35)", flexShrink: 0 }}>
                  {calOpen ? "−" : "+"}
                </span>
              </div>

              {/* Inline calendar */}
              {calOpen && (
                <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(14,31,64,0.10)", padding: "14px 12px 12px", marginBottom: 14, boxShadow: "0 4px 20px rgba(14,31,64,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid rgba(14,31,64,0.06)" }}>
                    <button onClick={() => setCalMonth(new Date(year, month-1, 1))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "rgba(14,31,64,0.4)", padding: "0 8px", fontFamily: "'DM Sans',sans-serif" }}>‹</button>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#0E1F40" }}>{MONTH_NAMES[month]} {year}</span>
                    <button onClick={() => setCalMonth(new Date(year, month+1, 1))} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "rgba(14,31,64,0.4)", padding: "0 8px", fontFamily: "'DM Sans',sans-serif" }}>›</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", marginBottom: 4 }}>
                    {DOW.map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.28)", padding: "3px 0", letterSpacing: 0.5 }}>{d}</div>)}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
                    {Array.from({ length: firstDow }, (_,i) => <div key={`e${i}`} />)}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const k = dateKey(day);
                      const past = isPast(day);
                      const blocked = blockedDates.has(k);
                      const isTdy = k === todayStr;
                      return (
                        <div key={day} onClick={() => !past && toggleBlocked(day)} style={{
                          height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: past ? "default" : "pointer",
                          background: blocked ? "#0E1F40" : isTdy ? "rgba(141,214,63,0.15)" : "transparent",
                          border: isTdy && !blocked ? "1.5px solid #8DD63F" : "none",
                          opacity: past ? 0.28 : 1, transition: "background 0.15s",
                        }}>
                          <span style={{ fontSize: 13, fontWeight: blocked ? 700 : 500, color: blocked ? "#fff" : isTdy ? "#0E1F40" : "rgba(14,31,64,0.75)" }}>{day}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: "rgba(14,31,64,0.32)", textAlign: "center" }}>Tap a date to block · tap again to unblock</div>
                </div>
              )}

              {/* Blocked date pills */}
              {pills.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {pills.map(p => (
                    <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20, background: "rgba(255,70,70,0.09)", border: "1px solid rgba(255,70,70,0.18)" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#b83232" }}>{p.label}</span>
                      <span onClick={() => removeGroup(p.keys)} style={{ fontSize: 12, color: "rgba(184,50,50,0.55)", cursor: "pointer", lineHeight: 1 }}>✕</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Block hours ── */}
              {blockedCount > 0 && (
                <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(14,31,64,0.10)", padding: "14px 14px", marginBottom: 16 }}>
                  {sectionLabel("Block hours")}
                  <SegmentedControl
                    options={["All day", "Certain hours"]}
                    value={blockHours}
                    onChange={v => setBlockHours(v as "All day" | "Certain hours")}
                  />
                  {blockHours === "Certain hours" && (
                    <HourPickers fromHour={blockFrom} toHour={blockTo} setFrom={setBlockFrom} setTo={setBlockTo} selectStyle={selectStyle} />
                  )}
                </div>
              )}

              {/* Stats */}
              <div style={{ background: "rgba(141,214,63,0.08)", borderRadius: 14, border: "1px solid rgba(141,214,63,0.18)", padding: "14px 16px", marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: "rgba(14,31,64,0.55)", fontWeight: 500 }}>Available</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1F40" }}>{availableDays} days/yr</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "rgba(14,31,64,0.55)", fontWeight: 500 }}>Blocked</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1F40" }}>{blockedCount} {blockedCount === 1 ? "day" : "days"}{blockHoursLabel}</span>
                </div>
              </div>
            </>
          ) : (
            /* ══ CUSTOM SCHEDULE MODE ══ */
            <>
              {sectionLabel("Available days")}
              <div style={{ display: "flex", gap: 7, marginBottom: 20 }}>
                {DOW.map((d, i) => {
                  const on = activeDays.has(i);
                  return (
                    <button key={d} onClick={() => toggleDay(i)} style={{
                      flex: 1, padding: "12px 0", borderRadius: 12,
                      background: on ? "#0E1F40" : "#fff",
                      border: `1px solid ${on ? "#0E1F40" : "rgba(14,31,64,0.14)"}`,
                      cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                      fontSize: 12, fontWeight: 700,
                      color: on ? "#fff" : "rgba(14,31,64,0.40)",
                      transition: "all 0.18s", letterSpacing: 0.2,
                    }}>{d}</button>
                  );
                })}
              </div>

              {/* ── Schedule hours ── */}
              <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(14,31,64,0.10)", padding: "14px 14px", marginBottom: 20 }}>
                {sectionLabel("Available hours")}
                <SegmentedControl
                  options={["All day", "Set hours"]}
                  value={schedHours}
                  onChange={v => setSchedHours(v as "All day" | "Set hours")}
                />
                {schedHours === "Set hours" && (
                  <HourPickers fromHour={fromHour} toHour={toHour} setFrom={setFromHour} setTo={setToHour} selectStyle={selectStyle} />
                )}
              </div>

              {/* Stats */}
              <div style={{ background: "rgba(141,214,63,0.08)", borderRadius: 14, border: "1px solid rgba(141,214,63,0.18)", padding: "14px 16px", marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: "rgba(14,31,64,0.55)", fontWeight: 500 }}>Schedule</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1F40" }}>{schedDetail}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "rgba(14,31,64,0.55)", fontWeight: 500 }}>Hours/week</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#0E1F40" }}>{hoursPerWeek} hrs</span>
                </div>
              </div>
            </>
          )}

          {/* CTA */}
          <button onClick={() => {
            if (state.addingExtraPad) {
              setState(s => ({ ...s, addingExtraPad: false }));
              goTo("paddashboard");
            } else {
              goTo("listingsuccess");
            }
          }} style={{
            width: "100%", padding: "16px 0", borderRadius: 100,
            background: "#8DD63F", border: "none", cursor: "pointer",
            fontSize: 16, fontWeight: 700, color: "#fff",
            fontFamily: "'DM Sans',sans-serif", letterSpacing: -0.2,
            boxShadow: "0 4px 16px rgba(141,214,63,0.30)",
          }}>
            Looks good →
          </button>
        </div>
      </div>
    </div>
  );
}
