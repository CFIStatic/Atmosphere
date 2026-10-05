import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const fieldApp = readFileSync(resolve(repoRoot, 'fieldcapture/js/app.js'), 'utf8');

describe('Field Capture "Create an account" inside the iPhone/Android app', () => {
  it('points at the corporate website sign-up page and opens it outside the app', () => {
    expect(fieldApp).toContain("var WEBSITE_SIGNUP_URL = 'https://atmosphereteam.com/signup';");
    const helper = fieldApp.slice(fieldApp.indexOf('function pointSignupToWebsite'), fieldApp.indexOf('function pointSignupToWebsite') + 200);
    expect(helper).toContain('link.href = WEBSITE_SIGNUP_URL;');
    expect(helper).toContain("link.target = '_blank';");
  });

  it('uses the website link in the app on both places that set the sign-up href', () => {
    const bind = fieldApp.slice(fieldApp.indexOf("when('#signup-link'"), fieldApp.indexOf("when('#signin-toggle'"));
    expect(bind.indexOf('if (IN_APP_SHELL)')).toBeGreaterThan(-1);
    expect(bind.indexOf('if (IN_APP_SHELL)')).toBeLessThan(bind.indexOf("resolveOfficeHref('/signup')"));
    const productSwitch = fieldApp.slice(fieldApp.indexOf('function bindProductSwitch'));
    expect(productSwitch.indexOf('pointSignupToWebsite(signup)')).toBeGreaterThan(-1);
    expect(productSwitch.indexOf('pointSignupToWebsite(signup)')).toBeLessThan(productSwitch.indexOf("resolveOfficeHref('/signup')"));
  });

  it('only applies in the app shell (user agent marker or Capacitor native)', () => {
    const detect = fieldApp.slice(fieldApp.indexOf('var IN_APP_SHELL'), fieldApp.indexOf('var WEBSITE_SIGNUP_URL'));
    expect(detect).toContain('/AtmosphereFieldCapture/');
    expect(detect).toContain('isNativePlatform');
  });
});
