const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 5000;

const SUPABASE_URL  = 'https://mcfxoimaqgpyntvasbsw.supabase.co';
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY    || '';
const SVC_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY  || '';

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

// ── Auth: signup — uses admin API when service role key is available ──────────
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, full_name, account_type } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  // Detect whether we have a real service role key (role=service_role in JWT)
  let hasServiceRole = false;
  try {
    const p = JSON.parse(Buffer.from(SVC_KEY.split('.')[1], 'base64url').toString());
    hasServiceRole = p.role === 'service_role';
  } catch {}

  try {
    if (hasServiceRole) {
      // ── Admin path: create confirmed user immediately, no email sent ──────
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method : 'POST',
        headers: SVC_HEADERS,
        body   : JSON.stringify({
          email, password,
          email_confirm: true,
          user_metadata: { full_name: full_name || '', account_type: account_type || 'renter' },
        }),
      });
      const user = await r.json();
      if (!r.ok) throw new Error(user.message || user.msg || JSON.stringify(user));

      // Sign in immediately
      const sr = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method : 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
        body   : JSON.stringify({ email, password }),
      });
      const session = await sr.json();

      // Create profile row
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method : 'POST',
        headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body   : JSON.stringify({ id: user.id, email, full_name: full_name || '', account_type: account_type || 'renter' }),
      });

      return res.json({ created: true, session: sr.ok ? session : null });
    }

    // ── Fallback: standard signup (email confirmation may be required) ──────
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method : 'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        email, password,
        data: { full_name: full_name || '', account_type: account_type || 'renter' },
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.message || JSON.stringify(data));

    // If Supabase returned a session (email confirmation is OFF in dashboard) log in now
    if (data.access_token) {
      // Try to save profile
      if (data.user) {
        await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
          method : 'POST',
          headers: { ...SVC_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body   : JSON.stringify({ id: data.user.id, email, full_name: full_name || '', account_type: account_type || 'renter' }),
        }).catch(() => {});
      }
      return res.json({ created: true, session: data });
    }

    // Email confirmation required
    return res.json({ created: true, session: null, confirm_email: true });
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
  if (!user_id && !user_email) return res.status(400).json({ error: 'user_id or user_email required' });
  try {
    const now = new Date().toISOString();
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
