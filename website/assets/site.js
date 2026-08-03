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
        a.setAttribute('href', APP_ORIGIN + (toSignup ? '/login?mode=signup' : '/login'));
      });
  }

  // Highlight the nav group for the page being read. Platform-family pages
  // light the Platform menu; company-family pages light Company.
  var page = location.pathname.split('/').pop() || 'index.html';
  var NAV_GROUP = {
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

  function authUrl(kind) {
    var origin = appOrigin();
    if (!origin) return null;
    return kind === 'signup' ? origin + '/login?mode=signup' : origin + '/login';
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
})();
