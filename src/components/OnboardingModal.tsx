import { useState, useRef, useEffect } from "react";

const STORAGE_KEY = "lp_onboarding_seen_v2";

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

const GAP = 14;

export default function OnboardingModal() {
  const [visible, setVisible] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEY); } catch { return true; }
  });
  const [slide, setSlide] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        setCardW(Math.min(w - 52, 300));
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setVisible(false);
  };

  const goTo = (idx: number) => {
    if (animating || idx === slide) return;
    setAnimating(true);
    setSlide(idx);
    setTimeout(() => setAnimating(false), 380);
  };

  const next = () => {
    if (slide < SLIDES.length - 1) goTo(slide + 1);
    else dismiss();
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - (touchStartY.current ?? 0));
    if (Math.abs(dx) > 44 && dy < 60) {
      if (dx < 0 && slide < SLIDES.length - 1) goTo(slide + 1);
      if (dx > 0 && slide > 0) goTo(slide - 1);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const isLast = slide === SLIDES.length - 1;
  const trackOffset = cardW ? (containerRef.current!.clientWidth - cardW) / 2 - slide * (cardW + GAP) : 0;

  return (
    <div
      style={{
        position: "absolute", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.78)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-end",
        fontFamily: "'DM Sans', sans-serif",
        padding: "0 0 52px",
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* ── Card carousel ── */}
      <div
        ref={containerRef}
        style={{
          width: "100%", overflow: "hidden",
          flex: "0 0 auto",
        }}
      >
        <div
          style={{
            display: "flex", gap: GAP,
            transform: `translateX(${trackOffset}px)`,
            transition: "transform 0.38s cubic-bezier(0.22,1,0.36,1)",
            willChange: "transform",
          }}
        >
          {SLIDES.map((s, i) => {
            const dist = Math.abs(i - slide);
            const isCenter = i === slide;
            return (
              <div
                key={i}
                onClick={() => { if (!isCenter) goTo(i); }}
                style={{
                  width: cardW || 280,
                  flexShrink: 0,
                  background: "#fff",
                  borderRadius: 22,
                  padding: "26px 24px 22px",
                  boxShadow: isCenter
                    ? "0 20px 56px rgba(0,0,0,0.32), 0 4px 16px rgba(0,0,0,0.14)"
                    : "0 4px 18px rgba(0,0,0,0.10)",
                  transform: `scale(${isCenter ? 1 : 0.87})`,
                  opacity: dist === 0 ? 1 : dist === 1 ? 0.72 : 0,
                  transition: "transform 0.38s cubic-bezier(0.22,1,0.36,1), opacity 0.38s cubic-bezier(0.22,1,0.36,1), box-shadow 0.38s",
                  display: "flex", flexDirection: "column",
                  justifyContent: "center",
                  cursor: isCenter ? "default" : "pointer",
                  userSelect: "none",
                }}
              >
                <div style={{ textAlign: "center" }}>
                  <h2 style={{
                    fontSize: 22, fontWeight: 800,
                    color: "#0E1F40", margin: "0 0 18px",
                    letterSpacing: "-0.03em", lineHeight: 1.2,
                  }}>
                    {s.title}
                  </h2>
                  <div style={{
                    height: 1,
                    background: "rgba(14,31,64,0.14)",
                    margin: "0 auto 20px",
                    width: "48px",
                  }} />
                  <p style={{
                    fontSize: 13.5, color: "rgba(14,31,64,0.62)",
                    margin: 0, lineHeight: 1.72,
                  }}>
                    {s.body}
                    {s.email && (
                      <a
                        href={`mailto:${s.email}`}
                        style={{ color: "#0E1F40", fontWeight: 700, textDecoration: "underline" }}
                        onClick={e => e.stopPropagation()}
                      >
                        {s.email}
                      </a>
                    )}
                    {s.email && "."}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Dots ── */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 20 }}>
        {SLIDES.map((_, i) => (
          <div
            key={i}
            onClick={() => goTo(i)}
            style={{
              width: i === slide ? 18 : 6, height: 6,
              borderRadius: 100,
              background: i === slide ? "#8DD63F" : "rgba(255,255,255,0.28)",
              transition: "all 0.3s cubic-bezier(0.22,1,0.36,1)",
              cursor: "pointer",
            }}
          />
        ))}
      </div>

      {/* ── Skip / Next ── */}
      <div style={{
        display: "flex", alignItems: "center",
        justifyContent: "space-between",
        width: "100%", padding: "16px 28px 0",
        boxSizing: "border-box",
      }}>
        <button
          onClick={dismiss}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.22)",
            color: "rgba(255,255,255,0.6)", borderRadius: 100,
            padding: "9px 20px", fontSize: 12.5, fontWeight: 600,
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            letterSpacing: "0.01em",
          }}
        >
          Skip
        </button>

        <button
          onClick={next}
          style={{
            background: "#8DD63F", border: "none",
            color: "#0E1F40", borderRadius: 100,
            padding: "9px 22px", fontSize: 12.5, fontWeight: 800,
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            letterSpacing: "0.01em",
          }}
        >
          {isLast ? "Join" : "Next →"}
        </button>
      </div>
    </div>
  );
}
