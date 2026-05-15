(function () {
  const SUPABASE_URL     = '%%SUPABASE_URL%%'     || window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = '%%SUPABASE_ANON_KEY%%' || window.__SUPABASE_ANON_KEY__;
  const SUPABASE_OK = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

  // ── Patch window.fetch to add missing apikey to all Supabase requests ────────
  // The pre-built bundle's Supabase client has an empty key baked in at build
  // time. This intercept fixes every fetch to *.supabase.co that lacks apikey.
  if (SUPABASE_ANON_KEY && !window.__lpFetchPatched) {
    window.__lpFetchPatched = true;
    const _fetch = window.fetch.bind(window);
    window.fetch = function (resource, init) {
      const url = (typeof resource === 'string') ? resource
                : (resource && resource.url) ? resource.url : '';
      if (url.includes('supabase.co')) {
        init = init ? Object.assign({}, init) : {};
        // Normalise headers to a plain object
        let headers = init.headers;
        if (headers instanceof Headers) {
          const plain = {};
          headers.forEach((v, k) => { plain[k] = v; });
          headers = plain;
        } else {
          headers = Object.assign({}, headers || {});
        }
        if (!headers['apikey'] && !headers['Apikey']) {
          headers['apikey'] = SUPABASE_ANON_KEY;
        }
        init.headers = headers;
      }
      return _fetch(resource, init);
    };
  }

  if (!SUPABASE_OK) {
    console.warn('[Lily Pad] Supabase config missing — hiding guard still runs.');
  }

  const HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };

  // ── Save / update profile via our own server (keeps service key off client) ─
  async function saveProfileToServer(session) {
    if (!session) return;
    const user = session.user || {};
    const meta = user.user_metadata || session.user_metadata || {};
    const id   = user.id || (session.user && session.user.id) || session.user_id;
    if (!id) return;
    try {
      const r = await fetch('/api/profile', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          id,
          email       : user.email || session.email || meta.email || '',
          full_name   : meta.full_name || meta.name  || '',
          account_type: meta.account_type || 'renter',
        }),
      });
      if (r.ok) console.log('[Lily Pad] Profile saved to Supabase');
      else      console.warn('[Lily Pad] Profile save failed:', r.status, await r.text());
    } catch (e) {
      console.warn('[Lily Pad] Profile save error:', e.message);
    }
  }

  // ── Session ───────────────────────────────────────────────────────────────
  function getSession() {
    try { return JSON.parse(localStorage.getItem('lily_pad_session') || 'null'); }
    catch { return null; }
  }
  function saveSession(s) { localStorage.setItem('lily_pad_session', JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem('lily_pad_session'); }

  async function refreshSession(token) {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.access_token) return null;
      saveSession(data);
      saveProfileToServer(data);
      return data;
    } catch { return null; }
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
    if (!gate) return;
    gate.classList.remove('hidden', 'hiding');
    gate.classList.add('visible');
  }
  function hideGate() {
    const gate = document.getElementById('auth-gate');
    if (!gate) return;
    gate.classList.add('hiding');
    gate.classList.remove('visible');
    setTimeout(() => {
      gate.classList.remove('hiding');
      gate.classList.add('hidden');
    }, 300);
  }

  function switchForm(id) {
    ['form-login', 'form-signup', 'form-forgot'].forEach(fid => {
      const el = document.getElementById(fid);
      if (el) el.classList.toggle('active', fid === id);
    });
  }

  // ── Auth form handlers (document-level delegation — works regardless of timing) ──
  async function handleLogin() {
    const email = (document.getElementById('login-email')?.value || '').trim();
    const pass  = document.getElementById('login-password')?.value || '';
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');
    if (errEl) errEl.textContent = '';
    if (!email || !pass) { if (errEl) errEl.textContent = 'Please enter your email and password.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    try {
      const res  = await fetch('/api/auth/signin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign-in failed');
      saveSession(data);
      saveProfileToServer(data);
      hideGate();
      afterAuth(data);
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
    }
  }

  async function handleSignup() {
    const name   = (document.getElementById('signup-name')?.value || '').trim();
    const email  = (document.getElementById('signup-email')?.value || '').trim();
    const pass   = document.getElementById('signup-password')?.value || '';
    const errEl  = document.getElementById('signup-error');
    const succEl = document.getElementById('signup-success');
    const btn    = document.getElementById('signup-btn');
    if (errEl)  errEl.textContent  = '';
    if (succEl) succEl.textContent = '';
    if (!name)         { if (errEl) errEl.textContent = 'Please enter your name.'; return; }
    if (!email)        { if (errEl) errEl.textContent = 'Please enter your email.'; return; }
    if (pass.length < 6) { if (errEl) errEl.textContent = 'Password must be at least 6 characters.'; return; }
    const accountType = document.querySelector('#role-picker .role-btn.active')?.dataset.role || 'renter';
    if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }
    console.log('[Lily Pad] Signup attempt:', email);
    try {
      const res  = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass, full_name: name, account_type: accountType }) });
      const data = await res.json();
      console.log('[Lily Pad] Signup response:', res.status, JSON.stringify(data).slice(0, 200));
      if (!res.ok) throw new Error(data.error || 'Sign-up failed');
      if (data.session && data.session.access_token) {
        saveSession(data.session);
        saveProfileToServer(data.session);
        hideGate();
        afterAuth(data.session);
      } else if (data.confirm_email) {
        if (succEl) succEl.textContent = 'Check your email for a confirmation link, then sign in.';
        if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
        setTimeout(() => switchForm('form-login'), 2500);
      } else {
        if (succEl) succEl.textContent = 'Account created! Please sign in.';
        if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
        setTimeout(() => switchForm('form-login'), 1500);
      }
    } catch (err) {
      console.error('[Lily Pad] Signup error:', err.message);
      if (errEl) errEl.textContent = err.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
    }
  }

  async function handleForgot() {
    const email  = (document.getElementById('forgot-email')?.value || '').trim();
    const errEl  = document.getElementById('forgot-error');
    const succEl = document.getElementById('forgot-success');
    const btn    = document.getElementById('forgot-btn');
    if (errEl)  errEl.textContent  = '';
    if (succEl) succEl.textContent = '';
    if (!email) { if (errEl) errEl.textContent = 'Please enter your email.'; return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      const res = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Request failed');
      if (succEl) succEl.textContent = 'Reset link sent — check your inbox.';
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send reset link'; }
    }
  }

  function wireAuthForms() {
    // Guard: attach to document exactly once — works regardless of DOM timing
    if (document.__lpFormsWired) return;
    document.__lpFormsWired = true;

    // ── Form submits (delegation on document) ────────────────────────────────
    document.addEventListener('submit', (e) => {
      const id = e.target && e.target.id;
      if (id === 'login-form'  || id === 'signup-form' || id === 'forgot-form') {
        e.preventDefault();
        e.stopPropagation();
      }
      if (id === 'login-form')  handleLogin();
      if (id === 'signup-form') handleSignup();
      if (id === 'forgot-form') handleForgot();
    }, true); // capture phase: fires before any child handler

    // ── Button clicks (delegation on document) ───────────────────────────────
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const id = btn.id;

      // Primary action buttons — trigger handlers directly in case submit doesn't fire
      if (id === 'login-btn')  { e.preventDefault(); handleLogin();  return; }
      if (id === 'signup-btn') { e.preventDefault(); handleSignup(); return; }
      if (id === 'forgot-btn') { e.preventDefault(); handleForgot(); return; }

      // Form switchers
      if (id === 'goto-forgot')    switchForm('form-forgot');
      if (id === 'goto-signup')    switchForm('form-signup');
      if (id === 'goto-login')     switchForm('form-login');
      if (id === 'back-to-login')  switchForm('form-login');

      // Role picker
      if (btn.closest('#role-picker')) {
        document.querySelectorAll('#role-picker .role-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }

      // Backdrop close
      if (btn.id === '' && e.target.id === 'auth-gate') hideGate();
    }, false);

    // Backdrop click (not on a button)
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'auth-gate') hideGate();
    }, false);

    console.log('[Lily Pad] Auth forms wired via document delegation');
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

    // Hide any standalone back-btn that goes directly home (not in .s-nav wizard nav)
    document.querySelectorAll('.back-btn').forEach(btn => {
      if (!btn.closest('.s-nav')) hide(btn);
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

  // ── Wizard step-by-step back navigation ──────────────────────────────────
  // The .s-nav .back-btn already has step-back built into the driver wizard,
  // but the pad renter wizard always goes to "padtype". We normalise both by
  // intercepting every back-btn click in capture phase and using the React
  // fiber tree to call dispatch(step - 1) directly.
  function getWizardFiberStep() {
    const sNav = document.querySelector('.s-nav');
    if (!sNav) return null;

    const fiberKey = Object.keys(sNav).find(k => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;

    // Walk UP the fiber tree from div.s-nav until we find a function component
    // whose first useState hook holds a non-negative integer (the step index).
    let fiber = sNav[fiberKey];
    const seen = new Set();
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      // Function components expose hook state in memoizedState linked list.
      // DOM node fibers have memoizedState === null.
      if (fiber.memoizedState !== null && typeof fiber.memoizedState === 'object') {
        const firstHook = fiber.memoizedState;
        if (
          typeof firstHook.memoizedState === 'number' &&
          firstHook.memoizedState >= 0 &&
          firstHook.queue &&
          typeof firstHook.queue.dispatch === 'function'
        ) {
          return { step: firstHook.memoizedState, dispatch: firstHook.queue.dispatch };
        }
      }
      fiber = fiber.return;
      if (fiber && fiber.stateNode instanceof Document) break;
    }
    return null;
  }

  function interceptWizardBack() {
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('.back-btn');
      if (!btn) return;
      if (!btn.closest('.s-nav')) return; // standalone home-back, let native fire

      const state = getWizardFiberStep();
      if (!state) return; // couldn't read fiber, fall through to native handler
      const { step, dispatch } = state;

      if (step > 0) {
        e.stopPropagation(); // prevent React's onBack from firing
        dispatch(step - 1);
        console.log('[Lily Pad] Wizard back: step', step, '→', step - 1);
      }
      // step === 0: let native fire (driver → padtype, pad renter → padtype)
    }, true /* capture phase */);
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

  // ── Photo drawing fullscreen ──────────────────────────────────────────────
  // When the lister sign-up reaches the spot-drawing step and a photo has been
  // selected, expand the canvas-wrap to near-fullscreen so the user can see
  // and draw over the complete image comfortably.
  function enterPhotoFullscreen() {
    if (document.body.classList.contains('lp-photo-fs')) return;
    document.body.classList.add('lp-photo-fs');

    // "Done" button — collapses fullscreen
    if (!document.getElementById('lp-fs-done')) {
      const done = document.createElement('button');
      done.id = 'lp-fs-done';
      done.textContent = 'Done';
      done.addEventListener('click', exitPhotoFullscreen);
      document.body.appendChild(done);
    }

    // Brief hint label
    if (!document.getElementById('lp-fs-hint')) {
      const hint = document.createElement('div');
      hint.id = 'lp-fs-hint';
      hint.textContent = 'Select pad colour then drag to mark your spot';
      document.body.appendChild(hint);
      setTimeout(() => {
        if (hint.parentNode) hint.classList.add('fade');
        setTimeout(() => hint.remove(), 600);
      }, 3000);
    }

    // Remove the small expand button from the canvas-wrap if present
    const exp = document.getElementById('lp-fs-expand');
    if (exp) exp.remove();

    console.log('[Lily Pad] Photo drawing: fullscreen entered');
  }

  function exitPhotoFullscreen() {
    document.body.classList.remove('lp-photo-fs');
    ['lp-fs-done', 'lp-fs-hint', 'lp-fs-expand'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    console.log('[Lily Pad] Photo drawing: fullscreen exited');
  }

  function updatePhotoFullscreen() {
    const canvasWrap = document.querySelector('.canvas-wrap');

    // No canvas-wrap in view — clean up
    if (!canvasWrap) {
      if (document.body.classList.contains('lp-photo-fs')) exitPhotoFullscreen();
      return;
    }

    const img = canvasWrap.querySelector('img[src]');
    const drawCanvas = canvasWrap.querySelector('canvas');

    if (img && drawCanvas) {
      // Photo + drawing canvas present — enter fullscreen
      enterPhotoFullscreen();
    } else {
      // Photo removed or changed step — exit fullscreen and show expand btn
      if (document.body.classList.contains('lp-photo-fs')) exitPhotoFullscreen();

      // Show a small expand icon when photo is loaded but not yet fullscreen
      if (img && !document.getElementById('lp-fs-expand')) {
        // canvas-wrap must be position:relative for the icon to anchor correctly
        if (getComputedStyle(canvasWrap).position === 'static') {
          canvasWrap.style.position = 'relative';
        }
        const exp = document.createElement('button');
        exp.id = 'lp-fs-expand';
        exp.title = 'View fullscreen';
        exp.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" ' +
          'stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<polyline points="15 3 21 3 21 9"/>' +
          '<polyline points="9 21 3 21 3 15"/>' +
          '<line x1="21" y1="3" x2="14" y2="10"/>' +
          '<line x1="3" y1="21" x2="10" y2="14"/>' +
          '</svg>';
        exp.addEventListener('click', enterPhotoFullscreen);
        canvasWrap.appendChild(exp);
      }
    }
  }

  // ── Account-page detector ─────────────────────────────────────────────────
  // Returns true when the Account tab's menu items are present in the DOM.
  function isOnAccountPage() {
    const markers = ['My Bookings', 'Saved Spots', 'Customer Service'];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.nodeValue.trim();
      if (markers.includes(t)) return true;
    }
    return false;
  }

  function injectPullDownSignOut() {
    if (document.getElementById('lp-pulldown-so')) return;

    const LABELS = ['My Account', 'My Bookings', 'Saved Spots', 'Customer Service'];

    // Strategy 1: walk UP from the "Customer Service" leaf node to the first
    // ancestor whose textContent contains 3+ of the 4 menu labels.
    // This works regardless of how deeply nested the label text is.
    let menuCard = null;
    const allNodes = document.querySelectorAll('*');
    let csNode = null;
    for (let i = 0; i < allNodes.length; i++) {
      const n = allNodes[i];
      if (n.children.length === 0 && n.textContent.trim() === 'Customer Service') {
        csNode = n; break;
      }
    }
    // Looser fallback: smallest element that contains ONLY "Customer Service"
    if (!csNode) {
      for (let i = allNodes.length - 1; i >= 0; i--) {
        const n = allNodes[i];
        if (n.textContent.includes('Customer Service') && !n.textContent.includes('My Account')) {
          csNode = n; break;
        }
      }
    }

    if (csNode) {
      let node = csNode.parentElement;
      while (node && node !== document.body) {
        const txt = node.textContent;
        let hits = 0;
        for (let j = 0; j < LABELS.length; j++) { if (txt.includes(LABELS[j])) hits++; }
        if (hits >= 3) { menuCard = node; break; }
        node = node.parentElement;
      }
    }

    // Strategy 2: fallback — scan divs whose children collectively cover labels
    if (!menuCard) {
      const divs = document.querySelectorAll('div');
      for (let i = 0; i < divs.length; i++) {
        const txt = divs[i].textContent;
        let hits = 0;
        for (let j = 0; j < LABELS.length; j++) { if (txt.includes(LABELS[j])) hits++; }
        if (hits >= 3 && divs[i].children.length >= 2) menuCard = divs[i];
      }
    }

    if (!menuCard) return; // menu panel not open yet — observer will retry

    const row = document.createElement('div');
    row.id = 'lp-pulldown-so';
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'gap:14px',
      'padding:14px 20px',
      'cursor:pointer',
      'border-top:1px solid rgba(255,255,255,0.07)',
      'margin-top:2px',
    ].join(';');
    row.innerHTML =
      '<div style="width:40px;height:40px;border-radius:12px;' +
        'background:rgba(229,57,53,0.13);display:flex;align-items:center;' +
        'justify-content:center;flex-shrink:0">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
          'stroke="rgba(229,57,53,0.9)" stroke-width="2.5" ' +
          'stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>' +
          '<polyline points="16 17 21 12 16 7"/>' +
          '<line x1="21" y1="12" x2="9" y2="12"/>' +
        '</svg>' +
      '</div>' +
      '<span style="font-size:15px;font-weight:700;' +
        'color:rgba(229,57,53,0.9);font-family:\'DM Sans\',sans-serif;' +
        'letter-spacing:-0.01em">Sign out</span>';
    row.addEventListener('click', doSignOut);
    menuCard.appendChild(row);
    console.log('[Lily Pad] Sign-out injected, container children:', menuCard.children.length);
  }

  // Poll for sign-out injection — retries every 300 ms until it lands
  function pollSignOut() {
    if (document.getElementById('lp-pulldown-so')) return;
    injectPullDownSignOut();
    if (!document.getElementById('lp-pulldown-so')) setTimeout(pollSignOut, 300);
  }

  // ── Fake spot coordinates baked into the read-only bundle (ar[] array) ───
  // Used to identify and remove hardcoded demo markers from the Leaflet map.
  const FAKE_LATLNGS = new Set([
    '29.757,-95.3677','29.7583,-95.3692','29.7561,-95.3703','29.755,-95.3715',
    '29.759,-95.366','29.7545,-95.3728','29.7535,-95.368','29.752,-95.3695',
    '29.7418,-95.3742','29.7438,-95.37','29.7425,-95.372','29.741,-95.376',
    '29.74,-95.369','29.7463,-95.391','29.7452,-95.3945','29.748,-95.3888',
    '29.744,-95.393','29.747,-95.387','29.792,-95.401','29.7935,-95.4028',
    '29.795,-95.399','29.7905,-95.405','29.796,-95.397','29.773,-95.41',
    '29.772,-95.406','29.774,-95.414','29.739,-95.462','29.7408,-95.464',
    '29.7375,-95.459','29.7382,-95.4665','29.736,-95.461','29.732,-95.451',
    '29.7338,-95.448','29.735,-95.442','29.7085,-95.398','29.706,-95.401',
    '29.71,-95.3955','29.7072,-95.394','29.7182,-95.4052','29.7165,-95.408',
    '29.72,-95.402','29.7632,-95.578','29.7645,-95.582','29.7618,-95.575',
    '29.766,-95.5698','29.7672,-95.584','29.7285,-95.548','29.727,-95.551',
    '29.73,-95.542','29.778,-95.512','29.776,-95.505','29.78,-95.508',
    '29.7755,-95.518','29.7502,-95.4338','29.7518,-95.436','29.7488,-95.4302',
    '29.7508,-95.342','29.7525,-95.338','29.749,-95.345','29.7342,-95.3618',
    '29.7328,-95.364','29.6198,-95.6482','29.622,-95.644','29.6178,-95.651',
    '29.6155,-95.639','29.5598,-95.3142','29.5618,-95.3108','29.5575,-95.3178',
    '29.6882,-95.2108','29.6905,-95.2048','29.6862,-95.2168','29.5522,-95.1128',
    '29.5545,-95.1182','29.55,-95.1068','29.7878,-95.8148','29.7892,-95.8188',
    '29.7858,-95.8118','30.1638,-95.5018','30.1658,-95.4988','30.1618,-95.5048',
    '30.1675,-95.4958','29.9698,-95.7028','29.9718,-95.6988','29.9678,-95.7068',
    '29.9962,-95.2908','29.9982,-95.2868','29.9942,-95.2948','29.6278,-95.5488',
    '29.6298,-95.5448','29.6258,-95.5528','29.7058,-95.4588','29.7075,-95.4552',
    '29.704,-95.462','29.8002,-95.3348','29.8022,-95.3308','29.6982,-95.5108',
    '29.6958,-95.5148','29.7338,-95.5068','29.6985,-95.4428','29.7002,-95.4468',
    '29.6712,-95.3962','29.6705,-95.4005','29.6732,-95.3928','29.6748,-95.399',
    '29.6682,-95.4038','29.6778,-95.3975','29.6662,-95.3888','29.6642,-95.4062',
    '29.6798,-95.4048','29.6602,-95.3918','29.6832,-95.4108','29.6822,-95.3982',
    '29.6708,-95.3984','29.6735,-95.3985','29.6712,-95.3942','29.6682,-95.4012',
    '29.6752,-95.399',
  ]);

  // ── Find Leaflet map instance via React fiber tree ────────────────────────
  function getLeafletMap() {
    const container = document.querySelector('.leaflet-container');
    if (!container) return null;
    const fk = Object.keys(container).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    let fiber = container[fk];
    for (let i = 0; i < 80 && fiber; i++) {
      fiber = fiber.return;
      if (!fiber) break;
      let s = fiber.memoizedState;
      while (s) {
        const v = s.memoizedState;
        if (v && typeof v === 'object' && v !== null &&
            'current' in v && v.current &&
            typeof v.current.eachLayer === 'function') {
          return v.current;
        }
        s = s.next;
      }
    }
    return null;
  }

  // ── Call the app's goTo(page) via React context fiber traversal ───────────
  function callGoTo(page) {
    const root = document.getElementById('root');
    if (!root) return false;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return false;
    const queue = [root[fk]];
    let checked = 0;
    while (queue.length && checked < 400) {
      const fiber = queue.shift();
      if (!fiber) continue;
      checked++;
      const mp = fiber.memoizedProps;
      if (mp && mp.value && typeof mp.value.goTo === 'function') {
        mp.value.goTo(page);
        return true;
      }
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    return false;
  }

  // ── Remove hardcoded fake parking spots from the Leaflet map ─────────────
  let _fakeMapCleaned = false;
  let _fakeMapListener = false;

  function removeFakeMapSpots() {
    if (!document.querySelector('.leaflet-container')) return;
    const map = getLeafletMap();
    if (!map) return;

    // Block any future re-addition of fake layers (one-time setup)
    if (!_fakeMapListener) {
      _fakeMapListener = true;
      map.on('layeradd', function (e) {
        if (!e.layer || typeof e.layer.getLatLng !== 'function') return;
        const ll = e.layer.getLatLng();
        const key = String(ll.lat) + ',' + String(ll.lng);
        if (FAKE_LATLNGS.has(key)) {
          setTimeout(() => { try { map.removeLayer(e.layer); } catch (_) {} }, 0);
        }
      });
    }

    if (_fakeMapCleaned) return;

    let removed = 0;
    map.eachLayer(function (layer) {
      if (typeof layer.getLatLng !== 'function') return;
      const ll = layer.getLatLng();
      const key = String(ll.lat) + ',' + String(ll.lng);
      if (FAKE_LATLNGS.has(key)) {
        try { map.removeLayer(layer); removed++; } catch (_) {}
      }
    });

    if (removed > 0) {
      _fakeMapCleaned = true;
      console.log('[Lily Pad] Removed ' + removed + ' fake map spots');
    }
  }

  // ── Back button on My Pads (paddashboard) page ────────────────────────────
  function injectPaddashboardBack() {
    if (document.getElementById('lp-pad-back')) return;

    // Detect paddashboard by its unique "Revenue & Payouts" header text
    const anchor = Array.from(document.querySelectorAll('p,span,div')).find(el =>
      el.childElementCount === 0 && el.textContent.trim() === 'Revenue & Payouts'
    );
    if (!anchor) return;

    // Walk up to find the page-level container (the dark-blue header section)
    let headerSection = anchor;
    for (let i = 0; i < 8; i++) {
      if (!headerSection.parentElement) break;
      headerSection = headerSection.parentElement;
      const bg = headerSection.style.background || '';
      if (bg.includes('#0E1F40') || bg.includes('#142A52') ||
          bg.includes('rgb(14') || bg.includes('rgb(20')) break;
    }

    const btn = document.createElement('button');
    btn.id = 'lp-pad-back';
    btn.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
      'stroke="rgba(255,255,255,0.80)" stroke-width="2.2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
      '<span style="font-family:\'DM Sans\',sans-serif;font-size:13px;' +
      'color:rgba(255,255,255,0.80);font-weight:600">Back</span>';
    btn.setAttribute('style', [
      'display:flex',
      'align-items:center',
      'gap:5px',
      'background:none',
      'border:none',
      'cursor:pointer',
      'padding:6px 0 10px',
      'flex-shrink:0',
    ].join(';'));

    btn.addEventListener('click', function () {
      document.getElementById('lp-pad-back')?.remove();
      if (!callGoTo('find')) {
        // Fallback: click the bottom tab-bar map/find button
        const tab = Array.from(document.querySelectorAll('.tab-bar button, button'))
          .find(b => /map|find|home/i.test(b.textContent));
        if (tab) tab.click();
      }
    });

    // Prepend into the header section so it sits at the very top
    headerSection.insertBefore(btn, headerSection.firstChild);
    console.log('[Lily Pad] Paddashboard back button injected');
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  function startHidingGuard() {
    const root = document.getElementById('root');
    if (!root) return;
    interceptWizardBack(); // one-time capture-phase listener for step-by-step back
    hideUnwantedElements();
    injectSignInButton();
    const guard = new MutationObserver(() => {
      hideUnwantedElements();
      injectSignInButton();
    });
    guard.observe(root, { childList: true, subtree: true });
  }

  function startGuard() {
    if (window.__lpGuardObserver) return;
    const target = document.body;
    const guard = new MutationObserver(() => {
      hideUnwantedElements();
      injectPullDownSignOut();
      updateProfileDisplay();
      updatePhotoFullscreen();
      injectPaddashboardBack();
      removeFakeMapSpots();
    });
    guard.observe(target, { childList: true, subtree: true });
    window.__lpGuardObserver = guard;
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

  // ── After native wizard: prompt user to save real Supabase account ──────────
  function promptNativeUserToRegister() {
    if (!SUPABASE_OK) return;
    if (getSession()) return; // already have a Supabase session

    // Read name / email the native wizard collected
    let fullName = '', email = '';
    try {
      const raw = localStorage.getItem('lilypad.appState.v1');
      if (raw) {
        const state = JSON.parse(raw);
        const dr = state.drAns || {};
        const su = state.suAns || {};
        const biz = state.bizAns || {};
        const first = dr[0] || su[0] || biz[5] || '';
        const last  = dr[1] || su[1] || biz[6] || '';
        email    = dr[2] || su[2] || biz[7] || '';
        fullName = (first + ' ' + last).trim();
      }
    } catch {}

    if (!email) return; // nothing to pre-fill — skip prompt

    // Show the signup form pre-filled
    setTimeout(() => {
      showGate();
      switchForm('form-signup');

      const nameEl  = document.getElementById('signup-name');
      const emailEl = document.getElementById('signup-email');
      if (nameEl  && !nameEl.value)  nameEl.value  = fullName;
      if (emailEl && !emailEl.value) emailEl.value = email;

      // Add a friendly banner so they know why the modal appeared
      const card = document.querySelector('#form-signup .auth-card');
      if (card && !document.getElementById('native-reg-banner')) {
        const banner = document.createElement('p');
        banner.id = 'native-reg-banner';
        banner.style.cssText = 'margin:0 0 12px;font-size:13px;color:rgba(255,255,255,0.7);text-align:center;line-height:1.45';
        banner.textContent = 'Set a password to save your account and access it from any device.';
        card.insertBefore(banner, card.firstChild);
      }
    }, 800);
  }

  function onNativeAuthComplete() {
    console.log('[Lily Pad] Native auth complete');
    hideUnwantedElements();
    startGuard();
    updateProfileDisplay();
    promptNativeUserToRegister();
  }

  async function afterAuth(session) {
    startGuard();
    const role = (session && session.access_token)
      ? await getUserRole(session.access_token)
      : 'renter';
    navigateToMap(role, () => {});
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    startHidingGuard();
    wireSignOut();
    wireAuthForms();
    startGuard();

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
