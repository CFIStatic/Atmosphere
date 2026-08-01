import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrgSchema, joinOrgSchema } from '../src/lib/validation.js';

// The create-organization and join-with-a-code flows share their contract with
// the frontend onboarding page (OnboardingPage.tsx) and the create_org /
// join_org database functions. These tests pin that contract down: if the
// accepted join-code shape or the required onboarding answers change, one of
// these fails before a customer does.

const answers = {
  role: 'project_manager',
  workType: 'mitigation',
  usageIntents: ['project_management', 'crm'],
} as const;

test('create: accepts a full payload and trims the organization name', () => {
  const parsed = createOrgSchema.parse({
    name: '  Acme Restoration  ',
    contractorType: 'restoration',
    ...answers,
  });
  assert.equal(parsed.name, 'Acme Restoration');
  assert.equal(parsed.contractorType, 'restoration');
  assert.deepEqual(parsed.usageIntents, ['project_management', 'crm']);
});

test('create: rejects a one-character organization name', () => {
  assert.throws(() =>
    createOrgSchema.parse({ name: 'A', contractorType: 'roofing', ...answers }),
  );
});

test('create: rejects an unknown contractor type', () => {
  assert.throws(() =>
    createOrgSchema.parse({ name: 'Acme', contractorType: 'landscaping', ...answers }),
  );
});

test('create: requires at least one usage intent', () => {
  assert.throws(() =>
    createOrgSchema.parse({
      name: 'Acme',
      contractorType: 'restoration',
      role: 'sales',
      workType: 'construction',
      usageIntents: [],
    }),
  );
});

test('join: accepts a code exactly as the dashboard displays it', () => {
  const parsed = joinOrgSchema.parse({ joinCode: '8F3A9C2B', ...answers });
  assert.equal(parsed.joinCode, '8F3A9C2B');
});

test('join: uppercases and trims a code typed by hand', () => {
  const parsed = joinOrgSchema.parse({ joinCode: '  8f3a9c2b ', ...answers });
  assert.equal(parsed.joinCode, '8F3A9C2B');
});

test('join: rejects codes outside the 6–12 alphanumeric shape', () => {
  for (const bad of ['ABC12', 'ABCDEF1234567', '8F3A-9C2B', '8F3A 9C2B', '']) {
    assert.throws(() => joinOrgSchema.parse({ joinCode: bad, ...answers }), bad || '(empty)');
  }
});

test('join: rejects a missing code with a clear message', () => {
  try {
    joinOrgSchema.parse({ ...answers });
    assert.fail('expected a validation error');
  } catch (err) {
    assert.match(JSON.stringify(err), /Join code is required/);
  }
});

test('both: reject an account type the app does not offer', () => {
  assert.throws(() =>
    joinOrgSchema.parse({ joinCode: '8F3A9C2B', ...answers, role: 'ceo' }),
  );
  assert.throws(() =>
    createOrgSchema.parse({ name: 'Acme', contractorType: 'other', ...answers, role: 'ceo' }),
  );
});

test('both: reject duplicate usage intents', () => {
  assert.throws(() =>
    joinOrgSchema.parse({
      joinCode: '8F3A9C2B',
      role: 'sales',
      workType: 'mitigation',
      usageIntents: ['crm', 'crm'],
    }),
  );
});
