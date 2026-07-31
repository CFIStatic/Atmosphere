// Shared behavior for the Atmosphere corporate site.
(function () {
  // Light/dark toggle. A saved choice wins; otherwise the OS preference shows.
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    var root = document.documentElement;
    toggle.addEventListener('click', function () {
      var explicit = root.getAttribute('data-theme');
      var isDark = explicit
        ? explicit === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      var next = isDark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('atm-theme', next); } catch (e) { /* private mode */ }
    });
  }
  // Replay restarts the receipt animation — the audit trail's replay, embodied.
  var receipt = document.getElementById('receipt');
  var btn = document.getElementById('replay');
  if (receipt && btn) {
    btn.addEventListener('click', function () {
      var lines = receipt.querySelectorAll('.r-line, .r-divider, .r-status');
      lines.forEach(function (el) { el.style.animation = 'none'; });
      void receipt.offsetWidth;
      lines.forEach(function (el) { el.style.animation = ''; });
    });
  }

  // Careers: role listings prefill the application form.
  var form = document.getElementById('careers-form');
  if (!form) return;

  document.querySelectorAll('.apply-link').forEach(function (link) {
    link.addEventListener('click', function () {
      var select = document.getElementById('ap-role');
      if (select && link.dataset.role) select.value = link.dataset.role;
    });
  });

  // Careers: submit the application to the backend, which emails the hiring
  // inbox. `data-api` on the form overrides the API origin when the site is
  // hosted separately from the backend.
  var status = document.getElementById('careers-status');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;

    var submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.className = 'form-status';
    status.textContent = 'Sending…';

    var payload = {
      name: document.getElementById('ap-name').value,
      email: document.getElementById('ap-email').value,
      role: document.getElementById('ap-role').value,
      links: document.getElementById('ap-links').value,
      message: document.getElementById('ap-message').value,
      website: document.getElementById('ap-website').value
    };

    fetch((form.dataset.api || '') + '/api/careers/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.ok) {
          form.reset();
          status.className = 'form-status ok';
          status.textContent = 'Application sent — a person reads every one, and replies either way.';
        } else {
          status.className = 'form-status err';
          status.textContent = (result.body && result.body.error) ||
            'Something went wrong on our end — please try again in a minute.';
        }
      })
      .catch(function () {
        status.className = 'form-status err';
        status.textContent = 'Could not reach the server — check your connection and try again.';
      })
      .then(function () { submit.disabled = false; });
  });
})();
