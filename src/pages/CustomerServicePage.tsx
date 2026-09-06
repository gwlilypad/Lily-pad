import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authenticatedHeaders } from "@/lib/apiAuth";

const NAVY  = "#0E1F40";
const GREEN = "#8DD63F";

export default function CustomerServicePage() {
  const navigate = useNavigate();

  const [name,       setName]       = useState("");
  const [email,      setEmail]      = useState("");
  const [phone,      setPhone]      = useState("");
  const [message,    setMessage]    = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent,       setSent]       = useState(false);
  const [error,      setError]      = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim())    { setError("Please enter your name.");       return; }
    if (!email.trim())   { setError("Please enter your email.");      return; }
    if (!message.trim()) { setError("Please describe your issue.");   return; }
    setSubmitting(true);
    try {
      const res  = await fetch("/api/contact", {
        method: "POST",
        headers: await authenticatedHeaders("application/json"),
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

  const labelStyle: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 700,
    color: "rgba(14,31,64,0.45)",
    letterSpacing: "0.06em", textTransform: "uppercase",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "12px 14px",
    borderRadius: 12,
    background: "#F4F6FA",
    border: "1.5px solid rgba(14,31,64,0.10)",
    color: NAVY, fontSize: 14,
    fontFamily: '"DM Sans", sans-serif',
    outline: "none", boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: NAVY, fontFamily: '"DM Sans", sans-serif', overflow: "hidden",
    }}>

      {/* ── NAVY HEADER + DESCRIPTION ── */}
      <div style={{ flexShrink: 0, padding: "calc(env(safe-area-inset-top) + 14px) 20px 24px" }}>

        {/* Back + title row */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              width: 38, height: 38, borderRadius: "50%",
              background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0, padding: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>
          <div>
            <div style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Customer Service</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.40)", marginTop: 1 }}>We're here to help</div>
          </div>
        </div>

        {/* Description — lives on navy */}
        <p style={{ margin: 0, fontSize: 13.5, color: "rgba(255,255,255,0.55)", lineHeight: 1.65 }}>
          Fill out the form below and we'll respond as soon as possible.
        </p>
      </div>

      {/* ── WHITE CARD — scrollable form ── */}
      <div style={{
        flex: 1, overflowY: "auto",
        background: "#F4F6FA",
        borderRadius: "26px 26px 0 0",
        WebkitOverflowScrolling: "touch" as any,
        paddingBottom: "calc(env(safe-area-inset-bottom) + 32px)",
      }}>
        {/* Handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 10, paddingBottom: 20 }}>
          <div style={{ width: 34, height: 4, borderRadius: 2, background: "rgba(14,31,64,0.12)" }}/>
        </div>

        {sent ? (
          /* ── Success state ── */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 20, paddingBottom: 20, textAlign: "center", padding: "20px 24px" }}>
            <div style={{ width: 68, height: 68, borderRadius: "50%", background: "rgba(141,214,63,0.14)", border: "1.5px solid rgba(141,214,63,0.30)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div>
              <p style={{ fontSize: 18, fontWeight: 800, color: NAVY, margin: "0 0 6px", letterSpacing: -0.3 }}>Message sent!</p>
              <p style={{ fontSize: 13, color: "rgba(14,31,64,0.50)", margin: 0, lineHeight: 1.6 }}>
                We'll get back to you at<br/>
                <span style={{ color: NAVY, fontWeight: 700 }}>{email}</span>
              </p>
            </div>
            <button
              onClick={() => navigate(-1)}
              style={{
                marginTop: 8, padding: "13px 36px", borderRadius: 100,
                border: "none", background: NAVY, color: "#fff",
                fontWeight: 800, fontSize: 14, cursor: "pointer",
                fontFamily: '"DM Sans", sans-serif', letterSpacing: -0.2,
              }}
            >
              Done
            </button>
          </div>
        ) : (
          /* ── Form ── */
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14, padding: "0 16px" }}>

            {/* Grouped input card */}
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(14,31,64,0.07)", overflow: "hidden" }}>

              {/* Name */}
              <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(14,31,64,0.06)" }}>
                <label style={labelStyle}>Name <span style={{ color: GREEN }}>*</span></label>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your name" autoComplete="name"
                  style={{ ...inputStyle, marginTop: 8, background: "#F4F6FA" }}
                />
              </div>

              {/* Email */}
              <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(14,31,64,0.06)" }}>
                <label style={labelStyle}>Email <span style={{ color: GREEN }}>*</span></label>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email"
                  style={{ ...inputStyle, marginTop: 8, background: "#F4F6FA" }}
                />
              </div>

              {/* Phone */}
              <div style={{ padding: "14px 16px" }}>
                <label style={labelStyle}>
                  Phone{" "}
                  <span style={{ color: "rgba(14,31,64,0.30)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                </label>
                <input
                  type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  placeholder="(713) 555-0000" autoComplete="tel"
                  style={{ ...inputStyle, marginTop: 8, background: "#F4F6FA" }}
                />
              </div>
            </div>

            {/* Message card */}
            <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(14,31,64,0.07)", padding: "14px 16px" }}>
              <label style={labelStyle}>How can we help? <span style={{ color: GREEN }}>*</span></label>
              <textarea
                value={message} onChange={e => setMessage(e.target.value)}
                placeholder="Describe your issue or question…"
                rows={5}
                style={{ ...inputStyle, marginTop: 8, background: "#F4F6FA", resize: "vertical", lineHeight: 1.55 }}
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 12, padding: "11px 14px", fontSize: 13, color: "#dc2626", fontWeight: 600 }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit" disabled={submitting}
              style={{
                padding: "15px", borderRadius: 100, border: "none",
                background: submitting ? "rgba(14,31,64,0.25)" : NAVY,
                color: "#fff", fontWeight: 800, fontSize: 15,
                cursor: submitting ? "default" : "pointer",
                fontFamily: '"DM Sans", sans-serif',
                letterSpacing: -0.2, marginBottom: 4,
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
