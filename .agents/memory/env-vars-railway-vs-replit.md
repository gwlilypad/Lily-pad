---
name: Env vars — Railway (prod) vs Replit (dev)
description: This project deploys to Railway for production; Replit is dev/preview only. Env vars must be set in both places independently.
---

Production for this app runs on Railway (lily-pad-production.up.railway.app, repo
github.com/gwlilypad/Lily-pad), not on Replit's own deployment. Replit is used
only for local dev/preview.

**Why:** The user explicitly said env vars belong in Railway for production,
since Replit secrets never reach the Railway runtime. There is no Railway
API/CLI access from the Replit workspace, so Railway env vars cannot be set
programmatically — the user must add them manually in the Railway dashboard.

**How to apply:** When a feature needs a new secret (e.g. Stripe keys), request
it via Replit's secret request flow for dev/testing here, AND explicitly remind
the user to add the equivalent (possibly differently-named) var in Railway's
dashboard before it will work in production. When naming server-side env vars,
prefer accepting multiple common naming conventions (e.g. check both
`STRIPE_PUBLISHABLE_KEY` and `VITE_STRIPE_PUBLISHABLE_KEY`) so the same code
works across both platforms without renaming.
