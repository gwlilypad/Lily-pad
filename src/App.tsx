import { useState, useEffect, useRef, useCallback } from "react";
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
import BookingsPage from "@/pages/BookingsPage";
import AdminPage from "@/pages/AdminPage";
import CustomerServicePage from "@/pages/CustomerServicePage";
import SavedSpotsPage from "@/pages/SavedSpotsPage";
import ListingSuccessPage from "@/pages/ListingSuccessPage";
import SignInPage from "@/pages/SignInPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import EmailVerifyPage from "@/pages/EmailVerifyPage";
import PWAInstallBanner from "@/components/PWAInstallBanner";
import EarlyAccessPage from "@/pages/EarlyAccessPage";

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
  bookings: "/bookings",
  admin: "/admin",
  savedspots: "/savedspots",
  customerservice: "/customerservice",
  listingsuccess: "/listingsuccess",
};

function AppInner() {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, loading: authLoading } = useAuth();
  const [fading, setFading] = useState(false);
  const [state, setState] = useState<AppState>(loadInitialState);
  // Read early access flag injected by server into window.__EARLY_ACCESS__
  // Falls back to /api/config fetch if the window global isn't present
  const [earlyAccess, setEarlyAccess] = useState<boolean>(
    () => !!(window as unknown as Record<string, unknown>).__EARLY_ACCESS__
  );
  const [configLoaded, setConfigLoaded] = useState(
    () => typeof (window as unknown as Record<string, unknown>).__EARLY_ACCESS__ !== 'undefined'
  );

  useEffect(() => {
    // If window.__EARLY_ACCESS__ was injected by server we already have the value;
    // only fall back to the API fetch when the global is missing (local dev, etc.)
    if (typeof (window as unknown as Record<string, unknown>).__EARLY_ACCESS__ !== 'undefined') return;
    fetch("/api/config")
      .then(r => r.json())
      .then(d => { setEarlyAccess(!!d.earlyAccess); })
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
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

  // ── Early access gate ─────────────────────────────────────────────────────
  // Admin/staff bypass: /admin and /signin paths are always accessible, and
  // users with admin or staff role see the full app even in early access mode.
  const isAdminPath    = location.pathname.startsWith("/admin");
  const isSignInPath   = location.pathname.startsWith("/signin") || location.pathname.startsWith("/forgot");
  const isAdminOrStaff = role === "admin" || role === "staff";
  if (configLoaded && earlyAccess && !isAdminPath && !isSignInPath && (authLoading || !isAdminOrStaff)) {
    return (
      <AppContext.Provider value={{ goTo, state, setState }}>
        <div className="screen">
          <EarlyAccessPage />
        </div>
      </AppContext.Provider>
    );
  }

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
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/savedspots" element={<AuthGuard><SavedSpotsPage /></AuthGuard>} />
          <Route path="/customerservice" element={<AuthGuard><CustomerServicePage /></AuthGuard>} />
          <Route path="/listingsuccess" element={<AuthGuard><ListingSuccessPage /></AuthGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
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
