(function () {
  const SUPABASE_URL = window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__;
  const SUPABASE_OK = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

  if (!SUPABASE_OK) {
    console.warn('[Lily Pad] Supabase config missing — hiding guard still runs.');
  }

  const HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };

  // ── Session (our key, for users who signed in via Supabase directly) ──────
  function getSession() {
    try { return JSON.parse(localStorage.getItem('lily_pad_session') || 'null'); }
    catch { return null; }
  }
  function saveSession(s) { localStorage.setItem('lily_pad_session', JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem('lily_pad_session'); }

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

    // Hide the map "Back to home" / "Back to admin" element (any tag)
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

  // ── Persistent guard: hides unwanted elements on every React re-render ────
  function startHidingGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    hideUnwantedElements();
    const guard = new MutationObserver(hideUnwantedElements);
    guard.observe(root, { childList: true, subtree: true });
  }

  // ── Full guard: hides + keeps sign-out FAB alive ──────────────────────────
  function startGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    const guard = new MutationObserver(() => {
      hideUnwantedElements();
      injectSignOutButtons();
    });
    guard.observe(root, { childList: true, subtree: true });
  }

  // ── Navigate to map by clicking the Renter/Driver toggle programmatically ─
  // Even if the toggle is hidden via display:none we briefly un-hide it,
  // click it (so React's event system fires), then re-hide immediately.
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
        console.log('[Lily Pad] Clicking toggle "' + targetLabel + '"');
        // Temporarily un-hide so React's click handler fires correctly
        btn.style.removeProperty('display');
        if (btn.parentElement) btn.parentElement.style.removeProperty('display');
        btn.click();
        // Re-hide immediately
        hide(btn);
        hide(btn.parentElement);
        complete('toggle clicked');
        return;
      }

      // Fallback: tab-bar exists → already on map
      if (document.querySelector('.tab-bar')) {
        complete('tab-bar found');
      }
    }

    const root = document.getElementById('root');
    const obs = new MutationObserver(() => { tryClick(); if (done) obs.disconnect(); });
    if (root) obs.observe(root, { childList: true, subtree: true });

    const poll = setInterval(() => { tryClick(); if (done) clearInterval(poll); }, 80);

    setTimeout(() => {
      clearInterval(poll);
      obs.disconnect();
      if (!done) {
        done = true;
        console.warn('[Lily Pad] Nav timeout — showing app as-is');
        if (onNavDone) onNavDone();
        hideUnwantedElements();
        startGuard();
        wireSignOut();
        injectSignOutButtons();
      }
    }, 8000);
  }

  // ── Watch for native app sign-up completion (tab-bar appearing) ───────────
  // When the user completes the native wizard, the app shows the tab-bar.
  // We detect that and finish setup (sign-out button, guard).
  function watchForNativeAuthComplete() {
    // If tab-bar already present, act immediately
    if (document.querySelector('.tab-bar')) {
      onNativeAuthComplete();
      return;
    }
    const root = document.getElementById('root');
    if (!root) return;
    const obs = new MutationObserver(() => {
      if (document.querySelector('.tab-bar')) {
        obs.disconnect();
        onNativeAuthComplete();
      }
    });
    obs.observe(root, { childList: true, subtree: true });
  }

  function onNativeAuthComplete() {
    console.log('[Lily Pad] Native auth complete — setting up guard + sign-out');
    hideUnwantedElements();
    startGuard();
    wireSignOut();
    injectSignOutButtons();
  }

  // ── After successful Supabase auth (our session key) ─────────────────────
  async function afterAuth(session) {
    const role = (session && session.access_token)
      ? await getUserRole(session.access_token)
      : 'renter';
    navigateToMap(role, () => {});
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
    if (!container) { setTimeout(injectSignOutFab, 120); return; }

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
  }

  // ── Sign-out intercept for account-screen rows ────────────────────────────
  function wireSignOut() {
    document.addEventListener('click', (e) => {
      const row = e.target.closest('.thumb-nav-row');
      if (row && row.textContent.includes('Sign out')) doSignOut();
    }, true);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    // Always hide the toggle/home button — regardless of Supabase config
    startHidingGuard();

    if (SUPABASE_OK) {
      // Check for existing session via our Supabase auth key
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
    }

    // No session (or no Supabase config) — let the native app handle sign-up/sign-in.
    // Watch for the tab-bar to appear (signals the user reached the map/account view).
    watchForNativeAuthComplete();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
