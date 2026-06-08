import { useState, useRef, useEffect } from "react";
import { useApp } from "@/context/AppContext";
import { supabase } from "@/lib/supabase";
import {
  makeId, formatSupportTime, ticketLastPreview,
  emptyResolutionDraft, ticketPipeline,
  gradeAgentMessage, conversationRating, staffRating,
  type SupportTicket, type SupportResolution, type TicketPipeline, type MessageRating,
} from "@/lib/support";
import {
  fetchConversations, sendMessage as apiSendMessage,
  updateConversationStatus, setLocalMeta, subscribeToSupport,
} from "@/lib/supportApi";
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

const lightInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 12,
  border: "1.5px solid rgba(14,31,64,0.15)",
  background: "rgba(14,31,64,0.04)",
  fontSize: 14,
  color: "#0E1F40",
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
  uuid: string;
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
      background: "#fff",
      borderRadius: 18,
      padding: "16px 18px",
      boxShadow: "0 2px 12px rgba(14,31,64,0.08)",
      border: "1px solid rgba(14,31,64,0.07)",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      cursor: onClick ? "pointer" : "default",
    }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: GREEN, fontWeight: 600, margin: 0 }}>{sub}</p>}
      {breakdown && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(14,31,64,0.08)", display: "flex", flexDirection: "column", gap: 5 }}>
          {breakdown.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: b.dot || GREEN, flexShrink: 0 }} />
                <span style={{ fontSize: 10.5, color: "rgba(14,31,64,0.55)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: NAVY, flexShrink: 0 }}>{b.value}</span>
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
    <div style={{ display: "flex", alignItems: "center", padding: "12px 0", borderBottom: "1px solid rgba(14,31,64,0.07)", gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(14,31,64,0.45)", letterSpacing: "0.04em", width: 88, flexShrink: 0, textTransform: "uppercase" }}>{label}</span>
      {editing ? (
        <>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") { onChange(draft); setEditing(false); } if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
            style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${NAVY}`, background: "#f0f3f8", fontSize: 13.5, color: NAVY, fontFamily: '"DM Sans",sans-serif', outline: "none", minWidth: 0 }}
          />
          <button onClick={() => { onChange(draft); setEditing(false); }} style={{ background: GREEN, color: NAVY, border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}>Save</button>
        </>
      ) : (
        <>
          <span style={{ flex: 1, fontSize: 13.5, color: NAVY, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || <span style={{ color: "rgba(14,31,64,0.28)" }}>— not set —</span>}</span>
          <button onClick={() => setEditing(true)} style={{ background: "rgba(14,31,64,0.07)", color: NAVY, border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}>Edit</button>
        </>
      )}
    </div>
  );
}

// ── Section header ──────────────────────────────────────────────────────────
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: "0 0 8px" }}>{children}</p>
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
    <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(14,31,64,0.09)", border: "1px solid rgba(14,31,64,0.08)" }}>
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
                style={{ flex: 1, padding: "5px 8px", borderRadius: 8, border: `1.5px solid ${NAVY}`, background: "#f0f3f8", fontSize: 13, color: NAVY, fontFamily: '"DM Sans",sans-serif', outline: "none", minWidth: 0 }}
              />
              <button onClick={() => { onRename(draftName.trim() || pad.name); setRenaming(false); }} style={{ background: GREEN, color: NAVY, border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>Save</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pad.name}</span>
              <button onClick={() => setRenaming(true)} style={{ background: "transparent", color: "rgba(14,31,64,0.40)", border: "none", padding: 4, cursor: "pointer" }} title="Rename pad">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </button>
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={onEdit} style={{ background: "rgba(14,31,64,0.07)", color: NAVY, border: "none", borderRadius: 8, padding: "6px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            Redraw spot
          </button>
          <button onClick={pickFile} style={{ background: "rgba(14,31,64,0.07)", color: NAVY, border: "none", borderRadius: 8, padding: "6px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", gap: 4 }}>
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

// ── Analytics coming soon — chart will show real data once payment is live ────
function GrowthChart() {
  return (
    <div style={{
      background: "#fff", borderRadius: 18, padding: "28px 20px",
      boxShadow: "0 2px 12px rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.07)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 8, minHeight: 160, textAlign: "center",
    }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.18)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(14,31,64,0.45)", margin: 0 }}>Financial Analytics</p>
      <p style={{ fontSize: 12, color: "rgba(14,31,64,0.30)", margin: 0, maxWidth: 240 }}>Revenue trends will appear here once real bookings are processed</p>
    </div>
  );
}

// ── Initials + colored avatar ───────────────────────────────────────────────
function Avatar({ user, size = 40 }: { user: MockUser; size?: number }) {
  const initials = user.lastName ? (user.firstName[0] + user.lastName[0]).toUpperCase() : user.firstName.slice(0, 2).toUpperCase();
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
interface PendingSpot {
  id: string; address: string; pad_type: string; surface: string;
  num_pads: number; price_per_hr: number; description: string;
  photo_url: string; photo_urls: string[];
  host_name: string; host_email: string; lat: number; lng: number;
  created_at: string; host_user_id: string; spot_name?: string;
}

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

  const [showTestPortal, setShowTestPortal] = useState(false);
  const [testEmail, setTestEmail]           = useState("");
  const [testPassword, setTestPassword]     = useState("");
  const [testError, setTestError]           = useState("");
  const [testLoading, setTestLoading]       = useState(false);
  const [testResetLoading, setTestResetLoading]       = useState(false);
  const [testResetStep, setTestResetStep]             = useState<"idle"|"otp"|"password"|"done">("idle");
  const [testResetOtp, setTestResetOtp]               = useState("");
  const [testResetNewPw, setTestResetNewPw]           = useState("");
  const [testResetAccessToken, setTestResetAccessToken] = useState<string|null>(null);

  const [view, setView] = useState<View>("dashboard");
  const [users, setUsers] = useState<MockUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  type AdminStats = { totalSpots: number; activeSpots: number; pendingSpots: number; totalUsers: number; newUsersThisWeek: number; totalBookings: number };
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
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

  // Pad approval queue + early access signups
  const [usersSection, setUsersSection]   = useState<"accounts" | "padqueue" | "pending">("accounts");
  const [pendingSpots, setPendingSpots]   = useState<PendingSpot[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [approvingSpotId, setApprovingSpotId] = useState<string | null>(null);

  // Early access signups (Pending tab)
  type EarlySignup = { id: string; name: string; email: string; role: string; status: string; notes: string; submitted_at: string; user_id: string | null; };
  const [earlySignups, setEarlySignups]       = useState<EarlySignup[]>([]);
  const [loadingEarlySignups, setLoadingEarlySignups] = useState(false);
  const [expandedSignupId, setExpandedSignupId] = useState<string | null>(null);
  const [signupNotes, setSignupNotes]         = useState<Record<string, string>>({});
  const [savingSignupId, setSavingSignupId]   = useState<string | null>(null);
  const [rejectingSpotId, setRejectingSpotId] = useState<string | null>(null);
  const [selectedSpot, setSelectedSpot]   = useState<PendingSpot | null>(null);
  const [approveConfirmSpot, setApproveConfirmSpot] = useState<PendingSpot | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

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
      const roleLabel = inviteCardRole === "admin" ? "Admin" : "Staff";
      const emailNote = d.emailSent
        ? `An invitation email has been sent to ${em}.`
        : `${em} added to ${roleLabel} list. They can activate via the staff login page.`;
      setInviteCardSuccess(emailNote);
      setInviteCardEmail("");
    } catch { setInviteCardError("Network error. Try again."); }
    finally { setInviteCardLoading(false); }
  }

  function refreshStaffList() { fetch("/api/staff/list").then(r => r.json()).then(d => { if (Array.isArray(d)) setStaffList(d); }).catch(() => {}); }
  useEffect(() => { refreshStaffList(); }, []);

  // Customer service — chat tickets + incoming email.
  const lastTicketRefreshRef = useRef(0);
  async function refreshTickets() {
    const now = Date.now();
    if (now - lastTicketRefreshRef.current < 1500) return;
    lastTicketRefreshRef.current = now;
    const data = await fetchConversations();
    setTickets(data);
  }
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [emails, setEmails] = useState<SupportEmail[]>(() => loadEmails());
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [agentReplyDraft, setAgentReplyDraft] = useState("");
  // Two-step send: every message must be confirmed before going to the customer.
  // Holds the trimmed pending text (and the ticket it's bound to so a tab/ticket
  // switch can't accidentally fire it on the wrong conversation).
  const [pendingReply, setPendingReply] = useState<{ ticketId: string; text: string } | null>(null);
  type ServiceTab = "email" | "tickets";
  type PipelineFilter = "all" | "open" | "pending" | "resolved";
  type AudienceFilter = "all" | "renter" | "padRenter";
  type EmailAudienceFilter = "all" | "renter" | "padRenter" | "guest";
  type EmailCategoryFilter = "all" | EmailCategory;
  type SortDir = "recent" | "oldest";
  const [serviceTab, setServiceTab] = useState<ServiceTab>("email");
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

  // Initial load + live sync.
  useEffect(() => { refreshTickets(); }, []);
  useEffect(() => subscribeToSupport(() => refreshTickets()), []);
  useEffect(() => { if (view === "service") refreshTickets(); }, [view]);
  useEffect(() => subscribeEmails(() => setEmails(loadEmails())), []);

  // Fetch pending spots / early access signups when the matching section opens
  useEffect(() => {
    if (view === "users" && usersSection === "padqueue") fetchPendingSpots();
    if (view === "users" && usersSection === "pending")  fetchEarlySignups();
  }, [view, usersSection]);

  const [earlySignupsTableReady, setEarlySignupsTableReady] = useState<boolean | null>(null);

  async function fetchEarlySignups() {
    setLoadingEarlySignups(true);
    try {
      const r = await fetch("/api/admin/early-access-signups");
      const d = await r.json();
      if (r.ok) {
        const signups = Array.isArray(d) ? d : (d.signups || []);
        const tableReady = Array.isArray(d) ? true : (d.tableReady !== false);
        setEarlySignups(signups);
        setEarlySignupsTableReady(tableReady);
        const notes: Record<string, string> = {};
        signups.forEach((s: EarlySignup) => { notes[s.id] = s.notes || ""; });
        setSignupNotes(notes);
      }
    } catch { /* silent */ }
    finally { setLoadingEarlySignups(false); }
  }

  async function approveEarlySignup(id: string) {
    setSavingSignupId(id);
    try {
      await fetch(`/api/admin/early-access-signups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      setEarlySignups(prev => prev.map(s => s.id === id ? { ...s, status: "approved" } : s));
    } catch { /* silent */ }
    finally { setSavingSignupId(null); }
  }

  async function saveSignupNotes(id: string) {
    setSavingSignupId(id);
    try {
      await fetch(`/api/admin/early-access-signups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: signupNotes[id] || "" }),
      });
      setEarlySignups(prev => prev.map(s => s.id === id ? { ...s, notes: signupNotes[id] || "" } : s));
    } catch { /* silent */ }
    finally { setSavingSignupId(null); }
  }

  function exportEarlySignupsPDF() {
    const pending  = earlySignups.filter(s => s.status === "pending");
    const approved = earlySignups.filter(s => s.status === "approved");
    const rows = (list: EarlySignup[]) => list.map(s => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${s.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${s.email}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-transform:capitalize">${s.role}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${new Date(s.submitted_at).toLocaleDateString()}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:${s.status==='approved'?'#22c55e':'#f59e0b'};font-weight:700;text-transform:capitalize">${s.status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:12px">${s.notes || "—"}</td>
      </tr>`).join("");
    const html = `<!DOCTYPE html><html><head><title>Lily Pad — Early Access Signups</title><style>body{font-family:system-ui,sans-serif;color:#1e293b;padding:32px}h1{font-size:22px;margin-bottom:4px}p.sub{color:#64748b;font-size:13px;margin-bottom:24px}table{border-collapse:collapse;width:100%}th{background:#0E1F40;color:#fff;padding:10px 12px;text-align:left;font-size:13px}td{font-size:13px}h2{font-size:15px;margin:24px 0 8px;color:#0E1F40}</style></head><body>
      <h1>🪷 Lily Pad — Early Access Signups</h1>
      <p class="sub">Exported ${new Date().toLocaleString()} · ${earlySignups.length} total signups</p>
      <h2>Pending (${pending.length})</h2>
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Submitted</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows(pending)}</tbody></table>
      <h2>Approved (${approved.length})</h2>
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Submitted</th><th>Status</th><th>Notes</th></tr></thead><tbody>${rows(approved)}</tbody></table>
      </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  async function fetchPendingSpots() {
    setLoadingPending(true);
    try {
      const r = await fetch("/api/spots/pending");
      const d = await r.json();
      if (r.ok) setPendingSpots(Array.isArray(d) ? d : []);
    } catch {}
    finally { setLoadingPending(false); }
  }

  async function approveSpot(spotId: string) {
    setApprovingSpotId(spotId);
    try {
      const r = await fetch(`/api/spots/${spotId}/approve`, { method: "POST" });
      if (r.ok) { setPendingSpots(prev => prev.filter(s => s.id !== spotId)); setToast("Spot approved — host notified by email"); }
    } catch {}
    finally { setApprovingSpotId(null); }
  }

  async function rejectSpot(spotId: string) {
    setRejectingSpotId(spotId);
    try {
      const r = await fetch(`/api/spots/${spotId}/reject`, { method: "POST" });
      if (r.ok) { setPendingSpots(prev => prev.filter(s => s.id !== spotId)); setToast("Listing rejected"); }
    } catch {}
    finally { setRejectingSpotId(null); }
  }

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
  async function confirmSendAgentReply() {
    if (!pendingReply || !selectedTicketId) return;
    if (pendingReply.ticketId !== selectedTicketId) {
      setPendingReply(null);
      return;
    }
    const text = pendingReply.text;
    if (!text) { setPendingReply(null); return; }
    const now = Date.now();
    const cur = tickets.find(t => t.id === selectedTicketId);
    const lastUserTs = cur
      ? [...cur.messages].reverse().find(m => m.from === "user")?.ts ?? null
      : null;
    const rating = gradeAgentMessage(text, now, lastUserTs);
    const msg = { id: makeId("m"), from: "agent" as const, text, ts: now, agentName: agentName(), rating };
    // Optimistic update
    setTickets(prev => prev.map(t => t.id === selectedTicketId
      ? { ...t, status: "open" as const, updatedAt: now, messages: [...t.messages, msg] }
      : t));
    setAgentReplyDraft("");
    setPendingReply(null);
    // Persist to Supabase
    await apiSendMessage({
      conversationId: selectedTicketId,
      senderId: null,
      senderName: agentName(),
      senderRole: role === "admin" ? "admin" : "staff",
      message: text,
    });
    refreshTickets();
  }

  // "Edit" returns the staged text to the textarea so the agent can revise it.
  function cancelPendingReply() {
    if (pendingReply) setAgentReplyDraft(pendingReply.text);
    setPendingReply(null);
  }

  function markTicketOpened(id: string) {
    setLocalMeta(id, { openedByAgent: true });
    setTickets(prev => prev.map(t => t.id === id ? { ...t, openedByAgent: true } : t));
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
    // Optimistic local update
    setTickets(prev => prev.map(t => t.id === selectedTicketId
      ? { ...t, status: newStatus, updatedAt: now, resolution }
      : t));
    // Persist status to Supabase; resolution stored locally (not in DB schema)
    setLocalMeta(selectedTicketId, { resolution });
    updateConversationStatus(selectedTicketId, newStatus);
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
    setTickets(prev => prev.map(t => {
      if (t.id !== id || t.status !== "pending_resolution" || !t.resolution) return t;
      const updated = {
        ...t,
        status: "resolved" as const,
        updatedAt: now,
        resolution: { ...t.resolution, approvedBy: approver, approvedByRole: "admin" as const, approvedAt: now },
      };
      setLocalMeta(id, { resolution: updated.resolution });
      return updated;
    }));
    updateConversationStatus(id, "resolved");
    setApprovePassword("");
    setApproveError("");
  }

  function rejectResolution(id: string) {
    if (role !== "admin") return;
    const now = Date.now();
    setTickets(prev => prev.map(t => t.id === id && t.status === "pending_resolution"
      ? { ...t, status: "open" as const, updatedAt: now, resolution: undefined }
      : t));
    setLocalMeta(id, { resolution: undefined });
    updateConversationStatus(id, "open");
    resetResolutionAuthFields();
  }

  function reopenTicket(id: string) {
    if (role !== "admin") return;
    const now = Date.now();
    setTickets(prev => prev.map(t => t.id === id && t.status === "resolved"
      ? { ...t, status: "open" as const, updatedAt: now }
      : t));
    updateConversationStatus(id, "open");
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

  // Fetch real admin stats from Supabase.
  async function fetchAdminStats() {
    try {
      const r = await fetch("/api/admin/stats");
      if (r.ok) setAdminStats(await r.json());
    } catch {}
  }

  // Fetch real users from Supabase profiles.
  async function fetchRealUsers() {
    setLoadingUsers(true);
    try {
      const r = await fetch("/api/admin/users");
      if (!r.ok) return;
      const data = await r.json();
      if (!Array.isArray(data)) return;
      const mapped: MockUser[] = data.map((p: Record<string, unknown>) => {
        const uuid = String(p.id || "");
        const numId = uuid ? (parseInt(uuid.replace(/-/g, "").slice(0, 8), 16) || 0) : 0;
        const nameParts = (String(p.full_name || "")).trim().split(" ");
        const firstName = nameParts[0] || "User";
        const lastName = nameParts.slice(1).join(" ") || "";
        const acct = String(p.account_type || "driver");
        const type: UserType = acct === "host" || acct === "padRenter" ? "host" : acct === "both" ? "both" : "driver";
        const joined = p.created_at ? new Date(String(p.created_at)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown";
        return {
          id: numId,
          uuid,
          type,
          firstName,
          lastName,
          email: String(p.email || ""),
          phone: String(p.phone || ""),
          bookingsThisMonth: Number(p.booking_count) || 0,
          earningsThisMonth: 0,
          totalSpent: Number(p.spend_total) || 0,
          joined,
          verified: String(p.status) === "active",
          status: String(p.status) === "suspended" ? "suspended" : "active",
        };
      });
      setUsers(mapped);
    } catch {}
    finally { setLoadingUsers(false); }
  }

  // Fetch stats and users once logged in.
  useEffect(() => {
    if (!loggedIn) return;
    fetchAdminStats();
    fetchRealUsers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  // Refresh user list when navigating to users view.
  useEffect(() => {
    if (loggedIn && view === "users") fetchRealUsers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Persist admin login flag (users now come from real API, not localStorage).
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

  async function handleTestPortalSendCode() {
    if (!testEmail.trim()) { setTestError("Enter your email above first."); return; }
    setTestError(""); setTestResetLoading(true);
    try {
      const r = await fetch("/api/beta/send-reset-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail.trim().toLowerCase() }),
      });
      const data = await r.json();
      if (!r.ok) { setTestError(data.error || "Failed to send code."); return; }
      setTestResetStep("otp");
    } catch { setTestError("Network error. Please try again."); }
    finally { setTestResetLoading(false); }
  }

  async function handleTestPortalVerifyOtp() {
    if (!testResetOtp.trim()) { setTestError("Enter the code from your email."); return; }
    setTestError("");
    setTestResetStep("password");
  }

  async function handleTestPortalSetPassword() {
    if (testResetNewPw.trim().length < 8) { setTestError("Password must be at least 8 characters."); return; }
    setTestError(""); setTestResetLoading(true);
    try {
      const r = await fetch("/api/beta/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail.trim().toLowerCase(), code: testResetOtp.trim(), password: testResetNewPw }),
      });
      const data = await r.json();
      if (!r.ok) { setTestError(data.error || "Failed to update password."); return; }
      setTestResetStep("done");
    } catch { setTestError("Network error. Please try again."); }
    finally { setTestResetLoading(false); }
  }

  async function handleTestPortalLogin() {
    if (!testEmail.trim() || !testPassword.trim()) {
      setTestError("Please enter your email and password.");
      return;
    }
    setTestError("");
    setTestLoading(true);
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: testEmail.trim().toLowerCase(),
        password: testPassword,
      });
      if (authErr) { setTestError("Incorrect email or password."); return; }
      const res = await fetch("/api/beta/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: testEmail.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!data.isBetaTester) {
        await supabase.auth.signOut();
        setTestError("This account is not a beta tester.");
        return;
      }
      goTo("find");
    } catch { setTestError("Network error. Please try again."); }
    finally { setTestLoading(false); }
  }

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
    setServiceTab("email");
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
    const user = users.find(u => u.id === id);
    if (!user?.uuid) return;
    const apiPatch: Record<string, unknown> = {};
    if (patch.status !== undefined) apiPatch.status = patch.status;
    if (patch.email !== undefined) apiPatch.email = patch.email;
    if (patch.phone !== undefined) apiPatch.phone = patch.phone;
    if (Object.keys(apiPatch).length === 0) return;
    fetch(`/api/admin/users/${user.uuid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(apiPatch),
    }).catch(() => {});
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
    <div className="page active" style={{ display: "flex", flexDirection: "column", background: NAVY }}>

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
          style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0 }}
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
                      const vRes = await fetch("/api/staff/verify-activation-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), code: otp }) });
                      const vData = await vRes.json();
                      if (!vRes.ok) { setInviteError(vData.error || "Invalid or expired code."); return; }
                      setInviteUserId(vData.userId ?? null);
                      setInviteAccessToken(vData.access_token ?? null);
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
                      const r = await fetch("/api/staff/send-activation-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em }) });
                      const d = await r.json();
                      if (!r.ok) { setInviteError(d.error || "Email not on the approved list."); return; }
                      setInviteRole(d.role);
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
        <>
          <div style={{ flexShrink: 0, padding: "8px 20px 28px", background: NAVY }}>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.52)", margin: 0, lineHeight: 1.55 }}>Sign in to access the Lily Pad operations center.</p>
          </div>
          <div style={{ flex: 1, overflowY: "auto", background: "#fff", borderRadius: "28px 28px 0 0", padding: "28px 24px 40px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
              <img src="/lily-pad-icon.png" alt="Lily Pad" style={{ width: 96, height: 96, objectFit: "contain" }} />
              <p style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: "-0.02em", textAlign: "center" }}>Choose your role</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
              <button onClick={() => { setRole("staff"); setError(""); setEmail(""); setPassword(""); }} style={{
                background: "rgba(14,31,64,0.06)", border: "1.5px solid rgba(14,31,64,0.18)", borderRadius: 12, padding: "13px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: NAVY, fontFamily: '"DM Sans",sans-serif',
                fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em",
              }}>
                Staff
              </button>
              <button onClick={() => { setRole("admin"); setError(""); setEmail(""); setPassword(""); }} style={{
                background: GREEN, border: "none", borderRadius: 12, padding: "13px",
                display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: NAVY, fontFamily: '"DM Sans",sans-serif',
                fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em",
              }}>
                Admin
              </button>
              <button onClick={() => { resetActivation(); setShowActivate(true); }} style={{
                background: "none", border: "none", padding: "8px", cursor: "pointer",
                color: "#3d6b18", fontFamily: '"DM Sans",sans-serif', fontSize: 13, fontWeight: 700, textAlign: "center",
              }}>
                New here? Activate your account →
              </button>

              {/* ── Test Portal ── */}
              <div style={{ borderTop: "1px solid rgba(14,31,64,0.08)", paddingTop: 14, marginTop: 2 }}>
                <button
                  onClick={() => { setShowTestPortal(p => !p); setTestEmail(""); setTestPassword(""); setTestError(""); }}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "rgba(14,31,64,0.30)", fontFamily: '"DM Sans",sans-serif', fontSize: 11, fontWeight: 600, textAlign: "center", width: "100%", letterSpacing: "0.04em" }}
                >
                  {showTestPortal ? "Hide test portal" : "Test Portal"}
                </button>

                {showTestPortal && (
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>

                    {/* ── Sign-in form (only when not in reset flow) ── */}
                    {testResetStep === "idle" && (<>
                      <input
                        type="email"
                        placeholder="Tester email"
                        value={testEmail}
                        onChange={e => { setTestEmail(e.target.value); setTestError(""); }}
                        onKeyDown={e => { if (e.key === "Enter") handleTestPortalLogin(); }}
                        style={{ ...lightInputStyle }}
                      />
                      <input
                        type="password"
                        placeholder="Password"
                        value={testPassword}
                        onChange={e => { setTestPassword(e.target.value); setTestError(""); }}
                        onKeyDown={e => { if (e.key === "Enter") handleTestPortalLogin(); }}
                        style={{ ...lightInputStyle }}
                      />
                      {testError && (
                        <p style={{ fontSize: 11, color: "#ef4444", margin: 0, textAlign: "center", fontFamily: '"DM Sans",sans-serif' }}>{testError}</p>
                      )}
                      <button
                        onClick={handleTestPortalLogin}
                        disabled={testLoading}
                        style={{ background: testLoading ? "rgba(14,31,64,0.06)" : "rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.18)", borderRadius: 100, padding: "10px", color: NAVY, fontSize: 13, fontWeight: 700, cursor: testLoading ? "not-allowed" : "pointer", fontFamily: '"DM Sans",sans-serif' }}
                      >
                        {testLoading ? "Signing in…" : "Enter as tester"}
                      </button>
                      <button
                        onClick={handleTestPortalSendCode}
                        disabled={testResetLoading}
                        style={{ background: "none", border: "none", padding: 0, cursor: testResetLoading ? "not-allowed" : "pointer", color: "rgba(14,31,64,0.38)", fontFamily: '"DM Sans",sans-serif', fontSize: 11, fontWeight: 500, textAlign: "center", textDecoration: "underline", textUnderlineOffset: 3 }}
                      >
                        {testResetLoading ? "Sending…" : "Forgot password?"}
                      </button>
                    </>)}

                    {/* ── OTP entry ── */}
                    {testResetStep === "otp" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <p style={{ fontSize: 11, color: "rgba(14,31,64,0.45)", margin: 0, textAlign: "center", fontFamily: '"DM Sans",sans-serif' }}>
                          Code sent to <strong style={{ color: NAVY }}>{testEmail}</strong>
                        </p>
                        <input
                          autoFocus
                          type="text"
                          inputMode="numeric"
                          placeholder="Enter 6-digit code"
                          value={testResetOtp}
                          onChange={e => { setTestResetOtp(e.target.value.replace(/\D/g, "")); setTestError(""); }}
                          onKeyDown={e => { if (e.key === "Enter") handleTestPortalVerifyOtp(); }}
                          style={{ ...lightInputStyle, fontSize: 20, fontWeight: 700, textAlign: "center", letterSpacing: "0.20em" }}
                        />
                        {testError && (
                          <p style={{ fontSize: 11, color: "#ef4444", margin: 0, textAlign: "center", fontFamily: '"DM Sans",sans-serif' }}>{testError}</p>
                        )}
                        <button
                          onClick={handleTestPortalVerifyOtp}
                          style={{ background: "rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.18)", borderRadius: 100, padding: "10px", color: NAVY, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}
                        >
                          Continue
                        </button>
                        <button onClick={() => { setTestResetStep("idle"); setTestResetOtp(""); setTestError(""); }} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "rgba(14,31,64,0.35)", fontFamily: '"DM Sans",sans-serif', fontSize: 11, textAlign: "center" }}>
                          ← Back to sign in
                        </button>
                      </div>
                    )}

                    {/* ── New password ── */}
                    {testResetStep === "password" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <p style={{ fontSize: 11, color: "rgba(14,31,64,0.45)", margin: 0, textAlign: "center", fontFamily: '"DM Sans",sans-serif' }}>Set a new password</p>
                        <input
                          autoFocus
                          type="password"
                          placeholder="New password (min 8 chars)"
                          value={testResetNewPw}
                          onChange={e => { setTestResetNewPw(e.target.value); setTestError(""); }}
                          onKeyDown={e => { if (e.key === "Enter") handleTestPortalSetPassword(); }}
                          style={{ ...lightInputStyle }}
                        />
                        {testError && (
                          <p style={{ fontSize: 11, color: "#ef4444", margin: 0, textAlign: "center", fontFamily: '"DM Sans",sans-serif' }}>{testError}</p>
                        )}
                        <button
                          onClick={handleTestPortalSetPassword}
                          disabled={testResetLoading}
                          style={{ background: testResetLoading ? "rgba(14,31,64,0.06)" : "rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.18)", borderRadius: 100, padding: "10px", color: NAVY, fontSize: 13, fontWeight: 700, cursor: testResetLoading ? "not-allowed" : "pointer", fontFamily: '"DM Sans",sans-serif' }}
                        >
                          {testResetLoading ? "Saving…" : "Set new password"}
                        </button>
                      </div>
                    )}

                    {/* ── Done ── */}
                    {testResetStep === "done" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <p style={{ fontSize: 12, color: "#3d6b18", margin: 0, textAlign: "center", fontFamily: '"DM Sans",sans-serif', fontWeight: 700 }}>
                          Password updated ✓
                        </p>
                        <button onClick={() => { setTestResetStep("idle"); setTestResetOtp(""); setTestResetNewPw(""); setTestError(""); }} style={{ background: "rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.18)", borderRadius: 100, padding: "10px", color: NAVY, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>
                          Sign in now
                        </button>
                      </div>
                    )}

                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : !loggedIn && role ? (
        /* ── ROLE-AWARE SIGN IN ── */
        <>
          <div style={{ flexShrink: 0, padding: "8px 20px 28px", background: NAVY }}>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.52)", margin: 0, lineHeight: 1.55 }}>
              {role === "admin" ? "Admin access — enter your credentials." : "Staff access — enter your credentials."}
            </p>
          </div>
          <div style={{ flex: 1, overflowY: "auto", background: "#fff", borderRadius: "28px 28px 0 0", padding: "28px 24px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
              <button onClick={() => { setRole(null); setError(""); }} style={{ background: "rgba(14,31,64,0.07)", border: "none", borderRadius: "50%", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: NAVY }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.40)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Change role</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{
                width: 52, height: 52, borderRadius: "50%",
                background: role === "admin" ? GREEN : "rgba(14,31,64,0.07)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {role === "admin"
                  ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={NAVY} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.40)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
              </div>
              <p style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: "-0.02em", textAlign: "center" }}>
                {role === "admin" ? "Admin Sign In" : "Staff Sign In"}
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.50)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Email</label>
              <input type="email" placeholder={role === "admin" ? "admin@lilypad.com" : "you@lilypad.com"} value={email}
                onChange={e => { setEmail(e.target.value); setError(""); }}
                onFocus={() => setEmailFocus(true)} onBlur={() => setEmailFocus(false)}
                style={{ ...lightInputStyle, borderColor: emailFocus ? GREEN : "rgba(14,31,64,0.15)" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.50)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Password</label>
              <input type="password" placeholder="••••••••" value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                onFocus={() => setPwFocus(true)} onBlur={() => setPwFocus(false)}
                onKeyDown={e => { if (e.key === "Enter") handleLogin(); }}
                style={{ ...lightInputStyle, borderColor: pwFocus ? GREEN : "rgba(14,31,64,0.15)" }} />
            </div>
            {error && (
              <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", margin: 0, fontFamily: '"DM Sans", sans-serif' }}>{error}</p>
            )}
            <button onClick={handleLogin} disabled={loginLoading} style={{ background: loginLoading ? "rgba(141,214,63,0.55)" : GREEN, color: NAVY, border: "none", borderRadius: 100, padding: "13px", fontWeight: 800, fontSize: 14, fontFamily: '"DM Sans", sans-serif', cursor: loginLoading ? "not-allowed" : "pointer", marginTop: 4, letterSpacing: "0.01em" }}>
              {loginLoading ? "Signing in…" : `Sign in as ${role === "admin" ? "Admin" : "Staff"}`}
            </button>
            <button
              type="button"
              onClick={() => { setForgotEmail(email); setForgotError(""); setForgotStep("email"); setForgotOpen(true); }}
              style={{ background: "none", border: "none", textAlign: "center", fontSize: 12, color: "rgba(14,31,64,0.45)", margin: 0, cursor: "pointer", fontFamily: '"DM Sans", sans-serif', textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Forgot password?
            </button>
          </div>
        </>
      ) : view === "dashboard" ? (
        /* ── DASHBOARD ── */
        <div style={{ flex: 1, overflowY: "auto", background: "#f5f7fa", borderRadius: "28px 28px 0 0", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: role === "staff" ? "rgba(14,31,64,0.45)" : GREEN, letterSpacing: "0.14em", textTransform: "uppercase", margin: 0 }}>{role === "staff" ? "Staff" : "Admin"}</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: "2px 0 0", letterSpacing: "-0.02em" }}>{(email.split("@")[0]) || (role === "staff" ? "Staff" : "Admin")}</p>
            </div>
            <button onClick={handleSignOut} style={{ background: "#fff", border: "1.5px solid rgba(14,31,64,0.15)", borderRadius: 100, padding: "8px 16px", fontSize: 12, fontWeight: 700, color: NAVY, cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}>Sign out</button>
          </div>

          {/* Financial growth chart — admin only */}
          {role === "admin" && <GrowthChart />}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <StatCard
              label="Total Pads"
              value={adminStats ? String(adminStats.totalSpots) : "—"}
              breakdown={adminStats ? [
                { label: "Active", value: String(adminStats.activeSpots), dot: GREEN },
                { label: "Pending review", value: String(adminStats.pendingSpots), dot: "#F59E0B" },
              ] : []}
            />
            <StatCard
              label="Users"
              value={adminStats ? String(adminStats.totalUsers) : "—"}
              sub={adminStats ? `↑ ${adminStats.newUsersThisWeek} this week` : "Loading…"}
            />
          </div>

          {/* User management entry */}
          <div onClick={() => setView("users")} style={{
            background: "#fff", borderRadius: 18, padding: "16px 18px",
            boxShadow: "0 2px 12px rgba(14,31,64,0.08)",
            display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
            border: "1px solid rgba(14,31,64,0.07)",
          }}>
            <div style={{ width: 42, height: 42, borderRadius: 100, background: `rgba(141,214,63,0.14)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: 0 }}>User Management</p>
              <p style={{ fontSize: 11.5, color: "rgba(14,31,64,0.50)", margin: "2px 0 0" }}>{users.length} accounts · Master controls</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.35)" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
          </div>

          {/* ── Invite Staff — admin only ── */}
          {role === "admin" && (
            <div style={{ background: "#fff", borderRadius: 18, boxShadow: "0 2px 12px rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.07)", overflow: "hidden" }}>
              {/* Header row — always visible, click to expand */}
              <div
                onClick={() => { setInviteCardOpen(o => !o); setInviteCardError(""); setInviteCardSuccess(null); }}
                style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 100, background: "rgba(141,214,63,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: 0 }}>Invite Staff</p>
                  <p style={{ fontSize: 11.5, color: "rgba(14,31,64,0.50)", margin: "2px 0 0" }}>Add a team member · sends invitation email</p>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.35)" strokeWidth="2.5" style={{ transform: inviteCardOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}><path d="m9 18 6-6-6-6"/></svg>
              </div>

              {/* Expandable form */}
              {inviteCardOpen && (
                <div style={{ padding: "0 18px 18px", display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid rgba(14,31,64,0.07)" }}>
                  {inviteCardSuccess ? (
                    <>
                      <div style={{ marginTop: 12, background: "rgba(141,214,63,0.08)", border: "1px solid rgba(141,214,63,0.25)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M20 6L9 17l-5-5"/></svg>
                        <p style={{ fontSize: 13, color: NAVY, margin: 0, lineHeight: 1.5 }}>{inviteCardSuccess}</p>
                      </div>
                      <button
                        onClick={() => { setInviteCardSuccess(null); setInviteCardEmail(""); setInviteCardError(""); }}
                        style={{ width: "100%", padding: "11px", borderRadius: 100, border: "1.5px solid rgba(14,31,64,0.15)", background: "transparent", color: NAVY, fontWeight: 700, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: "pointer" }}
                      >
                        Invite another
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Role toggle */}
                      <div style={{ marginTop: 12, display: "flex", gap: 4, background: "rgba(14,31,64,0.05)", borderRadius: 100, padding: 4 }}>
                        {(["staff", "admin"] as const).map(r => (
                          <button
                            key={r}
                            onClick={() => setInviteCardRole(r)}
                            style={{ flex: 1, padding: "8px", borderRadius: 100, border: "none", background: inviteCardRole === r ? (r === "admin" ? GREEN : NAVY) : "transparent", color: inviteCardRole === r ? (r === "admin" ? NAVY : "#fff") : "rgba(14,31,64,0.45)", fontWeight: 700, fontSize: 12, fontFamily: '"DM Sans",sans-serif', cursor: "pointer", transition: "all 0.15s", textTransform: "capitalize" }}
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
                        style={{ ...lightInputStyle, borderColor: inviteCardError ? "#ef4444" : inviteCardEmailFocus ? GREEN : "rgba(14,31,64,0.15)" }}
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
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "0 0 10px" }}>Revenue & Payouts</p>
              <div style={{ background: "#fff", borderRadius: 18, padding: "28px 20px", boxShadow: "0 2px 12px rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.07)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 120, textAlign: "center" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                <p style={{ fontSize: 14, fontWeight: 700, color: "rgba(14,31,64,0.50)", margin: 0 }}>Payment Analytics Coming Soon</p>
                <p style={{ fontSize: 12, color: "rgba(14,31,64,0.35)", margin: 0, maxWidth: 260 }}>Revenue and payout data will appear here once payment processing is configured</p>
              </div>
            </div>
          )}

        </div>
      ) : view === "service" ? (
        /* ── CUSTOMER SERVICE — Live Chat + Email ── */
        (() => {
          // ── chat tickets ── (change-request tickets are shown in their own "Tickets" tab)
          const changeRequestTickets = tickets.filter(t => t.subject.startsWith("[Change Request]"));
          const chatTickets = tickets.filter(t => !t.subject.startsWith("[Change Request]"));
          const sortedAll = [...chatTickets].sort((a, b) => sortDir === "recent" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt);
          const totalChats = chatTickets.length;
          const openCount     = chatTickets.filter(t => { const p = ticketPipeline(t); return p === "new" || p === "working"; }).length;
          const pendingCount  = chatTickets.filter(t => ticketPipeline(t) === "pending").length;
          const resolvedCount = chatTickets.filter(t => ticketPipeline(t) === "resolved").length;
          const openCRCount   = changeRequestTickets.filter(t => t.status === "open").length;
          const filtered = sortedAll.filter(t => {
            const p = ticketPipeline(t);
            if (pipelineFilter === "open"     && !(p === "new" || p === "working")) return false;
            if (pipelineFilter === "pending"  && p !== "pending")  return false;
            if (pipelineFilter === "resolved" && p !== "resolved") return false;
            if (audienceFilter !== "all" && t.accountType !== audienceFilter) return false;
            return true;
          });
          const selected = selectedTicketId ? sortedAll.find(t => t.id === selectedTicketId) || null : null;
          const selectedCR = selectedTicketId ? changeRequestTickets.find(t => t.id === selectedTicketId) || null : null;

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
              <div style={{ flex: 1, overflowY: "auto", background: "#f5f7fa", borderRadius: "28px 28px 0 0", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => setSelectedEmailId(null)} style={{ background: "#fff", border: "1px solid rgba(14,31,64,0.12)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: NAVY, flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Email · Read-only</p>
                    <p style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: "2px 0 0", letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject}</p>
                  </div>
                  <button onClick={() => markEmailRead(e.id, !e.read)} style={{ background: e.read ? "rgba(14,31,64,0.06)" : "rgba(141,214,63,0.18)", color: e.read ? "rgba(14,31,64,0.55)" : GREEN, border: `1px solid ${e.read ? "rgba(14,31,64,0.10)" : "rgba(141,214,63,0.30)"}`, borderRadius: 100, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', flexShrink: 0 }}>{e.read ? "Mark unread" : "Mark read"}</button>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "12px 14px", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, alignItems: "center", border: "1px solid rgba(14,31,64,0.08)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)" }}>
                  <div><span style={{ color: "rgba(14,31,64,0.45)" }}>From </span><span style={{ color: NAVY, fontWeight: 700 }}>{e.fromName}</span></div>
                  <div><span style={{ color: "rgba(14,31,64,0.45)" }}>Email </span><span style={{ color: NAVY, fontWeight: 700 }}>{e.fromAddress}</span></div>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, color: emailAudPillFg(e.accountType), background: emailAudPillBg(e.accountType) }}>{emailAudienceLabel(e.accountType)}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, color: "rgba(14,31,64,0.60)", background: "rgba(14,31,64,0.07)" }}>{emailCategoryLabel(e.category)}</span>
                  <div><span style={{ color: "rgba(14,31,64,0.45)" }}>Received </span><span style={{ color: NAVY, fontWeight: 700 }}>{formatEmailTime(e.receivedAt)}</span></div>
                </div>
                <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", color: NAVY, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid rgba(14,31,64,0.08)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)" }}>
                  {e.body}
                </div>
                <p style={{ fontSize: 11.5, color: "rgba(14,31,64,0.40)", margin: 0, fontStyle: "italic", padding: "0 4px" }}>This view is read-only. Replies happen outside the app.</p>
              </div>
            );
          }

          if (false && selected) {
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
            <div style={{ flex: 1, overflowY: "auto", background: "#f5f7fa", borderRadius: "28px 28px 0 0", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Customer Service</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: "2px 0 0", letterSpacing: "-0.02em" }}>Customer interaction</p>
              </div>

              {/* ── Sub-tab toggle: Email / Tickets ── */}
              <div style={{ display: "flex", gap: 4, background: "rgba(14,31,64,0.06)", borderRadius: 100, padding: 4 }}>
                {([
                  { key: "email" as ServiceTab, label: "Email", count: totalEmails, accent: unreadEmails },
                  { key: "tickets" as ServiceTab, label: "Tickets", count: changeRequestTickets.length, accent: openCRCount },
                ]).map(t => {
                  const active = serviceTab === t.key;
                  return (
                    <button key={t.key} onClick={() => { setServiceTab(t.key); setSelectedTicketId(null); setSelectedEmailId(null); setResolveOpen(false); setPendingReply(null); resetResolutionAuthFields(); }} style={{ flex: 1, padding: "9px 8px", borderRadius: 100, border: "none", background: active ? GREEN : "transparent", color: active ? NAVY : "rgba(14,31,64,0.50)", fontWeight: 800, fontSize: 11.5, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <span>{t.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 6px", borderRadius: 100, background: active ? "rgba(14,31,64,0.16)" : "rgba(14,31,64,0.10)", color: active ? NAVY : "rgba(14,31,64,0.55)" }}>{t.count}</span>
                      {t.accent > 0 && !active && (
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN, boxShadow: "0 0 0 3px rgba(141,214,63,0.25)", flexShrink: 0 }} />
                      )}
                    </button>
                  );
                })}
              </div>

              {serviceTab === "tickets" ? (
                /* ── CHANGE REQUEST TICKETS ── */
                (() => {
                  const crSorted = [...changeRequestTickets].sort((a, b) => b.updatedAt - a.updatedAt);

                  function parseCRPayload(t: SupportTicket): { field?: string; current?: string; requested?: string; padName?: string; spotId?: string; hostName?: string; hostEmail?: string; hostPhone?: string } {
                    try {
                      const firstMsg = t.messages[0];
                      if (!firstMsg) return {};
                      const p = JSON.parse(firstMsg.text);
                      if (p?.type === "change_request") return p;
                    } catch {}
                    return {};
                  }

                  async function markInProgress(id: string) {
                    try {
                      await fetch(`/api/support/conversations/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: "in_progress" }),
                      });
                      refreshTickets();
                    } catch {}
                  }

                  async function resolveTicket(id: string) {
                    try {
                      await fetch(`/api/support/conversations/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status: "resolved" }),
                      });
                      refreshTickets();
                    } catch {}
                  }

                  if (selectedCR) {
                    const cr = parseCRPayload(selectedCR);
                    const statusColor = selectedCR.status === "resolved" ? "#9DBEFF" : selectedCR.status === "in_progress" ? "#F59E0B" : GREEN;
                    const statusLabel = selectedCR.status === "resolved" ? "Resolved" : selectedCR.status === "in_progress" ? "In progress" : "New · Needs review";
                    return (
                      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <button onClick={() => setSelectedTicketId(null)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", color: "rgba(255,255,255,0.65)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', padding: 0, alignSelf: "flex-start" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                          All tickets
                        </button>

                        {/* Status pill */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "3px 10px", borderRadius: 100, color: statusColor, background: `${statusColor}22`, border: `1px solid ${statusColor}44` }}>{statusLabel}</span>
                          <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.45)" }}>{formatSupportTime(selectedCR.createdAt)}</span>
                        </div>

                        {/* Host profile card */}
                        <div style={{ background: "#fff", borderRadius: 16, padding: "14px 16px", border: "1px solid rgba(14,31,64,0.08)", boxShadow: "0 2px 10px rgba(14,31,64,0.06)", display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(14,31,64,0.40)", letterSpacing: "0.10em", textTransform: "uppercase" }}>Host profile</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(141,214,63,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 17, fontWeight: 800, color: GREEN }}>
                              {(cr.hostName || selectedCR.userName || "H").charAt(0).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 800, color: NAVY }}>{cr.hostName || selectedCR.userName || "—"}</div>
                              {(cr.hostEmail || selectedCR.userEmail) && (
                                <a href={`mailto:${cr.hostEmail || selectedCR.userEmail}`} style={{ fontSize: 12, color: GREEN, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                                  {cr.hostEmail || selectedCR.userEmail}
                                </a>
                              )}
                              {cr.hostPhone && (
                                <a href={`tel:${cr.hostPhone}`} style={{ fontSize: 12, color: "rgba(14,31,64,0.55)", fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.48 2 2 0 0 1 3.62 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.16 6.16l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                  {cr.hostPhone}
                                </a>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Request detail */}
                        <div style={{ background: "#fff", borderRadius: 16, padding: "14px 16px", border: "1px solid rgba(14,31,64,0.08)", boxShadow: "0 2px 10px rgba(14,31,64,0.06)", display: "flex", flexDirection: "column", gap: 10 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(14,31,64,0.40)", letterSpacing: "0.10em", textTransform: "uppercase" }}>Change request details</div>
                          {cr.field && (
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>Field</div>
                              <div style={{ fontSize: 13.5, fontWeight: 700, color: NAVY }}>{cr.field}</div>
                            </div>
                          )}
                          {cr.padName && (
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>Pad</div>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: "rgba(14,31,64,0.75)" }}>{cr.padName}</div>
                            </div>
                          )}
                          {cr.current && (
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>Current value</div>
                              <div style={{ fontSize: 13, color: "rgba(14,31,64,0.55)" }}>{cr.current}</div>
                            </div>
                          )}
                          {cr.requested && (
                            <div>
                              <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.38)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>Requested change</div>
                              <div style={{ fontSize: 13.5, fontWeight: 600, color: NAVY, background: "rgba(141,214,63,0.08)", border: "1px solid rgba(141,214,63,0.25)", borderRadius: 10, padding: "10px 12px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{cr.requested}</div>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        {selectedCR.status !== "resolved" && (
                          <div style={{ display: "flex", gap: 8 }}>
                            {selectedCR.status === "open" && (
                              <button onClick={() => markInProgress(selectedCR.id)} style={{ flex: 1, padding: "11px", borderRadius: 100, border: "1px solid rgba(245,158,11,0.40)", background: "rgba(245,158,11,0.10)", color: "#F59E0B", fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>
                                Mark in progress
                              </button>
                            )}
                            <button onClick={() => resolveTicket(selectedCR.id)} style={{ flex: 1, padding: "11px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 12.5, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>
                              {selectedCR.status === "in_progress" ? "Mark resolved" : "Resolve ticket"}
                            </button>
                          </div>
                        )}
                        {selectedCR.status === "resolved" && (
                          <div style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.40)", fontStyle: "italic" }}>This ticket has been resolved.</div>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1, background: "#fff", borderRadius: 14, padding: "12px 14px", textAlign: "center", border: "1px solid rgba(14,31,64,0.07)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)" }}>
                          <div style={{ fontSize: 22, fontWeight: 800, color: NAVY, letterSpacing: "-0.02em" }}>{changeRequestTickets.length}</div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", marginTop: 2 }}>Total</div>
                        </div>
                        <div style={{ flex: 1, background: "#fff", borderRadius: 14, padding: "12px 14px", textAlign: "center", border: "1px solid rgba(14,31,64,0.07)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)" }}>
                          <div style={{ fontSize: 22, fontWeight: 800, color: openCRCount > 0 ? GREEN : NAVY, letterSpacing: "-0.02em" }}>{openCRCount}</div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", marginTop: 2 }}>Open</div>
                        </div>
                        <div style={{ flex: 1, background: "#fff", borderRadius: 14, padding: "12px 14px", textAlign: "center", border: "1px solid rgba(14,31,64,0.07)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)" }}>
                          <div style={{ fontSize: 22, fontWeight: 800, color: "#5B8BDF", letterSpacing: "-0.02em" }}>{changeRequestTickets.filter(t => t.status === "resolved").length}</div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", marginTop: 2 }}>Resolved</div>
                        </div>
                      </div>

                      {crSorted.length === 0 ? (
                        <div style={{ background: "#fff", borderRadius: 18, padding: "36px 22px", textAlign: "center", color: "rgba(14,31,64,0.40)", fontSize: 13, border: "1px solid rgba(14,31,64,0.07)" }}>
                          No change request tickets yet. When a host requests a locked-field update, it appears here.
                        </div>
                      ) : (
                        crSorted.map(t => {
                          const cr = parseCRPayload(t);
                          const isOpen = t.status === "open";
                          const isInProgress = t.status === "in_progress";
                          const isResolved = t.status === "resolved";
                          const statusColor = isResolved ? "#5B8BDF" : isInProgress ? "#F59E0B" : GREEN;
                          const statusLabel = isResolved ? "Resolved" : isInProgress ? "In progress" : "New";
                          return (
                            <div
                              key={t.id}
                              onClick={() => setSelectedTicketId(t.id)}
                              style={{ background: "#fff", borderRadius: 14, padding: "12px 14px", cursor: "pointer", border: isOpen ? `1px solid rgba(141,214,63,0.35)` : "1px solid rgba(14,31,64,0.07)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)", display: "flex", flexDirection: "column", gap: 8 }}
                            >
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(141,214,63,0.14)", color: GREEN, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cr.field || t.subject}</div>
                                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>{cr.padName || "—"}</div>
                                  </div>
                                </div>
                                <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", padding: "3px 8px", borderRadius: 100, color: statusColor, background: `${statusColor}22`, flexShrink: 0 }}>{statusLabel}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                                {cr.hostName || t.userName}{cr.hostEmail || t.userEmail ? ` · ${cr.hostEmail || t.userEmail}` : ""}
                              </div>
                              {cr.requested && (
                                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.70)", background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "6px 9px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {cr.requested}
                                </div>
                              )}
                              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.35)" }}>{formatSupportTime(t.createdAt)}</div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  );
                })()
              ) : (
                <>
                  {/* ── Email overall summary ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <button onClick={() => setEmailUnreadOnly(false)} style={{ background: "#fff", borderRadius: 14, padding: 12, textAlign: "center", border: !emailUnreadOnly ? `1px solid ${NAVY}` : "1px solid rgba(14,31,64,0.08)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)", cursor: "pointer", color: "inherit", fontFamily: '"DM Sans",sans-serif' }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: "-0.02em" }}>{totalEmails}</p>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.50)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Total inbox</p>
                    </button>
                    <button onClick={() => setEmailUnreadOnly(true)} style={{ background: "#fff", borderRadius: 14, padding: 12, textAlign: "center", border: emailUnreadOnly ? `1px solid ${GREEN}` : "1px solid rgba(14,31,64,0.08)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)", cursor: "pointer", color: "inherit", fontFamily: '"DM Sans",sans-serif' }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color: GREEN, margin: 0, letterSpacing: "-0.02em" }}>{unreadEmails}</p>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.50)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Unread</p>
                    </button>
                  </div>

                  {/* ── Email filters ── */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 4, background: "rgba(14,31,64,0.06)", borderRadius: 100, padding: 4 }}>
                      {([
                        { key: "all" as EmailAudienceFilter, label: "All accounts" },
                        { key: "renter" as EmailAudienceFilter, label: "Renters" },
                        { key: "padRenter" as EmailAudienceFilter, label: "Listers" },
                        { key: "guest" as EmailAudienceFilter, label: "Guests" },
                      ]).map(f => (
                        <button key={f.key} onClick={() => setEmailAudienceFilter(f.key)} style={{ flex: 1, padding: "7px 6px", borderRadius: 100, border: "none", background: emailAudienceFilter === f.key ? "#fff" : "transparent", color: emailAudienceFilter === f.key ? NAVY : "rgba(14,31,64,0.50)", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>{f.label}</button>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <div style={{ flex: 1, display: "flex", gap: 4, background: "rgba(14,31,64,0.06)", borderRadius: 100, padding: 4, overflowX: "auto" }}>
                        {(["all", "billing", "account", "support", "feedback", "other"] as EmailCategoryFilter[]).map(c => (
                          <button key={c} onClick={() => setEmailCategoryFilter(c)} style={{ padding: "7px 12px", borderRadius: 100, border: "none", background: emailCategoryFilter === c ? GREEN : "transparent", color: emailCategoryFilter === c ? NAVY : "rgba(14,31,64,0.55)", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', whiteSpace: "nowrap" }}>{c === "all" ? "All topics" : emailCategoryLabel(c as EmailCategory)}</button>
                        ))}
                      </div>
                      <button onClick={() => setEmailSortDir(d => d === "recent" ? "oldest" : "recent")} style={{ background: "#fff", border: "1px solid rgba(14,31,64,0.12)", borderRadius: 100, padding: "7px 14px", color: "rgba(14,31,64,0.65)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', display: "flex", alignItems: "center", gap: 6 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          {emailSortDir === "recent" ? <path d="M12 5v14m-6-6 6 6 6-6"/> : <path d="M12 19V5m-6 6 6-6 6 6"/>}
                        </svg>
                        {emailSortDir === "recent" ? "Newest" : "Oldest"}
                      </button>
                    </div>
                  </div>

                  {filteredEmails.length === 0 ? (
                    <div style={{ background: "#fff", borderRadius: 18, padding: "32px 22px", textAlign: "center", color: "rgba(14,31,64,0.40)", fontSize: 13, border: "1px solid rgba(14,31,64,0.07)" }}>
                      {totalEmails === 0 ? "Inbox is empty." : "No emails match these filters."}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {filteredEmails.map(e => (
                        <div key={e.id} onClick={() => { setSelectedEmailId(e.id); markEmailRead(e.id, true); }} style={{ background: "#fff", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", border: !e.read ? `1px solid rgba(141,214,63,0.40)` : "1px solid rgba(14,31,64,0.07)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)", position: "relative" }}>
                          {!e.read && (
                            <span style={{ position: "absolute", top: 10, right: 10, width: 8, height: 8, borderRadius: "50%", background: GREEN, boxShadow: "0 0 0 3px rgba(141,214,63,0.20)" }} />
                          )}
                          <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(91,139,223,0.12)", color: "#5B8BDF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: e.read ? 700 : 800, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject}</span>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: emailAudPillFg(e.accountType), background: emailAudPillBg(e.accountType) }}>{emailAudienceLabel(e.accountType)}</span>
                              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: "rgba(14,31,64,0.60)", background: "rgba(14,31,64,0.07)" }}>{emailCategoryLabel(e.category)}</span>
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(14,31,64,0.50)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.fromName} · {e.fromAddress}
                            </div>
                            <div style={{ fontSize: 11.5, color: "rgba(14,31,64,0.60)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {e.preview}
                            </div>
                          </div>
                          <div style={{ fontSize: 10.5, color: "rgba(14,31,64,0.40)", flexShrink: 0 }}>{formatEmailTime(e.receivedAt)}</div>
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
            <div style={{ flex: 1, overflowY: "auto", background: "#f5f7fa", borderRadius: "28px 28px 0 0", padding: "24px 20px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Admin · Staff</p>
                <p style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: "2px 0 0", letterSpacing: "-0.02em" }}>Team accounts</p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div style={{ background: "#fff", borderRadius: 14, padding: "12px", textAlign: "center", border: "1px solid rgba(14,31,64,0.07)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)" }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: "-0.02em" }}>{staffList.length}</p>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Total</p>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "12px", textAlign: "center", border: "1px solid rgba(14,31,64,0.07)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)" }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: GREEN, margin: 0, letterSpacing: "-0.02em" }}>{activeCount}</p>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Active</p>
                </div>
                <div style={{ background: "#fff", borderRadius: 14, padding: "12px", textAlign: "center", border: "1px solid rgba(14,31,64,0.07)", boxShadow: "0 2px 8px rgba(14,31,64,0.06)" }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: 0, letterSpacing: "-0.02em" }}>{adminCount}</p>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: "2px 0 0" }}>Admins</p>
                </div>
              </div>

              {/* ── Email Activation — self-serve OTP flow ── */}
              <div style={{ background: "#fff", borderRadius: 18, padding: "16px 18px", boxShadow: "0 2px 12px rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.07)", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Team invitation</p>
                    <p style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "2px 0 0" }}>{inviteStep === "success" ? "Invite sent!" : "Add team member"}</p>
                  </div>
                  <div style={{ width: 36, height: 36, borderRadius: 100, background: "rgba(141,214,63,0.14)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  </div>
                </div>
                {inviteStep === "success" ? (
                  <>
                    <div style={{ background: "rgba(141,214,63,0.10)", border: "1px solid rgba(141,214,63,0.30)", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: GREEN, margin: 0 }}>Invite sent!</p>
                        <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", margin: "2px 0 0" }}>An activation link was emailed to the new {inviteRole}. They'll appear here once they activate.</p>
                      </div>
                    </div>
                    <button onClick={resetActivation} style={{ width: "100%", padding: "11px", borderRadius: 100, border: "1.5px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.70)", fontWeight: 700, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: "pointer" }}>Invite another</button>
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
                          const r = await fetch("/api/staff/invite", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ email: em, role: inviteRole }),
                          });
                          const data = await r.json();
                          if (!r.ok) { setInviteError(data.error || "Failed to send invite. Try again."); return; }
                          setInviteStep("success");
                          setInviteEmail("");
                        } catch { setInviteError("Network error. Try again."); }
                        finally { setInviteLoading(false); }
                      }}
                      style={{ width: "100%", padding: "12px", borderRadius: 100, border: "none", background: inviteLoading ? "rgba(141,214,63,0.50)" : GREEN, color: NAVY, fontWeight: 800, fontSize: 13, fontFamily: '"DM Sans",sans-serif', cursor: inviteLoading ? "not-allowed" : "pointer", letterSpacing: "0.01em" }}
                    >
                      {inviteLoading ? "Sending invite…" : "Add & send invite"}
                    </button>
                    <p style={{ fontSize: 11, color: "rgba(255,255,255,0.30)", margin: 0, lineHeight: 1.4 }}>Adds to the team list and emails them an activation link.</p>
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
                      background: "#fff", borderRadius: 16, padding: "14px 16px",
                      boxShadow: "0 2px 12px rgba(14,31,64,0.08)",
                      border: "1px solid rgba(14,31,64,0.07)",
                      display: "flex", flexDirection: "column", gap: 12,
                      opacity: suspended ? 0.65 : 1,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: "50%",
                          background: isAdmin ? "rgba(141,214,63,0.18)" : "rgba(14,31,64,0.07)",
                          color: isAdmin ? GREEN : NAVY,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontWeight: 800, fontSize: 14, flexShrink: 0,
                        }}>{(s.firstName[0] + s.lastName[0]).toUpperCase()}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 14, fontWeight: 800, color: NAVY, letterSpacing: "-0.01em" }}>{displayName}</span>
                            <span style={{
                              fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
                              padding: "2px 7px", borderRadius: 100,
                              color: isAdmin ? GREEN : "rgba(14,31,64,0.55)",
                              background: isAdmin ? "rgba(141,214,63,0.14)" : "rgba(14,31,64,0.07)",
                            }}>{s.role}</span>
                            {suspended && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 100, color: "#ef4444", background: "rgba(239,68,68,0.10)" }}>Suspended</span>
                            )}
                          </div>
                          <p style={{ fontSize: 11.5, color: "rgba(14,31,64,0.50)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.email}</p>
                          <p style={{ fontSize: 10.5, color: "rgba(14,31,64,0.35)", margin: "1px 0 0" }}>Last sign-in · {s.lastSignIn}</p>
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
                            background: suspended ? "rgba(141,214,63,0.12)" : "rgba(239,68,68,0.08)",
                            color: suspended ? GREEN : "#ef4444",
                            border: `1px solid ${suspended ? "rgba(141,214,63,0.25)" : "rgba(239,68,68,0.18)"}`,
                            borderRadius: 100, padding: "7px 14px",
                            fontSize: 11, fontWeight: 800, cursor: "pointer",
                            fontFamily: '"DM Sans",sans-serif', flexShrink: 0,
                          }}
                        >
                          {suspended ? "Reinstate" : "Suspend"}
                        </button>
                      </div>

                      {/* Performance scorecard — review summary for this staff member. */}
                      <div style={{ borderTop: "1px solid rgba(14,31,64,0.08)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <p style={{ fontSize: 10, fontWeight: 800, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Performance review</p>
                          {qa ? (
                            <span style={{ fontSize: 10, color: "rgba(14,31,64,0.40)", fontWeight: 700 }}>
                              {qa.count} reply{qa.count === 1 ? "" : "s"} · {qa.ticketCount} chat{qa.ticketCount === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span style={{ fontSize: 10, color: "rgba(14,31,64,0.35)", fontWeight: 700 }}>No graded replies yet</span>
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
        <div style={{ flex: 1, overflowY: "auto", background: "#f5f7fa", borderRadius: "28px 28px 0 0", padding: "20px 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setView("dashboard")} style={{ background: "#fff", border: "1px solid rgba(14,31,64,0.12)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: NAVY, flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Admin · Users</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: "1px 0 0", letterSpacing: "-0.02em" }}>All Accounts</p>
            </div>
          </div>

          {/* Section toggle: ACCOUNTS | PAD QUEUE | PENDING */}
          <div style={{ background: "rgba(14,31,64,0.06)", borderRadius: 100, padding: 4, display: "flex" }}>
            {([
              { id: "accounts" as const, label: "Accounts" },
              { id: "padqueue" as const, label: "Pad Queue", badge: pendingSpots.length },
              { id: "pending"  as const, label: "Pending", badge: earlySignups.filter(s => s.status === "pending").length },
            ]).map(t => {
              const active = usersSection === t.id;
              return (
                <button key={t.id} onClick={() => setUsersSection(t.id)} style={{
                  flex: 1, padding: "9px 8px", borderRadius: 100,
                  background: active ? NAVY : "transparent",
                  color: active ? "#fff" : "rgba(14,31,64,0.50)",
                  border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  fontFamily: '"DM Sans",sans-serif', display: "flex",
                  alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.15s",
                }}>
                  {t.label}
                  {(t as any).badge !== undefined && (t as any).badge > 0 && (
                    <span style={{ background: "#E53E3E", color: "#fff", fontSize: 10, fontWeight: 800, borderRadius: 100, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{(t as any).badge}</span>
                  )}
                </button>
              );
            })}
          </div>

          {usersSection === "accounts" && (<>
          {/* Renter / Host segmented toggle */}
          <div style={{ background: "rgba(14,31,64,0.06)", borderRadius: 100, padding: 4, display: "flex", gap: 0 }}>
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
                  flex: 1, padding: "9px 8px", borderRadius: 100,
                  background: active ? NAVY : "transparent",
                  color: active ? "#fff" : "rgba(14,31,64,0.50)",
                  border: "none",
                  fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif',
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, letterSpacing: 0.3,
                  transition: "all 0.15s",
                }}>
                  {t.icon}
                  <span>{t.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>({t.count})</span>
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px", marginTop: -4 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.40)", letterSpacing: 0.8, textTransform: "uppercase" }}>
              Sorted by {adminView === "hosts" ? "earnings" : "spend"} · highest first
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(14,31,64,0.40)" }}>
              {filteredUsers.length} shown
            </span>
          </div>

          {/* Search */}
          <input
            type="text" placeholder="Search by name or email"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...lightInputStyle, padding: "11px 14px", fontSize: 13.5 }}
          />

          {/* User list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filteredUsers.length === 0 && (
              <p style={{ textAlign: "center", color: "rgba(14,31,64,0.40)", padding: "24px 0", fontSize: 13 }}>No users match.</p>
            )}
            {filteredUsers.map(u => (
              <div key={u.id} onClick={() => { setSelectedUserId(u.id); setView("userDetail"); }} style={{
                background: "#fff", borderRadius: 14, padding: "12px 14px",
                boxShadow: "0 2px 10px rgba(14,31,64,0.07)",
                border: "1px solid rgba(14,31,64,0.07)",
                display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
              }}>
                <Avatar user={u} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{u.firstName} {u.lastName}</span>
                    {u.verified && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill={GREEN}><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 14.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/></svg>
                    )}
                    {u.status === "suspended" && (
                      <span style={{ fontSize: 9, fontWeight: 800, color: "#ef4444", background: "rgba(239,68,68,0.10)", padding: "2px 6px", borderRadius: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>Suspended</span>
                    )}
                  </div>
                  <p style={{ fontSize: 11.5, color: "rgba(14,31,64,0.50)", margin: "1px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: "rgba(14,31,64,0.45)", fontWeight: 600 }}>{u.bookingsThisMonth} booking{u.bookingsThisMonth !== 1 ? "s" : ""}</span>
                  {u.type === "both" && <TypeBadge type="both" />}
                </div>
              </div>
            ))}
          </div>
          </>)}

          {/* ── PAD APPROVAL QUEUE ── */}
          {usersSection === "padqueue" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: 0.8, textTransform: "uppercase" }}>
                  {pendingSpots.length} spot{pendingSpots.length !== 1 ? "s" : ""} awaiting review
                </span>
                <button onClick={fetchPendingSpots} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, padding: "5px 10px", color: "rgba(255,255,255,0.70)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>↻ Refresh</button>
              </div>

              {loadingPending ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Loading…</div>
              ) : pendingSpots.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                  <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: 600, margin: 0 }}>No spots awaiting approval</p>
                  <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, margin: "6px 0 0" }}>New listings will appear here for review</p>
                </div>
              ) : pendingSpots.map(s => (
                <div
                  key={s.id}
                  onClick={() => setSelectedSpot(s)}
                  style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(14,31,64,0.10)", border: "1px solid rgba(14,31,64,0.08)", cursor: "pointer", position: "relative" }}
                >
                  {s.photo_url && (
                    <div style={{ position: "relative" }}>
                      <img src={s.photo_url} alt="Pad photo" style={{ width: "100%", height: 160, objectFit: "cover", display: "block" }} />
                      {(s.photo_urls?.length ?? 0) > 1 && (
                        <span style={{ position: "absolute", bottom: 8, right: 8, background: "rgba(0,0,0,0.60)", color: "#fff", fontSize: 10.5, fontWeight: 700, borderRadius: 20, padding: "3px 9px" }}>
                          +{s.photo_urls.length - 1} more
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(141,214,63,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: NAVY }}>{s.host_name || "Unknown Host"}</p>
                        <p style={{ margin: 0, fontSize: 11, color: "rgba(14,31,64,0.50)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.host_email}</p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <span style={{ background: "rgba(246,200,0,0.15)", color: "#CC9900", fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 100, letterSpacing: "0.06em", textTransform: "uppercase" }}>Pending</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.30)" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                      </div>
                    </div>
                    <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700, color: NAVY, lineHeight: 1.35 }}>{s.spot_name || s.address}</p>
                    {s.spot_name && <p style={{ margin: "0 0 8px", fontSize: 11.5, color: "rgba(14,31,64,0.50)" }}>{s.address}</p>}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.55)", background: "rgba(14,31,64,0.06)", borderRadius: 6, padding: "3px 8px" }}>{s.pad_type}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.55)", background: "rgba(14,31,64,0.06)", borderRadius: 6, padding: "3px 8px" }}>{s.num_pads} pad{s.num_pads !== 1 ? "s" : ""}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: GREEN }}>${s.price_per_hr}/hr</span>
                    </div>
                    <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "rgba(14,31,64,0.40)", fontWeight: 600 }}>Tap to review all photos & details →</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── EARLY ACCESS PENDING SIGNUPS ── */}
          {usersSection === "pending" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: 0.8, textTransform: "uppercase" }}>
                  {earlySignups.length} signup{earlySignups.length !== 1 ? "s" : ""} total
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={fetchEarlySignups} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 8, padding: "5px 10px", color: "rgba(255,255,255,0.70)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>↻ Refresh</button>
                  <button onClick={exportEarlySignupsPDF} style={{ background: `${GREEN}22`, border: `1px solid ${GREEN}44`, borderRadius: 8, padding: "5px 10px", color: GREEN, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}>⬇ Export PDF</button>
                </div>
              </div>

              {loadingEarlySignups ? (
                <div style={{ textAlign: "center", padding: "40px 0", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Loading…</div>
              ) : earlySignupsTableReady === false ? (
                <div style={{ background: "rgba(246,200,0,0.08)", border: "1px solid rgba(246,200,0,0.22)", borderRadius: 14, padding: "18px 16px" }}>
                  <p style={{ fontSize: 13, fontWeight: 800, color: "#F6C800", margin: "0 0 6px" }}>⚠ Database table not set up yet</p>
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", margin: "0 0 10px", lineHeight: 1.6 }}>
                    The early access signups table doesn't exist in Supabase yet. Run the setup SQL to enable the Pending tab.
                  </p>
                  <a
                    href="https://supabase.com/dashboard/project/mcfxoimaqgpyntvasbsw/sql/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-block", background: "#F6C800", color: "#0E1F40", fontSize: 12, fontWeight: 800, padding: "8px 14px", borderRadius: 8, textDecoration: "none" }}
                  >
                    Open Supabase SQL Editor →
                  </a>
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", margin: "8px 0 0" }}>
                    Or visit <code style={{ background: "rgba(255,255,255,0.08)", padding: "1px 4px", borderRadius: 3 }}>/early-access-sql</code> in your app to get a clean, minimal SQL snippet (no DO blocks — guaranteed to run without errors).
                  </p>
                </div>
              ) : earlySignups.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🪷</div>
                  <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, fontWeight: 600, margin: 0 }}>No early access signups yet</p>
                  <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, margin: "6px 0 0" }}>Signups will appear here when EARLY_ACCESS mode is enabled</p>
                </div>
              ) : earlySignups.map(s => {
                const expanded = expandedSignupId === s.id;
                const approved = s.status === "approved";
                return (
                  <div key={s.id} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 2px 12px rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.08)" }}>
                    {/* Row header — always visible */}
                    <div
                      onClick={() => setExpandedSignupId(expanded ? null : s.id)}
                      style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                    >
                      <div style={{ width: 38, height: 38, borderRadius: "50%", background: approved ? `${GREEN}22` : "rgba(246,200,0,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={approved ? GREEN : "#F6C800"} strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#fff" }}>{s.name}</p>
                        <p style={{ margin: "1px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.50)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.email}</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", padding: "2px 8px", borderRadius: 100, background: approved ? `${GREEN}22` : "rgba(246,200,0,0.15)", color: approved ? GREEN : "#F6C800" }}>
                          {approved ? "Approved" : "Pending"}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.35)", textTransform: "capitalize" }}>{s.role === "both" ? "Driver + Host" : s.role}</span>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.18s" }}>
                        <path d="M9 18l6-6-6-6"/>
                      </svg>
                    </div>

                    {/* Expanded detail */}
                    {expanded && (
                      <div style={{ padding: "0 16px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: 12, paddingTop: 14 }}>
                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px" }}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.40)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 3px" }}>Submitted</p>
                            <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0 }}>{new Date(s.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                          </div>
                          <div style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 12px" }}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.40)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 3px" }}>Role</p>
                            <p style={{ fontSize: 13, fontWeight: 600, color: "#fff", margin: 0, textTransform: "capitalize" }}>{s.role === "both" ? "Driver + Host" : s.role}</p>
                          </div>
                        </div>

                        {/* Notes */}
                        <div>
                          <p style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 6px" }}>Notes</p>
                          <textarea
                            value={signupNotes[s.id] ?? ""}
                            onChange={e => setSignupNotes(prev => ({ ...prev, [s.id]: e.target.value }))}
                            placeholder="Add internal notes…"
                            rows={2}
                            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 13, fontFamily: '"DM Sans",sans-serif', resize: "vertical", outline: "none" }}
                          />
                        </div>

                        <div style={{ display: "flex", gap: 8 }}>
                          {!approved && (
                            <button
                              onClick={() => approveEarlySignup(s.id)}
                              disabled={savingSignupId === s.id}
                              style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "none", background: savingSignupId === s.id ? "rgba(255,255,255,0.08)" : GREEN, color: savingSignupId === s.id ? "rgba(255,255,255,0.35)" : "#0E1F40", fontSize: 13, fontWeight: 800, cursor: savingSignupId === s.id ? "not-allowed" : "pointer", fontFamily: '"DM Sans",sans-serif' }}
                            >
                              {savingSignupId === s.id ? "Saving…" : "✓ Approve"}
                            </button>
                          )}
                          {approved && (
                            <div style={{ flex: 1, padding: "10px 12px", borderRadius: 10, background: `${GREEN}18`, border: `1px solid ${GREEN}44`, textAlign: "center" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>✓ Approved</span>
                            </div>
                          )}
                          <button
                            onClick={() => saveSignupNotes(s.id)}
                            disabled={savingSignupId === s.id}
                            style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.70)", fontSize: 13, fontWeight: 700, cursor: savingSignupId === s.id ? "not-allowed" : "pointer", fontFamily: '"DM Sans",sans-serif' }}
                          >
                            Save notes
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : selectedUser ? (
        /* ── USER DETAIL DASHBOARD ── */
        <div style={{ flex: 1, overflowY: "auto", background: "#f5f7fa", borderRadius: "28px 28px 0 0", padding: "20px 20px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => { setView("users"); setSelectedUserId(null); }} style={{ background: "#fff", border: "1px solid rgba(14,31,64,0.12)", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: NAVY, flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.12em", textTransform: "uppercase", margin: 0 }}>Admin · User Detail</p>
          </div>

          {/* Profile header */}
          <div style={{ background: "#fff", borderRadius: 18, padding: "18px", boxShadow: "0 2px 12px rgba(14,31,64,0.08)", border: "1px solid rgba(14,31,64,0.07)", display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar user={selectedUser} size={64} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: "-0.02em" }}>{selectedUser.firstName} {selectedUser.lastName}</span>
                <TypeBadge type={selectedUser.type} />
              </div>
              <p style={{ fontSize: 12, color: "rgba(14,31,64,0.50)", margin: "2px 0 0" }}>ID #{selectedUser.id} · Joined {selectedUser.joined}</p>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <div style={{ background: "#fff", borderRadius: 14, padding: "12px 14px", boxShadow: "0 2px 10px rgba(14,31,64,0.07)", border: "1px solid rgba(14,31,64,0.07)" }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: "0.10em", textTransform: "uppercase", margin: 0 }}>Bookings (all time)</p>
              <p style={{ fontSize: 22, fontWeight: 800, color: NAVY, margin: "2px 0 0", letterSpacing: "-0.02em" }}>{selectedUser.bookingsThisMonth}</p>
            </div>
          </div>

          {/* Personal info — editable */}
          <div>
            <SectionHeader>Personal Info</SectionHeader>
            <div style={{ background: "#fff", borderRadius: 14, padding: "4px 14px", boxShadow: "0 2px 10px rgba(14,31,64,0.07)", border: "1px solid rgba(14,31,64,0.07)" }}>
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
                <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(14,31,64,0.45)" }}>{selectedUser.pads.length} pad{selectedUser.pads.length !== 1 ? "s" : ""}</span>
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
            <div style={{ background: "#fff", borderRadius: 14, padding: "12px 14px", boxShadow: "0 2px 10px rgba(14,31,64,0.07)", border: "1px solid rgba(14,31,64,0.07)" }}>
              <textarea
                value={selectedUser.internalNote || ""}
                onChange={e => updateUser(selectedUser.id, { internalNote: e.target.value })}
                placeholder="Visible only to admins — risk flags, support context, etc."
                rows={3}
                style={{ width: "100%", border: "none", outline: "none", resize: "vertical", background: "transparent", color: NAVY, fontFamily: '"DM Sans",sans-serif', fontSize: 13, lineHeight: 1.5, boxSizing: "border-box", minHeight: 60 }}
              />
            </div>
          </div>}

          {/* Master actions — admin only */}
          {role === "admin" && <div>
            <SectionHeader>Master Actions</SectionHeader>
            <div style={{ background: "#fff", borderRadius: 14, padding: "4px 14px", boxShadow: "0 2px 10px rgba(14,31,64,0.07)", border: "1px solid rgba(14,31,64,0.07)" }}>
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
          background: "#fff",
          borderTop: "0.5px solid rgba(14,31,64,0.10)",
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
              label: "USERS",
              active: view === "users" || view === "userDetail",
              onClick: () => { setView("users"); setSelectedUserId(null); },
              svg: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
            },
            {
              label: "MAP",
              active: false,
              onClick: () => { sessionStorage.setItem("lp_admin_preview", "1"); setState(s => ({ ...s, adminPreview: true, adminPreviewRole: role })); goTo("find"); },
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
                color: item.active ? GREEN : "rgba(14,31,64,0.40)",
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

      {/* ── PAD DETAIL OVERLAY ── */}
      {selectedSpot && (
        <div style={{ position: "fixed", inset: 0, zIndex: 400, background: NAVY, display: "flex", flexDirection: "column", fontFamily: '"DM Sans",sans-serif' }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px 12px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <button onClick={() => setSelectedSpot(null)} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Pad Review</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>{selectedSpot.spot_name || selectedSpot.address}</p>
            </div>
            <span style={{ background: "rgba(246,200,0,0.15)", color: "#F6C800", fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 100, letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>Pending</span>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 0 130px" }}>

            {/* Photo gallery */}
            {(selectedSpot.photo_urls?.length ?? 0) > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {selectedSpot.photo_urls.map((url, i) => (
                  <div key={i} onClick={() => setLightboxPhoto(url)} style={{ position: "relative", cursor: "zoom-in" }}>
                    <img src={url} alt={`Photo ${i + 1}`} style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block" }} />
                    <div style={{ position: "absolute", bottom: 8, right: 10, background: "rgba(0,0,0,0.55)", borderRadius: 20, padding: "3px 9px", display: "flex", alignItems: "center", gap: 4 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>
                      <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>Tap to expand</span>
                    </div>
                    <span style={{ position: "absolute", top: 8, left: 10, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "3px 9px" }}>
                      Photo {i + 1} of {selectedSpot.photo_urls.length}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ height: 120, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "rgba(255,255,255,0.30)", fontSize: 12, fontWeight: 600 }}>No photos uploaded</span>
              </div>
            )}

            <div style={{ padding: "20px 20px 0" }}>

              {/* Host profile card */}
              <div style={{ background: "#142A52", borderRadius: 16, padding: "16px", marginBottom: 16, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 10px rgba(0,0,0,0.25)" }}>
                <p style={{ margin: "0 0 12px", fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase" }}>Host Profile</p>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: `linear-gradient(135deg, ${GREEN}33, ${GREEN}11)`, border: `1.5px solid ${GREEN}44`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#fff" }}>{selectedSpot.host_name || "Unknown Host"}</p>
                    <a href={`mailto:${selectedSpot.host_email}`} style={{ color: GREEN, fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}>{selectedSpot.host_email}</a>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 12px" }}>
                    <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Host ID</p>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.70)", wordBreak: "break-all" }}>{selectedSpot.host_user_id?.slice(0, 18)}…</p>
                  </div>
                  <div style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 12px" }}>
                    <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Submitted</p>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#fff" }}>
                      {selectedSpot.created_at ? new Date(selectedSpot.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Listing details */}
              <div style={{ background: "#142A52", borderRadius: 16, padding: "16px", marginBottom: 16, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 10px rgba(0,0,0,0.25)" }}>
                <p style={{ margin: "0 0 12px", fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", letterSpacing: "0.10em", textTransform: "uppercase" }}>Listing Details</p>

                {selectedSpot.spot_name && (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Pad Name</p>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#fff" }}>{selectedSpot.spot_name}</p>
                  </div>
                )}

                <div style={{ marginBottom: 12 }}>
                  <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Address</p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff", lineHeight: 1.4 }}>{selectedSpot.address}</p>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                  {[
                    { label: "Type", value: selectedSpot.pad_type },
                    { label: "Surface", value: selectedSpot.surface },
                    { label: "Spaces", value: `${selectedSpot.num_pads} pad${selectedSpot.num_pads !== 1 ? "s" : ""}` },
                    { label: "Rate", value: `$${selectedSpot.price_per_hr}/hr`, accent: true },
                  ].map(f => (
                    <div key={f.label} style={{ flex: 1, minWidth: 80, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: "10px 12px" }}>
                      <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{f.label}</p>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: f.accent ? GREEN : "#fff" }}>{f.value}</p>
                    </div>
                  ))}
                </div>

                {selectedSpot.lat && selectedSpot.lng && (
                  <div style={{ marginBottom: 12 }}>
                    <p style={{ margin: "0 0 2px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Coordinates</p>
                    <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: "rgba(255,255,255,0.65)" }}>{selectedSpot.lat.toFixed(5)}, {selectedSpot.lng.toFixed(5)}</p>
                  </div>
                )}

                {selectedSpot.description && (
                  <div>
                    <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Description</p>
                    <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>{selectedSpot.description}</p>
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* Fixed bottom action bar */}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "14px 20px 32px", background: `linear-gradient(to top, ${NAVY} 75%, transparent)`, display: "flex", gap: 10 }}>
            <button
              onClick={() => { const id = selectedSpot.id; setSelectedSpot(null); rejectSpot(id); }}
              disabled={rejectingSpotId === selectedSpot.id || !!approvingSpotId}
              style={{ flex: 1, padding: "14px", borderRadius: 100, border: "1.5px solid rgba(239,68,68,0.40)", background: "rgba(239,68,68,0.10)", color: "#ef4444", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', opacity: rejectingSpotId === selectedSpot.id ? 0.6 : 1 }}
            >
              {rejectingSpotId === selectedSpot.id ? "Rejecting…" : "✕ Reject"}
            </button>
            <button
              onClick={() => setApproveConfirmSpot(selectedSpot)}
              disabled={!!approvingSpotId}
              style={{ flex: 1, padding: "14px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', opacity: approvingSpotId === selectedSpot.id ? 0.6 : 1 }}
            >
              {approvingSpotId === selectedSpot.id ? "Approving…" : "✓ Approve"}
            </button>
          </div>
        </div>
      )}

      {/* ── PHOTO LIGHTBOX ── */}
      {lightboxPhoto && (
        <div
          onClick={() => setLightboxPhoto(null)}
          style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,0.95)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
        >
          <button onClick={e => { e.stopPropagation(); setLightboxPhoto(null); }} style={{ position: "absolute", top: 18, right: 18, background: "rgba(255,255,255,0.12)", border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <img src={lightboxPhoto} alt="Full size" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* ── APPROVE CONFIRMATION MODAL ── */}
      {approveConfirmSpot && (
        <div style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "flex-end", justifyContent: "center", fontFamily: '"DM Sans",sans-serif' }}>
          <div style={{ background: "#142A52", borderRadius: "24px 24px 0 0", padding: "28px 24px 40px", width: "100%", maxWidth: 480, boxShadow: "0 -8px 40px rgba(0,0,0,0.50)" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2, margin: "0 auto 22px" }} />

            <div style={{ width: 52, height: 52, borderRadius: "50%", background: `${GREEN}22`, border: `2px solid ${GREEN}55`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>

            <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 800, color: "#fff", textAlign: "center", letterSpacing: "-0.02em" }}>Approve this pad?</h2>
            <p style={{ margin: "0 0 4px", fontSize: 13.5, fontWeight: 700, color: "#fff", textAlign: "center" }}>
              {approveConfirmSpot.spot_name || approveConfirmSpot.address}
            </p>
            <p style={{ margin: "0 0 24px", fontSize: 12.5, color: "rgba(255,255,255,0.50)", textAlign: "center", lineHeight: 1.55 }}>
              This listing will go live on the map immediately and {approveConfirmSpot.host_name || "the host"} will be notified by email.
            </p>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setApproveConfirmSpot(null)}
                style={{ flex: 1, padding: "14px", borderRadius: 100, border: "1.5px solid rgba(255,255,255,0.15)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const spot = approveConfirmSpot;
                  setApproveConfirmSpot(null);
                  setSelectedSpot(null);
                  await approveSpot(spot.id);
                }}
                disabled={!!approvingSpotId}
                style={{ flex: 2, padding: "14px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: '"DM Sans",sans-serif' }}
              >
                Yes, Approve
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
