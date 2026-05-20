import { useState, useRef, useEffect, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icons broken by Vite's asset pipeline
const leafletIcon = L.icon({
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize:    [25, 41],
  iconAnchor:  [12, 41],
  popupAnchor: [1, -34],
  shadowSize:  [41, 41],
});

type InputType = "text" | "choice" | "number" | "price" | "textarea";
interface Question {
  label: string; text: string; type: InputType;
  placeholder?: string; hint?: string; choices?: string[]; optional?: boolean;
}

const AP_QUESTIONS: Question[] = [
  { label: "Address", text: "What's the address?", type: "text", placeholder: "123 Main St, City, State", hint: "Include city and state" },
  { label: "Spot type", text: "What kind of spot is it?", type: "choice", choices: ["Driveway", "Garage", "Street (permitted)", "Alley"] },
  { label: "Surface", text: "What's the surface?", type: "choice", choices: ["Concrete", "Asphalt", "Gravel", "Grass"] },
  { label: "Number of pads", text: "How many pads?", type: "number" },
  { label: "Price per hour", text: "What's your price per hour?", type: "price", hint: "You can change this anytime." },
  { label: "Description", text: "Add a short description.", type: "textarea", placeholder: "Easy access driveway right off the main street, great for downtown commuters.", hint: "Tell renters what makes your spot great. (optional)", optional: true },
];

export default function AddPadPage() {
  const { goTo, state, setState: setAppState } = useApp();
  const { user } = useAuth();
  const [cur, setCur] = useState(0);
  const [ans, setAns] = useState<Record<number, string>>({});
  const [inputVal, setInputVal]   = useState("");
  const [addrCity, setAddrCity]   = useState("");
  const [addrState, setAddrState] = useState("");
  const [addrZip, setAddrZip]     = useState("");
  const [numVal, setNumVal]       = useState(1);
  const [locked, setLocked]       = useState(false);
  const [done, setDone]           = useState(false);
  const [foundMsg, setFoundMsg]   = useState("");
  const [addrError, setAddrError]         = useState("");
  const [addrValidating, setAddrValidating] = useState(false);

  // Map-pin picker state
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [pinAddr, setPinAddr]   = useState("");
  const [pinParsed, setPinParsed] = useState<{ street: string; city: string; state: string; zip: string } | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinLat, setPinLat] = useState(0);
  const [pinLng, setPinLng] = useState(0);
  const mapDivRef        = useRef<HTMLDivElement>(null);
  const leafletMapRef    = useRef<L.Map | null>(null);
  const leafletMarkerRef = useRef<L.Marker | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const cityRef  = useRef<HTMLInputElement>(null);

  const q        = AP_QUESTIONS[cur];
  const progress = Math.round((Math.min(cur, AP_QUESTIONS.length) / AP_QUESTIONS.length) * 100) + 16;

  useEffect(() => {
    setInputVal(ans[cur] || "");
    setNumVal(ans[cur] ? parseInt(ans[cur]) || 1 : 1);
    if (q?.type === "text" || q?.type === "price") setTimeout(() => inputRef.current?.focus(), 100);
  }, [cur]);

  function buildFullAddress() {
    const parts = [inputVal.trim(), addrCity.trim(), [addrState.trim(), addrZip.trim()].filter(Boolean).join(" ")].filter(Boolean);
    return parts.join(", ");
  }

  function clearPinCoords() {
    setPinLat(0); setPinLng(0);
    setAppState(prev => ({ ...prev, apLat: 0, apLng: 0 }));
  }

  // ── Geocoding validation ────────────────────────────────────────────────────
  async function validateAndAdvanceAddress() {
    const fullAddr = buildFullAddress();
    if (!fullAddr) return;
    setAddrError("");

    // If we already have pin-validated coords, skip re-geocoding
    if (state.apLat && state.apLng) {
      advance(fullAddr);
      return;
    }

    setAddrValidating(true);
    try {
      const r    = await fetch(`/api/geocode?address=${encodeURIComponent(fullAddr)}`);
      const data = await r.json();

      if (!r.ok) {
        setAddrError(data.error || "Address not found — please enter a valid street address.");
        return;
      }

      // Cross-check: returned city/state must match what the user typed
      const enteredCity    = addrCity.trim().toLowerCase();
      const returnedCity   = (data.city  || "").toLowerCase();
      const enteredState   = addrState.trim().toUpperCase();
      const returnedState  = (data.state || "").toUpperCase();

      const cityOk  = returnedCity.includes(enteredCity) || enteredCity.includes(returnedCity);
      const stateOk = !enteredState || enteredState === returnedState;

      if (!cityOk || !stateOk) {
        setAddrError("Address not found — please enter a valid street address.");
        return;
      }

      setAppState(prev => ({ ...prev, apLat: data.lat, apLng: data.lng }));
      setFoundMsg("Address verified!");
      setTimeout(() => setFoundMsg(""), 3000);
      advance(data.formatted_address || fullAddr);
    } catch {
      setAddrError("Address not found — please enter a valid street address.");
    } finally {
      setAddrValidating(false);
    }
  }

  // ── Map-pin picker ──────────────────────────────────────────────────────────
  const doReverseGeocode = useCallback(async (lat: number, lng: number) => {
    setPinLoading(true);
    setPinAddr("");
    setPinParsed(null);
    try {
      const r    = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
      const data = await r.json();
      if (r.ok) {
        setPinAddr(data.formatted_address || "");
        setPinParsed({ street: data.street || "", city: data.city || "", state: data.state || "", zip: data.zip || "" });
        setPinLat(lat); setPinLng(lng);
      }
    } catch {}
    finally { setPinLoading(false); }
  }, []);

  const initLeafletMap = useCallback(() => {
    if (!mapDivRef.current) return;
    // Tear down any existing Leaflet instance first (avoid "Map container is already initialized")
    if (leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current    = null;
      leafletMarkerRef.current = null;
    }

    const houston: [number, number] = [29.7604, -95.3698];
    const map = L.map(mapDivRef.current, { zoomControl: true }).setView(houston, 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker(houston, { draggable: true, icon: leafletIcon }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      doReverseGeocode(pos.lat, pos.lng);
    });

    // Try to centre on user's location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        map.setView(loc, 16);
        marker.setLatLng(loc);
        doReverseGeocode(loc[0], loc[1]);
      }, () => {});
    }

    leafletMapRef.current    = map;
    leafletMarkerRef.current = marker;
  }, [doReverseGeocode]);

  function openMapPicker() {
    setShowMapPicker(true);
    setPinAddr(""); setPinParsed(null); setPinLoading(false);
    // Small delay to ensure the modal div is in the DOM before Leaflet mounts
    setTimeout(initLeafletMap, 120);
  }

  function handleUseThisLocation() {
    if (!pinParsed || !pinLat || !pinLng) return;
    setInputVal(pinParsed.street);
    setAddrCity(pinParsed.city);
    setAddrState(pinParsed.state);
    setAddrZip(pinParsed.zip);
    setAddrError("");
    setAppState(prev => ({ ...prev, apLat: pinLat, apLng: pinLng }));
    setShowMapPicker(false);
    setFoundMsg("Location pinned!");
    setTimeout(() => setFoundMsg(""), 3000);
  }

  // ── Step advance ────────────────────────────────────────────────────────────
  function advance(val?: string) {
    const v      = val !== undefined ? val : inputVal.trim();
    if (!v && q?.type !== "number" && !q?.optional) return;
    const finalV = q?.type === "number" ? String(numVal) : v;
    const newAns = { ...ans, [cur]: finalV };
    setAns(newAns);
    const next = cur + 1;
    if (next >= AP_QUESTIONS.length) {
      setDone(true);
      setAppState(prev => ({ ...prev, apAns: newAns, apNumPads: numVal, apLogoUrl: "" }));
    } else {
      setCur(next);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === "Enter") advance(); }

  const addrFilled = inputVal.trim() && addrCity.trim() && addrState.trim();
  const hasPinCoords = !!(state.apLat && state.apLng);

  return (
    <div className="page active">
      <SharedHeader
        step="Step 2 of 6"
        title="Add your lily pad."
        progress={progress}
        label={`Profile ${progress}% complete`}
        foundMsg={foundMsg}
      />
      <div className="s-divider" />
      <div className="s-body">
        <NavBar
          onBack={() => cur > 0 ? setCur(cur - 1) : goTo(state.addingExtraPad ? "paddashboard" : (user ? "padtype" : "signup"))}
          onHome={() => goTo("home")}
          dots={AP_QUESTIONS.map((_, i) => i)}
          currentDot={cur}
          onDotClick={(i) => { if (ans[i] !== undefined) setCur(i); }}
        />

        <div className="form-center-wrap">
          {!done ? (
            <div className="q-center">
              <p className="q-step-lbl">{`${cur + 1} of ${AP_QUESTIONS.length}`}</p>
              <p className="q-text">{q.text}</p>

              {/* ── Address step ── */}
              {q.type === "text" && cur === 0 && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap">
                    <input
                      ref={inputRef}
                      className="pill-input"
                      placeholder="Street address"
                      value={inputVal}
                      onChange={e => { setInputVal(e.target.value); setAddrError(""); clearPinCoords(); }}
                      onKeyDown={e => { if (e.key === "Enter") cityRef.current?.focus(); }}
                    />
                  </div>
                  <div className="pill-wrap" style={{ marginTop: 10 }}>
                    <input
                      ref={cityRef}
                      className="pill-input"
                      placeholder="City"
                      value={addrCity}
                      onChange={e => { setAddrCity(e.target.value); setAddrError(""); clearPinCoords(); }}
                      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                    <div className="pill-wrap" style={{ flex: 1 }}>
                      <input
                        className="pill-input"
                        placeholder="State"
                        value={addrState}
                        onChange={e => { setAddrState(e.target.value); setAddrError(""); clearPinCoords(); }}
                        style={{ textTransform: "uppercase" }}
                        maxLength={2}
                      />
                    </div>
                    <div className="pill-wrap" style={{ flex: 1 }}>
                      <input
                        className="pill-input"
                        placeholder="ZIP"
                        value={addrZip}
                        onChange={e => { setAddrZip(e.target.value.replace(/\D/g, "")); setAddrError(""); }}
                        inputMode="numeric"
                        maxLength={5}
                      />
                    </div>
                  </div>


                  {/* Error */}
                  {addrError && (
                    <p style={{
                      marginTop: 10, color: "#E53E3E", fontSize: 13, fontWeight: 600,
                      textAlign: "center", lineHeight: 1.4,
                    }}>{addrError}</p>
                  )}

                  {addrFilled && (
                    <div className="cta-area" style={{ marginTop: 16 }}>
                      <button
                        className="cta-btn"
                        onClick={validateAndAdvanceAddress}
                        disabled={addrValidating}
                        style={{ opacity: addrValidating ? 0.7 : 1 }}
                      >
                        {addrValidating ? "Checking address…" : hasPinCoords ? "Continue →" : "Continue"}
                      </button>
                    </div>
                  )}

                  {/* Map pin fallback */}
                  <div style={{ marginTop: 14, textAlign: "center" }}>
                    <button
                      onClick={openMapPicker}
                      style={{
                        background: "none", border: "none",
                        color: "rgba(14,31,64,0.5)", fontSize: 13, fontWeight: 600,
                        cursor: "pointer", textDecoration: "underline", padding: "4px 0",
                      }}
                    >
                      📍 Pin your location instead
                    </button>
                  </div>
                </div>
              )}

              {/* ── Other text questions ── */}
              {q.type === "text" && cur !== 0 && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap">
                    <input
                      ref={inputRef}
                      className="pill-input"
                      placeholder={q.placeholder}
                      value={inputVal}
                      onChange={e => setInputVal(e.target.value)}
                      onKeyDown={handleKeyDown}
                    />
                  </div>
                  {q.hint && <p className="hint">{q.hint}</p>}
                  {inputVal.trim() && (
                    <div className="cta-area" style={{ marginTop: 16 }}>
                      <button className="cta-btn" onClick={() => advance()}>Continue</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Price ── */}
              {q.type === "price" && (
                <div style={{ width: "100%" }}>
                  <div className="pill-wrap" style={{ display: "flex", alignItems: "center", padding: "0 18px", gap: 8 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, color: "#8DD63F", lineHeight: 1 }}>$</span>
                    <input
                      ref={inputRef}
                      className="pill-input"
                      style={{ padding: "16px 0", fontSize: 18, fontWeight: 700 }}
                      type="text" inputMode="decimal" placeholder=""
                      value={inputVal}
                      onChange={e => {
                        const c = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                        setInputVal(c);
                      }}
                      onKeyDown={handleKeyDown}
                    />
                    <span style={{ fontSize: 13, color: "rgba(14,31,64,0.45)", fontWeight: 600, whiteSpace: "nowrap" }}>/ hr</span>
                  </div>
                  {q.hint && <p className="hint">{q.hint}</p>}
                  {inputVal.trim() && Number(inputVal) > 0 && (
                    <div className="cta-area" style={{ marginTop: 16 }}>
                      <button className="cta-btn" onClick={() => advance()}>Continue</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Textarea ── */}
              {q.type === "textarea" && (
                <div style={{ width: "100%" }}>
                  <textarea
                    className="pill-input"
                    style={{
                      width: "100%", minHeight: 110, padding: "14px 18px",
                      borderRadius: 18, border: "1.5px solid rgba(14,31,64,0.12)",
                      background: "#fff", fontSize: 15, color: "#0E1F40",
                      fontFamily: "'DM Sans',sans-serif", fontWeight: 500,
                      outline: "none", resize: "vertical", lineHeight: 1.5, boxSizing: "border-box",
                    }}
                    placeholder={q.placeholder}
                    value={inputVal}
                    onChange={e => setInputVal(e.target.value)}
                  />
                  {q.hint && <p className="hint">{q.hint}</p>}
                  <div className="cta-area" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                    {inputVal.trim() && <button className="cta-btn" onClick={() => advance()}>Continue</button>}
                    {q.optional && (
                      <button
                        style={{ background: "none", border: "none", color: "rgba(14,31,64,0.45)", fontSize: 14, fontWeight: 500, cursor: "pointer", padding: "8px 0" }}
                        onClick={() => advance("")}
                      >Skip</button>
                    )}
                  </div>
                </div>
              )}

              {/* ── Choice ── */}
              {q.type === "choice" && (
                <div className="choice-list">
                  {q.choices?.map(ch => (
                    <button key={ch} className={`choice-btn${ans[cur] === ch ? " selected" : ""}`} onClick={() => advance(ch)}>{ch}</button>
                  ))}
                </div>
              )}

              {/* ── Number ── */}
              {q.type === "number" && (
                <div className="num-wrap">
                  <p className="num-note">One pad = one parking spot. Multiple pads can share the same driveway.</p>
                  <div className="num-row">
                    <button className="num-btn" onClick={() => setNumVal(Math.max(1, numVal - 1))}>−</button>
                    <span className="num-val">{numVal}</span>
                    <button className="num-btn" onClick={() => setNumVal(Math.min(10, numVal + 1))}>+</button>
                  </div>
                  <button className="num-confirm" onClick={() => advance(String(numVal))}>Confirm</button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="answer-stack" style={{ marginTop: 4 }}>
                {AP_QUESTIONS.map((qq, i) => (
                  <div key={i} className="answer-card" onClick={() => !locked && setCur(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">{ans[i] || "—"}</span>
                    </div>
                    {!locked && <span className="answer-card-edit">Edit</span>}
                  </div>
                ))}
              </div>
              <div className="cta-area">
                <p className="cta-nudge">Next — photos and highlights.</p>
                <button className="cta-btn" onClick={() => {
                  setLocked(true);
                  setAppState(s => ({ ...s, apSpotId: "" }));
                  goTo("photointro");
                }}>Continue</button>
              </div>
            </>
          )}

          {!done && Object.keys(ans).length > 0 && (
            <div className="answer-stack" style={{ marginTop: 10 }}>
              {Object.entries(ans).map(([idx, val]) => {
                const i = parseInt(idx);
                if (i >= cur) return null;
                const qq = AP_QUESTIONS[i];
                return (
                  <div key={i} className="answer-card" onClick={() => !locked && setCur(i)}>
                    <div className="answer-card-left">
                      <span className="answer-card-lbl">{qq.label}</span>
                      <span className="answer-card-val">{val}</span>
                    </div>
                    {!locked && <span className="answer-card-edit">Edit</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Map pin picker modal ─────────────────────────────────────────────── */}
      {showMapPicker && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", flexDirection: "column",
          background: "#fff",
        }}>
          {/* Header */}
          <div style={{
            padding: "16px 20px", borderBottom: "1px solid rgba(14,31,64,0.1)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0E1F40" }}>Pin your location</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(14,31,64,0.5)", fontWeight: 500 }}>Drag the pin to your exact parking spot</p>
            </div>
            <button
              onClick={() => setShowMapPicker(false)}
              style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "rgba(14,31,64,0.08)", border: "none",
                fontSize: 18, cursor: "pointer", color: "#0E1F40",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >✕</button>
          </div>

          {/* Map */}
          <div ref={mapDivRef} style={{ flex: 1, minHeight: 0 }} />

          {/* Bottom panel */}
          <div style={{
            padding: "16px 20px 24px",
            borderTop: "1px solid rgba(14,31,64,0.1)",
            background: "#fff", flexShrink: 0,
          }}>
            {pinLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  border: "2px solid #8DD63F", borderTopColor: "transparent",
                  animation: "spin 0.7s linear infinite",
                }} />
                <span style={{ fontSize: 13, color: "rgba(14,31,64,0.5)", fontWeight: 500 }}>Finding address…</span>
              </div>
            ) : pinAddr ? (
              <div style={{ marginBottom: 14 }}>
                <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Selected location</p>
                <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 600, color: "#0E1F40", lineHeight: 1.4 }}>{pinAddr}</p>
              </div>
            ) : (
              <p style={{ marginBottom: 14, color: "rgba(14,31,64,0.4)", fontSize: 13, fontWeight: 500 }}>Drag the pin to your parking spot</p>
            )}

            <button
              className="cta-btn"
              onClick={handleUseThisLocation}
              disabled={!pinParsed || pinLoading}
              style={{ width: "100%", opacity: pinParsed && !pinLoading ? 1 : 0.4 }}
            >
              Use this location
            </button>
          </div>
        </div>
      )}

      {/* Spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
