(function () {
  const SUPABASE_URL     = '%%SUPABASE_URL%%'     || window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = '%%SUPABASE_ANON_KEY%%' || window.__SUPABASE_ANON_KEY__;
  const SUPABASE_OK = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

  // ── Auto-recover from the bundle's ErrorBoundary ────────────────────────────
  // After a deep-page save (e.g. pad drawing) the Leaflet map sometimes throws
  // "Invalid LatLng (NaN, NaN)" which is caught by the bundle's ErrorBoundary.
  // Intercept the console.error it emits and navigate to paddashboard so the
  // user sees a working screen instead of an error message.
  (function () {
    const _ce = console.error.bind(console);
    console.error = function (...args) {
      _ce(...args);
      const msg = String(args[0] || '');
      if (msg.includes('[ErrorBoundary] Caught') || msg.includes('Invalid LatLng')) {
        clearTimeout(window.__lpErrRecoverTimer);
        window.__lpErrRecoverTimer = setTimeout(() => {
          try {
            // Walk fiber to get goTo and navigate to a safe page
            const root = document.getElementById('root');
            if (!root) return;
            const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
            if (!fk) return;
            const q = [root[fk]];
            let n = 0;
            while (q.length && n++ < 600) {
              const f = q.shift();
              if (!f) continue;
              const v = f.memoizedProps && f.memoizedProps.value;
              if (v && typeof v.goTo === 'function') {
                v.goTo('paddashboard');
                console.log('[Lily Pad] ErrorBoundary recovery: navigated to paddashboard');
                return;
              }
              if (f.child)   q.push(f.child);
              if (f.sibling) q.push(f.sibling);
            }
          } catch {}
        }, 400);
      }
    };
  })();

  // ── Block fake pad sample data from ever persisting ─────────────────────────
  // The bundle's "My Pads" host view initialises from a hardcoded e2 array
  // (sample pads like "142 Maple St"). Intercepting localStorage prevents the
  // bundle from reading or re-writing those samples between sessions.
  (function () {
    const PADS_KEY = 'lilypad.pads.v1';
    const _get = Storage.prototype.getItem;
    const _set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === PADS_KEY) return null; // always look empty → bundle stays at []
      return _get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === PADS_KEY) return; // block sample data from being stored
      _set.call(this, key, value);
    };
  })();

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

  // ── Write real user info into the native React app state ─────────────────
  // The bundle derives the Account pull-down name from state.drAns[0,1,2].
  // Calling setState via React fiber injects it without touching the bundle.
  function writeUserToNativeState(firstName, lastName, email) {
    if (!firstName && !email) return;
    // Also persist to localStorage so the bundle picks it up on remount
    try {
      const raw = localStorage.getItem('lilypad.appState.v1');
      const state = raw ? JSON.parse(raw) : {};
      state.drAns = { ...(state.drAns || {}), 0: firstName, 1: lastName, 2: email };
      state.suAns = { ...(state.suAns || {}), 0: firstName, 1: lastName, 2: email };
      localStorage.setItem('lilypad.appState.v1', JSON.stringify(state));
    } catch {}

    // Walk fiber tree to find the global state context and update it live
    const root = document.getElementById('root');
    if (!root) return;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return;
    const queue = [root[fk]];
    let checked = 0;
    while (queue.length && checked < 600) {
      const fiber = queue.shift();
      if (!fiber) continue;
      checked++;
      const mp = fiber.memoizedProps;
      if (mp && mp.value && typeof mp.value.setState === 'function') {
        const v = mp.value;
        if (v.state && typeof v.state === 'object' &&
            ('drAns' in v.state || 'suAns' in v.state || 'accountType' in v.state)) {
          v.setState(prev => ({
            ...prev,
            drAns: { ...(prev.drAns || {}), 0: firstName, 1: lastName, 2: email },
            suAns: { ...(prev.suAns || {}), 0: firstName, 1: lastName, 2: email },
          }));
          console.log('[Lily Pad] Native state name written:', firstName, lastName, email);
          return;
        }
      }
      if (fiber.child)    queue.push(fiber.child);
      if (fiber.sibling)  queue.push(fiber.sibling);
    }
  }

  // ── Clear fake sample pads via React fiber dispatch ───────────────────────
  // The bundle initialises "My Pads" with a hardcoded e2 array of sample pads
  // (address "142 Maple Street" etc.). Walk the fiber tree to find that state
  // and replace it with [] so no fake listings appear.
  // No once-only flag — clearFakePads must re-run after navigation because React
  // remounts the My-Pads component and resets state to the hardcoded e2 array.
  // The address check makes it safe to call repeatedly; it never touches real pads.
  let _clearPadsCooldown = 0;
  function clearFakePads() {
    const now = Date.now();
    if (now - _clearPadsCooldown < 800) return; // throttle: max once per 800 ms
    const root = document.getElementById('root');
    if (!root) return;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return;

    function walk(fiber, depth) {
      if (!fiber || depth > 120) return false;
      let s = fiber.memoizedState;
      while (s) {
        const v = s.memoizedState;
        if (Array.isArray(v) && v.length > 0 && v[0] &&
            (v[0].address === '142 Maple Street' || v[0].id === 1)) {
          const dispatch = s.queue && s.queue.dispatch;
          if (typeof dispatch === 'function') {
            dispatch([]);
            _clearPadsCooldown = now;
            console.log('[Lily Pad] Fake sample pads cleared from My Pads');
            return true;
          }
        }
        s = s.next;
      }
      if (walk(fiber.child,   depth + 1)) return true;
      if (walk(fiber.sibling, depth + 1)) return true;
      return false;
    }
    walk(root[fk], 0);
  }

  // ── Clear fake driver-side listings ──────────────────────────────────────
  // The bundle ships with a hardcoded `ar` array of ~105 Houston parking spots.
  // Drivers see these before any real Supabase listings are loaded.  We clear
  // them by:
  //   1. Patching the useMemo `Q` (nearby-pads array) to [] in the fiber tree
  //   2. Clearing the fake saved-IDs Set (which triggers a React re-render,
  //      causing React to use the [] we wrote into the useMemo cache)
  //   3. DOM-hiding any listing-card component fiber whose memoizedProps carry
  //      {addr:string, price:string, id:number} — the ea-rendered list items
  let _clearListingsCooldown = 0;
  function clearFakeListings() {
    const now = Date.now();
    if (now - _clearListingsCooldown < 400) return;

    const root = document.getElementById('root');
    if (!root) return;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return;

    // helpers
    function isFakeArr(v) {
      return Array.isArray(v) && v.length > 0 && v[0] &&
             typeof v[0].addr === 'string' && typeof v[0].id === 'number';
    }
    function isFakeSet(v) {
      if (!(v instanceof Set) || v.size === 0) return false;
      for (const x of v) { if (typeof x !== 'number' || x > 500) return false; }
      return true;
    }

    let forceRenderDispatch = null;

    function walk(fiber, depth) {
      if (!fiber || depth > 160) return;

      // ── Check this fiber's hooks ────────────────────────────────────────
      let s = fiber.memoizedState;
      while (s) {
        const v = s.memoizedState;

        // useMemo hook: memoizedState = [value, deps]
        if (Array.isArray(v) && v.length === 2 && isFakeArr(v[0])) {
          v[0] = [];   // overwrite the cached memoized value
          _clearListingsCooldown = now;
        }

        // useState Set of fake saved-listing IDs (Set([1,2,3,4,5,…]))
        if (isFakeSet(v)) {
          const dispatch = s.queue && s.queue.dispatch;
          if (typeof dispatch === 'function') {
            dispatch(new Set());
            forceRenderDispatch = dispatch; // this re-render will pick up Q=[]
            _clearListingsCooldown = now;
          }
        }

        s = s.next;
      }

      // ── Check memoizedProps for listing-card component ──────────────────
      // Function components spread ar-item props: {addr, price, id, meta, lat, lng}
      const p = fiber.memoizedProps;
      if (p && typeof p.addr === 'string' && typeof p.price === 'string' &&
          typeof p.id === 'number') {
        // Walk down to find the first host (DOM) element
        let f = fiber;
        while (f && !(f.stateNode instanceof HTMLElement)) f = f.child;
        if (f && f.stateNode instanceof HTMLElement &&
            f.stateNode.style.display !== 'none') {
          f.stateNode.style.display = 'none';
          _clearListingsCooldown = now;
        }
      }

      walk(fiber.child,   depth + 1);
      walk(fiber.sibling, depth + 1);
    }

    walk(root[fk], 0);

    // If we patched useMemo values but the saved-Set dispatch wasn't found,
    // force a re-render through any boolean useState to pick up the patched Q
    if (!forceRenderDispatch) {
      const root2 = document.getElementById('root');
      if (root2 && root2[fk]) {
        (function tryForce(fiber, depth) {
          if (!fiber || depth > 80 || forceRenderDispatch) return;
          let s = fiber.memoizedState;
          while (s) {
            if (typeof s.memoizedState === 'boolean' &&
                s.queue && typeof s.queue.dispatch === 'function') {
              forceRenderDispatch = s.queue.dispatch;
              break;
            }
            s = s.next;
          }
          tryForce(fiber.child,   depth + 1);
          tryForce(fiber.sibling, depth + 1);
        })(root2[fk], 0);
        if (forceRenderDispatch) {
          // flip and immediately restore to trigger re-render without visible change
          const prev = forceRenderDispatch._lpVal;
          forceRenderDispatch(x => { const n = !x; forceRenderDispatch._lpVal = n; return n; });
          setTimeout(() => forceRenderDispatch(x => !x), 0);
        }
      }
    }
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
      // Write real name into native app state so pull-down shows correct name
      const meta = (data.user && data.user.user_metadata) || {};
      const fullN = (meta.full_name || meta.name || '').trim();
      const [fn = '', ...lnParts] = fullN.split(' ');
      writeUserToNativeState(fn, lnParts.join(' '), email);
      hideGate();
      afterAuth(data);
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
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
      if (id === 'forgot-btn') { e.preventDefault(); handleForgot(); return; }

      // Form switchers
      if (id === 'goto-forgot')    switchForm('form-forgot');
      if (id === 'goto-signup')    { hideGate(); return; } // back to home to use native signup
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
      hint.textContent = 'Drag to draw your spot — then drag it again to reposition';
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

  // ── Drag-to-reposition existing pad box ──────────────────────────────────────
  // The bundle's h2 component stores the drawn box as a flat
  // {cx, cy, w, h, angle} normalized (0-1) object in its k useState hook.
  // We intercept canvas pointer events (capture phase, before React) and move
  // the box by dispatching updated cx/cy to the same hook.

  function findH2BoxHook(canvas) {
    const fk = Object.keys(canvas).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    let f = canvas[fk];
    while (f && !(f.stateNode instanceof Document)) {
      let s = f.memoizedState;
      while (s) {
        const v = s.memoizedState;
        // h2's k state: plain object with cx/cy/w/h (not a ref, not array, not bool/number)
        if (v !== null && typeof v === 'object' && !Array.isArray(v) && !('current' in v) &&
            'cx' in v && 'cy' in v && 'w' in v && 'h' in v &&
            s.queue && typeof s.queue.dispatch === 'function') {
          return { box: v, dispatch: s.queue.dispatch };
        }
        s = s.next;
      }
      f = f.return;
    }
    return null;
  }

  function installPadMoveHandlers(canvas) {
    if (canvas.dataset.lpMove) return;
    canvas.dataset.lpMove = '1';

    const cw = canvas.closest('.canvas-wrap') || canvas.parentElement;
    if (getComputedStyle(cw).position === 'static') cw.style.position = 'relative';

    // ── Build overlay controls ──────────────────────────────────────────────
    // 1. Stem + drag-dot (move handle): line + circle extending above the box
    const stemEl = document.createElement('div');
    stemEl.className = 'lp-drag-stem';
    stemEl.innerHTML =
      '<div class="lp-drag-dot" title="Drag to move"></div>' +
      '<div class="lp-stem-line"></div>';
    cw.appendChild(stemEl);
    const dragDot = stemEl.querySelector('.lp-drag-dot');

    // 2. Delete (×) button – top-right, outside box
    const delBtn = document.createElement('div');
    delBtn.className = 'lp-box-delete';
    delBtn.innerHTML = '&times;';
    delBtn.title = 'Delete spot';
    cw.appendChild(delBtn);

    // 3. Corner handles
    const CORNER_DEFS = [
      { id: 'tl', cursor: 'nwse-resize' },
      { id: 'tr', cursor: 'nesw-resize' },
      { id: 'bl', cursor: 'nesw-resize' },
      { id: 'br', cursor: 'nwse-resize' },
    ];
    const handles = {};
    CORNER_DEFS.forEach(({ id, cursor }) => {
      const h = document.createElement('div');
      h.className = 'lp-corner';
      h.dataset.corner = id;
      h.style.cursor = cursor;
      cw.appendChild(h);
      handles[id] = h;
    });

    // ── updateControls: sync all overlay positions from box state ───────────
    function updateControls(box) {
      const show = box && box.w > 0.01;
      stemEl.style.display = show ? 'flex' : 'none';
      delBtn.style.display  = show ? 'flex' : 'none';
      Object.values(handles).forEach(h => { h.style.display = show ? 'block' : 'none'; });
      if (!show) return;

      const { cx, cy, w, h } = box;
      // Stem anchors to top-center of box; CSS translates it upward via translateY(-100%)
      stemEl.style.left = cx * 100 + '%';
      stemEl.style.top  = (cy - h / 2) * 100 + '%';

      // Delete button: top-right corner, offset outward
      delBtn.style.left = (cx + w / 2) * 100 + '%';
      delBtn.style.top  = (cy - h / 2) * 100 + '%';

      // Corners
      const pos = {
        tl: [cx - w / 2, cy - h / 2],
        tr: [cx + w / 2, cy - h / 2],
        bl: [cx - w / 2, cy + h / 2],
        br: [cx + w / 2, cy + h / 2],
      };
      Object.entries(handles).forEach(([id, el]) => {
        el.style.left = pos[id][0] * 100 + '%';
        el.style.top  = pos[id][1] * 100 + '%';
      });
    }

    // Expose so updatePhotoFullscreen can refresh after React redraws
    canvas._lpUpdateHandles = updateControls;

    // ── Helpers ─────────────────────────────────────────────────────────────
    let drag = null;

    function normXY(e) {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? (e.touches[0] || e.changedTouches[0]) : e;
      return { x: (t.clientX - r.left) / r.width, y: (t.clientY - r.top) / r.height };
    }

    // ── Canvas: block new draws while a box exists ───────────────────────────
    // When box is present, prevent the bundle's pointerdown from starting a
    // fresh draw (which would overwrite the existing spot).
    canvas.addEventListener('pointerdown', e => {
      const hook = findH2BoxHook(canvas);
      if (hook && hook.box && hook.box.w > 0.01) {
        e.stopPropagation(); // box exists – block bundle's draw-start handler
      }
    }, true);

    // ── Drag-dot: move entire box ────────────────────────────────────────────
    dragDot.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      dragDot.setPointerCapture(e.pointerId);
      const hook = findH2BoxHook(canvas);
      if (!hook) return;
      const { x, y } = normXY(e);
      drag = { mode: 'move', dispatch: hook.dispatch,
               origCx: hook.box.cx, origCy: hook.box.cy, startX: x, startY: y };
      dragDot.classList.add('grabbing');
    });

    dragDot.addEventListener('pointermove', e => {
      if (!drag || drag.mode !== 'move') return;
      e.stopPropagation();
      const { x, y } = normXY(e);
      const newCx = Math.max(0.04, Math.min(0.96, drag.origCx + x - drag.startX));
      const newCy = Math.max(0.04, Math.min(0.96, drag.origCy + y - drag.startY));
      drag.dispatch(prev => {
        const u = { ...prev, cx: newCx, cy: newCy };
        updateControls(u);
        return u;
      });
    });

    dragDot.addEventListener('pointerup', e => {
      if (!drag || drag.mode !== 'move') return;
      e.stopPropagation();
      drag = null;
      dragDot.classList.remove('grabbing');
    });

    dragDot.addEventListener('pointercancel', () => {
      drag = null;
      dragDot.classList.remove('grabbing');
    });

    // ── Delete button ────────────────────────────────────────────────────────
    delBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      const hook = findH2BoxHook(canvas);
      if (!hook) return;
      // Zero out the box so the bundle treats it as empty
      hook.dispatch(prev => ({ ...prev, cx: 0, cy: 0, w: 0, h: 0, angle: 0 }));
      updateControls(null);
    });

    // ── Corner handles: resize (drag corner; opposite corner stays fixed) ────
    Object.entries(handles).forEach(([id, handle]) => {

      handle.addEventListener('pointerdown', e => {
        e.stopPropagation();
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const hook = findH2BoxHook(canvas);
        if (!hook) return;
        const box = hook.box;
        // Anchor = diagonally opposite corner
        const ax = id.includes('r') ? box.cx - box.w / 2 : box.cx + box.w / 2;
        const ay = id.includes('b') ? box.cy - box.h / 2 : box.cy + box.h / 2;
        drag = { mode: 'resize', dispatch: hook.dispatch,
                 ax, ay, rect: canvas.getBoundingClientRect() };
        handle.classList.add('active');
      });

      handle.addEventListener('pointermove', e => {
        if (!drag || drag.mode !== 'resize') return;
        e.stopPropagation();
        e.preventDefault();
        const nx = Math.max(0.01, Math.min(0.99, (e.clientX - drag.rect.left) / drag.rect.width));
        const ny = Math.max(0.01, Math.min(0.99, (e.clientY - drag.rect.top)  / drag.rect.height));
        const newW = Math.abs(nx - drag.ax);
        const newH = Math.abs(ny - drag.ay);
        if (newW < 0.03 || newH < 0.03) return;
        const newCx = (nx + drag.ax) / 2;
        const newCy = (ny + drag.ay) / 2;
        drag.dispatch(prev => {
          const u = { ...prev, cx: newCx, cy: newCy, w: newW, h: newH };
          updateControls(u);
          return u;
        });
      });

      handle.addEventListener('pointerup', e => {
        if (!drag || drag.mode !== 'resize') return;
        e.stopPropagation();
        drag = null;
        handle.classList.remove('active');
      });

      handle.addEventListener('pointercancel', () => {
        if (drag?.mode === 'resize') drag = null;
        handle.classList.remove('active');
      });
    });

    console.log('[Lily Pad] Pad move + corner-resize + delete controls installed');
  }

  // ── Cancel button for the h2 pad-drawing editing modal ─────────────────────
  // The h2 component receives an onClose prop but renders no visible cancel UI.
  // Walk the fiber tree UP from canvas-wrap to find that prop and call it.
  function injectCanvasCancel() {
    if (document.getElementById('lp-canvas-cancel')) return;
    const cw = document.querySelector('.canvas-wrap');
    if (!cw || !cw.querySelector('canvas')) return;

    // Walk UP the fiber tree from canvas-wrap to find onClose
    let onClose = null;
    const cwKey = Object.keys(cw).find(k => k.startsWith('__reactFiber$'));
    if (cwKey) {
      let f = cw[cwKey];
      let steps = 0;
      while (f && steps++ < 40) {
        const mp = f.memoizedProps;
        if (mp && typeof mp.onClose === 'function') { onClose = mp.onClose; break; }
        f = f.return;
      }
    }

    // Only inject when we found an onClose (i.e. we're in the editing modal,
    // not the wizard photo step which has its own wizard-back navigation).
    if (!onClose) return;

    const btn = document.createElement('button');
    btn.id = 'lp-canvas-cancel';
    btn.textContent = '← Back';
    btn.addEventListener('click', () => {
      exitPhotoFullscreen();
      onClose();
      const el = document.getElementById('lp-canvas-cancel');
      if (el) el.remove();
    });
    document.body.appendChild(btn);
    console.log('[Lily Pad] Canvas cancel button injected');
  }

  function updatePhotoFullscreen() {
    const canvasWrap = document.querySelector('.canvas-wrap');

    // No canvas-wrap in view — clean up
    if (!canvasWrap) {
      if (document.body.classList.contains('lp-photo-fs')) exitPhotoFullscreen();
      const cc = document.getElementById('lp-canvas-cancel');
      if (cc) cc.remove();
      return;
    }

    const img = canvasWrap.querySelector('img[src]');
    const drawCanvas = canvasWrap.querySelector('canvas');

    if (img && drawCanvas) {
      // Photo + drawing canvas present — enter fullscreen, inject cancel btn,
      // and install drag-to-reposition handlers on the canvas element.
      enterPhotoFullscreen();
      injectCanvasCancel();
      installPadMoveHandlers(drawCanvas);
      // Keep corner handles in sync on every DOM mutation (React redraws, state changes)
      if (typeof drawCanvas._lpUpdateHandles === 'function') {
        const hook = findH2BoxHook(drawCanvas);
        drawCanvas._lpUpdateHandles(hook ? hook.box : null);
      }
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

  // ── Deep-page back button ─────────────────────────────────────────────────
  // Pages like "availability" and "payment" are sub-pages of paddashboard but
  // the bundle renders them without a back button. We inject one by reading the
  // current page name from the React fiber tree and using the context's goTo().
  const LP_BACK_TARGETS = {
    availability   : 'paddashboard',
    payment        : 'paddashboard',
    photo          : 'paddashboard',
    photointro     : 'paddashboard',
    addpad         : 'paddashboard',
    account        : 'paddashboard',  // pad detail / edit opened from My Pads
    billing        : 'paddashboard',
    confirm        : 'paddashboard',
    bookings       : 'find',
    driveraccount  : 'find',          // driver viewing a listing
    feedback       : 'find',
    support        : 'find',
    admin          : 'find',
    reinstate      : 'admin',
    verify         : 'admin',
    unverify       : 'admin',
    suspend        : 'admin',
  };
  const LP_ALL_PAGES = new Set([
    'home','find','root','paddashboard','bookings','payment',
    'availability','photo','photointro','addpad',
    'signup','driversignup','bizsignup','padtype','admin',
    'account','billing','confirm','driveraccount',
    'feedback','support','reinstate','verify','unverify','suspend',
  ]);
  let _lpGoToFn   = null;  // cached from fiber; invalidated on back-click
  let _lpLastPage = null;
  let _lpBackTmr  = null;

  function lpGetGoTo() {
    if (_lpGoToFn) return _lpGoToFn;
    const root = document.getElementById('root');
    if (!root) return null;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    const q = [root[fk]];
    let n = 0;
    while (q.length && n++ < 600) {
      const f = q.shift();
      if (!f) continue;
      const v = f.memoizedProps && f.memoizedProps.value;
      if (v && typeof v.goTo === 'function') { _lpGoToFn = v.goTo; return _lpGoToFn; }
      if (f.child)   q.push(f.child);
      if (f.sibling) q.push(f.sibling);
    }
    return null;
  }

  function lpGetCurrentPage() {
    const root = document.getElementById('root');
    if (!root) return null;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    const q = [root[fk]];
    let n = 0;
    while (q.length && n++ < 800) {
      const f = q.shift();
      if (!f) continue;
      let s = f.memoizedState;
      while (s) {
        if (typeof s.memoizedState === 'string' && LP_ALL_PAGES.has(s.memoizedState))
          return s.memoizedState;
        s = s.next;
      }
      if (f.child)   q.push(f.child);
      if (f.sibling) q.push(f.sibling);
    }
    return null;
  }

  function removeDeepBackBtn() {
    const el = document.getElementById('lp-deep-back');
    if (el) el.remove();
  }

  function injectDeepBackButton() {
    const goTo = lpGetGoTo();
    if (!goTo) return;

    const page = lpGetCurrentPage();
    if (!page) return;

    // Clear stale button whenever the page has changed
    if (page !== _lpLastPage) {
      removeDeepBackBtn();
      _lpLastPage = page;
    }

    const target = LP_BACK_TARGETS[page];
    if (!target) return; // not a page that needs an injected back btn

    // Already injected for this page
    if (document.getElementById('lp-deep-back')) return;

    // The bundle's own back button on addpad navigates to 'signup' for existing
    // pads instead of 'paddashboard', so we hide it and inject our own which
    // always uses the correct LP_BACK_TARGETS destination.
    document.querySelectorAll('.s-nav:not(#lp-deep-back) .back-btn').forEach(el => {
      el.style.visibility = 'hidden';
      el.style.pointerEvents = 'none';
    });

    // Find best anchor — prefer the active page container
    const anchor = document.querySelector('.page.active') ||
                   document.querySelector('.s-body') ||
                   document.getElementById('root');
    if (!anchor) return;

    // Build an element that mirrors the bundle's native .s-nav / .back-btn structure
    // so the bundle's own CSS styles it consistently with other back buttons.
    const nav = document.createElement('div');
    nav.id        = 'lp-deep-back';
    nav.className = 's-nav';

    const btn = document.createElement('button');
    btn.className = 'back-btn';
    btn.innerHTML = '<span class="back-lbl">Back</span>';
    btn.addEventListener('click', () => {
      _lpGoToFn = null; // invalidate cache — context may have been recreated
      const fresh = lpGetGoTo();
      if (fresh) fresh(target);
      setTimeout(removeDeepBackBtn, 300);
    });

    nav.appendChild(btn);
    anchor.insertBefore(nav, anchor.firstChild);
    console.log('[Lily Pad] Deep back injected:', page, '→', target);
  }

  function scheduleDeepBack() {
    clearTimeout(_lpBackTmr);
    _lpBackTmr = setTimeout(injectDeepBackButton, 180);
  }

  // ── Photo lightbox: full-size pad photo + box drawing ───────────────────────
  // Clicking any pad-photo thumbnail (lister dashboard or driver listing view)
  // opens a modal with the full image and the drawn spot overlaid on a canvas.
  // On the lister side, "Redraw" and "Change Photo" buttons hook back into the
  // native bundle flow via the p2 component's onEdit / onReplacePhoto props.

  function getPadPropsFromEl(el) {
    // Walk fiber UP from el to find the p2 component's {pad, onEdit, onReplacePhoto} props.
    // Only require photoUrl — box may be absent for pads that haven't had a spot drawn yet.
    const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    let f = el[fk];
    let depth = 0;
    while (f && !(f.stateNode instanceof Document) && depth++ < 80) {
      const p = f.memoizedProps;
      if (p && p.pad && typeof p.pad.photoUrl === 'string' && p.pad.photoUrl) {
        return { pad: p.pad, onEdit: p.onEdit || null, onReplacePhoto: p.onReplacePhoto || null };
      }
      f = f.return;
    }
    return null;
  }

  function drawBoxOnLightboxCanvas(canvas, box, color, name) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!box || box.w < 0.01 || box.h < 0.01) return;

    const cx = box.cx * W, cy = box.cy * H;
    const bw = box.w * W, bh = box.h * H;
    const angle = box.angle || 0;
    const r = parseInt(color.slice(1, 3), 16) || 141;
    const g = parseInt(color.slice(3, 5), 16) || 214;
    const b = parseInt(color.slice(5, 7), 16) || 63;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Box fill + border
    ctx.fillStyle = `rgba(${r},${g},${b},0.22)`;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, W * 0.004);
    const rad = 6;
    ctx.beginPath();
    ctx.moveTo(-bw/2 + rad, -bh/2);
    ctx.lineTo(bw/2 - rad, -bh/2);
    ctx.arcTo(bw/2, -bh/2, bw/2, -bh/2 + rad, rad);
    ctx.lineTo(bw/2, bh/2 - rad);
    ctx.arcTo(bw/2, bh/2, bw/2 - rad, bh/2, rad);
    ctx.lineTo(-bw/2 + rad, bh/2);
    ctx.arcTo(-bw/2, bh/2, -bw/2, bh/2 - rad, rad);
    ctx.lineTo(-bw/2, -bh/2 + rad);
    ctx.arcTo(-bw/2, -bh/2, -bw/2 + rad, -bh/2, rad);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Name badge
    const badgeW = Math.min(120, bw * 0.65), badgeH = 22;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-bw/2, -bh/2, badgeW, badgeH, 3);
    ctx.fill();
    const fs = Math.max(12, W * 0.022);
    ctx.fillStyle = '#142A52';
    ctx.font = `bold ${fs}px "DM Sans", sans-serif`;
    ctx.fillText(name || 'Pad', -bw/2 + 6, -bh/2 + fs * 0.88);

    ctx.restore();
  }

  function closeLightbox() {
    const lb = document.getElementById('lp-lightbox');
    if (lb) { lb.classList.remove('open'); setTimeout(() => lb.remove(), 220); }
  }

  function openPhotoLightbox({ photoUrl, box, color, name, isLister, onEdit, onReplacePhoto }) {
    closeLightbox();
    const lb = document.createElement('div');
    lb.id = 'lp-lightbox';
    lb.innerHTML = `
      <div id="lp-lb-backdrop"></div>
      <div id="lp-lb-modal">
        <div id="lp-lb-header">
          <span id="lp-lb-title">${name || ''}</span>
          <button id="lp-lb-x" aria-label="Close">✕</button>
        </div>
        <div id="lp-lb-wrap">
          <img id="lp-lb-img" src="${photoUrl}" alt="${name || 'Pad photo'}" />
          <canvas id="lp-lb-canvas"></canvas>
        </div>
        <div id="lp-lb-actions">
          ${isLister ? `
            <button class="lp-lb-btn lp-lb-primary" id="lp-lb-redraw">✎ Redraw spot</button>
            <button class="lp-lb-btn lp-lb-secondary" id="lp-lb-newphoto">📷 Change photo</button>
          ` : ''}
          <button class="lp-lb-btn lp-lb-ghost" id="lp-lb-close">Close</button>
        </div>
        ${isLister ? '<input type="file" id="lp-lb-file" accept="image/*" style="display:none">' : ''}
      </div>`;
    document.body.appendChild(lb);
    requestAnimationFrame(() => lb.classList.add('open'));

    // Close via explicit buttons only — backdrop tap intentionally does NOT close
    // (avoids accidental dismissal when the user taps around the photo)
    lb.querySelector('#lp-lb-x').addEventListener('click', closeLightbox);
    lb.querySelector('#lp-lb-close').addEventListener('click', closeLightbox);

    // Draw box after image loads — canvas matched to the displayed 3:2 area
    const img = lb.querySelector('#lp-lb-img');
    const canvas = lb.querySelector('#lp-lb-canvas');
    function render() {
      const wrap = lb.querySelector('#lp-lb-wrap');
      if (!wrap) return;
      canvas.width  = wrap.offsetWidth  || img.naturalWidth  || 360;
      canvas.height = wrap.offsetHeight || img.naturalHeight || 240;
      drawBoxOnLightboxCanvas(canvas, box, color || '#8DD63F', name);
    }
    if (img.complete && img.naturalWidth) render();
    else img.addEventListener('load', render);
    const ro = new ResizeObserver(render);
    ro.observe(img);
    lb._ro = ro;

    // Lister actions
    if (isLister) {
      const redrawBtn  = lb.querySelector('#lp-lb-redraw');
      const photoBtn   = lb.querySelector('#lp-lb-newphoto');
      const fileInput  = lb.querySelector('#lp-lb-file');

      if (redrawBtn && typeof onEdit === 'function') {
        redrawBtn.addEventListener('click', () => { closeLightbox(); setTimeout(onEdit, 150); });
      }

      if (photoBtn && fileInput) {
        photoBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result;
            // Resize to max 1200px before handing off (matches p2's ce() function)
            const tmpImg = new Image();
            tmpImg.onload = () => {
              let w = tmpImg.naturalWidth, h = tmpImg.naturalHeight;
              if (w > 1200 || h > 1200) {
                const s = Math.min(1200 / w, 1200 / h);
                w = Math.round(w * s); h = Math.round(h * s);
              }
              const c = document.createElement('canvas');
              c.width = w; c.height = h;
              c.getContext('2d').drawImage(tmpImg, 0, 0, w, h);
              const out = (() => { try { return c.toDataURL('image/jpeg', 0.82); } catch { return dataUrl; } })();
              if (typeof onReplacePhoto === 'function') onReplacePhoto(out);
              closeLightbox();
            };
            tmpImg.onerror = () => { if (typeof onReplacePhoto === 'function') onReplacePhoto(dataUrl); closeLightbox(); };
            tmpImg.src = dataUrl;
          };
          reader.readAsDataURL(file);
        });
      }
    }
  }

  function lpAddZoomBadge(container) {
    if (container.querySelector('.lp-zoom-badge')) return;
    const badge = document.createElement('div');
    badge.className = 'lp-zoom-badge';
    badge.textContent = '⊕ Tap to enlarge';
    container.appendChild(badge);
  }

  function installPhotoClickHandlers() {
    // ── 1. LISTER: p2 pad-cards — <img> inside the SVG-overlay container ──────
    // The p2 component always renders svg[viewBox="0 0 100 70"] next to the img.
    document.querySelectorAll('svg[viewBox="0 0 100 70"]').forEach(svg => {
      const wrap = svg.parentElement;
      if (!wrap || wrap.dataset.lpLb) return;
      const img = wrap.querySelector('img');
      if (!img || !img.src) return;

      // Fiber walk for pad props; fall back to raw img.src if not found
      const data      = getPadPropsFromEl(img);
      const photoUrl  = (data && data.pad && data.pad.photoUrl) || img.src;
      if (!photoUrl) return;

      wrap.dataset.lpLb = '1';
      wrap.style.cursor = 'zoom-in';
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      lpAddZoomBadge(wrap);

      wrap.addEventListener('click', e => {
        e.stopPropagation();
        const latest    = getPadPropsFromEl(img) || data || {};
        const pad       = (latest && latest.pad) || {};
        const page      = lpGetCurrentPage();
        const isLister  = page === 'paddashboard' || page === 'addpad' ||
                          page === 'photo'        || page === 'photointro';
        openPhotoLightbox({
          photoUrl:       pad.photoUrl || img.src,
          box:            pad.box,
          color:          pad.color,
          name:           pad.name,
          isLister,
          onEdit:         latest.onEdit  || null,
          onReplacePhoto: latest.onReplacePhoto || null,
        });
      });
    });

    // ── 2. DRIVER: background-image photo divs (detail & booking card views) ──
    // The bundle renders pad photos as:
    //   <div style="height:180; background:url(photoUrl) center/cover, #ddd">
    //   <div style="height:130; background:url(photoUrl) center/cover, ...">
    // These are NOT <img> elements so the SVG selector misses them entirely.
    document.querySelectorAll('div[style*="url("]').forEach(div => {
      if (div.dataset.lpLb) return;
      // Skip Leaflet map tiles and other non-photo elements
      if (div.closest('.leaflet-tile-container,.leaflet-layer,.leaflet-pane,[class*="leaflet"]')) return;
      const bg = div.style.background || div.style.backgroundImage || '';
      const urlMatch = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!urlMatch) return;
      const photoUrl = urlMatch[1];
      // Only data URLs or http(s) URLs — skip map tiles and SVG icons
      if (!photoUrl.startsWith('http') && !photoUrl.startsWith('data:image')) return;
      // Must have a meaningful physical height (photos are 130-180px min)
      const h = div.offsetHeight || div.getBoundingClientRect().height;
      if (h < 60) return;

      div.dataset.lpLb = '1';
      div.style.cursor = 'zoom-in';
      if (!div.style.position || div.style.position === 'static') div.style.position = 'relative';
      lpAddZoomBadge(div);

      div.addEventListener('click', e => {
        e.stopPropagation();
        // Re-read URL in case React has updated it (e.g. photo was changed)
        const freshBg  = div.style.background || div.style.backgroundImage || '';
        const freshUrl = (freshBg.match(/url\(["']?([^"')]+)["']?\)/) || [])[1] || photoUrl;
        openPhotoLightbox({ photoUrl: freshUrl, box: null, name: '', isLister: false });
      });
    });
  }

  function enlargePadCards() {
    // The p2 component renders pad photo containers with viewBox="0 0 100 70"
    // SVGs (10:7 ratio).  Bump them to 3:2 by widening the parent container's
    // aspect-ratio so the thumbnails are noticeably larger and easier to read.
    document.querySelectorAll('svg[viewBox="0 0 100 70"]').forEach(svg => {
      const wrap = svg.parentElement;
      if (!wrap || wrap.dataset.lpEnlarged) return;
      wrap.dataset.lpEnlarged = '1';
      wrap.style.aspectRatio = '3 / 2';
    });
  }

  function startGuard() {
    if (window.__lpGuardObserver) return;
    const target = document.body;
    const guard = new MutationObserver(() => {
      hideUnwantedElements();
      injectPullDownSignOut();
      updateProfileDisplay();
      updatePhotoFullscreen();
      scheduleDeepBack();
      removeFakeMapSpots();
      clearFakePads();
      clearFakeListings();
      installPhotoClickHandlers();
      enlargePadCards();
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
        injectPullDownSignOut();
        updateProfileDisplay();
      }
    }, 8000);
  }

  // ── Real-time wizard input capture ──────────────────────────────────────────
  // Intercepts email + password as the user types in the native wizard forms.
  // More reliable than reading from localStorage alone (password may be cleared).
  const _wiz = { email: '', password: '', name: '' };

  function _attachWizardInputListeners() {
    document.querySelectorAll('input[type="email"]').forEach(el => {
      if (el.__lpWired) return;
      el.__lpWired = true;
      const id = el.id || '';
      if (id.startsWith('login') || id.startsWith('forgot')) return; // skip our overlay
      el.addEventListener('input', () => {
        if (el.value && !id.startsWith('login') && !id.startsWith('forgot')) {
          _wiz.email = el.value.trim();
          console.log('[Lily Pad] wizard email captured');
        }
      });
    });
    document.querySelectorAll('input[type="password"]').forEach(el => {
      if (el.__lpWired) return;
      el.__lpWired = true;
      const id = el.id || '';
      if (id.startsWith('login') || id.startsWith('forgot') || id.startsWith('signup')) return;
      el.addEventListener('input', () => {
        if (el.value) {
          _wiz.password = el.value;
          console.log('[Lily Pad] wizard password captured');
        }
      });
    });
    document.querySelectorAll('input[type="text"]').forEach(el => {
      if (el.__lpWired) return;
      el.__lpWired = true;
      const id = el.id || '';
      if (id.startsWith('login') || id.startsWith('signup') || id.startsWith('forgot')) return;
      el.addEventListener('input', () => {
        if (el.value) _wiz.name = (_wiz.name + ' ' + el.value.trim()).trim();
      });
    });
  }

  function startWizardInputCapture() {
    _attachWizardInputListeners();
    const obs = new MutationObserver(_attachWizardInputListeners);
    const root = document.getElementById('root');
    if (root) obs.observe(root, { childList: true, subtree: true });
  }

  // ── Poll localStorage every 500 ms for completed wizard state ──────────────
  // Replaces the MutationObserver approach which did not fire on Railway.
  function startWizardPoller() {
    if (!SUPABASE_OK) {
      console.warn('[Lily Pad] poller: SUPABASE_OK false, skipping');
      return;
    }

    let attempts = 0;
    const MAX_ATTEMPTS = 720; // 6 minutes max

    const iv = setInterval(() => {
      attempts++;

      // Stop if we already have a session
      if (getSession()) {
        console.log('[Lily Pad] poller: session found, stopping');
        clearInterval(iv);
        return;
      }

      // Stop after timeout
      if (attempts >= MAX_ATTEMPTS) {
        console.warn('[Lily Pad] poller: timed out after 6 min');
        clearInterval(iv);
        return;
      }

      // Read state
      let raw;
      try { raw = localStorage.getItem('lilypad.appState.v1'); } catch { return; }
      if (!raw) return;

      let state;
      try { state = JSON.parse(raw); } catch { return; }

      const dr  = state.drAns  || {};
      const su  = state.suAns  || {};
      const biz = state.bizAns || {};

      // Email at index 2 for driver/host, index 7 for business
      const email = (
        dr[2] || dr['2'] || su[2] || su['2'] || biz[7] || biz['7'] || ''
      ).trim();

      // Password indices per wizard:
      //   Driver   (Lr array,  X1=5): drAns[5]
      //   Host     ($a array,  km=4): drAns[4]  (set via ns())
      //   Business (wm=9)           : bizAns[9]
      const password = (
        dr[5] || dr['5'] || dr[4] || dr['4'] ||
        su[5] || su['5'] || su[4] || su['4'] ||
        biz[9] || biz['9'] || ''
      ).trim();

      // Fall back to DOM-captured credentials
      const finalEmail    = email    || _wiz.email;
      const finalPassword = password || _wiz.password;

      if (!finalEmail || !finalPassword) return; // wizard not finished yet

      // We have what we need — stop polling and register
      clearInterval(iv);

      const first = (dr[0] || dr['0'] || su[0] || su['0'] || biz[5] || biz['5'] || '').trim();
      const last  = (dr[1] || dr['1'] || su[1] || su['1'] || biz[6] || biz['6'] || '').trim();
      const fullName    = ((first + ' ' + last).trim() || _wiz.name || 'Lily Pad User');
      const accountType = (state.accountType === 'padRenter') ? 'padRenter' : 'renter';

      console.log('[Lily Pad] poller: wizard complete — email:', finalEmail, '| accountType:', accountType, '| attempt:', attempts);

      fetch('/api/auth/signup', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          email       : finalEmail,
          password    : finalPassword,
          full_name   : fullName,
          account_type: accountType,
        }),
      })
        .then(r => r.json())
        .then(data => {
          console.log('[Lily Pad] poller signup response:', JSON.stringify(data).slice(0, 200));
          if (data.session && data.session.access_token) {
            saveSession(data.session);
            saveProfileToServer(data.session);
            // Write real name/email into native state for pull-down display
            const [pfn = '', ...pln] = fullName.split(' ');
            writeUserToNativeState(pfn, pln.join(' '), finalEmail);
            setTimeout(updateProfileDisplay, 600);
            setTimeout(clearFakePads, 800);
            console.log('[Lily Pad] poller: account created + session saved for', finalEmail);
          } else if (data.error) {
            console.warn('[Lily Pad] poller signup error:', data.error);
          }
        })
        .catch(err => console.error('[Lily Pad] poller fetch failed:', err.message));

    }, 500);

    console.log('[Lily Pad] poller started (500 ms interval)');
  }

  async function afterAuth(session) {
    startGuard();
    const role = (session && session.access_token)
      ? await getUserRole(session.access_token)
      : 'renter';

    // Write real name into native app state for the Account pull-down
    const meta = (session && session.user_metadata) ||
                 (session && session.user && session.user.user_metadata) || {};
    const email = (session && session.email) ||
                  (session && session.user && session.user.email) || '';
    const fullN = (meta.full_name || meta.name || '').trim();
    const [fn = '', ...lnParts] = fullN.split(' ');
    if (fn || email) {
      // Retry until the React tree is ready (navigation may still be in progress)
      let tries = 0;
      const tryWrite = () => {
        writeUserToNativeState(fn, lnParts.join(' '), email);
        updateProfileDisplay();
        clearFakePads();
        if (++tries < 6) setTimeout(tryWrite, 800);
      };
      setTimeout(tryWrite, 400);
    }

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

    startWizardInputCapture();
    startWizardPoller();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
