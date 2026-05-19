import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";
import {
  loadTickets, mutateTickets, subscribeTickets, makeId, formatSupportTime, ticketLastPreview,
  emptyResolutionDraft, ticketPipeline,
  gradeAgentMessage, conversationRating, staffRating,
  type SupportTicket, type SupportResolution, type TicketPipeline, type MessageRating,
} from "@/lib/support";
import {
  loadEmails, subscribeEmails, markEmailRead,
  emailCategoryLabel, emailAudienceLabel, formatEmailTime,
  type SupportEmail, type EmailAccountType, type EmailCategory,
} from "@/lib/email";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";
const PAD_COLORS = ["#8DD63F", "#F59E0B", "#4A6FA5"];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "13px 16px",
  borderRadius: 14,
  border: "1.5px solid rgba(255,255,255,0.10)",
  background: "#08152F",
  fontSize: 15,
  color: "#fff",
  fontFamily: '"DM Sans", sans-serif',
  fontWeight: 400,
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.18s",
};

// ── User / Staff types ───────────────────────────────────────────────────────
type UserType = "driver" | "host" | "both";
interface PadInfo {
  name: string;
  color: string;
  photoUrl: string;
  box: { cx: number; cy: number; w: number; h: number; angle: number };
}
interface MockUser {
  id: number;
  type: UserType;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  vehicle?: string;
  address?: string;
  pads?: PadInfo[];
  bookingsThisMonth: number;
  earningsThisMonth?: number;
  totalSpent?: number;
  joined: string;
  verified: boolean;
  status: "active" | "suspended";
  internalNote?: string;
}

// ── localStorage keys ───────────────────────────────────────────────────────
const ADMIN_LOGIN_KEY   = "lilypad.admin.loggedIn.v1";
const ADMIN_ROLE_KEY    = "lilypad.admin.role.v1";
const ADMIN_USERS_KEY   = "lilypad.admin.users.v1";
const STAFF_ACCOUNTS_KEY = "lilypad.admin.staff.v1";

type AdminRole = "staff" | "admin";

// ── Staff accounts (real data from Supabase admin_users) ─────────────────────
type StaffAccount = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: AdminRole;
  status: "active" | "suspended";
  lastSignIn: string;
};


function StatCard({
  label, value, sub, breakdown, onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  breakdown?: { label: string; value: string; dot?: string }[];
  onClick?: () => void;
}) {
  return (
    <div onClick={onClick} style={{
      background: "#142A52",
      borderRadius: 18,
      padding: "16px 18px",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 14px rgba(0,0,0,0.30)",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      cursor: onClick ? "pointer" : "default",
    }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: GREEN, fontWeight: 600, margin: 0 }}>{sub}</p>}
      {breakdown && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 5 }}>
          {breakdown.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: b.dot || GREEN, flexShrink: 0 }} />
                <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.70)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{b.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RevenueRow({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 0",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: accent ? 700 : 500, color: accent ? "#fff" : "rgba(255,255,255,0.62)" }}>{label}</span>
        {hint && <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.50)", fontWeight: 400 }}>{hint}</span>}
      </div>
      <span style={{ fontSize: accent ? 17 : 14, fontWeight: accent ? 800 : 600, color: accent ? GREEN : "#fff", letterSpacing: "-0.01em" }}>{value}</span>
    </div>
  );
}

// ── Editable field ──────────────────────────────────────────────────────────
function EditableField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.52)", letterSpacing: "0.04em", width: 88, flexShrink: 0, textTransform: "uppercase" }}>{label}</span>
      {editing ? (
        <>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") { onChange(draft); setEditing(false); } if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
            style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${NAVY}`, background: "#142A52", fontSize: 13.5, color: "#fff", fontFamily: '"DM Sans",sans-serif', outline: "none", minWidth: 0 }}
          />
          <button onClick={() => { onChange(draft); setEditing(false); }} style={{ background: GREEN, color: NAVY, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}>Save</button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, fontSize: 13.5, color: "#fff", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || <span style={{ color: "rgba(255,255,255,0.30)" }}>— not set —</span>}</span>
          <button onClick={() => setEditing(true)} style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}>Edit</button>
        </>
      )}
    </div>
  );
}

// ── Section header ──────────────────────────────────────────────────────────
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 8px" }}>{children}</p>
  );
}

// ── Inline spot box editor (canvas; tap inside box to drag, ↻ handle to rotate, ✕ to delete, drag empty area to redraw) ─
const HANDLE_R = 14;
const HANDLE_ARM = 28;
const CLOSE_R = 11;

function SpotEditor({ pad, onSave, onClose }: { pad: PadInfo; onSave: (box: PadInfo["box"]) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(360);
  const [ch, setCh] = useState(240);
  const [box, setBox] = useState(pad.box);
  const [drawing, setDrawing] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [moving, setMoving] = useState(false);
  const startRef = useRef({ x: 0, y: 0 });
  const curRef = useRef({ x: 0, y: 0 });
  const moveOffsetRef = useRef({ dx: 0, dy: 0 });

  const hasBox = box.w > 0.01 && box.h > 0.01;

  // Resize observer
  useEffect(() => {
    const w = wrapRef.current;
    if (!w) return;
    const ro = new ResizeObserver(() => {
      setCw(w.clientWidth);
      setCh(w.clientHeight);
    });
    ro.observe(w);
    return () => ro.disconnect();
  }, []);

  function hexToRgba(hex: string, a: number) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function getHandlePos(b: { cx: number; cy: number; w: number; h: number; angle: number }) {
    const cxPx = b.cx * cw, cyPx = b.cy * ch;
    const hPx = b.h * ch;
    const armLen = hPx / 2 + HANDLE_ARM;
    return {
      x: cxPx + armLen * Math.sin(b.angle),
      y: cyPx - armLen * Math.cos(b.angle),
    };
  }

  function getClosePos(b: { cx: number; cy: number; w: number; h: number; angle: number }) {
    const cxPx = b.cx * cw, cyPx = b.cy * ch;
    const wPx = b.w * cw, hPx = b.h * ch;
    // Local top-right corner, then rotate by box angle
    const lx = wPx / 2;
    const ly = -hPx / 2;
    const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
    return { x: cxPx + lx * cos - ly * sin, y: cyPx + lx * sin + ly * cos };
  }

  function isInsideBox(p: { x: number; y: number }, b: { cx: number; cy: number; w: number; h: number; angle: number }) {
    const cxPx = b.cx * cw, cyPx = b.cy * ch;
    const wPx = b.w * cw, hPx = b.h * ch;
    const dx = p.x - cxPx, dy = p.y - cyPx;
    const cos = Math.cos(-b.angle), sin = Math.sin(-b.angle);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    return Math.abs(lx) < wPx / 2 && Math.abs(ly) < hPx / 2;
  }

  function redraw() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, cw, ch);

    const drawB = (b: typeof box, dashed: boolean) => {
      const col = pad.color;
      const cxPx = b.cx * cw, cyPx = b.cy * ch;
      const wPx = b.w * cw, hPx = b.h * ch;
      ctx.save();
      ctx.translate(cxPx, cyPx);
      ctx.rotate(b.angle);
      ctx.fillStyle = hexToRgba(col, 0.22);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      if (dashed) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.roundRect(-wPx / 2, -hPx / 2, wPx, hPx, 4);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      // Label badge
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(-wPx / 2, -hPx / 2, 50, 16, 3);
      ctx.fill();
      ctx.fillStyle = NAVY;
      ctx.font = "bold 10px DM Sans, sans-serif";
      ctx.fillText(pad.name, -wPx / 2 + 5, -hPx / 2 + 11);
      ctx.restore();

      // Rotate handle
      const { x: hx, y: hy } = getHandlePos(b);
      const topX = cxPx + (hPx / 2) * Math.sin(b.angle);
      const topY = cyPx - (hPx / 2) * Math.cos(b.angle);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_R * 0.50, -Math.PI * 0.72, Math.PI * 0.56);
      ctx.stroke();

      // Close (delete) button at top-right corner of the box — skip during the live-draw preview
      if (!dashed) {
        const { x: clx, y: cly } = getClosePos(b);
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(clx, cly, CLOSE_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = NAVY;
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(clx - 4, cly - 4);
        ctx.lineTo(clx + 4, cly + 4);
        ctx.moveTo(clx + 4, cly - 4);
        ctx.lineTo(clx - 4, cly + 4);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
    };

    if (drawing) {
      // Live preview — convert pixel rect to normalized box for display
      const sx = startRef.current.x, sy = startRef.current.y;
      const ex = curRef.current.x, ey = curRef.current.y;
      const bw = Math.abs(ex - sx) / cw;
      const bh = Math.abs(ey - sy) / ch;
      const cxN = ((sx + ex) / 2) / cw;
      const cyN = ((sy + ey) / 2) / ch;
      drawB({ cx: cxN, cy: cyN, w: bw, h: bh, angle: 0 }, true);
    } else if (hasBox) {
      drawB(box, false);
    }
  }

  useEffect(() => { redraw(); }, [box, cw, ch, drawing, hasBox]);

  function getPos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = getPos(e);
    if (hasBox) {
      // 1. Close (X) hit → delete the box (then user can draw again)
      const { x: clx, y: cly } = getClosePos(box);
      if (Math.hypot(p.x - clx, p.y - cly) < CLOSE_R * 1.5) {
        setBox({ cx: 0.5, cy: 0.5, w: 0, h: 0, angle: 0 });
        return;
      }
      // 2. Rotate handle hit
      const { x: hx, y: hy } = getHandlePos(box);
      if (Math.hypot(p.x - hx, p.y - hy) < HANDLE_R * 1.6) {
        setRotating(true);
        return;
      }
      // 3. Inside box → drag to move
      if (isInsideBox(p, box)) {
        moveOffsetRef.current = { dx: p.x - box.cx * cw, dy: p.y - box.cy * ch };
        setMoving(true);
        return;
      }
      // 4. Outside the box, but a box already exists → ignore (must delete first)
      return;
    }
    // 5. No box yet → start drawing a fresh one
    startRef.current = p;
    curRef.current = p;
    setDrawing(true);
  }

  function onMove(e: React.PointerEvent) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = getPos(e);
    if (rotating) {
      const cxPx = box.cx * cw, cyPx = box.cy * ch;
      const newAngle = Math.atan2(p.y - cyPx, p.x - cxPx) + Math.PI / 2;
      setBox(b => ({ ...b, angle: newAngle }));
      return;
    }
    if (moving) {
      const newCxPx = p.x - moveOffsetRef.current.dx;
      const newCyPx = p.y - moveOffsetRef.current.dy;
      const cxN = Math.max(0, Math.min(1, newCxPx / cw));
      const cyN = Math.max(0, Math.min(1, newCyPx / ch));
      setBox(b => ({ ...b, cx: cxN, cy: cyN }));
      return;
    }
    if (drawing) {
      curRef.current = p;
      redraw();
    }
  }

  function onUp() {
    if (rotating) { setRotating(false); return; }
    if (moving) { setMoving(false); return; }
    if (!drawing) return;
    const sx = startRef.current.x, sy = startRef.current.y;
    const ex = curRef.current.x, ey = curRef.current.y;
    const bwPx = Math.abs(ex - sx);
    const bhPx = Math.abs(ey - sy);
    if (bwPx > 12 && bhPx > 12) {
      setBox({
        cx: ((sx + ex) / 2) / cw,
        cy: ((sy + ey) / 2) / ch,
        w: bwPx / cw,
        h: bhPx / ch,
        angle: 0,
      });
    }
    setDrawing(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(14,31,64,0.85)", zIndex: 1000, display: "flex", flexDirection: "column", padding: "24px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, color: "#fff" }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Master spot editor</p>
          <p style={{ fontSize: 17, fontWeight: 800, margin: "2px 0 0", letterSpacing: "-0.02em" }}>Redraw {pad.name}</p>
        </div>
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.12)", border: "none", borderRadius: "50%", width: 34, height: 34, color: "#fff", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>

      <div ref={wrapRef} style={{ position: "relative", width: "100%", aspectRatio: "3/2", background: "#000", borderRadius: 12, overflow: "hidden", touchAction: "none" }}>
        <img src={pad.photoUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <canvas
          ref={canvasRef}
          width={cw}
          height={ch}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: moving ? "grabbing" : drawing ? "crosshair" : hasBox ? "grab" : "crosshair" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>

      <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 11.5, margin: "12px 0 0", textAlign: "center", lineHeight: 1.5 }}>
        {hasBox
          ? "Drag the box to move · ↻ handle to rotate · ✕ to delete and redraw"
          : "Drag on the photo to draw the parking box"}
      </p>

      <div style={{ marginTop: "auto", display: "flex", gap: 10 }}>
        <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Cancel</button>
        <button onClick={() => { onSave(box); onClose(); }} style={{ flex: 1, padding: "13px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Save spot</button>
      </div>
    </div>
  );
}

// ── Pad photo with overlay box (read-only display) ──────────────────────────
function PadPhotoCard({
  pad, onEdit, onReplacePhoto, onRename, onDelete,
}: {
  pad: PadInfo;
  onEdit: () => void;
  onReplacePhoto: (dataUrl: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const W = 100, H = 70; // SVG viewBox in % units
  const cx = pad.box.cx * W, cy = pad.box.cy * H;
  const w = pad.box.w * W, h = pad.box.h * H;
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(pad.name);
  useEffect(() => { setDraftName(pad.name); }, [pad.name]);

  function pickFile() { fileRef.current?.click(); }
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // Downscale to keep localStorage well under quota (raw phone photos can be 3–5MB).
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          const ratio = Math.min(MAX / w, MAX / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { onReplacePhoto(String(reader.result)); return; }
        ctx.drawImage(img, 0, 0, w, h);
        try {
          const out = canvas.toDataURL("image/jpeg", 0.82);
          onReplacePhoto(out);
        } catch {
          onReplacePhoto(String(reader.result));
        }
      };
      img.onerror = () => onReplacePhoto(String(reader.result));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
    e.target.value = "";
  }

  return (
    <div style={{ background: "#142A52", borderRadius: 14, overflow: "hidden", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 10px rgba(0,0,0,0.28)" }}>
      <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
      <div style={{ position: "relative", width: "100%", aspectRatio: "10/7", background: "#000" }}>
        <img src={pad.photoUrl} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <g transform={`translate(${cx} ${cy}) rotate(${pad.box.angle * 180 / Math.PI})`}>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={1.2} fill={pad.color} fillOpacity={0.22} stroke={pad.color} strokeWidth={0.6} />
            <rect x={-w / 2} y={-h / 2} width={Math.min(15, w * 0.6)} height={3.5} rx={0.6} fill={pad.color} />
            <text x={-w / 2 + 1} y={-h / 2 + 2.6} fontSize={2.2} fontWeight={700} fill={NAVY} fontFamily="DM Sans, sans-serif">{pad.name}</text>
          </g>
        </svg>
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: pad.color, flexShrink: 0 }} />
          {renaming ? (
            <>
              <input
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") { onRename(draftName.trim() || pad.name); setRenaming(false); } if (e.key === "Escape") { setDraftName(pad.name); setRenaming(false); } }}
                style={{ flex: 1, padding: "5px 8px", borderRadius: 8, border: `1.5px solid ${NAVY}`, background: "#142A52", fontSize: 13, color: "#fff", fontFamily: '"DM Sans",sans-serif', outline: "none", minWidth: 0 }}
              />
              <button onClick={() => { onRename(draftName.trim() || pad.name); setRenaming(false); }} style={{ background: GREEN, color: NAVY, border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Save</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pad.name}</span>
              <button onClick={() => setRenaming(true)} style={{ background: "transparent", color: "rgba(255,255,255,0.62)", border: "none", padding: 4, cursor: "pointer" }} title="Rename pad">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </button>
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={onEdit} style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            Redraw spot
          </button>
          <button onClick={pickFile} style={{ background: "rgba(255,255,255,0.08)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            Replace photo
          </button>
          <button onClick={onDelete} style={{ background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "none", borderRadius: 8, padding: "6px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Financial growth chart (W / M / Y) ──────────────────────────────────────
type GrowthRange = "day" | "week" | "month" | "3months" | "ytd" | "year" | "all";
const GROWTH_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const GROWTH_DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function growthDaysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function buildGrowthSeries(n: number, start: number, end: number, wobbleFrac: number, seed: number): number[] {
  const out: number[] = [];
  let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const span = Math.max(Math.abs(start), Math.abs(end));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const ease = t * t * (3 - 2 * t);
    const base = start + (end - start) * ease;
    const noise = (rnd() - 0.5) * 2 * wobbleFrac * span;
    out.push(Math.max(0, Math.round(base + noise)));
  }
  if (n > 0) {
    out[0] = Math.round(start);
    out[n - 1] = Math.round(end);
  }
  return out;
}
function buildGrowthData(): Record<GrowthRange, { labels: string[]; values: number[]; xLabel: string }> {
  const today = new Date(2026, 3, 29); // Apr 29, 2026

  // 1D — hourly (24 points)
  const dayLabels: string[] = [];
  for (let h = 0; h < 24; h++) {
    if (h === 0) dayLabels.push("12a");
    else if (h < 12) dayLabels.push(`${h}a`);
    else if (h === 12) dayLabels.push("12p");
    else dayLabels.push(`${h - 12}p`);
  }
  const dayValues = buildGrowthSeries(24, 8, 342, 0.05, 7);

  // 1W — daily (7 points)
  const weekLabels: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    weekLabels.push(`${GROWTH_DOW[d.getDay()]} ${GROWTH_MONTHS[d.getMonth()]} ${d.getDate()}`);
  }
  const weekValues = buildGrowthSeries(7, 142, 287, 0.06, 11);

  // 1M — daily (Apr 1 → Apr 29)
  const monthDays = today.getDate();
  const monthLabels: string[] = [];
  for (let d = 1; d <= monthDays; d++) monthLabels.push(`Apr ${d}`);
  const monthValues = buildGrowthSeries(monthDays, 820, 1528, 0.04, 17);

  // 3M — daily (Feb 1 → Apr 29)
  const start3M = new Date(2026, 1, 1);
  const days3M = growthDaysBetween(start3M, today) + 1;
  const labels3M: string[] = [];
  for (let i = 0; i < days3M; i++) {
    const d = new Date(start3M); d.setDate(start3M.getDate() + i);
    labels3M.push(`${GROWTH_MONTHS[d.getMonth()]} ${d.getDate()}`);
  }
  const values3M = buildGrowthSeries(days3M, 3280, 4218, 0.04, 23);

  // YTD — daily (Jan 1 → Apr 29)
  const startYTD = new Date(2026, 0, 1);
  const daysYTD = growthDaysBetween(startYTD, today) + 1;
  const labelsYTD: string[] = [];
  for (let i = 0; i < daysYTD; i++) {
    const d = new Date(startYTD); d.setDate(startYTD.getDate() + i);
    labelsYTD.push(`${GROWTH_MONTHS[d.getMonth()]} ${d.getDate()}`);
  }
  const valuesYTD = buildGrowthSeries(daysYTD, 2840, 4218, 0.05, 31);

  // 1Y — daily (365 points)
  const startYear = new Date(today); startYear.setDate(today.getDate() - 364);
  const labelsYear: string[] = [];
  for (let i = 0; i < 365; i++) {
    const d = new Date(startYear); d.setDate(startYear.getDate() + i);
    labelsYear.push(`${GROWTH_MONTHS[d.getMonth()]} ${d.getDate()}, ${String(d.getFullYear()).slice(2)}`);
  }
  const valuesYear = buildGrowthSeries(365, 1100, 4218, 0.05, 41);

  // ALL — weekly (~5 years)
  const startAll = new Date(2021, 4, 2);
  const weeksAll = Math.floor(growthDaysBetween(startAll, today) / 7) + 1;
  const labelsAll: string[] = [];
  for (let i = 0; i < weeksAll; i++) {
    const d = new Date(startAll); d.setDate(startAll.getDate() + i * 7);
    labelsAll.push(`${GROWTH_MONTHS[d.getMonth()]} ${d.getDate()}, ${String(d.getFullYear()).slice(2)}`);
  }
  const valuesAll = buildGrowthSeries(weeksAll, 4200, 33378, 0.04, 53);

  return {
    day:       { labels: dayLabels,   values: dayValues,   xLabel: "Today" },
    week:      { labels: weekLabels,  values: weekValues,  xLabel: "Last 7 days" },
    month:     { labels: monthLabels, values: monthValues, xLabel: "This month" },
    "3months": { labels: labels3M,    values: values3M,    xLabel: "Last 3 months" },
    ytd:       { labels: labelsYTD,   values: valuesYTD,   xLabel: "Year to date" },
    year:      { labels: labelsYear,  values: valuesYear,  xLabel: "Past 12 months" },
    all:       { labels: labelsAll,   values: valuesAll,   xLabel: "All time" },
  };
}
const GROWTH_DATA = buildGrowthData();
const RANGE_ORDER: { key: GrowthRange; label: string }[] = [
  { key: "day",      label: "1D" },
  { key: "week",     label: "1W" },
  { key: "month",    label: "1M" },
  { key: "3months",  label: "3M" },
  { key: "ytd",      label: "YTD" },
  { key: "year",     label: "1Y" },
  { key: "all",      label: "ALL" },
];
function formatDollars(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

function GrowthChart() {
  const [range, setRange] = useState<GrowthRange>("month");
  const [scrubIdx, setScrubIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const data = GROWTH_DATA[range];
  const W = 320, H = 96, PT = 6, PB = 6, PL = 2, PR = 2;
  const innerW = W - PL - PR;
  const innerH = H - PT - PB;
  const max = Math.max(...data.values);
  const min = Math.min(...data.values);
  const range01 = max === min ? 1 : max - min;
  const n = data.values.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const pts = data.values.map((v, i) => ({
    x: PL + i * stepX,
    y: PT + innerH - ((v - min) / range01) * innerH,
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  const startVal = data.values[0];
  const endVal = data.values[n - 1];
  const overallPct = startVal === 0 ? 0 : ((endVal - startVal) / Math.abs(startVal)) * 100;
  const overallUp = overallPct >= 0;

  // Reset scrub state when switching ranges.
  useEffect(() => { setScrubIdx(null); }, [range]);

  // Active display: scrubbed point or overall summary.
  const activeIdx = scrubIdx ?? n - 1;
  const activeVal = data.values[activeIdx];
  const activePt = pts[activeIdx];
  const scrubbing = scrubIdx !== null;
  // When scrubbing, change is from start to that point.
  // When not scrubbing, change is overall from start to end.
  const cmpVal = scrubbing ? data.values[activeIdx] : endVal;
  const cmpPct = startVal === 0 ? 0 : ((cmpVal - startVal) / Math.abs(startVal)) * 100;
  const cmpAbs = cmpVal - startVal;
  const cmpUp = cmpPct >= 0;
  const lineColor = overallUp ? GREEN : "#ef4444";
  const cmpColor = cmpUp ? GREEN : "#ef4444";
  const startY = pts[0].y;

  function pointerToIdx(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const xInSvg = PL + ratio * innerW;
    if (stepX === 0) return 0;
    const idx = Math.round((xInSvg - PL) / stepX);
    return Math.max(0, Math.min(n - 1, idx));
  }

  return (
    <div style={{
      background: "#142A52", borderRadius: 18, padding: "16px 18px 14px",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 14px rgba(0,0,0,0.30)",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ minHeight: 80 }}>
        <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Financial Growth</p>
        <p style={{ fontSize: 30, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.03em", lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>{formatDollars(activeVal)}</p>
        <p style={{ fontSize: 12, color: cmpColor, fontWeight: 700, margin: "5px 0 0", display: "flex", alignItems: "center", gap: 5, fontVariantNumeric: "tabular-nums" }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style={{ transform: cmpUp ? "none" : "rotate(180deg)" }}>
            <polygon points="12 4 22 20 2 20" />
          </svg>
          {cmpUp ? "+" : "−"}${Math.abs(cmpAbs).toLocaleString()} ({cmpUp ? "+" : ""}{cmpPct.toFixed(2)}%)
          <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
            {scrubbing ? data.labels[activeIdx] : data.xLabel}
          </span>
        </p>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 110, display: "block", touchAction: "none", cursor: "crosshair" }}
        onPointerDown={e => {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          setScrubIdx(pointerToIdx(e.clientX));
        }}
        onPointerMove={e => {
          if (e.buttons === 0 && e.pointerType === "mouse") return;
          if (scrubIdx === null && e.pointerType !== "mouse") return;
          setScrubIdx(pointerToIdx(e.clientX));
        }}
        onPointerUp={() => setScrubIdx(null)}
        onPointerCancel={() => setScrubIdx(null)}
        onPointerLeave={() => setScrubIdx(null)}
      >
        {/* dashed reference at the starting price */}
        <line x1={PL} x2={W - PR} y1={startY} y2={startY}
          stroke="rgba(255,255,255,0.20)" strokeWidth={0.6} strokeDasharray="2 3" />
        {/* line */}
        <path d={linePath} fill="none" stroke={lineColor} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        {/* end dot with subtle halo (when not scrubbing) */}
        {!scrubbing && (
          <>
            <circle cx={pts[n - 1].x} cy={pts[n - 1].y} r={5.5} fill={lineColor} opacity={0.20} />
            <circle cx={pts[n - 1].x} cy={pts[n - 1].y} r={2.4} fill={lineColor} />
          </>
        )}
        {/* scrub crosshair */}
        {scrubbing && (
          <>
            <line x1={activePt.x} x2={activePt.x} y1={0} y2={H}
              stroke="rgba(255,255,255,0.45)" strokeWidth={0.6} strokeDasharray="2 2" />
            <circle cx={activePt.x} cy={activePt.y} r={6} fill={lineColor} opacity={0.22} />
            <circle cx={activePt.x} cy={activePt.y} r={2.6} fill="#fff" stroke={lineColor} strokeWidth={1.2} />
          </>
        )}
      </svg>

      <div style={{ display: "flex", gap: 2, marginTop: 2, justifyContent: "space-between" }}>
        {RANGE_ORDER.map(({ key, label }) => {
          const active = range === key;
          return (
            <button key={key} onClick={() => setRange(key)} style={{
              background: active ? "rgba(141,214,63,0.18)" : "transparent",
              color: active ? GREEN : "rgba(255,255,255,0.62)",
              border: "none", borderRadius: 100, padding: "5px 9px",
              fontSize: 10.5, fontWeight: 800, cursor: "pointer",
              fontFamily: '"DM Sans",sans-serif', letterSpacing: "0.04em",
              flex: 1, minWidth: 0,
            }}>{label}</button>
          );
        })}
      </div>
    </div>
  );
}

// ── Initials + colored avatar ───────────────────────────────────────────────
function Avatar({ user, size = 40 }: { user: MockUser; size?: number }) {
  const initials = (user.firstName[0] + user.lastName[0]).toUpperCase();
  const bg = user.type === "host" ? "rgba(141,214,63,0.18)" : user.type === "driver" ? "rgba(255,255,255,0.12)" : "rgba(120,170,255,0.20)";
  const fg = user.type === "host" ? "#B6E97A" : user.type === "driver" ? "#fff" : "#9DBEFF";
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size * 0.38, flexShrink: 0 }}>{initials}</div>
  );
}

function TypeBadge({ type }: { type: UserType }) {
  const map = {
    driver: { label: "Driver", bg: "rgba(255,255,255,0.10)", fg: "#fff" },
    host: { label: "Host", bg: "rgba(141,214,63,0.18)", fg: "#B6E97A" },
    both: { label: "Both", bg: "rgba(120,170,255,0.18)", fg: "#9DBEFF" },
  } as const;
  const m = map[type];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: m.fg, background: m.bg, padding: "3px 8px", borderRadius: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>{m.label}</span>
  );
}

// Color a 1–5 score: red below 3, amber at 3–3.9, green at 4+.
function scoreColor(n: number): string {
  if (n >= 4) return GREEN;
  if (n >= 3) return "#F59E0B";
  return "#ef4444";
}

// Compact admin-only rating pill shown beneath each agent message.
function RatingPill({ rating }: { rating: MessageRating }) {
  const color = scoreColor(rating.overall);
  return (
    <span
      title={`Professional ${rating.professionalism}/5 · Spelling ${rating.spelling}/5 · Grammar ${rating.grammar}/5 · Response ${rating.responseTime}/5`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "rgba(141,214,63,0.10)",
        border: `1px solid ${color}55`,
        color,
        fontWeight: 800,
        fontSize: 9.5,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        padding: "1px 6px",
        borderRadius: 100,
        lineHeight: 1.4,
      }}
    >
      QA {rating.overall}/5
    </span>
  );
}

function ResolutionReadout({ r }: { r: SupportResolution }) {
  const satFg = r.customerSatisfied === "yes" ? GREEN : r.customerSatisfied === "no" ? "#ef4444" : "#9DBEFF";
  const satBg = r.customerSatisfied === "yes" ? "rgba(141,214,63,0.18)" : r.customerSatisfied === "no" ? "rgba(239,68,68,0.18)" : "rgba(120,170,255,0.18)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <p style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.50)", letterSpacing: 0.5, textTransform: "uppercase", margin: "0 0 3px" }}>Issue</p>
        <p style={{ fontSize: 12.5, color: "#fff", margin: 0, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{r.issue}</p>
      </div>
      <div>
        <p style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.50)", letterSpacing: 0.5, textTransform: "uppercase", margin: "0 0 3px" }}>Solution</p>
        <p style={{ fontSize: 12.5, color: "#fff", margin: 0, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{r.solution}</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.50)", letterSpacing: 0.5, textTransform: "uppercase" }}>Customer satisfied</span>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", padding: "2px 7px", borderRadius: 5, color: satFg, background: satBg }}>{r.customerSatisfied}</span>
      </div>
      {r.customerFeedback && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.50)", letterSpacing: 0.5, textTransform: "uppercase", margin: "0 0 3px" }}>Customer feedback</p>
          <p style={{ fontSize: 12.5, color: "#fff", margin: 0, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{r.customerFeedback}</p>
        </div>
      )}
      {r.staffNotes && (
        <div>
          <p style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.50)", letterSpacing: 0.5, textTransform: "uppercase", margin: "0 0 3px" }}>Internal notes</p>
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.78)", margin: 0, lineHeight: 1.45, whiteSpace: "pre-wrap", fontStyle: "italic" }}>{r.staffNotes}</p>
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
type View = "dashboard" | "users" | "userDetail" | "service" | "staff";
type AdminView = "renters" | "hosts";
type StaffAuthAction = { kind: "suspend" | "reinstate"; staffId: string; staffName: string };

export default function AdminPage() {
  const { goTo, setState } = useApp();
  const [loggedIn, setLoggedIn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(ADMIN_LOGIN_KEY) === "1"; } catch { return false; }
  });
  const [role, setRole] = useState<AdminRole | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const r = window.localStorage.getItem(ADMIN_ROLE_KEY);
      return r === "admin" || r === "staff" ? (r as AdminRole) : null;
    } catch { return null; }
  });
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [error, setError]         = useState("");
  const [emailFocus, setEmailFocus] = useState(false);
  const [pwFocus, setPwFocus]     = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const [view, setView] = useState<View>("dashboard");
  const [users, setUsers] = useState<MockUser[]>([]);
  const [adminView, setAdminView] = useState<AdminView>("renters");
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [editingPad, setEditingPad] = useState<{ userId: number; padIdx: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  type AuthAction = { kind: "verify" | "unverify" | "suspend" | "reinstate"; userId: number; userName: string };
  const [authAction, setAuthAction] = useState<AuthAction | null>(null);
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // Staff accounts (admin manages these).
  const [staffList, setStaffList] = useState<StaffAccount[]>([]);
  const [staffAuthAction, setStaffAuthAction] = useState<StaffAuthAction | null>(null);
  const [staffAuthPassword, setStaffAuthPassword] = useState("");
  const [staffAuthError, setStaffAuthError] = useState("");

  // Staff invite / email activation.
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"staff" | "admin">("staff");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteEmailFocus, setInviteEmailFocus] = useState(false);
  const [inviteStep, setInviteStep] = useState<"email" | "otp" | "password" | "success">("email");
  const [inviteOtpDigits, setInviteOtpDigits] = useState<string[]>([]);
  const [invitePassword, setInvitePassword] = useState("");
  const [invitePasswordFocus, setInvitePasswordFocus] = useState(false);
  const [invitePasswordError, setInvitePasswordError] = useState("");
  const [inviteUserId, setInviteUserId] = useState<string | null>(null);
  const [inviteAccessToken, setInviteAccessToken] = useState<string | null>(null);
  const [showActivate, setShowActivate] = useState(false);
  function resetActivation() { setInviteStep("email"); setInviteEmail(""); setInviteOtpDigits([]); setInviteError(""); setInviteEmailFocus(false); setInvitePassword(""); setInvitePasswordError(""); setInviteUserId(null); setInviteAccessToken(null); }

  // ── Invite Staff card (dashboard) ──────────────────────────────────────────
  const [inviteCardOpen, setInviteCardOpen] = useState(false);
  const [inviteCardEmail, setInviteCardEmail] = useState("");
  const [inviteCardRole, setInviteCardRole] = useState<"staff" | "admin">("staff");
  const [inviteCardLoading, setInviteCardLoading] = useState(false);
  const [inviteCardError, setInviteCardError] = useState("");
  const [inviteCardSuccess, setInviteCardSuccess] = useState<string | null>(null);
  const [inviteCardEmailFocus, setInviteCardEmailFocus] = useState(false);

  async function handleSendInvite() {
    const em = inviteCardEmail.trim().toLowerCase();
    if (!em || !em.includes("@")) { setInviteCardError("Enter a valid email address."); return; }
    setInviteCardLoading(true); setInviteCardError(""); setInviteCardSuccess(null);
    try {
      const r = await fetch("/api/staff/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, role: inviteCardRole }),
      });
      const d = await r.json();
      if (!r.ok) { setInviteCardError(d.error || "Failed to send invite."); return; }
      const sentNote = d.emailSent ? " An invitation email has been sent." : " They can now activate via the staff login page.";
      setInviteCardSuccess(`${em} added as ${inviteCardRole}.${sentNote}`);
      setInviteCardEmail("");
    } catch { setInviteCardError("Network error. Try again."); }
    finally { setInviteCardLoading(false); }
  }

  function refreshStaffList() { fetch("/api/staff/list").then(r => r.json()).then(d => { if (Array.isArray(d)) setStaffList(d); }).catch(() => {}); }
  useEffect(() => { refreshStaffList(); }, []);

  // Customer service — chat tickets + incoming email.
  const [tickets, setTickets] = useState<SupportTicket[]>(() => loadTickets());
  const [emails, setEmails] = useState<SupportEmail[]>(() => loadEmails());
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [agentReplyDraft, setAgentReplyDraft] = useState("");
  // Two-step send: every message must be confirmed before going to the customer.
  // Holds the trimmed pending text (and the ticket it's bound to so a tab/ticket
  // switch can't accidentally fire it on the wrong conversation).
  const [pendingReply, setPendingReply] = useState<{ ticketId: string; text: string } | null>(null);
  type ServiceTab = "chat" | "email";
  type PipelineFilter = "all" | "open" | "pending" | "resolved";
  type AudienceFilter = "all" | "renter" | "padRenter";
  type EmailAudienceFilter = "all" | "renter" | "padRenter" | "guest";
  type EmailCategoryFilter = "all" | EmailCategory;
  type SortDir = "recent" | "oldest";
  const [serviceTab, setServiceTab] = useState<ServiceTab>("chat");
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>("open");
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("all");
  const [emailAudienceFilter, setEmailAudienceFilter] = useState<EmailAudienceFilter>("all");
  const [emailCategoryFilter, setEmailCategoryFilter] = useState<EmailCategoryFilter>("all");
  const [emailUnreadOnly, setEmailUnreadOnly] = useState(false);
  const [sortDir, setSortDir] = useState<SortDir>("recent");
  const [emailSortDir, setEmailSortDir] = useState<SortDir>("recent");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveDraft, setResolveDraft] = useState(() => emptyResolutionDraft());
  const [resolveError, setResolveError] = useState("");
  // Password gating for resolution submit (staff) and approve (admin).
  const [resolveSubmitPassword, setResolveSubmitPassword] = useState("");
  const [approvePassword, setApprovePassword] = useState("");
  const [approveError, setApproveError] = useState("");
  const agentThreadEndRef = useRef<HTMLDivElement | null>(null);

  // Refresh tickets/emails when entering service view, and listen for cross-tab changes.
  useEffect(() => {
    if (view === "service") {
      setTickets(loadTickets());
      setEmails(loadEmails());
    }
  }, [view]);
  // Live sync across same tab, other tabs, and embedded iframes.
  useEffect(() => subscribeTickets(() => setTickets(loadTickets())), []);
  useEffect(() => subscribeEmails(() => setEmails(loadEmails())), []);
  // Auto-scroll the agent thread when messages arrive.
  useEffect(() => {
    if (view === "service" && selectedTicketId && agentThreadEndRef.current) {
      agentThreadEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [view, selectedTicketId, tickets]);

  function agentName(): string {
    const e = email.trim().toLowerCase();
    // Prefer the staff record's full display name so message attribution and
    // per-staff QA aggregates (Team Accounts) match the same identity.
    if (e) {
      const match = staffList.find(s => s.email.toLowerCase() === e);
      if (match) return `${match.firstName} ${match.lastName}`.trim();
      return e.split("@")[0];
    }
    return role === "admin" ? "Admin" : "Support rep";
  }

  // Step 1: stage the reply for confirmation. Nothing is sent yet — the agent
  // sees a preview card with Confirm / Edit before the message reaches the
  // customer. This satisfies the "every message prompts a confirm submit" rule.
  function stageAgentReply() {
    const text = agentReplyDraft.trim();
    if (!text || !selectedTicketId) return;
    setPendingReply({ ticketId: selectedTicketId, text });
  }

  // Step 2: actually deliver the staged reply, attaching a quality grade.
  // The grade is admin-only and never surfaced to staff (gated in the UI).
  function confirmSendAgentReply() {
    if (!pendingReply || !selectedTicketId) return;
    if (pendingReply.ticketId !== selectedTicketId) {
      // Defensive: ticket changed under us — discard rather than mis-deliver.
      setPendingReply(null);
      return;
    }
    const text = pendingReply.text;
    if (!text) { setPendingReply(null); return; }
    const now = Date.now();
    // Find the customer's most recent message to compute response-time score.
    const cur = tickets.find(t => t.id === selectedTicketId);
    const lastUserTs = cur
      ? [...cur.messages].reverse().find(m => m.from === "user")?.ts ?? null
      : null;
    const rating = gradeAgentMessage(text, now, lastUserTs);
    const msg = { id: makeId("m"), from: "agent" as const, text, ts: now, agentName: agentName(), rating };
    const next = mutateTickets(curList => curList.map(t => t.id === selectedTicketId
      ? { ...t, status: "open" as const, updatedAt: now, messages: [...t.messages, msg] }
      : t));
    setTickets(next);
    setAgentReplyDraft("");
    setPendingReply(null);
  }

  // "Edit" returns the staged text to the textarea so the agent can revise it.
  function cancelPendingReply() {
    if (pendingReply) setAgentReplyDraft(pendingReply.text);
    setPendingReply(null);
  }

  function markTicketOpened(id: string) {
    const next = mutateTickets(cur => cur.map(t => t.id === id && !t.openedByAgent ? { ...t, openedByAgent: true } : t));
    setTickets(next);
  }

  // Clears the resolution-flow password fields and any inline errors.
  // Called whenever the operator transitions away from a context where a
  // password may have been typed but not submitted (closing the form, tapping
  // back out of a ticket, switching tickets, switching service tabs, etc.).
  // Centralized so a typed password can never silently survive a context switch.
  function resetResolutionAuthFields() {
    setResolveSubmitPassword("");
    setApprovePassword("");
    setResolveError("");
    setApproveError("");
  }

  function openResolveForm(t: SupportTicket) {
    if (t.resolution) {
      const r = t.resolution;
      setResolveDraft({
        issue: r.issue,
        solution: r.solution,
        customerSatisfied: r.customerSatisfied,
        customerFeedback: r.customerFeedback,
        staffNotes: r.staffNotes,
      });
    } else {
      setResolveDraft(emptyResolutionDraft());
    }
    setResolveError("");
    setResolveSubmitPassword("");
    setResolveOpen(true);
  }

  function submitResolution() {
    if (!selectedTicketId || !role) return;
    const issue = resolveDraft.issue.trim();
    const solution = resolveDraft.solution.trim();
    if (!issue) { setResolveError("Please describe the issue."); return; }
    if (!solution) { setResolveError("Please describe the solution used."); return; }
    // Mock password gate: in this prototype any non-empty password of length >= 4
    // counts as "verified" for the signed-in agent (mirrors the pattern used by
    // the staff-account auth modal). A real backend would compare a hash.
    const pw = resolveSubmitPassword.trim();
    if (!pw)            { setResolveError("Enter your password to confirm."); return; }
    if (pw.length < 4)  { setResolveError("Password is too short."); return; }
    const now = Date.now();
    const resolution: SupportResolution = {
      issue,
      solution,
      customerSatisfied: resolveDraft.customerSatisfied,
      customerFeedback: resolveDraft.customerFeedback.trim(),
      staffNotes: resolveDraft.staffNotes.trim(),
      submittedBy: agentName(),
      submittedByRole: role,
      submittedAt: now,
    };
    // Admin's own resolution self-approves (they have authority).
    if (role === "admin") {
      resolution.approvedBy = agentName();
      resolution.approvedByRole = "admin";
      resolution.approvedAt = now;
    }
    const newStatus: SupportTicket["status"] = role === "admin" ? "resolved" : "pending_resolution";
    const next = mutateTickets(cur => cur.map(t => t.id === selectedTicketId
      ? { ...t, status: newStatus, updatedAt: now, resolution }
      : t));
    setTickets(next);
    setResolveOpen(false);
    setResolveError("");
    setResolveSubmitPassword("");
  }

  function approveResolution(id: string) {
    if (role !== "admin") return;
    const pw = approvePassword.trim();
    if (!pw)           { setApproveError("Enter your admin password to approve."); return; }
    if (pw.length < 4) { setApproveError("Password is too short."); return; }
    const now = Date.now();
    const approver = agentName();
    const next = mutateTickets(cur => cur.map(t => {
      if (t.id !== id || t.status !== "pending_resolution" || !t.resolution) return t;
      return {
        ...t,
        status: "resolved" as const,
        updatedAt: now,
        resolution: {
          ...t.resolution,
          approvedBy: approver,
          approvedByRole: "admin" as const,
          approvedAt: now,
        },
      };
    }));
    setTickets(next);
    setApprovePassword("");
    setApproveError("");
  }

  function rejectResolution(id: string) {
    if (role !== "admin") return;
    const now = Date.now();
    const next = mutateTickets(cur => cur.map(t => t.id === id && t.status === "pending_resolution"
      ? { ...t, status: "open", updatedAt: now, resolution: undefined }
      : t));
    setTickets(next);
    // Sending it back is a context exit — wipe any half-typed admin password.
    resetResolutionAuthFields();
  }

  function reopenTicket(id: string) {
    if (role !== "admin") return;
    const now = Date.now();
    const next = mutateTickets(cur => cur.map(t => t.id === id && t.status === "resolved"
      ? { ...t, status: "open", updatedAt: now }
      : t));
    setTickets(next);
  }

  // Forgot-password flow.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotStep, setForgotStep] = useState<"email" | "otp" | "password" | "done">("email");
  const [forgotOtp, setForgotOtp] = useState("");
  const [forgotOtpError, setForgotOtpError] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotNewPasswordError, setForgotNewPasswordError] = useState("");
  const [forgotNewPasswordFocus, setForgotNewPasswordFocus] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotAccessToken, setForgotAccessToken] = useState<string | null>(null);
  function closeForgot() { setForgotOpen(false); setForgotStep("email"); setForgotEmail(""); setForgotError(""); setForgotOtp(""); setForgotOtpError(""); setForgotNewPassword(""); setForgotNewPasswordError(""); setForgotLoading(false); setForgotAccessToken(null); }

  // Persist admin users + login flag.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(ADMIN_USERS_KEY, JSON.stringify(users)); } catch {}
  }, [users]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(STAFF_ACCOUNTS_KEY, JSON.stringify(staffList)); } catch {}
  }, [staffList]);
  useEffect(() => {
    if (view === "staff" && role !== "admin") setView("dashboard");
  }, [view, role]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(ADMIN_LOGIN_KEY, loggedIn ? "1" : "0"); } catch {}
  }, [loggedIn]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (role) window.localStorage.setItem(ADMIN_ROLE_KEY, role);
      else window.localStorage.removeItem(ADMIN_ROLE_KEY);
    } catch {}
  }, [role]);
  // Safety: if localStorage says "logged in" but role couldn't be restored
  // (e.g. stale data from before ADMIN_ROLE_KEY was defined), force re-login
  // so the role-chooser + sign-in screen appear correctly.
  useEffect(() => {
    if (loggedIn && !role) {
      setLoggedIn(false);
      try { window.localStorage.setItem(ADMIN_LOGIN_KEY, "0"); } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(t);
  }, [toast]);

  const selectedUser = users.find(u => u.id === selectedUserId) || null;

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setError("");
    setLoginLoading(true);
    try {
      const r = await fetch("/api/staff/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.error || "Invalid credentials. Contact your administrator."); return; }
      const serverRole: AdminRole = data.role === "admin" ? "admin" : "staff";
      setRole(serverRole);
      setLoggedIn(true);
    } catch { setError("Network error. Please try again."); }
    finally { setLoginLoading(false); }
  }

  function handleSignOut() {
    setLoggedIn(false);
    setRole(null);
    setEmail("");
    setPassword("");
    setView("dashboard");
    setSelectedUserId(null);
    setError("");
    setShowTransactions(false);
    setConfirmDelete(false);
    setAuthAction(null);
    setAuthPassword("");
    setAuthError("");
    setEditingPad(null);
    setStaffAuthAction(null);
    setStaffAuthPassword("");
    setStaffAuthError("");
    closeForgot();
    setSelectedTicketId(null);
    setSelectedEmailId(null);
    setAgentReplyDraft("");
    setPendingReply(null);
    setServiceTab("chat");
    setPipelineFilter("open");
    setAudienceFilter("all");
    setEmailAudienceFilter("all");
    setEmailCategoryFilter("all");
    setEmailUnreadOnly(false);
    setSortDir("recent");
    setEmailSortDir("recent");
    setResolveOpen(false);
    setResolveDraft(emptyResolutionDraft());
    setResolveError("");
    setResolveSubmitPassword("");
    setApprovePassword("");
    setApproveError("");
  }

  async function handleForgotSubmit() {
    const e = forgotEmail.trim().toLowerCase();
    if (!e) { setForgotError("Enter your email address."); return; }
    setForgotError(""); setForgotLoading(true);
    try {
      const r = await fetch("/api/staff/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e }),
      });
      const d = await r.json();
      if (!r.ok) { setForgotError(d.error || "Something went wrong. Try again."); return; }
      const { error: otpErr } = await supabase.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
      if (otpErr) { setForgotError(otpErr.message || "Failed to send code. Try again."); return; }
      setForgotStep("otp");
    } catch { setForgotError("Network error. Try again."); }
    finally { setForgotLoading(false); }
  }

  function updateUser(id: number, patch: Partial<MockUser>) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u));
  }

  function updateStaff(id: string, patch: Partial<StaffAccount>) {
    setStaffList(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    if (patch.status) fetch("/api/staff/update-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: patch.status }) }).catch(() => {});
  }

  function updatePadBox(userId: number, padIdx: number, box: PadInfo["box"]) {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId || !u.pads) return u;
      const newPads = u.pads.map((p, i) => i === padIdx ? { ...p, box } : p);
      return { ...u, pads: newPads };
    }));
  }

  function updatePad(userId: number, padIdx: number, patch: Partial<PadInfo>) {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId || !u.pads) return u;
      const newPads = u.pads.map((p, i) => i === padIdx ? { ...p, ...patch } : p);
      return { ...u, pads: newPads };
    }));
  }

  function deletePad(userId: number, padIdx: number) {
    setUsers(prev => prev.map(u => {
      if (u.id !== userId || !u.pads) return u;
      return { ...u, pads: u.pads.filter((_, i) => i !== padIdx) };
    }));
    setToast("Pad removed");
  }

  function deleteUser(userId: number) {
    setUsers(prev => prev.filter(u => u.id !== userId));
    setSelectedUserId(null);
    setView("users");
    setConfirmDelete(false);
    setToast("Account deleted");
  }

  function exportUser(u: MockUser) {
    try {
      const blob = new Blob([JSON.stringify(u, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lilypad-user-${u.id}-${u.firstName}-${u.lastName}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setToast("Export downloaded");
    } catch { setToast("Export failed"); }
  }

  const filteredUsers = users
    .filter(u => adminView === "hosts" ? (u.type === "host" || u.type === "both") : (u.type === "driver" || u.type === "both"))
    .filter(u => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (`${u.firstName} ${u.lastName}`.toLowerCase().includes(s) || u.email.toLowerCase().includes(s));
    })
    .sort((a, b) => {
      // Sort by activity desc — hosts by earnings, renters by spend; tie-break on bookings
      if (adminView === "hosts") {
        const ea = a.earningsThisMonth || 0, eb = b.earningsThisMonth || 0;
        if (eb !== ea) return eb - ea;
      } else {
        const sa = a.totalSpent || 0, sb = b.totalSpent || 0;
        if (sb !== sa) return sb - sa;
      }
      return b.bookingsThisMonth - a.bookingsThisMonth;
    });

  const renterCount = users.filter(u => u.type === "driver" || u.type === "both").length;
  const hostCount = users.filter(u => u.type === "host" || u.type === "both").length;

  return (
    <div className="page active" style={{ display: "flex", flexDirection: "column", background: "#08152F" }}>

      {/* ── Header ── */}
      <div style={{
        background: NAVY,
        padding: "48px 20px 20px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
      }}>
        <button
          onClick={() => goTo("home")}
          style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", margin: 0 }}>lily pad</p>
          <p style={{ color: "#fff", fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>Admin</p>
        </div>
      </div>

      {/* ── Content ── */}
      {showActivate ? (
        /* ── ACCOUNT ACTIVATION (pre-login, accessible from role picker or sign-in) ── */
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 20, justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => { resetActivation(); setShowActivate(false); }} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            </button>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Lily Pad</p>
              <p style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: "1px 0 0", letterSpacing: "-0.02em" }}>Activate Account</p>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.5 }}>
            Enter the email address your manager added to the team list. You'll receive a 6-digit code to activate your account.
          </p>
          <div style={{ background: "#142A52", borderRadius: 18, padding: "18px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 14px rgba(0,0,0,0.30)", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Email activation</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "2px 0 0" }}>{inviteStep === "success" ? "Account activated" : inviteStep === "password" ? "Create password" : inviteStep === "otp" ? "Enter your code" : "Activate account"}</p>
              </div>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(141,214,63,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              </div>
            </div>
            {inviteStep === "success" ? (
              <>
                <div style={{ background: "rgba(141,214,63,0.10)", border: "1px solid rgba(141,214,63,0.30)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: GREEN, margin: 0 }}>Account activated!</p>
                    <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", margin: "2px 0 0" }}>{inviteEmail} is now active as {inviteRole}. You can now sign in.</p>
                  </div>
                </div>
                <button onClick={() => { resetActivation(); setShowActivate(false); setRole(inviteRole); }} style={{ width: "100%", padding: "11px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: "pointer" }}>Sign in now →</button>
              </>
            ) : inviteStep === "password" ? (
              <>
                <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 14px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Account email</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "3px 0 0" }}>{inviteEmail}</p>
                </div>
                <input
                  type="password"
                  placeholder="Create a password (min. 8 chars)"
                  value={invitePassword}
                  onChange={e => { setInvitePassword(e.target.value); setInvitePasswordError(""); }}
                  onFocus={() => setInvitePasswordFocus(true)}
                  onBlur={() => setInvitePasswordFocus(false)}
                  style={{ width: "100%", padding: "14px 16px", borderRadius: 12, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 15, fontFamily: '"DM Sans",sans-serif', outline: "none", border: `1.5px solid ${invitePasswordError ? "#ef4444" : invitePasswordFocus ? GREEN : "rgba(255,255,255,0.15)"}`, transition: "border-color 0.15s" }}
                />
                {invitePasswordError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{invitePasswordError}</p>}
                <button
                  disabled={!invitePassword.trim() || inviteLoading}
                  onClick={async () => {
                    if (invitePassword.trim().length < 8) { setInvitePasswordError("Password must be at least 8 characters."); return; }
                    setInviteLoading(true); setInvitePasswordError("");
                    try {
                      if (!inviteAccessToken) { setInvitePasswordError("Session expired. Please go back and verify your code again."); return; }
                      const pwRes = await fetch("/api/staff/set-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: inviteAccessToken, password: invitePassword }) });
                      const pwData = await pwRes.json();
                      if (!pwRes.ok) { setInvitePasswordError(pwData.error || "Failed to set password."); return; }
                      await fetch("/api/staff/record-activation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), role: inviteRole, userId: inviteUserId }) }).catch(() => {});
                      refreshStaffList();
                      setInviteStep("success");
                    } catch { setInvitePasswordError("Network error. Try again."); }
                    finally { setInviteLoading(false); }
                  }}
                  style={{ width: "100%", padding: "11px", borderRadius: 100, border: "none", background: !invitePassword.trim() || inviteLoading ? "rgba(141,214,63,0.40)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: !invitePassword.trim() || inviteLoading ? "default" : "pointer" }}
                >
                  {inviteLoading ? "Creating account…" : "Create account"}
                </button>
              </>
            ) : inviteStep === "otp" ? (
              <>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.5 }}>Enter the code sent to <strong style={{ color: "#fff" }}>{inviteEmail}</strong></p>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Enter code"
                  value={inviteOtpDigits.join("")}
                  onChange={e => { setInviteOtpDigits(e.target.value.replace(/\s/g,"").split("")); setInviteError(""); }}
                  style={{ width: "100%", padding: "14px 16px", borderRadius: 12, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 20, fontWeight: 700, textAlign: "center", letterSpacing: "0.2em", fontFamily: '"DM Sans",sans-serif', outline: "none", border: `1.5px solid ${inviteError ? "#ef4444" : inviteOtpDigits.length > 0 ? "rgba(141,214,63,0.70)" : "rgba(255,255,255,0.15)"}`, transition: "border-color 0.15s" }}
                />
                {inviteError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{inviteError}</p>}
                <button
                  disabled={!inviteOtpDigits.join("").trim() || inviteLoading}
                  onClick={async () => {
                    const otp = inviteOtpDigits.join("");
                    setInviteLoading(true); setInviteError("");
                    try {
                      const { data: vData, error: vErr } = await supabase.auth.verifyOtp({ email: inviteEmail.trim().toLowerCase(), token: otp, type: "email" });
                      if (vErr) { setInviteError(vErr.message || "Invalid or expired code."); return; }
                      setInviteUserId(vData?.user?.id ?? null);
                      setInviteAccessToken(vData?.session?.access_token ?? null);
                      setInviteStep("password");
                    } catch { setInviteError("Network error. Try again."); }
                    finally { setInviteLoading(false); }
                  }}
                  style={{ width: "100%", padding: "11px", borderRadius: 100, border: "none", background: !inviteOtpDigits.join("").trim() || inviteLoading ? "rgba(141,214,63,0.40)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: !inviteOtpDigits.join("").trim() || inviteLoading ? "default" : "pointer" }}
                >
                  {inviteLoading ? "Verifying…" : "Activate account"}
                </button>
                <button onClick={resetActivation} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 12, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', padding: 0, textAlign: "left" }}>← Change email</button>
              </>
            ) : (
              <>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={inviteEmail}
                  onChange={e => { setInviteEmail(e.target.value); setInviteError(""); }}
                  onFocus={() => setInviteEmailFocus(true)}
                  onBlur={() => setInviteEmailFocus(false)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: 10, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", border: `1.5px solid ${inviteError ? "#ef4444" : inviteEmailFocus ? GREEN : "rgba(255,255,255,0.10)"}`, transition: "border-color 0.15s" }}
                />
                {inviteError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{inviteError}</p>}
                <button
                  disabled={inviteLoading}
                  onClick={async () => {
                    const em = inviteEmail.trim().toLowerCase();
                    if (!em || !em.includes("@")) { setInviteError("Enter a valid email address."); return; }
                    setInviteLoading(true); setInviteError("");
                    try {
                      const chk = await fetch("/api/staff/check-whitelist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em }) });
                      const chkData = await chk.json();
                      if (!chk.ok) { setInviteError(chkData.error || "Email not on the approved list."); return; }
                      setInviteRole(chkData.role);
                      const { error: otpErr } = await supabase.auth.signInWithOtp({ email: em, options: { shouldCreateUser: true } });
                      if (otpErr) { setInviteError(otpErr.message || "Failed to send code."); return; }
                      setInviteStep("otp");
                    } catch { setInviteError("Network error. Try again."); }
                    finally { setInviteLoading(false); }
                  }}
                  style={{ width: "100%", padding: "11px", borderRadius: 100, border: "none", background: inviteLoading ? "rgba(141,214,63,0.50)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: inviteLoading ? "not-allowed" : "pointer" }}
                >
                  {inviteLoading ? "Sending…" : "Send code"}
                </button>
              </>
            )}
          </div>
        </div>
      ) : !loggedIn && !role ? (
        /* ── ROLE CHOOSER ── */
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 24px" }}>
          <div style={{ width: "100%", background: "#142A52", borderRadius: 28, padding: "40px 28px 32px", boxShadow: "0 12px 40px rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <div style={{ width: 60, height: 60, borderRadius: "50%", background: `rgba(255,255,255,0.08)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em", textAlign: "center" }}>Choose your role</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => { setRole("staff"); setError(""); setEmail(""); setPassword(""); }} style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: "18px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", fontFamily: '"DM Sans",sans-serif',
                fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em",
              }}>
                Staff
              </button>
              <button onClick={() => { setRole("admin"); setError(""); setEmail(""); setPassword(""); }} style={{
                background: GREEN, border: "none", borderRadius: 16, padding: "18px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: NAVY, fontFamily: '"DM Sans",sans-serif',
                fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em",
              }}>
                Admin
              </button>
              <button onClick={() => { resetActivation(); setShowActivate(true); }} style={{
                background: "none", border: "none", padding: "8px", cursor: "pointer",
                color: GREEN, fontFamily: '"DM Sans",sans-serif', fontSize: 13, fontWeight: 700, textAlign: "center",
              }}>
                New here? Activate your account →
              </button>
            </div>
          </div>
        </div>
      ) : !loggedIn && role ? (
        /* ── ROLE-AWARE SIGN IN ── */
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "28px 24px" }}>
          <div style={{
            width: "100%", background: "#142A52", borderRadius: 28, padding: "36px 28px 32px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
              <button onClick={() => { setRole(null); setError(""); }} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Change role</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <div style={{
                width: 60, height: 60, borderRadius: "50%",
                background: role === "admin" ? GREEN : `rgba(255,255,255,0.08)`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {role === "admin"
                  ? <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
              </div>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em", textAlign: "center" }}>
                {role === "admin" ? "Admin Sign In" : "Staff Sign In"}
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.62)", letterSpacing: "0.04em" }}>Email</label>
              <input type="email" placeholder={role === "admin" ? "admin@lilypad.com" : "you@lilypad.com"} value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                onFocus={() => setEmailFocus(true)} onBlur={() => setEmailFocus(false)}
                style={{ ...inputStyle, borderColor: emailFocus ? GREEN : "rgba(255,255,255,0.10)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.62)", letterSpacing: "0.04em" }}>Password</label>
              <input type="password" placeholder="••••••••" value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onFocus={() => setPwFocus(true)} onBlur={() => setPwFocus(false)}
                onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
                style={{ ...inputStyle, borderColor: pwFocus ? GREEN : "rgba(255,255,255,0.10)" }} />
            </div>
            {error && (
              <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", margin: 0, fontFamily: '"DM Sans", sans-serif' }}>{error}</p>
            )}
            <button onClick={handleLogin} disabled={loginLoading} style={{ background: loginLoading ? "rgba(141,214,63,0.55)" : GREEN, color: NAVY, border: "none", borderRadius: 100, padding: "15px", fontWeight: 800, fontSize: 15, fontFamily: '"DM Sans", sans-serif', cursor: loginLoading ? "not-allowed" : "pointer", marginTop: 4, letterSpacing: "0.01em" }}>
              {loginLoading ? "Signing in…" : `Sign in as ${role === "admin" ? "Admin" : "Staff"}`}
            </button>
            <button
              type="button"
              onClick={() => { setForgotEmail(email); setForgotError(""); setForgotStep("email"); setForgotOpen(true); }}
              style={{ background: "none", border: "none", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.55)", margin: 0, cursor: "pointer", fontFamily: '"DM Sans", sans-serif', textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Forgot password?
            </button>
          </div>
        </div>
      ) : view === "dashboard" ? (
        /* ── DASHBOARD ── */
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: role === "staff" ? "rgba(255,255,255,0.55)" : GREEN, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>{role === "staff" ? "Staff" : "Admin"}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.02em" }}>{(email.split("@")[0]) || (role === "staff" ? "Staff" : "Admin")}</p>
            </div>
            <button onClick={handleSignOut} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 100, padding: "8px 16px", fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}>Sign Out</button>
          </div>

          {/* Financial growth chart — admin only */}
          {role === "admin" && <GrowthChart />}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <StatCard
              label="Total Pads"
              value="142"
              breakdown={[
                { label: "Active", value: "118", dot: GREEN },
                { label: "Currently booked", value: "37", dot: NAVY },
              ]}
            />
            <StatCard
              label="Drivers"
              value="218"
              sub="↑ 12 this week"
            />
          </div>

          {/* User management entry */}
          <div onClick={() => setView("users")} style={{
            background: "#142A52", borderRadius: 18, padding: "16px 18px",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 14px rgba(0,0,0,0.30)",
            display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
            border: `1px solid rgba(141,214,63,0.18)`,
          }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: `rgba(141,214,63,0.14)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: 0 }}>User Management</p>
              <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>{users.length} accounts · Master controls</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
          </div>

          {/* ── Invite Staff — admin only ── */}
          {role === "admin" && (
            <div style={{ background: "#142A52", borderRadius: 18, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 14px rgba(0,0,0,0.30)", border: `1px solid rgba(141,214,63,0.18)`, overflow: "hidden" }}>
              {/* Header row — always visible, click to expand */}
              <div
                onClick={() => { setInviteCardOpen(o => !o); setInviteCardError(""); setInviteCardSuccess(null); }}
                style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(141,214,63,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: 0 }}>Invite Staff</p>
                  <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>Add a team member · sends invitation email</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="2.5" style={{ transform: inviteCardOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}><path d="m9 18 6-6-6-6"/></svg>
              </div>

              {/* Expandable form */}
              {inviteCardOpen && (
                <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                  {inviteCardSuccess ? (
                    <>
                      <div style={{ background: "rgba(141,214,63,0.10)", border: "1px solid rgba(141,214,63,0.30)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M20 6L9 17l-5-5"/></svg>
                        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", margin: 0, lineHeight: 1.5 }}>{inviteCardSuccess}</p>
                      </div>
                      <button
                        onClick={() => { setInviteCardSuccess(null); setInviteCardEmail(""); }}
                        style={{ width: "100%", padding: "11px", borderRadius: 100, border: "1.5px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.70)", fontWeight: 700, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: "pointer" }}
                      >
                        Invite another
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Role toggle */}
                      <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 4 }}>
                        {(["staff", "admin"] as const).map(r => (
                          <button
                            key={r}
                            onClick={() => setInviteCardRole(r)}
                            style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: inviteCardRole === r ? (r === "admin" ? GREEN : "rgba(255,255,255,0.12)") : "transparent", color: inviteCardRole === r ? (r === "admin" ? NAVY : "#fff") : "rgba(255,255,255,0.45)", fontWeight: 700, fontSize: 12, fontFamily: '"DM Sans",sans-serif', cursor: "pointer", transition: "all 0.15s", textTransform: "capitalize" }}
                          >
                            {r}
                          </button>
                        ))}
                      </div>
                      {/* Email input */}
                      <input
                        type="email"
                        placeholder="team@example.com"
                        value={inviteCardEmail}
                        onChange={e => { setInviteCardEmail(e.target.value); setInviteCardError(""); }}
                        onFocus={() => setInviteCardEmailFocus(true)}
                        onBlur={() => setInviteCardEmailFocus(false)}
                        onKeyDown={e => { if (e.key === "Enter") handleSendInvite(); }}
                        style={{ width: "100%", padding: "12px 14px", borderRadius: 12, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif', outline: "none", border: `1.5px solid ${inviteCardError ? "#ef4444" : inviteCardEmailFocus ? GREEN : "rgba(255,255,255,0.12)"}`, transition: "border-color 0.15s" }}
                      />
                      {inviteCardError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{inviteCardError}</p>}
                      <button
                        disabled={inviteCardLoading || !inviteCardEmail.trim()}
                        onClick={handleSendInvite}
                        style={{ width: "100%", padding: "12px", borderRadius: 100, border: "none", background: inviteCardLoading || !inviteCardEmail.trim() ? "rgba(141,214,63,0.40)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 14, fontFamily: '"DM Sans",sans-serif', cursor: inviteCardLoading || !inviteCardEmail.trim() ? "default" : "pointer" }}
                      >
                        {inviteCardLoading ? "Sending invite…" : "Send invite"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Revenue & Payouts — admin only */}
          {role === "admin" && (
            <div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "0 0 10px" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Revenue & Payouts</p>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.52)", fontWeight: 500, margin: 0 }}>This month</p>
              </div>

              <div style={{ background: "#142A52", borderRadius: 18, padding: "18px 20px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 14px rgba(0,0,0,0.30)", display: "flex", flexDirection: "column" }}>
                <div style={{ background: "#0A1A36", borderRadius: 14, padding: "16px 18px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid rgba(141,214,63,0.18)" }}>
                  <div>
                    <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Gross Revenue</p>
                    <p style={{ fontSize: 28, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.03em" }}>$4,218.50</p>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Bookings</p>
                    <p style={{ fontSize: 16, fontWeight: 700, color: GREEN, margin: "2px 0 0" }}>218</p>
                  </div>
                </div>
                <RevenueRow label="Host payouts" value="$3,374.80" hint="80% to lily pad hosts" />
                <RevenueRow label="Stripe processing fees" value="−$143.43" hint="2.9% + $0.30 per booking" />
                <RevenueRow label="Refunds & adjustments" value="−$48.20" hint="3 refunds this month" />
                <RevenueRow label="Platform take-home" value="$652.07" hint="Net after payouts & fees" accent />
                <div style={{ marginTop: 12, background: "rgba(141,214,63,0.08)", border: "1px solid rgba(141,214,63,0.25)", borderRadius: 12, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#fff", margin: 0, letterSpacing: "0.04em" }}>Pending payouts</p>
                    <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.62)", margin: "1px 0 0" }}>Releases Friday</p>
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: 0 }}>$412.30</p>
                </div>
              </div>
            </div>
          )}

        </div>
      ) : view === "service" ? (
        /* ── CUSTOMER SERVICE — Live Chat + Email ── */
        (() => {
          // ── chat tickets ──
          const sortedAll = [...tickets].sort((a, b) => sortDir === "recent" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt);
          const totalChats = tickets.length;
          const openCount     = tickets.filter(t => { const p = ticketPipeline(t); return p === "new" || p === "working"; }).length;
          const pendingCount  = tickets.filter(t => ticketPipeline(t) === "pending").length;
          const resolvedCount = tickets.filter(t => ticketPipeline(t) === "resolved").length;
          const filtered = sortedAll.filter(t => {
            const p = ticketPipeline(t);
            if (pipelineFilter === "open"     && !(p === "new" || p === "working")) return false;
            if (pipelineFilter === "pending"  && p !== "pending")  return false;
            if (pipelineFilter === "resolved" && p !== "resolved") return false;
            if (audienceFilter !== "all" && t.accountType !== audienceFilter) return false;
            return true;
          });
          const selected = selectedTicketId ? sortedAll.find(t => t.id === selectedTicketId) || null : null;

          const audienceLabel  = (a: SupportTicket["accountType"]) => a === "padRenter" ? "Lister" : "Renter";
          const audiencePillBg = (a: SupportTicket["accountType"]) => a === "padRenter" ? "rgba(141,214,63,0.16)" : "rgba(120,170,255,0.16)";
          const audiencePillFg = (a: SupportTicket["accountType"]) => a === "padRenter" ? GREEN : "#9DBEFF";

          const pipelinePillFg = (p: TicketPipeline) =>
            p === "new" ? GREEN
            : p === "working" ? "#FACC15"
            : p === "pending" ? "#F59E0B"
            : "#9DBEFF";
          const pipelinePillBg = (p: TicketPipeline) =>
            p === "new" ? "rgba(141,214,63,0.18)"
            : p === "working" ? "rgba(250,204,21,0.18)"
            : p === "pending" ? "rgba(245,158,11,0.20)"
            : "rgba(120,170,255,0.18)";
          const pipelineText   = (p: TicketPipeline) =>
            p === "new" ? "New"
            : p === "working" ? "Working on"
            : p === "pending" ? "Pending review"
            : "Resolved";

          // ── email ──
          const sortedEmails = [...emails].sort((a, b) => emailSortDir === "recent" ? b.receivedAt - a.receivedAt : a.receivedAt - b.receivedAt);
          const totalEmails = emails.length;
          const unreadEmails = emails.filter(e => !e.read).length;
          const filteredEmails = sortedEmails.filter(e => {
            if (emailAudienceFilter !== "all" && e.accountType !== emailAudienceFilter) return false;
            if (emailCategoryFilter !== "all" && e.category !== emailCategoryFilter) return false;
            if (emailUnreadOnly && e.read) return false;
            return true;
          });
          const selectedEmail = selectedEmailId ? emails.find(e => e.id === selectedEmailId) || null : null;
          const emailAudPillFg = (a: EmailAccountType) => a === "padRenter" ? GREEN : a === "renter" ? "#9DBEFF" : "rgba(255,255,255,0.65)";
          const emailAudPillBg = (a: EmailAccountType) => a === "padRenter" ? "rgba(141,214,63,0.16)" : a === "renter" ? "rgba(120,170,255,0.16)" : "rgba(255,255,255,0.08)";

          // ── EMAIL DETAIL ──
          if (serviceTab === "email" && selectedEmail) {
            const e = selectedEmail;
            return (
              <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => setSelectedEmailId(null)} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Email · Read-only</p>
                    <p style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject}</p>
                  </div>
                  <button onClick={() => markEmailRead(e.id, !e.read)} style={{ background: e.read ? "rgba(255,255,255,0.08)" : "rgba(141,214,63,0.18)", color: e.read ? "rgba(255,255,255,0.65)" : GREEN, border: `1px solid ${e.read ? "rgba(255,255,255,0.10)" : "rgba(141,214,63,0.30)"}`, borderRadius: 100, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}>{e.read ? "Mark unread" : "Mark read"}</button>
                </div>
                <div style={{ background: "#142A52", borderRadius: 14, padding: "12px 14px", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
                  <div><span style={{ color: "rgba(255,255,255,0.45)" }}>From </span><span style={{ color: "#fff", fontWeight: 700 }}>{e.fromName}</span></div>
                  <div><span style={{ color: "rgba(255,255,255,0.45)" }}>Email </span><span style={{ color: "#fff", fontWeight: 700 }}>{e.fromAddress}</span></div>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, color: emailAudPillFg(e.accountType), background: emailAudPillBg(e.accountType) }}>{emailAudienceLabel(e.accountType)}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, color: "rgba(255,255,255,0.78)", background: "rgba(255,255,255,0.08)" }}>{emailCategoryLabel(e.category)}</span>
                  <div><span style={{ color: "rgba(255,255,255,0.45)" }}>Received </span><span style={{ color: "#fff", fontWeight: 700 }}>{formatEmailTime(e.receivedAt)}</span></div>
                </div>
                <div style={{ background: "#142A52", borderRadius: 18, padding: "16px 18px", color: "#fff", fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {e.body}
                </div>
                <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)", margin: 0, fontStyle: "italic", padding: "0 4px" }}>This view is read-only. Replies happen outside the app.</p>
              </div>
            );
          }

          if (serviceTab === "chat" && selected) {
            const last = selected.messages[selected.messages.length - 1];
            const customerWaiting = last && last.from === "user" && selected.status === "open";
            return (
              <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => { setSelectedTicketId(null); setAgentReplyDraft(""); setPendingReply(null); setResolveOpen(false); resetResolutionAuthFields(); }} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>
                      Live chat · {pipelineText(ticketPipeline(selected))}
                    </p>
                    <p style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.subject}</p>
                  </div>
                  {selected.status === "open" && (
                    <button
                      onClick={() => openResolveForm(selected)}
                      style={{ background: "rgba(141,214,63,0.18)", color: GREEN, border: "1px solid rgba(141,214,63,0.30)", borderRadius: 100, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}
                    >
                      {role === "admin" ? "Mark resolved" : "Submit resolution"}
                    </button>
                  )}
                  {selected.status === "resolved" && role === "admin" && (
                    <button
                      onClick={() => reopenTicket(selected.id)}
                      style={{ background: "rgba(120,170,255,0.16)", color: "#9DBEFF", border: "1px solid rgba(120,170,255,0.30)", borderRadius: 100, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}
                    >
                      Reopen
                    </button>
                  )}
                </div>

                <div style={{ background: "#142A52", borderRadius: 14, padding: "12px 14px", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
                  <div><span style={{ color: "rgba(255,255,255,0.45)" }}>From </span><span style={{ color: "#fff", fontWeight: 700 }}>{selected.userName}</span></div>
                  {selected.userEmail && <div><span style={{ color: "rgba(255,255,255,0.45)" }}>Email </span><span style={{ color: "#fff", fontWeight: 700 }}>{selected.userEmail}</span></div>}
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, color: audiencePillFg(selected.accountType), background: audiencePillBg(selected.accountType) }}>{audienceLabel(selected.accountType)}</span>
                  <div><span style={{ color: "rgba(255,255,255,0.45)" }}>Opened </span><span style={{ color: "#fff", fontWeight: 700 }}>{formatSupportTime(selected.createdAt)}</span></div>
                </div>

                {selected.status === "pending_resolution" && selected.resolution && (
                  <div style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.34)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, color: "#F59E0B", background: "rgba(245,158,11,0.20)" }}>Pending review</span>
                      <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.70)" }}>
                        Worked by <span style={{ color: "#fff", fontWeight: 700 }}>{selected.resolution.submittedBy}</span>
                        {" · "}{formatSupportTime(selected.resolution.submittedAt)}
                      </span>
                    </div>
                    <ResolutionReadout r={selected.resolution} />
                    {role === "admin" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                        <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.65)", letterSpacing: 0.5, textTransform: "uppercase", margin: 0 }}>
                          Confirm with your admin password
                        </p>
                        <input
                          type="password"
                          value={approvePassword}
                          onChange={e => { setApprovePassword(e.target.value); if (approveError) setApproveError(""); }}
                          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); approveResolution(selected.id); } }}
                          placeholder="Admin password"
                          autoComplete="current-password"
                          style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: `1.5px solid ${approveError ? "#ef4444" : "rgba(255,255,255,0.10)"}`, color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", boxSizing: "border-box" }}
                        />
                        {approveError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{approveError}</p>}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => rejectResolution(selected.id)} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Send back</button>
                          <button onClick={() => approveResolution(selected.id)} style={{ flex: 1, padding: "10px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Approve · Resolve</button>
                        </div>
                      </div>
                    ) : (
                      <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", margin: 0, fontStyle: "italic" }}>Waiting for an admin to review and approve.</p>
                    )}
                  </div>
                )}

                {selected.status === "resolved" && selected.resolution && (
                  <div style={{ background: "rgba(120,170,255,0.08)", border: "1px solid rgba(120,170,255,0.25)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, color: "#9DBEFF", background: "rgba(120,170,255,0.18)" }}>Resolved</span>
                      <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.70)" }}>
                        Worked by <span style={{ color: "#fff", fontWeight: 700 }}>{selected.resolution.submittedBy}</span>
                        {selected.resolution.approvedBy && (
                          <>
                            {" · Approved by "}
                            <span style={{ color: "#fff", fontWeight: 700 }}>{selected.resolution.approvedBy}</span>
                          </>
                        )}
                        {selected.resolution.approvedAt && (
                          <>
                            {" · "}{formatSupportTime(selected.resolution.approvedAt)}
                          </>
                        )}
                      </span>
                    </div>
                    <ResolutionReadout r={selected.resolution} />
                  </div>
                )}

                {/* Admin-only QA scorecard for the conversation. Hidden from staff. */}
                {role === "admin" && (() => {
                  const convScore = conversationRating(selected.messages);
                  if (!convScore) return null;
                  return (
                    <div style={{ background: "rgba(141,214,63,0.06)", border: "1px solid rgba(141,214,63,0.22)", borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <p style={{ fontSize: 10.5, fontWeight: 800, color: GREEN, margin: 0, letterSpacing: "0.10em", textTransform: "uppercase" }}>QA score · Admin only</p>
                        <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)" }}>{convScore.count} reply{convScore.count === 1 ? "" : "s"} graded</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{convScore.overall.toFixed(1)}</span>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>/ 5 overall</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                        {([
                          { label: "Professional", value: convScore.professionalism },
                          { label: "Spelling", value: convScore.spelling },
                          { label: "Grammar", value: convScore.grammar },
                          { label: "Response", value: convScore.responseTime },
                        ]).map(s => (
                          <div key={s.label} style={{ background: "rgba(14,31,64,0.35)", borderRadius: 10, padding: "8px 6px", textAlign: "center" }}>
                            <p style={{ fontSize: 16, fontWeight: 800, color: scoreColor(s.value), margin: 0, letterSpacing: "-0.02em" }}>{s.value.toFixed(1)}</p>
                            <p style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: "0.06em", textTransform: "uppercase", margin: "2px 0 0" }}>{s.label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div style={{ background: "#142A52", borderRadius: 18, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10, maxHeight: 360, overflowY: "auto" }}>
                  {selected.messages.map(m => {
                    const isAgent = m.from === "agent";
                    const isBot = m.from === "bot";
                    return (
                      <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isAgent ? "flex-end" : "flex-start" }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: isAgent ? GREEN : isBot ? "rgba(141,214,63,0.75)" : "#9DBEFF", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 3, padding: "0 4px" }}>
                          {isAgent ? `${m.agentName || "You"} · Replying` : isBot ? "Lily · Support bot" : selected.userName}
                        </div>
                        <div style={{
                          maxWidth: "82%",
                          padding: "10px 13px",
                          borderRadius: 14,
                          background: isAgent ? GREEN : isBot ? "rgba(141,214,63,0.14)" : "rgba(255,255,255,0.08)",
                          color: isAgent ? NAVY : "#fff",
                          fontSize: 13,
                          lineHeight: 1.4,
                          fontWeight: isAgent ? 600 : 500,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}>{m.text}</div>
                        <div style={{ fontSize: 9.5, color: "rgba(255,255,255,0.32)", marginTop: 3, padding: "0 4px", display: "flex", alignItems: "center", gap: 6 }}>
                          <span>{formatSupportTime(m.ts)}</span>
                          {/* Admin-only per-message rating pill — never shown to staff. */}
                          {role === "admin" && isAgent && m.rating && (
                            <RatingPill rating={m.rating} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={agentThreadEndRef} />
                </div>

                {resolveOpen && (
                  <div style={{ background: "#142A52", border: "1px solid rgba(141,214,63,0.28)", borderRadius: 18, padding: "16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <p style={{ fontSize: 13.5, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: -0.2 }}>{role === "admin" ? "Resolve ticket" : "Submit resolution for review"}</p>
                      <button onClick={() => { setResolveOpen(false); resetResolutionAuthFields(); }} style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.55)", fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
                    </div>

                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, textTransform: "uppercase" }}>Issue</span>
                      <textarea value={resolveDraft.issue} onChange={e => { setResolveDraft(d => ({ ...d, issue: e.target.value })); if (resolveError) setResolveError(""); }} placeholder="What was the customer's problem?" rows={2} style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${resolveError && !resolveDraft.issue.trim() ? "#ef4444" : "rgba(255,255,255,0.10)"}`, borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", resize: "vertical" }} />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, textTransform: "uppercase" }}>Solution</span>
                      <textarea value={resolveDraft.solution} onChange={e => { setResolveDraft(d => ({ ...d, solution: e.target.value })); if (resolveError) setResolveError(""); }} placeholder="What did you do to resolve it?" rows={3} style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${resolveError && !resolveDraft.solution.trim() ? "#ef4444" : "rgba(255,255,255,0.10)"}`, borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", resize: "vertical" }} />
                    </label>

                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, textTransform: "uppercase" }}>Customer satisfied?</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {(["yes", "no", "unknown"] as const).map(v => (
                          <button key={v} onClick={() => setResolveDraft(d => ({ ...d, customerSatisfied: v }))} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid " + (resolveDraft.customerSatisfied === v ? "rgba(141,214,63,0.45)" : "rgba(255,255,255,0.10)"), background: resolveDraft.customerSatisfied === v ? "rgba(141,214,63,0.18)" : "transparent", color: resolveDraft.customerSatisfied === v ? GREEN : "rgba(255,255,255,0.65)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', textTransform: "capitalize" }}>{v}</button>
                        ))}
                      </div>
                    </div>

                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, textTransform: "uppercase" }}>Customer feedback (optional)</span>
                      <textarea value={resolveDraft.customerFeedback} onChange={e => setResolveDraft(d => ({ ...d, customerFeedback: e.target.value }))} placeholder="Any words from the customer?" rows={2} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", resize: "vertical" }} />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, textTransform: "uppercase" }}>Internal notes (optional)</span>
                      <textarea value={resolveDraft.staffNotes} onChange={e => setResolveDraft(d => ({ ...d, staffNotes: e.target.value }))} placeholder="Notes for the team" rows={2} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", resize: "vertical" }} />
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 2 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, textTransform: "uppercase" }}>
                        Confirm with your {role === "admin" ? "admin" : "staff"} password
                      </span>
                      <input
                        type="password"
                        value={resolveSubmitPassword}
                        onChange={e => { setResolveSubmitPassword(e.target.value); if (resolveError) setResolveError(""); }}
                        placeholder={role === "admin" ? "Admin password" : "Staff password"}
                        autoComplete="current-password"
                        style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${resolveError && !resolveSubmitPassword.trim() ? "#ef4444" : "rgba(255,255,255,0.10)"}`, borderRadius: 10, padding: "10px 12px", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", boxSizing: "border-box" }}
                      />
                      <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.4 }}>
                        {role === "admin"
                          ? "You have authority — this will resolve the ticket immediately."
                          : "Submitting sends this to an admin for review and approval."}
                      </span>
                    </label>

                    {resolveError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{resolveError}</p>}

                    <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                      <button onClick={() => { setResolveOpen(false); resetResolutionAuthFields(); }} style={{ flex: 1, padding: "11px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Cancel</button>
                      <button onClick={submitResolution} style={{ flex: 1, padding: "11px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>{role === "admin" ? "Resolve ticket" : "Submit for review"}</button>
                    </div>
                  </div>
                )}

                {selected.status === "open" && customerWaiting && !resolveOpen && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: GREEN, letterSpacing: 0.4, textTransform: "uppercase", padding: "0 2px" }}>Customer is waiting on a reply</div>
                )}

                {!resolveOpen && pendingReply && pendingReply.ticketId === selected.id && (
                  <div style={{ background: "#142A52", border: `1px solid ${GREEN}`, borderRadius: 16, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <p style={{ fontSize: 11, fontWeight: 800, color: GREEN, margin: 0, letterSpacing: "0.10em", textTransform: "uppercase" }}>Confirm before sending</p>
                      <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)" }}>To {selected.userName}</span>
                    </div>
                    <div style={{ background: "rgba(141,214,63,0.08)", border: "1px solid rgba(141,214,63,0.18)", borderRadius: 12, padding: "10px 12px", color: "#fff", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {pendingReply.text}
                    </div>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.4 }}>
                      Once sent, this message goes straight to the customer.
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={cancelPendingReply}
                        style={{ flex: 1, padding: "11px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}
                      >Edit</button>
                      <button
                        onClick={confirmSendAgentReply}
                        style={{ flex: 1, padding: "11px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}
                      >Confirm &amp; send</button>
                    </div>
                  </div>
                )}

                {!resolveOpen && !(pendingReply && pendingReply.ticketId === selected.id) && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <textarea
                      value={agentReplyDraft}
                      onChange={e => setAgentReplyDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); stageAgentReply(); } }}
                      placeholder={`Reply as ${agentName()}…  (⌘/Ctrl + Enter to review)`}
                      rows={3}
                      style={{ flex: 1, background: "#142A52", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: "11px 14px", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", resize: "vertical", minHeight: 64 }}
                    />
                    <button
                      onClick={stageAgentReply}
                      disabled={!agentReplyDraft.trim()}
                      style={{ background: agentReplyDraft.trim() ? GREEN : "rgba(141,214,63,0.30)", color: NAVY, border: "none", borderRadius: 14, padding: "0 18px", fontSize: 13, fontWeight: 800, cursor: agentReplyDraft.trim() ? "pointer" : "default", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}
                    >
                      Review
                    </button>
                  </div>
                )}
              </div>
            );
          }

          return (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Customer Service</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.02em" }}>Customer interaction</p>
              </div>

              {/* ── Sub-tab toggle: Live chat / Email ── */}
              <div style={{ display: "flex", gap: 6, background: "#142A52", borderRadius: 100, padding: 4 }}>
                {([
                  { key: "chat" as ServiceTab, label: "Live chat", count: totalChats, accent: openCount + (role === "admin" ? pendingCount : 0) },
                  { key: "email" as ServiceTab, label: "Email", count: totalEmails, accent: unreadEmails },
                ]).map(t => {
                  const active = serviceTab === t.key;
                  return (
                    <button key={t.key} onClick={() => { setServiceTab(t.key); setSelectedTicketId(null); setSelectedEmailId(null); setResolveOpen(false); setPendingReply(null); resetResolutionAuthFields(); }} style={{ flex: 1, padding: "9px 10px", borderRadius: 100, border: "none", background: active ? GREEN : "transparent", color: active ? NAVY : "rgba(255,255,255,0.65)", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <span>{t.label}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 7px", borderRadius: 100, background: active ? "rgba(14,31,64,0.16)" : "rgba(255,255,255,0.10)", color: active ? NAVY : "rgba(255,255,255,0.78)" }}>{t.count}</span>
                      {t.accent > 0 && !active && (
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN, boxShadow: "0 0 0 3px rgba(141,214,63,0.25)" }} />
                      )}
                    </button>
                  );
                })}
              </div>

              {serviceTab === "chat" ? (
                <>
                  {/* ── Pipeline list (Total / Open / Pending approval / Resolved) ── */}
                  <div style={{ background: "#142A52", borderRadius: 16, padding: "4px 14px" }}>
                    {([
                      { key: "all" as PipelineFilter,      label: "Total",            count: totalChats,    dot: "rgba(255,255,255,0.55)", num: "#fff" },
                      { key: "open" as PipelineFilter,     label: "Open",             count: openCount,     dot: GREEN,                    num: GREEN },
                      { key: "pending" as PipelineFilter,  label: "Pending approval", count: pendingCount,  dot: "#F59E0B",                num: "#F59E0B", showAdminPing: true },
                      { key: "resolved" as PipelineFilter, label: "Resolved",         count: resolvedCount, dot: "rgba(157,190,255,0.55)", num: "#9DBEFF" },
                    ]).map((row, i, arr) => {
                      const active = pipelineFilter === row.key;
                      return (
                        <button
                          key={row.key}
                          onClick={() => setPipelineFilter(row.key)}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", gap: 10,
                            padding: "14px 4px",
                            background: "transparent", border: "none", cursor: "pointer",
                            borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
                            color: "inherit", fontFamily: '"DM Sans",sans-serif',
                            position: "relative",
                          }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: row.dot, flexShrink: 0 }} />
                          <span style={{ flex: 1, textAlign: "left", fontSize: 14, fontWeight: 700, color: active ? "#fff" : "rgba(255,255,255,0.78)" }}>
                            {row.label}
                          </span>
                          {row.showAdminPing && role === "admin" && row.count > 0 && (
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B", boxShadow: "0 0 0 2px #142A52" }} />
                          )}
                          <span style={{ fontSize: 16, fontWeight: 800, color: row.num, letterSpacing: "-0.01em" }}>
                            {row.count}
                          </span>
                          {active && (
                            <span style={{ position: "absolute", left: -14, top: 8, bottom: 8, width: 3, borderRadius: 2, background: GREEN }} />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Audience + sort ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <div style={{ flex: 1, display: "flex", gap: 4, background: "#142A52", borderRadius: 100, padding: 4 }}>
                        {([
                          { key: "all" as AudienceFilter, label: "All users" },
                          { key: "renter" as AudienceFilter, label: "Renters" },
                          { key: "padRenter" as AudienceFilter, label: "Listers" },
                        ]).map(f => (
                          <button key={f.key} onClick={() => setAudienceFilter(f.key)} style={{ flex: 1, padding: "7px 8px", borderRadius: 100, border: "none", background: audienceFilter === f.key ? "rgba(255,255,255,0.10)" : "transparent", color: audienceFilter === f.key ? "#fff" : "rgba(255,255,255,0.55)", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>{f.label}</button>
                        ))}
                      </div>
                      <button onClick={() => setSortDir(d => d === "recent" ? "oldest" : "recent")} style={{ background: "#142A52", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 100, padding: "7px 14px", color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          {sortDir === "recent" ? <path d="M12 5v14m-6-6 6 6 6-6"/> : <path d="M12 19V5m-6 6 6-6 6 6"/>}
                        </svg>
                        {sortDir === "recent" ? "Newest" : "Oldest"}
                      </button>
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <div style={{ background: "#142A52", borderRadius: 18, padding: "32px 22px", textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: 13 }}>
                      {totalChats === 0
                        ? "No support conversations yet. When a customer chats, it'll show up here."
                        : "No conversations match these filters."}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {filtered.map(t => {
                        const p = ticketPipeline(t);
                        const last = t.messages[t.messages.length - 1];
                        const needsReply = last && last.from === "user" && t.status === "open";
                        const unreadByAgent = !t.openedByAgent;
                        return (
                          <div key={t.id} onClick={() => { setSelectedTicketId(t.id); setAgentReplyDraft(""); setPendingReply(null); setResolveOpen(false); resetResolutionAuthFields(); markTicketOpened(t.id); }} style={{ background: "#142A52", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", border: needsReply ? `1px solid rgba(141,214,63,0.32)` : "1px solid transparent", position: "relative" }}>
                            {unreadByAgent && (
                              <span style={{ position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: "50%", background: GREEN, boxShadow: "0 0 0 3px rgba(141,214,63,0.20)" }} />
                            )}
                            <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(141,214,63,0.18)", color: GREEN, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</span>
                                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: pipelinePillFg(p), background: pipelinePillBg(p) }}>{pipelineText(p)}</span>
                                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: audiencePillFg(t.accountType), background: audiencePillBg(t.accountType) }}>{audienceLabel(t.accountType)}</span>
                                {needsReply && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: NAVY, background: GREEN }}>Reply</span>}
                                {t.status === "pending_resolution" && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: "#FACC15", background: "rgba(250,204,21,0.18)", border: "1px solid rgba(250,204,21,0.30)" }}>Awaiting admin</span>}
                              </div>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", marginTop: 2 }}>
                                {t.userName}{t.userEmail ? ` · ${t.userEmail}` : ""}
                              </div>
                              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {ticketLastPreview(t)}
                              </div>
                            </div>
                            <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.40)", flexShrink: 0 }}>{formatSupportTime(t.updatedAt)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* ── Email overall summary ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => setEmailUnreadOnly(false)} style={{ background: "#142A52", borderRadius: 14, padding: 12, textAlign: "center", border: !emailUnreadOnly ? "1px solid rgba(255,255,255,0.18)" : "1px solid transparent", cursor: "pointer", color: "inherit", fontFamily: '"DM Sans",sans-serif' }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>{totalEmails}</p>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Total inbox</p>
                    </button>
                    <button onClick={() => setEmailUnreadOnly(true)} style={{ background: "#142A52", borderRadius: 14, padding: 12, textAlign: "center", border: emailUnreadOnly ? `1px solid ${GREEN}` : "1px solid transparent", cursor: "pointer", color: "inherit", fontFamily: '"DM Sans",sans-serif' }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color: GREEN, margin: 0, letterSpacing: "-0.02em" }}>{unreadEmails}</p>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Unread</p>
                    </button>
                  </div>

                  {/* ── Email filters ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 4, background: "#142A52", borderRadius: 100, padding: 4 }}>
                      {([
                        { key: "all" as EmailAudienceFilter, label: "All accounts" },
                        { key: "renter" as EmailAudienceFilter, label: "Renters" },
                        { key: "padRenter" as EmailAudienceFilter, label: "Listers" },
                        { key: "guest" as EmailAudienceFilter, label: "Guests" },
                      ]).map(f => (
                        <button key={f.key} onClick={() => setEmailAudienceFilter(f.key)} style={{ flex: 1, padding: "7px 6px", borderRadius: 100, border: "none", background: emailAudienceFilter === f.key ? "rgba(255,255,255,0.10)" : "transparent", color: emailAudienceFilter === f.key ? "#fff" : "rgba(255,255,255,0.55)", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>{f.label}</button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <div style={{ flex: 1, display: "flex", gap: 4, background: "#142A52", borderRadius: 100, padding: 4, overflowX: "auto" }}>
                        {(["all", "billing", "account", "support", "feedback", "other"] as EmailCategoryFilter[]).map(c => (
                          <button key={c} onClick={() => setEmailCategoryFilter(c)} style={{ padding: "7px 12px", borderRadius: 100, border: "none", background: emailCategoryFilter === c ? GREEN : "transparent", color: emailCategoryFilter === c ? NAVY : "rgba(255,255,255,0.62)", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', whiteSpace: "nowrap" }}>{c === "all" ? "All topics" : emailCategoryLabel(c as EmailCategory)}</button>
                        ))}
                      </div>
                      <button onClick={() => setEmailSortDir(d => d === "recent" ? "oldest" : "recent")} style={{ background: "#142A52", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 100, padding: "7px 14px", color: "rgba(255,255,255,0.65)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          {emailSortDir === "recent" ? <path d="M12 5v14m-6-6 6 6 6-6"/> : <path d="M12 19V5m-6 6 6-6 6 6"/>}
                        </svg>
                        {emailSortDir === "recent" ? "Newest" : "Oldest"}
                      </button>
                    </div>
                  </div>

                  {filteredEmails.length === 0 ? (
                    <div style={{ background: "#142A52", borderRadius: 18, padding: "32px 22px", textAlign: "center", color: "rgba(255,255,255,0.45)", fontSize: 13 }}>
                      {totalEmails === 0 ? "Inbox is empty." : "No emails match these filters."}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {filteredEmails.map(e => (
                        <div key={e.id} onClick={() => { setSelectedEmailId(e.id); markEmailRead(e.id, true); }} style={{ background: "#142A52", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", border: !e.read ? `1px solid rgba(141,214,63,0.28)` : "1px solid transparent", position: "relative" }}>
                          {!e.read && (
                            <span style={{ position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: "50%", background: GREEN, boxShadow: "0 0 0 3px rgba(141,214,63,0.20)" }} />
                          )}
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(120,170,255,0.18)", color: "#9DBEFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: e.read ? 700 : 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject}</span>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: emailAudPillFg(e.accountType), background: emailAudPillBg(e.accountType) }}>{emailAudienceLabel(e.accountType)}</span>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: "rgba(255,255,255,0.78)", background: "rgba(255,255,255,0.08)" }}>{emailCategoryLabel(e.category)}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.50)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.fromName} · {e.fromAddress}
                            </div>
                            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.preview}
                            </div>
                          </div>
                          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.40)", flexShrink: 0 }}>{formatEmailTime(e.receivedAt)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()
      ) : view === "staff" && role === "admin" ? (
        /* ── STAFF MANAGEMENT (admin only) ── */
        (() => {
          const sorted = [...staffList].sort((a, b) => {
            if (a.status !== b.status) return a.status === "active" ? -1 : 1;
            if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
            return a.firstName.localeCompare(b.firstName);
          });
          const activeCount = staffList.filter(s => s.status === "active").length;
          const adminCount = staffList.filter(s => s.role === "admin").length;
          return (
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Admin · Staff</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.02em" }}>Team accounts</p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: "#142A52", borderRadius: 14, padding: "12px", textAlign: "center" }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>{staffList.length}</p>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Total</p>
                </div>
                <div style={{ background: "#142A52", borderRadius: 14, padding: "12px", textAlign: "center" }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: GREEN, margin: 0, letterSpacing: "-0.02em" }}>{activeCount}</p>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Active</p>
                </div>
                <div style={{ background: "#142A52", borderRadius: 14, padding: "12px", textAlign: "center" }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>{adminCount}</p>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Admins</p>
                </div>
              </div>

              {/* ── Email Activation — self-serve OTP flow ── */}
              <div style={{ background: "#142A52", borderRadius: 18, padding: "16px 18px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 10px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Email activation</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "2px 0 0" }}>{inviteStep === "success" ? "Account activated" : inviteStep === "password" ? "Create password" : inviteStep === "otp" ? "Enter your code" : "Activate account"}</p>
                  </div>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(141,214,63,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  </div>
                </div>
                {inviteStep === "success" ? (
                  <>
                    <div style={{ background: "rgba(141,214,63,0.10)", border: "1px solid rgba(141,214,63,0.30)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: GREEN, margin: 0 }}>Account activated!</p>
                        <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", margin: "2px 0 0" }}>{inviteEmail} is now active as {inviteRole}.</p>
                      </div>
                    </div>
                    <button onClick={resetActivation} style={{ width: "100%", padding: "11px", borderRadius: 100, border: "1.5px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.70)", fontWeight: 700, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: "pointer" }}>Activate another</button>
                  </>
                ) : inviteStep === "password" ? (
              <>
                <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 14px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Account email</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "3px 0 0" }}>{inviteEmail}</p>
                </div>
                <input
                  type="password"
                  placeholder="Create a password (min. 8 chars)"
                  value={invitePassword}
                  onChange={e => { setInvitePassword(e.target.value); setInvitePasswordError(""); }}
                  onFocus={() => setInvitePasswordFocus(true)}
                  onBlur={() => setInvitePasswordFocus(false)}
                  style={{ width: "100%", padding: "14px 16px", borderRadius: 12, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 15, fontFamily: '"DM Sans",sans-serif', outline: "none", border: `1.5px solid ${invitePasswordError ? "#ef4444" : invitePasswordFocus ? GREEN : "rgba(255,255,255,0.15)"}`, transition: "border-color 0.15s" }}
                />
                {invitePasswordError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{invitePasswordError}</p>}
                <button
                  disabled={!invitePassword.trim() || inviteLoading}
                  onClick={async () => {
                    if (invitePassword.trim().length < 8) { setInvitePasswordError("Password must be at least 8 characters."); return; }
                    setInviteLoading(true); setInvitePasswordError("");
                    try {
                      if (!inviteAccessToken) { setInvitePasswordError("Session expired. Please go back and verify your code again."); return; }
                      const pwRes = await fetch("/api/staff/set-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: inviteAccessToken, password: invitePassword }) });
                      const pwData = await pwRes.json();
                      if (!pwRes.ok) { setInvitePasswordError(pwData.error || "Failed to set password."); return; }
                      await fetch("/api/staff/record-activation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), role: inviteRole, userId: inviteUserId }) }).catch(() => {});
                      refreshStaffList();
                      setInviteStep("success");
                    } catch { setInvitePasswordError("Network error. Try again."); }
                    finally { setInviteLoading(false); }
                  }}
                  style={{ width: "100%", padding: "11px", borderRadius: 100, border: "none", background: !invitePassword.trim() || inviteLoading ? "rgba(141,214,63,0.40)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: !invitePassword.trim() || inviteLoading ? "default" : "pointer" }}
                >
                  {inviteLoading ? "Creating account…" : "Create account"}
                </button>
              </>
            ) : inviteStep === "otp" ? (
              <>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.5 }}>Enter the code sent to <strong style={{ color: "#fff" }}>{inviteEmail}</strong></p>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Enter code"
                  value={inviteOtpDigits.join("")}
                  onChange={e => { setInviteOtpDigits(e.target.value.replace(/\D/g,"").split("")); setInviteError(""); }}
                  style={{ width: "100%", padding: "14px 16px", borderRadius: 12, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 20, fontWeight: 700, fontFamily: '"DM Sans",sans-serif', outline: "none", border: `1.5px solid ${inviteError ? "#ef4444" : "rgba(255,255,255,0.20)"}`, textAlign: "center", letterSpacing: "0.18em", transition: "border-color 0.15s" }}
                />
                {inviteError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{inviteError}</p>}
                <button
                  disabled={!inviteOtpDigits.join("").trim() || inviteLoading}
                  onClick={async () => {
                    const otp = inviteOtpDigits.join("");
                    setInviteLoading(true); setInviteError("");
                    try {
                      const { data: vData, error: vErr } = await supabase.auth.verifyOtp({ email: inviteEmail.trim().toLowerCase(), token: otp, type: "email" });
                      if (vErr) { setInviteError(vErr.message || "Invalid or expired code."); return; }
                      setInviteUserId(vData?.user?.id ?? null);
                      setInviteAccessToken(vData?.session?.access_token ?? null);
                      setInviteStep("password");
                    } catch { setInviteError("Network error. Try again."); }
                    finally { setInviteLoading(false); }
                  }}
                  style={{ width: "100%", padding: "11px", borderRadius: 100, border: "none", background: !inviteOtpDigits.join("").trim() || inviteLoading ? "rgba(141,214,63,0.40)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: !inviteOtpDigits.join("").trim() || inviteLoading ? "default" : "pointer" }}
                >
                  {inviteLoading ? "Verifying…" : "Verify code"}
                </button>
                <button onClick={resetActivation} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 12, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', padding: 0, textAlign: "left" }}>← Change email</button>
              </>
            ) : (
                  <>
                    <input
                      type="email"
                      placeholder="your@email.com"
                      value={inviteEmail}
                      onChange={e => { setInviteEmail(e.target.value); setInviteError(""); }}
                      onFocus={() => setInviteEmailFocus(true)}
                      onBlur={() => setInviteEmailFocus(false)}
                      style={{ width: "100%", padding: "10px 14px", borderRadius: 10, boxSizing: "border-box", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', outline: "none", border: `1.5px solid ${inviteError ? "#ef4444" : inviteEmailFocus ? GREEN : "rgba(255,255,255,0.10)"}`, transition: "border-color 0.15s" }}
                    />
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["admin","staff"] as const).map(r => (
                        <button key={r} onClick={() => { setInviteRole(r); setInviteError(""); }} style={{ flex: 1, padding: "8px", borderRadius: 10, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', fontSize: 12, fontWeight: 700, border: `1.5px solid ${inviteRole === r ? (r === "admin" ? GREEN : "rgba(255,255,255,0.40)") : "rgba(255,255,255,0.10)"}`, background: inviteRole === r ? (r === "admin" ? "rgba(141,214,63,0.12)" : "rgba(255,255,255,0.07)") : "transparent", color: inviteRole === r ? (r === "admin" ? GREEN : "#fff") : "rgba(255,255,255,0.40)", textTransform: "capitalize" }}>{r}</button>
                      ))}
                    </div>
                    {inviteError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{inviteError}</p>}
                    <button
                      disabled={inviteLoading}
                      onClick={async () => {
                        const em = inviteEmail.trim().toLowerCase();
                        if (!em || !em.includes("@")) { setInviteError("Enter a valid email address."); return; }
                        setInviteLoading(true); setInviteError("");
                        try {
                          const chk = await fetch("/api/staff/check-whitelist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em }) });
                          const chkData = await chk.json();
                          if (!chk.ok) { setInviteError(chkData.error || "Email not on the approved list."); return; }
                          setInviteRole(chkData.role);
                          const { error: otpErr } = await supabase.auth.signInWithOtp({ email: em, options: { shouldCreateUser: true } });
                          if (otpErr) { setInviteError(otpErr.message || "Failed to send code."); return; }
                          setInviteStep("otp");
                        } catch { setInviteError("Network error. Try again."); }
                        finally { setInviteLoading(false); }
                      }}
                      style={{ width: "100%", padding: "12px", borderRadius: 100, border: "none", background: inviteLoading ? "rgba(141,214,63,0.50)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: inviteLoading ? "not-allowed" : "pointer", letterSpacing: "0.01em" }}
                    >
                      {inviteLoading ? "Sending…" : "Send code"}
                    </button>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.30)", margin: 0, lineHeight: 1.4 }}>Email must be on the approved {inviteRole} list in Supabase.</p>
                  </>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {sorted.map(s => {
                  const suspended = s.status === "suspended";
                  const isAdmin = s.role === "admin";
                  // Performance scorecard (admin-only view; staff never reach this page).
                  // Match the staff member to graded messages via display name —
                  // the same string used as `agentName()` when sending messages.
                  // Also include the email-prefix as an alias so any messages
                  // attributed under the legacy short form still aggregate here.
                  const displayName = `${s.firstName} ${s.lastName}`;
                  const emailPrefix = s.email.split("@")[0] || "";
                  const qa = staffRating(tickets, displayName, [emailPrefix]);
                  return (
                    <div key={s.id} style={{
                      background: "#142A52", borderRadius: 16, padding: "14px 16px",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 10px rgba(0,0,0,0.22)",
                      display: "flex", flexDirection: "column", gap: 12,
                      opacity: suspended ? 0.65 : 1,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: "50%",
                          background: isAdmin ? "rgba(141,214,63,0.18)" : "rgba(255,255,255,0.10)",
                          color: isAdmin ? "#B6E97A" : "#fff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 800, fontSize: 14, flexShrink: 0,
                        }}>{(s.firstName[0] + s.lastName[0]).toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: "-0.01em" }}>{displayName}</span>
                            <span style={{
                              fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                              padding: "2px 7px", borderRadius: 6,
                              color: isAdmin ? "#B6E97A" : "#fff",
                              background: isAdmin ? "rgba(141,214,63,0.16)" : "rgba(255,255,255,0.10)",
                            }}>{s.role}</span>
                            {suspended && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 6, color: "#ff8585", background: "rgba(239,68,68,0.16)" }}>Suspended</span>
                            )}
                          </div>
                          <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.email}</p>
                          <p style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", margin: "1px 0 0" }}>Last sign-in · {s.lastSignIn}</p>
                        </div>
                        <button
                          onClick={() => {
                            setStaffAuthError(""); setStaffAuthPassword("");
                            setStaffAuthAction({
                              kind: suspended ? "reinstate" : "suspend",
                              staffId: s.id,
                              staffName: displayName,
                            });
                          }}
                          style={{
                            background: suspended ? "rgba(141,214,63,0.18)" : "rgba(239,68,68,0.12)",
                            color: suspended ? "#B6E97A" : "#ff8585",
                            border: "none", borderRadius: 100, padding: "8px 14px",
                            fontSize: 11, fontWeight: 800, cursor: "pointer",
                            fontFamily: '"DM Sans",sans-serif', flexShrink: 0,
                          }}
                        >
                          {suspended ? "Reinstate" : "Suspend"}
                        </button>
                      </div>

                      {/* Performance scorecard — review summary for this staff member. */}
                      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <p style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.55)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Performance review</p>
                          {qa ? (
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.50)", fontWeight: 700 }}>
                              {qa.count} reply{qa.count === 1 ? "" : "s"} · {qa.ticketCount} chat{qa.ticketCount === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.40)", fontWeight: 700 }}>No graded replies yet</span>
                          )}
                        </div>
                        {qa ? (
                          <>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                              <span style={{ fontSize: 22, fontWeight: 800, color: scoreColor(qa.overall), letterSpacing: "-0.02em" }}>{qa.overall.toFixed(1)}</span>
                              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>/ 5 average</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                              {([
                                { label: "Prof", value: qa.professionalism },
                                { label: "Spell", value: qa.spelling },
                                { label: "Gram", value: qa.grammar },
                                { label: "Time", value: qa.responseTime },
                              ]).map(stat => (
                                <div key={stat.label} style={{ background: "rgba(14,31,64,0.45)", borderRadius: 8, padding: "6px 4px", textAlign: "center" }}>
                                  <p style={{ fontSize: 13, fontWeight: 800, color: scoreColor(stat.value), margin: 0, letterSpacing: "-0.02em" }}>{stat.value.toFixed(1)}</p>
                                  <p style={{ fontSize: 8.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.06em", textTransform: "uppercase", margin: "2px 0 0" }}>{stat.label}</p>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", margin: 0, fontStyle: "italic" }}>
                            Replies sent by {s.firstName} will be auto-graded for tone, spelling, grammar, and response time.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()
      ) : view === "users" ? (
        /* ── USER LIST ── */
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setView("dashboard")} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Admin · Users</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "1px 0 0", letterSpacing: "-0.02em" }}>All Accounts</p>
            </div>
          </div>

          {/* Renter / Host segmented toggle */}
          <div style={{ background: "#142A52", borderRadius: 12, padding: 4, display: "flex", gap: 0, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 6px rgba(0,0,0,0.22)" }}>
            {([
              { id: "renters" as const, label: "Renters", count: renterCount, icon: (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 17h14M5 17a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2M7 17v2M17 17v2M5 10l1.5-4.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L19 10"/></svg>
              )},
              { id: "hosts" as const, label: "Hosts", count: hostCount, icon: (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              )},
            ]).map(t => {
              const active = adminView === t.id;
              return (
                <button key={t.id} onClick={() => setAdminView(t.id)} style={{
                  flex: 1, padding: "10px 8px", borderRadius: 8,
                  background: active ? NAVY : "transparent",
                  color: active ? "#fff" : "rgba(255,255,255,0.55)",
                  border: "none",
                  fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif',
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7, letterSpacing: 0.3,
                }}>
                  {t.icon}
                  <span>{t.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>({t.count})</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px", marginTop: -4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: 0.8, textTransform: "uppercase" }}>
              Sorted by {adminView === "hosts" ? "earnings" : "spend"} · highest first
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.50)" }}>
              {filteredUsers.length} shown
            </span>
          </div>

          {/* Search */}
          <input
            type="text" placeholder="Search by name or email"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, padding: "11px 14px", fontSize: 13.5 }}
          />

          {/* User list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredUsers.length === 0 && (
              <p style={{ textAlign: "center", color: "rgba(255,255,255,0.42)", padding: "24px 0", fontSize: 13 }}>No users match.</p>
            )}
            {filteredUsers.map(u => (
              <div key={u.id} onClick={() => { setSelectedUserId(u.id); setView("userDetail"); }} style={{
                background: "#142A52", borderRadius: 14, padding: "12px 14px",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 6px rgba(0,0,0,0.22)",
                display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
              }}>
                <Avatar user={u} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{u.firstName} {u.lastName}</span>
                    {u.verified && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={GREEN}><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/></svg>
                    )}
                    {u.status === "suspended" && (
                      <span style={{ fontSize: 9, fontWeight: 800, color: "#ef4444", background: "rgba(239,68,68,0.10)", padding: "2px 6px", borderRadius: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>Suspended</span>
                    )}
                  </div>
                  <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.62)", margin: "1px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: GREEN, letterSpacing: "-0.01em" }}>
                    ${(adminView === "hosts" ? u.earningsThisMonth : u.totalSpent)?.toFixed(0) || "0"}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>{u.bookingsThisMonth} bookings</span>
                  {u.type === "both" && <TypeBadge type="both" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : selectedUser ? (
        /* ── USER DETAIL DASHBOARD ── */
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => { setView("users"); setSelectedUserId(null); }} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Admin · User Detail</p>
          </div>

          {/* Profile header */}
          <div style={{ background: "#142A52", borderRadius: 18, padding: "18px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 14px rgba(0,0,0,0.30)", display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar user={selectedUser} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{selectedUser.firstName} {selectedUser.lastName}</span>
                <TypeBadge type={selectedUser.type} />
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>ID #{selectedUser.id} · Joined {selectedUser.joined}</p>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <a
                  href={`tel:${selectedUser.phone.replace(/[^0-9+]/g, "")}`}
                  style={{ textDecoration: "none", background: GREEN, color: NAVY, border: "none", borderRadius: 100, padding: "6px 12px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  Call
                </a>
                <a
                  href={`mailto:${selectedUser.email}`}
                  style={{ textDecoration: "none", background: "rgba(255,255,255,0.10)", color: "#fff", border: "none", borderRadius: 100, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
                  Email
                </a>
                {role === "admin" && (
                  <>
                    <button
                      onClick={() => {
                        setAuthError(""); setAuthPassword("");
                        setAuthAction({
                          kind: selectedUser.verified ? "unverify" : "verify",
                          userId: selectedUser.id,
                          userName: `${selectedUser.firstName} ${selectedUser.lastName}`,
                        });
                      }}
                      style={{ background: selectedUser.verified ? "rgba(141,214,63,0.18)" : "rgba(255,255,255,0.10)", color: selectedUser.verified ? "#B6E97A" : "#fff", border: "none", borderRadius: 100, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>
                      {selectedUser.verified ? "✓ Verified" : "Verify"}
                    </button>
                    <button
                      onClick={() => {
                        setAuthError(""); setAuthPassword("");
                        setAuthAction({
                          kind: selectedUser.status === "suspended" ? "reinstate" : "suspend",
                          userId: selectedUser.id,
                          userName: `${selectedUser.firstName} ${selectedUser.lastName}`,
                        });
                      }}
                      style={{ background: selectedUser.status === "suspended" ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.10)", color: selectedUser.status === "suspended" ? "#ff8585" : "#fff", border: "none", borderRadius: 100, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>
                      {selectedUser.status === "suspended" ? "Reinstate" : "Suspend"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: selectedUser.type === "both" ? "1fr 1fr" : "1fr 1fr", gap: 10 }}>
            <div style={{ background: "#142A52", borderRadius: 14, padding: "12px 14px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 6px rgba(0,0,0,0.22)" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Bookings (mo)</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.02em" }}>{selectedUser.bookingsThisMonth}</p>
            </div>
            <div style={{ background: "#142A52", borderRadius: 14, padding: "12px 14px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 6px rgba(0,0,0,0.22)" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>{selectedUser.type === "driver" ? "Total Spent" : "Earnings (mo)"}</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: GREEN, margin: "2px 0 0", letterSpacing: "-0.02em" }}>${(selectedUser.type === "driver" ? selectedUser.totalSpent : selectedUser.earningsThisMonth)?.toFixed(2) || "0.00"}</p>
            </div>
          </div>

          {/* Personal info — editable */}
          <div>
            <SectionHeader>Personal Info</SectionHeader>
            <div style={{ background: "#142A52", borderRadius: 14, padding: "4px 14px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 6px rgba(0,0,0,0.22)" }}>
              <EditableField label="First name" value={selectedUser.firstName} onChange={v => updateUser(selectedUser.id, { firstName: v })} />
              <EditableField label="Last name" value={selectedUser.lastName} onChange={v => updateUser(selectedUser.id, { lastName: v })} />
              <EditableField label="Email" value={selectedUser.email} onChange={v => updateUser(selectedUser.id, { email: v })} />
              <EditableField label="Phone" value={selectedUser.phone} onChange={v => updateUser(selectedUser.id, { phone: v })} />
              {(selectedUser.type === "driver" || selectedUser.type === "both") && (
                <EditableField label="Vehicle" value={selectedUser.vehicle || ""} onChange={v => updateUser(selectedUser.id, { vehicle: v })} />
              )}
              {(selectedUser.type === "host" || selectedUser.type === "both") && (
                <EditableField label="Address" value={selectedUser.address || ""} onChange={v => updateUser(selectedUser.id, { address: v })} />
              )}
            </div>
          </div>

          {/* Pads — only for hosts */}
          {selectedUser.pads && selectedUser.pads.length > 0 && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <SectionHeader>Pads & Spot Boxes</SectionHeader>
                <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.55)" }}>{selectedUser.pads.length} pad{selectedUser.pads.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {selectedUser.pads.map((pad, i) => (
                  <PadPhotoCard
                    key={i}
                    pad={pad}
                    onEdit={() => setEditingPad({ userId: selectedUser.id, padIdx: i })}
                    onReplacePhoto={url => updatePad(selectedUser.id, i, { photoUrl: url })}
                    onRename={name => updatePad(selectedUser.id, i, { name })}
                    onDelete={() => {
                      if (window.confirm(`Delete ${pad.name}? This can't be undone.`)) {
                        deletePad(selectedUser.id, i);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Internal note — admin only */}
          {role === "admin" && <div>
            <SectionHeader>Internal Note</SectionHeader>
            <div style={{ background: "#142A52", borderRadius: 14, padding: "12px 14px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 6px rgba(0,0,0,0.22)" }}>
              <textarea
                value={selectedUser.internalNote || ""}
                onChange={e => updateUser(selectedUser.id, { internalNote: e.target.value })}
                placeholder="Visible only to admins — risk flags, support context, etc."
                rows={3}
                style={{ width: "100%", border: "none", outline: "none", resize: "vertical", background: "transparent", color: "#fff", fontFamily: '"DM Sans",sans-serif', fontSize: 13, lineHeight: 1.5, boxSizing: "border-box", minHeight: 60 }}
              />
            </div>
          </div>}

          {/* Master actions — admin only */}
          {role === "admin" && <div>
            <SectionHeader>Master Actions</SectionHeader>
            <div style={{ background: "#142A52", borderRadius: 14, padding: "4px 14px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 6px rgba(0,0,0,0.22)" }}>
              {(() => {
                const actions: { label: string; icon: React.ReactNode; onClick: () => void }[] = [
                  {
                    label: "Send password reset email",
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2"><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15 19 4M18 5l2 2M15 8l2 2"/></svg>,
                    onClick: () => setToast(`Reset link sent to ${selectedUser.email}`),
                  },
                  {
                    label: "Resend welcome email",
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>,
                    onClick: () => setToast(`Welcome email resent to ${selectedUser.email}`),
                  },
                  {
                    label: "View transaction history",
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2"><path d="M3 3v18h18"/><path d="m7 14 4-4 4 4 5-6"/></svg>,
                    onClick: () => setShowTransactions(true),
                  },
                  {
                    label: "Export user data",
                    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
                    onClick: () => exportUser(selectedUser),
                  },
                ];
                return actions.map((a, i) => (
                  <div key={i} onClick={a.onClick} style={{ display: "flex", alignItems: "center", padding: "12px 0", borderBottom: i < actions.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", cursor: "pointer", gap: 10 }}>
                    <span style={{ width: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>{a.icon}</span>
                    <span style={{ flex: 1, fontSize: 13, color: "#fff", fontWeight: 500 }}>{a.label}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                  </div>
                ));
              })()}
            </div>
            <button onClick={() => setConfirmDelete(true)} style={{ width: "100%", marginTop: 10, background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.20)", borderRadius: 100, padding: "12px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>
              Delete account
            </button>
          </div>}
        </div>
      ) : null}

      {/* ── Transactions modal ── */}
      {showTransactions && selectedUser && (
        <div onClick={() => setShowTransactions(false)} style={{ position: "fixed", inset: 0, background: "rgba(14,31,64,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "#142A52", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "20px 22px 28px", maxHeight: "75vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Transactions</p>
                <p style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: "2px 0 0", letterSpacing: "-0.02em" }}>{selectedUser.firstName} {selectedUser.lastName}</p>
              </div>
              <button onClick={() => setShowTransactions(false)} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 14 }}>✕</button>
            </div>
            <div style={{ marginTop: 6 }}>
              {[
                { date: "Apr 26", desc: "Booking · 142 Maple St", amt: 12.50, kind: "in" },
                { date: "Apr 22", desc: "Booking · 880 Oak Ln", amt: 8.00, kind: "in" },
                { date: "Apr 18", desc: "Refund · 880 Oak Ln", amt: -4.00, kind: "out" },
                { date: "Apr 14", desc: "Booking · 142 Maple St", amt: 16.00, kind: "in" },
                { date: "Apr 09", desc: "Payout · Stripe", amt: -28.30, kind: "out" },
                { date: "Apr 02", desc: "Booking · 142 Maple St", amt: 12.50, kind: "in" },
              ].map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{t.desc}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>{t.date}, 2026</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: t.amt >= 0 ? GREEN : "#ef4444", letterSpacing: "-0.01em" }}>
                    {t.amt >= 0 ? "+" : "−"}${Math.abs(t.amt).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete-account confirmation ── */}
      {confirmDelete && selectedUser && (
        <div onClick={() => setConfirmDelete(false)} style={{ position: "fixed", inset: 0, background: "rgba(14,31,64,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, background: "#142A52", borderRadius: 22, padding: "22px 22px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(239,68,68,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.4"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
              </div>
              <p style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>Delete this account?</p>
              <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", margin: 0, lineHeight: 1.5 }}>
                {selectedUser.firstName} {selectedUser.lastName} ({selectedUser.email}) and all their pads will be permanently removed.
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.22)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Cancel</button>
              <button onClick={() => deleteUser(selectedUser.id)} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "none", background: "#ef4444", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Verify / Suspend admin-auth confirmation ── */}
      {authAction && (() => {
        const a = authAction;
        const verb = a.kind === "verify" ? "Verify"
          : a.kind === "unverify" ? "Remove verification from"
          : a.kind === "suspend" ? "Suspend"
          : "Reinstate";
        const accent = a.kind === "suspend" ? "#ef4444" : a.kind === "unverify" ? "#ff8585" : GREEN;
        const accentText = a.kind === "verify" || a.kind === "reinstate" ? NAVY : "#fff";
        const consequence = a.kind === "verify"
          ? "Their account and all pads they list will be marked verified."
          : a.kind === "unverify"
          ? "Verification will be removed from their account and from every pad they list."
          : a.kind === "suspend"
          ? "Their account will be suspended. Their pads will be hidden from drivers and active bookings will be cancelled."
          : "Their account will be reinstated. Their pads will become bookable again.";
        const confirm = () => {
          if (!authPassword.trim()) { setAuthError("Password required"); return; }
          if (authPassword.trim().length < 4) { setAuthError("Password too short"); return; }
          if (a.kind === "verify") updateUser(a.userId, { verified: true });
          else if (a.kind === "unverify") updateUser(a.userId, { verified: false });
          else if (a.kind === "suspend") updateUser(a.userId, { status: "suspended" });
          else if (a.kind === "reinstate") updateUser(a.userId, { status: "active" });
          const past = a.kind === "verify" ? "Verified"
            : a.kind === "unverify" ? "Verification removed for"
            : a.kind === "suspend" ? "Suspended"
            : "Reinstated";
          setToast(`${past} ${a.userName}`);
          setAuthAction(null); setAuthPassword(""); setAuthError("");
        };
        return (
          <div onClick={() => setAuthAction(null)} style={{ position: "fixed", inset: 0, background: "rgba(14,31,64,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#142A52", borderRadius: 18, padding: 22, width: "100%", maxWidth: 380, fontFamily: '"DM Sans",sans-serif', boxShadow: "0 12px 40px rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Confirm action</p>
                <p style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: "4px 0 0", letterSpacing: "-0.02em" }}>{verb} {a.userName}?</p>
                <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", margin: "8px 0 0", lineHeight: 1.5 }}>{consequence}</p>
              </div>
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "0 0 6px" }}>Re-enter your admin password</p>
                <input
                  type="password"
                  value={authPassword}
                  onChange={e => { setAuthPassword(e.target.value); if (authError) setAuthError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") confirm(); }}
                  autoFocus
                  placeholder="Admin password"
                  style={{ width: "100%", padding: "11px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1.5px solid ${authError ? "#ef4444" : "rgba(255,255,255,0.10)"}`, color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif', outline: "none", boxSizing: "border-box" }}
                />
                {authError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: "6px 0 0" }}>{authError}</p>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setAuthAction(null)} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.22)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Cancel</button>
                <button onClick={confirm} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "none", background: accent, color: accentText, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>{verb}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {staffAuthAction && (() => {
        const a = staffAuthAction;
        const verb = a.kind === "suspend" ? "Suspend" : "Reinstate";
        const accent = a.kind === "suspend" ? "#ef4444" : GREEN;
        const accentText = a.kind === "suspend" ? "#fff" : NAVY;
        const consequence = a.kind === "suspend"
          ? "They will lose access to the admin app immediately. Their reset link requests will also be blocked."
          : "They will regain access to the admin app and can request a password reset again.";
        const confirm = () => {
          if (!staffAuthPassword.trim()) { setStaffAuthError("Password required"); return; }
          if (staffAuthPassword.trim().length < 4) { setStaffAuthError("Password too short"); return; }
          updateStaff(a.staffId, { status: a.kind === "suspend" ? "suspended" : "active" });
          setToast(`${a.kind === "suspend" ? "Suspended" : "Reinstated"} ${a.staffName}`);
          setStaffAuthAction(null); setStaffAuthPassword(""); setStaffAuthError("");
        };
        return (
          <div onClick={() => setStaffAuthAction(null)} style={{ position: "fixed", inset: 0, background: "rgba(14,31,64,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#142A52", borderRadius: 18, padding: 22, width: "100%", maxWidth: 380, fontFamily: '"DM Sans",sans-serif', boxShadow: "0 12px 40px rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ marginBottom: 14 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Confirm action</p>
                <p style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: "4px 0 0", letterSpacing: "-0.02em" }}>{verb} {a.staffName}?</p>
                <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", margin: "8px 0 0", lineHeight: 1.5 }}>{consequence}</p>
              </div>
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "0 0 6px" }}>Re-enter your admin password</p>
                <input
                  type="password"
                  value={staffAuthPassword}
                  onChange={e => { setStaffAuthPassword(e.target.value); if (staffAuthError) setStaffAuthError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") confirm(); }}
                  autoFocus
                  placeholder="Admin password"
                  style={{ width: "100%", padding: "11px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1.5px solid ${staffAuthError ? "#ef4444" : "rgba(255,255,255,0.10)"}`, color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif', outline: "none", boxSizing: "border-box" }}
                />
                {staffAuthError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: "6px 0 0" }}>{staffAuthError}</p>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStaffAuthAction(null)} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.22)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Cancel</button>
                <button onClick={confirm} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "none", background: accent, color: accentText, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>{verb}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {forgotOpen && (
        <div onClick={closeForgot} style={{ position: "fixed", inset: 0, background: "rgba(14,31,64,0.65)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#142A52", borderRadius: 18, padding: 22, width: "100%", maxWidth: 380, fontFamily: '"DM Sans",sans-serif', boxShadow: "0 12px 40px rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Password reset</p>
              <p style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: "4px 0 0", letterSpacing: "-0.02em" }}>
                {forgotStep === "done" ? "Password updated" : forgotStep === "password" ? "Create new password" : forgotStep === "otp" ? "Enter your code" : "Forgot your password?"}
              </p>
            </div>

            {forgotStep === "done" ? (
              <>
                <div style={{ background: "rgba(141,214,63,0.12)", border: "1px solid rgba(141,214,63,0.32)", borderRadius: 12, padding: "12px 14px" }}>
                  <p style={{ color: GREEN, fontSize: 12.5, fontWeight: 700, margin: 0 }}>Password updated</p>
                  <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>Your password has been changed. You can now sign in with your new password.</p>
                </div>
                <button onClick={closeForgot} style={{ width: "100%", padding: "12px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Sign in →</button>
              </>
            ) : forgotStep === "password" ? (
              <>
                <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 14px" }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Account email</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "3px 0 0" }}>{forgotEmail.trim().toLowerCase()}</p>
                </div>
                <input
                  type="password"
                  placeholder="New password (min. 8 chars)"
                  value={forgotNewPassword}
                  autoFocus
                  onChange={e => { setForgotNewPassword(e.target.value); setForgotNewPasswordError(""); }}
                  onFocus={() => setForgotNewPasswordFocus(true)}
                  onBlur={() => setForgotNewPasswordFocus(false)}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1.5px solid ${forgotNewPasswordError ? "#ef4444" : forgotNewPasswordFocus ? GREEN : "rgba(255,255,255,0.10)"}`, color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif', outline: "none", boxSizing: "border-box" }}
                />
                {forgotNewPasswordError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{forgotNewPasswordError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={closeForgot} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.22)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Cancel</button>
                  <button
                    disabled={!forgotNewPassword.trim() || forgotLoading}
                    onClick={async () => {
                      if (forgotNewPassword.trim().length < 8) { setForgotNewPasswordError("Password must be at least 8 characters."); return; }
                      setForgotLoading(true); setForgotNewPasswordError("");
                      try {
                        if (!forgotAccessToken) { setForgotNewPasswordError("Session expired. Please go back and verify your code again."); return; }
                        const pwRes = await fetch("/api/staff/set-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access_token: forgotAccessToken, password: forgotNewPassword }) });
                        const pwData = await pwRes.json();
                        if (!pwRes.ok) { setForgotNewPasswordError(pwData.error || "Failed to update password."); return; }
                        setForgotStep("done");
                      } catch { setForgotNewPasswordError("Network error. Try again."); }
                      finally { setForgotLoading(false); }
                    }}
                    style={{ flex: 1, padding: "12px", borderRadius: 100, border: "none", background: !forgotNewPassword.trim() || forgotLoading ? "rgba(141,214,63,0.40)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, cursor: !forgotNewPassword.trim() || forgotLoading ? "default" : "pointer", fontFamily: '"DM Sans",sans-serif' }}
                  >{forgotLoading ? "Updating…" : "Set password"}</button>
                </div>
              </>
            ) : forgotStep === "otp" ? (
              <>
                <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", margin: 0, lineHeight: 1.5 }}>Enter the code sent to <strong style={{ color: "#fff" }}>{forgotEmail.trim().toLowerCase()}</strong></p>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Enter code"
                  value={forgotOtp}
                  autoFocus
                  onChange={e => { setForgotOtp(e.target.value.replace(/\D/g, "")); setForgotOtpError(""); }}
                  style={{ width: "100%", padding: "12px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1.5px solid ${forgotOtpError ? "#ef4444" : "rgba(255,255,255,0.10)"}`, color: "#fff", fontSize: 22, fontWeight: 700, fontFamily: '"DM Sans",sans-serif', outline: "none", boxSizing: "border-box", textAlign: "center", letterSpacing: "0.20em" }}
                />
                {forgotOtpError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: 0 }}>{forgotOtpError}</p>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setForgotStep("email")} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.22)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>← Back</button>
                  <button
                    disabled={!forgotOtp.trim() || forgotLoading}
                    onClick={async () => {
                      setForgotLoading(true); setForgotOtpError("");
                      try {
                        const { data: fvData, error: vErr } = await supabase.auth.verifyOtp({ email: forgotEmail.trim().toLowerCase(), token: forgotOtp, type: "email" });
                        if (vErr) { setForgotOtpError(vErr.message || "Invalid or expired code."); return; }
                        setForgotAccessToken(fvData?.session?.access_token ?? null);
                        setForgotStep("password");
                      } catch { setForgotOtpError("Network error. Try again."); }
                      finally { setForgotLoading(false); }
                    }}
                    style={{ flex: 1, padding: "12px", borderRadius: 100, border: "none", background: !forgotOtp.trim() || forgotLoading ? "rgba(141,214,63,0.40)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, cursor: !forgotOtp.trim() || forgotLoading ? "default" : "pointer", fontFamily: '"DM Sans",sans-serif' }}
                  >{forgotLoading ? "Verifying…" : "Verify code"}</button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.62)", margin: 0, lineHeight: 1.5 }}>Enter your work email. We'll send a code to verify your identity.</p>
                <div>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "0 0 6px" }}>Work email</p>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={e => { setForgotEmail(e.target.value); if (forgotError) setForgotError(""); }}
                    onKeyDown={e => { if (e.key === "Enter") handleForgotSubmit(); }}
                    autoFocus
                    placeholder="you@lilypad.com"
                    style={{ width: "100%", padding: "11px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: `1.5px solid ${forgotError ? "#ef4444" : "rgba(255,255,255,0.10)"}`, color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif', outline: "none", boxSizing: "border-box" }}
                  />
                  {forgotError && <p style={{ color: "#ef4444", fontSize: 11.5, fontWeight: 600, margin: "6px 0 0" }}>{forgotError}</p>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={closeForgot} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "1px solid rgba(255,255,255,0.22)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Cancel</button>
                  <button onClick={handleForgotSubmit} disabled={forgotLoading} style={{ flex: 1, padding: "12px", borderRadius: 100, border: "none", background: forgotLoading ? "rgba(141,214,63,0.40)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, cursor: forgotLoading ? "default" : "pointer", fontFamily: '"DM Sans",sans-serif' }}>
                    {forgotLoading ? "Sending…" : "Send code"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", background: NAVY, color: "#fff", padding: "11px 18px", borderRadius: 100, fontSize: 12.5, fontWeight: 600, fontFamily: '"DM Sans",sans-serif', boxShadow: "0 4px 16px rgba(14,31,64,0.30)", zIndex: 1100, maxWidth: "80%", textAlign: "center" }}>
          {toast}
        </div>
      )}

      {/* ── Spot editor overlay ── */}
      {editingPad && (() => {
        const u = users.find(x => x.id === editingPad.userId);
        const p = u?.pads?.[editingPad.padIdx];
        if (!u || !p) return null;
        return (
          <SpotEditor
            pad={p}
            onSave={box => updatePadBox(u.id, editingPad.padIdx, box)}
            onClose={() => setEditingPad(null)}
          />
        );
      })()}

      {/* ── Bottom nav (only when signed in) ── */}
      {loggedIn && (
        <div style={{
          background: "#142A52",
          borderTop: "0.5px solid rgba(255,255,255,0.08)",
          padding: "14px 16px 24px",
          display: "flex",
          justifyContent: "space-around",
          flexShrink: 0,
        }}>
          {([
            {
              label: "HOME",
              active: view === "dashboard",
              onClick: () => { setView("dashboard"); setSelectedUserId(null); },
              svg: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
            },
            {
              label: "MAP",
              active: false,
              onClick: () => { setState(s => ({ ...s, adminPreview: true, adminPreviewRole: role })); goTo("find"); },
              svg: <><polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21 1 6"/><line x1="8" y1="3" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="21"/></>,
            },
            {
              label: "SUPPORT",
              active: view === "service",
              onClick: () => { setView("service"); setSelectedUserId(null); },
              svg: <><path d="M3 18v-2a4 4 0 0 1 4-4h2"/><path d="M21 18v-2a4 4 0 0 0-4-4h-2"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="7" r="3"/></>,
            },
            ...(role === "admin" ? [{
              label: "STAFF",
              active: view === "staff",
              onClick: () => { setView("staff"); setSelectedUserId(null); },
              svg: <><circle cx="9" cy="7" r="3"/><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/><circle cx="17" cy="9" r="2.5"/><path d="M22 19v-.5a3.5 3.5 0 0 0-3.5-3.5H17"/></>,
            }] : []),
          ]).map(item => (
            <button
              key={item.label}
              onClick={item.onClick}
              style={{
                background: "none", border: "none", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                color: item.active ? GREEN : "rgba(255,255,255,0.55)",
                fontSize: 10, fontWeight: item.active ? 800 : 600,
                letterSpacing: "0.10em", fontFamily: '"DM Sans", sans-serif',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {item.svg}
              </svg>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
