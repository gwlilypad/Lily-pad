import { Navigate } from "react-router-dom";

/**
 * Kept only for backwards-compatible imports. Payout details must never be
 * collected by Lily Pad; the real Stripe Connect onboarding owns this flow.
 */
export default function PaymentPage() {
  return <Navigate to="/payment" replace />;
}
