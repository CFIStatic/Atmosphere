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

  assert.match(subject, /Job file on Atmosphere/);
  assert.match(subject, /Cedar Ridge/);
  assert.doesNotMatch(subject, /^Priya Shah at Ortiz Restoration/);
  assert.match(text, /There is a job file for you on Atmosphere/);
  assert.match(text, /From: Priya Shah at Ortiz Restoration/);
  assert.ok(text.includes('\n  https://platform.atmosphereteam.com/progress/tok123\n'));
  assert.match(text, /View progress/i);
  assert.match(text, /Save this job/i);
  assert.match(text, /email \+ password/i);
  assert.doesNotMatch(text, /Field Capture/i);
  assert.doesNotMatch(text, /no payment/i);
  assert.doesNotMatch(text, /Open in Field Capture/i);
  assert.doesNotMatch(text, /film the day/i);
  assert.doesNotMatch(text, /jettx\.ai/i);
  assert.match(html, /A job file on Atmosphere/);
  assert.match(html, /From Priya Shah at Ortiz Restoration/);
  assert.match(html, /View progress/);
  assert.match(html, /Save this job/);
  assert.match(html, /https:\/\/platform\.atmosphereteam\.com\/progress\/tok123/);
  assert.match(html, /intent=homeowner/);
  assert.doesNotMatch(html, /Field Capture/i);
  assert.doesNotMatch(html, /Create your login/);
  assert.doesNotMatch(html, /jettx\.ai/i);
});

test('progressShareEmail — path-only when no origin', () => {
  const { text } = progressShareEmail({
    orgName: 'Ortiz Restoration',
    path: '/progress/tok123',
  });
  assert.ok(text.includes('\n  /progress/tok123\n'));
});
