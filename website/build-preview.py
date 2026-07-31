#!/usr/bin/env python3
"""Assemble the multi-page site into one self-contained preview file.

The preview inlines the shared stylesheet, stacks every page's content into
route containers, and swaps cross-page links for a tiny hash router — so the
whole suite can be reviewed as a single HTML file with working navigation.

Usage: python3 build-preview.py <output-file>
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
PAGES = [
    ('home', 'index.html'),
    ('platform', 'platform.html'),
    ('security', 'security.html'),
    ('pricing', 'pricing.html'),
    ('docs', 'docs.html'),
    ('about', 'about.html'),
    ('contact', 'contact.html'),
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
    html = re.sub(r'href="((?:index|platform|security|pricing|docs|about|contact)\.html)(?:#[\w-]+)?"',
                  page_link, html)
    # App routes don't exist inside the preview; neutralize them but say why.
    html = re.sub(r'href="(/(?:signin|signup|technician))"',
                  r'href="#app" title="App route (\1) — outside this design preview"', html)
    return html


css = (HERE / 'assets' / 'site.css').read_text()
routes_html = []
for route, fname in PAGES:
    hidden = '' if route == 'home' else ' hidden'
    routes_html.append(f'<div class="route" id="route-{route}"{hidden}>\n'
                       f'{reroute(extract(fname))}\n</div>')

nav_links = '\n      '.join(
    f'<a href="#/{r}" data-nav="{r}">{r.capitalize()}</a>'
    for r, _ in PAGES if r not in ('home', 'contact'))

preview_bar = ' '.join(f'<a href="#/{r}">{r.upper()}</a>' for r, _ in PAGES)

out = f'''<title>Atmosphere — AI for Restoration &amp; Construction</title>
<style>
{css}
/* ---------- Preview-only chrome ---------- */
.route[hidden] {{ display: none; }}
.preview-bar {{
  background: var(--ink); color: var(--bg);
  font-size: 10.5px; letter-spacing: .08em;
  padding: 6px 12px; text-align: center;
}}
.preview-bar a {{ color: inherit; text-decoration: none; opacity: .75; padding: 0 7px; }}
.preview-bar a:hover {{ opacity: 1; }}
.preview-bar .lbl {{ opacity: .45; padding-right: 8px; }}
</style>

<div class="preview-bar mono"><span class="lbl">DESIGN PREVIEW · 7 PAGES</span>{preview_bar}</div>

<nav class="nav">
  <div class="wrap nav-inner">
    <a class="wordmark" href="#/home" aria-label="Atmosphere home">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect class="lb lb1" width="22" height="2.8"/><rect class="lb lb2" y="4.8" width="22" height="2.8"/><rect class="lb lb3" y="9.6" width="22" height="2.8"/><rect class="lb lb4" y="14.4" width="22" height="2.8"/><rect class="lb-a" y="19.2" width="22" height="2.8"/></svg>
      Atmosphere
    </a>
    <div class="nav-links">
      {nav_links}
      <a class="btn-quiet" href="#app" title="App route (/signin) — outside this design preview">Sign in</a>
      <a class="btn" href="#app" title="App route (/signup) — outside this design preview">Get started</a>
    </div>
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
        <p>AI that does the work — and proves it did. Built for the trades that put homes back together.</p>
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
        <a href="#/about">Careers</a>
        <a href="#/contact">Contact</a>
      </div>
      <div class="foot-col">
        <h4>App</h4>
        <a href="#app" title="App route (/signin) — outside this design preview">Sign in</a>
        <a href="#app" title="App route (/signup) — outside this design preview">Create an organization</a>
        <a href="#app" title="App route (/technician) — outside this design preview">Technician app</a>
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
    document.querySelectorAll('[data-nav]').forEach(function (a) {{
      if (a.getAttribute('data-nav') === r) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }});
    if (changed) window.scrollTo(0, 0);
  }}
  window.addEventListener('hashchange', show);
  show();

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
