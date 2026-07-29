import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { AppContext, type PageId, type AppState, DEFAULT_STATE, STORAGE_KEY, TRANSIENT_KEYS, loadInitialState } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AuthGuard } from "@/components/AuthGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import HomePage from "@/pages/HomePage";
import PadTypePage from "@/pages/PadTypePage";
import BizSignupPage from "@/pages/BizSignupPage";
import SignupPage from "@/pages/SignupPage";
import AddPadPage from "@/pages/AddPadPage";
import PhotoIntroPage from "@/pages/PhotoIntroPage";
import PhotoPage from "@/pages/PhotoPage";
import AvailabilityPage from "@/pages/AvailabilityPage";
import StripeConnectPage from "@/pages/StripeConnectPage";
import AccountPage from "@/pages/AccountPage";
import FindPage from "@/pages/FindPage";
import ConfirmPage from "@/pages/ConfirmPage";
import DriverSignupPage from "@/pages/DriverSignupPage";
import DriverAccountPage from "@/pages/DriverAccountPage";
import PadDashboardPage from "@/pages/PadDashboardPage";
import ListerBookingsPage from "@/pages/ListerBookingsPage";
import BookingsPage from "@/pages/BookingsPage";
import AdminPage from "@/pages/AdminPage";
import CustomerServicePage from "@/pages/CustomerServicePage";
import SavedSpotsPage from "@/pages/SavedSpotsPage";
import ListingSuccessPage from "@/pages/ListingSuccessPage";
import SignInPage from "@/pages/SignInPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import EmailVerifyPage from "@/pages/EmailVerifyPage";
import PWAInstallBanner from "@/components/PWAInstallBanner";

const PAGE_ROUTES: Record<PageId, string> = {
  home: "/",
  padtype: "/padtype",
  bizsignup: "/bizsignup",
  signup: "/signup",
  addpad: "/addpad",
  photointro: "/photointro",
  photo: "/photo",
  availability: "/availability",
  payment: "/payment",
  account: "/account",
  find: "/find",
  spot: "/find",
  booking: "/bookings",
  confirm: "/confirm",
  driversignup: "/driversignup",
  driveraccount: "/driveraccount",
  paddashboard: "/paddashboard",
  listerbookings: "/listerbookings",
  bookings: "/bookings",
  admin: "/admin",
  savedspots: "/savedspots",
  customerservice: "/customerservice",
  listingsuccess: "/listingsuccess",
};

function AppInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, loading: authLoading, isBetaTester } = useAuth();
  const [fading, setFading] = useState(false);
  const [state, setState] = useState<AppState>(loadInitialState);

  // On first load, redirect away from mid-flow pages so the app always starts fresh
  const FLOW_PATHS = ["/bizsignup", "/addpad", "/padtype", "/photointro", "/photo", "/availability", "/payment", "/signup", "/driversignup", "/listingsuccess"];
  useEffect(() => {
    if (FLOW_PATHS.some(p => location.pathname.startsWith(p))) {
      navigate("/", { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync auth role → accountType whenever the user signs in or profile loads
  useEffect(() => {
    if (role === "host") setState(s => ({ ...s, accountType: "padRenter" }));
    else if (role === "driver") setState(s => ({ ...s, accountType: "renter" }));
  }, [role]);

  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (saveTimer.current != null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        const toSave: Partial<AppState> = { ...state };
        for (const k of TRANSIENT_KEYS) delete (toSave as Record<string, unknown>)[k];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      } catch { /* ignore */ }
    }, 250);
    return () => { if (saveTimer.current != null) window.clearTimeout(saveTimer.current); };
  }, [state]);

  const goTo = useCallback((page: PageId) => {
    const route = PAGE_ROUTES[page] ?? "/";
    setFading(true);
    setTimeout(() => {
      navigate(route);
      setFading(false);
    }, 180);
  }, [navigate]);

  // Beta testers cannot access admin — redirect to /find
  const isAdminPath = location.pathname.startsWith("/admin");
  if (isBetaTester && isAdminPath) {
    navigate("/find", { replace: true });
    return null;
  }

  // ── Admin simulation toolbar (shown on customer pages when adminPreview active) ──
  const CUSTOMER_PATHS = ["/find", "/bookings", "/account", "/driveraccount", "/paddashboard", "/savedspots", "/customerservice"];
  const isCustomerPage = CUSTOMER_PATHS.some(p => location.pathname.startsWith(p));
  const GREEN_SIM = "#8DD63F";
  const adminSimBar = state.adminPreview && isCustomerPage ? (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 19999,
      background: "rgba(10,20,45,0.97)",
      borderTop: "1px solid rgba(141,214,63,0.35)",
      boxShadow: "0 -4px 28px rgba(0,0,0,0.55)",
      padding: "8px 10px env(safe-area-inset-bottom, 8px)",
      display: "flex", alignItems: "center", gap: 6,
      fontFamily: '"DM Sans", sans-serif',
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    }}>
      {/* label pill */}
      <div style={{
        display: "flex", alignItems: "center", gap: 5,
        background: "rgba(141,214,63,0.12)", border: "1px solid rgba(141,214,63,0.30)",
        borderRadius: 100, padding: "4px 8px", flexShrink: 0,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: GREEN_SIM, flexShrink: 0 }} />
        <span style={{ fontSize: 9, fontWeight: 800, color: GREEN_SIM, letterSpacing: "0.14em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {state.adminPreviewRole === "staff" ? "Staff sim" : "Admin sim"}
        </span>
      </div>

      {/* customer area tabs */}
      {([
        { label: "Map",      page: "find"          as PageId, match: "/find"          },
        { label: "Bookings", page: "bookings"       as PageId, match: "/bookings"      },
        { label: "Driver",   page: "driveraccount"  as PageId, match: "/driveraccount" },
        { label: "Host",     page: "account"        as PageId, match: "/account"       },
      ] as { label: string; page: PageId; match: string }[]).map(item => {
        const active = location.pathname.startsWith(item.match);
        return (
          <button key={item.label} onClick={() => goTo(item.page)} style={{
            flex: 1, padding: "5px 2px",
            background: active ? "rgba(141,214,63,0.15)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${active ? "rgba(141,214,63,0.45)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 8,
            color: active ? GREEN_SIM : "rgba(255,255,255,0.50)",
            fontSize: 10, fontWeight: active ? 700 : 500,
            cursor: "pointer", fontFamily: '"DM Sans", sans-serif',
            letterSpacing: "0.01em", transition: "all 0.15s",
          }}>{item.label}</button>
        );
      })}

      {/* back to admin */}
      <button
        onClick={() => {
          sessionStorage.removeItem("lp_admin_preview");
          setState(s => ({ ...s, adminPreview: false, adminPreviewRole: null }));
          goTo("admin");
        }}
        style={{
          flexShrink: 0, padding: "5px 10px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 8, color: "rgba(255,255,255,0.80)",
          fontSize: 10, fontWeight: 700,
          cursor: "pointer", fontFamily: '"DM Sans", sans-serif',
          letterSpacing: "0.02em", whiteSpace: "nowrap",
        }}
      >↩ Admin</button>
    </div>
  ) : null;

  return (
    <AppContext.Provider value={{ goTo, state, setState }}>
      <div className={`screen${fading ? " fade-out" : ""}`}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/forgot" element={<ForgotPasswordPage />} />
          <Route path="/verify" element={<EmailVerifyPage />} />
          <Route path="/confirm" element={<ConfirmPage />} />
          <Route path="/driversignup" element={<DriverSignupPage />} />
          <Route path="/padtype" element={<PadTypePage />} />
          <Route path="/bizsignup" element={<BizSignupPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/addpad" element={<AddPadPage />} />
          <Route path="/photointro" element={<PhotoIntroPage />} />
          <Route path="/photo" element={<PhotoPage />} />
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route path="/payment" element={<StripeConnectPage />} />
          <Route path="/find" element={<AuthGuard><ErrorBoundary><FindPage /></ErrorBoundary></AuthGuard>} />
          <Route path="/bookings" element={<AuthGuard><BookingsPage /></AuthGuard>} />
          <Route path="/account" element={<AuthGuard><AccountPage /></AuthGuard>} />
          <Route path="/driveraccount" element={<AuthGuard><DriverAccountPage /></AuthGuard>} />
          <Route path="/paddashboard" element={<AuthGuard><PadDashboardPage /></AuthGuard>} />
          <Route path="/listerbookings" element={<AuthGuard><ListerBookingsPage /></AuthGuard>} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/savedspots" element={<AuthGuard><SavedSpotsPage /></AuthGuard>} />
          <Route path="/customerservice" element={<AuthGuard><CustomerServicePage /></AuthGuard>} />
          <Route path="/listingsuccess" element={<AuthGuard><ListingSuccessPage /></AuthGuard>} />
          {/* Stripe Connect return/refresh — land back on /payment with a query param */}
          <Route path="/connect-return" element={<Navigate to="/payment?stripe_connect=return" replace />} />
          <Route path="/connect-refresh" element={<Navigate to="/payment?stripe_connect=refresh" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {adminSimBar}

    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
        <PWAInstallBanner />
      </AuthProvider>
    </BrowserRouter>
  );
}
