import { Link } from "react-router-dom";

type LegalKind = "terms" | "privacy" | "cancellation" | "host-agreement";

const CONTENT: Record<LegalKind, { title: string; updated: string; sections: Array<[string, string]> }> = {
  terms: {
    title: "Terms of Service", updated: "Effective: February 20, 2025",
    sections: [
      ["Using Lily Pad", "Lily Pad provides a marketplace for drivers to find parking and for hosts to offer parking spaces. You must provide accurate information, follow applicable laws and posted location rules, and use the service only for lawful parking activity."],
      ["Accounts and bookings", "You are responsible for your account credentials and activity. A booking is confirmed only after payment is authorized and the booking confirmation is shown. Hosts and drivers must communicate respectfully and may not discriminate."],
      ["Platform role", "Lily Pad facilitates bookings; parking spaces are offered by independent hosts. We may suspend access, remove listings, or cancel a booking when needed to protect users, comply with law, or enforce these terms."],
      ["Questions", "This plain-language baseline is provided by Lily Pad for product use and is not legal advice. Contact Lily Pad support with questions about your account or a booking."],
    ],
  },
  privacy: {
    title: "Privacy Policy", updated: "Effective: February 20, 2025",
    sections: [
      ["Information we collect", "We collect account details, listing and booking information, support messages, device and usage information, and payment-related information processed by our payment providers."],
      ["How we use information", "We use information to operate bookings and payouts, verify accounts, provide support, prevent fraud, improve the service, and meet legal obligations."],
      ["Sharing", "We share only information needed for a booking with the other party, and use service providers such as payment processors, hosting, and communications providers. We do not sell personal information."],
      ["Your choices", "You can request access, correction, or deletion of account information subject to legal and operational requirements. Contact Lily Pad support to make a request."],
    ],
  },
  cancellation: {
    title: "Cancellation Policy", updated: "Effective: February 20, 2025",
    sections: [
      ["Before your booking", "Review the location, time, price, and cancellation terms shown at checkout. Cancellation requests should be made as early as possible through your booking or by contacting support."],
      ["Refunds", "Eligibility and refund amounts depend on the booking timing, whether the space was available as described, and applicable payment-processor rules. We will communicate the outcome of a review when one is required."],
      ["Host cancellations", "Hosts must promptly report an unavailable space. Lily Pad may assist affected drivers with support or a refund review when a host cancels or the space is materially unavailable."],
      ["No-show and misuse", "Charges may remain due for no-shows, overstays, damage, fraud, or violations of parking rules. This policy does not replace any rights required by applicable law."],
    ],
  },
  "host-agreement": {
    title: "Host Agreement", updated: "Effective: February 20, 2025",
    sections: [
      ["Listing your space", "You represent that you own the space or are authorized to offer it, that the listing is accurate, and that parking there is lawful. Keep availability, prices, access details, and photos current."],
      ["Host responsibilities", "Provide safe, reasonably accessible parking as described, honor confirmed bookings, communicate promptly, and comply with property rules, insurance requirements, taxes, permits, and applicable laws."],
      ["Payouts and fees", "Payouts are facilitated through Stripe Connect. You authorize Lily Pad and its payment providers to process applicable platform fees and send eligible earnings according to the payout schedule and Stripe onboarding terms."],
      ["Enforcement", "Lily Pad may pause, reject, or remove a listing and withhold payouts where reasonably necessary to investigate safety, fraud, legal compliance, disputes, or violations of this agreement."],
    ],
  },
};

export function LegalPage({ kind }: { kind: LegalKind }) {
  const page = CONTENT[kind];
  return (
    <main className="page active" style={{ overflowY: "auto", display: "block", padding: "36px 20px 48px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", color: "#0E1F40", fontFamily: "'DM Sans', sans-serif" }}>
        <Link to="/" style={{ color: "#0E1F40", fontWeight: 700, fontSize: 14 }}>← Back to Lily Pad</Link>
        <h1 style={{ fontSize: 30, margin: "28px 0 6px", letterSpacing: "-0.03em" }}>{page.title}</h1>
        <p style={{ color: "rgba(14,31,64,0.55)", fontSize: 13, marginBottom: 28 }}>{page.updated}</p>
        <p style={{ lineHeight: 1.6, fontSize: 14 }}>These are Lily Pad’s practical baseline policies for using the app. They are not legal advice and may be updated as the service evolves.</p>
        {page.sections.map(([heading, text]) => <section key={heading} style={{ marginTop: 24 }}><h2 style={{ fontSize: 17, margin: "0 0 8px" }}>{heading}</h2><p style={{ lineHeight: 1.65, fontSize: 14, margin: 0 }}>{text}</p></section>)}
      </div>
    </main>
  );
}