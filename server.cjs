const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 5000;

const SUPABASE_URL  = 'https://mcfxoimaqgpyntvasbsw.supabase.co';
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY    || '';
const SVC_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY  || '';

// Comma-separated list of emails allowed to register as staff/admin
// Set this in Replit Secrets as ADMIN_EMAILS=alice@co.com,bob@co.com
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const EARLY_ACCESS = (process.env.EARLY_ACCESS || '').toLowerCase() === 'true';

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

// ── Public config — exposes non-secret feature flags to the frontend ──────────
app.get('/api/config', (req, res) => {
  res.json({ earlyAccess: EARLY_ACCESS });
});

// ── Health check — shows masked key status ────────────────────────────────────
app.get('/api/health', (req, res) => {
  let svcRole = 'missing';
  let anonOk  = !!SUPABASE_ANON;
  try {
    const p = JSON.parse(Buffer.from(SVC_KEY.split('.')[1], 'base64url').toString());
    svcRole = p.role;
  } catch {}
  res.json({
    ok: true,
    anon_key_set: anonOk,
    anon_key_len: SUPABASE_ANON.length,
    svc_role: svcRole,
    supabase_url: SUPABASE_URL,
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

// ── Early access signup ───────────────────────────────────────────────────────
app.post('/api/early-access/signup', async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'name, email and password required' });
  const emailLower = email.toLowerCase().trim();
  try {
    // Create Supabase auth user (pre-confirmed, no SMTP needed)
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method : 'POST',
      headers: { 'apikey': SVC_KEY, 'Authorization': `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        email: emailLower, password,
        email_confirm: true,
        user_metadata: { full_name: name, account_type: role || 'driver' },
      }),
    });
    const authData = await authRes.json();
    if (!authRes.ok) {
      const msg = authData.error_description || authData.message || JSON.stringify(authData);
      return res.status(authRes.status).json({ error: msg });
    }
    const userId = authData.id;

    // Upsert profile row
    if (userId) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method : 'POST',
        headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body   : JSON.stringify({ id: userId, email: emailLower, full_name: name, account_type: role || 'driver' }),
      }).catch(() => {});
    }

    // Insert early_access_signups row
    await fetch(`${SUPABASE_URL}/rest/v1/early_access_signups`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
      body   : JSON.stringify({ name, email: emailLower, role: role || 'driver', user_id: userId || null, status: 'pending' }),
    }).catch(() => {});

    res.json({ ok: true, userId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: list early access signups ─────────────────────────────────────────
app.get('/api/admin/early-access-signups', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/early_access_signups?order=submitted_at.desc&limit=500`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    if (!r.ok) {
      const isTableMissing = JSON.stringify(data).includes('PGRST205') || JSON.stringify(data).includes('does not exist');
      // Return tableReady=false so admin UI can show setup instructions
      if (isTableMissing) return res.json({ signups: [], tableReady: false });
      return res.status(r.status).json({ error: JSON.stringify(data) });
    }
    res.json({ signups: Array.isArray(data) ? data : [], tableReady: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: update early access signup (approve / add notes) ───────────────────
app.patch('/api/admin/early-access-signups/:id', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { id } = req.params;
  const { status, notes } = req.body || {};
  const patch = {};
  if (status !== undefined) patch.status = status;
  if (notes  !== undefined) patch.notes  = notes;
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to update' });
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/early_access_signups?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' }, body: JSON.stringify(patch) }
    );
    if (!r.ok) { const d = await r.text(); return res.status(r.status).json({ error: d }); }
    res.json({ ok: true });
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

// ── Staff list — returns all admin_users rows mapped to StaffAccount shape ────
app.get('/api/staff/list', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/admin_users?select=id,email,full_name,role,status,last_login_at&order=created_at.asc`, { headers: SVC_HEADERS });
    const rows = await r.json();
    if (!Array.isArray(rows)) return res.json([]);
    const list = rows.map(row => ({
      id: row.id,
      name: row.full_name || row.email,
      email: row.email,
      role: row.role || 'staff',
      status: row.status || 'active',
      lastSignIn: row.last_login_at ? new Date(row.last_login_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never',
    }));
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Staff update-status — PATCH admin_users status by id ─────────────────────
app.post('/api/staff/update-status', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { id, status } = req.body || {};
  if (!id || !status) return res.status(400).json({ error: 'id and status required' });
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/admin_users?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status }),
    });
    res.json({ updated: true });
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
      let photo_url = '', descText = s.description || '', photo_urls = [], services = [];
      try {
        const parsed = JSON.parse(s.description || '{}');
        if (parsed && typeof parsed === 'object') {
          photo_url  = parsed.photo_url  || '';
          descText   = parsed.text       || '';
          photo_urls = Array.isArray(parsed.photo_urls) ? parsed.photo_urls : (photo_url ? [photo_url] : []);
          services   = Array.isArray(parsed.services)   ? parsed.services   : [];
        }
      } catch { /* plain-text description — legacy row */ }
      if (!photo_urls.length && photo_url) photo_urls = [photo_url];
      return {
        ...s,
        description: descText,
        photo_url,
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

// ── Helper: find a globally-unique spot_name starting from baseName ──────────
async function findUniquePadName(baseName) {
  let name = baseName;
  let attempt = 1;
  while (true) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/spots?spot_name=ilike.${encodeURIComponent(name)}&select=id&limit=1`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return name;
    attempt++;
    name = `${baseName} ${attempt}`;
    if (attempt > 999) return `${baseName} ${Date.now()}`; // safety
  }
}

// ── Spots: check whether a name is available (case-insensitive) ───────────────
app.get('/api/spots/check-name', async (req, res) => {
  const { name, excludeId } = req.query;
  if (!name || !String(name).trim()) return res.json({ available: false });
  try {
    let url = `${SUPABASE_URL}/rest/v1/spots?spot_name=ilike.${encodeURIComponent(String(name).trim())}&select=id&limit=1`;
    if (excludeId) url += `&id=neq.${excludeId}`;
    const r = await fetch(url, { headers: SVC_HEADERS });
    const data = await r.json();
    res.json({ available: Array.isArray(data) && data.length === 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    const descPayload = JSON.stringify({ text: description || '', photo_url: allUrls[0] || '', photo_urls: allUrls });
    // Assign a globally-unique pad name
    const assignedName = await findUniquePadName(rawSpotName?.trim() || 'My Lily Pad');
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
        spot_name: assignedName,
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
      `${SUPABASE_URL}/rest/v1/spots?id=eq.${id}&select=description,status,price_per_hr,address,lat,lng`,
      { headers: SVC_HEADERS }
    );
    const curData = await cur.json();
    const existing = Array.isArray(curData) ? curData[0] : curData;

    // Parse existing description JSON (may be plain text for legacy rows)
    let descObj = { text: '', photo_url: '', photo_urls: [], services: [] };
    try {
      const p = JSON.parse(existing?.description || '{}');
      if (p && typeof p === 'object') descObj = {
        text: p.text || '',
        photo_url: p.photo_url || '',
        photo_urls: Array.isArray(p.photo_urls) ? p.photo_urls : [],
        services: Array.isArray(p.services) ? p.services : [],
      };
    } catch { descObj.text = existing?.description || ''; }

    // Merge changes — all stored inside description JSON blob
    if ('photo_url'   in body) descObj.photo_url  = body.photo_url;
    if ('photo_urls'  in body) descObj.photo_urls  = body.photo_urls;
    if ('description' in body) descObj.text        = body.description;
    if ('services'    in body) descObj.services    = body.services;

    const patchFields = { description: JSON.stringify(descObj) };
    if ('status'       in body) patchFields.status       = body.status;
    if ('price_per_hr' in body) patchFields.price_per_hr = body.price_per_hr;
    if ('address'      in body) patchFields.address       = body.address;
    if ('lat'          in body) patchFields.lat           = body.lat;
    if ('lng'          in body) patchFields.lng           = body.lng;
    if ('spot_name'    in body) {
      const newName = String(body.spot_name || '').trim();
      if (newName) {
        // Uniqueness check (case-insensitive, exclude self)
        const chkR = await fetch(
          `${SUPABASE_URL}/rest/v1/spots?spot_name=ilike.${encodeURIComponent(newName)}&id=neq.${id}&select=id&limit=1`,
          { headers: SVC_HEADERS }
        );
        const chkData = await chkR.json();
        if (Array.isArray(chkData) && chkData.length > 0) {
          return res.status(409).json({ error: 'That pad name is already taken. Choose a different name.' });
        }
        patchFields.spot_name = newName;
      }
    }

    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/spots?id=eq.${id}`,
      { method: 'PATCH', headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' }, body: JSON.stringify(patchFields) }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    const row = Array.isArray(data) ? (data[0] || null) : data;
    // Decode response
    if (row) { try { const p = JSON.parse(row.description || '{}'); row.photo_url = p.photo_url || ''; row.description = p.text || ''; } catch {} }
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
      let photo_url = '', descText = s.description || '', photo_urls = [], services = [];
      try {
        const p = JSON.parse(s.description || '{}');
        if (p && typeof p === 'object') {
          photo_url  = p.photo_url  || '';
          descText   = p.text       || '';
          photo_urls = Array.isArray(p.photo_urls) ? p.photo_urls : (photo_url ? [photo_url] : []);
          services   = Array.isArray(p.services)   ? p.services   : [];
        }
      } catch {}
      if (!photo_urls.length && photo_url) photo_urls = [photo_url];
      return { ...s, description: descText, photo_url, photo_urls, services };
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
      let photo_url = '', descText = s.description || '', photo_urls = [];
      try {
        const p = JSON.parse(s.description || '{}');
        if (p && typeof p === 'object') {
          photo_url  = p.photo_url  || '';
          descText   = p.text       || '';
          photo_urls = Array.isArray(p.photo_urls) ? p.photo_urls : (photo_url ? [photo_url] : []);
        }
      } catch {}
      if (!photo_urls.length && photo_url) photo_urls = [photo_url];
      return { ...s, description: descText, photo_url, photo_urls, host_name: s.host?.full_name || '', host_email: s.host?.email || '' };
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

// ── Bookings: create (creates as 'pending' — lister must approve) ───────────────
app.post('/api/bookings', async (req, res) => {
  const { user_id, spot_id, start_ts, end_ts, price_per_hr, total_price, booking_data } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  try {
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
    };

    const r = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method : 'POST',
      headers: { ...SVC_HEADERS, 'Prefer': 'return=representation' },
      body   : JSON.stringify({
        user_id,
        spot_id: String(spot_id || ''),
        booking_data: data_payload,
        status: 'pending',
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });

    // Email lister about the new request (non-blocking)
    const addr   = booking_data?.addr || spot?.address || 'your spot';
    const dtOpts = { month: 'short', day: 'numeric' };
    const tmOpts = { hour: 'numeric', minute: '2-digit' };
    const dateStr = start_ts ? new Date(start_ts).toLocaleDateString('en-US', dtOpts) : '';
    const fromStr = start_ts ? new Date(start_ts).toLocaleTimeString('en-US', tmOpts) : '';
    const tillStr = end_ts   ? new Date(end_ts).toLocaleTimeString('en-US', tmOpts)   : '';
    const totalLabel = total_price ? `$${Number(total_price).toFixed(2)}` : '';
    sendEmail(listerEmail, 'New Booking Request — Lily Pad',
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#0E1F40;margin:0 0 8px">New booking request 🛏</h2>
        <p style="color:#555;margin:0 0 16px">Hi ${listerName},</p>
        <p style="color:#555;margin:0 0 20px"><strong>${driverName}</strong> has requested to book your spot.</p>
        <div style="background:#f5f7fa;border-radius:12px;padding:16px;margin-bottom:20px">
          <div style="font-size:13px;color:#0E1F40;margin-bottom:6px"><strong>📍 ${addr}</strong></div>
          <div style="font-size:13px;color:#555;margin-bottom:4px">📅 ${dateStr}</div>
          <div style="font-size:13px;color:#555;margin-bottom:4px">⏰ ${fromStr} → ${tillStr}</div>
          ${totalLabel ? `<div style="font-size:13px;color:#555"><strong>💰 ${totalLabel}</strong></div>` : ''}
        </div>
        <p style="color:#555;margin:0 0 20px">Log in to your Lily Pad account and open <strong>My Pads</strong> to approve or deny this request.</p>
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
    const spotRes  = await fetch(`${SUPABASE_URL}/rest/v1/spots?host_user_id=eq.${listerId}&select=id,address`, { headers: SVC_HEADERS });
    const spotData = await spotRes.json();
    if (!spotRes.ok || !Array.isArray(spotData) || spotData.length === 0) return res.json([]);
    const spotMap  = {};
    spotData.forEach(s => { spotMap[s.id] = s.address; });
    const ids = spotData.map(s => s.id).join(',');

    // 2. Fetch all bookings for those spots
    const bRes  = await fetch(`${SUPABASE_URL}/rest/v1/bookings?spot_id=in.(${ids})&select=*&order=created_at.desc`, { headers: SVC_HEADERS });
    const bData = await bRes.json();
    if (!bRes.ok || !Array.isArray(bData)) return res.json([]);

    const mapped = bData.map(b => {
      const bd = b.booking_data || {};
      return {
        id:           b.id,
        spot_id:      b.spot_id,
        spot_address: bd.addr || spotMap[b.spot_id] || '',
        driver_name:  bd.driver_name  || 'Driver',
        driver_email: bd.driver_email || null,
        start_ts:     bd.start_ts     || null,
        end_ts:       bd.end_ts       || null,
        price_per_hr: Number(bd.price_per_hr) || 0,
        total_price:  Number(bd.total_price)  || 0,
        pad_type:     bd.padType || 'Driveway',
        status:       b.status   || 'pending',
        created_at:   b.created_at,
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
      return {
        id:          b.id,
        user_id:     b.user_id,
        spot_id:     bd.spot_id || b.spot_id || '',
        addr:        bd.addr    || bd.address || '',
        city:        'Houston, TX',
        pad_type:    bd.padType || 'Driveway',
        host_name:   bd.hostName  || '',
        host_phone:  bd.hostPhone || '',
        start_ts:    bd.start_ts  || null,
        end_ts:      bd.end_ts    || null,
        price_per_hr: Number(bd.price_per_hr) || 0,
        total_price:  Number(bd.total_price)  || 0,
        status:      b.status || 'confirmed',
        created_at:  b.created_at,
      };
    });
    res.json(mapped);
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

// ── Staff login page ───────────────────────────────────────────────────────────
app.get('/staff-login', (req, res) => {
  res.sendFile(path.join(__dirname, 'staff-login.html'));
});

// ── Serve built React/Vite app ─────────────────────────────────────────────────
const DIST = path.join(__dirname, 'dist');
// index:false so index.html is NOT auto-served — the SPA fallback below
// injects window.__EARLY_ACCESS__ into every HTML response instead
app.use(express.static(DIST, { index: false }));

// SPA fallback — inject server-side flags into index.html so React reads them
// instantly (no async fetch needed, no race conditions)
app.get('*', (req, res) => {
  const indexHtml = path.join(DIST, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    return res.status(503).send('<h1>Building…</h1><p>The app is being compiled. Restart once <code>npm run build</code> completes.</p>');
  }
  try {
    let html = fs.readFileSync(indexHtml, 'utf8');
    const inject = `<script>window.__EARLY_ACCESS__=${EARLY_ACCESS ? 'true' : 'false'};</script>`;
    html = html.replace('</head>', inject + '\n</head>');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch {
    res.sendFile(indexHtml);
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[LP] Lily Pad server v2 running on port ${PORT}`);
  await checkDB();
  await ensureStorageBucket();
});
