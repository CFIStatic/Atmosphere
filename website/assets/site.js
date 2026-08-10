// Shared behavior for the Atmosphere corporate site.
(function () {
  // The bridge to the product. The deploy workflow stamps the hosted app's
  // origin onto <html data-app-origin> (from the WEBSITE_APP_ORIGIN repo
  // variable); when present, every sign-in / get-started CTA routes into the
  // real app and the early-access stubs below stand down. Unstamped — local
  // dev, or the app not hosted yet — the site keeps its designed surfaces.
  var APP_ORIGIN = (document.documentElement.getAttribute('data-app-origin') || '')
    .replace(/\/+$/, '');
  if (APP_ORIGIN) {
    document.querySelectorAll('a[href$="signin.html"], a[href$="signup.html"]')
      .forEach(function (a) {
        var toSignup = a.getAttribute('href').indexOf('signup') !== -1;
        a.setAttribute('href', APP_ORIGIN + (toSignup ? '/signup' : '/login'));
      });
  }

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

  // Auth links: when an app origin is known (local dev or data-app-origin at
  // deploy), every Sign in / Get started CTA goes straight to the React app.
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
    var signin = authUrl('signin');
    var signup = authUrl('signup');
    if (!signin) return;
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (href === 'signin.html' || href === './signin.html') a.setAttribute('href', signin);
      else if (href === 'signup.html' || href === './signup.html') a.setAttribute('href', signup);
    });
    wireAppLinks();
  }

  wireAuthLinks();

  // Dedicated auth pages: skip the marketing stub and open the app directly.
  var authPage = page.replace(/^\.\//, '');
  var signinTarget = authUrl('signin');
  var signupTarget = authUrl('signup');
  if (signinTarget && authPage === 'signin.html') {
    location.replace(signinTarget);
    return;
  }
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
  stubForm('signin-form', 'signin-status',
    "We're onboarding organizations personally during early access — your team's workspace link gets you in.",
    signinTarget);
  stubForm('signup-form', 'signup-status',
    "We're onboarding organizations personally during early access — reach out via the contact page and yours will be ready today.",
    signupTarget);
  stubForm('investors-form', 'investors-status',
    'Access keys are issued personally — use Request access and we will be in touch.');

  wireForm('contact-form', 'contact-status', '/api/contact/send', {
    name: 'ct-name', email: 'ct-email', company: 'ct-company',
    teamSize: 'ct-team', workType: 'ct-work',
    message: 'ct-message', website: 'ct-website'
  }, "Sent — a person replies, usually within one business day.");

  // Store prices (helmets & vests) are published from one attribute per card:
  // put whole dollars in data-price and the card prints them. Left empty, the
  // card says so in words — an unpriced product must never render as a figure
  // nobody set, and never as free. Same rule as the recovery counter.
  document.querySelectorAll('.shop-price').forEach(function (el) {
    var raw = (el.getAttribute('data-price') || '').replace(/[^0-9.]/g, '');
    var amount = parseFloat(raw);
    if (!raw || !isFinite(amount) || amount <= 0) {
      el.classList.add('is-unset');
      el.textContent = 'Price to come';
      return;
    }
    el.classList.remove('is-unset');
    el.textContent = '$' + amount.toLocaleString('en-US');
    var unit = document.createElement('span');
    unit.className = 'shop-unit';
    unit.textContent = el.getAttribute('data-unit') || 'each';
    el.appendChild(unit);
  });

  // An Order button carries which item it came from; the contact form opens
  // with that already written down, so sales gets a request and not a riddle.
  var ORDER_ITEMS = {
    'helmet-mount': 'Helmet Mount',
    'chest-vest': 'Chest Vest',
    'crew-kit': 'Crew Kit (one helmet mount + one vest per tech)'
  };
  var ordered = ORDER_ITEMS[(location.search.match(/[?&]item=([\w-]+)/) || [])[1]];
  var orderMessage = document.getElementById('ct-message');
  if (ordered && orderMessage && !orderMessage.value) {
    orderMessage.value = 'I would like to order: ' + ordered + '.\n\nHow many: ';
  }
})();
