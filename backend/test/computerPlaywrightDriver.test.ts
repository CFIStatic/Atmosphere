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

test.after(async () => {
  await browser?.close();
});
