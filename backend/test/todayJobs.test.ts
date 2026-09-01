import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTodayAt,
  pickInviteToken,
  pickTodayJobs,
  sortJobsForOpen,
  todayJobLocation,
  todayKey,
  type TodayJobInput,
} from '../src/field/todayJobs.js';

const TZ = 'America/New_York';
const DAY = '2026-08-12';

const job = (over: Partial<TodayJobInput> & Pick<TodayJobInput, 'id'>): TodayJobInput => ({
  jobNumber: 100,
  title: over.id,
  status: 'scheduled',
  scheduledStart: null,
  propertyId: null,
  ...over,
});

test('todayKey is the calendar day in the org timezone, not UTC', () => {
  // 1am UTC on the 13th is still the 12th in Eastern.
  assert.equal(todayKey(new Date('2026-08-13T01:00:00Z'), TZ), '2026-08-12');
  assert.equal(todayKey(new Date('2026-08-12T16:00:00Z'), TZ), '2026-08-12');
});

test('the job already filmed today is on the list even after it is completed', () => {
  const picked = pickTodayJobs(
    [
      job({
        id: 'done',
        title: 'Cedar Ridge',
        status: 'completed',
        scheduledStart: '2026-08-11T13:00:00Z',
      }),
      job({
        id: 'other',
        title: 'Tomorrow',
        status: 'scheduled',
        scheduledStart: '2026-08-14T13:00:00Z',
      }),
    ],
    ['done'],
    DAY,
    TZ,
  );
  assert.deepEqual(
    picked.map((j) => j.id),
    ['done', 'other'],
  );
  assert.equal(picked[0].filmed, true);
  assert.equal(picked[0].reason, 'filmed');
});

test('open jobs stay on the list even when another job has a start time today', () => {
  const picked = pickTodayJobs(
    [
      job({
        id: 'later',
        title: 'Next week',
        status: 'scheduled',
        scheduledStart: '2026-08-20T13:00:00Z',
      }),
      job({
        id: 'today',
        title: 'Meridian Ave',
        status: 'scheduled',
        scheduledStart: '2026-08-12T13:00:00Z',
      }),
      job({
        id: 'unscheduled',
        title: 'No date yet',
        status: 'draft',
        scheduledStart: null,
      }),
    ],
    [],
    DAY,
    TZ,
  );
  assert.deepEqual(
    picked.map((j) => j.id),
    ['today', 'later', 'unscheduled'],
  );
  assert.ok(picked.every((j) => j.reason === 'open'));
});

test('an in-progress job counts as today even with no start time', () => {
  const picked = pickTodayJobs(
    [job({ id: 'live', title: 'On site', status: 'in_progress' })],
    [],
    DAY,
    TZ,
  );
  assert.equal(picked[0].id, 'live');
  assert.equal(picked[0].reason, 'in_progress');
});

test('cancelled work stays off the list unless it was filmed today', () => {
  const hidden = pickTodayJobs(
    [job({ id: 'gone', status: 'cancelled', scheduledStart: '2026-08-12T13:00:00Z' })],
    [],
    DAY,
    TZ,
  );
  assert.deepEqual(hidden, []);

  const filmed = pickTodayJobs(
    [job({ id: 'gone', status: 'cancelled' })],
    ['gone'],
    DAY,
    TZ,
  );
  assert.equal(filmed[0].id, 'gone');
  assert.equal(filmed[0].reason, 'filmed');
});

test('open jobs are offered so filming can start without a start date', () => {
  const picked = pickTodayJobs(
    [
      job({ id: 'open', title: 'Unscheduled', status: 'draft' }),
      job({ id: 'done', title: 'Finished last week', status: 'completed' }),
    ],
    [],
    DAY,
    TZ,
  );
  assert.deepEqual(
    picked.map((j) => j.id),
    ['open'],
  );
  assert.equal(picked[0].reason, 'open');
});

test('filmed today sorts ahead of other open work', () => {
  const picked = pickTodayJobs(
    [
      job({
        id: 'afternoon',
        title: 'Afternoon',
        scheduledStart: '2026-08-12T18:00:00Z',
      }),
      job({
        id: 'morning',
        title: 'Morning',
        scheduledStart: '2026-08-12T12:00:00Z',
      }),
    ],
    ['afternoon'],
    DAY,
    TZ,
  );
  assert.deepEqual(
    picked.map((j) => j.id),
    ['afternoon', 'morning'],
  );
});

test('formatTodayAt says Filmed once the day film is on file', () => {
  assert.equal(formatTodayAt('2026-08-12T13:00:00Z', true, TZ), 'Filmed');
  assert.equal(formatTodayAt(null, false, TZ), '');
  assert.match(formatTodayAt('2026-08-12T13:00:00Z', false, TZ), /\d/);
});

test('todayJobLocation does not invent an address or treat a nameless site as unplaced', () => {
  assert.deepEqual(todayJobLocation(null, undefined, false), { address: '', placed: true });
  assert.deepEqual(todayJobLocation(null, undefined, true), { address: '', placed: true });
  assert.deepEqual(todayJobLocation('prop-1', '412 Meridian Ave', false), {
    address: '412 Meridian Ave',
    placed: true,
  });
  assert.deepEqual(todayJobLocation('prop-1', undefined, false), { address: '', placed: false });
  assert.deepEqual(todayJobLocation('prop-1', undefined, true), { address: '', placed: true });
});

test('the dashboard puts the job worked today above older folders', () => {
  const sorted = sortJobsForOpen(
    [
      { jobId: 'old', createdAt: '2026-08-10T10:00:00Z' },
      { jobId: 'today', createdAt: '2026-08-01T10:00:00Z' },
      { jobId: 'empty', createdAt: '2026-08-11T10:00:00Z' },
    ],
    new Map([
      ['old', '2026-08-10'],
      ['today', '2026-08-12'],
    ]),
    DAY,
  );
  assert.deepEqual(
    sorted.map((j) => j.jobId),
    ['today', 'old', 'empty'],
  );
});

test('pickInviteToken uses the email invite for that job, not another crew', () => {
  const parties = [
    { jobId: 'job-3', email: 'other@example.com', accessToken: 'someone-else' },
    { jobId: 'job-3', email: 'jack@jettx.ai', accessToken: 'ce731b712f8eaf218161c24baa03c0731ad11ea93b15cb0b' },
    { jobId: 'job-9', email: 'jack@jettx.ai', accessToken: 'other-job' },
  ];
  assert.equal(
    pickInviteToken(parties, 'job-3', 'Jack@jettx.ai'),
    'ce731b712f8eaf218161c24baa03c0731ad11ea93b15cb0b',
  );
  assert.equal(pickInviteToken(parties, 'job-3', 'nobody@jettx.ai'), null);
  assert.equal(pickInviteToken(parties, 'job-3', null), null);
});
