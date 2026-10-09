/**
 * Live view for a Windows desktop: a small page served by this server (same
 * origin as the app, so the existing frame rules allow it) that shows the
 * desktop's screen and, in control mode, sends the person's clicks and keys
 * to it. The desktop agent itself is never exposed to the browser.
 *
 * The link is a signed, short-lived token (like a Browserbase live-view
 * link): it names one session and one org, says whether input is allowed,
 * and expires. It is minted per viewer and never stored or logged.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DESKTOP_LIVE_BASE = '/api/chat-computer/desktop-live';

export interface LiveToken {
  /** Provider session id. */
  s: string;
  /** Org id. */
  o: string;
  /** Expiry, ms since epoch. */
  e: number;
  /** 1 = the viewer may click and type. */
  c: 0 | 1;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function mac(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(`desktop-live\n${payload}`, 'utf8').digest();
}

export function mintLiveToken(secret: string, token: LiveToken): string {
  const payload = b64url(JSON.stringify(token));
  return `${payload}.${b64url(mac(secret, payload))}`;
}

/** The org a token claims (unverified): used only to pick which secret checks it. */
export function liveTokenOrg(raw: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw.split('.')[0] ?? '', 'base64url').toString('utf8')) as Partial<LiveToken>;
    return typeof parsed.o === 'string' ? parsed.o : null;
  } catch {
    return null;
  }
}

/** The token's contents when the signature is right and it hasn't expired; otherwise null. */
export function verifyLiveToken(secret: string, raw: string, nowMs: number): LiveToken | null {
  const [payload, sig, extra] = raw.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const want = mac(secret, payload);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let parsed: Partial<LiveToken>;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<LiveToken>;
  } catch {
    return null;
  }
  if (typeof parsed.s !== 'string' || typeof parsed.o !== 'string' || typeof parsed.e !== 'number' || (parsed.c !== 0 && parsed.c !== 1)) return null;
  if (parsed.e <= nowMs) return null;
  return { s: parsed.s, o: parsed.o, e: parsed.e, c: parsed.c };
}

export function liveViewPath(token: string): string {
  return `${DESKTOP_LIVE_BASE}/${token}/`;
}

/** The viewer page. Script is a separate same-origin file so the default CSP applies unchanged. */
export function liveViewHtml(control: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1280">
<meta name="referrer" content="no-referrer">
<title>Computer desktop</title>
<link rel="stylesheet" href="../viewer.css">
</head>
<body data-control="${control ? '1' : '0'}">
<img id="screen" alt="The company's Windows computer" width="1280" height="800" draggable="false">
<div id="status" role="status">Connecting to the computer…</div>
<script src="../viewer.js"></script>
</body>
</html>`;
}

export const LIVE_VIEW_CSS = `html,body{margin:0;padding:0;background:#111;overflow:hidden}
#screen{display:block;width:1280px;height:800px;outline:none;user-select:none}
body[data-control="1"] #screen{cursor:crosshair}
#status{position:fixed;left:8px;bottom:8px;font:12px system-ui,sans-serif;color:#eee;background:rgba(0,0,0,.6);padding:4px 8px;border-radius:4px}
#status:empty{display:none}`;

/**
 * Polls the screen and, in control mode, forwards input. Coordinates are in
 * the 1280×800 frame; the parent page scales the frame with CSS, and
 * offsetX/offsetY already undo that.
 */
export const LIVE_VIEW_JS = `(function () {
  var img = document.getElementById('screen');
  var status = document.getElementById('status');
  var control = document.body.getAttribute('data-control') === '1';
  var busy = false, failures = 0, stopped = false;
  function frame() {
    if (stopped || busy) return;
    busy = true;
    var next = new Image();
    next.onload = function () { img.src = next.src; busy = false; failures = 0; status.textContent = ''; };
    next.onerror = function () {
      busy = false; failures += 1;
      if (failures > 5) { stopped = true; status.textContent = 'The live view ended. Close it and open it again.'; }
    };
    next.src = 'frame?t=' + Date.now();
  }
  setInterval(frame, 700);
  frame();
  if (!control) return;
  img.tabIndex = 0;
  function send(body) {
    fetch('input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit' })
      .then(function () { setTimeout(frame, 150); })
      .catch(function () {});
  }
  function pos(e) { return { x: Math.round(e.offsetX), y: Math.round(e.offsetY) }; }
  img.addEventListener('mousedown', function (e) { img.focus(); e.preventDefault(); });
  img.addEventListener('click', function (e) { var p = pos(e); send({ action: 'click', x: p.x, y: p.y, button: 'left', clickCount: 1 }); });
  img.addEventListener('dblclick', function (e) { var p = pos(e); send({ action: 'click', x: p.x, y: p.y, button: 'left', clickCount: 2 }); });
  img.addEventListener('contextmenu', function (e) { e.preventDefault(); var p = pos(e); send({ action: 'click', x: p.x, y: p.y, button: 'right', clickCount: 1 }); });
  img.addEventListener('wheel', function (e) { e.preventDefault(); var p = pos(e); send({ action: 'scroll', x: p.x, y: p.y, direction: e.deltaY > 0 ? 'down' : 'up', amount: 3 }); }, { passive: false });
  var NAMES = { Enter: 'Return', Backspace: 'BackSpace', Tab: 'Tab', Escape: 'Escape', Delete: 'Delete', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'Page_Up', PageDown: 'Page_Down' };
  img.addEventListener('keydown', function (e) {
    var mods = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.altKey) mods.push('alt');
    if (e.metaKey) mods.push('super');
    var named = NAMES[e.key] || (/^F\\d{1,2}$/.test(e.key) ? e.key : null);
    if (named || mods.length) {
      e.preventDefault();
      var k = named || e.key.toLowerCase();
      if (e.shiftKey && named) mods.push('shift');
      send({ action: 'key', combo: mods.concat([k]).join('+'), repeat: 1 });
    } else if (e.key.length === 1) {
      e.preventDefault();
      send({ action: 'type', text: e.key });
    }
  });
  document.addEventListener('paste', function (e) {
    var text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (text) { e.preventDefault(); send({ action: 'type', text: text.slice(0, 2000) }); }
  });
})();`;
