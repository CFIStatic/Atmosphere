/**
 * Sign-in lab: the saved-password filler (PlaywrightDriver.fillSignIn) against
 * the sign-in page shapes real portals use, in a real Chromium. Each case is a
 * pattern that has broken naive fillers: slow single-page apps, forms inside
 * iframes, buttons outside any <form>, odd field names, shadow DOM, and a
 * wrong password that leaves the form on screen with an error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, BrowserContext } from 'playwright-core';
import { PlaywrightDriver } from '../src/computer/providers/playwrightDriver.js';
import { launchTestChromium } from './helpers/chromium.js';

const browser: Browser | null = await launchTestChromium();
const skip = browser ? false : 'no local Chromium';
const PASSWORD = 'PW-SECRET-zq9-Atmosphere-LAB-5521';
const USER = 'lab.user@example.test';

test.after(async () => {
  await browser?.close();
});

type Pages = Record<string, string>;

/** Serve fixed pages per host; record every POST body. */
async function lab(pages: Record<string, Pages>) {
  const context: BrowserContext = await browser!.newContext({ viewport: { width: 1280, height: 800 } });
  const posted: string[] = [];
  for (const [host, byPath] of Object.entries(pages)) {
    await context.route(`https://${host}/**`, async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (req.method() === 'POST') posted.push(`${host}${path}?${req.postData() ?? ''}`);
      const body = byPath[path] ?? '<h1>Dashboard</h1><p>Welcome back</p>';
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body>${body}</body></html>` });
    });
  }
  const page = await context.newPage();
  const driver = new PlaywrightDriver(browser!, context, page, { width: 1280, height: 800 });
  return { context, page, driver, posted };
}

test('slow single-page-app sign-in: the filler waits for the app instead of reporting the form still there', { skip }, async () => {
  const { context, page, driver } = await lab({
    'app.example-spa.test': {
      '/login': `<form id="f"><input type="email" name="email"><input type="password" name="password"><button type="submit">Sign in</button></form>
        <script>document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); setTimeout(() => { history.pushState({}, '', '/home'); document.body.innerHTML = '<h1>Dashboard</h1>'; }, 3000); });</script>`,
    },
  });
  try {
    await page.goto('https://app.example-spa.test/login');
    assert.equal(await driver.fillSignIn({ username: USER, password: PASSWORD }), 'submitted');
    const signals = await driver.pageSignals();
    assert.equal(signals.hasPasswordField, false, 'checked after the app finished signing in');
    assert.equal(new URL(page.url()).pathname, '/home');
  } finally {
    await context.close();
  }
});

test('sign-in form inside an iframe (embedded identity widget)', { skip }, async () => {
  const { context, page, driver, posted } = await lab({
    'portal.example-carrier.test': {
      '/login': '<h1>Carrier portal</h1><iframe src="https://login.example-carrier.test/widget" style="width:600px;height:400px;border:0"></iframe>',
    },
    'login.example-carrier.test': {
      '/widget': '<form method="post" action="/session" target="_top"><input name="username"><input type="password" name="password"><button type="submit">Log in</button></form>',
    },
  });
  try {
    await page.goto('https://portal.example-carrier.test/login');
    const res = await driver.fillSignIn(
      { username: USER, password: PASSWORD },
      { allowHost: (h) => h.endsWith('example-carrier.test') },
    );
    assert.equal(res, 'submitted');
    assert.deepEqual(posted, [`login.example-carrier.test/session?username=lab.user%40example.test&password=${PASSWORD}`]);
  } finally {
    await context.close();
  }
});

test('an iframe on another site never gets the password', { skip }, async () => {
  const { context, page, driver, posted } = await lab({
    'portal.example-carrier.test': {
      '/login': '<iframe src="https://evil.example-phish.test/widget" style="width:600px;height:400px;border:0"></iframe>',
    },
    'evil.example-phish.test': {
      '/widget': '<form method="post" action="/steal"><input name="username"><input type="password" name="password"><button type="submit">Log in</button></form>',
    },
  });
  try {
    await page.goto('https://portal.example-carrier.test/login');
    const res = await driver.fillSignIn(
      { username: USER, password: PASSWORD },
      { allowHost: (h) => h.endsWith('example-carrier.test') },
    );
    assert.equal(res, 'other_site');
    assert.deepEqual(posted, []);
    const typed = await page.frames()[1]?.locator('input[type=password]').inputValue().catch(() => '');
    assert.equal(typed, '', 'nothing typed into the other site');
  } finally {
    await context.close();
  }
});

test('sign-in button outside any <form>, wired up in script', { skip }, async () => {
  const { context, page, driver } = await lab({
    'app.example-noform.test': {
      '/login': `<div><label>Email <input id="u"></label><label>Password <input id="p" type="password"></label>
        <div role="button" tabindex="0" id="go">Sign in</div></div>
        <script>document.getElementById('go').addEventListener('click', () => {
          if (document.getElementById('u').value && document.getElementById('p').value) location.href = '/home';
        });</script>`,
    },
  });
  try {
    await page.goto('https://app.example-noform.test/login');
    assert.equal(await driver.fillSignIn({ username: USER, password: PASSWORD }), 'submitted');
    assert.equal(new URL(page.url()).pathname, '/home');
  } finally {
    await context.close();
  }
});

test('username box with an unhelpful name is found next to the password box', { skip }, async () => {
  const { context, page, driver, posted } = await lab({
    'portal.example-legacy.test': {
      '/login': '<form method="post" action="/auth"><input type="text" name="acct"><input type="password" name="pw"><input type="submit" value="Enter"></form>',
    },
  });
  try {
    await page.goto('https://portal.example-legacy.test/login');
    assert.equal(await driver.fillSignIn({ username: 'J12345', password: PASSWORD }), 'submitted');
    assert.deepEqual(posted, [`portal.example-legacy.test/auth?acct=J12345&pw=${PASSWORD}`]);
  } finally {
    await context.close();
  }
});

test('sign-in fields inside an open shadow root (web-component portals)', { skip }, async () => {
  const { context, page, driver } = await lab({
    'portal.example-lightning.test': {
      '/login': `<x-login></x-login><script>
        customElements.define('x-login', class extends HTMLElement { connectedCallback() {
          const r = this.attachShadow({ mode: 'open' });
          r.innerHTML = '<input id="u" autocomplete="username"><input id="p" type="password"><button id="b">Log In</button>';
          r.getElementById('b').addEventListener('click', () => {
            if (r.getElementById('u').value && r.getElementById('p').value) location.href = '/home';
          });
        } });</script>`,
    },
  });
  try {
    await page.goto('https://portal.example-lightning.test/login');
    assert.equal(await driver.fillSignIn({ username: USER, password: PASSWORD }), 'submitted');
    assert.equal(new URL(page.url()).pathname, '/home');
  } finally {
    await context.close();
  }
});

test('a wrong password leaves the form with an error, and the signals say so', { skip }, async () => {
  const { context, page, driver } = await lab({
    'portal.example-wrong.test': {
      '/login': '<form method="post" action="/login2"><input name="username"><input type="password" name="password"><button type="submit">Sign in</button></form>',
      '/login2': '<div role="alert">Incorrect username or password.</div><form method="post" action="/login2"><input name="username"><input type="password" name="password"><button type="submit">Sign in</button></form>',
    },
  });
  try {
    await page.goto('https://portal.example-wrong.test/login');
    assert.equal(await driver.fillSignIn({ username: USER, password: 'not-it' }), 'submitted');
    const signals = await driver.pageSignals();
    assert.equal(signals.hasPasswordField, true);
    assert.match(signals.signInError ?? '', /incorrect username or password/i);
  } finally {
    await context.close();
  }
});
