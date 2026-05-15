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
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

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

ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings    ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles'    AND policyname='profiles_self')
    THEN CREATE POLICY profiles_self    ON public.profiles    FOR ALL USING (auth.uid() = id);         END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='saved_spots' AND policyname='saved_spots_self')
    THEN CREATE POLICY saved_spots_self ON public.saved_spots FOR ALL USING (auth.uid() = user_id);    END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bookings'    AND policyname='bookings_self')
    THEN CREATE POLICY bookings_self    ON public.bookings    FOR ALL USING (auth.uid() = user_id);    END IF;
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

  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
});

app.use(express.static(__dirname));

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Lily Pad server running on port ${PORT}`);
  await checkDB();
});
