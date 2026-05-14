(function () {
  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[Lily Pad] Supabase config missing.');
    hideGate();
    return;
  }

  const HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };

  // ── Session ──────────────────────────────────────────────────────────────
  function getSession() {
    try { return JSON.parse(localStorage.getItem('lily_pad_session') || 'null'); }
    catch { return null; }
  }
  function saveSession(s) { localStorage.setItem('lily_pad_session', JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem('lily_pad_session'); }

  // ── Supabase calls ───────────────────────────────────────────────────────
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

  async function signUp(email, password, fullName, role) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({ email, password, data: { full_name: fullName, account_type: role } }),
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

  async function getUserRole(accessToken) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { ...HEADERS, 'Authorization': `Bearer ${accessToken}` },
      });
      if (!res.ok) return 'renter';
      const profile = await res.json();
      return (profile.user_metadata && profile.user_metadata.account_type) || 'renter';
    } catch { return 'renter'; }
  }

  // ── Element hiding ────────────────────────────────────────────────────────
  // The landing toggle ("Renter"/"Driver") and top icon buttons have NO CSS classes —
  // they are pure inline-styled elements. We find them by text / inline dimensions.
  function hideUnwantedElements() {
    Array.from(document.querySelectorAll('button')).forEach(btn => {
      const text = btn.textContent.trim();
      const title = (btn.title || '').toLowerCase();

      // Hide the Renter/Driver toggle pill and its container
      if (text === 'Renter' || text === 'Driver') {
        hide(btn);
        hide(btn.parentElement);
      }

      // Hide 36×36 circular top-bar icon buttons (landing page nav/home icons)
      const w = parseInt(btn.style.width);
      const h = parseInt(btn.style.height);
      if (w === 36 && h === 36) {
        hide(btn);
        hide(btn.parentElement);
      }

      // Hide 44×44 map overlay home button (title="Back to home" / "Back to admin")
      // These are inline-styled with no class name — target by title attribute
      if (title.includes('back to home') || title.includes('back to admin')) {
        hide(btn);
      }
    });

    // Hide class-based home button (used inside step/booking flows)
    document.querySelectorAll('.home-icon-btn').forEach(hide);
  }

  function hide(el) {
    if (el) el.style.setProperty('display', 'none', 'important');
  }

  // ── Navigate to map after auth ────────────────────────────────────────────
  // The Renter/Driver toggle buttons call d("find") → go to map.
  // "Renter" button  → accountType:"renter"    (driver looking for parking)
  // "Driver" button  → accountType:"padRenter" (pad host)
  function navigateToMap(role) {
    // Target label: "Renter" for drivers, "Driver" for pad hosts
    const targetLabel = (role === 'padRenter') ? 'Driver' : 'Renter';
    let done = false;

    function tryClick() {
      if (done) return;
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === targetLabel);
      if (btn) {
        done = true;
        console.log('[Lily Pad] Clicking toggle "' + targetLabel + '" to navigate to map');
        hideUnwantedElements();   // hide immediately before click
        btn.click();
        hideUnwantedElements();   // hide again right after click
        startGuard();
        wireSignOut();
        return;
      }

      // Fallback: tab-bar first button
      const tab = document.querySelector('.tab-bar button');
      if (tab) {
        done = true;
        console.log('[Lily Pad] Navigating via tab-bar fallback');
        hideUnwantedElements();
        tab.click();
        hideUnwantedElements();
        startGuard();
        wireSignOut();
      }
    }

    // MutationObserver: fires when React renders into #root
    const root = document.getElementById('root');
    const obs = new MutationObserver(() => {
      tryClick();
      if (done) obs.disconnect();
    });
    if (root) obs.observe(root, { childList: true, subtree: true });

    // Polling as safety net (catches case where React already rendered)
    const poll = setInterval(() => {
      tryClick();
      if (done) clearInterval(poll);
    }, 80);

    // Hard timeout: give up after 8s and just show+guard the app
    setTimeout(() => {
      clearInterval(poll);
      obs.disconnect();
      if (!done) {
        done = true;
        console.warn('[Lily Pad] Navigation timeout — showing app as-is');
        hideUnwantedElements();
        startGuard();
        wireSignOut();
      }
    }, 8000);
  }

  // ── Persistent guard: re-hide after every React re-render ────────────────
  function startGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    const guard = new MutationObserver(() => hideUnwantedElements());
    guard.observe(root, { childList: true, subtree: true });
  }

  // ── Sign-out intercept ───────────────────────────────────────────────────
  function wireSignOut() {
    document.addEventListener('click', (e) => {
      const row = e.target.closest('.thumb-nav-row');
      if (row && row.textContent.includes('Sign out')) {
        clearSession();
        setTimeout(() => location.reload(), 120);
      }
    }, true);
  }

  // ── Gate ─────────────────────────────────────────────────────────────────
  function hideGate() {
    const gate = document.getElementById('auth-gate');
    if (!gate) return;
    gate.classList.add('hiding');
    setTimeout(() => gate.classList.add('hidden'), 420);
  }

  async function afterAuth(session) {
    hideGate();
    const role = session && session.access_token
      ? await getUserRole(session.access_token)
      : 'renter';
    navigateToMap(role);
  }

  // ── Auth forms ───────────────────────────────────────────────────────────
  function showForm(id) {
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    clearMsgs();
  }
  function clearMsgs() {
    document.querySelectorAll('.auth-error, .auth-success').forEach(el => el.textContent = '');
  }
  function setError(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
  function setSuccess(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
  function setLoading(btn, on) {
    btn.disabled = on;
    btn.textContent = on ? 'Please wait…' : btn.dataset.label;
  }

  async function init() {
    const session = getSession();
    if (session) {
      const nowSec = Date.now() / 1000;
      if ((session.expires_at || 0) > nowSec + 60) { afterAuth(session); return; }
      if (session.refresh_token) {
        const r = await refreshSession(session.refresh_token).catch(() => null);
        if (r) { afterAuth(r); return; }
      }
      clearSession();
    }

    // Wire role picker
    document.querySelectorAll('.role-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

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

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) { setError('login-error', 'Please enter your email and password.'); return; }
      clearMsgs(); setLoading(loginBtn, true);
      try { afterAuth(await signIn(email, password)); }
      catch (err) { setError('login-error', err.message); setLoading(loginBtn, false); }
    });

    document.getElementById('signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name     = document.getElementById('signup-name').value.trim();
      const email    = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const roleEl   = document.querySelector('.role-btn.active');
      const role     = roleEl ? roleEl.dataset.role : 'renter';
      if (!name)   { setError('signup-error', 'Please enter your full name.'); return; }
      if (!email)  { setError('signup-error', 'Please enter your email.'); return; }
      if (!password || password.length < 6) { setError('signup-error', 'Password must be at least 6 characters.'); return; }
      clearMsgs(); setLoading(signupBtn, true);
      try {
        const result = await signUp(email, password, name, role);
        if (result.access_token) { afterAuth(result); }
        else if (result.id) {
          setSuccess('signup-success', 'Check your inbox to confirm your email, then sign in.');
          signupBtn.style.display = 'none';
        } else { setError('signup-error', 'Something went wrong.'); setLoading(signupBtn, false); }
      } catch (err) { setError('signup-error', err.message); setLoading(signupBtn, false); }
    });

    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      if (!email) { setError('forgot-error', 'Please enter your email.'); return; }
      clearMsgs(); setLoading(forgotBtn, true);
      try { await sendPasswordReset(email); setSuccess('forgot-success', 'Reset link sent! Check your inbox.'); }
      catch (err) { setError('forgot-error', err.message); }
      finally { setLoading(forgotBtn, false); }
    });
  }

  // Debug bypass: skip auth and go straight to map
  if (window.__LP_DEBUG__) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        hideGate();
        navigateToMap('renter');
      });
    } else {
      hideGate();
      navigateToMap('renter');
    }
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
