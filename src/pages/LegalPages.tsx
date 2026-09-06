import { Link } from "react-router-dom";

type LegalKind = "terms" | "privacy" | "cancellation" | "host-agreement";

const CONTENT: Record<LegalKind, { title: string }> = {
  terms: {
    title: "Terms of Service",
  },
  privacy: {
    title: "Privacy Policy",
  },
  cancellation: {
    title: "Cancellation Policy",
  },
  "host-agreement": {
    title: "Host Agreement",
  },
};

export function LegalPage({ kind }: { kind: LegalKind }) {
  const page = CONTENT[kind];
  return (
    <main className="page active" style={{ overflowY: "auto", display: "block", padding: "36px 20px 48px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", color: "#0E1F40", fontFamily: "'DM Sans', sans-serif" }}>
        <Link to="/" style={{ color: "#0E1F40", fontWeight: 700, fontSize: 14 }}>← Back to Lily Pad</Link>
        <h1 style={{ fontSize: 30, margin: "28px 0 6px", letterSpacing: "-0.03em" }}>{page.title}</h1>
      </div>
    </main>
  );
}