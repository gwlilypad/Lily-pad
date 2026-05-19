import { useState, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";

type Spot = {
  id: number;
  addr: string;
  price: string;
  meta: string;
  lat: number;
  lng: number;
};

const SAVED_KEY = "lilypad_saved";

function loadSavedIds(): number[] {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as number[]; } catch { return []; }
}
function saveSavedIds(ids: number[]) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(ids)); } catch {}
}

export default function SavedSpotsPage() {
  const { goTo } = useApp();
  const [savedIds, setSavedIds] = useState<number[]>(() => loadSavedIds());
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (savedIds.length === 0) { setLoading(false); return; }
    supabase.from("spots").select("id,addr,price,meta,lat,lng").in("id", savedIds)
      .then(({ data }) => {
        setSpots((data as Spot[]) ?? []);
        setLoading(false);
      });
  }, []);

  function unsave(id: number) {
    const next = savedIds.filter(x => x !== id);
    setSavedIds(next);
    saveSavedIds(next);
    setSpots(prev => prev.filter(s => s.id !== id));
  }

  const savedSpots = savedIds.map(id => spots.find(s => s.id === id)).filter(Boolean) as Spot[];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0E1F40", fontFamily: '"DM Sans", sans-serif', overflow: "hidden" }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "52px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => goTo("find")} style={{
            background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Saved Pads</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>
              {savedIds.length} {savedIds.length === 1 ? "spot" : "spots"} saved
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 32px", display: "flex", flexDirection: "column", gap: 10 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ width: 28, height: 28, border: "3px solid rgba(141,214,63,0.3)", borderTopColor: "#8DD63F", borderRadius: "50%", animation: "lp-spin 0.8s linear infinite", margin: "0 auto" }} />
            <style>{`@keyframes lp-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : savedIds.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 16px", color: "rgba(255,255,255,0.30)", fontSize: 14 }}>
            No saved pads yet.<br />
            <span style={{ fontSize: 12 }}>Tap ☆ Save on any spot in the map.</span>
          </div>
        ) : savedSpots.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 16px", color: "rgba(255,255,255,0.30)", fontSize: 14 }}>
            Loading your saved spots…
          </div>
        ) : (
          savedSpots.map(spot => {
            const priceNum = spot.price.replace(/[^0-9]/g, "");
            const parts = spot.meta.split("·").map(s => s.trim());
            return (
              <div key={spot.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 14, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{spot.addr}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", marginTop: 3 }}>{parts[0]}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#8DD63F" }}>${priceNum}<span style={{ fontSize: 10, fontWeight: 500, color: "rgba(141,214,63,0.55)" }}>/hr</span></div>
                </div>
                <button
                  onClick={() => unsave(spot.id)}
                  title="Remove from saved"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#8DD63F", padding: 4, flexShrink: 0, display: "flex", alignItems: "center" }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="#8DD63F" stroke="#8DD63F" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
