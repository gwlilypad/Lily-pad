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

  async function signUp(email, password, fullName, role) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST', headers: HEADERS,
      body: JSON.stringify({
        email, password,
        data: { full_name: fullName, account_type: role },
      }),
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

  async function getUserProfile(accessToken) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { ...HEADERS, 'Authorization': `Bearer ${accessToken}` },
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  // ── Hide ALL unwanted top-bar elements via JS ────────────────────────────
  // These elements use inline styles only — CSS class selectors cannot target them.
  function hideUnwantedElements() {
    // 1. Hide Renter/Driver toggle — find buttons by their text labels
    //    and hide their parent container (the pill wrapper)
    document.querySelectorAll('button').forEach(btn => {
      const text = btn.textContent.trim();
      if ((text === 'Renter' || text === 'Driver') && btn.style.borderRadius === '20px') {
        const container = btn.parentElement;
        if (container) container.style.setProperty('display', 'none', 'important');
      }
    });

    // 2. Hide the top-bar icon buttons (36×36 circular, inline styled)
    document.querySelectorAll('button').forEach(btn => {
      if (btn.style.width === '36px' && btn.style.height === '36px'
          && btn.style.borderRadius === '50%') {
        btn.style.setProperty('display', 'none', 'important');
        const parent = btn.parentElement;
        if (parent) parent.style.setProperty('display', 'none', 'important');
      }
    });

    // 3. Hide .home-icon-btn (step/booking flow home button — class exists in bundle)
    document.querySelectorAll('.home-icon-btn').forEach(el => {
      el.style.setProperty('display', 'none', 'important');
    });
  }

  // ── Navigate to map based on role ────────────────────────────────────────
  // The Renter/Driver toggle buttons call d("find") → navigate to map.
  // "renter" tab = driver looking for parking.
  // "padRenter" tab = pad renter / listing host.
  function navigateToMap(role) {
    const root = document.getElementById('root');
    if (root) root.style.opacity = '0';

    // The button text labels in the toggle:
    //   z="renter"    → children text "Renter"   → sets accountType:"renter"   (driver)
    //   z="padRenter" → children text "Driver"   → sets accountType:"padRenter" (host)
    // We click the label that matches the user's saved role.
    const targetLabel = (role === 'padRenter') ? 'Driver' : 'Renter';

    function tryNavigate(attempts) {
      const allBtns = Array.from(document.querySelectorAll('button'));

      // Find the toggle button matching this role
      const toggleBtn = allBtns.find(b =>
        b.textContent.trim() === targetLabel && b.style.borderRadius === '20px'
      );

      if (toggleBtn) {
        toggleBtn.click(); // triggers d("find") → goes to map
        console.log('[Lily Pad] Navigated to map as', role, 'via toggle button');
        setTimeout(() => {
          if (root) root.style.opacity = '1';
          hideUnwantedElements();
          startElementGuard();
          wireSignOut();
        }, 200);
        return;
      }

      // Fallback: try tab-bar if it already exists
      const tabBar = document.querySelector('.tab-bar');
      if (tabBar) {
        const firstTab = tabBar.querySelector('button');
        if (firstTab) {
          firstTab.click();
          console.log('[Lily Pad] Navigated via tab-bar fallback');
          setTimeout(() => {
            if (root) root.style.opacity = '1';
            hideUnwantedElements();
            startElementGuard();
            wireSignOut();
          }, 200);
          return;
        }
      }

      if (attempts < 60) {
        setTimeout(() => tryNavigate(attempts + 1), 100);
      } else {
        if (root) root.style.opacity = '1';
        hideUnwantedElements();
        startElementGuard();
        wireSignOut();
        console.warn('[Lily Pad] Navigation timeout — showing app as-is');
      }
    }

    // Use MutationObserver to fire as soon as React renders anything
    const obs = new MutationObserver(() => {
      const allBtns = Array.from(document.querySelectorAll('button'));
      const hasToggle = allBtns.some(b =>
        (b.textContent.trim() === 'Renter' || b.textContent.trim() === 'Driver')
        && b.style.borderRadius === '20px'
      );
      if (hasToggle) {
        obs.disconnect();
        tryNavigate(0);
      }
    });

    if (root) obs.observe(root, { childList: true, subtree: true });

    // Also start polling immediately in case React already rendered
    setTimeout(() => tryNavigate(0), 100);
  }

  // ── Persistent element guard (re-hides after React re-renders) ───────────
  function startElementGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    const guard = new MutationObserver(() => hideUnwantedElements());
    guard.observe(root, { childList: true, subtree: true });
  }

  // ── Intercept Sign Out ───────────────────────────────────────────────────
  function wireSignOut() {
    document.addEventListener('click', function (e) {
      const row = e.target.closest('.thumb-nav-row');
      if (row && row.textContent.includes('Sign out')) {
        clearSession();
        setTimeout(() => location.reload(), 120);
      }
    }, true);
  }

  // ── Auth gate ────────────────────────────────────────────────────────────
  function hideGate() {
    const gate = document.getElementById('auth-gate');
    if (!gate) return;
    gate.classList.add('hiding');
    setTimeout(() => gate.classList.add('hidden'), 420);
  }

  async function afterAuth(session) {
    hideGate();
    // Determine role from user profile metadata
    let role = 'renter'; // default: driver looking for parking
    if (session && session.access_token) {
      const profile = await getUserProfile(session.access_token);
      if (profile && profile.user_metadata && profile.user_metadata.account_type) {
        role = profile.user_metadata.account_type;
      }
    }
    navigateToMap(role);
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
    const session = getSession();
    if (session) {
      const nowSec = Date.now() / 1000;
      if ((session.expires_at || 0) > nowSec + 60) {
        afterAuth(session);
        return;
      }
      if (session.refresh_token) {
        const refreshed = await refreshSession(session.refresh_token).catch(() => null);
        if (refreshed) { afterAuth(refreshed); return; }
      }
      clearSession();
    }

    // Wire role picker toggle
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

    // Login
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) { setError('login-error', 'Please enter your email and password.'); return; }
      clearMsgs();
      setLoading(loginBtn, true);
      try {
        const session = await signIn(email, password);
        afterAuth(session);
      } catch (err) {
        setError('login-error', err.message);
        setLoading(loginBtn, false);
      }
    });

    // Signup
    document.getElementById('signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name     = document.getElementById('signup-name').value.trim();
      const email    = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const activeRole = document.querySelector('.role-btn.active');
      const role     = activeRole ? activeRole.dataset.role : 'renter';

      if (!name)                             { setError('signup-error', 'Please enter your full name.'); return; }
      if (!email)                            { setError('signup-error', 'Please enter your email address.'); return; }
      if (!password || password.length < 6) { setError('signup-error', 'Password must be at least 6 characters.'); return; }
      clearMsgs();
      setLoading(signupBtn, true);
      try {
        const result = await signUp(email, password, name, role);
        if (result.access_token) {
          afterAuth(result);
        } else if (result.id) {
          setSuccess('signup-success', 'Account created! Check your inbox to confirm your email, then sign in.');
          signupBtn.style.display = 'none';
        } else {
          setError('signup-error', 'Something went wrong. Please try again.');
          setLoading(signupBtn, false);
        }
      } catch (err) {
        setError('signup-error', err.message);
        setLoading(signupBtn, false);
      }
    });

    // Forgot password
    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
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
