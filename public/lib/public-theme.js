/* e-meyar public pages: day/night toggle.
   The saved choice is applied before paint by a one-line script in each
   page's <head>; this file wires up the toggle buttons ([data-theme-toggle]). */
(function () {
  var root = document.documentElement;
  function label() {
    var dark = root.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
      b.title = dark ? 'Gündüz rejimi' : 'Gecə rejimi';
      b.setAttribute('aria-label', b.title);
    });
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('emeyar_theme', next); } catch (e) {}
      label();
    });
  });
  label();
})();
