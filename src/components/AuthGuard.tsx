import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

interface AuthGuardProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function AuthGuard({ children, requireAdmin }: AuthGuardProps) {
  const { user, loading, role } = useAuth();

  if (loading) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "#0E1F40",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          width: 36, height: 36, border: "3px solid rgba(141,214,63,0.3)",
          borderTopColor: "#8DD63F", borderRadius: "50%",
          animation: "lp-spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes lp-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) return <Navigate to="/signin" replace />;
  if (requireAdmin && role !== "admin" && role !== "staff") return <Navigate to="/find" replace />;

  return <>{children}</>;
}
