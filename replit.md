# Lily Pad — Houston Parking Marketplace

## Project Overview
React/Vite SPA (pre-built, READ-ONLY bundle: `assets/index-BVbrUITE.js`) served by a Node.js Express server (`server.js`). All runtime patching happens via `auth.js` (injected into every page via `auth-overlay.html`). Supabase is used for real auth + data persistence.

**Key files:**
- `auth.js` — all DOM/fiber patching, fake-data removal, admin panel, support chat, back buttons (~4100 lines)
- `auth.css` — styles for all injected UI (admin panel, support chat, back buttons)
- `server.js` — Express server, Supabase API routes, admin/support endpoints
- `auth-overlay.html` — sign-in + forgot-password overlay forms
- `assets/index-BVbrUITE.js` — READ-ONLY compiled bundle

**Supabase project:** `mcfxoimaqgpyntvasbsw`
**Secrets:** `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

**Current build stamp:** `LP-2026-05-16-AH` (bump on every deploy)

## User Preferences

- **`**` symbol** — whenever the user types `**`, perform a full real-world verification before continuing or finishing: check server logs, fetch browser console logs, take a screenshot, and confirm the change is live in code + server + browser from all viewpoints. Do not consider a task done until this triple-check passes.
- Always bump `LP_BUILD` stamp in `auth.js` on every change and restart the workflow.
- Never stop working until changes are confirmed live — log evidence required.
- Do not use fake/placeholder data anywhere; always wire to real Supabase data.
