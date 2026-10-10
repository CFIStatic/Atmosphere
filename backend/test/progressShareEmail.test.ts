import assert from 'node:assert/strict';
import test from 'node:test';
import { progressShareEmail } from '../src/verifier/progressShareEmail.js';

test('progressShareEmail — homeowner view progress, not Field Capture', () => {
  const { subject, text, html, fromName } = progressShareEmail({
    orgName: 'Ortiz Restoration',
    sharerName: 'Priya Shah',
    jobTitle: 'Cedar Ridge — storm damage',
    recipientEmail: 'home@example.com',
    origin: 'https://platform.atmosphereteam.com',
    path: '/progress/tok123',
    expiresAt: '2026-10-01T00:00:00Z',
  });

  assert.equal(subject, 'Ortiz Restoration shared the job file for Cedar Ridge — storm damage');
  assert.equal(fromName, 'Ortiz Restoration via Atmosphere');
  assert.match(
    text,
    /Priya Shah at Ortiz Restoration shared the job file for Cedar Ridge — storm damage with you on Atmosphere/,
  );
  assert.match(text, /because Ortiz Restoration added home@example\.com to this job/);
  assert.match(text, /Contact Ortiz Restoration directly/);
  assert.ok(text.includes('\n  https://platform.atmosphereteam.com/progress/tok123\n'));
  assert.match(text, /View progress/i);
  assert.match(text, /Save this job/i);
  assert.match(text, /email \+ password/i);
  assert.doesNotMatch(text, /Field Capture/i);
  assert.doesNotMatch(text, /no payment/i);
  assert.doesNotMatch(text, /Open in Field Capture/i);
  assert.doesNotMatch(text, /film the day/i);
  assert.doesNotMatch(text, /jettx\.ai/i);
  assert.match(html, /Job file for Cedar Ridge/);
  assert.match(html, /Priya Shah at Ortiz Restoration shared the job file/);
  assert.match(html, /If you were not expecting it, you can ignore it/);
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

test('progressShareEmail — escapes org and job in HTML', () => {
  const { html, subject } = progressShareEmail({
    orgName: '<b>Acme</b>',
    jobTitle: 'Unit "4" & co',
    path: '/progress/tok123',
  });
  assert.doesNotMatch(html, /<b>Acme<\/b>/);
  assert.match(html, /&lt;b&gt;Acme&lt;\/b&gt;/);
  assert.match(html, /Unit &quot;4&quot; &amp; co/);
  assert.match(subject, /shared the job file for Unit "4" & co/);
});
