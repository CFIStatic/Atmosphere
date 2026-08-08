import assert from 'node:assert/strict';
import test from 'node:test';
import { progressShareEmail } from '../src/verifier/progressShareEmail.js';

test('progressShareEmail — no account required, link on its own line', () => {
  const { subject, text } = progressShareEmail({
    orgName: 'Ortiz Restoration',
    sharerName: 'Priya Shah',
    jobTitle: 'Cedar Ridge — storm damage',
    origin: 'https://app.atmosphere.example',
    path: '/progress/tok123',
    expiresAt: '2026-10-01T00:00:00Z',
  });

  assert.match(subject, /job progress/i);
  assert.match(subject, /Cedar Ridge/);
  assert.ok(text.includes('\n  https://app.atmosphere.example/progress/tok123\n'));
  assert.match(text, /No account is required/i);
  assert.match(text, /expires on 2026-10-01/i);
});

test('progressShareEmail — path-only when no origin', () => {
  const { text } = progressShareEmail({
    orgName: 'Ortiz Restoration',
    path: '/progress/tok123',
  });
  assert.ok(text.includes('\n  /progress/tok123\n'));
});
