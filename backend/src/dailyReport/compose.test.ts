import assert from 'node:assert/strict';
import test from 'node:test';
import { composeClipGlance, composeDailyGlance } from './compose.js';
import { dailyJobReportEmail } from './email.js';
import { isPastSendHour, defaultDailyReportSettings } from './settings.js';
import { PRIVACY_REDACTED_LABEL } from '../audio/privacyRedactions.js';

test('composeClipGlance builds glance points from conversation', () => {
  const clip = composeClipGlance({
    id: 'p1',
    work_date: '2026-09-14',
    phase: 'afternoon',
    title: 'North slope tear-off',
    ai_findings: {
      conversation: {
        executiveSummary: 'Crew agreed to finish the north slope before rain.',
        keyMoments: [{ text: 'Agreed to tarp overnight' }],
        refusals: [{ text: 'Homeowner refused interior demo today' }],
        actionItems: [{ text: 'Order ice-and-water shield', owner: 'PM' }],
      },
      peoplePresent: { peoplePresent: [{ displayName: 'Alex', role: 'crew' }] },
    },
  });
  assert.equal(clip.title, 'North slope tear-off');
  assert.match(clip.headline ?? '', /north slope/i);
  assert.ok(clip.points.some((p) => /tarp/i.test(p)));
  assert.ok(clip.points.some((p) => /refused/i.test(p)));
  assert.deepEqual(clip.people, ['Alex']);
  assert.equal(clip.privacyProtected, false);
});

test('composeClipGlance redacts private moment text', () => {
  const clip = composeClipGlance({
    id: 'p2',
    work_date: '2026-09-14',
    ai_summary: 'Worker walked into the bathroom while recording',
    ai_findings: {
      privacyRedactions: {
        version: 1,
        ranges: [{ startSec: 10, endSec: 40, reason: 'bathroom', confidence: 0.9, source: 'vision' }],
      },
      conversation: {
        summary: 'Discussion in the bathroom about fixtures',
        keyMoments: [{ text: 'Standing in the bathroom stall' }],
      },
    },
  });
  assert.equal(clip.privacyProtected, true);
  assert.equal(clip.headline, PRIVACY_REDACTED_LABEL);
  assert.ok(clip.points.every((p) => p === PRIVACY_REDACTED_LABEL || !/bathroom/i.test(p)));
});

test('composeDailyGlance overview joins headlines', () => {
  const report = composeDailyGlance({
    orgId: 'o1',
    jobId: 'j1',
    jobTitle: 'Cedar Ridge',
    orgName: 'Ortiz',
    localDay: '2026-09-14',
    timezone: 'America/Chicago',
    proofs: [
      {
        id: 'a',
        work_date: '2026-09-14',
        ai_findings: { conversation: { summary: 'Hung drywall in master.' } },
      },
      {
        id: 'b',
        work_date: '2026-09-14',
        ai_findings: { conversation: { summary: 'Paint touch-ups upstairs.' } },
      },
    ],
  });
  assert.equal(report.clips.length, 2);
  assert.match(report.overview, /drywall/i);
  assert.match(report.overview, /Paint/i);

  const mail = dailyJobReportEmail({
    report,
    origin: 'https://platform.atmosphereteam.com',
  });
  assert.match(mail.subject, /Cedar Ridge/);
  assert.match(mail.text, /Glance/i);
  assert.match(mail.html, /Open job file/);
  assert.doesNotMatch(mail.html, /bathroom/i);
});

test('settings defaults are opt-in off', () => {
  const s = defaultDailyReportSettings('org');
  assert.equal(s.enabled, false);
  assert.equal(s.channel, 'email');
  assert.equal(s.sendHour, 18);
});

test('isPastSendHour respects timezone', () => {
  // 2026-09-14 23:30 UTC = 18:30 America/New_York (EDT UTC-4)
  const evening = new Date('2026-09-14T22:30:00.000Z');
  assert.equal(isPastSendHour(evening, 'America/New_York', 18), true);
  const morning = new Date('2026-09-14T12:00:00.000Z'); // 08:00 EDT
  assert.equal(isPastSendHour(morning, 'America/New_York', 18), false);
});
