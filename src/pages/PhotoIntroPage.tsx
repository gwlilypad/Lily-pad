import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
// Placeholder colours for the three photo-guide slides (real photos not yet uploaded)
const frontalImg = "";
const sideImg = "";
const overheadImg = "";

// ─── Data types ────────────────────────────────────────────────────────────────

interface AnimBox {
  cx: number; cy: number;    // center as 0–1 fractions of container dimensions
  hw: number; hh: number;    // half-width and half-height as 0–1 fractions
  color: string;
  label: string;
  startTime: number;          // ms from animation start when drawing begins
  // Optional rotation animation (only on boxes that demonstrate the rotate feature)
  targetAngle?: number;       // final rotation in radians; if undefined → 0°
  rotateStartDelay?: number;  // ms after draw completes before rotation starts
  rotateDuration?: number;    // ms for the rotation animation
}

// ─── Coordinates ───────────────────────────────────────────────────────────────
//
// Container: 390×472 CSS px.  Image: 1024×1024.  objectFit:cover:
//   scale = 472/1024 = 0.461, horizontal crop = (472−390)/2 = 41 px each side.
//   Visible x in original: 89–935.  Full y: 0–1024.
//
// All (cx, cy, hw, hh) are 0–1 fractions of the container (390 × 472 px).
//
//  Slide 1 (frontal):   Spot 1 = left half of driveway.
//  Slide 2 (side):      Spots are wide shallow horizontal bands (perspective view).
//                       Box 1 draws axis-aligned then rotates slightly to demo the
//                       rotate-handle feature.  Box 2 is pre-rotated.
//  Slide 3 (overhead):  Two street-parking spots at the bottom of the image.

const SLIDE_BOXES: AnimBox[][] = [
  // ── Slide 1: frontal view – one green box over spot 1 (left driveway) ───────
  //   Grid-measured: left line x≈0.12, centre line x≈0.50, top y≈0.67, bottom y≈0.91
  //   cx=(0.12+0.50)/2=0.31, hw=(0.50-0.12)/2=0.19
  //   cy=(0.67+0.91)/2=0.79, hh=(0.91-0.67)/2=0.12
  [
    {
      cx: 0.31, cy: 0.79, hw: 0.19, hh: 0.12,
      color: "#8DD63F", label: "Pad 1",
      startTime: 0,
    },
  ],

  // ── Slide 2: side-angle view – show the ROTATE FEATURE ──────────────────────
  //   Grid-measured spot 1: x 0–0.88, y 0.79–0.92 → cx=0.44, cy=0.855, hw=0.44, hh=0.065
  //   Grid-measured spot 2: x 0–0.70, y 0.64–0.78 → cx=0.35, cy=0.71, hw=0.35, hh=0.07
  [
    {
      cx: 0.44, cy: 0.855, hw: 0.44, hh: 0.065,
      color: "#8DD63F", label: "Pad 1",
      startTime: 0,
      targetAngle: -0.10,         // ≈ −6°, perspective tilt demo
      rotateStartDelay: 200,
      rotateDuration: 500,
    },
    {
      cx: 0.35, cy: 0.71, hw: 0.35, hh: 0.07,
      color: "#F59E0B", label: "Pad 2",
      startTime: 1580,
      targetAngle: -0.10,
    },
  ],

  // ── Slide 3: overhead view – two street-parking spots at the bottom ──────────
  //   Grid-measured both spots: top y≈0.70, bottom y≈0.90
  //   Left spot x: 0–0.38 → cx=0.19, hw=0.19
  //   Right spot x: 0.62–1.0 → cx=0.81, hw=0.19
  //   cy=(0.70+0.90)/2=0.80, hh=(0.90-0.70)/2=0.10
  [
    {
      cx: 0.19, cy: 0.80, hw: 0.19, hh: 0.10,
      color: "#8DD63F", label: "Pad 1",
      startTime: 0,
    },
    {
      cx: 0.81, cy: 0.80, hw: 0.19, hh: 0.10,
      color: "#60A5FA", label: "Pad 2",
      startTime: 1160,
    },
  ],
];

// ─── Animation constants ───────────────────────────────────────────────────────
const BOX_DUR = 780; // ms to draw one box

// ─── Helpers ──────────────────────────────────────────────────────────────────

function easeOut(t: number) { return 1 - Math.pow(1 - t, 3); }

function hexToRgba(hex: string, a: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Draws a pointing-finger cursor with the tip at (tipX, tipY).
function drawFingerCursor(ctx: CanvasRenderingContext2D, tipX: number, tipY: number, color: string) {
  const fw = 13, fh = 26, tr = fw / 2;
  ctx.save();
  ctx.translate(tipX - fw / 2, tipY - fh);
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.fillStyle = "rgba(255,255,255,0.93)";
  // Finger body
  ctx.beginPath();
  ctx.roundRect(0, tr, fw, fh - tr, [0, 0, fw * 0.38, fw * 0.38]);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  // Fingertip cap
  ctx.beginPath();
  ctx.arc(tr, tr, tr, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Subtle nail tint
  ctx.fillStyle = hexToRgba(color, 0.18);
  ctx.beginPath();
  ctx.ellipse(tr, tr - 1, tr - 2.5, tr - 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Draws the rotate-handle UI element (dashed arm + circle with ↻ icon).
function drawRotateHandle(
  ctx: CanvasRenderingContext2D,
  cxPx: number, cyPx: number,
  fullHhPx: number,
  angle: number,
  color: string,
  alpha: number,
) {
  if (alpha <= 0) return;
  const armLen = fullHhPx + 22;
  const hx = cxPx + armLen * Math.sin(angle);
  const hy = cyPx - armLen * Math.cos(angle);
  const topX = cxPx + fullHhPx * Math.sin(angle);
  const topY = cyPx - fullHhPx * Math.cos(angle);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Dashed arm
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(topX, topY);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Circle handle
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(0,0,0,0.18)";
  ctx.shadowBlur = 5;
  ctx.beginPath();
  ctx.arc(hx, hy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  // Rotation arrow icon
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hx, hy, 5, -Math.PI * 0.72, Math.PI * 0.56);
  ctx.stroke();
  const aEnd = Math.PI * 0.56;
  const ax = hx + 5 * Math.cos(aEnd);
  const ay = hy + 5 * Math.sin(aEnd);
  const tang = aEnd + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(ax - 4 * Math.cos(tang - 0.4), ay - 4 * Math.sin(tang - 0.4));
  ctx.lineTo(ax, ay);
  ctx.lineTo(ax - 4 * Math.cos(tang + 0.4), ay - 4 * Math.sin(tang + 0.4));
  ctx.stroke();

  ctx.restore();

  return { hx, hy }; // caller may need handle position for cursor
}

// ─── Slide metadata ────────────────────────────────────────────────────────────

const SLIDES = [
  {
    num: "1 of 3",
    title: "Shoot from the front, straight on.",
    desc: "Stand at the curb facing your driveway. Capture the full width so drivers can clearly see both spots and recognize the property when they arrive.",
    img: frontalImg,
  },
  {
    num: "2 of 3",
    title: "Add a side angle view.",
    desc: "Draw a box over each spot, then drag the ↻ handle to rotate it flush with the driveway angle. This helps drivers judge whether their vehicle will fit.",
    img: sideImg,
  },
  {
    num: "3 of 3",
    title: "An overhead view shows the full picture.",
    desc: "If possible, capture how your spots sit relative to the street. Numbered spots and clear boundaries make it easy for drivers to find the right one.",
    img: overheadImg,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function PhotoIntroPage() {
  const { goTo } = useApp();
  const [slide, setSlide] = useState(0);
  const startXRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = imgContainerRef.current;
    if (!canvas || !container) return;

    // High-DPI canvas setup — all drawing in CSS-pixel space (w × h)
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const boxes = SLIDE_BOXES[slide] || [];
    if (boxes.length === 0) return;

    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scales once; no compounding

    // Compute how long this slide's animation runs
    let animEnd = 0;
    for (const box of boxes) {
      const drawEnd = box.startTime + BOX_DUR;
      let boxEnd = drawEnd;
      if (box.rotateStartDelay !== undefined && box.rotateDuration !== undefined) {
        boxEnd = drawEnd + box.rotateStartDelay + box.rotateDuration;
      }
      animEnd = Math.max(animEnd, boxEnd);
    }

    let rafId: number;
    const startTime = Date.now();

    function renderFrame(elapsed: number) {
      const isDone = elapsed >= animEnd;
      ctx.clearRect(0, 0, w, h);

      for (const box of boxes) {
        const drawEnd = box.startTime + BOX_DUR;

        // ── Draw progress (0 → 1) ────────────────────────────────────────────
        let drawP = 0;
        if (elapsed >= box.startTime) {
          drawP = elapsed < drawEnd
            ? easeOut((elapsed - box.startTime) / BOX_DUR)
            : 1;
        }
        if (drawP <= 0) continue;

        // ── Current rotation angle ───────────────────────────────────────────
        let currentAngle = 0;
        let inRotatePhase = false;
        let handleAlpha = 0;

        if (box.targetAngle !== undefined) {
          if (box.rotateStartDelay !== undefined && box.rotateDuration !== undefined) {
            const rotStart = drawEnd + box.rotateStartDelay;
            const rotEnd = rotStart + box.rotateDuration;
            // Handle fades in from drawEnd
            handleAlpha = Math.min(1, Math.max(0, (elapsed - drawEnd) / 200));
            if (elapsed >= rotStart) {
              const rp = elapsed < rotEnd
                ? easeOut((elapsed - rotStart) / box.rotateDuration)
                : 1;
              currentAngle = box.targetAngle * rp;
            }
            inRotatePhase = elapsed >= rotStart && elapsed < rotEnd && !isDone;
          } else {
            // Pre-rotated: no animation, box draws at its final angle from frame 1
            currentAngle = box.targetAngle;
          }
        }

        // ── Pixel positions ──────────────────────────────────────────────────
        const cxPx = box.cx * w;
        const cyPx = box.cy * h;
        const hwFull = box.hw * w;  // half-width at full draw
        const hhFull = box.hh * h;  // half-height at full draw

        // ── Draw the box ─────────────────────────────────────────────────────
        //    Grows from top-left corner toward bottom-right (drag-to-draw feel).
        //    The anchor (TL) is fixed in local space; BR corner expands with drawP.
        ctx.save();
        ctx.translate(cxPx, cyPx);
        ctx.rotate(currentAngle);

        const curW = hwFull * 2 * drawP;
        const curH = hhFull * 2 * drawP;

        ctx.fillStyle = hexToRgba(box.color, 0.20);
        ctx.strokeStyle = box.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(-hwFull, -hhFull, curW, curH, 5);
        ctx.fill();
        ctx.stroke();

        // Label badge – fades in as box nears completion
        if (drawP > 0.72) {
          const la = Math.min(1, (drawP - 0.72) / 0.28);
          ctx.save();
          ctx.globalAlpha = la;
          ctx.fillStyle = box.color;
          ctx.beginPath();
          ctx.roundRect(-hwFull + 5, -hhFull + 5, 52, 21, 4);
          ctx.fill();
          ctx.fillStyle = "#0E1F40";
          ctx.font = "bold 11px DM Sans, sans-serif";
          ctx.fillText(box.label, -hwFull + 9, -hhFull + 18);
          ctx.restore();
        }

        ctx.restore();

        // ── Rotate handle (slide 2 only, fades in after box is drawn) ────────
        if (handleAlpha > 0) {
          drawRotateHandle(ctx, cxPx, cyPx, hhFull, currentAngle, box.color, handleAlpha);
        }

        // ── Finger cursor ─────────────────────────────────────────────────────
        if (!isDone) {
          if (inRotatePhase) {
            // During rotation: cursor tracks the rotating handle position
            const armLen = hhFull + 22;
            const hx = cxPx + armLen * Math.sin(currentAngle);
            const hy = cyPx - armLen * Math.cos(currentAngle);
            drawFingerCursor(ctx, hx, hy, box.color);
          } else if (elapsed >= box.startTime && elapsed < drawEnd + 160) {
            // During draw: cursor tracks the expanding bottom-right corner
            // BR corner in local rotated space: (hwFull*(2p−1), hhFull*(2p−1))
            const lx = hwFull * (2 * drawP - 1);
            const ly = hhFull * (2 * drawP - 1);
            const tipX = cxPx + lx * Math.cos(currentAngle) - ly * Math.sin(currentAngle);
            const tipY = cyPx + lx * Math.sin(currentAngle) + ly * Math.cos(currentAngle);
            drawFingerCursor(ctx, tipX, tipY, box.color);
          }
        }
      }
    }

    function tick() {
      const elapsed = Date.now() - startTime;
      renderFrame(elapsed);
      if (elapsed < animEnd) {
        rafId = requestAnimationFrame(tick);
      }
      // Once done: canvas holds final state; no more frames
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [slide]);

  function nextSlide() {
    if (slide < SLIDES.length - 1) setSlide(slide + 1);
    else goTo("photo");
  }

  function prevSlide() {
    if (slide > 0) setSlide(slide - 1);
  }

  function handleTouchStart(e: React.TouchEvent) {
    startXRef.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (startXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - startXRef.current;
    if (dx < -40) nextSlide();
    else if (dx > 40) prevSlide();
    startXRef.current = null;
  }

  const s = SLIDES[slide];

  return (
    <div className="page active">
      <div
        style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Photo with canvas overlay */}
        <div
          ref={imgContainerRef}
          style={{ flex: 1, position: "relative", overflow: "hidden", background: "#e8e0d8" }}
        >
          <img
            key={slide}
            src={s.img}
            alt={s.title}
            style={{
              width: "100%", height: "100%",
              objectFit: "cover", objectPosition: "center",
              display: "block",
            }}
          />
          {/* Bottom gradient */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.28) 0%, transparent 38%)",
            pointerEvents: "none",
          }} />
          {/* Animation canvas — non-interactive overlay */}
          <canvas
            ref={canvasRef}
            style={{ position: "absolute", inset: 0, pointerEvents: "none", width: "100%", height: "100%" }}
          />
        </div>

        {/* Content card */}
        <div style={{ background: "#fff", padding: "22px 24px 20px", flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", color: "#8DD63F", textTransform: "uppercase", marginBottom: 6 }}>{s.num}</p>
          <h2 style={{ fontSize: 22, fontWeight: 300, color: "#0E1F40", lineHeight: 1.2, marginBottom: 8, letterSpacing: "-0.01em" }}>{s.title}</h2>
          <p style={{ fontSize: 13, fontWeight: 300, color: "rgba(14,31,64,0.5)", lineHeight: 1.55, marginBottom: 0 }}>{s.desc}</p>

          {/* Dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 18, marginBottom: 16 }}>
            {SLIDES.map((_, i) => (
              <div
                key={i}
                className={`pi-dot${i === slide ? " pi-dot-active" : ""}`}
                onClick={() => setSlide(i)}
                style={{ cursor: "pointer" }}
              />
            ))}
          </div>

          <button
            style={{ width: "100%", padding: "15px 0", background: "#0E1F40", color: "#fff", fontSize: 15, fontWeight: 500, border: "none", borderRadius: 100, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
            onClick={nextSlide}
          >
            {slide < SLIDES.length - 1 ? "Next" : "Take my photos"}
          </button>

          <p
            style={{ fontSize: 12, color: "rgba(14,31,64,0.3)", textAlign: "center", marginTop: 12, cursor: "pointer" }}
            onClick={() => goTo("photo")}
          >
            Skip tutorial
          </p>
        </div>
      </div>
    </div>
  );
}
