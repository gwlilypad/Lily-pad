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

  function authHeader(token) {
    return { ...HEADERS, 'Authorization': `Bearer ${token}` };
  }

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
    if (data.access_token) {
      saveSession(data);
    }
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
    const session = getSession();
    if (session) {
      const expiry = session.expires_at || 0;
      const nowSec = Date.now() / 1000;
      if (expiry > nowSec + 60) {
        hideGate();
        return;
      }
      if (session.refresh_token) {
        const refreshed = await refreshSession(session.refresh_token).catch(() => null);
        if (refreshed) {
          hideGate();
          return;
        }
      }
      clearSession();
    }

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

    loginBtn.addEventListener('click', async () => {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) { setError('login-error', 'Please enter your email and password.'); return; }
      clearErrors();
      setLoading(loginBtn, true);
      try {
        await signIn(email, password);
        hideGate();
      } catch (err) {
        setError('login-error', err.message);
      } finally {
        setLoading(loginBtn, false);
      }
    });

    signupBtn.addEventListener('click', async () => {
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
          hideGate();
        } else {
          setSuccess('signup-error', 'Check your email to confirm your account, then sign in.');
          showForm('form-login');
        }
      } catch (err) {
        setError('signup-error', err.message);
      } finally {
        setLoading(signupBtn, false);
      }
    });

    forgotBtn.addEventListener('click', async () => {
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

    [
      ['login-email', 'login-password'],
      ['signup-name', 'signup-email', 'signup-password'],
      ['forgot-email'],
    ].forEach((fields, i) => {
      const btns = [loginBtn, signupBtn, forgotBtn];
      fields.forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => {
          if (e.key === 'Enter') btns[i].click();
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
