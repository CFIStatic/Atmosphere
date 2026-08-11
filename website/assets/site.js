// Shared behavior for the Atmosphere corporate site.
(function () {
  // Highlight the nav group for the page being read. Platform-family pages
  // light the Platform menu; company-family pages light Company.
  var page = location.pathname.split('/').pop() || 'index.html';
  var NAV_GROUP = {
    'verification.html': 'platform', 'how-it-works.html': 'platform',
    'platform.html': 'platform', 'sales.html': 'platform', 'operations.html': 'platform',
    'field.html': 'platform', 'manager.html': 'platform',
    'security.html': 'resources', 'pricing.html': 'pricing', 'docs.html': 'resources',
    'about.html': 'about', 'careers.html': 'about', 'contact.html': 'about',
    'investors.html': 'about'
  };
  var group = NAV_GROUP[page] || (page.indexOf('doc-') === 0 ? 'resources' : null);
  if (group) {
    document.querySelectorAll('.nav-links a[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === group) a.setAttribute('aria-current', 'page');
    });
  }

  // Mobile drawer.
  var burger = document.getElementById('nav-burger');
  var navEl = document.querySelector('.nav');
  if (burger && navEl) {
    burger.addEventListener('click', function () {
      var open = navEl.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.querySelectorAll('.nav-panel a').forEach(function (a) {
      a.addEventListener('click', function () {
        navEl.classList.remove('nav-open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // "On this page" rail: highlight the section in view.
  document.querySelectorAll('.subnav').forEach(function (sub) {
    var links = Array.prototype.slice.call(sub.querySelectorAll('a[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) return;
    var byId = {};
    links.forEach(function (a) {
      var el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) byId[el.id] = a;
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && byId[entry.target.id]) {
          links.forEach(function (a) { a.classList.remove('active'); });
          byId[entry.target.id].classList.add('active');
        }
      });
    }, { rootMargin: '-25% 0px -65% 0px' });
    Object.keys(byId).forEach(function (id) { io.observe(document.getElementById(id)); });
  });
  // Appearance: System → Light → Dark. Same keys as the React console so a
  // choice made in either place sticks everywhere on this origin.
  var THEME_KEY = 'atmosphere.theme';
  var PREFS_KEY = 'atmosphere.preferences';
  var LEGACY_THEME_KEY = 'atm-theme';
  var THEME_CYCLE = ['system', 'light', 'dark'];

  function readThemePref() {
    try {
      var p = localStorage.getItem(THEME_KEY);
      if (p === 'light' || p === 'dark' || p === 'system') return p;
      try {
        var prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        if (prefs.theme === 'light' || prefs.theme === 'dark' || prefs.theme === 'system') {
          return prefs.theme;
        }
      } catch (e) { /* ignore */ }
      p = localStorage.getItem(LEGACY_THEME_KEY);
      if (p === 'light' || p === 'dark') return p;
    } catch (e) { /* private mode */ }
    return 'system';
  }

  function resolveTheme(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function persistThemePref(pref) {
    try {
      localStorage.setItem(THEME_KEY, pref);
      var prefs = {};
      try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { prefs = {}; }
      prefs.theme = pref;
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      if (pref === 'system') localStorage.removeItem(LEGACY_THEME_KEY);
      else localStorage.setItem(LEGACY_THEME_KEY, pref);
    } catch (e) { /* private mode */ }
  }

  function applyThemePref(pref) {
    var root = document.documentElement;
    var resolved = resolveTheme(pref);
    root.setAttribute('data-theme', resolved);
    root.setAttribute('data-theme-preference', pref);
    return resolved;
  }

  function themeLabel(pref) {
    return pref === 'system' ? 'System' : pref === 'light' ? 'Light' : 'Dark';
  }

  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    // Ensure a monitor glyph exists for the System state without editing every HTML file.
    if (!toggle.querySelector('.icon-system')) {
      toggle.insertAdjacentHTML(
        'beforeend',
        '<svg class="icon-system" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
          '<rect x="1.5" y="2.5" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/>' +
          '<path d="M5.5 14h5M8 11.5V14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' +
        '</svg>'
      );
    }

    var media = window.matchMedia('(prefers-color-scheme: dark)');
    function paintFromStore() {
      var pref = readThemePref();
      applyThemePref(pref);
      toggle.setAttribute(
        'aria-label',
        'Appearance: ' + themeLabel(pref) + '. Click to change.'
      );
      toggle.setAttribute('title', 'Appearance: ' + themeLabel(pref));
    }
    paintFromStore();
    media.addEventListener('change', function () {
      if (readThemePref() === 'system') applyThemePref('system');
    });

    toggle.addEventListener('click', function () {
      var current = readThemePref();
      var idx = THEME_CYCLE.indexOf(current);
      var next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
      persistThemePref(next);
      applyThemePref(next);
      toggle.setAttribute(
        'aria-label',
        'Appearance: ' + themeLabel(next) + '. Click to change.'
      );
      toggle.setAttribute('title', 'Appearance: ' + themeLabel(next));
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

  // Pricing: monthly ↔ annual swaps the figure each plan advertises.
  var seg = document.getElementById('billing-seg');
  if (seg) {
    seg.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-period]');
      if (!btn) return;
      var annual = btn.dataset.period === 'annual';
      seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === btn); });
      document.querySelectorAll('.plan .amt[data-monthly]').forEach(function (el) {
        el.textContent = annual ? el.dataset.annual : el.dataset.monthly;
      });
    });
  }

  // Site forms post JSON to the backend, which emails the right inbox.
  // `data-api` on a form overrides the API origin when the site is hosted
  // separately from the backend.
  function wireForm(formId, statusId, endpoint, fields, successText) {
    var form = document.getElementById(formId);
    if (!form) return;
    var status = document.getElementById(statusId);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      status.className = 'form-status';
      status.textContent = 'Sending…';
      var payload = {};
      Object.keys(fields).forEach(function (key) {
        payload[key] = document.getElementById(fields[key]).value;
      });
      fetch((form.dataset.api || '') + endpoint, {
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
            status.textContent = successText;
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
  }

  // Careers: role listings prefill the application form.
  document.querySelectorAll('.apply-link').forEach(function (link) {
    link.addEventListener('click', function () {
      var select = document.getElementById('ap-role');
      if (select && link.dataset.role) select.value = link.dataset.role;
    });
  });

  wireForm('careers-form', 'careers-status', '/api/careers/apply', {
    name: 'ap-name', email: 'ap-email', role: 'ap-role',
    links: 'ap-links', message: 'ap-message', website: 'ap-website'
  }, 'Application sent — a person reads every one, and replies either way.');

  // The bridge to the product. The deploy workflow stamps the hosted app's
  // origin onto <html data-app-origin> (from the WEBSITE_APP_ORIGIN repo
  // variable). Sign-in stays on the site's own page — it performs a real
  // login below and forwards into the app — while Get started / Create your
  // organization CTAs go straight to the React app's signup flow.
  function appOrigin() {
    var fromHtml = document.documentElement.getAttribute('data-app-origin');
    if (fromHtml) return fromHtml.replace(/\/$/, '');
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return 'http://localhost:5174';
    }
    return null;
  }

  function authUrl(kind, nextPath) {
    var origin = appOrigin();
    if (!origin) return null;
    return kind === 'signup' ? origin + '/signup' : origin + '/login';
  }

  function appPath(path) {
    var origin = appOrigin();
    if (!origin) return null;
    var safe = path.charAt(0) === '/' ? path : '/' + path;
    return origin + safe;
  }

  function wireAppLinks() {
    document.querySelectorAll('[data-app-path]').forEach(function (a) {
      var path = a.getAttribute('data-app-path');
      if (!path) return;
      var target = appPath(path);
      if (target) a.setAttribute('href', target);
    });
  }

  function wireAuthLinks() {
    var signup = authUrl('signup');
    if (!signup) return;
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (href === 'signup.html' || href === './signup.html') a.setAttribute('href', signup);
    });
    wireAppLinks();
  }

  wireAuthLinks();

  // The signup page is still a handoff: when the app is hosted, skip the
  // marketing stub and open the real create-account flow directly. Sign-in
  // is a working surface (wired below), so it never redirects away.
  var authPage = page.replace(/^\.\//, '');
  var signupTarget = authUrl('signup');
  if (signupTarget && authPage === 'signup.html') {
    location.replace(signupTarget);
    return;
  }

  // Auth forms on signin/signup pages (shown only when no app origin is set).
  function stubForm(formId, statusId, text, appHref) {
    var form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (appHref) {
        location.href = appHref;
        return;
      }
      var status = document.getElementById(statusId);
      status.className = 'form-status ok';
      status.textContent = text;
    });
  }
  stubForm('signup-form', 'signup-status',
    "We're onboarding organizations personally during early access — reach out via the contact page and yours will be ready today.",
    signupTarget);
  stubForm('investors-form', 'investors-status',
    'Access keys are issued personally — use Request access and we will be in touch.');

  // Sign in is real: the form posts credentials to the backend's auth
  // endpoint — the same one the dashboard uses. The session comes back as
  // httpOnly cookies (no token ever touches page JavaScript), and the page
  // forwards into the app, which sees the fresh session and passes straight
  // through to the dashboard. If the browser declined a cross-site cookie
  // (site and backend on different origins), the app's login page comes up
  // with the email already filled in — one password away, never a dead end.
  // `data-api` on the form overrides the API origin when the site is hosted
  // separately from the backend (stamped from WEBSITE_API_ORIGIN at deploy).
  var signinForm = document.getElementById('signin-form');
  if (signinForm) {
    var signinStatus = document.getElementById('signin-status');
    var signinApi = (signinForm.dataset.api || '').replace(/\/+$/, '');
    if (!signinApi && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      signinApi = 'http://localhost:4000'; // the local backend's default port
    }

    signinForm.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!signinForm.reportValidity()) return;
      var submit = signinForm.querySelector('button[type="submit"]');
      var email = document.getElementById('email').value.trim();
      submit.disabled = true;
      signinStatus.className = 'form-status';
      signinStatus.textContent = 'Signing in…';
      fetch(signinApi + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // the session lives in httpOnly cookies
        body: JSON.stringify({ email: email, password: document.getElementById('password').value })
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            return { ok: res.ok, body: body };
          });
        })
        .then(function (result) {
          if (result.ok) {
            signinStatus.className = 'form-status ok';
            var origin = appOrigin();
            if (origin) {
              signinStatus.textContent = 'Signed in — opening your workspace…';
              location.href = origin + '/login?email=' + encodeURIComponent(email);
              return;
            }
            signinStatus.textContent =
              "Signed in. Open your team's workspace link to reach your dashboard.";
            submit.disabled = false;
          } else {
            signinStatus.className = 'form-status err';
            signinStatus.textContent = (result.body && result.body.error) ||
              'Could not sign you in — please try again in a minute.';
            submit.disabled = false;
          }
        })
        .catch(function () {
          signinStatus.className = 'form-status err';
          signinStatus.textContent =
            'Could not reach the sign-in service — check your connection and try again.';
          submit.disabled = false;
        });
    });
  }

  wireForm('contact-form', 'contact-status', '/api/contact/send', {
    name: 'ct-name', email: 'ct-email', company: 'ct-company',
    teamSize: 'ct-team', workType: 'ct-work',
    message: 'ct-message', website: 'ct-website'
  }, "Sent — a person replies, usually within one business day.");
})();
