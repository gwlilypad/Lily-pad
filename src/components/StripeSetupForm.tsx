import React, { useState } from "react";
import { loadStripe, Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

const NAVY = "#0E1F40";
const GREEN = "#8DD63F";

let stripePromiseCache: Promise<Stripe | null> | null = null;
let stripePromiseKey: string | null = null;
function getStripePromise(publishableKey: string) {
  if (!stripePromiseCache || stripePromiseKey !== publishableKey) {
    stripePromiseCache = loadStripe(publishableKey);
    stripePromiseKey = publishableKey;
  }
  return stripePromiseCache;
}

function SetupForm({
  onSuccess,
  onError,
  onCancel,
}: {
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
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError("");

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message || "Please check your card details.");
      setSubmitting(false);
      return;
    }

    const { error: confirmError } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (confirmError) {
      const msg = confirmError.message || "Could not save card. Please try again.";
      setError(msg);
      onError(msg);
      setSubmitting(false);
      return;
    }

    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PaymentElement options={{ layout: "tabs" }} />
      {error && (
        <div style={{ fontSize: 12, color: "#fca5a5", background: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.20)", borderRadius: 10, padding: "10px 12px", lineHeight: 1.5 }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting}
        style={{
          width: "100%", padding: "14px", borderRadius: 100, border: "none",
          background: submitting ? "rgba(141,214,63,0.45)" : GREEN,
          color: NAVY, fontSize: 14, fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Saving…" : "Save Card"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{ background: "none", border: "none", fontSize: 13, color: "rgba(255,255,255,0.40)", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", padding: 0 }}
      >
        Cancel
      </button>
    </form>
  );
}

export default function StripeSetupForm({
  clientSecret,
  publishableKey,
  onSuccess,
  onError,
  onCancel,
}: {
  clientSecret: string;
  publishableKey: string;
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
      <SetupForm onSuccess={onSuccess} onError={onError} onCancel={onCancel} />
    </Elements>
  );
}
