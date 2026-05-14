(function () {
  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[Lily Pad Auth] Supabase config missing — auth gate disabled.');
    hideGate();
    return;
  }

  const HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };

  function getSession() {
    try {
      const raw = localStorage.getItem('lily_pad_session');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveSession(session) {
    localStorage.setItem('lily_pad_session', JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem('lily_pad_session');
  }

  async function signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign in failed.');
    saveSession(data);
    return data;
  }

  async function signUp(email, password, fullName) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        email,
        password,
        data: { full_name: fullName },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign up failed.');
    if (data.access_token) saveSession(data);
    return data;
  }

  async function sendPasswordReset(email) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error_description || data.msg || 'Reset request failed.');
    }
  }

  async function refreshSession(refreshToken) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    saveSession(data);
    return data;
  }

  // ── Navigate to map after auth ───────────────────────────────────────────
  function navigateToMap() {
    const root = document.getElementById('root');
    // Keep root invisible during navigation to avoid landing-page flash
    if (root) root.style.opacity = '0';

    let attempts = 0;
    const maxAttempts = 40; // 4 seconds total

    const tryClick = () => {
      attempts++;
      const buttons = Array.from(document.querySelectorAll('button'));
      const findBtn = buttons.find(b => b.textContent.trim() === 'Find a pad');
      if (findBtn) {
        findBtn.click();
        setTimeout(() => {
          if (root) root.style.opacity = '1';
        }, 80);
        return;
      }
      if (attempts < maxAttempts) {
        setTimeout(tryClick, 100);
      } else {
        // Fallback: just reveal the app as-is
        if (root) root.style.opacity = '1';
      }
    };

    setTimeout(tryClick, 150);
  }

  // ── Wire existing app Sign Out to clear Supabase session ─────────────────
  function wireSignOut() {
    document.addEventListener('click', function (e) {
      const row = e.target.closest('.thumb-nav-row');
      if (row && row.textContent.includes('Sign out')) {
        clearSession();
        setTimeout(() => location.reload(), 120);
      }
    }, true);
  }

  // ── Called on every successful auth (login, token refresh, new session) ──
  function afterAuth() {
    hideGate();
    navigateToMap();
    wireSignOut();
  }

  function hideGate() {
    const gate = document.getElementById('auth-gate');
    if (!gate) return;
    gate.classList.add('hiding');
    setTimeout(() => gate.classList.add('hidden'), 420);
  }

  function showForm(id) {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    clearErrors();
  }

  function clearErrors() {
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

  async function init() {
    // Check for existing valid session first
    const session = getSession();
    if (session) {
      const expiry = session.expires_at || 0;
      const nowSec = Date.now() / 1000;
      if (expiry > nowSec + 60) {
        afterAuth();
        return;
      }
      if (session.refresh_token) {
        const refreshed = await refreshSession(session.refresh_token).catch(() => null);
        if (refreshed) {
          afterAuth();
          return;
        }
      }
      clearSession();
    }

    // No valid session — show auth gate
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const forgotBtn = document.getElementById('forgot-btn');
    loginBtn.dataset.label = 'Sign in';
    signupBtn.dataset.label = 'Create account';
    forgotBtn.dataset.label = 'Send reset link';

    document.getElementById('goto-signup').addEventListener('click', () => showForm('form-signup'));
    document.getElementById('goto-login').addEventListener('click', () => showForm('form-login'));
    document.getElementById('goto-forgot').addEventListener('click', () => showForm('form-forgot'));
    document.getElementById('back-to-login').addEventListener('click', () => showForm('form-login'));

    document.getElementById('login-form').addEventListener('submit', async () => {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) { setError('login-error', 'Please enter your email and password.'); return; }
      clearErrors();
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

    document.getElementById('signup-form').addEventListener('submit', async () => {
      const name = document.getElementById('signup-name').value.trim();
      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      if (!name) { setError('signup-error', 'Please enter your full name.'); return; }
      if (!email) { setError('signup-error', 'Please enter your email address.'); return; }
      if (!password || password.length < 6) { setError('signup-error', 'Password must be at least 6 characters.'); return; }
      clearErrors();
      setLoading(signupBtn, true);
      try {
        const result = await signUp(email, password, name);
        if (result.access_token) {
          afterAuth();
        } else if (result.id) {
          // Email confirmation required — stay on form, show message
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

    document.getElementById('forgot-form').addEventListener('submit', async () => {
      const email = document.getElementById('forgot-email').value.trim();
      if (!email) { setError('forgot-error', 'Please enter your email address.'); return; }
      clearErrors();
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
