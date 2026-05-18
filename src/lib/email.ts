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

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const SEED: Omit<SupportEmail, "id">[] = [
  {
    fromName: "Marcus Reed", fromAddress: "marcus.reed@gmail.com", accountType: "renter",
    subject: "Charged twice for the same booking?",
    preview: "Hey team, I just got two charges on my card for the booking at 312 Brook Ave on Tuesday…",
    body: "Hey team,\n\nI just got two charges on my card for the booking at 312 Brook Ave on Tuesday morning ($14.50 each). The booking only happened once. Can you take a look and refund the duplicate?\n\nReceipt IDs: BK-9821, BK-9822.\n\nThanks,\nMarcus",
    receivedAt: Date.now() - 18 * MIN, read: false, category: "billing",
  },
  {
    fromName: "Priya Shah", fromAddress: "priya.shah@workmail.com", accountType: "padRenter",
    subject: "How do I add a second driveway to my listing?",
    preview: "Hi! I have another spot at the back of my house I want to list as well…",
    body: "Hi!\n\nI have another spot at the back of my house I want to list as well. Is there a way to add a second listing under the same account or do I need to create a new one?\n\n— Priya",
    receivedAt: Date.now() - 1.4 * HOUR, read: false, category: "account",
  },
  {
    fromName: "Devon Chen", fromAddress: "devon@startupmail.io", accountType: "renter",
    subject: "Loving the app — small UX suggestion",
    preview: "Just wanted to say I've used Lilypad three times this week and it's been great…",
    body: "Just wanted to say I've used Lilypad three times this week and it's been great. One small thing — when I'm zoomed out the price tags overlap. Would love to see a cluster view at low zoom.\n\nKeep it up,\nDevon",
    receivedAt: Date.now() - 3.2 * HOUR, read: true, category: "feedback",
  },
  {
    fromName: "Aaliyah Thompson", fromAddress: "aaliyah.t@gmail.com", accountType: "padRenter",
    subject: "Renter overstayed by 2 hours — what can I do?",
    preview: "A renter booked my driveway for 1 hour but stayed for 3. The app doesn't seem to bill them for the extra…",
    body: "A renter booked my driveway for 1 hour but stayed for 3. The app doesn't seem to bill them for the extra time automatically. Should I report this? Booking ID is BK-9701.\n\nThanks,\nAaliyah",
    receivedAt: Date.now() - 6 * HOUR, read: false, category: "support",
  },
  {
    fromName: "Jordan Liu", fromAddress: "jordanliu@protonmail.com", accountType: "guest",
    subject: "Question before I sign up",
    preview: "Hi, I'm thinking of trying Lilypad. Do I need to register a card before I browse spots?",
    body: "Hi,\n\nI'm thinking of trying Lilypad in the city this weekend. Do I need to register a card before I can browse available spots, or can I look around first?\n\nThanks,\nJordan",
    receivedAt: Date.now() - 1.1 * DAY, read: true, category: "account",
  },
  {
    fromName: "Sam Patel", fromAddress: "sampatel@workmail.com", accountType: "renter",
    subject: "Receipt request for booking on Apr 22",
    preview: "Could you send me a PDF receipt for the booking on April 22? My company needs it for reimbursement.",
    body: "Hi,\n\nCould you send me a PDF receipt for the booking on April 22 at 88 Maple Drive? My company needs it for reimbursement. Booking ID BK-9544.\n\nThanks,\nSam",
    receivedAt: Date.now() - 2.3 * DAY, read: true, category: "billing",
  },
  {
    fromName: "Elena Rivera", fromAddress: "elena.rivera@hostmail.com", accountType: "padRenter",
    subject: "Payout schedule — when do I get paid?",
    preview: "Just wanted to confirm the payout schedule. I see pending earnings of $46 but no transfer yet…",
    body: "Hi team,\n\nJust wanted to confirm the payout schedule. I see pending earnings of $46 but no transfer to my bank yet. Is it weekly?\n\n— Elena",
    receivedAt: Date.now() - 3 * DAY, read: false, category: "billing",
  },
  {
    fromName: "Tyler Brooks", fromAddress: "tylerbrooks@gmail.com", accountType: "renter",
    subject: "App froze during checkout",
    preview: "The app froze on the confirm screen and I had to close it. Did the booking go through?",
    body: "Hey,\n\nThe app froze on the confirm screen yesterday and I had to force-close it. Not sure if the booking went through. My account email is the same as this one.\n\n— Tyler",
    receivedAt: Date.now() - 4.5 * DAY, read: true, category: "support",
  },
];

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
    if (!raw) {
      const seeded = SEED.map(s => ({ ...s, id: makeEmailId() })).map(sanitize);
      try { window.localStorage.setItem(SUPPORT_EMAILS_KEY, JSON.stringify(seeded)); } catch {}
      return seeded;
    }
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
  return a === "padRenter" ? "Lister" : a === "renter" ? "Renter" : "Guest";
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
