import { useState, useRef } from "react";

const STORAGE_KEY = "lp_onboarding_seen";

const SLIDES = [
  {
    title: "Welcome, neighbor",
    body: "Lily Pad connects homeowners with private driveways to drivers who deserve a better place to park. Instant bookings, smart pricing, verified drivers, and support when you need it.",
  },
  {
    title: "How it works",
    body: "Drivers can pre-book or instantly reserve a private driveway near their destination. Own a driveway? List it, set your preferences, and start earning passive income.",
  },
  {
    title: "Who it's for",
    body: "Lily Pad was built for areas where parking is hardest to find—downtown districts, campuses, airports, events, concerts, nightlife areas, and shopping centers. Bringing convenience back to parking, helping homeowners earn passive income, and making cities feel a little more connected.",
  },
  {
    title: "What happens next",
    body: "Complete your account to join the neighborhood. Have questions? Visit our FAQs or reach us at ",
    email: "support@lilypadparking.com",
  },
];

export default function OnboardingModal() {
  const [visible, setVisible] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEY); } catch { return true; }
  });
  const [slide, setSlide] = useState(0);
  const [animDir, setAnimDir] = useState<"left" | "right" | null>(null);
  const touchStartX = useRef<number | null>(null);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setVisible(false);
  };

  const goTo = (idx: number) => {
    if (idx === slide) return;
    setAnimDir(idx > slide ? "left" : "right");
    setSlide(idx);
    setTimeout(() => setAnimDir(null), 300);
  };

  const next = () => {
    if (slide < SLIDES.length - 1) goTo(slide + 1);
    else dismiss();
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -48 && slide < SLIDES.length - 1) goTo(slide + 1);
    if (dx >  48 && slide > 0) goTo(slide - 1);
    touchStartX.current = null;
  };

  const isLast = slide === SLIDES.length - 1;
  const current = SLIDES[slide];

  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.72)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "32px 22px",
      fontFamily: "'DM Sans', sans-serif",
    }}>
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          width: "100%",
          background: "#0E1F40",
          borderRadius: 26,
          padding: "44px 28px 28px",
          display: "flex", flexDirection: "column",
          boxShadow: "0 28px 72px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.30)",
          minHeight: 360,
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        <div
          key={slide}
          style={{
            flex: 1,
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            textAlign: "center", gap: 20,
            animation: animDir
              ? `slideIn${animDir === "left" ? "Left" : "Right"} 0.28s cubic-bezier(0.22,1,0.36,1) both`
              : undefined,
          }}
        >
          <h2 style={{
            fontSize: 24, fontWeight: 800, color: "#fff",
            margin: 0, letterSpacing: "-0.03em", lineHeight: 1.2,
          }}>
            {current.title}
          </h2>
          <p style={{
            fontSize: 14, color: "rgba(255,255,255,0.70)",
            margin: 0, lineHeight: 1.7, maxWidth: 290,
          }}>
            {current.body}
            {current.email && (
              <a
                href={`mailto:${current.email}`}
                style={{ color: "#8DD63F", textDecoration: "underline" }}
                onClick={e => e.stopPropagation()}
              >
                {current.email}
              </a>
            )}
            {current.email && "."}
          </p>
        </div>

        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between", marginTop: 36,
        }}>
          <button
            onClick={dismiss}
            style={{
              background: "transparent",
              border: "1.5px solid rgba(255,255,255,0.28)",
              color: "rgba(255,255,255,0.80)", borderRadius: 100,
              padding: "10px 22px", fontSize: 13, fontWeight: 700,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              letterSpacing: "-0.01em", minWidth: 70,
            }}
          >
            Skip
          </button>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {SLIDES.map((_, i) => (
              <div
                key={i}
                onClick={() => goTo(i)}
                style={{
                  width: i === slide ? 22 : 7, height: 7,
                  borderRadius: 100,
                  background: i === slide ? "#8DD63F" : "rgba(255,255,255,0.22)",
                  transition: "all 0.28s cubic-bezier(0.22,1,0.36,1)",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>

          <button
            onClick={next}
            style={{
              background: "#8DD63F", border: "none",
              color: "#0E1F40", borderRadius: 100,
              padding: "10px 22px", fontSize: 13, fontWeight: 800,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              letterSpacing: "-0.01em", minWidth: 70,
            }}
          >
            {isLast ? "Join" : "Next →"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(-32px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
