import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATMOSPHERE_EMAIL_LOGO_DARK_URL,
  ATMOSPHERE_EMAIL_LOGO_LIGHT_URL,
  ATMOSPHERE_EMAIL_LOGO_STYLE,
  atmosphereWordmarkHtml,
} from '../src/lib/brandMark.js';

test('email header uses the hosted website lockup PNG with alt text', () => {
  const html = atmosphereWordmarkHtml();
  assert.ok(html.includes(`src="${ATMOSPHERE_EMAIL_LOGO_LIGHT_URL}"`));
  assert.ok(html.includes(`src="${ATMOSPHERE_EMAIL_LOGO_DARK_URL}"`));
  assert.match(html, /alt="Atmosphere"/);
  assert.match(html, /width="162" height="32"/);
  assert.ok(!/<svg/i.test(html));
  assert.match(ATMOSPHERE_EMAIL_LOGO_STYLE, /data-ogsc/);
  const dark = atmosphereWordmarkHtml({ ground: 'dark' });
  assert.ok(dark.includes(ATMOSPHERE_EMAIL_LOGO_DARK_URL));
  assert.ok(!dark.includes(ATMOSPHERE_EMAIL_LOGO_LIGHT_URL));
});
