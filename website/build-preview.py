#!/usr/bin/env python3
"""Assemble the multi-page site into one self-contained preview file.

The preview inlines the shared stylesheet, stacks every page's content into
route containers, and swaps cross-page links for a tiny hash router — so the
whole suite can be reviewed as a single HTML file with working navigation.
404.html is deliberately excluded: it has no route to be "not found" from.

Usage: python3 build-preview.py <output-file>
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
PAGES = [
    ('home', 'index.html'),
    ('platform', 'platform.html'),
    ('sales', 'sales.html'),
    ('operations', 'operations.html'),
    ('field', 'field.html'),
    ('manager', 'manager.html'),
    ('security', 'security.html'),
    ('pricing', 'pricing.html'),
    ('docs', 'docs.html'),
    ('doc-getting-started', 'doc-getting-started.html'),
    ('doc-recipes', 'doc-recipes.html'),
    ('doc-troubleshooting', 'doc-troubleshooting.html'),
    ('doc-estimators', 'doc-estimators.html'),
    ('doc-web-access', 'doc-web-access.html'),
    ('doc-computer-use', 'doc-computer-use.html'),
    ('doc-field', 'doc-field.html'),
    ('doc-billing', 'doc-billing.html'),
    ('about', 'about.html'),
    ('careers', 'careers.html'),
    ('contact', 'contact.html'),
    ('signin', 'signin.html'),
    ('signup', 'signup.html'),
]
ROUTE_OF = {fname: route for route, fname in PAGES}


def extract(fname: str) -> str:
    html = (HERE / fname).read_text()
    m = re.search(r'<!-- page:start -->\n(.*?)\n<!-- page:end -->', html, re.S)
    if not m:
        raise SystemExit(f'{fname}: page markers not found')
    return m.group(1)


def reroute(html: str) -> str:
    def page_link(m):
        return f'href="#/{ROUTE_OF[m.group(1)]}"'
    pattern = '|'.join(re.escape(f) for f in ROUTE_OF)
    html = re.sub('href="(' + pattern + ')(?:#[\\w-]+)?"', page_link, html)
    return html


css = (HERE / 'assets' / 'site.css').read_text()
routes_html = []
for route, fname in PAGES:
    hidden = '' if route == 'home' else ' hidden'
    routes_html.append(f'<div class="route" id="route-{route}"{hidden}>\n'
                       f'{reroute(extract(fname))}\n</div>')


out = f'''<title>Atmosphere — AI for Restoration &amp; Construction</title>
<style>
{css}
/* ---------- Preview-only chrome ---------- */
.route[hidden] {{ display: none; }}
</style>

<nav class="nav">
  <div class="wrap nav-inner">
    <a class="wordmark" href="#/home" aria-label="Atmosphere home">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect class="lb lb1" width="22" height="2.8"/><rect class="lb lb2" y="4.8" width="22" height="2.8"/><rect class="lb lb3" y="9.6" width="22" height="2.8"/><rect class="lb lb4" y="14.4" width="22" height="2.8"/><rect class="lb-a" y="19.2" width="22" height="2.8"/></svg>
      Atmosphere
    </a>
    <div class="nav-links">
      <div class="nav-item">
        <a href="#/platform" data-nav="platform">Platform <span class="caret" aria-hidden="true"></span></a>
        <div class="menu">
          <a href="#/platform">Platform overview <span>How the four fit together</span></a>
          <a href="#/sales">Sales Platform <span>Win the work</span></a>
          <a href="#/operations">Operations Platform <span>Run the work</span></a>
          <a href="#/field">Field Platform <span>Capture the job site</span></a>
          <a href="#/manager">Manager Platform <span>Run the business</span></a>
        </div>
      </div>
      <a href="#/pricing" data-nav="pricing">Pricing</a>
      <div class="nav-item">
        <a href="#/docs" data-nav="resources">Resources <span class="caret" aria-hidden="true"></span></a>
        <div class="menu">
          <a href="#/docs">Documentation <span>How every piece works</span></a>
          <a href="#/doc-recipes">Guides &amp; recipes <span>Ways crews use Atmosphere</span></a>
          <a href="#/doc-troubleshooting">Troubleshooting <span>Solving errors, step by step</span></a>
          <a href="#/security">Security <span>The model, by construction</span></a>
        </div>
      </div>
      <div class="nav-item">
        <a href="#/about" data-nav="about">Company <span class="caret" aria-hidden="true"></span></a>
        <div class="menu">
          <a href="#/about">About <span>Why proof-first</span></a>
          <a href="#/careers">Careers <span>Open roles</span></a>
          <a href="#/contact">Contact <span>Talk to a human</span></a>
        </div>
      </div>
      <a class="btn-quiet" href="#/signin">Sign in</a>
      <a class="btn" href="#/signup">Get started</a>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch between light and dark mode">
        <svg class="icon-moon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <svg class="icon-sun" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v1.8M8 13.2V15M15 8h-1.8M2.8 8H1M12.95 3.05l-1.27 1.27M4.32 11.68l-1.27 1.27M12.95 12.95l-1.27-1.27M4.32 4.32 3.05 3.05" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
      <button class="nav-burger" id="nav-burger" type="button" aria-label="Open menu" aria-expanded="false">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>
  <div class="nav-panel" id="nav-panel">
    <div class="grp mono">Platform</div>
    <a class="sub" href="#/platform">Overview</a>
    <a class="sub" href="#/field">Field Platform</a>
    <a href="#/pricing">Pricing</a>
    <div class="grp mono">Resources</div>
    <a class="sub" href="#/docs">Documentation</a>
    <a class="sub" href="#/doc-recipes">Guides &amp; recipes</a>
    <a class="sub" href="#/doc-troubleshooting">Troubleshooting</a>
    <a class="sub" href="#/security">Security</a>
    <div class="grp mono">Company</div>
    <a class="sub" href="#/about">About</a>
    <a class="sub" href="#/careers">Careers</a>
    <a class="sub" href="#/contact">Contact</a>
    <a href="#/signin">Sign in</a>
    <a href="#/signup">Create your organization</a>
  </div>
</nav>

{chr(10).join(routes_html)}

<footer>
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-brand">
        <a class="wordmark" href="#/home" aria-label="Atmosphere home">
          <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true"><rect class="lb lb1" width="22" height="2.8"/><rect class="lb lb2" y="4.8" width="22" height="2.8"/><rect class="lb lb3" y="9.6" width="22" height="2.8"/><rect class="lb lb4" y="14.4" width="22" height="2.8"/><rect class="lb-a" y="19.2" width="22" height="2.8"/></svg>
          Atmosphere
        </a>
      </div>
      <div class="foot-col">
        <h4>Product</h4>
        <a href="#/platform">Platform</a>
        <a href="#/security">Security</a>
        <a href="#/pricing">Pricing</a>
        <a href="#/docs">Docs</a>
      </div>
      <div class="foot-col">
        <h4>Company</h4>
        <a href="#/about">About</a>
        <a href="#/careers">Careers</a>
        <a href="#/contact">Contact</a>
      </div>
      <div class="foot-col">
        <h4>App</h4>
        <a href="#/signin">Sign in</a>
        <a href="#/signup">Create an organization</a>
        <a href="#/field">Field Platform</a>
      </div>
    </div>
    <div class="foot-note">
      <span>© 2026 Atmosphere.</span>
      <span>Every run, on the record.</span>
    </div>
  </div>
</footer>

<script>
(function () {{
  var routes = {[r for r, _ in PAGES]!r};
  var last = null;
  function current() {{
    var h = location.hash;
    if (h.indexOf('#/') === 0) {{
      var r = h.slice(2);
      return routes.indexOf(r) !== -1 ? r : 'home';
    }}
    return last || 'home';
  }}
  function show() {{
    var r = current();
    var changed = r !== last;
    last = r;
    routes.forEach(function (name) {{
      var el = document.getElementById('route-' + name);
      if (el) el.hidden = (name !== r);
    }});
    var NAV_GROUP = {{ platform: 'platform', sales: 'platform', operations: 'platform',
      field: 'platform', manager: 'platform', security: 'resources', pricing: 'pricing',
      docs: 'resources', about: 'about', careers: 'about', contact: 'about' }};
    var g = NAV_GROUP[r] || (r.indexOf('doc-') === 0 ? 'resources' : null);
    document.querySelectorAll('[data-nav]').forEach(function (a) {{
      if (a.getAttribute('data-nav') === g) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }});
    if (changed) window.scrollTo(0, 0);
  }}
  window.addEventListener('hashchange', show);
  show();

  var burger = document.getElementById('nav-burger');
  var navEl = document.querySelector('.nav');
  if (burger && navEl) {{
    burger.addEventListener('click', function () {{
      var open = navEl.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    }});
    document.querySelectorAll('.nav-panel a').forEach(function (a) {{
      a.addEventListener('click', function () {{
        navEl.classList.remove('nav-open');
        burger.setAttribute('aria-expanded', 'false');
      }});
    }});
  }}

  document.querySelectorAll('.subnav').forEach(function (sub) {{
    var links = Array.prototype.slice.call(sub.querySelectorAll('a[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) return;
    var byId = {{}};
    links.forEach(function (a) {{
      var el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) byId[el.id] = a;
    }});
    var io = new IntersectionObserver(function (entries) {{
      entries.forEach(function (entry) {{
        if (entry.isIntersecting && byId[entry.target.id]) {{
          links.forEach(function (a) {{ a.classList.remove('active'); }});
          byId[entry.target.id].classList.add('active');
        }}
      }});
    }}, {{ rootMargin: '-25% 0px -65% 0px' }});
    Object.keys(byId).forEach(function (id) {{ io.observe(document.getElementById(id)); }});
  }});

  var seg = document.getElementById('billing-seg');
  if (seg) {{
    seg.addEventListener('click', function (event) {{
      var b2 = event.target.closest('button[data-period]');
      if (!b2) return;
      var annual = b2.dataset.period === 'annual';
      seg.querySelectorAll('button').forEach(function (b) {{ b.classList.toggle('on', b === b2); }});
      document.querySelectorAll('.plan .amt[data-monthly]').forEach(function (el) {{
        el.textContent = annual ? el.dataset.annual : el.dataset.monthly;
      }});
    }});
  }}

  var toggle = document.getElementById('theme-toggle');
  if (toggle) {{
    toggle.addEventListener('click', function () {{
      var root = document.documentElement;
      var explicit = root.getAttribute('data-theme');
      var isDark = explicit ? explicit === 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', isDark ? 'light' : 'dark');
    }});
  }}

  document.querySelectorAll('.apply-link').forEach(function (link) {{
    link.addEventListener('click', function () {{
      var sel = document.getElementById('ap-role');
      if (sel && link.dataset.role) sel.value = link.dataset.role;
    }});
  }});
  var careersForm = document.getElementById('careers-form');
  if (careersForm) {{
    careersForm.addEventListener('submit', function (ev) {{
      ev.preventDefault();
      var s = document.getElementById('careers-status');
      s.className = 'form-status ok';
      s.textContent = 'Design preview — when hosted, this posts to /api/careers/apply and emails the hiring inbox.';
    }});
  }}

  var receipt = document.getElementById('receipt');
  var btn = document.getElementById('replay');
  if (receipt && btn) {{
    btn.addEventListener('click', function () {{
      var lines = receipt.querySelectorAll('.r-line, .r-divider, .r-status');
      lines.forEach(function (el) {{ el.style.animation = 'none'; }});
      void receipt.offsetWidth;
      lines.forEach(function (el) {{ el.style.animation = ''; }});
    }});
  }}
}})();
</script>
'''

Path(sys.argv[1]).write_text(out)
print(f'wrote {sys.argv[1]} ({len(out):,} bytes)')
