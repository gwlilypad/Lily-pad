import { useState, useRef, useEffect, useCallback } from "react";
import { authenticatedHeaders } from "@/lib/apiAuth";

const PAD_COLORS = ["#8DD63F", "#F59E0B", "#4A6FA5"];
const PAD_NAMES  = ["Pad 1", "Pad 2", "Pad 3"];

const HANDLE_R  = 22;
const HANDLE_ARM = 52;
const CORNER_R  = 9;
const DEL_R     = 11;
const CANVAS_W  = 750;

interface Box { cx: number; cy: number; w: number; h: number; angle: number; pad: number; }

function getCorners(b: Box) {
  const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
  return (
    [[-b.w/2,-b.h/2],[b.w/2,-b.h/2],[-b.w/2,b.h/2],[b.w/2,b.h/2]] as [number,number][]
  ).map(([lx,ly]) => ({ x: b.cx + lx*cos - ly*sin, y: b.cy + lx*sin + ly*cos }));
}
function isInsideBox(p: {x:number;y:number}, b: Box) {
  const dx=p.x-b.cx, dy=p.y-b.cy;
  const cos=Math.cos(-b.angle), sin=Math.sin(-b.angle);
  const lx=dx*cos-dy*sin, ly=dx*sin+dy*cos;
  return Math.abs(lx)<b.w/2 && Math.abs(ly)<b.h/2;
}
function getDelPos(b: Box) {
  const lx=b.w/2+DEL_R+4, ly=-(b.h/2+DEL_R+4);
  const cos=Math.cos(b.angle), sin=Math.sin(b.angle);
  return { x: b.cx+lx*cos-ly*sin, y: b.cy+lx*sin+ly*cos };
}
function getHandlePos(b: Box) {
  const arm=b.h/2+HANDLE_ARM;
  return { x: b.cx+arm*Math.sin(b.angle), y: b.cy-arm*Math.cos(b.angle) };
}
function hexRgba(hex:string, a:number) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), bv=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${bv},${a})`;
}

async function annotatePhoto(photoUrl: string, boxes: Box[]): Promise<string> {
  const img = new window.Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((res, rej) => { img.onload=()=>res(); img.onerror=()=>rej(); img.src=photoUrl; });
  const CW = 750;
  const CH = img.naturalWidth > 0 ? Math.round(CW * img.naturalHeight / img.naturalWidth) : 500;
  const c = document.createElement("canvas");
  c.width=CW; c.height=CH;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, CW, CH);
  for (const b of boxes) {
    const col = PAD_COLORS[b.pad] || "#8DD63F";
    ctx.save();
    ctx.translate(b.cx, b.cy); ctx.rotate(b.angle);
    ctx.fillStyle=hexRgba(col,0.22); ctx.strokeStyle=col; ctx.lineWidth=3;
    ctx.beginPath();
    if ((ctx as any).roundRect) (ctx as any).roundRect(-b.w/2,-b.h/2,b.w,b.h,6);
    else ctx.rect(-b.w/2,-b.h/2,b.w,b.h);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  return c.toDataURL("image/jpeg", 0.85);
}

async function uploadAnnotated(dataUrl: string, userId: string): Promise<string> {
  const img = new window.Image();
  await new Promise<void>((res, rej) => { img.onload=()=>res(); img.onerror=()=>rej(); img.src=dataUrl; });
  const MAX=1200; let w=img.naturalWidth, h=img.naturalHeight;
  if (w>MAX) { h=Math.round(h*MAX/w); w=MAX; }
  const c=document.createElement("canvas"); c.width=w||1200; c.height=h||900;
  c.getContext("2d")!.drawImage(img,0,0,c.width,c.height);
  const blob = await new Promise<Blob>((res,rej) =>
    c.toBlob(b=>b?res(b):rej(new Error("export failed")),"image/jpeg",0.82));
  const r = await fetch("/api/upload-photo", {
    method:"POST", headers:{ ...(await authenticatedHeaders("image/jpeg")), "X-User-Id":userId }, body:blob,
  });
  if (!r.ok) throw new Error(await r.text());
  const { url } = await r.json();
  return url as string;
}

interface Props {
  photoUrl: string;
  rawPhotoUrl?: string;
  spotId: string;
  userId: string;
  numPads: number;
  startWithPicker?: boolean;
  onClose: () => void;
  onSaved: (newUrl: string, rawUrl: string) => void;
}

export default function SpotDrawModal({ photoUrl, rawPhotoUrl, spotId, userId, numPads, startWithPicker, onClose, onSaved }: Props) {
  const [basePhoto, setBasePhoto] = useState(rawPhotoUrl || photoUrl);
  const [naturalW, setNaturalW]   = useState(0);
  const [naturalH, setNaturalH]   = useState(0);
  const [boxes, setBoxes]         = useState<Box[]>([]);
  const [activePad, setActivePad] = useState(0);
  const [drawing, setDrawing]     = useState(false);
  const [sx, setSx] = useState(0); const [sy, setSy] = useState(0);
  const [cx, setCx] = useState(0); const [cy, setCy] = useState(0);
  const [rotatingIdx, setRotatingIdx]         = useState<number|null>(null);
  const [draggingCorner, setDraggingCorner]   = useState<{boxIdx:number;ci:number}|null>(null);
  const [draggingBox, setDraggingBox]         = useState<{boxIdx:number;offX:number;offY:number}|null>(null);
  const [saving, setSaving]   = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const fileRef  = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const CANVAS_H = naturalW > 0 ? Math.round(CANVAS_W * naturalH / naturalW) : 500;

  // Measure natural dimensions of current base photo
  useEffect(() => {
    if (!basePhoto) { setNaturalW(1200); setNaturalH(900); return; }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload  = () => { setNaturalW(img.naturalWidth);  setNaturalH(img.naturalHeight); };
    img.onerror = () => { setNaturalW(1200); setNaturalH(900); };
    img.src = basePhoto;
  }, [basePhoto]);

  // Auto-open file picker when startWithPicker is true
  useEffect(() => {
    if (startWithPicker) {
      const t = setTimeout(() => fileRef.current?.click(), 120);
      return () => clearTimeout(t);
    }
  }, [startWithPicker]);

  const drawScene = useCallback(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);

    boxes.forEach(b => {
      const col = PAD_COLORS[b.pad] || "#8DD63F";
      ctx.save();
      ctx.translate(b.cx, b.cy); ctx.rotate(b.angle);
      ctx.fillStyle=hexRgba(col,0.22); ctx.strokeStyle=col; ctx.lineWidth=3;
      ctx.beginPath();
      if ((ctx as any).roundRect) (ctx as any).roundRect(-b.w/2,-b.h/2,b.w,b.h,6);
      else ctx.rect(-b.w/2,-b.h/2,b.w,b.h);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle=col;
      ctx.beginPath();
      if ((ctx as any).roundRect) (ctx as any).roundRect(-b.w/2,-b.h/2,70,24,4);
      else ctx.rect(-b.w/2,-b.h/2,70,24);
      ctx.fill();
      ctx.fillStyle="#0E1F40"; ctx.font="bold 13px DM Sans, sans-serif";
      ctx.fillText(PAD_NAMES[b.pad]||`Pad ${b.pad+1}`, -b.w/2+8, -b.h/2+16);
      ctx.restore();

      const {x:dx,y:dy}=getDelPos(b);
      ctx.save(); ctx.shadowColor="rgba(0,0,0,0.25)"; ctx.shadowBlur=6;
      ctx.fillStyle="rgba(220,38,38,0.92)"; ctx.beginPath(); ctx.arc(dx,dy,DEL_R,0,Math.PI*2); ctx.fill();
      ctx.shadowBlur=0; ctx.strokeStyle="rgba(255,255,255,0.7)"; ctx.lineWidth=1.5; ctx.stroke(); ctx.restore();
      const xi=DEL_R*0.44; ctx.save(); ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.lineCap="round";
      ctx.beginPath(); ctx.moveTo(dx-xi,dy-xi); ctx.lineTo(dx+xi,dy+xi);
      ctx.moveTo(dx+xi,dy-xi); ctx.lineTo(dx-xi,dy+xi); ctx.stroke(); ctx.restore();

      // Handles for active pad
      if (b.pad===activePad) {
        const corners=getCorners(b);
        corners.forEach(({x,y})=>{
          ctx.save(); ctx.beginPath(); ctx.arc(x,y,CORNER_R,0,Math.PI*2);
          ctx.fillStyle="rgba(255,255,255,0.82)"; ctx.fill();
          ctx.strokeStyle=col; ctx.lineWidth=2; ctx.stroke(); ctx.restore();
        });
        const {x:hx,y:hy}=getHandlePos(b);
        const topX=b.cx+(b.h/2)*Math.sin(b.angle), topY=b.cy-(b.h/2)*Math.cos(b.angle);
        ctx.strokeStyle=col; ctx.lineWidth=2; ctx.setLineDash([5,5]);
        ctx.beginPath(); ctx.moveTo(topX,topY); ctx.lineTo(hx,hy); ctx.stroke(); ctx.setLineDash([]);
        ctx.save(); ctx.shadowColor="rgba(0,0,0,0.18)"; ctx.shadowBlur=8;
        ctx.fillStyle="rgba(255,255,255,0.97)"; ctx.strokeStyle=col; ctx.lineWidth=2.5;
        ctx.beginPath(); ctx.arc(hx,hy,HANDLE_R,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; ctx.stroke(); ctx.restore();
        ctx.strokeStyle=col; ctx.lineWidth=2.5;
        const iconR=HANDLE_R*0.46;
        ctx.beginPath(); ctx.arc(hx,hy,iconR,-Math.PI*0.72,Math.PI*0.56); ctx.stroke();
        const aEnd=Math.PI*0.56; const ax=hx+iconR*Math.cos(aEnd), ay=hy+iconR*Math.sin(aEnd);
        const tang=aEnd+Math.PI/2;
        ctx.beginPath(); ctx.moveTo(ax-5*Math.cos(tang-0.45),ay-5*Math.sin(tang-0.45));
        ctx.lineTo(ax,ay); ctx.lineTo(ax-5*Math.cos(tang+0.45),ay-5*Math.sin(tang+0.45)); ctx.stroke();
      }
    });

    if (drawing) {
      const bw=cx-sx, bh=cy-sy;
      const col=PAD_COLORS[activePad]||"#8DD63F";
      ctx.fillStyle=hexRgba(col,0.15); ctx.strokeStyle=col; ctx.lineWidth=2; ctx.setLineDash([6,3]);
      ctx.beginPath();
      if ((ctx as any).roundRect) (ctx as any).roundRect(sx,sy,bw,bh,6); else ctx.rect(sx,sy,bw,bh);
      ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
  }, [boxes, drawing, cx, cy, sx, sy, activePad]);

  useEffect(() => { drawScene(); }, [drawScene]);

  function getPos(e: React.MouseEvent|React.TouchEvent) {
    const c=canvasRef.current!; const rect=c.getBoundingClientRect();
    const scX=c.width/rect.width, scY=c.height/rect.height;
    const src="touches" in e
      ? ((e as React.TouchEvent).touches[0]||(e as React.TouchEvent).changedTouches[0])
      : (e as React.MouseEvent);
    return { x:(src.clientX-rect.left)*scX, y:(src.clientY-rect.top)*scY };
  }

  function handleDown(e: React.MouseEvent|React.TouchEvent) {
    const p=getPos(e);
    for (let i=0;i<boxes.length;i++) {
      const {x:dx,y:dy}=getDelPos(boxes[i]);
      if (Math.sqrt((p.x-dx)**2+(p.y-dy)**2)<DEL_R*2.2) {
        setBoxes(prev=>prev.filter((_,idx)=>idx!==i));
        if ("preventDefault" in e) e.preventDefault(); return;
      }
    }
    for (let i=0;i<boxes.length;i++) {
      if (boxes[i].pad!==activePad) continue;
      const corners=getCorners(boxes[i]);
      for (let ci=0;ci<corners.length;ci++) {
        const {x,y}=corners[ci];
        if (Math.sqrt((p.x-x)**2+(p.y-y)**2)<CORNER_R*2.8) {
          setDraggingCorner({boxIdx:i,ci}); if ("preventDefault" in e) e.preventDefault(); return;
        }
      }
    }
    for (let i=0;i<boxes.length;i++) {
      if (boxes[i].pad!==activePad) continue;
      const {x:hx,y:hy}=getHandlePos(boxes[i]);
      if (Math.sqrt((p.x-hx)**2+(p.y-hy)**2)<HANDLE_R*2) {
        setRotatingIdx(i); if ("preventDefault" in e) e.preventDefault(); return;
      }
    }
    for (let i=0;i<boxes.length;i++) {
      if (isInsideBox(p,boxes[i])) {
        setDraggingBox({boxIdx:i,offX:p.x-boxes[i].cx,offY:p.y-boxes[i].cy});
        if ("preventDefault" in e) e.preventDefault(); return;
      }
    }
    setSx(p.x); setSy(p.y); setCx(p.x); setCy(p.y); setDrawing(true);
  }

  function handleMove(e: React.MouseEvent|React.TouchEvent) {
    const p=getPos(e);
    if (draggingBox!==null) {
      setBoxes(prev=>{
        const upd=[...prev]; const b=upd[draggingBox.boxIdx]; if (!b) return prev;
        upd[draggingBox.boxIdx]={...b,cx:p.x-draggingBox.offX,cy:p.y-draggingBox.offY};
        return upd;
      }); return;
    }
    if (draggingCorner!==null) {
      setBoxes(prev=>{
        const upd=[...prev]; const b=upd[draggingCorner.boxIdx]; if (!b) return prev;
        const OPPOSITE=[3,2,1,0];
        const opp=getCorners(b)[OPPOSITE[draggingCorner.ci]];
        const newCx=(p.x+opp.x)/2, newCy=(p.y+opp.y)/2;
        const dx=p.x-newCx, dy=p.y-newCy;
        const cos=Math.cos(b.angle), sin=Math.sin(b.angle);
        const lx=dx*cos+dy*sin, ly=-dx*sin+dy*cos;
        upd[draggingCorner.boxIdx]={...b,cx:newCx,cy:newCy,w:Math.max(20,2*Math.abs(lx)),h:Math.max(20,2*Math.abs(ly))};
        return upd;
      }); return;
    }
    if (rotatingIdx!==null) {
      setBoxes(prev=>{
        const upd=[...prev]; const b=upd[rotatingIdx]; if (!b) return prev;
        upd[rotatingIdx]={...b,angle:Math.atan2(p.y-b.cy,p.x-b.cx)+Math.PI/2};
        return upd;
      }); return;
    }
    if (!drawing) return;
    setCx(p.x); setCy(p.y);
  }

  function handleUp() {
    if (draggingBox!==null) { setDraggingBox(null); return; }
    if (draggingCorner!==null) { setDraggingCorner(null); return; }
    if (rotatingIdx!==null) { setRotatingIdx(null); return; }
    if (!drawing) return;
    const bw=cx-sx, bh=cy-sy;
    if (Math.abs(bw)>16 && Math.abs(bh)>16) {
      setBoxes(prev=>{
        const filtered=prev.filter(b=>b.pad!==activePad);
        filtered.push({cx:(sx+cx)/2,cy:(sy+cy)/2,w:Math.abs(bw),h:Math.abs(bh),angle:0,pad:activePad});
        return filtered;
      });
    }
    setDrawing(false);
  }

  function handleNewPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f=e.target.files?.[0]; if (!f) return;
    e.target.value="";
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const url=ev.target?.result as string; if (!url) return;
      setBasePhoto(url); setBoxes([]);
    };
    reader.readAsDataURL(f);
  }

  async function handleSave() {
    setSaving(true); setSaveErr("");
    try {
      // If basePhoto is a local data URL (new photo picked), upload original first
      let rawUrl: string;
      if (basePhoto.startsWith("data:")) {
        rawUrl = await uploadAnnotated(basePhoto, userId);
      } else {
        rawUrl = basePhoto; // already a remote URL — keep it as the raw base
      }
      const annotated = await annotatePhoto(basePhoto, boxes);
      const newUrl    = await uploadAnnotated(annotated, userId);
      await fetch(`/api/spots/${spotId}`, {
        method:"PATCH",
        headers:await authenticatedHeaders("application/json"),
        body:JSON.stringify({ photo_url: newUrl, raw_photo_url: rawUrl, photo_urls: [newUrl] }),
      });
      onSaved(newUrl, rawUrl);
    } catch (err: any) {
      setSaveErr(err?.message || "Save failed — try again.");
    }
    setSaving(false);
  }

  const N = Math.min(numPads, 3);

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:9000, background:"#050f1f",
      display:"flex", flexDirection:"column", fontFamily:"'DM Sans',sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"14px 16px", borderBottom:"1px solid rgba(255,255,255,0.08)",
        flexShrink:0,
      }}>
        <button onClick={onClose} style={{
          width:36, height:36, borderRadius:"50%", background:"rgba(255,255,255,0.08)",
          border:"1px solid rgba(255,255,255,0.12)", display:"flex", alignItems:"center",
          justifyContent:"center", cursor:"pointer", padding:0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:15, fontWeight:800, color:"#fff", letterSpacing:-0.3 }}>Redraw your spot</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", marginTop:1 }}>Drag to draw a box over each pad</div>
        </div>
        <button onClick={() => fileRef.current?.click()} style={{
          background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)",
          borderRadius:100, padding:"7px 12px", fontSize:11, fontWeight:700, color:"rgba(255,255,255,0.8)",
          cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap",
        }}>
          New photo
        </button>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleNewPhoto} />
      </div>

      {/* Pad selector */}
      {N > 1 && (
        <div style={{ display:"flex", gap:6, padding:"10px 16px 4px", flexShrink:0 }}>
          {Array.from({length:N},(_,i)=>i).map(i=>(
            <button key={i} onClick={()=>setActivePad(i)} style={{
              flex:1, padding:"7px 0", borderRadius:100,
              background: activePad===i ? PAD_COLORS[i] : "rgba(255,255,255,0.06)",
              border: `1.5px solid ${activePad===i ? PAD_COLORS[i] : "rgba(255,255,255,0.10)"}`,
              color: activePad===i ? "#0E1F40" : "rgba(255,255,255,0.55)",
              fontSize:12, fontWeight:800, cursor:"pointer", fontFamily:"'DM Sans',sans-serif",
              display:"flex", alignItems:"center", justifyContent:"center", gap:5,
            }}>
              {boxes.some(b=>b.pad===i) && <span>✓</span>}
              {PAD_NAMES[i]}
            </button>
          ))}
        </div>
      )}

      {/* Canvas area */}
      <div style={{ flex:1, minHeight:0, display:"flex", alignItems:"center", justifyContent:"center", padding:"8px 0" }}>
        <div style={{
          position:"relative", maxWidth:"100%", maxHeight:"100%",
          aspectRatio: naturalW>0 ? `${naturalW}/${naturalH}` : "4/3",
          width:"100%", display:"flex",
        }}>
          <img
            src={basePhoto}
            crossOrigin="anonymous"
            style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"fill", display:"block" }}
            alt="Spot"
          />
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            style={{ position:"absolute", inset:0, width:"100%", height:"100%", touchAction:"none", cursor:"crosshair" }}
            onMouseDown={handleDown}
            onMouseMove={handleMove}
            onMouseUp={handleUp}
            onMouseLeave={handleUp}
            onTouchStart={handleDown}
            onTouchMove={handleMove}
            onTouchEnd={handleUp}
          />
          {boxes.length===0 && (
            <div style={{
              position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center",
              pointerEvents:"none",
            }}>
              <div style={{
                background:"rgba(0,0,0,0.52)", backdropFilter:"blur(6px)",
                borderRadius:20, padding:"10px 20px",
                fontSize:14, fontWeight:700, color:"#fff",
                display:"flex", alignItems:"center", gap:8,
              }}>
                <span style={{ fontSize:18 }}>✏️</span>
                Drag to draw your {N===1 ? "parking spot" : PAD_NAMES[activePad]}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Guide + actions */}
      <div style={{
        flexShrink:0, padding:"12px 16px env(safe-area-inset-bottom, 16px)",
        borderTop:"1px solid rgba(255,255,255,0.07)", background:"rgba(5,15,31,0.95)",
      }}>
        <div style={{ display:"flex", gap:8, marginBottom:10 }}>
          {[
            "Drag to draw a box over your spot",
            "Drag ↻ handle to rotate",
            "Tap the red ✕ to remove",
          ].map((t,i)=>(
            <div key={i} style={{ flex:1, display:"flex", alignItems:"flex-start", gap:5 }}>
              <span style={{ fontSize:10, fontWeight:800, color:"#8DD63F", flexShrink:0, marginTop:1 }}>{i+1}</span>
              <span style={{ fontSize:10, color:"rgba(255,255,255,0.42)", lineHeight:1.4 }}>{t}</span>
            </div>
          ))}
        </div>
        {saveErr && <div style={{ fontSize:12, color:"#ef4444", fontWeight:600, marginBottom:8 }}>{saveErr}</div>}
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width:"100%", padding:"14px 0", borderRadius:14,
            background: saving ? "rgba(141,214,63,0.35)" : "#8DD63F",
            border:"none", color:"#0E1F40", fontSize:15, fontWeight:800,
            cursor: saving ? "default" : "pointer", fontFamily:"'DM Sans',sans-serif",
          }}
        >
          {saving ? "Saving…" : boxes.length===0 ? "Save (no boxes)" : `Save annotation`}
        </button>
      </div>
    </div>
  );
}
