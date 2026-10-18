/**
 * Cloudflare Email Worker for legal@atmosphereteam.com.
 *
 * Bound to that address by an Email Routing rule (action: worker). For every
 * message it:
 *   1. forwards the original to FORWARD_TO (jack@jettx.ai) — always first, so
 *      a backend outage can never lose a legal request; then
 *   2. POSTs a parsed copy (sender, subject, text body, received time,
 *      message-id, attachment names/sizes) to LEGAL_INBOUND_URL with the
 *      x-legal-inbound-secret header, if LEGAL_INBOUND_SECRET is set.
 *
 * Bindings (Workers dashboard → legal-email → Settings → Variables):
 *   FORWARD_TO           plain text, verified Email Routing destination
 *   LEGAL_INBOUND_URL    plain text, https://platform.atmosphereteam.com/api/legal/inbound
 *   LEGAL_INBOUND_SECRET secret, same value as the backend's LEGAL_INBOUND_SECRET
 *
 * No dependencies: a small MIME walker pulls the text/plain body and lists
 * attachments. Deployed via the Cloudflare API as an ES module.
 */

const MAX_RAW = 25 * 1024 * 1024;
const MAX_TEXT = 200000;

export default {
  async email(message, env, ctx) {
    await message.forward(env.FORWARD_TO || 'jack@jettx.ai');
    if (!env.LEGAL_INBOUND_SECRET || !env.LEGAL_INBOUND_URL) return;
    ctx.waitUntil(logToBackend(message, env).catch((err) => console.error('legal inbound log failed', String(err))));
  },
};

async function logToBackend(message, env) {
  const raw = message.rawSize <= MAX_RAW ? await new Response(message.raw).text() : '';
  const parsed = raw ? parseMime(raw) : { text: null, attachments: [] };
  const { name, address } = splitAddress(message.headers.get('from') || message.from);
  const date = Date.parse(message.headers.get('date') || '');
  const payload = {
    messageId: message.headers.get('message-id'),
    from: address || message.from,
    fromName: name,
    to: message.to,
    subject: decodeWords(message.headers.get('subject') || ''),
    text: parsed.text ? parsed.text.slice(0, MAX_TEXT) : null,
    receivedAt: new Date().toISOString(),
    sentAt: Number.isFinite(date) ? new Date(date).toISOString() : undefined,
    rawSize: message.rawSize,
    attachments: parsed.attachments.slice(0, 100),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(env.LEGAL_INBOUND_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-legal-inbound-secret': env.LEGAL_INBOUND_SECRET },
      body: JSON.stringify(payload),
    });
    if (res.ok || (res.status >= 400 && res.status < 500)) return;
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
}

function splitAddress(value) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(value || '');
  if (m) return { name: decodeWords(m[1].trim()) || null, address: m[2].trim() };
  return { name: null, address: (value || '').trim() };
}

function splitHeaders(part) {
  const idx = part.search(/\r?\n\r?\n/);
  const head = idx < 0 ? part : part.slice(0, idx);
  const body = idx < 0 ? '' : part.slice(idx).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body };
}

function param(header, key) {
  const m = new RegExp(`${key}\\*?=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(header || '');
  if (!m) return null;
  let v = m[1] ?? m[2];
  if (/^[\w-]+''/.test(v)) v = decodeURIComponent(v.replace(/^[\w-]+''/, ''));
  return decodeWords(v);
}

function decodeBody(body, encoding) {
  const enc = (encoding || '').toLowerCase();
  if (enc === 'base64') {
    try {
      const bin = atob(body.replace(/\s+/g, ''));
      return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return body;
    }
  }
  if (enc === 'quoted-printable') {
    const bytes = [];
    const s = body.replace(/=\r?\n/g, '');
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
        bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
        i += 2;
      } else bytes.push(s.charCodeAt(i) & 0xff);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
  return body;
}

function encodedSize(body, encoding) {
  const clean = body.replace(/\s+/g, '');
  return (encoding || '').toLowerCase() === 'base64' ? Math.floor((clean.length * 3) / 4) : body.length;
}

function decodeWords(s) {
  return (s || '').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, _cs, enc, text) => {
    try {
      if (enc.toUpperCase() === 'B') return decodeBody(text, 'base64');
      return decodeBody(text.replace(/_/g, ' '), 'quoted-printable');
    } catch {
      return text;
    }
  });
}

function parseMime(raw) {
  const out = { text: null, html: null, attachments: [] };
  walk(raw, out, 0);
  if (!out.text && out.html) out.text = out.html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return { text: out.text, attachments: out.attachments };
}

function walk(part, out, depth) {
  if (depth > 8) return;
  const { headers, body } = splitHeaders(part);
  const type = (headers['content-type'] || 'text/plain').toLowerCase();
  const disposition = headers['content-disposition'] || '';
  const filename = param(disposition, 'filename') || param(headers['content-type'], 'name');
  if (type.startsWith('multipart/')) {
    const boundary = param(headers['content-type'], 'boundary');
    if (!boundary) return;
    const pieces = body.split(`--${boundary}`);
    for (const piece of pieces.slice(1)) {
      if (piece.startsWith('--')) break;
      walk(piece.replace(/^\r?\n/, ''), out, depth + 1);
    }
    return;
  }
  if (filename || /^attachment/i.test(disposition)) {
    out.attachments.push({ filename: filename || null, contentType: type.split(';')[0], size: encodedSize(body, headers['content-transfer-encoding']) });
    return;
  }
  if (type.startsWith('text/plain') && out.text == null) out.text = decodeBody(body, headers['content-transfer-encoding']);
  else if (type.startsWith('text/html') && out.html == null) out.html = decodeBody(body, headers['content-transfer-encoding']);
}

export { parseMime, splitAddress };
