import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";

const PAD_COLORS = ["#8DD63F", "#F59E0B", "#4A6FA5"];
const PAD_NAMES = ["Pad 1", "Pad 2", "Pad 3"];

const HANDLE_R = 22;
const HANDLE_ARM = 52;
const CORNER_R = 9;

interface Box {
  cx: number; cy: number;
  w: number; h: number;
  angle: number;
  pad: number;
}

function getCorners(b: Box): { x: number; y: number }[] {
  const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
  return (
    [[-b.w / 2, -b.h / 2], [b.w / 2, -b.h / 2], [-b.w / 2, b.h / 2], [b.w / 2, b.h / 2]] as [number, number][]
  ).map(([lx, ly]) => ({
    x: b.cx + lx * cos - ly * sin,
    y: b.cy + lx * sin + ly * cos,
  }));
}

async function compressAndUpload(dataUrl: string, userId: string): Promise<string> {
  // Load from data URL (already decoded — works with all formats including HEIC-converted-to-JPEG)
  const img = new window.Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Image failed to decode"));
    img.src = dataUrl;
  });
  const MAX_W = 1200;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
  const canvas = document.createElement("canvas");
  canvas.width = w || 1200; canvas.height = h || 900;
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("Canvas export failed")), "image/jpeg", 0.82)
  );
  // Upload via server (uses service role key — no storage RLS issues)
  const res = await fetch("/api/upload-photo", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg", "X-User-Id": userId },
    body: blob,
  });
  if (!res.ok) throw new Error(await res.text());
  const { url } = await res.json();
  return url as string;
}

export default function PhotoPage() {
  const { goTo, state, setState: setAppState } = useApp();
  const { user } = useAuth();
  const numPads = state.apNumPads || 1;

  const [photos, setPhotos] = useState<Record<number, string>>({});
  const [activePhoto, setActivePhoto] = useState(0);
  const [activePad, setActivePad] = useState<number | null>(0);
  const [allBoxes, setAllBoxes] = useState<Record<number, Box[]>>({});
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Drawing state
  const [drawing, setDrawing] = useState(false);
  const [sx, setSx] = useState(0);
  const [sy, setSy] = useState(0);
  const [cx, setCx] = useState(0);
  const [cy, setCy] = useState(0);
  const [rotatingIdx, setRotatingIdx] = useState<number | null>(null);
  const [draggingCorner, setDraggingCorner] = useState<{ boxIdx: number; ci: number } | null>(null);

  // Fullscreen state
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Canvas pixel dimensions (2× sharpness, based on image ratio) ──
  const CANVAS_PX_W = 750;
  const CANVAS_PX_H = naturalW > 0 ? Math.round(CANVAS_PX_W * naturalH / naturalW) : 500;

  // ── Fullscreen display dimensions ──
  function getFsDisplaySize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (naturalW === 0) return { w: vw, h: vh };
    const ratio = naturalH / naturalW;
    let w = vw;
    let h = vw * ratio;
    if (h > vh) { h = vh; w = vh / ratio; }
    return { w, h };
  }

  function hexToRgba(hex: string, a: number) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function getHandlePos(b: Box) {
    const armLen = b.h / 2 + HANDLE_ARM;
    return {
      x: b.cx + armLen * Math.sin(b.angle),
      y: b.cy - armLen * Math.cos(b.angle),
    };
  }

  function drawBox(ctx: CanvasRenderingContext2D, b: Box, showHandle: boolean) {
    const col = PAD_COLORS[b.pad] || "#8DD63F";
    ctx.save();
    ctx.translate(b.cx, b.cy);
    ctx.rotate(b.angle);
    ctx.fillStyle = hexToRgba(col, 0.22);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.roundRect(-b.w / 2, -b.h / 2, 70, 24, 4);
    ctx.fill();
    ctx.fillStyle = "#0E1F40";
    ctx.font = "bold 13px DM Sans, sans-serif";
    ctx.fillText(PAD_NAMES[b.pad] || `Pad ${b.pad + 1}`, -b.w / 2 + 8, -b.h / 2 + 16);
    ctx.restore();

    if (!showHandle) return;

    // ── Corner handles (subtle, draggable) ──
    const corners = getCorners(b);
    corners.forEach(({ x, y }) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, CORNER_R, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.82)";
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    });

    const { x: hx, y: hy } = getHandlePos(b);
    const topX = b.cx + (b.h / 2) * Math.sin(b.angle);
    const topY = b.cy - (b.h / 2) * Math.cos(b.angle);

    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = "rgba(255,255,255,0.97)";
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    const iconR = HANDLE_R * 0.46;
    ctx.beginPath();
    ctx.arc(hx, hy, iconR, -Math.PI * 0.72, Math.PI * 0.56);
    ctx.stroke();
    const aEnd = Math.PI * 0.56;
    const ax = hx + iconR * Math.cos(aEnd);
    const ay = hy + iconR * Math.sin(aEnd);
    const tang = aEnd + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(ax - 5 * Math.cos(tang - 0.45), ay - 5 * Math.sin(tang - 0.45));
    ctx.lineTo(ax, ay);
    ctx.lineTo(ax - 5 * Math.cos(tang + 0.45), ay - 5 * Math.sin(tang + 0.45));
    ctx.stroke();
  }

  function redraw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);

    const boxes = allBoxes[activePhoto] || [];
    boxes.forEach(b => drawBox(ctx, b, b.pad === activePad));

    if (drawing) {
      const bw = cx - sx, bh = cy - sy;
      const col = activePad !== null ? PAD_COLORS[activePad] : "#8DD63F";
      ctx.fillStyle = hexToRgba(col, 0.15);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.roundRect(sx, sy, bw, bh, 6);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  useEffect(() => { redraw(); }, [allBoxes, activePhoto, drawing, cx, cy, activePad, rotatingIdx, fullscreenOpen]);

  function getPos(e: React.MouseEvent | React.TouchEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const scaleX = c.width / rect.width;
    const scaleY = c.height / rect.height;
    const src = "touches" in e
      ? ((e as React.TouchEvent).touches[0] || (e as React.TouchEvent).changedTouches[0])
      : (e as React.MouseEvent);
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }

  function handleDown(e: React.MouseEvent | React.TouchEvent) {
    if (!photos[activePhoto] || activePad === null) return;
    const p = getPos(e);
    const boxes = allBoxes[activePhoto] || [];

    // Check corner handles first (active pad only)
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].pad !== activePad) continue;
      const corners = getCorners(boxes[i]);
      for (let ci = 0; ci < corners.length; ci++) {
        const { x, y } = corners[ci];
        if (Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2) < CORNER_R * 2.8) {
          setDraggingCorner({ boxIdx: i, ci });
          if ("preventDefault" in e) e.preventDefault();
          return;
        }
      }
    }

    // Check rotation handle (active pad only)
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].pad !== activePad) continue;
      const { x: hx, y: hy } = getHandlePos(boxes[i]);
      if (Math.sqrt((p.x - hx) ** 2 + (p.y - hy) ** 2) < HANDLE_R * 2) {
        setRotatingIdx(i);
        if ("preventDefault" in e) e.preventDefault();
        return;
      }
    }

    setSx(p.x); setSy(p.y); setCx(p.x); setCy(p.y);
    setDrawing(true);
  }

  function handleMove(e: React.MouseEvent | React.TouchEvent) {
    const p = getPos(e);

    // Corner drag: opposite corner stays fixed, reshape the box
    if (draggingCorner !== null) {
      const boxes = allBoxes[activePhoto] || [];
      const b = boxes[draggingCorner.boxIdx];
      if (!b) return;
      const OPPOSITE = [3, 2, 1, 0];
      const opp = getCorners(b)[OPPOSITE[draggingCorner.ci]];
      const newCx = (p.x + opp.x) / 2;
      const newCy = (p.y + opp.y) / 2;
      const dx = p.x - newCx, dy = p.y - newCy;
      const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      const newW = Math.max(20, 2 * Math.abs(lx));
      const newH = Math.max(20, 2 * Math.abs(ly));
      setAllBoxes(prev => {
        const updated = [...(prev[activePhoto] || [])];
        updated[draggingCorner.boxIdx] = { ...b, cx: newCx, cy: newCy, w: newW, h: newH };
        return { ...prev, [activePhoto]: updated };
      });
      return;
    }

    if (rotatingIdx !== null) {
      const boxes = allBoxes[activePhoto] || [];
      const b = boxes[rotatingIdx];
      if (!b) return;
      const newAngle = Math.atan2(p.y - b.cy, p.x - b.cx) + Math.PI / 2;
      setAllBoxes(prev => {
        const updated = [...(prev[activePhoto] || [])];
        updated[rotatingIdx] = { ...b, angle: newAngle };
        return { ...prev, [activePhoto]: updated };
      });
      return;
    }

    if (!drawing) return;
    setCx(p.x); setCy(p.y);
  }

  function handleUp() {
    if (draggingCorner !== null) { setDraggingCorner(null); return; }
    if (rotatingIdx !== null) { setRotatingIdx(null); return; }
    if (!drawing || activePad === null) return;
    const pad = activePad;
    const bw = cx - sx, bh = cy - sy;
    if (Math.abs(bw) > 16 && Math.abs(bh) > 16) {
      setAllBoxes(prev => {
        const boxes = [...(prev[activePhoto] || [])].filter(b => b.pad !== pad);
        boxes.push({ cx: (sx + cx) / 2, cy: (sy + cy) / 2, w: Math.abs(bw), h: Math.abs(bh), angle: 0, pad });
        return { ...prev, [activePhoto]: boxes };
      });
    }
    setDrawing(false);
  }

  function padDone(pad: number) {
    return (allBoxes[activePhoto] || []).some(b => b.pad === pad);
  }

  const allDone = Array.from({ length: numPads }, (_, i) => i).every(padDone);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    // Use FileReader → data URL (base64). Works universally on mobile, avoids
    // blob URL issues and HEIC decode failures on iOS/Android.
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;

      // Show photo + open fullscreen IMMEDIATELY
      setPhotos(prev => ({ ...prev, [activePhoto]: dataUrl }));
      setActivePad(activePhoto < numPads ? activePhoto : 0);
      setFullscreenOpen(true);

      // Get dimensions in background for canvas sizing
      const dimImg = new window.Image();
      dimImg.onload = () => {
        setNaturalW(dimImg.naturalWidth);
        setNaturalH(dimImg.naturalHeight);
      };
      dimImg.onerror = () => { setNaturalW(1200); setNaturalH(900); };
      dimImg.src = dataUrl;

      // Upload to server in background
      if (user) {
        setUploadLoading(true);
        setUploadError("");
        compressAndUpload(dataUrl, user.id)
          .then(publicUrl => {
            setAppState(prev => ({ ...prev, apPhotoUrl: publicUrl }));
          })
          .catch(err => {
            setUploadError("Photo saved locally — upload failed.");
            console.error("[Photo] upload error:", err);
          })
          .finally(() => setUploadLoading(false));
      }
    };
    reader.onerror = () => setUploadError("Could not read the selected photo.");
    reader.readAsDataURL(file);
  }

  function openFullscreen(photoIdx: number) {
    setActivePhoto(photoIdx);
    setActivePad(photoIdx < numPads ? photoIdx : 0);
    setFullscreenOpen(true);
  }

  const fsSize = getFsDisplaySize();

  // ── Canvas element (rendered in whichever context is active) ──
  const canvasEl = (
    <canvas
      ref={canvasRef}
      width={CANVAS_PX_W}
      height={CANVAS_PX_H}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none" }}
      onMouseDown={handleDown}
      onMouseMove={handleMove}
      onMouseUp={handleUp}
      onMouseLeave={handleUp}
      onTouchStart={handleDown}
      onTouchMove={handleMove}
      onTouchEnd={handleUp}
    />
  );

  return (
    <div className="page active">
      <SharedHeader step="Step 3 of 6" title="Mark your pads." progress={32} label="Profile 32% complete" />
      <div className="s-divider" />
      <div className="s-body" style={{ padding: "14px 16px 18px" }}>
        <NavBar onBack={() => goTo("photointro")} onHome={() => goTo("home")} dots={[0,1,2]} currentDot={1} />

        {/* Photo thumbnails */}
        <div className="photo-strip">
          {Array.from({ length: Math.min(numPads + 1, 3) }, (_, i) => (
            <div
              key={i}
              className={`photo-thumb${i === activePhoto ? " active-thumb" : ""}${!photos[i] ? " empty" : ""}`}
              onClick={() => {
                setActivePhoto(i);
                setActivePad(i < numPads ? i : null);
                if (photos[i]) openFullscreen(i);
                else fileRef.current?.click();
              }}
            >
              {photos[i] ? <img src={photos[i]} alt="" /> : <span className="thumb-plus">+</span>}
            </div>
          ))}
        </div>

        {/* Preview area — aspect-ratio matched so canvas and image align perfectly */}
        <div
          className="canvas-wrap"
          style={{
            height: photos[activePhoto] ? "auto" : 160,
            aspectRatio: photos[activePhoto] && naturalW > 0 ? `${naturalW}/${naturalH}` : undefined,
            maxHeight: 280,
            cursor: "pointer",
          }}
          onClick={() => {
            if (photos[activePhoto]) openFullscreen(activePhoto);
            else fileRef.current?.click();
          }}
        >
          {!photos[activePhoto] ? (
            <div className="canvas-placeholder">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.2)" strokeWidth="1.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <p>Tap to add photo</p>
            </div>
          ) : (
            <div style={{ position: "relative", width: "100%", height: "100%" }}>
              {/* objectFit: fill — container already matches image ratio so no crop/letterbox */}
              <img
                src={photos[activePhoto]}
                style={{ width: "100%", height: "100%", objectFit: "fill", position: "absolute", inset: 0, display: "block" }}
                alt=""
              />
              {/* Canvas overlay — same coordinate space as image, perfect alignment */}
              {!fullscreenOpen && (
                <canvas
                  width={CANVAS_PX_W}
                  height={CANVAS_PX_H}
                  ref={canvasRef}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                />
              )}
              <div style={{
                position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(0,0,0,0.22)",
              }}>
                <div style={{
                  background: "rgba(255,255,255,0.92)", borderRadius: 20, padding: "6px 16px",
                  fontSize: 13, fontWeight: 700, color: "#0E1F40", display: "flex", alignItems: "center", gap: 6,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                  </svg>
                  Tap to draw
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Guide */}
        {!photos[activePhoto] && (
          <div className="guide-box">
            <div className="guide-row"><div className="guide-num">1</div><p className="guide-txt">Add a photo of your parking spot from the street</p></div>
            <div className="guide-row"><div className="guide-num">2</div><p className="guide-txt">Select a pad color and drag to draw a box over the spot</p></div>
            <div className="guide-row"><div className="guide-num">3</div><p className="guide-txt">Drag the ↻ handle to rotate the box and fit angled spots</p></div>
          </div>
        )}

        {uploadLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", color: "#0E1F40", fontSize: 13, fontWeight: 600 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
            Saving photo…
          </div>
        )}
        {uploadError && (
          <p style={{ fontSize: 12, color: "#ef4444", fontWeight: 600, padding: "0 4px", margin: 0 }}>{uploadError}</p>
        )}
        {state.apPhotoUrl && !uploadLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 4px", color: "#8DD63F", fontSize: 12, fontWeight: 700 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            Photo saved
          </div>
        )}

        <div className="ghost-row">
          <button className="ghost-btn" onClick={() => fileRef.current?.click()}>
            {photos[activePhoto] ? "Replace photo" : "Upload photo"}
          </button>
          {allDone && (
            <button
              className="ghost-btn"
              style={{ background: "#0E1F40", color: "#fff", border: "none" }}
              onClick={async () => {
                // Create the spot in Supabase now that we have the photo URL.
                // photo_url is included in the INSERT so no PATCH needed.
                if (user && !state.apSpotId) {
                  try {
                    const res = await fetch("/api/spots", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        host_user_id: user.id,
                        address:      state.apAns[0] || "",
                        pad_type:     state.apAns[1] || "Driveway",
                        surface:      state.apAns[2] || "Concrete",
                        num_pads:     parseInt(state.apAns[3] || "1"),
                        price_per_hr: parseFloat(state.apAns[4] || "4"),
                        description:  state.apAns[5] || "",
                        photo_url:    state.apPhotoUrl || "",
                      }),
                    });
                    if (res.ok) {
                      const spot = await res.json();
                      if (spot?.id) {
                        setAppState(s => ({ ...s, apSpotId: spot.id }));
                      }
                    }
                  } catch { /* non-blocking */ }
                }
                goTo("availability");
              }}
            >
              Done — Next step →
            </button>
          )}
        </div>

        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: "none" }} onChange={handleFileChange} />
      </div>

      {/* ── FULLSCREEN DRAWING OVERLAY ── */}
      {fullscreenOpen && photos[activePhoto] && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 500,
          background: "#000",
          display: "flex", flexDirection: "column",
        }}>
          {/* Top bar */}
          <div style={{
            flexShrink: 0, background: "#0E1F40",
            padding: "14px 16px 10px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <p style={{ margin: 0, color: "#fff", fontSize: 15, fontWeight: 700 }}>Mark your pads</p>
            <button
              onClick={() => setFullscreenOpen(false)}
              style={{
                background: "#8DD63F", color: "#0E1F40", border: "none",
                borderRadius: 20, padding: "7px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>

          {/* Image + canvas area */}
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
          }}>
            <div style={{
              position: "relative",
              width: fsSize.w,
              height: fsSize.h,
              flexShrink: 0,
            }}>
              <img
                src={photos[activePhoto]}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", display: "block" }}
                alt=""
                onLoad={e => {
                  const img = e.target as HTMLImageElement;
                  setNaturalW(img.naturalWidth);
                  setNaturalH(img.naturalHeight);
                }}
              />
              {canvasEl}
            </div>
          </div>

          {/* Pad pills */}
          <div style={{
            flexShrink: 0, background: "#0E1F40",
            padding: "10px 16px 16px",
            display: "flex", gap: 8, alignItems: "center", justifyContent: "center",
          }}>
            {Array.from({ length: numPads }, (_, i) => (
              <div
                key={i}
                onClick={() => setActivePad(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: activePad === i ? PAD_COLORS[i] : "rgba(255,255,255,0.1)",
                  border: `2px solid ${PAD_COLORS[i]}`,
                  borderRadius: 20, padding: "6px 14px", cursor: "pointer",
                  transition: "background 0.15s",
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: activePad === i ? "#0E1F40" : PAD_COLORS[i] }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: activePad === i ? "#0E1F40" : "#fff" }}>
                  {PAD_NAMES[i]}{padDone(i) ? " ✓" : ""}
                </span>
              </div>
            ))}
            {/* Undo last box for active pad */}
            {(allBoxes[activePhoto] || []).some(b => b.pad === activePad) && (
              <div
                onClick={() => {
                  setAllBoxes(prev => {
                    const boxes = (prev[activePhoto] || []).filter(b => b.pad !== activePad);
                    return { ...prev, [activePhoto]: boxes };
                  });
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "rgba(255,255,255,0.08)", border: "2px solid rgba(255,255,255,0.2)",
                  borderRadius: 20, padding: "6px 14px", cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>✕ Redo</span>
              </div>
            )}
          </div>

          {/* Hint */}
          <p style={{ margin: 0, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.4)", padding: "0 0 10px" }}>
            Drag to draw a box · use ↻ handle to rotate
          </p>
        </div>
      )}
    </div>
  );
}
