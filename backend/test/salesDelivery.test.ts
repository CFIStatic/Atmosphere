import test from 'node:test';
import assert from 'node:assert/strict';
import {
  phaseLabel,
  phaseProgress,
  dryingByArea,
  areaIsDry,
  deliveryEvents,
  deliverySentence,
  draftCustomerUpdate,
} from '../src/sales/delivery.js';

/**
 * Operations and Field, translated for Sales.
 *
 * The risk in this file is not a crash. It is a sentence that sounds
 * authoritative and is not true — telling a customer their house is dry when
 * the readings do not say so. Most of these tests are about what the code
 * refuses to claim.
 */

test('phases read as something a customer would understand', () => {
  assert.equal(phaseLabel('drying_complete'), 'Drying finished');
  assert.equal(phaseLabel('approval'), 'Waiting on carrier approval');
  assert.equal(phaseLabel('punch_list'), 'Punch list');
  assert.equal(phaseLabel(null), 'Not started');
  // An unknown phase still reads rather than showing a raw key.
  assert.equal(phaseLabel('some_new_phase'), 'some new phase');
});

test('progress runs forward along the ladder and refuses unknown phases', () => {
  assert.equal(phaseProgress('intake'), 0);
  assert.equal(phaseProgress('paid'), 1);
  assert.ok((phaseProgress('drying') ?? 0) > (phaseProgress('scheduled') ?? 0));
  assert.equal(phaseProgress('nonsense'), null);
});

test('the latest reading per area wins, and older ones are ignored', () => {
  const areas = [
    { id: 'a1', label: 'Kitchen', dry_goal_pct: 16 },
    { id: 'a2', label: 'Master bedroom', dry_goal_pct: 15 },
  ];
  // Newest first, as the query returns them.
  const readings = [
    { area_id: 'a1', moisture_pct: 14.2, taken_at: '2026-08-03T09:00:00Z' },
    { area_id: 'a1', moisture_pct: 19.8, taken_at: '2026-08-01T09:00:00Z' },
    { area_id: 'a2', moisture_pct: 17.4, taken_at: '2026-08-03T09:05:00Z' },
  ];

  const out = dryingByArea(areas, readings);
  assert.equal(out[0].latestPct, 14.2);
  assert.equal(out[0].readingAt, '2026-08-03T09:00:00Z');
  assert.equal(areaIsDry(out[0]), true);
  assert.equal(areaIsDry(out[1]), false);
});

test('an area with no goal gets no verdict rather than a guessed one', () => {
  // Dry standard depends on the material and the control reading. Guessing it
  // is how somebody tells a customer their floor is dry when it is not.
  const out = dryingByArea(
    [{ id: 'a1', label: 'Hall', dry_goal_pct: null }],
    [{ area_id: 'a1', moisture_pct: 12, taken_at: '2026-08-03T09:00:00Z' }],
  );
  assert.equal(out[0].latestPct, 12);
  assert.equal(areaIsDry(out[0]), null);
});

test('an area with no reading yet gets no verdict either', () => {
  const out = dryingByArea([{ id: 'a1', label: 'Hall', dry_goal_pct: 16 }], []);
  assert.equal(out[0].latestPct, null);
  assert.equal(areaIsDry(out[0]), null);
});

test('the headline only claims everything is dry when every judged area is', () => {
  const dry = [
    { label: 'Kitchen', latestPct: 14, goalPct: 16, readingAt: null },
    { label: 'Hall', latestPct: 13, goalPct: 16, readingAt: null },
  ];
  assert.match(deliverySentence({ phase: 'drying', areas: dry }), /all 2 areas are at dry standard/i);

  const mixed = [...dry, { label: 'Bath', latestPct: 22, goalPct: 16, readingAt: null }];
  assert.match(deliverySentence({ phase: 'drying', areas: mixed }), /2 of 3 areas/);

  // Unjudgeable areas are excluded from the count rather than assumed wet or
  // dry — either assumption would be a claim the readings do not support.
  const unknown = [{ label: 'Attic', latestPct: null, goalPct: null, readingAt: null }];
  assert.equal(deliverySentence({ phase: 'drying', areas: unknown }), 'Drying');
});

test('delivery events are labelled with the platform that recorded them', () => {
  const events = deliveryEvents({
    milestones: [
      { id: 'm1', label: 'Carrier approval received', kind: 'carrier', completed_at: '2026-08-02T10:00:00Z', due_at: '2026-08-02T00:00:00Z' },
      { id: 'm2', label: 'Not done yet', kind: 'internal', completed_at: null, due_at: '2026-08-09T00:00:00Z' },
    ],
    placements: [
      { id: 'p1', area_label: 'Kitchen', placed_at: '2026-07-30T08:00:00Z', removed_at: '2026-08-03T08:00:00Z' },
      { id: 'p2', area_label: 'Hall', placed_at: '2026-07-30T08:05:00Z', removed_at: null },
    ],
    areas: [{ id: 'a1', label: 'Kitchen' }],
    readings: [{ id: 'r1', area_id: 'a1', moisture_pct: 14.2, taken_at: '2026-08-03T09:00:00Z' }],
    alerts: [
      { id: 'x1', title: 'No readings in 2 days', severity: 'warn', category: 'drying', status: 'open', created_at: '2026-08-03T06:00:00Z' },
      { id: 'x2', title: 'Resolved thing', severity: 'critical', category: 'drying', status: 'resolved', created_at: '2026-08-01T06:00:00Z' },
      { id: 'x3', title: 'Just noise', severity: 'info', category: 'general', status: 'open', created_at: '2026-08-03T06:00:00Z' },
    ],
    updates: [
      { id: 'u1', audience: 'customer', subject: 'Day 8', status: 'sent', sent_at: '2026-08-02T12:00:00Z', created_at: '2026-08-02T11:00:00Z' },
      { id: 'u2', audience: 'customer', subject: 'Draft', status: 'draft', sent_at: null, created_at: '2026-08-03T11:00:00Z' },
    ],
  });

  const texts = events.map((e) => e.text);
  assert.ok(texts.some((t) => /Carrier approval received/.test(t)));
  assert.ok(!texts.some((t) => /Not done yet/.test(t)), 'incomplete milestones are not news');
  assert.ok(texts.some((t) => /Equipment pulled in Kitchen/.test(t)));
  assert.ok(texts.some((t) => /Equipment set in Hall/.test(t)));
  assert.ok(texts.some((t) => /Kitchen at 14\.2%/.test(t)));

  // A resolved alert would have a salesperson apologise for a problem the
  // office already fixed; an info alert is not worth their attention at all.
  assert.ok(!texts.some((t) => /Resolved thing/.test(t)));
  assert.ok(!texts.some((t) => /Just noise/.test(t)));
  // An unsent draft is not something that happened.
  assert.ok(!texts.some((t) => /Draft/.test(t)));

  assert.equal(events.find((e) => /Equipment/.test(e.text))?.source, 'field');
  assert.equal(events.find((e) => /Carrier approval/.test(e.text))?.source, 'operations');

  // Newest first.
  for (let i = 1; i < events.length; i += 1) {
    assert.ok(events[i - 1].at >= events[i].at, 'events are not in order');
  }
});

test('only the newest reading reaches the feed', () => {
  // A drying job produces one reading per area per day, sometimes hourly.
  // Letting them all through buries everything else.
  const events = deliveryEvents({
    areas: [{ id: 'a1', label: 'Kitchen' }],
    readings: Array.from({ length: 40 }, (_, i) => ({
      id: `r${i}`,
      area_id: 'a1',
      moisture_pct: 20 - i * 0.1,
      taken_at: `2026-08-0${(i % 3) + 1}T09:00:00Z`,
    })),
  });
  assert.equal(events.filter((e) => /Moisture reading/.test(e.text)).length, 1);
});

test('a drafted update says only what is recorded', () => {
  const draft = draftCustomerUpdate({
    customerName: 'Elena Nguyen',
    jobTitle: 'Water loss, Class 3',
    phase: 'drying',
    areas: [
      { label: 'Kitchen', latestPct: 14, goalPct: 16, readingAt: null },
      { label: 'Bath', latestPct: 22, goalPct: 16, readingAt: null },
    ],
    recentEvents: [
      { id: 'e1', text: 'Equipment pulled in Kitchen', tone: 'progress', source: 'field', at: '2026-08-03T08:00:00Z' },
      { id: 'e2', text: 'No readings in 2 days', tone: 'attention', source: 'operations', at: '2026-08-03T06:00:00Z' },
    ],
    senderName: 'Dana Ortiz',
  });

  assert.match(draft.body, /Hi Elena,/);
  assert.match(draft.body, /1 of 2 affected areas are at dry standard/);
  assert.match(draft.body, /Equipment pulled in Kitchen/);
  // An internal warning is not something to forward to the customer.
  assert.ok(!/No readings in 2 days/.test(draft.body), draft.body);
  assert.match(draft.body, /— Dana Ortiz/);
  // Non-deceptive and specific, which is the legal requirement as well as the
  // reason it gets opened.
  assert.match(draft.subject, /Update on your water loss/i);
  assert.ok(!/%/.test(draft.subject));
});

test('a draft with nothing to report does not invent progress', () => {
  const draft = draftCustomerUpdate({
    customerName: null,
    jobTitle: 'Storm damage',
    phase: null,
    areas: [],
    recentEvents: [],
  });
  assert.match(draft.body, /Hi there,/);
  assert.match(draft.body, /not started/i);
  assert.ok(!/Recently:/.test(draft.body));
  assert.ok(!/almost|nearly|shortly|soon/i.test(draft.body), 'no promises the record cannot back');
});
