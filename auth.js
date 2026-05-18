(function () {
  const LP_BUILD = 'LP-2026-05-18-D6';   // bump each deploy to confirm cache bust
  console.log('[Lily Pad] auth.js build:', LP_BUILD);

  const SUPABASE_URL     = '%%SUPABASE_URL%%'     || window.__SUPABASE_URL__;
  const SUPABASE_ANON_KEY = '%%SUPABASE_ANON_KEY%%' || window.__SUPABASE_ANON_KEY__;
  const SUPABASE_OK = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

  // ── Current user role cache (admin | staff | padRenter | renter | customer) ─
  let _lpCurrentRole = localStorage.getItem('lp_role_cache') || 'customer';

  async function _fetchAndCacheRole(userId) {
    try {
      const r = await fetch(`/api/profile/${userId}`);
      if (r.ok) {
        const p = await r.json();
        if (p && p.account_type) {
          _lpCurrentRole = p.account_type;
          localStorage.setItem('lp_role_cache', p.account_type);
          console.log('[LP] Role cached:', _lpCurrentRole);
        }
      }
    } catch {}
  }

  // ── Block fake admin-users data from localStorage ────────────────────────
  // The bundle persists all users (including the hardcoded demo users with
  // numeric ids 1-N) to "lilypad.admin.users.v1".  Intercept reads/writes to
  // strip any user whose id is a plain number; real Supabase users have UUID
  // strings.  This runs before React hydrates so no fake pads ever load.
  (function patchAdminUsersStorage() {
    const KEY = 'lilypad.admin.users.v1';
    function isFake(u) { return u && typeof u.id === 'number'; }
    function clean(arr) { return Array.isArray(arr) ? arr.filter(u => !isFake(u)) : arr; }

    // Clean existing entry immediately
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.some(isFake)) {
          localStorage.setItem(KEY, JSON.stringify(clean(data)));
        }
      }
    } catch (_) {}

    // Intercept future writes
    const _origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === KEY) {
        try {
          const data = JSON.parse(value);
          if (Array.isArray(data) && data.some(isFake)) {
            return _origSet.call(this, key, JSON.stringify(clean(data)));
          }
        } catch (_) {}
      }
      return _origSet.call(this, key, value);
    };
  })();

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
  // All bundle-hardcoded pads/spots use numeric IDs (1, 2, 3…).
  // Real user-created pads use UUID strings.  Any item with typeof id === 'number'
  // is guaranteed to be demo/fake data and is silently discarded everywhere.
  const _LP_PADS_KEY = 'lilypad.pads.v1';
  const _lpRawGet    = Storage.prototype.getItem; // unpatched getter

  // Helper: is this array full of real (UUID-id) items?
  function _lpOnlyReal(arr) {
    if (!Array.isArray(arr)) return arr;
    return arr.filter(p => p && typeof p.id !== 'number');
  }

  // ── One-time nuclear localStorage sweep ──────────────────────────────────
  // Runs immediately on page load — before React hydrates — and removes every
  // numeric-id item from every lilypad.* localStorage key.
  // Also force-clears keys known to hold fake staff/customer demo data.
  (function _nukeFakeLocalStorage() {
    const FORCE_EMPTY_KEYS = [
      'lilypad.admin.users.v1',
      'lilypad.staff.v1',
      'lilypad.customers.v1',
      'lilypad.team.v1',
      'lilypad.users.v1',
    ];
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      for (const key of keys) {
        if (!key || !key.startsWith('lilypad.')) continue;
        const raw = _lpRawGet.call(localStorage, key);
        if (!raw) continue;
        let data;
        try { data = JSON.parse(raw); } catch { continue; }
        if (Array.isArray(data)) {
          const cleaned = _lpOnlyReal(data);
          if (cleaned.length < data.length) {
            // Always write back (even empty []) so the bundle never falls back to
            // its hardcoded initial state when it reads an absent key.
            Storage.prototype.setItem.call(localStorage, key, JSON.stringify(cleaned));
            console.log(`[LP] Purged ${data.length - cleaned.length} fake entries from ${key}`);
          }
        } else if (data && typeof data === 'object') {
          // appState.v1 embeds arrays under various keys — clean those too
          let dirty = false;
          for (const k of Object.keys(data)) {
            if (Array.isArray(data[k])) {
              const cleaned = _lpOnlyReal(data[k]);
              if (cleaned.length < data[k].length) { data[k] = cleaned; dirty = true; }
            }
          }
          if (dirty) Storage.prototype.setItem.call(localStorage, key, JSON.stringify(data));
        }
      }
      // Force-clear known fake-data keys to [] regardless
      for (const key of FORCE_EMPTY_KEYS) {
        const raw = _lpRawGet.call(localStorage, key);
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          if (Array.isArray(data) && data.length > 0 && data.some(u => typeof u.id === 'number')) {
            Storage.prototype.setItem.call(localStorage, key, '[]');
            console.log(`[LP] Force-cleared fake data from ${key}`);
          }
        } catch {}
      }
    } catch (e) { console.warn('[LP] nukeFakeLocalStorage error', e); }
  })();

  // ── Pre-seed lilypad.pads.v1 with [] if absent ───────────────────────────
  // If the key is missing entirely the bundle falls back to its hardcoded fake
  // pads at React init time.  Writing an empty array before React runs stops
  // that fallback from triggering.
  (function () {
    const existing = _lpRawGet.call(localStorage, _LP_PADS_KEY);
    if (!existing) {
      Storage.prototype.setItem.call(localStorage, _LP_PADS_KEY, '[]');
      console.log('[LP] Pre-seeded lilypad.pads.v1 with []');
    }
  })();

  // ── Intercept lilypad.pads.v1 on every future read/write ─────────────────
  // Ensures fake pads can never re-enter storage even after a hot-reload.
  // IMPORTANT: return '[]' (not null) when all entries are fake — returning
  // null makes the bundle treat the key as absent and load its hardcoded fakes.
  (function () {
    const _set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key !== _LP_PADS_KEY) return _lpRawGet.call(this, key);
      const raw = _lpRawGet.call(this, key);
      if (!raw) return '[]';
      try {
        const real = _lpOnlyReal(JSON.parse(raw));
        return JSON.stringify(real);   // always return valid JSON, even '[]'
      } catch { return '[]'; }
    };
    Storage.prototype.setItem = function (key, value) {
      if (key !== _LP_PADS_KEY) { _set.call(this, key, value); return; }
      try {
        const real = _lpOnlyReal(JSON.parse(value));
        _set.call(this, key, JSON.stringify(real));  // write even if empty
      } catch {}
    };
  })();

  // ── Poison the fake parking-spots array (ar[]) at the prototype level ───────
  // The bundle initialises ar[] as a literal with ~105 items shaped like:
  //   {id:number, addr:string, lat:number, lng:number, price:string, meta:string}
  // Every time a map or listing component re-renders it calls ar.filter(…) or
  // ar.map(…) to compute nearby spots.  By intercepting those calls and returning
  // [] whenever the receiver looks like ar[], fake spots NEVER reach React state
  // or the DOM — regardless of zooming, re-renders, or component remounts.
  // Real Supabase listings use UUID string ids so isFakeSpotArr() stays false.
  (function () {
    function isFakeSpotArr(arr) {
      if (!arr || arr.length === 0) return false;
      const i = arr[0];
      return i && typeof i === 'object' &&
             typeof i.id     === 'number' && i.id < 5000 &&
             typeof i.addr   === 'string' &&
             typeof i.lat    === 'number' &&
             typeof i.lng    === 'number';
    }
    const _filter  = Array.prototype.filter;
    const _map     = Array.prototype.map;
    const _forEach = Array.prototype.forEach;
    const _reduce  = Array.prototype.reduce;
    const _find    = Array.prototype.find;
    const _some    = Array.prototype.some;
    const _every   = Array.prototype.every;
    const _flat    = Array.prototype.flat;
    const _flatMap = Array.prototype.flatMap;

    Array.prototype.filter  = function (fn, ctx)   { if (isFakeSpotArr(this)) return []; return _filter.call(this, fn, ctx); };
    Array.prototype.map     = function (fn, ctx)   { if (isFakeSpotArr(this)) return []; return _map.call(this, fn, ctx); };
    Array.prototype.forEach = function (fn, ctx)   { if (isFakeSpotArr(this)) return;    return _forEach.call(this, fn, ctx); };
    Array.prototype.find    = function (fn, ctx)   { if (isFakeSpotArr(this)) return undefined; return _find.call(this, fn, ctx); };
    Array.prototype.some    = function (fn, ctx)   { if (isFakeSpotArr(this)) return false;     return _some.call(this, fn, ctx); };
    Array.prototype.every   = function (fn, ctx)   { if (isFakeSpotArr(this)) return true;      return _every.call(this, fn, ctx); };
    Array.prototype.flat    = function (...a)       { if (isFakeSpotArr(this)) return [];        return _flat.apply(this, a); };
    Array.prototype.flatMap = function (fn, ctx)   { if (isFakeSpotArr(this)) return [];        return _flatMap.call(this, fn, ctx); };
    Array.prototype.reduce  = function (fn, ...rest) {
      if (isFakeSpotArr(this)) return rest.length ? rest[0] : undefined;
      return rest.length ? _reduce.call(this, fn, rest[0]) : _reduce.call(this, fn);
    };
    console.log('[Lily Pad] ar[] prototype intercepts installed');
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

  // ── Read real user data from Supabase session (preferred) or native state ─
  function getUserData() {
    // Supabase session is authoritative — check it first so drAns/suAns (which
    // may contain stale bundle-demo values) never shadow the real account name.
    const session = getSession();
    if (session) {
      const meta  = (session.user && session.user.user_metadata)
                 || session.user_metadata || {};
      const email = (session.user && session.user.email) || session.email || '';
      const name  = (meta.full_name || meta.name || '').trim();
      if (name || email) {
        const [firstName = '', ...rest] = name.split(' ');
        return { firstName, lastName: rest.join(' '), fullName: name, email };
      }
    }
    // Fallback: native app state written by writeUserToNativeState
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
    return null;
  }

  // ── Write real user info into the native React app state ─────────────────
  // The bundle derives the Account pull-down name from state.drAns[0,1,2].
  // Calling setState via React fiber injects it without touching the bundle.
  function writeUserToNativeState(firstName, lastName, email) {
    if (!firstName && !email) return;
    console.log('[Lily Pad] writeUserToNativeState:', firstName, lastName, email);
    // Persist to localStorage so the bundle picks it up on remount
    try {
      const raw = localStorage.getItem('lilypad.appState.v1');
      const state = raw ? JSON.parse(raw) : {};
      state.drAns = { ...(state.drAns || {}), 0: firstName, 1: lastName, 2: email };
      state.suAns = { ...(state.suAns || {}), 0: firstName, 1: lastName, 2: email };
      localStorage.setItem('lilypad.appState.v1', JSON.stringify(state));
    } catch {}

    // Walk fiber tree — two strategies:
    // A) Context provider whose value.setState manages app state (original approach)
    // B) Any useState/useReducer hook whose state object contains drAns or suAns
    const root = document.getElementById('root');
    if (!root) return;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return;
    const queue = [root[fk]];
    let checked = 0;
    while (queue.length && checked < 800) {
      const fiber = queue.shift();
      if (!fiber) continue;
      checked++;

      // Strategy A: context provider with value.setState
      for (const propsKey of ['memoizedProps', 'pendingProps']) {
        const mp = fiber[propsKey];
        if (mp && mp.value && typeof mp.value.setState === 'function') {
          const v = mp.value;
          if (v.state && typeof v.state === 'object' &&
              ('drAns' in v.state || 'suAns' in v.state || 'accountType' in v.state)) {
            v.setState(prev => ({
              ...prev,
              drAns: { ...(prev.drAns || {}), 0: firstName, 1: lastName, 2: email },
              suAns: { ...(prev.suAns || {}), 0: firstName, 1: lastName, 2: email },
            }));
            console.log('[Lily Pad] Native state written (ctx setState) after', checked, 'fibers');
            return;
          }
        }
      }

      // Strategy B: useState/useReducer hook holding drAns/suAns object directly
      let ms = fiber.memoizedState;
      while (ms) {
        const v = ms.memoizedState;
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Set) &&
            ('drAns' in v || 'suAns' in v || 'accountType' in v)) {
          const dispatch = ms.queue && ms.queue.dispatch;
          if (typeof dispatch === 'function') {
            dispatch(prev => ({
              ...prev,
              drAns: { ...(prev.drAns || {}), 0: firstName, 1: lastName, 2: email },
              suAns: { ...(prev.suAns || {}), 0: firstName, 1: lastName, 2: email },
            }));
            console.log('[Lily Pad] Native state written (hook dispatch) after', checked, 'fibers');
            return;
          }
        }
        ms = ms.next;
      }

      if (fiber.child)   queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }
    console.log('[Lily Pad] writeUserToNativeState: no fiber found after', checked, 'nodes (localStorage only)');
  }

  // ── Clear fake admin users and driver spots from React state ─────────────
  // Clears hardcoded fake users from the lister admin state.
  // The bundle initialises "lilypad.admin.users.v1" with demo users whose ids
  // are plain numbers (1, 2, 3…).  Real Supabase users always have UUID strings.
  // We dispatch a reducer that keeps only UUID-id'd users, leaving the signed-in
  // user's entry (and their real pads) untouched.
  let _clearPadsCooldown = 0;
  function clearFakePads() {
    const now = Date.now();
    if (now - _clearPadsCooldown < 400) return;

    const root = document.getElementById('root');
    if (!root) return;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return;

    // Fake-user array: any array whose first item has a numeric id AND
    // any person-like field.  Real Supabase users always have UUID string ids.
    function isFakeUserArr(v) {
      if (!Array.isArray(v) || v.length === 0 || !v[0]) return false;
      const f = v[0];
      if (typeof f.id !== 'number') return false;
      return !!(
        f.firstName || f.lastName || f.name ||
        f.email     || f.phone    || f.avatar ||
        f.type === 'host'  || f.type === 'driver' ||
        f.type === 'staff' || f.type === 'admin'  ||
        f.role === 'staff' || f.role === 'admin'  ||
        f.role === 'customer'
      );
    }
    // Lister-pad array: any array where items have numeric ids AND look like pads
    // (have address, photoUrl, or type fields).  Numeric id = guaranteed fake.
    function isFakeSpotArr(v) {
      if (!Array.isArray(v) || v.length === 0 || !v[0]) return false;
      const first = v[0];
      return typeof first.id === 'number' && (
        typeof first.address === 'string' ||
        typeof first.photoUrl === 'string' ||
        typeof first.addr    === 'string'
      );
    }

    function walk(fiber, depth) {
      if (!fiber || depth > 300) return;
      let s = fiber.memoizedState;
      while (s) {
        const v = s.memoizedState;
        const dispatch = s.queue && s.queue.dispatch;
        if (typeof dispatch === 'function') {
          if (isFakeUserArr(v)) {
            // Keep only real UUID-string users; remove all numeric-id demo users
            dispatch(prev => {
              if (!Array.isArray(prev)) return prev;
              const cleaned = prev.filter(u => u && typeof u.id !== 'number');
              if (cleaned.length === prev.length) return prev;
              console.log('[Lily Pad] Fake demo users removed from My Pads state');
              _clearPadsCooldown = now;
              return cleaned;
            });
          }
          if (isFakeSpotArr(v)) {
            dispatch([]);
            _clearPadsCooldown = now;
          }
        }
        s = s.next;
      }
      walk(fiber.child,   depth + 1);
      walk(fiber.sibling, depth + 1);
    }
    walk(root[fk], 0);
  }

  // ── Known fake pad photo IDs (Unsplash) ───────────────────────────────────
  // These are the exact photo IDs hardcoded in the bundle's demo lister pads.
  // Any rendered <img> whose src contains one of these is from a fake pad card.
  const _FAKE_PAD_PHOTO_IDS = [
    'photo-1590674899484',   // 142 Maple Street
    'photo-1448630360428',   // 880 Oak Lane
    'photo-1568605114967',   // other demo
    'photo-1597328540614',
    'photo-1502672023488',
    'photo-1494522358652',
  ];

  // ── Clear lp_padbox cache entries for fake pads at startup ───────────────
  (function _clearFakePadboxCache() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      for (const key of keys) {
        if (!key || !key.startsWith('lp_padbox_')) continue;
        const raw = _lpRawGet.call(localStorage, key);
        if (!raw) continue;
        if (_FAKE_PAD_PHOTO_IDS.some(id => raw.includes(id))) {
          localStorage.removeItem(key);
          console.log('[LP] Cleared fake padbox cache:', key);
        }
      }
    } catch {}
  })();

  // ── DOM-level fake pad card hider ─────────────────────────────────────────
  // Pad cards in the "My Pads" list use an INLINE CSS background:
  //   style={{ background: `url(${photoUrl}) center/cover` }}
  // NOT <img> tags.  So we must query [style*="photo-id"] to find them.
  // We also handle <img> tags used in the lightbox/detail view.
  function hideFakePadCards() {
    if (!document.getElementById('lp-fake-css')) {
      const st = document.createElement('style');
      st.id = 'lp-fake-css';
      st.textContent = '[data-lp-fake]{display:none!important}';
      document.head.appendChild(st);
    }
    let found = 0;

    // Strategy 1: inline-style background (the pad list card photo divs)
    for (const photoId of _FAKE_PAD_PHOTO_IDS) {
      const els = document.querySelectorAll('[style*="' + photoId + '"]');
      for (const el of els) {
        if (el.closest('[data-lp-fake]')) continue;
        // The photo div is INSIDE the card — walk up to the card container
        // (first ancestor that has 2+ children or height > 100)
        let card = el.parentElement;
        let hid = false;
        for (let i = 0; i < 6 && card && card !== document.body; i++) {
          if (card.children.length >= 2 || card.offsetHeight > 100) {
            card.setAttribute('data-lp-fake', 'pad');
            found++;
            hid = true;
            break;
          }
          card = card.parentElement;
        }
        if (!hid && !el.hasAttribute('data-lp-fake')) {
          el.setAttribute('data-lp-fake', 'pad');
          found++;
        }
      }
    }

    // Strategy 2: <img> tags (lightbox / detail view)
    const imgs = document.querySelectorAll('img');
    for (const img of imgs) {
      const src = img.getAttribute('src') || img.src || '';
      if (!_FAKE_PAD_PHOTO_IDS.some(id => src.includes(id))) continue;
      if (img.closest('[data-lp-fake]')) continue;
      let el = img.parentElement;
      for (let i = 0; i < 10 && el && el !== document.body; i++) {
        if (el.offsetHeight > 80) {
          el.setAttribute('data-lp-fake', 'pad');
          found++;
          break;
        }
        el = el.parentElement;
      }
    }

    if (found) console.log('[LP] hideFakePadCards: hid', found, 'fake pad elements');
  }

  // ── Shared helper: position a fixed button INSIDE the app container ─────────
  // The app renders in a centred phone-shaped #root div.  position:fixed with
  // top/left=14 puts the button at the browser-window corner — outside the app.
  // This helper reads #root's screen rect so the button lands inside the phone.
  function _lpAppInset(topOffset, leftOffset) {
    const root = document.getElementById('root');
    const rect = root ? root.getBoundingClientRect() : null;
    const t = rect ? rect.top  + (topOffset  || 14) : (topOffset  || 14);
    const l = rect ? rect.left + (leftOffset || 14) : (leftOffset || 14);
    return 'top:' + Math.round(t) + 'px;left:' + Math.round(l) + 'px';
  }

  // ── Back button to exit the "Add your lily pad" wizard ────────────────────
  // The wizard page has heading "Add your lily pad." and shows "Step X of 6".
  // There is no built-in way to exit back to My Pads — this injects one.
  function injectWizardExitBack() {
    const existing = document.getElementById('lp-wizard-exit-back');
    const leafTexts = el => el.childElementCount === 0;
    const hasWizard = !!Array.from(document.querySelectorAll('h1,h2,h3,p,span,div'))
      .find(el => leafTexts(el) && /add your lily pad/i.test(el.textContent.trim()));

    if (existing && !hasWizard) { existing.remove(); return; }
    if (!hasWizard || existing) return;

    const btn = document.createElement('button');
    btn.id = 'lp-wizard-exit-back';
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
      '<span style="font-size:13px;font-weight:600;font-family:\'DM Sans\',sans-serif">My Pads</span>';
    btn.setAttribute('style', [
      'position:fixed', _lpAppInset(), 'z-index:9999',
      'display:flex', 'align-items:center', 'gap:5px',
      'background:rgba(14,31,64,0.82)', 'color:#fff',
      'border:none', 'border-radius:20px', 'padding:6px 14px 6px 10px',
      'cursor:pointer', 'box-shadow:0 2px 8px rgba(0,0,0,0.28)',
      'backdrop-filter:blur(4px)', '-webkit-backdrop-filter:blur(4px)',
    ].join(';'));
    btn.addEventListener('click', function () {
      btn.remove();
      if (!callGoTo('paddashboard')) {
        const pads = Array.from(document.querySelectorAll('button'))
          .find(b => /my pads/i.test(b.textContent));
        if (pads) pads.click(); else window.history.back();
      }
    });
    document.body.appendChild(btn);
    console.log('[Lily Pad] Wizard exit back button injected');
  }

  // ── Clear fake driver-side listings ──────────────────────────────────────
  // The bundle ships with a hardcoded `ar` array of ~105 Houston parking spots.
  // Drivers see these before any real Supabase listings are loaded.  We clear
  // them by:
  //   1. Dispatching [] to any useState that directly holds the fake array
  //      (memoizedState is the array itself — this is the permanent fix)
  //   2. Patching the useMemo `Q` (nearby-pads array) to [] in the fiber tree
  //   3. Clearing the fake saved-IDs Set (which triggers a React re-render,
  //      causing React to use the [] we wrote into the useMemo cache)
  //   4. DOM-hiding any listing-card component fiber whose memoizedProps carry
  //      {addr:string, price:string, id:number} — the already-rendered list items
  let _clearListingsCooldown = 0;
  function clearFakeListings() {
    const now = Date.now();

    // ── DOM scan (fast, NO cooldown — runs on every mutation) ────────────────
    // Strategy A: walk UP from any "X PADS NEARBY" leaf node to find the
    //   listings section container (has prices/distances, no tab-bar text).
    //   Hide the whole container so cards + header disappear together.
    // Strategy B: independently target each listing card by price+distance
    //   combo — catches cards that Strategy A misses (e.g. panel not yet
    //   tall enough to pass height checks, or differently-structured markup).
    if (!document.getElementById('lp-fake-css')) {
      const st = document.createElement('style');
      st.id = 'lp-fake-css';
      st.textContent = '[data-lp-fake]{display:none!important}';
      document.head.appendChild(st);
    }
    let scanHid = 0;
    const nearbyRe = /\d+\s+PADS?\s+NEARBY/i;
    const priceRe  = /\$\s*\d+\s*\/\s*hr/i;
    const distRe   = /\b\d+\.?\d*\s*mi\b/;

    // Strategy A — hide the whole listings section.
    // "8 PADS NEARBY" is often split across sibling spans so we can't require
    // a leaf-only match.  Instead find the element with the SHORTEST textContent
    // that still matches the pattern — that's the header row, not the whole sheet.
    let nearbyEl   = null;
    let nearbyLen  = Infinity;
    for (const el of document.querySelectorAll('*')) {
      if (el.dataset.lpFake || el.dataset.lpFakePanel) continue;
      const t = el.textContent.trim();
      if (nearbyRe.test(t) && t.length < nearbyLen) { nearbyEl = el; nearbyLen = t.length; }
    }
    if (nearbyEl) {
      // Walk UP from the header until we find an ancestor that contains prices
      // or distances but NOT the tab-bar text (Park Now / Park Later).
      // That boundary is the listings section — hide the whole thing.
      let node = nearbyEl.parentElement;
      for (let i = 0; i < 20 && node && node !== document.body; i++) {
        const txt = node.textContent;
        if ((priceRe.test(txt) || distRe.test(txt)) &&
            !txt.includes('Park Now') && !txt.includes('Park Later')) {
          if (!node.dataset.lpFake) {
            node.setAttribute('data-lp-fake', '1');
            node.dataset.lpFakePanel = '1';
            scanHid++;
          }
          break;
        }
        node = node.parentElement;
      }
    }

    // Strategy B — target individual listing cards by price + distance combo.
    // "Garage · Sarah L. · 1.5 mi  $5/hr" — that pair is unique to listing cards.
    // Skip anything containing tab-bar text or obviously too-large (full sheet).
    for (const el of document.querySelectorAll('div,li')) {
      if (el.dataset.lpFake || el.dataset.lpFakePanel) continue;
      const txt = el.textContent;
      if (!priceRe.test(txt) || !distRe.test(txt)) continue;
      if (txt.includes('Park Now') || txt.includes('Park Later')) continue;
      if (el.offsetHeight > 500) continue; // skip full-sheet containers
      el.setAttribute('data-lp-fake', '1');
      scanHid++;
    }

    if (scanHid > 0) {
      console.log('[Lily Pad] DOM scan hid', scanHid, 'fake listing element(s)');
      // Schedule follow-up passes to catch React re-renders after the first hide
      setTimeout(() => { _clearListingsCooldown = 0; clearFakeListings(); }, 250);
      setTimeout(() => { _clearListingsCooldown = 0; clearFakeListings(); }, 700);
    } else if (nearbyEl) {
      // Panel is visible but scan found nothing new — retry shortly
      setTimeout(() => clearFakeListings(), 300);
    }

    // ── Fiber walk (expensive — rate-limited to once per 400 ms) ─────────────
    if (now - _clearListingsCooldown < 400) return;

    const root = document.getElementById('root');
    if (!root) return;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return;

    // helpers
    function isFakeArr(v) {
      if (!Array.isArray(v) || v.length === 0 || !v[0]) return false;
      const item = v[0];
      // Accept addr OR address field (bundle may use either)
      const hasAddr = typeof item.addr === 'string' || typeof item.address === 'string';
      // Accept numeric id OR small-integer string id (e.g. "42")
      const id = item.id;
      const hasNumId = typeof id === 'number' ||
                       (typeof id === 'string' && /^\d+$/.test(id) && +id < 2000);
      return hasAddr && hasNumId;
    }
    function isFakeSet(v) {
      if (!(v instanceof Set) || v.size === 0) return false;
      for (const x of v) {
        if (typeof x === 'number') { if (x > 2000) return false; }
        else if (typeof x === 'string') { if (!/^\d+$/.test(x) || +x > 2000) return false; }
        else return false;
      }
      return true;
    }

    let forceRenderDispatch = null;

    function hideFakeFiber(fiber) {
      // Walk DOWN to the first HTMLElement stateNode (card's root div)
      let f = fiber;
      while (f && !(f.stateNode instanceof HTMLElement)) f = f.child;
      if (f && f.stateNode instanceof HTMLElement) {
        f.stateNode.setAttribute('data-lp-fake', '1');
        _clearListingsCooldown = now;
      }
    }

    function walk(fiber, depth) {
      if (!fiber || depth > 300) return;

      // ── Check this fiber's hooks ────────────────────────────────────────
      let s = fiber.memoizedState;
      while (s) {
        const v = s.memoizedState;

        // useState hook whose value IS the fake listings array directly.
        // splice(0) empties the underlying ar[] object in-place so that future
        // component mounts (which re-run useState(ar)) also get an empty array.
        // dispatch([]) covers the currently-mounted instance immediately.
        if (isFakeArr(v)) {
          console.log('[Lily Pad] Splicing fake listings array (len=' + v.length + ')');
          v.splice(0);
          const dispatch = s.queue && s.queue.dispatch;
          if (typeof dispatch === 'function') {
            dispatch([]);
            _clearListingsCooldown = now;
          }
        }

        // useMemo hook: memoizedState = [value, deps]
        if (Array.isArray(v) && v.length === 2 && isFakeArr(v[0])) {
          v[0].splice(0); // mutate the source array in-place too
          v[0] = [];
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
      // Spread props: {addr|address, price|cost, id(number|string)}
      // Wrapped props: {spot|pad|item|listing: {addr|address, price|cost, id}}
      const p = fiber.memoizedProps;
      if (p) {
        const pid = p.id;
        const pIsNumId = typeof pid === 'number' ||
                         (typeof pid === 'string' && /^\d+$/.test(pid) && +pid < 2000);
        const pHasAddr = typeof p.addr === 'string' || typeof p.address === 'string';
        const pHasPrice = typeof p.price === 'string' || typeof p.cost === 'string';
        if (pIsNumId && pHasAddr && pHasPrice) {
          hideFakeFiber(fiber);
        } else {
          const inner = p.spot || p.pad || p.item || p.listing;
          if (inner) {
            const iid = inner.id;
            const iIsNumId = typeof iid === 'number' ||
                             (typeof iid === 'string' && /^\d+$/.test(iid) && +iid < 2000);
            const iHasAddr  = typeof inner.addr === 'string' || typeof inner.address === 'string';
            const iHasPrice = typeof inner.price === 'string' || typeof inner.cost === 'string';
            if (iIsNumId && iHasAddr && iHasPrice) hideFakeFiber(fiber);
          }
        }
      }

      walk(fiber.child,   depth + 1);
      walk(fiber.sibling, depth + 1);
    }

    walk(root[fk], 0);

    // (DOM text-scan now runs unconditionally at the top of clearFakeListings)

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
          forceRenderDispatch(x => { const n = !x; forceRenderDispatch._lpVal = n; return n; });
          setTimeout(() => forceRenderDispatch(x => !x), 0);
        }
      }
    }
  }

  // ── Update profile name/email displayed in the pull-down ─────────────────
  // The bundle does NOT use .profile-name or .avatar-initials class names.
  // Instead we find the pull-down container (same detection as injectPullDownSignOut)
  // and update leaf text nodes that are not known menu labels.
  const _PD_LABELS = new Set([
    'My Account','My Bookings','Saved Spots','Customer Service','Sign out',
    'Find a Pad','List my lily pad','Driver','Renter','Find a pad',
  ]);
  function _findPullDownContainer() {
    let csNode = null;
    for (const n of document.querySelectorAll('*')) {
      if (n.children.length === 0 && n.textContent.trim() === 'Customer Service') {
        csNode = n; break;
      }
    }
    if (!csNode) return null;
    let node = csNode.parentElement;
    while (node && node !== document.body) {
      const txt = node.textContent;
      let hits = 0;
      if (txt.includes('My Account'))      hits++;
      if (txt.includes('My Bookings'))     hits++;
      if (txt.includes('Saved Spots'))     hits++;
      if (txt.includes('Customer Service')) hits++;
      if (hits >= 3) return node;
      node = node.parentElement;
    }
    return null;
  }

  function updateProfileDisplay() {
    const data = getUserData();
    if (!data) return;

    const menuCard = _findPullDownContainer();
    if (!menuCard) return; // pull-down not open yet — observer will retry

    // Walk UP from menuCard to include the header section (name + email live above)
    let container = menuCard;
    for (let i = 0; i < 5 && container.parentElement; i++) {
      container = container.parentElement;
      if (container.textContent.includes('@') ||
          container.offsetHeight > menuCard.offsetHeight + 80) break;
    }

    let nameSet = false;
    Array.from(container.querySelectorAll('*')).forEach(el => {
      if (el.children.length !== 0) return;
      const t = el.textContent.trim();
      if (!t || t.length > 60) return;
      if (_PD_LABELS.has(t)) return;
      // Email element
      if (t.includes('@') && data.email && el.textContent !== data.email) {
        el.textContent = data.email;
        return;
      }
      // Name element: non-label, non-email, non-numeric, reasonable length
      if (!nameSet && !t.includes('@') && t.length >= 2 &&
          !/^\d/.test(t) && data.fullName && el.textContent !== data.fullName) {
        el.textContent = data.fullName;
        nameSet = true;
        console.log('[Lily Pad] Profile name updated in pull-down:', data.fullName);
      }
    });
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
    ['form-login', 'form-signup', 'form-forgot', 'form-confirm-email'].forEach(fid => {
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
      let msg = err.message;
      if (/email.*not.*confirm|not confirm.*email|email_not_confirmed/i.test(msg)) {
        msg = 'Please confirm your email first — check your inbox for the activation link.';
      }
      if (errEl) errEl.textContent = msg;
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
      if (id === 'login-form' || id === 'forgot-form') {
        e.preventDefault();
        e.stopPropagation();
      }
      if (id === 'login-form')  handleLogin();
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
      if (id === 'goto-login')           switchForm('form-login');
      if (id === 'back-to-login')        switchForm('form-login');
      if (id === 'back-to-login-confirm') switchForm('form-login');

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
          // Remove synchronously (no setTimeout) to prevent even a 1-frame flash
          try { map.removeLayer(e.layer); } catch (_) {}
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
  // Rendered as a position:fixed overlay so it is always visible regardless of
  // the host page's stacking context, overflow, or background colour.
  function injectPaddashboardBack() {
    const existing = document.getElementById('lp-pad-back');

    // Detect paddashboard by checking rendered UI elements — NOT body.textContent
    // because that includes our own <script> tag text and causes false positives.
    const elTexts = el => el.childElementCount === 0 && el.getBoundingClientRect().width > 0;
    const hasMyPads = !!Array.from(document.querySelectorAll('h1,h2,h3,p,span,div'))
      .find(el => elTexts(el) && /^my pads$/i.test(el.textContent.trim()));
    const hasAddNewPad = !!Array.from(document.querySelectorAll('button,a,span,p,div,h1,h2,h3'))
      .find(el => elTexts(el) && /^add new pad$/i.test(el.textContent.trim()));
    const hasPayoutsThisMonth = !!Array.from(document.querySelectorAll('p,span,div,h1,h2,h3'))
      .find(el => elTexts(el) && /this month/i.test(el.textContent.trim()));
    const onPage = hasMyPads || hasAddNewPad || hasPayoutsThisMonth;
    if (!existing) console.log('[Lily Pad] injectPaddashboardBack: onPage=', onPage);

    // Remove the button if we've navigated away
    if (existing && !onPage) { existing.remove(); return; }
    if (!onPage || existing) return;

    const btn = document.createElement('button');
    btn.id = 'lp-pad-back';
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
      '<span style="font-size:13px;font-weight:600;font-family:\'DM Sans\',sans-serif">Back</span>';
    btn.setAttribute('style', [
      'position:fixed',
      _lpAppInset(),
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'gap:5px',
      'background:rgba(14,31,64,0.82)',
      'color:#fff',
      'border:none',
      'border-radius:20px',
      'padding:6px 14px 6px 10px',
      'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,0.28)',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)',
    ].join(';'));

    btn.addEventListener('click', function () {
      btn.remove();
      if (!callGoTo('find')) {
        const tab = Array.from(document.querySelectorAll('button'))
          .find(b => /map|find|home/i.test(b.textContent));
        if (tab) tab.click();
      }
    });

    document.body.appendChild(btn);
    console.log('[Lily Pad] Paddashboard back button injected (fixed overlay)');
  }

  // ── Back button on pad detail (account) page ──────────────────────────────
  // Detected by the "Change photo" button (unique to this single-pad view).
  // Rendered as a position:fixed overlay — always visible on top of the photo.
  // Navigates back to paddashboard (My Pads list).
  function injectPadAccountBack() {
    const existing = document.getElementById('lp-pad-account-back');

    // "Change photo" only exists on the individual pad detail/account page
    const onPage = !!Array.from(document.querySelectorAll('button'))
      .find(b => b.childElementCount === 0 && b.textContent.trim() === 'Change photo');
    if (!existing) console.log('[Lily Pad] injectPadAccountBack: onPage=', onPage);

    // Remove if we've navigated away
    if (existing && !onPage) { existing.remove(); return; }
    if (!onPage || existing) return;

    const btn = document.createElement('button');
    btn.id = 'lp-pad-account-back';
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
      '<span style="font-size:13px;font-weight:600;font-family:\'DM Sans\',sans-serif">Back</span>';
    btn.setAttribute('style', [
      'position:fixed',
      _lpAppInset(),
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'gap:5px',
      'background:rgba(14,31,64,0.82)',
      'color:#fff',
      'border:none',
      'border-radius:20px',
      'padding:6px 14px 6px 10px',
      'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,0.28)',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)',
    ].join(';'));

    btn.addEventListener('click', function () {
      btn.remove();
      if (!callGoTo('paddashboard')) {
        _lpGoToFn = null;
        const fresh = lpGetGoTo();
        if (fresh) fresh('paddashboard');
      }
    });

    document.body.appendChild(btn);
    console.log('[Lily Pad] Pad account back button injected (fixed overlay)');
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
      hideFakePadCards();   // hide fake pad cards the moment React renders them
      clearFakePads();      // dispatch [] to any numeric-id pad state
    });
    guard.observe(root, { childList: true, subtree: true });
  }

  // ── Deep-page back button ─────────────────────────────────────────────────
  // Pages like "availability" and "payment" are sub-pages of paddashboard but
  // the bundle renders them without a back button. We inject one by reading the
  // current page name from the React fiber tree and using the context's goTo().
  const LP_BACK_TARGETS = {
    paddashboard   : 'find',          // lister My Pads → back to map
    availability   : 'paddashboard',
    payment        : 'paddashboard',
    photo          : 'paddashboard',
    photointro     : 'paddashboard',
    addpad         : 'paddashboard',
    // account handled by injectPadAccountBack() via DOM text detection
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
  let _lpGoToFn        = null;  // cached from fiber; invalidated on back-click
  let _lpLastPage      = null;
  let _lpBackTmr       = null;
  let _lpPendingRestore = null; // page queued for restore after browser refresh

  // Only stable top-level pages are saved/restored — wizard and flow pages
  // (payment, confirm, addpad, signup, etc.) cannot be safely dropped back into.
  const LP_RESTORE_PAGES = new Set([
    'account', 'driveraccount', 'support', 'bookings',
    'paddashboard', 'admin', 'billing', 'feedback',
  ]);

  function lpGetGoTo() {
    if (_lpGoToFn) return _lpGoToFn;
    const root = document.getElementById('root');
    if (!root) return null;
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    const q = [root[fk]];
    let n = 0;
    while (q.length && n++ < 2000) {
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

  function drawQuadOnCanvas(canvas, pts) {
    if (!pts || pts.length < 3) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x * W, pts[0].y * H);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H);
    ctx.closePath();
    ctx.fillStyle = 'rgba(76,175,80,0.28)';
    ctx.fill();
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = Math.max(2.5, W * 0.004);
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
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

  function openPhotoLightbox({ photoUrl, srcKey, box, color, name, isLister, onEdit, onReplacePhoto }) {
    console.log('[LP] openLb photoUrl=…' + (photoUrl||'').slice(-60) + ' srcKey=…' + (srcKey||'').slice(-60));
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

    // ── Independent drawing overlay for the lightbox ───────────────────────
    // Injected separately from render() so canvas timing issues can't block it.
    // Retries at 150 ms and 400 ms to survive any React re-render race.
    const _lkSrc = srcKey || photoUrl;
    function _applyLbOverlay() {
      const lbWrap = lb.querySelector('#lp-lb-wrap');
      console.log('[LP] lbApply wrap=' + !!lbWrap + ' lkSrc=' + JSON.stringify((_lkSrc || '').slice(-40)));
      if (!lbWrap || !_lkSrc) return;
      const found = !!_loadPadBox(_lkSrc);
      console.log('[LP] lbApply found=' + found);
      overlayPadDrawing({ src: _lkSrc }, lbWrap);
      console.log('[LP] lbApply done svgInDom=' + !!lbWrap.querySelector('.lp-draw-overlay-svg'));
    }
    _applyLbOverlay();                           // immediate (catches cached images)
    setTimeout(_applyLbOverlay, 150);            // after CSS layout commits
    setTimeout(_applyLbOverlay, 400);            // belt-and-suspenders

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
      console.log('[LP] render W=' + canvas.width + ' H=' + canvas.height + ' lkSrc=…' + (_lkSrc||'').slice(-40));
      drawBoxOnLightboxCanvas(canvas, box, color || '#8DD63F', name);
      // Draw saved quad overlay directly on canvas — bypasses all SVG/DOM timing issues
      const saved = _loadPadBox(_lkSrc);
      let pts = null;
      if (Array.isArray(saved) && saved.length >= 3) pts = saved;
      else if (saved && saved.w > 0.01) pts = _rectToQuad(saved);
      console.log('[LP] render quad pts=' + (pts ? pts.length : 'null'));
      if (pts) drawQuadOnCanvas(canvas, pts);
      // SVG overlay is also attempted for belt-and-suspenders
      _applyLbOverlay();
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

  // Element-based lister-page detection — mirrors the onDash logic in
  // injectPadDrawEdit.  Used instead of lpGetCurrentPage() (fiber walk) because
  // the fiber walk often returns null/wrong-page for the paddashboard view.
  function _onListerPage() {
    const leaf = el => el.childElementCount === 0 && el.getBoundingClientRect().width > 0;
    return !!(
      Array.from(document.querySelectorAll('button,a,span,p,div,h1,h2,h3'))
        .find(el => leaf(el) && /^add new pad$/i.test(el.textContent.trim())) ||
      Array.from(document.querySelectorAll('p,span,div,h1,h2,h3'))
        .find(el => leaf(el) && /this month/i.test(el.textContent.trim()))
    );
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

      // DOM fallback for onEdit: find the native p2 "Edit" button on this card.
      // The fiber walk can occasionally return onEdit:null if React hasn't
      // committed memoizedProps yet; clicking the native button is 100% reliable.
      let nativeEditBtn = null;
      let el = wrap.parentElement;
      for (let i = 0; i < 10 && el; i++, el = el.parentElement) {
        const btn = Array.from(el.querySelectorAll('button'))
          .find(b => b.textContent.trim() === 'Edit');
        if (btn) { nativeEditBtn = btn; break; }
      }

      wrap.dataset.lpLb = '1';
      wrap.style.cursor = 'zoom-in';
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      lpAddZoomBadge(wrap);

      wrap.addEventListener('click', e => {
        e.stopPropagation();
        const latest   = getPadPropsFromEl(img) || data || {};
        const pad      = (latest && latest.pad) || {};
        const isLister = _onListerPage();
        // On lister pages always open OUR draw editor, bypassing the unreliable
        // fiber-sourced onEdit which often returns null for the paddashboard view.
        openPhotoLightbox({
          photoUrl:       pad.photoUrl || img.src,
          srcKey:         img.src,  // key used by _savePadBox — may differ from pad.photoUrl
          box:            pad.box,
          color:          pad.color,
          name:           pad.name,
          isLister,
          onEdit:         isLister ? () => openPadDrawEditor(img) : null,
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
        const freshBg  = div.style.background || div.style.backgroundImage || '';
        const freshUrl = (freshBg.match(/url\(["']?([^"')]+)["']?\)/) || [])[1] || photoUrl;
        const isLister = _onListerPage();
        const padData  = getPadPropsFromEl(div);
        const pad      = (padData && padData.pad) || {};
        // On My Pads: always open our draw editor — bypasses the unreliable fiber onEdit
        const fakeImg  = { src: freshUrl };
        openPhotoLightbox({
          photoUrl:       freshUrl,
          srcKey:         freshUrl, // matches _savePadBox key (from background-image URL)
          box:            pad.box   || null,
          color:          pad.color || null,
          name:           pad.name  || '',
          isLister,
          onEdit:         isLister ? () => openPadDrawEditor(fakeImg) : null,
          onReplacePhoto: padData ? padData.onReplacePhoto : null,
        });
      });
    });
  }

  // ── Same-address hint on the add-pad wizard ──────────────────────────────
  // Shows a suggestion chip for any previously-listed pad address so the
  // user doesn't have to retype it when adding a second pad.
  //
  // Detection: DOM-based — fires whenever "What's the address?" is visible
  // regardless of which wizard flow (addpad, signup step 2, etc.) triggered it.
  // Proactively harvest pad addresses while the user is on the My Pads
  // (paddashboard) view and stash them in lp_saved_addresses so they are
  // available as chip hints the moment the user taps "Add new pad".
  // Runs from the guard every tick — idempotent via a version counter.
  let _scrapeVersion = 0;
  function _scrapePaddashboardAddresses() {
    // Same element-based detection used by injectPaddashboardBack — avoids
    // false positives from our own <script> text containing these strings.
    const elTexts = el => el.childElementCount === 0 && el.getBoundingClientRect().width > 0;
    const onDash =
      !!Array.from(document.querySelectorAll('button,a,span,p,div,h1,h2,h3'))
        .find(el => elTexts(el) && /^add new pad$/i.test(el.textContent.trim())) ||
      !!Array.from(document.querySelectorAll('p,span,div,h1,h2,h3'))
        .find(el => elTexts(el) && /this month/i.test(el.textContent.trim()));
    if (!onDash) return;

    const saved = (() => {
      try { return JSON.parse(localStorage.getItem('lp_saved_addresses') || '[]'); } catch { return []; }
    })();
    const seen = new Set(saved);
    let added = 0;

    function tryAdd(a) {
      const v = (a || '').trim();
      if (!v || v.length < 5 || _LP_FAKE_ADDRS.has(v) || seen.has(v)) return;
      if (!/^\d/.test(v)) return;   // must start with a house number
      seen.add(v);
      saved.unshift(v);
      added++;
    }

    // Helper: extract address string from a pad object regardless of field name
    function _padAddr(p) {
      return (p.address || p.addr || p.street || p.streetAddress ||
              p.streetAddr || p.location || p.fullAddress || p.line1 || '').trim();
    }

    // Source A: fiber state — walk for any array whose items have an address field
    const root = document.getElementById('root');
    if (root) {
      const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
      if (fk) {
        (function walk(f, d) {
          if (!f || d > 300) return;
          let s = f.memoizedState;
          while (s) {
            const v = s.memoizedState;
            if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') {
              const a0 = _padAddr(v[0]);
              if (a0 && /^\d/.test(a0) && !_LP_FAKE_ADDRS.has(a0))
                v.forEach(p => tryAdd(_padAddr(p)));
            }
            s = s.next;
          }
          walk(f.child,   d + 1);
          walk(f.sibling, d + 1);
        })(root[fk], 0);
      }
    }

    // Source B: DOM text — scan leaf nodes for text that looks like a full address.
    // Real addresses contain a comma ("123 Main St, Houston TX").
    // UI strings ("0 spots saved", "$78 this month") do not.
    // The ·-separated metadata filter is already in tryAdd() via _LP_FAKE_ADDRS/seen.
    Array.from(document.querySelectorAll('p,span,div,h1,h2,h3,li'))
      .filter(el => el.childElementCount === 0 && el.getBoundingClientRect().width > 0)
      .forEach(el => {
        const t = (el.textContent || '').trim();
        if (t.includes(',') && /^\d+\s+[A-Za-z]/.test(t)) tryAdd(t);
      });

    if (added > 0) {
      try { localStorage.setItem('lp_saved_addresses', JSON.stringify(saved.slice(0, 10))); } catch {}
      console.log('[Lily Pad] Scraped', added, 'address(es) from paddashboard:', saved.slice(0, added));
      _scrapeVersion++;
    }
  }

  function injectSameAddressHint() {
    // ── Step 1: Find the address input ─────────────────────────────────────
    // Triggered by the "123 Main St, City, State" placeholder from the pad
    // wizard address step. Matches both "add pad from dashboard" and the
    // initial onboarding wizard.
    const addressInput =
      Array.from(document.querySelectorAll('input[type="text"],input:not([type])')).find(i => {
        const ph = (i.placeholder || '').toLowerCase();
        return ph.includes('main st') || ph.includes('city, state') ||
               ph.includes('123 main') || ph.includes('address');
      }) || null;

    // If no address input on screen, remove any stale chip row and bail.
    if (!addressInput) {
      const stale = document.getElementById('lp-same-addr');
      if (stale) stale.remove();
      return;
    }

    // ── Step 2: Purge garbage from lp_saved_addresses ─────────────────────
    // Previous scraper runs may have stored metadata-concatenated strings
    // like "880 Oak Lane · Driveway · 2 spots", UI count strings like
    // "0 spots saved", or short counts like "2 listings". Clean those out.
    // An address must start with a house number (≥1 digit) followed by a
    // proper street word — not a UI word like spots/pads/saved/nearby/month.
    const _addrSecondWordBlock =
      /^\d+\s+(spots?|pads?|saved|available|nearby|this|listings?|month|items?|results?|entries|records|parking)\b/i;
    try {
      const raw = JSON.parse(localStorage.getItem('lp_saved_addresses') || '[]');
      const clean = raw.filter(v =>
        typeof v === 'string' && v.length >= 8 && /^\d+\s+[A-Za-z]/.test(v) &&
        !v.includes('·') && !v.includes('listing') && !_LP_FAKE_ADDRS.has(v) &&
        !_addrSecondWordBlock.test(v)
      );
      if (clean.length !== raw.length)
        localStorage.setItem('lp_saved_addresses', JSON.stringify(clean));
    } catch {}

    // ── Step 3: Collect real pad addresses from available sources ──────────
    const addrs = [];
    const seen  = new Set();
    function addAddr(a) {
      const v = (a || '').trim();
      if (!v || v.length < 8 || seen.has(v)) return;
      if (_LP_FAKE_ADDRS.has(v)) return;
      // Reject metadata strings (contain ·), count-strings ("0 spots saved"), non-addresses
      if (v.includes('·') || v.includes('listing') || !/^\d+\s+[A-Za-z]/.test(v)) return;
      if (_addrSecondWordBlock.test(v)) return;
      seen.add(v);
      addrs.push(v);
    }

    // Source 1: lilypad.pads.v1 raw localStorage read
    try {
      const raw = _lpRawGet.call(localStorage, _LP_PADS_KEY);
      if (raw) {
        JSON.parse(raw)
          .filter(p => !_LP_FAKE_ADDRS.has(p.address) && !_LP_FAKE_ADDRS.has(p.addr) &&
                       !/Austin,?\s*TX/i.test(p.city || ''))
          .forEach(p => addAddr(p.address || p.addr));
      }
    } catch {}

    // Source 2: lp_saved_addresses (already purged above)
    try {
      JSON.parse(localStorage.getItem('lp_saved_addresses') || '[]').forEach(addAddr);
    } catch {}

    // Helper: extract address from a pad object regardless of field name
    function _fiberPadAddr(p) {
      return (p.address || p.addr || p.street || p.streetAddress ||
              p.streetAddr || p.location || p.fullAddress || p.line1 || '').trim();
    }

    // Source 3: React fiber state — walk for any array of pad-like objects
    const root = document.getElementById('root');
    if (root) {
      const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'));
      if (fk) {
        (function walk(f, d) {
          if (!f || d > 300) return;
          let s = f.memoizedState;
          while (s) {
            const v = s.memoizedState;
            if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') {
              const a0 = _fiberPadAddr(v[0]);
              if (a0 && /^\d/.test(a0) && !_LP_FAKE_ADDRS.has(a0))
                v.forEach(p => addAddr(_fiberPadAddr(p)));
            }
            s = s.next;
          }
          walk(f.child,   d + 1);
          walk(f.sibling, d + 1);
        })(root[fk], 0);
      }
    }

    // Source 4: DOM leaf-node text — real addresses always contain a comma
    // ("1234 Main St, Houston TX").  UI strings ("0 spots saved") never do.
    Array.from(document.querySelectorAll('p,span,div,h1,h2,h3,li'))
      .filter(el => el.childElementCount === 0 && el.getBoundingClientRect().width > 0)
      .forEach(el => {
        const t = (el.textContent || '').trim();
        if (t.includes(',') && /^\d+\s+[A-Za-z]/.test(t)) addAddr(t);
      });

    console.log('[Lily Pad] injectSameAddressHint: input found, addrs=', addrs);

    // ── Step 4: Re-position existing row, or build it fresh ───────────────
    // The chip row is fixed-positioned directly over the input so React
    // remounting the input's parent cannot wipe it out.
    const inputRect = addressInput.getBoundingClientRect();
    let row = document.getElementById('lp-same-addr');

    if (row) {
      // Update position in case the layout shifted
      row.style.top  = (inputRect.bottom + 6) + 'px';
      row.style.left = inputRect.left + 'px';
      row.style.width= inputRect.width + 'px';
      return;
    }

    if (addrs.length === 0) return;

    row = document.createElement('div');
    row.id = 'lp-same-addr';
    row.style.cssText = [
      'position:fixed',
      'z-index:99999',
      'display:flex',
      'flex-wrap:wrap',
      'gap:6px',
      'padding:4px 2px',
      'top:'  + (inputRect.bottom + 6) + 'px',
      'left:' + inputRect.left + 'px',
      'width:'+ inputRect.width + 'px',
      'pointer-events:all',
    ].join(';');

    // Label above the chips
    const lbl = document.createElement('div');
    lbl.textContent = 'Use same address as an existing pad:';
    lbl.style.cssText = [
      'width:100%',
      'font-size:11px',
      'font-weight:600',
      "font-family:'DM Sans',sans-serif",
      'color:#142A52',
      'opacity:0.7',
      'margin-bottom:2px',
    ].join(';');
    row.appendChild(lbl);

    addrs.forEach(addr => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = '↩ ' + addr;
      chip.style.cssText = [
        'padding:6px 12px',
        'background:#f0f8e8',
        'border:1.5px solid #8DD63F',
        'border-radius:20px',
        'font-size:13px',
        'font-weight:600',
        'cursor:pointer',
        "font-family:'DM Sans',sans-serif",
        'color:#142A52',
        'white-space:nowrap',
        'box-shadow:0 1px 4px rgba(0,0,0,0.10)',
      ].join(';');
      chip.addEventListener('click', e => {
        e.stopPropagation();
        // Fill via React's native setter so bundle onChange fires properly
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(addressInput, addr);
        addressInput.dispatchEvent(new Event('input',  { bubbles: true }));
        addressInput.dispatchEvent(new Event('change', { bubbles: true }));
        addressInput.dispatchEvent(new Event('blur',   { bubbles: true }));
        row.remove();

        // Persist address for future sessions
        try {
          const sv = JSON.parse(localStorage.getItem('lp_saved_addresses') || '[]');
          if (!sv.includes(addr)) {
            sv.unshift(addr);
            localStorage.setItem('lp_saved_addresses', JSON.stringify(sv.slice(0, 10)));
          }
        } catch {}

        // Auto-advance: click Next/Continue after React processes the value
        setTimeout(() => {
          const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
            const t = b.textContent.trim().toLowerCase();
            return t === 'next' || t === 'continue' || t === 'next step';
          });
          if (nextBtn && !nextBtn.disabled) {
            nextBtn.click();
            console.log('[Lily Pad] Same-addr chip: auto-advanced via', nextBtn.textContent.trim());
          }
        }, 150);

        console.log('[Lily Pad] Same-addr chip tapped:', addr);
      });
      row.appendChild(chip);
    });

    document.body.appendChild(row);

    // Auto-save address on manual blur (for future sessions)
    if (!addressInput.dataset.lpAddrSave) {
      addressInput.dataset.lpAddrSave = '1';
      addressInput.addEventListener('blur', () => {
        const v = addressInput.value.trim();
        if (!v || v.length < 8 || _LP_FAKE_ADDRS.has(v) || !(/^\d+\s+[A-Za-z]/.test(v))) return;
        try {
          const saved = JSON.parse(localStorage.getItem('lp_saved_addresses') || '[]');
          if (!saved.includes(v)) {
            saved.unshift(v);
            localStorage.setItem('lp_saved_addresses', JSON.stringify(saved.slice(0, 10)));
            console.log('[Lily Pad] Address manually saved for hints:', v);
          }
        } catch {}
      });
    }

    console.log('[Lily Pad] Same-address hint injected:', addrs);
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

  // ── Pad drawing editor ────────────────────────────────────────────────────
  // Lets the pad owner click a thumbnail photo on paddashboard and redraw /
  // adjust the parking-spot box on that photo, then saves it.

  // Stable per-image key for localStorage (blob URLs are stable within a session)
  function _padBoxKey(src) {
    // Strip query-string before hashing — Supabase signed URLs include a
    // rotating ?token=... that changes on every render, so we must normalize
    // to the path-only part to get a stable storage key.
    const normalized = src ? src.split('?')[0] : (src || '');
    let h = 5381;
    const s = normalized.slice(-150);
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    return 'lp_padbox_' + h.toString(36);
  }
  function _savePadBox(src, box) {
    const key = _padBoxKey(src);
    console.log('[LP] savePadBox key=' + key + ' src=…' + src.slice(-60));
    try { localStorage.setItem(key, JSON.stringify(box)); } catch {}
  }
  function _loadPadBox(src) {
    const key = _padBoxKey(src);
    try {
      const val = JSON.parse(localStorage.getItem(key) || 'null');
      if (val) console.log('[LP] loadPadBox HIT key=' + key + ' src=…' + src.slice(-60));
      return val;
    } catch { return null; }
  }

  // Convert legacy {cx,cy,w,h} rectangle to quad array
  function _rectToQuad(box) {
    const { cx, cy, w, h } = box;
    return [
      { x: cx - w / 2, y: cy - h / 2 }, // TL
      { x: cx + w / 2, y: cy - h / 2 }, // TR
      { x: cx + w / 2, y: cy + h / 2 }, // BR
      { x: cx - w / 2, y: cy + h / 2 }, // BL
    ];
  }

  // Overlay the saved drawing as a green SVG polygon on a thumbnail image.
  // Handles both legacy {cx,cy,w,h} and the new quad [{x,y}×4] format.
  // `wrap` is the pad-card photo container (parent of the bundle's SVG overlay).
  // Passing it explicitly avoids relying on img.parentElement which may be a
  // deeply-nested inner element, not the styled wrap we need.
  function overlayPadDrawing(img, wrap) {
    const parent = wrap || img.parentElement;
    if (!parent) return;
    // ── Load data FIRST — only touch the DOM if there is something to render.
    // Setting parent.style.position before this check triggers the MutationObserver
    // (which watches 'style') on EVERY guard tick for images with no saved box,
    // causing an infinite loop.
    const saved = _loadPadBox(img.src);
    let pts;
    if (Array.isArray(saved) && saved.length === 4) {
      pts = saved;
    } else if (saved && saved.w > 0.01) {
      pts = _rectToQuad(saved);
    } else {
      // No drawing saved for this image — remove any stale overlay and stop.
      const stale = parent.querySelector('.lp-draw-overlay-svg');
      if (stale) stale.remove();
      return;
    }
    // Safe to touch the DOM now — we know we'll render
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    // Clip the overlay to the photo container so the polygon never bleeds outside
    if (getComputedStyle(parent).overflow === 'visible') parent.style.overflow = 'hidden';
    const old = parent.querySelector('.lp-draw-overlay-svg');
    if (old) old.remove();
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.className = 'lp-draw-overlay-svg';
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', pts.map(p => (p.x * 100).toFixed(2) + ',' + (p.y * 100).toFixed(2)).join(' '));
    poly.setAttribute('fill',   'rgba(76,175,80,0.25)');
    poly.setAttribute('stroke', '#4caf50');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(poly);
    parent.appendChild(svg);
  }

  // Inject "Edit drawing" pencil button on every pad photo thumbnail when on
  // the paddashboard (My Pads).  Re-runs on every guard tick; idempotent.
  //
  // Discovery strategy: use the SAME svg[viewBox="0 0 100 70"] selector that
  // installPhotoClickHandlers and enlargePadCards already rely on — this is the
  // only proven-reliable way to find pad-card photo containers in the bundle's
  // DOM.  The img may be nested several levels inside the wrap, so we never
  // use img.parentElement; we always pass the outer wrap explicitly.
  function injectPadDrawEdit() {
    // Detect paddashboard using rendered elements only — document.body.textContent
    // includes our own <script> text and causes false positives.
    const elTexts = el => el.childElementCount === 0 && el.getBoundingClientRect().width > 0;
    const onDash =
      !!Array.from(document.querySelectorAll('button,a,span,p,div,h1,h2,h3'))
        .find(el => elTexts(el) && /^add new pad$/i.test(el.textContent.trim())) ||
      !!Array.from(document.querySelectorAll('p,span,div,h1,h2,h3'))
        .find(el => elTexts(el) && (/this month/i.test(el.textContent.trim()) ||
                                    /revenue.*payouts|payouts/i.test(el.textContent.trim())));
    if (!onDash) {
      document.querySelectorAll('.lp-draw-edit-btn').forEach(el => el.remove());
      // Only remove overlays that are NOT inside the lightbox — the lightbox
      // overlay is managed by openPhotoLightbox's render() and must be preserved.
      document.querySelectorAll('.lp-draw-overlay-svg').forEach(el => {
        if (!el.closest('#lp-lightbox')) el.remove();
      });
      return;
    }

    // ── Helper: ensure the edit button exists in wrap (idempotent) ────────────
    function _ensureDrawBtn(img, wrap) {
      if (wrap.querySelector('.lp-draw-edit-btn')) return; // already there — no DOM mutation
      // wrap already has position:relative set by installPhotoClickHandlers
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      const btn = document.createElement('button');
      btn.className = 'lp-draw-edit-btn';
      btn.title = 'Edit spot drawing';
      btn.innerHTML =
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
          '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
        '</svg>Edit drawing';
      wrap.appendChild(btn);
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openPadDrawEditor(img);
      });
      console.log('[Lily Pad] Draw edit btn injected');
    }

    // ── Shared: idempotent overlay helper ────────────────────────────────────
    function _applyOverlay(fakeImg, container) {
      const saved = _loadPadBox(fakeImg.src);
      if (!saved) return;
      const newHash = JSON.stringify(saved);
      const existingSvg = container.querySelector('.lp-draw-overlay-svg');
      if (!existingSvg || existingSvg.dataset.lpHash !== newHash) {
        overlayPadDrawing(fakeImg, container);
        const freshSvg = container.querySelector('.lp-draw-overlay-svg');
        if (freshSvg) freshSvg.dataset.lpHash = newHash;
      }
    }

    // ── Path 1: SVG-overlay pad cards (img sibling of svg[viewBox="0 0 100 70"]) ─
    document.querySelectorAll('svg[viewBox="0 0 100 70"]').forEach(svg => {
      const wrap = svg.parentElement;
      if (!wrap) return;
      const img = wrap.querySelector('img');
      if (!img || !img.src) return;
      if (wrap.closest('#lp-lightbox,#lp-draw-editor')) return;

      _ensureDrawBtn(img, wrap);
      if (!wrap.dataset.lpDrawEdit) wrap.dataset.lpDrawEdit = '1';
      wrap.dataset.lpPhotoSrc = img.src; // store URL for reliable post-save refresh
      _applyOverlay({ src: img.src }, wrap);
    });

    // ── Path 2: background-image div photos ───────────────────────────────────
    // My Pads may render photos as <div style="background:url(...)"> rather
    // than <img>.  installPhotoClickHandlers already hooks the click; here we
    // inject the "Edit drawing" button AND overlay the saved spot polygon.
    document.querySelectorAll('div[style*="url("]').forEach(div => {
      if (div.closest('#lp-lightbox,#lp-draw-editor')) return;
      if (div.closest('.leaflet-tile-container,.leaflet-layer,.leaflet-pane,[class*="leaflet"]')) return;
      const bg = div.style.background || div.style.backgroundImage || '';
      const urlMatch = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!urlMatch) return;
      const photoUrl = urlMatch[1];
      if (!photoUrl.startsWith('http') && !photoUrl.startsWith('data:image')) return;
      const h = div.offsetHeight || div.getBoundingClientRect().height;
      if (h < 60) return;
      const fakeImg = { src: photoUrl };
      _ensureDrawBtn(fakeImg, div);
      if (!div.dataset.lpDrawEdit) div.dataset.lpDrawEdit = '1';
      div.dataset.lpPhotoSrc = photoUrl; // store URL for reliable post-save refresh
      _applyOverlay(fakeImg, div);
    });
  }

  // ── Photo overlay on ALL pages (lister + customer/driver) ────────────────
  // Renders the saved green polygon on any pad photo that has one stored in
  // localStorage — no page-gate, so customers see the spot on listing views
  // just as the lister does on My Pads.  Edit-button injection is still
  // lister-only (inside injectPadDrawEdit).  Idempotent: checks a hash so
  // it only touches the DOM when the saved drawing has actually changed.
  function injectAllPhotoOverlays() {
    function _tryOverlay(src, container) {
      const saved = _loadPadBox(src);
      if (!saved) return;
      const newHash = JSON.stringify(saved);
      const existing = container.querySelector('.lp-draw-overlay-svg');
      if (existing && existing.dataset.lpHash === newHash) return;
      overlayPadDrawing({ src }, container);
      const fresh = container.querySelector('.lp-draw-overlay-svg');
      if (fresh) fresh.dataset.lpHash = newHash;
    }

    // Path A: img inside SVG-overlay card container
    document.querySelectorAll('svg[viewBox="0 0 100 70"]').forEach(svg => {
      const wrap = svg.parentElement;
      if (!wrap || wrap.closest('#lp-lightbox,#lp-draw-editor')) return;
      const img = wrap.querySelector('img');
      if (img && img.src) _tryOverlay(img.src, wrap);
    });

    // Path B: background-image photo divs (driver listing / booking views)
    document.querySelectorAll('div[style*="url("]').forEach(div => {
      if (div.closest('#lp-lightbox,#lp-draw-editor')) return;
      if (div.closest('.leaflet-tile-container,.leaflet-layer,.leaflet-pane,[class*="leaflet"]')) return;
      const bg = div.style.background || div.style.backgroundImage || '';
      const m  = bg.match(/url\(["']?([^"')]+)["']?\)/);
      if (!m) return;
      const photoUrl = m[1];
      if (!photoUrl.startsWith('http') && !photoUrl.startsWith('data:image')) return;
      const h = div.offsetHeight || div.getBoundingClientRect().height;
      if (h < 60) return;
      _tryOverlay(photoUrl, div);
    });
  }

  // Show a brief toast notification
  function showLpToast(msg) {
    const t = document.createElement('div');
    t.className = 'lp-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => t.classList.add('lp-toast-visible'));
    });
    setTimeout(() => {
      t.classList.remove('lp-toast-visible');
      setTimeout(() => t.remove(), 300);
    }, 2500);
  }

  // Full-screen drawing editor modal
  // Interactions:
  //   • Drag on blank area         → draw a new shape (rectangle seed)
  //   • Drag the green pill tab    → move the whole shape
  //   • Drag any white corner dot  → move ONLY that corner (others stay fixed)
  //   • Rotate button (↻)         → rotate 15° clockwise around centroid
  //   • Clear                      → remove shape so you can redraw
  //   • Save                       → persist quad and update thumbnail
  function openPadDrawEditor(img) {
    if (document.getElementById('lp-draw-editor')) return;

    // Load existing drawing — support both legacy {cx,cy,w,h} and new quad format
    const raw = _loadPadBox(img.src);
    let quad = null; // array of 4 {x,y} points: [TL, TR, BR, BL] in 0-1 coords
    if (raw) {
      if (Array.isArray(raw) && raw.length === 4) {
        quad = raw.map(p => ({ x: p.x, y: p.y }));
      } else if (raw.w > 0.01) {
        quad = _rectToQuad(raw);
      }
    }

    // ── Interaction state ─────────────────────────────────────────────────────
    // mode: 'idle' | 'draw' | 'move' | 'corner' | 'rotate'
    let mode                = 'idle';
    let drawStart           = { x: 0, y: 0 };
    let moveDelta           = { dx: 0, dy: 0 }; // offset from centroid (move)
    let activeCorner        = -1;               // index into quad[] being dragged
    let rotateStartAngle    = 0;                // atan2 angle at drag start (rotate)
    let rotateStartQuad     = null;             // quad snapshot at drag start (rotate)
    let rotateStartCentroid = null;             // centroid snapshot at drag start

    // ── DOM ───────────────────────────────────────────────────────────────────
    const modal = document.createElement('div');
    modal.id = 'lp-draw-editor';
    modal.innerHTML =
      '<div class="lp-de-bg"></div>' +
      '<div class="lp-de-inner">' +
        '<div class="lp-de-header">' +
          '<span class="lp-de-title">Edit Parking Spot</span>' +
          '<button class="lp-de-close">&#x2715;</button>' +
        '</div>' +
        '<div class="lp-de-hint">Drag on the photo to draw your spot</div>' +
        '<div class="lp-de-canvas-wrap">' +
          '<img class="lp-de-photo" src="' + img.src + '" alt="Pad photo" draggable="false">' +
          '<svg class="lp-de-box-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' +
            '<rect class="lp-de-bg-hit" x="0" y="0" width="100" height="100" ' +
                  'fill="transparent" style="cursor:crosshair"/>' +
          '</svg>' +
        '</div>' +
        '<div class="lp-de-footer">' +
          '<button class="lp-de-clear">Clear</button>' +
          '<button class="lp-de-save">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    const boxSvg   = modal.querySelector('.lp-de-box-svg');
    const bgHit    = modal.querySelector('.lp-de-bg-hit');
    const saveBtn  = modal.querySelector('.lp-de-save');
    const clearBtn = modal.querySelector('.lp-de-clear');
    const closeBtn = modal.querySelector('.lp-de-close');
    const hint     = modal.querySelector('.lp-de-hint');
    const ns       = 'http://www.w3.org/2000/svg';

    // Dynamic SVG elements (rebuilt by renderQuad)
    let svgPoly = null, svgTab = null, svgLabel = null;
    let svgRotLine = null, svgRotHandle = null, svgRotSymbol = null;
    let svgCorners = []; // 4 circle elements

    // Normalise a pointer/touch event to 0-1 coords over the SVG
    function normXY(e) {
      const r = boxSvg.getBoundingClientRect();
      const t = e.touches ? (e.touches[0] || e.changedTouches[0]) : e;
      return {
        x: Math.max(0, Math.min(1, (t.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (t.clientY - r.top)  / r.height)),
      };
    }

    // Compute centroid of the current quad
    function centroid() {
      return {
        x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
        y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
      };
    }

    // Clamp a point to [0,1]×[0,1]
    function clamp01(p) {
      return { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
    }

    // Rebuild the SVG visuals from the current quad.
    // DOM paint order: bgHit → svgPoly → svgTab → svgLabel → svgCorners → svgRotLine → svgRotHandle
    function renderQuad() {
      if (svgPoly)      { svgPoly.remove();      svgPoly      = null; }
      if (svgTab)       { svgTab.remove();       svgTab       = null; }
      if (svgLabel)     { svgLabel.remove();     svgLabel     = null; }
      if (svgRotLine)   { svgRotLine.remove();   svgRotLine   = null; }
      if (svgRotHandle) { svgRotHandle.remove(); svgRotHandle = null; }
      if (svgRotSymbol) { svgRotSymbol.remove(); svgRotSymbol = null; }
      svgCorners.forEach(c => c.remove());
      svgCorners = [];

      if (!quad) return;

      // Polygon fill
      svgPoly = document.createElementNS(ns, 'polygon');
      svgPoly.setAttribute('points',
        quad.map(p => (p.x * 100).toFixed(2) + ',' + (p.y * 100).toFixed(2)).join(' '));
      svgPoly.setAttribute('fill',         'rgba(76,175,80,0.22)');
      svgPoly.setAttribute('stroke',       '#4caf50');
      svgPoly.setAttribute('stroke-width', '2');
      svgPoly.setAttribute('vector-effect','non-scaling-stroke');
      svgPoly.style.cursor = 'move';
      svgPoly.dataset.lpRole = 'move';
      bgHit.insertAdjacentElement('afterend', svgPoly);

      // Move-tab pill at the topmost point of the quad
      const cen  = centroid();
      const topY = Math.min(quad[0].y, quad[1].y, quad[2].y, quad[3].y);
      const tabW = 18, tabH = 6;
      svgTab = document.createElementNS(ns, 'rect');
      svgTab.setAttribute('x',      cen.x * 100 - tabW / 2);
      svgTab.setAttribute('y',      topY  * 100 - tabH - 2);
      svgTab.setAttribute('width',  tabW);
      svgTab.setAttribute('height', tabH);
      svgTab.setAttribute('rx',     tabH / 2);
      svgTab.setAttribute('fill',   '#4caf50');
      svgTab.setAttribute('stroke', '#fff');
      svgTab.setAttribute('stroke-width', '1.2');
      svgTab.setAttribute('vector-effect', 'non-scaling-stroke');
      svgTab.style.cursor = 'grab';
      svgTab.dataset.lpRole = 'move';
      boxSvg.appendChild(svgTab);

      // "Your spot" label
      svgLabel = document.createElementNS(ns, 'text');
      svgLabel.setAttribute('x', cen.x * 100);
      svgLabel.setAttribute('y', topY  * 100 - tabH - 5);
      svgLabel.setAttribute('text-anchor', 'middle');
      svgLabel.setAttribute('font-size',   '4.5');
      svgLabel.setAttribute('font-family', 'DM Sans, sans-serif');
      svgLabel.setAttribute('font-weight', '600');
      svgLabel.setAttribute('fill',        '#4caf50');
      svgLabel.setAttribute('pointer-events', 'none');
      svgLabel.textContent = 'Your spot';
      boxSvg.appendChild(svgLabel);

      // Corner handles — subtle small diamonds (rotated rects), no white blobs
      const cursors = ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'];
      quad.forEach((pt, i) => {
        const cx = (pt.x * 100).toFixed(2), cy = (pt.y * 100).toFixed(2);
        const c = document.createElementNS(ns, 'rect');
        c.setAttribute('x',      (pt.x * 100 - 3.5).toFixed(2));
        c.setAttribute('y',      (pt.y * 100 - 3.5).toFixed(2));
        c.setAttribute('width',  '7');
        c.setAttribute('height', '7');
        c.setAttribute('rx',     '1');
        c.setAttribute('transform', `rotate(45,${cx},${cy})`);
        c.setAttribute('fill',         '#4caf50');
        c.setAttribute('stroke',       'rgba(255,255,255,0.85)');
        c.setAttribute('stroke-width', '1.5');
        c.setAttribute('vector-effect','non-scaling-stroke');
        c.style.cursor = cursors[i];
        c.dataset.lpRole   = 'corner';
        c.dataset.lpCorner = String(i);
        boxSvg.appendChild(c);
        svgCorners.push(c);
      });

      // Rotate handle — circle above the shape connected by a dashed stem.
      // Drag it to rotate to any angle.
      const rotStemX  = cen.x * 100;
      const rotStemY0 = topY  * 100;
      const rotHY     = Math.max(4, topY * 100 - 18); // 18 SVG units above top, clamped
      svgRotLine = document.createElementNS(ns, 'line');
      svgRotLine.setAttribute('x1', rotStemX);
      svgRotLine.setAttribute('y1', rotStemY0);
      svgRotLine.setAttribute('x2', rotStemX);
      svgRotLine.setAttribute('y2', rotHY);
      svgRotLine.setAttribute('stroke',          '#4caf50');
      svgRotLine.setAttribute('stroke-width',    '1.5');
      svgRotLine.setAttribute('stroke-dasharray','2.5,2');
      svgRotLine.setAttribute('vector-effect',   'non-scaling-stroke');
      svgRotLine.setAttribute('pointer-events',  'none');
      boxSvg.appendChild(svgRotLine);

      svgRotHandle = document.createElementNS(ns, 'circle');
      svgRotHandle.setAttribute('cx', rotStemX);
      svgRotHandle.setAttribute('cy', rotHY);
      svgRotHandle.setAttribute('r',  '7');
      svgRotHandle.setAttribute('fill',         '#4caf50');
      svgRotHandle.setAttribute('stroke',       'rgba(255,255,255,0.85)');
      svgRotHandle.setAttribute('stroke-width', '1.5');
      svgRotHandle.setAttribute('vector-effect','non-scaling-stroke');
      svgRotHandle.style.cursor     = 'grab';
      svgRotHandle.dataset.lpRole   = 'rotate';
      boxSvg.appendChild(svgRotHandle);

      // ↻ symbol on top — pointer-events:none so circle handles the drag
      svgRotSymbol = document.createElementNS(ns, 'text');
      svgRotSymbol.setAttribute('x',                  rotStemX);
      svgRotSymbol.setAttribute('y',                  rotHY + 0.5);
      svgRotSymbol.setAttribute('text-anchor',        'middle');
      svgRotSymbol.setAttribute('dominant-baseline',  'middle');
      svgRotSymbol.setAttribute('font-size',          '8');
      svgRotSymbol.setAttribute('font-family',        'system-ui, sans-serif');
      svgRotSymbol.setAttribute('fill',               '#fff');
      svgRotSymbol.setAttribute('pointer-events',     'none');
      svgRotSymbol.setAttribute('user-select',        'none');
      svgRotSymbol.textContent = '↻';
      boxSvg.appendChild(svgRotSymbol);
    }

    renderQuad();

    // ── Unified SVG pointer handling ──────────────────────────────────────────
    boxSvg.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      boxSvg.setPointerCapture(e.pointerId);
      const p    = normXY(e);
      const role = e.target.dataset.lpRole;

      if (role === 'rotate') {
        mode = 'rotate';
        const cen = centroid();
        rotateStartAngle    = Math.atan2(p.y - cen.y, p.x - cen.x);
        rotateStartQuad     = quad.map(pt => ({ x: pt.x, y: pt.y }));
        rotateStartCentroid = { x: cen.x, y: cen.y };
        hint.textContent = 'Drag to rotate to any angle';
      } else if (role === 'corner') {
        // Move only this corner; others stay put
        mode = 'corner';
        activeCorner = parseInt(e.target.dataset.lpCorner, 10);
        hint.textContent = 'Drag to move this corner — others stay fixed';
      } else if (role === 'move') {
        mode = 'move';
        const cen = centroid();
        moveDelta = { dx: p.x - cen.x, dy: p.y - cen.y };
        hint.textContent = 'Drag to reposition your spot';
      } else {
        // Blank area — start a fresh rectangle draw
        mode      = 'draw';
        drawStart = p;
        quad = null;
        renderQuad();
        hint.textContent = 'Drag to set the size of your spot';
      }
    });

    boxSvg.addEventListener('pointermove', e => {
      if (mode === 'idle') return;
      e.preventDefault();
      const p = normXY(e);

      if (mode === 'draw') {
        const left  = Math.min(drawStart.x, p.x);
        const right = Math.max(drawStart.x, p.x);
        const top   = Math.min(drawStart.y, p.y);
        const bot   = Math.max(drawStart.y, p.y);
        quad = [
          { x: left,  y: top },   // TL
          { x: right, y: top },   // TR
          { x: right, y: bot },   // BR
          { x: left,  y: bot },   // BL
        ];
      } else if (mode === 'move') {
        // Translate all 4 corners together
        const cen = centroid();
        const newCen = { x: p.x - moveDelta.dx, y: p.y - moveDelta.dy };
        const dx = newCen.x - cen.x, dy = newCen.y - cen.y;
        quad = quad.map(pt => clamp01({ x: pt.x + dx, y: pt.y + dy }));
        // Update anchor so grab feels sticky
        const updatedCen = centroid();
        moveDelta = { dx: p.x - updatedCen.x, dy: p.y - updatedCen.y };
      } else if (mode === 'corner') {
        // Move only the active corner — the other 3 are untouched
        const newQuad = quad.map((pt, i) =>
          i === activeCorner ? clamp01(p) : { x: pt.x, y: pt.y }
        );
        quad = newQuad;
      } else if (mode === 'rotate') {
        // Rotate all corners around the centroid snapshot from drag start.
        // Using startQuad (not live quad) avoids accumulated floating-point drift.
        const cen     = rotateStartCentroid;
        const newAngle = Math.atan2(p.y - cen.y, p.x - cen.x);
        const delta    = newAngle - rotateStartAngle;
        const cos      = Math.cos(delta), sin = Math.sin(delta);
        quad = rotateStartQuad.map(pt => {
          const dx = pt.x - cen.x, dy = pt.y - cen.y;
          return clamp01({
            x: cen.x + dx * cos - dy * sin,
            y: cen.y + dx * sin + dy * cos,
          });
        });
      }
      renderQuad();
    });

    boxSvg.addEventListener('pointerup', e => {
      if (mode === 'idle') return;
      e.preventDefault();
      const prevMode = mode;
      mode = 'idle';

      if (prevMode === 'draw') {
        // Reject tiny accidental taps — quad may still be null if no pointermove fired
        if (!quad) {
          hint.textContent = 'Try dragging a larger area across your photo.';
          renderQuad();
          return;
        }
        const w = (quad[1].x - quad[0].x), h = (quad[3].y - quad[0].y);
        if (w > 0.04 && h > 0.02) {
          hint.textContent = 'Looking good! Drag corners to adjust, or tap Save.';
        } else {
          quad = null;
          hint.textContent = 'Try dragging a larger area across your photo.';
        }
        renderQuad();
      } else {
        renderQuad();
        hint.textContent = 'Tap Save to apply, or keep adjusting.';
      }
    });

    boxSvg.addEventListener('pointercancel', () => { mode = 'idle'; });
    boxSvg.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

    // ── Buttons ───────────────────────────────────────────────────────────────
    clearBtn.addEventListener('click', () => {
      quad = null;
      renderQuad();
      hint.textContent = 'Spot cleared — drag on the photo to draw a new one';
    });

    function closeModal() { modal.remove(); }
    closeBtn.addEventListener('click', closeModal);
    modal.querySelector('.lp-de-bg').addEventListener('click', closeModal);

    saveBtn.addEventListener('click', () => {
      if (!quad) {
        hint.textContent = 'Draw a spot first, then tap Save.';
        return;
      }
      _savePadBox(img.src, quad);
      closeModal();
      // Directly refresh every tagged container — more reliable than URL re-matching
      // because data-lp-photo-src was set at the same time the edit button was
      // created (same URL, same _padBoxKey hash).
      document.querySelectorAll('[data-lp-photo-src]').forEach(c => {
        if (c.closest('#lp-lightbox,#lp-draw-editor')) return;
        overlayPadDrawing({ src: c.dataset.lpPhotoSrc }, c);
      });
      // Belt-and-suspenders: also run the full overlay scan after a short delay
      // in case React re-rendered the containers between closeModal() and here.
      setTimeout(() => injectAllPhotoOverlays(), 250);
      showLpToast('Spot saved!');
      console.log('[Lily Pad] Pad drawing saved (quad):', JSON.stringify(quad));
    });

    console.log('[Lily Pad] Draw editor opened. Existing quad:', JSON.stringify(quad));
  }

  // ── Admin/Staff panel — real user accounts from Supabase ─────────────────
  let _adminUsers = null;
  let _adminFetching = false;
  let _adminTab = 'renters';
  let _adminSearch = '';

  function _isAdminOrStaff() {
    return _lpCurrentRole === 'admin' || _lpCurrentRole === 'staff';
  }

  function _isAdminView() {
    if (lpGetCurrentPage() === 'admin') return true;
    return Array.from(document.querySelectorAll('h1,h2,h3,[class*="title"]')).some(
      el => el.childElementCount === 0 && el.textContent.trim() === 'All Accounts'
    );
  }

  function _adminInitials(name) {
    const parts = (name || '?').split(' ').filter(Boolean);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : (parts[0] || '?').slice(0, 2).toUpperCase();
  }

  async function _fetchAdminUsers(force) {
    if (_adminFetching && !force) return;
    _adminFetching = true;
    try {
      const r = await fetch('/api/admin/users');
      if (r.ok) { _adminUsers = await r.json(); _renderAdminPanel(); }
    } catch (e) { console.warn('[LP] admin users fetch failed:', e.message); }
    finally { _adminFetching = false; }
  }

  function _renderAdminPanel() {
    const panel = document.getElementById('lp-admin-panel');
    if (!panel || !_adminUsers) return;

    const renters = _adminUsers.filter(u => u.account_type !== 'padRenter' && u.account_type !== 'admin' && u.account_type !== 'staff');
    const hosts   = _adminUsers.filter(u => u.account_type === 'padRenter');

    const _tabBar = () => `
      <div class="lp-ap-tabs">
        <button class="lp-ap-tab ${_adminTab==='renters'?'active':''}" data-tab="renters">🚗 Renters (${renters.length})</button>
        <button class="lp-ap-tab ${_adminTab==='hosts'?'active':''}" data-tab="hosts">🏠 Hosts (${hosts.length})</button>
        <button class="lp-ap-tab ${_adminTab==='chats'?'active':''}" data-tab="chats">💬 Chats (${_supportConvs.length})</button>
      </div>`;

    // ── Chats tab: only users who have had message interactions ──────────────
    if (_adminTab === 'chats') {
      if (_supportConvs.length === 0) _fetchConversations();
      const convsSorted = [..._supportConvs].sort((a, b) =>
        new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
      );
      panel.querySelector('.lp-ap-content').innerHTML = `
        ${_tabBar()}
        <div class="lp-ap-meta-row">
          <span>CURRENT &amp; PAST ACTIVE CHATS</span>
          <button class="lp-ap-new-msg-btn">+ New Message</button>
        </div>
        <div class="lp-ap-list">
          ${convsSorted.length === 0
            ? '<div class="lp-ap-empty">No conversations yet — use + New Message to start one.</div>'
            : convsSorted.map(c => {
                const name    = c.user_name || c.user_email || 'Customer';
                const preview = (c.last_message || 'No messages yet').slice(0, 55);
                const stCls   = c.status === 'closed' ? 'susp' : c.status === 'pending' ? 'pend' : 'verif';
                const stLbl   = (c.status || 'open').toUpperCase();
                return `
                <div class="lp-ap-row lp-ap-conv-row" data-cid="${c.id}">
                  <div class="lp-ap-avatar">${_adminInitials(name)}</div>
                  <div class="lp-ap-info">
                    <div class="lp-ap-name">${name}</div>
                    <div class="lp-ap-email">${preview}</div>
                  </div>
                  <div class="lp-ap-meta-r">
                    <span class="lp-ap-badge ${stCls}">${stLbl}</span>
                    <div class="lp-ap-bcount">${_tsRelative(c.updated_at)}</div>
                  </div>
                </div>`;
              }).join('')
          }
        </div>`;
      panel.querySelectorAll('.lp-ap-tab').forEach(btn =>
        btn.addEventListener('click', () => { _adminTab = btn.dataset.tab; _renderAdminPanel(); })
      );
      panel.querySelector('.lp-ap-new-msg-btn')?.addEventListener('click', () => _openNewChatModal());
      panel.querySelectorAll('.lp-ap-conv-row').forEach(row => {
        const c = _supportConvs.find(x => x.id === row.dataset.cid);
        if (c) row.addEventListener('click', () => _openDrawerConv(c));
      });
      return;
    }

    // ── Renters / Hosts tabs ──────────────────────────────────────────────────
    const isHosts = _adminTab === 'hosts';
    const pool    = isHosts ? hosts : renters;
    const q       = _adminSearch.toLowerCase();
    const visible = q ? pool.filter(u => (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)) : pool;
    const sorted  = [...visible].sort((a, b) => (b.spend_total || 0) - (a.spend_total || 0));

    panel.querySelector('.lp-ap-content').innerHTML = `
      ${_tabBar()}
      <div class="lp-ap-meta-row">
        <span>SORTED BY SPEND · HIGHEST FIRST</span><span>${sorted.length} shown</span>
      </div>
      <div class="lp-ap-search-wrap">
        <input class="lp-ap-search" placeholder="Search by name or email" value="${_adminSearch.replace(/"/g, '&quot;')}">
      </div>
      <div class="lp-ap-list">
        ${sorted.length === 0
          ? `<div class="lp-ap-empty">No ${isHosts ? 'hosts' : 'renters'} registered yet.</div>`
          : sorted.map(u => {
              const name  = u.full_name || u.email || 'Unknown';
              const susp  = u.status === 'suspended';
              const verif = u.status === 'verified';
              const spend = u.spend_total ? '$' + Math.round(u.spend_total) : '$0';
              const bc    = u.booking_count || 0;
              return `
              <div class="lp-ap-row" data-uid="${u.id}">
                <div class="lp-ap-avatar">${_adminInitials(name)}</div>
                <div class="lp-ap-info">
                  <div class="lp-ap-name">
                    ${name} <span class="lp-ap-star">★</span>
                    ${susp  ? '<span class="lp-ap-badge susp">SUSPENDED</span>' : ''}
                    ${verif ? '<span class="lp-ap-badge verif">VERIFIED</span>' : ''}
                  </div>
                  <div class="lp-ap-email">${u.email || ''}</div>
                </div>
                <div class="lp-ap-meta-r">
                  <div class="lp-ap-spend">${spend}</div>
                  <div class="lp-ap-bcount">${bc} booking${bc !== 1 ? 's' : ''}</div>
                </div>
              </div>`;
            }).join('')
        }
      </div>`;

    panel.querySelectorAll('.lp-ap-tab').forEach(btn =>
      btn.addEventListener('click', () => { _adminTab = btn.dataset.tab; _renderAdminPanel(); })
    );
    const srch = panel.querySelector('.lp-ap-search');
    if (srch) srch.addEventListener('input', () => { _adminSearch = srch.value; _renderAdminPanel(); });
    panel.querySelectorAll('.lp-ap-row').forEach(row =>
      row.addEventListener('click', () => {
        const u = _adminUsers.find(x => x.id === row.dataset.uid);
        if (u) _showAdminActions(u);
      })
    );
  }

  function _showAdminActions(user) {
    document.getElementById('lp-admin-sheet')?.remove();
    const susp = user.status === 'suspended';
    const verif = user.status === 'verified';
    const sheet = document.createElement('div');
    sheet.id = 'lp-admin-sheet';
    sheet.innerHTML = `
      <div class="lp-sheet-backdrop"></div>
      <div class="lp-sheet-body">
        <div class="lp-sheet-name">${user.full_name || user.email}</div>
        <div class="lp-sheet-email">${user.email || ''}</div>
        <div class="lp-sheet-type">${user.account_type === 'padRenter' ? '🏠 Host' : '🚗 Renter'} · Joined ${user.created_at ? new Date(user.created_at).toLocaleDateString() : 'unknown'}</div>
        <div class="lp-sheet-actions">
          <button class="lp-sheet-btn" data-action="message">💬 Message User</button>
          ${susp
            ? '<button class="lp-sheet-btn green" data-action="reinstate">✓ Reinstate Account</button>'
            : '<button class="lp-sheet-btn red"   data-action="suspend">⊘ Suspend Account</button>'}
          ${verif
            ? '<button class="lp-sheet-btn" data-action="unverify">✗ Remove Verification</button>'
            : '<button class="lp-sheet-btn" data-action="verify">✓ Verify Account</button>'}
          <button class="lp-sheet-btn ghost" data-action="cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('open'));

    const close = () => { sheet.classList.remove('open'); setTimeout(() => sheet.remove(), 220); };
    sheet.querySelector('.lp-sheet-backdrop').addEventListener('click', close);
    sheet.querySelector('[data-action="cancel"]').addEventListener('click', close);

    sheet.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        if (action === 'cancel') return;
        if (action === 'message') { close(); _openAdminChatWith(user); return; }
        const statusMap = { suspend: 'suspended', reinstate: 'active', verify: 'verified', unverify: 'active' };
        const newStatus = statusMap[action];
        if (!newStatus) return;
        btn.disabled = true;
        try {
          const r = await fetch(`/api/admin/users/${user.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          });
          if (r.ok) {
            const idx = (_adminUsers || []).findIndex(u => u.id === user.id);
            if (idx >= 0) _adminUsers[idx].status = newStatus;
            close();
            _renderAdminPanel();
          }
        } catch (e) { console.warn('[LP] admin action failed:', e.message); btn.disabled = false; }
      });
    });
  }

  // ── Inject "Activate your account" button on native "Choose your role" screen ──
  // The compiled bundle shows a "Choose your role" modal with Staff / Admin buttons
  // during onboarding. We intercept it and add a link to the staff portal.
  function _injectChooseRoleActivateBtn() {
    // Detect the screen by looking for a visible heading with "Choose your role"
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,p,span,div'))
      .find(el =>
        el.childElementCount === 0 &&
        el.getBoundingClientRect().width > 0 &&
        /^choose your role$/i.test(el.textContent.trim())
      );

    const onPage   = !!heading;
    const existing = document.getElementById('lp-choose-role-activate');
    const backBtn  = document.getElementById('lp-choose-role-back');

    // Clean up if we've navigated away
    if (!onPage) {
      if (existing) existing.remove();
      if (backBtn)  backBtn.remove();
      return;
    }
    if (existing) return; // already injected

    // Walk up from the heading to find the card that holds the Staff/Admin buttons
    let card = heading.parentElement;
    for (let i = 0; i < 6 && card; i++) {
      if (card.querySelectorAll('button').length >= 2) break;
      card = card.parentElement;
    }
    if (!card) return;

    // "Activate your account" ghost button — appended after existing role buttons
    const btn = document.createElement('button');
    btn.id = 'lp-choose-role-activate';
    btn.textContent = 'Activate your account';
    btn.setAttribute('style', [
      'display:block',
      'width:calc(100% - 32px)',
      'margin:10px 16px 20px',
      'padding:15px',
      'background:rgba(255,255,255,0.07)',
      'color:rgba(255,255,255,0.8)',
      'border:1px solid rgba(255,255,255,0.15)',
      'border-radius:14px',
      'font-size:15px',
      'font-weight:600',
      'font-family:inherit',
      'cursor:pointer',
      'text-align:center',
      'box-sizing:border-box',
    ].join(';'));
    btn.addEventListener('click', () => { window.location.href = '/staff-login'; });
    card.appendChild(btn);

    // ← Back button fixed top-left (same style as other back buttons)
    const back = document.createElement('button');
    back.id = 'lp-choose-role-back';
    back.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>' +
      '<span style="font-size:13px;font-weight:600;font-family:\'DM Sans\',sans-serif">Back</span>';
    back.setAttribute('style', [
      'position:fixed',
      _lpAppInset(),
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'gap:5px',
      'background:rgba(14,31,64,0.82)',
      'color:#fff',
      'border:none',
      'border-radius:20px',
      'padding:6px 14px 6px 10px',
      'cursor:pointer',
      'box-shadow:0 2px 8px rgba(0,0,0,0.28)',
      'backdrop-filter:blur(4px)',
      '-webkit-backdrop-filter:blur(4px)',
    ].join(';'));
    back.addEventListener('click', () => { history.back(); });
    document.body.appendChild(back);

    console.log('[Lily Pad] _injectChooseRoleActivateBtn: injected on Choose your role screen');
  }

  function injectAdminPanel() {
    if (!_isAdminOrStaff()) return;
    if (!_isAdminView()) { document.getElementById('lp-admin-panel')?.remove(); return; }
    if (document.getElementById('lp-admin-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'lp-admin-panel';
    panel.innerHTML = `
      <div class="lp-ap-header">
        <div class="lp-ap-breadcrumb">ADMIN · USERS</div>
        <div class="lp-ap-title-row">
          <h2 class="lp-ap-title">All Accounts</h2>
          <button class="lp-ap-refresh" title="Refresh">↻</button>
        </div>
      </div>
      <div class="lp-ap-content"><div class="lp-ap-loading">Loading accounts…</div></div>`;
    document.body.appendChild(panel);

    panel.querySelector('.lp-ap-refresh').addEventListener('click', () => { _fetchAdminUsers(true); _fetchConversations(); });
    _fetchAdminUsers();
    _fetchConversations(); // pre-load so Chats tab is ready immediately
  }

  // ── Support chat — 3-way messaging: customer ↔ staff ↔ admin ─────────────
  let _supportConvs = [];
  let _supportActiveConv = null;
  let _supportMessages = [];
  let _supportPollTimer = null;
  let _supportMsgPollTimer = null;
  let _supportPrevMsgCount = 0; // detect new incoming messages
  let _lpAutoOpenedNew = false;  // fire new-request form once per session if no convs

  // ── Chat drawer state ──────────────────────────────────────────────────────
  let _drawerActiveConv   = null;
  let _drawerMsgPoll      = null;
  let _drawerPrevMsgCount = 0;   // kept for legacy ref; full-rerender now used
  let _supportViewMissCount = 0; // consecutive "not on support" guard cycles (debounce)

  // ── Admin native-chat-detail bridge state ─────────────────────────────────
  // Tracks the conversation whose messages we're mirroring into the admin's
  // native "Reply as Admin" view so both sides share the same data source.
  let _lpAdminDetailConv  = null;
  let _lpAdminDetailPoll  = null;
  let _lpAdminDetailCount = 0;

  // ── Unread tracking ───────────────────────────────────────────────────────
  // Tracks the last timestamp (ms) each conversation was read, stored in
  // localStorage so it survives page refreshes.
  const _LP_SEEN_KEY = 'lp.support.seen';
  let _lpUnreadMap = {};
  function _lpLoadSeen() {
    try { _lpUnreadMap = JSON.parse(localStorage.getItem(_LP_SEEN_KEY) || '{}'); } catch { _lpUnreadMap = {}; }
  }
  function _lpMarkSeen(convId) {
    _lpUnreadMap[convId] = Date.now();
    try { localStorage.setItem(_LP_SEEN_KEY, JSON.stringify(_lpUnreadMap)); } catch {}
  }
  function _lpIsUnread(conv) {
    if (!conv.last_message) return false;
    const seen = _lpUnreadMap[conv.id];
    if (!seen) return true; // never opened
    const lat = conv.last_message_at || conv.updated_at;
    return lat ? (new Date(lat).getTime() > seen) : false;
  }
  function _lpUnreadCount() { return _supportConvs.filter(_lpIsUnread).length; }
  function _lpUpdateHeaderBadge() {
    const badge = document.getElementById('lp-sup-hdr-badge');
    if (!badge) return;
    const n = _lpUnreadCount();
    badge.textContent = n;
    badge.style.display = n > 0 ? '' : 'none';
  }

  function _isSupportView() {
    // Fastest check: our own real-conv-list is only injected inside the support
    // page's React subtree — React removes it the moment it navigates away.
    if (document.getElementById('lp-real-conv-list')) return true;
    // Fiber check: reliable even during brief React re-renders of the support view
    if (lpGetCurrentPage() === 'support') return true;
    // Text fallback: catches the very first guard cycle before we've injected anything
    return Array.from(document.querySelectorAll('h1,h2,h3,span,p')).some(
      el => el.childElementCount === 0 &&
        /^(Customer Service|Support|Help & Support)$/.test(el.textContent.trim())
    );
  }

  function _getLpUser() {
    const session = getSession();
    if (!session) return null;
    const user = session.user || {};
    const meta = user.user_metadata || session.user_metadata || {};
    return {
      id:    user.id || session.user_id || null,
      name:  (meta.full_name || meta.name || user.email || 'Customer').trim(),
      email: user.email || session.email || '',
      role:  _lpCurrentRole,
    };
  }

  function _tsRelative(iso) {
    if (!iso) return '';
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  async function _fetchConversations() {
    const me = _getLpUser();
    if (!me || !me.id) { console.warn('[LP] _fetchConversations: no me or no me.id — aborting', me); return; }
    try {
      const isPriv = me.role === 'admin' || me.role === 'staff';
      const url = isPriv
        ? '/api/support/conversations'
        : `/api/support/conversations?user_id=${me.id}`;
      console.log('[LP] fetchConvs: me.id=', me.id, '| role=', me.role, '| url=', url);
      const r = await fetch(url);
      if (r.ok) {
        _supportConvs = await r.json();
        console.log('[LP] fetchConvs: got', _supportConvs.length, 'conversations');
        _renderSupportList();
        _renderRealConvList();
        _lpUpdateHeaderBadge();
        injectSupportNavBadge();
      } else {
        console.warn('[LP] fetchConvs: HTTP error', r.status);
      }
    } catch (e) { console.warn('[LP] fetchConvs error:', e.message); }
  }

  async function _fetchMessages(convId) {
    try {
      const r = await fetch(`/api/support/conversations/${convId}/messages`);
      if (r.ok) { _supportMessages = await r.json(); _renderMessages(); }
    } catch {}
  }

  function _renderSupportList() {
    const panel = document.getElementById('lp-support-panel');
    if (!panel) return;
    const me = _getLpUser();
    const isPriv = me && (me.role === 'admin' || me.role === 'staff');
    const list = panel.querySelector('.lp-sup-list');
    if (!list) return;

    if (_supportConvs.length === 0) {
      list.innerHTML = `<div class="lp-sup-empty">${isPriv ? 'No open conversations.' : 'No conversations yet.<br>Start one to get help.'}</div>`;
      return;
    }
    list.innerHTML = _supportConvs.map(c => {
      const name = isPriv ? (c.user_name || c.user_email || 'Customer') : (c.subject || 'Support Request');
      const preview = (c.last_message || 'No messages yet').slice(0, 70);
      const stCls = c.status === 'closed' ? 'closed' : c.status === 'pending' ? 'pend' : 'open';
      const stLbl = c.status === 'closed' ? 'CLOSED' : c.status === 'pending' ? 'PENDING' : 'OPEN';
      const active = _supportActiveConv && _supportActiveConv.id === c.id ? 'active' : '';
      const unreadDot = _lpIsUnread(c) ? '<span class="lp-sup-unread-dot"></span>' : '';
      return `
        <div class="lp-sup-conv-row ${active}" data-cid="${c.id}">
          <div class="lp-sup-conv-top">
            <span class="lp-sup-conv-name">${name}</span>
            <span class="lp-sup-st ${stCls}">${stLbl}</span>
            ${unreadDot}
            <span class="lp-sup-ts">${_tsRelative(c.updated_at)}</span>
          </div>
          <div class="lp-sup-preview">${preview}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.lp-sup-conv-row').forEach(row =>
      row.addEventListener('click', () => {
        const c = _supportConvs.find(x => x.id === row.dataset.cid);
        if (c) _openConversation(c);
      })
    );
  }

  function _renderMessages() {
    const panel = document.getElementById('lp-support-panel');
    if (!panel) return;
    const msgs = panel.querySelector('.lp-sup-messages');
    if (!msgs) return;
    const me = _getLpUser();
    if (_supportMessages.length === 0) {
      msgs.innerHTML = '<div class="lp-sup-msg-empty">Send a message below.</div>';
      return;
    }
    const prevCount = _supportPrevMsgCount;
    if (prevCount === 0) msgs.innerHTML = ''; // fresh open — clear stale content
    _supportMessages.forEach((m, idx) => {
      if (idx < prevCount) return; // skip already-rendered messages
      const isMine = me && m.sender_id === me.id;
      const roleTag = m.sender_role === 'admin' ? '🛡 Admin' : m.sender_role === 'staff' ? '👤 Staff' : '';
      const safeMsg = m.message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const isNew   = idx >= prevCount && prevCount > 0 ? 'lp-sup-msg-new' : '';
      const el = document.createElement('div');
      el.className = `lp-sup-msg ${isMine ? 'mine' : 'theirs'} ${isNew}`.trim();
      el.setAttribute('data-role', m.sender_role || '');
      el.innerHTML = `
        <div class="lp-sup-msg-meta">
          ${roleTag ? `<span class="lp-sup-role-tag">${roleTag}</span>` : ''}
          <span class="lp-sup-msg-author">${m.sender_name}</span>
          <span class="lp-sup-msg-ts">${_tsRelative(m.created_at)}</span>
        </div>
        <div class="lp-sup-bubble">${safeMsg}</div>`;
      msgs.appendChild(el);
    });
    _supportPrevMsgCount = _supportMessages.length;
    msgs.scrollTop = msgs.scrollHeight;
    if (_supportActiveConv) {
      _lpMarkSeen(_supportActiveConv.id);
      _lpUpdateHeaderBadge();
      injectSupportNavBadge();
    }
  }

  function _openConversation(conv) {
    _supportActiveConv = conv;
    _supportPrevMsgCount = 0;
    _lpMarkSeen(conv.id);
    clearInterval(_supportMsgPollTimer);
    const panel = document.getElementById('lp-support-panel');
    if (!panel) return;
    const me = _getLpUser();
    const isPriv = me && (me.role === 'admin' || me.role === 'staff');

    panel.querySelector('.lp-sup-list-view').style.display  = 'none';
    const tv = panel.querySelector('.lp-sup-thread-view');
    tv.style.display = 'flex';

    const title = isPriv ? (conv.user_name || conv.user_email || 'Customer') : (conv.subject || 'Support Request');
    panel.querySelector('.lp-sup-thread-title').textContent = title;

    const actBox = panel.querySelector('.lp-sup-thread-actions');
    if (isPriv) {
      const statusBtn = conv.status === 'closed'
        ? '<button class="lp-sup-act-btn reopen" data-act="open">↺ Reopen</button>'
        : '<button class="lp-sup-act-btn close-btn" data-act="closed">✓ Close</button>';
      actBox.innerHTML = statusBtn + '<button class="lp-sup-act-btn delete-btn" data-act="delete">🗑 Delete</button>';
      actBox.querySelector('[data-act="delete"]').addEventListener('click', () => _deleteConversation(conv));
      actBox.querySelector('[data-act]:not([data-act="delete"])').addEventListener('click', async function () {
        const newStatus = this.dataset.act;
        const r = await fetch(`/api/support/conversations/${conv.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (r.ok) {
          conv.status = newStatus;
          _openConversation(conv);
          _fetchConversations();
        }
      });
    } else {
      actBox.innerHTML = '';
    }

    _fetchMessages(conv.id);
    _supportMsgPollTimer = setInterval(() => _fetchMessages(conv.id), 5000);
    _renderSupportList();
  }

  async function _sendSupportMessage() {
    const panel = document.getElementById('lp-support-panel');
    if (!panel || !_supportActiveConv) return;
    const ta  = panel.querySelector('.lp-sup-input');
    const msg = (ta ? ta.value : '').trim();
    if (!msg) return;
    const me = _getLpUser();
    if (!me) return;
    ta.value = '';
    ta.disabled = true;
    try {
      const senderRole = (me.role === 'admin' || me.role === 'staff') ? me.role : 'customer';
      await fetch('/api/support/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: _supportActiveConv.id,
          sender_id: me.id, sender_name: me.name, sender_role: senderRole, message: msg,
        }),
      });
      await _fetchMessages(_supportActiveConv.id);
      await _fetchConversations();
    } catch (e) { console.warn('[LP] send failed:', e.message); }
    finally { ta.disabled = false; ta.focus(); }
  }

  function _startNewConversation() {
    const panel = document.getElementById('lp-support-panel');
    if (!panel) return;
    const me = _getLpUser();
    if (!me) return;
    const listView = panel.querySelector('.lp-sup-list-view');

    if (panel.querySelector('.lp-sup-new-view')) return;
    const newDiv = document.createElement('div');
    newDiv.className = 'lp-sup-new-view';
    newDiv.innerHTML = `
      <div class="lp-sup-new-hdr">
        <button class="lp-sup-back-btn">← Back</button>
        <span>New Support Request</span>
      </div>
      <input class="lp-sup-new-subject" placeholder="Subject (e.g. Payment issue)" maxlength="80">
      <textarea class="lp-sup-new-msg" placeholder="Describe your issue…" rows="5"></textarea>
      <button class="lp-sup-new-send-btn">Send Message</button>`;
    listView.parentElement.insertBefore(newDiv, listView);
    listView.style.display = 'none';

    newDiv.querySelector('.lp-sup-back-btn').addEventListener('click', () => {
      newDiv.remove(); listView.style.display = 'flex';
    });
    newDiv.querySelector('.lp-sup-new-send-btn').addEventListener('click', async () => {
      const subject = newDiv.querySelector('.lp-sup-new-subject').value.trim() || 'Support Request';
      const msg     = newDiv.querySelector('.lp-sup-new-msg').value.trim();
      if (!msg) return;
      const btn = newDiv.querySelector('.lp-sup-new-send-btn');
      btn.disabled = true; btn.textContent = 'Sending…';
      const payload = { user_id: me.id, user_name: me.name, user_email: me.email, subject, first_message: msg };
      console.log('[LP] customer new conv payload:', JSON.stringify(payload));
      try {
        const r = await fetch('/api/support/conversations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          const conv = await r.json();
          console.log('[LP] customer conv created:', conv.id);
          newDiv.remove(); listView.style.display = 'flex';
          await _fetchConversations();
          if (conv && conv.id) _openConversation(conv);
        } else {
          const err = await r.json().catch(() => ({}));
          console.warn('[LP] create conversation failed:', r.status, err);
          btn.disabled = false; btn.textContent = 'Send Message';
        }
      } catch (e) {
        console.warn('[LP] create conversation error:', e.message);
        btn.disabled = false; btn.textContent = 'Send Message';
      }
    });
  }

  function _startAdminNewChat() {
    const panel = document.getElementById('lp-support-panel');
    if (!panel) return;
    const listView = panel.querySelector('.lp-sup-list-view');
    if (panel.querySelector('.lp-sup-new-view')) return;

    const newDiv = document.createElement('div');
    newDiv.className = 'lp-sup-new-view';
    newDiv.innerHTML = `
      <div class="lp-sup-new-hdr">
        <button class="lp-sup-back-btn">← Back</button>
        <span>Start Chat with Customer</span>
      </div>
      <input class="lp-sup-new-search" placeholder="Filter by name or email…" autocomplete="off">
      <div class="lp-sup-search-results"><div class="lp-sup-search-hint">Loading users…</div></div>`;
    listView.parentElement.insertBefore(newDiv, listView);
    listView.style.display = 'none';

    newDiv.querySelector('.lp-sup-back-btn').addEventListener('click', () => {
      newDiv.remove();
      listView.style.display = 'flex';
    });

    let _allUsers = null;
    let _searchTimer = null;
    const results = newDiv.querySelector('.lp-sup-search-results');

    const _renderRows = (users, filter) => {
      const q = (filter || '').toLowerCase();
      const pool = q
        ? users.filter(u => (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
        : users;
      const matched = pool.slice(0, 40);
      if (!matched.length) {
        results.innerHTML = `<div class="lp-sup-search-hint">${q ? 'No customers found' : 'No customers yet'}</div>`;
        return;
      }
      results.innerHTML = matched.map(u => {
        const name  = (u.full_name || u.email || 'Unknown').replace(/"/g, '&quot;');
        const email = (u.email || '').replace(/"/g, '&quot;');
        const hasConv = _supportConvs.some(c => c.user_id === u.id);
        return `<div class="lp-sup-search-row" data-uid="${u.id}" data-name="${name}" data-email="${email}">
          <div class="lp-sup-search-name">${u.full_name || u.email || 'Unknown'}${hasConv ? ' <span style="color:#8DD63F;font-size:11px;font-weight:600">● chat</span>' : ''}</div>
          <div class="lp-sup-search-email">${u.email || ''}</div>
        </div>`;
      }).join('');
      results.querySelectorAll('.lp-sup-search-row').forEach(row => {
        row.addEventListener('click', () => {
          newDiv.remove();
          listView.style.display = 'flex';
          _openAdminChatWith({ id: row.dataset.uid, full_name: row.dataset.name, email: row.dataset.email });
        });
      });
    };

    // Load all users immediately — no typing required
    fetch('/api/admin/users').then(r => r.json()).then(users => {
      _allUsers = users.filter(u => u.account_type !== 'admin' && u.account_type !== 'staff');
      _renderRows(_allUsers, '');
    }).catch(() => {
      results.innerHTML = '<div class="lp-sup-search-hint">Failed to load — try again</div>';
    });

    // Live-filter as admin types
    newDiv.querySelector('.lp-sup-new-search').addEventListener('input', function () {
      clearTimeout(_searchTimer);
      const q = this.value;
      _searchTimer = setTimeout(() => { if (_allUsers) _renderRows(_allUsers, q); }, 200);
    });
  }

  async function _deleteConversation(conv) {
    if (!confirm(`Delete this conversation permanently? This cannot be undone.`)) return;
    await fetch(`/api/support/conversations/${conv.id}`, { method: 'DELETE' });
    clearInterval(_drawerMsgPoll);
    _drawerActiveConv   = null;
    _drawerPrevMsgCount = 0;
    _closeDrawerConv();
    await _fetchConversations();
  }

  function _openAdminChatWith(user) {
    console.log('[LP] _openAdminChatWith: user.id=', user.id, '| email=', user.email);
    const existing = _supportConvs.find(c => c.user_id === user.id && c.status !== 'closed');
    if (existing) {
      console.log('[LP] _openAdminChatWith: opening existing conv', existing.id);
      _openDrawerConv(existing);
    } else {
      const me = _getLpUser();
      if (!me) return;
      const payload = { user_id: user.id, user_name: user.full_name || user.email, user_email: user.email, subject: 'Admin Message' };
      console.log('[LP] _openAdminChatWith: creating conv payload=', JSON.stringify(payload));
      fetch('/api/support/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(async r => {
        const conv = await r.json();
        if (!r.ok) { console.warn('[LP] _openAdminChatWith: conv create failed', r.status, conv); return; }
        console.log('[LP] _openAdminChatWith: conv created', conv.id);
        _fetchConversations().then(() => { if (conv && conv.id) _openDrawerConv(conv); });
      }).catch(e => console.warn('[LP] _openAdminChatWith error:', e.message));
    }
  }

  // ── Bottom chat drawer ────────────────────────────────────────────────────
  function _injectChatDrawer() {
    if (document.getElementById('lp-chat-drawer')) return;
    const drawer = document.createElement('div');
    drawer.id = 'lp-chat-drawer';
    drawer.innerHTML = `
      <div class="lp-drawer-handle-area">
        <div class="lp-drawer-handle"></div>
        <span class="lp-drawer-title"></span>
        <button class="lp-drawer-close" title="Close">✕</button>
      </div>
      <div class="lp-drawer-status-row" style="display:none"></div>
      <div class="lp-drawer-messages"></div>
      <div class="lp-drawer-compose">
        <textarea class="lp-drawer-input" placeholder="Type a message…" rows="2"></textarea>
        <button class="lp-drawer-send">Send</button>
      </div>`;
    document.body.appendChild(drawer);
    drawer.querySelector('.lp-drawer-close').addEventListener('click', _closeDrawerConv);
    drawer.querySelector('.lp-drawer-send').addEventListener('click', _sendDrawerMessage);
    drawer.querySelector('.lp-drawer-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendDrawerMessage(); }
    });
  }

  function _openDrawerConv(conv) {
    _drawerActiveConv   = conv;
    _drawerPrevMsgCount = 0;
    clearInterval(_drawerMsgPoll);
    _lpMarkSeen(conv.id);

    const drawer = document.getElementById('lp-chat-drawer');
    if (!drawer) { _injectChatDrawer(); return _openDrawerConv(conv); }

    const me     = _getLpUser();
    const isPriv = me && (me.role === 'admin' || me.role === 'staff');

    drawer.querySelector('.lp-drawer-title').textContent =
      isPriv ? (conv.user_name || conv.user_email || 'Customer') : (conv.subject || 'Support Chat');

    // Admin/staff action row
    const statusRow = drawer.querySelector('.lp-drawer-status-row');
    if (isPriv) {
      const stCls = conv.status === 'closed' ? 'closed' : conv.status === 'pending' ? 'pend' : 'open';
      const stLbl = conv.status === 'closed' ? 'CLOSED' : conv.status === 'pending' ? 'PENDING' : 'OPEN';
      const toggleBtn = conv.status === 'closed'
        ? `<button class="lp-drawer-act-btn green" data-act="open">↺ Reopen</button>`
        : `<button class="lp-drawer-act-btn" data-act="closed">✓ Close</button>`;
      statusRow.innerHTML = `
        <span class="lp-rconv-status ${stCls}">${stLbl}</span>
        ${toggleBtn}
        <button class="lp-drawer-act-btn red" data-act="delete">🗑 Delete</button>`;
      statusRow.style.display = 'flex';
      statusRow.querySelector('[data-act="delete"]').addEventListener('click', () => _deleteConversation(conv));
      statusRow.querySelector('[data-act]:not([data-act="delete"])').addEventListener('click', async function () {
        const newStatus = this.dataset.act;
        const r = await fetch(`/api/support/conversations/${conv.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (r.ok) { conv.status = newStatus; await _fetchConversations(); _openDrawerConv(conv); }
      });
    } else {
      statusRow.style.display = 'none';
      statusRow.innerHTML = '';
    }

    drawer.querySelector('.lp-drawer-messages').innerHTML = '<div class="lp-drawer-empty">Loading…</div>';
    drawer.classList.add('open');
    _fetchDrawerMessages(conv.id);
    _drawerMsgPoll = setInterval(() => _fetchDrawerMessages(conv.id), 3000);
    _renderRealConvList(); // refresh list (active highlight + unread dots)
    injectSupportNavBadge();
  }

  function _closeDrawerConv() {
    clearInterval(_drawerMsgPoll);
    _drawerActiveConv   = null;
    _drawerPrevMsgCount = 0;
    const drawer = document.getElementById('lp-chat-drawer');
    if (drawer) drawer.classList.remove('open');
    _renderRealConvList();
  }

  async function _fetchDrawerMessages(convId) {
    try {
      const r = await fetch(`/api/support/conversations/${convId}/messages`);
      if (r.ok) _renderDrawerMessages(await r.json());
    } catch {}
  }

  function _renderDrawerMessages(msgs) {
    const drawer = document.getElementById('lp-chat-drawer');
    if (!drawer || !_drawerActiveConv) return;
    const me = _getLpUser();
    const container = drawer.querySelector('.lp-drawer-messages');
    const newCount = msgs ? msgs.length : 0;

    // Skip re-render entirely when nothing has changed.
    // This is critical: every innerHTML mutation fires the MutationObserver guard
    // which calls _isSupportView() — we must avoid churning the DOM on idle polls.
    if (newCount === _drawerPrevMsgCount && newCount > 0) return;

    // Full re-render when count has changed (new message arrived or first load).
    // Full re-render is simpler than incremental and immune to prevCount drift.
    container.innerHTML = '';
    if (!msgs || msgs.length === 0) {
      container.innerHTML = '<div class="lp-drawer-empty">No messages yet — say hi!</div>';
      _drawerPrevMsgCount = 0;
      return;
    }
    msgs.forEach((m) => {
      const isMine  = me && m.sender_id === me.id;
      const roleTag = m.sender_role === 'admin' ? '🛡 Admin' : m.sender_role === 'staff' ? '👤 Staff' : '';
      const safeMsg = (m.message || m.body || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      const el = document.createElement('div');
      el.className = `lp-drawer-msg ${isMine ? 'mine' : 'theirs'}`;
      el.innerHTML = `
        <div class="lp-drawer-bubble">${safeMsg}</div>
        <div class="lp-drawer-msg-meta">
          ${roleTag ? `<span class="lp-drawer-role-tag">${roleTag}</span>` : ''}
          <span>${m.sender_name || ''}</span>
          <span>${_tsRelative(m.created_at)}</span>
        </div>`;
      container.appendChild(el);
    });
    _drawerPrevMsgCount = msgs.length;
    container.scrollTop = container.scrollHeight;
    if (_drawerActiveConv) { _lpMarkSeen(_drawerActiveConv.id); injectSupportNavBadge(); }
  }

  async function _sendDrawerMessage() {
    if (!_drawerActiveConv) return;
    const drawer = document.getElementById('lp-chat-drawer');
    if (!drawer) return;
    const ta  = drawer.querySelector('.lp-drawer-input');
    const msg = (ta ? ta.value : '').trim();
    if (!msg) return;
    const me = _getLpUser();
    if (!me) return;
    ta.value = '';
    ta.disabled = true;
    const sendBtn = drawer.querySelector('.lp-drawer-send');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending…'; }
    try {
      const senderRole = (me.role === 'admin' || me.role === 'staff') ? me.role : 'customer';
      const r = await fetch('/api/support/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: _drawerActiveConv.id,
          sender_id: me.id, sender_name: me.name, sender_role: senderRole, message: msg,
        }),
      });
      if (!r.ok) {
        console.warn('[LP] sendDrawerMessage failed:', r.status, await r.json().catch(() => ({})));
      } else {
        // Reset the count guard so the post-send fetch ALWAYS triggers a
        // re-render regardless of any racing poll that may have already
        // incremented _drawerPrevMsgCount to the new value.
        _drawerPrevMsgCount = 0;
        await _fetchDrawerMessages(_drawerActiveConv.id);
        await _fetchConversations();
      }
    } catch (e) { console.warn('[LP] sendDrawerMessage error:', e.message); }
    finally {
      ta.disabled = false;
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
      ta.focus();
    }
  }

  // Patch the native support page: wire "Chat with a rep", hide fake rows, inject real list.
  function _patchNativeSupportPage() {
    // Wire "Chat with a rep" button
    Array.from(document.querySelectorAll('button, div[role="button"], a')).forEach(el => {
      if (el.dataset.lpWired) return;
      if (/^Chat with a rep$/i.test(el.textContent.trim()) || /^Chat with us$/i.test(el.textContent.trim())) {
        el.dataset.lpWired = '1';
        el.addEventListener('click', e => { e.stopPropagation(); _openNewChatModal(); }, true);
      }
    });
    // Hide native fake conversation rows
    Array.from(document.querySelectorAll('*')).forEach(el => {
      if (el.dataset.lpHidden || el.id === 'lp-real-conv-list' || el.id === 'lp-chat-drawer') return;
      if (el.childElementCount <= 4 && /^Live chat with a rep$/i.test(el.textContent.trim())) {
        el.dataset.lpHidden = '1'; el.style.display = 'none';
      }
    });
    // Inject our real conversation list once
    if (!document.getElementById('lp-real-conv-list')) {
      const hdrEl = Array.from(document.querySelectorAll('*')).find(
        el => el.childElementCount === 0 && /YOUR CONVERSATIONS/i.test(el.textContent.trim())
      );
      const anchor = hdrEl ? (hdrEl.closest('[class]') || hdrEl.parentElement) : null;
      const injected = document.createElement('div');
      injected.id = 'lp-real-conv-list';
      if (anchor && anchor.parentElement) {
        anchor.parentElement.insertBefore(injected, anchor.nextSibling);
      } else {
        (document.querySelector('main,[role="main"]') || document.body).appendChild(injected);
      }
      _renderRealConvList();
    }
  }

  function _renderRealConvList() {
    const el = document.getElementById('lp-real-conv-list');
    if (!el) return;
    const me     = _getLpUser();
    const isPriv = me && (me.role === 'admin' || me.role === 'staff');
    _lpLoadSeen();
    if (_supportConvs.length === 0) {
      el.innerHTML = `<div class="lp-rconv-empty">${
        isPriv ? 'No open conversations.' : 'No conversations yet — tap "Chat with a rep" to start one.'
      }</div>`;
      return;
    }
    el.innerHTML = _supportConvs.map(c => {
      const name    = isPriv ? (c.user_name || c.user_email || 'Customer') : (c.subject || 'Support Request');
      const preview = (c.last_message || 'No messages yet').slice(0, 65);
      const stCls   = c.status === 'closed' ? 'closed' : c.status === 'pending' ? 'pend' : 'open';
      const stLbl   = c.status === 'closed' ? 'CLOSED' : c.status === 'pending' ? 'PENDING' : 'OPEN';
      const active  = _drawerActiveConv && _drawerActiveConv.id === c.id;
      const unread  = _lpIsUnread(c) && !(active);
      return `
        <div class="lp-rconv-row${active ? ' active' : ''}" data-cid="${c.id}">
          <div class="lp-rconv-icon">💬</div>
          <div class="lp-rconv-body">
            <div class="lp-rconv-top">
              <span class="lp-rconv-name">${name}</span>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="lp-rconv-status ${stCls}">${stLbl}</span>
                <span class="lp-rconv-time">${_tsRelative(c.updated_at || c.created_at)}</span>
              </div>
            </div>
            <div class="lp-rconv-preview">${preview}</div>
          </div>
          ${unread ? '<div class="lp-rconv-unread-dot"></div>' : ''}
        </div>`;
    }).join('');
    el.querySelectorAll('.lp-rconv-row').forEach(row =>
      row.addEventListener('click', () => {
        const c = _supportConvs.find(x => x.id === row.dataset.cid);
        if (c) _openDrawerConv(c);
      })
    );
  }

  // New-chat modal (bottom sheet) — customer gets subject+message form, admin gets customer search.
  function _openNewChatModal() {
    if (document.getElementById('lp-new-chat-modal')) return;
    const me = _getLpUser();
    if (!me) return;
    const isPriv = me.role === 'admin' || me.role === 'staff';
    const modal = document.createElement('div');
    modal.id = 'lp-new-chat-modal';
    modal.innerHTML = `
      <div class="lp-ncm-sheet">
        <div class="lp-ncm-hdr">
          <span class="lp-ncm-title">${isPriv ? 'Start Chat with Customer' : 'New Support Request'}</span>
          <button class="lp-ncm-close">✕</button>
        </div>
        ${isPriv ? `
          <input class="lp-ncm-input" id="lp-ncm-search" placeholder="Search customer by name or email…" autocomplete="off">
          <div id="lp-ncm-results" style="margin-top:8px"></div>
        ` : `
          <input class="lp-ncm-input" id="lp-ncm-subject" placeholder="Subject (e.g. Payment issue)" maxlength="80">
          <textarea class="lp-ncm-textarea" id="lp-ncm-msg" placeholder="Describe your issue…" rows="4"></textarea>
          <button class="lp-ncm-send" id="lp-ncm-send-btn">Send Message</button>
        `}
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('.lp-ncm-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    if (isPriv) {
      let _st = null, _allUsers = null;
      const res = modal.querySelector('#lp-ncm-results');

      const _renderUserRows = (users, filter) => {
        const q = (filter || '').toLowerCase();
        const pool = q
          ? users.filter(u => (u.full_name||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q))
          : users;
        const matched = pool.slice(0, 30);
        if (!matched.length) {
          res.innerHTML = `<div class="lp-rconv-empty" style="padding:8px 0">${q ? 'No users found' : 'No users yet'}</div>`;
          return;
        }
        res.innerHTML = matched.map(u => {
          const hasConv = _supportConvs.some(c => c.user_id === u.id);
          return `
            <div class="lp-rconv-row" data-uid="${u.id}"
              data-name="${(u.full_name||u.email||'').replace(/"/g,'&quot;')}"
              data-email="${(u.email||'').replace(/"/g,'&quot;')}"
              style="margin-bottom:6px">
              <div class="lp-rconv-icon" style="font-size:14px">${(u.full_name||u.email||'?')[0].toUpperCase()}</div>
              <div class="lp-rconv-body">
                <div class="lp-rconv-name">${u.full_name||u.email||'Unknown'}${hasConv ? ' <span style="color:#22c55e;font-size:11px;font-weight:600">● existing chat</span>' : ''}</div>
                <div class="lp-rconv-preview">${u.email||''}</div>
              </div>
            </div>`;
        }).join('');
        res.querySelectorAll('.lp-rconv-row').forEach(row => row.addEventListener('click', () => {
          modal.remove();
          _openAdminChatWith({ id: row.dataset.uid, full_name: row.dataset.name, email: row.dataset.email });
        }));
      };

      // Load and show all users immediately — no need to type first
      res.innerHTML = '<div class="lp-rconv-empty" style="padding:8px 0">Loading users…</div>';
      fetch('/api/admin/users').then(r => r.json()).then(users => {
        _allUsers = users.filter(u => u.account_type !== 'admin' && u.account_type !== 'staff');
        _renderUserRows(_allUsers, '');
      }).catch(() => {
        res.innerHTML = '<div class="lp-rconv-empty" style="padding:8px 0">Failed to load — try again</div>';
      });

      // Filter list as user types
      modal.querySelector('#lp-ncm-search').addEventListener('input', function () {
        clearTimeout(_st);
        const q = this.value;
        _st = setTimeout(() => { if (_allUsers) _renderUserRows(_allUsers, q); }, 200);
      });
    } else {
      modal.querySelector('#lp-ncm-send-btn').addEventListener('click', async () => {
        const subject = (modal.querySelector('#lp-ncm-subject').value.trim()) || 'Support Request';
        const msg     = modal.querySelector('#lp-ncm-msg').value.trim();
        if (!msg) return;
        const btn = modal.querySelector('#lp-ncm-send-btn');
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const r = await fetch('/api/support/conversations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: me.id, user_name: me.name, user_email: me.email, subject, first_message: msg }),
          });
          if (r.ok) {
            const conv = await r.json();
            modal.remove();
            await _fetchConversations();
            if (conv && conv.id) _openDrawerConv(conv);
          } else {
            console.warn('[LP] create conv failed:', r.status);
            btn.disabled = false; btn.textContent = 'Send Message';
          }
        } catch (e) {
          console.warn('[LP] create conv error:', e.message);
          btn.disabled = false; btn.textContent = 'Send Message';
        }
      });
    }
  }

  function injectSupportChat() {
    const onSupport = _isSupportView();

    if (!onSupport) {
      // Only do a full teardown when we are CERTAIN the user has navigated away.
      // lpGetCurrentPage() can return null during React mid-renders (fiber tree is
      // being rebuilt) even while still on the support page.  Tearing down on a
      // null read kills _drawerMsgPoll and clears _drawerActiveConv, which is why
      // admin replies stop showing — the poll is dead.
      //
      // Safe teardown rule: currentPage must be a known, non-null, non-support page.
      const currentPage = lpGetCurrentPage();
      if (currentPage === null || currentPage === 'support') return; // stay alive
      if (_drawerActiveConv) return; // keep drawer alive while a conversation is open on any page

      clearInterval(_supportPollTimer);
      _supportPollTimer = null;
      clearInterval(_drawerMsgPoll);
      _drawerMsgPoll      = null;
      _drawerActiveConv   = null;
      _drawerPrevMsgCount = 0;
      const drawer = document.getElementById('lp-chat-drawer');
      if (drawer) drawer.remove();
      const trigBtn = document.getElementById('lp-sup-trigger-btn');
      if (trigBtn) trigBtn.remove();
      const oldPanel = document.getElementById('lp-support-panel');
      if (oldPanel) oldPanel.remove();
      return;
    }

    // On the support page — ensure drawer is injected, native page is patched
    _lpLoadSeen();
    _injectChatDrawer();
    _patchNativeSupportPage();

    if (!_supportPollTimer) {
      _fetchConversations();
      _supportPollTimer = setInterval(_fetchConversations, 10000);
    }
  }

  // ── Support nav badge: show unread count on the "Customer Service" nav entry ─
  // Scans for the native Customer Service / Help button when NOT on support page
  // and injects a red badge showing how many conversations have new messages.
  function injectSupportNavBadge() {
    _lpLoadSeen();
    const count = _lpUnreadCount();

    // Remove badge entirely if on support page or no unread
    if (_isSupportView()) {
      document.querySelectorAll('.lp-sup-nav-badge').forEach(b => b.remove());
      return;
    }

    const targets = Array.from(document.querySelectorAll('button,li,span,div,a'))
      .filter(el => {
        if (el.childElementCount !== 0) return false;
        const t = el.textContent.trim();
        return /^(Customer Service|Customer support|Help & Support|Help|Support)$/i.test(t);
      });

    targets.forEach(el => {
      let badge = el.querySelector('.lp-sup-nav-badge');
      if (!badge) {
        // try parent in case el has no relative positioning
        badge = el.parentElement && el.parentElement.querySelector('.lp-sup-nav-badge');
      }
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'lp-sup-nav-badge';
          el.parentElement.style.position = 'relative';
          el.parentElement.appendChild(badge);
        }
        badge.textContent = count;
      } else if (badge) {
        badge.remove();
      }
    });
  }

  // ── Admin native-chat-detail bridge ──────────────────────────────────────
  // When an admin/staff user is on the native "Reply as Admin" detail page,
  // we inject a real-Supabase message overlay above the reply compose area
  // AND piggyback every reply submission to our /api/support/messages endpoint.
  // This is the root fix for the two-system disconnect: the native interface
  // writes to the SPA's own backend; our drawer reads from Supabase.  Both
  // are now bridged through this function.
  async function _patchAdminNativeChatPage() {
    const me = _getLpUser();
    if (!me || (me.role !== 'admin' && me.role !== 'staff')) return;

    const replyTA = document.querySelector('textarea[placeholder*="Reply as Admin"]');

    if (!replyTA) {
      // Left the admin detail page — clean up
      if (_lpAdminDetailPoll) {
        clearInterval(_lpAdminDetailPoll);
        _lpAdminDetailPoll  = null;
        _lpAdminDetailConv  = null;
        _lpAdminDetailCount = 0;
        const ol = document.getElementById('lp-admin-msg-overlay');
        if (ol) ol.remove();
      }
      return;
    }

    // Already wired — poll handles live updates; nothing more to do here
    if (replyTA.dataset.lpAdminWired) return;
    replyTA.dataset.lpAdminWired = '1';

    // ── Identify the customer's conversation ────────────────────────────────
    // The native page renders the customer's email somewhere in its DOM.
    // Scan leaf-text nodes for an email pattern (skip internal/system emails).
    let convEmail = null;
    Array.from(document.querySelectorAll('*')).some(el => {
      if (el.childElementCount > 0) return false;
      const t = el.textContent.trim();
      const m = t.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      if (m && !/supabase|replit|railway|gmail\.com.*supabase/i.test(m[0])) {
        convEmail = m[0].toLowerCase();
        return true;
      }
      return false;
    });

    // Ensure conversation list is loaded
    if (_supportConvs.length === 0) await _fetchConversations();

    // Prefer the most recent open conversation for this customer
    const conv =
      _supportConvs.find(c => c.user_email && c.user_email.toLowerCase() === convEmail && c.status !== 'closed') ||
      _supportConvs.find(c => c.user_email && c.user_email.toLowerCase() === convEmail);

    if (!conv) {
      console.warn('[LP] Admin detail bridge: no Supabase conv found for email', convEmail);
      return;
    }

    _lpAdminDetailConv  = conv;
    _lpAdminDetailCount = 0;
    console.log('[LP] Admin detail bridge: wired conv', conv.id, 'for', convEmail);

    // ── Inject real-message overlay above the reply compose area ────────────
    let overlay = document.getElementById('lp-admin-msg-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'lp-admin-msg-overlay';
      // Walk up from textarea until we find a container we can insert before
      let anchor = replyTA.parentElement;
      for (let i = 0; i < 5 && anchor && anchor.parentElement; i++) {
        if (anchor.parentElement !== document.body) { anchor = anchor.parentElement; break; }
      }
      if (anchor && anchor.parentElement) {
        anchor.parentElement.insertBefore(overlay, anchor);
      } else {
        document.body.appendChild(overlay);
      }
    }

    // Render messages into overlay; skip if count unchanged
    const _renderAdminOverlay = async () => {
      if (!_lpAdminDetailConv) return;
      try {
        const r = await fetch(`/api/support/conversations/${_lpAdminDetailConv.id}/messages`);
        if (!r.ok) return;
        const msgs = await r.json();
        const newCount = msgs ? msgs.length : 0;
        if (newCount === _lpAdminDetailCount && newCount > 0) return;
        _lpAdminDetailCount = newCount;

        if (newCount === 0) {
          overlay.innerHTML = '<div class="lp-adm-empty">No messages in Lily Pad system yet.</div>';
          return;
        }
        overlay.innerHTML = msgs.map(m => {
          const isAdm  = m.sender_role === 'admin' || m.sender_role === 'staff';
          const safe   = (m.message || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
          const who    = isAdm ? ('🛡 ' + (m.sender_name || 'Admin')) : ('👤 ' + (m.sender_name || 'Customer'));
          return `<div class="lp-adm-msg ${isAdm ? 'lp-adm-right' : 'lp-adm-left'}">
            <div class="lp-adm-bubble">${safe}</div>
            <div class="lp-adm-meta">${who} · ${_tsRelative(m.created_at)}</div>
          </div>`;
        }).join('');
        overlay.scrollTop = overlay.scrollHeight;
      } catch {}
    };

    await _renderAdminOverlay();

    // Poll for new messages every 3 s (same cadence as customer drawer)
    clearInterval(_lpAdminDetailPoll);
    _lpAdminDetailPoll = setInterval(_renderAdminOverlay, 3000);

    // ── Intercept reply submissions → also write to Supabase ────────────────
    // We use capture=true so our handler fires BEFORE React's synthetic handler.
    // We capture the message text first (React will clear the textarea), then
    // post to our API asynchronously — the native flow still completes normally.
    const _doAdminSend = async (msg) => {
      if (!msg || !_lpAdminDetailConv) return;
      try {
        const r = await fetch('/api/support/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: _lpAdminDetailConv.id,
            sender_id:   me.id,
            sender_name: me.name,
            sender_role: 'admin',
            message:     msg,
          }),
        });
        if (r.ok) {
          _lpAdminDetailCount = 0; // force overlay re-render
          _renderAdminOverlay();
          console.log('[LP] Admin reply mirrored to Supabase:', msg.slice(0, 60));
        } else {
          console.warn('[LP] Admin reply mirror failed:', r.status, await r.json().catch(() => ({})));
        }
      } catch (e) { console.warn('[LP] Admin reply mirror error:', e.message); }
    };

    // Find the "Review" / send button near the textarea
    const sendBtn = (() => {
      let el = replyTA.parentElement;
      for (let i = 0; i < 6 && el && el !== document.body; i++) {
        const btn = Array.from(el.querySelectorAll('button'))
          .find(b => b !== replyTA && b.textContent.trim().length > 0);
        if (btn) return btn;
        el = el.parentElement;
      }
      return null;
    })();

    if (sendBtn && !sendBtn.dataset.lpAdminWired) {
      sendBtn.dataset.lpAdminWired = '1';
      sendBtn.addEventListener('click', (e) => {
        // Capture message BEFORE React's handler clears textarea
        const msg = replyTA.value.trim();
        // Let native behavior proceed (no stopPropagation)
        // Mirror to Supabase after a short tick (50 ms) so React has settled
        if (msg) setTimeout(() => _doAdminSend(msg), 50);
      }, true); // capture phase
    }

    // Also intercept ⌘/Ctrl + Enter keyboard shortcut shown in the placeholder
    replyTA.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const msg = replyTA.value.trim();
        if (msg) setTimeout(() => _doAdminSend(msg), 50);
      }
    });
  }

  let _guardDiagLast  = 0;
  let _lpPageSaveTime = 0;      // throttle for sessionStorage page-save
  let _guardRafPending = false; // RAF debounce flag

  function _runGuardFunctions() {
    // ── Guard-driven page restore after browser refresh ────────────────────
    // Fires goTo() the instant React has committed the fiber tree on the map
    // page — far more reliable than a fixed-delay retry loop.
    if (_lpPendingRestore) {
      const _cur = lpGetCurrentPage();
      if (_cur === 'find' || _cur === 'home' || _cur === 'root') {
        const _goTo = lpGetGoTo();
        if (_goTo) {
          const _target = _lpPendingRestore;
          _lpPendingRestore = null;
          _lpGoToFn = null; // bust stale cache so the post-restore nav gets a fresh ref
          console.log('[Lily Pad] Guard restoring page after refresh:', _target);
          _goTo(_target);
        }
      }
    }

    hideUnwantedElements();
    injectPullDownSignOut();
    updateProfileDisplay();
    updatePhotoFullscreen();
    scheduleDeepBack();
    injectPaddashboardBack();
    injectPadAccountBack();
    injectWizardExitBack();
    removeFakeMapSpots();
    clearFakePads();
    hideFakePadCards();
    clearFakeListings();
    installPhotoClickHandlers();
    _scrapePaddashboardAddresses();
    injectSameAddressHint();
    enlargePadCards();
    injectPadDrawEdit();
    injectAllPhotoOverlays();
    _injectChooseRoleActivateBtn();
    injectAdminPanel();
    injectSupportChat();
    injectSupportNavBadge();
    _patchAdminNativeChatPage();

    // ── Throttled page-state diagnostic (once every 4 s) ──────────────────
    const _now = Date.now();
    if (_now - _guardDiagLast > 4000) {
      _guardDiagLast = _now;
      const leafTexts = Array.from(document.querySelectorAll('p,span,h1,h2,h3,button'))
        .filter(el => el.childElementCount === 0)
        .map(el => el.textContent.trim())
        .filter(t => t.length > 2 && t.length < 40)
        .slice(0, 12);
      console.log('[Lily Pad] guard page-state:', JSON.stringify(leafTexts));
    }

    // ── Continuous page-save for refresh restoration (every 2 s) ──────────
    // beforeunload fires too late (React may have torn down its fiber by then),
    // so we continuously snapshot the current page here while the guard is live.
    // Only stable top-level pages are saved; wizard/flow pages are cleared so
    // a refresh on a transient page goes back to the map, not mid-wizard.
    if (_now - _lpPageSaveTime > 2000) {
      _lpPageSaveTime = _now;
      try {
        const _pg = lpGetCurrentPage();
        if (_pg && LP_RESTORE_PAGES.has(_pg)) {
          sessionStorage.setItem('lp_last_page', _pg);
        } else if (_pg && !LP_RESTORE_PAGES.has(_pg)) {
          sessionStorage.removeItem('lp_last_page');
        }
      } catch {}
    }
  }

  function startGuard() {
    if (window.__lpGuardObserver) return;
    const target = document.body;
    // ── RAF-debounced MutationObserver ─────────────────────────────────────
    // Cascaded DOM mutations (e.g. adding a lightbox that triggers injectPadDrawEdit
    // which adds a button which triggers the guard again) can fire the callback
    // synchronously many times before the browser paints or processes rAFs.
    // Debouncing to one run per animation frame ensures:
    //   1. All mutations in a batch are handled in a single guard pass.
    //   2. requestAnimationFrame callbacks (like lb.classList.add('open')) are
    //      never blocked by an unbounded cascade of synchronous guard calls.
    const guard = new MutationObserver(() => {
      if (_guardRafPending) return;
      _guardRafPending = true;
      requestAnimationFrame(() => {
        _guardRafPending = false;
        _runGuardFunctions();
      });
    });
    guard.observe(target, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
    });
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
          if (data.confirm_email) {
            // Supabase sent a confirmation email — show the check-inbox panel
            const addrEl = document.getElementById('confirm-email-addr');
            if (addrEl) addrEl.textContent = finalEmail;
            showGate();
            switchForm('form-confirm-email');
            console.log('[Lily Pad] poller: email confirmation required for', finalEmail);
          } else if (data.session && data.session.access_token) {
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

    // Cache full DB role (may include admin/staff not in JWT metadata)
    const uid = (session && session.user && session.user.id) || (session && session.user_id);
    if (uid) _fetchAndCacheRole(uid);
    else if (role) { _lpCurrentRole = role; localStorage.setItem('lp_role_cache', role); }

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

    // ── Continuous 1-second page-save (primary mechanism) ────────────────────
    // Saves lp_last_page every second while the user is on a restorable page.
    // This is bulletproof — no dependency on beforeunload timing, iframe quirks,
    // or the MutationObserver guard firing at the right moment.
    const _pageSaveInterval = setInterval(() => {
      try {
        const pg = lpGetCurrentPage();
        if (pg && LP_RESTORE_PAGES.has(pg)) {
          sessionStorage.setItem('lp_last_page', pg);
        } else if (pg && !LP_RESTORE_PAGES.has(pg)) {
          sessionStorage.removeItem('lp_last_page');
        }
      } catch {}
    }, 1000);

    // ── beforeunload backup save ──────────────────────────────────────────────
    // Belt-and-suspenders: also try to save in beforeunload in case the 1-second
    // interval hasn't fired yet (e.g. user refreshes within the first second).
    window.addEventListener('beforeunload', () => {
      try {
        const pg = lpGetCurrentPage();
        console.log('[Lily Pad] beforeunload: page =', pg);
        if (pg && LP_RESTORE_PAGES.has(pg)) {
          sessionStorage.setItem('lp_last_page', pg);
        } else if (pg && !LP_RESTORE_PAGES.has(pg)) {
          sessionStorage.removeItem('lp_last_page');
        }
      } catch {}
    });

    // ── Restore page after browser refresh ──────────────────────────────────
    // Read the saved page BEFORE navigateToMap.
    const _savedPage = (() => {
      try { return sessionStorage.getItem('lp_last_page'); } catch { return null; }
    })();
    if (_savedPage) sessionStorage.removeItem('lp_last_page'); // consume immediately
    console.log('[Lily Pad] Refresh restore: savedPage =', _savedPage);

    navigateToMap(role, () => {
      if (_savedPage) {
        // Retry-loop: poll lpGetGoTo() every 200 ms until React has committed the
        // map page fiber and goTo is reachable. Limit: 25 tries = 5 seconds.
        _lpGoToFn = null; // bust stale pre-refresh cache
        console.log('[Lily Pad] Starting page restore to:', _savedPage);
        let _restoreTries = 0;
        const _tryRestore = () => {
          const goTo = lpGetGoTo();
          console.log('[Lily Pad] Restore try', _restoreTries + 1, '— goTo found:', !!goTo);
          if (goTo) { console.log('[Lily Pad] Restored to', _savedPage); goTo(_savedPage); return; }
          if (++_restoreTries < 25) setTimeout(_tryRestore, 200);
          else console.warn('[Lily Pad] Restore gave up after', _restoreTries, 'tries');
        };
        setTimeout(_tryRestore, 300);
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    // If an invite link lands on the main app (not /staff-login), redirect there
    // so the set-password flow can handle the token correctly.
    (function _redirectInviteToken() {
      try {
        const hash = window.location.hash;
        if (!hash) return;
        const params = new URLSearchParams(hash.slice(1));
        if (params.get('type') === 'invite' && params.get('access_token')) {
          window.location.replace('/staff-login' + hash);
        }
      } catch (_) {}
    })();

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
