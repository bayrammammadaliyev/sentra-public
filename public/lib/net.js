/* e-meyar — network failures in plain Azerbaijani.
   Load in <head>, before any page script calls fetch().

   With no connection, or a server that doesn't answer, fetch() rejects with
   the browser's own English text ("Failed to fetch"; Safari: "Load failed";
   Firefox: "NetworkError…"). An HTML error page instead of our JSON (e.g.
   Railway's page while the server restarts) makes res.json() throw
   "Unexpected token '<'…". Both become one Azerbaijani message, so every
   existing catch (err) { …err.message… } shows it with no page changes.
   The error carries isNetworkError = true for pages that want to say more.

   Untouched: real answers from our server (their { error } texts, 401 →
   logout). Those resolve normally and never come through here. */
(function () {
  var MESSAGE = 'İnternet bağlantısı yoxdur və ya server cavab vermir. Bağlantını yoxlayıb yenidən cəhd edin.';
  var realFetch = window.fetch;
  if (!realFetch || realFetch.emeyarNet) return;

  function networkError(cause) {
    var e = new Error(MESSAGE);
    e.name = 'NetworkError';
    e.isNetworkError = true;
    e.cause = cause;
    return e;
  }

  function fetchWithMessage() {
    return realFetch.apply(window, arguments).then(function (res) {
      var realJson = res.json.bind(res);
      res.json = function () {
        return realJson().catch(function (err) {
          if (err && err.name === 'SyntaxError') throw networkError(err);
          throw err;
        });
      };
      return res;
    }, function (err) {
      if (err && err.name === 'AbortError') throw err;
      throw networkError(err);
    });
  }
  fetchWithMessage.emeyarNet = true;
  window.fetch = fetchWithMessage;
})();
