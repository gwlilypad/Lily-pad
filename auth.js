(function () {
  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[Lily Pad] Supabase config missing — auth gate disabled.');
    hideGate();
    return;
  }

  const HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };

  // ── Session helpers ──────────────────────────────────────────────────────
  function getSession() {
    try { return JSON.parse(localStorage.getItem('lily_pad_session') || 'null'); }
    catch { return null; }
  }
  function saveSession(s) { localStorage.setItem('lily_pad_session', JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem('lily_pad_session'); }

  // ── Supabase API ─────────────────────────────────────────────────────────
  async function signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed.');
    saveSession(data);
    return data;
  }

  async function signUp(email, password, fullName) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ email, password, data: { full_name: fullName } }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign up failed.');
    if (data.access_token) saveSession(data);
    return data;
  }

  async function sendPasswordReset(email) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error_description || data.msg || 'Reset failed.');
    }
  }

  async function refreshSession(token) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ refresh_token: token }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    saveSession(data);
    return data;
  }

  // ── Navigate to map after auth ───────────────────────────────────────────
  function navigateToMap() {
    const root = document.getElementById('root');
    if (root) root.style.opacity = '0';

    let attempts = 0;

    function tryNavigate() {
      attempts++;

      // Strategy 1: click the first tab in .tab-bar (the find/map tab)
      const tabBar = document.querySelector('.tab-bar');
      if (tabBar) {
        const firstTab = tabBar.querySelector('button');
        if (firstTab) {
          firstTab.click();
          setTimeout(() => { if (root) root.style.opacity = '1'; }, 100);
          console.log('[Lily Pad] Navigated to map via tab-bar');
          wireSignOut();
          return;
        }
      }

      // Strategy 2: find "Find a pad" button by text
      const buttons = Array.from(document.querySelectorAll('button'));
      const findBtn = buttons.find(b => b.textContent.trim() === 'Find a pad');
      if (findBtn) {
        findBtn.click();
        setTimeout(() => { if (root) root.style.opacity = '1'; }, 100);
        console.log('[Lily Pad] Navigated to map via Find a pad button');
        wireSignOut();
        return;
      }

      // Retry up to 5 seconds
      if (attempts < 50) {
        setTimeout(tryNavigate, 100);
      } else {
        // Fallback: show whatever state the app is in
        if (root) root.style.opacity = '1';
        console.warn('[Lily Pad] Could not navigate to map after 5s — showing app as-is');
        wireSignOut();
      }
    }

    // Start after a short delay to allow React to mount
    setTimeout(tryNavigate, 200);
  }

  // ── Intercept app's Sign Out to also clear Supabase session ─────────────
  function wireSignOut() {
    document.addEventListener('click', function (e) {
      const row = e.target.closest('.thumb-nav-row');
      if (row && row.textContent.includes('Sign out')) {
        clearSession();
        setTimeout(() => location.reload(), 120);
      }
    }, true);
  }

  // ── Auth gate UI helpers ─────────────────────────────────────────────────
  function hideGate() {
    const gate = document.getElementById('auth-gate');
    if (!gate) return;
    gate.classList.add('hiding');
    setTimeout(() => gate.classList.add('hidden'), 420);
  }

  function afterAuth() {
    hideGate();
    navigateToMap();
  }

  function showForm(id) {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    clearMsgs();
  }

  function clearMsgs() {
    document.querySelectorAll('.auth-error, .auth-success').forEach(el => el.textContent = '');
  }

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  }

  function setSuccess(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  }

  function setLoading(btn, loading) {
    btn.disabled = loading;
    btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
  }

  // ── Initialise ───────────────────────────────────────────────────────────
  async function init() {
    // Check existing session
    const session = getSession();
    if (session) {
      const nowSec = Date.now() / 1000;
      if ((session.expires_at || 0) > nowSec + 60) {
        afterAuth();
        return;
      }
      if (session.refresh_token) {
        const refreshed = await refreshSession(session.refresh_token).catch(() => null);
        if (refreshed) { afterAuth(); return; }
      }
      clearSession();
    }

    // Show auth forms
    const loginBtn  = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const forgotBtn = document.getElementById('forgot-btn');
    loginBtn.dataset.label  = 'Sign in';
    signupBtn.dataset.label = 'Create account';
    forgotBtn.dataset.label = 'Send reset link';

    document.getElementById('goto-signup').addEventListener('click', () => showForm('form-signup'));
    document.getElementById('goto-login').addEventListener('click',  () => showForm('form-login'));
    document.getElementById('goto-forgot').addEventListener('click', () => showForm('form-forgot'));
    document.getElementById('back-to-login').addEventListener('click', () => showForm('form-login'));

    // Login
    document.getElementById('login-form').addEventListener('submit', async () => {
      const email    = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) { setError('login-error', 'Please enter your email and password.'); return; }
      clearMsgs();
      setLoading(loginBtn, true);
      try {
        await signIn(email, password);
        afterAuth();
      } catch (err) {
        setError('login-error', err.message);
      } finally {
        setLoading(loginBtn, false);
      }
    });

    // Signup
    document.getElementById('signup-form').addEventListener('submit', async () => {
      const name     = document.getElementById('signup-name').value.trim();
      const email    = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      if (!name)                        { setError('signup-error', 'Please enter your full name.'); return; }
      if (!email)                       { setError('signup-error', 'Please enter your email address.'); return; }
      if (!password || password.length < 6) { setError('signup-error', 'Password must be at least 6 characters.'); return; }
      clearMsgs();
      setLoading(signupBtn, true);
      try {
        const result = await signUp(email, password, name);
        if (result.access_token) {
          afterAuth();
        } else if (result.id) {
          setSuccess('signup-success', 'Account created! Check your inbox to confirm your email, then sign in.');
          signupBtn.style.display = 'none';
        } else {
          setError('signup-error', 'Something went wrong. Please try again.');
        }
      } catch (err) {
        setError('signup-error', err.message);
      } finally {
        setLoading(signupBtn, false);
      }
    });

    // Forgot password
    document.getElementById('forgot-form').addEventListener('submit', async () => {
      const email = document.getElementById('forgot-email').value.trim();
      if (!email) { setError('forgot-error', 'Please enter your email address.'); return; }
      clearMsgs();
      setLoading(forgotBtn, true);
      try {
        await sendPasswordReset(email);
        setSuccess('forgot-success', 'Reset link sent! Check your inbox.');
      } catch (err) {
        setError('forgot-error', err.message);
      } finally {
        setLoading(forgotBtn, false);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
