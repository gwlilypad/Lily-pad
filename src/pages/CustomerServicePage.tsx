import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

export default function CustomerServicePage() {
  const { setState } = useApp();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function goBack() {
    setState(s => ({ ...s, openAcctOnFind: true }));
    navigate(-1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!email.trim()) { setError("Please enter your email."); return; }
    if (!message.trim()) { setError("Please describe your issue."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim(), message: message.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Failed to send. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.05)",
    border: "1.5px solid rgba(255,255,255,0.10)",
    color: "#fff",
    fontSize: 14,
    fontFamily: '"DM Sans", sans-serif',
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: NAVY, fontFamily: '"DM Sans", sans-serif', overflow: "hidden" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, padding: "52px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={goBack} style={{
            background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", color: "#fff", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Customer Service</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 2 }}>We're here to help</div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px 48px" }}>

        {sent ? (
          /* ── Success state ── */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 40, textAlign: "center" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(141,214,63,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#fff", margin: "0 0 6px", letterSpacing: -0.3 }}>Message sent!</p>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.50)", margin: 0, lineHeight: 1.6 }}>We'll get back to you at<br /><span style={{ color: "#fff", fontWeight: 600 }}>{email}</span></p>
            </div>
            <button
              onClick={goBack}
              style={{ marginTop: 8, padding: "12px 28px", borderRadius: 100, border: "none", background: GREEN, color: NAVY, fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}
            >
              Done
            </button>
          </div>
        ) : (
          /* ── Form ── */
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "0 0 4px", lineHeight: 1.6 }}>
              Fill out the form below and we'll respond as soon as possible.
            </p>

            {/* Name */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Name <span style={{ color: GREEN }}>*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                style={inputStyle}
              />
            </div>

            {/* Email */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Email <span style={{ color: GREEN }}>*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                style={inputStyle}
              />
            </div>

            {/* Phone (optional) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Phone <span style={{ color: "rgba(255,255,255,0.30)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(713) 555-0000"
                autoComplete="tel"
                style={inputStyle}
              />
            </div>

            {/* Message */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                How can we help? <span style={{ color: GREEN }}>*</span>
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Describe your issue or question…"
                rows={5}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.55 }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", borderRadius: 10, padding: "10px 13px", fontSize: 13, color: "#FCA5A5", fontWeight: 600 }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                padding: "14px",
                borderRadius: 100,
                border: "none",
                background: submitting ? "rgba(141,214,63,0.40)" : GREEN,
                color: NAVY,
                fontWeight: 800,
                fontSize: 15,
                cursor: submitting ? "default" : "pointer",
                fontFamily: '"DM Sans", sans-serif',
                marginTop: 4,
                letterSpacing: -0.2,
              }}
            >
              {submitting ? "Sending…" : "Send message"}
            </button>

          </form>
        )}
      </div>
    </div>
  );
}
