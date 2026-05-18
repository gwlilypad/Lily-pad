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

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS spend_total NUMERIC DEFAULT 0;

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

// ── Check DB schema on startup ────────────────────────────────────────────────
async function checkDB() {
  if (!SVC_KEY) { console.warn('[DB] SUPABASE_SERVICE_ROLE_KEY missing'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?limit=1`, { headers: SVC_HEADERS });
    if (res.ok || res.status === 406) {
      console.log('[DB] profiles table ✓');
      return;
    }
    const body = await res.text();
    if (res.status === 404 || body.includes('does not exist') || body.includes('PGRST')) {
      console.log('\n[DB] ⚠️  Tables not found. Paste this into Supabase → SQL Editor:\n');
      console.log(SETUP_SQL);
      console.log('\n[DB] Then restart the server. (Visit /setup to see the SQL again.)\n');
    } else {
      console.warn('[DB] Unexpected response:', res.status, body.slice(0, 200));
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

// ── Staff/admin invite — send Supabase magic invite link to approved email ──────
app.post('/api/staff/invite', async (req, res) => {
  if (!SVC_KEY) return res.status(500).json({ error: 'Service key not configured' });
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const emailLower = email.toLowerCase().trim();

  if (ADMIN_EMAILS.length === 0)
    return res.status(403).json({ error: 'No staff emails configured. Contact your system administrator.' });
  if (!ADMIN_EMAILS.includes(emailLower))
    return res.status(403).json({ error: 'This email is not on the approved staff list.' });

  try {
    const now = new Date().toISOString();
    // Build redirect URL — prefer the stable Replit public domain, fall back to Host header
    const redirectTo = process.env.SITE_URL
      ? `${process.env.SITE_URL.replace(/\/$/, '')}/staff-login`
      : `https://${process.env.REPLIT_DEV_DOMAIN || req.get('host') || ''}/staff-login`;

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

// ── Staff/admin set-password — called after clicking invite link ───────────────
// The invite link lands on /staff-login with access_token in the URL hash.
// The client sends that token here; we set the password and return the user.
app.post('/api/staff/set-password', async (req, res) => {
  const { access_token, password } = req.body || {};
  if (!access_token || !password) return res.status(400).json({ error: 'access_token and password required' });
  if (password.length < 8)            return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!/[A-Z]/.test(password))        return res.status(400).json({ error: 'Password must include at least one uppercase letter.' });
  if (!/[a-z]/.test(password))        return res.status(400).json({ error: 'Password must include at least one lowercase letter.' });
  if (!/[0-9]/.test(password))        return res.status(400).json({ error: 'Password must include at least one number.' });
  if (!/[^A-Za-z0-9]/.test(password)) return res.status(400).json({ error: 'Password must include at least one special character.' });
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

    // Verify the user is in admin_users
    const adminRes = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(emailLower)}&select=role`,
      { headers: SVC_HEADERS }
    );
    const adminRows = await adminRes.json();
    if (!adminRes.ok || !Array.isArray(adminRows) || !adminRows.length)
      return res.status(403).json({ error: 'Not authorized as staff. Contact your administrator.' });

    const role = adminRows[0].role || 'staff';
    // Update last login timestamp
    fetch(`${SUPABASE_URL}/rest/v1/admin_users?email=eq.${encodeURIComponent(emailLower)}`,
      { method: 'PATCH', headers: SVC_HEADERS, body: JSON.stringify({ last_login_at: new Date().toISOString() }) }
    ).catch(() => {});

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

// ── Main page ──────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const authJS      = fs.readFileSync(path.join(__dirname, 'auth.js'),           'utf8');
  const authCSS     = fs.readFileSync(path.join(__dirname, 'auth.css'),          'utf8');
  const authOverlay = fs.readFileSync(path.join(__dirname, 'auth-overlay.html'), 'utf8');

  const headInjection = `
  <style id="lily-auth-css">${authCSS}</style>
  <style id="lily-overrides">
    .home-icon-btn { display: none !important; }
  </style>
  <script>
    window.__SUPABASE_URL__      = "${SUPABASE_URL}";
    window.__SUPABASE_ANON_KEY__ = "${SUPABASE_ANON}";
  </script>`;

  // Bake credentials directly into auth.js — no window variable dependency
  const authJSFinal = authJS
    .replace(/%%SUPABASE_URL%%/g,      SUPABASE_URL)
    .replace(/%%SUPABASE_ANON_KEY%%/g, SUPABASE_ANON);

  html = html.replace('</head>',             () => `${headInjection}</head>`);
  html = html.replace('<div id="root"></div>', () => `${authOverlay}<div id="root"></div>`);
  html = html.replace('</body>',             () => `<script>${authJSFinal}</script></body>`);

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Surrogate-Control', 'no-store');
  res.send(html);
});

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Lily Pad server running on port ${PORT}`);
  await checkDB();
});
