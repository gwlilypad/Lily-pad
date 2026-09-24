---
name: Address lookup reliability
description: Production-versus-preview behavior for host address validation and the low-volume backup strategy.
---

Production on Railway returned "address not found" even for well-known valid street addresses that the Replit preview resolved. The old API classified every non-success Google response as an invalid address, concealing provider/configuration errors.

**Why:** Google Maps keys and API restrictions are configured separately in Railway and Replit. A valid address should not be rejected as nonexistent merely because a provider is unavailable. A limited OpenStreetMap Nominatim backup helps low-volume onboarding, but its public usage limit is not a substitute for a production geocoding contract at scale.

**How to apply:** Check live and preview with the same known public address when changing host address validation. Distinguish lookup outages from zero results, preserve street-number validation, and avoid high-throughput requests to the public backup. If production remains on old behavior after a GitHub source update, check Railway deployment status rather than claiming the fix is live.