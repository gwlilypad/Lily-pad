(function () {
  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[Lily Pad] Supabase config missing.');
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

  // ── Sign-out ─────────────────────────────────────────────────────────────
  function doSignOut() {
    clearSession();
    location.reload();
  }

  // ── Gate show / hide ─────────────────────────────────────────────────────
  function showGate() {
    const gate = document.getElementById('auth-gate');
    if (!gate) return;
    gate.classList.remove('hidden', 'hiding');
    void gate.offsetWidth;
    gate.classList.add('visible');
  }

  function hideGate() {
    const gate = document.getElementById('auth-gate');
    if (!gate || gate.classList.contains('hidden')) return;
    gate.classList.remove('visible');
    gate.classList.add('hiding');
    setTimeout(() => {
      gate.classList.remove('hiding');
      gate.classList.add('hidden');
    }, 420);
  }

  // ── Element hiding ────────────────────────────────────────────────────────
  function hideUnwantedElements() {
    const appRoot = document.getElementById('root');

    Array.from(document.querySelectorAll('button')).forEach(btn => {
      const text = btn.textContent.trim();

      // Hide the Renter/Driver toggle pill — only inside #root
      if ((text === 'Renter' || text === 'Driver') && appRoot && appRoot.contains(btn)) {
        hide(btn);
        hide(btn.parentElement);
      }

      // Hide 36×36 circular top-bar icon buttons
      const w = parseInt(btn.style.width);
      const h = parseInt(btn.style.height);
      if (w === 36 && h === 36) {
        hide(btn);
        hide(btn.parentElement);
      }
    });

    // Hide the map "Back to home" / "Back to admin" element
    document.querySelectorAll('[title]').forEach(el => {
      const t = (el.title || '').toLowerCase();
      if (t.includes('back to home') || t.includes('back to admin')) {
        hide(el);
      }
    });

    document.querySelectorAll('.home-icon-btn').forEach(hide);
  }

  function hide(el) {
    if (el) el.style.setProperty('display', 'none', 'important');
  }

  // ── Early guard: hides unwanted elements before and after auth ────────────
  function startHidingGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    hideUnwantedElements();
    const guard = new MutationObserver(hideUnwantedElements);
    guard.observe(root, { childList: true, subtree: true });
  }

  // ── Full guard: hides + keeps sign-out FAB alive after auth ───────────────
  function startGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    const guard = new MutationObserver(() => {
      hideUnwantedElements();
      injectSignOutButtons();
    });
    guard.observe(root, { childList: true, subtree: true });
  }

  // ── Intercept landing page CTA buttons → show sign-in gate ──────────────
  function interceptLandingButtons() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const text = btn.textContent.trim();
      if (text === 'Find a pad' || text === 'List my lily pad') {
        e.stopPropagation();
        e.preventDefault();
        showForm('form-login');
        showGate();
      }
    }, true);
  }

  // ── Sign-out button injection ─────────────────────────────────────────────
  function injectSignOutButtons() {
    injectSignOutFab();
    injectAdminSignOut();
  }

  function injectSignOutFab() {
    if (document.getElementById('lp-so-fab')) return;

    const root = document.getElementById('root');
    if (!root) return;

    const container = root.firstElementChild;
    if (!container) {
      setTimeout(injectSignOutFab, 120);
      return;
    }

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    container.style.setProperty('overflow', 'visible', 'important');

    const fab = document.createElement('button');
    fab.id = 'lp-so-fab';
    fab.textContent = 'Sign out';
    fab.addEventListener('click', doSignOut);
    fab.setAttribute('style', [
      'position:absolute',
      'top:14px',
      'right:14px',
      'z-index:2147483647',
      'background:rgba(14,31,64,0.88)',
      'color:#fff',
      'border:none',
      'border-radius:18px',
      'padding:7px 15px',
      'font-size:12px',
      'font-weight:700',
      'font-family:"DM Sans",sans-serif',
      'cursor:pointer',
      'box-shadow:0 2px 10px rgba(0,0,0,0.28)',
      'backdrop-filter:blur(10px)',
      '-webkit-backdrop-filter:blur(10px)',
      'letter-spacing:-0.1px',
      'line-height:1.2',
      'pointer-events:auto',
    ].join(';'));
    container.appendChild(fab);
    console.log('[Lily Pad] Sign-out FAB injected');
  }

  function injectAdminSignOut() {
    const banner = Array.from(document.querySelectorAll('div')).find(div => {
      if (div.style.zIndex !== '600') return false;
      if (div.style.position !== 'absolute') return false;
      const t = (div.textContent || '').trim();
      return t.includes('Admin view') || t.includes('Staff view');
    });
    if (!banner) return;

    const old = document.getElementById('lp-admin-so');
    if (old) old.remove();

    const btn = document.createElement('button');
    btn.id = 'lp-admin-so';
    btn.textContent = 'Sign out';
    btn.addEventListener('click', doSignOut);
    btn.setAttribute('style', [
      'background:rgba(229,57,53,0.90)',
      'color:#fff',
      'border:none',
      'border-radius:14px',
      'padding:5px 13px',
      'font-size:11.5px',
      'font-weight:700',
      'font-family:"DM Sans",sans-serif',
      'cursor:pointer',
      'margin-left:8px',
      'flex-shrink:0',
      'pointer-events:auto',
    ].join(';'));
    banner.appendChild(btn);
    console.log('[Lily Pad] Admin sign-out button injected');
  }

  // ── Navigate to map after auth ────────────────────────────────────────────
  function navigateToMap(role, onNavDone) {
    const targetLabel = (role === 'padRenter') ? 'Driver' : 'Renter';
    let done = false;

    function complete(reason) {
      if (done) return;
      done = true;
      console.log('[Lily Pad] Navigation complete:', reason);
      if (onNavDone) onNavDone();
      hideUnwantedElements();
      startGuard();
      wireSignOut();
      injectSignOutButtons();
    }

    function tryClick() {
      if (done) return;

      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === targetLabel);
      if (btn) {
        console.log('[Lily Pad] Clicking toggle "' + targetLabel + '" to navigate to map');
        btn.click();
        complete('toggle clicked');
        return;
      }

      const findTab = Array.from(document.querySelectorAll('.tab-bar button'))
        .find(b => b.textContent.includes('Find') || b.classList.contains('active-tab'));
      if (findTab) {
        console.log('[Lily Pad] Navigating via Find tab fallback');
        findTab.click();
        complete('find-tab clicked');
        return;
      }

      if (document.querySelector('.tab-bar') &&
          !Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === targetLabel)) {
        complete('already on map');
      }
    }

    const root = document.getElementById('root');
    const obs = new MutationObserver(() => {
      tryClick();
      if (done) obs.disconnect();
    });
    if (root) obs.observe(root, { childList: true, subtree: true });

    const poll = setInterval(() => {
      tryClick();
      if (done) clearInterval(poll);
    }, 80);

    setTimeout(() => {
      clearInterval(poll);
      obs.disconnect();
      if (!done) {
        done = true;
        console.warn('[Lily Pad] Navigation timeout — showing app as-is');
        if (onNavDone) onNavDone();
        hideUnwantedElements();
        startGuard();
        wireSignOut();
        injectSignOutButtons();
      }
    }, 8000);
  }

  // ── Sign-out intercept for existing account-screen rows ──────────────────
  function wireSignOut() {
    document.addEventListener('click', (e) => {
      const row = e.target.closest('.thumb-nav-row');
      if (row && row.textContent.includes('Sign out')) {
        doSignOut();
      }
    }, true);
  }

  // ── After successful auth ─────────────────────────────────────────────────
  async function afterAuth(session) {
    const role = (session && session.access_token)
      ? await getUserRole(session.access_token)
      : 'renter';
    navigateToMap(role, () => hideGate());
  }

  // ── Auth form helpers ─────────────────────────────────────────────────────
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

  // ── Wire auth forms ───────────────────────────────────────────────────────
  function wireAuthForms() {
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

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    // Always start hiding the toggle & home button immediately
    if (document.getElementById('root')) {
      startHidingGuard();
    } else {
      document.addEventListener('DOMContentLoaded', startHidingGuard);
    }

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

    // No valid session — let landing page show, intercept CTA taps
    interceptLandingButtons();
    wireAuthForms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
