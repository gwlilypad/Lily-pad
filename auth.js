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

  // ── Session ───────────────────────────────────────────────────────────────
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

  // ── Read real user data from native app state or Supabase session ──────────
  function getUserData() {
    try {
      const raw = localStorage.getItem('lilypad.appState.v1');
      if (raw) {
        const state = JSON.parse(raw);
        const dr = state.drAns || {};
        const su = state.suAns || {};
        const biz = state.bizAns || {};
        const firstName = dr[0] || su[0] || biz[5] || '';
        const lastName  = dr[1] || su[1] || biz[6] || '';
        const email     = dr[2] || su[2] || biz[7] || '';
        if (firstName || email) {
          return { firstName, lastName, fullName: `${firstName} ${lastName}`.trim(), email };
        }
      }
    } catch {}
    // Fallback: Supabase session
    const session = getSession();
    if (session) {
      const meta = session.user_metadata || {};
      const email = session.email || (session.user && session.user.email) || '';
      const name = meta.full_name || meta.name || '';
      const [firstName = '', ...rest] = name.split(' ');
      return { firstName, lastName: rest.join(' '), fullName: name, email };
    }
    return null;
  }

  // ── Update profile name/initials/email displayed in the pull-down ─────────
  function updateProfileDisplay() {
    const data = getUserData();
    if (!data) return;

    // Update name
    document.querySelectorAll('.profile-name').forEach(el => {
      if (data.fullName) el.textContent = data.fullName;
    });

    // Update avatar initials
    document.querySelectorAll('.avatar-initials').forEach(el => {
      const initials = [data.firstName[0], data.lastName[0]]
        .filter(Boolean).join('').toUpperCase();
      if (initials) el.textContent = initials;
    });

    // Update any element near .profile-name that looks like an email address
    // (contains '@') — this is the email sub-line in the pull-down header
    if (data.email) {
      document.querySelectorAll('.profile-name').forEach(nameEl => {
        // Check siblings and nearby elements for an email-looking node
        const parent = nameEl.parentElement;
        if (!parent) return;
        Array.from(parent.querySelectorAll('*')).forEach(el => {
          if (el.children.length === 0 && el.textContent.includes('@')) {
            el.textContent = data.email;
          }
        });
      });
    }
  }

  // ── Auth gate (sign-in modal) ──────────────────────────────────────────────
  function showGate() {
    const gate = document.getElementById('auth-gate');
    if (gate) gate.classList.remove('hidden');
  }
  function hideGate() {
    const gate = document.getElementById('auth-gate');
    if (gate) gate.classList.add('hidden');
  }

  function switchForm(id) {
    ['form-login', 'form-signup', 'form-forgot'].forEach(fid => {
      const el = document.getElementById(fid);
      if (el) el.classList.toggle('active', fid === id);
    });
  }

  function wireAuthForms() {
    // Login
    const loginForm = document.getElementById('login-form');
    if (loginForm && !loginForm.dataset.wired) {
      loginForm.dataset.wired = '1';
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const pass  = document.getElementById('login-password').value;
        const errEl = document.getElementById('login-error');
        const btn   = document.getElementById('login-btn');
        if (errEl) errEl.textContent = '';
        if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST', headers: HEADERS,
            body: JSON.stringify({ email, password: pass }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error_description || data.message || 'Sign-in failed');
          saveSession(data);
          hideGate();
          afterAuth(data);
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
        }
      });
    }

    // Forgot password
    const forgotForm = document.getElementById('forgot-form');
    if (forgotForm && !forgotForm.dataset.wired) {
      forgotForm.dataset.wired = '1';
      forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email  = document.getElementById('forgot-email').value.trim();
        const errEl  = document.getElementById('forgot-error');
        const succEl = document.getElementById('forgot-success');
        const btn    = document.getElementById('forgot-btn');
        if (errEl) errEl.textContent = '';
        if (succEl) succEl.textContent = '';
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

        try {
          const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
            method: 'POST', headers: HEADERS,
            body: JSON.stringify({ email }),
          });
          if (!res.ok) {
            const d = await res.json();
            throw new Error(d.error_description || d.message || 'Request failed');
          }
          if (succEl) succEl.textContent = 'Reset link sent — check your inbox.';
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = 'Send reset link'; }
        }
      });
    }

    // Form switchers
    const gotoForgot = document.getElementById('goto-forgot');
    const gotoSignup = document.getElementById('goto-signup');
    const gotoLogin  = document.getElementById('goto-login');
    const backLogin  = document.getElementById('back-to-login');
    if (gotoForgot && !gotoForgot.dataset.wired) { gotoForgot.dataset.wired = '1'; gotoForgot.addEventListener('click', () => switchForm('form-forgot')); }
    if (gotoSignup && !gotoSignup.dataset.wired) { gotoSignup.dataset.wired = '1'; gotoSignup.addEventListener('click', () => switchForm('form-signup')); }
    if (gotoLogin  && !gotoLogin.dataset.wired)  { gotoLogin.dataset.wired  = '1'; gotoLogin.addEventListener('click',  () => switchForm('form-login'));  }
    if (backLogin  && !backLogin.dataset.wired)  { backLogin.dataset.wired  = '1'; backLogin.addEventListener('click',  () => switchForm('form-login'));  }

    // Close gate on backdrop click
    const gate = document.getElementById('auth-gate');
    if (gate && !gate.dataset.wired) {
      gate.dataset.wired = '1';
      gate.addEventListener('click', (e) => {
        if (e.target === gate) hideGate();
      });
    }
  }

  // ── Sign-out ──────────────────────────────────────────────────────────────
  function doSignOut() {
    clearSession();
    localStorage.removeItem('lilypad.appState.v1');
    location.reload();
  }

  let signOutWired = false;
  function wireSignOut() {
    if (signOutWired) return;
    signOutWired = true;
    document.addEventListener('click', (e) => {
      const row = e.target.closest('.thumb-nav-row');
      if (row && row.textContent.includes('Sign out')) {
        e.stopPropagation();
        e.preventDefault();
        doSignOut();
      }
    }, true);
  }

  // ── Element hiding ────────────────────────────────────────────────────────
  function hideUnwantedElements() {
    const appRoot = document.getElementById('root');

    Array.from(document.querySelectorAll('button')).forEach(btn => {
      const text = btn.textContent.trim();

      // Hide Renter/Driver toggle inside #root
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

    // Hide the lily pad logo button at the top of sign-up wizard screens (.s-header first button)
    document.querySelectorAll('.s-header').forEach(header => {
      const firstBtn = header.querySelector('button');
      if (firstBtn) hide(firstBtn);
    });

    // Hide "Back to home" / "Back to admin" nav elements
    document.querySelectorAll('[title]').forEach(el => {
      const t = (el.title || '').toLowerCase();
      if (t.includes('back to home') || t.includes('back to admin')) hide(el);
    });

    document.querySelectorAll('.home-icon-btn').forEach(hide);
  }

  function hide(el) {
    if (el) el.style.setProperty('display', 'none', 'important');
  }

  // ── Landing page: replace "Have a referral code?" with "Sign in" ──────────
  function injectSignInButton() {
    if (document.getElementById('lp-signin-btn')) return;

    const refEl = Array.from(document.querySelectorAll('*')).find(el =>
      el.children.length === 0 &&
      el.textContent.trim() === 'Have a referral code?'
    );
    if (!refEl) return;

    const refWrapper = refEl.closest('p, a, div, span, button') || refEl;
    refWrapper.style.setProperty('display', 'none', 'important');

    const btn = document.createElement('button');
    btn.id = 'lp-signin-btn';
    btn.textContent = 'Sign in';
    btn.setAttribute('style', [
      'display:block',
      'width:100%',
      'background:transparent',
      'border:none',
      'color:rgba(14,31,64,0.55)',
      'font-size:15px',
      'font-weight:500',
      'font-family:"DM Sans",sans-serif',
      'text-decoration:underline',
      'text-decoration-color:rgba(14,31,64,0.2)',
      'text-align:center',
      'padding:10px 0',
      'cursor:pointer',
      'margin-top:4px',
    ].join(';'));

    btn.addEventListener('click', () => {
      switchForm('form-login');
      wireAuthForms();
      showGate();
    });

    refWrapper.parentNode.insertBefore(btn, refWrapper.nextSibling);
    console.log('[Lily Pad] Sign-in button injected on landing page');
  }

  // ── Pull-down sign-out injection ──────────────────────────────────────────
  // Injects a dedicated sign-out card into the account pull-down whenever
  // thumb-nav-cards are present and our row isn't already there.
  function injectPullDownSignOut() {
    // Re-check: if our element still exists in the DOM, skip
    if (document.getElementById('lp-pulldown-so')) return;

    // ── Strategy A: standard renter/pad-renter pull-down (.thumb-nav-card) ──
    const cards = document.querySelectorAll('.thumb-nav-card');
    if (cards.length > 0) {
      const lastCard = cards[cards.length - 1];
      const row = document.createElement('div');
      row.id = 'lp-pulldown-so';
      row.className = 'thumb-nav-row';
      row.style.cursor = 'pointer';
      row.innerHTML =
        '<span class="thumb-nav-lbl" style="color:rgba(229,57,53,0.85);font-weight:700">Sign out</span>' +
        '<span class="thumb-nav-arrow">›</span>';
      row.addEventListener('click', doSignOut);
      const wrapper = document.createElement('div');
      wrapper.className = 'thumb-nav-card';
      wrapper.style.marginTop = '8px';
      wrapper.appendChild(row);
      lastCard.parentNode.insertBefore(wrapper, lastCard.nextSibling);
      console.log('[Lily Pad] Pull-down sign-out injected (standard)');
      return;
    }

    // ── Strategy B: all other views (admin, staff, custom account panels) ──
    // Find the div whose DIRECT children contain all known menu item labels.
    // This is reliable across admin view, staff view, and any future variant.
    const MENU_LABELS = ['My Account', 'My Bookings'];
    const allDivs = Array.from(document.querySelectorAll('div'));
    const menuContainer = allDivs.find(div => {
      if (div.children.length < 3) return false;
      const childTexts = Array.from(div.children).map(c => c.textContent);
      return MENU_LABELS.every(label => childTexts.some(t => t.includes(label)));
    });

    if (!menuContainer) return;

    const soRow = document.createElement('div');
    soRow.id = 'lp-pulldown-so';
    soRow.style.cssText = [
      'display:flex',
      'align-items:center',
      'padding:18px 20px',
      'cursor:pointer',
      'border-top:1px solid rgba(255,255,255,0.08)',
      'margin-top:8px',
      'gap:10px',
    ].join(';');
    soRow.innerHTML =
      '<span style="font-size:16px;font-weight:700;color:rgba(229,57,53,0.9);' +
      'font-family:\'DM Sans\',sans-serif;letter-spacing:-0.01em">Sign out</span>';
    soRow.addEventListener('click', doSignOut);
    menuContainer.appendChild(soRow);
    console.log('[Lily Pad] Pull-down sign-out injected (admin/staff/custom view)');
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  function startHidingGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    hideUnwantedElements();
    injectSignInButton();
    const guard = new MutationObserver(() => {
      hideUnwantedElements();
      injectSignInButton();
    });
    guard.observe(root, { childList: true, subtree: true });
  }

  function startGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    const guard = new MutationObserver(() => {
      hideUnwantedElements();
      injectSignOutButtons();
      injectPullDownSignOut();
      updateProfileDisplay();
    });
    guard.observe(root, { childList: true, subtree: true });
  }

  // ── Navigate to map ───────────────────────────────────────────────────────
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
      injectSignOutButtons();
      injectPullDownSignOut();
      updateProfileDisplay();
    }

    function tryClick() {
      if (done) return;
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => b.textContent.trim() === targetLabel);
      if (btn) {
        btn.style.removeProperty('display');
        if (btn.parentElement) btn.parentElement.style.removeProperty('display');
        btn.click();
        hide(btn);
        hide(btn.parentElement);
        complete('toggle clicked');
        return;
      }
      if (document.querySelector('.tab-bar')) complete('tab-bar found');
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
        console.warn('[Lily Pad] Nav timeout');
        if (onNavDone) onNavDone();
        hideUnwantedElements();
        startGuard();
        injectSignOutButtons();
        injectPullDownSignOut();
        updateProfileDisplay();
      }
    }, 8000);
  }

  // ── Native auth completion watcher ────────────────────────────────────────
  function watchForNativeAuthComplete() {
    if (document.querySelector('.tab-bar')) { onNativeAuthComplete(); return; }
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
    console.log('[Lily Pad] Native auth complete');
    hideUnwantedElements();
    startGuard();
    injectSignOutButtons();
    injectPullDownSignOut();
    updateProfileDisplay();
  }

  async function afterAuth(session) {
    const role = (session && session.access_token)
      ? await getUserRole(session.access_token)
      : 'renter';
    navigateToMap(role, () => {});
  }

  // ── Sign-out button injections ────────────────────────────────────────────
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

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
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
  }

  function injectAdminSignOut() {
    const banner = Array.from(document.querySelectorAll('div')).find(div => {
      if (div.style.zIndex !== '600') return false;
      if (div.style.position !== 'absolute') return false;
      const t = (div.textContent || '').trim();
      return t.includes('Admin view') || t.includes('Staff view');
    });
    if (!banner) return;
    if (document.getElementById('lp-admin-so')) return;
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

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    // Always hide unwanted elements + inject landing sign-in button
    startHidingGuard();
    // Always wire sign-out intercept from startup
    wireSignOut();
    // Wire auth modal forms
    wireAuthForms();

    if (SUPABASE_OK) {
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

    watchForNativeAuthComplete();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
