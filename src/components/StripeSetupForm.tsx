import React, { useState } from "react";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  LinkAuthenticationElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

let stripePromiseCache: Promise<Stripe | null> | null = null;
let stripePromiseKey: string | null = null;
export function getStripePromise(publishableKey: string) {
  if (!stripePromiseCache || stripePromiseKey !== publishableKey) {
    stripePromiseCache = loadStripe(publishableKey);
    stripePromiseKey = publishableKey;
  }
  return stripePromiseCache;
}

function SetupForm({
  email,
  onSuccess,
  onError,
  onCancel,
}: {
  email?: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!stripe || !elements) {
      setError("Payment system still loading — please wait a moment and try again.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);

    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (confirmError) {
      const msg = confirmError.message || "Could not save payment method. Please try again.";
      setError(msg);
      onError(msg);
      setSubmitting(false);
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Link authentication — pre-fills email for Stripe Link sign-in */}
      <LinkAuthenticationElement
        options={email ? { defaultValues: { email } } : undefined}
      />

      {/* Payment Element — shows Link sign-in + card fallback */}
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />

      {error && (
        <div style={{
          fontSize: 12.5, color: "#fca5a5",
          background: "rgba(255,80,80,0.10)",
          border: "1px solid rgba(255,80,80,0.25)",
          borderRadius: 10, padding: "11px 14px", lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      {!stripe ? (
        <div style={{ textAlign: "center", padding: "10px 0", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
          Loading payment form…
        </div>
      ) : (
        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%", padding: "14px", borderRadius: 100, border: "none",
            background: submitting ? "rgba(141,214,63,0.45)" : GREEN,
            color: NAVY, fontSize: 14, fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
            cursor: submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Saving…" : "Save Payment Method"}
        </button>
      )}

      <button
        type="button"
        onClick={onCancel}
        style={{
          background: "none", border: "none", fontSize: 13,
          color: "rgba(255,255,255,0.40)", cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif", padding: 0,
        }}
      >
        Cancel
      </button>
    </form>
  );
}

export default function StripeSetupForm({
  clientSecret,
  publishableKey,
  email,
  onSuccess,
  onError,
  onCancel,
}: {
  clientSecret: string;
  publishableKey: string;
  email?: string;
  onSuccess: () => void;
  onError: (msg: string) => void;
  onCancel: () => void;
}) {
  const stripePromise = getStripePromise(publishableKey);
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: GREEN,
            colorBackground: "#152a52",
            colorText: "#ffffff",
            colorTextSecondary: "rgba(255,255,255,0.55)",
            colorDanger: "#ff6060",
            fontFamily: "'DM Sans', sans-serif",
            borderRadius: "12px",
          },
        },
      }}
    >
      <SetupForm
        email={email}
        onSuccess={onSuccess}
        onError={onError}
        onCancel={onCancel}
      />
    </Elements>
  );
}
