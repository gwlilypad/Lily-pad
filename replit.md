# Lily Pad — Houston Parking Marketplace

## Project Overview
Full React + TypeScript + Vite source-code rebuild. The app is a proper React SPA compiled by Vite and served statically by the Express server.

**Architecture:**
- `src/` — full React/TypeScript source (compiled to `dist/` via Vite)
- `server.js` — Express API server (CommonJS). Serves `dist/` statically + SPA fallback. Handles all `/api/*` routes proxied to Supabase.
- `vite.config.ts` — Vite build config (React + Tailwind v4, `@` alias → `src/`)
- Workflow command: `npm run build && node server.js`

**Key source files:**
- `src/App.tsx` — BrowserRouter + all routes + goTo() wrapper
- `src/context/AuthContext.tsx` — Supabase auth state (useAuth hook)
- `src/context/AppContext.tsx` — app state + goTo(PageId) interface
- `src/components/AuthGuard.tsx` — protects authenticated routes
- `src/lib/supabase.ts` — Supabase client (uses VITE_SUPABASE_ANON_KEY)
- `src/pages/SignInPage.tsx` — sign-in form (Supabase signInWithPassword)
- `src/pages/ForgotPasswordPage.tsx` — password reset form
- `src/pages/HomePage.tsx` — landing page with car SVG + Find/List CTAs
- `src/pages/AccountPage.tsx` — host account (real profile from useAuth)
- `src/pages/DriverAccountPage.tsx` — driver account (real profile from useAuth)
- `src/pages/BookingsPage.tsx` — bookings (fetches from /api/bookings/:userId)
- `src/pages/FindPage.tsx` — map + spot finder (from source, ~3700 lines)
- `src/pages/AdminPage.tsx` — admin panel (from source, ~2950 lines)

**Navigation:** `goTo(PageId)` from `useApp()` — maps PageId → URL via `PAGE_ROUTES` in App.tsx, calls React Router's `navigate()`.

**Protected routes:** `/find`, `/bookings`, `/account`, `/driveraccount`, `/paddashboard`, `/admin` (admin/staff only) — guarded by `AuthGuard`.

**Supabase project:** `mcfxoimaqgpyntvasbsw`
**Secrets:** `VITE_SUPABASE_ANON_KEY` (Vite build + client), `SUPABASE_SERVICE_ROLE_KEY` (server-side API)

**Build stamp:** `LP-2026-05-18-REBUILD-v1`

## User Preferences

- **`**` symbol** — whenever the user types `**`, perform a full real-world verification before continuing or finishing: check server logs, fetch browser console logs, take a screenshot, and confirm the change is live in code + server + browser from all viewpoints. Do not consider a task done until this triple-check passes.
- Never stop working until changes are confirmed live — log evidence required.
- Do not use fake/placeholder data anywhere; always wire to real Supabase data.
- After every code change: run `npm run build`, restart the workflow, and screenshot to confirm.
