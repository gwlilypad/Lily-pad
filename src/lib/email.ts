export const SUPPORT_EMAILS_KEY = "lilypad.support.emails.v1";
export const SUPPORT_EMAILS_EVENT = "lilypad:support:emails-changed";

export type EmailAccountType = "renter" | "padRenter" | "guest";

export type EmailCategory = "billing" | "account" | "support" | "feedback" | "other";

export type SupportEmail = {
  id: string;
  fromName: string;
  fromAddress: string;
  accountType: EmailAccountType;
  subject: string;
  preview: string;
  body: string;
  receivedAt: number;
  read: boolean;
  category: EmailCategory;
};

function makeEmailId() {
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitize(e: any): SupportEmail {
  const at = e?.accountType === "padRenter" ? "padRenter" : e?.accountType === "guest" ? "guest" : "renter";
  const cat = (["billing", "account", "support", "feedback", "other"] as const).includes(e?.category) ? e.category : "other";
  return {
    id: String(e?.id ?? makeEmailId()),
    fromName: String(e?.fromName ?? "Unknown"),
    fromAddress: String(e?.fromAddress ?? ""),
    accountType: at,
    subject: String(e?.subject ?? "(no subject)"),
    preview: String(e?.preview ?? ""),
    body: String(e?.body ?? ""),
    receivedAt: Number(e?.receivedAt) || Date.now(),
    read: e?.read === true,
    category: cat,
  };
}

export function loadEmails(): SupportEmail[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUPPORT_EMAILS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(sanitize);
  } catch { return []; }
}

let _bc: BroadcastChannel | null = null;
function getBC(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (_bc) return _bc;
  try { _bc = new BroadcastChannel("lilypad.support.emails"); } catch { _bc = null; }
  return _bc;
}

export function subscribeEmails(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => { if (e.key === SUPPORT_EMAILS_KEY) handler(); };
  const onCustom = () => handler();
  const onBC = (_e: MessageEvent) => handler();
  window.addEventListener("storage", onStorage);
  window.addEventListener(SUPPORT_EMAILS_EVENT, onCustom);
  const bc = getBC();
  if (bc) bc.addEventListener("message", onBC);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SUPPORT_EMAILS_EVENT, onCustom);
    if (bc) bc.removeEventListener("message", onBC);
  };
}

function saveEmails(list: SupportEmail[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(SUPPORT_EMAILS_KEY, JSON.stringify(list)); } catch {}
  try { window.dispatchEvent(new CustomEvent(SUPPORT_EMAILS_EVENT)); } catch {}
  const bc = getBC();
  if (bc) { try { bc.postMessage({ type: "emails-changed", at: Date.now() }); } catch {} }
}

export function markEmailRead(id: string, read = true) {
  const next = loadEmails().map(e => e.id === id ? { ...e, read } : e);
  saveEmails(next);
}

export function emailCategoryLabel(c: EmailCategory): string {
  return c === "billing" ? "Billing" : c === "account" ? "Account" : c === "support" ? "Support" : c === "feedback" ? "Feedback" : "Other";
}

export function emailAudienceLabel(a: EmailAccountType): string {
  return a === "padRenter" ? "Lister" : a === "renter" ? "Driver" : "Guest";
}

export function formatEmailTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return t;
  const diff = (now.getTime() - ts) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: "short" }) + " · " + t;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " + t;
}
