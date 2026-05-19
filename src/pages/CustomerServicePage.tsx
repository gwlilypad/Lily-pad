import { useState, useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import {
  loadTickets, subscribeTickets, mutateTickets,
  getOrCreateUserId, makeId, formatSupportTime, ticketLastPreview,
  type SupportTicket,
} from "@/lib/support";

export default function CustomerServicePage() {
  const { goTo, state } = useApp();
  const { profile } = useAuth();

  const [tickets, setTickets] = useState<SupportTicket[]>(() => loadTickets());
  const userId = useRef<string>(getOrCreateUserId());
  const [view, setView] = useState<"menu" | "thread">("menu");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const threadEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeTickets(() => setTickets(loadTickets())), []);

  useEffect(() => {
    if (view === "thread") {
      setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    }
  }, [view, tickets]);

  function identity() {
    const first = profile?.first_name || state.drAns[0] || state.suAns[0] || "";
    const last  = profile?.last_name  || state.drAns[1] || state.suAns[1] || "";
    const email = profile?.email      || state.drAns[2] || state.suAns[2] || "";
    return {
      userName: `${first} ${last}`.trim() || "Guest",
      userEmail: email.trim(),
      accountType: (state.accountType === "padRenter" ? "padRenter" : "renter") as "padRenter" | "renter",
    };
  }

  function startNewChat() {
    const id = identity();
    const now = Date.now();
    const t: SupportTicket = {
      id: makeId("t"),
      userId: userId.current,
      userName: id.userName,
      userEmail: id.userEmail,
      accountType: id.accountType,
      subject: "Live chat with a rep",
      status: "open",
      openedByAgent: false,
      createdAt: now,
      updatedAt: now,
      messages: [{
        id: makeId("m"),
        from: "bot",
        text: "Hi there! You're connected with Lilypad support. A rep usually replies within a few minutes — what's going on?",
        ts: now,
      }],
    };
    const next = mutateTickets(cur => [t, ...cur.filter(x => x.id !== t.id)]);
    setTickets(next);
    setActiveId(t.id);
    setView("thread");
    setDraft("");
  }

  function sendMessage(ticketId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = Date.now();
    const msg = { id: makeId("m"), from: "user" as const, text: trimmed, ts: now };
    const next = mutateTickets(cur => cur.map(t => t.id === ticketId
      ? { ...t, status: "open" as const, openedByAgent: false, updatedAt: now, messages: [...t.messages, msg] }
      : t));
    setTickets(next);
    setDraft("");
  }

  const myTickets = tickets
    .filter(t => t.userId === userId.current && t.status !== "resolved")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const activeTicket = activeId ? tickets.find(t => t.id === activeId) || null : null;

  const backBtn = (onClick: () => void) => (
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
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "52px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {view === "thread"
            ? backBtn(() => { setView("menu"); setActiveId(null); })
            : backBtn(() => goTo("find"))
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
                {activeTicket.status === "open" ? "Open" : activeTicket.status === "pending_resolution" ? "Pending resolution" : "Resolved"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      {view === "menu" ? (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", margin: 0, lineHeight: 1.5 }}>
            How can we help? Start a chat with a real Lilypad rep — they usually reply within a few minutes.
          </p>

          <button
            onClick={() => startNewChat()}
            style={{ background: "#8DD63F", color: "#0E1F40", border: "none", borderRadius: 14, padding: "16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", fontFamily: '"DM Sans",sans-serif', textAlign: "left", width: "100%" }}
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

          {myTickets.length > 0 && (
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
                      {isBot ? "Lily · Support bot" : `${m.agentName || "Support rep"}`}
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
            <div ref={threadEndRef} />
          </div>

          {activeTicket.status === "resolved" && (
            <div style={{ margin: "0 16px 8px", background: "rgba(120,170,255,0.10)", border: "1px solid rgba(120,170,255,0.25)", borderRadius: 12, padding: "10px 14px", color: "rgba(255,255,255,0.72)", fontSize: 12, textAlign: "center" }}>
              This conversation was marked resolved. Send a new message to reopen it.
            </div>
          )}

          <div style={{ flexShrink: 0, padding: "8px 16px 32px", display: "flex", gap: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(activeTicket.id, draft); } }}
              placeholder="Type a message…"
              style={{ flex: 1, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 100, padding: "12px 18px", color: "#fff", fontSize: 14, fontFamily: '"DM Sans",sans-serif', outline: "none" }}
            />
            <button
              onClick={() => sendMessage(activeTicket.id, draft)}
              disabled={!draft.trim()}
              style={{ background: draft.trim() ? "#8DD63F" : "rgba(141,214,63,0.30)", color: "#0E1F40", border: "none", borderRadius: "50%", width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center", cursor: draft.trim() ? "pointer" : "default", flexShrink: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
