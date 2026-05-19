import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

interface Pad {
  id: number;
  // Vital — locked (can't be changed; would affect bookings)
  address: string;
  city: string;
  type: string;          // Driveway / Business lot
  spotCount: number;
  // Editable
  nickname: string;
  price: number;         // $/hr
  description: string;
  services: string[];
  photoUrl: string;
  // Display only
  status: "active" | "paused";
  pausedUntil?: number | null; // unix ms; null/undefined = indefinite
  since: string;
  bookings: number;
}

const ALL_SERVICES = [
  "EV charging", "Covered parking", "Security camera", "Lighting at night",
  "24/7 access", "Wheelchair accessible", "Wide spot", "Surface paved",
];

const MOCK_PADS: Pad[] = [
  {
    id: 1,
    address: "142 Maple Street", city: "Austin, TX", type: "Driveway", spotCount: 1,
    nickname: "Front driveway", price: 4,
    description: "Easy-access driveway right off the main road. Great for downtown commuters.",
    services: ["Lighting at night", "24/7 access"],
    photoUrl: "https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=600&q=70",
    status: "active", since: "Mar 2025", bookings: 14,
  },
  {
    id: 2,
    address: "880 Oak Lane", city: "Austin, TX", type: "Driveway", spotCount: 2,
    nickname: "Side gravel pad", price: 3,
    description: "Two-car gravel pad next to the house. Quiet residential street.",
    services: ["Wide spot", "Surface paved"],
    photoUrl: "https://images.unsplash.com/photo-1448630360428-65456885c650?w=600&q=70",
    status: "active", since: "Jan 2025", bookings: 22,
  },
];

function StatusPill({ pad }: { pad: Pad }) {
  const active = pad.status === "active";
  const tonightLabel = pad.pausedUntil ? "Paused · tonight" : "Paused";
  return (
    <div style={{
      background: active ? "rgba(141,214,63,0.18)" : "rgba(255,200,0,0.18)",
      border: `1px solid ${active ? "rgba(141,214,63,0.40)" : "rgba(255,200,0,0.35)"}`,
      borderRadius: 20, padding: "4px 10px",
      fontSize: 10, fontWeight: 800,
      color: active ? "#5a9e1a" : "#a07800",
      letterSpacing: 0.5, textTransform: "uppercase",
    }}>
      {active ? "● Active" : tonightLabel}
    </div>
  );
}

function PauseSwitch({ paused, onPress }: { paused: boolean; onPress: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onPress(e); }}
      title={paused ? "Re-open this pad for bookings" : "Stop new bookings"}
      style={{
        width: 44, height: 26, borderRadius: 100, position: "relative",
        background: paused ? "rgba(14,31,64,0.18)" : "rgba(141,214,63,0.55)",
        border: `1px solid ${paused ? "rgba(14,31,64,0.20)" : "rgba(141,214,63,0.65)"}`,
        cursor: "pointer", padding: 0, flexShrink: 0,
        transition: "all 0.18s",
      }}>
      <span style={{
        position: "absolute", top: 2, left: paused ? 2 : 20, width: 20, height: 20,
        background: "#fff", borderRadius: "50%",
        boxShadow: "0 1px 3px rgba(14,31,64,0.25)",
        transition: "left 0.18s",
      }} />
    </button>
  );
}

function LockedRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 0", borderBottom: "1px solid rgba(14,31,64,0.06)", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.40)", letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: NAVY, marginTop: 2 }}>{value}</div>
      </div>
      <div title="Locked — contact support to change"
        style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(14,31,64,0.30)", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", flexShrink: 0 }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Locked
      </div>
    </div>
  );
}

export default function PadDashboardPage() {
  const { goTo, setState } = useApp();
  const [pads, setPads] = useState<Pad[]>(MOCK_PADS);
  function startAddPad() {
    setState(s => ({ ...s, addingExtraPad: true, apAns: {} }));
    goTo("addpad");
  }
  // Persist pads to local storage so the host's listings survive a refresh.
  const PADS_KEY = "lilypad.pads.v1";
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PADS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Pad[];
        if (Array.isArray(saved) && saved.length > 0) setPads(saved);
      }
    } catch {}
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PADS_KEY, JSON.stringify(pads));
    } catch {}
  }, [pads]);

  const [openPadId, setOpenPadId] = useState<number | null>(null);
  const [pendingPauseId, setPendingPauseId] = useState<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const openPad = openPadId == null ? null : pads.find(p => p.id === openPadId) || null;
  const pendingPad = pendingPauseId == null ? null : pads.find(p => p.id === pendingPauseId) || null;

  // Sort: active first, paused last; preserve original order within each group.
  const sortedPads = [...pads].sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === "paused" ? 1 : -1;
  });

  function updatePad(id: number, patch: Partial<Pad>) {
    setPads(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  function requestPauseToggle(id: number) {
    const pad = pads.find(p => p.id === id);
    if (!pad) return;
    if (pad.status === "paused") {
      // Re-opening doesn't need confirmation.
      updatePad(id, { status: "active", pausedUntil: null });
      return;
    }
    setPendingPauseId(id);
  }

  // Auto-resume "Just for tonight" pauses once the cutoff has passed.
  useEffect(() => {
    function checkExpiry() {
      const now = Date.now();
      setPads(prev => {
        let changed = false;
        const next = prev.map(p => {
          if (p.status === "paused" && p.pausedUntil && p.pausedUntil <= now) {
            changed = true;
            return { ...p, status: "active" as const, pausedUntil: null };
          }
          return p;
        });
        return changed ? next : prev;
      });
    }
    checkExpiry();
    const id = window.setInterval(checkExpiry, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") checkExpiry(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  function confirmPauseFor(scope: "tonight" | "indefinite") {
    if (pendingPauseId == null) return;
    const tomorrow6am = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(6, 0, 0, 0);
      return d.getTime();
    })();
    updatePad(pendingPauseId, {
      status: "paused",
      pausedUntil: scope === "tonight" ? tomorrow6am : null,
    });
    setPendingPauseId(null);
  }

  function toggleService(id: number, service: string) {
    setPads(prev => prev.map(p => {
      if (p.id !== id) return p;
      const has = p.services.includes(service);
      return { ...p, services: has ? p.services.filter(s => s !== service) : [...p.services, service] };
    }));
  }

  function onPhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!openPad) return;
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => updatePad(openPad.id, { photoUrl: String(reader.result) });
    reader.readAsDataURL(f);
  }

  return (
    <div className="page active" style={{ background: "#f5f7fa", display: "flex", flexDirection: "column", fontFamily: "'DM Sans',sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: "52px 20px 22px", background: NAVY }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>
              {openPad ? openPad.nickname || openPad.address : "My Pads"}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>
              {openPad ? `${openPad.address} · ${openPad.city}` : `${pads.length} listing${pads.length !== 1 ? "s" : ""}`}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 32px" }}>

        {!openPad ? (
          /* ── LIST VIEW ── */
          <>
            {(() => {
              const totalEarnings = pads.reduce((sum, p) => sum + p.bookings * p.price * 2, 0);
              const totalBookings = pads.reduce((sum, p) => sum + p.bookings, 0);
              const activeCount = pads.filter(p => p.status === "active").length;
              const monthEarnings = Math.round(totalEarnings * 0.32);
              const lastMonthEarnings = Math.round(totalEarnings * 0.27);
              const monthDelta = lastMonthEarnings === 0 ? 0 : Math.round(((monthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100);
              const occupancy = Math.min(98, Math.round((totalBookings / Math.max(1, pads.length * 30)) * 100));

              const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
              const seed = totalEarnings || 42;
              const dailyBars = dayLabels.map((_, i) => {
                const base = ((Math.sin(seed + i * 1.3) + 1) / 2);
                return 0.25 + base * 0.75;
              });
              const maxBar = Math.max(...dailyBars);

              return (
                <>
                  {/* Earnings hero */}
                  <div style={{
                    background: `linear-gradient(140deg, ${NAVY} 0%, #16315a 100%)`,
                    borderRadius: 20, padding: "18px 18px 16px", marginBottom: 14,
                    color: "#fff", boxShadow: "0 4px 18px rgba(14,31,64,0.18)",
                    position: "relative", overflow: "hidden",
                  }}>
                    <div style={{ position: "absolute", top: -30, right: -30, width: 140, height: 140, background: "radial-gradient(circle, rgba(141,214,63,0.20), transparent 65%)", borderRadius: "50%" }} />
                    <div style={{ position: "relative" }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 4 }}>
                        Total earnings · all time
                      </div>
                      <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1.05 }}>
                        ${totalEarnings.toLocaleString()}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                        <span style={{
                          background: monthDelta >= 0 ? "rgba(141,214,63,0.18)" : "rgba(255,120,120,0.18)",
                          color: monthDelta >= 0 ? GREEN : "#ff8585",
                          padding: "2px 8px", borderRadius: 100, fontSize: 11, fontWeight: 700,
                          display: "inline-flex", alignItems: "center", gap: 3,
                        }}>
                          {monthDelta >= 0 ? "▲" : "▼"} {Math.abs(monthDelta)}%
                        </span>
                        <span>${monthEarnings.toLocaleString()} this month</span>
                      </div>

                      {/* Mini bar chart */}
                      <div style={{ marginTop: 16, display: "flex", alignItems: "flex-end", gap: 6, height: 48 }}>
                        {dailyBars.map((h, i) => (
                          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{
                              width: "100%", height: `${(h / maxBar) * 100}%`,
                              background: i === 6 ? GREEN : "rgba(141,214,63,0.45)",
                              borderRadius: "4px 4px 2px 2px",
                              transition: "height 0.3s",
                            }} />
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.40)", fontWeight: 600, letterSpacing: 0.3 }}>{dayLabels[i]}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.40)", marginTop: 6, letterSpacing: 0.3 }}>
                        Earnings · last 7 days
                      </div>
                    </div>
                  </div>

                  {/* Stats grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18 }}>
                    {[
                      { l: "Bookings", v: String(totalBookings), sub: "all time" },
                      { l: "Active pads", v: `${activeCount}/${pads.length}`, sub: pads.length === 1 ? "listing" : "listings" },
                      { l: "Occupancy", v: `${occupancy}%`, sub: "this month" },
                    ].map(s => (
                      <div key={s.l} style={{ background: "#fff", borderRadius: 14, padding: "11px 12px", border: "1px solid rgba(14,31,64,0.07)" }}>
                        <div style={{ fontSize: 9.5, color: "rgba(14,31,64,0.32)", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{s.l}</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: NAVY, letterSpacing: -0.5, lineHeight: 1 }}>{s.v}</div>
                        <div style={{ fontSize: 10, color: "rgba(14,31,64,0.40)", marginTop: 4 }}>{s.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Per-pad earnings breakdown */}
                  {pads.length > 1 && (
                    <div style={{ background: "#fff", borderRadius: 14, padding: "14px 14px", marginBottom: 18, border: "1px solid rgba(14,31,64,0.07)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.5, textTransform: "uppercase" }}>Earnings by pad</span>
                        <span style={{ fontSize: 10.5, color: "rgba(14,31,64,0.35)" }}>all time</span>
                      </div>
                      {pads.map(p => {
                        const earn = p.bookings * p.price * 2;
                        const pct = totalEarnings === 0 ? 0 : (earn / totalEarnings) * 100;
                        return (
                          <div key={p.id} style={{ marginBottom: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "65%" }}>{p.nickname || p.address}</span>
                              <span style={{ fontSize: 12.5, fontWeight: 700, color: NAVY }}>${earn}</span>
                            </div>
                            <div style={{ height: 6, background: "rgba(14,31,64,0.06)", borderRadius: 100, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: GREEN, borderRadius: 100 }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
                    Your pads
                  </div>
                </>
              );
            })()}

            {sortedPads.map(pad => (
              <div key={pad.id} onClick={() => setOpenPadId(pad.id)} style={{
                background: "#fff", borderRadius: 18, border: "1px solid rgba(14,31,64,0.09)",
                overflow: "hidden", marginBottom: 14,
                boxShadow: "0 2px 12px rgba(14,31,64,0.06)", cursor: "pointer",
                opacity: pad.status === "paused" ? 0.78 : 1,
              }}>
                <div style={{
                  height: 130,
                  background: `url(${pad.photoUrl}) center/cover, linear-gradient(135deg,rgba(141,214,63,0.15),rgba(14,31,64,0.08))`,
                  position: "relative",
                  filter: pad.status === "paused" ? "grayscale(0.4)" : "none",
                }}>
                  <div style={{ position: "absolute", top: 10, right: 10 }}>
                    <StatusPill pad={pad} />
                  </div>
                  <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.92)", borderRadius: 100, padding: "5px 8px 5px 10px", boxShadow: "0 2px 6px rgba(14,31,64,0.18)" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: NAVY, letterSpacing: 0.3 }}>
                      {pad.status === "paused" ? "Closed" : "Open"}
                    </span>
                    <PauseSwitch
                      paused={pad.status === "paused"}
                      onPress={() => requestPauseToggle(pad.id)}
                    />
                  </div>
                </div>
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, letterSpacing: -0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pad.nickname || pad.address}
                      </div>
                      <div style={{ fontSize: 12, color: "rgba(14,31,64,0.45)", marginTop: 2 }}>
                        {pad.address} · {pad.type}{pad.spotCount > 1 ? ` · ${pad.spotCount} spots` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: GREEN }}>${pad.price}<span style={{ fontSize: 10, color: "rgba(141,214,63,0.6)", fontWeight: 500 }}>/hr</span></div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {[
                      { l: "Listed", r: pad.since },
                      { l: "Bookings", r: String(pad.bookings) },
                      { l: "Earnings", r: `$${(pad.bookings * pad.price * 2).toFixed(0)}` },
                    ].map(s => (
                      <div key={s.l} style={{ flex: 1, background: "rgba(14,31,64,0.04)", borderRadius: 10, padding: "8px 10px", border: "1px solid rgba(14,31,64,0.07)" }}>
                        <div style={{ fontSize: 9, color: "rgba(14,31,64,0.30)", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>{s.l}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{s.r}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {/* Add new pad */}
            <button onClick={startAddPad} style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              padding: "15px 0", borderRadius: 16,
              background: "transparent", border: `2px dashed rgba(141,214,63,0.40)`,
              cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
              fontSize: 15, fontWeight: 700, color: "#5a9e1a", letterSpacing: -0.2,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Add another pad
            </button>
          </>
        ) : (
          /* ── DETAIL / EDIT VIEW ── */
          <>
            {/* Photo with replace */}
            <input ref={photoInputRef} type="file" accept="image/*" onChange={onPhotoPick} style={{ display: "none" }} />
            <div style={{ position: "relative", borderRadius: 18, overflow: "hidden", marginBottom: 14, boxShadow: "0 2px 12px rgba(14,31,64,0.06)" }}>
              <div style={{ height: 180, background: `url(${openPad.photoUrl}) center/cover, #ddd` }} />
              <button onClick={() => photoInputRef.current?.click()} style={{
                position: "absolute", bottom: 12, right: 12,
                background: "rgba(255,255,255,0.95)", border: "none", borderRadius: 100,
                padding: "8px 14px", fontSize: 12, fontWeight: 700, color: NAVY,
                cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                Change photo
              </button>
              <div style={{ position: "absolute", top: 12, left: 12 }}>
                <StatusPill pad={openPad} />
              </div>
            </div>

            {/* Quick stats */}
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {[
                { l: "Listed", r: openPad.since },
                { l: "Bookings", r: String(openPad.bookings) },
                { l: "Earnings", r: `$${(openPad.bookings * openPad.price * 2).toFixed(0)}` },
              ].map(s => (
                <div key={s.l} style={{ flex: 1, background: "#fff", borderRadius: 12, padding: "10px 12px", border: "1px solid rgba(14,31,64,0.07)" }}>
                  <div style={{ fontSize: 9, color: "rgba(14,31,64,0.32)", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>{s.l}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: s.l === "Earnings" ? GREEN : NAVY, letterSpacing: -0.2 }}>{s.r}</div>
                </div>
              ))}
            </div>

            {/* Locked vital info */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
              Listing details · locked
            </div>
            <div style={{ background: "#fff", borderRadius: 14, padding: "4px 14px", marginBottom: 22, border: "1px solid rgba(14,31,64,0.07)" }}>
              <LockedRow label="Address" value={`${openPad.address}, ${openPad.city}`} />
              <LockedRow label="Pad type" value={openPad.type} />
              <LockedRow label="Number of spots" value={String(openPad.spotCount)} />
            </div>

            {/* Editable */}
            <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
              You can edit
            </div>
            <div style={{ background: "#fff", borderRadius: 14, padding: "12px 14px", marginBottom: 14, border: "1px solid rgba(14,31,64,0.07)" }}>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Nickname</div>
                <input
                  value={openPad.nickname}
                  onChange={e => updatePad(openPad.id, { nickname: e.target.value })}
                  placeholder="e.g. Front driveway"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid rgba(14,31,64,0.12)", background: "#fff", fontSize: 14, color: NAVY, fontFamily: "'DM Sans',sans-serif", fontWeight: 500, outline: "none", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Price per hour</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, border: "1.5px solid rgba(14,31,64,0.12)", background: "#fff" }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: GREEN }}>$</span>
                  <input
                    type="number" min="0" step="0.5"
                    value={openPad.price}
                    onChange={e => updatePad(openPad.id, { price: Number(e.target.value) || 0 })}
                    style={{ flex: 1, padding: 0, border: "none", background: "transparent", fontSize: 16, fontWeight: 700, color: NAVY, fontFamily: "'DM Sans',sans-serif", outline: "none" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(14,31,64,0.40)", fontWeight: 600 }}>/ hr</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Description</div>
                <textarea
                  value={openPad.description}
                  onChange={e => updatePad(openPad.id, { description: e.target.value })}
                  rows={3}
                  placeholder="Tell renters what makes this spot great…"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid rgba(14,31,64,0.12)", background: "#fff", fontSize: 14, color: NAVY, fontFamily: "'DM Sans',sans-serif", fontWeight: 500, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.45 }}
                />
              </div>
            </div>

            {/* Services */}
            <div style={{ background: "#fff", borderRadius: 14, padding: "14px 14px", marginBottom: 16, border: "1px solid rgba(14,31,64,0.07)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>Services & amenities</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ALL_SERVICES.map(svc => {
                  const on = openPad.services.includes(svc);
                  return (
                    <button key={svc} onClick={() => toggleService(openPad.id, svc)} style={{
                      padding: "7px 12px", borderRadius: 100,
                      background: on ? "rgba(141,214,63,0.16)" : "rgba(14,31,64,0.04)",
                      border: `1px solid ${on ? "rgba(141,214,63,0.40)" : "rgba(14,31,64,0.10)"}`,
                      color: on ? "#5a9e1a" : "rgba(14,31,64,0.55)",
                      fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                      display: "flex", alignItems: "center", gap: 5,
                    }}>
                      {on && <span style={{ fontSize: 11 }}>✓</span>}
                      {svc}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Open / closed toggle */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, padding: "14px 16px", borderRadius: 16,
              background: openPad.status === "active" ? "rgba(141,214,63,0.10)" : "rgba(255,200,0,0.10)",
              border: `1px solid ${openPad.status === "active" ? "rgba(141,214,63,0.30)" : "rgba(255,200,0,0.30)"}`,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, letterSpacing: -0.2 }}>
                  {openPad.status === "active" ? "Open for new bookings" : (openPad.pausedUntil ? "Closed for tonight" : "Closed indefinitely")}
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(14,31,64,0.55)", marginTop: 3 }}>
                  {openPad.status === "active"
                    ? "Drivers can book this pad from the map."
                    : "New bookings are paused. Existing bookings will still complete."}
                </div>
              </div>
              <PauseSwitch
                paused={openPad.status === "paused"}
                onPress={() => requestPauseToggle(openPad.id)}
              />
            </div>

            <p style={{ textAlign: "center", fontSize: 10.5, color: "rgba(14,31,64,0.32)", margin: "16px 0 4px" }}>
              Need to change address, pad type, or spot count? Contact support.
            </p>
          </>
        )}
      </div>

      {/* Pause confirmation modal */}
      {pendingPad && (
        <div
          onClick={() => setPendingPauseId(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(14,31,64,0.55)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            zIndex: 200, padding: 16,
            animation: "fadeIn 0.18s ease",
          }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 460, background: "#fff",
              borderRadius: 22, padding: "20px 20px 18px",
              boxShadow: "0 -8px 30px rgba(14,31,64,0.25)",
              fontFamily: "'DM Sans',sans-serif",
            }}>
            <div style={{
              width: 36, height: 4, background: "rgba(14,31,64,0.18)",
              borderRadius: 100, margin: "0 auto 14px",
            }} />
            <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: -0.3, marginBottom: 6 }}>
              Stop new bookings?
            </div>
            <div style={{ fontSize: 13, color: "rgba(14,31,64,0.60)", lineHeight: 1.45, marginBottom: 16 }}>
              <strong style={{ color: NAVY }}>{pendingPad.nickname || pendingPad.address}</strong> won't appear to new drivers. Any bookings already on the calendar will still go through.
            </div>

            <button
              onClick={() => confirmPauseFor("tonight")}
              style={{
                width: "100%", padding: "14px 16px", borderRadius: 14,
                background: "rgba(141,214,63,0.12)", border: `1px solid ${GREEN}`,
                color: NAVY, fontSize: 14, fontWeight: 700, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif", marginBottom: 8,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              }}>
              <span style={{ textAlign: "left" }}>
                <span style={{ display: "block" }}>Just for tonight</span>
                <span style={{ display: "block", fontSize: 11, color: "rgba(14,31,64,0.55)", fontWeight: 500, marginTop: 2 }}>
                  Re-opens automatically tomorrow at 6 AM
                </span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>

            <button
              onClick={() => confirmPauseFor("indefinite")}
              style={{
                width: "100%", padding: "14px 16px", borderRadius: 14,
                background: "rgba(14,31,64,0.04)", border: "1px solid rgba(14,31,64,0.15)",
                color: NAVY, fontSize: 14, fontWeight: 700, cursor: "pointer",
                fontFamily: "'DM Sans',sans-serif", marginBottom: 12,
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
              }}>
              <span style={{ textAlign: "left" }}>
                <span style={{ display: "block" }}>Indefinitely</span>
                <span style={{ display: "block", fontSize: 11, color: "rgba(14,31,64,0.55)", fontWeight: 500, marginTop: 2 }}>
                  Stays closed until you turn it back on
                </span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>

            <button
              onClick={() => setPendingPauseId(null)}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 100,
                background: "transparent", border: "none",
                color: "rgba(14,31,64,0.55)", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
              }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
