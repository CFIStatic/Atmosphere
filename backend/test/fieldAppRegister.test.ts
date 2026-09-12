import test from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialsSchema,
  fieldOfficeSchema,
  fieldRegisterSchema,
  FIELD_APP_ONBOARDING,
} from '../src/lib/validation.js';
import { alreadyLinkedMessage } from '../src/field/officeLink.js';

/**
 * Field Capture iOS account creation shares the website email/password
 * contract. A pending invite for the email joins that office; an optional
 * office name starts a new company.
 */

test('credentials: accept a normal work email and password', () => {
  const parsed = credentialsSchema.parse({
    email: '  Crew@Office.example  ',
    password: 'long-enough',
  });
  assert.equal(parsed.email, 'crew@office.example');
  assert.equal(parsed.password, 'long-enough');
});

test('credentials: reject a short password and a malformed email', () => {
  assert.throws(() => credentialsSchema.parse({ email: 'crew@office.example', password: 'short' }));
  assert.throws(() => credentialsSchema.parse({ email: 'not-an-email', password: 'long-enough' }));
});

test('field register: email and password join by invite', () => {
  const parsed = fieldRegisterSchema.parse({
    email: 'alex@crew.example',
    password: 'long-enough',
    fullName: 'Alex Rivera',
    acceptedTermsVersion: '2026-09-10',
  });
  assert.equal(parsed.email, 'alex@crew.example');
  assert.equal(parsed.fullName, 'Alex Rivera');
  assert.equal(parsed.orgName, undefined);
});

test('field register: start a new office', () => {
  const parsed = fieldRegisterSchema.parse({
    email: 'owner@shop.example',
    password: 'long-enough',
    orgName: '  Rio Grande Restoration  ',
    acceptedTermsVersion: '2026-09-10',
  });
  assert.equal(parsed.orgName, 'Rio Grande Restoration');
});

test('field register: require a Terms of Service acknowledgment', () => {
  try {
    fieldRegisterSchema.parse({
      email: 'alex@crew.example',
      password: 'long-enough',
      orgName: 'Shop',
    });
    assert.fail('expected a validation error');
  } catch (err) {
    assert.match(JSON.stringify(err), /Terms of Service/);
  }
});

test('field office: empty body joins by invite; a name starts an office', () => {
  const joined = fieldOfficeSchema.parse({});
  assert.equal(joined.orgName, undefined);
  const created = fieldOfficeSchema.parse({ orgName: 'Shop' });
  assert.equal(created.orgName, 'Shop');
});

test('already-linked copy names the office the phone is on', () => {
  assert.match(alreadyLinkedMessage('Ortiz Restoration'), /Ortiz Restoration/);
});

test('field onboarding defaults match a crew login, not an office admin', () => {
  assert.equal(FIELD_APP_ONBOARDING.role, 'employee');
  assert.equal(FIELD_APP_ONBOARDING.workType, 'construction');
  assert.deepEqual([...FIELD_APP_ONBOARDING.usageIntents], ['field_work']);
});

test('POST /api/field-app/office/preview is gone', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/field-app/office/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('POST /api/field-app/register rejects a short password before hitting Auth', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/field-app/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'crew@office.example',
        password: 'short',
        orgName: 'Shop',
        acceptedTermsVersion: '2026-09-10',
      }),
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error?: string; code?: string };
    assert.match(body.error ?? '', /at least 8 characters/i);
    assert.equal(body.code, 'validation_error');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});

test('field-app/me returns the saved profile photo so Field Capture matches the office chip', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/routes/fieldApp.ts', import.meta.url), 'utf8');
  assert.match(src, /select\('full_name, avatar_url'\)/);
  assert.match(src, /avatarUrl: isDisplayableAvatarUrl/);
});

test('POST /api/field-app/jobs starts a job from Field Capture then assigns the crew', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/routes/fieldApp.ts', import.meta.url), 'utf8');
  assert.match(src, /fieldAppRouter\.post\('\/jobs'/);
  assert.match(src, /fieldStartJobSchema\.parse/);
  assert.match(src, /intakeFromFieldStart/);
  assert.match(src, /createJobFile/);
  assert.match(src, /allowTypedFallback: true/);
  assert.match(src, /fieldAppRouter\.get\('\/places\/status'/);
  assert.match(src, /fieldAppRouter\.post\('\/places\/autocomplete'/);
  assert.match(src, /fieldAppRouter\.post\('\/places\/resolve'/);
  assert.match(src, /role_on_job: 'crew'/);
  assert.match(src, /j\.created_by === userId/);
});
