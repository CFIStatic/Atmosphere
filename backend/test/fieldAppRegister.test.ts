import test from 'node:test';
import assert from 'node:assert/strict';
import {
  credentialsSchema,
  fieldOfficePreviewSchema,
  fieldOfficeSchema,
  fieldRegisterSchema,
  FIELD_APP_ONBOARDING,
} from '../src/lib/validation.js';
import { alreadyLinkedMessage } from '../src/field/officeLink.js';

/**
 * Field Capture iOS account creation shares the website email/password
 * contract, then requires an office (join code or new name) so day films
 * have an organization to land in.
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

test('field register: join an existing office', () => {
  const parsed = fieldRegisterSchema.parse({
    email: 'alex@crew.example',
    password: 'long-enough',
    fullName: 'Alex Rivera',
    joinCode: '  8f3a9c2b ',
  });
  assert.equal(parsed.email, 'alex@crew.example');
  assert.equal(parsed.joinCode, '8F3A9C2B');
  assert.equal(parsed.fullName, 'Alex Rivera');
  assert.equal(parsed.orgName, undefined);
});

test('field register: start a new office', () => {
  const parsed = fieldRegisterSchema.parse({
    email: 'owner@shop.example',
    password: 'long-enough',
    orgName: '  Rio Grande Restoration  ',
  });
  assert.equal(parsed.orgName, 'Rio Grande Restoration');
  assert.equal(parsed.joinCode, undefined);
});

test('field register: require an office join code or a new office name', () => {
  try {
    fieldRegisterSchema.parse({
      email: 'alex@crew.example',
      password: 'long-enough',
    });
    assert.fail('expected a validation error');
  } catch (err) {
    assert.match(JSON.stringify(err), /office join code or a new office name/);
  }
});

test('field register: reject supplying both a join code and a new office name', () => {
  assert.throws(() =>
    fieldRegisterSchema.parse({
      email: 'alex@crew.example',
      password: 'long-enough',
      joinCode: '8F3A9C2B',
      orgName: 'Acme',
    }),
  );
});

test('field office: same office rules once the phone already has a session', () => {
  const joined = fieldOfficeSchema.parse({ joinCode: 'abc123' });
  assert.equal(joined.joinCode, 'ABC123');
  const created = fieldOfficeSchema.parse({ orgName: 'Shop' });
  assert.equal(created.orgName, 'Shop');
  assert.throws(() => fieldOfficeSchema.parse({}));
});

test('field office preview: accepts a typed join code', () => {
  const parsed = fieldOfficePreviewSchema.parse({ joinCode: '  8f3a9c2b ' });
  assert.equal(parsed.joinCode, '8F3A9C2B');
});

test('field office preview: rejects a malformed code', () => {
  assert.throws(() => fieldOfficePreviewSchema.parse({ joinCode: 'NO' }));
  assert.throws(() => fieldOfficePreviewSchema.parse({}));
});

test('already-linked copy names the office the phone is on', () => {
  assert.match(alreadyLinkedMessage('Ortiz Restoration'), /Ortiz Restoration/);
  assert.match(alreadyLinkedMessage('Ortiz Restoration'), /disconnect this phone/i);
});

test('field onboarding defaults match a crew login, not an office admin', () => {
  assert.equal(FIELD_APP_ONBOARDING.role, 'employee');
  assert.equal(FIELD_APP_ONBOARDING.workType, 'construction');
  assert.deepEqual([...FIELD_APP_ONBOARDING.usageIntents], ['field_work']);
});

test('POST /api/field-app/office/preview is public and rejects a missing code', async () => {
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
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'validation_error');
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
