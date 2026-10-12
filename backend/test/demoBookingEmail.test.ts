import test from 'node:test';
import assert from 'node:assert/strict';
import { demoBookingSchema } from '../src/lib/demoBooking.js';
import {
  DEMO_EMAIL_LOGO_URL,
  demoGuestEmail,
  demoHostEmail,
  slotSubjectLabel,
} from '../src/lib/demoBookingEmail.js';

const start = new Date('2026-10-13T14:00:00.000Z'); // Tue Oct 13, 9:00 AM CT
const b = demoBookingSchema.parse({
  slotStart: start.toISOString(),
  name: 'Alpha Test',
  email: 'alpha@example.com',
  company: 'Alpha <Roofing> & Co',
  phone: '(555) 010-2000',
  notes: 'Three crews\n<script>x</script>',
  timeZone: 'America/New_York',
});

test('subject lines', () => {
  assert.equal(slotSubjectLabel(start), 'Tue Oct 13, 9:00 AM CT');
  assert.equal(
    demoHostEmail(b, start).subject,
    'New demo booked: Alpha Test, Tue Oct 13, 9:00 AM CT',
  );
  assert.equal(
    demoGuestEmail(b, start, 'Jack Cyganiak').subject,
    'Your Atmosphere demo is confirmed: Tue Oct 13, 10:00 AM EDT',
  );
  const ct = demoGuestEmail({ ...b, timeZone: 'America/Chicago' }, start, 'Jack').subject;
  assert.equal(ct, 'Your Atmosphere demo is confirmed: Tue Oct 13, 9:00 AM CT');
  const bogus = demoGuestEmail({ ...b, timeZone: 'Not/AZone' }, start, 'Jack').subject;
  assert.match(bogus, /9:00 AM CT$/);
});

test('host email: branded HTML with every detail, escaped, plus text', () => {
  const m = demoHostEmail(b, start);
  assert.ok(m.html.includes(DEMO_EMAIL_LOGO_URL));
  assert.match(DEMO_EMAIL_LOGO_URL, /^https:\/\/atmosphereteam\.com\//);
  assert.match(m.html, /prefers-color-scheme: dark/);
  assert.match(m.html, /Tuesday, October 13, 2026/);
  assert.match(m.html, /9:00 – 9:30 AM CT/);
  assert.match(m.html, /mailto:alpha@example.com/);
  assert.match(m.html, /Alpha &lt;Roofing&gt; &amp; Co/);
  assert.ok(!m.html.includes('<script>'));
  assert.match(m.html, /\(555\) 010-2000/);
  assert.match(m.html, /Three crews<br \/>&lt;script&gt;/);
  assert.match(m.html, /atmosphereteam\.com/);
  assert.match(m.text, /When: {5}Tuesday, October 13, 2026, 9:00 – 9:30 AM CT \(30 min\)/);
  assert.match(m.text, /Notes: {4}Three crews/);
});

test('guest email: their zone, calendar + reply lines, no host-only notes', () => {
  const m = demoGuestEmail(b, start, 'Jack Cyganiak');
  assert.match(m.html, /10:00 – 10:30 AM EDT/);
  assert.match(m.html, /Add it to your calendar/);
  assert.match(m.html, /reschedule or have a question/);
  assert.ok(!m.html.includes('Three crews'));
  assert.match(m.text, /atmosphere-demo\.ics/);
  assert.match(m.text, /reply to this email/i);
});
