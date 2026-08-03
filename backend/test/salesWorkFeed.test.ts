import test from 'node:test';
import assert from 'node:assert/strict';
import {
  phraseEvent,
  isCustomerRelevant,
  summariseJobs,
  daysSince,
  statusLabel,
  isOpen,
  type RawEvent,
  type JobRow,
} from '../src/sales/workFeed.js';

/**
 * The salesperson's view of delivery.
 *
 * Two things are worth testing here and they are both about wording rather than
 * plumbing: that an internal event comes out as something you could say to a
 * customer, and that a job which has gone quiet is spotted before the customer
 * spots it.
 */

const event = (over: Partial<RawEvent> = {}): RawEvent => ({
  id: 'e1',
  seq: 1,
  event_type: 'job.updated',
  entity_type: 'job',
  job_id: 'j1',
  actor_email: 'crew@example.com',
  summary: 'Job updated',
  changes: {},
  occurred_at: '2026-08-01T12:00:00Z',
  ...over,
});

const job = (over: Partial<JobRow> = {}): JobRow => ({
  id: 'j1',
  job_number: 412,
  title: 'Vargas Apartments — roof hail claim',
  status: 'in_progress',
  work_type: 'restoration',
  owner_id: 'u1',
  scheduled_start: null,
  scheduled_end: null,
  actual_start: null,
  actual_end: null,
  contract_amount: 27400,
  invoiced_amount: 0,
  paid_amount: 0,
  account_id: 'a1',
  contact_id: null,
  updated_at: '2026-08-01T12:00:00Z',
  ...over,
});

test('a status change reads as something you could say on the phone', () => {
  const started = phraseEvent(
    event({ event_type: 'job.status_changed', changes: { status: { from: 'scheduled', to: 'in_progress' } } }),
  );
  assert.equal(started.text, 'Crew started on site');
  assert.equal(started.tone, 'progress');

  assert.equal(
    phraseEvent(
      event({ event_type: 'job.status_changed', changes: { status: { to: 'complete' } } }),
    ).text,
    'Work finished on site',
  );
  assert.equal(
    phraseEvent(event({ event_type: 'job.status_changed', changes: { status: { to: 'on_hold' } } }))
      .tone,
    'attention',
  );
  assert.equal(
    phraseEvent(event({ event_type: 'job.status_changed', changes: { status: { to: 'paid' } } }))
      .tone,
    'money',
  );
});

test("a work log keeps the crew's own words", () => {
  const said = phraseEvent(
    event({
      event_type: 'work_log.created',
      changes: { body: { to: 'Roof tarped, four rooms on dehus' }, minutes: { to: 210 } },
    }),
  );
  // The hours are useful context but the sentence has to survive intact — it is
  // the only line on the page anybody would repeat verbatim to a customer.
  assert.ok(said.text.includes('Roof tarped, four rooms on dehus'), said.text);
  assert.ok(said.text.startsWith('3.5h logged'), said.text);
});

test('a short work log does not claim hours it does not have', () => {
  const said = phraseEvent(
    event({ event_type: 'work_log.created', changes: { body: { to: 'Dropped off fans' }, minutes: { to: 20 } } }),
  );
  assert.equal(said.text, 'Dropped off fans');
});

test('an unfamiliar event falls back to its stored sentence rather than vanishing', () => {
  const said = phraseEvent(
    event({ event_type: 'something.new', summary: 'Something nobody has taught this page yet' }),
  );
  assert.equal(said.text, 'Something nobody has taught this page yet');
});

test('sign-ins and empty touches are not customer news', () => {
  assert.equal(isCustomerRelevant(event({ entity_type: 'session', event_type: 'auth.signed_in' })), false);
  assert.equal(isCustomerRelevant(event({ event_type: 'auth.signed_out', entity_type: 'job' })), false);
  // A job row touched with nothing meaningful changed.
  assert.equal(isCustomerRelevant(event({ event_type: 'job.updated', changes: { notes: { to: 'x' } } })), false);
  assert.equal(
    isCustomerRelevant(event({ event_type: 'job.updated', changes: { scheduled_start: { to: '2026-08-09' } } })),
    true,
  );
});

test('a job with a crew on it and no news for days is flagged', () => {
  const now = new Date('2026-08-10T00:00:00Z');
  const [summary] = summariseJobs({
    jobs: [job({ status: 'in_progress', updated_at: '2026-08-01T00:00:00Z' })],
    events: [],
    accounts: new Map([['a1', 'Vargas Apartments']]),
    contacts: new Map(),
    now,
  });

  assert.equal(summary.quiet, true);
  assert.equal(summary.daysQuiet, 9);
  assert.equal(summary.customer, 'Vargas Apartments');
  assert.equal(summary.statusLabel, 'On site');
});

test('a scheduled job is allowed to sit quietly until its start date', () => {
  const now = new Date('2026-08-10T00:00:00Z');
  const [summary] = summariseJobs({
    jobs: [job({ status: 'scheduled', updated_at: '2026-08-01T00:00:00Z' })],
    events: [],
    accounts: new Map(),
    contacts: new Map(),
    now,
  });
  // Nine days with nothing happening on a job that has not started yet is
  // normal, and flagging it would train somebody to ignore the flag.
  assert.equal(summary.quiet, false);
  assert.equal(summary.daysQuiet, 9);
});

test('a closed job is never flagged as quiet', () => {
  const now = new Date('2027-01-01T00:00:00Z');
  for (const status of ['complete', 'paid', 'cancelled', 'invoiced']) {
    const [summary] = summariseJobs({
      jobs: [job({ status, updated_at: '2026-01-01T00:00:00Z' })],
      events: [],
      accounts: new Map(),
      contacts: new Map(),
      now,
    });
    assert.equal(summary.quiet, false, `${status} should not be flagged`);
    assert.equal(summary.open, false);
  }
});

test('the newest event wins as the last thing that happened', () => {
  const [summary] = summariseJobs({
    jobs: [job()],
    // Newest first, which is the order the query returns.
    events: [
      event({ seq: 9, event_type: 'work_log.created', changes: { body: { to: 'Dehus pulled' } }, occurred_at: '2026-08-09T09:00:00Z' }),
      event({ seq: 4, event_type: 'job.status_changed', changes: { status: { to: 'in_progress' } }, occurred_at: '2026-08-02T09:00:00Z' }),
    ],
    accounts: new Map(),
    contacts: new Map(),
    now: new Date('2026-08-09T12:00:00Z'),
  });

  assert.equal(summary.lastEventText, 'Dehus pulled');
  assert.equal(summary.lastEventAt, '2026-08-09T09:00:00Z');
  assert.equal(summary.quiet, false);
});

test('events that are not customer news do not count as the job being active', () => {
  // Otherwise somebody signing in would reset the quiet clock on every job and
  // the flag would never fire.
  const [summary] = summariseJobs({
    jobs: [job({ status: 'in_progress', updated_at: '2026-08-01T00:00:00Z' })],
    events: [
      event({ seq: 30, entity_type: 'session', event_type: 'auth.signed_in', occurred_at: '2026-08-10T08:00:00Z' }),
    ],
    accounts: new Map(),
    contacts: new Map(),
    now: new Date('2026-08-10T09:00:00Z'),
  });
  assert.equal(summary.quiet, true);
});

test('a contact stands in when there is no account', () => {
  const [summary] = summariseJobs({
    jobs: [job({ account_id: null, contact_id: 'c1' })],
    events: [],
    accounts: new Map(),
    contacts: new Map([['c1', 'Elena Nguyen']]),
    now: new Date('2026-08-01T12:00:00Z'),
  });
  assert.equal(summary.customer, 'Elena Nguyen');
});

test('the small helpers behave', () => {
  assert.equal(statusLabel('in_progress'), 'On site');
  assert.equal(statusLabel('some_new_status'), 'some new status');
  assert.equal(isOpen('in_progress'), true);
  assert.equal(isOpen('paid'), false);
  assert.equal(daysSince(null), null);
  assert.equal(daysSince('not a date'), null);
});
