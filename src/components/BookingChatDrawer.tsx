import { useState, useEffect, useRef, useCallback } from "react";
import { authenticatedHeaders } from "@/lib/apiAuth";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

interface ChatMessage {
  id: string;
  booking_id: string;
  sender_id: string;
  sender_role: "driver" | "host";
  message: string;
  created_at: string;
}

interface Props {
  bookingId: string;
  bookingAddr: string;
  myUserId: string;
  myRole: "driver" | "host";
  otherName: string;
  onClose: () => void;
}

function fmtMsgTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function BookingChatDrawer({ bookingId, bookingAddr, myUserId, myRole, otherName, onClose }: Props) {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [draft, setDraft]         = useState("");
  const [sending, setSending]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [sendErr, setSendErr]     = useState("");
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLTextAreaElement>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async (silent = false) => {
    try {
      const r = await fetch(`/api/booking-chat/${bookingId}`, { headers: await authenticatedHeaders() });
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data)) setMessages(data);
    } catch {}
    if (!silent) setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    fetchMessages();
    pollRef.current = setInterval(() => fetchMessages(true), 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true); setSendErr("");
    try {
      const r = await fetch(`/api/booking-chat/${bookingId}`, {
        method: "POST",
        headers: await authenticatedHeaders("application/json"),
        body: JSON.stringify({ sender_id: myUserId, sender_role: myRole, message: text }),
      });
      if (!r.ok) { setSendErr("Failed to send. Try again."); return; }
      setDraft("");
      await fetchMessages(true);
    } catch { setSendErr("Network error."); }
    finally { setSending(false); }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9200,
      background: NAVY, display: "flex", flexDirection: "column",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        flexShrink: 0, padding: "52px 16px 14px", background: NAVY,
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={onClose} style={{
          width: 36, height: 36, borderRadius: "50%",
          background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", padding: 0, flexShrink: 0,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: -0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {myRole === "driver" ? `Host · ${otherName}` : `Driver · ${otherName}`}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.38)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bookingAddr}
          </div>
        </div>
        <div style={{
          background: "rgba(141,214,63,0.12)", border: "1px solid rgba(141,214,63,0.25)",
          borderRadius: 100, padding: "4px 10px", fontSize: 10, fontWeight: 800,
          color: GREEN, letterSpacing: 0.3, textTransform: "uppercase" as const, flexShrink: 0,
        }}>
          {myRole === "driver" ? "Driver" : "Host"}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "60px 0" }}>
            <div style={{ width: 24, height: 24, border: `2px solid rgba(141,214,63,0.3)`, borderTopColor: GREEN, borderRadius: "50%", animation: "lp-spin 0.8s linear infinite", margin: "0 auto" }} />
            <style>{`@keyframes lp-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(141,214,63,0.10)", border: "1px solid rgba(141,214,63,0.18)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.55)" }}>No messages yet</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.28)", lineHeight: 1.6 }}>
              {myRole === "driver"
                ? "Send a message to your host about this booking."
                : "Message the driver about their reservation."}
            </div>
          </div>
        ) : messages.map((m, i) => {
          const isMe = m.sender_role === myRole;
          const prevSame = i > 0 && messages[i - 1].sender_role === m.sender_role;
          return (
            <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", marginTop: prevSame ? 2 : 8 }}>
              <div style={{
                maxWidth: "78%",
                background: isMe ? GREEN : "rgba(255,255,255,0.10)",
                color: isMe ? NAVY : "#fff",
                borderRadius: isMe
                  ? (prevSame ? "16px 4px 4px 16px" : "16px 16px 4px 16px")
                  : (prevSame ? "4px 16px 16px 4px" : "16px 16px 16px 4px"),
                padding: "10px 14px",
                fontSize: 13.5, fontWeight: 500, lineHeight: 1.45,
                wordBreak: "break-word" as const,
              }}>
                {m.message}
              </div>
              {(i === messages.length - 1 || messages[i + 1]?.sender_role !== m.sender_role) && (
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 3, marginLeft: isMe ? 0 : 4, marginRight: isMe ? 4 : 0 }}>
                  {fmtMsgTime(m.created_at)}
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        flexShrink: 0, padding: "10px 16px env(safe-area-inset-bottom, 16px)",
        background: "rgba(5,15,31,0.97)", borderTop: "1px solid rgba(255,255,255,0.07)",
      }}>
        {sendErr && <div style={{ fontSize: 11, color: "#f87171", marginBottom: 6, fontWeight: 600 }}>{sendErr}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={e => { setDraft(e.target.value); setSendErr(""); }}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder={myRole === "driver" ? "Message your host…" : "Message the driver…"}
            rows={1}
            style={{
              flex: 1, resize: "none" as const,
              background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.12)",
              borderRadius: 14, color: "#fff", fontFamily: "'DM Sans', sans-serif",
              fontSize: 13, padding: "10px 14px", outline: "none", lineHeight: 1.45,
              maxHeight: 100, overflowY: "auto" as const,
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!draft.trim() || sending}
            style={{
              width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
              background: draft.trim() && !sending ? GREEN : "rgba(141,214,63,0.20)",
              border: "none", cursor: draft.trim() && !sending ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 0.15s",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke={draft.trim() && !sending ? NAVY : "rgba(255,255,255,0.35)"}
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
