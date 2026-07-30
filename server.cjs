const express = require('express');
const path    = require('path');
const fs      = require('fs');
// stripe v10+ ships as a dual ESM/CJS package; in some Node CJS environments
// require('stripe') returns { default: StripeConstructor } instead of the class
// directly.  Always unwrap .default when present.
const _stripeImport = require('stripe');
const StripeClass   = (typeof _stripeImport === 'function') ? _stripeImport
                    : (_stripeImport.default || _stripeImport);

const app  = express();
const PORT = process.env.PORT || 5000;

const SUPABASE_URL  = 'https://mcfxoimaqgpyntvasbsw.supabase.co';
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY    || '';
const SVC_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY  || '';

// Accept either naming convention (Railway uses unprefixed; Replit dev may use
// VITE_-prefixed for the publishable key).
// Support common naming variations people use in Railway
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
                       || process.env.STRIPE_SECRET
                       || process.env.STRIPE_API_KEY
                       || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY
                             || process.env.STRIPE_PUBLIC_KEY
                             || process.env.VITE_STRIPE_PUBLISHABLE_KEY
                             || process.env.VITE_STRIPE_PUBLIC_KEY
                             || '';

// Initialise Stripe — wrap in try/catch so a bad key surfaces in logs instead
// of silently producing null and returning 503 to every payment endpoint.
let stripe = null;
if (!STRIPE_SECRET_KEY) {
  console.warn('[Stripe] STRIPE_SECRET_KEY is not set — payment endpoints will return 503.');
} else {
  try {
    stripe = new StripeClass(STRIPE_SECRET_KEY);
    console.log(`[Stripe] Initialised OK (key prefix: ${STRIPE_SECRET_KEY.slice(0, 8)}…)`);
  } catch (err) {
    console.error('[Stripe] Failed to initialise:', err.message);
  }
}

// ── Diagnostic endpoint — hit /api/stripe-check on Railway to confirm env vars ──
// Returns which variable names were found (never the values themselves).
// Delete this route once Stripe is confirmed working in production.

// Comma-separated list of emails allowed to register as staff/admin
// Set this in Replit Secrets as ADMIN_EMAILS=alice@co.com,bob@co.com
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);


const SVC_HEADERS = {
  'apikey'       : SVC_KEY,
  'Authorization': `Bearer ${SVC_KEY}`,
  'Content-Type' : 'application/json',
};

// ── In-memory activation code store (TTL 10 min) ─────────────────────────────
// Map<emailLower, { code: string, role: string, expires: number }>
const activationCodes = new Map();
function pruneActivationCodes() {
  const now = Date.now();
  for (const [k, v] of activationCodes) { if (v.expires < now) activationCodes.delete(k); }
}

// ── In-memory beta password-reset code store (TTL 15 min) ─────────────────────
// Map<emailLower, { code: string, expires: number }>
const betaResetCodes = new Map();

// ── Staff status store — persisted to /tmp/staff_status.json ─────────────────
// Map<"admin:<id>" | "staff:<id>", "active" | "suspended">
const STAFF_STATUS_FILE = '/tmp/staff_status.json';
const staffStatusMap = (() => {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(STAFF_STATUS_FILE,'utf8')))); } catch { return new Map(); }
})();
function saveStaffStatus() {
  try { fs.writeFileSync(STAFF_STATUS_FILE, JSON.stringify(Object.fromEntries(staffStatusMap))); } catch {}
}
function getStaffStatus(table, id) {
  return staffStatusMap.get(`${table}:${id}`) || 'active';
}
function setStaffStatus(table, id, status) {
  staffStatusMap.set(`${table}:${id}`, status);
  saveStaffStatus();
}

// ── Email helper (Resend) ────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Lily Pad <noreply@lilypadparking.com>', to, subject, html }),
    });
    if (!r.ok) console.warn('[Email] Resend error:', await r.text());
  } catch (e) { console.warn('[Email] Failed to send:', e.message); }
}

// ── SQL that must be run once in Supabase SQL Editor ─────────────────────────
const SETUP_SQL = `
-- ▶ Run this ONCE in Supabase → SQL Editor

CREATE TABLE IF NOT EXISTS public.profiles (
  id            UUID PRIMARY KEY,
  email         TEXT,
  full_name     TEXT,
  account_type  TEXT DEFAULT 'renter',
  avatar_url    TEXT,
  status        TEXT DEFAULT 'active',
  spend_total   NUMERIC DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status     TEXT    DEFAULT 'active';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS spend_total NUMERIC DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone      TEXT    DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role       TEXT    DEFAULT 'driver';

CREATE TABLE IF NOT EXISTS public.spots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  address       TEXT NOT NULL,
  pad_type      TEXT DEFAULT 'Driveway',
  surface       TEXT DEFAULT 'Concrete',
  num_pads      INTEGER DEFAULT 1,
  price_per_hr  NUMERIC NOT NULL DEFAULT 4,
  description   TEXT DEFAULT '',
  lat           DOUBLE PRECISION DEFAULT 29.7604,
  lng           DOUBLE PRECISION DEFAULT -95.3698,
  featured      BOOLEAN DEFAULT FALSE,
  status        TEXT DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.spots ADD COLUMN IF NOT EXISTS spot_name TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS spots_spot_name_unique
  ON public.spots (lower(spot_name))
  WHERE spot_name IS NOT NULL AND spot_name != '';

ALTER TABLE public.spots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spots' AND policyname='spots_public_read')
    THEN CREATE POLICY spots_public_read ON public.spots FOR SELECT USING (TRUE); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spots' AND policyname='spots_host_write')
    THEN CREATE POLICY spots_host_write ON public.spots FOR ALL USING (auth.uid() = host_user_id); END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.saved_spots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  spot_id     TEXT NOT NULL,
  spot_data   JSONB DEFAULT '{}',
  saved_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, spot_id)
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  spot_id       TEXT,
  booking_data  JSONB DEFAULT '{}',
  status        TEXT DEFAULT 'pending',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.booking_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  TEXT NOT NULL,
  sender_id   UUID NOT NULL,
  sender_role TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name        TEXT DEFAULT '',
  user_email       TEXT DEFAULT '',
  subject          TEXT DEFAULT 'Support Request',
  status           TEXT DEFAULT 'open',
  assigned_to      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_name    TEXT DEFAULT '',
  last_message     TEXT DEFAULT '',
  last_message_at  TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_name      TEXT NOT NULL DEFAULT 'User',
  sender_role      TEXT NOT NULL DEFAULT 'customer',
  message          TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_spots          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages     ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles'    AND policyname='profiles_self')
    THEN CREATE POLICY profiles_self    ON public.profiles    FOR ALL USING (auth.uid() = id);         END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='saved_spots' AND policyname='saved_spots_self')
    THEN CREATE POLICY saved_spots_self ON public.saved_spots FOR ALL USING (auth.uid() = user_id);    END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bookings'    AND policyname='bookings_self')
    THEN CREATE POLICY bookings_self    ON public.bookings    FOR ALL USING (auth.uid() = user_id);    END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_conversations' AND policyname='support_conv_self')
    THEN CREATE POLICY support_conv_self ON public.support_conversations FOR ALL USING (auth.uid() = user_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='support_messages' AND policyname='support_msg_self')
    THEN CREATE POLICY support_msg_self ON public.support_messages FOR ALL USING (auth.uid() = sender_id); END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'staff',
  auth_user_id  UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.admin_whitelist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.staff_whitelist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, account_type)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'account_type', 'renter')
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Early access signups (for EARLY_ACCESS launch mode)
CREATE TABLE IF NOT EXISTS public.early_access_signups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'driver',
  user_id      UUID,
  status       TEXT NOT NULL DEFAULT 'pending',
  notes        TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.early_access_signups ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='early_access_signups' AND policyname='ea_signups_svc_all')
    THEN CREATE POLICY ea_signups_svc_all ON public.early_access_signups FOR ALL USING (TRUE); END IF;
END $$;
`;

// ── Try running SQL via Supabase Management API ───────────────────────────────
const SUPABASE_REF = (SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1] || '';
async function runSQL(sql) {
  if (!SUPABASE_REF) return { ok: false, error: 'Cannot parse project ref' };
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_REF}/database/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SVC_KEY}` },
      body: JSON.stringify({ query: sql }),
    });
    const data = await r.json();
    return { ok: r.ok, data, error: r.ok ? null : JSON.stringify(data) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ── Ensure Supabase Storage bucket exists ─────────────────────────────────────
async function ensureStorageBucket() {
  if (!SVC_KEY) return;
  try {
    const check = await fetch(`${SUPABASE_URL}/storage/v1/bucket/spot-photos`, {
      headers: { 'Authorization': `Bearer ${SVC_KEY}`, 'apikey': SVC_KEY },
    });
    if (check.ok) { console.log('[Storage] spot-photos bucket ✓'); return; }
    const create = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SVC_KEY}`, 'apikey': SVC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'spot-photos', name: 'spot-photos', public: true }),
    });
    if (create.ok) console.log('[Storage] spot-photos bucket created ✓');
    else console.warn('[Storage] bucket create failed:', await create.text());
  } catch (e) { console.warn('[Storage] bucket check failed:', e.message); }
}

// ── Check DB schema on startup ────────────────────────────────────────────────
async function checkDB() {
  if (!SVC_KEY) { console.warn('[DB] SUPABASE_SERVICE_ROLE_KEY missing'); return; }
  try {
    // ── 1. profiles table check (required) ──
    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?limit=1`, { headers: SVC_HEADERS });
    if (!profRes.ok && profRes.status !== 406) {
      const body = await profRes.text();
      if (profRes.status === 404 || body.includes('does not exist') || body.includes('PGRST')) {
        console.log('\n[DB] ⚠️  Tables not found. Paste this into Supabase → SQL Editor:\n');
        console.log(SETUP_SQL);
        console.log('\n[DB] Then restart the server. (Visit /setup to see the SQL again.)\n');
      } else {
        console.warn('[DB] Unexpected response:', profRes.status, body.slice(0, 200));
      }
      return;
    }
    console.log('[DB] profiles table ✓');

    // ── 2. spots table check — auto-create if missing ──
    const spotsRes = await fetch(`${SUPABASE_URL}/rest/v1/spots?limit=1`, { headers: SVC_HEADERS });
    if (spotsRes.ok || spotsRes.status === 406) {
      console.log('[DB] spots table ✓');
      // Always run safe column additions (idempotent), then reload PostgREST schema cache
      await runSQL(`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT DEFAULT '';`).catch(()=>{});
      await runSQL(`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_connect_status TEXT DEFAULT 'not_started';`).catch(()=>{});
      // Add a dedicated column for the Stripe PaymentIntent ID on bookings with a UNIQUE constraint
      // to prevent replay attacks (same PI used to create multiple confirmed bookings).
      await runSQL(`ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT;`).catch(()=>{});
      await runSQL(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'public.bookings'::regclass
              AND conname = 'bookings_stripe_payment_intent_id_unique'
          ) THEN
            ALTER TABLE public.bookings
              ADD CONSTRAINT bookings_stripe_payment_intent_id_unique
              UNIQUE (stripe_payment_intent_id);
          END IF;
        END $$;
      `).catch(()=>{});
      const addPhotoUrl = await runSQL(`ALTER TABLE public.spots ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '';`);
      if (addPhotoUrl.ok) {
        // Notify PostgREST to reload its schema cache so the new column is accessible via REST
        await runSQL(`SELECT pg_notify('pgrst', 'reload schema');`);
        console.log('[DB] photo_url column ready, schema cache reloaded');
      }
      // ── early_access_signups table (always idempotent) ──
      const earlyRes = await runSQL(`
CREATE TABLE IF NOT EXISTS public.early_access_signups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'driver',
  user_id      UUID,
  status       TEXT NOT NULL DEFAULT 'pending',
  notes        TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);
`).catch(() => ({ ok: false }));
      if (earlyRes && earlyRes.ok) {
        await runSQL(`SELECT pg_notify('pgrst', 'reload schema');`).catch(() => {});
      }
      console.log('[DB] early_access_signups table ✓');

      // ── booking_messages table (idempotent) ──
      await runSQL(`
CREATE TABLE IF NOT EXISTS public.booking_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  TEXT NOT NULL,
  sender_id   UUID NOT NULL,
  sender_role TEXT NOT NULL,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
`).catch(() => {});
      await runSQL(`SELECT pg_notify('pgrst', 'reload schema');`).catch(() => {});
      console.log('[DB] booking_messages table ✓');
      return;
    }
    console.log('[DB] spots table missing — attempting auto-create…');
    const SPOTS_SQL = `
CREATE TABLE IF NOT EXISTS public.spots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  address       TEXT NOT NULL,
  pad_type      TEXT DEFAULT 'Driveway',
  surface       TEXT DEFAULT 'Concrete',
  num_pads      INTEGER DEFAULT 1,
  price_per_hr  NUMERIC NOT NULL DEFAULT 4,
  description   TEXT DEFAULT '',
  lat           DOUBLE PRECISION DEFAULT 29.7604,
  lng           DOUBLE PRECISION DEFAULT -95.3698,
  featured      BOOLEAN DEFAULT FALSE,
  status        TEXT DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.spots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spots' AND policyname='spots_public_read')
    THEN CREATE POLICY spots_public_read ON public.spots FOR SELECT USING (TRUE); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spots' AND policyname='spots_host_write')
    THEN CREATE POLICY spots_host_write ON public.spots FOR ALL USING (auth.uid() = host_user_id); END IF;
END $$;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role  TEXT DEFAULT 'driver';
`;
    const result = await runSQL(SPOTS_SQL);
    if (result.ok) {
      console.log('[DB] spots table created ✓');
    } else {
      console.warn('[DB] Auto-create failed. Run this in Supabase → SQL Editor (visit /spots-sql):\n');
      console.log(SPOTS_SQL);
    }
    // ── early_access_signups table (idempotent) ──
    await runSQL(`
CREATE TABLE IF NOT EXISTS public.early_access_signups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'driver',
  user_id     UUID,
  status      TEXT NOT NULL DEFAULT 'pending',
  notes       TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);
`).catch(() => {});
    console.log('[DB] early_access_signups table ✓');

  } catch (e) {
    console.warn('[DB] DB check failed:', e.message);
  }
}

app.use(express.json());

// ── SQL setup page ─────────────────────────────────────────────────────────────
app.get('/setup', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(SETUP_SQL);
});

app.get('/early-access-sql', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`-- ▶ Run this in Supabase → SQL Editor to enable Early Access signups
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS, etc.)

CREATE TABLE IF NOT EXISTS public.early_access_signups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'driver',
  user_id      UUID,
  status       TEXT NOT NULL DEFAULT 'pending',
  notes        TEXT DEFAULT '',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.early_access_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY ea_signups_svc_all
  ON public.early_access_signups
  FOR ALL
  USING (TRUE);
`);
});

app.get('/spots-sql', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`-- Run this in Supabase → SQL Editor to create the spots table:

CREATE TABLE IF NOT EXISTS public.spots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  address       TEXT NOT NULL,
  pad_type      TEXT DEFAULT 'Driveway',
  surface       TEXT DEFAULT 'Concrete',
  num_pads      INTEGER DEFAULT 1,
  price_per_hr  NUMERIC NOT NULL DEFAULT 4,
  description   TEXT DEFAULT '',
  lat           DOUBLE PRECISION DEFAULT 29.7604,
  lng           DOUBLE PRECISION DEFAULT -95.3698,
  featured      BOOLEAN DEFAULT FALSE,
  status        TEXT DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.spots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spots' AND policyname='spots_public_read')
    THEN CREATE POLICY spots_public_read ON public.spots FOR SELECT USING (TRUE); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='spots' AND policyname='spots_host_write')
    THEN CREATE POLICY spots_host_write ON public.spots FOR ALL USING (auth.uid() = host_user_id); END IF;
END $$;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role  TEXT DEFAULT 'driver';
`);
});


// ── Health check — shows masked key status ────────────────────────────────────
app.get('/api/health', (req, res) => {
  let svcRole = 'missing';
  let anonOk  = !!SUPABASE_ANON;
  try {
    const p = JSON.parse(Buffer.from(SVC_KEY.split('.')[1], 'base64url').toString());
    svcRole = p.role;
  } catch {}

  // Stripe diagnostics — which variable name was found and whether init succeeded.
  // Values are never returned; only which env var name held the key.
  const stripeSecretSource =
    process.env.STRIPE_SECRET_KEY     ? 'STRIPE_SECRET_KEY'     :
    process.env.STRIPE_SECRET         ? 'STRIPE_SECRET'         :
    process.env.STRIPE_API_KEY        ? 'STRIPE_API_KEY'        : null;
  const stripePubSource =
    process.env.STRIPE_PUBLISHABLE_KEY    ? 'STRIPE_PUBLISHABLE_KEY'    :
    process.env.STRIPE_PUBLIC_KEY         ? 'STRIPE_PUBLIC_KEY'         :
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ? 'VITE_STRIPE_PUBLISHABLE_KEY' :
    process.env.VITE_STRIPE_PUBLIC_KEY    ? 'VITE_STRIPE_PUBLIC_KEY'    : null;

  res.json({
    ok: true,
    anon_key_set: anonOk,
    anon_key_len: SUPABASE_ANON.length,
    svc_role: svcRole,
    supabase_url: SUPABASE_URL,
    stripe: {
      initialised: !!stripe,
      secret_key_source: stripeSecretSource || 'NOT FOUND — check Railway variable names',
      secret_key_prefix: STRIPE_SECRET_KEY ? STRIPE_SECRET_KEY.slice(0, 8) + '…' : null,
      publishable_key_source: stripePubSource || 'NOT FOUND',
      publishable_key_prefix: STRIPE_PUBLISHABLE_KEY ? STRIPE_PUBLISHABLE_KEY.slice(0, 8) + '…' : null,
    },
  });
});

// ── Auth: server-side sign-in (keeps keys off the client) ─────────────────────
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!SUPABASE_ANON) return res.status(500).json({ error: 'Server auth not configured (missing anon key)' });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: data.error_description || data.message || 'Invalid email or password' });
    }
    // Block admin/staff from using the customer sign-in portal
    if (SVC_KEY) {
      const emailLower = email.toLowerCase().trim();
      const adminCheck = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(emailLower)}&select=role`,
        { headers: SVC_HEADERS }
      ).then(r2 => r2.json()).catch(() => []);
      if (Array.isArray(adminCheck) && adminCheck.length > 0) {
        return res.status(403).json({ staff_redirect: true });
      }
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auth: forgot password ─────────────────────────────────────────────────────
app.post('/api/auth/forgot', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!SUPABASE_ANON) return res.status(500).json({ error: 'Server auth not configured' });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ email }),
    });
    if (!r.ok) {
      const d = await r.json();
      return res.status(r.status).json({ error: d.error_description || d.message || 'Request failed' });
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auth: password reset — step 1: send OTP via Resend (bypasses Supabase SMTP) ─
const resetCodes = new Map(); // email → { code, userId, expires }
function pruneResetCodes() {
  const now = Date.now();
  for (const [k, v] of resetCodes) { if (v.expires < now) resetCodes.delete(k); }
}

app.post('/api/auth/reset-send-code', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const emailLower = email.toLowerCase().trim();
  if (!SVC_KEY) return res.status(500).json({ error: 'Server not configured' });
  try {
    pruneResetCodes();
    // Generate code — user existence verified at verify step
    const code = String(Math.floor(100000 + Math.random() * 900000));
    resetCodes.set(emailLower, { code, expires: Date.now() + 10 * 60 * 1000 });

    const RESEND_KEY = process.env.RESEND_API_KEY || '';
    if (!RESEND_KEY) {
      console.warn('[Reset] RESEND_API_KEY not set — dev code:', code);
      return res.json({ ok: true });
    }
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Lily Pad <noreply@lilypadparking.com>',
        to: [emailLower],
        subject: 'Your Lily Pad password reset code',
        html: `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0E1F40;border-radius:20px;padding:40px 32px;color:#fff;">
  <p style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:#8DD63F;text-transform:uppercase;margin:0 0 8px;">Lily Pad Parking</p>
  <h1 style="font-size:26px;font-weight:800;margin:0 0 16px;letter-spacing:-0.02em;">Reset your password</h1>
  <p style="font-size:15px;color:rgba(255,255,255,0.78);line-height:1.6;margin:0 0 24px;">
    Enter this code in the app to reset your password. It expires in <strong style="color:#fff;">10 minutes</strong>.
  </p>
  <div style="text-align:center;background:rgba(141,214,63,0.12);border:1.5px solid rgba(141,214,63,0.40);border-radius:16px;padding:24px;margin-bottom:28px;">
    <span style="font-size:42px;font-weight:800;letter-spacing:0.25em;color:#8DD63F;">${code}</span>
  </div>
  <p style="font-size:12px;color:rgba(255,255,255,0.40);line-height:1.6;margin:0;text-align:center;">
    If you didn't request this, you can safely ignore it.
  </p>
</div>`,
      }),
    });
    if (!emailRes.ok) {
      const emailErr = await emailRes.json().catch(() => ({}));
      console.error('[Reset] Resend failed:', emailErr);
      return res.status(500).json({ error: 'Failed to send code. Please try again.' });
    }
    console.log(`[Reset] Code sent to ${emailLower}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auth: password reset — step 2: verify OTP, look up user, return reset token ─
const resetVerified = new Map(); // token → { userId, expires }
app.post('/api/auth/reset-verify-code', async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'email and code required' });
  const emailLower = email.toLowerCase().trim();
  pruneResetCodes();
  const stored = resetCodes.get(emailLower);
  if (!stored) return res.status(400).json({ error: 'No active code for this email. Request a new one.' });
  if (Date.now() > stored.expires) {
    resetCodes.delete(emailLower);
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }
  if (stored.code !== code.trim()) return res.status(400).json({ error: 'Incorrect code. Please try again.' });
  resetCodes.delete(emailLower);

  // Look up user by fetching all users and matching email client-side
  // (GoTrue list API does not filter by email — must search client-side)
  try {
    let userId = null;
    let page = 1;
    while (!userId) {
      const r = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=1000`,
        { headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}` } }
      );
      const data = await r.json().catch(() => ({}));
      const users = Array.isArray(data.users) ? data.users : [];
      const match = users.find(u => u.email?.toLowerCase() === emailLower);
      if (match) { userId = match.id; break; }
      if (users.length < 1000) break; // no more pages
      page++;
    }
    if (!userId) return res.status(404).json({ error: 'No account found with that email address.' });

    const token = require('crypto').randomBytes(32).toString('hex');
    resetVerified.set(token, { userId, expires: Date.now() + 15 * 60 * 1000 });
    console.log(`[Reset] Code verified for ${emailLower}`);
    res.json({ ok: true, reset_token: token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auth: password reset — step 3: set new password using reset token ─────────
app.post('/api/auth/reset-set-password', async (req, res) => {
  const { reset_token, password } = req.body || {};
  if (!reset_token || !password) return res.status(400).json({ error: 'reset_token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const entry = resetVerified.get(reset_token);
  if (!entry) return res.status(400).json({ error: 'Reset session expired. Please start over.' });
  if (Date.now() > entry.expires) {
    resetVerified.delete(reset_token);
    return res.status(400).json({ error: 'Reset session expired. Please start over.' });
  }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${entry.userId}`, {
      method: 'PUT',
      headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || 'Failed to set password.' });
    resetVerified.delete(reset_token);
    console.log(`[Reset] Password updated for user ${entry.userId}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auth: server-side token refresh ───────────────────────────────────────────
app.post('/api/auth/refresh', async (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token required' });
  if (!SUPABASE_ANON) return res.status(500).json({ error: 'Server auth not configured' });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ refresh_token }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error_description || data.message || 'Refresh failed' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auth: customer signup — uses admin API to pre-confirm email (no SMTP required) ──
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, full_name, account_type } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    // Create user via admin API with email pre-confirmed — bypasses Supabase SMTP entirely
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method : 'POST',
      headers: { 'apikey': SVC_KEY, 'Authorization': `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        email, password,
        email_confirm: true,
        user_metadata: { full_name: full_name || '', account_type: account_type || 'renter' },
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data.error_description || data.message || data.msg || JSON.stringify(data);
      return res.status(r.status).json({ error: msg });
    }

    // Upsert profile row
    if (data.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method : 'POST',
        headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body   : JSON.stringify({
          id: data.id, email, full_name: full_name || '',
          account_type: account_type || 'renter',
        }),
      }).catch(() => {});
    }

    // Auto sign-in so the client gets a session immediately — no OTP step needed
    const signInR = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ email, password }),
    });
    const signInData = await signInR.json();
    if (signInR.ok && signInData.access_token) {
      return res.json({ created: true, session: signInData });
    }

    return res.json({ created: true, session: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// ── Staff/admin activation — step 1: whitelist check only (OTP sent by client via Supabase JS) ──
app.post('/api/staff/check-whitelist', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const emailLower = email.toLowerCase().trim();
  try {
    // Check admin_whitelist first, then staff_whitelist — auto-detect role
    let detectedRole = null;
    for (const [table, r] of [['admin_whitelist', 'admin'], ['staff_whitelist', 'staff']]) {
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?email=eq.${encodeURIComponent(emailLower)}&select=email`,
        { headers: SVC_HEADERS }
      );
      const rows = await chk.json().catch(() => []);
      if (chk.ok && Array.isArray(rows) && rows.length) { detectedRole = r; break; }
    }
    if (!detectedRole)
      return res.status(403).json({ error: 'This email is not on the approved team list. Contact your admin.' });
    console.log(`[Activation] Whitelist check passed for ${emailLower} (${detectedRole})`);
    res.json({ ok: true, role: detectedRole });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin forgot password — checks all three tables before sending reset ─
app.post('/api/staff/forgot-password', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const emailLower = email.toLowerCase().trim();
  try {
    // 1. Check admin_users (activated accounts)
    const auRes = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(emailLower)}&select=email,status&limit=1`,
      { headers: SVC_HEADERS }
    );
    const auRows = await auRes.json();
    if (Array.isArray(auRows) && auRows.length > 0) {
      if (auRows[0].status === 'suspended') {
        return res.status(403).json({ error: 'This account is suspended. Contact an admin for access.' });
      }
      // Found and active — send reset
    } else {
      // 2. Check admin_whitelist
      const awRes = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_whitelist?email=eq.${encodeURIComponent(emailLower)}&select=email&limit=1`,
        { headers: SVC_HEADERS }
      );
      const awRows = await awRes.json();
      const inAdminWl = Array.isArray(awRows) && awRows.length > 0;

      // 3. Check staff_whitelist
      const swRes = await fetch(
        `${SUPABASE_URL}/rest/v1/staff_whitelist?email=eq.${encodeURIComponent(emailLower)}&select=email&limit=1`,
        { headers: SVC_HEADERS }
      );
      const swRows = await swRes.json();
      const inStaffWl = Array.isArray(swRows) && swRows.length > 0;

      if (!inAdminWl && !inStaffWl) {
        return res.status(404).json({ error: 'No staff or admin account matches that email.' });
      }
    }

    console.log(`[Staff ForgotPassword] Email verified for reset: ${emailLower}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin activation — step 2: record verified activation in admin_users ──
app.post('/api/staff/record-activation', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email, role, userId } = req.body || {};
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });
  const emailLower = email.toLowerCase().trim();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/admin_users`, {
      method: 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ email: emailLower, role, auth_user_id: userId || null, last_login_at: new Date().toISOString() }),
    });
    console.log(`[Activation] Recorded activation for ${emailLower} (${role})`);
    res.json({ recorded: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff whitelist-add — just inserts email, no email sending ───────────────
app.post('/api/staff/whitelist-add', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email, role } = req.body || {};
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });
  const emailLower = email.toLowerCase().trim();
  if (!emailLower.includes('@')) return res.status(400).json({ error: 'Invalid email address' });
  if (!['staff', 'admin'].includes(role)) return res.status(400).json({ error: 'role must be staff or admin' });
  try {
    const table = role === 'admin' ? 'admin_whitelist' : 'staff_whitelist';
    const wlRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
      body   : JSON.stringify({ email: emailLower }),
    });
    if (!wlRes.ok && wlRes.status !== 409) {
      const wlErr = await wlRes.json().catch(() => ({}));
      throw new Error(wlErr.message || `Failed to add to whitelist (${wlRes.status})`);
    }
    console.log(`[Whitelist] ${emailLower} added to ${table} as ${role}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff invite — whitelist email + send Resend invitation ──────────────────
app.post('/api/staff/invite', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  const { email, role } = req.body || {};
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });
  const emailLower = email.toLowerCase().trim();
  if (!emailLower.includes('@')) return res.status(400).json({ error: 'Invalid email address' });
  if (!['staff', 'admin'].includes(role)) return res.status(400).json({ error: 'role must be staff or admin' });
  try {
    // 1. Add to the correct whitelist table
    const table = role === 'admin' ? 'admin_whitelist' : 'staff_whitelist';
    const wlRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
      body   : JSON.stringify({ email: emailLower }),
    });
    if (!wlRes.ok && wlRes.status !== 409) {
      const wlErr = await wlRes.json().catch(() => ({}));
      throw new Error(wlErr.message || `Failed to add to whitelist (${wlRes.status})`);
    }
    console.log(`[Invite] ${emailLower} added to ${table} as ${role}`);

    // 2. Send invitation email via Resend (optional — skip gracefully if key missing)
    if (!RESEND_KEY) {
      console.warn('[Invite] RESEND_API_KEY not set — skipping email');
      return res.json({ invited: true, emailSent: false, emailError: 'Email service not configured' });
    }
    const appUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}/admin`
      : 'https://lilypadparking.com/admin';
    const roleLabel = role === 'admin' ? 'Admin' : 'Staff';
    const emailRes = await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        from   : 'Lily Pad <noreply@lilypadparking.com>',
        to     : [emailLower],
        subject: `You're invited to the Lily Pad ${roleLabel} team`,
        html   : `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0E1F40;border-radius:20px;padding:40px 32px;color:#fff;">
  <p style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:#8DD63F;text-transform:uppercase;margin:0 0 8px;">Lily Pad Parking</p>
  <h1 style="font-size:26px;font-weight:800;margin:0 0 16px;letter-spacing:-0.02em;">You're invited!</h1>
  <p style="font-size:15px;color:rgba(255,255,255,0.78);line-height:1.6;margin:0 0 28px;">
    You've been added to the Lily Pad <strong style="color:#fff;">${roleLabel}</strong> team.
    Click the button below to activate your account and set a password.
  </p>
  <div style="text-align:center;margin-bottom:28px;">
    <a href="${appUrl}" style="display:inline-block;background:#8DD63F;color:#0E1F40;font-weight:800;font-size:15px;padding:16px 36px;border-radius:100px;text-decoration:none;">
      Activate my account →
    </a>
  </div>
  <p style="font-size:12px;color:rgba(255,255,255,0.40);line-height:1.6;margin:0;text-align:center;">
    On the sign-in page tap <strong style="color:rgba(255,255,255,0.60);">New here? Activate your account</strong> and enter this email address.<br/>
    If you weren't expecting this, you can safely ignore it.
  </p>
</div>`,
      }),
    });
    if (!emailRes.ok) {
      const emailErr = await emailRes.json().catch(() => ({}));
      console.warn(`[Invite] Resend failed for ${emailLower}:`, emailErr.message);
      return res.json({ invited: true, emailSent: false, emailError: emailErr.message || 'Email delivery failed' });
    }
    console.log(`[Invite] Invitation email sent to ${emailLower}`);
    res.json({ invited: true, emailSent: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff list — merges admin_whitelist + staff_whitelist into StaffAccount shape
app.get('/api/staff/list', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  try {
    const [awRes, swRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/admin_whitelist?select=id,email&order=id.asc`, { headers: SVC_HEADERS }),
      fetch(`${SUPABASE_URL}/rest/v1/staff_whitelist?select=id,email&order=id.asc`, { headers: SVC_HEADERS }),
    ]);
    const [adminRows, staffRows] = await Promise.all([awRes.json(), swRes.json()]);
    const toAccount = (row, role, table) => {
      const prefix = row.email.split('@')[0] || row.email;
      const parts = prefix.split(/[._\-\s]+/);
      const firstName = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : prefix;
      const lastName  = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : '';
      return {
        id       : `${table}:${row.id}`,
        firstName,
        lastName,
        email    : row.email,
        role,
        status   : getStaffStatus(table, row.id),
        lastSignIn: 'Never',
      };
    };
    const adminList = Array.isArray(adminRows) ? adminRows.map(r => toAccount(r, 'admin', 'admin_whitelist')) : [];
    const staffList = Array.isArray(staffRows) ? staffRows.map(r => toAccount(r, 'staff', 'staff_whitelist')) : [];
    res.json([...adminList, ...staffList]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff update-status — tracks active/suspended in memory + file ────────────
app.post('/api/staff/update-status', async (req, res) => {
  const { id, status } = req.body || {};
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  // id is "table:rowId" (e.g. "admin_whitelist:3")
  const [table, rowId] = id.split(':');
  if (!table || !rowId) return res.status(400).json({ error: 'invalid id format' });
  setStaffStatus(table, rowId, status);
  res.json({ updated: true });
});

// ── Staff remove — deletes from admin_whitelist or staff_whitelist ─────────────
app.post('/api/staff/remove', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const [table, rowId] = id.split(':');
  if (!['admin_whitelist','staff_whitelist'].includes(table) || !rowId)
    return res.status(400).json({ error: 'invalid id' });
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(rowId)}`, {
      method: 'DELETE',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
    });
    staffStatusMap.delete(`${table}:${rowId}`);
    saveStaffStatus();
    res.json({ removed: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin activation — step 1: send 6-digit code via Resend ────────────
app.post('/api/staff/send-activation-code', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const emailLower = email.toLowerCase().trim();
  try {
    pruneActivationCodes();

    // 1. Whitelist check
    let detectedRole = null;
    for (const [table, r] of [['admin_whitelist', 'admin'], ['staff_whitelist', 'staff']]) {
      const chk = await fetch(
        `${SUPABASE_URL}/rest/v1/${table}?email=eq.${encodeURIComponent(emailLower)}&select=email`,
        { headers: SVC_HEADERS }
      );
      const rows = await chk.json().catch(() => []);
      if (chk.ok && Array.isArray(rows) && rows.length) { detectedRole = r; break; }
    }
    if (!detectedRole)
      return res.status(403).json({ error: 'This email is not on the approved team list. Contact your admin.' });

    // 2. Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    activationCodes.set(emailLower, { code, role: detectedRole, expires: Date.now() + 10 * 60 * 1000 });

    // 3. Send via Resend
    const RESEND_KEY = process.env.RESEND_API_KEY || '';
    if (!RESEND_KEY) {
      console.warn('[Activation] RESEND_API_KEY not set — logging code for dev:', code);
      return res.json({ ok: true, role: detectedRole, devCode: code });
    }
    const roleLabel = detectedRole === 'admin' ? 'Admin' : 'Staff';
    const emailRes = await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        from   : 'Lily Pad <noreply@lilypadparking.com>',
        to     : [emailLower],
        subject: `Your Lily Pad ${roleLabel} activation code`,
        html   : `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0E1F40;border-radius:20px;padding:40px 32px;color:#fff;">
  <p style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:#8DD63F;text-transform:uppercase;margin:0 0 8px;">Lily Pad Parking</p>
  <h1 style="font-size:26px;font-weight:800;margin:0 0 16px;letter-spacing:-0.02em;">Your activation code</h1>
  <p style="font-size:15px;color:rgba(255,255,255,0.78);line-height:1.6;margin:0 0 24px;">
    Use this code to activate your Lily Pad <strong style="color:#fff;">${roleLabel}</strong> account.
    It expires in <strong style="color:#fff;">10 minutes</strong>.
  </p>
  <div style="text-align:center;background:rgba(141,214,63,0.12);border:1.5px solid rgba(141,214,63,0.40);border-radius:16px;padding:24px;margin-bottom:28px;">
    <span style="font-size:42px;font-weight:800;letter-spacing:0.25em;color:#8DD63F;">${code}</span>
  </div>
  <p style="font-size:12px;color:rgba(255,255,255,0.40);line-height:1.6;margin:0;text-align:center;">
    If you weren't expecting this email, you can safely ignore it.
  </p>
</div>`,
      }),
    });
    if (!emailRes.ok) {
      const emailErr = await emailRes.json().catch(() => ({}));
      console.error('[Activation] Resend failed:', emailErr);
      return res.status(500).json({ error: emailErr.message || 'Failed to send activation code. Try again.' });
    }
    console.log(`[Activation] Code sent to ${emailLower} (${detectedRole})`);
    res.json({ ok: true, role: detectedRole });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin activation — step 2: verify code + create account ─────────────
app.post('/api/staff/verify-activation-code', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'email and code required' });
  const emailLower = email.toLowerCase().trim();
  try {
    pruneActivationCodes();
    const stored = activationCodes.get(emailLower);
    if (!stored) return res.status(400).json({ error: 'No active code for this email. Request a new one.' });
    if (Date.now() > stored.expires) {
      activationCodes.delete(emailLower);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }
    if (stored.code !== String(code).trim()) {
      return res.status(400).json({ error: 'Incorrect code. Check your email and try again.' });
    }
    // Code is valid — consume it
    activationCodes.delete(emailLower);
    const role = stored.role;

    // Create/prepare auth user (email_confirm: true, temp pw, sign in for access_token)
    const tempPw = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + 'Aa1!';
    let userId = null;

    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method : 'POST',
      headers: { 'apikey': SVC_KEY, 'Authorization': `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ email: emailLower, email_confirm: true, password: tempPw, user_metadata: { account_type: role } }),
    });
    const createData = await createRes.json();
    if (createRes.ok) {
      userId = createData.id;
    } else {
      // User already exists — look up + reset to tempPw
      const listRes = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(emailLower)}&per_page=10`,
        { headers: SVC_HEADERS }
      );
      const listData = await listRes.json().catch(() => ({}));
      const existing = (listData.users || []).find(u => u.email?.toLowerCase() === emailLower);
      if (!existing?.id) {
        const msg = createData.message || createData.error_description || 'Failed to prepare account.';
        return res.status(400).json({ error: msg });
      }
      userId = existing.id;
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method : 'PUT',
        headers: { 'apikey': SVC_KEY, 'Authorization': `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json' },
        body   : JSON.stringify({ password: tempPw, email_confirm: true }),
      });
    }

    // Sign in with tempPw to get a real access_token the client can use to set their real password
    const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ email: emailLower, password: tempPw }),
    });
    const signInData = await signInRes.json();
    if (!signInRes.ok || !signInData.access_token) {
      const msg = signInData.error_description || signInData.message || 'Failed to create session.';
      return res.status(400).json({ error: msg });
    }

    console.log(`[Activation] Code verified + account ready for ${emailLower} (${role})`);
    res.json({ ok: true, userId, role, access_token: signInData.access_token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin activation — no-SMTP account creation ────────────────────────
// Called after whitelist check passes. Creates (or finds) the auth user with
// email_confirm:true, sets a short-lived temp password, signs in to get a real
// access_token, and returns it so the client can set the user's real password.
// No Supabase SMTP is involved at any point.
app.post('/api/staff/create-activation', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email, role } = req.body || {};
  if (!email || !role) return res.status(400).json({ error: 'email and role required' });
  const emailLower = email.toLowerCase().trim();
  try {
    // Generate a random temp password (will be replaced immediately by the user)
    const tempPw = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + 'Aa1!';

    let userId = null;

    // 1. Try to create a brand-new user (admin API, email pre-confirmed, no SMTP)
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method : 'POST',
      headers: { 'apikey': SVC_KEY, 'Authorization': `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        email: emailLower,
        email_confirm: true,
        password: tempPw,
        user_metadata: { full_name: '', account_type: role },
      }),
    });
    const createData = await createRes.json();

    if (createRes.ok) {
      userId = createData.id;
    } else {
      // User already exists — look them up and reset to temp password
      const listRes = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(emailLower)}&per_page=10`,
        { headers: SVC_HEADERS }
      );
      const listData = await listRes.json().catch(() => ({}));
      const existing = (listData.users || []).find(u => u.email?.toLowerCase() === emailLower);
      if (!existing?.id) {
        const msg = createData.message || createData.error_description || 'Failed to prepare account.';
        return res.status(400).json({ error: msg });
      }
      userId = existing.id;
      // Update their password to tempPw so we can sign them in momentarily
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method : 'PUT',
        headers: { 'apikey': SVC_KEY, 'Authorization': `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json' },
        body   : JSON.stringify({ password: tempPw, email_confirm: true }),
      });
    }

    // 2. Sign in with the temp password to get a real session access_token
    const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ email: emailLower, password: tempPw }),
    });
    const signInData = await signInRes.json();
    if (!signInRes.ok || !signInData.access_token) {
      const msg = signInData.error_description || signInData.message || 'Failed to create session.';
      return res.status(400).json({ error: msg });
    }

    console.log(`[Activation] Account prepared for ${emailLower} (${role}), userId=${userId}`);
    res.json({ ok: true, userId, access_token: signInData.access_token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin activation — step 2: verify OTP, create account ──────────────
app.post('/api/staff/verify-activation', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email, token, role } = req.body || {};
  if (!email || !token || !role) return res.status(400).json({ error: 'email, token and role required' });
  const emailLower = email.toLowerCase().trim();
  try {
    // Verify OTP with Supabase
    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', email, token }),
    });
    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok)
      return res.status(400).json({ error: verifyData.msg || verifyData.message || verifyData.error_description || 'Invalid or expired code.' });

    // Upsert into admin_users with the verified role
    const userId = verifyData.user?.id || null;
    await fetch(`${SUPABASE_URL}/rest/v1/admin_users`, {
      method: 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ email: emailLower, role, auth_user_id: userId, last_login_at: new Date().toISOString() }),
    }).catch(() => {});

    console.log(`[Activation] ${role} activated: ${emailLower}`);
    res.json({ created: true, role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin invite — send Supabase magic invite link to approved email ──────
app.post('/api/staff/invite', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const emailLower = email.toLowerCase().trim();

  try {
    const now = new Date().toISOString();
    // Build redirect URL — prefer explicit SITE_URL env var (set on Railway), fall back to Host header
    const redirectTo = process.env.SITE_URL
      ? `${process.env.SITE_URL.replace(/\/$/, '')}/staff-login`
      : `https://${req.get('host') || ''}/staff-login`;

    // Supabase admin invite — creates the user and emails them an activation link
    const r = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        email,
        redirect_to: redirectTo,
        data: { account_type: 'staff' },
      }),
    });
    const rawText = await r.text();
    let data;
    try { data = JSON.parse(rawText); } catch (_) {
      throw new Error(`Supabase returned non-JSON (${r.status}): ${rawText.slice(0, 200)}`);
    }
    if (!r.ok) {
      const msg = data.message || data.msg || data.error_description || JSON.stringify(data);
      if (/already been invited|already registered|already been registered/i.test(msg)) {
        // Delete the existing pending user so we can send a fresh invite
        const listR = await fetch(
          `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(emailLower)}&per_page=10`,
          { headers: SVC_HEADERS }
        );
        const listData = await listR.json().catch(() => ({}));
        const existing = (listData.users || []).find(u => u.email?.toLowerCase() === emailLower);
        if (existing?.id) {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, {
            method : 'DELETE',
            headers: SVC_HEADERS,
          }).catch(() => {});
        }
        // Re-send a fresh invite
        const r2 = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
          method : 'POST',
          headers: { ...SVC_HEADERS, 'Content-Type': 'application/json' },
          body   : JSON.stringify({ email, redirect_to: redirectTo, data: { account_type: 'staff' } }),
        });
        const data2 = await r2.json().catch(() => ({}));
        if (!r2.ok) throw new Error(data2.message || data2.error_description || 'Failed to resend invite');
        await fetch(`${SUPABASE_URL}/rest/v1/admin_users`, {
          method : 'POST',
          headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body   : JSON.stringify({ email: emailLower, full_name: '', role: 'staff', auth_user_id: data2.id || null, created_at: now }),
        }).catch(() => {});
        return res.json({ invited: true, resent: true });
      }
      throw new Error(msg);
    }

    // Pre-register in admin_users so signin check works once they activate
    await fetch(`${SUPABASE_URL}/rest/v1/admin_users`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body   : JSON.stringify({ email: emailLower, full_name: '', role: 'staff', auth_user_id: data.id || null, created_at: now }),
    }).catch(() => {});

    res.json({ invited: true, resent: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Generic update-password — takes an access_token from verifyOtp + new password ─
app.post('/api/auth/update-password', async (req, res) => {
  const { access_token, password } = req.body || {};
  if (!access_token || !password) return res.status(400).json({ error: 'access_token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method : 'PUT',
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ password }),
    });
    const user = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: user.message || user.error_description || 'Failed to set password.' });
    console.log(`[Auth] Password updated for ${user.email || 'unknown'}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin set-password — called after clicking invite link ───────────────
// The invite link lands on /staff-login with access_token in the URL hash.
// The client sends that token here; we set the password and return the user.
app.post('/api/staff/set-password', async (req, res) => {
  const { access_token, password } = req.body || {};
  if (!access_token || !password) return res.status(400).json({ error: 'access_token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    // Set the new password using the invite session token
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method : 'PUT',
      headers: {
        'apikey'       : SUPABASE_ANON,
        'Authorization': `Bearer ${access_token}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    const user = await r.json();
    if (!r.ok) throw new Error(user.message || user.error_description || 'Failed to set password');

    const now      = new Date().toISOString();
    const email    = (user.email || '').toLowerCase();
    const userId   = user.id || null;

    // Ensure admin_users entry is up to date
    if (email) {
      await fetch(`${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(email)}`,
        { method: 'PATCH', headers: SVC_HEADERS, body: JSON.stringify({ auth_user_id: userId, last_login_at: now }) }
      ).catch(() => {});
    }

    // Ensure profile row exists
    if (userId && email) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method : 'POST',
        headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body   : JSON.stringify({ id: userId, email, account_type: 'staff', updated_at: now }),
      }).catch(() => {});
    }

    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff/admin signin — verifies email is in admin_users table ───────────────
app.post('/api/staff/signin', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const emailLower = email.toLowerCase().trim();
  try {
    // Authenticate via Supabase
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error_description || data.message || 'Invalid credentials' });

    // Check admin_users table
    const adminRes = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(emailLower)}&select=role`,
      { headers: SVC_HEADERS }
    );
    const adminRows = await adminRes.json().catch(() => []);

    let role = 'staff';
    if (adminRes.ok && Array.isArray(adminRows) && adminRows.length) {
      // Existing staff/admin record — use stored role
      role = adminRows[0].role || 'staff';
      fetch(`${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(emailLower)}`,
        { method: 'PATCH', headers: SVC_HEADERS, body: JSON.stringify({ last_login_at: new Date().toISOString() }) }
      ).catch(() => {});
    } else if (ADMIN_EMAILS.includes(emailLower)) {
      // Bootstrap: email is in ADMIN_EMAILS env var — auto-create admin record on first login
      role = 'admin';
      await fetch(`${SUPABASE_URL}/rest/v1/admin_users`, {
        method : 'POST',
        headers: { ...SVC_HEADERS, 'Prefer': 'resolution=ignore-duplicates' },
        body   : JSON.stringify({ email: emailLower, role: 'admin', auth_user_id: data.user?.id || null, last_login_at: new Date().toISOString() }),
      }).catch(() => {});
      console.log(`[Admin] Bootstrapped admin: ${emailLower}`);
    } else {
      return res.status(403).json({ error: 'Not authorized as staff. Contact your administrator.' });
    }

    res.json({ session: data, role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Profile: upsert (service key stays server-side) ───────────────────────────
app.post('/api/profile', async (req, res) => {
  const { id, email, full_name, account_type } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body   : JSON.stringify({
        id, email: email || '', full_name: full_name || '',
        account_type: account_type || 'renter',
        updated_at: new Date().toISOString(),
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json(Array.isArray(data) ? data[0] : data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Profile: fetch by id ───────────────────────────────────────────────────────
app.get('/api/profile/:id', async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${req.params.id}&select=*`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json(Array.isArray(data) ? (data[0] || null) : data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Profile: update fields ─────────────────────────────────────────────────────
app.patch('/api/profile/:id', async (req, res) => {
  const fields = { ...req.body, updated_at: new Date().toISOString() };
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' }, body: JSON.stringify(fields) }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json(Array.isArray(data) ? (data[0] || null) : data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spots: list all active pads (with host name from profiles) ────────────────
app.get('/api/spots', async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/spots?status=eq.active&select=*,host:profiles!host_user_id(full_name)&order=created_at.desc`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    const rows = Array.isArray(data) ? data : [];
    // description is stored as JSON: { text, photo_url } — decode it transparently
    const flat = rows.map(s => {
      let photo_url = '', descText = s.description || '', photo_urls = [], services = [], raw_photo_url = '';
      try {
        const parsed = JSON.parse(s.description || '{}');
        if (parsed && typeof parsed === 'object') {
          photo_url     = parsed.photo_url     || '';
          raw_photo_url = parsed.raw_photo_url || '';
          descText      = parsed.text          || '';
          photo_urls    = Array.isArray(parsed.photo_urls) ? parsed.photo_urls : (photo_url ? [photo_url] : []);
          services      = Array.isArray(parsed.services)   ? parsed.services   : [];
        }
      } catch { /* plain-text description — legacy row */ }
      if (!photo_urls.length && photo_url) photo_urls = [photo_url];
      return {
        ...s,
        description: descText,
        photo_url,
        raw_photo_url,
        photo_urls,
        services,
        host_name: (s.host && s.host.full_name) ? s.host.full_name : '',
      };
    });
    res.json(flat);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Photo upload — server proxies to Supabase Storage with service role key ───
app.post('/api/upload-photo', express.raw({ type: 'image/*', limit: '10mb' }), async (req, res) => {
  const userId = req.headers['x-user-id'] || 'anon';
  const mimeType = req.headers['content-type'] || 'image/jpeg';
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;

  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/spot-photos/${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SVC_KEY}`,
        'apikey': SVC_KEY,
        'Content-Type': mimeType,
        'Cache-Control': '3600',
      },
      body: req.body,
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: err });
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/spot-photos/${path}`;
    res.json({ url: publicUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Maps key (safe to expose — restrict by HTTP referrer in Google Console) ────
app.get('/api/maps-key', (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Maps not configured' });
  res.json({ key });
});

// ── Maps JS proxy — fetches Maps script server-side so no browser Referer is sent ──
// This bypasses API key HTTP referrer restrictions on the Google Cloud Console.
app.get('/api/maps-proxy.js', async (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).send('// Maps not configured');
  try {
    const url = `https://maps.googleapis.com/maps/api/js?key=${key}`;
    const r = await fetch(url, { headers: { 'Referer': '' } });
    const js = await r.text();
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(js);
  } catch (e) {
    res.status(500).send(`// Maps proxy error: ${e.message}`);
  }
});

// ── Reverse geocode: lat/lng → structured address ──────────────────────────────
app.get('/api/reverse-geocode', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  const GMAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GMAPS_KEY) return res.status(500).json({ error: 'Maps not configured' });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GMAPS_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK' || !data.results?.[0]) {
      return res.status(404).json({ error: 'Location not found' });
    }
    const result = data.results[0];
    const comps = result.address_components || [];
    const get  = (type) => comps.find(c => c.types.includes(type))?.long_name  || '';
    const getS = (type) => comps.find(c => c.types.includes(type))?.short_name || '';
    const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
    const city   = get('locality') || get('sublocality_level_1') || get('administrative_area_level_3');
    const state  = getS('administrative_area_level_1');
    const zip    = get('postal_code');
    res.json({ street, city, state, zip, formatted_address: result.formatted_address });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Geocode: validate address via Google Maps and return lat/lng + city/state ──
app.get('/api/geocode', async (req, res) => {
  const { address } = req.query;
  if (!address) return res.status(400).json({ error: 'address required' });
  const GMAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GMAPS_KEY) return res.status(500).json({ error: 'Geocoding not configured' });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GMAPS_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      return res.status(404).json({ error: 'Address not found — please enter a valid street address.' });
    }
    const result = data.results[0];
    const types = result.types || [];
    const comps = result.address_components || [];
    const get  = (type) => comps.find(c => c.types.includes(type))?.long_name  || '';
    const getS = (type) => comps.find(c => c.types.includes(type))?.short_name || '';
    // Must be a street-level result
    const hasStreetNumber = comps.some(c => c.types.includes('street_number'));
    const isVague = types.includes('country') || types.includes('administrative_area_level_1') || types.includes('locality');
    if (isVague || !hasStreetNumber) {
      return res.status(422).json({ error: 'Address not found — please enter a valid street address.' });
    }
    const { lat, lng } = result.geometry.location;
    const city  = get('locality') || get('sublocality_level_1') || get('administrative_area_level_3');
    const state = getS('administrative_area_level_1');
    const zip   = get('postal_code');
    res.json({ lat, lng, formatted_address: result.formatted_address, city, state, zip });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Helper: spot_name is stored in description JSON blob (no separate column) ──
// Just return the provided name as-is; uniqueness not enforced at DB level.
async function findUniquePadName(baseName) {
  return baseName || 'My Lily Pad';
}

// ── Spots: check whether a name is available — always available (no DB column) ─
app.get('/api/spots/check-name', async (req, res) => {
  res.json({ available: true });
});

// ── Spots: create a new pad listing ───────────────────────────────────────────
app.post('/api/spots', async (req, res) => {
  const { host_user_id, address, pad_type, surface, num_pads, price_per_hr, description, photo_url, photo_urls, spot_name: rawSpotName } = req.body || {};
  if (!host_user_id || !address) return res.status(400).json({ error: 'host_user_id and address required' });

  // Use pre-validated lat/lng from client if provided, otherwise geocode with Google Maps
  let lat = parseFloat(req.body.lat) || 0;
  let lng = parseFloat(req.body.lng) || 0;
  if (!lat || !lng) {
    const GMAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
    try {
      if (GMAPS_KEY) {
        const geoR = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GMAPS_KEY}`
        );
        const geoData = await geoR.json();
        if (geoData.status === 'OK' && geoData.results?.[0]) {
          lat = geoData.results[0].geometry.location.lat;
          lng = geoData.results[0].geometry.location.lng;
        }
      }
    } catch { /* fall through to Houston city center */ }
    if (!lat || !lng) { lat = 29.7604; lng = -95.3698; }
  }

  try {
    // photo_url(s) encoded inside description JSON — no separate column needed
    const allUrls = Array.isArray(photo_urls) && photo_urls.length ? photo_urls : (photo_url ? [photo_url] : []);
    // spot_name lives inside the description JSON blob (no separate DB column)
    const assignedName = (rawSpotName?.trim()) || 'My Lily Pad';
    const descPayload = JSON.stringify({ text: description || '', photo_url: allUrls[0] || '', photo_urls: allUrls, spot_name: assignedName });
    const r = await fetch(`${SUPABASE_URL}/rest/v1/spots`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' },
      body   : JSON.stringify({
        host_user_id,
        address: address || '',
        pad_type: pad_type || 'Driveway',
        surface: surface || 'Concrete',
        num_pads: parseInt(num_pads) || 1,
        price_per_hr: parseFloat(price_per_hr) || 4,
        description: descPayload,
        lat, lng,
        status: 'pending',
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    const row = Array.isArray(data) ? data[0] : data;
    // Decode description back for the response
    if (row) {
      try {
        const parsed = JSON.parse(row.description || '{}');
        row.photo_url   = parsed.photo_url || '';
        row.description = parsed.text || '';
        row.spot_name   = parsed.spot_name || assignedName;
      } catch {}
    }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spots: update a pad listing ────────────────────────────────────────────────
app.patch('/api/spots/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};

  // First fetch the current row so we can merge photo_url into description JSON
  try {
    const cur = await fetch(
      `${SUPABASE_URL}/rest/v1/spots?id=eq.${id}&select=description,status,price_per_hr,address,lat,lng,spot_data`,
      { headers: SVC_HEADERS }
    );
    const curData = await cur.json();
    const existing = Array.isArray(curData) ? curData[0] : curData;

    // Parse existing description JSON (may be plain text for legacy rows)
    let descObj = { text: '', photo_url: '', raw_photo_url: '', photo_urls: [], services: [], spot_name: '' };
    try {
      const p = JSON.parse(existing?.description || '{}');
      if (p && typeof p === 'object') descObj = {
        text: p.text || '',
        photo_url: p.photo_url || '',
        raw_photo_url: p.raw_photo_url || '',
        photo_urls: Array.isArray(p.photo_urls) ? p.photo_urls : [],
        services: Array.isArray(p.services) ? p.services : [],
        spot_name: p.spot_name || existing?.spot_name || '',
      };
    } catch { descObj.text = existing?.description || ''; }

    // Merge changes — all stored inside description JSON blob
    if ('photo_url'     in body) descObj.photo_url     = body.photo_url;
    if ('raw_photo_url' in body) descObj.raw_photo_url = body.raw_photo_url;
    if ('photo_urls'    in body) descObj.photo_urls    = body.photo_urls;
    if ('description'   in body) descObj.text          = body.description;
    if ('services'      in body) descObj.services      = body.services;
    // spot_name lives in the description blob (no DB column)
    if ('spot_name'     in body) {
      const newName = String(body.spot_name || '').trim();
      if (newName) descObj.spot_name = newName;
    }

    const patchFields = { description: JSON.stringify(descObj) };
    if ('status'       in body) patchFields.status       = body.status;
    if ('price_per_hr' in body) patchFields.price_per_hr = body.price_per_hr;
    if ('address'      in body) patchFields.address       = body.address;
    if ('lat'          in body) patchFields.lat           = body.lat;
    if ('lng'          in body) patchFields.lng           = body.lng;
    if ('auto_approve' in body) {
      const existingSpotData = existing?.spot_data || {};
      patchFields.spot_data = { ...existingSpotData, auto_approve: !!body.auto_approve };
    }

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/spots?id=eq.${id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' }, body: JSON.stringify(patchFields) }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    const row = Array.isArray(data) ? (data[0] || null) : data;
    // Decode response
    if (row) { try { const p = JSON.parse(row.description || '{}'); row.photo_url = p.photo_url || ''; row.description = p.text || ''; row.spot_name = p.spot_name || row.spot_name || ''; } catch {} }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spots: host's own listings (any status) ───────────────────────────────────
app.get('/api/spots/user/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/spots?host_user_id=eq.${userId}&select=*&order=created_at.desc`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    const rows = Array.isArray(data) ? data : [];
    const flat = rows.map(s => {
      let photo_url = '', descText = s.description || '', photo_urls = [], services = [], spot_name = '';
      try {
        const p = JSON.parse(s.description || '{}');
        if (p && typeof p === 'object') {
          photo_url  = p.photo_url  || '';
          descText   = p.text       || '';
          photo_urls = Array.isArray(p.photo_urls) ? p.photo_urls : (photo_url ? [photo_url] : []);
          services   = Array.isArray(p.services)   ? p.services   : [];
          spot_name  = p.spot_name  || s.spot_name || '';
        }
      } catch {}
      if (!photo_urls.length && photo_url) photo_urls = [photo_url];
      return { ...s, description: descText, photo_url, photo_urls, services, spot_name };
    });
    res.json(flat);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spots: all pending — admin approval queue ──────────────────────────────────
app.get('/api/spots/pending', async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/spots?status=eq.pending&select=*,host:profiles!host_user_id(full_name,email)&order=created_at.desc`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    const rows = Array.isArray(data) ? data : [];
    const flat = rows.map(s => {
      let photo_url = '', descText = s.description || '', photo_urls = [], spot_name = '';
      try {
        const p = JSON.parse(s.description || '{}');
        if (p && typeof p === 'object') {
          photo_url  = p.photo_url  || '';
          descText   = p.text       || '';
          photo_urls = Array.isArray(p.photo_urls) ? p.photo_urls : (photo_url ? [photo_url] : []);
          spot_name  = p.spot_name  || s.spot_name || '';
        }
      } catch {}
      if (!photo_urls.length && photo_url) photo_urls = [photo_url];
      return { ...s, description: descText, photo_url, photo_urls, spot_name, host_name: s.host?.full_name || '', host_email: s.host?.email || '' };
    });
    res.json(flat);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spots: admin approve — set active + email host ────────────────────────────
app.post('/api/spots/:id/approve', async (req, res) => {
  const { id } = req.params;
  const RESEND_KEY = process.env.RESEND_API_KEY || '';
  try {
    // 1. Activate the spot
    const patchR = await fetch(`${SUPABASE_URL}/rest/v1/spots?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify({ status: 'active' }),
    });
    const patchData = await patchR.json();
    if (!patchR.ok) return res.status(patchR.status).json({ error: patchData });
    const spot = Array.isArray(patchData) ? patchData[0] : patchData;

    // 2. Decode description JSON
    let photo_url = '', description = '';
    try { const p = JSON.parse(spot.description || '{}'); photo_url = p.photo_url || ''; description = p.text || ''; } catch {}

    // 3. Fetch host profile for email
    const profileR = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${spot.host_user_id}&select=email,full_name`,
      { headers: SVC_HEADERS }
    );
    const profiles = await profileR.json();
    const host = Array.isArray(profiles) ? profiles[0] : profiles;

    // 4. Send approval email via Resend
    if (RESEND_KEY && host?.email) {
      const appUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}/find`
        : 'https://lilypadparking.com/find';
      const firstName = (host.full_name || 'there').split(' ')[0];
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Lily Pad <noreply@lilypadparking.com>',
          to: [host.email],
          subject: `Your Lily Pad listing is live! 🎉`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;background:#0E1F40;border-radius:20px;padding:40px 32px;color:#fff;">
  <p style="font-size:11px;font-weight:700;letter-spacing:0.18em;color:#8DD63F;text-transform:uppercase;margin:0 0 8px;">Lily Pad Parking</p>
  <h1 style="font-size:26px;font-weight:800;margin:0 0 16px;letter-spacing:-0.02em;">Your spot is live! 🎉</h1>
  <p style="font-size:15px;color:rgba(255,255,255,0.78);line-height:1.6;margin:0 0 8px;">
    Hey ${firstName}, great news — your listing has been reviewed and approved by our team.
  </p>
  <div style="background:#142A52;border-radius:14px;padding:16px 18px;margin:20px 0;">
    <p style="font-size:11px;font-weight:700;letter-spacing:0.12em;color:#8DD63F;text-transform:uppercase;margin:0 0 6px;">Your listing</p>
    <p style="font-size:16px;font-weight:700;color:#fff;margin:0;line-height:1.4;">${spot.address}</p>
    ${description ? `<p style="font-size:13px;color:rgba(255,255,255,0.60);margin:6px 0 0;line-height:1.5;">${description}</p>` : ''}
    <p style="font-size:14px;font-weight:700;color:#8DD63F;margin:10px 0 0;">$${spot.price_per_hr}/hr</p>
  </div>
  <p style="font-size:14px;color:rgba(255,255,255,0.78);line-height:1.6;margin:0 0 28px;">
    Drivers can now find and book your spot on the Lily Pad map. You'll receive booking notifications as they come in.
  </p>
  <div style="text-align:center;margin-bottom:28px;">
    <a href="${appUrl}" style="display:inline-block;background:#8DD63F;color:#0E1F40;font-weight:800;font-size:15px;padding:16px 36px;border-radius:100px;text-decoration:none;">
      View on map →
    </a>
  </div>
  <p style="font-size:12px;color:rgba(255,255,255,0.40);line-height:1.6;margin:0;text-align:center;">
    If you have questions, contact us at support@lilypadparking.com
  </p>
</div>`,
        }),
      }).catch(e => console.warn('[Approve] Email failed:', e.message));
    }

    res.json({ approved: true, spot: { ...spot, description, photo_url } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spots: admin reject — mark rejected ───────────────────────────────────────
app.post('/api/spots/:id/reject', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/spots?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'rejected' }),
    });
    if (!r.ok) { const d = await r.json(); return res.status(r.status).json({ error: d }); }
    res.json({ rejected: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers for Stripe/payment endpoints
// ─────────────────────────────────────────────────────────────────────────────

// Verifies a Supabase JWT from the Authorization header.
// Returns { id, email } on success or null on failure.
async function verifyBearerToken(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !SUPABASE_ANON) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: (u.email || '').toLowerCase() } : null;
  } catch { return null; }
}

// Verifies a JWT AND checks that the caller is in the admin_users table (role=admin or staff).
// Returns the role string on success, or null on failure.
async function verifyAdminBearerToken(req) {
  const caller = await verifyBearerToken(req);
  if (!caller?.email) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(caller.email)}&select=role,status`,
      { headers: SVC_HEADERS }
    );
    const rows = await r.json();
    if (!r.ok || !Array.isArray(rows) || rows.length === 0) return null;
    if (rows[0].status === 'suspended') return null;
    return rows[0].role || 'staff'; // 'admin' | 'staff'
  } catch { return null; }
}

// ── Stripe: expose publishable key to the client (avoids needing a VITE_-prefixed
//    build-time var — works regardless of how the host platform names it) ──────
app.get('/api/stripe-config', (req, res) => {
  if (!STRIPE_PUBLISHABLE_KEY) return res.status(503).json({ error: 'Stripe is not configured on the server.' });
  res.json({ publishableKey: STRIPE_PUBLISHABLE_KEY });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stripe Connect — host onboarding & account management
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/connect/create-account
// Creates a Stripe Express Connect account for the host, stores account ID in profiles,
// and returns an onboarding URL.
app.post('/api/connect/create-account', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { userId, email } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });
  // Caller may only create a Connect account for themselves
  if (caller.id !== userId) return res.status(403).json({ error: 'Forbidden' });

  try {
    // Check if user already has a connect account
    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_connect_account_id,email`, { headers: SVC_HEADERS });
    const profRows = await profRes.json();
    const prof = Array.isArray(profRows) ? profRows[0] : null;
    let accountId = prof?.stripe_connect_account_id || '';

    // Create new account if none exists
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: email || prof?.email || undefined,
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        business_type: 'individual',
      });
      accountId = account.id;

      // Store account ID in profiles
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ stripe_connect_account_id: accountId, stripe_connect_status: 'pending' }),
      });
    }

    const baseUrl = req.headers.origin || `https://${req.headers.host}`;
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/connect-refresh`,
      return_url: `${baseUrl}/connect-return`,
      type: 'account_onboarding',
    });

    res.json({ accountId, url: accountLink.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/connect/status/:userId
// Returns the connect status for a host (not_started | pending | active)
app.get('/api/connect/status/:userId', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { userId } = req.params;
  if (caller.id !== userId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=stripe_connect_account_id,stripe_connect_status`, { headers: SVC_HEADERS });
    const profRows = await profRes.json();
    const prof = Array.isArray(profRows) ? profRows[0] : null;
    if (!prof || !prof.stripe_connect_account_id) {
      return res.json({ status: 'not_started', accountId: null });
    }

    const accountId = prof.stripe_connect_account_id;
    // Ask Stripe whether the account can accept charges
    if (stripe) {
      try {
        const account = await stripe.accounts.retrieve(accountId);
        const isActive = account.charges_enabled;
        const newStatus = isActive ? 'active' : 'pending';
        // Update status in DB if changed
        if (newStatus !== prof.stripe_connect_status) {
          await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
            method: 'PATCH',
            headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ stripe_connect_status: newStatus }),
          });
        }
        return res.json({ status: newStatus, accountId, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled });
      } catch {
        return res.json({ status: prof.stripe_connect_status || 'pending', accountId });
      }
    }
    res.json({ status: prof.stripe_connect_status || 'pending', accountId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/connect/create-login-link/:accountId
// Returns a Stripe dashboard login link for the host
app.post('/api/connect/create-login-link/:accountId', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { accountId } = req.params;
  // Verify the caller owns this connect account
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=stripe_connect_account_id`, { headers: SVC_HEADERS });
  const profRows = await profRes.json().catch(() => []);
  const ownedAccountId = Array.isArray(profRows) ? profRows[0]?.stripe_connect_account_id : null;
  if (!ownedAccountId || ownedAccountId !== accountId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const link = await stripe.accounts.createLoginLink(accountId);
    res.json({ url: link.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/connect/payouts/:accountId
// Lists recent payouts for the host's connected account
app.get('/api/connect/payouts/:accountId', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { accountId } = req.params;
  // Verify ownership
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=stripe_connect_account_id`, { headers: SVC_HEADERS });
  const profRows = await profRes.json().catch(() => []);
  const ownedId = Array.isArray(profRows) ? profRows[0]?.stripe_connect_account_id : null;
  if (!ownedId || ownedId !== accountId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const payouts = await stripe.payouts.list(
      { limit: 20 },
      { stripeAccount: accountId }
    );
    res.json(payouts.data.map(p => ({
      id: p.id,
      amount: p.amount / 100,
      currency: p.currency,
      status: p.status,
      arrival_date: p.arrival_date,
      description: p.description,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/connect/balance/:accountId
// Returns available + pending balance for the host's connected account
app.get('/api/connect/balance/:accountId', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { accountId } = req.params;
  // Verify ownership
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=stripe_connect_account_id`, { headers: SVC_HEADERS });
  const profRows = await profRes.json().catch(() => []);
  const ownedId = Array.isArray(profRows) ? profRows[0]?.stripe_connect_account_id : null;
  if (!ownedId || ownedId !== accountId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
    const available = balance.available.reduce((s, b) => b.currency === 'usd' ? s + b.amount : s, 0) / 100;
    const pending   = balance.pending.reduce((s, b) => b.currency === 'usd' ? s + b.amount : s, 0) / 100;
    res.json({ available, pending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/connect/bookings/:userId
// Returns confirmed bookings for a host's spots (for earnings dashboard)
app.get('/api/connect/bookings/:userId', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { userId } = req.params;
  if (caller.id !== userId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const spotRes = await fetch(`${SUPABASE_URL}/rest/v1/spots?host_user_id=eq.${userId}&select=id,address,description`, { headers: SVC_HEADERS });
    const spotData = await spotRes.json();
    if (!Array.isArray(spotData) || spotData.length === 0) return res.json([]);
    const spotMap = {};
    spotData.forEach(s => {
      let spotName = '';
      try { spotName = JSON.parse(s.description || '{}').spot_name || ''; } catch {}
      spotMap[s.id] = { address: s.address, spot_name: spotName };
    });
    const ids = spotData.map(s => s.id).join(',');
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?spot_id=in.(${ids})&status=eq.confirmed&select=*&order=created_at.desc&limit=100`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    if (!Array.isArray(bData)) return res.json([]);
    res.json(bData.map(b => {
      const bd = b.booking_data || {};
      return {
        id: b.id,
        spot_id: b.spot_id,
        spot_address: spotMap[b.spot_id]?.address || bd.addr || '',
        spot_name: spotMap[b.spot_id]?.spot_name || '',
        driver_name: bd.driver_name || 'Driver',
        start_ts: bd.start_ts || null,
        total_price: Number(bd.total_price) || 0,
        platform_fee: Number(bd.platform_fee) || 0,
        payment_intent_id: bd.stripe_payment_intent_id || '',
        refund_status: bd.refund_status || null,
        created_at: b.created_at,
      };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Refunds
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/refunds/request
app.post('/api/refunds/request', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { bookingId, requesterId, requesterType, reason } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'bookingId required' });
  // Caller must match the supplied requesterId
  if (requesterId && caller.id !== requesterId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=booking_data,status,user_id`, { headers: SVC_HEADERS });
    const bRows = await bRes.json();
    const booking = Array.isArray(bRows) ? bRows[0] : null;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    // Verify caller is the driver or the host for this booking
    const bd = booking.booking_data || {};
    const isDriver = booking.user_id === caller.id;
    const isHost   = bd.lister_id === caller.id;
    if (!isDriver && !isHost) return res.status(403).json({ error: 'Forbidden — not your booking' });
    const updated = {
      ...bd,
      refund_status: 'requested',
      refund_requested_at: new Date().toISOString(),
      refund_requester_id: requesterId || null,
      refund_requester_type: requesterType || 'driver',
      refund_reason: reason || '',
    };
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ booking_data: updated }),
    });
    if (!pRes.ok) return res.status(500).json({ error: 'Failed to update booking' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/refunds/pending  (admin)
app.get('/api/refunds/pending', async (req, res) => {
  const adminRole = await verifyAdminBearerToken(req);
  if (!adminRole) return res.status(401).json({ error: 'Admin authentication required' });
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?select=*&order=created_at.desc`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    if (!Array.isArray(bData)) return res.json([]);
    const pending = bData.filter(b => b.booking_data?.refund_status === 'requested');
    res.json(pending.map(b => {
      const bd = b.booking_data || {};
      return {
        id: b.id,
        status: b.status,
        spot_id: b.spot_id,
        driver_name: bd.driver_name || 'Driver',
        driver_email: bd.driver_email || '',
        addr: bd.addr || '',
        total_price: Number(bd.total_price) || 0,
        payment_intent_id: bd.stripe_payment_intent_id || '',
        refund_requester_type: bd.refund_requester_type || 'driver',
        refund_reason: bd.refund_reason || '',
        refund_requested_at: bd.refund_requested_at || b.created_at,
        start_ts: bd.start_ts || null,
      };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/refunds/approve/:bookingId  (admin only)
app.post('/api/refunds/approve/:bookingId', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  const adminRole = await verifyAdminBearerToken(req);
  if (!adminRole || adminRole !== 'admin') return res.status(401).json({ error: 'Admin authentication required' });
  const { bookingId } = req.params;
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=booking_data,status`, { headers: SVC_HEADERS });
    const bRows = await bRes.json();
    const booking = Array.isArray(bRows) ? bRows[0] : null;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const bd = booking.booking_data || {};
    const paymentIntentId = bd.stripe_payment_intent_id;
    if (!paymentIntentId) return res.status(400).json({ error: 'No payment intent on this booking' });

    const refund = await stripe.refunds.create({ payment_intent: paymentIntentId });
    const updated = {
      ...bd,
      refund_status: 'approved',
      refund_id: refund.id,
      refund_approved_at: new Date().toISOString(),
    };
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ booking_data: updated, status: 'cancelled' }),
    });
    res.json({ success: true, refundId: refund.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/refunds/deny/:bookingId  (admin only)
app.post('/api/refunds/deny/:bookingId', async (req, res) => {
  const adminRole = await verifyAdminBearerToken(req);
  if (!adminRole || adminRole !== 'admin') return res.status(401).json({ error: 'Admin authentication required' });
  const { bookingId } = req.params;
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=booking_data`, { headers: SVC_HEADERS });
    const bRows = await bRes.json();
    const booking = Array.isArray(bRows) ? bRows[0] : null;
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    const bd = booking.booking_data || {};
    const updated = { ...bd, refund_status: 'denied', refund_denied_at: new Date().toISOString() };
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ booking_data: updated }),
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: transactions & revenue
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/transactions  (admin only)
app.get('/api/admin/transactions', async (req, res) => {
  const adminRole = await verifyAdminBearerToken(req);
  if (!adminRole || adminRole !== 'admin') return res.status(401).json({ error: 'Admin authentication required' });
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?status=eq.confirmed&select=*&order=created_at.desc&limit=200`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    if (!Array.isArray(bData)) return res.json([]);
    res.json(bData.map(b => {
      const bd = b.booking_data || {};
      const total = Number(bd.total_price) || 0;
      const fee   = Number(bd.platform_fee) || Math.round(total * 0.15 * 100) / 100;
      return {
        id: b.id,
        created_at: b.created_at,
        driver_name: bd.driver_name || 'Driver',
        driver_email: bd.driver_email || '',
        addr: bd.addr || '',
        spot_id: b.spot_id,
        total_price: total,
        platform_fee: fee,
        host_payout: Math.round((total - fee) * 100) / 100,
        payment_intent_id: bd.stripe_payment_intent_id || '',
        connect_account_id: bd.connect_account_id || '',
        refund_status: bd.refund_status || null,
        start_ts: bd.start_ts || null,
        payment_method_last4: bd.payment_method_last4 || '',
        payment_method_brand: bd.payment_method_brand || '',
      };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Customer: saved payment method
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/customer/payment-method/:userId
app.get('/api/customer/payment-method/:userId', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { userId } = req.params;
  if (caller.id !== userId) return res.status(403).json({ error: 'Forbidden' });
  try {
    // Find the most recent confirmed booking with a payment intent for this user
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?user_id=eq.${userId}&status=eq.confirmed&order=created_at.desc&limit=10&select=booking_data`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    if (!Array.isArray(bData)) return res.json(null);
    let last4 = '', brand = '', piId = '';
    for (const b of bData) {
      const bd = b.booking_data || {};
      if (bd.stripe_payment_intent_id) { piId = bd.stripe_payment_intent_id; break; }
    }
    if (piId) {
      const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
      const pm = pi.payment_method;
      if (pm && typeof pm === 'object' && pm.card) {
        last4 = pm.card.last4 || '';
        brand = pm.card.brand || '';
      }
    }
    res.json(last4 ? { last4, brand } : null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/customer/payment-method/:userId — detach saved card
app.delete('/api/customer/payment-method/:userId', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { userId } = req.params;
  if (caller.id !== userId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?user_id=eq.${userId}&status=eq.confirmed&order=created_at.desc&limit=10&select=booking_data`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    let piId = '';
    for (const b of (Array.isArray(bData) ? bData : [])) {
      const bd = b.booking_data || {};
      if (bd.stripe_payment_intent_id) { piId = bd.stripe_payment_intent_id; break; }
    }
    if (!piId) return res.json({ removed: false, reason: 'No saved card found.' });
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
    const pm = pi.payment_method;
    if (!pm || typeof pm !== 'object') return res.json({ removed: false, reason: 'No payment method found.' });
    await stripe.paymentMethods.detach(pm.id);
    res.json({ removed: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/customer/setup-intent — save card without booking (SetupIntent)
app.post('/api/customer/setup-intent', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY on the server.' });
  if (!STRIPE_PUBLISHABLE_KEY) return res.status(503).json({ error: 'Stripe publishable key not configured. Set STRIPE_PUBLISHABLE_KEY on the server.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  try {
    // Find or create a Stripe Customer for this user
    const CUSTOMERS_FILE = '/tmp/stripe_customers.json';
    let customers = {};
    try { customers = JSON.parse(require('fs').readFileSync(CUSTOMERS_FILE, 'utf8')); } catch {}
    let customerId = customers[caller.id];
    if (!customerId) {
      // Check if a customer already exists with this email
      const existing = await stripe.customers.list({ email: caller.email, limit: 1 });
      if (existing.data.length > 0) {
        customerId = existing.data[0].id;
      } else {
        const customer = await stripe.customers.create({ email: caller.email, metadata: { userId: caller.id } });
        customerId = customer.id;
      }
      customers[caller.id] = customerId;
      try { require('fs').writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers)); } catch {}
    }
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });
    console.log(`[Setup] Created setupIntent ${setupIntent.id} for customer ${customerId}`);
    res.json({ clientSecret: setupIntent.client_secret, publishableKey: STRIPE_PUBLISHABLE_KEY });
  } catch (e) {
    console.error('[Setup] setup-intent error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/customer/receipt/:bookingId — Stripe receipt URL
app.get('/api/customer/receipt/:bookingId', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.bookingId}&select=*`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    const booking = Array.isArray(bData) ? bData[0] : null;
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    if (booking.user_id !== caller.id) return res.status(403).json({ error: 'Forbidden' });
    const piId = (booking.booking_data || {}).stripe_payment_intent_id;
    if (!piId) return res.json({ receiptUrl: null });
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
    const charge = pi.latest_charge;
    const receiptUrl = (charge && typeof charge === 'object') ? charge.receipt_url : null;
    res.json({ receiptUrl: receiptUrl || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/customer/bookings/:userId
app.get('/api/customer/bookings/:userId', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { userId } = req.params;
  if (caller.id !== userId) return res.status(403).json({ error: 'Forbidden' });
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?user_id=eq.${userId}&order=created_at.desc&limit=50&select=*`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    if (!Array.isArray(bData)) return res.json([]);
    res.json(bData.map(b => {
      const bd = b.booking_data || {};
      return {
        id: b.id,
        status: b.status,
        addr: bd.addr || '',
        start_ts: bd.start_ts || null,
        end_ts: bd.end_ts || null,
        total_price: Number(bd.total_price) || 0,
        payment_intent_id: bd.stripe_payment_intent_id || '',
        payment_method_last4: bd.payment_method_last4 || '',
        payment_method_brand: bd.payment_method_brand || '',
        refund_status: bd.refund_status || null,
        created_at: b.created_at,
      };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Stripe: create a PaymentIntent for a pending booking ─────────────────────
// Amount is always recalculated server-side from the spot's real price_per_hr —
// never trust a client-supplied amount.
app.post('/api/create-payment-intent', async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured on the server.' });
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { spot_id, start_ts, end_ts, user_id } = req.body || {};
  if (!spot_id || !start_ts || !end_ts) return res.status(400).json({ error: 'spot_id, start_ts, end_ts required' });
  // Reject if the client-supplied user_id doesn't match the authenticated caller
  if (user_id && user_id !== caller.id) return res.status(403).json({ error: 'Forbidden' });

  try {
    // Fetch spot info and host's connect account in parallel
    const [spotRes, hostConnectRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/spots?id=eq.${spot_id}&select=price_per_hr,address,host_user_id`, { headers: SVC_HEADERS }),
      fetch(`${SUPABASE_URL}/rest/v1/spots?id=eq.${spot_id}&select=host_user_id`, { headers: SVC_HEADERS }),
    ]);
    const spotRows = await spotRes.json();
    const spot     = Array.isArray(spotRows) ? spotRows[0] : null;
    if (!spot) return res.status(404).json({ error: 'Spot not found' });

    // Look up host's Stripe Connect account
    let hostConnectAccountId = null;
    if (spot.host_user_id) {
      const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${spot.host_user_id}&select=stripe_connect_account_id,stripe_connect_status`, { headers: SVC_HEADERS });
      const profRows = await profRes.json();
      const prof = Array.isArray(profRows) ? profRows[0] : null;
      if (prof?.stripe_connect_status === 'active' && prof?.stripe_connect_account_id) {
        hostConnectAccountId = prof.stripe_connect_account_id;
      }
    }

    const pricePerHr = Number(spot.price_per_hr) || 0;
    const durMs   = new Date(end_ts).getTime() - new Date(start_ts).getTime();
    if (!(durMs > 0)) return res.status(400).json({ error: 'end_ts must be after start_ts' });
    const durHrs  = Math.max(1, Math.round(durMs / (60 * 60 * 1000)));
    const total   = Math.round(pricePerHr * durHrs * 100) / 100;
    const amountCents = Math.max(50, Math.round(total * 100)); // Stripe minimum charge is $0.50
    const PLATFORM_FEE_RATE = 0.15;
    const platformFeeCents = Math.round(amountCents * PLATFORM_FEE_RATE);

    const piParams = {
      amount: amountCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        spot_id: String(spot_id),
        user_id: caller.id,          // always set from verified JWT, never from client input
        start_ts: String(start_ts),
        end_ts: String(end_ts),
        amount_cents: String(amountCents), // bind computed amount for later validation
        address: spot.address || '',
        connect_account_id: hostConnectAccountId || '',
      },
    };

    // If host has a connected account, route payment through Connect
    if (hostConnectAccountId) {
      piParams.application_fee_amount = platformFeeCents;
      piParams.transfer_data = { destination: hostConnectAccountId };
    }

    const paymentIntent = await stripe.paymentIntents.create(piParams);
    const platformFee = Math.round(platformFeeCents) / 100;

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: total,
      platformFee,
      connectAccountId: hostConnectAccountId,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: create (creates as 'pending' unless a verified Stripe payment ───
//    has already succeeded, in which case it's created as 'confirmed') ────────
app.post('/api/bookings', async (req, res) => {
  const caller = await verifyBearerToken(req);
  if (!caller) return res.status(401).json({ error: 'Authentication required' });
  const { user_id, spot_id, start_ts, end_ts, price_per_hr, total_price, booking_data, payment_intent_id } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  // Caller may only create bookings for themselves
  if (caller.id !== user_id) return res.status(403).json({ error: 'Forbidden' });

  try {
    // If a payment intent was supplied, verify it actually succeeded before
    // trusting the client's "paid" claim.
    let bookingStatus = 'pending';
    let verifiedPaymentIntentId = null;
    if (payment_intent_id) {
      if (!stripe) return res.status(503).json({ error: 'Stripe is not configured on the server.' });

      // All booking fields are required when confirming via a payment intent
      if (!spot_id)     return res.status(400).json({ error: 'spot_id required for payment confirmation' });
      if (!start_ts)    return res.status(400).json({ error: 'start_ts required for payment confirmation' });
      if (!end_ts)      return res.status(400).json({ error: 'end_ts required for payment confirmation' });
      if (!total_price) return res.status(400).json({ error: 'total_price required for payment confirmation' });

      const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
      if (pi.status !== 'succeeded') {
        return res.status(402).json({ error: `Payment not completed (status: ${pi.status})` });
      }

      // ── Strict binding: PI metadata must match this booking request exactly ──
      const piMeta = pi.metadata || {};
      const normTs = (ts) => { try { return new Date(String(ts)).toISOString(); } catch { return ''; } };

      // user_id — mandatory; always set from verified caller when creating the PI
      if (!piMeta.user_id || piMeta.user_id !== caller.id) {
        return res.status(403).json({ error: 'Payment intent does not belong to this user' });
      }

      // spot_id — strict equality required
      if (!piMeta.spot_id || String(piMeta.spot_id) !== String(spot_id)) {
        return res.status(403).json({ error: 'Payment intent was for a different spot' });
      }

      // start_ts / end_ts — strict equality (normalised to ISO)
      if (!piMeta.start_ts || normTs(piMeta.start_ts) !== normTs(start_ts)) {
        return res.status(403).json({ error: 'Payment intent was for a different booking start time' });
      }
      if (!piMeta.end_ts || normTs(piMeta.end_ts) !== normTs(end_ts)) {
        return res.status(403).json({ error: 'Payment intent was for a different booking end time' });
      }

      // Amount — claimed total_price must equal the PI amount (±1 cent rounding tolerance)
      if (!piMeta.amount_cents) {
        return res.status(403).json({ error: 'Payment intent is missing amount binding metadata' });
      }
      const paidCents    = Number(piMeta.amount_cents);
      const claimedCents = Math.round(Number(total_price) * 100);
      if (Math.abs(claimedCents - paidCents) > 1) {
        return res.status(403).json({ error: 'Booking total does not match the payment intent amount' });
      }

      // ── Replay prevention: reject if this PI has already been used ──
      const replayRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?stripe_payment_intent_id=eq.${encodeURIComponent(pi.id)}&select=id&limit=1`,
        { headers: SVC_HEADERS }
      );
      const replayRows = await replayRes.json().catch(() => []);
      if (Array.isArray(replayRows) && replayRows.length > 0) {
        return res.status(409).json({ error: 'This payment has already been used to create a booking' });
      }

      bookingStatus = 'confirmed';
      verifiedPaymentIntentId = pi.id;
      // Extract platform fee and connect account from metadata
      var piFee = pi.application_fee_amount ? pi.application_fee_amount / 100 : (pi.amount ? Math.round(pi.amount * 0.15) / 100 : 0);
      var piConnectAccountId = pi.metadata?.connect_account_id || (pi.transfer_data?.destination || '');
      var piLast4 = '', piBrand = '';
      try {
        if (pi.payment_method && typeof pi.payment_method === 'string') {
          const pmObj = await stripe.paymentMethods.retrieve(pi.payment_method);
          piLast4 = pmObj?.card?.last4 || '';
          piBrand = pmObj?.card?.brand || '';
        }
      } catch {}
    }

    // Look up driver profile and spot/lister info in parallel
    const [driverRes, spotRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}&select=full_name,email`, { headers: SVC_HEADERS }),
      spot_id ? fetch(`${SUPABASE_URL}/rest/v1/spots?id=eq.${spot_id}&select=host_user_id,address`, { headers: SVC_HEADERS }) : Promise.resolve(null),
    ]);
    const driverRows  = await driverRes.json();
    const driver      = Array.isArray(driverRows) ? driverRows[0] : null;
    const driverName  = driver?.full_name || 'A driver';
    const driverEmail = driver?.email     || null;

    const spotRows    = spotRes ? await spotRes.json() : [];
    const spot        = Array.isArray(spotRows) ? spotRows[0] : null;
    const listerId    = spot?.host_user_id || null;

    // Look up lister profile for their email
    let listerEmail = null, listerName = 'Host';
    if (listerId) {
      const lrRes  = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${listerId}&select=full_name,email`, { headers: SVC_HEADERS });
      const lrRows = await lrRes.json();
      const lr     = Array.isArray(lrRows) ? lrRows[0] : null;
      listerEmail  = lr?.email     || null;
      listerName   = lr?.full_name || 'Host';
    }

    const data_payload = {
      ...(booking_data || {}),
      spot_id:      spot_id     || null,
      start_ts:     start_ts    || null,
      end_ts:       end_ts      || null,
      price_per_hr: price_per_hr || 0,
      total_price:  total_price  || 0,
      lister_id:    listerId,
      driver_name:  driverName,
      driver_email: driverEmail,
      ...(verifiedPaymentIntentId ? {
        stripe_payment_intent_id: verifiedPaymentIntentId,
        platform_fee: piFee || 0,
        connect_account_id: piConnectAccountId || '',
        payment_method_last4: piLast4 || '',
        payment_method_brand: piBrand || '',
      } : {}),
    };

    const bookingRow = {
      user_id,
      spot_id: String(spot_id || ''),
      booking_data: data_payload,
      status: bookingStatus,
      // Write PI ID to dedicated column so UNIQUE constraint prevents replay
      ...(verifiedPaymentIntentId ? { stripe_payment_intent_id: verifiedPaymentIntentId } : {}),
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' },
      body   : JSON.stringify(bookingRow),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });

    // Email lister about the new booking (non-blocking)
    const addr   = booking_data?.addr || spot?.address || 'your spot';
    const dtOpts = { month: 'short', day: 'numeric' };
    const tmOpts = { hour: 'numeric', minute: '2-digit' };
    const dateStr = start_ts ? new Date(start_ts).toLocaleDateString('en-US', dtOpts) : '';
    const fromStr = start_ts ? new Date(start_ts).toLocaleTimeString('en-US', tmOpts) : '';
    const tillStr = end_ts   ? new Date(end_ts).toLocaleTimeString('en-US', tmOpts)   : '';
    const totalLabel = total_price ? `$${Number(total_price).toFixed(2)}` : '';
    const isPaid = bookingStatus === 'confirmed';
    sendEmail(listerEmail, isPaid ? 'New Paid Booking — Lily Pad' : 'New Booking Request — Lily Pad',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0E1F40;margin:0 0 8px">${isPaid ? 'New paid booking ✅' : 'New booking request 🛏'}</h2>
        <p style="color:#555;margin:0 0 16px">Hi ${listerName},</p>
        <p style="color:#555;margin:0 0 20px"><strong>${driverName}</strong> ${isPaid ? 'has paid and confirmed a booking for your spot.' : 'has requested to book your spot.'}</p>
        <div style="background:#f5f7fa;border-radius:12px;padding:16px;margin-bottom:20px">
          <div style="font-size:13px;color:#0E1F40;margin-bottom:6px"><strong>📍 ${addr}</strong></div>
          <div style="font-size:13px;color:#555;margin-bottom:4px">📅 ${dateStr}</div>
          <div style="font-size:13px;color:#555;margin-bottom:4px">⏰ ${fromStr} → ${tillStr}</div>
          ${totalLabel ? `<div style="font-size:13px;color:#555"><strong>💰 ${totalLabel}</strong></div>` : ''}
        </div>
        <p style="color:#555;margin:0 0 20px">${isPaid ? 'This booking is already confirmed and paid — open <strong>My Pads</strong> to view the details.' : 'Log in to your Lily Pad account and open <strong>My Pads</strong> to approve or deny this request.'}</p>
        <p style="font-size:12px;color:#999;margin:0">— Lily Pad</p>
      </div>`
    );

    res.json(Array.isArray(data) ? data[0] : data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: lister view — all bookings for spots owned by this user ───────────
app.get('/api/bookings/lister/:listerId', async (req, res) => {
  const { listerId } = req.params;
  try {
    // 1. Get all spot IDs for this lister
    const spotRes  = await fetch(`${SUPABASE_URL}/rest/v1/spots?host_user_id=eq.${listerId}&select=id,address,spot_data`, { headers: SVC_HEADERS });
    const spotData = await spotRes.json();
    if (!spotRes.ok || !Array.isArray(spotData) || spotData.length === 0) return res.json([]);
    const spotMap     = {};
    const spotDataMap = {};
    spotData.forEach(s => { spotMap[s.id] = s.address; spotDataMap[s.id] = s.spot_data || {}; });
    const ids = spotData.map(s => s.id).join(',');

    // 2. Fetch all bookings for those spots
    const bRes  = await fetch(`${SUPABASE_URL}/rest/v1/bookings?spot_id=in.(${ids})&select=*&order=created_at.desc`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    if (!bRes.ok || !Array.isArray(bData)) return res.json([]);

    const mapped = bData.map(b => {
      const bd = b.booking_data || {};
      const er = bd.extend_request || null;
      return {
        id:             b.id,
        driver_user_id: b.user_id,
        spot_id:        b.spot_id,
        spot_address:   bd.addr || spotMap[b.spot_id] || '',
        driver_name:    bd.driver_name  || 'Driver',
        driver_email:   bd.driver_email || null,
        start_ts:       bd.start_ts     || null,
        end_ts:         bd.end_ts       || null,
        price_per_hr:   Number(bd.price_per_hr) || 0,
        total_price:    Number(bd.total_price)  || 0,
        pad_type:       bd.padType || 'Driveway',
        status:         b.status   || 'pending',
        created_at:     b.created_at,
        extend_request: er ? { new_end_ts: er.new_end_ts, requested_at: er.requested_at, status: er.status || 'pending' } : null,
        auto_approve:   !!(spotDataMap[b.spot_id]?.auto_approve),
      };
    });
    res.json(mapped);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: approve ─────────────────────────────────────────────────────────
app.patch('/api/bookings/:id/approve', async (req, res) => {
  try {
    // Fetch booking first so we can email the driver
    const getR  = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}&select=*`, { headers: SVC_HEADERS });
    const rows  = await getR.json();
    const b     = Array.isArray(rows) ? rows[0] : null;
    if (!b) return res.status(404).json({ error: 'Not found' });

    const patchR = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ status: 'approved' }) }
    );
    if (!patchR.ok) { const e = await patchR.json(); return res.status(patchR.status).json({ error: e }); }

    const bd      = b.booking_data || {};
    const dEmail  = bd.driver_email || null;
    const dName   = bd.driver_name  || 'Driver';
    const addr    = bd.addr         || 'your booked spot';
    const dtOpts  = { month: 'short', day: 'numeric' };
    const tmOpts  = { hour: 'numeric', minute: '2-digit' };
    const dateStr = bd.start_ts ? new Date(bd.start_ts).toLocaleDateString('en-US', dtOpts)  : '';
    const fromStr = bd.start_ts ? new Date(bd.start_ts).toLocaleTimeString('en-US', tmOpts) : '';
    const tillStr = bd.end_ts   ? new Date(bd.end_ts).toLocaleTimeString('en-US', tmOpts)   : '';
    sendEmail(dEmail, 'Booking Approved — Lily Pad',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0E1F40;margin:0 0 8px">Your booking is approved! ✅</h2>
        <p style="color:#555;margin:0 0 16px">Hi ${dName},</p>
        <p style="color:#555;margin:0 0 20px">Great news — the host has approved your booking request.</p>
        <div style="background:#f0fce8;border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #c8e9a0">
          <div style="font-size:13px;color:#0E1F40;margin-bottom:6px"><strong>📍 ${addr}</strong></div>
          <div style="font-size:13px;color:#555;margin-bottom:4px">📅 ${dateStr}</div>
          <div style="font-size:13px;color:#555">⏰ ${fromStr} → ${tillStr}</div>
        </div>
        <p style="color:#555;margin:0 0 20px">Open Lily Pad and check <strong>My Bookings</strong> to view your booking details.</p>
        <p style="font-size:12px;color:#999;margin:0">— Lily Pad</p>
      </div>`
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: deny ────────────────────────────────────────────────────────────
app.patch('/api/bookings/:id/deny', async (req, res) => {
  try {
    const getR  = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}&select=*`, { headers: SVC_HEADERS });
    const rows  = await getR.json();
    const b     = Array.isArray(rows) ? rows[0] : null;
    if (!b) return res.status(404).json({ error: 'Not found' });

    const patchR = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ status: 'denied' }) }
    );
    if (!patchR.ok) { const e = await patchR.json(); return res.status(patchR.status).json({ error: e }); }

    const bd     = b.booking_data || {};
    const dEmail = bd.driver_email || null;
    const dName  = bd.driver_name  || 'Driver';
    const addr   = bd.addr         || 'the spot';
    sendEmail(dEmail, 'Booking Request Update — Lily Pad',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0E1F40;margin:0 0 8px">Booking not approved</h2>
        <p style="color:#555;margin:0 0 16px">Hi ${dName},</p>
        <p style="color:#555;margin:0 0 20px">Unfortunately, the host was unable to approve your booking request for <strong>${addr}</strong>.</p>
        <p style="color:#555;margin:0 0 20px">Open Lily Pad and search the map — there are other spots nearby that may work for you.</p>
        <p style="font-size:12px;color:#999;margin:0">— Lily Pad</p>
      </div>`
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Spots: delete — cancels all active/pending bookings and emails drivers ─────
app.delete('/api/spots/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Find all non-cancelled bookings for this spot
    const bRes  = await fetch(`${SUPABASE_URL}/rest/v1/bookings?spot_id=eq.${id}&status=not.in.(cancelled,denied)&select=*`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    const bookings = Array.isArray(bData) ? bData : [];

    // 2. Email each driver and cancel their bookings
    await Promise.all(bookings.map(async b => {
      const bd     = b.booking_data || {};
      const dEmail = bd.driver_email || null;
      const dName  = bd.driver_name  || 'Driver';
      const addr   = bd.addr         || 'the spot';
      sendEmail(dEmail, 'Booking Cancelled — Lily Pad',
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#0E1F40;margin:0 0 8px">Booking cancelled</h2>
          <p style="color:#555;margin:0 0 16px">Hi ${dName},</p>
          <p style="color:#555;margin:0 0 20px">The host has removed the listing for <strong>${addr}</strong>. Your booking has been automatically cancelled.</p>
          <p style="color:#555;margin:0 0 20px">We're sorry for the inconvenience — open Lily Pad to find another spot nearby.</p>
          <p style="font-size:12px;color:#999;margin:0">— Lily Pad</p>
        </div>`
      );
    }));

    // 3. Bulk-cancel affected bookings
    if (bookings.length > 0) {
      const ids = bookings.map(b => b.id).join(',');
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=in.(${ids})`,
        { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }) }
      );
    }

    // 4. Delete the spot
    const delR = await fetch(`${SUPABASE_URL}/rest/v1/spots?id=eq.${id}`,
      { method: 'DELETE', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' } }
    );
    if (!delR.ok) { const e = await delR.json(); return res.status(delR.status).json({ error: e }); }
    res.json({ ok: true, cancelled: bookings.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: cancel ───────────────────────────────────────────────────────────
app.patch('/api/bookings/:id/cancel', async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }) }
    );
    if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e }); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: extend (update end_ts inside booking_data JSONB) ─────────────────
app.patch('/api/bookings/:id/reschedule', async (req, res) => {
  const { start_ts, end_ts } = req.body || {};
  if (!start_ts || !end_ts) return res.status(400).json({ error: 'start_ts and end_ts required' });
  try {
    const getR = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}&select=booking_data`, { headers: SVC_HEADERS });
    const rows = await getR.json();
    if (!getR.ok || !Array.isArray(rows) || !rows[0]) return res.status(404).json({ error: 'Not found' });
    const merged = { ...(rows[0].booking_data || {}), start_ts, end_ts };
    const patchR = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ booking_data: merged }) }
    );
    if (!patchR.ok) { const e = await patchR.json(); return res.status(patchR.status).json({ error: e }); }
    console.log(`[booking] rescheduled ${req.params.id} → ${start_ts} – ${end_ts}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/bookings/:id/extend', async (req, res) => {
  const { new_end_ts } = req.body || {};
  if (!new_end_ts) return res.status(400).json({ error: 'new_end_ts required' });
  try {
    // Fetch current booking_data then merge
    const getR = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}&select=booking_data`,
      { headers: SVC_HEADERS }
    );
    const rows = await getR.json();
    if (!getR.ok || !Array.isArray(rows) || !rows[0]) return res.status(404).json({ error: 'Not found' });
    const merged = { ...(rows[0].booking_data || {}), end_ts: new_end_ts };
    const patchR = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ booking_data: merged }) }
    );
    if (!patchR.ok) { const e = await patchR.json(); return res.status(patchR.status).json({ error: e }); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: request extension (driver → asks lister to extend end time) ──────
app.post('/api/bookings/:id/extension-request', async (req, res) => {
  const { new_end_ts } = req.body || {};
  if (!new_end_ts) return res.status(400).json({ error: 'new_end_ts required' });
  try {
    const bkRes  = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}&select=*`, { headers: SVC_HEADERS });
    const bkRows = await bkRes.json();
    const bk     = Array.isArray(bkRows) ? bkRows[0] : null;
    if (!bk) return res.status(404).json({ error: 'Not found' });

    const bd      = bk.booking_data || {};
    const spot_id = bk.spot_id;

    // Fetch spot to check auto_approve setting
    const spotRes  = await fetch(`${SUPABASE_URL}/rest/v1/spots?id=eq.${spot_id}&select=spot_data,host_user_id,address`, { headers: SVC_HEADERS });
    const spotRows = await spotRes.json();
    const spot     = Array.isArray(spotRows) ? spotRows[0] : null;
    const autoApprove = !!(spot?.spot_data?.auto_approve);

    const requested_at = new Date().toISOString();

    if (autoApprove) {
      // Auto-approve: immediately update end_ts
      const merged = { ...bd, end_ts: new_end_ts, extend_request: { new_end_ts, requested_at, status: 'approved' } };
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
        { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ booking_data: merged }) }
      );
      console.log(`[extension] auto-approved ${req.params.id} → ${new_end_ts}`);
      return res.json({ status: 'auto_approved', new_end_ts });
    }

    // Needs lister approval: store pending request
    const merged = { ...bd, extend_request: { new_end_ts, requested_at, status: 'pending' } };
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ booking_data: merged }) }
    );

    // Email lister
    const listerId = bd.lister_id || spot?.host_user_id;
    if (listerId) {
      const lrRes  = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${listerId}&select=full_name,email`, { headers: SVC_HEADERS });
      const lrRows = await lrRes.json();
      const lr     = Array.isArray(lrRows) ? lrRows[0] : null;
      const addr   = bd.addr || spot?.address || 'your spot';
      const tmOpts = { hour: 'numeric', minute: '2-digit' };
      const dOpts  = { month: 'short', day: 'numeric' };
      const newEndStr = new Date(new_end_ts).toLocaleTimeString('en-US', tmOpts);
      const newDateStr = new Date(new_end_ts).toLocaleDateString('en-US', dOpts);
      sendEmail(lr?.email, 'Extension Request — Lily Pad',
        `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#0E1F40;margin:0 0 8px">Extension request ⏱</h2>
          <p style="color:#555;margin:0 0 16px">Hi ${lr?.full_name || 'Host'},</p>
          <p style="color:#555;margin:0 0 20px"><strong>${bd.driver_name || 'Your guest'}</strong> has requested to extend their booking at <strong>${addr}</strong>.</p>
          <div style="background:#f5f7fa;border-radius:12px;padding:16px;margin-bottom:20px">
            <div style="font-size:13px;color:#555;margin-bottom:4px">New checkout: <strong>${newDateStr} at ${newEndStr}</strong></div>
          </div>
          <p style="color:#555;margin:0 0 20px">Open Lily Pad and go to <strong>My Reservations</strong> to approve or deny.</p>
          <p style="font-size:12px;color:#999;margin:0">— Lily Pad</p>
        </div>`
      );
    }
    console.log(`[extension] pending request ${req.params.id} → ${new_end_ts}`);
    res.json({ status: 'pending' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: approve extension ────────────────────────────────────────────────
app.patch('/api/bookings/:id/extension-approve', async (req, res) => {
  try {
    const getR  = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}&select=*`, { headers: SVC_HEADERS });
    const rows  = await getR.json();
    const bk    = Array.isArray(rows) ? rows[0] : null;
    if (!bk) return res.status(404).json({ error: 'Not found' });
    const bd         = bk.booking_data || {};
    const new_end_ts = bd.extend_request?.new_end_ts;
    if (!new_end_ts) return res.status(400).json({ error: 'No pending extension request' });

    const merged = { ...bd, end_ts: new_end_ts, extend_request: { ...bd.extend_request, status: 'approved' } };
    const patchR = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ booking_data: merged }) }
    );
    if (!patchR.ok) { const e = await patchR.json(); return res.status(patchR.status).json({ error: e }); }

    const dEmail   = bd.driver_email || null;
    const dName    = bd.driver_name  || 'Driver';
    const addr     = bd.addr         || 'your spot';
    const tmOpts   = { hour: 'numeric', minute: '2-digit' };
    const dOpts    = { month: 'short', day: 'numeric' };
    const newEndStr  = new Date(new_end_ts).toLocaleTimeString('en-US', tmOpts);
    const newDateStr = new Date(new_end_ts).toLocaleDateString('en-US', dOpts);
    sendEmail(dEmail, 'Extension Approved — Lily Pad',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0E1F40;margin:0 0 8px">Extension approved! ✅</h2>
        <p style="color:#555;margin:0 0 16px">Hi ${dName},</p>
        <p style="color:#555;margin:0 0 20px">Great news — the host approved your extension request for <strong>${addr}</strong>.</p>
        <div style="background:#f0fce8;border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #c8e9a0">
          <div style="font-size:13px;color:#555">New checkout: <strong>${newDateStr} at ${newEndStr}</strong></div>
        </div>
        <p style="font-size:12px;color:#999;margin:0">— Lily Pad</p>
      </div>`
    );
    console.log(`[extension] approved ${req.params.id} → ${new_end_ts}`);
    res.json({ ok: true, new_end_ts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: deny extension ───────────────────────────────────────────────────
app.patch('/api/bookings/:id/extension-deny', async (req, res) => {
  try {
    const getR  = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}&select=booking_data`, { headers: SVC_HEADERS });
    const rows  = await getR.json();
    const bk    = Array.isArray(rows) ? rows[0] : null;
    if (!bk) return res.status(404).json({ error: 'Not found' });
    const bd = bk.booking_data || {};

    const merged = { ...bd, extend_request: { ...bd.extend_request, status: 'denied' } };
    const patchR = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify({ booking_data: merged }) }
    );
    if (!patchR.ok) { const e = await patchR.json(); return res.status(patchR.status).json({ error: e }); }

    const dEmail = bd.driver_email || null;
    const dName  = bd.driver_name  || 'Driver';
    sendEmail(dEmail, 'Extension Request Update — Lily Pad',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0E1F40;margin:0 0 8px">Extension not approved</h2>
        <p style="color:#555;margin:0 0 16px">Hi ${dName},</p>
        <p style="color:#555;margin:0 0 20px">Unfortunately the host was unable to approve your extension request. Your booking will end at the original time.</p>
        <p style="font-size:12px;color:#999;margin:0">— Lily Pad</p>
      </div>`
    );
    console.log(`[extension] denied ${req.params.id}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Saved spots: list ──────────────────────────────────────────────────────────
app.get('/api/saved-spots/:userId', async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/saved_spots?user_id=eq.${req.params.userId}&select=*&order=saved_at.desc`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    res.json(r.ok ? data : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Saved spots: add ───────────────────────────────────────────────────────────
app.post('/api/saved-spots', async (req, res) => {
  const { user_id, spot_id, spot_data } = req.body || {};
  if (!user_id || !spot_id) return res.status(400).json({ error: 'user_id and spot_id required' });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/saved_spots`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body   : JSON.stringify({ user_id, spot_id, spot_data: spot_data || {}, saved_at: new Date().toISOString() }),
    });
    if (!r.ok) { const e = await r.json(); return res.status(r.status).json({ error: e }); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Saved spots: remove ────────────────────────────────────────────────────────
app.delete('/api/saved-spots', async (req, res) => {
  const { user_id, spot_id } = req.body || {};
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/saved_spots?user_id=eq.${user_id}&spot_id=eq.${spot_id}`,
      { method: 'DELETE', headers: SVC_HEADERS }
    );
    res.json({ ok: r.ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Bookings: list ─────────────────────────────────────────────────────────────
app.get('/api/bookings/:userId', async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?user_id=eq.${req.params.userId}&select=*&order=created_at.desc`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    if (!r.ok) return res.json([]);
    const rows = Array.isArray(data) ? data : [];
    const mapped = rows.map(b => {
      const bd = b.booking_data || {};
      const er = bd.extend_request || null;
      return {
        id:             b.id,
        uuid:           b.id,
        user_id:        b.user_id,
        spot_id:        bd.spot_id || b.spot_id || '',
        addr:           bd.addr    || bd.address || '',
        city:           'Houston, TX',
        pad_type:       bd.padType || 'Driveway',
        host_name:      bd.hostName  || '',
        host_phone:     bd.hostPhone || '',
        start_ts:       bd.start_ts  || null,
        end_ts:         bd.end_ts    || null,
        price_per_hr:   Number(bd.price_per_hr) || 0,
        total_price:    Number(bd.total_price)  || 0,
        status:         b.status || 'confirmed',
        created_at:     b.created_at,
        extend_request: er ? { new_end_ts: er.new_end_ts, requested_at: er.requested_at, status: er.status || 'pending' } : null,
      };
    });
    res.json(mapped);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Booking Chat: host inbox (latest msg per booking, stored in booking_data) ──
app.get('/api/booking-chat/host-inbox/:hostId', async (req, res) => {
  const { hostId } = req.params;
  try {
    const spotRes = await fetch(`${SUPABASE_URL}/rest/v1/spots?host_user_id=eq.${hostId}&select=id`, { headers: SVC_HEADERS });
    const spots = await spotRes.json();
    if (!Array.isArray(spots) || spots.length === 0) return res.json([]);
    const spotIds = spots.map(s => s.id);

    const bRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?spot_id=in.(${spotIds.join(',')})&select=id,booking_data&order=created_at.desc`,
      { headers: SVC_HEADERS }
    );
    const bookings = await bRes.json();
    if (!Array.isArray(bookings)) return res.json([]);

    const inbox = [];
    for (const b of bookings) {
      const bd = b.booking_data || {};
      const msgs = Array.isArray(bd.chat_messages) ? bd.chat_messages : [];
      if (msgs.length === 0) continue;
      const last = msgs[msgs.length - 1];
      inbox.push({
        booking_id:      b.id,
        driver_name:     bd.driver_name  || 'Driver',
        spot_address:    bd.addr         || '',
        last_message:    last.message,
        last_message_at: last.created_at,
        sender_role:     last.sender_role,
      });
    }
    res.json(inbox);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Booking Chat: fetch messages (from booking_data.chat_messages) ─────────────
app.get('/api/booking-chat/:bookingId', async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${req.params.bookingId}&select=booking_data`,
      { headers: SVC_HEADERS }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return res.json([]);
    const msgs = rows[0]?.booking_data?.chat_messages;
    res.json(Array.isArray(msgs) ? msgs : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Booking Chat: send message (append to booking_data.chat_messages) ──────────
app.post('/api/booking-chat/:bookingId', async (req, res) => {
  const { bookingId } = req.params;
  const { sender_id, sender_role, message } = req.body;
  if (!sender_id || !sender_role || !message?.trim()) {
    return res.status(400).json({ error: 'sender_id, sender_role, and message are required' });
  }
  try {
    // 1. Fetch current booking_data
    const getR = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}&select=booking_data`,
      { headers: SVC_HEADERS }
    );
    const rows = await getR.json();
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const bd = rows[0].booking_data || {};
    const existing = Array.isArray(bd.chat_messages) ? bd.chat_messages : [];

    // 2. Append new message
    const newMsg = {
      id:          require('crypto').randomUUID(),
      booking_id:  bookingId,
      sender_id,
      sender_role,
      message:     message.trim(),
      created_at:  new Date().toISOString(),
    };
    const updated = [...existing, newMsg];

    // 3. Patch booking_data with updated messages
    const patchR = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${bookingId}`, {
      method: 'PATCH',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ booking_data: { ...bd, chat_messages: updated } }),
    });
    if (!patchR.ok) {
      const e = await patchR.json().catch(() => ({}));
      return res.status(patchR.status).json({ error: e });
    }
    res.json(newMsg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: live stats from real Supabase data ─────────────────────────────────
app.get('/api/admin/stats', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  try {
    const [spotsR, usersR, bookingsR] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/spots?select=status`, { headers: SVC_HEADERS }),
      fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,created_at`, { headers: SVC_HEADERS }),
      fetch(`${SUPABASE_URL}/rest/v1/bookings?select=id`, { headers: SVC_HEADERS }),
    ]);
    const spots    = await spotsR.json();
    const users    = await usersR.json();
    const bookings = await bookingsR.json();
    const weekAgo  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const totalSpots       = Array.isArray(spots)    ? spots.length : 0;
    const activeSpots      = Array.isArray(spots)    ? spots.filter(s => s.status === 'active').length  : 0;
    const pendingSpots     = Array.isArray(spots)    ? spots.filter(s => s.status === 'pending').length : 0;
    const totalUsers       = Array.isArray(users)    ? users.length : 0;
    const newUsersThisWeek = Array.isArray(users)    ? users.filter(u => new Date(u.created_at) >= weekAgo).length : 0;
    const totalBookings    = Array.isArray(bookings) ? bookings.length : 0;
    res.json({ totalSpots, activeSpots, pendingSpots, totalUsers, newUsersThisWeek, totalBookings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: list all real users with booking counts ────────────────────────────
app.get('/api/admin/users', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  try {
    const [profRes, bookRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&order=created_at.desc`, { headers: SVC_HEADERS }),
      fetch(`${SUPABASE_URL}/rest/v1/bookings?select=user_id`, { headers: SVC_HEADERS }),
    ]);
    const profiles = await profRes.json();
    const bookings = await bookRes.json();
    if (!profRes.ok) return res.status(profRes.status).json({ error: profiles });
    const counts = {};
    if (Array.isArray(bookings)) bookings.forEach(b => { if (b.user_id) counts[b.user_id] = (counts[b.user_id] || 0) + 1; });
    const result = Array.isArray(profiles)
      ? profiles
          .filter(p => !String(p.email || '').toLowerCase().endsWith('@lilypadparking.com'))
          .filter(p => String(p.email || '').includes('@'))
          .map(p => ({ ...p, booking_count: counts[p.id] || 0 }))
      : [];
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: update user (status, account_type, etc.) ──────────────────────────
app.patch('/api/admin/users/:id', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const fields = { ...req.body, updated_at: new Date().toISOString() };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' }, body: JSON.stringify(fields) }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json(Array.isArray(data) ? (data[0] || null) : data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Support: list conversations (all for staff/admin; filtered by user_id for customers) ─
app.get('/api/support/conversations', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { user_id } = req.query;
  try {
    const filter = user_id ? `?user_id=eq.${user_id}&order=updated_at.desc` : `?order=updated_at.desc`;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/support_conversations${filter}`, { headers: SVC_HEADERS });
    const data = await r.json();
    res.json(r.ok ? (Array.isArray(data) ? data : []) : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Support: create conversation ──────────────────────────────────────────────
app.post('/api/support/conversations', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { user_id, user_name, user_email, subject, first_message } = req.body || {};
  console.log('[CONV CREATE] user_id:', user_id, '| email:', user_email, '| subject:', subject, '| first_message:', first_message?.slice(0,40));
  if (!user_id && !user_email) return res.status(400).json({ error: 'user_id or user_email required' });
  try {
    const now = new Date().toISOString();
    // Upsert user profile so the FK on support_conversations.user_id is satisfied.
    // Users authenticated via Supabase may not have a profiles row if the trigger
    // didn't fire for their account (e.g. created before the table existed).
    if (user_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          id: user_id, email: user_email || '', full_name: user_name || '',
          account_type: 'driver', updated_at: now,
        }),
      });
    }
    const conv = {
      user_id: user_id || null, user_name: user_name || user_email || 'Customer',
      user_email: user_email || '', subject: subject || 'Support Request',
      status: 'open', last_message: first_message || '', last_message_at: now,
      created_at: now, updated_at: now,
    };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/support_conversations`,
      { method: 'POST', headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' }, body: JSON.stringify(conv) }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    const created = Array.isArray(data) ? data[0] : data;
    if (first_message && created && created.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/support_messages`, {
        method: 'POST', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          conversation_id: created.id, sender_id: user_id || null,
          sender_name: user_name || user_email || 'Customer',
          sender_role: 'customer', message: first_message, created_at: now,
        }),
      });
    }
    res.json(created);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Support: get messages for a conversation ──────────────────────────────────
app.get('/api/support/conversations/:id/messages', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/support_messages?conversation_id=eq.${req.params.id}&order=created_at.asc`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    res.json(r.ok ? (Array.isArray(data) ? data : []) : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Support: send a message ───────────────────────────────────────────────────
app.post('/api/support/messages', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { conversation_id, sender_id, sender_name, sender_role, message } = req.body || {};
  if (!conversation_id || !message) return res.status(400).json({ error: 'conversation_id and message required' });
  try {
    const now = new Date().toISOString();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/support_messages`,
      { method: 'POST', headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify({ conversation_id, sender_id: sender_id || null,
          sender_name: sender_name || 'User', sender_role: sender_role || 'customer',
          message, created_at: now }) }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    await fetch(`${SUPABASE_URL}/rest/v1/support_conversations?id=eq.${conversation_id}`,
      { method: 'PATCH', headers: SVC_HEADERS,
        body: JSON.stringify({ last_message: message, last_message_at: now, updated_at: now }) }
    );
    res.json(Array.isArray(data) ? (data[0] || null) : data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Support: delete conversation (admin/staff only) ───────────────────────────
app.delete('/api/support/conversations/:id', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/support_conversations?id=eq.${req.params.id}`,
      { method: 'DELETE', headers: SVC_HEADERS }
    );
    res.status(r.ok ? 204 : r.status).end();
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Support: update conversation (status, assigned_to) ────────────────────────
app.patch('/api/support/conversations/:id', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/support_conversations?id=eq.${req.params.id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify({ ...req.body, updated_at: new Date().toISOString() }) }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json(Array.isArray(data) ? (data[0] || null) : data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Beta tester check ──────────────────────────────────────────────────────────
app.post('/api/beta/check', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.json({ isBetaTester: false });
  try {
    const em = email.trim().toLowerCase();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/beta_testers?select=email&email=ilike.${encodeURIComponent(em)}`,
      { headers: SVC_HEADERS }
    );
    const rows = await r.json();
    const found = Array.isArray(rows) && rows.length > 0;
    console.log(`[beta/check] ${em} → isBetaTester=${found}`);
    return res.json({ isBetaTester: found });
  } catch (err) {
    console.error('[beta/check] unexpected:', err.message);
    return res.json({ isBetaTester: false });
  }
});

// ── Beta: send password-reset code via Resend ──────────────────────────────────
app.post('/api/beta/send-reset-code', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const em = email.trim().toLowerCase();
  try {
    // Only allow beta testers
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/beta_testers?email=eq.${encodeURIComponent(em)}&select=email`, { headers: SVC_HEADERS });
    const rows = await chk.json();
    if (!Array.isArray(rows) || rows.length === 0) return res.status(403).json({ error: 'Not a beta tester.' });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    betaResetCodes.set(em, { code, expires: Date.now() + 15 * 60 * 1000 });

    await sendEmail(em, 'Your lily pad password reset code', `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0E1F40;border-radius:16px;color:#fff;">
        <p style="font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#8DD63F;margin:0 0 8px;">lily pad — beta access</p>
        <h1 style="font-size:24px;font-weight:800;margin:0 0 8px;">Password reset code</h1>
        <p style="color:rgba(255,255,255,0.6);font-size:14px;margin:0 0 28px;">Use this code to reset your password. It expires in 15 minutes.</p>
        <div style="background:rgba(255,255,255,0.07);border-radius:12px;padding:24px;text-align:center;letter-spacing:0.22em;font-size:32px;font-weight:800;color:#fff;">${code}</div>
        <p style="color:rgba(255,255,255,0.35);font-size:12px;margin:24px 0 0;">If you didn't request this, you can ignore this email.</p>
      </div>
    `);
    console.log(`[beta/reset] Code sent to ${em}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Beta: verify code + set new password ───────────────────────────────────────
app.post('/api/beta/reset-password', async (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password) return res.status(400).json({ error: 'email, code, and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const em = email.trim().toLowerCase();

  const stored = betaResetCodes.get(em);
  if (!stored || stored.code !== code.trim() || stored.expires < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired code.' });
  }

  try {
    // Look up user ID from profiles table (reliable case-insensitive email match)
    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=ilike.${encodeURIComponent(em)}&select=id&limit=1`,
      { headers: SVC_HEADERS }
    );
    const profiles = await pRes.json();
    const userId = profiles?.[0]?.id;
    if (!userId) return res.status(404).json({ error: 'Account not found.' });

    // Update password via admin API using the confirmed user ID
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: SVC_HEADERS,
      body: JSON.stringify({ password }),
    });
    const uData = await uRes.json();
    if (!uRes.ok) return res.status(uRes.status).json({ error: uData.message || 'Failed to update password.' });

    betaResetCodes.delete(em);
    console.log(`[beta/reset] Password updated for ${em} (id=${userId})`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Customer contact form ──────────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
    if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required.' });
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required.' });

    const html = `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
        <h2 style="color:#0E1F40;margin-bottom:4px">New Support Request</h2>
        <p style="color:#666;margin-top:0;font-size:13px">Submitted via the Lily Pad app</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
          <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#555;width:100px"><strong>Name</strong></td><td style="padding:10px 0;border-bottom:1px solid #eee">${name.trim()}</td></tr>
          <tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#555"><strong>Email</strong></td><td style="padding:10px 0;border-bottom:1px solid #eee"><a href="mailto:${email.trim()}">${email.trim()}</a></td></tr>
          ${phone ? `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#555"><strong>Phone</strong></td><td style="padding:10px 0;border-bottom:1px solid #eee">${phone.trim()}</td></tr>` : ''}
        </table>
        <div style="margin-top:20px;background:#f6f8fb;border-radius:8px;padding:16px">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.05em">Message</p>
          <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap">${message.trim()}</p>
        </div>
      </div>`;

    await sendEmail('support@lilypadparking.com', `Support request from ${name.trim()}`, html);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff login page ───────────────────────────────────────────────────────────
app.get('/staff-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'staff-login.html'));
});

// ── Serve built React/Vite app ─────────────────────────────────────────────────
const DIST = path.join(__dirname, 'dist');
// index:false so index.html is NOT auto-served — the SPA fallback below handles it
app.use(express.static(DIST, { index: false }));

function _unusedBuildEarlyAccessHtml_REMOVED(logoUrl) {
  return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">\n' +
'<title>lily pad \u2014 Parking Marketplace</title>\n' +
'<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&display=swap" rel="stylesheet">\n' +
'<style>\n' +
'*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n' +
'html,body{height:100%;overflow:hidden;background:#0E1F40}\n' +
'body{font-family:"DM Sans",sans-serif;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center}\n' +
'#app{width:100%;max-width:430px;height:100dvh;height:100vh;display:flex;flex-direction:column;overflow:hidden;position:relative}\n' +
'.screen{position:absolute;inset:0;display:flex;flex-direction:column;transition:opacity .22s,transform .22s;will-change:opacity,transform}\n' +
'.screen.hidden{opacity:0;pointer-events:none;transform:translateY(12px)}\n' +
'.green-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:16px 40px;border-radius:100px;background:#8DD63F;border:none;color:#0E1F40;font-family:"DM Sans",sans-serif;font-size:15px;font-weight:700;cursor:pointer;transition:opacity .15s}\n' +
'.green-btn:active{opacity:.85}\n' +
'.pill-input{width:100%;padding:14px 20px;border-radius:100px;border:1.5px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff;font-family:"DM Sans",sans-serif;font-size:16px;font-weight:400;outline:none;transition:border-color .18s}\n' +
'.pill-input::placeholder{color:rgba(255,255,255,.35)}\n' +
'.pill-input:focus{border-color:rgba(141,214,63,.6)}\n' +
'.role-btn{padding:11px 30px;border-radius:100px;border:1.5px solid rgba(255,255,255,.20);background:rgba(255,255,255,.06);color:rgba(255,255,255,.60);font-family:"DM Sans",sans-serif;font-size:15px;font-weight:400;cursor:pointer;transition:all .16s}\n' +
'.role-btn.on{border-color:#8DD63F;background:#8DD63F;color:#0E1F40;font-weight:700}\n' +
'.continue-btn{width:100%;padding:15px 0;border-radius:100px;background:#fff;color:#0E1F40;font-family:"DM Sans",sans-serif;font-size:15px;font-weight:700;border:none;cursor:pointer;transition:opacity .15s}\n' +
'.continue-btn:disabled{opacity:.45;cursor:not-allowed}\n' +
'.continue-btn:active{opacity:.85}\n' +
'@keyframes slide-in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}\n' +
'.animate{animation:slide-in .28s cubic-bezier(.22,.68,0,1.2) both}\n' +
'@keyframes fade-in{from{opacity:0}to{opacity:1}}\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<div id="app">\n' +

// ── WELCOME ──────────────────────────────────────────────────────────────────
'<div id="s-welcome" class="screen">\n' +
'  <div id="logo-zone" style="flex-shrink:0;display:flex;justify-content:center;padding-top:52px;overflow:hidden;position:relative">\n' +
'    <img id="logo-img" src="' + logoUrl + '" alt="lily pad" draggable="false"\n' +
'      style="width:86%;max-width:389px;height:auto;cursor:grab;user-select:none;-webkit-user-select:none;will-change:transform;transition:transform .55s cubic-bezier(.34,1.56,.64,1)">\n' +
'  </div>\n' +
'  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 32px 80px;text-align:center">\n' +
'    <h1 style="font-size:26px;font-weight:800;color:#fff;margin:0 0 10px;letter-spacing:-.02em;line-height:1.3">Coming to Houston Soon.</h1>\n' +
'    <p style="font-size:15px;font-weight:400;color:rgba(255,255,255,.75);margin:0 0 28px;letter-spacing:-.01em">Start Earning. Start Parking.</p>\n' +
'    <button class="green-btn" onclick="showForm()">Join the Pre-Launch</button>\n' +
'  </div>\n' +
'</div>\n' +

// ── FORM ─────────────────────────────────────────────────────────────────────
'<div id="s-form" class="screen hidden">\n' +
'  <div style="flex-shrink:0;overflow:hidden;height:200px;position:relative">\n' +
'    <img src="' + logoUrl + '" alt="lily pad"\n' +
'      style="width:160%;max-width:700px;height:auto;position:absolute;left:50%;top:50%;transform:translate(-50%,-46%);pointer-events:none">\n' +
'    <button onclick="stepBack()" style="position:absolute;top:18px;left:18px;background:rgba(255,255,255,.10);border:none;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font-size:16px;font-family:inherit">\u2190</button>\n' +
'  </div>\n' +
'  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 28px 16px;width:100%">\n' +
'    <div id="q-card" class="animate" style="width:100%;max-width:400px;display:flex;flex-direction:column;align-items:center;text-align:center">\n' +
'      <p id="q-step" style="font-size:10px;font-weight:400;letter-spacing:.18em;color:rgba(255,255,255,.30);text-transform:uppercase;margin:0 0 14px"></p>\n' +
'      <p id="q-text" style="font-size:24px;font-weight:200;color:#fff;line-height:1.3;margin:0 0 28px;letter-spacing:-.01em"></p>\n' +
'      <div id="q-role" style="display:none;flex-direction:column;align-items:center;gap:10px;width:100%">\n' +
'        <div style="display:flex;gap:10px">\n' +
'          <button class="role-btn" id="btn-driver" onclick="toggleRole(\'driver\')">Driver</button>\n' +
'          <button class="role-btn" id="btn-host" onclick="toggleRole(\'host\')">Host</button>\n' +
'        </div>\n' +
'        <p style="font-size:11.5px;color:rgba(255,255,255,.32);margin:0;font-style:italic">You can select both!</p>\n' +
'      </div>\n' +
'      <div id="q-input" style="display:none;width:100%">\n' +
'        <input id="the-input" class="pill-input" autocomplete="off"\n' +
'          oninput="onInput()" onkeydown="if(event.key===\'Enter\')advance()">\n' +
'        <div id="pw-reqs" style="display:none;margin-top:14px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);text-align:left">\n' +
'          <div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.28);letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px">Password must include</div>\n' +
'          <div id="pw-list" style="display:flex;flex-direction:column;gap:7px"></div>\n' +
'        </div>\n' +
'      </div>\n' +
'      <p id="q-error" style="font-size:12.5px;color:#ff7070;font-weight:600;margin:10px 0 0;min-height:18px"></p>\n' +
'      <div id="q-cta" style="width:100%;padding-top:18px;animation:fade-in .18s ease both">\n' +
'        <button class="continue-btn" id="continue-btn" onclick="advance()">Continue</button>\n' +
'      </div>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +

// ── THANKS ───────────────────────────────────────────────────────────────────
'<div id="s-thanks" class="screen hidden">\n' +
'  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:0 32px">\n' +
'    <img src="' + logoUrl + '" alt="lily pad" style="width:175px;height:auto">\n' +
'    <div style="width:60px;height:60px;border-radius:50%;background:rgba(141,214,63,.11);display:flex;align-items:center;justify-content:center">\n' +
'      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>\n' +
'    </div>\n' +
'    <div style="text-align:center">\n' +
'      <h1 style="font-size:26px;font-weight:800;color:#fff;margin:0 0 10px;letter-spacing:-.03em;line-height:1.2">You\'re on the list!</h1>\n' +
'      <p style="font-size:14.5px;color:rgba(255,255,255,.50);margin:0;line-height:1.65;max-width:300px">We\'ll reach out as soon as your lily pad account is ready.</p>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +

'</div>\n' + // #app

'<script>\n' +
'var QUESTIONS=[{id:"role",text:"I\'m signing up as a\u2026",type:"role"},{id:"name",text:"What\'s your name?",type:"text",ph:"Full name"},{id:"phone",text:"Your phone number?",type:"tel",ph:"(555) 000-0000"},{id:"email",text:"What\'s your email?",type:"email",ph:"you@email.com"},{id:"password",text:"Create a password.",type:"password",ph:"Create a strong password"}];\n' +
'var cur=0,ans={},roles=new Set(),loading=false;\n' +
'function show(id){["s-welcome","s-form","s-thanks"].forEach(function(s){var el=document.getElementById(s);el.classList.toggle("hidden",s!==id);});}\n' +
'function showForm(){show("s-form");renderQ();}\n' +
'function showThanks(){show("s-thanks");}\n' +
'function stepBack(){if(cur===0){show("s-welcome");}else{cur--;renderQ();}}\n' +
'function renderQ(){\n' +
'  var q=QUESTIONS[cur];\n' +
'  document.getElementById("q-step").textContent=(cur+1)+" of "+QUESTIONS.length;\n' +
'  document.getElementById("q-text").textContent=q.text;\n' +
'  document.getElementById("q-error").textContent="";\n' +
'  var card=document.getElementById("q-card");card.classList.remove("animate");void card.offsetWidth;card.classList.add("animate");\n' +
'  var isRole=q.type==="role",isInput=q.type!=="role";\n' +
'  document.getElementById("q-role").style.display=isRole?"flex":"none";\n' +
'  document.getElementById("q-input").style.display=isInput?"block":"none";\n' +
'  if(isInput){\n' +
'    var inp=document.getElementById("the-input");\n' +
'    inp.type=q.type==="tel"?"tel":q.type==="email"?"email":q.type==="password"?"password":"text";\n' +
'    inp.placeholder=q.ph||"";\n' +
'    inp.autocomplete=q.type==="password"?"new-password":q.type==="email"?"email":q.type==="tel"?"tel":"name";\n' +
'    if(q.type==="password"){inp.value="";}else{inp.value=ans[q.id]||"";}\n' +
'    document.getElementById("pw-reqs").style.display="none";\n' +
'    setTimeout(function(){inp.focus();},60);\n' +
'  }\n' +
'  updateCta();\n' +
'}\n' +
'function toggleRole(id){\n' +
'  if(roles.has(id))roles.delete(id);else roles.add(id);\n' +
'  document.getElementById("btn-driver").classList.toggle("on",roles.has("driver"));\n' +
'  document.getElementById("btn-host").classList.toggle("on",roles.has("host"));\n' +
'  document.getElementById("q-error").textContent="";\n' +
'  updateCta();\n' +
'}\n' +
'function onInput(){\n' +
'  document.getElementById("q-error").textContent="";\n' +
'  var q=QUESTIONS[cur];\n' +
'  if(q.type==="password"){\n' +
'    var val=document.getElementById("the-input").value;\n' +
'    if(val.length>0){showPwReqs(val);}else{document.getElementById("pw-reqs").style.display="none";}\n' +
'  }\n' +
'  updateCta();\n' +
'}\n' +
'function updateCta(){\n' +
'  var q=QUESTIONS[cur],btn=document.getElementById("continue-btn"),can=false;\n' +
'  if(q.type==="role"){can=roles.size>0;}\n' +
'  else if(q.type==="password"){var v=document.getElementById("the-input").value;can=v.length>0&&validatePw(v,ans["email"]||"",ans["name"]||"").allValid;}\n' +
'  else{can=(document.getElementById("the-input").value.trim().length>0);}\n' +
'  btn.disabled=!can;\n' +
'  btn.textContent=cur===QUESTIONS.length-1?(loading?"Joining\u2026":"Join the Pre-Launch"):"Continue";\n' +
'}\n' +
'function validatePw(pw,email,name){\n' +
'  var length=pw.length>=8,capital=/[A-Z]/.test(pw),number=/[0-9]/.test(pw);\n' +
'  var lp=pw.toLowerCase(),fn=(name.split(" ")[0]||"").toLowerCase(),ln=(name.split(" ").slice(1).join(" ")||"").toLowerCase(),em=email.toLowerCase();\n' +
'  var notIdentity=!(lp.includes(fn)&&fn.length>1)&&!(ln.length>1&&lp.includes(ln))&&!(em.length>1&&lp.includes(em.split("@")[0]));\n' +
'  return{length:length,capital:capital,number:number,notIdentity:notIdentity,allValid:length&&capital&&number&&notIdentity};\n' +
'}\n' +
'function showPwReqs(val){\n' +
'  var box=document.getElementById("pw-reqs"),list=document.getElementById("pw-list");\n' +
'  box.style.display="block";\n' +
'  var res=validatePw(val,ans["email"]||"",ans["name"]||"");\n' +
'  var rules=[{key:"length",label:"At least 8 characters"},{key:"capital",label:"1 capital letter (A-Z)"},{key:"number",label:"1 number (0-9)"},{key:"notIdentity",label:"Not your name or email"}];\n' +
'  list.innerHTML=rules.map(function(r){\n' +
'    var ok=res[r.key];\n' +
'    return \'<div style="display:flex;align-items:center;gap:8px"><div style="width:16px;height:16px;border-radius:50%;flex-shrink:0;background:\'+( ok?"#8DD63F":"rgba(255,255,255,.10)")+\';display:flex;align-items:center;justify-content:center">\'+(ok?\'<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0E1F40" stroke-width="3.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>\':\'<div style="width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,.35)"></div>\')+\'</div><span style="font-size:12.5px;font-weight:\'+(ok?"600":"400")+\';color:\'+(ok?"#fff":"rgba(255,255,255,.45)")+\'">\'+ r.label +\'</span></div>\';\n' +
'  }).join("");\n' +
'}\n' +
'function advance(){\n' +
'  if(loading)return;\n' +
'  var q=QUESTIONS[cur],err="";\n' +
'  if(q.type==="role"){if(roles.size===0){err="Please select at least one.";}else{var arr=Array.from(roles);ans[q.id]=arr.length===2?"both":arr[0];}}\n' +
'  else{\n' +
'    var val=document.getElementById("the-input").value.trim();\n' +
'    if(!val){err="This field is required.";}\n' +
'    else if(q.type==="email"&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(val)){err="Please enter a valid email address.";}\n' +
'    else if(q.type==="password"&&!validatePw(val,ans["email"]||"",ans["name"]||"").allValid){err="Password doesn\'t meet the requirements.";}\n' +
'    else if(q.type==="tel"&&val.replace(/\\D/g,"").length<10){err="Please enter a valid phone number.";}\n' +
'    else{ans[q.id]=val;}\n' +
'  }\n' +
'  if(err){document.getElementById("q-error").textContent=err;return;}\n' +
'  var next=cur+1;\n' +
'  if(next>=QUESTIONS.length){doSubmit();}else{cur=next;renderQ();}\n' +
'}\n' +
'async function doSubmit(){\n' +
'  loading=true;updateCta();\n' +
'  document.getElementById("q-error").textContent="";\n' +
'  try{\n' +
'    var res=await fetch("/api/early-access/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:ans["name"]||"",email:ans["email"]||"",password:ans["password"]||"",phone:ans["phone"]||"",role:ans["role"]||"driver"})});\n' +
'    var data=await res.json();\n' +
'    if(!res.ok){document.getElementById("q-error").textContent=data.error||"Something went wrong. Try again.";loading=false;updateCta();return;}\n' +
'    showThanks();\n' +
'  }catch(e){\n' +
'    document.getElementById("q-error").textContent="Network error. Please try again.";\n' +
'    loading=false;updateCta();\n' +
'  }\n' +
'}\n' +
// Drag-to-admin: tap logo 7 times quickly
'var _tapCount=0,_tapTimer=null;\n' +
'document.getElementById("logo-img").addEventListener("click",function(){\n' +
'  _tapCount++;clearTimeout(_tapTimer);\n' +
'  _tapTimer=setTimeout(function(){_tapCount=0;},1800);\n' +
'  if(_tapCount>=7){window.location.href="/admin";}\n' +
'});\n' +
'// drag-to-admin gesture on logo\n' +
'(function(){\n' +
'  var img=document.getElementById("logo-img"),startX=0,active=false,THRESH=150;\n' +
'  function getX(e){return e.touches?e.touches[0].clientX:e.clientX;}\n' +
'  img.addEventListener("mousedown",function(e){e.preventDefault();startX=e.clientX;active=true;img.style.cursor="grabbing";});\n' +
'  img.addEventListener("touchstart",function(e){startX=e.touches[0].clientX;active=true;},{passive:true});\n' +
'  window.addEventListener("mousemove",function(e){if(!active)return;var d=Math.min(Math.max(0,e.clientX-startX),THRESH+16);img.style.transition="none";img.style.transform="translateX("+d+"px)";if(d>=THRESH){img.style.filter="drop-shadow(0 0 22px #8DD63F) drop-shadow(0 0 8px #8DD63FAA)";}else{img.style.filter="none";}},{passive:true});\n' +
'  window.addEventListener("touchmove",function(e){if(!active)return;var d=Math.min(Math.max(0,e.touches[0].clientX-startX),THRESH+16);img.style.transition="none";img.style.transform="translateX("+d+"px)";if(d>=THRESH){img.style.filter="drop-shadow(0 0 22px #8DD63F)";}else{img.style.filter="none";}},{passive:true});\n' +
'  function end(){if(!active)return;active=false;img.style.cursor="grab";\n' +
'    var cur=parseFloat(img.style.transform.replace("translateX(","").replace("px)",""))||0;\n' +
'    if(cur>=THRESH){setTimeout(function(){window.location.href="/admin";},200);}else{img.style.transition="transform .55s cubic-bezier(.34,1.56,.64,1)";img.style.transform="translateX(0px)";img.style.filter="none";}\n' +
'  }\n' +
'  window.addEventListener("mouseup",end);\n' +
'  window.addEventListener("touchend",end);\n' +
'  window.addEventListener("touchcancel",end);\n' +
'})();\n' +
'</script>\n' +
'</body>\n' +
'</html>';
}

// ── SPA fallback — serve React app for all unmatched routes ──────────────────
app.get('*', (req, res) => {
  const noCacheHeaders = () => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  const indexHtml = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    return res.status(503).send('<h1>Building\u2026</h1><p>Restart once <code>npm run build</code> completes.</p>');
  }
  try {
    const html = fs.readFileSync(indexHtml, 'utf8');
    noCacheHeaders();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch {
    res.status(503).send('<h1>App loading\u2026</h1><p>Please refresh in a moment.</p>');
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[LP] Lily Pad server v2 running on port ${PORT}`);
  await checkDB();
  await ensureStorageBucket();
});
