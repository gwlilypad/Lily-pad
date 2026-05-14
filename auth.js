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

  // ── Sign-out ─────────────────────────────────────────────────────────────
  function doSignOut() {
    clearSession();
    location.reload();
  }

  // ── Element hiding ────────────────────────────────────────────────────────
  function hideUnwantedElements() {
    Array.from(document.querySelectorAll('button')).forEach(btn => {
      const text  = btn.textContent.trim();
      const title = (btn.title || '').toLowerCase();

      // Hide the Renter/Driver toggle pill and its parent container.
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

  // ── Sign-out button injection ─────────────────────────────────────────────
  function injectSignOutButtons() {
    injectSignOutFab();
    injectAdminSignOut();
  }

  // Persistent "Sign out" pill injected into the app's own root container.
  // Uses position:absolute inside #root so it stays within the phone frame
  // in the Replit preview AND is correct in the deployed full-screen app.
  function injectSignOutFab() {
    if (document.getElementById('lp-so-fab')) return;

    // Find the app's outermost rendered div (first child of #root)
    const root = document.getElementById('root');
    if (!root || !root.firstElementChild) return;
    const container = root.firstElementChild;

    // Ensure container can hold absolutely-positioned children
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

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

  // Inject a red "Sign out" button into the admin/staff preview banner.
  // The banner: position:absolute; top:0; left:0; right:0; zIndex:600; background:#0E1F40
  function injectAdminSignOut() {
    if (document.getElementById('lp-admin-so')) return;

    // Find the banner by its unique combination of inline styles + text content
    const banner = Array.from(document.querySelectorAll('div')).find(div => {
      if (div.style.zIndex !== '600') return false;
      if (div.style.position !== 'absolute') return false;
      const t = (div.textContent || '').trim();
      return t.includes('Admin view') || t.includes('Staff view');
    });
    if (!banner) return;

    // Remove any existing injected button (React re-render guard)
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
  // onNavDone is called as soon as the toggle is clicked (or tab-bar found).
  // afterAuth() passes hideGate as onNavDone so the gate stays up until
  // navigation happens — the user never sees the Renter/Driver toggle.
  function navigateToMap(role, onNavDone) {
    const targetLabel = (role === 'padRenter') ? 'Driver' : 'Renter';
    let done = false;

    function complete(reason) {
      if (done) return;
      done = true;
      console.log('[Lily Pad] Navigation complete:', reason);
      if (onNavDone) onNavDone();     // hides the gate
      hideUnwantedElements();
      startGuard();
      wireSignOut();
      injectSignOutButtons();
    }

    function tryClick() {
      if (done) return;

      // Primary: find the Renter/Driver toggle button by text content.
      // The toggle has no class — match by exact text only (original reliable approach).
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === targetLabel);
      if (btn) {
        console.log('[Lily Pad] Clicking toggle "' + targetLabel + '" to navigate to map');
        btn.click();
        complete('toggle clicked');
        return;
      }

      // Fallback A: any button that routes to "find" view (tab-bar "Find" button)
      const findTab = Array.from(document.querySelectorAll('.tab-bar button'))
        .find(b => b.textContent.includes('Find') || b.classList.contains('active-tab'));
      if (findTab) {
        console.log('[Lily Pad] Navigating via Find tab fallback');
        findTab.click();
        complete('find-tab clicked');
        return;
      }

      // Fallback B: tab-bar exists but no toggle — we're already on map view
      if (document.querySelector('.tab-bar') &&
          !Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === targetLabel)) {
        complete('already on map');
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
        if (onNavDone) onNavDone();
        hideUnwantedElements();
        startGuard();
        wireSignOut();
        injectSignOutButtons();
      }
    }, 8000);
  }

  // ── Persistent guard: re-hide after every React re-render ────────────────
  function startGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    const guard = new MutationObserver(() => {
      hideUnwantedElements();
      injectSignOutButtons();
    });
    guard.observe(root, { childList: true, subtree: true });
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

  // ── Gate ─────────────────────────────────────────────────────────────────
  function hideGate() {
    const gate = document.getElementById('auth-gate');
    if (!gate) return;
    gate.classList.add('hiding');
    setTimeout(() => gate.classList.add('hidden'), 420);
  }

  // Gate stays visible until navigation completes — user never sees the toggle.
  async function afterAuth(session) {
    const role = (session && session.access_token)
      ? await getUserRole(session.access_token)
      : 'renter';
    navigateToMap(role, () => hideGate());
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

  // ── Debug bypass ─────────────────────────────────────────────────────────
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
