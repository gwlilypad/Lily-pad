import { useState, useEffect, useRef } from "react";

const BANNER_KEY = "lp_pwa_banner";
const MAX_DISMISSALS = 3;
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

interface BannerState {
  dismissals: number;
  lastDismissedAt: number | null;
  installed: boolean;
}

function load(): BannerState {
  try {
    return (
      JSON.parse(localStorage.getItem(BANNER_KEY) || "null") ?? {
        dismissals: 0,
        lastDismissedAt: null,
        installed: false,
      }
    );
  } catch {
    return { dismissals: 0, lastDismissedAt: null, installed: false };
  }
}

function save(s: BannerState) {
  try { localStorage.setItem(BANNER_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export default function PWAInstallBanner() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [hasNativePrompt, setHasNativePrompt] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showIOSSteps, setShowIOSSteps] = useState(false);
  const deferredPrompt = useRef<any>(null);

  useEffect(() => {
    const s = load();
    if (s.installed) return;
    if (s.dismissals >= MAX_DISMISSALS && s.lastDismissedAt !== null && Date.now() - s.lastDismissedAt < COOLDOWN_MS) return;

    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) && !(ua.includes("Chrome") || ua.includes("CriOS"));
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;

    if (standalone) return;

    setIsIOS(ios);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e;
      setHasNativePrompt(true);
      setShow(true);
    };

    const onInstalled = () => {
      save({ ...load(), installed: true });
      deferredPrompt.current = null;
      setHasNativePrompt(false);
      setShow(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (ios) setShow(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSSteps(true);
      return;
    }

    const dp = deferredPrompt.current;
    if (!dp) return;

    try {
      setInstalling(true);
      await dp.prompt();
      const { outcome } = await dp.userChoice;
      if (outcome === "accepted") {
        save({ ...load(), installed: true });
        setShow(false);
      }
    } catch {
      // prompt failed — keep banner open so user can try again
    } finally {
      deferredPrompt.current = null;
      setHasNativePrompt(false);
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    const s = load();
    save({ ...s, dismissals: s.dismissals + 1, lastDismissedAt: Date.now() });
    setShow(false);
    setShowIOSSteps(false);
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
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 99999,
          background: "#0E1F40",
          borderTop: "1px solid rgba(141,214,63,0.28)",
          boxShadow: "0 -6px 32px rgba(0,0,0,0.40)",
          fontFamily: '"DM Sans", sans-serif',
          animation: "lp-slide-up 0.32s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {showIOSSteps ? (
          <div style={{ padding: "18px 20px env(safe-area-inset-bottom, 18px)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12 }}>
              Add to Home Screen
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { n: 1, text: "Tap the Share button", icon: "⎋", sub: "at the bottom of Safari" },
                { n: 2, text: 'Tap "Add to Home Screen"', icon: "＋", sub: "scroll down if you don't see it" },
                { n: 3, text: 'Tap "Add"', icon: "✓", sub: "in the top-right corner" },
              ].map(step => (
                <div key={step.n} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(141,214,63,0.15)", border: "1px solid rgba(141,214,63,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#8DD63F", fontWeight: 800, flexShrink: 0 }}>
                    {step.n}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>{step.text} <span style={{ color: "#8DD63F" }}>{step.icon}</span></div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", marginTop: 1 }}>{step.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={handleDismiss}
              style={{ marginTop: 16, width: "100%", padding: "11px 0", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 100, color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: '"DM Sans", sans-serif' }}
            >
              Got it
            </button>
          </div>
        ) : (
          <div style={{ padding: "14px 16px env(safe-area-inset-bottom, 14px)", display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src="/icon-192.png"
              alt="Lily Pad"
              style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.30)" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.4 }}>
                Add Lily Pad to your home screen
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
                Faster access, full-screen experience
              </div>
            </div>

            {(isIOS || hasNativePrompt) && (
              <button
                onClick={handleInstall}
                disabled={installing}
                style={{
                  background: installing ? "rgba(141,214,63,0.50)" : "#8DD63F",
                  color: "#0E1F40",
                  border: "none",
                  borderRadius: 100,
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: installing ? "default" : "pointer",
                  fontFamily: '"DM Sans", sans-serif',
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {installing ? "Adding…" : "Add"}
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
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
