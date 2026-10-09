/* e-meyar (student) — login session in the browser.
   Load after net.js, before any page script calls the API.

   Unlike the teacher app (which keeps only the access token and logs out on
   the first 401, about an hour after login), this keeps BOTH tokens. On a
   401 it swaps the refresh token for a new pair once (POST
   /api/auth/refresh) and repeats the request; only if that fails too does
   the student go back to the login page.

   Supabase rotates refresh tokens: each one works once, so the new pair is
   always saved. With several tabs open only one may refresh at a time (Web
   Locks), and a tab whose token was already renewed by another tab simply
   uses the new one. */
(function () {
  var ACCESS = 'emeyar_student_access';
  var REFRESH = 'emeyar_student_refresh';
  var LOGIN_PAGE = '/login.html';

  function get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function del(k) { try { localStorage.removeItem(k); } catch (_) {} }

  function save(session) {
    if (!session || !session.access_token || !session.refresh_token) return false;
    set(ACCESS, session.access_token);
    set(REFRESH, session.refresh_token);
    return true;
  }
  function clear() { del(ACCESS); del(REFRESH); }
  function hasSession() { return !!(get(ACCESS) && get(REFRESH)); }

  function toLogin() {
    clear();
    window.location.replace(LOGIN_PAGE);
  }

  // Serialise refreshes across tabs when the browser can; otherwise per tab.
  function withLock(fn) {
    if (navigator.locks && navigator.locks.request) {
      return navigator.locks.request('emeyar-student-refresh', fn);
    }
    return fn();
  }

  var inFlight = null;

  // Resolves to true (new tokens saved), or false (session is over: log in
  // again). Throws for a temporary problem (network, server busy), so the
  // page can show the message and the student stays logged in.
  function refresh(failedToken) {
    if (inFlight) return inFlight;
    inFlight = withLock(async function () {
      // Another tab may have refreshed while we waited for the lock.
      var current = get(ACCESS);
      if (current && current !== failedToken) return true;
      var rt = get(REFRESH);
      if (!rt) return false;
      var res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt })
      });
      if (res.status === 401) return false;
      var data = await res.json().catch(function (e) { if (e && e.isNetworkError) throw e; return {}; });
      if (!res.ok) throw new Error(data.error || 'Sessiyanı yeniləmək alınmadı. Bir az sonra yenidən cəhd edin.');
      return save(data.session);
    });
    var p = inFlight;
    p.then(function () { inFlight = null; }, function () { inFlight = null; });
    return p;
  }

  function withAuth(opts, token) {
    var o = Object.assign({}, opts || {});
    var h = Object.assign({}, o.headers || {});
    h.Authorization = 'Bearer ' + (token || '');
    if (o.body && typeof o.body === 'string' && !h['Content-Type']) h['Content-Type'] = 'application/json';
    o.headers = h;
    return o;
  }

  // fetch() for logged-in API calls. On 401: refresh once, repeat once. If
  // the session can't be renewed, goes to the login page (the returned
  // promise then never settles, so pages don't flash an error first).
  async function apiFetch(url, opts) {
    var token = get(ACCESS);
    if (!token) { toLogin(); return new Promise(function () {}); }
    var res = await fetch(url, withAuth(opts, token));
    if (res.status !== 401) return res;

    var ok = await refresh(token);
    if (!ok) { toLogin(); return new Promise(function () {}); }
    res = await fetch(url, withAuth(opts, get(ACCESS)));
    if (res.status === 401) { toLogin(); return new Promise(function () {}); }
    return res;
  }

  // Revokes the refresh tokens on the server (all devices, as in the teacher
  // app), forgets them here and goes to the login page. An expired access
  // token is renewed first, or the revocation would be refused (401) and the
  // refresh token would stay usable.
  async function logout() {
    var token = get(ACCESS);
    try {
      if (token) {
        var send = function (t) { return fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }); };
        var res = await send(token);
        if (res.status === 401 && await refresh(token)) await send(get(ACCESS));
      }
    } catch (_) {}
    toLogin();
  }

  // For pages that need a login: no saved session → login page right away.
  function requireLogin() {
    if (!hasSession()) { toLogin(); return false; }
    return true;
  }

  window.EmeyarAuth = {
    save: save,
    clear: clear,
    hasSession: hasSession,
    apiFetch: apiFetch,
    logout: logout,
    requireLogin: requireLogin
  };
})();
