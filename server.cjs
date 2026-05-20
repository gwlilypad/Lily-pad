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

const SVC_HEADERS = {
  'apikey'       : SVC_KEY,
  'Authorization': `Bearer ${SVC_KEY}`,
  'Content-Type' : 'application/json',
};

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
      // Always run safe column additions (idempotent)
      await runSQL(`ALTER TABLE public.spots ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '';`);
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

// ── Auth: customer signup — always uses standard flow so Supabase sends confirmation email ──
// Enable "Confirm email" in Supabase → Authentication → Providers → Email for this to require
// email verification. If confirmation is off in the dashboard the user is signed in immediately.
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, full_name, account_type } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        email, password,
        data: { full_name: full_name || '', account_type: account_type || 'renter' },
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data.error_description || data.message || data.msg || JSON.stringify(data);
      return res.status(r.status).json({ error: msg });
    }

    // Create/upsert profile row immediately (user.id is available even before confirmation)
    if (data.user && data.user.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method : 'POST',
        headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body   : JSON.stringify({
          id: data.user.id, email, full_name: full_name || '',
          account_type: account_type || 'renter',
        }),
      }).catch(() => {});
    }

    // Supabase returned a session → email confirmation is OFF in dashboard, sign in now
    if (data.access_token) return res.json({ created: true, session: data });

    // No session → confirmation email was sent; client should show "check your email"
    return res.json({ created: true, session: null, confirm_email: true });
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
        from   : 'Lily Pad <onboarding@resend.dev>',
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

// ── Spots: list all active pads ───────────────────────────────────────────────
app.get('/api/spots', async (req, res) => {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/spots?status=eq.active&select=*`,
      { headers: SVC_HEADERS }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json(Array.isArray(data) ? data : []);
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

// ── Spots: create a new pad listing ───────────────────────────────────────────
app.post('/api/spots', async (req, res) => {
  const { host_user_id, address, pad_type, surface, num_pads, price_per_hr, description, photo_url } = req.body || {};
  if (!host_user_id || !address) return res.status(400).json({ error: 'host_user_id and address required' });

  // Geocode the address using Nominatim
  let lat = 29.7604, lng = -95.3698;
  try {
    const geo = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address + ', Houston, TX')}`,
      { headers: { 'User-Agent': 'LilyPadApp/1.0' } }
    );
    const geoData = await geo.json();
    if (Array.isArray(geoData) && geoData.length > 0) {
      lat = parseFloat(geoData[0].lat);
      lng = parseFloat(geoData[0].lon);
    }
  } catch { /* use city center as fallback */ }

  try {
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
        description: description || '',
        photo_url: photo_url || '',
        lat, lng,
        status: 'active',
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json(Array.isArray(data) ? data[0] : data);
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
    res.json(r.ok ? data : []);
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
    const result = Array.isArray(profiles) ? profiles.map(p => ({ ...p, booking_count: counts[p.id] || 0 })) : [];
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
app.use(express.static(DIST));

// SPA fallback — all non-API routes serve the Vite-built index.html
app.get('*', (req, res) => {
  const indexHtml = path.join(DIST, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(503).send('<h1>Building…</h1><p>The app is being compiled. Restart the workflow once: <code>npm run build</code> completes.</p>');
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`[LP] Lily Pad server v2 running on port ${PORT}`);
  await checkDB();
  await ensureStorageBucket();
});
