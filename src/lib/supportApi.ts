import { supabase } from "@/lib/supabase";
import { authenticatedHeaders } from "@/lib/apiAuth";
import type { SupportTicket, SupportMessage, SupportResolution } from "@/lib/support";

// ── Supabase row shapes ───────────────────────────────────────────────────────
interface ConvRow {
  id: string;
  user_id: string | null;
  user_name: string;
  user_email: string;
  subject: string;
  status: string;
  last_message: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

interface MsgRow {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_name: string;
  sender_role: string;  // 'customer' | 'staff' | 'admin' | 'bot'
  message: string;
  created_at: string;
}

// ── Local-only metadata (things not stored in Supabase) ───────────────────────
// openedByAgent, resolution, accountType — stored keyed by conversation id
const META_KEY = "lilypad.support.meta.v2";
type LocalMeta = Record<string, {
  openedByAgent?: boolean;
  accountType?: "renter" | "padRenter";
  resolution?: SupportResolution;
}>;

function loadMeta(): LocalMeta {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? "{}"); } catch { return {}; }
}
function saveMeta(m: LocalMeta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {}
}
export function setLocalMeta(convId: string, patch: Partial<LocalMeta[string]>) {
  const m = loadMeta();
  m[convId] = { ...m[convId], ...patch };
  saveMeta(m);
}
export function getLocalMeta(convId: string): LocalMeta[string] {
  return loadMeta()[convId] ?? {};
}

// ── Row → SupportTicket mapping ───────────────────────────────────────────────
function msgRowToMsg(m: MsgRow): SupportMessage {
  const from: "user" | "agent" | "bot" =
    m.sender_role === "bot"      ? "bot"   :
    m.sender_role === "customer" ? "user"  : "agent";
  return {
    id: m.id,
    from,
    text: m.message,
    ts: new Date(m.created_at).getTime(),
    agentName: from === "agent" ? (m.sender_name || "Support rep") : undefined,
  };
}

function convToTicket(conv: ConvRow, msgs: MsgRow[]): SupportTicket {
  const meta = loadMeta()[conv.id] ?? {};
  return {
    id: conv.id,
    userId: conv.user_id ?? conv.user_email ?? "anon",
    userName: conv.user_name || "Guest",
    userEmail: conv.user_email || "",
    accountType: meta.accountType ?? "renter",
    subject: conv.subject || "Support Request",
    status: (conv.status as SupportTicket["status"]) || "open",
    openedByAgent: meta.openedByAgent ?? false,
    createdAt: new Date(conv.created_at).getTime(),
    updatedAt: new Date(conv.updated_at).getTime(),
    messages: msgs.map(msgRowToMsg),
    resolution: meta.resolution,
  };
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(path: string, init?: RequestInit) {
  const authHeaders = await authenticatedHeaders("application/json");
  const r = await fetch(path, {
    ...init,
    headers: { ...authHeaders, ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`API ${path} → ${r.status}`);
  if (r.status === 204) return null;
  return r.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch conversations (+ all messages) for one user, or all if no userId. */
export async function fetchConversations(userId?: string | null): Promise<SupportTicket[]> {
  try {
    const url = userId
      ? `/api/support/conversations?user_id=${encodeURIComponent(userId)}`
      : `/api/support/conversations`;
    const convs: ConvRow[] = await apiFetch(url);
    if (!Array.isArray(convs) || convs.length === 0) return [];
    const withMsgs = await Promise.all(
      convs.map(async conv => {
        const msgs: MsgRow[] = await apiFetch(
          `/api/support/conversations/${conv.id}/messages`
        ).catch(() => []);
        return convToTicket(conv, Array.isArray(msgs) ? msgs : []);
      })
    );
    return withMsgs;
  } catch {
    return [];
  }
}

/** Create a new conversation, returns the created SupportTicket. */
export async function createConversation(params: {
  userId: string | null;
  userName: string;
  userEmail: string;
  accountType: "renter" | "padRenter";
}): Promise<SupportTicket | null> {
  try {
    const botIntro = "Hi there! You're connected with Lilypad support. A rep usually replies within a few minutes — what's going on?";
    const conv: ConvRow = await apiFetch("/api/support/conversations", {
      method: "POST",
      body: JSON.stringify({
        user_id: params.userId,
        user_name: params.userName,
        user_email: params.userEmail,
        subject: "Live chat with a rep",
      }),
    });
    if (!conv?.id) return null;

    // Send the bot intro message (server created conv without a first_message)
    await apiFetch("/api/support/messages", {
      method: "POST",
      body: JSON.stringify({
        conversation_id: conv.id,
        sender_id: null,
        sender_name: "Lily",
        sender_role: "bot",
        message: botIntro,
      }),
    });

    // Store account type locally
    setLocalMeta(conv.id, { accountType: params.accountType });

    // Fetch the full conversation with messages
    const msgs: MsgRow[] = await apiFetch(
      `/api/support/conversations/${conv.id}/messages`
    ).catch(() => []);

    broadcastUpdate();
    return convToTicket(conv, Array.isArray(msgs) ? msgs : []);
  } catch {
    return null;
  }
}

/** Send a message in a conversation. */
export async function sendMessage(params: {
  conversationId: string;
  senderId: string | null;
  senderName: string;
  senderRole: "customer" | "staff" | "admin" | "bot";
  message: string;
}): Promise<boolean> {
  try {
    await apiFetch("/api/support/messages", {
      method: "POST",
      body: JSON.stringify({
        conversation_id: params.conversationId,
        sender_id: params.senderId,
        sender_name: params.senderName,
        sender_role: params.senderRole,
        message: params.message,
      }),
    });
    broadcastUpdate();
    return true;
  } catch {
    return false;
  }
}

/** Update a conversation's status (open / pending_resolution / resolved). */
export async function updateConversationStatus(
  id: string,
  status: SupportTicket["status"]
): Promise<boolean> {
  try {
    await apiFetch(`/api/support/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    broadcastUpdate();
    return true;
  } catch {
    return false;
  }
}

/** Delete a conversation (admin only). */
export async function deleteConversation(id: string): Promise<boolean> {
  try {
    await apiFetch(`/api/support/conversations/${id}`, { method: "DELETE" });
    broadcastUpdate();
    return true;
  } catch {
    return false;
  }
}

// ── Real-time ─────────────────────────────────────────────────────────────────
// Uses Supabase Broadcast (no RLS restrictions) + 5-second polling as fallback.
// Any write calls broadcastUpdate() → all subscribers get notified instantly.

const BC_CHANNEL = "lilypad:support:v1";

function broadcastUpdate() {
  try {
    supabase.channel(BC_CHANNEL).send({
      type: "broadcast",
      event: "refresh",
      payload: { at: Date.now() },
    });
  } catch { /* ignore */ }
}

/**
 * Subscribe to support data changes. Call the returned function to unsubscribe.
 * Fires immediately on any write from any client, plus polls every 5s as backup.
 */
export function subscribeToSupport(handler: () => void): () => void {
  const channel = supabase
    .channel(BC_CHANNEL)
    .on("broadcast", { event: "refresh" }, () => handler())
    .subscribe();

  const interval = setInterval(handler, 5000);

  return () => {
    supabase.removeChannel(channel);
    clearInterval(interval);
  };
}
