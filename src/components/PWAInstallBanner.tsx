import { useState, useEffect } from "react";

const BANNER_KEY = "lp_pwa_banner";
const MAX_DISMISSALS = 2;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

interface BannerState {
  dismissals: number;
  lastDismissedAt: number | null;
  installed: boolean;
}

function load(): BannerState {
  try {
    return JSON.parse(localStorage.getItem(BANNER_KEY) || "null") ?? { dismissals: 0, lastDismissedAt: null, installed: false };
  } catch {
    return { dismissals: 0, lastDismissedAt: null, installed: false };
  }
}

function save(s: BannerState) {
  localStorage.setItem(BANNER_KEY, JSON.stringify(s));
}

export default function PWAInstallBanner() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const s = load();
    if (s.installed || s.dismissals >= MAX_DISMISSALS) return;
    if (s.lastDismissedAt !== null && Date.now() - s.lastDismissedAt < COOLDOWN_MS) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;

    if (standalone) return;

    setIsIOS(ios);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
      setShow(true);
    };

    const onInstalled = () => {
      save({ ...load(), installed: true });
      setShow(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if (ios) setShow(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") save({ ...load(), installed: true });
    }
    setShow(false);
  };

  const handleDismiss = () => {
    const s = load();
    save({ ...s, dismissals: s.dismissals + 1, lastDismissedAt: Date.now() });
    setShow(false);
  };

  if (!show) return null;

  return (
    <>
      <style>{`
        @keyframes lp-slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 99999,
        padding: "14px 16px env(safe-area-inset-bottom, 16px)",
        background: "#0E1F40",
        borderTop: "1px solid rgba(141,214,63,0.28)",
        boxShadow: "0 -6px 32px rgba(0,0,0,0.40)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: '"DM Sans", sans-serif',
        animation: "lp-slide-up 0.32s cubic-bezier(0.22,1,0.36,1)",
      }}>
        <img
          src="/icon-192.png"
          alt="Lily Pad"
          style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.30)" }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.4 }}>
            Add Lily Pad to your home screen for the best experience
          </div>
          {isIOS && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.52)", marginTop: 3, lineHeight: 1.4 }}>
              Tap <strong style={{ color: "rgba(255,255,255,0.70)" }}>Share</strong> then <strong style={{ color: "rgba(255,255,255,0.70)" }}>Add to Home Screen</strong>
            </div>
          )}
        </div>

        {!isIOS && (
          <button
            onClick={handleInstall}
            style={{
              background: "#8DD63F",
              color: "#0E1F40",
              border: "none",
              borderRadius: 100,
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: '"DM Sans", sans-serif',
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            Install
          </button>
        )}

        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "none",
            borderRadius: "50%",
            width: 30,
            height: 30,
            color: "rgba(255,255,255,0.55)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            padding: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </>
  );
}
