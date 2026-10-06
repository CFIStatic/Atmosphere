/**
 * The real Playwright driver (the one Browserbase sessions use) against a
 * local Chromium and a static claim form. Skips when no Chromium is
 * installed. Checks that the DOM readers classify what is under the
 * pointer the way the gate expects.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright-core';
import { classifyClick, classifyKey } from '../src/computer/gate.js';
import { PlaywrightDriver } from '../src/computer/providers/playwrightDriver.js';

const PAGE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<form action="/submit" style="padding:20px">
  <label>Insured name <input id="insured" name="insured" style="position:absolute;left:200px;top:20px;width:300px;height:30px"></label>
  <label>Password <input id="pw" type="password" style="position:absolute;left:200px;top:70px;width:300px;height:30px"></label>
  <label>Code <input id="otp" autocomplete="one-time-code" style="position:absolute;left:200px;top:120px;width:300px;height:30px"></label>
  <label style="position:absolute;left:20px;top:170px"><input id="terms" type="checkbox"> I agree to the terms</label>
  <button type="button" style="position:absolute;left:20px;top:220px;width:120px;height:40px">Save draft</button>
  <button style="position:absolute;left:200px;top:220px;width:160px;height:40px">Submit claim</button>
</form>
<p style="position:absolute;top:300px;left:20px">Enter the verification code we sent you.</p>
</body></html>`;

let browser: Browser | null = null;
try {
  browser = await chromium.launch({ headless: true });
} catch {
  browser = null;
}

test('Playwright driver reads targets for the gate', { skip: browser ? false : 'no local Chromium' }, async () => {
  const context = await browser!.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.setContent(PAGE);
  const driver = new PlaywrightDriver(browser!, context, page, { width: 1280, height: 800 });
  try {
    const submit = await driver.describeTarget(280, 240);
    assert.equal(submit?.tag, 'button');
    assert.equal(submit?.label, 'Submit claim');
    assert.equal(submit?.inForm, true);
    const d = classifyClick(submit);
    assert.ok(d.type === 'consequential' && d.kind === 'submit');
    assert.equal(classifyClick(await driver.describeTarget(80, 240)).type, 'allow', 'Save draft');
    const terms = classifyClick(await driver.describeTarget(30, 180));
    assert.ok(terms.type === 'consequential' && terms.kind === 'accept_terms', JSON.stringify(terms));
    assert.equal((await driver.describeTarget(300, 85))?.isPassword, true);
    assert.equal((await driver.describeTarget(300, 135))?.isOneTimeCode, true);

    await driver.click(300, 35);
    await driver.type('Jane Testcase');
    const focused = await driver.focusedElement();
    assert.equal(focused?.isTextEntry, true);
    assert.equal(classifyKey('Return', focused).type, 'consequential');
    const fields = await driver.readFormFields();
    assert.ok(fields.some((f) => f.value === 'Jane Testcase'));
    const signals = await driver.pageSignals();
    assert.equal(signals.hasPasswordField, true);
    assert.equal(signals.hasOneTimeCodeField, true);
    assert.equal(signals.mentionsVerificationCode, true);
    assert.equal(signals.hasCaptcha, false);
    const png = await driver.screenshot('png');
    assert.ok(png.length > 1000);
  } finally {
    await context.close();
  }
});

test('fillSignIn types a saved login into a username-first sign-in, then the password page', { skip: browser ? false : 'no local Chromium' }, async () => {
  const PASSWORD = 'PW-SECRET-zq9-Atmosphere-TEST-7781-driver';
  const context = await browser!.newContext({ viewport: { width: 1280, height: 800 } });
  const posted: string[] = [];
  await context.route('https://login.example-sso.test/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST') posted.push(`${path}?${req.postData() ?? ''}`);
    const html =
      path === '/start'
        ? '<form method="post" action="/password"><input type="email" name="loginfmt"><button>Next</button></form>'
        : path === '/password'
          ? '<form method="post" action="/done"><input type="password" name="passwd"><input type="submit" value="Sign in"></form>'
          : path === '/combined'
            ? '<form method="post" action="/done"><input name="username"><input type="password" name="pw"><button type="submit">Log in</button></form>'
            : '<p>Welcome back</p>';
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>${html}</body></html>` });
  });
  const page = await context.newPage();
  const driver = new PlaywrightDriver(browser!, context, page, { width: 1280, height: 800 });
  try {
    await page.goto('https://login.example-sso.test/start');
    assert.equal(await driver.fillSignIn({ username: 'saved@example.test', password: PASSWORD }), 'submitted');
    assert.equal(new URL(page.url()).pathname, '/done');
    assert.deepEqual(posted, ['/password?loginfmt=saved%40example.test', `/done?passwd=${PASSWORD}`]);
    assert.equal((await driver.pageSignals()).hasPasswordField, false);

    posted.length = 0;
    await page.goto('https://login.example-sso.test/combined');
    assert.equal(await driver.fillSignIn({ username: 'saved', password: PASSWORD }), 'submitted');
    assert.deepEqual(posted, [`/done?username=saved&pw=${PASSWORD}`]);

    // Already signed in: nothing to fill.
    assert.equal(await driver.fillSignIn({ username: 'saved', password: PASSWORD }), 'no_form');
  } finally {
    await context.close();
  }
});

test('fillSignIn never types into a newsletter or sign-up box, and finds "username webauthn" boxes', { skip: browser ? false : 'no local Chromium' }, async () => {
  const PASSWORD = 'PW-SECRET-zq9-Atmosphere-TEST-7781-newsletter';
  const context = await browser!.newContext({ viewport: { width: 1280, height: 800 } });
  const posted: string[] = [];
  await context.route('https://shop.example-supplier.test/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() === 'POST') posted.push(`${path}?${req.postData() ?? ''}`);
    const html =
      path === '/home'
        ? '<a href="/login">Login</a><form method="post" action="/subscribe"><input type="email" name="email" placeholder="Email address"><button>Sign up</button></form>'
        : path === '/login'
          ? '<form method="post" action="/done"><input name="username"><input type="password" name="password"><button type="submit">Log in</button></form>'
          : path === '/square'
            ? '<form method="post" action="/done"><input id="mpui-combo-field-input" name="ident" autocomplete="username webauthn"><input type="password" name="pw"><button type="submit">Sign in</button></form>'
            : '<p>Welcome back</p>';
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>${html}</body></html>` });
  });
  const page = await context.newPage();
  const driver = new PlaywrightDriver(browser!, context, page, { width: 1280, height: 800 });
  try {
    await page.goto('https://shop.example-supplier.test/home');
    assert.deepEqual(await (await import('../src/computer/providers/playwrightDriver.js')).signInFieldsVisible(page), { username: false, password: false });
    assert.equal(await driver.fillSignIn({ username: 'saved@example.test', password: PASSWORD }, { openWith: ['Login'] }), 'submitted');
    assert.deepEqual(posted, [`/done?username=saved%40example.test&password=${PASSWORD}`], 'the newsletter form is never submitted');

    posted.length = 0;
    await page.goto('https://shop.example-supplier.test/square');
    assert.equal(await driver.fillSignIn({ username: 'owner@example.test', password: PASSWORD }), 'submitted');
    assert.deepEqual(posted, [`/done?ident=owner%40example.test&pw=${PASSWORD}`], 'the "username webauthn" box gets the username');
  } finally {
    await context.close();
  }
});

test.after(async () => {
  await browser?.close();
});
