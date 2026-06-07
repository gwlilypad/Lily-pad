import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { formatSupportTime, ticketLastPreview, type SupportTicket } from "@/lib/support";
import {
  fetchConversations, createConversation, sendMessage, subscribeToSupport,
} from "@/lib/supportApi";

export default function CustomerServicePage() {
  const { goTo, state } = useApp();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [tickets, setTickets]           = useState<SupportTicket[]>([]);
  const [loading, setLoading]           = useState(true);
  const [view, setView]                 = useState<"menu" | "thread">("menu");
  const [activeId, setActiveId]         = useState<string | null>(null);
  const [draft, setDraft]               = useState("");
  const [sending, setSending]           = useState(false);
  const threadEndRef                    = useRef<HTMLDivElement>(null);
  const lastRefreshRef                  = useRef(0);

  const userId = user?.id ?? null;

  function identity() {
    const first = profile?.first_name || state.drAns[0] || state.suAns[0] || "";
    const last  = profile?.last_name  || state.drAns[1] || state.suAns[1] || "";
    const email = profile?.email      || state.drAns[2] || state.suAns[2] || "";
    return {
      userName:    `${first} ${last}`.trim() || "Guest",
      userEmail:   email.trim(),
      accountType: (state.accountType === "padRenter" ? "padRenter" : "renter") as "renter" | "padRenter",
    };
  }

  async function refresh() {
    const now = Date.now();
    if (now - lastRefreshRef.current < 1500) return;
    lastRefreshRef.current = now;
    const data = await fetchConversations(userId);
    setTickets(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    return subscribeToSupport(refresh);
  }, [userId]);

  useEffect(() => {
    if (view === "thread") {
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  }, [view, tickets]);

  async function startNewChat() {
    const id = identity();
    setLoading(true);
    const ticket = await createConversation({
      userId,
      userName:    id.userName,
      userEmail:   id.userEmail,
      accountType: id.accountType,
    });
    if (ticket) {
      setTickets(prev => [ticket, ...prev.filter(t => t.id !== ticket.id)]);
      setActiveId(ticket.id);
      setView("thread");
    }
    setLoading(false);
  }

  async function sendUserMsg() {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    setSending(true);
    setDraft("");
    const id = identity();
    const now = Date.now();
    // Optimistic update
    setTickets(prev => prev.map(t => t.id === activeId ? {
      ...t,
      updatedAt: now,
      messages: [...t.messages, {
        id: `opt-${now}`, from: "user" as const, text, ts: now,
      }],
    } : t));
    await sendMessage({
      conversationId: activeId,
      senderId:       userId,
      senderName:     id.userName || "Customer",
      senderRole:     "customer",
      message:        text,
    });
    setSending(false);
    await refresh();
  }

  const myTickets = tickets
    .filter(t => t.status !== "resolved")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const activeTicket = activeId ? tickets.find(t => t.id === activeId) || null : null;

  const BackBtn = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} style={{
      background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center",
      justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0E1F40", fontFamily: '"DM Sans", sans-serif', overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ flexShrink: 0, padding: "52px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {view === "thread"
            ? <BackBtn onClick={() => { setView("menu"); setActiveId(null); }} />
            : <BackBtn onClick={() => navigate(-1)} />
          }
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>
              {view === "thread" && activeTicket ? activeTicket.subject : "Customer Service"}
            </div>
            {view === "menu" && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>We usually reply within a few minutes</div>
            )}
            {view === "thread" && activeTicket && (
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>
                {activeTicket.status === "open" ? "Open"
                  : activeTicket.status === "pending_resolution" ? "Pending resolution"
                  : "Resolved"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      {view === "menu" ? (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.55 }}>
            How can we help? Start a chat with a real Lilypad rep — they usually reply within a few minutes.
          </p>

          <button
            onClick={startNewChat}
            disabled={loading}
            style={{ background: "#8DD63F", color: "#0E1F40", border: "none", borderRadius: 14, padding: "16px", display: "flex", alignItems: "center", gap: 12, cursor: loading ? "default" : "pointer", fontFamily: '"DM Sans",sans-serif', textAlign: "left", width: "100%", opacity: loading ? 0.7 : 1 }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(14,31,64,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.2 }}>Chat with a rep</div>
              <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.78, marginTop: 2 }}>Live · usually a few minutes</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="m9 18 6-6-6-6"/></svg>
          </button>

          {!loading && myTickets.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.40)", letterSpacing: 0.6, textTransform: "uppercase" }}>
                Your conversations · {myTickets.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {myTickets.map(t => {
                  const last = t.messages[t.messages.length - 1];
                  const unread = last && last.from !== "user";
                  return (
                    <div key={t.id} onClick={() => { setActiveId(t.id); setView("thread"); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 14, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer" }}>
                      <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(141,214,63,0.18)", color: "#8DD63F", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</span>
                          {t.status === "pending_resolution" && (
                            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, color: "#FACC15", background: "rgba(250,204,21,0.16)", flexShrink: 0 }}>Pending</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: unread ? "#8DD63F" : "rgba(255,255,255,0.45)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: unread ? 700 : 400 }}>
                          {ticketLastPreview(t)}
                        </div>
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>{formatSupportTime(t.updatedAt)}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 0" }}>
              <div style={{ width: 24, height: 24, border: "3px solid rgba(141,214,63,0.25)", borderTopColor: "#8DD63F", borderRadius: "50%", animation: "cs-spin 0.8s linear infinite" }} />
              <style>{`@keyframes cs-spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
        </div>

      ) : view === "thread" && activeTicket ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
            {activeTicket.messages.map(m => {
              const isUser = m.from === "user";
              const isBot  = m.from === "bot";
              return (
                <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
                  {!isUser && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: isBot ? "#8DD63F" : "#9DBEFF", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 3, paddingLeft: 4 }}>
                      {isBot ? "Lily · Support bot" : (m.agentName || "Support rep")}
                    </div>
                  )}
                  <div style={{
                    maxWidth: "82%", padding: "10px 14px", borderRadius: 16,
                    background: isUser ? "#8DD63F" : isBot ? "rgba(141,214,63,0.14)" : "rgba(255,255,255,0.10)",
                    color: isUser ? "#0E1F40" : "#fff",
                    fontSize: 14, lineHeight: 1.45, fontWeight: isUser ? 600 : 500,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>{m.text}</div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.30)", marginTop: 3, padding: "0 4px" }}>{formatSupportTime(m.ts)}</div>
                </div>
              );
            })}
            {activeTicket.messages.length === 0 && (
              <div style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 13, padding: "32px 0" }}>Loading messages…</div>
            )}
            <div ref={threadEndRef} />
          </div>

          {activeTicket.status === "resolved" && (
            <div style={{ margin: "0 16px 8px", background: "rgba(120,170,255,0.10)", border: "1px solid rgba(120,170,255,0.25)", borderRadius: 12, padding: "10px 14px", color: "rgba(255,255,255,0.72)", fontSize: 12, textAlign: "center" }}>
              This conversation was marked resolved. Send a message to reopen it.
            </div>
          )}

          <div style={{ flexShrink: 0, padding: "8px 16px 36px", display: "flex", gap: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendUserMsg(); } }}
              placeholder="Type a message…"
              style={{ flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 100, padding: "12px 18px", color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif', outline: "none" }}
            />
            <button
              onClick={sendUserMsg}
              disabled={!draft.trim() || sending}
              style={{ background: draft.trim() && !sending ? "#8DD63F" : "rgba(141,214,63,0.30)", color: "#0E1F40", border: "none", borderRadius: "50%", width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center", cursor: draft.trim() && !sending ? "pointer" : "default", flexShrink: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
