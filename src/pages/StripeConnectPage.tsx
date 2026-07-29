import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

type ConnectStatus = "loading" | "not_started" | "pending" | "active" | "error";

interface Payout {
  id: string;
  amount: number;
  status: string;
  arrival_date: number;
  description: string | null;
}

interface HostBooking {
  id: string;
  spot_id: string;
  spot_address: string;
  spot_name: string;
  driver_name: string;
  start_ts: string | null;
  total_price: number;
  platform_fee: number;
  payment_intent_id: string;
  refund_status: string | null;
  created_at: string;
}

interface Balance {
  available: number;
  pending: number;
}

function fmtDate(ts: string | null | number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtUsd(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Refund request modal
function RefundModal({
  booking,
  onClose,
  onSubmit,
}: {
  booking: HostBooking;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!reason.trim()) return;
    setSubmitting(true);
    await onSubmit(reason.trim());
    setDone(true);
    setSubmitting(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "flex-end", justifyContent: "center", fontFamily: '"DM Sans", sans-serif' }}>
      <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "24px 20px 40px", width: "100%", maxWidth: 480 }}>
        {done ? (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: `${GREEN}22`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, color: NAVY, margin: "0 0 6px" }}>Refund request sent</p>
            <p style={{ fontSize: 12.5, color: "rgba(14,31,64,0.5)", margin: "0 0 20px" }}>Our team will review and process within 3-5 business days.</p>
            <button onClick={onClose} style={{ background: NAVY, color: "#fff", border: "none", borderRadius: 100, padding: "12px 32px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: NAVY }}>Request Refund</p>
              <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(14,31,64,0.4)", padding: 4 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div style={{ background: "rgba(14,31,64,0.04)", borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: NAVY }}>{booking.spot_address || booking.spot_name}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "rgba(14,31,64,0.5)" }}>{fmtDate(booking.start_ts)} · {fmtUsd(booking.total_price)}</p>
            </div>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Describe the reason for the refund request…"
              style={{ width: "100%", minHeight: 90, padding: "10px 14px", borderRadius: 12, border: "1.5px solid rgba(14,31,64,0.15)", fontSize: 13, color: NAVY, fontFamily: '"DM Sans", sans-serif', resize: "vertical", boxSizing: "border-box", outline: "none" }}
            />
            <button
              onClick={submit}
              disabled={!reason.trim() || submitting}
              style={{ marginTop: 14, width: "100%", padding: "14px", borderRadius: 100, border: "none", background: reason.trim() && !submitting ? NAVY : "rgba(14,31,64,0.25)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: reason.trim() && !submitting ? "pointer" : "not-allowed", fontFamily: '"DM Sans", sans-serif' }}
            >
              {submitting ? "Sending…" : "Submit Request"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function StripeConnectPage() {
  const { goTo } = useApp();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [connectStatus, setConnectStatus] = useState<ConnectStatus>("loading");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  // Dashboard data
  const [balance, setBalance] = useState<Balance | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [bookings, setBookings] = useState<HostBooking[]>([]);
  const [loadingDash, setLoadingDash] = useState(false);

  // Per-pad breakdown
  const [padView, setPadView] = useState<"bookings" | "payouts">("bookings");

  // Refund modal
  const [refundBooking, setRefundBooking] = useState<HostBooking | null>(null);

  // Handle connect return/refresh query params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("stripe_connect");
    if (p === "return" || p === "refresh") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Load connect status on mount
  useEffect(() => {
    if (!user?.id) { setConnectStatus("not_started"); return; }
    loadConnectStatus();
  }, [user?.id]);

  // Load dashboard data when active
  useEffect(() => {
    if (connectStatus === "active" && accountId && user?.id) {
      loadDashboard();
    }
  }, [connectStatus, accountId, user?.id]);

  async function loadConnectStatus() {
    if (!user?.id) return;
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/connect/status/${user.id}`, { headers });
      const data = await res.json();
      setAccountId(data.accountId || "");
      setConnectStatus(data.status || "not_started");
    } catch {
      setConnectStatus("not_started");
    }
  }

  async function loadDashboard() {
    if (!accountId || !user?.id) return;
    setLoadingDash(true);
    try {
      const headers = await getAuthHeader();
      const [balRes, payRes, bkRes] = await Promise.all([
        fetch(`/api/connect/balance/${accountId}`, { headers }),
        fetch(`/api/connect/payouts/${accountId}`, { headers }),
        fetch(`/api/connect/bookings/${user.id}`, { headers }),
      ]);
      const [bal, pay, bk] = await Promise.all([balRes.json(), payRes.json(), bkRes.json()]);
      if (balRes.ok) setBalance(bal);
      if (payRes.ok) setPayouts(Array.isArray(pay) ? pay : []);
      if (bkRes.ok) setBookings(Array.isArray(bk) ? bk : []);
    } catch { /* silent */ }
    finally { setLoadingDash(false); }
  }

  async function startConnect() {
    if (!user?.id) { setError("You must be signed in to connect a bank account."); return; }
    setStarting(true);
    setError("");
    try {
      const headers = await getAuthHeader();
      const res = await fetch("/api/connect/create-account", {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: user.id, email: user.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create account");
      setAccountId(data.accountId);
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setStarting(false);
    }
  }

  async function openStripeDashboard() {
    if (!accountId) return;
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`/api/connect/create-login-link/${accountId}`, { method: "POST", headers });
      const data = await res.json();
      if (res.ok && data.url) window.open(data.url, "_blank");
    } catch { /* silent */ }
  }

  async function submitRefundRequest(reason: string) {
    if (!refundBooking || !user?.id) return;
    const headers = await getAuthHeader();
    await fetch("/api/refunds/request", {
      method: "POST",
      headers,
      body: JSON.stringify({
        bookingId: refundBooking.id,
        requesterId: user.id,
        requesterType: "host",
        reason,
      }),
    });
    setBookings(prev => prev.map(b => b.id === refundBooking.id ? { ...b, refund_status: "requested" } : b));
    setRefundBooking(null);
  }

  // ── Computed stats ──
  const confirmedBookings = bookings.filter(b => !b.refund_status || b.refund_status === "none");
  const totalEarned = confirmedBookings.reduce((s, b) => s + (b.total_price - b.platform_fee), 0);
  const totalGross = confirmedBookings.reduce((s, b) => s + b.total_price, 0);
  const platformFees = confirmedBookings.reduce((s, b) => s + b.platform_fee, 0);

  // Per-pad breakdown
  const padBreakdown: Record<string, { address: string; name: string; count: number; earned: number }> = {};
  for (const b of confirmedBookings) {
    const key = b.spot_id;
    if (!padBreakdown[key]) padBreakdown[key] = { address: b.spot_address, name: b.spot_name, count: 0, earned: 0 };
    padBreakdown[key].count++;
    padBreakdown[key].earned += b.total_price - b.platform_fee;
  }

  // Year stats for tax summary
  const thisYear = new Date().getFullYear();
  const yearBookings = confirmedBookings.filter(b => b.start_ts && new Date(b.start_ts).getFullYear() === thisYear);
  const yearGross = yearBookings.reduce((s, b) => s + b.total_price, 0);
  const yearFees = yearBookings.reduce((s, b) => s + b.platform_fee, 0);
  const yearNet = yearGross - yearFees;

  // ── Render ──
  if (connectStatus === "loading") {
    return (
      <div className="page active">
        <SharedHeader step="Step 5 of 6" title="Set up payments." progress={83} label="Profile 83% complete" />
        <div className="s-divider" />
        <div className="s-body">
          <NavBar onBack={() => navigate(-1)} onHome={() => goTo("home")} dots={[0]} currentDot={0} onDotClick={() => {}} />
          <div className="form-center-wrap">
            <div className="q-center">
              <p style={{ fontSize: 14, color: "rgba(14,31,64,0.45)" }}>Loading…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── ACTIVE — full earnings dashboard ──
  if (connectStatus === "active") {
    return (
      <div className="page active" style={{ overflowY: "auto" }}>
        <SharedHeader step="" title="Earnings" progress={100} label="Bank connected" />
        <div className="s-divider" />
        <div className="s-body" style={{ padding: "0 0 40px" }}>
          <NavBar onBack={() => navigate(-1)} onHome={() => goTo("home")} dots={[0]} currentDot={0} onDotClick={() => {}} />

          <div style={{ padding: "0 20px", display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Status banner */}
            <div style={{ background: "rgba(141,214,63,0.10)", border: "1px solid rgba(141,214,63,0.30)", borderRadius: 14, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(141,214,63,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: NAVY }}>Bank account connected</p>
                <p style={{ margin: 0, fontSize: 11, color: "rgba(14,31,64,0.5)" }}>Payouts deposit automatically after each booking</p>
              </div>
              <button onClick={openStripeDashboard} style={{ background: "none", border: "1px solid rgba(14,31,64,0.20)", borderRadius: 100, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: NAVY, cursor: "pointer", fontFamily: '"DM Sans", sans-serif', flexShrink: 0 }}>
                Dashboard ↗
              </button>
            </div>

            {/* Balance cards */}
            {balance && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Available", value: balance.available, color: GREEN },
                  { label: "Pending", value: balance.pending, color: "rgba(14,31,64,0.5)" },
                ].map(c => (
                  <div key={c.label} style={{ background: "rgba(14,31,64,0.04)", borderRadius: 14, padding: "14px 16px", border: "1px solid rgba(14,31,64,0.08)" }}>
                    <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.5, textTransform: "uppercase" }}>{c.label}</p>
                    <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: c.color, letterSpacing: -0.5 }}>{fmtUsd(c.value)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Total earnings card */}
            <div style={{ background: NAVY, borderRadius: 16, padding: "18px 20px", color: "#fff" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.50)", letterSpacing: 0.5, textTransform: "uppercase" }}>Total Earned (all time)</p>
              <p style={{ margin: "0 0 12px", fontSize: 28, fontWeight: 800, color: GREEN, letterSpacing: -1 }}>{fmtUsd(totalEarned)}</p>
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: "rgba(255,255,255,0.50)" }}>
                <span>Gross: {fmtUsd(totalGross)}</span>
                <span>Platform fees: {fmtUsd(platformFees)}</span>
                <span>{confirmedBookings.length} bookings</span>
              </div>
            </div>

            {/* Per-pad breakdown */}
            {Object.keys(padBreakdown).length > 0 && (
              <div>
                <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.5, textTransform: "uppercase" }}>Earnings by Pad</p>
                {Object.values(padBreakdown).map((pad, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", padding: "11px 14px", borderRadius: 12, background: "rgba(14,31,64,0.04)", border: "1px solid rgba(14,31,64,0.07)", marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pad.name || pad.address}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "rgba(14,31,64,0.45)" }}>{pad.count} booking{pad.count !== 1 ? "s" : ""}</p>
                    </div>
                    <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: GREEN }}>{fmtUsd(pad.earned)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Booking history */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.5, textTransform: "uppercase" }}>Booking History</p>
                {loadingDash && <p style={{ margin: 0, fontSize: 11, color: "rgba(14,31,64,0.4)" }}>Loading…</p>}
              </div>
              {bookings.length === 0 && !loadingDash ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "rgba(14,31,64,0.35)", fontSize: 13 }}>No confirmed bookings yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {bookings.slice(0, 20).map(b => {
                    const net = b.total_price - b.platform_fee;
                    const canRefund = b.status !== "cancelled" && !b.refund_status;
                    return (
                      <div key={b.id} style={{ padding: "12px 14px", borderRadius: 12, background: "rgba(14,31,64,0.04)", border: "1px solid rgba(14,31,64,0.07)" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: NAVY, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.spot_address || b.spot_name}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(14,31,64,0.45)" }}>{fmtDate(b.start_ts)} · {b.driver_name}</p>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: NAVY }}>{fmtUsd(net)}</p>
                            <p style={{ margin: 0, fontSize: 10, color: "rgba(14,31,64,0.40)" }}>after {fmtUsd(b.platform_fee)} fee</p>
                          </div>
                        </div>
                        {b.refund_status && (
                          <div style={{ marginTop: 6, fontSize: 10.5, fontWeight: 700, color: b.refund_status === "requested" ? "#f59e0b" : b.refund_status === "approved" ? "#ef4444" : "rgba(14,31,64,0.4)", background: b.refund_status === "requested" ? "rgba(245,158,11,0.10)" : b.refund_status === "approved" ? "rgba(239,68,68,0.08)" : "rgba(14,31,64,0.05)", borderRadius: 6, padding: "3px 8px", display: "inline-block" }}>
                            Refund {b.refund_status}
                          </div>
                        )}
                        {canRefund && (
                          <button
                            onClick={() => setRefundBooking(b)}
                            style={{ marginTop: 8, background: "none", border: "1px solid rgba(14,31,64,0.18)", borderRadius: 100, padding: "5px 12px", fontSize: 11, fontWeight: 600, color: "rgba(14,31,64,0.55)", cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}
                          >
                            Request Refund
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Payout history */}
            {payouts.length > 0 && (
              <div>
                <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.5, textTransform: "uppercase" }}>Recent Payouts</p>
                {payouts.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderRadius: 12, background: "rgba(14,31,64,0.04)", border: "1px solid rgba(14,31,64,0.07)", marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: NAVY }}>
                        {p.status === "paid" ? "Deposited" : p.status === "in_transit" ? "In transit" : p.status}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "rgba(14,31,64,0.45)" }}>
                        {p.arrival_date ? fmtDate(new Date(p.arrival_date * 1000).toISOString()) : "—"}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: p.status === "paid" ? GREEN : NAVY }}>{fmtUsd(p.amount)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Tax summary */}
            <div style={{ background: "rgba(14,31,64,0.04)", borderRadius: 16, padding: "16px 18px", border: "1px solid rgba(14,31,64,0.08)" }}>
              <p style={{ margin: "0 0 12px", fontSize: 10, fontWeight: 700, color: "rgba(14,31,64,0.45)", letterSpacing: 0.5, textTransform: "uppercase" }}>Tax Summary {thisYear}</p>
              {[
                { label: "Gross income", value: fmtUsd(yearGross) },
                { label: "Platform fees withheld", value: fmtUsd(yearFees) },
                { label: "Net earnings", value: fmtUsd(yearNet), bold: true },
              ].map(row => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid rgba(14,31,64,0.06)" }}>
                  <span style={{ fontSize: 13, color: "rgba(14,31,64,0.65)", fontWeight: row.bold ? 700 : 400 }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: row.bold ? 800 : 600, color: NAVY }}>{row.value}</span>
                </div>
              ))}
              <p style={{ margin: "10px 0 0", fontSize: 10, color: "rgba(14,31,64,0.35)", lineHeight: 1.5 }}>
                For tax purposes only. Consult a tax professional. Lily Pad does not file 1099s automatically.
              </p>
            </div>

          </div>
        </div>

        {refundBooking && (
          <RefundModal
            booking={refundBooking}
            onClose={() => setRefundBooking(null)}
            onSubmit={submitRefundRequest}
          />
        )}
      </div>
    );
  }

  // ── NOT STARTED or PENDING or ERROR — onboarding flow ──
  return (
    <div className="page active">
      <SharedHeader step="Step 5 of 6" title="Set up payments." progress={83} label="Profile 83% complete" />
      <div className="s-divider" />
      <div className="s-body">
        <NavBar onBack={() => navigate(-1)} onHome={() => goTo("home")} dots={[0]} currentDot={0} onDotClick={() => {}} />

        <div className="form-center-wrap">
          {connectStatus === "not_started" && (
            <div className="q-center">
              <p className="q-step-lbl">Payment setup</p>
              <p className="q-text">Connect your bank securely through Stripe.</p>
              <p style={{ fontSize: 12, color: "rgba(14,31,64,0.45)", lineHeight: 1.6, margin: "8px 0 24px", textAlign: "center" }}>
                Stripe handles your banking details so lily pad never sees your account numbers. Setup takes about 2 minutes.
              </p>

              <button
                onClick={startConnect}
                disabled={starting}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  width: "100%", padding: "16px 0",
                  background: starting ? "rgba(99,91,255,0.55)" : "#635BFF",
                  color: "#fff",
                  fontSize: 15, fontWeight: 600,
                  border: "none", borderRadius: 100, cursor: starting ? "not-allowed" : "pointer",
                  fontFamily: '"DM Sans", sans-serif',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect width="24" height="24" rx="6" fill="white" fillOpacity="0.18" />
                  <path d="M11.5 7C9.01 7 7 9.01 7 11.5C7 13.99 9.01 16 11.5 16C13.99 16 16 13.99 16 11.5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M14 9L16.5 6.5M16.5 6.5H14M16.5 6.5V9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {starting ? "Opening Stripe…" : "Connect Bank Account"}
              </button>

              {error && (
                <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", marginTop: 12 }}>{error}</p>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 16 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.3)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span style={{ fontSize: 11, color: "rgba(14,31,64,0.3)" }}>256-bit encrypted · PCI DSS compliant</span>
              </div>

              <button
                onClick={() => goTo("find")}
                style={{ marginTop: 28, background: "none", border: "none", fontSize: 13, fontWeight: 400, color: "rgba(14,31,64,0.35)", cursor: "pointer", fontFamily: '"DM Sans", sans-serif', textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                Skip for now
              </button>
            </div>
          )}

          {connectStatus === "pending" && (
            <div className="q-center">
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(245,158,11,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              </div>
              <p style={{ fontSize: 17, fontWeight: 300, color: NAVY, marginBottom: 6 }}>Setup incomplete</p>
              <p style={{ fontSize: 12, color: "rgba(14,31,64,0.4)", lineHeight: 1.6, marginBottom: 24 }}>
                Your Stripe account was created but setup isn't complete. Click below to finish connecting your bank.
              </p>
              <button
                onClick={startConnect}
                disabled={starting}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", padding: "16px 0", background: "#635BFF", color: "#fff", fontSize: 15, fontWeight: 600, border: "none", borderRadius: 100, cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}
              >
                {starting ? "Opening Stripe…" : "Complete Setup"}
              </button>
              {error && <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", marginTop: 12 }}>{error}</p>}
              <button onClick={() => goTo("find")} style={{ marginTop: 20, background: "none", border: "none", fontSize: 13, color: "rgba(14,31,64,0.35)", cursor: "pointer", fontFamily: '"DM Sans", sans-serif', textDecoration: "underline", textUnderlineOffset: 3 }}>
                Continue without setup
              </button>
            </div>
          )}

          {connectStatus === "error" && (
            <div className="q-center">
              <p style={{ fontSize: 14, color: "#ef4444", marginBottom: 16, textAlign: "center" }}>{error || "Something went wrong."}</p>
              <button className="cta-btn" onClick={() => { setConnectStatus("not_started"); setError(""); }}>Try again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
