export const SUPPORT_TICKETS_KEY = "lilypad.support.tickets.v1";
export const SUPPORT_USER_KEY = "lilypad.support.userId.v1";
export const SUPPORT_TICKETS_EVENT = "lilypad:support:tickets-changed";

/**
 * Quality grade attached to an agent message. Surfaced on the admin side
 * (chat review + per-staff scorecards) and intentionally hidden from staff —
 * staff never see their own scores. Each axis is 1–5; `overall` is the mean.
 */
export type MessageRating = {
  professionalism: number; // 1-5: tone, vocabulary, courtesy
  spelling: number;        // 1-5: common misspellings
  grammar: number;         // 1-5: punctuation + capitalization
  responseTime: number;    // 1-5: time since the customer's last message
  overall: number;         // 1-5: arithmetic mean of the four axes
};

export type SupportMessage = {
  id: string;
  from: "user" | "agent" | "bot";
  text: string;
  ts: number;
  agentName?: string;
  /** Set only on `from === "agent"` messages. Computed at send-time. */
  rating?: MessageRating;
};

const clampScore = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

// ── Heuristic grader ────────────────────────────────────────────────────────
// Deterministic, mock-only. A real backend would hand this off to an NLP model.
// Each axis starts at 5 and loses 1 per detected issue (floored at 1).

const SLANG_TOKENS = ["lol", "lmao", "bruh", "ya", "yea", "yeah", "nah", "wtf", "omg", "ugh", "idk", "kinda", "sorta", "gonna"];
const COMMON_MISSPELLS = ["teh", "recieve", "seperate", "occured", "untill", "alot", "definately", "wich", "becuase", "thier", "youre", "wierd", "tommorow", "calender", "neccessary"];

function gradeProfessionalism(text: string): number {
  const lower = text.toLowerCase();
  let deductions = 0;
  for (const w of SLANG_TOKENS) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(lower)) { deductions += 1; break; }
  }
  // All-caps shouting: a run of 3+ ALL-CAPS words.
  if (/\b[A-Z]{2,}\b\s+\b[A-Z]{2,}\b\s+\b[A-Z]{2,}\b/.test(text)) deductions += 1;
  // Excessive punctuation
  if (/[!?]{2,}/.test(text)) deductions += 1;
  return clampScore(5 - deductions);
}

function gradeSpelling(text: string): number {
  const lower = text.toLowerCase();
  let deductions = 0;
  for (const w of COMMON_MISSPELLS) {
    const re = new RegExp(`\\b${w}\\b`, "i");
    if (re.test(lower)) deductions += 1;
  }
  // Repeated letters typo (e.g. "helllo")
  if (/([a-zA-Z])\1{2,}/.test(text)) deductions += 1;
  return clampScore(5 - deductions);
}

function gradeGrammar(text: string): number {
  let deductions = 0;
  const trimmed = text.trim();
  if (!trimmed) return 1;
  // Should start with a capital letter (or quote/digit).
  if (!/^["'(0-9A-Z]/.test(trimmed)) deductions += 1;
  // Should end with terminal punctuation.
  if (!/[.!?]['")\]]?$/.test(trimmed)) deductions += 1;
  // Stray double spaces or space-before-punct.
  if (/ {2,}/.test(trimmed)) deductions += 1;
  if (/\s[,.;:!?]/.test(trimmed)) deductions += 1;
  return clampScore(5 - deductions);
}

function gradeResponseTime(messageTs: number, prevUserTs: number | null): number {
  if (prevUserTs == null) return 5;
  const deltaSec = Math.max(0, (messageTs - prevUserTs) / 1000);
  if (deltaSec < 60)        return 5;  // < 1 min
  if (deltaSec < 5 * 60)    return 4;  // < 5 min
  if (deltaSec < 15 * 60)   return 3;  // < 15 min
  if (deltaSec < 60 * 60)   return 2;  // < 1 hour
  return 1;                            // ≥ 1 hour
}

/** Grade an outgoing agent message. `prevUserTs` is the customer's last msg ts (or null). */
export function gradeAgentMessage(text: string, messageTs: number, prevUserTs: number | null): MessageRating {
  const professionalism = gradeProfessionalism(text);
  const spelling = gradeSpelling(text);
  const grammar = gradeGrammar(text);
  const responseTime = gradeResponseTime(messageTs, prevUserTs);
  const overall = clampScore((professionalism + spelling + grammar + responseTime) / 4);
  return { professionalism, spelling, grammar, responseTime, overall };
}

function sanitizeRating(r: any): MessageRating | undefined {
  if (!r || typeof r !== "object") return undefined;
  const pick = (k: string) => Number.isFinite(Number(r[k])) ? clampScore(Number(r[k])) : 0;
  const professionalism = pick("professionalism");
  const spelling = pick("spelling");
  const grammar = pick("grammar");
  const responseTime = pick("responseTime");
  if (!professionalism || !spelling || !grammar || !responseTime) return undefined;
  const overall = Number.isFinite(Number(r.overall))
    ? clampScore(Number(r.overall))
    : clampScore((professionalism + spelling + grammar + responseTime) / 4);
  return { professionalism, spelling, grammar, responseTime, overall };
}

function sanitizeMessage(m: any): SupportMessage {
  const from = m?.from === "agent" ? "agent" : m?.from === "bot" ? "bot" : "user";
  return {
    id: String(m?.id ?? `m-${Math.random().toString(36).slice(2)}`),
    from,
    text: String(m?.text ?? ""),
    ts: Number(m?.ts) || Date.now(),
    agentName: m?.agentName ? String(m.agentName) : undefined,
    rating: from === "agent" ? sanitizeRating(m?.rating) : undefined,
  };
}

/**
 * Average the rating across every agent message in `messages` that has one.
 * Returns null if no rated messages exist (e.g. ticket has no agent reply yet).
 */
export function conversationRating(messages: SupportMessage[]): (MessageRating & { count: number }) | null {
  const rated = messages.filter(m => m.from === "agent" && m.rating);
  if (rated.length === 0) return null;
  const sum = rated.reduce((acc, m) => {
    const r = m.rating!;
    return {
      professionalism: acc.professionalism + r.professionalism,
      spelling:        acc.spelling + r.spelling,
      grammar:         acc.grammar + r.grammar,
      responseTime:    acc.responseTime + r.responseTime,
      overall:         acc.overall + r.overall,
    };
  }, { professionalism: 0, spelling: 0, grammar: 0, responseTime: 0, overall: 0 });
  const n = rated.length;
  return {
    professionalism: Math.round((sum.professionalism / n) * 10) / 10,
    spelling:        Math.round((sum.spelling / n) * 10) / 10,
    grammar:         Math.round((sum.grammar / n) * 10) / 10,
    responseTime:    Math.round((sum.responseTime / n) * 10) / 10,
    overall:         Math.round((sum.overall / n) * 10) / 10,
    count: n,
  };
}

/**
 * Aggregate every rated message a particular staff member has sent across the
 * full ticket pool. Used by the admin Team Accounts view as a perf scorecard.
 * Match is by `agentName` (case-insensitive trim).
 */
export function staffRating(
  tickets: SupportTicket[],
  agentDisplayName: string,
  aliases: string[] = [],
): (MessageRating & { count: number; ticketCount: number }) | null {
  // Match by any of the staff member's known identity strings — primarily the
  // current display name ("First Last"), plus any historical aliases such as
  // the legacy email-prefix that older messages were attributed under. This
  // keeps Team Accounts aggregates correct across attribution-format changes.
  const targets = new Set<string>();
  const add = (s: string) => { const v = s.trim().toLowerCase(); if (v) targets.add(v); };
  add(agentDisplayName);
  for (const a of aliases) add(a);
  if (targets.size === 0) return null;

  const rated: SupportMessage[] = [];
  const ticketIds = new Set<string>();
  for (const t of tickets) {
    let touched = false;
    for (const m of t.messages) {
      if (m.from === "agent" && m.rating && targets.has((m.agentName || "").trim().toLowerCase())) {
        rated.push(m);
        touched = true;
      }
    }
    if (touched) ticketIds.add(t.id);
  }
  if (rated.length === 0) return null;
  const conv = conversationRating(rated);
  if (!conv) return null;
  return { ...conv, ticketCount: ticketIds.size };
}

export type SupportAccountType = "renter" | "padRenter";

export type SupportResolution = {
  issue: string;
  solution: string;
  customerSatisfied: "yes" | "no" | "unknown";
  customerFeedback: string;
  staffNotes: string;
  submittedBy: string;
  submittedByRole: "staff" | "admin";
  submittedAt: number;
  // Set when an admin approves the resolution. The admin who acts must be
  // distinct from the submitter — captured for the audit trail shown in the
  // ticket detail (e.g. "Worked by Sam · Approved by Alex").
  approvedBy?: string;
  approvedByRole?: "admin";
  approvedAt?: number;
};

export type SupportTicket = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  accountType: SupportAccountType;
  subject: string;
  status: "open" | "pending_resolution" | "resolved";
  openedByAgent: boolean;
  createdAt: number;
  updatedAt: number;
  messages: SupportMessage[];
  resolution?: SupportResolution;
};

function sanitizeTicket(t: any): SupportTicket {
  const status = t?.status === "resolved" ? "resolved"
    : t?.status === "pending_resolution" ? "pending_resolution"
    : "open";
  return {
    id: String(t?.id ?? `t-${Math.random().toString(36).slice(2)}`),
    userId: String(t?.userId ?? "anon"),
    userName: String(t?.userName ?? "Guest"),
    userEmail: String(t?.userEmail ?? ""),
    accountType: t?.accountType === "padRenter" ? "padRenter" : "renter",
    subject: String(t?.subject ?? "(no subject)"),
    status,
    openedByAgent: t?.openedByAgent === true,
    createdAt: Number(t?.createdAt) || Date.now(),
    updatedAt: Number(t?.updatedAt) || Date.now(),
    messages: Array.isArray(t?.messages) ? t.messages.map(sanitizeMessage) : [],
    resolution: t?.resolution && typeof t.resolution === "object" ? {
      issue: String(t.resolution.issue ?? ""),
      solution: String(t.resolution.solution ?? ""),
      customerSatisfied: t.resolution.customerSatisfied === "yes" ? "yes" : t.resolution.customerSatisfied === "no" ? "no" : "unknown",
      customerFeedback: String(t.resolution.customerFeedback ?? ""),
      staffNotes: String(t.resolution.staffNotes ?? ""),
      submittedBy: String(t.resolution.submittedBy ?? "Support rep"),
      submittedByRole: t.resolution.submittedByRole === "admin" ? "admin" : "staff",
      submittedAt: Number(t.resolution.submittedAt) || Date.now(),
      approvedBy: t.resolution.approvedBy ? String(t.resolution.approvedBy) : undefined,
      approvedByRole: t.resolution.approvedByRole === "admin" ? "admin" : undefined,
      approvedAt: t.resolution.approvedAt ? Number(t.resolution.approvedAt) || undefined : undefined,
    } : undefined,
  };
}

export function loadTickets(): SupportTicket[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUPPORT_TICKETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(sanitizeTicket);
  } catch { return []; }
}

// Lazy-init BroadcastChannel — works across tabs AND nested iframes of the
// same origin (e.g. Replit's workspace iframe → app iframe), which is more
// reliable than the browser's `storage` event in those embedded contexts.
let _bc: BroadcastChannel | null = null;
function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (_bc) return _bc;
  try { _bc = new BroadcastChannel("lilypad.support.tickets"); } catch { _bc = null; }
  return _bc;
}

export function subscribeTickets(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => { if (e.key === SUPPORT_TICKETS_KEY) handler(); };
  const onCustom  = () => handler();
  const onBC      = (_e: MessageEvent) => handler();
  window.addEventListener("storage", onStorage);
  window.addEventListener(SUPPORT_TICKETS_EVENT, onCustom);
  const bc = getBroadcastChannel();
  if (bc) bc.addEventListener("message", onBC);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SUPPORT_TICKETS_EVENT, onCustom);
    if (bc) bc.removeEventListener("message", onBC);
  };
}

export function saveTickets(t: SupportTicket[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(SUPPORT_TICKETS_KEY, JSON.stringify(t)); } catch {}
  // Same-tab notification: `storage` events do not fire in the tab that wrote.
  try { window.dispatchEvent(new CustomEvent(SUPPORT_TICKETS_EVENT)); } catch {}
  // Cross-tab + cross-iframe notification: BroadcastChannel reaches every
  // listener of the same origin, including embedded app iframes where the
  // `storage` event sometimes does not propagate.
  const bc = getBroadcastChannel();
  if (bc) { try { bc.postMessage({ type: "tickets-changed", at: Date.now() }); } catch {} }
}

/**
 * Per-ticket merge used to reconcile a locally-proposed change with whatever
 * is currently in storage (which may have been updated by another tab between
 * read and write). The newer side (by `updatedAt`) wins for scalar fields,
 * messages are unioned by id and re-sorted by timestamp, and `openedByAgent`
 * is sticky-true (once any tab marks a ticket opened, it stays opened).
 */
function mergeTicket(a: SupportTicket, b: SupportTicket): SupportTicket {
  const newer = a.updatedAt >= b.updatedAt ? a : b;
  const seen = new Map<string, SupportMessage>();
  for (const m of [...a.messages, ...b.messages]) seen.set(m.id, m);
  const messages = [...seen.values()].sort((x, y) => x.ts - y.ts);
  return {
    ...newer,
    openedByAgent: a.openedByAgent || b.openedByAgent,
    messages,
  };
}

/**
 * Cross-tab-safe mutation. Snapshots storage, runs the updater, then re-reads
 * storage just before writing and reconciles per ticket id:
 *  - tickets the updater removed are dropped (honoring local intent),
 *  - tickets present in both the proposed result and the latest storage are
 *    merged via `mergeTicket` so concurrent appends/status changes survive,
 *  - tickets only in latest storage are preserved,
 *  - new tickets from the updater are added.
 */
export function mutateTickets(updater: (current: SupportTicket[]) => SupportTicket[]): SupportTicket[] {
  const before = loadTickets();
  const proposed = updater(before).map(sanitizeTicket);
  const latest = loadTickets();

  const beforeMap = new Map(before.map(t => [t.id, t]));
  const latestMap = new Map(latest.map(t => [t.id, t]));
  const proposedMap = new Map(proposed.map(t => [t.id, t]));

  const ids = new Set<string>([...latestMap.keys(), ...proposedMap.keys()]);
  const result: SupportTicket[] = [];
  for (const id of ids) {
    const beforeT = beforeMap.get(id);
    const latestT = latestMap.get(id);
    const proposedT = proposedMap.get(id);

    if (proposedT == null) {
      // Updater removed (or never knew about) this id.
      if (beforeT != null && latestT != null) {
        // Updater explicitly dropped a ticket it had seen: honor the deletion
        // even if another tab updated it.
        continue;
      }
      if (latestT != null) {
        // Ticket was added by another tab after `before` snapshot — keep it.
        result.push(latestT);
      }
      continue;
    }

    if (latestT == null) {
      // Brand-new ticket from this updater, or another tab deleted it.
      // Treat as new and keep it.
      result.push(proposedT);
      continue;
    }

    // Both sides have a ticket with this id. Decide what to write:
    const localChanged = beforeT == null || beforeT !== proposedT;
    const remoteChanged = beforeT == null || JSON.stringify(beforeT) !== JSON.stringify(latestT);
    if (localChanged && remoteChanged) {
      result.push(mergeTicket(proposedT, latestT));
    } else if (localChanged) {
      result.push(proposedT);
    } else {
      result.push(latestT);
    }
  }

  result.sort((a, b) => b.updatedAt - a.updatedAt);
  saveTickets(result);
  return result;
}

export function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "anon";
  try {
    let id = window.localStorage.getItem(SUPPORT_USER_KEY);
    if (!id) {
      id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
      window.localStorage.setItem(SUPPORT_USER_KEY, id);
    }
    return id;
  } catch { return "anon"; }
}

export function makeId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
}

export function formatSupportTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return t;
  const diff = (now.getTime() - ts) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" }) + " · " + t;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + t;
}

export function ticketLastPreview(t: SupportTicket): string {
  const m = t.messages[t.messages.length - 1];
  if (!m) return "";
  const prefix = m.from === "user" ? "" : m.from === "agent" ? `${m.agentName || "Agent"}: ` : "Lily: ";
  return prefix + m.text;
}

export function emptyResolutionDraft(): Omit<SupportResolution, "submittedBy" | "submittedByRole" | "submittedAt"> {
  return { issue: "", solution: "", customerSatisfied: "unknown", customerFeedback: "", staffNotes: "" };
}

/**
 * Pipeline stage of a chat ticket — drives the admin Customer Service columns.
 *  - "new"      : customer opened the chat, no agent has replied yet.
 *  - "working"  : an agent has sent at least one reply, no resolution yet.
 *  - "pending"  : a staff member submitted a resolution and it's awaiting
 *                 admin approval (status === "pending_resolution").
 *  - "resolved" : admin has approved/marked the ticket resolved.
 */
export type TicketPipeline = "new" | "working" | "pending" | "resolved";

export function ticketPipeline(t: SupportTicket): TicketPipeline {
  if (t.status === "resolved") return "resolved";
  if (t.status === "pending_resolution") return "pending";
  const hasAgentReply = t.messages.some(m => m.from === "agent");
  return hasAgentReply ? "working" : "new";
}

export function pipelineLabel(p: TicketPipeline): string {
  return p === "new" ? "New" : p === "working" ? "Working on" : p === "pending" ? "Pending review" : "Resolved";
}
