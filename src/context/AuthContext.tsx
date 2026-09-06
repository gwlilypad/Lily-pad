import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { authenticatedHeaders } from "@/lib/apiAuth";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role: string;
  avatar_url?: string;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  role: string | null;
  isBetaTester: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role?: string,
    consents?: { terms: boolean; privacy: boolean; hostAgreement?: boolean },
  ) => Promise<{ error: string | null; confirmEmail?: boolean }>;
  verifyOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  forgotPassword: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx>({
  user: null, session: null, profile: null, loading: true, role: null, isBetaTester: false,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null }),
  verifyOtp: async () => ({ error: null }),
  signOut: async () => {},
  forgotPassword: async () => ({ error: null }),
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | null>(null);
  const [isBetaTester, setIsBetaTester] = useState(false);

  async function checkBetaTester(email: string) {
    try {
      const res = await fetch("/api/beta/check", {
        method: "POST",
        headers: await authenticatedHeaders("application/json"),
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const data = await res.json();
        setIsBetaTester(!!data.isBetaTester);
      }
    } catch {
      // non-critical — fail silently
    }
  }

  async function fetchProfile(userId: string) {
    try {
      const res = await fetch(`/api/profile/${userId}`, { headers: await authenticatedHeaders() });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          const nameParts = (data.full_name || "").split(" ");
          const userRole = data.account_type || data.role || "driver";
          const email = data.email || "";
          setProfile({
            id: data.id,
            email,
            full_name: data.full_name || "",
            first_name: nameParts[0] || "",
            last_name: nameParts.slice(1).join(" ") || "",
            phone: data.phone || "",
            role: userRole,
            avatar_url: data.avatar_url || "",
          });
          setRole(userRole);
          if (email) await checkBetaTester(email);
        }
      }
    } catch {
      // profile fetch failed — not critical
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const sessionEmail = session.user.email ?? "";
        fetchProfile(session.user.id)
          .then(async () => {
            // Fallback: if profile had no email, still check beta status via session email
            if (sessionEmail) await checkBetaTester(sessionEmail);
          })
          .finally(() => setLoading(false));
      } else {
        setProfile(null);
        setRole(null);
        setIsBetaTester(false);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        if (data.staff_redirect) return { error: "Please use the staff portal to sign in." };
        return { error: data.error || "Invalid email or password." };
      }
      // Write session directly into localStorage in Supabase's expected format
      // so getSession() picks it up reliably on next page load
      if (data.access_token) {
        try {
          localStorage.setItem(
            "sb-mcfxoimaqgpyntvasbsw-auth-token",
            JSON.stringify({
              access_token: data.access_token,
              refresh_token: data.refresh_token,
              token_type: data.token_type || "bearer",
              expires_in: data.expires_in,
              expires_at: data.expires_at,
              user: data.user,
            })
          );
        } catch { /* storage blocked — ignore */ }
        // Also try setSession for same-page state update (may fail in iframe contexts)
        try {
          await supabase.auth.setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
          });
        } catch { /* ignore — localStorage fallback above covers this */ }
      }
      return { error: null };
    } catch (e: any) {
      return { error: e.message || "Sign in failed. Please try again." };
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    userRole = "driver",
    consents?: { terms: boolean; privacy: boolean; hostAgreement?: boolean },
  ) => {
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          account_type: userRole,
          consents,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) return { error: data.error || "Signup failed. Please try again." };
      if (data.session?.access_token) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      }
      return { error: null };
    } catch (e: any) {
      return { error: e.message || "Signup failed. Please try again." };
    }
  };

  const verifyOtp = async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    return { error: error ? error.message : null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const forgotPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/verify`,
    });
    return { error: error ? error.message : null };
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, role, isBetaTester, signIn, signUp, verifyOtp, signOut, forgotPassword, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
