import assert from 'node:assert/strict';
import test from 'node:test';
import { progressShareEmail } from '../src/verifier/progressShareEmail.js';

test('progressShareEmail — job file and recordings, no account required', () => {
  const { subject, text, html } = progressShareEmail({
    orgName: 'Ortiz Restoration',
    sharerName: 'Priya Shah',
    jobTitle: 'Cedar Ridge — storm damage',
    origin: 'https://app.atmosphere.example',
    path: '/progress/tok123',
    expiresAt: '2026-10-01T00:00:00Z',
  });

  assert.match(subject, /job file/i);
  assert.match(subject, /Cedar Ridge/);
  assert.ok(text.includes('\n  https://app.atmosphere.example/progress/tok123\n'));
  assert.ok(text.includes('\n  https://app.atmosphere.example/progress/tok123?ask=1\n'));
  assert.match(text, /View the job file/i);
  assert.match(text, /Ask a question/i);
  assert.match(text, /No account is required/i);
  assert.match(text, /every recording/i);
  assert.match(text, /expire on 2026-10-01/i);
  assert.match(html, /View job file/);
  assert.match(html, /Ask this job/);
  assert.match(html, /https:\/\/app\.atmosphere\.example\/progress\/tok123"/);
  assert.match(html, /https:\/\/app\.atmosphere\.example\/progress\/tok123\?ask=1/);
  assert.match(html, /Atmosphere/);
});

test('progressShareEmail — path-only when no origin', () => {
  const { text } = progressShareEmail({
    orgName: 'Ortiz Restoration',
    path: '/progress/tok123',
  });
  assert.ok(text.includes('\n  /progress/tok123\n'));
  assert.ok(text.includes('\n  /progress/tok123?ask=1\n'));
});
