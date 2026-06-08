import { useState, useRef, useEffect } from "react";

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
  const [visible, setVisible] = useState(true);
  const [slide, setSlide] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const dragStartX = useRef<number | null>(null);
  const isDragging = useRef(false);
  const [dragDelta, setDragDelta] = useState(0);
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

  const dismiss = () => setVisible(false);

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
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - (touchStartY.current ?? 0));
    if (dy < 60) setDragDelta(dx);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.changedTouches[0].clientY - (touchStartY.current ?? 0));
    setDragDelta(0);
    if (Math.abs(dx) > 44 && dy < 60) {
      if (dx < 0 && slide < SLIDES.length - 1) goTo(slide + 1);
      if (dx > 0 && slide > 0) goTo(slide - 1);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    dragStartX.current = e.clientX;
    isDragging.current = true;
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || dragStartX.current === null) return;
    setDragDelta(e.clientX - dragStartX.current);
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (!isDragging.current || dragStartX.current === null) return;
    const dx = e.clientX - dragStartX.current;
    setDragDelta(0);
    isDragging.current = false;
    dragStartX.current = null;
    if (Math.abs(dx) > 44) {
      if (dx < 0 && slide < SLIDES.length - 1) goTo(slide + 1);
      if (dx > 0 && slide > 0) goTo(slide - 1);
    }
  };
  const onMouseLeave = () => {
    if (isDragging.current) {
      setDragDelta(0);
      isDragging.current = false;
      dragStartX.current = null;
    }
  };

  const isLast = slide === SLIDES.length - 1;
  const baseOffset = cardW ? (containerRef.current!.clientWidth - cardW) / 2 - slide * (cardW + GAP) : 0;
  const trackOffset = baseOffset + dragDelta;

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
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
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
            transition: dragDelta !== 0 ? "none" : "transform 0.38s cubic-bezier(0.22,1,0.36,1)",
            willChange: "transform",
            cursor: isDragging.current ? "grabbing" : "grab",
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
                  background: "linear-gradient(145deg, #1a3560 0%, #0E1F40 100%)",
                  borderRadius: 22,
                  padding: "26px 24px 22px",
                  border: "1px solid rgba(255,255,255,0.10)",
                  boxShadow: isCenter
                    ? "0 20px 56px rgba(0,0,0,0.48), 0 4px 16px rgba(0,0,0,0.28)"
                    : "0 4px 18px rgba(0,0,0,0.22)",
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
                    color: "#fff", margin: "0 0 18px",
                    letterSpacing: "-0.03em", lineHeight: 1.2,
                  }}>
                    {s.title}
                  </h2>
                  <div style={{
                    height: 1,
                    background: "rgba(141,214,63,0.45)",
                    margin: "0 auto 20px",
                    width: "48px",
                  }} />
                  <p style={{
                    fontSize: 13.5, color: "rgba(255,255,255,0.65)",
                    margin: 0, lineHeight: 1.72,
                  }}>
                    {s.body}
                    {s.email && (
                      <a
                        href={`mailto:${s.email}`}
                        style={{ color: "#8DD63F", fontWeight: 700, textDecoration: "underline" }}
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

      {/* ── Next / Skip ── */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        width: "100%", padding: "18px 28px 0",
        boxSizing: "border-box", gap: 12,
      }}>
        <button
          onClick={next}
          style={{
            width: "100%", background: "#fff", border: "none",
            color: "#0E1F40", borderRadius: 100,
            padding: "0 24px", height: 56, fontSize: 16, fontWeight: 800,
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            letterSpacing: "-0.02em",
          }}
        >
          {isLast ? "Finish" : "Next"}
        </button>

        <button
          onClick={dismiss}
          style={{
            background: "transparent", border: "none",
            color: "rgba(255,255,255,0.45)", borderRadius: 100,
            padding: "6px 16px", fontSize: 13, fontWeight: 500,
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
          }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
