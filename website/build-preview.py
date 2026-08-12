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
    ('verification', 'verification.html'),
    ('how-it-works', 'how-it-works.html'),
    ('field', 'field.html'),
    ('security', 'security.html'),
    ('pricing', 'pricing.html'),
    ('docs', 'docs.html'),
    ('doc-getting-started', 'doc-getting-started.html'),
    ('doc-recipes', 'doc-recipes.html'),
    ('doc-troubleshooting', 'doc-troubleshooting.html'),
    ('doc-field', 'doc-field.html'),
    ('doc-web-access', 'doc-web-access.html'),
    ('doc-billing', 'doc-billing.html'),
    ('about', 'about.html'),
    ('careers', 'careers.html'),
    ('contact', 'contact.html'),
    ('signin', 'signin.html'),
    ('signup', 'signup.html'),
    ('investors', 'investors.html'),
    ('privacy', 'privacy.html'),
    ('terms', 'terms.html'),
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

# The preview's nav and footer ARE the site's — extracted from index.html and
# rerouted — so they can never drift from the real pages again.
_index = (HERE / 'index.html').read_text()
site_nav = reroute(re.search(r'<nav class="nav">.*?</nav>', _index, re.S).group(0))
site_footer = reroute(re.search(r'<footer>.*?</footer>', _index, re.S).group(0))
routes_html = []
for route, fname in PAGES:
    hidden = '' if route == 'home' else ' hidden'
    routes_html.append(f'<div class="route" id="route-{route}"{hidden}>\n'
                       f'{reroute(extract(fname))}\n</div>')


out = f'''<title>Atmosphere — AI for Service Contractors</title>
<style>
{css}
/* ---------- Preview-only chrome ---------- */
.route[hidden] {{ display: none; }}
</style>

{site_nav}

{chr(10).join(routes_html)}

{site_footer}

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
    var NAV_GROUP = {{ verification: 'platform', 'how-it-works': 'platform', platform: 'platform', sales: 'platform', operations: 'platform',
      field: 'platform', manager: 'platform', security: 'resources', pricing: 'pricing',
      docs: 'resources', about: 'about', careers: 'about', contact: 'about',
      investors: 'about' }};
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
  // No form in the preview may submit natively — that would navigate the
  // single-file page away (on a hosted copy, to a Forbidden URL). Every
  // submit shows what the real site would do instead.
  var FORM_NOTES = {{
    'signin-form': 'Design preview — when hosted, this signs into your account via /api/auth/login and opens the app.',
    'careers-form': 'Design preview — when hosted, this posts to /api/careers/apply and emails the hiring inbox.',
    'contact-form': 'Design preview — when hosted, this posts to /api/contact/send and emails the sales inbox.',
    'signup-form': 'Design preview — when hosted, this opens the app\\'s create-account flow.',
    'investors-form': 'Design preview — access keys are issued personally; use Request access.'
  }};
  document.addEventListener('submit', function (ev) {{
    var form = ev.target;
    if (!form || form.tagName !== 'FORM') return;
    ev.preventDefault();
    var s = form.querySelector('.form-status');
    if (s) {{
      s.className = 'form-status ok';
      s.textContent = FORM_NOTES[form.id] ||
        'Design preview — this form is wired to the backend on the hosted site.';
    }}
  }}, true);

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
