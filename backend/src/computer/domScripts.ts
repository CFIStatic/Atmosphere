/**
 * In-page readers for the Playwright driver, kept as plain JavaScript source
 * (the backend compiles without DOM types). They run inside the customer's
 * website, only read the DOM, and return plain data. Nothing they return is
 * ever treated as an instruction.
 */

const SHARED = String.raw`
  const OTP_RE = /\b(otp|one.?time|verification.?code|2fa|mfa)\b/;
  const textOf = (node) => {
    if (!node) return '';
    const aria = node.getAttribute('aria-label') || node.getAttribute('title') || '';
    const value = node.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(node.type) ? node.value : '';
    const inner = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    return (aria || value || inner).slice(0, 160);
  };
  const describe = (el, extra) => {
    const clickable = el.closest('button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="tab"], [onclick]') || el;
    let input = null;
    if (clickable.tagName === 'INPUT') input = clickable;
    else if (clickable.tagName === 'LABEL' && clickable.control && clickable.control.tagName === 'INPUT') input = clickable.control;
    let label = textOf(clickable);
    if (input && (input.type === 'checkbox' || input.type === 'radio') && input.labels && input.labels[0]) {
      label = textOf(input.labels[0]) || label;
    }
    if (input && !label) {
      label = (input.labels && input.labels[0] ? textOf(input.labels[0]) : '') || input.placeholder || input.name || '';
    }
    const form = (input || clickable).closest('form');
    const typeAttr = input ? input.type : clickable.getAttribute('type');
    const autocomplete = input ? (input.getAttribute('autocomplete') || '').toLowerCase() : '';
    const nameish = input ? (input.name + ' ' + input.id + ' ' + input.placeholder).toLowerCase() : '';
    const textEntry = Boolean(
      (input && !['submit', 'button', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden'].includes(input.type)) ||
      clickable.tagName === 'TEXTAREA' || clickable.isContentEditable,
    );
    return Object.assign({
      tag: clickable.tagName.toLowerCase(),
      type: typeAttr ? String(typeAttr).toLowerCase() : null,
      role: clickable.getAttribute('role'),
      label: label,
      href: clickable.tagName === 'A' ? clickable.href : null,
      inForm: Boolean(form),
      formAction: form ? form.action || null : null,
      isFileInput: Boolean(input && input.type === 'file'),
      isPassword: Boolean(input && input.type === 'password'),
      isOneTimeCode: Boolean(input && (autocomplete === 'one-time-code' || OTP_RE.test(nameish))),
      isCheckbox: Boolean(input && (input.type === 'checkbox' || input.type === 'radio')),
      isTextEntry: textEntry,
      isTextarea: clickable.tagName === 'TEXTAREA' || Boolean(clickable.isContentEditable),
      inCaptcha: Boolean(clickable.closest('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]')),
      frameSrc: null,
      frameRect: null,
    }, extra || {});
  };
`;

/** (arg: {x, y}) => descriptor | null. Reports iframes so the driver can look inside. */
export const DESCRIBE_AT_POINT = String.raw`(arg) => {
  ${SHARED}
  const CAPTCHA = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|geetest|captcha/i;
  const el = document.elementFromPoint(arg.x, arg.y);
  if (!el) return null;
  if (el.tagName === 'IFRAME') {
    const r = el.getBoundingClientRect();
    const src = el.src || '';
    const meta = src + ' ' + (el.getAttribute('title') || '') + ' ' + el.id + ' ' + el.className;
    return describe(el, { inCaptcha: CAPTCHA.test(meta), frameSrc: src, frameRect: { x: r.left, y: r.top } });
  }
  return describe(el);
}`;

export const DESCRIBE_FOCUSED = String.raw`() => {
  ${SHARED}
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  return describe(el);
}`;

export const READ_FIELDS = String.raw`() => {
  const out = [];
  const els = Array.from(document.querySelectorAll('input, textarea, select'));
  for (const el of els) {
    const type = el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(type)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    let value = '';
    if (type === 'password') value = el.value ? '••••••' : '';
    else if (type === 'checkbox' || type === 'radio') value = el.checked ? 'checked' : '';
    else if (el.tagName === 'SELECT') value = el.selectedOptions[0] ? el.selectedOptions[0].text : el.value;
    else value = el.value;
    if (!value) continue;
    const label = (el.labels && el.labels[0] ? el.labels[0].innerText : '') || el.getAttribute('aria-label') || el.placeholder || el.name || '';
    out.push({ label: String(label).replace(/\s+/g, ' ').trim().slice(0, 120), name: el.name || null, type: type, value: String(value).slice(0, 500) });
    if (out.length >= 60) break;
  }
  return out;
}`;

export const READ_SIGNALS = String.raw`() => {
  const CAPTCHA = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|arkoselabs|funcaptcha|geetest/i;
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
  const frames = Array.from(document.querySelectorAll('iframe')).filter(visible);
  const text = ((document.body && document.body.innerText) || '').slice(0, 20000);
  const mentionsVerificationCode = /\b(verification code|security code|one-time (pass)?code|enter the code|two-step|2-step|two-factor|authenticator app)\b/i.test(text);
  // Number-matching MFA: the page asks the person to approve a number on their phone.
  const numberMatchTalk = /\b(approve|number matching|enter (?:this|the) number|are you trying to sign in|authenticator)\b/i.test(text);
  let approvalNumber = null;
  if (numberMatchTalk) {
    const big = Array.from(document.querySelectorAll('h1,h2,h3,[role="heading"],[class*="number"],[class*="Number"],[data-testid*="number"]'))
      .filter(visible)
      .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
      .find((t) => /^\d{2,3}$/.test(t));
    if (big) approvalNumber = big;
    if (!approvalNumber) {
      const m = text.match(/\b(?:approve|enter|number(?:\s+is)?|matching)[^\d]{0,40}\b(\d{2,3})\b/i)
        || text.match(/\b(\d{2,3})\b[^\d]{0,40}(?:on your (?:phone|device)|in (?:your )?authenticator|to (?:sign in|continue|approve))/i);
      if (m) approvalNumber = m[1];
    }
  }
  // A code written on this page (not in an input). Prefer "code is 123456" phrasing.
  let visibleOtpCode = null;
  if (mentionsVerificationCode || /\b(your code|code is|verification code[:\s])/i.test(text)) {
    const m = text.match(/\b(?:code(?:\s+is)?|verification code)[:\s]+(\d{4,8})\b/i)
      || text.match(/\b(\d{6})\b/);
    // Only keep a standalone 4–8 digit code when the page is clearly about codes,
    // and it is not the same 2–3 digit approval number.
    if (m && m[1] !== approvalNumber && (m[1].length >= 4)) visibleOtpCode = m[1];
  }
  return {
    url: location.href,
    hasPasswordField: inputs.some((i) => i.type === 'password'),
    hasOneTimeCodeField: inputs.some((i) => (i.getAttribute('autocomplete') || '').toLowerCase() === 'one-time-code' || /\b(otp|one.?time|verification.?code|2fa|mfa)\b/i.test(i.name + ' ' + i.id + ' ' + i.placeholder)),
    hasCaptcha: frames.some((f) => CAPTCHA.test(f.src + ' ' + f.title)) || Boolean(document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile')),
    mentionsVerificationCode,
    approvalNumber,
    visibleOtpCode,
  };
}`;

/* -------------------------------------------- perception (Computer IQ) -- */

const A11Y = String.raw`
  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="combobox"], [role="textbox"], [role="option"], [role="switch"], [contenteditable="true"], [onclick]';
  const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = window.getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'search') return 'searchbox';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return 'generic';
  };
  const nameOf = (el) => {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.innerText || n.textContent : ''; }).join(' ');
      if (squash(t)) return squash(t).slice(0, 120);
    }
    const aria = el.getAttribute('aria-label');
    if (squash(aria)) return squash(aria).slice(0, 120);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (el.labels && el.labels[0] && squash(el.labels[0].innerText)) return squash(el.labels[0].innerText).slice(0, 120);
      if (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type) && squash(el.value)) return squash(el.value).slice(0, 120);
      const ph = el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '';
      return squash(ph).slice(0, 120);
    }
    const img = el.querySelector && el.querySelector('img[alt]');
    const text = squash(el.innerText || el.textContent || '') || (img ? squash(img.getAttribute('alt')) : '') || squash(el.getAttribute('title'));
    return text.slice(0, 120);
  };
  const norm = (s) => squash(s).toLowerCase().replace(/[“”"'’]/g, '').replace(/[^a-z0-9$.]+/g, ' ').trim();
`;

/** () => PageOutline. Stores the element list on window so a later LOCATE by ref finds the same node. */
export const PAGE_OUTLINE = String.raw`() => {
  ${A11Y}
  const vw = window.innerWidth, vh = window.innerHeight;
  const all = Array.from(document.querySelectorAll(INTERACTIVE)).filter(visible);
  const inView = all.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw; });
  const picked = inView.slice(0, 80);
  window.__atmoRefs = picked;
  const elements = picked.map((el, i) => {
    const r = el.getBoundingClientRect();
    const isInput = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
    const type = el.tagName === 'INPUT' ? (el.type || 'text').toLowerCase() : null;
    return {
      ref: i,
      role: roleOf(el),
      name: nameOf(el),
      tag: el.tagName.toLowerCase(),
      type,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
      h: Math.round(r.height),
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      checked: type === 'checkbox' || type === 'radio' ? Boolean(el.checked) : null,
      inForm: Boolean(el.closest('form')),
      isPassword: type === 'password',
      hasValue: isInput ? Boolean(el.value) : false,
    };
  });
  const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]')).filter(visible).map((h) => squash(h.innerText)).filter(Boolean).slice(0, 8).map((s) => s.slice(0, 120));
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')).filter(visible).map((d) => squash(d.getAttribute('aria-label') || (d.innerText || '').slice(0, 80))).slice(0, 3);
  return { url: location.href, title: squash(document.title).slice(0, 160), headings, dialogs, elements };
}`;

/** (target) => LocatedElement | null. Ref first (same page), then role + accessible name (exact, then contains). */
export const LOCATE_ELEMENT = String.raw`(target) => {
  ${A11Y}
  const box = (el) => {
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), role: roleOf(el), name: nameOf(el), tag: el.tagName.toLowerCase() };
  };
  if (typeof target.ref === 'number' && window.__atmoRefs && window.__atmoRefs[target.ref] && window.__atmoRefs[target.ref].isConnected) {
    return box(window.__atmoRefs[target.ref]);
  }
  const want = norm(target.name || '');
  if (!want) return null;
  const roleWant = target.role ? String(target.role).toLowerCase() : null;
  const tagWant = target.tag ? String(target.tag).toLowerCase() : null;
  const cands = Array.from(document.querySelectorAll(INTERACTIVE)).filter(visible);
  const sameKind = (el) => {
    if (roleWant && roleOf(el) !== roleWant && !(roleWant === 'textbox' && roleOf(el) === 'searchbox') && !(roleWant === 'searchbox' && roleOf(el) === 'textbox')) return false;
    if (tagWant && !roleWant && el.tagName.toLowerCase() !== tagWant) return false;
    return true;
  };
  const exact = cands.find((el) => sameKind(el) && norm(nameOf(el)) === want);
  if (exact) return box(exact);
  const starts = cands.find((el) => sameKind(el) && norm(nameOf(el)).startsWith(want));
  if (starts) return box(starts);
  const contains = cands.find((el) => sameKind(el) && want.length >= 4 && norm(nameOf(el)).includes(want));
  return contains ? box(contains) : null;
}`;

/** () => string. What the person would notice changing: URL, text, focus, field state, dialogs. */
export const PAGE_FINGERPRINT = String.raw`() => {
  const h = (s) => { let x = 5381; for (let i = 0; i < s.length; i += 1) x = ((x << 5) + x + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
  const text = ((document.body && document.body.innerText) || '').slice(0, 30000);
  const f = document.activeElement;
  const focus = f && f !== document.body ? f.tagName + '|' + (f.getAttribute('name') || f.id || '') + '|' + (f.getAttribute('aria-label') || '') : '';
  const fields = Array.from(document.querySelectorAll('input, textarea, select')).map((el) => (el.type === 'checkbox' || el.type === 'radio') ? (el.checked ? '1' : '0') : String(el.value || '').length).join(',');
  const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]').length;
  return [location.href, h(text), h(focus), h(fields), dialogs, Math.round(window.scrollY / 40)].join('#');
}`;

/**
 * () => DismissedOverlay[]. Cookie banners: prefer "reject / necessary only",
 * else "accept". Promo pop-ups: their close button. Never touches a dialog
 * with a password, code or payment field, or one about signing in, verifying,
 * paying or submitting.
 */
export const DISMISS_OVERLAYS = String.raw`() => {
  ${A11Y}
  const out = [];
  const CONSENT = '#onetrust-banner-sdk, #onetrust-consent-sdk, #CybotCookiebotDialog, #truste-consent-track, .truste_box_overlay, #didomi-host, .qc-cmp2-container, .osano-cm-dialog, #cookie-banner, #cookieBanner, [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i]';
  const REJECT = /^(reject all|reject|decline|decline all|deny|necessary only|only necessary|essential only|use necessary cookies only|reject optional cookies|continue without accepting)$/i;
  const ACCEPT = /^(accept all|accept all cookies|accept|accept cookies|allow all|allow all cookies|agree|i agree|got it|ok|okay|i understand)$/i;
  const CLOSE = /^(close|dismiss|no thanks|no, thanks|not now|maybe later|skip|×|✕|x)$/i;
  const RISKY = /sign ?in|log ?in|password|verification|verify|security code|payment|card number|checkout|place order|submit|delete/i;
  const buttons = (root) => Array.from(root.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')).filter(visible);
  const safeRoot = (root) => !root.querySelector('input[type="password"], input[autocomplete="one-time-code"], input[autocomplete^="cc-"]');
  const consent = Array.from(document.querySelectorAll(CONSENT)).filter((el) => visible(el) && /cookie|privacy|consent|tracking/i.test(el.innerText || ''));
  for (const root of consent.slice(0, 3)) {
    if (!safeRoot(root)) continue;
    const btns = buttons(root);
    const pick = btns.find((b) => REJECT.test(nameOf(b))) || btns.find((b) => ACCEPT.test(nameOf(b))) || btns.find((b) => CLOSE.test(nameOf(b)));
    if (pick) { const label = nameOf(pick); pick.click(); out.push({ kind: 'cookie', label }); break; }
  }
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')).filter(visible);
  for (const d of dialogs.slice(0, 2)) {
    const text = (d.innerText || '').slice(0, 2000);
    if (!safeRoot(d) || RISKY.test(text)) continue;
    if (d.querySelector('input:not([type="hidden"]):not([type="checkbox"]), textarea, select') && !/newsletter|sign up for|email updates|subscribe|offer|discount|% off|deal/i.test(text)) continue;
    const btn = buttons(d).find((b) => CLOSE.test(nameOf(b)) || /close|dismiss/i.test(b.getAttribute('aria-label') || ''));
    if (btn) { const label = nameOf(btn) || 'Close'; btn.click(); out.push({ kind: 'popup', label }); }
  }
  return out;
}`;

/**
 * Installed in every page while a person has control. Reports clicks, field
 * edits and Enter presses to the server through the __atmoRecord binding.
 * Password and one-time-code fields report only that sign-in happened.
 */
export const RECORDER = String.raw`(() => {
  if (window.__atmoRecorder) return;
  window.__atmoRecorder = true;
  ${A11Y}
  const send = (ev) => { try { if (window.__atmoRecording !== false && typeof window.__atmoRecord === 'function') window.__atmoRecord(ev); } catch (e) {} };
  const describe = (el) => ({ role: roleOf(el), name: nameOf(el), tag: el.tagName.toLowerCase() });
  const secret = (el) => el && el.tagName === 'INPUT' && (el.type === 'password' || (el.getAttribute('autocomplete') || '').toLowerCase() === 'one-time-code' || /\b(otp|one.?time|verification.?code|2fa|mfa)\b/i.test((el.name || '') + ' ' + (el.id || '')));
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest(INTERACTIVE) : null;
    if (!el) return;
    if (el.tagName === 'INPUT' && !['submit', 'button', 'reset', 'image', 'checkbox', 'radio'].includes(el.type)) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
    send(Object.assign({ kind: 'click' }, describe(el)));
  }, true);
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (el.tagName === 'INPUT' && ['checkbox', 'radio', 'submit', 'button', 'file', 'hidden'].includes(el.type)) return;
    if (secret(el)) { send({ kind: 'sign_in' }); return; }
    const value = el.tagName === 'SELECT' ? (el.selectedOptions[0] ? el.selectedOptions[0].text : el.value) : el.value;
    send(Object.assign({ kind: 'type', inputType: el.tagName === 'INPUT' ? el.type : el.tagName.toLowerCase(), value: String(value || '').slice(0, 500) }, describe(el)));
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = document.activeElement;
    if (secret(el)) return;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.tagName !== 'TEXTAREA') {
      send(Object.assign({ kind: 'type', inputType: el.type, value: String(el.value || '').slice(0, 500) }, describe(el)));
    }
    send(Object.assign({ kind: 'press', key: 'Enter' }, el ? describe(el) : {}));
  }, true);
})()`;

/** Find the file input at (or labelled by, or next to) a point. Called as `(${FIND_FILE_INPUT})(x, y)`. */
export const FIND_FILE_INPUT = `(px, py) => {
  const el = document.elementFromPoint(px, py);
  if (!el) return null;
  if (el instanceof HTMLInputElement && el.type === 'file') return el;
  const label = el.closest('label');
  const forInput = label ? (label.htmlFor ? document.getElementById(label.htmlFor) : label.querySelector('input[type=file]')) : null;
  if (forInput instanceof HTMLInputElement && forInput.type === 'file') return forInput;
  const box = el.closest('form, fieldset, section, div');
  const near = box ? box.querySelector('input[type=file]') : null;
  return near instanceof HTMLInputElement ? near : null;
}`;
