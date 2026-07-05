---
name: Stripe payment flow architecture (Lily Pad bookings)
description: How Stripe is wired into the booking flow — one-off PaymentIntent per booking, not the subscription/product-catalog pattern from the stripe skill.
---

For dynamic, one-off booking charges (price depends on spot + duration), use a
plain Stripe PaymentIntent flow rather than the stripe-replit-sync /
webhook / product-catalog pattern described in the general stripe skill — that
pattern is designed for subscriptions/fixed product catalogs backed by local
Postgres, which doesn't fit a marketplace where amounts are computed per-order
and the source of truth is Supabase.

**Why:** Keeps the integration simple and auditable: server always recomputes
the charge amount from real data (never trusts a client-supplied amount),
and booking confirmation is gated on verifying the PaymentIntent status
server-side before marking a booking 'confirmed'.

**How to apply:** Client fetches a publishable key from a server endpoint
(avoids requiring a `VITE_`-prefixed build-time var — works across platforms
that name secrets differently). A "create payment intent" endpoint
recalculates price server-side and returns a client secret. Stripe Elements
collects card details and confirms payment client-side. Only after
`paymentIntent.status === 'succeeded'` does the client call the booking-create
endpoint with the payment_intent_id; the server re-verifies that intent via
`stripe.paymentIntents.retrieve` before marking the booking confirmed instead
of pending.
