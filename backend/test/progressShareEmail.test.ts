import assert from 'node:assert/strict';
import test from 'node:test';
import { progressShareEmail } from '../src/verifier/progressShareEmail.js';

test('progressShareEmail — homeowner view progress, not Field Capture', () => {
  const { subject, text, html } = progressShareEmail({
    orgName: 'Ortiz Restoration',
    sharerName: 'Priya Shah',
    jobTitle: 'Cedar Ridge — storm damage',
    recipientEmail: 'home@example.com',
    origin: 'https://platform.atmosphereteam.com',
    path: '/progress/tok123',
    expiresAt: '2026-10-01T00:00:00Z',
  });

  assert.match(subject, /job file/i);
  assert.match(subject, /view progress/i);
  assert.match(subject, /Cedar Ridge/);
  assert.ok(text.includes('\n  https://platform.atmosphereteam.com/progress/tok123\n'));
  assert.match(text, /View job progress/i);
  assert.match(text, /email and password/i);
  assert.match(text, /no payment/i);
  assert.match(text, /atmosphereteam\.com/i);
  assert.match(text, /no Field Capture seat/i);
  assert.doesNotMatch(text, /Open in Field Capture/i);
  assert.doesNotMatch(text, /film the day/i);
  assert.doesNotMatch(text, /invited you to capture/i);
  assert.doesNotMatch(text, /jettx\.ai/i);
  assert.doesNotMatch(text, /No account is required/i);
  assert.match(html, /View job progress/);
  assert.match(html, /Create your login/);
  assert.match(html, /https:\/\/platform\.atmosphereteam\.com\/progress\/tok123/);
  assert.match(html, /intent=homeowner/);
  assert.doesNotMatch(html, /Open in Field Capture/i);
  assert.doesNotMatch(html, /film the day/i);
  assert.doesNotMatch(html, /jettx\.ai/i);
});

test('progressShareEmail — path-only when no origin', () => {
  const { text } = progressShareEmail({
    orgName: 'Ortiz Restoration',
    path: '/progress/tok123',
  });
  assert.ok(text.includes('\n  /progress/tok123\n'));
});
