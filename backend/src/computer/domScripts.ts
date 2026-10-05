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
  return {
    url: location.href,
    hasPasswordField: inputs.some((i) => i.type === 'password'),
    hasOneTimeCodeField: inputs.some((i) => (i.getAttribute('autocomplete') || '').toLowerCase() === 'one-time-code' || /\b(otp|one.?time|verification.?code|2fa|mfa)\b/i.test(i.name + ' ' + i.id + ' ' + i.placeholder)),
    hasCaptcha: frames.some((f) => CAPTCHA.test(f.src + ' ' + f.title)) || Boolean(document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile')),
    mentionsVerificationCode: /\b(verification code|security code|one-time (pass)?code|enter the code|two-step|2-step|two-factor|authenticator app)\b/i.test(text),
  };
}`;
