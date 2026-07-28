import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import SpotDrawModal from "@/components/SpotDrawModal";
import BookingChatDrawer from "@/components/BookingChatDrawer";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

interface ListerBooking {
  id: string;
  driver_user_id?: string;
  spot_id: string;
  spot_address: string;
  driver_name: string;
  driver_email: string | null;
  start_ts: string | null;
  end_ts: string | null;
  price_per_hr: number;
  total_price: number;
  pad_type: string;
  status: string;
  created_at: string;
}

interface InboxItem {
  booking_id: string;
  driver_name: string;
  spot_address: string;
  last_message: string;
  last_message_at: string;
  sender_role: string;
}

function fmtDt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { month:"short", day:"numeric" });
}
function fmtTm(ts: string | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-US", { hour:"numeric", minute:"2-digit" });
}

interface Pad {
  id: number;
  spotId?: string;       // Supabase UUID
  // Vital — locked (can't be changed; would affect bookings)
  address: string;
  city: string;
  type: string;          // Driveway / Business lot
  spotCount: number;
  // Editable
  name: string;          // globally-unique spot_name
  nickname: string;      // legacy alias (= name)
  price: number;         // $/hr
  description: string;
  services: string[];
  photoUrl: string;
  rawPhotoUrl: string;   // original unannotated photo for redraw base
  photoUrls: string[];   // all uploaded photos (gallery)
  auto_approve: boolean;
  // Display only
  status: "active" | "paused" | "pending" | "archived";
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
    nickname: "Front driveway", name: "Front driveway", price: 4, auto_approve: true,
    description: "Easy-access driveway right off the main road. Great for downtown commuters.",
    services: ["Lighting at night", "24/7 access"],
    photoUrl: "https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=600&q=70",
    rawPhotoUrl: "", photoUrls: ["https://images.unsplash.com/photo-1590674899484-d5640e854abe?w=600&q=70"],
    status: "active", since: "Mar 2025", bookings: 14,
  },
  {
    id: 2,
    address: "880 Oak Lane", city: "Austin, TX", type: "Driveway", spotCount: 2,
    nickname: "Side gravel pad", name: "Side gravel pad", price: 3, auto_approve: true,
    description: "Two-car gravel pad next to the house. Quiet residential street.",
    services: ["Wide spot", "Surface paved"],
    photoUrl: "https://images.unsplash.com/photo-1448630360428-65456885c650?w=600&q=70",
    rawPhotoUrl: "", photoUrls: ["https://images.unsplash.com/photo-1448630360428-65456885c650?w=600&q=70"],
    status: "active", since: "Jan 2025", bookings: 22,
  },
];

function StatusPill({ pad }: { pad: Pad }) {
  if (pad.status === "archived") {
    return (
      <div style={{
        background: "rgba(100,100,120,0.18)", border: "1px solid rgba(150,150,170,0.30)",
        borderRadius: 20, padding: "4px 10px", fontSize: 10, fontWeight: 800,
        color: "rgba(200,200,220,0.7)", letterSpacing: 0.5, textTransform: "uppercase",
      }}>
        Archived
      </div>
    );
  }
  if (pad.status === "pending") {
    return (
      <div style={{
        background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.35)",
        borderRadius: 20, padding: "4px 10px", fontSize: 10, fontWeight: 800,
        color: "#f59e0b", letterSpacing: 0.5, textTransform: "uppercase",
      }}>
        ● Pending review
      </div>
    );
  }
  const active = pad.status === "active";
  const tonightLabel = pad.pausedUntil ? "Paused · tonight" : "Paused";
  return (
    <div style={{
      background: active ? "rgba(141,214,63,0.18)" : "rgba(255,200,0,0.18)",
      border: `1px solid ${active ? "rgba(141,214,63,0.40)" : "rgba(255,200,0,0.35)"}`,
      borderRadius: 20, padding: "4px 10px", fontSize: 10, fontWeight: 800,
      color: active ? "#5a9e1a" : "#a07800", letterSpacing: 0.5, textTransform: "uppercase",
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pads, setPads] = useState<Pad[]>([]);
  const [loadingPads, setLoadingPads] = useState(true);
  const [listerBookings, setListerBookings] = useState<ListerBooking[]>([]);

  function startAddPad() {
    setState(s => ({ ...s, addingExtraPad: true, apAns: {} }));
    goTo("addpad");
  }

  const fetchListerBookings = useCallback(() => {
    if (!user?.id) return;
    fetch(`/api/bookings/lister/${user.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setListerBookings(data); })
      .catch(() => {});
  }, [user?.id]);

  const fetchHostInbox = useCallback(() => {
    if (!user?.id) return;
    setInboxLoading(true);
    fetch(`/api/booking-chat/host-inbox/${user.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setHostInbox(data); })
      .catch(() => {})
      .finally(() => setInboxLoading(false));
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) fetchHostInbox();
  }, [user?.id, fetchHostInbox]);

  useEffect(() => {
    if (!user?.id) { setLoadingPads(false); return; }
    fetch(`/api/spots/user/${user.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const loaded: Pad[] = data.map((s: Record<string, unknown>, idx: number) => {
            const padName = String(s.spot_name || "My Lily Pad");
            return {
              id: idx + 1,
              spotId: String(s.id || ""),
              address: String(s.address || ""),
              city: "Houston, TX",
              type: String(s.pad_type || "Driveway"),
              spotCount: Number(s.num_pads) || 1,
              name: padName,
              nickname: padName,
              price: Number(s.price_per_hr) || 4,
              description: String(s.description || ""),
              services: Array.isArray(s.services) ? s.services as string[] : [],
              photoUrl: String(s.photo_url || ""),
              rawPhotoUrl: String(s.raw_photo_url || ""),
              photoUrls: Array.isArray(s.photo_urls) ? (s.photo_urls as string[]) : (s.photo_url ? [String(s.photo_url)] : []),
              auto_approve: (s.spot_data as any)?.auto_approve !== false,
              status: s.status === "active" ? "active" : s.status === "paused" ? "paused" : s.status === "archived" ? "archived" : "pending",
              pausedUntil: null,
              since: s.created_at ? new Date(String(s.created_at)).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—",
              bookings: 0,
            };
          });
          setPads(loaded);
        } else {
          setPads([]);
        }
        setLoadingPads(false);
      })
      .catch(() => setLoadingPads(false));
    fetchListerBookings();
  }, [user?.id, fetchListerBookings]);

  const [openPadId, setOpenPadId] = useState<number | null>(null);
  const [pendingPauseId, setPendingPauseId] = useState<number | null>(null);

  // Rename state
  const [renamingPad, setRenamingPad] = useState<Pad | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  // User profile (for change-request contact info)
  const [userProfile, setUserProfile] = useState<{ phone?: string; full_name?: string } | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("profiles").select("phone, full_name").eq("id", user.id).single()
      .then(({ data }) => { if (data) setUserProfile(data as { phone?: string; full_name?: string }); });
  }, [user?.id]);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState<{
    name: string; price: number; description: string; services: string[];
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Services saved toast
  const [serviceToast, setServiceToast] = useState(false);
  const serviceToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spot draw modal
  const [drawModalOpen, setDrawModalOpen] = useState(false);
  const [drawStartWithPicker, setDrawStartWithPicker] = useState(false);

  // Reset gallery index when switching pads
  useEffect(() => { setPhotoIndex(0); }, [openPadId]);

  // Photo gallery (per-pad hero)
  const [photoIndex, setPhotoIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  // Photo lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lbTouchStartX, setLbTouchStartX] = useState<number | null>(null);

  // Archive confirm
  const [archiveConfirmId, setArchiveConfirmId] = useState<number | null>(null);
  const [archiving, setArchiving] = useState(false);

  // List tab: "active" | "pending" | "archived"
  const [listTab, setListTab] = useState<"active" | "pending" | "archived">("active");

  // Top-level view: pads list or reservations
  const [padView, setPadView] = useState<"pads" | "reservations">("pads");
  // Booking chat
  const [chatBooking, setChatBooking] = useState<{ id: string; addr: string; driverName: string } | null>(null);
  // Host message inbox
  const [hostInbox, setHostInbox] = useState<InboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);

  async function saveEdit() {
    if (!openPad || !editDraft) return;
    setEditSaving(true);
    setEditError("");
    try {
      const trimmedName = editDraft.name.trim();
      const nameChanged = trimmedName !== openPad.name;
      if (nameChanged) {
        if (trimmedName.length < 2) { setEditError("Pad name must be at least 2 characters."); setEditSaving(false); return; }
        const chkUrl = `/api/spots/check-name?name=${encodeURIComponent(trimmedName)}${openPad.spotId ? `&excludeId=${openPad.spotId}` : ""}`;
        const chk = await fetch(chkUrl);
        const { available } = await chk.json();
        if (!available) { setEditError("That name is already taken. Try something unique."); setEditSaving(false); return; }
      }
      const r = await fetch(`/api/spots/${openPad.spotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(nameChanged ? { spot_name: trimmedName } : {}),
          price_per_hr: editDraft.price,
          description: editDraft.description,
          services: editDraft.services,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setEditError((err as { error?: string }).error || "Could not save. Try again.");
        setEditSaving(false);
        return;
      }
      updatePad(openPad.id, {
        name: trimmedName,
        nickname: trimmedName,
        price: editDraft.price,
        description: editDraft.description,
        services: editDraft.services,
      });
      setEditMode(false);
      setEditDraft(null);
    } catch {
      setEditError("Network error. Try again.");
    }
    setEditSaving(false);
  }

  // Change request modal
  const [changeRequestField, setChangeRequestField] = useState<string | null>(null);
  const [changeRequestText, setChangeRequestText] = useState("");
  const [changeRequestSending, setChangeRequestSending] = useState(false);
  const [changeRequestSent, setChangeRequestSent] = useState(false);

  function openChangeRequest(fieldLabel: string) {
    setChangeRequestField(fieldLabel);
    setChangeRequestText("");
    setChangeRequestSent(false);
  }

  async function submitChangeRequest() {
    if (!openPad || !changeRequestField || !changeRequestText.trim() || !user) return;
    setChangeRequestSending(true);
    try {
      const fieldValue = changeRequestField === "Address"
        ? `${openPad.address}, ${openPad.city}`
        : changeRequestField === "Pad type"
        ? openPad.type
        : String(openPad.spotCount);

      const payload = JSON.stringify({
        type: "change_request",
        field: changeRequestField,
        current: fieldValue,
        requested: changeRequestText.trim(),
        padName: openPad.name,
        spotId: openPad.spotId || "",
        hostName: userProfile?.full_name || user.email || "",
        hostEmail: user.email || "",
        hostPhone: userProfile?.phone || "",
      });

      await fetch("/api/support/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          user_name: userProfile?.full_name || user.email || "Host",
          user_email: user.email || "",
          subject: `[Change Request] ${changeRequestField} — ${openPad.name}`,
          first_message: payload,
        }),
      });
      setChangeRequestSent(true);
    } catch {
      setChangeRequestSent(true);
    }
    setChangeRequestSending(false);
  }

  function startRename(pad: Pad) {
    setRenamingPad(pad);
    setRenameValue(pad.name);
    setRenameError("");
  }

  async function saveRename() {
    if (!renamingPad) return;
    const trimmed = renameValue.trim();
    if (trimmed.length < 2) { setRenameError("Name must be at least 2 characters."); return; }
    setRenameSaving(true);
    setRenameError("");
    try {
      const chkUrl = `/api/spots/check-name?name=${encodeURIComponent(trimmed)}${renamingPad.spotId ? `&excludeId=${renamingPad.spotId}` : ""}`;
      const chk = await fetch(chkUrl);
      const { available } = await chk.json();
      if (!available) {
        setRenameError("That name is already taken across all Lily Pad accounts. Try something unique.");
        setRenameSaving(false);
        return;
      }
      const r = await fetch(`/api/spots/${renamingPad.spotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spot_name: trimmed }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setRenameError((err as {error?: string}).error || "Could not save. Try again.");
        setRenameSaving(false);
        return;
      }
      updatePad(renamingPad.id, { name: trimmed, nickname: trimmed });
      setRenamingPad(null);
    } catch {
      setRenameError("Network error. Try again.");
    }
    setRenameSaving(false);
  }

  const openPad = openPadId == null ? null : pads.find(p => p.id === openPadId) || null;
  const pendingPad = pendingPauseId == null ? null : pads.find(p => p.id === pendingPauseId) || null;

  // Sort: active → paused (pending and archived have their own tabs)
  const pendingPads  = pads.filter(p => p.status === "pending");
  const activePads   = pads.filter(p => p.status !== "archived" && p.status !== "pending");
  const archivedPads = pads.filter(p => p.status === "archived");
  const sortedPads = [...activePads].sort((a, b) => {
    const order: Record<string, number> = { active: 0, paused: 1 };
    return (order[a.status] ?? 1) - (order[b.status] ?? 1);
  });

  // Auto-switch to pending tab when user has pending pads
  useEffect(() => {
    if (pendingPads.length > 0 && listTab === "active" && activePads.length === 0) {
      setListTab("pending");
    }
  }, [pads.length]);

  async function archivePad(id: number) {
    const pad = pads.find(p => p.id === id);
    if (!pad?.spotId) return;
    setArchiving(true);
    try {
      await fetch(`/api/spots/${pad.spotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });
      updatePad(id, { status: "archived" });
      setOpenPadId(null);
      setEditMode(false);
      setEditDraft(null);
    } catch {}
    setArchiving(false);
    setArchiveConfirmId(null);
  }

  function updatePad(id: number, patch: Partial<Pad>) {
    setPads(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  async function toggleAutoApprove(pad: Pad) {
    const newVal = !pad.auto_approve;
    updatePad(pad.id, { auto_approve: newVal });
    if (pad.spotId) {
      fetch(`/api/spots/${pad.spotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_approve: newVal }),
      }).catch(() => {});
    }
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
    let newServices: string[] = [];
    let spotId = "";
    setPads(prev => prev.map(p => {
      if (p.id !== id) return p;
      const has = p.services.includes(service);
      const updated = has ? p.services.filter(s => s !== service) : [...p.services, service];
      newServices = updated;
      spotId = p.spotId || "";
      return { ...p, services: updated };
    }));
    if (spotId) {
      fetch(`/api/spots/${spotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: newServices }),
      }).then(() => {
        if (serviceToastTimer.current) clearTimeout(serviceToastTimer.current);
        setServiceToast(true);
        serviceToastTimer.current = setTimeout(() => setServiceToast(false), 1800);
      }).catch(() => {});
    }
  }

  function openDrawModal(withPicker: boolean) {
    setDrawStartWithPicker(withPicker);
    setDrawModalOpen(true);
  }

  return (
    <>
    <div className="page active" style={{ background: NAVY, display: "flex", flexDirection: "column", fontFamily: "'DM Sans',sans-serif" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: "52px 20px 16px", background: NAVY }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => openPad ? (setOpenPadId(null), setEditMode(false), setEditDraft(null)) : navigate(-1)}
            style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", padding: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>
              {openPad ? openPad.name || openPad.address : padView === "pads" ? "My Pads" : "Reservations"}
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>
              {openPad ? `${openPad.address} · ${openPad.city}` : `${pads.length} listing${pads.length !== 1 ? "s" : ""}`}
            </div>
          </div>
          {!openPad && listerBookings.filter(b => b.status === "pending").length > 0 && (
            <div style={{ background: "#f59e0b", borderRadius: 100, padding: "4px 10px", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
              {listerBookings.filter(b => b.status === "pending").length} new
            </div>
          )}
        </div>
      </div>

      {/* View tab switcher — only shown on list view */}
      {!openPad && (
        <div style={{ flexShrink: 0, padding: "0 16px 16px", background: NAVY }}>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 3 }}>
            {(["pads", "reservations"] as const).map(v => (
              <button key={v} onClick={() => { setPadView(v); if (v === "reservations") fetchHostInbox(); }}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 10,
                  background: padView === v ? "#fff" : "transparent",
                  border: "none", cursor: "pointer",
                  fontFamily: "'DM Sans',sans-serif", fontSize: 12, fontWeight: 800,
                  color: padView === v ? NAVY : "rgba(255,255,255,0.50)",
                  transition: "all 0.15s",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                }}>
                {v === "pads" ? "My Pads" : "Reservations"}
                {v === "reservations" && listerBookings.filter(b => b.status === "pending").length > 0 && (
                  <span style={{ background: "#f59e0b", borderRadius: 100, padding: "1px 6px", fontSize: 9, color: "#fff", fontWeight: 800 }}>
                    {listerBookings.filter(b => b.status === "pending").length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={!openPad
        ? { flex: 1, overflowY: "auto", background: "#fff", borderRadius: "28px 28px 0 0", padding: "24px 16px 40px" }
        : { flex: 1, overflowY: "auto", padding: "20px 16px 40px" }
      }>

        {loadingPads ? (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ width: 28, height: 28, border: "3px solid rgba(141,214,63,0.3)", borderTopColor: "#8DD63F", borderRadius: "50%", animation: "lp-spin 0.8s linear infinite", margin: "0 auto" }} />
            <style>{`@keyframes lp-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : !openPad ? (
          padView === "reservations" ? (
            /* ── RESERVATIONS VIEW ── */
            <>
              {/* ── Message center ── */}
              {inboxLoading ? (
                <div style={{ textAlign: "center", padding: "24px 0" }}>
                  <div style={{ width: 22, height: 22, border: "2px solid rgba(14,31,64,0.10)", borderTopColor: NAVY, borderRadius: "50%", animation: "lp-spin 0.8s linear infinite", margin: "0 auto" }} />
                  <style>{`@keyframes lp-spin{to{transform:rotate(360deg)}}`}</style>
                </div>
              ) : hostInbox.length > 0 ? (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 3, height: 16, borderRadius: 2, background: GREEN }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: NAVY, letterSpacing: 0.3, textTransform: "uppercase" as const }}>Messages</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", background: "rgba(14,31,64,0.08)", borderRadius: 100, padding: "2px 7px" }}>{hostInbox.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    {hostInbox.map(item => {
                      const unread = item.sender_role === "driver";
                      return (
                        <button key={item.booking_id}
                          onClick={() => setChatBooking({ id: item.booking_id, addr: item.spot_address, driverName: item.driver_name })}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: unread ? "rgba(141,214,63,0.06)" : "#fff", borderRadius: 14, border: `1px solid ${unread ? "rgba(141,214,63,0.22)" : "rgba(14,31,64,0.08)"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "'DM Sans',sans-serif", boxShadow: "0 1px 4px rgba(14,31,64,0.05)" }}>
                          <div style={{ width: 40, height: 40, borderRadius: "50%", background: GREEN, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 15, color: NAVY, flexShrink: 0 }}>
                            {(item.driver_name[0] || "D").toUpperCase()}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 800, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{item.driver_name}</span>
                              <span style={{ fontSize: 10, color: "rgba(14,31,64,0.38)", whiteSpace: "nowrap" as const, flexShrink: 0 }}>{fmtDt(item.last_message_at)}</span>
                            </div>
                            <div style={{ fontSize: 12, color: unread ? NAVY : "rgba(14,31,64,0.45)", fontWeight: unread ? 600 : 400, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                              {item.sender_role === "host" ? "You: " : ""}{item.last_message}
                            </div>
                            <div style={{ fontSize: 10.5, color: "rgba(14,31,64,0.35)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{item.spot_address}</div>
                          </div>
                          {unread && <div style={{ width: 9, height: 9, borderRadius: "50%", background: GREEN, flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* ── All reservations ── */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 3, height: 16, borderRadius: 2, background: GREEN }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: NAVY, letterSpacing: 0.3, textTransform: "uppercase" as const }}>All Reservations</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", background: "rgba(14,31,64,0.08)", borderRadius: 100, padding: "2px 7px" }}>{listerBookings.length}</span>
                </div>
                {listerBookings.length === 0 ? (
                  <div style={{ background: "rgba(14,31,64,0.04)", borderRadius: 16, padding: "28px 20px", textAlign: "center" as const, border: "1px dashed rgba(14,31,64,0.18)", color: "rgba(14,31,64,0.35)", fontSize: 13 }}>
                    No reservations yet.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                    {listerBookings.map(b => {
                      const nowMs = Date.now();
                      const start = b.start_ts ? new Date(b.start_ts).getTime() : 0;
                      const end   = b.end_ts   ? new Date(b.end_ts).getTime()   : 0;
                      const ds = b.status === "cancelled" ? "cancelled" : b.status === "denied" ? "denied" : b.status === "pending" ? "pending" : end < nowMs ? "completed" : start <= nowMs && nowMs < end ? "active" : "upcoming";
                      const stMap: Record<string, { bg: string; color: string; label: string }> = {
                        pending:   { bg: "rgba(251,191,36,0.12)", color: "#f59e0b",             label: "Awaiting" },
                        upcoming:  { bg: "rgba(141,214,63,0.12)", color: "#3d8c0a",             label: "Upcoming" },
                        active:    { bg: "rgba(52,199,89,0.14)",  color: "#1a7a3c",             label: "Active"   },
                        completed: { bg: "rgba(14,31,64,0.06)",   color: "rgba(14,31,64,0.40)", label: "Done"     },
                        cancelled: { bg: "rgba(255,80,80,0.08)",  color: "#ef4444",             label: "Cancelled"},
                        denied:    { bg: "rgba(255,80,80,0.08)",  color: "#ef4444",             label: "Denied"   },
                      };
                      const st = stMap[ds] || stMap.completed;
                      return (
                        <button key={b.id}
                          onClick={() => setChatBooking({ id: b.id, addr: b.spot_address, driverName: b.driver_name })}
                          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "#fff", borderRadius: 14, border: "1px solid rgba(14,31,64,0.08)", cursor: "pointer", textAlign: "left" as const, fontFamily: "'DM Sans',sans-serif", boxShadow: "0 1px 4px rgba(14,31,64,0.06)" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ fontSize: 13, fontWeight: 800, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{b.driver_name}</span>
                              <div style={{ background: st.bg, borderRadius: 100, padding: "3px 8px", fontSize: 9.5, fontWeight: 800, color: st.color, whiteSpace: "nowrap" as const, flexShrink: 0, letterSpacing: 0.3, textTransform: "uppercase" as const }}>
                                {st.label}
                              </div>
                            </div>
                            <div style={{ fontSize: 11, color: "rgba(14,31,64,0.45)", marginTop: 2 }}>
                              {fmtDt(b.start_ts)} · {fmtTm(b.start_ts)}{b.end_ts ? ` – ${fmtTm(b.end_ts)}` : ""}
                            </div>
                            <div style={{ fontSize: 10.5, color: "rgba(14,31,64,0.35)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{b.spot_address}</div>
                          </div>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.28)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
          /* ── LIST VIEW ── */
          <>
            {/* ══ YOUR PADS ══ */}
            <div style={{ marginBottom: 28 }}>
              {/* Section header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 3, height: 16, borderRadius: 2, background: GREEN }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: NAVY, letterSpacing: 0.3, textTransform: "uppercase" }}>Your Pads</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", background: "rgba(14,31,64,0.08)", borderRadius: 100, padding: "2px 7px" }}>{activePads.length + pendingPads.length}</span>
                </div>
                <div style={{ display: "flex", gap: 14 }}>
                  {[
                    { l: "Active", v: `${pads.filter(p => p.status === "active").length}/${activePads.length}` },
                    { l: "Bookings", v: String(listerBookings.length) },
                  ].map(s => (
                    <div key={s.l} style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: NAVY, letterSpacing: -0.3, lineHeight: 1 }}>{s.v}</div>
                      <div style={{ fontSize: 9.5, color: "rgba(14,31,64,0.38)", fontWeight: 600, marginTop: 1 }}>{s.l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "rgba(14,31,64,0.06)", borderRadius: 12, padding: 4 }}>
                {(["active", "pending", "archived"] as const).map(tab => (
                  <button key={tab} onClick={() => setListTab(tab)} style={{
                    flex: 1, padding: "8px 0", borderRadius: 9,
                    background: listTab === tab ? "#fff" : "transparent",
                    border: "none",
                    color: listTab === tab ? NAVY : "rgba(14,31,64,0.40)",
                    fontSize: 12, fontWeight: 800, cursor: "pointer",
                    fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.2,
                    boxShadow: listTab === tab ? "0 1px 4px rgba(14,31,64,0.12)" : "none",
                    transition: "all 0.15s",
                    textTransform: "capitalize",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  }}>
                    {tab === "active" ? "Active" : tab === "pending" ? "Pending" : "Archived"}
                    {tab === "pending" && pendingPads.length > 0 && (
                      <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(251,191,36,0.22)", borderRadius: 100, padding: "1px 5px", color: "#a07800" }}>
                        {pendingPads.length}
                      </span>
                    )}
                    {tab === "archived" && archivedPads.length > 0 && (
                      <span style={{ fontSize: 9, fontWeight: 800, background: "rgba(14,31,64,0.12)", borderRadius: 100, padding: "1px 5px", color: "rgba(14,31,64,0.55)" }}>
                        {archivedPads.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Pending tab — under review banner */}
              {listTab === "pending" && (
                <>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.30)", borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a07800" strokeWidth="2.2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7a5800", lineHeight: 1.3 }}>Under review</div>
                      <div style={{ fontSize: 11.5, color: "rgba(120,88,0,0.70)", marginTop: 2, lineHeight: 1.4 }}>Your pad is being reviewed by our team. We'll notify you once it's approved and live.</div>
                    </div>
                  </div>
                  {pendingPads.length === 0 ? (
                    <div style={{ background: "rgba(14,31,64,0.04)", borderRadius: 16, padding: "28px 20px", textAlign: "center", border: "1px dashed rgba(14,31,64,0.18)", color: "rgba(14,31,64,0.35)", fontSize: 13 }}>
                      No pads pending review.
                    </div>
                  ) : pendingPads.map(pad => (
                  <div key={pad.id} onClick={() => setOpenPadId(pad.id)} style={{
                    background: "#fff", borderRadius: 18, border: "1px solid rgba(14,31,64,0.10)",
                    overflow: "hidden", marginBottom: 12,
                    boxShadow: "0 2px 12px rgba(14,31,64,0.10)", cursor: "pointer",
                    opacity: pad.status === "paused" || pad.status === "archived" ? 0.72 : 1,
                  }}>
                    <div style={{
                      height: 120,
                      background: `url(${pad.photoUrl}) center/cover, linear-gradient(135deg,rgba(141,214,63,0.18),rgba(14,31,64,0.12))`,
                      position: "relative",
                      filter: pad.status === "paused" || pad.status === "archived" ? "grayscale(0.55)" : "none",
                    }}>
                      <div style={{ position: "absolute", top: 10, right: 10 }}>
                        <StatusPill pad={pad} />
                      </div>
                      {pad.status !== "pending" && pad.status !== "archived" && (
                        <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.92)", borderRadius: 100, padding: "5px 8px 5px 10px", boxShadow: "0 2px 6px rgba(0,0,0,0.22)" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: NAVY, letterSpacing: 0.3 }}>
                            {pad.status === "paused" ? "Closed" : "Open"}
                          </span>
                          <PauseSwitch paused={pad.status === "paused"} onPress={() => requestPauseToggle(pad.id)} />
                        </div>
                      )}
                    </div>
                    <div style={{ padding: "12px 14px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                            <div style={{ fontSize: 14.5, fontWeight: 700, color: NAVY, letterSpacing: -0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {pad.name}
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); startRename(pad); }}
                              style={{ flexShrink: 0, padding: "2px 8px", borderRadius: 100, background: "rgba(141,214,63,0.12)", border: "1px solid rgba(141,214,63,0.35)", color: "#5a9e1a", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.2 }}
                            >
                              Rename
                            </button>
                          </div>
                          <div style={{ fontSize: 11.5, color: "rgba(14,31,64,0.45)" }}>
                            {pad.address} · {pad.type}{pad.spotCount > 1 ? ` · ${pad.spotCount} spots` : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: GREEN }}>${pad.price}<span style={{ fontSize: 10, color: "rgba(141,214,63,0.55)", fontWeight: 500 }}>/hr</span></div>
                          <div style={{ fontSize: 10, color: "rgba(14,31,64,0.38)", marginTop: 2 }}>Since {pad.since}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  ))}
                </>
              )}

              {/* Active / Archived pad cards */}
              {listTab !== "pending" && (
                (listTab === "active" ? sortedPads : archivedPads).length === 0 ? (
                  <div style={{ background: "rgba(14,31,64,0.04)", borderRadius: 16, padding: "28px 20px", textAlign: "center", border: "1px dashed rgba(14,31,64,0.18)", color: "rgba(14,31,64,0.35)", fontSize: 13 }}>
                    {listTab === "active" ? "No pads listed yet." : "No archived pads."}
                  </div>
                ) : (
                  (listTab === "active" ? sortedPads : archivedPads).map(pad => (
                    <div key={pad.id} onClick={() => setOpenPadId(pad.id)} style={{
                      background: "#fff", borderRadius: 18, border: "1px solid rgba(14,31,64,0.10)",
                      overflow: "hidden", marginBottom: 12,
                      boxShadow: "0 2px 12px rgba(14,31,64,0.10)", cursor: "pointer",
                      opacity: pad.status === "paused" || pad.status === "archived" ? 0.72 : 1,
                    }}>
                      <div style={{
                        height: 120,
                        background: `url(${pad.photoUrl}) center/cover, linear-gradient(135deg,rgba(141,214,63,0.18),rgba(14,31,64,0.12))`,
                        position: "relative",
                        filter: pad.status === "paused" || pad.status === "archived" ? "grayscale(0.55)" : "none",
                      }}>
                        <div style={{ position: "absolute", top: 10, right: 10 }}>
                          <StatusPill pad={pad} />
                        </div>
                        {pad.status !== "pending" && pad.status !== "archived" && (
                          <div style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.92)", borderRadius: 100, padding: "5px 8px 5px 10px", boxShadow: "0 2px 6px rgba(0,0,0,0.22)" }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: NAVY, letterSpacing: 0.3 }}>
                              {pad.status === "paused" ? "Closed" : "Open"}
                            </span>
                            <PauseSwitch paused={pad.status === "paused"} onPress={() => requestPauseToggle(pad.id)} />
                          </div>
                        )}
                      </div>
                      <div style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                              <div style={{ fontSize: 14.5, fontWeight: 700, color: NAVY, letterSpacing: -0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {pad.name}
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); startRename(pad); }}
                                style={{ flexShrink: 0, padding: "2px 8px", borderRadius: 100, background: "rgba(141,214,63,0.12)", border: "1px solid rgba(141,214,63,0.35)", color: "#5a9e1a", fontSize: 10, fontWeight: 800, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.2 }}
                              >
                                Rename
                              </button>
                            </div>
                            <div style={{ fontSize: 11.5, color: "rgba(14,31,64,0.45)" }}>
                              {pad.address} · {pad.type}{pad.spotCount > 1 ? ` · ${pad.spotCount} spots` : ""}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 17, fontWeight: 800, color: GREEN }}>${pad.price}<span style={{ fontSize: 10, color: "rgba(141,214,63,0.55)", fontWeight: 500 }}>/hr</span></div>
                            <div style={{ fontSize: 10, color: "rgba(14,31,64,0.38)", marginTop: 2 }}>Since {pad.since}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )
              )}

              {/* Add new pad */}
              <button onClick={startAddPad} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                padding: "13px 0", borderRadius: 14,
                background: "transparent", border: `2px dashed rgba(141,214,63,0.35)`,
                cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                fontSize: 14, fontWeight: 700, color: GREEN, letterSpacing: -0.2,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                Add another pad
              </button>
            </div>

          </>
          )
        ) : (
          /* ── DETAIL / EDIT VIEW (dark profile) ── */
          <>
            {/* Photo hero — swipeable gallery */}
            {(() => {
              const photos = openPad.photoUrls.length > 0 ? openPad.photoUrls : (openPad.photoUrl ? [openPad.photoUrl] : []);
              const safeIdx = Math.min(photoIndex, Math.max(0, photos.length - 1));
              const currentPhoto = photos[safeIdx] || "";
              return (
                <div
                  style={{ position: "relative", borderRadius: 20, overflow: "hidden", marginBottom: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.40)", cursor: currentPhoto ? "zoom-in" : "default" }}
                  onTouchStart={e => setTouchStartX(e.touches[0].clientX)}
                  onTouchEnd={e => {
                    if (touchStartX === null) return;
                    const dx = e.changedTouches[0].clientX - touchStartX;
                    if (Math.abs(dx) > 40) {
                      if (dx < 0) setPhotoIndex(i => Math.min(i + 1, photos.length - 1));
                      else setPhotoIndex(i => Math.max(i - 1, 0));
                    }
                    setTouchStartX(null);
                  }}
                  onClick={() => { if (currentPhoto) { setLightboxIndex(safeIdx); setLightboxOpen(true); } }}
                >
                  <div style={{ height: 210, background: currentPhoto ? `url(${currentPhoto}) center/cover` : `linear-gradient(135deg, #142A52 0%, #1e3d72 100%)`, transition: "background-image 0.2s" }} />
                  <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, transparent 35%, rgba(8,15,35,0.88) 100%)" }} />
                  <div style={{ position: "absolute", top: 12, left: 12 }}>
                    <StatusPill pad={openPad} />
                  </div>
                  <div style={{ position: "absolute", bottom: 14, left: 16, right: 16, minWidth: 0 }}>
                    <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", letterSpacing: -0.4, textShadow: "0 1px 5px rgba(0,0,0,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {openPad.name}
                    </div>
                    <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.68)", marginTop: 2, textShadow: "0 1px 3px rgba(0,0,0,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {openPad.address}, {openPad.city}
                    </div>
                    {/* Dot indicators */}
                    {photos.length > 1 && (
                      <div style={{ display: "flex", gap: 5, marginTop: 8 }} onClick={e => e.stopPropagation()}>
                        {photos.map((_, i) => (
                          <button key={i} onClick={() => setPhotoIndex(i)} style={{
                            width: i === safeIdx ? 16 : 6, height: 6, borderRadius: 3,
                            background: i === safeIdx ? "#8DD63F" : "rgba(255,255,255,0.45)",
                            border: "none", padding: 0, cursor: "pointer",
                            transition: "all 0.2s",
                          }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }} onClick={e => e.stopPropagation()}>
                    {openPad.spotId && (
                      <>
                        <button onClick={() => openDrawModal(false)} style={{
                          background: "rgba(141,214,63,0.20)", backdropFilter: "blur(8px)",
                          border: "1px solid rgba(141,214,63,0.45)", borderRadius: 100,
                          padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "#8DD63F",
                          cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                          display: "flex", alignItems: "center", gap: 5,
                        }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                          Redraw
                        </button>
                        <button onClick={() => openDrawModal(true)} style={{
                          background: "rgba(0,0,0,0.48)", backdropFilter: "blur(8px)",
                          border: "1px solid rgba(255,255,255,0.18)", borderRadius: 100,
                          padding: "7px 12px", fontSize: 11, fontWeight: 700, color: "#fff",
                          cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                          display: "flex", alignItems: "center", gap: 5,
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          Photo
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Quick stats */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[
                { l: "Listed", r: openPad.since },
                { l: "Bookings", r: String(openPad.bookings) },
              ].map(s => (
                <div key={s.l} style={{ flex: 1, background: "#142A52", borderRadius: 12, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 6px rgba(0,0,0,0.18)" }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.38)", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 3 }}>{s.l}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", letterSpacing: -0.2 }}>{s.r}</div>
                </div>
              ))}
            </div>

            {/* Open / Closed toggle */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, padding: "14px 16px", borderRadius: 14, marginBottom: 16,
              background: openPad.status === "active" ? "rgba(141,214,63,0.10)" : "rgba(255,200,0,0.10)",
              border: `1px solid ${openPad.status === "active" ? "rgba(141,214,63,0.26)" : "rgba(255,200,0,0.26)"}`,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", letterSpacing: -0.2 }}>
                  {openPad.status === "active" ? "Open for new bookings" : (openPad.pausedUntil ? "Closed for tonight" : "Closed indefinitely")}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.48)", marginTop: 2 }}>
                  {openPad.status === "active" ? "Drivers can find and book this pad." : "New bookings are paused."}
                </div>
              </div>
              {openPad.status !== "pending" && (
                <PauseSwitch paused={openPad.status === "paused"} onPress={() => requestPauseToggle(openPad.id)} />
              )}
            </div>

            {/* Auto-approve toggle */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 12, padding: "14px 16px", borderRadius: 14, marginBottom: 16,
              background: openPad.auto_approve ? "rgba(141,214,63,0.08)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${openPad.auto_approve ? "rgba(141,214,63,0.22)" : "rgba(255,255,255,0.08)"}`,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", letterSpacing: -0.2 }}>
                  Auto-approve extensions
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
                  {openPad.auto_approve
                    ? "Extension requests are approved instantly."
                    : "You'll review and approve each extension request."}
                </div>
              </div>
              <PauseSwitch paused={!openPad.auto_approve} onPress={() => toggleAutoApprove(openPad)} />
            </div>

            {/* ── LOCKED FIELDS ── */}
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.32)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
              Listing details · locked
            </div>
            <div style={{ background: "#142A52", borderRadius: 14, padding: "4px 14px", marginBottom: 18, border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 6px rgba(0,0,0,0.18)" }}>
              {([
                { label: "Address", value: `${openPad.address}, ${openPad.city}` },
                { label: "Pad type", value: openPad.type },
                { label: "Number of spots", value: String(openPad.spotCount) },
              ]).map((row, i, arr) => (
                <div key={row.label} style={{ display: "flex", alignItems: "center", padding: "13px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: 0.6, textTransform: "uppercase" }}>{row.label}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#fff", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.value}</div>
                  </div>
                  <button
                    onClick={() => openChangeRequest(row.label)}
                    style={{ flexShrink: 0, padding: "6px 11px", borderRadius: 100, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.62)", fontSize: 10.5, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.2, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Request change
                  </button>
                </div>
              ))}
            </div>

            {/* ── EDITABLE FIELDS ── */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.32)", letterSpacing: 0.8, textTransform: "uppercase" }}>
                Listing info · editable
              </div>
              {!editMode ? (
                <button
                  onClick={() => { setEditMode(true); setEditDraft({ name: openPad.name, price: openPad.price, description: openPad.description, services: [...openPad.services] }); setEditError(""); }}
                  style={{ padding: "5px 13px", borderRadius: 100, background: "rgba(141,214,63,0.15)", border: "1px solid rgba(141,214,63,0.35)", color: GREEN, fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: 0.2 }}
                >
                  Edit listing
                </button>
              ) : (
                <button
                  onClick={() => { setEditMode(false); setEditDraft(null); setEditError(""); }}
                  style={{ padding: "5px 13px", borderRadius: 100, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.62)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}
                >
                  Cancel
                </button>
              )}
            </div>
            <div style={{ background: "#142A52", borderRadius: 14, padding: "14px 14px", marginBottom: 14, border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 6px rgba(0,0,0,0.18)" }}>
              {/* Pad name */}
              <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.36)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Pad name</div>
                {editMode && editDraft ? (
                  <input
                    value={editDraft.name}
                    onChange={e => setEditDraft(d => d ? { ...d, name: e.target.value } : d)}
                    placeholder="e.g. Front driveway…"
                    maxLength={60}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid rgba(141,214,63,0.38)", background: "rgba(141,214,63,0.06)", fontSize: 14, color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600, outline: "none", boxSizing: "border-box" }}
                  />
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{openPad.name}</div>
                )}
              </div>
              {/* Price */}
              <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.36)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Price per hour</div>
                {editMode && editDraft ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, border: "1.5px solid rgba(141,214,63,0.38)", background: "rgba(141,214,63,0.06)" }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: GREEN }}>$</span>
                    <input
                      type="number" min="0" step="0.5"
                      value={editDraft.price}
                      onChange={e => setEditDraft(d => d ? { ...d, price: Number(e.target.value) || 0 } : d)}
                      style={{ flex: 1, padding: 0, border: "none", background: "transparent", fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: "'DM Sans',sans-serif", outline: "none" }}
                    />
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", fontWeight: 600 }}>/ hr</span>
                  </div>
                ) : (
                  <div style={{ fontSize: 20, fontWeight: 800, color: GREEN, letterSpacing: -0.4 }}>
                    ${openPad.price}<span style={{ fontSize: 11, color: "rgba(141,214,63,0.55)", fontWeight: 500 }}>/hr</span>
                  </div>
                )}
              </div>
              {/* Description */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.36)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>Description</div>
                {editMode && editDraft ? (
                  <textarea
                    value={editDraft.description}
                    onChange={e => setEditDraft(d => d ? { ...d, description: e.target.value } : d)}
                    rows={3}
                    placeholder="Tell renters what makes this spot great…"
                    style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1.5px solid rgba(141,214,63,0.38)", background: "rgba(141,214,63,0.06)", fontSize: 13.5, color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 500, outline: "none", resize: "vertical", boxSizing: "border-box", lineHeight: 1.45 }}
                  />
                ) : (
                  <div style={{ fontSize: 13.5, color: openPad.description ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.28)", lineHeight: 1.5, fontStyle: openPad.description ? "normal" : "italic" }}>
                    {openPad.description || "No description yet."}
                  </div>
                )}
              </div>
            </div>

            {/* Services */}
            <div style={{ background: "#142A52", borderRadius: 14, padding: "14px 14px", marginBottom: 14, border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 1px 6px rgba(0,0,0,0.18)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.36)", letterSpacing: 0.6, textTransform: "uppercase" }}>Services & amenities</div>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
                  color: serviceToast ? GREEN : "rgba(255,255,255,0.22)",
                  transition: "color 0.25s",
                }}>
                  {serviceToast ? "✓ Saved" : "Tap to toggle"}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {ALL_SERVICES.map(svc => {
                  const on = openPad.services.includes(svc);
                  return (
                    <button key={svc} onClick={() => {
                      toggleService(openPad.id, svc);
                      if (editDraft) {
                        setEditDraft(d => {
                          if (!d) return d;
                          const has = d.services.includes(svc);
                          return { ...d, services: has ? d.services.filter(s => s !== svc) : [...d.services, svc] };
                        });
                      }
                    }} style={{
                      padding: "7px 12px", borderRadius: 100,
                      background: on ? "rgba(141,214,63,0.16)" : "rgba(255,255,255,0.06)",
                      border: `1px solid ${on ? "rgba(141,214,63,0.40)" : "rgba(255,255,255,0.08)"}`,
                      color: on ? GREEN : "rgba(255,255,255,0.48)",
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                      fontFamily: "'DM Sans',sans-serif",
                      display: "flex", alignItems: "center", gap: 5,
                      transition: "background 0.15s, border-color 0.15s, color 0.15s",
                    }}>
                      {on && <span style={{ fontSize: 11 }}>✓</span>}
                      {svc}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Save / error row — only visible in edit mode */}
            {editMode && (
              <>
                {editError && <div style={{ fontSize: 12.5, color: "#ef4444", fontWeight: 600, marginBottom: 8, paddingLeft: 2 }}>{editError}</div>}
                <button
                  onClick={saveEdit}
                  disabled={editSaving}
                  style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: editSaving ? "rgba(141,214,63,0.35)" : GREEN, border: "none", color: NAVY, fontSize: 15, fontWeight: 800, cursor: editSaving ? "default" : "pointer", fontFamily: "'DM Sans',sans-serif", marginBottom: 20 }}
                >
                  {editSaving ? "Saving…" : "Save changes"}
                </button>
              </>
            )}

            {/* Archive */}
            {!editMode && openPad.status !== "archived" && (
              <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <button
                  onClick={() => setArchiveConfirmId(openPad.id)}
                  style={{
                    width: "100%", padding: "13px 0", borderRadius: 14,
                    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)",
                    color: "rgba(239,68,68,0.75)", fontSize: 13.5, fontWeight: 700,
                    cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
                  Archive this pad
                </button>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
                  Hides from customers &amp; map. Stays in your account.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Change Request modal ── */}
      {changeRequestField && (
        <div
          onClick={() => { setChangeRequestField(null); setChangeRequestSent(false); }}
          style={{ position: "fixed", inset: 0, background: "rgba(5,10,25,0.75)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 400, padding: 16, animation: "fadeIn 0.18s ease" }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 460, background: "#142A52", borderRadius: 22, padding: "20px 20px 28px", boxShadow: "0 -8px 36px rgba(0,0,0,0.50)", fontFamily: "'DM Sans',sans-serif", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.18)", borderRadius: 100, margin: "0 auto 18px" }} />
            {changeRequestSent ? (
              <div style={{ textAlign: "center", padding: "6px 0 2px" }}>
                <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: -0.3, marginBottom: 8 }}>Request sent!</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.58)", lineHeight: 1.55, marginBottom: 22 }}>
                  Our team will review your request to change <strong style={{ color: "#fff" }}>{changeRequestField.toLowerCase()}</strong> and reach out within 1–2 business days.
                </div>
                <button onClick={() => { setChangeRequestField(null); setChangeRequestSent(false); }} style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: GREEN, border: "none", color: NAVY, fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  Done
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.38)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 4 }}>Request a change</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: "#fff", letterSpacing: -0.3, marginBottom: 6 }}>{changeRequestField}</div>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.48)", marginBottom: 18, lineHeight: 1.5 }}>
                  This field is locked because changes can affect existing bookings. Describe what you'd like updated and our team will review it — typically within 1–2 business days.
                </div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.42)", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
                  What would you like to change it to?
                </div>
                <textarea
                  autoFocus
                  value={changeRequestText}
                  onChange={e => setChangeRequestText(e.target.value)}
                  rows={3}
                  placeholder={`Describe the change to ${changeRequestField.toLowerCase()}…`}
                  style={{ width: "100%", padding: "11px 13px", borderRadius: 12, border: "1.5px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", fontSize: 13.5, color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 500, outline: "none", resize: "none", boxSizing: "border-box", lineHeight: 1.45, marginBottom: 14 }}
                />
                <button
                  onClick={submitChangeRequest}
                  disabled={changeRequestSending || !changeRequestText.trim()}
                  style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: changeRequestSending || !changeRequestText.trim() ? "rgba(141,214,63,0.28)" : GREEN, border: "none", color: NAVY, fontSize: 15, fontWeight: 800, cursor: changeRequestSending || !changeRequestText.trim() ? "default" : "pointer", fontFamily: "'DM Sans',sans-serif", marginBottom: 10 }}
                >
                  {changeRequestSending ? "Sending…" : "Submit request"}
                </button>
                <button onClick={() => setChangeRequestField(null)} style={{ width: "100%", padding: "10px 0", borderRadius: 100, background: "transparent", border: "none", color: "rgba(255,255,255,0.42)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Pause confirmation modal */}
      {/* ── Rename modal ── */}
      {renamingPad && (
        <div
          onClick={() => setRenamingPad(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(14,31,64,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 300, padding: 16, animation: "fadeIn 0.18s ease" }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 22, padding: "20px 20px 28px", boxShadow: "0 -8px 30px rgba(14,31,64,0.25)", fontFamily: "'DM Sans',sans-serif" }}>
            <div style={{ width: 36, height: 4, background: "rgba(14,31,64,0.18)", borderRadius: 100, margin: "0 auto 16px" }} />
            <div style={{ fontSize: 18, fontWeight: 800, color: NAVY, letterSpacing: -0.3, marginBottom: 4 }}>Rename pad</div>
            <div style={{ fontSize: 12.5, color: "rgba(14,31,64,0.50)", marginBottom: 16, lineHeight: 1.45 }}>
              Give your pad a unique name — no two pads on Lily Pad can share the same name.
            </div>
            <input
              autoFocus
              value={renameValue}
              onChange={e => { setRenameValue(e.target.value); setRenameError(""); }}
              onKeyDown={e => e.key === "Enter" && saveRename()}
              placeholder="e.g. Front driveway, Oak Street spot…"
              maxLength={60}
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1.5px solid ${renameError ? "rgba(239,68,68,0.60)" : "rgba(14,31,64,0.18)"}`, background: "#fff", fontSize: 15, color: NAVY, fontFamily: "'DM Sans',sans-serif", fontWeight: 600, outline: "none", boxSizing: "border-box", marginBottom: renameError ? 6 : 14 }}
            />
            {renameError && (
              <div style={{ fontSize: 12, color: "#ef4444", fontWeight: 600, marginBottom: 14, paddingLeft: 2 }}>{renameError}</div>
            )}
            <button
              onClick={saveRename}
              disabled={renameSaving || !renameValue.trim()}
              style={{ width: "100%", padding: "14px 0", borderRadius: 14, background: renameSaving || !renameValue.trim() ? "rgba(141,214,63,0.30)" : GREEN, border: "none", color: NAVY, fontSize: 15, fontWeight: 800, cursor: renameSaving || !renameValue.trim() ? "default" : "pointer", fontFamily: "'DM Sans',sans-serif", marginBottom: 10 }}>
              {renameSaving ? "Saving…" : "Save name"}
            </button>
            <button onClick={() => setRenamingPad(null)} style={{ width: "100%", padding: "10px 0", borderRadius: 100, background: "transparent", border: "none", color: "rgba(14,31,64,0.50)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

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
              <strong style={{ color: NAVY }}>{pendingPad.name || pendingPad.address}</strong> won't appear to new drivers. Any bookings already on the calendar will still go through.
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

    {/* ── Archive confirmation sheet ── */}
    {archiveConfirmId !== null && (() => {
      const pad = pads.find(p => p.id === archiveConfirmId);
      return (
        <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={() => setArchiveConfirmId(null)} style={{ position: "absolute", inset: 0, background: "rgba(14,31,64,0.55)", backdropFilter: "blur(4px)" }} />
          <div style={{
            position: "relative", background: "#fff", borderRadius: "22px 22px 0 0",
            padding: "24px 20px 40px", width: "100%", maxWidth: 430, zIndex: 1,
          }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(239,68,68,0.10)", display: "flex", alignItems: "center",
                justifyContent: "center", margin: "0 auto 14px",
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(239,68,68,0.8)" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>
                </svg>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: NAVY, marginBottom: 8 }}>
                Archive "{pad?.nickname || pad?.address}"?
              </div>
              <div style={{ fontSize: 13, color: "rgba(14,31,64,0.55)", lineHeight: 1.6 }}>
                This pad will be hidden from customers and the map immediately. You can view it in your Archived tab. This action cannot be undone from the app.
              </div>
            </div>
            <button
              onClick={() => archivePad(archiveConfirmId)}
              disabled={archiving}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 14,
                background: archiving ? "rgba(239,68,68,0.35)" : "rgba(239,68,68,0.85)",
                border: "none", color: "#fff", fontSize: 15, fontWeight: 800,
                cursor: archiving ? "default" : "pointer",
                fontFamily: "'DM Sans',sans-serif", marginBottom: 10,
              }}
            >
              {archiving ? "Archiving…" : "Yes, archive this pad"}
            </button>
            <button
              onClick={() => setArchiveConfirmId(null)}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 100,
                background: "transparent", border: "none",
                color: "rgba(14,31,64,0.55)", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    })()}

    {/* ── Photo lightbox ── */}
    {lightboxOpen && openPad && (() => {
      const photos = openPad.photoUrls.length > 0 ? openPad.photoUrls : (openPad.photoUrl ? [openPad.photoUrl] : []);
      const safeIdx = Math.min(lightboxIndex, Math.max(0, photos.length - 1));
      return (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(0,0,0,0.95)", display: "flex", flexDirection: "column", fontFamily: "'DM Sans',sans-serif" }}
          onTouchStart={e => setLbTouchStartX(e.touches[0].clientX)}
          onTouchEnd={e => {
            if (lbTouchStartX === null) return;
            const dx = e.changedTouches[0].clientX - lbTouchStartX;
            if (Math.abs(dx) > 40) {
              if (dx < 0) setLightboxIndex(i => Math.min(i + 1, photos.length - 1));
              else setLightboxIndex(i => Math.max(i - 1, 0));
            }
            setLbTouchStartX(null);
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", flexShrink: 0 }}>
            <button
              onClick={() => setLightboxOpen(false)}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", fontWeight: 600 }}>
              {photos.length > 1 ? `${safeIdx + 1} / ${photos.length}` : openPad.name}
            </div>
            <div style={{ width: 36 }} />
          </div>
          {/* Full-screen photo */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 16px", minHeight: 0 }}>
            <img
              src={photos[safeIdx]}
              alt="Pad photo"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 12, userSelect: "none" }}
              draggable={false}
            />
          </div>
          {/* Dot indicators + arrows */}
          {photos.length > 1 && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: "16px 16px 32px" }}>
              <button
                onClick={() => setLightboxIndex(i => Math.max(i - 1, 0))}
                disabled={safeIdx === 0}
                style={{ width: 32, height: 32, borderRadius: "50%", background: safeIdx === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", cursor: safeIdx === 0 ? "default" : "pointer", padding: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <div style={{ display: "flex", gap: 6 }}>
                {photos.map((_, i) => (
                  <button key={i} onClick={() => setLightboxIndex(i)} style={{
                    width: i === safeIdx ? 18 : 7, height: 7, borderRadius: 3.5,
                    background: i === safeIdx ? "#8DD63F" : "rgba(255,255,255,0.35)",
                    border: "none", padding: 0, cursor: "pointer", transition: "all 0.2s",
                  }} />
                ))}
              </div>
              <button
                onClick={() => setLightboxIndex(i => Math.min(i + 1, photos.length - 1))}
                disabled={safeIdx === photos.length - 1}
                style={{ width: 32, height: 32, borderRadius: "50%", background: safeIdx === photos.length - 1 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", cursor: safeIdx === photos.length - 1 ? "default" : "pointer", padding: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          )}
        </div>
      );
    })()}

    {/* ── Spot draw modal ── */}
    {drawModalOpen && openPad && openPad.spotId && user && (
      <SpotDrawModal
        photoUrl={openPad.photoUrl}
        rawPhotoUrl={openPad.rawPhotoUrl || undefined}
        spotId={openPad.spotId}
        userId={user.id}
        numPads={openPad.spotCount}
        startWithPicker={drawStartWithPicker}
        onClose={() => { setDrawModalOpen(false); setDrawStartWithPicker(false); }}
        onSaved={(newUrl, rawUrl) => {
          updatePad(openPad.id, { photoUrl: newUrl, rawPhotoUrl: rawUrl, photoUrls: [newUrl] });
          setDrawModalOpen(false);
          setDrawStartWithPicker(false);
        }}
      />
    )}

    {/* ── Booking chat drawer ── */}
    {chatBooking && user?.id && (
      <BookingChatDrawer
        bookingId={chatBooking.id}
        bookingAddr={chatBooking.addr}
        myUserId={user.id}
        myRole="host"
        otherName={chatBooking.driverName}
        onClose={() => setChatBooking(null)}
      />
    )}
    </>
  );
}
