/**
 * Form lab: PlaywrightDriver.setField against the controls real claim and
 * order forms use, in a real Chromium. Every value is read back, so a field
 * that silently rejected or reformatted the value is reported, not assumed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright-core';
import { PlaywrightDriver } from '../src/computer/providers/playwrightDriver.js';
import { fieldMatches, toChecked, toIsoDate } from '../src/computer/fieldValues.js';
import { launchTestChromium } from './helpers/chromium.js';

const browser: Browser | null = await launchTestChromium();
const skip = browser ? false : 'no local Chromium';

test.after(async () => {
  await browser?.close();
});

const FORM = `<!doctype html><html><body style="margin:0;font:15px sans-serif">
<style>.row{position:absolute;left:20px} input,select,textarea{position:absolute;left:220px;width:300px;height:28px}</style>
<div class="row" style="top:10px"><label for="name">Insured name</label></div><input id="name" style="top:10px">
<div class="row" style="top:50px"><label for="state">State</label></div>
<select id="state" style="top:50px"><option value="">Choose…</option><option value="TX">Texas</option><option value="OK">Oklahoma</option><option value="LA">Louisiana</option></select>
<div class="row" style="top:90px"><label for="loss">Date of loss</label></div><input id="loss" type="date" style="top:90px">
<div class="row" style="top:130px"><label for="phone">Phone</label></div><input id="phone" style="top:130px">
<label class="row" style="top:170px"><input id="roof" type="checkbox" style="position:static;width:auto;height:auto"> Roof damage</label>
<label class="row" style="top:210px"><input name="kind" value="wind" type="radio" style="position:static;width:auto;height:auto"> Wind</label>
<label class="row" style="top:250px"><input name="kind" value="hail" type="radio" style="position:static;width:auto;height:auto"> Hail</label>
<div class="row" style="top:290px"><label for="adj">Adjuster</label></div><input id="adj" role="combobox" aria-autocomplete="list" style="top:290px">
<ul id="list" role="listbox" style="position:absolute;left:220px;top:322px;margin:0;padding:0;list-style:none;background:#fff"></ul>
<div class="row" style="top:400px"><label for="notes">Notes</label></div><textarea id="notes" style="top:400px;height:60px"></textarea>
<div class="row" style="top:480px"><label for="locked">Policy number</label></div><input id="locked" disabled value="P-1" style="top:480px">
<x-field style="position:absolute;left:220px;top:520px"></x-field>
<script>
  const phone = document.getElementById('phone');
  phone.addEventListener('input', () => {
    const d = phone.value.replace(/\\D/g, '').slice(0, 10);
    phone.value = d.length === 10 ? '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6) : d;
  });
  const adj = document.getElementById('adj'), list = document.getElementById('list');
  const people = ['Dana Whitfield', 'Dan Ortiz', 'Marcus Lee'];
  adj.addEventListener('input', () => {
    list.innerHTML = '';
    for (const p of people.filter((x) => adj.value && x.toLowerCase().startsWith(adj.value.toLowerCase().slice(0, 3)))) {
      const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = p; li.style.padding = '4px';
      li.addEventListener('click', () => { adj.value = p; list.innerHTML = ''; });
      list.appendChild(li);
    }
  });
  customElements.define('x-field', class extends HTMLElement { connectedCallback() {
    this.attachShadow({ mode: 'open' }).innerHTML = '<input id="inner" aria-label="Contractor" style="width:300px;height:28px">';
  } });
</script></body></html>`;

test('setField fills text, dropdown, date, masked phone, checkbox, radio, autocomplete, textarea and shadow DOM; reads each back', { skip }, async () => {
  const context = await browser!.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.setContent(FORM);
  const driver = new PlaywrightDriver(browser!, context, page, { width: 1280, height: 800 });
  try {
    const at = (y: number, x = 300) => [x, y] as const;
    const set = (pt: readonly [number, number], v: string) => driver.setField(pt[0], pt[1], v);

    assert.deepEqual(await set(at(24), 'Jane Testcase'), { kind: 'text', ok: true, actual: 'Jane Testcase' });
    // Clicking the label works too, and a field is replaced, not appended to.
    assert.equal((await set([40, 24], 'Jane Q. Testcase')).actual, 'Jane Q. Testcase');

    const state = await set(at(64), 'TX');
    assert.equal(state.ok, true);
    assert.equal(state.actual, 'Texas', 'picked by value when the label differs');
    assert.equal((await set(at(64), 'oklahoma')).actual, 'Oklahoma', 'case-insensitive label');
    const bad = await set(at(64), 'Ohio');
    assert.equal(bad.ok, false);
    assert.match(bad.note ?? '', /no option named/);

    const loss = await set(at(104), '10/03/2026');
    assert.equal(loss.ok, true);
    assert.equal(await page.locator('#loss').inputValue(), '2026-10-03');

    const phone = await set(at(144), '555-123-4567');
    assert.equal(phone.ok, true, 'a mask that reformats still counts as the same number');
    assert.equal(phone.actual, '(555) 123-4567');

    assert.equal((await set([30, 182], 'checked')).ok, true);
    assert.equal(await page.locator('#roof').isChecked(), true);
    assert.equal((await set([30, 182], 'checked')).actual, 'checked', 'already checked stays checked');
    assert.equal((await set([30, 182], 'no')).actual, 'unchecked');

    assert.equal((await set([30, 262], 'yes')).ok, true);
    assert.equal(await page.locator('input[value=hail]').isChecked(), true);

    const adj = await set(at(304), 'Dana Whitfield');
    assert.equal(adj.kind, 'combobox');
    assert.equal(adj.ok, true);
    assert.equal(await page.locator('#list li').count(), 0, 'the suggestion was picked, so the list closed');

    assert.equal((await set(at(430), 'Line one\nLine two')).ok, true);

    const locked = await set(at(494), 'P-2');
    assert.equal(locked.ok, false, 'a disabled field is reported, not assumed');
    assert.equal(await page.locator('#locked').inputValue(), 'P-1');

    assert.equal((await set(at(534), 'Acme Roofing')).ok, true, 'shadow DOM input');

    assert.equal((await driver.setField(900, 700, 'x')).kind, 'none');
  } finally {
    await context.close();
  }
});

test('fieldMatches allows site reformatting but not different values', () => {
  assert.equal(fieldMatches('555-123-4567', '(555) 123-4567'), true);
  assert.equal(fieldMatches('555-123-4567', '(555) 123-4568'), false);
  assert.equal(fieldMatches('10/3/2026', '2026-10-03'), true);
  assert.equal(fieldMatches('Oct 3, 2026', '10/03/2026'), true);
  assert.equal(fieldMatches('1250', '1,250.00'), true);
  assert.equal(fieldMatches('CLM-0042', 'clm 0042'), true);
  assert.equal(fieldMatches('Jane Doe', 'Jane Doe Jr'), false);
  assert.equal(fieldMatches('checked', 'checked', 'checkbox'), true);
  assert.equal(fieldMatches('yes', 'unchecked', 'checkbox'), false);
  assert.equal(fieldMatches('x', null), false);
  assert.equal(toIsoDate('02/30/2026'), null);
  assert.equal(toIsoDate('2026-1-5'), '2026-01-05');
  assert.equal(toChecked('maybe'), null);
});
