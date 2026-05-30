import { useState, useRef, useEffect, useCallback } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";
declare global { interface Window { google: any; } }

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
  const [pinAddrEditable, setPinAddrEditable] = useState("");
  const [mapType, setMapType] = useState<"roadmap" | "satellite">("roadmap");
  const mapDivRef   = useRef<HTMLDivElement>(null);
  const gmapRef     = useRef<any>(null);
  const markerRef   = useRef<any>(null);
  const mapsLoading = useRef(false);

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
      // Always commit exactly what the user typed — never let Google's normalized
      // version silently rename streets (e.g. "Frst" → "First", "Frst Ln" → "Forest Ln")
      advance(fullAddr);
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
        const fmt = data.formatted_address || "";
        setPinAddr(fmt);
        setPinAddrEditable(fmt);
        setPinParsed({ street: data.street || "", city: data.city || "", state: data.state || "", zip: data.zip || "" });
        setPinLat(lat); setPinLng(lng);
      }
    } catch {}
    finally { setPinLoading(false); }
  }, []);

  const [mapError, setMapError] = useState("");

  const initGoogleMap = useCallback(() => {
    if (!mapDivRef.current) {
      setMapError("Map container not ready — please close and try again.");
      return;
    }
    if (!window.google?.maps) {
      setMapError("Google Maps failed to load — check your internet connection.");
      return;
    }
    try {
      const G       = window.google.maps;
      const houston = { lat: 29.7604, lng: -95.3698 };
      const map = new G.Map(mapDivRef.current, {
        center: houston, zoom: 19,
        mapTypeId: "roadmap",
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
      });
      const marker = new G.Marker({
        position: houston, map, draggable: true,
        animation: G.Animation.DROP,
        title: "Drag to your exact spot",
      });
      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (pos) doReverseGeocode(pos.lat(), pos.lng());
      });
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          map.setCenter(loc);
          map.setZoom(19);
          marker.setPosition(loc);
          doReverseGeocode(loc.lat, loc.lng);
        }, () => {});
      }
      gmapRef.current   = map;
      markerRef.current = marker;
    } catch (e: any) {
      setMapError(`Maps init error: ${e?.message || e}`);
    }
  }, [doReverseGeocode]);

  async function openMapPicker() {
    setShowMapPicker(true);
    setMapType("roadmap");
    setMapError("");
    setPinAddr(""); setPinAddrEditable(""); setPinParsed(null); setPinLoading(false);
    if (gmapRef.current) { gmapRef.current = null; }
    // If already loaded, init after next paint so DOM is committed
    if (window.google?.maps) {
      requestAnimationFrame(() => requestAnimationFrame(initGoogleMap));
      return;
    }
    if (mapsLoading.current) return;
    mapsLoading.current = true;
    try {
      const keyRes = await fetch("/api/maps-key");
      const { key } = await keyRes.json();
      // Use the canonical callback pattern — Maps JS calls __lilyMapsReady when fully ready
      await new Promise<void>((resolve, reject) => {
        (window as any).__lilyMapsReady = () => {
          delete (window as any).__lilyMapsReady;
          resolve();
        };
        const s = document.createElement("script");
        s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=__lilyMapsReady`;
        s.async = true;
        s.onerror = () => reject(new Error("Script load failed — check API key or network"));
        document.head.appendChild(s);
      });
      initGoogleMap();
    } catch (e: any) {
      mapsLoading.current = false;
      setMapError(`Maps load error: ${e?.message || e}`);
    }
  }

  function handleUseThisLocation() {
    if (!pinLat || !pinLng) return;
    // Use the edited address text — split on first comma to get street portion
    const edited  = pinAddrEditable.trim();
    const street  = edited.includes(",") ? edited.split(",")[0].trim() : edited;
    setInputVal(street || pinParsed?.street || "");
    setAddrCity(pinParsed?.city   || "");
    setAddrState(pinParsed?.state || "");
    setAddrZip(pinParsed?.zip     || "");
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

          {/* Map + overlay toggle */}
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
            {mapError ? (
              <div style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", padding: 24, background: "#f6f8fc",
              }}>
                <p style={{ color: "#c0392b", fontWeight: 700, fontSize: 14, textAlign: "center", margin: 0 }}>⚠️ {mapError}</p>
                <p style={{ color: "rgba(14,31,64,0.5)", fontSize: 12, marginTop: 8, textAlign: "center" }}>
                  Check that the Maps JavaScript API is enabled in Google Cloud Console and billing is active.
                </p>
              </div>
            ) : (
              <div ref={mapDivRef} style={{ position: "absolute", inset: 0 }} />
            )}
            {/* Map type toggle */}
            <div style={{
              position: "absolute", top: 12, right: 12, zIndex: 10,
              display: "flex", borderRadius: 8, overflow: "hidden",
              boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
            }}>
              {(["roadmap", "satellite"] as const).map(type => (
                <button
                  key={type}
                  onClick={() => {
                    setMapType(type);
                    if (gmapRef.current) gmapRef.current.setMapTypeId(type);
                  }}
                  style={{
                    padding: "7px 13px",
                    fontSize: 12, fontWeight: 700,
                    fontFamily: "'DM Sans',sans-serif",
                    border: "none", cursor: "pointer",
                    background: mapType === type ? "#0E1F40" : "rgba(255,255,255,0.92)",
                    color: mapType === type ? "#fff" : "#0E1F40",
                    transition: "background 0.15s, color 0.15s",
                  }}
                >
                  {type === "roadmap" ? "Map" : "Satellite"}
                </button>
              ))}
            </div>
          </div>

          {/* Bottom panel */}
          <div style={{
            padding: "14px 20px 24px",
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
            ) : pinAddrEditable !== "" ? (
              <div style={{ marginBottom: 12 }}>
                <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Confirm or correct address
                </p>
                <input
                  value={pinAddrEditable}
                  onChange={e => setPinAddrEditable(e.target.value)}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "12px 14px", borderRadius: 12,
                    border: "1.5px solid rgba(14,31,64,0.18)",
                    background: "#F6F8FC", fontSize: 14, fontWeight: 500,
                    color: "#0E1F40", fontFamily: "'DM Sans',sans-serif",
                    outline: "none",
                  }}
                  placeholder="Street address"
                />
                <p style={{ margin: "5px 0 0", fontSize: 11, color: "rgba(14,31,64,0.38)", fontWeight: 500 }}>
                  Edit if the address is slightly off — the pin coordinates are always saved exactly.
                </p>
              </div>
            ) : (
              <p style={{ marginBottom: 14, color: "rgba(14,31,64,0.4)", fontSize: 13, fontWeight: 500 }}>Drag the pin to your parking spot</p>
            )}

            <button
              className="cta-btn"
              onClick={handleUseThisLocation}
              disabled={!pinLat || pinLoading}
              style={{ width: "100%", opacity: pinLat && !pinLoading ? 1 : 0.4 }}
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
